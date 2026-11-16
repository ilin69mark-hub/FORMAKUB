import { BUILD_CALC_VERSION } from "@/lib/configurator/versions";
import { getProject, recalculateProject } from "@/lib/server/projects";

import { evaluateApplyGate, type ApplyGateResult } from "./apply";
import {
  JOBS_COLLECTION,
  cancelProjectRecalculation,
  completeProjectRecalculation,
  deadLetterProjectRecalculation,
  failProjectRecalculation,
  listProjectRecalculations,
  recoverStaleProjectRecalculation,
  retryProjectRecalculation,
  skipProjectRecalculation,
  startProjectRecalculation,
  touchProjectRecalculationHeartbeat,
} from "./jobs";
import { getPublishedVersion, getVersion } from "./pricing";
import { ensurePublishRecalculationBatch } from "./publish-recalc";
import {
  reconcileRecalculationState,
  type ReconcileReport,
} from "./reconcile";
import {
  projectRecalculationSchema,
  type ProjectRecalculation,
  type RecalculationError,
} from "./schema";
import { updateCollection } from "@/lib/server/store";

/**
 * CA-T-404 — single-instance, in-process worker полного жизненного цикла
 * заданий пересчёта (ADR-05).
 *
 * Worker:
 *  1. периодически выполняет идемпотентную сверку (`reconcile.ts`);
 *  2. восстанавливает зависшие running-задания (heartbeat/stale);
 *  3. атомарно захватывает pending-задания (`pending → running`);
 *  4. выполняет пересчёт существующим сервисом `recalculateProject`
 *     (DataResolver → Engine → Display Adapter → атомарная запись);
 *  5. проверяет apply gate §10.5 до записи;
 *  6. закрывает задание (completed/failed/skipped/cancelled/dead_letter),
 *     применяя retry policy по `maxAttempts`;
 *  7. обновляет heartbeat во время выполнения.
 *
 * Внешняя очередь, Redis и distributed locks не используются; в одном
 * процессе допускается один runtime-экземпляр worker (см.
 * `startRecalculationRuntimeWorker`). Межпроцессная защита — instance lock.
 */

export const DEFAULT_RECALC_HEARTBEAT_MS = 10_000;
export const DEFAULT_RECALC_STALE_MS = 30_000;
export const DEFAULT_RECALC_MAX_RECOVERIES = 3;
export const DEFAULT_RECALC_RECONCILE_MS = 60_000;

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name}: ожидалось положительное целое, получено "${raw}"`);
  }
  return value;
}

function envNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name}: ожидалось неотрицательное целое, получено "${raw}"`);
  }
  return value;
}

/** Явное выключение (`0`/`false`) либо включение (`1`/`true`); иначе — вне тестов. */
export function resolveRecalcWorkerEnabled(
  nodeEnv: string | undefined,
  raw: string | undefined,
): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  return nodeEnv !== "test";
}

export interface RecalculationWorkerOptions {
  heartbeatIntervalMs?: number;
  staleAfterMs?: number;
  maxRecoveries?: number;
  /** Период runtime-сверки; `0` — на каждом прогоне. */
  reconcileIntervalMs?: number;
  /** Восстанавливать batch для published-версии при старте runtime. */
  recoverPublishedBatches?: boolean;
}

export interface WorkerRunReport {
  recovered: number;
  deadLettered: number;
  heartbeated: number;
  claimed: number;
  completed: number;
  failed: number;
  retried: number;
  skipped: number;
  cancelled: number;
  reconciliation?: ReconcileReport;
}

type JobOutcome =
  | "completed"
  | "failed"
  | "retried"
  | "skipped"
  | "cancelled"
  | "dead_lettered"
  | "claim_lost";

function emptyReport(): WorkerRunReport {
  return {
    recovered: 0,
    deadLettered: 0,
    heartbeated: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    skipped: 0,
    cancelled: 0,
  };
}

function isStale(job: ProjectRecalculation, nowMs: number, staleAfterMs: number): boolean {
  if (!job.lastHeartbeatAt) return true;
  const stamp = Date.parse(job.lastHeartbeatAt);
  return !Number.isFinite(stamp) || nowMs - stamp > staleAfterMs;
}

const RETRYABLE_CODES = new Set([
  "CALCULATION_INPUTS_FAILED",
  "CALCULATION_FAILED",
  "DISPLAY_METADATA_UNAVAILABLE",
  "ENGINE_FAILED",
  "STORAGE_TEMPORARY",
]);

function isRetryableError(
  issues: Array<{ code?: string }> | undefined,
  status: number | undefined,
): boolean {
  if (issues?.some((issue) => issue.code && RETRYABLE_CODES.has(issue.code))) {
    return true;
  }
  return status !== undefined && status >= 500;
}

function errorFromIssues(
  issues: Array<{ code?: string; message?: string }> | undefined,
  fallbackCode: string,
  retryable: boolean,
): RecalculationError {
  const first = issues?.[0];
  return {
    code: first?.code ?? fallbackCode,
    message: first?.message ?? "пересчёт не выполнен",
    retryable,
  };
}

export class RecalculationWorker {
  readonly heartbeatIntervalMs: number;
  readonly staleAfterMs: number;
  readonly maxRecoveries: number;
  readonly reconcileIntervalMs: number;
  readonly recoverPublishedBatches: boolean;

  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  private stopping = false;
  private lastReconcileAt = 0;

  lastRun: WorkerRunReport | undefined;
  lastReconcile: ReconcileReport | undefined;
  lastError: unknown;

  constructor(options: RecalculationWorkerOptions = {}) {
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ??
      envPositiveInt("FORMAKUB_RECALC_HEARTBEAT_MS", DEFAULT_RECALC_HEARTBEAT_MS);
    this.staleAfterMs =
      options.staleAfterMs ??
      envPositiveInt("FORMAKUB_RECALC_STALE_MS", DEFAULT_RECALC_STALE_MS);
    this.maxRecoveries =
      options.maxRecoveries ??
      envPositiveInt("FORMAKUB_RECALC_MAX_RECOVERIES", DEFAULT_RECALC_MAX_RECOVERIES);
    this.recoverPublishedBatches = options.recoverPublishedBatches ?? false;
    this.reconcileIntervalMs =
      options.reconcileIntervalMs ??
      envNonNegativeInt(
        "FORMAKUB_RECALC_RECONCILE_MS",
        DEFAULT_RECALC_RECONCILE_MS,
      );
  }

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Запуск worker: начальная сверка + обработка, затем периодический tick.
   * Pending-задания исполняются полностью (claim → recalc → close).
   */
  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    await this.runOnce();
    if (this.stopping) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        this.lastError = error;
      });
    }, this.heartbeatIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(now = new Date().toISOString()): Promise<WorkerRunReport> {
    if (this.ticking) {
      return this.lastRun ?? emptyReport();
    }
    this.ticking = true;
    try {
      const report = emptyReport();

      // Block 2: восстановление batch, потерянного между publish и batch.
      if (this.recoverPublishedBatches) {
        try {
          const published = await getPublishedVersion();
          if (published) {
            await ensurePublishRecalculationBatch(published, "worker-recovery");
          }
        } catch {
          // Восстановление не должно останавливать обработку очереди.
        }
      }

      if (this.shouldReconcile(now)) {
        this.lastReconcile = await reconcileRecalculationState();
        this.lastReconcileAt = Date.parse(now);
        report.reconciliation = this.lastReconcile;
      }

      const recovery = await this.recoverStale(now);
      report.recovered = recovery.report.recovered;
      report.deadLettered = recovery.report.deadLettered;

      report.heartbeated = await this.heartbeatRunning(now);

      const pending = await listProjectRecalculations({ status: "pending" });
      for (const job of pending) {
        if (this.stopping) break;
        // Восстановленные в этом тике задания обрабатываются следующим
        // тиком: иначе stale-recovery сразу же превращался бы в немедленный
        // повторный запуск и не давал зафиксировать промежуточный pending.
        if (recovery.recoveredIds.has(job.id)) continue;
        const outcome = await this.executePendingJob(job, now);
        this.tally(report, outcome);
      }

      this.lastRun = report;
      return report;
    } finally {
      this.ticking = false;
    }
  }

  private shouldReconcile(now: string): boolean {
    if (this.lastReconcileAt === 0) return true;
    if (this.reconcileIntervalMs <= 0) return true;
    const stamp = Date.parse(now);
    if (!Number.isFinite(stamp)) return false;
    return stamp - this.lastReconcileAt >= this.reconcileIntervalMs;
  }

  private tally(report: WorkerRunReport, outcome: JobOutcome): void {
    switch (outcome) {
      case "completed":
        report.completed += 1;
        report.claimed += 1;
        break;
      case "failed":
        report.failed += 1;
        report.claimed += 1;
        break;
      case "retried":
        report.retried += 1;
        report.claimed += 1;
        break;
      case "skipped":
        report.skipped += 1;
        report.claimed += 1;
        break;
      case "cancelled":
        report.cancelled += 1;
        report.claimed += 1;
        break;
      case "dead_lettered":
        report.deadLettered += 1;
        report.claimed += 1;
        break;
      case "claim_lost":
        break;
    }
  }

  private async recoverStale(now: string): Promise<{
    report: WorkerRunReport;
    recoveredIds: Set<string>;
  }> {
    const nowMs = Date.parse(now);
    const running = await listProjectRecalculations({ status: "running" });
    let recovered = 0;
    let deadLettered = 0;
    const recoveredIds = new Set<string>();
    for (const job of running) {
      if (!isStale(job, nowMs, this.staleAfterMs)) continue;
      const deadLetter = job.attempt > this.maxRecoveries;
      const result = await recoverStaleProjectRecalculation(job.id, {
        deadLetter,
        now,
      });
      if (result.ok) {
        if (deadLetter) deadLettered += 1;
        else {
          recovered += 1;
          recoveredIds.add(job.id);
        }
      }
    }
    return {
      report: { ...emptyReport(), recovered, deadLettered },
      recoveredIds,
    };
  }

  private async heartbeatRunning(now: string): Promise<number> {
    const running = await listProjectRecalculations({ status: "running" });
    if (running.length === 0) return 0;

    let heartbeated = 0;
    await updateCollection<ProjectRecalculation, void>(JOBS_COLLECTION, (jobs) => {
      const next = jobs.map((job) => {
        if (job.status !== "running") return job;
        heartbeated += 1;
        return projectRecalculationSchema.parse({
          ...job,
          lastHeartbeatAt: now,
        });
      });
      return { items: next, result: undefined };
    });
    return heartbeated;
  }

  /**
   * Полный цикл одного pending-задания. Захват атомарен: только один
   * worker/цикл может перевести pending → running; проигравший получает
   * INVALID_TRANSITION и ничего не пишет.
   */
  private async executePendingJob(
    job: ProjectRecalculation,
    now: string,
  ): Promise<JobOutcome> {
    const projectRead = await getProject(job.projectId);
    const fromPriceVersionId =
      projectRead.status === "ok" ? projectRead.project.priceVersion ?? null : null;
    const oldPrice =
      projectRead.status === "ok" ? projectRead.project.price.total : null;

    const claimed = await startProjectRecalculation(job.id, {
      fromPriceVersionId,
      oldPrice,
      now,
    });
    if (!claimed.ok) return "claim_lost";

    const current = claimed.value;

    const heartbeat = setInterval(() => {
      void touchProjectRecalculationHeartbeat(
        current.id,
        new Date().toISOString(),
      ).catch(() => undefined);
    }, this.heartbeatIntervalMs);
    heartbeat.unref?.();

    try {
      if (projectRead.status !== "ok") {
        const code =
          projectRead.status === "not_found"
            ? "PROJECT_NOT_FOUND"
            : projectRead.status === "quarantined"
              ? "PROJECT_QUARANTINED"
              : "PROJECT_UNSUPPORTED";
        return await this.failJob(current, {
          code,
          message:
            projectRead.status === "not_found"
              ? `проект "${current.projectId}" не найден`
              : projectRead.reason,
          retryable: false,
        }, now);
      }

      // Задание должно исполняться той же сборкой, что зафиксирована у
      // проекта; иная версия — не молчаливая подмена, а skip (§5.7).
      if (current.calcVersion !== BUILD_CALC_VERSION) {
        return await this.skipJob(current, {
          code: "CALC_VERSION_MISMATCH",
          message: `calcVersion задания "${current.calcVersion}" ≠ текущей сборки "${BUILD_CALC_VERSION}"; требуется engine_migration`,
          retryable: false,
        }, now);
      }

      const gate = await this.evaluateGate(current, projectRead.project, now);
      if (!gate.ok) {
        return await this.failJob(current, gate.error, now);
      }
      if (gate.result.action !== "apply") {
        return await this.applyGateAction(current, gate.result, projectRead.project, now);
      }

      const result = await recalculateProject({
        projectId: current.projectId,
        operationId: operationIdForJob(current.id),
        targetPriceVersionId: current.toPriceVersionId,
        expectedProjectCalcVersion: BUILD_CALC_VERSION,
        requiredExecutedCalcVersion: BUILD_CALC_VERSION,
        expectedSourcePriceVersion: current.fromPriceVersionId,
      });

      if (result.ok) {
        const completed = await completeProjectRecalculation(current.id, {
          newPrice: result.project.price.total,
          now,
        });
        if (!completed.ok) {
          // Задание могло быть отменено администратором во время выполнения;
          // проект уже записан атомарно, история не дублируется.
          return "failed";
        }
        return "completed";
      }

      const retryable = isRetryableError(result.issues, result.status);
      const firstCode = result.issues[0]?.code;
      if (firstCode === "STALE_SOURCE_PRICE_VERSION") {
        return await this.cancelJob(
          current,
          errorFromIssues(result.issues, "STALE_SOURCE_PRICE_VERSION", false),
          now,
        );
      }
      if (
        firstCode === "CALC_VERSION_UNKNOWN" ||
        firstCode === "CALC_VERSION_MISMATCH" ||
        firstCode === "PROJECT_CALC_VERSION_MISMATCH"
      ) {
        return await this.skipJob(
          current,
          errorFromIssues(result.issues, firstCode, false),
          now,
        );
      }
      return await this.failJob(
        current,
        errorFromIssues(result.issues, "RECALC_FAILED", retryable),
        now,
      );
    } catch (error) {
      return await this.failJob(
        current,
        {
          code: "WORKER_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
        now,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async evaluateGate(
    job: ProjectRecalculation,
    project: {
      priceVersion?: string;
      calcVersion?: string;
      priceHistory?: Array<{ operationId: string; newPrice: number }>;
    },
    now: string,
  ): Promise<
    | { ok: true; result: ApplyGateResult }
    | { ok: false; error: RecalculationError }
  > {
    void now;
    const target = await getVersion(job.toPriceVersionId);
    if (!target || target.publishedSeq === undefined) {
      return {
        ok: false,
        error: {
          code: "TARGET_VERSION_UNAVAILABLE",
          message: `целевая версия "${job.toPriceVersionId}" не найдена или не имеет publishedSeq`,
          retryable: false,
        },
      };
    }
    const latest = await getPublishedVersion();
    if (!latest || latest.publishedSeq === undefined) {
      return {
        ok: false,
        error: {
          code: "PUBLISHED_VERSION_UNAVAILABLE",
          message: "опубликованная версия не найдена или не имеет publishedSeq",
          retryable: false,
        },
      };
    }

    let projectPublishedSeq = 0;
    if (project.priceVersion) {
      const projectVersion = await getVersion(project.priceVersion);
      if (!projectVersion || projectVersion.publishedSeq === undefined) {
        return {
          ok: false,
          error: {
            code: "PROJECT_VERSION_UNAVAILABLE",
            message: `версия проекта "${project.priceVersion}" не найдена или не имеет publishedSeq`,
            retryable: false,
          },
        };
      }
      projectPublishedSeq = projectVersion.publishedSeq;
    }

    const existingEvent = (project.priceHistory ?? []).find(
      (event) => event.operationId === operationIdForJob(job.id),
    );

    return {
      ok: true,
      result: evaluateApplyGate({
        jobStatus: job.status,
        projectPriceVersion: project.priceVersion ?? null,
        expectedSourcePriceVersion: job.fromPriceVersionId,
        toPriceVersionId: job.toPriceVersionId,
        projectPublishedSeq,
        targetPublishedSeq: target.publishedSeq,
        latestPublishedSeq: latest.publishedSeq,
        attemptAlreadyApplied: Boolean(existingEvent),
        projectCalcVersion: project.calcVersion ?? null,
        eventCalcVersion: BUILD_CALC_VERSION,
      }),
    };
  }

  private async applyGateAction(
    job: ProjectRecalculation,
    gate: ApplyGateResult,
    project: { priceHistory?: Array<{ operationId: string; newPrice: number }> },
    now: string,
  ): Promise<JobOutcome> {
    if (gate.action === "close") {
      const event = (project.priceHistory ?? []).find(
        (item) => item.operationId === operationIdForJob(job.id),
      );
      const completed = await completeProjectRecalculation(job.id, {
        newPrice: event?.newPrice ?? 0,
        now,
      });
      return completed.ok ? "completed" : "claim_lost";
    }
    if (gate.action === "skip") {
      return await this.skipJob(
        job,
        {
          code: gate.code ?? "APPLY_SKIPPED",
          message: gate.message,
          retryable: false,
        },
        now,
      );
    }
    if (gate.action === "cancel") {
      return await this.cancelJob(
        job,
        {
          code: gate.code ?? "APPLY_CANCELLED",
          message: gate.message,
          retryable: false,
        },
        now,
      );
    }
    // noop: задание уже не running (например, отменено) — ничего не пишем.
    return "claim_lost";
  }

  private async failJob(
    job: ProjectRecalculation,
    error: RecalculationError,
    now: string,
  ): Promise<JobOutcome> {
    const failed = await failProjectRecalculation(job.id, { error, now });
    if (!failed.ok) return "claim_lost";

    if (error.retryable && job.attempt < job.maxAttempts) {
      const retried = await retryProjectRecalculation(job.id);
      return retried.ok ? "retried" : "failed";
    }

    if (error.retryable) {
      const dead = await deadLetterProjectRecalculation(job.id);
      return dead.ok ? "dead_lettered" : "failed";
    }

    return "failed";
  }

  private async skipJob(
    job: ProjectRecalculation,
    error: RecalculationError,
    now: string,
  ): Promise<JobOutcome> {
    const result = await skipProjectRecalculation(job.id, { error, now });
    return result.ok ? "skipped" : "claim_lost";
  }

  private async cancelJob(
    job: ProjectRecalculation,
    error: RecalculationError,
    now: string,
  ): Promise<JobOutcome> {
    const result = await cancelProjectRecalculation(job.id, now);
    if (!result.ok) return "claim_lost";
    void error;
    return "cancelled";
  }
}

export function operationIdForJob(jobId: string): string {
  return `recalc-job:${jobId}`;
}

/* ─── Runtime singleton (один worker на процесс) ─────────────────────── */

let runtimeWorker: RecalculationWorker | undefined;

/**
 * Запуск единственного в процессе runtime-worker. Повторный вызов при
 * запущенном worker возвращает существующий экземпляр; второй worker в
 * одном процессе не создаётся.
 */
export async function startRecalculationRuntimeWorker(
  options?: RecalculationWorkerOptions,
): Promise<RecalculationWorker> {
  if (runtimeWorker?.isRunning) return runtimeWorker;
  const worker = new RecalculationWorker({
    ...options,
    recoverPublishedBatches: true,
  });
  await worker.start();
  runtimeWorker = worker;
  return worker;
}

export function stopRecalculationRuntimeWorker(): void {
  runtimeWorker?.stop();
}

export function isRecalculationRuntimeWorkerRunning(): boolean {
  return runtimeWorker?.isRunning ?? false;
}
