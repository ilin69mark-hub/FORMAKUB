import { randomBytes } from "node:crypto";

import { appendAuditEvent, listAuditEvents } from "@/lib/server/audit";
import { readCollectionStatus, updateCollection } from "@/lib/server/store";

import { compositionVersionSchema } from "./composition-schema";
import { compositionContentHash } from "./composition-hash";

/**
 * Journal публикации CompositionVersion (по принципам ADR-07 D-10/D-11).
 *
 * Межколлекционная транзакция не заявляется (NEW-N3 не используется):
 * публикация версии и audit event разделены, но намерение фиксируется в
 * журнале. Recovery при старте и перед публикацией доводит завершённую
 * запись до audit либо безопасно отменяет незавершённую.
 */

const JOURNAL = "composition-publication-journal.json";
const VERSIONS = "composition-versions.json";

export type CompositionPublicationPhase =
  | "prepared"
  | "version_published"
  | "audit_pending"
  | "recovering"
  | "completed"
  | "aborted";

export interface CompositionPublicationEntry {
  operationId: string;
  versionId: string;
  expectedVersion: number;
  contentHash: string;
  actorId: string;
  actorRole: string;
  phase: CompositionPublicationPhase;
  publishedSeq?: number;
  auditEventId?: string;
  recoveryToken?: string;
  recoveryStartedAt?: string;
  recoveryAttempts?: number;
  issues?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CompositionRecoveryResult {
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

export async function listCompositionPublicationJournal(): Promise<
  CompositionPublicationEntry[]
> {
  const read = await readCollectionStatus<CompositionPublicationEntry>(JOURNAL);
  return read.status === "ok" ? read.items : [];
}

export async function beginCompositionPublication(input: {
  operationId: string;
  versionId: string;
  expectedVersion: number;
  contentHash: string;
  actorId: string;
  actorRole: string;
}): Promise<{ created: boolean; entry: CompositionPublicationEntry }> {
  let result!: { created: boolean; entry: CompositionPublicationEntry };
  const now = nowIso();
  await updateCollection<CompositionPublicationEntry, void>(JOURNAL, (items) => {
    const existing = items.find(
      (entry) => entry.operationId === input.operationId,
    );
    if (existing && existing.phase !== "aborted") {
      if (existing.phase !== "completed") {
        throw new Error(
          `Публикация состава "${input.operationId}" уже выполняется или не завершена (phase=${existing.phase}); выполните recovery.`,
        );
      }
      if (
        existing.versionId !== input.versionId ||
        existing.contentHash !== input.contentHash
      ) {
        throw new Error(
          `Конфликт operationId "${input.operationId}": другие параметры публикации состава.`,
        );
      }
      result = { created: false, entry: existing };
      return { items, result: undefined };
    }
    const entry: CompositionPublicationEntry = {
      operationId: input.operationId,
      versionId: input.versionId,
      expectedVersion: input.expectedVersion,
      contentHash: input.contentHash,
      actorId: input.actorId,
      actorRole: input.actorRole,
      phase: "prepared",
      createdAt: now,
      updatedAt: now,
    };
    result = { created: true, entry };
    return {
      items: existing
        ? items.map((item) =>
            item.operationId === input.operationId ? entry : item,
          )
        : [...items, entry],
      result: undefined,
    };
  });
  return result;
}

export async function updateCompositionPublication(
  operationId: string,
  patch: Partial<CompositionPublicationEntry>,
): Promise<void> {
  await updateCollection<CompositionPublicationEntry, void>(
    JOURNAL,
    (items) => ({
      items: items.map((entry) =>
        entry.operationId === operationId
          ? { ...entry, ...patch, updatedAt: nowIso() }
          : entry,
      ),
      result: undefined,
    }),
  );
}

interface RawComposition {
  id?: unknown;
  status?: unknown;
  contentHash?: unknown;
  publishedSeq?: unknown;
  lines?: unknown;
  publishedAt?: unknown;
  publishedBy?: unknown;
}

function findPublishedVersion(
  items: readonly unknown[],
  entry: CompositionPublicationEntry,
): RawComposition | undefined {
  return items.find((raw) => {
    if (raw === null || typeof raw !== "object") return false;
    const version = raw as RawComposition;
    return (
      version.id === entry.versionId &&
      (version.status === "published" || version.status === "superseded") &&
      version.contentHash === entry.contentHash
    );
  }) as RawComposition | undefined;
}

async function ensureCompositionAudit(
  entry: CompositionPublicationEntry,
  version: RawComposition,
): Promise<string> {
  const events = await listAuditEvents({ action: "composition.publish" });
  const existing = events.find((event) => event.requestId === entry.operationId);
  if (existing) return existing.id;

  const event = await appendAuditEvent({
    action: "composition.publish",
    entityType: "compositionVersion",
    entityId: entry.versionId,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    result: "ok",
    requestId: entry.operationId,
    newValue: {
      versionId: entry.versionId,
      publishedSeq: version.publishedSeq ?? entry.publishedSeq ?? null,
      linesCount: Array.isArray(version.lines) ? version.lines.length : 0,
      contentHash: entry.contentHash,
      recovered: true,
    },
  });
  return event.id;
}

/**
 * Идемпотентное восстановление публикаций состава. Не публикует заново и
 * не меняет содержимое версии.
 */
export async function recoverCompositionPublications(): Promise<CompositionRecoveryResult> {
  const journal = await readCollectionStatus<CompositionPublicationEntry>(
    JOURNAL,
  );
  if (journal.status === "missing") {
    return { recovered: 0, finalized: 0, aborted: 0, failed: 0, issues: [] };
  }
  if (journal.status === "corrupt") {
    return {
      recovered: 0,
      finalized: 0,
      aborted: 0,
      failed: 0,
      issues: [`composition-publication-journal.json повреждён: ${journal.reason}`],
    };
  }

  const now = Date.now();
  const token = randomBytes(6).toString("hex");
  const claimed: CompositionPublicationEntry[] = [];

  await updateCollection<CompositionPublicationEntry, void>(
    JOURNAL,
    (items) => ({
      items: items.map((entry) => {
        if (entry.phase === "completed" || entry.phase === "aborted") return entry;
        const stale =
          entry.phase !== "recovering" ||
          !entry.recoveryStartedAt ||
          now - Date.parse(entry.recoveryStartedAt) > RECOVERY_STALE_MS;
        if (!stale) return entry;
        const updated: CompositionPublicationEntry = {
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
    }),
  );

  const read = await readCollectionStatus<unknown>(VERSIONS);
  const versions = read.status === "ok" ? read.items : [];
  const issues: string[] = [];
  if (read.status === "corrupt") {
    issues.push(`composition-versions.json повреждён: ${read.reason}`);
  }

  let recovered = 0;
  let finalized = 0;
  let aborted = 0;
  let failed = 0;

  for (const entry of claimed) {
    try {
      const version = findPublishedVersion(versions, entry);
      if (!version) {
        await updateCompositionPublication(entry.operationId, {
          phase: "aborted",
          recoveryToken: undefined,
          issues: [
            ...(entry.issues ?? []),
            "опубликованная версия состава не найдена; публикация отменена",
          ],
        });
        aborted += 1;
        continue;
      }
      const parsed = compositionVersionSchema.safeParse(version);
      if (!parsed.success) {
        throw new Error(
          `опубликованная версия не проходит схему: ${parsed.error.message}`,
        );
      }
      const expectedHash = compositionContentHash(
        parsed.data.lines,
        parsed.data.rulesSnapshotId,
        parsed.data.pins,
      );
      if (expectedHash !== parsed.data.contentHash) {
        throw new Error(
          `опубликованная версия "${parsed.data.id}" имеет неверный contentHash.`,
        );
      }
      const auditEventId = await ensureCompositionAudit(entry, version);
      await updateCompositionPublication(entry.operationId, {
        phase: "completed",
        publishedSeq:
          typeof version.publishedSeq === "number"
            ? version.publishedSeq
            : entry.publishedSeq,
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
      await updateCompositionPublication(entry.operationId, {
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
