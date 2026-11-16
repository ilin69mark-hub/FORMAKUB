import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultKitchen } from "@/lib/configurator/defaults";
import { calculatePrice } from "@/lib/configurator/pricing";
import { applyProjectPriceHistory } from "@/lib/server/projects";
import type { ProjectPriceHistory, StoredProject } from "@/lib/configurator/types";

const COUNT = 200;
const T = "2026-11-10T00:00:00.000Z";
let dir = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-mass-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const projects: StoredProject[] = [];
  const configs = new Map<string, StoredProject["config"]>();
  for (let index = 0; index < COUNT; index += 1) {
    const id = `p${String(index).padStart(7, "0")}`;
    const config = defaultKitchen();
    const price = calculatePrice(config);
    configs.set(id, config);
    projects.push({
      id,
      config,
      schemaVersion: 1,
      calcVersion: "calc-2026.11.0",
      priceVersion: "price-1",
      price,
      priceHistory: [],
      createdAt: T,
      updatedAt: T,
    });
  }
  writeFileSync(path.join(dir, "projects.json"), JSON.stringify(projects), "utf8");
  return { projects, configs };
}

function event(project: StoredProject): ProjectPriceHistory {
  return {
    id: `hist-${project.id}`,
    projectId: project.id,
    operationId: "mass-batch",
    reason: "manual_recalc",
    fromPriceVersionId: "price-1",
    toPriceVersionId: "price-2",
    schemaVersion: 1,
    calcVersion: "calc-2026.11.0",
    oldPrice: project.price.total,
    newPrice: project.price.total,
    delta: 0,
    breakdown: project.price,
    breakdownVersion: 1,
    requestFingerprint: "a".repeat(64),
    requestFingerprintVersion: "sha256-canonical-json-v1",
    computedAt: T,
  };
}

describe("CA-T-411: массовый пересчёт", () => {
  it(
    "200 проектов: 0 потерь конфигураций, время записано",
    async () => {
      const { projects, configs } = fixture();
      const started = Date.now();

      for (const project of projects) {
        const result = await applyProjectPriceHistory({
          expectedSourcePriceVersion: "price-1",
          event: event(project),
        });
        expect(result.ok).toBe(true);
      }

      const durationMs = Date.now() - started;
      const onDisk = JSON.parse(
        readFileSync(path.join(dir, "projects.json"), "utf8"),
      ) as StoredProject[];

      expect(onDisk).toHaveLength(COUNT);
      expect(onDisk.every((project) => project.priceVersion === "price-2")).toBe(true);
      expect(onDisk.every((project) => project.priceHistory?.length === 1)).toBe(true);
      expect(
        onDisk.every(
          (project) => JSON.stringify(project.config) === JSON.stringify(configs.get(project.id)),
        ),
      ).toBe(true);

      // Замер сохраняется в выводе теста и в отчёте задачи.
      console.info(`CA-T-411 mass recalc: ${COUNT} projects, ${durationMs} ms`);
      expect(durationMs).toBeGreaterThan(0);
    },
    30_000,
  );
});
