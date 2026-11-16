import { randomBytes } from "node:crypto";

import { readCollection } from "@/lib/server/store";
import { MAP_ROWS } from "./dependency-map";
import { checkPresetPriceRefs } from "./price-items";

import {
  priceItemSchema,
  pricingVersionSchema,
  promoDefinitionSchema,
  type PriceItem,
  type PricingVersion,
} from "./schema";

/**
 * CA-T-209 — Draft + diff (дизайн §6.5, §6.6, §8.2, §8.7).
 *
 * Модуль **read-only**: управление чтением draft/версий и вычисление diff
 * между draft и актуальной опубликованной версией. Записи `PricingChange`
 * в этом модуле НЕ создаются — по §6.6/§8.1 они создаются автоматически
 * при публикации (CA-T-211, вне scope).
 *
 * Ограничения модели:
 *  - draft ≤ 1 (§8.2): несколько draft → отказ, без молчаливой подмены;
 *  - `published` — единственная активная версия (§8.4.2): несколько →
 *    отказ (диагностика, не маскировка);
 *  - чтение — только через Storage Adapter (`readCollection`); битый файл
 *    → исключение пробрасывается (I-09), ничего не записывается;
 *  - операции не создают audit-событий (только чтение и сравнение).
 *
 * Diff (формат по §6.6): `targetType ∈ {priceItem, rule, promo, metadata}`,
 * `targetKey` — стабильный идентификатор (`PriceItem.id` / имя правила /
 * `code` промокода / имя метаданных `label|disclaimer|notes`), `field` —
 * изменившееся поле, `oldValue`/`newValue` — до/после; `null` — отсутствие
 * (добавление/удаление). Сопоставление — строго по идентификаторам, не по
 * позициям массива и не по совпадению сумм (R-15); порядок элементов
 * снимка не значим. В сравнение входят только данные контракта версии
 * (§6.5/§8.7): snapshot (`amount`), rules, promos, metadata
 * (`label/disclaimer/notes`).
 */

const VERSIONS = "pricing-versions.json";

/** Поля промокода для сравнения (промо `code` — это `targetKey`). */
const PROMO_FIELDS = [
  "title",
  "description",
  "type",
  "value",
  "minSubtotal",
  "maxDiscount",
  "appliesTo",
  "active",
  "demo",
] as const;

/** Метаданные версии для сравнения (§6.6: label, disclaimer, notes). */
const METADATA_FIELDS = ["label", "disclaimer", "notes"] as const;

// ─── Контракт diff ───

export interface PricingDiffEntry {
  targetType: "priceItem" | "rule" | "promo" | "metadata";
  targetKey: string;
  field: string;
  /** Значение в published (база); `null` — отсутствовало (добавление). */
  oldValue: unknown;
  /** Значение в draft; `null` — отсутствовало (удаление, §6.6). */
  newValue: unknown;
}

export interface PricingDiff {
  /** Актуальная опубликованная версия (§8.4.2) — база сравнения. */
  fromVersionId: string;
  /** Draft-версия (§8.2) — сравниваемая сторона. */
  toVersionId: string;
  /** Упорядоченный по (targetType, targetKey, field) перечень изменений. */
  changes: PricingDiffEntry[];
}

/**
 * Результат сравнения: отсутствие draft/опубликованной версии — явные
 * статусы, не скрытие данных.
 */
export type DraftDiffResult =
  | { status: "ok"; diff: PricingDiff }
  | { status: "no_draft" }
  | { status: "no_published" };

// ─── Чтение версий ───

async function readVersions(): Promise<PricingVersion[]> {
  return readCollection<PricingVersion>(VERSIONS);
}

/** Все версии прайса (без изменений). */
export async function listVersions(): Promise<PricingVersion[]> {
  return readVersions();
}

/** Версия по id; отсутствует → `undefined` (без создания). */
export async function getVersion(id: string): Promise<PricingVersion | undefined> {
  const versions = await readVersions();
  return versions.find((version) => version.id === id);
}

/**
 * Текущий draft (§8.2: ровно одна draft-версия). Отсутствует →
 * `undefined` (создание — CA-T-208/будущие операции, не здесь); несколько
 * → отказ: подмена одного draft другим запрещена.
 */
export async function getDraftVersion(): Promise<PricingVersion | undefined> {
  const drafts = (await readVersions()).filter(
    (version) => version.status === "draft",
  );
  if (drafts.length > 1) {
    throw new Error(
      `Нарушение §8.2: обнаружено ${drafts.length} draft-версий (${drafts
        .map((version) => version.id)
        .join(", ")}) — допускается не более одной; выбор одной из них подменял бы draft.`,
    );
  }
  return drafts[0];
}

/**
 * Актуальная опубликованная версия (§8.4.2: единственная `published`).
 * Отсутствует → `undefined`; несколько → отказ (бизнес-ограничение
 * единственности нарушено — не маскируется).
 */
export async function getPublishedVersion(): Promise<PricingVersion | undefined> {
  const published = (await readVersions()).filter(
    (version) => version.status === "published",
  );
  if (published.length > 1) {
    throw new Error(
      `Нарушение §8.4.2: обнаружено ${published.length} опубликованных версий (${published
        .map((version) => version.id)
        .join(", ")}) — активной может быть только одна.`,
    );
  }
  return published[0];
}

// ─── Diff ───

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sortedEntries(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Snapshot → map по `priceItemId`; дубли (нарушение §8.3) → отказ. */
function amountMap(
  version: PricingVersion,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of version.snapshot) {
    if (map.has(entry.priceItemId)) {
      throw new Error(
        `Снимок версии "${version.id}": дубликат priceItemId "${entry.priceItemId}" — по §8.3/§6.5 ставка присутствует ровно один раз; сравнение неоднозначно.`,
      );
    }
    map.set(entry.priceItemId, entry.amount);
  }
  return map;
}

function diffSnapshot(
  published: PricingVersion,
  draft: PricingVersion,
): PricingDiffEntry[] {
  const from = amountMap(published);
  const to = amountMap(draft);
  const changes: PricingDiffEntry[] = [];

  for (const [id, amount] of sortedEntries(to)) {
    if (!from.has(id)) {
      changes.push({
        targetType: "priceItem",
        targetKey: id,
        field: "amount",
        oldValue: null,
        newValue: amount,
      });
    } else if (from.get(id) !== amount) {
      changes.push({
        targetType: "priceItem",
        targetKey: id,
        field: "amount",
        oldValue: from.get(id) ?? null,
        newValue: amount,
      });
    }
  }
  for (const [id, amount] of sortedEntries(from)) {
    if (!to.has(id)) {
      changes.push({
        targetType: "priceItem",
        targetKey: id,
        field: "amount",
        oldValue: amount,
        newValue: null,
      });
    }
  }
  return changes;
}

function diffRules(
  published: PricingVersion,
  draft: PricingVersion,
): PricingDiffEntry[] {
  const changes: PricingDiffEntry[] = [];
  const keys = new Set([
    ...Object.keys(published.rules),
    ...Object.keys(draft.rules),
  ]);
  for (const key of [...keys].sort()) {
    const oldValue = published.rules[key];
    const newValue = draft.rules[key];
    if (oldValue === undefined) {
      changes.push({
        targetType: "rule",
        targetKey: key,
        field: key,
        oldValue: null,
        newValue,
      });
    } else if (newValue === undefined) {
      changes.push({
        targetType: "rule",
        targetKey: key,
        field: key,
        oldValue,
        newValue: null,
      });
    } else if (!sameValue(oldValue, newValue)) {
      changes.push({
        targetType: "rule",
        targetKey: key,
        field: key,
        oldValue,
        newValue,
      });
    }
  }
  return changes;
}

function promoObject(promo: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of PROMO_FIELDS) {
    result[field] = promo[field];
  }
  return result;
}

function promoMap(
  version: PricingVersion,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const promo of version.promos) {
    if (map.has(promo.code)) {
      throw new Error(
        `Версия "${version.id}": дубликат промокода "${promo.code}" (§8.3: уникальность кодов) — сравнение неоднозначно.`,
      );
    }
    map.set(promo.code, promo as unknown as Record<string, unknown>);
  }
  return map;
}

function diffPromos(
  published: PricingVersion,
  draft: PricingVersion,
): PricingDiffEntry[] {
  const changes: PricingDiffEntry[] = [];
  const from = promoMap(published);
  const to = promoMap(draft);

  for (const code of [...to.keys()].sort()) {
    const newPromo = to.get(code)!;
    const oldPromo = from.get(code);
    if (!oldPromo) {
      changes.push({
        targetType: "promo",
        targetKey: code,
        field: "promo",
        oldValue: null,
        newValue: promoObject(newPromo),
      });
      continue;
    }
    for (const field of PROMO_FIELDS) {
      const oldValue = oldPromo[field];
      const newValue = newPromo[field];
      if (!sameValue(oldValue, newValue)) {
        changes.push({
          targetType: "promo",
          targetKey: code,
          field,
          oldValue,
          newValue,
        });
      }
    }
  }
  for (const code of [...from.keys()].sort()) {
    if (!to.has(code)) {
      changes.push({
        targetType: "promo",
        targetKey: code,
        field: "promo",
        oldValue: promoObject(from.get(code)!),
        newValue: null,
      });
    }
  }
  return changes;
}

function diffMetadata(
  published: PricingVersion,
  draft: PricingVersion,
): PricingDiffEntry[] {
  const changes: PricingDiffEntry[] = [];
  for (const field of METADATA_FIELDS) {
    const oldValue = published[field];
    const newValue = draft[field];
    if (oldValue === newValue) continue;
    changes.push({
      targetType: "metadata",
      targetKey: field,
      field,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
    });
  }
  return changes;
}

const TYPE_ORDER: Record<PricingDiffEntry["targetType"], number> = {
  priceItem: 0,
  rule: 1,
  promo: 2,
  metadata: 3,
};

/**
 * Вычисление diff между двумя версиями (§6.6): добавления/удаления/изменения
 * по стабильным идентификаторам. Используется CA-T-209 (draft ↔ published)
 * и CA-T-210/211 (генерация `PricingChange` при публикации).
 */
export function computePricingDiff(
  from: PricingVersion,
  to: PricingVersion,
): PricingDiffEntry[] {
  return [
    ...diffSnapshot(from, to),
    ...diffRules(from, to),
    ...diffPromos(from, to),
    ...diffMetadata(from, to),
  ].sort(
    (a, b) =>
      TYPE_ORDER[a.targetType] - TYPE_ORDER[b.targetType] ||
      a.targetKey.localeCompare(b.targetKey) ||
      a.field.localeCompare(b.field),
  );
}

/**
 * Сравнение draft с актуальной опубликованной версией (read-only, без
 * записи данных и audit-событий). Отсутствие версий — явные статусы.
 */
export async function diffDraftWithPublished(): Promise<DraftDiffResult> {
  const draft = await getDraftVersion();
  if (!draft) return { status: "no_draft" };

  const published = await getPublishedVersion();
  if (!published) return { status: "no_published" };

  return {
    status: "ok",
    diff: {
      fromVersionId: published.id,
      toVersionId: draft.id,
      changes: computePricingDiff(published, draft),
    },
  };
}

// ─── Валидация draft (CA-T-210, дизайн §8.3) ───

const PRICE_ITEMS = "price-items.json";

export type ValidationSeverity = "error" | "warning" | "info";

/** Формат issues — ТЗ §3.2 `ValidationResult` (близок к `ValidationIssue[]`). */
export interface ValidationIssue {
  code: string;
  message: string;
  path: string;
  severity: ValidationSeverity;
}

/**
 * Результат валидации (ТЗ §3.2 `ValidationResult`).
 *
 * `scope="price"` — по enum ТЗ §3.2; дизайн §8.3 упоминает `price_version`,
 * которого в enum нет (расхождение документа зафиксировано в отчёте
 * CA-T-210, значение не расширялось).
 */
export interface PricingValidationResult {
  /** Идентификатор прогона (ТЗ §3.2). */
  id: string;
  scope: "price";
  targetId: string | null;
  /** `false` при наличии хотя бы одного `error` (§8.3: passed=false → 422). */
  passed: boolean;
  issues: ValidationIssue[];
  createdAt: string;
}

/** Обязательные правила §8.3: `rounding > 0`, `minOrder ≥ 0`, … */
const REQUIRED_RULES: ReadonlyArray<{
  key: string;
  valid: (value: unknown) => boolean;
  expect: string;
}> = [
  { key: "rounding", valid: (v) => typeof v === "number" && Number.isFinite(v) && v > 0, expect: "число > 0 (§8.3)" },
  { key: "minOrder", valid: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0, expect: "число ≥ 0 (§8.3)" },
  {
    key: "complexityPerExtraModule",
    valid: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
    expect: "число ≥ 0 (§8.3)",
  },
  {
    key: "complexityMax",
    valid: (v) => typeof v === "number" && Number.isFinite(v) && v >= 1,
    expect: "число ≥ 1 (§8.3)",
  },
];

/** «Ставки материалов» для проверки равенства (OI-010/§8.3). */
const MATERIAL_UNITS = new Set(["RUB_PER_SQM", "RUB_PER_LINM"]);

function issue(
  code: string,
  severity: ValidationSeverity,
  path: string,
  message: string,
): ValidationIssue {
  return { code, severity, path, message };
}

function zodIssues(
  error: { issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }> },
  code: string,
  prefix: string,
): ValidationIssue[] {
  return error.issues.map((item) =>
    issue(
      code,
      "error",
      [prefix, ...item.path.map((part) => String(part))].filter(Boolean).join("."),
      item.message,
    ),
  );
}

/**
 * Валидация конкретного draft перед публикацией (дизайн §8.3,
 * карточка CA-T-210: «422 при неполноте; warnings» — маппинг на HTTP
 * выполняется при появлении API, CA-T-609; C11).
 *
 * Read-only: ничего не создаёт и не меняет (draft/публикуемые версии,
 * snapshot, статусы не трогаются), audit-события не создаются, пересчёт
 * не запускается. `id` не передан → текущий draft (§8.2: несколько →
 * отказ, без выбора случайного); `id` передан → валидируется конкретная
 * версия по id.
 *
 * Проверки §8.3: структура (`pricingVersionSchema`), полнота и состав
 * snapshot (S-01: ровно `active ∧ used`, без дублей, известные id),
 * amount ≥ 0 и FACTOR ∈ [0.1, 10], правила `rounding/minOrder/
 * complexityPerExtraModule/complexityMax`, промокоды (схема + value/
 * minSubtotal ≥ 0 + уникальность кодов); предупреждения: preliminary-
 * ставки (опоры/LED, аудит §10) и равенство ставок материалов (OI-010);
 * информационно, без сокрытия: PARTIAL-ребра `priceRef` (R-15) и
 * unresolved-ссылки `priceRef` (R-15). `passed=false` только при errors.
 */
export async function validateDraftVersion(
  id?: string,
): Promise<PricingValidationResult> {
  const issues: ValidationIssue[] = [];
  let version: PricingVersion | undefined;

  if (id !== undefined) {
    version = await getVersion(id);
    if (!version) {
      issues.push(issue("version_not_found", "error", "version", `Версия "${id}" не найдена.`));
    } else if (version.status !== "draft") {
      issues.push(
        issue(
          "not_draft",
          "error",
          "version",
          `Версия "${id}" имеет статус "${version.status}" — валидация перед публикацией применяется к draft (§8.2).`,
        ),
      );
    }
  } else {
    version = await getDraftVersion();
    if (!version) {
      issues.push(issue("draft_not_found", "error", "version", "Draft-версия не найдена (§8.2) — публикация невозможна."));
    }
  }

  if (version) {
    // 1) Структура записи (реальная схема §6.5).
    const parsed = pricingVersionSchema.safeParse(version);
    if (!parsed.success) {
      issues.push(...zodIssues(parsed.error, "schema_invalid", ""));
    }

    // 2) Snapshot (§8.3/S-01).
    if (version.snapshot === undefined) {
      issues.push(issue("snapshot_missing", "error", "snapshot", "Снимок версии отсутствует (§6.5: snapshot обязателен)."));
    } else if (Array.isArray(version.snapshot)) {
      const seen = new Set<string>();
      for (const entry of version.snapshot) {
        if (seen.has(entry.priceItemId)) {
          issues.push(
            issue(
              "snapshot_duplicate",
              "error",
              `snapshot.${entry.priceItemId}`,
              `Ставка "${entry.priceItemId}" присутствует в снимке более одного раза (§8.3: ровно один раз).`,
            ),
          );
        }
        seen.add(entry.priceItemId);
        if (entry.amount < 0) {
          issues.push(
            issue(
              "amount_negative",
              "error",
              `snapshot.${entry.priceItemId}.amount`,
              `Сумма ${entry.amount} < 0 (§8.3: суммы ≥ 0).`,
            ),
          );
        }
      }

      // Коллекция PriceItem: структура и состав S-01.
      const rawItems = await readCollection<unknown>(PRICE_ITEMS);
      const byId = new Map<string, PriceItem>();
      for (const raw of rawItems) {
        const result = priceItemSchema.safeParse(raw);
        if (!result.success) {
          const item = raw as { id?: unknown };
          issues.push(
            ...zodIssues(result.error, "price_item_invalid", `priceItems.${String(item.id ?? "?")}`),
          );
          continue;
        }
        byId.set(result.data.id, result.data);
      }

      const snapshotIds = new Set(version.snapshot.map((entry) => entry.priceItemId));
      for (const entry of version.snapshot) {
        const priceItem = byId.get(entry.priceItemId);
        if (!priceItem) {
          issues.push(
            issue(
              "price_item_unknown",
              "error",
              `snapshot.${entry.priceItemId}`,
              `PriceItem "${entry.priceItemId}" отсутствует в коллекции ставок (§8.3: неизвестный priceItemId — ошибка).`,
            ),
          );
          continue;
        }
        if (priceItem.status !== "active" || priceItem.usage !== "used") {
          issues.push(
            issue(
              "snapshot_composition",
              "error",
              `snapshot.${entry.priceItemId}`,
              `Ставка "${entry.priceItemId}" имеет status="${priceItem.status}", usage="${priceItem.usage}" — в снимке допускается ровно active ∧ used (§8.3/S-01).`,
            ),
          );
        }
        if (priceItem.unit === "FACTOR" && (entry.amount < 0.1 || entry.amount > 10)) {
          issues.push(
            issue(
              "amount_factor_range",
              "error",
              `snapshot.${entry.priceItemId}.amount`,
              `FACTOR-ставка ${entry.amount} вне диапазона [0.1, 10] (§8.3).`,
            ),
          );
        }
        // Предупреждение §8.3: preliminary-данные (опоры/LED, аудит §10).
        if (
          priceItem.sourceRef.startsWith("src/content/supports.ts:") ||
          priceItem.sourceRef.startsWith("src/content/lighting.ts:")
        ) {
          issues.push(
            issue(
              "preliminary_data",
              "warning",
              `snapshot.${entry.priceItemId}`,
              `Ставка "${entry.priceItemId}" (${priceItem.sourceRef}) требует инженерного подтверждения (опоры/LED, preliminary — аудит §10).`,
            ),
          );
        }
      }

      // Полнота S-01: каждый active ∧ used PriceItem обязан быть в снимке.
      for (const priceItem of byId.values()) {
        if (priceItem.status === "active" && priceItem.usage === "used" && !snapshotIds.has(priceItem.id)) {
          issues.push(
            issue(
              "snapshot_incomplete",
              "error",
              `snapshot.${priceItem.id}`,
              `Активная used-ставка "${priceItem.id}" отсутствует в снимке (§8.3/S-01: множество ровно active ∧ used).`,
            ),
          );
        }
      }

      // Равенство ставок материалов (OI-010 → warning, §8.3).
      const groups = new Map<string, string[]>();
      for (const entry of version.snapshot) {
        const priceItem = byId.get(entry.priceItemId);
        if (!priceItem || !MATERIAL_UNITS.has(priceItem.unit)) continue;
        const key = `${priceItem.unit}|${entry.amount}`;
        groups.set(key, [...(groups.get(key) ?? []), entry.priceItemId]);
      }
      for (const [key, ids] of groups) {
        if (new Set(ids).size > 1) {
          issues.push(
            issue(
              "rate_equality",
              "warning",
              `snapshot(${[...new Set(ids)].sort().join(", ")})`,
              `Равные ставки разных материалов (${key.split("|")[1]}, единица ${key.split("|")[0]}): ${[...new Set(ids)].sort().join(", ")} — OI-010 (§8.3, warning).`,
            ),
          );
        }
      }
    }

    // 3) Правила (§8.3).
    if (version.rules !== undefined && version.rules !== null && typeof version.rules === "object") {
      for (const rule of REQUIRED_RULES) {
        if (!(rule.key in version.rules)) {
          issues.push(
            issue("rule_missing", "error", `rules.${rule.key}`, `Правило "${rule.key}" отсутствует (§8.3: требуется ${rule.expect}).`),
          );
        } else if (!rule.valid(version.rules[rule.key])) {
          issues.push(
            issue("rule_invalid", "error", `rules.${rule.key}`, `Недопустимое значение правила "${rule.key}": ${JSON.stringify(version.rules[rule.key])} — требуется ${rule.expect}.`),
          );
        }
      }
    }

    // 4) Промокоды (схема §6.5 + §8.3: value/minSubtotal ≥ 0, уникальность).
    if (Array.isArray(version.promos)) {
      const codes = new Set<string>();
      version.promos.forEach((promo, index) => {
        const result = promoDefinitionSchema.safeParse(promo);
        if (!result.success) {
          issues.push(...zodIssues(result.error, "promo_invalid", `promos.${index}`));
          return;
        }
        const code = result.data.code;
        if (codes.has(code)) {
          issues.push(
            issue("promo_duplicate", "error", `promos.${code}`, `Дубликат промокода "${code}" (§8.3: уникальность кодов).`),
          );
        }
        codes.add(code);
        if (result.data.value < 0) {
          issues.push(issue("promo_invalid", "error", `promos.${code}.value`, `value ${result.data.value} < 0 (§8.3).`));
        }
        if (result.data.minSubtotal < 0) {
          issues.push(issue("promo_invalid", "error", `promos.${code}.minSubtotal`, `minSubtotal ${result.data.minSubtotal} < 0 (§8.3).`));
        }
      });
    }

    // 5) Связи priceRef (R-15): PARTIAL и unresolved не скрываются и не
    //    объявляются разрешёнными; не блокируют (в §8.3 не входят).
    for (const row of MAP_ROWS) {
      if (row.evidence === "PARTIAL" && JSON.stringify(row).includes("priceRef")) {
        issues.push(
          issue(
            "price_ref_partial",
            "info",
            `priceRef.${row.sourceId}`,
            `Ребро priceRef "${row.sourceId}" → "${row.targetId}" остаётся PARTIAL (R-15): полное разрешение — только после DataResolver (CA-T-304); не объявляется решённым.`,
          ),
        );
      }
    }
    for (const link of await checkPresetPriceRefs()) {
      issues.push(
        issue(
          "price_ref_unresolved",
          "info",
          `priceRef.${link.preset}`,
          `priceRef "${link.priceRef}" пресета ${link.preset} не разрешается в существующий PriceItem (R-15: unresolved).`,
        ),
      );
    }
  }

  const passed = !issues.some((item) => item.severity === "error");
  return {
    id: randomBytes(8).toString("hex"),
    scope: "price",
    targetId: version?.id ?? id ?? null,
    passed,
    issues,
    createdAt: new Date().toISOString(),
  };
}
