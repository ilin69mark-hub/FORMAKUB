import { appendAuditEvent } from "@/lib/server/audit";

import type { ActorContext } from "./parameters";
import {
  cancelProjectRecalculation,
  getProjectRecalculation,
  retryProjectRecalculation,
  type JobModelResult,
} from "./jobs";
import type { ProjectRecalculation } from "./schema";

/**
 * CA-T-409 — retry/cancel задания с записью в существующий AdminAuditLog.
 * Только single-instance сервис: не запускает worker и не выполняет расчёт.
 */

async function audit(
  action: "recalc.retry" | "recalc.cancel",
  before: ProjectRecalculation,
  after: ProjectRecalculation,
  actor: ActorContext,
  now: string,
): Promise<void> {
  await appendAuditEvent({
    action,
    entityType: "projectRecalculation",
    entityId: before.id,
    oldValue: { status: before.status, attempt: before.attempt },
    newValue: { status: after.status, attempt: after.attempt },
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    createdAt: now,
  });
}

export async function retryRecalculation(input: {
  jobId: string;
  actor: ActorContext;
  now?: string;
}): Promise<JobModelResult<ProjectRecalculation>> {
  const before = await getProjectRecalculation(input.jobId);
  if (!before) {
    return {
      ok: false,
      issues: [{ code: "JOB_NOT_FOUND", path: "jobId", message: "задание не найдено" }],
    };
  }
  const result = await retryProjectRecalculation(input.jobId);
  if (!result.ok) return result;
  await audit("recalc.retry", before, result.value, input.actor, input.now ?? new Date().toISOString());
  return result;
}

export async function cancelRecalculation(input: {
  jobId: string;
  actor: ActorContext;
  now?: string;
}): Promise<JobModelResult<ProjectRecalculation>> {
  const before = await getProjectRecalculation(input.jobId);
  if (!before) {
    return {
      ok: false,
      issues: [{ code: "JOB_NOT_FOUND", path: "jobId", message: "задание не найдено" }],
    };
  }
  const result = await cancelProjectRecalculation(input.jobId, input.now);
  if (!result.ok) return result;
  await audit("recalc.cancel", before, result.value, input.actor, input.now ?? new Date().toISOString());
  return result;
}
