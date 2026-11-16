import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBootstrap } from "./bootstrap";
import { seedDisplayMetadata } from "./display-metadata";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";
import { importPriceItems } from "./import";
import { publishPricingVersion } from "./publish";
import { getProject, saveProject } from "@/lib/server/projects";
import { RecalculationWorker } from "./worker";
import { getPublishedVersion } from "./pricing";
import { BATCHES_COLLECTION, JOBS_COLLECTION } from "./jobs";
import { readCollection, updateCollection } from "@/lib/server/store";
import { defaultKitchen } from "@/lib/configurator/defaults";
import type { StoredProject } from "@/lib/configurator/types";
import type { ProjectRecalculation, RecalculationBatch } from "./schema";

const ACTOR = { actorId: "block2-test", actorRole: "calc-admin" as const };
let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-publish-recalc-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-block2.1",
    pricingLabel: "block2 base",
    now: "2026-11-12T00:00:00.000Z",
  });
  await seedDisplayMetadata({ actorId: "test", actorRole: "system" });
  await seedRulesSnapshotFixture();
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("Stage 8 / Block 2: publish → batch → worker", () => {
  it("полный цикл с успешным и заблокированным проектом", async () => {
    const fresh = await saveProject({ config: defaultKitchen() });
    const old = await saveProject({ config: defaultKitchen() });
    expect(fresh.ok && old.ok).toBe(true);
    if (!fresh.ok || !old.ok) return;

    await updateCollection<StoredProject, void>("projects.json", (items) => ({
      items: items.map((project) =>
        project.id === old.project.id
          ? { ...project, calcVersion: "calc-2026.11.0", schemaVersion: 1 }
          : project,
      ),
      result: undefined,
    }));

    const report = await importPriceItems(ACTOR);
    expect(report.snapshot).not.toBeNull();
    const published = await publishPricingVersion(report.snapshot!.versionId, ACTOR, {
      enqueueRecalculation: true,
    });

    const batches = await readCollection<RecalculationBatch>(BATCHES_COLLECTION);
    const batch = batches.find((item) => item.id === `batch-publish-${published.version.id}`);
    expect(batch).toBeDefined();
    expect(batch!.priceVersionId).toBe(published.version.id);
    expect(batch!.trigger).toBe("publish");

    const jobsBefore = await readCollection<ProjectRecalculation>(JOBS_COLLECTION);
    expect(jobsBefore.filter((job) => job.batchId === batch!.id)).toHaveLength(2);

    const worker = new RecalculationWorker({ reconcileIntervalMs: 0 });
    for (let i = 0; i < 4; i += 1) await worker.runOnce();

    const freshRead = await getProject(fresh.project.id);
    expect(freshRead.status).toBe("ok");
    if (freshRead.status !== "ok") return;
    expect(freshRead.project.priceVersion).toBe(published.version.id);
    expect(freshRead.project.calcVersion).toBe("calc-2026.11.2");
    expect(freshRead.project.config).toEqual(fresh.project.config);
    expect((freshRead.project.priceHistory ?? []).filter((event) => event.reason === "manual_recalc")).toHaveLength(1);

    const oldRead = await getProject(old.project.id);
    expect(oldRead.status).toBe("ok");
    if (oldRead.status !== "ok") return;
    expect(oldRead.project.priceVersion).toBe("price-block2.1");
    expect(oldRead.project.calcVersion).toBe("calc-2026.11.0");
    expect(oldRead.project.config).toEqual(old.project.config);

    const jobsAfter = await readCollection<ProjectRecalculation>(JOBS_COLLECTION);
    const oldJob = jobsAfter.find((job) => job.projectId === old.project.id && job.batchId === batch!.id);
    expect(oldJob?.status).not.toBe("completed");
  });

  it("повторный publish handler/ensure не дублирует batch и jobs", async () => {
    const batches = await readCollection<RecalculationBatch>(BATCHES_COLLECTION);
    const jobs = await readCollection<ProjectRecalculation>(JOBS_COLLECTION);
    const batch = batches.find((item) => item.id.startsWith("batch-publish-"))!;
    const count = jobs.filter((job) => job.batchId === batch.id).length;
    const { ensurePublishRecalculationBatch } = await import("./publish-recalc");
    const versions = await readCollection<{ id: string; status: string; snapshot: unknown[] }>("pricing-versions.json");
    const published = versions.find((version) => version.status === "published") as never;
    await ensurePublishRecalculationBatch(published, ACTOR.actorId);
    const after = await readCollection<ProjectRecalculation>(JOBS_COLLECTION);
    expect(after.filter((job) => job.batchId === batch.id)).toHaveLength(count);
  });

  it("worker recovery восстанавливает потерянный batch", async () => {
    await updateCollection<RecalculationBatch, void>(BATCHES_COLLECTION, () => ({
      items: [],
      result: undefined,
    }));
    await updateCollection<ProjectRecalculation, void>(JOBS_COLLECTION, () => ({
      items: [],
      result: undefined,
    }));
    const worker = new RecalculationWorker({
      recoverPublishedBatches: true,
      reconcileIntervalMs: 0,
    });
    await worker.runOnce();
    const batches = await readCollection<RecalculationBatch>(BATCHES_COLLECTION);
    const published = await getPublishedVersion();
    expect(batches.some((batch) => batch.id === `batch-publish-${published!.id}`)).toBe(true);
    const jobs = await readCollection<ProjectRecalculation>(JOBS_COLLECTION);
    expect(jobs.length).toBeGreaterThan(0);
  });
});
