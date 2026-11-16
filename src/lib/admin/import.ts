import { SUPPORTED_SCHEMA_VERSION } from "@/lib/configurator/versions";
import { appendAuditEvent } from "@/lib/server/audit";
import { readCollection, updateCollection } from "@/lib/server/store";
import {
  BODY_MATERIALS,
  COUNTERTOPS,
  FACADE_MATERIALS,
  FACADE_STYLES,
  HANDLES,
  KITCHEN_MODULES,
} from "@/content/catalog";
import {
  LED_CONTROLS,
  LED_CONNECTOR_PRICE,
  LED_DIFFUSERS,
  LED_END_CAP_PRICE,
  LED_INSTALL_PRICE_PER_METER,
  LED_PROFILES,
  LED_PSU_PRICE,
  LED_STRIPS,
} from "@/content/lighting";
import { PLINTH_MATERIALS } from "@/content/plinth";
import { PROMOS, PRICING } from "@/content/pricing";
import { SUPPORT_SYSTEMS } from "@/content/supports";

import { PERMANENTLY_UNUSED } from "./price-items";
import type { ActorContext } from "./parameters";
import {
  priceItemSchema,
  pricingVersionSchema,
  type PriceItem,
  type PricingVersion,
} from "./schema";

/**
 * CA-T-208 — контролируемый импорт PriceItem из `src/content/*`.
 *
 * Решение владельца R-14 (план §11): первичное создание определений
 * PriceItem — только этим импортом; ручной CRUD create не вводится;
 * фиктивные ставки не создаются; подбор связей по совпадению amount
 * запрещён (R-15).
 *
 * Источники — реестр §4 `CALCULATOR_TECHNICAL_AUDIT.md` (118 позиций):
 *  - значения читаются из реального `src/content/*` в рантайме (не
 *    дублируются в коде);
 *  - `id`/`sourceRef` — по структуре источника (пример §6.4
 *    `kitchen.hingePerDoor`, `catalog.body.ldsp.rate`);
 *  - `label`/`unit` — из содержимого источника (`name`/`label`) либо из
 *    документированной единицы §4 (таблица `PRICING_SPEC`); для ключей
 *    без документированной единицы — исключение с причиной.
 *
 * Исключается из импорта (24 позиции §4 → отчёт `excluded`):
 *  - `rules` §8.7 (rounding, minOrder, complexity*, bodyFactor,
 *    bodyDepthReference) — живут в `PricingVersion.rules`;
 *  - `PROMOS` — `PricingVersion.promos` (§6.5);
 *  - `kitchen.countertopDepthAllowance` — единица «—» §4 не
 *    документирована в enum `unit`;
 *  - `PLINTH_MATERIALS[].finishes[].rateDelta` (§4 №60–72) — дельта
 *    исполнения, может быть отрицательной → несовместима со
 *    snapshot-контрактом §8.3 (`amount ≥ 0`).
 *
 * Идемпотентность/атомарность (Storage Adapter): вся спецификация и оба
 * файла-приёмника валидируются ДО первой записи; конфликты (id/источник/
 * чужие active∧used ставки / черновик не создать) → отчёт без единой
 * записи. Затем — до двух последовательных `updateCollection` (price-items,
 * затем draft-версия): сбой между ними восстанавливается повторным
 * запуском. Опубликованные/superseded-версии не читаются на запись и не
 * изменяются никогда.
 *
 * Связи `ModulePreset.priceRef` (R-15): импорт только **отчитывается**
 * (`matched` — точное совпадение `priceRef` = `PriceItem.id`; `unresolved`
 * — отсутствует/нет в источнике); сопоставление по amount не выполняется;
 * PARTIAL-ребра карты зависимостей не изменяются (CA-T-304/303 — вне
 * scope). `matched` ≠ resolved — полное разрешение только после
 * DataResolver.
 *
 * Аудит (enum не расширяется): запуск импорта с изменениями →
 * `diagnostic.run` (прецедент CA-T-206), создание черновика →
 * `pricing.create`.
 */

const PRICE_ITEMS = "price-items.json";
const VERSIONS = "pricing-versions.json";
const PRESETS = "module-presets.json";

const DEAD_IDS = new Set(PERMANENTLY_UNUSED.map((item) => item.id));

/** Формат id черновика — от версии источника (`price-` + `PRICING.version`). */
const draftVersionId = (): string => `price-${PRICING.version}`;

/**
 * CA-T-516: legacy-ставки сохраняются без изменений и без импорта.
 * Они не имеют sourceRef в текущем spec, но остаются active/used и должны
 * присутствовать в новом snapshot для исторической совместимости.
 */
const LEGACY_IMPORT_EXCLUDED_IDS = new Set([
  "catalog.body.mdf.ratePerSqm",
  "catalog.body.plywood.ratePerSqm",
  "catalog.facade.veneer.ratePerSqm",
  "catalog.facade.glass.ratePerSqm",
  "catalog.facade.solid.ratePerSqm",
]);

function legacySnapshotAmount(
  versions: PricingVersion[],
  id: string,
): number | undefined {
  // Сначала опубликованный снимок, затем любой другой с этим id.
  const ordered = [
    ...versions.filter((version) => version.status === "published"),
    ...versions.filter((version) => version.status !== "published"),
  ];
  for (const version of ordered) {
    const entry = version.snapshot.find((item) => item.priceItemId === id);
    if (entry) return entry.amount;
  }
  return undefined;
}

// ─── Спецификация ───

interface SpecEntry {
  id: string;
  scope: PriceItem["scope"];
  label: string;
  unit: PriceItem["unit"];
  usage: PriceItem["usage"];
  editable: boolean;
  sourceRef: string;
  value: number;
}

interface ExcludedEntry {
  sourceRef: string;
  reason: string;
}

const REASON_RULE =
  "правило §8.7 — PricingVersion.rules, не PriceItem (ТЗ §3.2)";
const REASON_PROMO = "промокод §6.5 — PricingVersion.promos, не PriceItem";
const REASON_RATE_DELTA =
  "дельта исполнения (§4 №60–72): amount может быть отрицательным → несовместимо со snapshot §8.3 (amount ≥ 0)";
const REASON_ALLOWANCE =
  "единица «—» (§4 №7) не документирована в enum unit PriceItem";

/** Ключи `PRICING.*` → правила версии (не ставки). */
const RULE_KEYS: Record<"kitchen" | "wardrobe", ReadonlySet<string>> = {
  kitchen: new Set([
    "complexityPerExtraModule",
    "complexityMax",
    "bodyDepthReference",
  ]),
  wardrobe: new Set(["bodyDepthReference", "bodyFactor"]),
};

/**
 * Ставки `PRICING.kitchen`/`PRICING.wardrobe`: единица и название — по
 * реестру §4 (позиции 3–33); нормализация единиц §4 → enum: «₽» → RUB,
 * «₽/шт» → RUB_PER_PCS, «₽/м» → RUB_PER_M, «₽/модуль» → RUB_PER_PCS
 * (фиксированная ставка за модуль, единого enum-соответствия в документе
 * нет — нормализация явная). Ключ без записи и без RULE_KEYS/исключения →
 * ошибка (полнота спецификации: новые ключи content не пропускаются
 * молча).
 */
const PRICING_SPEC: Record<
  "kitchen" | "wardrobe",
  Readonly<Record<string, { unit: PriceItem["unit"]; label: string }>>
> = {
  kitchen: {
    baseCost: { unit: "RUB", label: "Основа проекта (кухня)" },
    plinthPerMeter: { unit: "RUB_PER_M", label: "Цоколь ₽/м (кухня, устаревший)" },
    shelf: { unit: "RUB_PER_PCS", label: "Полка (кухня)" },
    underCabinetLightPerMeter: {
      unit: "RUB_PER_M",
      label: "Подсветка за метр (устаревшая)",
    },
    sidePanel: { unit: "RUB_PER_PCS", label: "Декоративная боковина" },
    sinkCutout: { unit: "RUB_PER_PCS", label: "Вырез под мойку" },
    sinkPartition: { unit: "RUB", label: "Перегородка мойки (демо)" },
    bottleRack: { unit: "RUB", label: "Бутылочница" },
    hobCutout: { unit: "RUB", label: "Вырез под варочную" },
    ovenNiches: { unit: "RUB", label: "Ниши под технику" },
    hingePerDoor: { unit: "RUB_PER_PCS", label: "Петля (кухня)" },
    softClosePerDoor: { unit: "RUB_PER_PCS", label: "Доводчик (кухня)" },
    pushToOpenPerDoor: { unit: "RUB_PER_PCS", label: "Push-to-open (кухня)" },
    drawerSlide: { unit: "RUB_PER_PCS", label: "Направляющие ящика (кухня)" },
    drawerSoftClose: { unit: "RUB_PER_PCS", label: "Доводчик ящика (кухня)" },
  },
  wardrobe: {
    baseCost: { unit: "RUB", label: "Основа проекта (шкаф)" },
    plinthPerMeter: { unit: "RUB_PER_M", label: "Цоколь шкафа" },
    shelf: { unit: "RUB_PER_PCS", label: "Полка (шкаф)" },
    rod: { unit: "RUB_PER_PCS", label: "Штанга" },
    drawer: { unit: "RUB_PER_PCS", label: "Ящик шкафа" },
    drawerSoftClose: { unit: "RUB_PER_PCS", label: "Доводчик ящика (шкаф)" },
    ledPerSection: { unit: "RUB_PER_PCS", label: "LED за секцию шкафа" },
    hingePerDoor: { unit: "RUB_PER_PCS", label: "Петля (шкаф)" },
    softClosePerDoor: { unit: "RUB_PER_PCS", label: "Доводчик (шкаф)" },
    pushToOpenPerDoor: { unit: "RUB_PER_PCS", label: "Push-to-open (шкаф)" },
    edgePvc04: { unit: "RUB_PER_M", label: "Кромка ПВХ 0,4 мм (шкаф)" },
    edgePvc1: { unit: "RUB_PER_M", label: "Кромка ПВХ 1 мм (шкаф)" },
    edgePvc2: { unit: "RUB_PER_M", label: "Кромка ПВХ 2 мм (шкаф)" },
  },
};

/** Позиция исключения (не ставка): `countertopDepthAllowance` §4 №7. */
const PRICING_EXCLUDED: Readonly<Record<string, string>> = {
  countertopDepthAllowance: REASON_ALLOWANCE,
};

const SUPPORT_PARTS: ReadonlyArray<{
  field: "legPrice" | "clipPrice" | "screwPrice" | "anchorPrice";
  label: string;
}> = [
  { field: "legPrice", label: "Опора" },
  { field: "clipPrice", label: "Клипса" },
  { field: "screwPrice", label: "Винт" },
  { field: "anchorPrice", label: "Анкер" },
];

function deadUsage(id: string): { usage: PriceItem["usage"]; editable: boolean } {
  return DEAD_IDS.has(id)
    ? { usage: "unused", editable: false }
    : { usage: "used", editable: true };
}

/** Опциональное поле content: отсутствует → ошибка, не подстановка. */
function requireValue(value: number | undefined, sourceRef: string): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(
      `Импорт: отсутствующее или не-конечное значение в "${sourceRef}".`,
    );
  }
  return value;
}

interface BuiltSpec {
  entries: SpecEntry[];
  excluded: ExcludedEntry[];
}

/**
 * Спецификация из реальных источников. Ошибки (дубль id/sourceRef,
 * неизвестный ключ content, не-конечное значение) → исключение до записи.
 */
/** Signed-корректировки finish.rateDelta (ADR-06 Rev10 §5.8.3). */
function buildSignedAdjustments(): Array<{ key: string; amount: number }> {
  return PLINTH_MATERIALS.flatMap((material) =>
    material.finishes.map((finish) => ({
      key: `plinth:${material.id}:${finish.id}`,
      amount: finish.rateDelta,
    })),
  );
}

export function buildImportSpec(): BuiltSpec {
  const entries: SpecEntry[] = [];
  const excluded: ExcludedEntry[] = [];
  const ids = new Set<string>();
  const refs = new Set<string>();

  const push = (entry: SpecEntry): void => {
    if (!Number.isFinite(entry.value)) {
      throw new Error(
        `Импорт: не-конечное значение "${entry.value}" для "${entry.sourceRef}".`,
      );
    }
    if (ids.has(entry.id)) {
      throw new Error(`Импорт: дубликат id "${entry.id}" в спецификации.`);
    }
    if (refs.has(entry.sourceRef)) {
      throw new Error(
        `Импорт: дубликат sourceRef "${entry.sourceRef}" в спецификации.`,
      );
    }
    ids.add(entry.id);
    refs.add(entry.sourceRef);
    entries.push(entry);
  };

  // ── PRICING (§4 №3–33) ──
  for (const family of ["kitchen", "wardrobe"] as const) {
    const section = PRICING[family] as unknown as Record<string, number>;
    for (const key of Object.keys(section)) {
      const sourceRef = `src/content/pricing.ts:PRICING.${family}.${key}`;
      if (RULE_KEYS[family].has(key)) {
        excluded.push({ sourceRef, reason: REASON_RULE });
        continue;
      }
      if (PRICING_EXCLUDED[key]) {
        excluded.push({ sourceRef, reason: PRICING_EXCLUDED[key]! });
        continue;
      }
      const spec = PRICING_SPEC[family][key];
      if (!spec) {
        throw new Error(
          `Импорт: для ключа PRICING.${family}.${key} нет спецификации (единица/название §4) — новый ключ content не импортируется молча.`,
        );
      }
      const id = `${family}.${key}`;
      push({
        id,
        scope: family,
        label: spec.label,
        unit: spec.unit,
        ...deadUsage(id),
        sourceRef,
        value: section[key]!,
      });
    }
  }
  for (const key of ["rounding", "minOrder"] as const) {
    excluded.push({
      sourceRef: `src/content/pricing.ts:PRICING.${key}`,
      reason: REASON_RULE,
    });
  }

  // ── Каталоги (§4 №34–54) ──
  for (const item of BODY_MATERIALS) {
    push({
      id: `catalog.body.${item.id}.ratePerSqm`,
      scope: "shared",
      label: item.name,
      unit: "RUB_PER_SQM",
      ...deadUsage(`catalog.body.${item.id}.ratePerSqm`),
      sourceRef: `src/content/catalog.ts:BODY_MATERIALS.${item.id}.ratePerSqm`,
      value: requireValue(
        item.ratePerSqm,
        `src/content/catalog.ts:BODY_MATERIALS.${item.id}.ratePerSqm`,
      ),
    });
  }
  for (const item of FACADE_MATERIALS) {
    push({
      id: `catalog.facade.${item.id}.ratePerSqm`,
      scope: "shared",
      label: item.name,
      unit: "RUB_PER_SQM",
      ...deadUsage(`catalog.facade.${item.id}.ratePerSqm`),
      sourceRef: `src/content/catalog.ts:FACADE_MATERIALS.${item.id}.ratePerSqm`,
      value: requireValue(
        item.ratePerSqm,
        `src/content/catalog.ts:FACADE_MATERIALS.${item.id}.ratePerSqm`,
      ),
    });
  }
  for (const item of FACADE_STYLES) {
    push({
      id: `catalog.facadeStyle.${item.id}.multiplier`,
      scope: "shared",
      label: item.name,
      unit: "FACTOR",
      ...deadUsage(`catalog.facadeStyle.${item.id}.multiplier`),
      sourceRef: `src/content/catalog.ts:FACADE_STYLES.${item.id}.multiplier`,
      value: item.multiplier,
    });
  }
  for (const item of HANDLES) {
    push({
      id: `catalog.handle.${item.id}.rate`,
      scope: "shared",
      label: item.name,
      unit: "RUB_PER_PCS",
      ...deadUsage(`catalog.handle.${item.id}.rate`),
      sourceRef: `src/content/catalog.ts:HANDLES.${item.id}.rate`,
      value: item.rate,
    });
  }
  for (const item of COUNTERTOPS) {
    push({
      id: `catalog.countertop.${item.id}.ratePerLinearMeter`,
      scope: "shared",
      label: item.name,
      unit: "RUB_PER_LINM",
      ...deadUsage(`catalog.countertop.${item.id}.ratePerLinearMeter`),
      sourceRef: `src/content/catalog.ts:COUNTERTOPS.${item.id}.ratePerLinearMeter`,
      value: requireValue(
        item.ratePerLinearMeter,
        `src/content/catalog.ts:COUNTERTOPS.${item.id}.ratePerLinearMeter`,
      ),
    });
  }

  // ── Цоколь (§4 №55–72): ratePerMeter импортируется, rateDelta — исключён ──
  for (const item of PLINTH_MATERIALS) {
    push({
      id: `catalog.plinth.${item.id}.ratePerMeter`,
      scope: "shared",
      label: item.name,
      unit: "RUB_PER_M",
      ...deadUsage(`catalog.plinth.${item.id}.ratePerMeter`),
      sourceRef: `src/content/plinth.ts:PLINTH_MATERIALS.${item.id}.ratePerMeter`,
      value: item.ratePerMeter,
    });
    for (const finish of item.finishes) {
      excluded.push({
        sourceRef: `src/content/plinth.ts:PLINTH_MATERIALS.${item.id}.finishes.${finish.id}.rateDelta`,
        reason: REASON_RATE_DELTA,
      });
    }
  }

  // ── Опоры (§4 №73–80) ──
  for (const system of SUPPORT_SYSTEMS) {
    for (const part of SUPPORT_PARTS) {
      const id = `catalog.support.${system.id}.${part.field}`;
      push({
        id,
        scope: "shared",
        label: `${part.label} (${system.id})`,
        unit: "RUB_PER_PCS",
        ...deadUsage(id),
        sourceRef: `src/content/supports.ts:SUPPORT_SYSTEMS.${system.id}.${part.field}`,
        value: system[part.field],
      });
    }
  }

  // ── Свет (§4 №81–107) ──
  for (const item of LED_PROFILES) {
    push({
      id: `lighting.profile.${item.id}`,
      scope: "shared",
      label: item.name,
      unit: "RUB_PER_M",
      ...deadUsage(`lighting.profile.${item.id}`),
      sourceRef: `src/content/lighting.ts:LED_PROFILES.${item.id}.ratePerMeter`,
      value: item.ratePerMeter,
    });
  }
  for (const item of LED_DIFFUSERS) {
    push({
      id: `lighting.diffuser.${item.id}`,
      scope: "shared",
      label: item.name,
      unit: "RUB_PER_M",
      ...deadUsage(`lighting.diffuser.${item.id}`),
      sourceRef: `src/content/lighting.ts:LED_DIFFUSERS.${item.id}.ratePerMeter`,
      value: item.ratePerMeter,
    });
  }
  for (const item of LED_CONTROLS) {
    push({
      id: `lighting.control.${item.id}`,
      scope: "shared",
      label: item.name,
      unit: "RUB_PER_PCS",
      ...deadUsage(`lighting.control.${item.id}`),
      sourceRef: `src/content/lighting.ts:LED_CONTROLS.${item.id}.price`,
      value: item.price,
    });
  }
  for (const watts of Object.keys(LED_PSU_PRICE).map(Number)) {
    push({
      id: `lighting.psu.${watts}`,
      scope: "shared",
      label: `Блок питания ${watts} Вт`,
      unit: "RUB",
      ...deadUsage(`lighting.psu.${watts}`),
      sourceRef: `src/content/lighting.ts:LED_PSU_PRICE.${watts}`,
      value: LED_PSU_PRICE[watts]!,
    });
  }
  for (const item of LED_STRIPS) {
    push({
      id: `lighting.strip.${item.id}`,
      scope: "shared",
      label: `Лента ${item.voltage} В ${item.power} Вт/м`,
      unit: "RUB_PER_M",
      ...deadUsage(`lighting.strip.${item.id}`),
      sourceRef: `src/content/lighting.ts:LED_STRIPS.${item.id}.pricePerMeter`,
      value: item.pricePerMeter,
    });
  }
  push({
    id: "lighting.endCap",
    scope: "shared",
    label: "Заглушка профиля",
    unit: "RUB_PER_PCS",
    ...deadUsage("lighting.endCap"),
    sourceRef: "src/content/lighting.ts:LED_END_CAP_PRICE",
    value: LED_END_CAP_PRICE,
  });
  push({
    id: "lighting.connector",
    scope: "shared",
    label: "Соединитель",
    unit: "RUB_PER_PCS",
    ...deadUsage("lighting.connector"),
    sourceRef: "src/content/lighting.ts:LED_CONNECTOR_PRICE",
    value: LED_CONNECTOR_PRICE,
  });
  push({
    id: "lighting.install",
    scope: "shared",
    label: "Монтаж подсветки",
    unit: "RUB_PER_M",
    ...deadUsage("lighting.install"),
    sourceRef: "src/content/lighting.ts:LED_INSTALL_PRICE_PER_METER",
    value: LED_INSTALL_PRICE_PER_METER,
  });

  // ── basePrice пресетов (§4 №111–118) ──
  for (const key of Object.keys(KITCHEN_MODULES)) {
    const preset = KITCHEN_MODULES[key as keyof typeof KITCHEN_MODULES];
    push({
      id: `kitchen.module.${key}.basePrice`,
      scope: "kitchen",
      label: `basePrice «${preset.label}»`,
      unit: "RUB",
      ...deadUsage(`kitchen.module.${key}.basePrice`),
      sourceRef: `src/content/catalog.ts:KITCHEN_MODULES.${key}.basePrice`,
      value: preset.basePrice,
    });
  }

  // ── Промокоды (§4 №108–110) — в promos версии ──
  for (const promo of PROMOS) {
    excluded.push({
      sourceRef: `src/content/pricing.ts:PROMOS.${promo.code}`,
      reason: REASON_PROMO,
    });
  }

  return { entries, excluded };
}

// ─── Отчёт ───

export interface PriceItemImportReport {
  /** Позиций в спецификации (ожидается 94: 118 − 24 исключений §4). */
  specTotal: number;
  imported: string[];
  unchanged: string[];
  conflicts: Array<{ id: string; reason: string }>;
  excluded: ExcludedEntry[];
  /** `null` при конфликтах — запись не выполнялась. */
  snapshot: {
    versionId: string;
    created: boolean;
    updated: boolean;
    entries: number;
  } | null;
  links: {
    /** Точное совпадение `priceRef` = `PriceItem.id` (≠ resolved, R-15). */
    matched: Array<{ preset: string; priceRef: string }>;
    unresolved: Array<{ preset: string; reason: string }>;
  };
  /** Версии, не изменённые импортом (опубликованные и др.). */
  untouchedVersionIds: string[];
}

// ─── Импорт ───

function specItem(entry: SpecEntry, actor: ActorContext): PriceItem {
  const now = new Date().toISOString();
  return priceItemSchema.parse({
    id: entry.id,
    scope: entry.scope,
    label: entry.label,
    unit: entry.unit,
    usage: entry.usage,
    status: "active",
    editable: entry.editable,
    sourceRef: entry.sourceRef,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.actorId,
  });
}

function sameDefinition(existing: PriceItem, entry: SpecEntry): boolean {
  return (
    existing.sourceRef === entry.sourceRef &&
    existing.scope === entry.scope &&
    existing.label === entry.label &&
    existing.unit === entry.unit
  );
}

function canonicalSnapshot(
  items: Array<{ priceItemId: string; amount: number }>,
): string {
  return JSON.stringify(
    [...items].sort((a, b) => a.priceItemId.localeCompare(b.priceItemId)),
  );
}

/**
 * Импорт определений + наполнение draft `PricingVersion.snapshot`
 * (состав — ровно `active ∧ used`, §6.4/S-01). Конфликты → отчёт без
 * записи; опубликованные версии не изменяются никогда.
 *
 * **P2-FIX-002 (конкурентность):** критическая секция — `updateCollection
 * (VERSIONS)`: там же, на актуальном состоянии под замком, вычисляются
 * фактическое `missing`, запись определений (вложенный замок `PRICE_ITEMS`
 * — другой файл; циклов нет), мутация draft и итоговые метрики. Параллельные
 * `importPriceItems` сериализуются этим замком: первый фактически создаёт
 * draft и записи, второй после снятия замка видит актуальное состояние
 * (`imported: 0`, `unchanged: 94`) и не создаёт второго `pricing.create`.
 * Событие `diagnostic.run` пишется на каждый запуск, претендовавший на
 * изменения (предварительное чтение до секции) либо изменивший draft, с
 * payload ФАКТИЧЕСКОГО результата этого вызова; последовательный повтор
 * без изменений остаётся без событий (прежний контракт сохранён).
 */
interface ImportOutcome {
  addedIds: string[];
  unchangedIds: string[];
  draftCreated: boolean;
  draftUpdated: boolean;
  snapshot: {
    versionId: string;
    created: boolean;
    updated: boolean;
    entries: number;
  };
  untouchedVersionIds: string[];
}
export async function importPriceItems(
  actor: ActorContext,
): Promise<PriceItemImportReport> {
  const spec = buildImportSpec();
  const specById = new Map(spec.entries.map((entry) => [entry.id, entry]));
  const specByRef = new Map(spec.entries.map((entry) => [entry.sourceRef, entry]));

  // Чтение обоих приёмников до записи: битый файл → исключение без записи.
  const existing = await readCollection<PriceItem>(PRICE_ITEMS);
  const versions = await readCollection<PricingVersion>(VERSIONS);
  const presets = await readCollection<Record<string, unknown>>(PRESETS);

  const conflicts: Array<{ id: string; reason: string }> = [];
  const existingById = new Map(existing.map((item) => [item.id, item]));

  // 1) Конфликты идентичности/источника существующих записей.
  for (const entry of spec.entries) {
    const current = existingById.get(entry.id);
    if (!current) continue;
    if (current.sourceRef !== entry.sourceRef) {
      conflicts.push({
        id: entry.id,
        reason: `конфликт источника: в хранилище "${current.sourceRef}", в источнике "${entry.sourceRef}" — перезапись запрещена`,
      });
    } else if (!sameDefinition(current, entry)) {
      conflicts.push({
        id: entry.id,
        reason: "конфликт идентичности: определение в хранилище отличается от источника (label/unit/scope) — перезапись запрещена",
      });
    }
  }

  // 2) Активные used-ставки без источника суммы → полнота снимка необъяснима.
  for (const item of existing) {
    if (
      item.status === "active" &&
      item.usage === "used" &&
      !specByRef.has(item.sourceRef) &&
      !LEGACY_IMPORT_EXCLUDED_IDS.has(item.id)
    ) {
      conflicts.push({
        id: item.id,
        reason: `активная used-ставка не имеет источника суммы в спецификации (sourceRef "${item.sourceRef}") — состав snapshot §6.4 необъясним`,
      });
    }
  }

  // 3) Правила черновика: ровно один draft (§8.2), наш id — только draft.
  const target = draftVersionId();
  const existingTarget = versions.find((version) => version.id === target);
  if (existingTarget && existingTarget.status !== "draft") {
    conflicts.push({
      id: target,
      reason: `версия "${target}" имеет статус "${existingTarget.status}" — id не переиспользуется, черновик не создаётся`,
    });
  }
  for (const version of versions) {
    if (version.status === "draft" && version.id !== target) {
      conflicts.push({
        id: version.id,
        reason: `существует другой черновик "${version.id}" — ограничение draft ≤ 1 (§8.2), второй не создаётся`,
      });
    }
  }

  const untouchedVersionIds = versions
    .filter((version) => version.id !== target)
    .map((version) => version.id);

  const links = buildLinks(presets, existingById, specById);
  // Триггер диагностического события — по предварительному чтению: «запуск
  // претендовал на изменения». При уже импортированных данных (последовательный
  // повтор) = 0 → без событий (прежний контракт идемпотентности сохранён);
  // конкурентный второй старт читает до записи первого → >0 → событие будет,
  // но payload отразит ФАКТ (P2-FIX-002).
  const preMissingCount = spec.entries.filter(
    (entry) => !existingById.has(entry.id),
  ).length;

  if (conflicts.length > 0) {
    return {
      specTotal: spec.entries.length,
      imported: [],
      unchanged: spec.entries
        .filter((entry) => existingById.has(entry.id))
        .map((entry) => entry.id),
      conflicts,
      excluded: spec.excluded,
      snapshot: null,
      links,
      untouchedVersionIds,
    };
  }

  // 4) Критическая секция P2-FIX-002 (под замком VERSIONS): фактический
  // результат вычисляется здесь, на актуальном состоянии данных. Параллельные
  // импорты сериализуются этим же замком (оба проходят через секцию);
  // вложенный замок PRICE_ITEMS — другой файл, циклов нет (ни PRICE_ITEMS,
  // ни AUDIT не берут замок VERSIONS) => взаимоблокировки исключены.
  const outcome = await updateCollection<PricingVersion, ImportOutcome>(
    VERSIONS,
    async (versions) => {
      const fresh = await readCollection<PriceItem>(PRICE_ITEMS);
      const freshById = new Map(fresh.map((item) => [item.id, item]));
      const missingNow = spec.entries.filter(
        (entry) => !freshById.has(entry.id),
      );

      // Определения: добавить отсутствующие (существующие не изменяются);
      // факт добавления возвращается из-под замка PRICE_ITEMS.
      let addedRecords: PriceItem[] = [];
      if (missingNow.length > 0) {
        addedRecords = await updateCollection<PriceItem, PriceItem[]>(
          PRICE_ITEMS,
          (items) => {
            const present = new Set(items.map((item) => item.id));
            const toAdd = missingNow
              .filter((entry) => !present.has(entry.id))
              .map((entry) => specItem(entry, actor));
            return { items: [...items, ...toAdd], result: toAdd };
          },
        );
      }
      const merged =
        addedRecords.length > 0 ? [...fresh, ...addedRecords] : fresh;

      // Draft snapshot: ровно active ∧ used, суммы — из спецификации;
      // по актуальному состоянию, а не по чтению до замка (P2-FIX-002).
      const activeUsed = merged.filter(
        (item) => item.status === "active" && item.usage === "used",
      );
      const snapshotItems = activeUsed.map((item) => {
        if (LEGACY_IMPORT_EXCLUDED_IDS.has(item.id)) {
          const amount = legacySnapshotAmount(versions, item.id);
          if (amount === undefined) {
            throw new Error(
              `Импорт: для legacy-ставки "${item.id}" нет исторической суммы в существующих версиях — снимок не может быть собран без выдумывания цены.`,
            );
          }
          return { priceItemId: item.id, amount };
        }
        const entry = specByRef.get(item.sourceRef);
        if (!entry) {
          throw new Error(
            `Импорт: для активной used-ставки "${item.id}" не найден источник суммы (sourceRef "${item.sourceRef}").`,
          );
        }
        return { priceItemId: item.id, amount: entry.value };
      });
      const canonical = canonicalSnapshot(snapshotItems);
      const signedAdjustments = buildSignedAdjustments();
      const signedCanonical = JSON.stringify(signedAdjustments);

      // Мутация versions напрямую: это уже наша критическая секция —
      // отдельный updateCollection(VERSIONS) здесь был бы рекурсивным
      // захватом того же замка (взаимоблокировка).
      const current = versions.find((version) => version.id === target);
      const draftCreated = current === undefined;
      const draftUpdated =
        current !== undefined &&
        (canonicalSnapshot(current.snapshot) !== canonical ||
          JSON.stringify(current.signedAdjustments ?? []) !== signedCanonical);
      let nextVersions = versions;
      if (draftCreated) {
        nextVersions = [
          ...versions,
          pricingVersionSchema.parse({
            id: target,
            label: `Импорт src/content/* (PRICING ${PRICING.version})`,
            status: "draft",
            snapshot: snapshotItems,
            rules: {
              rounding: PRICING.rounding,
              minOrder: PRICING.minOrder,
              complexityPerExtraModule:
                PRICING.kitchen.complexityPerExtraModule,
              complexityMax: PRICING.kitchen.complexityMax,
              bodyFactor: PRICING.wardrobe.bodyFactor,
              // §8.7: одно поле; kitchen/wardrobe совпадают (60).
              bodyDepthReference: PRICING.kitchen.bodyDepthReference,
            },
            signedAdjustments,
            promos: PROMOS.map((promo) => ({
              code: promo.code,
              title: promo.title,
              description: promo.description,
              type: promo.type,
              value: promo.value,
              minSubtotal: promo.minSubtotal,
              ...(promo.maxDiscount !== undefined
                ? { maxDiscount: promo.maxDiscount }
                : {}),
              appliesTo: promo.appliesTo,
              active: promo.active,
              demo: promo.demo,
            })),
            baseSchema: SUPPORTED_SCHEMA_VERSION,
            createdAt: new Date().toISOString(),
            createdBy: actor.actorId,
          }),
        ];
      } else if (current !== undefined && draftUpdated) {
        const candidate = pricingVersionSchema.parse({
          ...current,
          snapshot: snapshotItems,
          signedAdjustments,
        });
        nextVersions = versions.map((version) =>
          version.id === target ? candidate : version,
        );
      }

      return {
        items: nextVersions,
        result: {
          addedIds: addedRecords.map((item) => item.id),
          // «unchanged» = существовавшие ДО этого вызова (контракт отчёта:
          // imported + unchanged = specTotal); свежедобавленные считаются
          // импортированными, а не неизменными (P2-FIX-002).
          unchangedIds: spec.entries
            .filter((entry) => freshById.has(entry.id))
            .map((entry) => entry.id),
          draftCreated,
          draftUpdated,
          snapshot: {
            versionId: target,
            created: draftCreated,
            updated: draftUpdated,
            entries: snapshotItems.length,
          },
          untouchedVersionIds: nextVersions
            .filter((version) => version.id !== target)
            .map((version) => version.id),
        },
      };
    },
  );

  // 5) Аудит ПОСЛЕ записи («данные → журнал», §13.2/R-09):
  // - diagnostic.run — на каждый запуск, претендовавший на изменения
  //   (preMissingCount по предварительному чтению) либо изменивший draft;
  //   payload — ФАКТИЧЕСКИЙ результат именно этого вызова (P2-FIX-002);
  // - pricing.create — строго при фактическом создании draft (outcome),
  //   ровно одно событие на факт независимо от числа конкурентов.
  if (preMissingCount > 0 || outcome.draftCreated || outcome.draftUpdated) {
    await appendAuditEvent({
      action: "diagnostic.run",
      entityType: "priceItem",
      entityId: "import",
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      result: "ok",
      newValue: {
        imported: outcome.addedIds.length,
        specTotal: spec.entries.length,
        snapshot: outcome.snapshot.entries,
        ...(outcome.draftCreated ? { createdVersion: target } : {}),
      },
    });
  }
  if (outcome.draftCreated) {
    await appendAuditEvent({
      action: "pricing.create",
      entityType: "pricingVersion",
      entityId: target,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      result: "ok",
      newValue: {
        id: target,
        status: "draft",
        snapshot: outcome.snapshot.entries,
      },
    });
  }

  return {
    specTotal: spec.entries.length,
    imported: outcome.addedIds,
    unchanged: outcome.unchangedIds,
    conflicts: [],
    excluded: spec.excluded,
    snapshot: outcome.snapshot,
    links,
    untouchedVersionIds: outcome.untouchedVersionIds,
  };
}

/**
 * Отчёт по связям `priceRef` (R-15): точное совпадение id → `matched`
 * (кандидат, ≠ resolved); отсутствует/нет priceRef → `unresolved`.
 * Сопоставление по amount не выполняется.
 */
function buildLinks(
  presets: Array<Record<string, unknown>>,
  existingById: Map<string, PriceItem>,
  specById: Map<string, SpecEntry>,
): PriceItemImportReport["links"] {
  const matched: PriceItemImportReport["links"]["matched"] = [];
  const unresolved: PriceItemImportReport["links"]["unresolved"] = [];

  // Контентные пресеты (KITCHEN_MODULES): priceRef в источнике отсутствует.
  for (const key of Object.keys(KITCHEN_MODULES)) {
    unresolved.push({
      preset: `kitchen:${key}`,
      reason:
        "priceRef отсутствует в источнике (KITCHEN_MODULES.basePrice) — связь не создаётся; совпадение amount не является доказательством (R-15)",
    });
  }

  // Админ-пресеты: контракт priceRef → PriceItem.id (точное совпадение).
  for (const preset of presets) {
    const name = `${String(preset.family)}:${String(preset.id)}`;
    const priceRef = preset.priceRef;
    if (typeof priceRef !== "string" || priceRef.length === 0) {
      unresolved.push({ preset: name, reason: "priceRef не задан" });
      continue;
    }
    if (existingById.has(priceRef) || specById.has(priceRef)) {
      matched.push({ preset: name, priceRef });
    } else {
      unresolved.push({
        preset: name,
        reason: `PriceItem "${priceRef}" не найден`,
      });
    }
  }

  return { matched, unresolved };
}
