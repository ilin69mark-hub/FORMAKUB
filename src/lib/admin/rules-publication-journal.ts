import { randomBytes } from "node:crypto";

import { appendAuditEvent, listAuditEvents } from "@/lib/server/audit";
import {
  readCollectionStatus,
  updateCollection,
} from "@/lib/server/store";

/**
 * NEW-N4 / D-10, D-11 — журнал публикации Rules Snapshot и recovery.
 *
 * Инвариант: успешно завершённая публикация всегда имеет audit event
 * `rule.publish` с тем же `requestId=operationId`. Межколлекционная
 * транзакция не заявляется (NEW-N3 не реализуется): используется журнал
 * намерения и идемпотентное восстановление.
 */

const JOURNAL = "rules-publication-journal.json";
const SNAPSHOTS = "rules-snapshots.json";
const RULES = "managed-rules.json";

export type PublicationPhase =
  | "prepared"
  | "snapshot_created"
  | "rules_promoted"
  | "audit_pending"
  | "recovering"
  | "completed"
  | "aborted";

export interface PublicationSelectionItem {
  id: string;
  expectedVersion: string;
}

export interface PublicationJournalEntry {
  operationId: string;
  actorId: string;
  actorRole: string;
  selection: PublicationSelectionItem[];
  contentHash: string;
  phase: PublicationPhase;
  snapshotId?: string;
  publishedSeq?: number;
  rulesCount?: number;
  publishedRuleIds?: string[];
  auditEventId?: string;
  recoveryToken?: string;
  recoveryStartedAt?: string;
  createdAt: string;
  updatedAt: string;
  recoveryAttempts?: number;
  issues?: string[];
}

export interface PublicationRecoveryResult {
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

export async function listRulesPublicationJournal(): Promise<
  PublicationJournalEntry[]
> {
  const read = await readCollectionStatus<PublicationJournalEntry>(JOURNAL);
  return read.status === "ok" ? read.items : [];
}

export async function findPublicationJournalEntry(
  operationId: string,
): Promise<PublicationJournalEntry | undefined> {
  const entries = await listRulesPublicationJournal();
  return entries.find((entry) => entry.operationId === operationId);
}

/**
 * Регистрация намерения публикации. Повторный operationId:
 *  - completed → возвращается существующая запись;
 *  - active → ошибка «в процессе» (вызывающий должен выполнить recovery);
 *  - aborted → создаётся новая попытка с тем же operationId.
 */
export async function beginPublication(input: {
  operationId: string;
  actorId: string;
  actorRole: string;
  selection: PublicationSelectionItem[];
  contentHash: string;
}): Promise<{ created: boolean; entry: PublicationJournalEntry }> {
  let result!: { created: boolean; entry: PublicationJournalEntry };
  const now = nowIso();
  await updateCollection<PublicationJournalEntry, void>(JOURNAL, (items) => {
    const existing = items.find((entry) => entry.operationId === input.operationId);
    if (existing && existing.phase !== "aborted") {
      if (existing.phase !== "completed") {
        throw new Error(
          `Публикация "${input.operationId}" уже выполняется или не завершена (phase=${existing.phase}); выполните recovery.`,
        );
      }
      if (
        existing.contentHash !== input.contentHash ||
        JSON.stringify(existing.selection) !== JSON.stringify(input.selection)
      ) {
        throw new Error(
          `Конфликт operationId "${input.operationId}": другие параметры публикации.`,
        );
      }
      result = { created: false, entry: existing };
      return { items, result: undefined };
    }

    const entry: PublicationJournalEntry = {
      operationId: input.operationId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      selection: input.selection,
      contentHash: input.contentHash,
      phase: "prepared",
      createdAt: now,
      updatedAt: now,
    };
    result = { created: true, entry };
    const next = existing
      ? items.map((item) => (item.operationId === input.operationId ? entry : item))
      : [...items, entry];
    return { items: next, result: undefined };
  });
  return result;
}

export async function updatePublicationEntry(
  operationId: string,
  patch: Partial<PublicationJournalEntry>,
): Promise<void> {
  await updateCollection<PublicationJournalEntry, void>(JOURNAL, (items) => ({
    items: items.map((entry) =>
      entry.operationId === operationId
        ? { ...entry, ...patch, updatedAt: nowIso() }
        : entry,
    ),
    result: undefined,
  }));
}

interface RawSnapshot {
  id?: unknown;
  publishedSeq?: unknown;
  rules?: unknown;
  contentHash?: unknown;
}

function findSnapshot(
  items: readonly unknown[],
  entry: PublicationJournalEntry,
): RawSnapshot | undefined {
  return items.find((raw) => {
    if (raw === null || typeof raw !== "object") return false;
    const snapshot = raw as RawSnapshot;
    if (entry.snapshotId) return snapshot.id === entry.snapshotId;
    return snapshot.contentHash === entry.contentHash;
  }) as RawSnapshot | undefined;
}

async function promoteSelectedRules(entry: PublicationJournalEntry): Promise<void> {
  if (entry.selection.length === 0) return;
  const expected = new Map(
    entry.selection.map((item) => [item.id, item.expectedVersion]),
  );
  await updateCollection<Record<string, unknown>, void>(RULES, (items) => ({
    items: items.map((rule) => {
      const id = typeof rule.id === "string" ? rule.id : "";
      if (rule.status !== "draft" || rule.version !== expected.get(id)) {
        return rule;
      }
      return { ...rule, status: "published" };
    }),
    result: undefined,
  }));
}

async function ensurePublicationAudit(
  entry: PublicationJournalEntry,
  snapshot: RawSnapshot,
): Promise<string> {
  const events = await listAuditEvents({ action: "rule.publish" });
  const existing = events.find((event) => event.requestId === entry.operationId);
  if (existing) return existing.id;

  const event = await appendAuditEvent({
    action: "rule.publish",
    entityType: "rulesSnapshot",
    entityId: String(snapshot.id ?? entry.snapshotId ?? "unknown"),
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    result: "ok",
    requestId: entry.operationId,
    newValue: {
      snapshotId: String(snapshot.id ?? entry.snapshotId ?? "unknown"),
      publishedSeq: snapshot.publishedSeq ?? entry.publishedSeq ?? null,
      rulesCount: Array.isArray(snapshot.rules) ? snapshot.rules.length : entry.rulesCount ?? 0,
      publishedRuleIds:
        entry.publishedRuleIds ??
        entry.selection.map((item) => item.id),
      contentHash: entry.contentHash,
      recovered: true,
    },
  });
  return event.id;
}

/**
 * Идемпотентное восстановление публикаций. Вызывается при старте приложения
 * и перед новой публикацией. Не создаёт snapshot и не публикует заново.
 */
export async function recoverRulesPublications(): Promise<PublicationRecoveryResult> {
  const journal = await readCollectionStatus<PublicationJournalEntry>(JOURNAL);
  if (journal.status === "missing") {
    return { recovered: 0, finalized: 0, aborted: 0, failed: 0, issues: [] };
  }
  if (journal.status === "corrupt") {
    return {
      recovered: 0,
      finalized: 0,
      aborted: 0,
      failed: 0,
      issues: [`rules-publication-journal.json повреждён: ${journal.reason}`],
    };
  }

  const now = Date.now();
  const token = randomBytes(6).toString("hex");
  const claimed: PublicationJournalEntry[] = [];

  await updateCollection<PublicationJournalEntry, void>(JOURNAL, (items) => {
    const next = items.map((entry) => {
      if (entry.phase === "completed" || entry.phase === "aborted") return entry;
      const stale =
        entry.phase !== "recovering" ||
        !entry.recoveryStartedAt ||
        now - Date.parse(entry.recoveryStartedAt) > RECOVERY_STALE_MS;
      if (!stale) return entry;
      const updated: PublicationJournalEntry = {
        ...entry,
        phase: "recovering",
        recoveryToken: token,
        recoveryStartedAt: nowIso(),
        recoveryAttempts: (entry.recoveryAttempts ?? 0) + 1,
        updatedAt: nowIso(),
      };
      claimed.push(updated);
      return updated;
    });
    return { items: next, result: undefined };
  });

  const snapshotsRead = await readCollectionStatus<unknown>(SNAPSHOTS);
  const snapshotItems =
    snapshotsRead.status === "ok" ? snapshotsRead.items : [];
  const issues: string[] = [];
  if (snapshotsRead.status === "corrupt") {
    issues.push(`rules-snapshots.json повреждён: ${snapshotsRead.reason}`);
  }

  let recovered = 0;
  let finalized = 0;
  let aborted = 0;
  let failed = 0;

  for (const entry of claimed) {
    try {
      const snapshot = findSnapshot(snapshotItems, entry);
      if (!snapshot) {
        // Snapshot не создан — публикация не состоялась; безопасно закрыть.
        await updatePublicationEntry(entry.operationId, {
          phase: "aborted",
          recoveryToken: undefined,
          issues: [...(entry.issues ?? []), "snapshot не создан; публикация отменена"],
        });
        aborted += 1;
        continue;
      }

      await promoteSelectedRules(entry);
      const auditEventId = await ensurePublicationAudit(entry, snapshot);
      await updatePublicationEntry(entry.operationId, {
        phase: "completed",
        snapshotId: String(snapshot.id ?? entry.snapshotId ?? ""),
        publishedSeq:
          typeof snapshot.publishedSeq === "number"
            ? snapshot.publishedSeq
            : entry.publishedSeq,
        rulesCount: Array.isArray(snapshot.rules)
          ? snapshot.rules.length
          : entry.rulesCount,
        publishedRuleIds: entry.publishedRuleIds ?? entry.selection.map((item) => item.id),
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
      await updatePublicationEntry(entry.operationId, {
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
