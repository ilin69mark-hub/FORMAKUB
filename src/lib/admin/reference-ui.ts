import type { CatalogItem, ModulePreset } from "./schema";

/**
 * CA-T-503 — чистые функции представления справочников и пресетов.
 *
 * Форматирование, фильтры и доступность архивирования для UI. Правила
 * жизненного цикла и валидация остаются в сервисах CA-T-204/CA-T-205:
 * результат здесь используется только для отображения, серверные запреты
 * действуют на каждом пути изменения.
 */

/** Человеческие названия видов справочников (ТЗ §2.2, разделы 02/04/05). */
export const CATALOG_KIND_LABELS: Record<CatalogItem["catalog"], string> = {
  bodyMaterial: "Материалы корпуса",
  facadeMaterial: "Материалы фасадов",
  facadeStyle: "Стили фасадов",
  handle: "Ручки",
  countertop: "Столешницы",
  plinthMaterial: "Материалы цоколя",
  plinthFinish: "Исполнения цоколя",
  plinthMount: "Крепление цоколя",
  supportSystem: "Системы опор",
  ledStrip: "Светодиодные ленты",
  ledProfile: "Профили",
  ledDiffuser: "Рассеиватели",
  ledControl: "Управление",
  ledPsu: "Блоки питания",
  sinkSize: "Раковины",
  promo: "Промокоды",
};

export const CATALOG_STATUSES = [
  "active",
  "archived",
  "preliminary",
] as const satisfies readonly CatalogItem["status"][];

export const CATALOG_STATUS_LABELS: Record<CatalogItem["status"], string> = {
  active: "active",
  archived: "archived",
  preliminary: "preliminary",
};

export const CATALOG_STATUS_HINTS: Record<CatalogItem["status"], string> = {
  active: "Активная запись справочника.",
  archived:
    "В архиве: исключена из новых версий, удаление запрещено (§6.2, OI-046).",
  preliminary: "Не подтверждённые данные (требование 5.10).",
};

export const PRESET_STATUSES = ["active", "archived"] as const satisfies readonly ModulePreset["status"][];

export const PRESET_STATUS_LABELS: Record<ModulePreset["status"], string> = {
  active: "active",
  archived: "archived",
};

export const PRESET_STATUS_HINTS: Record<ModulePreset["status"], string> = {
  active: "Активный пресет: применяется при создании модулей.",
  archived:
    "В архиве: в новые проекты не попадает, удаление запрещено (§6.3); существующие проекты не затрагиваются.",
};

export const PRESET_FAMILIES = ["kitchen", "wardrobe"] as const satisfies readonly ModulePreset["family"][];

export const PRESET_FAMILY_LABELS: Record<ModulePreset["family"], string> = {
  kitchen: "Кухня",
  wardrobe: "Шкаф",
};

// ─── Каталоги (CA-T-204) ────────────────────────────────────────────────

export interface CatalogFilter {
  status?: CatalogItem["status"];
  q?: string;
}

function optionalEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function parseCatalogFilter(input: {
  status?: string;
  q?: string;
}): CatalogFilter {
  const q = input.q?.trim();
  return {
    status: optionalEnum(input.status, CATALOG_STATUSES),
    ...(q ? { q } : {}),
  };
}

export function filterCatalogItems(
  items: CatalogItem[],
  filter: CatalogFilter,
): CatalogItem[] {
  const needle = filter.q?.toLowerCase();
  return items.filter((item) => {
    if (filter.status !== undefined && item.status !== filter.status) {
      return false;
    }
    if (
      needle &&
      !item.id.toLowerCase().includes(needle) &&
      !item.label.toLowerCase().includes(needle)
    ) {
      return false;
    }
    return true;
  });
}

export function formatCatalogAttrs(item: CatalogItem): string {
  const entries = Object.entries(item.attrs);
  if (entries.length === 0) return "—";
  return entries
    .map(([key, value]) => `${key}: ${formatAttrValue(value)}`)
    .join("\n");
}

function formatAttrValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((entry) => typeof entry === "string")) {
      return value.join(", ");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export type ArchiveAvailability =
  | { canArchive: true }
  | { canArchive: false; reason: string };

/** Доступность архивирования: только status=active (сервер проверяет тоже). */
export function catalogArchiveAvailability(
  item: CatalogItem,
): ArchiveAvailability {
  if (item.status === "active") return { canArchive: true };
  if (item.status === "archived") {
    return {
      canArchive: false,
      reason: "Элемент уже в архиве; повторное архивирование отклоняется (§6.2).",
    };
  }
  return {
    canArchive: false,
    reason:
      "Архивирование доступно только из status=active (§6.2); preliminary-записи проходят отдельную процедуру подтверждения.",
  };
}

// ─── Пресеты (CA-T-205) ─────────────────────────────────────────────────

export interface PresetFilter {
  family?: ModulePreset["family"];
  status?: ModulePreset["status"];
  q?: string;
}

export function parsePresetFilter(input: {
  family?: string;
  status?: string;
  q?: string;
}): PresetFilter {
  const q = input.q?.trim();
  return {
    family: optionalEnum(input.family, PRESET_FAMILIES),
    status: optionalEnum(input.status, PRESET_STATUSES),
    ...(q ? { q } : {}),
  };
}

export function filterModulePresets(
  items: ModulePreset[],
  filter: PresetFilter,
): ModulePreset[] {
  const needle = filter.q?.toLowerCase();
  return items.filter((item) => {
    if (filter.family !== undefined && item.family !== filter.family) {
      return false;
    }
    if (filter.status !== undefined && item.status !== filter.status) {
      return false;
    }
    if (needle && !item.id.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export function presetArchiveAvailability(
  preset: ModulePreset,
): ArchiveAvailability {
  if (preset.status === "active") return { canArchive: true };
  if (preset.status === "archived") {
    return {
      canArchive: false,
      reason: "Пресет уже в архиве; повторное архивирование отклоняется (§6.3).",
    };
  }
  return {
    canArchive: false,
    reason: "Архивирование доступно только из status=active (§6.3).",
  };
}

export function formatDimension(dimension: {
  min: number;
  max: number;
  default: number;
}): string {
  return `${dimension.min} … ${dimension.max} (по умолчанию ${dimension.default})`;
}
