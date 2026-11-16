import { randomBytes } from "node:crypto";

import { appendAuditEvent, listAuditEvents, type AuditAction } from "@/lib/server/audit";
import { readCollectionStatus, updateCollection } from "@/lib/server/store";
import type { StoredProject } from "@/lib/configurator/types";
import { compositionVersionSchema } from "./composition-schema";
import { compositionContentHash } from "./composition-hash";

/**
 * Journal явного закрепления CompositionVersion за проектом.
 *
 * Межколлекционная транзакция не заявляется (NEW-N3 не используется):
 * проект и audit разделены, но намерение фиксируется. Recovery доводит
 * применённый pin до audit либо отменяет незавершённую операцию.
 */

const JOURNAL = "composition-transition-journal.json";

export type CompositionTransitionPhase =
  | "prepared"
  | "project_updated"
  | "audit_pending"
  | "recovering"
  | "completed"
  | "aborted";

export type CompositionOperationAction =
  | "project_transition"
  | "composition_create"
  | "composition_update"
  | "composition_delete"
  | "composition_confirm"
  | "composition_approve";

export interface CompositionTransitionEntry {
  operationId: string;
  /** project_transition — старый формат; остальные — mutation journal. */
  action?: CompositionOperationAction;
  projectId?: string;
  targetVersionId?: string;
  expectedUpdatedAt?: string;
  previousCompositionVersionId?: string | null;
  /** Для mutation journal. */
  entityId?: string;
  actorId?: string;
  actorRole?: string;
  auditAction?: AuditAction;
  auditOldValue?: Record<string, unknown>;
  auditNewValue?: Record<string, unknown>;
  afterVersion?: number;
  afterHash?: string;
  phase: CompositionTransitionPhase;
  auditEventId?: string;
  recoveryToken?: string;
  recoveryStartedAt?: string;
  recoveryAttempts?: number;
  issues?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CompositionTransitionRecoveryResult {
  recovered: number;
  finalized: number;
  aborted: number;
  failed: number;
  issues: string[];
}

const RECOVERY_STALE_MS = 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

export async function listCompositionTransitionJournal(): Promise<
  CompositionTransitionEntry[]
> {
  const read = await readCollectionStatus<CompositionTransitionEntry>(JOURNAL);
  return read.status === "ok" ? read.items : [];
}

export async function beginCompositionTransition(input: {
  operationId: string;
  projectId: string;
  targetVersionId: string;
  expectedUpdatedAt: string;
  previousCompositionVersionId: string | null;
}): Promise<{ created: boolean; entry: CompositionTransitionEntry }> {
  let result!: { created: boolean; entry: CompositionTransitionEntry };
  const now = nowIso();
  await updateCollection<CompositionTransitionEntry, void>(JOURNAL, (items) => {
    const existing = items.find((item) => item.operationId === input.operationId);
    if (existing && existing.phase !== "aborted") {
      if (existing.phase !== "completed") {
        throw new Error(
          `Переход состава "${input.operationId}" уже выполняется (phase=${existing.phase}); выполните recovery.`,
        );
      }
      if (
        existing.projectId !== input.projectId ||
        existing.targetVersionId !== input.targetVersionId
      ) {
        throw new Error(
          `Конфликт operationId "${input.operationId}": другие параметры перехода.`,
        );
      }
      result = { created: false, entry: existing };
      return { items, result: undefined };
    }
    const entry: CompositionTransitionEntry = {
      operationId: input.operationId,
      action: "project_transition",
      projectId: input.projectId,
      targetVersionId: input.targetVersionId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      previousCompositionVersionId: input.previousCompositionVersionId,
      phase: "prepared",
      createdAt: now,
      updatedAt: now,
    };
    result = { created: true, entry };
    return {
      items: existing
        ? items.map((item) => (item.operationId === input.operationId ? entry : item))
        : [...items, entry],
      result: undefined,
    };
  });
  return result;
}

export async function updateCompositionTransition(
  operationId: string,
  patch: Partial<CompositionTransitionEntry>,
): Promise<void> {
  await updateCollection<CompositionTransitionEntry, void>(JOURNAL, (items) => ({
    items: items.map((entry) =>
      entry.operationId === operationId
        ? { ...entry, ...patch, updatedAt: nowIso() }
        : entry,
    ),
    result: undefined,
  }));
}

export async function beginCompositionOperation(input: {
  operationId: string;
  action: Exclude<CompositionOperationAction, "project_transition">;
  entityId: string;
  actorId: string;
  actorRole: string;
  auditAction: AuditAction;
  auditOldValue?: Record<string, unknown>;
  auditNewValue?: Record<string, unknown>;
  afterVersion?: number;
  afterHash?: string;
}): Promise<{ created: boolean; entry: CompositionTransitionEntry }> {
  let result!: { created: boolean; entry: CompositionTransitionEntry };
  const now = nowIso();
  await updateCollection<CompositionTransitionEntry, void>(JOURNAL, (items) => {
    const existing = items.find((item) => item.operationId === input.operationId);
    if (existing && existing.phase !== "aborted") {
      if (existing.phase !== "completed") {
        throw new Error(
          `Операция состава "${input.operationId}" уже выполняется (phase=${existing.phase}); выполните recovery.`,
        );
      }
      result = { created: false, entry: existing };
      return { items, result: undefined };
    }
    const entry: CompositionTransitionEntry = {
      operationId: input.operationId,
      action: input.action,
      entityId: input.entityId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      auditAction: input.auditAction,
      ...(input.auditOldValue ? { auditOldValue: input.auditOldValue } : {}),
      ...(input.auditNewValue ? { auditNewValue: input.auditNewValue } : {}),
      ...(input.afterVersion !== undefined ? { afterVersion: input.afterVersion } : {}),
      ...(input.afterHash ? { afterHash: input.afterHash } : {}),
      phase: "prepared",
      createdAt: now,
      updatedAt: now,
    };
    result = { created: true, entry };
    return {
      items: existing
        ? items.map((item) => (item.operationId === input.operationId ? entry : item))
        : [...items, entry],
      result: undefined,
    };
  });
  return result;
}

export async function updateCompositionOperation(
  operationId: string,
  patch: Partial<CompositionTransitionEntry>,
): Promise<void> {
  await updateCompositionTransition(operationId, patch);
}

async function ensureOperationAudit(
  entry: CompositionTransitionEntry,
): Promise<string> {
  const action = entry.auditAction ?? "composition.update";
  const events = await listAuditEvents({ action });
  const existing = events.find((event) => event.requestId === entry.operationId);
  if (existing) return existing.id;
  const event = await appendAuditEvent({
    action,
    entityType: "compositionVersion",
    entityId: entry.entityId ?? entry.operationId,
    actorId: entry.actorId ?? "recovery",
    actorRole: entry.actorRole ?? "system",
    result: "ok",
    requestId: entry.operationId,
    ...(entry.auditOldValue ? { oldValue: entry.auditOldValue } : {}),
    ...(entry.auditNewValue ? { newValue: entry.auditNewValue } : {}),
  });
  return event.id;
}

async function ensureTransitionAudit(
  entry: CompositionTransitionEntry,
): Promise<string> {
  const events = await listAuditEvents({
    action: "project.composition_transition",
  });
  const existing = events.find((event) => event.requestId === entry.operationId);
  if (existing) return existing.id;
  const event = await appendAuditEvent({
    action: "project.composition_transition",
    entityType: "project",
    entityId: entry.projectId ?? entry.entityId ?? entry.operationId,
    actorId: "recovery",
    actorRole: "system",
    result: "ok",
    requestId: entry.operationId,
    oldValue: { compositionVersionId: entry.previousCompositionVersionId },
    newValue: { compositionVersionId: entry.targetVersionId },
  });
  return event.id;
}

export async function recoverCompositionTransitions(): Promise<CompositionTransitionRecoveryResult> {
  const journal = await readCollectionStatus<CompositionTransitionEntry>(JOURNAL);
  if (journal.status === "missing") {
    return { recovered: 0, finalized: 0, aborted: 0, failed: 0, issues: [] };
  }
  if (journal.status === "corrupt") {
    return {
      recovered: 0,
      finalized: 0,
      aborted: 0,
      failed: 0,
      issues: [`composition-transition-journal.json повреждён: ${journal.reason}`],
    };
  }
  const now = Date.now();
  const token = randomBytes(6).toString("hex");
  const claimed: CompositionTransitionEntry[] = [];
  await updateCollection<CompositionTransitionEntry, void>(JOURNAL, (items) => ({
    items: items.map((entry) => {
      if (entry.phase === "completed" || entry.phase === "aborted") return entry;
      const stale =
        entry.phase !== "recovering" ||
        !entry.recoveryStartedAt ||
        now - Date.parse(entry.recoveryStartedAt) > RECOVERY_STALE_MS;
      if (!stale) return entry;
      const updated: CompositionTransitionEntry = {
        ...entry,
        phase: "recovering",
        recoveryToken: token,
        recoveryStartedAt: nowIso(),
        recoveryAttempts: (entry.recoveryAttempts ?? 0) + 1,
        updatedAt: nowIso(),
      };
      claimed.push(updated);
      return updated;
    }),
    result: undefined,
  }));

  const projectsRead = await readCollectionStatus<StoredProject>("projects.json");
  const projects = projectsRead.status === "ok" ? projectsRead.items : [];
  const versionsRead = await readCollectionStatus<unknown>("composition-versions.json");
  const versions =
    versionsRead.status === "ok"
      ? versionsRead.items
          .map((raw) => compositionVersionSchema.safeParse(raw))
          .filter((parsed) => parsed.success)
          .map((parsed) => parsed.data)
          .filter(
            (version) =>
              compositionContentHash(
                version.lines,
                version.rulesSnapshotId,
                version.pins,
              ) === version.contentHash,
          )
      : [];
  const issues: string[] = [];
  if (projectsRead.status === "corrupt") {
    issues.push(`projects.json повреждён: ${projectsRead.reason}`);
  }

  let recovered = 0;
  let finalized = 0;
  let aborted = 0;
  let failed = 0;

  for (const entry of claimed) {
    try {
      const action = entry.action ?? "project_transition";
      let applied = false;
      if (action === "project_transition") {
        const project = projects.find((item) => item.id === entry.projectId);
        applied = project?.compositionVersionId === entry.targetVersionId;
      } else if (action === "composition_delete") {
        applied = !versions.some((version) => version.id === entry.entityId);
      } else {
        const version = versions.find((item) => item.id === entry.entityId);
        applied =
          Boolean(version) &&
          (entry.afterVersion === undefined ||
            (version !== undefined && version.version >= entry.afterVersion));
      }
      if (!applied) {
        await updateCompositionTransition(entry.operationId, {
          phase: "aborted",
          recoveryToken: undefined,
          issues: [...(entry.issues ?? []), "изменение не применено; операция отменена"],
        });
        aborted += 1;
        continue;
      }
      const auditEventId =
        action === "project_transition"
          ? await ensureTransitionAudit(entry)
          : await ensureOperationAudit(entry);
      await updateCompositionTransition(entry.operationId, {
        phase: "completed",
        auditEventId,
        recoveryToken: undefined,
        issues: undefined,
      });
      finalized += 1;
      recovered += 1;
    } catch (error) {
      failed += 1;
      issues.push(
        `${entry.operationId}: recovery не выполнен — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await updateCompositionTransition(entry.operationId, {
        recoveryToken: undefined,
        issues: [
          ...(entry.issues ?? []),
          error instanceof Error ? error.message : String(error),
        ],
      }).catch(() => undefined);
    }
  }

  return { recovered, finalized, aborted, failed, issues };
}
