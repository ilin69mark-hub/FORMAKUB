import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { defaultKitchen } from "@/lib/configurator/defaults";
import { calculatePrice } from "@/lib/configurator/pricing";
import { applyProjectPriceHistory } from "@/lib/server/projects";

import {
  BATCHES_COLLECTION,
  JOBS_COLLECTION,
  createProjectRecalculation,
  createRecalculationBatch,
  getProjectRecalculation,
  startProjectRecalculation,
} from "./jobs";

let dir = "";
const T = "2026-11-10T00:00:00.000Z";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-apply-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  for (const file of ["projects.json", BATCHES_COLLECTION, JOBS_COLLECTION]) {
    rmSync(path.join(dir, file), { force: true });
  }
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeProject() {
  const config = defaultKitchen();
  const price = calculatePrice(config);
  writeFileSync(
    path.join(dir, "projects.json"),
    JSON.stringify([
      {
        id: "abcdefgh",
        config,
        schemaVersion: 1,
        calcVersion: "calc-2026.11.0",
        priceVersion: "price-1",
        price,
        priceHistory: [],
        createdAt: T,
        updatedAt: T,
      },
    ]),
    "utf8",
  );
  return { config, price };
}

function event(price: ReturnType<typeof calculatePrice>, to = "price-2") {
  return {
    id: "hist-1",
    projectId: "abcdefgh",
    operationId: "batch-1",
    reason: "manual_recalc" as const,
    fromPriceVersionId: "price-1",
    toPriceVersionId: to,
    schemaVersion: 1,
    calcVersion: "calc-2026.11.0",
    oldPrice: price.total,
    newPrice: price.total,
    delta: 0,
    breakdown: price,
    breakdownVersion: 1,
    requestFingerprint: "a".repeat(64),
    requestFingerprintVersion: "sha256-canonical-json-v1",
    computedAt: T,
  };
}

async function runningJob() {
  await createRecalculationBatch({
    id: "batch-1",
    priceVersionId: "price-2",
    trigger: "manual",
    createdBy: "admin:test",
    now: T,
  });
  const created = await createProjectRecalculation({
    batchId: "batch-1",
    projectId: "abcdefgh",
    toPriceVersionId: "price-2",
    calcVersion: "calc-2026.11.0",
    deltaReason: "manual",
    createdBy: "admin:test",
    now: T,
  });
  if (!created.ok) throw new Error("job не создан");
  const started = await startProjectRecalculation(created.value.id, {
    fromPriceVersionId: "price-1",
    oldPrice: 100,
    now: T,
  });
  if (!started.ok) throw new Error("job не запущен");
  return started.value;
}

describe("CA-T-407: атомарная запись проекта и истории", () => {
  it("записывает цену/версии/историю одной записью и закрывает job", async () => {
    const { price } = writeProject();
    const job = await runningJob();
    const result = await applyProjectPriceHistory({
      jobId: job.id,
      expectedSourcePriceVersion: "price-1",
      event: event(price),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.priceVersion).toBe("price-2");
    expect(result.project.priceHistory).toHaveLength(1);

    const onDisk = JSON.parse(
      readFileSync(path.join(dir, "projects.json"), "utf8"),
    ) as Array<{ priceVersion: string; priceHistory: unknown[] }>;
    expect(onDisk[0]?.priceVersion).toBe("price-2");
    expect(onDisk[0]?.priceHistory).toHaveLength(1);
    expect((await getProjectRecalculation(job.id))?.status).toBe("completed");
  });

  it("не пишет при stale source", async () => {
    const { price } = writeProject();
    const before = readFileSync(path.join(dir, "projects.json"), "utf8");
    const result = await applyProjectPriceHistory({
      expectedSourcePriceVersion: "price-other",
      event: event(price),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(before);
  });

  it("CA-T-412: не подменяет calcVersion проекта результатом другой сборки", async () => {
    const { price } = writeProject();
    const before = readFileSync(path.join(dir, "projects.json"), "utf8");
    const result = await applyProjectPriceHistory({
      expectedSourcePriceVersion: "price-1",
      event: { ...event(price), calcVersion: "calc-2026.12.0" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.issues[0]?.code).toBe("CALC_VERSION_MISMATCH");
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(before);
  });

  it("CA-516-03: не применяет результат пересчёта к legacy-фасаду", async () => {
    const { price } = writeProject();
    const projects = JSON.parse(
      readFileSync(path.join(dir, "projects.json"), "utf8"),
    ) as Array<{ config: Record<string, unknown> }>;
    projects[0]!.config.facadeMaterial = "glass";
    writeFileSync(
      path.join(dir, "projects.json"),
      JSON.stringify(projects),
      "utf8",
    );
    const before = readFileSync(path.join(dir, "projects.json"), "utf8");

    const result = await applyProjectPriceHistory({
      expectedSourcePriceVersion: "price-1",
      event: event(price),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.issues[0]?.code).toBe("LEGACY_FACADE_MATERIAL");
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(before);
  });

  it("повтор события не создаёт дубль", async () => {
    const { price } = writeProject();
    const first = await applyProjectPriceHistory({
      expectedSourcePriceVersion: "price-1",
      event: event(price),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await applyProjectPriceHistory({
      expectedSourcePriceVersion: "price-2",
      event: event(price),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replay).toBe(true);
    expect(second.project.priceHistory).toHaveLength(1);
  });
});
