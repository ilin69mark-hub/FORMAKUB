/**
 * CA-T-505 — типы и представление пересчёта/истории.
 *
 * Модели повторяют дизайн §6.9/§6.10/§6.13 (ProjectRecalculation,
 * RecalculationBatch, ProjectPriceHistory). Backend пересчёта (Фаза 4)
 * заблокирован, поэтому раздел работает на изолированных mock-данных;
 * helper выполняет только отображение и проверку допустимости retry,
 * реальных операций здесь нет.
 */

export type RecalculationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped"
  | "dead_letter";

export type BatchStatus =
  | "running"
  | "completed"
  | "completed_with_errors"
  | "cancelled";

export type DeltaReason = "price_publish" | "manual";

export type HistoryReason =
  | "create"
  | "price_publish"
  | "manual_recalc"
  | "retro_certification"
  | "engine_migration";

export interface RecalculationError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface RecalculationBatch {
  id: string;
  priceVersionId: string;
  trigger: "publish" | "manual";
  status: BatchStatus;
  totalCount: number;
  pendingCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: string;
  finishedAt: string | null;
  createdBy: string;
}

export interface ProjectRecalculation {
  id: string;
  batchId: string;
  projectId: string;
  fromPriceVersionId: string | null;
  toPriceVersionId: string;
  calcVersion: string;
  status: RecalculationStatus;
  attempt: number;
  maxAttempts: number;
  oldPrice: number | null;
  newPrice: number | null;
  deltaReason: DeltaReason;
  error: RecalculationError | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: string;
}

export interface ProjectPriceHistory {
  id: string;
  projectId: string;
  operationId: string | null;
  jobId: string | null;
  attemptId: string | null;
  reason: HistoryReason;
  fromPriceVersionId: string | null;
  toPriceVersionId: string;
  calcVersion: string;
  prevCalcVersion: string | null;
  schemaVersion: number;
  oldPrice: number | null;
  newPrice: number;
  delta: number | null;
  breakdown: Record<string, unknown>;
  breakdownVersion: number;
  computedAt: string;
}

export interface ProjectMeta {
  id: string;
  title: string;
  type: "kitchen" | "wardrobe";
}

export interface RecalculationBoard {
  publishedVersionId: string | null;
  batch: RecalculationBatch | null;
  jobs: ProjectRecalculation[];
  history: ProjectPriceHistory[];
  projects: ProjectMeta[];
}

export const RECALC_STATUS_LABELS: Record<RecalculationStatus, string> = {
  pending: "pending",
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  skipped: "skipped",
  dead_letter: "dead_letter",
};

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  running: "running",
  completed: "completed",
  completed_with_errors: "completed_with_errors",
  cancelled: "cancelled",
};

export const HISTORY_REASON_LABELS: Record<HistoryReason, string> = {
  create: "создание проекта",
  price_publish: "публикация прайса",
  manual_recalc: "ручной пересчёт",
  retro_certification: "ретро-сертификация",
  engine_migration: "миграция движка",
};

export const TERMINAL_STATUSES: readonly RecalculationStatus[] = [
  "completed",
  "cancelled",
  "skipped",
  "dead_letter",
];

/** Прогресс батча: обработанные = completed + failed + skipped. */
export function batchProgress(batch: RecalculationBatch): {
  processed: number;
  total: number;
  percent: number;
} {
  const processed =
    batch.completedCount + batch.failedCount + batch.skippedCount;
  const total = batch.totalCount;
  return {
    processed,
    total,
    percent: total === 0 ? 0 : Math.round((processed / total) * 100),
  };
}

/** Проверка счётчиков батча против фактических заданий (для тестов/QA). */
export function countersMatchJobs(
  batch: RecalculationBatch,
  jobs: ProjectRecalculation[],
): boolean {
  const count = (status: RecalculationStatus) =>
    jobs.filter((job) => job.status === status).length;
  return (
    batch.totalCount === jobs.length &&
    batch.pendingCount === count("pending") &&
    batch.runningCount === count("running") &&
    batch.completedCount === count("completed") &&
    batch.failedCount === count("failed") &&
    batch.skippedCount === count("skipped")
  );
}

export type RetryAvailability =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * UI-подсказка допустимости retry по дизайну §6.9/§10.3. Реального retry
 * нет: сервис Фазы 4 заблокирован, backend обязан проверить то же правило
 * повторно.
 */
export function retryAvailability(
  job: ProjectRecalculation,
): RetryAvailability {
  if (job.status === "completed") {
    return { allowed: false, reason: "Задание уже успешно завершено." };
  }
  if (job.status === "cancelled") {
    return { allowed: false, reason: "Задание отменено; повтор не предусмотрен." };
  }
  if (job.status === "pending" || job.status === "running") {
    return { allowed: false, reason: "Задание уже в очереди или выполняется." };
  }
  if (job.attempt >= job.maxAttempts) {
    return {
      allowed: false,
      reason: `Исчерпан лимит попыток (${job.attempt}/${job.maxAttempts}).`,
    };
  }
  if (job.status === "failed" && job.error?.retryable === false) {
    return {
      allowed: false,
      reason: "Ошибка помечена как неretryable; требуется вмешательство оператора.",
    };
  }
  return { allowed: true };
}

export function formatRub(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString("ru-RU")} ₽`;
}

export function formatDelta(
  oldPrice: number | null | undefined,
  newPrice: number | null | undefined,
): string {
  if (oldPrice === null || oldPrice === undefined) return "—";
  if (newPrice === null || newPrice === undefined) return "—";
  const delta = newPrice - oldPrice;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${Math.abs(delta).toLocaleString("ru-RU")} ₽`;
}

export interface HistoryFilter {
  projectId?: string;
  reason?: HistoryReason;
}

export function parseHistoryFilter(input: {
  projectId?: string;
  reason?: string;
}): HistoryFilter {
  const projectId = input.projectId?.trim();
  const reasons = Object.keys(HISTORY_REASON_LABELS) as HistoryReason[];
  return {
    ...(projectId ? { projectId } : {}),
    ...(input.reason !== undefined && reasons.includes(input.reason as HistoryReason)
      ? { reason: input.reason as HistoryReason }
      : {}),
  };
}

export function filterHistory(
  entries: ProjectPriceHistory[],
  filter: HistoryFilter,
): ProjectPriceHistory[] {
  const needle = filter.projectId?.toLowerCase();
  return entries.filter((entry) => {
    if (filter.reason !== undefined && entry.reason !== filter.reason) {
      return false;
    }
    if (needle && !entry.projectId.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** История — append-only; сортировка только для отображения (новые сверху). */
export function sortHistory(
  entries: ProjectPriceHistory[],
): ProjectPriceHistory[] {
  return [...entries].sort((a, b) =>
    a.computedAt < b.computedAt ? 1 : a.computedAt > b.computedAt ? -1 : a.id < b.id ? 1 : -1,
  );
}
