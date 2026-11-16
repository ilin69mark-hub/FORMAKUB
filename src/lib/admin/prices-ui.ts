import type { PricingDiffEntry } from "./pricing";
import type { PriceItem, PricingVersion } from "./schema";

/**
 * CA-T-504 — представление прайс-борда.
 *
 * Только фильтрация, форматирование и сводка diff. Расчёт diff выполняет
 * существующая функция `computePricingDiff` (CA-T-210); публикация живёт в
 * сервисе CA-T-211 и в этом UI не вызывается (CA-T-609/602).
 */

export const PRICE_UNIT_LABELS: Record<PriceItem["unit"], string> = {
  RUB: "₽",
  RUB_PER_SQM: "₽/м²",
  RUB_PER_M: "₽/м",
  RUB_PER_LINM: "₽/пог. м",
  RUB_PER_PCS: "₽/шт",
  FACTOR: "коэф.",
};

export const PRICE_SCOPE_LABELS: Record<PriceItem["scope"], string> = {
  kitchen: "Кухня",
  wardrobe: "Шкаф",
  shared: "Общее",
};

export const PRICE_STATUS_LABELS: Record<PriceItem["status"], string> = {
  active: "active",
  archived: "archived",
};

export const PRICE_USAGE_LABELS: Record<PriceItem["usage"], string> = {
  used: "читается движком",
  unused: "не читается",
};

export interface PriceItemFilter {
  q?: string;
  scope?: PriceItem["scope"];
  status?: PriceItem["status"];
  usage?: PriceItem["usage"];
}

function optionalEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function parsePriceItemFilter(input: {
  q?: string;
  scope?: string;
  status?: string;
  usage?: string;
}): PriceItemFilter {
  const q = input.q?.trim();
  return {
    ...(q ? { q } : {}),
    scope: optionalEnum(input.scope, ["kitchen", "wardrobe", "shared"]),
    status: optionalEnum(input.status, ["active", "archived"]),
    usage: optionalEnum(input.usage, ["used", "unused"]),
  };
}

export function filterPriceItems(
  items: PriceItem[],
  filter: PriceItemFilter,
): PriceItem[] {
  const needle = filter.q?.toLowerCase();
  return items.filter((item) => {
    if (filter.scope !== undefined && item.scope !== filter.scope) return false;
    if (filter.status !== undefined && item.status !== filter.status) return false;
    if (filter.usage !== undefined && item.usage !== filter.usage) return false;
    if (
      needle &&
      !item.id.toLowerCase().includes(needle) &&
      !item.label.toLowerCase().includes(needle) &&
      !item.sourceRef.toLowerCase().includes(needle)
    ) {
      return false;
    }
    return true;
  });
}

/** Ставка из снимка версии; отсутствие — явный `undefined`, не 0. */
export function amountInVersion(
  version: PricingVersion,
  priceItemId: string,
): number | undefined {
  return version.snapshot.find((entry) => entry.priceItemId === priceItemId)?.amount;
}

export interface DiffSummary {
  total: number;
  priceItems: number;
  rules: number;
  promos: number;
  metadata: number;
  changedPriceItemKeys: string[];
}

export function summarizeDiff(changes: PricingDiffEntry[]): DiffSummary {
  const priceItemKeys = new Set<string>();
  for (const change of changes) {
    if (change.targetType === "priceItem") priceItemKeys.add(change.targetKey);
  }
  return {
    total: changes.length,
    priceItems: changes.filter((c) => c.targetType === "priceItem").length,
    rules: changes.filter((c) => c.targetType === "rule").length,
    promos: changes.filter((c) => c.targetType === "promo").length,
    metadata: changes.filter((c) => c.targetType === "metadata").length,
    changedPriceItemKeys: [...priceItemKeys].sort(),
  };
}

export function formatDiffValue(value: unknown): string {
  if (value === null) return "—";
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function formatPriceAmount(
  item: PriceItem,
  amount: number | undefined,
): string {
  if (amount === undefined) return "нет в версии";
  return `${amount.toLocaleString("ru-RU")} ${PRICE_UNIT_LABELS[item.unit]}`;
}

/**
 * UI-RBAC: какие действия с ценами доступны текущему пользователю.
 *
 * Единственный источник истины — существующие permissions сессии
 * (`price.write`, `price.publish`); новых ролей и permissions не вводится.
 * Серверная защита остаётся неизменной (403 на API).
 */
export function priceCapabilities(
  permissions: readonly string[],
): { canWrite: boolean; canPublish: boolean } {
  return {
    canWrite: permissions.includes("price.write"),
    canPublish: permissions.includes("price.publish"),
  };
}
