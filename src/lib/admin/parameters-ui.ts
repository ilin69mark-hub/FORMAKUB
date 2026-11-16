import type { AdminParameter } from "./schema";

/**
 * CA-T-502 — чистые функции представления параметров.
 *
 * Только форматирование, разбор ввода формы и фильтрация списка. Правила
 * редактирования — `parameterEditability` в `parameters.ts`; серверная
 * валидация AdminParameter не заменяется клиентской.
 */

export const PARAMETER_STATUS_LABELS: Record<AdminParameter["status"], string> = {
  active: "active",
  readonly: "readonly",
  preliminary: "preliminary",
  pending_release: "pending_release",
  dead: "dead",
};

export const PARAMETER_STATUS_HINTS: Record<AdminParameter["status"], string> = {
  active: "Действует.",
  readonly:
    "Только просмотр: изменение значения запрещено до перевода в active (§7.5.1).",
  preliminary:
    "Не подтверждён инженерно. Подтверждение — отдельная процедура §7.6.4, вне CA-T-502.",
  pending_release:
    "Изменение принято, но не действует до выпуска новой calcVersion (PEND-01/§5.7).",
  dead: "Не влияет на расчёт; изменение невозможно (§6.1).",
};

export const PARAMETER_GROUP_LABELS: Record<AdminParameter["group"], string> = {
  "01": "01 — Геометрия и параметры",
  "02": "02 — Материалы и справочники",
  "03": "03 — Модули и комплектация",
  "04": "04 — Фурнитура и опоры",
  "05": "05 — Освещение",
  "06": "06 — Цены и коммерческие правила",
};

export const PARAMETER_SCOPE_LABELS: Record<AdminParameter["scope"], string> = {
  kitchen: "Кухня",
  wardrobe: "Шкаф",
  shared: "Общее",
};

export const PARAMETER_APPLIES_LABELS: Record<
  AdminParameter["appliesTo"],
  string
> = {
  new_projects: "Только новые проекты",
  all_read_paths: "Все пути чтения",
};

export const PARAMETER_STATUSES = [
  "active",
  "readonly",
  "preliminary",
  "pending_release",
  "dead",
] as const satisfies readonly AdminParameter["status"][];

export const PARAMETER_GROUPS = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
] as const satisfies readonly AdminParameter["group"][];

export const PARAMETER_SCOPES = [
  "kitchen",
  "wardrobe",
  "shared",
] as const satisfies readonly AdminParameter["scope"][];

export function formatParameterValue(parameter: AdminParameter): string {
  switch (parameter.valueType) {
    case "boolean":
      return parameter.value ? "да" : "нет";
    case "string[]":
      return parameter.value.length > 0 ? parameter.value.join(", ") : "—";
    case "string":
      return parameter.value.length > 0 ? parameter.value : "—";
    case "enum":
    case "int":
    case "decimal":
      return String(parameter.value);
  }
}

export function formatParameterRange(parameter: AdminParameter): string {
  if (parameter.valueType === "int" || parameter.valueType === "decimal") {
    return `${parameter.min} … ${parameter.max} ${parameter.unit === "none" ? "" : parameter.unit}`.trim();
  }
  if (parameter.valueType === "enum") {
    return parameter.enumValues.join(" / ");
  }
  return "—";
}

export class ParameterInputError extends Error {}

/**
 * Разбор поля формы в типизированное значение AdminParameter.
 *
 * Проверяет только соответствие типу (и вхождение в enumValues) — диапазон,
 * границы и остальные правила проверяет сервер (`adminParameterSchema`).
 */
export function parseParameterInput(
  parameter: AdminParameter,
  raw: string | null,
): unknown {
  switch (parameter.valueType) {
    case "int": {
      const text = (raw ?? "").trim();
      if (text === "") throw new ParameterInputError("Укажите целое значение.");
      const value = Number(text);
      if (!Number.isInteger(value)) {
        throw new ParameterInputError("Значение должно быть целым числом.");
      }
      return value;
    }
    case "decimal": {
      const text = (raw ?? "").trim();
      if (text === "") throw new ParameterInputError("Укажите числовое значение.");
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new ParameterInputError("Значение должно быть числом.");
      }
      return value;
    }
    case "boolean":
      return raw === "on" || raw === "true";
    case "string": {
      const value = raw ?? "";
      if (value.length > 500) {
        throw new ParameterInputError("Строка длиннее 500 символов.");
      }
      return value;
    }
    case "enum": {
      if (!raw || !parameter.enumValues.includes(raw)) {
        throw new ParameterInputError(
          "Значение должно входить в список допустимых.",
        );
      }
      return raw;
    }
    case "string[]":
      return (raw ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
  }
}

export interface ParameterFilter {
  q?: string;
  status?: AdminParameter["status"];
  group?: AdminParameter["group"];
  scope?: AdminParameter["scope"];
}

function optionalEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Разбор query-параметров: неизвестные значения игнорируются, не угадываются. */
export function parseParameterFilter(input: {
  q?: string;
  status?: string;
  group?: string;
  scope?: string;
}): ParameterFilter {
  const q = input.q?.trim();
  return {
    ...(q ? { q } : {}),
    status: optionalEnum(input.status, PARAMETER_STATUSES),
    group: optionalEnum(input.group, PARAMETER_GROUPS),
    scope: optionalEnum(input.scope, PARAMETER_SCOPES),
  };
}

/** Поиск по id/sourceRef (ТЗ §7.3); статус/группа/scope — точным совпадением. */
export function filterParameters(
  items: AdminParameter[],
  filter: ParameterFilter,
): AdminParameter[] {
  const needle = filter.q?.toLowerCase();
  return items.filter((item) => {
    if (filter.status !== undefined && item.status !== filter.status) {
      return false;
    }
    if (filter.group !== undefined && item.group !== filter.group) {
      return false;
    }
    if (filter.scope !== undefined && item.scope !== filter.scope) return false;
    if (
      needle &&
      !item.id.toLowerCase().includes(needle) &&
      !item.sourceRef.toLowerCase().includes(needle)
    ) {
      return false;
    }
    return true;
  });
}
