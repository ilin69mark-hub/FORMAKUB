import {
  getParameter,
  parameterEditability,
  updateParameterValue,
  type ActorContext,
} from "./parameters";
import type { AdminParameter } from "./schema";
import { parseParameterInput, ParameterInputError } from "./parameters-ui";

/**
 * CA-T-502 — применение правки значения из формы панели.
 *
 * Тонкая обвязка над существующим сервисом CA-T-203: проверка доступности
 * (тот же `parameterEditability`, что и в UI), разбор типа и вызов
 * `updateParameterValue` с optimistic locking. Новых бизнес-правил нет;
 * серверные запреты и валидация остаются обязательными.
 */

export interface ParameterEditRequest {
  id: string;
  expectedVersion: string;
  rawValue: string | null;
  actor: ActorContext;
}

export type ParameterEditResult =
  | { ok: true; parameter: AdminParameter; message: string }
  | { ok: false; message: string };

function asMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

export async function applyParameterValueEdit(
  request: ParameterEditRequest,
): Promise<ParameterEditResult> {
  const current = await getParameter(request.id);
  if (!current) {
    return { ok: false, message: `Параметр "${request.id}" не найден.` };
  }

  const editability = parameterEditability(current);
  if (!editability.editable) {
    return { ok: false, message: editability.message };
  }

  let value: unknown;
  try {
    value = parseParameterInput(current, request.rawValue);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ParameterInputError
          ? error.message
          : "Не удалось разобрать значение.",
    };
  }

  try {
    const updated = await updateParameterValue(
      request.id,
      { value, expectedVersion: request.expectedVersion },
      request.actor,
    );
    const message =
      updated.status === "pending_release"
        ? `Принято: version ${updated.version}, статус pending_release — изменение не действует до выпуска новой calcVersion.`
        : `Сохранено: version ${updated.version}, статус ${updated.status}.`;
    return { ok: true, parameter: updated, message };
  } catch (error) {
    return {
      ok: false,
      message: asMessage(error, "Не удалось сохранить параметр."),
    };
  }
}
