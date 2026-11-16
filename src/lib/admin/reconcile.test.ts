import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  BATCHES_COLLECTION,
  JOBS_COLLECTION,
  completeProjectRecalculation,
  createProjectRecalculation,
  createRecalculationBatch,
  startProjectRecalculation,
} from "./jobs";
import { reconcileRecalculationState } from "./reconcile";

let dir = "";
const T = "2026-11-10T00:00:00.000Z";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-reconcile-"));
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

function writeProjects(ids: string[]) {
  writeFileSync(
    path.join(dir, "projects.json"),
    JSON.stringify(
      ids.map((id) => ({
        id,
        config: { kind: "wardrobe", sections: [] },
        price: { total: 100, currency: "RUB" },
        schemaVersion: 1,
        calcVersion: "calc-2026.11.0",
        priceVersion: "price-1",
        createdAt: T,
        updatedAt: T,
      })),
    ),
    "utf8",
  );
}

async function batch() {
  const result = await createRecalculationBatch({
    id: "batch-1",
    priceVersionId: "price-2",
    trigger: "manual",
    createdBy: "admin:test",
    now: T,
  });
  if (!result.ok) throw new Error("batch");
  return result.value;
}

async function job(projectId: string) {
  const result = await createProjectRecalculation({
    batchId: "batch-1",
    projectId,
    toPriceVersionId: "price-2",
    calcVersion: "calc-2026.11.0",
    deltaReason: "manual",
    createdBy: "admin:test",
    now: T,
  });
  if (!result.ok) throw new Error("job");
  return result.value;
}

describe("CA-T-408: reconciliation", () => {
  it("дозаполняет задания и повторно ничего не меняет", async () => {
    await batch();
    writeProjects(["project-1", "project-2"]);
    await job("project-1");

    const first = await reconcileRecalculationState();
    expect(first.createdJobs).toBe(1);
    const jobsAfterFirst = readFileSync(path.join(dir, JOBS_COLLECTION), "utf8");

    const second = await reconcileRecalculationState();
    expect(second.createdJobs).toBe(0);
    expect(readFileSync(path.join(dir, JOBS_COLLECTION), "utf8")).toBe(
      jobsAfterFirst,
    );
  });

  it("сообщает completed job с несовпадающим project priceVersion", async () => {
    await batch();
    writeProjects(["project-1"]);
    const created = await job("project-1");
    await startProjectRecalculation(created.id, {
      fromPriceVersionId: "price-1",
      now: T,
    });
    await completeProjectRecalculation(created.id, { newPrice: 200, now: T });

    const report = await reconcileRecalculationState();
    expect(
      report.issues.some((issue) => issue.code === "COMPLETED_WRONG_PRICE_VERSION"),
    ).toBe(true);
  });

  it("сообщает job без batch", async () => {
    writeProjects([]);
    writeFileSync(path.join(dir, JOBS_COLLECTION), JSON.stringify([]), "utf8");
    writeFileSync(
      path.join(dir, BATCHES_COLLECTION),
      JSON.stringify([
        {
          id: "batch-1",
          priceVersionId: "price-2",
          trigger: "manual",
          status: "running",
          totalCount: 0,
          pendingCount: 0,
          runningCount: 0,
          completedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          startedAt: T,
          finishedAt: null,
          createdBy: "admin:test",
        },
      ]),
      "utf8",
    );
    writeFileSync(
      path.join(dir, JOBS_COLLECTION),
      JSON.stringify([
        {
          id: "job-orphan",
          batchId: "missing-batch",
          projectId: "project-1",
          fromPriceVersionId: null,
          toPriceVersionId: "price-2",
          calcVersion: "calc-2026.11.0",
          status: "pending",
          attempt: 0,
          maxAttempts: 3,
          oldPrice: null,
          newPrice: null,
          deltaReason: "manual",
          error: null,
          lastHeartbeatAt: null,
          createdAt: T,
          startedAt: null,
          finishedAt: null,
          createdBy: "admin:test",
          attempts: [],
        },
      ]),
      "utf8",
    );

    const report = await reconcileRecalculationState();
    expect(report.issues.some((issue) => issue.code === "ORPHAN_BATCH")).toBe(true);
  });
});
