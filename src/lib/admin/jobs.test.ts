import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  BATCHES_COLLECTION,
  JOBS_COLLECTION,
  completeProjectRecalculation,
  createProjectRecalculation,
  createRecalculationBatch,
  failProjectRecalculation,
  getProjectRecalculation,
  getRecalculationBatch,
  listProjectRecalculations,
  retryProjectRecalculation,
  startProjectRecalculation,
} from "./jobs";

let dir = "";

const T = "2026-11-10T00:00:00.000Z";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-jobs-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(path.join(dir, BATCHES_COLLECTION), { force: true });
  rmSync(path.join(dir, JOBS_COLLECTION), { force: true });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

async function batch(id = "batch-1") {
  const result = await createRecalculationBatch({
    id,
    priceVersionId: "price-2026.11.1",
    trigger: "manual",
    createdBy: "admin:test",
    now: T,
  });
  if (!result.ok) throw new Error("batch не создан");
  return result.value;
}

async function job(batchId = "batch-1") {
  const result = await createProjectRecalculation({
    batchId,
    projectId: "project-1",
    toPriceVersionId: "price-2026.11.1",
    calcVersion: "calc-2026.11.0",
    deltaReason: "manual",
    createdBy: "admin:test",
    now: T,
  });
  if (!result.ok) throw new Error("job не создан");
  return result.value;
}

describe("CA-T-403: модель заданий", () => {
  it("создаёт batch и job, from при создании отсутствует", async () => {
    await batch();
    const created = await job();
    expect(created.status).toBe("pending");
    expect(created.fromPriceVersionId).toBeNull();
    expect(created.attempt).toBe(0);
    expect(created.attempts).toEqual([]);
    const batchState = await getRecalculationBatch("batch-1");
    expect(batchState?.totalCount).toBe(1);
    expect(batchState?.pendingCount).toBe(1);
  });

  it("U(projectId,toPriceVersionId,operationId) не создаёт дубль", async () => {
    await batch();
    const first = await job();
    const second = await createProjectRecalculation({
      batchId: "batch-1",
      projectId: "project-1",
      toPriceVersionId: "price-2026.11.1",
      calcVersion: "calc-2026.11.0",
      deltaReason: "manual",
      createdBy: "admin:test",
      now: T,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.value.id).toBe(first.id);
    expect(await listProjectRecalculations({ batchId: "batch-1" })).toHaveLength(1);
  });

  it("конфликтует при другом calcVersion и не меняет исходную job", async () => {
    await batch();
    const first = await job();
    const conflict = await createProjectRecalculation({
      batchId: "batch-1",
      projectId: "project-1",
      toPriceVersionId: "price-2026.11.1",
      calcVersion: "calc-other",
      deltaReason: "manual",
      createdBy: "admin:test",
      now: T,
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.issues[0]?.code).toBe("JOB_PARAMETER_CONFLICT");
    expect(conflict.issues[0]?.path).toBe("calcVersion");
    expect(await listProjectRecalculations({ batchId: "batch-1" })).toHaveLength(1);
    expect(await getProjectRecalculation(first.id)).toEqual(first);
  });

  it("конфликтует при другом deltaReason", async () => {
    await batch();
    await job();
    const conflict = await createProjectRecalculation({
      batchId: "batch-1",
      projectId: "project-1",
      toPriceVersionId: "price-2026.11.1",
      calcVersion: "calc-2026.11.0",
      deltaReason: "price_publish",
      createdBy: "admin:test",
      now: T,
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.issues[0]?.path).toBe("deltaReason");
  });

  it("конфликтует при другом maxAttempts", async () => {
    await batch();
    await job();
    const conflict = await createProjectRecalculation({
      batchId: "batch-1",
      projectId: "project-1",
      toPriceVersionId: "price-2026.11.1",
      calcVersion: "calc-2026.11.0",
      deltaReason: "manual",
      createdBy: "admin:test",
      maxAttempts: 5,
      now: T,
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.issues[0]?.path).toBe("maxAttempts");
  });

  it("конфликтует при другом createdBy", async () => {
    await batch();
    await job();
    const conflict = await createProjectRecalculation({
      batchId: "batch-1",
      projectId: "project-1",
      toPriceVersionId: "price-2026.11.1",
      calcVersion: "calc-2026.11.0",
      deltaReason: "manual",
      createdBy: "admin:other",
      now: T,
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.issues[0]?.path).toBe("createdBy");
  });

  it("после конфликта исходный повтор снова возвращает первоначальную job", async () => {
    await batch();
    const first = await job();
    await createProjectRecalculation({
      batchId: "batch-1",
      projectId: "project-1",
      toPriceVersionId: "price-2026.11.1",
      calcVersion: "calc-other",
      deltaReason: "manual",
      createdBy: "admin:test",
      now: T,
    });
    const repeat = await createProjectRecalculation({
      batchId: "batch-1",
      projectId: "project-1",
      toPriceVersionId: "price-2026.11.1",
      calcVersion: "calc-2026.11.0",
      deltaReason: "manual",
      createdBy: "admin:test",
      now: T,
    });
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.created).toBe(false);
    expect(repeat.value.id).toBe(first.id);
    expect(await listProjectRecalculations({ batchId: "batch-1" })).toHaveLength(1);
  });

  it("fromPriceVersionId фиксируется на каждой попытке", async () => {
    await batch();
    const created = await job();
    const started = await startProjectRecalculation(created.id, {
      fromPriceVersionId: "price-1",
      oldPrice: 100,
      now: T,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.status).toBe("running");
    expect(started.value.attempt).toBe(1);
    expect(started.value.fromPriceVersionId).toBe("price-1");
    expect(started.value.attempts[0]?.fromPriceVersionId).toBe("price-1");

    const failed = await failProjectRecalculation(created.id, {
      error: { code: "TRANSIENT", message: "retry", retryable: true },
      now: T,
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value.status).toBe("failed");

    const retried = await retryProjectRecalculation(created.id);
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.value.status).toBe("pending");

    const second = await startProjectRecalculation(created.id, {
      fromPriceVersionId: "price-2",
      oldPrice: 200,
      now: "2026-11-10T00:01:00.000Z",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.attempt).toBe(2);
    expect(second.value.attempts.map((attempt) => attempt.fromPriceVersionId)).toEqual([
      "price-1",
      "price-2",
    ]);
  });

  it("завершает job и обновляет batch", async () => {
    await batch();
    const created = await job();
    await startProjectRecalculation(created.id, {
      fromPriceVersionId: "price-1",
      now: T,
    });
    const completed = await completeProjectRecalculation(created.id, {
      newPrice: 250,
      now: T,
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.value.status).toBe("completed");
    expect(completed.value.newPrice).toBe(250);
    const batchState = await getRecalculationBatch("batch-1");
    expect(batchState?.status).toBe("completed");
    expect(batchState?.completedCount).toBe(1);
  });

  it("запрещает недопустимые переходы", async () => {
    await batch();
    const created = await job();
    const completed = await completeProjectRecalculation(created.id, {
      newPrice: 250,
      now: T,
    });
    expect(completed.ok).toBe(false);
    if (completed.ok) return;
    expect(completed.issues[0]?.code).toBe("INVALID_TRANSITION");
  });
});
