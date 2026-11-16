import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyBootstrap } from "./bootstrap";
import { DISPLAY_METADATA_COLLECTION, seedDisplayMetadata } from "./display-metadata";
import {
  createProjectRecalculation,
  createRecalculationBatch,
  getProjectRecalculation,
} from "./jobs";
import type { PricingVersion } from "./schema";
import {
  RecalculationWorker,
  isRecalculationRuntimeWorkerRunning,
  startRecalculationRuntimeWorker,
  stopRecalculationRuntimeWorker,
} from "./worker";
import { defaultKitchen } from "@/lib/configurator/defaults";
import type { StoredProject } from "@/lib/configurator/types";
import { getProject, saveProject } from "@/lib/server/projects";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";
import { readCollection, updateCollection } from "@/lib/server/store";

/**
 * CA-T-404 — интеграционные тесты runtime-worker на реальном
 * DataResolver → Engine → Display Adapter → apply gate → PriceHistory.
 * Каждый тест работает в отдельном временном SQLite-каталоге; production
 * `data/` не используется.
 */

const JOBS = "project-recalculations.json";

async function withFreshData<T>(task: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "formakub-worker-runtime-"));
  const previousDir = process.env.FORMAKUB_DATA_DIR;
  const previousStorage = process.env.FORMAKUB_STORAGE;
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
  try {
    return await task();
  } finally {
    if (previousDir === undefined) delete process.env.FORMAKUB_DATA_DIR;
    else process.env.FORMAKUB_DATA_DIR = previousDir;
    if (previousStorage === undefined) delete process.env.FORMAKUB_STORAGE;
    else process.env.FORMAKUB_STORAGE = previousStorage;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function seedProject(): Promise<{
  projectId: string;
  calcVersion: string;
  versionId: string;
}> {
  const bootstrap = await applyBootstrap({
    pricingVersionId: "price-runtime.1",
    pricingLabel: "Runtime worker test",
    now: "2026-11-10T00:00:00.000Z",
  });
  await seedRulesSnapshotFixture();
  await seedDisplayMetadata({ actorId: "test", actorRole: "system" });
  const saved = await saveProject({ config: defaultKitchen() });
  if (!saved.ok) throw new Error("проект не сохранён");
  if (!saved.project.calcVersion) throw new Error("calcVersion не выставлен");
  return {
    projectId: saved.project.id,
    calcVersion: saved.project.calcVersion,
    versionId: bootstrap.version.id,
  };
}

/** Новая published-версия на основе текущей; предыдущая published → superseded. */
async function addPublishedVersion(id: string, seq: number): Promise<PricingVersion> {
  const versions = await readCollection<PricingVersion>("pricing-versions.json");
  const base = versions.find((version) => version.status === "published") ?? versions[0];
  if (!base) throw new Error("нет базовой версии прайса");
  const snapshot = base.snapshot.map((item, index) =>
    index === 0 ? { ...item, amount: item.amount + 1 } : item,
  );
  const next: PricingVersion = {
    ...base,
    id,
    label: id,
    status: "published",
    snapshot,
    publishedSeq: seq,
    publishedAt: "2026-11-10T00:00:00.000Z",
    publishedBy: "test",
  };
  await updateCollection<PricingVersion, void>("pricing-versions.json", (items) => ({
    items: [
      ...items.map((version) =>
        version.status === "published"
          ? { ...version, status: "superseded" as const }
          : version,
      ),
      next,
    ],
    result: undefined,
  }));
  return next;
}

async function makeJob(input: {
  projectId: string;
  calcVersion: string;
  toPriceVersionId: string;
  batchId: string;
}): Promise<string> {
  const batch = await createRecalculationBatch({
    id: input.batchId,
    priceVersionId: input.toPriceVersionId,
    trigger: "manual",
    createdBy: "test",
  });
  if (!batch.ok) throw new Error("batch не создан");
  const job = await createProjectRecalculation({
    batchId: input.batchId,
    projectId: input.projectId,
    toPriceVersionId: input.toPriceVersionId,
    calcVersion: input.calcVersion,
    deltaReason: "manual",
    createdBy: "test",
  });
  if (!job.ok) throw new Error("job не создан");
  return job.value.id;
}

afterEach(() => {
  stopRecalculationRuntimeWorker();
});

describe("CA-T-404: runtime worker полного жизненного цикла", () => {
  it("захватывает pending, выполняет пересчёт и пишет PriceHistory без изменения config", async () => {
    await withFreshData(async () => {
      const seed = await seedProject();
      await addPublishedVersion("price-runtime.2", 2);
      const jobId = await makeJob({
        projectId: seed.projectId,
        calcVersion: seed.calcVersion,
        toPriceVersionId: "price-runtime.2",
        batchId: "batch-runtime-1",
      });

      const before = await getProject(seed.projectId);
      if (before.status !== "ok") throw new Error("проект не прочитан");

      const worker = new RecalculationWorker({ reconcileIntervalMs: 0 });
      const report = await worker.runOnce("2026-11-10T00:00:10.000Z");

      expect(report.completed).toBe(1);
      expect(report.claimed).toBe(1);

      const job = await getProjectRecalculation(jobId);
      expect(job?.status).toBe("completed");
      expect(job?.newPrice).not.toBeNull();

      const after = await getProject(seed.projectId);
      if (after.status !== "ok") throw new Error("проект не прочитан после");
      expect(after.project.priceVersion).toBe("price-runtime.2");
      expect((after.project.priceHistory ?? []).filter((event) => event.reason === "manual_recalc")).toHaveLength(1);
      expect(after.project.config).toEqual(before.project.config);
      expect(after.project.pins).toEqual(before.project.pins);
      expect(after.project.price.total).toBe(job?.newPrice);
    });
  });

  it("CA-516-03: worker не пересчитывает проект с legacy-фасадом и не меняет историю", async () => {
    await withFreshData(async () => {
      const seed = await seedProject();
      await updateCollection<StoredProject, void>("projects.json", (items) => ({
        items: items.map((project) =>
          project.id === seed.projectId
            ? {
                ...project,
                config: { ...project.config, facadeMaterial: "glass" } as typeof project.config,
              }
            : project,
        ),
        result: undefined,
      }));
      await addPublishedVersion("price-runtime.2", 2);
      const jobId = await makeJob({
        projectId: seed.projectId,
        calcVersion: seed.calcVersion,
        toPriceVersionId: "price-runtime.2",
        batchId: "batch-runtime-legacy-facade",
      });

      const before = await getProject(seed.projectId);
      if (before.status !== "ok") throw new Error("проект не прочитан");

      const worker = new RecalculationWorker({ reconcileIntervalMs: 0 });
      const report = await worker.runOnce("2026-11-10T00:00:10.000Z");

      expect(report.failed).toBe(1);
      const job = await getProjectRecalculation(jobId);
      expect(job?.status).toBe("failed");
      expect(job?.error?.code).toBe("LEGACY_FACADE_MATERIAL");

      const after = await getProject(seed.projectId);
      if (after.status !== "ok") throw new Error("проект не прочитан после");
      expect(after.project.config).toEqual(before.project.config);
      expect(after.project.price.total).toBe(before.project.price.total);
      expect(after.project.priceVersion).toBe(before.project.priceVersion);
      expect(after.project.priceHistory).toEqual(before.project.priceHistory);
      expect(after.project.pins).toEqual(before.project.pins);
    });
  });

  it("повторная обработка не дублирует историю цен", async () => {
    await withFreshData(async () => {
      const seed = await seedProject();
      await addPublishedVersion("price-runtime.2", 2);
      await makeJob({
        projectId: seed.projectId,
        calcVersion: seed.calcVersion,
        toPriceVersionId: "price-runtime.2",
        batchId: "batch-runtime-2",
      });

      const worker = new RecalculationWorker({
        reconcileIntervalMs: 60_000,
      });
      await worker.runOnce("2026-11-10T00:00:10.000Z");
      const second = await worker.runOnce("2026-11-10T00:00:20.000Z");
      expect(second.claimed).toBe(0);

      const after = await getProject(seed.projectId);
      if (after.status !== "ok") throw new Error("проект не прочитан");
      expect((after.project.priceHistory ?? []).filter((event) => event.reason === "manual_recalc")).toHaveLength(1);
    });
  });

  it("два параллельных цикла не захватывают одно задание дважды", async () => {
    await withFreshData(async () => {
      const seed = await seedProject();
      await addPublishedVersion("price-runtime.2", 2);
      await makeJob({
        projectId: seed.projectId,
        calcVersion: seed.calcVersion,
        toPriceVersionId: "price-runtime.2",
        batchId: "batch-runtime-3",
      });

      const first = new RecalculationWorker({ reconcileIntervalMs: 0 });
      const second = new RecalculationWorker({ reconcileIntervalMs: 0 });
      await Promise.all([
        first.runOnce("2026-11-10T00:00:10.000Z"),
        second.runOnce("2026-11-10T00:00:10.000Z"),
      ]);

      const after = await getProject(seed.projectId);
      if (after.status !== "ok") throw new Error("проект не прочитан");
      expect((after.project.priceHistory ?? []).filter((event) => event.reason === "manual_recalc")).toHaveLength(1);
    });
  });

  it("retryable ошибка проходит retry policy и доходит до dead_letter", async () => {
    await withFreshData(async () => {
      const seed = await seedProject();
      await addPublishedVersion("price-runtime.2", 2);
      const jobId = await makeJob({
        projectId: seed.projectId,
        calcVersion: seed.calcVersion,
        toPriceVersionId: "price-runtime.2",
        batchId: "batch-runtime-4",
      });

      // DisplayMetadata отсутствует → retryable DISPLAY_METADATA_UNAVAILABLE.
      await updateCollection(DISPLAY_METADATA_COLLECTION, () => ({
        items: [],
        result: undefined,
      }));

      const worker = new RecalculationWorker({ reconcileIntervalMs: 60_000 });
      await worker.runOnce("2026-11-10T00:00:10.000Z");
      expect((await getProjectRecalculation(jobId))?.status).toBe("pending");
      await worker.runOnce("2026-11-10T00:00:20.000Z");
      expect((await getProjectRecalculation(jobId))?.status).toBe("pending");
      await worker.runOnce("2026-11-10T00:00:30.000Z");
      const finalJob = await getProjectRecalculation(jobId);
      expect(finalJob?.status).toBe("dead_letter");
      expect(finalJob?.error?.retryable).toBe(true);

      const after = await getProject(seed.projectId);
      if (after.status !== "ok") throw new Error("проект не прочитан");
      expect((after.project.priceHistory ?? []).filter((event) => event.reason === "manual_recalc")).toHaveLength(0);
    });
  });

  it("reconciliation вызывается в runtime и дозаполняет задание", async () => {
    await withFreshData(async () => {
      await seedProject();
      await addPublishedVersion("price-runtime.2", 2);
      // Batch есть, job отсутствует — его должен создать reconcile.
      const batch = await createRecalculationBatch({
        id: "batch-runtime-5",
        priceVersionId: "price-runtime.2",
        trigger: "manual",
        createdBy: "test",
      });
      if (!batch.ok) throw new Error("batch не создан");

      const worker = new RecalculationWorker({ reconcileIntervalMs: 0 });
      const report = await worker.runOnce("2026-11-10T00:00:10.000Z");

      expect(report.reconciliation?.createdJobs).toBe(1);
      const jobs = await readCollection(JOBS);
      expect(jobs).toHaveLength(1);
      expect(report.completed).toBe(1);
    });
  });

  it("runtime-worker — единственный экземпляр в процессе", async () => {
    await withFreshData(async () => {
      const first = await startRecalculationRuntimeWorker({
        reconcileIntervalMs: 60_000,
      });
      const second = await startRecalculationRuntimeWorker({
        reconcileIntervalMs: 60_000,
      });
      expect(second).toBe(first);
      expect(isRecalculationRuntimeWorkerRunning()).toBe(true);
      stopRecalculationRuntimeWorker();
      expect(isRecalculationRuntimeWorkerRunning()).toBe(false);
    });
  });
});
