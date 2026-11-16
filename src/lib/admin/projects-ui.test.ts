import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyBootstrap } from "./bootstrap";
import { seedDisplayMetadata } from "./display-metadata";
import {
  batchProgress,
  countersMatchJobs,
  filterHistory,
  formatDelta,
  formatRub,
  parseHistoryFilter,
  retryAvailability,
  sortHistory,
  type ProjectRecalculation,
  type ProjectPriceHistory,
  type RecalculationBatch,
} from "./projects-ui";
import { defaultKitchen } from "@/lib/configurator/defaults";
import { saveProject } from "@/lib/server/projects";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";
import { getRecalculationBoard } from "@/app/admin/projects/_data/source";

const BATCH: RecalculationBatch = {
  id: "batch-1",
  priceVersionId: "price-1",
  trigger: "manual",
  status: "running",
  totalCount: 3,
  pendingCount: 0,
  runningCount: 0,
  completedCount: 2,
  failedCount: 1,
  skippedCount: 0,
  startedAt: "2026-11-10T00:00:00.000Z",
  finishedAt: null,
  createdBy: "test",
};

const job = (
  status: ProjectRecalculation["status"],
  overrides: Partial<ProjectRecalculation> = {},
): ProjectRecalculation => ({
  id: `job-${status}`,
  batchId: BATCH.id,
  projectId: "project-1",
  fromPriceVersionId: null,
  toPriceVersionId: BATCH.priceVersionId,
  calcVersion: "calc-2026.11.0",
  status,
  attempt: 1,
  maxAttempts: 3,
  oldPrice: 100,
  newPrice: 200,
  deltaReason: "manual",
  error: null,
  lastHeartbeatAt: null,
  createdAt: BATCH.startedAt,
  startedAt: BATCH.startedAt,
  finishedAt: null,
  createdBy: "test",
  ...overrides,
});

const HISTORY: ProjectPriceHistory[] = [
  {
    id: "hist-001",
    projectId: "project-1",
    operationId: "op-1",
    jobId: null,
    attemptId: null,
    reason: "create",
    fromPriceVersionId: null,
    toPriceVersionId: "price-1",
    calcVersion: "calc-2026.11.0",
    prevCalcVersion: null,
    schemaVersion: 1,
    oldPrice: null,
    newPrice: 100,
    delta: null,
    breakdown: {},
    breakdownVersion: 1,
    computedAt: "2026-11-10T00:00:00.000Z",
  },
  {
    id: "hist-002",
    projectId: "project-1",
    operationId: "op-2",
    jobId: "job-1",
    attemptId: "job-1#1",
    reason: "manual_recalc",
    fromPriceVersionId: "price-1",
    toPriceVersionId: "price-2",
    calcVersion: "calc-2026.11.0",
    prevCalcVersion: null,
    schemaVersion: 1,
    oldPrice: 100,
    newPrice: 200,
    delta: 100,
    breakdown: {},
    breakdownVersion: 1,
    computedAt: "2026-11-11T00:00:00.000Z",
  },
];

describe("счётчики и прогресс (CA-T-505)", () => {
  it("счётчики батча совпадают с заданиями", () => {
    const jobs = [
      job("completed"),
      job("completed", { id: "job-2" }),
      job("failed", { id: "job-3", error: { code: "X", message: "m", retryable: true } }),
    ];
    expect(countersMatchJobs(BATCH, jobs)).toBe(true);
  });

  it("прогресс: обработанные = completed + failed + skipped", () => {
    const progress = batchProgress(BATCH);
    expect(progress.processed).toBe(3);
    expect(progress.total).toBe(3);
    expect(progress.percent).toBe(100);
    expect(batchProgress({ ...BATCH, totalCount: 0 }).percent).toBe(0);
  });
});

describe("допустимость retry по дизайну §6.9/§10.3 (CA-T-505)", () => {
  it("failed retryable при attempt < maxAttempts → допустим", () => {
    expect(
      retryAvailability(
        job("failed", {
          attempt: 1,
          maxAttempts: 3,
          error: { code: "X", message: "m", retryable: true },
        }),
      ),
    ).toEqual({ allowed: true });
  });

  it("skipped → допустим, пока не исчерпаны попытки", () => {
    expect(retryAvailability(job("skipped", { attempt: 0, maxAttempts: 3 }))).toEqual({
      allowed: true,
    });
    expect(retryAvailability(job("skipped", { attempt: 3, maxAttempts: 3 })).allowed).toBe(false);
  });

  it("completed/running/pending/cancelled → запрещены с причиной", () => {
    for (const status of ["completed", "running", "pending", "cancelled"] as const) {
      const availability = retryAvailability(job(status));
      expect(availability.allowed).toBe(false);
      if (!availability.allowed) expect(availability.reason.length).toBeGreaterThan(0);
    }
  });

  it("неretryable failed и исчерпанный лимит → запрещены", () => {
    expect(
      retryAvailability(
        job("failed", {
          attempt: 0,
          maxAttempts: 3,
          error: { code: "X", message: "m", retryable: false },
        }),
      ).allowed,
    ).toBe(false);
    expect(
      retryAvailability(
        job("failed", {
          attempt: 3,
          maxAttempts: 3,
          error: { code: "X", message: "m", retryable: true },
        }),
      ).allowed,
    ).toBe(false);
    expect(retryAvailability(job("dead_letter", { attempt: 3, maxAttempts: 3 })).allowed).toBe(false);
  });
});

describe("представление истории и сумм (CA-T-505)", () => {
  it("форматирование денег и дельты", () => {
    expect(formatRub(189700)).toContain("189");
    expect(formatRub(null)).toBe("—");
    expect(formatDelta(182400, 189700)).toMatch(/^\+7\s300 ₽$/);
    expect(formatDelta(100, 90)).toBe("−10 ₽");
    expect(formatDelta(null, 90)).toBe("—");
  });

  it("фильтры истории: проект/причина, неизвестная причина игнорируется", () => {
    expect(parseHistoryFilter({ reason: "unknown" }).reason).toBeUndefined();
    expect(parseHistoryFilter({ projectId: "  project-001 " }).projectId).toBe(
      "project-001",
    );

    expect(filterHistory(HISTORY, { projectId: "project-1" })).toHaveLength(2);
    expect(filterHistory(HISTORY, { reason: "create" })).toHaveLength(1);
    expect(filterHistory(HISTORY, { projectId: "zzz" })).toEqual([]);
  });

  it("сортировка истории по computedAt (новые сверху) без мутации входа", () => {
    const sorted = sortHistory(HISTORY);
    expect(sorted[0]?.id).toBe("hist-002");
    expect(sorted.at(-1)?.id).toBe("hist-001");
    expect(HISTORY[0]?.id).toBe("hist-001");
  });

  it("UI-модуль не содержит операций пересчёта/записи", async () => {
    const loaded = await import("./projects-ui");
    const mutating = Object.keys(loaded).filter((name) =>
      /^(append|create|update|delete|write|remove|run|retryJob|publish)/i.test(name),
    );
    expect(mutating).toEqual([]);
  });
});

describe("реальный источник проектов/пересчёта (CA-T-505)", () => {
  it("читает published, проекты и историю через Storage Adapter", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "formakub-projects-ui-"));
    const previousDir = process.env.FORMAKUB_DATA_DIR;
    const previousStorage = process.env.FORMAKUB_STORAGE;
    process.env.FORMAKUB_DATA_DIR = dir;
    process.env.FORMAKUB_STORAGE = "sqlite";
    try {
      await applyBootstrap({
        pricingVersionId: "price-projects-ui.1",
        pricingLabel: "Projects UI test",
        now: "2026-11-10T00:00:00.000Z",
      });
      await seedDisplayMetadata({ actorId: "test", actorRole: "system" });
      await seedRulesSnapshotFixture();
      const saved = await saveProject({ config: defaultKitchen() });
      if (!saved.ok) throw new Error("проект не сохранён");

      const board = await getRecalculationBoard();
      expect(board.publishedVersionId).toBe("price-projects-ui.1");
      expect(board.batch).toBeNull();
      expect(board.jobs).toEqual([]);
      expect(board.projects.map((project) => project.id)).toContain(saved.project.id);
      expect(board.history.length).toBeGreaterThan(0);
      expect(board.history[0]?.projectId).toBe(saved.project.id);
    } finally {
      if (previousDir === undefined) delete process.env.FORMAKUB_DATA_DIR;
      else process.env.FORMAKUB_DATA_DIR = previousDir;
      if (previousStorage === undefined) delete process.env.FORMAKUB_STORAGE;
      else process.env.FORMAKUB_STORAGE = previousStorage;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
