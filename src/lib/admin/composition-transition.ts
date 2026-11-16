import { readCollectionStatus, updateCollection } from "@/lib/server/store";
import { appendAuditEvent, listAuditEvents } from "@/lib/server/audit";
import type { StoredProject } from "@/lib/configurator/types";

import { getCompositionVersion } from "./composition";
import type { ActorContext } from "./parameters";
import {
  beginCompositionTransition,
  recoverCompositionTransitions,
  updateCompositionTransition,
} from "./composition-transition-journal";

/**
 * Явное закрепление опубликованного состава за проектом.
 *
 * Journal + recovery, optimistic locking по updatedAt, audit. Пересчёт не
 * запускается, сохранённая цена/конфигурация не меняются.
 */

export interface CompositionTransitionInput {
  projectId: string;
  compositionVersionId: string;
  expectedUpdatedAt: string;
  operationId: string;
  actor: ActorContext;
}

export type CompositionTransitionResult =
  | { ok: true; project: StoredProject; replay: boolean }
  | { ok: false; status: 404 | 409 | 422 | 500; code: string; message: string };

function fail(
  status: 404 | 409 | 422 | 500,
  code: string,
  message: string,
): CompositionTransitionResult {
  return { ok: false, status, code, message };
}

export async function transitionProjectComposition(
  input: CompositionTransitionInput,
): Promise<CompositionTransitionResult> {
  await recoverCompositionTransitions();
  const operationId = input.operationId.trim();
  if (!operationId) {
    return fail(422, "OPERATION_ID_REQUIRED", "operationId обязателен.");
  }

  const target = await getCompositionVersion(input.compositionVersionId);
  if (!target) {
    return fail(404, "COMPOSITION_NOT_FOUND", `Версия состава "${input.compositionVersionId}" не найдена.`);
  }
  if (target.status !== "published") {
    return fail(409, "COMPOSITION_NOT_PUBLISHED", `Версия состава "${target.id}" не опубликована.`);
  }

  const events = await listAuditEvents({
    action: "project.composition_transition",
  });
  const replayEvent = events.find((event) => event.requestId === operationId);
  if (replayEvent) {
    const read = await readCollectionStatus<StoredProject>("projects.json");
    const project =
      read.status === "ok"
        ? read.items.find((item) => item.id === input.projectId)
        : undefined;
    if (project && project.compositionVersionId === target.id) {
      return { ok: true, project, replay: true };
    }
    return fail(
      409,
      "OPERATION_ID_CONFLICT",
      `operationId "${operationId}" уже использован с другим результатом.`,
    );
  }

  const preRead = await readCollectionStatus<StoredProject>("projects.json");
  if (preRead.status === "corrupt") {
    return fail(409, "PROJECTS_CORRUPT", `projects.json повреждён: ${preRead.reason}`);
  }
  const current =
    preRead.status === "ok"
      ? preRead.items.find((item) => item.id === input.projectId)
      : undefined;
  if (!current) {
    return fail(404, "PROJECT_NOT_FOUND", `Проект "${input.projectId}" не найден.`);
  }
  if (current.config.kind !== "kitchen") {
    return fail(422, "COMPOSITION_NOT_APPLICABLE", "Состав модулей применим только к кухонной конфигурации.");
  }
  if (current.updatedAt !== input.expectedUpdatedAt) {
    return fail(
      409,
      "PROJECT_VERSION_CONFLICT",
      `Конфликт версии проекта: ожидался updatedAt "${input.expectedUpdatedAt}", текущий "${current.updatedAt}".`,
    );
  }
  if (target.rulesSnapshotId && current.rulesSnapshotId !== target.rulesSnapshotId) {
    return fail(
      409,
      "COMPOSITION_RULES_SNAPSHOT_MISMATCH",
      `Composition использует RulesSnapshot "${target.rulesSnapshotId}", проект — "${current.rulesSnapshotId ?? "нет"}".`,
    );
  }
  if (current.compositionVersionId === target.id) {
    return { ok: true, project: current, replay: true };
  }

  const begun = await beginCompositionTransition({
    operationId,
    projectId: input.projectId,
    targetVersionId: target.id,
    expectedUpdatedAt: input.expectedUpdatedAt,
    previousCompositionVersionId: current.compositionVersionId ?? null,
  });
  if (!begun.created) {
    const read = await readCollectionStatus<StoredProject>("projects.json");
    const project =
      read.status === "ok"
        ? read.items.find((item) => item.id === input.projectId)
        : undefined;
    if (project?.compositionVersionId === target.id) {
      return { ok: true, project, replay: true };
    }
    return fail(409, "OPERATION_ID_CONFLICT", `operationId "${operationId}" уже использован.`);
  }

  let updated!: StoredProject;
  try {
    await updateCollection<StoredProject, void>("projects.json", (items) => {
      const index = items.findIndex((item) => item.id === input.projectId);
      if (index < 0) throw new Error(`Проект "${input.projectId}" не найден.`);
      const stored = items[index]!;
      if (stored.updatedAt !== input.expectedUpdatedAt) {
        throw new Error(
          `Конфликт версии проекта: ожидался updatedAt "${input.expectedUpdatedAt}", текущий "${stored.updatedAt}".`,
        );
      }
      if (stored.config.kind !== "kitchen") {
        throw new Error("Состав модулей применим только к кухонной конфигурации.");
      }
      if (target.rulesSnapshotId && stored.rulesSnapshotId !== target.rulesSnapshotId) {
        throw new Error(
          `Composition использует RulesSnapshot "${target.rulesSnapshotId}", проект — "${stored.rulesSnapshotId ?? "нет"}".`,
        );
      }
      updated = {
        ...stored,
        compositionVersionId: target.id,
        updatedAt: new Date().toISOString(),
      };
      const next = [...items];
      next[index] = updated;
      return { items: next, result: undefined };
    });
  } catch (error) {
    await updateCompositionTransition(operationId, {
      phase: "aborted",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    return fail(
      409,
      "COMPOSITION_TRANSITION_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }

  await updateCompositionTransition(operationId, {
    phase: "project_updated",
  });

  try {
    const event = await appendAuditEvent({
      action: "project.composition_transition",
      entityType: "project",
      entityId: input.projectId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      result: "ok",
      requestId: operationId,
      oldValue: { compositionVersionId: current.compositionVersionId ?? null },
      newValue: { compositionVersionId: target.id },
    });
    await updateCompositionTransition(operationId, {
      phase: "completed",
      auditEventId: event.id,
    });
  } catch (error) {
    await updateCompositionTransition(operationId, {
      phase: "audit_pending",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    return fail(
      500,
      "COMPOSITION_AUDIT_PENDING",
      error instanceof Error ? error.message : String(error),
    );
  }

  return { ok: true, project: updated, replay: false };
}
