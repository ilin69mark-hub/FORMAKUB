import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  BATCHES_COLLECTION,
  JOBS_COLLECTION,
  createProjectRecalculation,
  createRecalculationBatch,
  getProjectRecalculation,
  startProjectRecalculation,
} from "./jobs";
import { RecalculationWorker } from "./worker";

let dir = "";
const T = "2026-11-10T00:00:00.000Z";
const T05 = "2026-11-10T00:00:05.000Z";
const T31 = "2026-11-10T00:00:31.000Z";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-worker-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  for (const file of [BATCHES_COLLECTION, JOBS_COLLECTION]) {
    rmSync(path.join(dir, file), { force: true });
  }
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

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
    projectId: "project-1",
    toPriceVersionId: "price-2",
    calcVersion: "calc-2026.11.0",
    deltaReason: "manual",
    createdBy: "admin:test",
    now: T,
  });
  if (!created.ok) throw new Error("job");
  const started = await startProjectRecalculation(created.value.id, {
    fromPriceVersionId: "price-1",
    oldPrice: 100,
    now: T,
  });
  if (!started.ok) throw new Error("start");
  return started.value;
}

describe("CA-T-404: worker heartbeat/recovery", () => {
  it("обновляет heartbeat running-задания", async () => {
    const job = await runningJob();
    const worker = new RecalculationWorker({
      heartbeatIntervalMs: 1000,
      staleAfterMs: 30_000,
      maxRecoveries: 3,
    });
    const report = await worker.runOnce(T05);
    expect(report.heartbeated).toBe(1);
    expect((await getProjectRecalculation(job.id))?.lastHeartbeatAt).not.toBe(T);
  });

  it("возвращает зависшую попытку в pending", async () => {
    const job = await runningJob();
    const worker = new RecalculationWorker({
      heartbeatIntervalMs: 1000,
      staleAfterMs: 30_000,
      maxRecoveries: 3,
    });
    const report = await worker.runOnce(T31);
    expect(report.recovered).toBe(1);
    expect((await getProjectRecalculation(job.id))?.status).toBe("pending");
  });

  it("после исчерпания maxRecoveries переводит в dead_letter", async () => {
    const job = await runningJob();
    const worker = new RecalculationWorker({
      heartbeatIntervalMs: 1000,
      staleAfterMs: 30_000,
      maxRecoveries: 3,
    });

    await worker.runOnce(T31);
    expect((await getProjectRecalculation(job.id))?.status).toBe("pending");

    for (let attempt = 2; attempt <= 4; attempt += 1) {
      await startProjectRecalculation(job.id, {
        fromPriceVersionId: "price-1",
        now: T,
      });
      await worker.runOnce(T31);
    }
    expect((await getProjectRecalculation(job.id))?.status).toBe("dead_letter");
  });

  it("start/stop управляет жизненным циклом", async () => {
    await runningJob();
    const worker = new RecalculationWorker({
      heartbeatIntervalMs: 1000,
      staleAfterMs: 30_000,
      maxRecoveries: 3,
    });
    await worker.start();
    expect(worker.isRunning).toBe(true);
    worker.stop();
    expect(worker.isRunning).toBe(false);
  });
});
