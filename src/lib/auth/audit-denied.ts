import type { ActorContext } from "@/lib/admin/parameters";
import {
  appendAuditEvent,
  type AuditAction,
} from "@/lib/server/audit";

/** CA-T-605: аудит отказов доступа в существующий AdminAuditLog. */
export async function auditDenied(input: {
  action: AuditAction;
  entityType: string;
  entityId: string;
  actor: ActorContext | null;
  reason: string;
  now?: string;
}): Promise<void> {
  await appendAuditEvent({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actor?.actorId ?? "anonymous",
    actorRole: input.actor?.actorRole ?? "anonymous",
    result: "denied",
    ...(input.action === "param.update"
      ? {
          paramVersion: "denied",
          oldValue: null,
          newValue: { reason: input.reason },
        }
      : { newValue: { reason: input.reason } }),
    createdAt: input.now ?? new Date().toISOString(),
  });
}
