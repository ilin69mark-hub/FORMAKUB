import { appendAuditEvent, listAuditEvents, type AdminAuditEvent } from "@/lib/server/audit";
import { readCollection, updateCollection } from "@/lib/server/store";

import { adminParameterSchema, type AdminParameter } from "./schema";

/**
 * Сервис AdminParameter (CA-T-203).
 *
 * Правила: дизайн §7.5 (PATCH, expectedVersion, инкремент version, аудит),
 * §7.4/§7.6, R-04 (геометрия не редактируется), R-08/PEND-01
 * (`pending_release`), §6.1 (жизненный цикл, без удаления). Хранение —
 * Storage Adapter (`withLock` через `updateCollection`, один инстанс);
 * аудит — существующий `appendAuditEvent`.
 *
 * Границы: нет HTTP; preliminary-подтверждение (§7.6.4) и активация
 * `pending_release` выпуском `calcVersion` — отдельные режимы, в CA-T-203
 * не реализуются (отклоняются).
 */

const COLLECTION = "admin-parameters.json";

/** Явный контекст вызывающей стороны: актёр не выдумывается сервисом. */
export interface ActorContext {
  actorId: string;
  actorRole: string;
}

function notFound(id: string): Error {
  return new Error(`Параметр "${id}" не найден.`);
}

function versionConflict(id: string, expected: string, actual: string): Error {
  return new Error(
    `Конфликт версии параметра "${id}": ожидалась "${expected}", фактически "${actual}".`,
  );
}

/** §7.5.3: каждое изменение инкрементирует `version` (числовая строка). */
function nextVersion(current: string): string {
  if (!/^\d+$/.test(current)) {
    throw new Error(
      `Не удалось инкрементировать version="${current}": формат не поддерживается (§7.5.3).`,
    );
  }
  return String(Number(current) + 1);
}

/**
 * R-04 + §7.4: редактирование геометрии запрещено — на КАЖДОМ пути
 * изменения (значение и статус), без обхода через смену статуса.
 * Признаки: `category=geometric` либо `affects.geometry=true`.
 */
function assertGeometryEditable(parameter: AdminParameter, operation: string): void {
  if (parameter.category === "geometric") {
    throw new Error(
      `Редактирование геометрического параметра "${parameter.id}" запрещено (${operation}; R-04/§7.5).`,
    );
  }
  if (parameter.affects.geometry) {
    throw new Error(
      `Параметр "${parameter.id}" влияет на геометрию — редактирование запрещено (${operation}; §7.4, R-04).`,
    );
  }
}

/** §7.5.1: правка только при editableInAdmin=true (иначе — §7.6.3). */
function assertEditableInAdmin(parameter: AdminParameter, operation: string): void {
  if (parameter.editableInAdmin !== true) {
    throw new Error(
      `Параметр "${parameter.id}" не редактируется в панели: editableInAdmin=false (${operation}; §7.5.1).`,
    );
  }
}

/**
 * R-08/§7.5.4: параметр «читается движком» для целей `pending_release` —
 * `affects.price=true` при `appliesTo=all_read_paths`: изменение принимается,
 * но не вступает в силу до выпуска новой `calcVersion`.
 * (Для `affects.validation` классификация в §7.5/§7.7 не определена —
 * см. открытые вопросы к задаче.)
 */
function requiresPendingRelease(parameter: AdminParameter): boolean {
  return parameter.affects.price && parameter.appliesTo === "all_read_paths";
}

/**
 * CA-T-502 — причина доступности правки для интерфейса.
 *
 * Единственный источник правил — предикаты этого сервиса; UI использует
 * результат только для отображения, серверные запреты продолжают
 * действовать на каждом пути изменения.
 */
export type ParameterEditability =
  | { editable: true; willRequireRelease: boolean }
  | {
      editable: false;
      reason: "geometry" | "notEditableInAdmin" | "status";
      status: AdminParameter["status"];
      message: string;
    };

const STATUS_EDIT_BLOCK: Record<
  Exclude<AdminParameter["status"], "active">,
  string
> = {
  readonly:
    "Статус readonly: изменение значения запрещено; перевод в active — отдельная операция (§7.5.1).",
  preliminary:
    "Статус preliminary: данные не подтверждены инженерно; изменение — только через процедуру подтверждения (§7.6.4), вне CA-T-502.",
  pending_release:
    "Статус pending_release: изменение уже принято и не действует до выпуска новой calcVersion (PEND-01/§5.7).",
  dead: "Статус dead: параметр не влияет на расчёт и не редактируется (§6.1).",
};

export function parameterEditability(
  parameter: AdminParameter,
): ParameterEditability {
  if (parameter.category === "geometric") {
    return {
      editable: false,
      reason: "geometry",
      status: parameter.status,
      message:
        "Геометрический параметр: редактирование запрещено (R-04/§7.5, ADR-04/OI-063).",
    };
  }
  if (parameter.affects.geometry) {
    return {
      editable: false,
      reason: "geometry",
      status: parameter.status,
      message:
        "Параметр влияет на геометрию: редактирование запрещено (§7.4, R-04).",
    };
  }
  if (parameter.editableInAdmin !== true) {
    return {
      editable: false,
      reason: "notEditableInAdmin",
      status: parameter.status,
      message:
        "Параметр не редактируется в панели: editableInAdmin=false (§7.5.1/§7.6.3).",
    };
  }
  if (parameter.status !== "active") {
    return {
      editable: false,
      reason: "status",
      status: parameter.status,
      message: STATUS_EDIT_BLOCK[parameter.status],
    };
  }
  return {
    editable: true,
    willRequireRelease: requiresPendingRelease(parameter),
  };
}

async function appendEvent(
  parameter: AdminParameter,
  input: {
    action: "param.create" | "param.update";
    oldValue?: unknown;
    newValue?: unknown;
    paramVersion?: string;
  },
  actor: ActorContext,
): Promise<void> {
  await appendAuditEvent({
    action: input.action,
    entityType: "parameter",
    entityId: parameter.id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    ...(input.oldValue !== undefined ? { oldValue: input.oldValue } : {}),
    ...(input.newValue !== undefined ? { newValue: input.newValue } : {}),
    ...(input.paramVersion !== undefined
      ? { paramVersion: input.paramVersion }
      : {}),
  });
}

/**
 * Создание параметра (§6.1: только через Administrative API / импорт).
 * Служебные поля штампуются сервисом: `version` = schemaVersion контента
 * (§6.1), `updatedAt`/`updatedBy` — по контексту актёра.
 */
export async function createParameter(
  input: Record<string, unknown>,
  actor: ActorContext,
): Promise<AdminParameter> {
  const candidate = {
    ...input,
    version: "1",
    updatedAt: new Date().toISOString(),
    updatedBy: actor.actorId,
  };
  const parameter = adminParameterSchema.parse(candidate);

  const stored = await updateCollection<AdminParameter, AdminParameter>(
    COLLECTION,
    (items) => {
      if (items.some((item) => item.id === parameter.id)) {
        throw new Error(`Параметр "${parameter.id}" уже существует.`);
      }
      return { items: [...items, parameter], result: parameter };
    },
  );

  // Аудит после записи; при ошибке журналирования ошибка пробрасывается
  // вызывающему без компенсации (правила не определены; атомарности нет).
  await appendEvent(stored, { action: "param.create" }, actor);
  return stored;
}

/** Чтение одного параметра (без блокировки — read-path). */
export async function getParameter(
  id: string,
): Promise<AdminParameter | undefined> {
  const items = await readCollection<AdminParameter>(COLLECTION);
  return items.find((item) => item.id === id);
}

/** Список параметров; фильтры ТЗ §8 (`group`, `status`). */
export async function listParameters(filter: {
  group?: string;
  status?: AdminParameter["status"];
}): Promise<AdminParameter[]> {
  const items = await readCollection<AdminParameter>(COLLECTION);
  return items.filter((item) => {
    if (filter.group !== undefined && item.group !== filter.group) return false;
    if (filter.status !== undefined && item.status !== filter.status) {
      return false;
    }
    return true;
  });
}

export interface UpdateValuePatch {
  value: unknown;
  expectedVersion: string;
}

/**
 * PATCH значения (ТЗ §8, §7.5): editableInAdmin, status=active,
 * expectedVersion (optimistic locking), инкремент version, валидация
 * полной записи схемой (границы §7.5.2), `pending_release` для параметров,
 * читаемых движком (R-08).
 */
export async function updateParameterValue(
  id: string,
  patch: UpdateValuePatch,
  actor: ActorContext,
): Promise<AdminParameter> {
  let previousValue: unknown;

  const updated = await updateCollection<AdminParameter, AdminParameter>(
    COLLECTION,
    (items) => {
      const current = items.find((item) => item.id === id);
      if (!current) throw notFound(id);

      assertGeometryEditable(current, "updateParameterValue");
      assertEditableInAdmin(current, "updateParameterValue");
      if (current.status !== "active") {
        throw new Error(
          `PATCH значения доступен только при status=active (§7.5.1); текущий статус "${current.status}" у параметра "${id}".`,
        );
      }
      if (current.version !== patch.expectedVersion) {
        throw versionConflict(id, patch.expectedVersion, current.version);
      }

      previousValue = current.value;
      const candidate = {
        ...current,
        value: patch.value as typeof current.value,
        version: nextVersion(current.version),
        updatedAt: new Date().toISOString(),
        updatedBy: actor.actorId,
        ...(requiresPendingRelease(current)
          ? { status: "pending_release" as const }
          : {}),
      };
      // §7.5.2: тип/диапазон/границы схемы — на обновлённой записи.
      const validated = adminParameterSchema.parse(candidate);
      return {
        items: items.map((item) => (item.id === id ? validated : item)),
        result: validated,
      };
    },
  );

  await appendEvent(
    updated,
    {
      action: "param.update",
      oldValue: previousValue,
      newValue: updated.value,
      paramVersion: updated.version,
    },
    actor,
  );
  return updated;
}

export type StatusTransition = "active" | "readonly" | "dead";

export interface UpdateStatusPatch {
  status: StatusTransition;
  expectedVersion: string;
}

/**
 * Смена статуса (§6.1 жизненный цикл, §7.5.1):
 * `active ⇄ readonly`, `active → dead`. Источники `preliminary`,
 * `pending_release`, `dead` — отклоняются (подтверждение §7.6.4 и
 * активация релизом `calcVersion` — вне CA-T-203). Геометрия и
 * `editableInAdmin=false` — запрещены теми же проверками, что и PATCH
 * значения (без обхода через статус).
 */
export async function updateParameterStatus(
  id: string,
  patch: UpdateStatusPatch,
  actor: ActorContext,
): Promise<AdminParameter> {
  const allowed: Record<string, StatusTransition[]> = {
    active: ["readonly", "dead"],
    readonly: ["active"],
  };

  let previousValue: unknown;

  const updated = await updateCollection<AdminParameter, AdminParameter>(
    COLLECTION,
    (items) => {
      const current = items.find((item) => item.id === id);
      if (!current) throw notFound(id);

      assertGeometryEditable(current, "updateParameterStatus");
      assertEditableInAdmin(current, "updateParameterStatus");
      if (current.version !== patch.expectedVersion) {
        throw versionConflict(id, patch.expectedVersion, current.version);
      }
      const targets = allowed[current.status] ?? [];
      if (!targets.includes(patch.status)) {
        throw new Error(
          `Переход статуса "${current.status}" → "${patch.status}" не разрешён (§6.1/§7.5.1); параметр "${id}".`,
        );
      }

      previousValue = current.value;
      const candidate = {
        ...current,
        status: patch.status,
        version: nextVersion(current.version),
        updatedAt: new Date().toISOString(),
        updatedBy: actor.actorId,
      };
      const validated = adminParameterSchema.parse(candidate);
      return {
        items: items.map((item) => (item.id === id ? validated : item)),
        result: validated,
      };
    },
  );

  await appendEvent(
    updated,
    {
      action: "param.update",
      // Значение не менялось: снимки до/после равны (§7.5.3 — каждое
      // изменение фиксируется журналом).
      oldValue: previousValue,
      newValue: updated.value,
      paramVersion: updated.version,
    },
    actor,
  );
  return updated;
}

/** История изменений параметра (ТЗ §8: `GET .../history`). */
export async function listParameterHistory(
  id: string,
): Promise<AdminAuditEvent[]> {
  return listAuditEvents({ entityType: "parameter", entityId: id });
}
