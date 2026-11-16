import type {
  ProjectMeta,
  ProjectPriceHistory,
  ProjectRecalculation,
  RecalculationBatch,
  RecalculationBoard,
} from "@/lib/admin/projects-ui";

/**
 * CA-T-505 — изолированные mock-данные пересчёта и истории.
 *
 * Сервисы Фазы 4 (ProjectRecalculation/Batch/History) заблокированы
 * (ADR-05/CA-Q), защищённый admin-API отсутствует (CA-T-609/602). Поэтому
 * раздел работает как UI-прототип: реальные проекты не пересчитываются,
 * история не пишется, retry не выполняется. Структуры повторяют дизайн
 * §6.9/§6.10/§6.13; значения — демонстрационные.
 */

const T = "2026-11-09T09:00:00.000Z";

export const MOCK_BATCH: RecalculationBatch = {
  id: "batch-2026.11.7",
  priceVersionId: "price-2026.11",
  trigger: "publish",
  status: "running",
  totalCount: 8,
  pendingCount: 2,
  runningCount: 1,
  completedCount: 3,
  failedCount: 1,
  skippedCount: 1,
  startedAt: T,
  finishedAt: null,
  createdBy: "system:publish",
};

export const MOCK_PROJECTS: ProjectMeta[] = [
  { id: "project-001", title: "Кухня «Графит»", type: "kitchen" },
  { id: "project-002", title: "Кухня «Дуб»", type: "kitchen" },
  { id: "project-003", title: "Кухня «Изгиб»", type: "kitchen" },
  { id: "project-004", title: "Шкаф «Орех»", type: "wardrobe" },
  { id: "project-005", title: "Шкаф «Лён»", type: "wardrobe" },
  { id: "project-006", title: "Кухня «Камень»", type: "kitchen" },
  { id: "project-007", title: "Шкаф «Графит»", type: "wardrobe" },
  { id: "project-008", title: "Кухня «Тёплый дуб»", type: "kitchen" },
];

function job(
  projectId: string,
  status: ProjectRecalculation["status"],
  overrides: Partial<ProjectRecalculation> = {},
): ProjectRecalculation {
  return {
    id: `job-${projectId}`,
    batchId: MOCK_BATCH.id,
    projectId,
    fromPriceVersionId: "price-2026.10",
    toPriceVersionId: MOCK_BATCH.priceVersionId,
    calcVersion: "calc-2026.11.0",
    status,
    attempt: 0,
    maxAttempts: 3,
    oldPrice: null,
    newPrice: null,
    deltaReason: "price_publish",
    error: null,
    lastHeartbeatAt: null,
    createdAt: T,
    startedAt: null,
    finishedAt: null,
    createdBy: "system:publish",
    ...overrides,
  };
}

export const MOCK_JOBS: ProjectRecalculation[] = [
  job("project-001", "completed", {
    oldPrice: 182400,
    newPrice: 189700,
    startedAt: "2026-11-09T09:00:05.000Z",
    finishedAt: "2026-11-09T09:00:07.000Z",
  }),
  job("project-002", "completed", {
    oldPrice: 96000,
    newPrice: 101200,
    startedAt: "2026-11-09T09:00:05.000Z",
    finishedAt: "2026-11-09T09:00:06.000Z",
  }),
  job("project-003", "completed", {
    oldPrice: 210500,
    newPrice: 210500,
    startedAt: "2026-11-09T09:00:06.000Z",
    finishedAt: "2026-11-09T09:00:08.000Z",
  }),
  job("project-004", "running", {
    oldPrice: 154000,
    startedAt: "2026-11-09T09:00:09.000Z",
    lastHeartbeatAt: "2026-11-09T09:00:14.000Z",
  }),
  job("project-005", "pending", { oldPrice: 88000 }),
  job("project-006", "pending", { oldPrice: 132000 }),
  job("project-007", "failed", {
    oldPrice: 143000,
    attempt: 1,
    startedAt: "2026-11-09T09:00:10.000Z",
    finishedAt: "2026-11-09T09:00:12.000Z",
    error: {
      code: "CALC_TIMEOUT",
      message: "Таймаут расчёта (mock); повтор разрешён.",
      retryable: true,
    },
  }),
  job("project-008", "skipped", {
    oldPrice: 78000,
    finishedAt: "2026-11-09T09:00:11.000Z",
    error: {
      code: "CONFIG_INCOMPATIBLE",
      message:
        "Конфигурация несовместима с целевой версией (mock); требуется решение оператора.",
      retryable: false,
    },
  }),
];

function history(
  id: string,
  projectId: string,
  reason: ProjectPriceHistory["reason"],
  computedAt: string,
  oldPrice: number | null,
  newPrice: number,
  overrides: Partial<ProjectPriceHistory> = {},
): ProjectPriceHistory {
  return {
    id,
    projectId,
    operationId: reason === "create" ? null : "batch-2026.11.7",
    jobId: reason === "create" ? null : `job-${projectId}`,
    attemptId: reason === "create" ? null : `job-${projectId}#1`,
    reason,
    fromPriceVersionId: reason === "create" ? null : "price-2026.10",
    toPriceVersionId: "price-2026.11",
    calcVersion: "calc-2026.11.0",
    prevCalcVersion: reason === "engine_migration" ? "calc-2026.09.0" : null,
    schemaVersion: 1,
    oldPrice,
    newPrice,
    delta: oldPrice === null ? null : newPrice - oldPrice,
    breakdown: { total: newPrice, currency: "RUB" },
    breakdownVersion: 1,
    computedAt,
    ...overrides,
  };
}

export const MOCK_HISTORY: ProjectPriceHistory[] = [
  history("hist-008", "project-003", "price_publish", "2026-11-09T09:00:08.000Z", 210500, 210500),
  history("hist-007", "project-002", "price_publish", "2026-11-09T09:00:06.000Z", 96000, 101200),
  history("hist-006", "project-001", "price_publish", "2026-11-09T09:00:07.000Z", 182400, 189700),
  history("hist-005", "project-007", "manual_recalc", "2026-11-08T13:20:00.000Z", 143000, 143000),
  history("hist-004", "project-004", "manual_recalc", "2026-11-07T11:10:00.000Z", 150000, 154000),
  history("hist-003", "project-003", "price_publish", "2026-11-02T10:15:00.000Z", 198000, 210500, {
    fromPriceVersionId: "price-2026.09",
    toPriceVersionId: "price-2026.10",
  }),
  history("hist-002", "project-001", "create", "2026-10-18T09:00:00.000Z", null, 176000, {
    toPriceVersionId: "price-2026.10",
    breakdownVersion: 1,
  }),
  history("hist-001", "project-002", "create", "2026-10-12T09:00:00.000Z", null, 94000, {
    toPriceVersionId: "price-2026.10",
  }),
];

export const MOCK_BOARD: RecalculationBoard = {
  publishedVersionId: MOCK_BATCH.priceVersionId,
  batch: MOCK_BATCH,
  jobs: MOCK_JOBS,
  history: MOCK_HISTORY,
  projects: MOCK_PROJECTS,
};
