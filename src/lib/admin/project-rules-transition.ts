import { appendAuditEvent, listAuditEvents } from "@/lib/server/audit";
import {
  readCollectionStatus,
  updateCollection,
} from "@/lib/server/store";
import {
  REQUEST_FINGERPRINT_VERSION,
  requestFingerprint,
} from "@/lib/server/operation-fingerprint";
import type { StoredProject } from "@/lib/configurator/types";

import type { ActorContext } from "./parameters";
import {
  resolveRulesSnapshotById,
  rulesSnapshotReferenceIssues,
} from "./managed-rules";

/**
 * CA-T-612 — контролируемый переход проекта на другой `rulesSnapshotId`
 * (ADR-07 §11.5, Q7-11).
 *
 * Контракт:
 *  - меняются только `StoredProject.rulesSnapshotId` и `updatedAt`
 *    (существующая метка изменения проекта; отдельного revision-поля нет);
 *  - `expectedVersion` — значение `updatedAt`, обязательное условие
 *    оптимистичной блокировки;
 *  - preflight до любых записей: проект, снимок, опубликованность, структура,
 *    отсутствие draft/preliminary, разрешимость ссылок;
 *  - replay по `operationId` возвращает **результат исходной операции**
 *    (id снимков + `updatedAt` после перехода), а не текущее состояние
 *    проекта; последующие переходы не меняют replay предыдущего;
 *  - незавершённые операции восстанавливаются через журнал
 *    `rules-transition-journal.json`: если проект уже изменён, недостающий
 *    audit event дописывается; если проект не изменён — запись журнала
 *    удаляется;
 *  - перерасчёт, коммерческий снимок, конфигурация, геометрия и история цен
 *    не изменяются; другим проектам ничего не назначается.
 *
 * Граница атомарности: Storage Adapter даёт атомарность в пределах одной
 * коллекции (`update`), но не межколлекционную транзакцию. Поэтому операция
 * использует журнал намерения и восстановление; строгая транзакционность —
 * отдельная инфраструктурная задача NEW-N3.
 */

const PROJECTS = "projects.json";
const JOURNAL = "rules-transition-journal.json";

export interface ProjectRulesTransitionInput {
  projectId: string;
  targetRulesSnapshotId: string;
  /** `StoredProject.updatedAt` — текущая версия записи проекта. */
  expectedVersion: string;
  operationId: string;
  actor: ActorContext;
}

export interface ProjectRulesTransitionIssue {
  code: string;
  path: string;
  message: string;
}

export type ProjectRulesTransitionResult =
  | {
      ok: true;
      /** `null` для replay: текущее состояние проекта не возвращается. */
      project: StoredProject | null;
      previousRulesSnapshotId: string | null;
      rulesSnapshotId: string;
      /** `updatedAt` после перехода (результат исходной операции). */
      updatedAt: string;
      replay: boolean;
    }
  | { ok: false; issues: ProjectRulesTransitionIssue[]; status: number };

interface TransitionJournalEntry {
  requestId: string;
  projectId: string;
  expectedVersion: string;
  previousRulesSnapshotId: string | null;
  targetRulesSnapshotId: string;
  updatedAt: string;
  fingerprint: string;
  fingerprintVersion: string;
  actorId: string;
  actorRole: string;
  createdAt: string;
}

interface TransitionAuditPayload {
  projectId?: unknown;
  rulesSnapshotId?: unknown;
  previousRulesSnapshotId?: unknown;
  updatedAt?: unknown;
  fingerprint?: unknown;
  fingerprintVersion?: unknown;
}

function issue(
  code: string,
  path: string,
  message: string,
  status = 422,
): ProjectRulesTransitionResult {
  return { ok: false, issues: [{ code, path, message }], status };
}

function nextUpdatedAt(previous: string): string {
  const now = Date.now();
  const prev = Date.parse(previous);
  const next = Number.isFinite(prev) && now <= prev ? prev + 1 : now;
  return new Date(next).toISOString();
}

function transitionFingerprint(
  projectId: string,
  targetRulesSnapshotId: string,
): string {
  return requestFingerprint({ projectId, targetRulesSnapshotId });
}

async function removeJournalEntry(requestId: string): Promise<void> {
  await updateCollection<TransitionJournalEntry, void>(JOURNAL, (items) => ({
    items: items.filter((entry) => entry.requestId !== requestId),
    result: undefined,
  }));
}

/**
 * Восстановление незавершённых переходов (журнал намерения).
 *
 * Правила:
 *  - проект уже содержит целевой снимок и `updatedAt` операции → переход
 *    состоялся; недостающий audit event дописывается, запись журнала удаляется;
 *  - проект в исходном состоянии → переход не состоялся; запись удаляется;
 *  - проект изменён иначе (например, другим переходом) → запись удаляется
 *    как устаревшая (результат операции недостоверен для восстановления).
 *
 * Возвращает число восстановленных и отброшенных записей.
 */
export async function recoverPendingRulesTransitions(): Promise<{
  recovered: number;
  discarded: number;
}> {
  const read = await readCollectionStatus<TransitionJournalEntry>(JOURNAL);
  if (read.status !== "ok" || read.items.length === 0) {
    return { recovered: 0, discarded: 0 };
  }
  const projectsRead = await readCollectionStatus<StoredProject>(PROJECTS);
  const projects = projectsRead.status === "ok" ? projectsRead.items : [];
  const auditEvents = await listAuditEvents({ action: "project.rules_transition" });
  const auditIds = new Set(
    auditEvents.map((event) => event.requestId).filter((id): id is string => Boolean(id)),
  );

  let recovered = 0;
  let discarded = 0;
  const processed = new Set<string>();

  for (const entry of read.items) {
    const project = projects.find((item) => item.id === entry.projectId);
    const applied =
      project !== undefined &&
      project.rulesSnapshotId === entry.targetRulesSnapshotId &&
      project.updatedAt === entry.updatedAt;

    if (!applied) {
      discarded += 1;
      processed.add(entry.requestId);
      continue;
    }

    if (!auditIds.has(entry.requestId)) {
      await appendAuditEvent({
        action: "project.rules_transition",
        entityType: "project",
        entityId: entry.projectId,
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        result: "ok",
        requestId: entry.requestId,
        oldValue: {
          rulesSnapshotId: entry.previousRulesSnapshotId,
          updatedAt: entry.expectedVersion,
        },
        newValue: {
          projectId: entry.projectId,
          rulesSnapshotId: entry.targetRulesSnapshotId,
          previousRulesSnapshotId: entry.previousRulesSnapshotId,
          expectedVersion: entry.expectedVersion,
          updatedAt: entry.updatedAt,
          fingerprint: entry.fingerprint,
          fingerprintVersion: entry.fingerprintVersion,
          recovered: true,
        },
      });
      auditIds.add(entry.requestId);
    }
    recovered += 1;
    processed.add(entry.requestId);
  }

  await updateCollection<TransitionJournalEntry, void>(JOURNAL, (items) => ({
    items: items.filter((entry) => !processed.has(entry.requestId)),
    result: undefined,
  }));

  return { recovered, discarded };
}

async function findAuditReplay(
  input: ProjectRulesTransitionInput,
  fingerprint: string,
): Promise<ProjectRulesTransitionResult | undefined> {
  const events = await listAuditEvents({ action: "project.rules_transition" });
  const existing = events.find((event) => event.requestId === input.operationId);
  if (!existing) return undefined;

  const payload = (existing.newValue ?? {}) as TransitionAuditPayload;
  if (
    payload.projectId !== input.projectId ||
    payload.rulesSnapshotId !== input.targetRulesSnapshotId ||
    payload.fingerprint !== fingerprint ||
    payload.fingerprintVersion !== REQUEST_FINGERPRINT_VERSION
  ) {
    return issue(
      "IDEMPOTENCY_CONFLICT",
      "operationId",
      "ключ идемпотентности уже использован с другими параметрами перехода",
      409,
    );
  }

  return {
    ok: true,
    project: null,
    previousRulesSnapshotId:
      typeof payload.previousRulesSnapshotId === "string"
        ? payload.previousRulesSnapshotId
        : null,
    rulesSnapshotId: input.targetRulesSnapshotId,
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : "",
    replay: true,
  };
}

/**
 * Выполняет переход проекта на целевой опубликованный снимок правил.
 * Возвращает контролируемую ошибку при любом нарушении preflight; проект,
 * аудит и история при ошибке не изменяются (replay ничего не пишет).
 */
export async function transitionProjectRulesSnapshot(
  input: ProjectRulesTransitionInput,
): Promise<ProjectRulesTransitionResult> {
  const projectId = input.projectId?.trim();
  const targetRulesSnapshotId = input.targetRulesSnapshotId?.trim();
  const expectedVersion = input.expectedVersion?.trim();
  const operationId = input.operationId?.trim();

  if (!projectId) return issue("PROJECT_ID_REQUIRED", "projectId", "projectId обязателен", 400);
  if (!targetRulesSnapshotId) {
    return issue(
      "RULES_SNAPSHOT_TARGET_REQUIRED",
      "targetRulesSnapshotId",
      "целевой rulesSnapshotId обязателен",
      400,
    );
  }
  if (!expectedVersion) {
    return issue(
      "PROJECT_VERSION_REQUIRED",
      "expectedVersion",
      "expectedVersion обязателен (updatedAt проекта)",
      400,
    );
  }
  if (!operationId) {
    return issue(
      "IDEMPOTENCY_KEY_REQUIRED",
      "operationId",
      "operationId обязателен",
      400,
    );
  }

  // Восстановление незавершённых операций до нового перехода (best-effort).
  try {
    await recoverPendingRulesTransitions();
  } catch {
    // Восстановление не должно блокировать новые операции; журнал сохранится.
  }

  const fingerprint = transitionFingerprint(projectId, targetRulesSnapshotId);
  const replay = await findAuditReplay(input, fingerprint);
  if (replay) return replay;

  const journalRead = await readCollectionStatus<TransitionJournalEntry>(JOURNAL);
  if (
    journalRead.status === "ok" &&
    journalRead.items.some((entry) => entry.requestId === operationId)
  ) {
    return issue(
      "PROJECT_TRANSITION_IN_PROGRESS",
      "operationId",
      "операция с этим operationId уже выполняется или не завершена",
      409,
    );
  }

  // Preflight 1: проект существует.
  const projectsRead = await readCollectionStatus<StoredProject>(PROJECTS);
  if (projectsRead.status === "corrupt") {
    return issue(
      "PROJECT_STORAGE_CORRUPT",
      "projectId",
      `Хранилище projects.json повреждено: ${projectsRead.reason}`,
      500,
    );
  }
  const project = projectsRead.status === "ok"
    ? projectsRead.items.find((item) => item.id === projectId)
    : undefined;
  if (!project) {
    return issue("PROJECT_NOT_FOUND", "projectId", `Проект "${projectId}" не найден`, 404);
  }

  // Preflight 2: optimistic locking до любых записей.
  if (project.updatedAt !== expectedVersion) {
    return issue(
      "PROJECT_VERSION_CONFLICT",
      "expectedVersion",
      `Конфликт версий проекта: ожидалась "${expectedVersion}", текущая "${project.updatedAt}"`,
      409,
    );
  }

  // Preflight 3–6: снимок существует, опубликован, валиден, без
  // draft/preliminary, ссылки разрешимы.
  const resolved = await resolveRulesSnapshotById(targetRulesSnapshotId);
  if (resolved.status !== "ok") {
    const code =
      resolved.status === "error" && resolved.code === "unknown"
        ? "RULES_SNAPSHOT_UNKNOWN"
        : "RULES_SNAPSHOT_CORRUPT";
    return issue(
      code,
      "targetRulesSnapshotId",
      resolved.status === "error"
        ? resolved.issues.join("; ")
        : "снимок не разрешён",
    );
  }
  const referenceIssues = await rulesSnapshotReferenceIssues(resolved.snapshot.rules);
  if (referenceIssues.length > 0) {
    return issue(
      "RULES_SNAPSHOT_REFERENCES_UNRESOLVED",
      "targetRulesSnapshotId",
      referenceIssues.join("; "),
    );
  }

  const previousRulesSnapshotId = project.rulesSnapshotId ?? null;

  // Повтор с тем же целевым снимком — согласованный no-op (Q7-11).
  if (previousRulesSnapshotId === targetRulesSnapshotId) {
    return {
      ok: true,
      project,
      previousRulesSnapshotId,
      rulesSnapshotId: targetRulesSnapshotId,
      updatedAt: project.updatedAt,
      replay: true,
    };
  }

  const journalEntry: TransitionJournalEntry = {
    requestId: operationId,
    projectId,
    expectedVersion,
    previousRulesSnapshotId,
    targetRulesSnapshotId,
    updatedAt: nextUpdatedAt(project.updatedAt),
    fingerprint,
    fingerprintVersion: REQUEST_FINGERPRINT_VERSION,
    actorId: input.actor.actorId,
    actorRole: input.actor.actorRole,
    createdAt: new Date().toISOString(),
  };

  // Журнал намерения: позволяет восстановить операцию после сбоя.
  await updateCollection<TransitionJournalEntry, void>(JOURNAL, (items) => {
    if (items.some((entry) => entry.requestId === operationId)) {
      throw new Error(`Операция "${operationId}" уже присутствует в журнале.`);
    }
    return { items: [...items, journalEntry], result: undefined };
  });

  let updatedProject: StoredProject | undefined;

  try {
    await updateCollection<StoredProject, void>(PROJECTS, (items) => {
      const current = items.find((item) => item.id === projectId);
      if (!current) {
        throw new TransitionPreflightError(
          "PROJECT_NOT_FOUND",
          `Проект "${projectId}" не найден (повторная проверка под замком)`,
          404,
        );
      }
      if (current.updatedAt !== expectedVersion) {
        throw new TransitionPreflightError(
          "PROJECT_VERSION_CONFLICT",
          `Конфликт версий проекта: ожидалась "${expectedVersion}", текущая "${current.updatedAt}"`,
          409,
        );
      }
      updatedProject = {
        ...current,
        rulesSnapshotId: targetRulesSnapshotId,
        updatedAt: journalEntry.updatedAt,
      };
      const next = updatedProject;
      return {
        items: items.map((item) => (item.id === projectId ? next : item)),
        result: undefined,
      };
    });
  } catch (error) {
    await removeJournalEntry(operationId).catch(() => undefined);
    if (error instanceof TransitionPreflightError) {
      return issue(error.code, "projectId", error.message, error.status);
    }
    throw error;
  }

  if (!updatedProject) {
    await removeJournalEntry(operationId).catch(() => undefined);
    return issue(
      "PROJECT_TRANSITION_FAILED",
      "projectId",
      "переход не применён: обновлённая запись не сформирована",
      500,
    );
  }

  try {
    await appendAuditEvent({
      action: "project.rules_transition",
      entityType: "project",
      entityId: projectId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      result: "ok",
      requestId: operationId,
      oldValue: {
        rulesSnapshotId: previousRulesSnapshotId,
        updatedAt: expectedVersion,
      },
      newValue: {
        projectId,
        rulesSnapshotId: targetRulesSnapshotId,
        previousRulesSnapshotId,
        expectedVersion,
        updatedAt: journalEntry.updatedAt,
        fingerprint,
        fingerprintVersion: REQUEST_FINGERPRINT_VERSION,
      },
    });
  } catch (error) {
    // Аудит не записан → откатываем закрепление, чтобы не оставить переход
    // без аудита. Если откат не удался, журнал остаётся для восстановления.
    const rolledBack = await rollbackTransition(journalEntry).catch(() => false);
    if (rolledBack) {
      await removeJournalEntry(operationId).catch(() => undefined);
    }
    throw error;
  }

  await removeJournalEntry(operationId).catch(() => undefined);

  return {
    ok: true,
    project: updatedProject,
    previousRulesSnapshotId,
    rulesSnapshotId: targetRulesSnapshotId,
    updatedAt: journalEntry.updatedAt,
    replay: false,
  };
}

async function rollbackTransition(entry: TransitionJournalEntry): Promise<boolean> {
  let rolledBack = false;
  await updateCollection<StoredProject, void>(PROJECTS, (items) => {
    const next = items.map((project) => {
      if (
        project.id !== entry.projectId ||
        project.rulesSnapshotId !== entry.targetRulesSnapshotId ||
        project.updatedAt !== entry.updatedAt
      ) {
        return project;
      }
      rolledBack = true;
      const restored: StoredProject = { ...project };
      delete restored.rulesSnapshotId;
      if (entry.previousRulesSnapshotId !== null) {
        restored.rulesSnapshotId = entry.previousRulesSnapshotId;
      }
      return { ...restored, updatedAt: entry.expectedVersion };
    });
    return { items: next, result: undefined };
  });
  return rolledBack;
}

class TransitionPreflightError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TransitionPreflightError";
  }
}
