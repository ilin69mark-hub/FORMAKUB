import { randomUUID } from "node:crypto";

import { readCollection, updateCollection } from "@/lib/server/store";

import {
  projectRecalculationSchema,
  recalculationBatchSchema,
  type ProjectRecalculation,
  type RecalculationBatch,
  type RecalculationError,
  type RecalculationStatus,
} from "./schema";

/**
 * CA-T-403 — модель заданий пересчёта.
 *
 * Только single-instance model/service: без worker, heartbeat-цикла, HTTP API
 * и массового пересчёта. `RecalculationBatch.id` — business operation ID;
 * `ProjectRecalculation.batchId` ссылается на него. U-ключ задания:
 * `(projectId, toPriceVersionId, batchId)`.
 */

export const BATCHES_COLLECTION = "recalculation-batches.json";
export const JOBS_COLLECTION = "project-recalculations.json";

export type JobModelIssueCode =
  | "BATCH_NOT_FOUND"
  | "BATCH_ID_CONFLICT"
  | "JOB_PARAMETER_CONFLICT"
  | "JOB_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INVALID_INPUT";

export interface JobModelIssue {
  code: JobModelIssueCode;
  path: string;
  message: string;
}

export type JobModelResult<T> =
  | { ok: true; value: T; created?: boolean }
  | { ok: false; issues: JobModelIssue[] };

function issue(
  code: JobModelIssueCode,
  path: string,
  message: string,
): JobModelIssue[] {
  return [{ code, path, message }];
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function jobKey(job: Pick<ProjectRecalculation, "batchId" | "projectId" | "toPriceVersionId">): string {
  return `${job.batchId}:${job.projectId}:${job.toPriceVersionId}`;
}

function batchStatusOf(
  jobs: readonly ProjectRecalculation[],
): RecalculationBatch["status"] {
  if (jobs.some((job) => job.status === "pending" || job.status === "running")) {
    return "running";
  }
  if (jobs.some((job) => job.status === "failed" || job.status === "dead_letter")) {
    return "completed_with_errors";
  }
  if (jobs.some((job) => job.status === "completed")) {
    return "completed";
  }
  return "cancelled";
}

/** Пересчёт счётчиков batch по фактическим заданиям (не атомарно с jobs). */
export async function refreshRecalculationBatchCounters(
  batchId: string,
): Promise<JobModelResult<RecalculationBatch>> {
  const jobs = await readCollection<ProjectRecalculation>(JOBS_COLLECTION);
  const batchJobs = jobs.filter((job) => job.batchId === batchId);

  return updateCollection<RecalculationBatch, JobModelResult<RecalculationBatch>>(
    BATCHES_COLLECTION,
    (batches) => {
      const index = batches.findIndex((batch) => batch.id === batchId);
      if (index < 0) {
        return {
          items: batches,
          result: {
            ok: false,
            issues: issue("BATCH_NOT_FOUND", "batchId", "batch не найден"),
          },
        };
      }
      const terminal = batchJobs.every(
        (job) => job.status !== "pending" && job.status !== "running",
      );
      const updated: RecalculationBatch = {
        ...batches[index]!,
        status: batchStatusOf(batchJobs),
        totalCount: batchJobs.length,
        pendingCount: batchJobs.filter((job) => job.status === "pending").length,
        runningCount: batchJobs.filter((job) => job.status === "running").length,
        completedCount: batchJobs.filter((job) => job.status === "completed").length,
        failedCount: batchJobs.filter(
          (job) => job.status === "failed" || job.status === "dead_letter",
        ).length,
        skippedCount: batchJobs.filter((job) => job.status === "skipped").length,
        finishedAt: terminal ? (batches[index]!.finishedAt ?? new Date().toISOString()) : null,
      };
      const next = [...batches];
      next[index] = recalculationBatchSchema.parse(updated);
      return {
        items: next,
        result: { ok: true, value: next[index]! },
      };
    },
  );
}

export interface CreateRecalculationBatchInput {
  id?: string;
  priceVersionId: string;
  trigger: RecalculationBatch["trigger"];
  createdBy: string;
  now?: string;
}

export async function createRecalculationBatch(
  input: CreateRecalculationBatchInput,
): Promise<JobModelResult<RecalculationBatch>> {
  if (!input.priceVersionId.trim() || !input.createdBy.trim()) {
    return {
      ok: false,
      issues: issue("INVALID_INPUT", "batch", "priceVersionId/createdBy обязательны"),
    };
  }

  const id = input.id?.trim() || `batch-${randomUUID()}`;
  const createdAt = nowIso(input.now);

  return updateCollection<RecalculationBatch, JobModelResult<RecalculationBatch>>(
    BATCHES_COLLECTION,
    (batches) => {
      const existing = batches.find((batch) => batch.id === id);
      if (existing) {
        if (
          existing.priceVersionId !== input.priceVersionId ||
          existing.trigger !== input.trigger
        ) {
          return {
            items: batches,
            result: {
              ok: false,
              issues: issue(
                "BATCH_ID_CONFLICT",
                "id",
                "batch id уже использован с другим priceVersion/trigger",
              ),
            },
          };
        }
        return {
          items: batches,
          result: { ok: true, value: existing, created: false },
        };
      }

      const batch = recalculationBatchSchema.parse({
        id,
        priceVersionId: input.priceVersionId,
        trigger: input.trigger,
        status: "running",
        totalCount: 0,
        pendingCount: 0,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        startedAt: createdAt,
        finishedAt: null,
        createdBy: input.createdBy,
      });
      return {
        items: [...batches, batch],
        result: { ok: true, value: batch, created: true },
      };
    },
  );
}

export interface CreateProjectRecalculationInput {
  batchId: string;
  projectId: string;
  toPriceVersionId: string;
  calcVersion: string;
  deltaReason: ProjectRecalculation["deltaReason"];
  createdBy: string;
  maxAttempts?: number;
  now?: string;
}

export async function createProjectRecalculation(
  input: CreateProjectRecalculationInput,
): Promise<JobModelResult<ProjectRecalculation>> {
  if (
    !input.batchId.trim() ||
    !input.projectId.trim() ||
    !input.toPriceVersionId.trim() ||
    !input.calcVersion.trim() ||
    !input.createdBy.trim()
  ) {
    return {
      ok: false,
      issues: issue(
        "INVALID_INPUT",
        "job",
        "batchId/projectId/toPriceVersionId/calcVersion/createdBy обязательны",
      ),
    };
  }

  const batches = await readCollection<RecalculationBatch>(BATCHES_COLLECTION);
  if (!batches.some((batch) => batch.id === input.batchId)) {
    return {
      ok: false,
      issues: issue("BATCH_NOT_FOUND", "batchId", "batch не найден"),
    };
  }

  const createdAt = nowIso(input.now);
  const result = await updateCollection<
    ProjectRecalculation,
    JobModelResult<ProjectRecalculation>
  >(JOBS_COLLECTION, (jobs) => {
    const candidate = {
      batchId: input.batchId,
      projectId: input.projectId,
      toPriceVersionId: input.toPriceVersionId,
    };
    const key = jobKey(candidate);
    const existing = jobs.find((job) => jobKey(job) === key);
    if (existing) {
      const conflicts: JobModelIssue[] = [];
      const maxAttempts = input.maxAttempts ?? 3;
      if (existing.calcVersion !== input.calcVersion) {
        conflicts.push({
          code: "JOB_PARAMETER_CONFLICT",
          path: "calcVersion",
          message: `задание уже создано с calcVersion "${existing.calcVersion}", запрошено "${input.calcVersion}"`,
        });
      }
      if (existing.deltaReason !== input.deltaReason) {
        conflicts.push({
          code: "JOB_PARAMETER_CONFLICT",
          path: "deltaReason",
          message: `задание уже создано с deltaReason "${existing.deltaReason}", запрошено "${input.deltaReason}"`,
        });
      }
      if (existing.maxAttempts !== maxAttempts) {
        conflicts.push({
          code: "JOB_PARAMETER_CONFLICT",
          path: "maxAttempts",
          message: `задание уже создано с maxAttempts ${existing.maxAttempts}, запрошено ${maxAttempts}`,
        });
      }
      if (existing.createdBy !== input.createdBy) {
        conflicts.push({
          code: "JOB_PARAMETER_CONFLICT",
          path: "createdBy",
          message: `задание уже создано createdBy "${existing.createdBy}", запрошено "${input.createdBy}"`,
        });
      }
      if (conflicts.length > 0) {
        return { items: jobs, result: { ok: false, issues: conflicts } };
      }
      return {
        items: jobs,
        result: { ok: true, value: existing, created: false },
      };
    }

    const job = projectRecalculationSchema.parse({
      id: `job-${randomUUID()}`,
      batchId: input.batchId,
      projectId: input.projectId,
      fromPriceVersionId: null,
      toPriceVersionId: input.toPriceVersionId,
      calcVersion: input.calcVersion,
      status: "pending",
      attempt: 0,
      maxAttempts: input.maxAttempts ?? 3,
      oldPrice: null,
      newPrice: null,
      deltaReason: input.deltaReason,
      error: null,
      lastHeartbeatAt: null,
      createdAt,
      startedAt: null,
      finishedAt: null,
      createdBy: input.createdBy,
      attempts: [],
    });
    return {
      items: [...jobs, job],
      result: { ok: true, value: job, created: true },
    };
  });

  if (result.ok && result.created) {
    await refreshRecalculationBatchCounters(input.batchId);
  }
  return result;
}

/** Допустимые переходы статусов задания (§6.9/§14.4). */
const TRANSITIONS: Record<RecalculationStatus, readonly RecalculationStatus[]> = {
  pending: ["running", "cancelled", "skipped"],
  running: ["completed", "failed", "cancelled"],
  failed: ["pending", "dead_letter", "cancelled"],
  skipped: ["pending", "cancelled"],
  dead_letter: ["pending", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionProjectRecalculation(
  from: RecalculationStatus,
  to: RecalculationStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface StartProjectRecalculationInput {
  fromPriceVersionId: string | null;
  oldPrice?: number | null;
  now?: string;
}

export async function startProjectRecalculation(
  id: string,
  input: StartProjectRecalculationInput,
): Promise<JobModelResult<ProjectRecalculation>> {
  const startedAt = nowIso(input.now);
  const result = await updateCollection<
    ProjectRecalculation,
    JobModelResult<ProjectRecalculation>
  >(JOBS_COLLECTION, (jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0) {
      return {
        items: jobs,
        result: { ok: false, issues: issue("JOB_NOT_FOUND", "id", "задание не найдено") },
      };
    }
    const job = jobs[index]!;
    if (!canTransitionProjectRecalculation(job.status, "running")) {
      return {
        items: jobs,
        result: {
          ok: false,
          issues: issue(
            "INVALID_TRANSITION",
            "status",
            `нельзя перейти ${job.status} → running`,
          ),
        },
      };
    }

    const attempt = job.attempt + 1;
    const updated: ProjectRecalculation = {
      ...job,
      status: "running",
      attempt,
      fromPriceVersionId: input.fromPriceVersionId,
      oldPrice: input.oldPrice ?? job.oldPrice,
      error: null,
      startedAt: job.startedAt ?? startedAt,
      lastHeartbeatAt: startedAt,
      attempts: [
        ...job.attempts,
        {
          attempt,
          fromPriceVersionId: input.fromPriceVersionId,
          oldPrice: input.oldPrice ?? null,
          startedAt,
          finishedAt: null,
        },
      ],
    };
    const next = [...jobs];
    next[index] = projectRecalculationSchema.parse(updated);
    return { items: next, result: { ok: true, value: next[index]! } };
  });

  if (result.ok) await refreshRecalculationBatchCounters(result.value.batchId);
  return result;
}

export async function completeProjectRecalculation(
  id: string,
  input: { newPrice: number; now?: string },
): Promise<JobModelResult<ProjectRecalculation>> {
  const finishedAt = nowIso(input.now);
  const result = await updateCollection<
    ProjectRecalculation,
    JobModelResult<ProjectRecalculation>
  >(JOBS_COLLECTION, (jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0) {
      return {
        items: jobs,
        result: { ok: false, issues: issue("JOB_NOT_FOUND", "id", "задание не найдено") },
      };
    }
    const job = jobs[index]!;
    if (!canTransitionProjectRecalculation(job.status, "completed")) {
      return {
        items: jobs,
        result: {
          ok: false,
          issues: issue(
            "INVALID_TRANSITION",
            "status",
            `нельзя перейти ${job.status} → completed`,
          ),
        },
      };
    }
    const attempts = [...job.attempts];
    const last = attempts[attempts.length - 1];
    if (last) attempts[attempts.length - 1] = { ...last, finishedAt };
    const updated: ProjectRecalculation = {
      ...job,
      status: "completed",
      newPrice: input.newPrice,
      finishedAt,
      lastHeartbeatAt: null,
      attempts,
    };
    const next = [...jobs];
    next[index] = projectRecalculationSchema.parse(updated);
    return { items: next, result: { ok: true, value: next[index]! } };
  });

  if (result.ok) await refreshRecalculationBatchCounters(result.value.batchId);
  return result;
}

export async function failProjectRecalculation(
  id: string,
  input: { error: RecalculationError; now?: string },
): Promise<JobModelResult<ProjectRecalculation>> {
  const finishedAt = nowIso(input.now);
  const result = await updateCollection<
    ProjectRecalculation,
    JobModelResult<ProjectRecalculation>
  >(JOBS_COLLECTION, (jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0) {
      return {
        items: jobs,
        result: { ok: false, issues: issue("JOB_NOT_FOUND", "id", "задание не найдено") },
      };
    }
    const job = jobs[index]!;
    if (!canTransitionProjectRecalculation(job.status, "failed")) {
      return {
        items: jobs,
        result: {
          ok: false,
          issues: issue(
            "INVALID_TRANSITION",
            "status",
            `нельзя перейти ${job.status} → failed`,
          ),
        },
      };
    }
    const attempts = [...job.attempts];
    const last = attempts[attempts.length - 1];
    if (last) attempts[attempts.length - 1] = { ...last, finishedAt };
    const updated: ProjectRecalculation = {
      ...job,
      status: "failed",
      error: input.error,
      finishedAt,
      lastHeartbeatAt: null,
      attempts,
    };
    const next = [...jobs];
    next[index] = projectRecalculationSchema.parse(updated);
    return { items: next, result: { ok: true, value: next[index]! } };
  });

  if (result.ok) await refreshRecalculationBatchCounters(result.value.batchId);
  return result;
}

export async function deadLetterProjectRecalculation(
  id: string,
): Promise<JobModelResult<ProjectRecalculation>> {
  const result = await updateCollection<
    ProjectRecalculation,
    JobModelResult<ProjectRecalculation>
  >(JOBS_COLLECTION, (jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0) {
      return {
        items: jobs,
        result: { ok: false, issues: issue("JOB_NOT_FOUND", "id", "задание не найдено") },
      };
    }
    const job = jobs[index]!;
    if (!canTransitionProjectRecalculation(job.status, "dead_letter")) {
      return {
        items: jobs,
        result: {
          ok: false,
          issues: issue(
            "INVALID_TRANSITION",
            "status",
            `нельзя перейти ${job.status} → dead_letter`,
          ),
        },
      };
    }
    const updated: ProjectRecalculation = { ...job, status: "dead_letter" };
    const next = [...jobs];
    next[index] = projectRecalculationSchema.parse(updated);
    return { items: next, result: { ok: true, value: next[index]! } };
  });
  if (result.ok) await refreshRecalculationBatchCounters(result.value.batchId);
  return result;
}

/**
 * CA-T-404: восстановление зависшей попытки. running → pending, либо
 * dead_letter при превышении лимита восстановлений. attempt не меняется
 * здесь: следующая попытка получит attempt+1 при старте.
 */
export async function recoverStaleProjectRecalculation(
  id: string,
  input: { deadLetter: boolean; now?: string },
): Promise<JobModelResult<ProjectRecalculation>> {
  const finishedAt = nowIso(input.now);
  const result = await updateCollection<
    ProjectRecalculation,
    JobModelResult<ProjectRecalculation>
  >(JOBS_COLLECTION, (jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0) {
      return {
        items: jobs,
        result: { ok: false, issues: issue("JOB_NOT_FOUND", "id", "задание не найдено") },
      };
    }
    const job = jobs[index]!;
    if (job.status !== "running") {
      return {
        items: jobs,
        result: {
          ok: false,
          issues: issue(
            "INVALID_TRANSITION",
            "status",
            `нельзя восстановить ${job.status}; ожидался running`,
          ),
        },
      };
    }
    const updated: ProjectRecalculation = input.deadLetter
      ? {
          ...job,
          status: "dead_letter",
          finishedAt,
          lastHeartbeatAt: null,
        }
      : {
          ...job,
          status: "pending",
          finishedAt: null,
          lastHeartbeatAt: null,
          error: null,
        };
    const next = [...jobs];
    next[index] = projectRecalculationSchema.parse(updated);
    return { items: next, result: { ok: true, value: next[index]! } };
  });
  if (result.ok) await refreshRecalculationBatchCounters(result.value.batchId);
  return result;
}

export async function cancelProjectRecalculation(
  id: string,
  now?: string,
): Promise<JobModelResult<ProjectRecalculation>> {
  return finishTerminal(id, "cancelled", now);
}

export async function skipProjectRecalculation(
  id: string,
  input: { error: RecalculationError; now?: string },
): Promise<JobModelResult<ProjectRecalculation>> {
  return finishTerminal(id, "skipped", input.now, input.error);
}

async function finishTerminal(
  id: string,
  status: "cancelled" | "skipped",
  now?: string,
  error: RecalculationError | null = null,
): Promise<JobModelResult<ProjectRecalculation>> {
  const finishedAt = nowIso(now);
  const result = await updateCollection<
    ProjectRecalculation,
    JobModelResult<ProjectRecalculation>
  >(JOBS_COLLECTION, (jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0) {
      return {
        items: jobs,
        result: { ok: false, issues: issue("JOB_NOT_FOUND", "id", "задание не найдено") },
      };
    }
    const job = jobs[index]!;
    if (!canTransitionProjectRecalculation(job.status, status)) {
      return {
        items: jobs,
        result: {
          ok: false,
          issues: issue(
            "INVALID_TRANSITION",
            "status",
            `нельзя перейти ${job.status} → ${status}`,
          ),
        },
      };
    }
    const attempts = [...job.attempts];
    const last = attempts[attempts.length - 1];
    if (last) attempts[attempts.length - 1] = { ...last, finishedAt };
    const updated: ProjectRecalculation = {
      ...job,
      status,
      error,
      finishedAt,
      lastHeartbeatAt: null,
      attempts,
    };
    const next = [...jobs];
    next[index] = projectRecalculationSchema.parse(updated);
    return { items: next, result: { ok: true, value: next[index]! } };
  });
  if (result.ok) await refreshRecalculationBatchCounters(result.value.batchId);
  return result;
}

export async function retryProjectRecalculation(
  id: string,
): Promise<JobModelResult<ProjectRecalculation>> {
  const result = await updateCollection<
    ProjectRecalculation,
    JobModelResult<ProjectRecalculation>
  >(JOBS_COLLECTION, (jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0) {
      return {
        items: jobs,
        result: { ok: false, issues: issue("JOB_NOT_FOUND", "id", "задание не найдено") },
      };
    }
    const job = jobs[index]!;
    if (!canTransitionProjectRecalculation(job.status, "pending")) {
      return {
        items: jobs,
        result: {
          ok: false,
          issues: issue(
            "INVALID_TRANSITION",
            "status",
            `нельзя перейти ${job.status} → pending`,
          ),
        },
      };
    }
    const updated: ProjectRecalculation = {
      ...job,
      status: "pending",
      error: null,
      finishedAt: null,
      lastHeartbeatAt: null,
    };
    const next = [...jobs];
    next[index] = projectRecalculationSchema.parse(updated);
    return { items: next, result: { ok: true, value: next[index]! } };
  });

  if (result.ok) await refreshRecalculationBatchCounters(result.value.batchId);
  return result;
}

/**
 * CA-T-404: heartbeat выполняющегося задания. Обновляет только running;
 * terminal/pending не трогает. Возвращает ошибку, если задание уже не running
 * (например, отменено администратором во время выполнения).
 */
export async function touchProjectRecalculationHeartbeat(
  id: string,
  now?: string,
): Promise<JobModelResult<ProjectRecalculation>> {
  const stamp = nowIso(now);
  return updateCollection<
    ProjectRecalculation,
    JobModelResult<ProjectRecalculation>
  >(JOBS_COLLECTION, (jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0) {
      return {
        items: jobs,
        result: { ok: false, issues: issue("JOB_NOT_FOUND", "id", "задание не найдено") },
      };
    }
    const job = jobs[index]!;
    if (job.status !== "running") {
      return {
        items: jobs,
        result: {
          ok: false,
          issues: issue(
            "INVALID_TRANSITION",
            "status",
            `heartbeat возможен только для running, текущий — ${job.status}`,
          ),
        },
      };
    }
    const next = [...jobs];
    next[index] = projectRecalculationSchema.parse({ ...job, lastHeartbeatAt: stamp });
    return { items: next, result: { ok: true, value: next[index]! } };
  });
}

export async function listProjectRecalculations(
  filter: { batchId?: string; projectId?: string; status?: RecalculationStatus } = {},
): Promise<ProjectRecalculation[]> {
  const jobs = await readCollection<ProjectRecalculation>(JOBS_COLLECTION);
  return jobs.filter(
    (job) =>
      projectRecalculationSchema.safeParse(job).success &&
      (filter.batchId === undefined || job.batchId === filter.batchId) &&
      (filter.projectId === undefined || job.projectId === filter.projectId) &&
      (filter.status === undefined || job.status === filter.status),
  );
}

export async function getProjectRecalculation(
  id: string,
): Promise<ProjectRecalculation | undefined> {
  const jobs = await readCollection<ProjectRecalculation>(JOBS_COLLECTION);
  return jobs.find((job) => job.id === id);
}

export async function listRecalculationBatches(): Promise<RecalculationBatch[]> {
  return readCollection<RecalculationBatch>(BATCHES_COLLECTION);
}

export async function getRecalculationBatch(
  id: string,
): Promise<RecalculationBatch | undefined> {
  const batches = await readCollection<RecalculationBatch>(BATCHES_COLLECTION);
  return batches.find((batch) => batch.id === id);
}

export function attemptIdOf(job: ProjectRecalculation): string {
  return `${job.id}#${job.attempt}`;
}
