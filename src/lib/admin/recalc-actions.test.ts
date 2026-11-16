import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { listAuditEvents } from "@/lib/server/audit";
import {
  BATCHES_COLLECTION,
  JOBS_COLLECTION,
  createProjectRecalculation,
  createRecalculationBatch,
  failProjectRecalculation,
  getProjectRecalculation,
  startProjectRecalculation,
} from "./jobs";
import { cancelRecalculation, retryRecalculation } from "./recalc-actions";

let dir = "";
const T = "2026-11-10T00:00:00.000Z";
const actor = { actorId: "admin:test", actorRole: "calc-admin" };

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-actions-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  for (const file of [BATCHES_COLLECTION, JOBS_COLLECTION, "admin-audit-log.json"]) {
    rmSync(path.join(dir, file), { force: true });
  }
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

async function job() {
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
  return created.value;
}

describe("CA-T-409: retry/cancel + audit", () => {
  it("retry из failed и запись recalc.retry", async () => {
    const created = await job();
    await startProjectRecalculation(created.id, {
      fromPriceVersionId: "price-1",
      now: T,
    });
    await failProjectRecalculation(created.id, {
      error: { code: "TRANSIENT", message: "retry", retryable: true },
      now: T,
    });

    const result = await retryRecalculation({
      jobId: created.id,
      actor,
      now: T,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("pending");
    const events = await listAuditEvents({ action: "recalc.retry" });
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe(created.id);
  });

  it("cancel running и запись recalc.cancel", async () => {
    const created = await job();
    await startProjectRecalculation(created.id, {
      fromPriceVersionId: "price-1",
      now: T,
    });
    const result = await cancelRecalculation({
      jobId: created.id,
      actor,
      now: T,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("cancelled");
    const events = await listAuditEvents({ action: "recalc.cancel" });
    expect(events).toHaveLength(1);
  });

  it("не выполняет retry из недопустимого статуса", async () => {
    const created = await job();
    const result = await retryRecalculation({
      jobId: created.id,
      actor,
      now: T,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("INVALID_TRANSITION");
    expect(await listAuditEvents({ action: "recalc.retry" })).toHaveLength(0);
    expect((await getProjectRecalculation(created.id))?.status).toBe("pending");
  });
});
