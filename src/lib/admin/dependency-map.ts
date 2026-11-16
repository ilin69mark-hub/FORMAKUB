/**
 * CA-T-206: подтверждённая карта «источник → формула/компонент».
 *
 * Источники: CALCULATOR_TECHNICAL_AUDIT.md §3 (реестр формул), §5 (карта
 * «параметр → формула»), §4 (использование ставок), §6 (дубли → syncRisk)
 * + фактический код (`src/lib/configurator/*`, `src/content/*`).
 *
 * Схема строк = `parameterDependencySchema` (CA-T-201, дизайн §6.8):
 * sourceType ∈ {parameter, priceItem, preset, catalogItem},
 * targetType ∈ {calculation, visualization, validation},
 * effect ∈ {price, geometry, validation, visualization, none}.
 *
 * Статусы доказательства (`evidence` — не поле записи графа, служебное
 * поле карты для импорта/диагностики):
 *  - CONFIRMED — потребление подтверждено кодом/аудитом (file:function);
 *  - PARTIAL   — частичное доказательство;
 *  - UNKNOWN   — потребитель не верифицирован → НЕ импортируется
 *                (см. UNKNOWN_SOURCES);
 *  - NOT_USED  — аудит подтверждает отсутствие влияния → импортируется
 *                как мёртвый источник `effect=none` (§6.8 п.1).
 *
 * Идентификаторы `parameter` провизорны: сид реестра AdminParameter в
 * проекте отсутствует (C3/ADR-04) — взята вокабуляра §5 аудита (имена
 * полей config). `catalogItem`/`preset` sourceId = составной ключ
 * (catalog:id) / (family:id) — пара из дизайна §6.8 п.1.
 */

export type EvidenceStatus = "CONFIRMED" | "PARTIAL" | "UNKNOWN" | "NOT_USED";
export type DependencyEffect = "price" | "geometry" | "validation" | "visualization" | "none";
export type DependencySourceType = "parameter" | "priceItem" | "preset" | "catalogItem";
export type DependencyTargetType = "calculation" | "visualization" | "validation";

export interface MapRow {
  sourceType: DependencySourceType;
  sourceId: string;
  targetType: DependencyTargetType;
  targetId: string;
  /** Путь к файлу-потребителю/владельцу, относительно src/. */
  targetFile: string;
  /** Имя функции либо имя константы-компонента. */
  targetFunction: string;
  effect: DependencyEffect;
  evidence: EvidenceStatus;
  syncRisk: boolean;
  duplicatedIn?: string[];
  note?: string;
}

/** ─── Реестр формул (§3 аудита: 17 основных + вспомогательные) ─────────── */

export interface FormulaRegistryEntry {
  id: string;
  file: string;
  family: "kitchen" | "wardrobe" | "shared";
  /** Одна из 17 основных строк §3 — участвует в критерии покрытия. */
  primary: boolean;
}

function fm(id: string, file: string, family: FormulaRegistryEntry["family"], primary = false): FormulaRegistryEntry {
  return { id, file, family, primary };
}

const PRICING = "lib/configurator/pricing.ts";
const SINK = "lib/configurator/sink.ts";
const VALID = "lib/configurator/validation.ts";
const DEF = "lib/configurator/defaults.ts";
const SUP = "lib/configurator/supports.ts";
const LIGHT = "lib/configurator/lighting.ts";

export const FORMULA_REGISTRY: FormulaRegistryEntry[] = [
  // Основные (17 строк §3).
  fm("calculateKitchenPrice", PRICING, "kitchen", true),
  fm("calculateWardrobePrice", PRICING, "wardrobe", true),
  fm("calculatePrice", PRICING, "shared", true),
  fm("calculatePromo", PRICING, "kitchen", true),
  fm("roundMoney", PRICING, "shared", true),
  fm("area", PRICING, "kitchen", true),
  fm("doorCountForWidth", PRICING, "kitchen", true),
  fm("kitchenTotalWidth", PRICING, "kitchen", true),
  fm("computeSupports", SUP, "kitchen", true),
  fm("computeLighting", LIGHT, "kitchen", true),
  fm("sinkGeometry", SINK, "kitchen", true),
  fm("sinkLayout", SINK, "kitchen", true),
  fm("validateSinkLayout", SINK, "kitchen"),
  fm("sinkFacadeTotals", SINK, "kitchen", true),
  fm("sinkRowMargins", SINK, "kitchen", true),
  fm("normalizeSinkModule", SINK, "kitchen", true),
  fm("normalizeKitchen", DEF, "kitchen", true),
  fm("validateConfig", VALID, "shared", true),
  // Вторичные имена строк §3 (цели рёбер допустимы).
  fm("applyPromo", PRICING, "kitchen"),
  fm("formatRange", PRICING, "shared"),
  fm("bodyRate", PRICING, "shared"),
  fm("facadeRate", PRICING, "shared"),
  fm("styleMultiplier", PRICING, "shared"),
  fm("handleRate", PRICING, "shared"),
  fm("kitchenDoorCount", PRICING, "kitchen"),
  fm("kitchenCountertopWidth", PRICING, "kitchen"),
  fm("wardrobeWidth", PRICING, "wardrobe"),
  fm("positionsForModule", SUP, "kitchen"),
  fm("supportsForModule", SUP, "kitchen"),
  fm("availableLength", LIGHT, "kitchen"),
  fm("countRuns", LIGHT, "kitchen"),
  fm("buildSections", SINK, "kitchen"),
  fm("computeFacadeBoxes", SINK, "kitchen"),
  fm("applyBottleCut", SINK, "kitchen"),
  fm("resolvePartitionBox", SINK, "kitchen"),
  fm("partitionBoxForSide", SINK, "kitchen"),
  fm("distributeDoors", SINK, "kitchen"),
  fm("autoPartitionSides", SINK, "kitchen"),
  fm("sinkRowContext", SINK, "kitchen"),
  fm("maxSinkWidthFor", SINK, "kitchen"),
  fm("maxSinkDepthFor", SINK, "kitchen"),
  fm("normalizeSinkStorage", SINK, "kitchen"),
  fm("resolveDrawerCount", SINK, "kitchen"),
  fm("normalizeKitchenDepth", DEF, "kitchen"),
  fm("normalizePlinthOptions", DEF, "kitchen"),
  fm("normalizeLighting", DEF, "kitchen"),
  fm("normalizeSupportSettings", DEF, "kitchen"),
  fm("validateKitchen", VALID, "kitchen"),
  fm("validateWardrobe", VALID, "wardrobe"),
  fm("validateSinkModule", VALID, "kitchen"),
  fm("validateSinkGeometry", VALID, "kitchen"),
  // Вспомогательные §3.
  fm("plinthRatePerMeter", "content/plinth.ts", "kitchen"),
  fm("snapPlinthThickness", "content/plinth.ts", "kitchen"),
  fm("snapPlinthFinish", "content/plinth.ts", "kitchen"),
  fm("snapCountertopThickness", "content/catalog.ts", "kitchen"),
  fm("findCountertop", "content/catalog.ts", "kitchen"),
  fm("nextShelfPosition", DEF, "wardrobe"),
  fm("sectionOuterWidth", SINK, "kitchen"),
  fm("sectionFitsDrawers", SINK, "kitchen"),
  fm("isBottleEdgeSection", SINK, "kitchen"),
  fm("doorCount", "components/configurator/KitchenScene.tsx", "kitchen"),
];

/**
 * Основные формулы, исключённые из проверяемого множества покрытия
 * (с формальной точки зрения у них нет ребра от данных сущностей).
 * Покрытие считается по `primary ∧ ¬excluded`; исключения показываются
 * отдельно в диагностике — «полнота» объявляется только без UNKNOWN/PARTIAL.
 */
export const EXCLUDED_FORMULAS: { id: string; reason: string }[] = [
  {
    id: "calculatePrice",
    reason: "диспетчер §3 №3: зависит от формул 1–2, не потребляет параметры/справочники",
  },
  {
    id: "roundMoney",
    reason: "источник — PRICING.rounding = PricingVersion.rules (§7.2 commercial_ref, не AdminParameter; sourceType модели не содержит pricingVersion)",
  },
];

/** ─── Реестр компонентов (§6.8 п.1: `component:<file:имя>`) ────────────── */

export interface ComponentRegistryEntry {
  id: string;
  file: string;
  name: string;
  /** Читается валидацией (§3 №17) → targetType=validation. */
  validation: boolean;
}

function comp(file: string, name: string, validation = false): ComponentRegistryEntry {
  return { id: `component:${file}:${name}`, file, name, validation };
}

export const COMPONENT_REGISTRY: ComponentRegistryEntry[] = [
  comp("content/catalog.ts", "KITCHEN_MODULES", true),
  comp("content/catalog.ts", "KITCHEN_LIMITS", true),
  comp("content/catalog.ts", "WARDROBE_LIMITS", true),
  comp("lib/configurator/sink.ts", "SINK_RULES", true),
  comp("content/catalog.ts", "COUNTERTOPS"),
  comp("content/catalog.ts", "DOOR_STYLES"),
  comp("content/catalog.ts", "HANDLES"),
  comp("content/catalog.ts", "BODY_MATERIALS"),
  comp("content/catalog.ts", "FACADE_MATERIALS"),
  comp("content/pricing.ts", "PRICING"),
  comp("content/pricing.ts", "PROMOS"),
  comp("content/supports.ts", "SUPPORT_SYSTEMS"),
  comp("content/lighting.ts", "LED_STRIPS"),
  comp("content/plinth.ts", "PLINTH_MATERIALS"),
];

/** ─── Строки карты ─────────────────────────────────────────────────────── */

/** Строка-параметр → формула. */
function p(
  sourceId: string,
  targetId: string,
  targetFile: string,
  effect: DependencyEffect,
  evidence: EvidenceStatus = "CONFIRMED",
  extra: Partial<Pick<MapRow, "syncRisk" | "duplicatedIn" | "note">> = {},
): MapRow {
  return {
    sourceType: "parameter",
    sourceId,
    targetType: "calculation",
    targetId,
    targetFile,
    targetFunction: targetId,
    effect,
    evidence,
    syncRisk: extra.syncRisk ?? false,
    ...(extra.duplicatedIn ? { duplicatedIn: extra.duplicatedIn } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  };
}

/** Строка-параметр → компонент. */
function pc(
  sourceId: string,
  targetFile: string,
  name: string,
  effect: DependencyEffect,
  evidence: EvidenceStatus = "CONFIRMED",
  extra: Partial<Pick<MapRow, "syncRisk" | "duplicatedIn" | "note">> = {},
): MapRow {
  const entry = COMPONENT_REGISTRY.find((item) => item.id === `component:${targetFile}:${name}`);
  return {
    sourceType: "parameter",
    sourceId,
    targetType: entry?.validation ? "validation" : "visualization",
    targetId: `component:${targetFile}:${name}`,
    targetFile,
    targetFunction: name,
    effect,
    evidence,
    syncRisk: extra.syncRisk ?? false,
    ...(extra.duplicatedIn ? { duplicatedIn: extra.duplicatedIn } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  };
}

/** Строка-элемент справочника → формула. */
function ci(
  catalog: string,
  id: string,
  targetId: string,
  targetFile: string,
  effect: DependencyEffect,
  evidence: EvidenceStatus = "CONFIRMED",
  extra: Partial<Pick<MapRow, "syncRisk" | "duplicatedIn" | "note">> = {},
): MapRow {
  return {
    sourceType: "catalogItem",
    sourceId: `${catalog}:${id}`,
    targetType: "calculation",
    targetId,
    targetFile,
    targetFunction: targetId,
    effect,
    evidence,
    syncRisk: extra.syncRisk ?? false,
    ...(extra.duplicatedIn ? { duplicatedIn: extra.duplicatedIn } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  };
}

/** Строка-элемент справочника → компонент. */
function cic(
  catalog: string,
  id: string,
  targetFile: string,
  name: string,
  effect: DependencyEffect,
  evidence: EvidenceStatus = "CONFIRMED",
): MapRow {
  const entry = COMPONENT_REGISTRY.find((item) => item.id === `component:${targetFile}:${name}`);
  return {
    sourceType: "catalogItem",
    sourceId: `${catalog}:${id}`,
    targetType: entry?.validation ? "validation" : "visualization",
    targetId: `component:${targetFile}:${name}`,
    targetFile,
    targetFunction: name,
    effect,
    evidence,
    syncRisk: false,
  };
}

/** Строка-пресет → формула/компонент. */
function pr(
  family: string,
  id: string,
  targetKind: "formula" | "component",
  targetId: string,
  targetFile: string,
  effect: DependencyEffect,
  evidence: EvidenceStatus = "CONFIRMED",
  note?: string,
): MapRow {
  return {
    sourceType: "preset",
    sourceId: `${family}:${id}`,
    targetType: targetKind === "formula" ? "calculation" : "validation",
    targetId,
    targetFile,
    targetFunction: targetKind === "formula" ? targetId : targetId.split(":").pop() ?? targetId,
    effect,
    evidence,
    syncRisk: false,
    ...(note ? { note } : {}),
  };
}

const SUPPORT_DUP = ["src/content/supports.ts:SUPPORT_SYSTEMS", "src/lib/configurator/config.supports"];
const PLINTH_DUP = ["src/content/pricing.ts:PRICING.wardrobe.plinthPerMeter", "src/content/plinth.ts:plinthRatePerMeter"];
const THICK_DUP = ["src/lib/configurator/lighting.ts:computeLighting", "src/components/configurator/KitchenScene.tsx"];

/**
 * Подтверждённая карта. Один U-ключ (sourceType, sourceId, targetType,
 * targetId) — одна строка; эффект один на ребро (множественные влияния
 * отражаются разными рёбрами на разные формулы).
 */
export const MAP_ROWS: MapRow[] = [
  // ── §5 №1/2: modules[].width/height/depth ──
  p("modules", "calculateKitchenPrice", PRICING, "price"),
  p("modules", "area", PRICING, "geometry", "CONFIRMED", { note: "area(w,h) §3 №6" }),
  p("modules", "kitchenTotalWidth", PRICING, "geometry"),
  p("modules", "doorCountForWidth", PRICING, "price", "CONFIRMED", { note: "CA-T-517: единый facadeDoorCount в facade-geometry.ts" }),
  p("modules", "validateSinkLayout", SINK, "validation"),
  // ── §5 №13: modules.length → complexityFactor ──
  p("modules.length", "calculateKitchenPrice", PRICING, "price", "CONFIRMED", { note: "complexityFactor = min(1.12, 1 + extra×0.02) (pricing.ts:308)" }),
  pc("modules.length", "content/catalog.ts", "KITCHEN_LIMITS", "validation", "CONFIRMED", { note: "maxModules=25 (KITCHEN_LIMITS) в валидации (§3 №17)" }),
  // ── §5 №3: sinkWidth/Depth/Position/Offset/Cutout ──
  p("sinkWidth", "sinkGeometry", SINK, "geometry"),
  p("sinkWidth", "sinkLayout", SINK, "geometry"),
  p("sinkWidth", "calculateKitchenPrice", PRICING, "price", "CONFIRMED", { note: "frontsCost/fittingsCost через sinkLayout" }),
  p("sinkWidth", "normalizeSinkModule", SINK, "validation"),
  p("sinkWidth", "validateSinkGeometry", VALID, "validation", "CONFIRMED", { note: "чтение sinkWidth (validation.ts:362)" }),
  pc("sinkWidth", SINK, "SINK_RULES", "validation", "CONFIRMED", { note: "CA-T-517: зазоры из единого facade-geometry.ts" }),
  p("sinkDepth", "sinkGeometry", SINK, "geometry"),
  p("sinkDepth", "sinkLayout", SINK, "geometry"),
  p("sinkDepth", "calculateKitchenPrice", PRICING, "price"),
  p("sinkDepth", "validateSinkGeometry", VALID, "validation"),
  pc("sinkDepth", SINK, "SINK_RULES", "validation", "CONFIRMED", { note: "CA-T-517: зазоры из единого facade-geometry.ts" }),
  p("sinkPosition", "sinkGeometry", SINK, "geometry"),
  p("sinkPosition", "sinkRowMargins", SINK, "geometry"),
  p("sinkPosition", "sinkLayout", SINK, "geometry"),
  p("sinkPosition", "calculateKitchenPrice", PRICING, "price"),
  p("sinkPosition", "validateSinkGeometry", VALID, "validation"),
  pc("sinkPosition", SINK, "SINK_RULES", "validation", "CONFIRMED", { note: "CA-T-517: зазоры из единого facade-geometry.ts" }),
  p("sinkOffset", "sinkGeometry", SINK, "geometry"),
  p("sinkOffset", "sinkLayout", SINK, "geometry"),
  p("sinkOffset", "calculateKitchenPrice", PRICING, "price"),
  p("sinkOffset", "validateSinkGeometry", VALID, "validation"),
  p("sinkCutout", "sinkGeometry", SINK, "geometry"),
  p("sinkCutout", "calculateKitchenPrice", PRICING, "price", "CONFIRMED", { note: "PRICING.kitchen.sinkCutout (pricing.ts:237)" }),
  p("sinkCutout", "validateSinkGeometry", VALID, "validation", "CONFIRMED", { note: "проверка выреза (validation.ts:421)" }),
  // ── §5 №4: sinkStorage[] ──
  p("sinkStorage", "autoPartitionSides", SINK, "geometry"),
  p("sinkStorage", "buildSections", SINK, "geometry"),
  p("sinkStorage", "sinkLayout", SINK, "geometry"),
  p("sinkStorage", "sinkFacadeTotals", SINK, "visualization"),
  p("sinkStorage", "normalizeSinkStorage", SINK, "validation"),
  p("sinkStorage", "validateSinkModule", VALID, "validation", "CONFIRMED", { note: "чтение sinkStorage (validation.ts:254)" }),
  p("sinkStorage", "calculateKitchenPrice", PRICING, "price", "CONFIRMED", { note: "полки/ящики секций → optionsCost/fittingsCost (§5 №4)" }),
  // ── §5 №6: handle/hinge/pushToOpen ──
  p("hinge", "calculateKitchenPrice", PRICING, "price", "CONFIRMED", { note: "hingePerDoor/softClosePerDoor (pricing.ts:212-214)" }),
  p("pushToOpen", "calculateKitchenPrice", PRICING, "price", "CONFIRMED", { note: "pushToOpenPerDoor (pricing.ts:217)" }),
  // ── §5 №7: countertop ──
  p("countertop", "calculateKitchenPrice", PRICING, "price", "CONFIRMED", { note: "kitchenCountertopWidth × ratePerLinearMeter (§5 №7)" }),
  pc("countertop", "content/catalog.ts", "COUNTERTOPS", "visualization"),
  // ── §5 №8: countertopThickness (стоимость «нет» — §5 №8) ──
  p("countertopThickness", "computeLighting", LIGHT, "geometry", "CONFIRMED", { syncRisk: true, duplicatedIn: THICK_DUP, note: "counterCm (lighting.ts:131); §5 №1: противоречие 2D/подсветка" }),
  p("countertopThickness", "normalizeKitchen", DEF, "validation", "CONFIRMED", { note: "snapCountertopThickness (§3 №16)" }),
  p("countertopThickness", "validateConfig", VALID, "validation", "CONFIRMED", { note: "диапазон 4–50 (аудит §2, kitchenConfigSchema)" }),
  // ── §5 №9/10: plinth/plinthMaterial/plinthFinish/plinthHeight ──
  p("plinth", "plinthRatePerMeter", "content/plinth.ts", "price", "CONFIRMED", { syncRisk: true, duplicatedIn: PLINTH_DUP, note: "ставка × ширина ряда (§5 №9); дубль механизмов цоколя (аудит §3)" }),
  p("plinthMaterial", "plinthRatePerMeter", "content/plinth.ts", "price"),
  pc("plinthMaterial", "content/plinth.ts", "PLINTH_MATERIALS", "visualization"),
  p("plinthFinish", "plinthRatePerMeter", "content/plinth.ts", "price", "CONFIRMED", { note: "rateDelta отделки (plinth.ts:136)" }),
  // ── §5 №11: supports.systemId/maxSpan/maxLoad ──
  p("supports.systemId", "computeSupports", SUP, "price", "CONFIRMED", { syncRisk: true, duplicatedIn: SUPPORT_DUP, note: "config.supports против каталога (аудит §3): конфиг приоритетнее" }),
  pc("supports.systemId", "content/supports.ts", "SUPPORT_SYSTEMS", "visualization"),
  p("supports.maxSpan", "computeSupports", SUP, "price", "CONFIRMED", { syncRisk: true, duplicatedIn: SUPPORT_DUP }),
  p("supports.maxLoad", "computeSupports", SUP, "price", "CONFIRMED", { syncRisk: true, duplicatedIn: SUPPORT_DUP }),
  // ── §5 №12: lighting.* ──
  p("lighting", "computeLighting", LIGHT, "price", "CONFIRMED", { note: "компонента/БП → cost (§5 №12)" }),
  pc("lighting", "content/lighting.ts", "LED_STRIPS", "visualization"),
  // ── §5 №5: bodyMaterial/facadeMaterial/facadeStyle (config-выбор) ──
  p("bodyMaterial", "bodyRate", PRICING, "price", "CONFIRMED", { note: "CA-T-514: при расчёте всегда используется фиксированный ldsp; legacy bodyMaterial не влияет" }),
  p("bodyMaterial", "calculateWardrobePrice", PRICING, "price", "CONFIRMED", { note: "CA-T-514: при расчёте всегда используется фиксированный ldsp; legacy bodyMaterial не влияет" }),
  pc("bodyMaterial", "content/catalog.ts", "BODY_MATERIALS", "visualization"),
  p("facadeMaterial", "facadeRate", PRICING, "price", "CONFIRMED", { note: "facadeRate (pricing.ts:47)" }),
  pc("facadeMaterial", "content/catalog.ts", "FACADE_MATERIALS", "visualization"),
  p("facadeStyle", "styleMultiplier", PRICING, "price", "CONFIRMED", { note: "styleMultiplier (pricing.ts:51)" }),
  pc("facadeStyle", "content/catalog.ts", "DOOR_STYLES", "visualization"),
  p("handle", "handleRate", PRICING, "price", "CONFIRMED", { note: "handleRate (pricing.ts:55)" }),
  pc("handle", "content/catalog.ts", "HANDLES", "visualization"),
  // ── §5 №14: promoCode ──
  p("promoCode", "calculatePromo", PRICING, "price"),
  p("promoCode", "calculateKitchenPrice", PRICING, "price", "CONFIRMED", { note: "discount → total (§5 №14)" }),
  pc("promoCode", "content/pricing.ts", "PROMOS", "visualization"),
  // ── §5 №15: sidePanels ──
  p("sidePanels", "calculateKitchenPrice", PRICING, "price", "CONFIRMED", { note: "×PRICING.kitchen.sidePanel (pricing.ts:274)" }),
  // ── §4 №7/8/10/13 + §5 «не влияют»: мёртвые источники (effect=none) ──
  p("PRICING.kitchen.countertopDepthAllowance", "calculateKitchenPrice", PRICING, "none", "NOT_USED", { note: "аудит §4 №7: ставка не читается" }),
  p("PRICING.kitchen.plinthPerMeter", "calculateKitchenPrice", PRICING, "none", "NOT_USED", { note: "аудит §4 №8: кухня берёт content/plinth.ts" }),
  p("PRICING.kitchen.underCabinetLightPerMeter", "calculateKitchenPrice", PRICING, "none", "NOT_USED", { note: "аудит §4 №10: заменено компонентной спецификацией" }),
  p("PRICING.kitchen.sinkPartition", "calculateKitchenPrice", PRICING, "none", "NOT_USED", { note: "аудит §4 №13: перегородки бесплатны" }),
  p("KITCHEN_LIMITS.minCountertopMeters", "calculateKitchenPrice", PRICING, "none", "NOT_USED", { note: "аудит §5: не читается (только объявление)" }),
  pc("PRICING.kitchen.sinkPartition", "content/pricing.ts", "PRICING", "none", "NOT_USED", { note: "ставка живёт в компоненте PRICING, влияния нет (§4 №13)" }),

  // ── Элементы справочников (реальные id src/content/*) ──
  ci("bodyMaterial", "ldsp", "bodyRate", PRICING, "price"),
  ci("facadeMaterial", "ldsp", "facadeRate", PRICING, "price"),
  ci("facadeMaterial", "mdf", "facadeRate", PRICING, "price"),
  ci("facadeMaterial", "mdf_pvc", "facadeRate", PRICING, "price"),
  ci("facadeStyle", "flat", "styleMultiplier", PRICING, "price"),
  ci("facadeStyle", "shaker", "styleMultiplier", PRICING, "price"),
  ci("facadeStyle", "handleless", "styleMultiplier", PRICING, "price"),
  ci("handle", "bar", "handleRate", PRICING, "price"),
  ci("handle", "knob", "handleRate", PRICING, "price"),
  ci("handle", "profile", "handleRate", PRICING, "price"),
  ci("handle", "none", "handleRate", PRICING, "price"),
  ci("countertop", "ldsp_hpl", "calculateKitchenPrice", PRICING, "price"),
  ci("countertop", "compact_hpl", "calculateKitchenPrice", PRICING, "price"),
  ci("countertop", "acrylic", "calculateKitchenPrice", PRICING, "price"),
  ci("countertop", "quartz", "calculateKitchenPrice", PRICING, "price"),
  ci("countertop", "porcelain", "calculateKitchenPrice", PRICING, "price"),
  ci("countertop", "solid_wood", "calculateKitchenPrice", PRICING, "price"),
  ci("plinthMaterial", "ldsp", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthMaterial", "mdf", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthMaterial", "plastic", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthMaterial", "aluminum", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthMaterial", "stainless", "plinthRatePerMeter", "content/plinth.ts", "price"),
  cic("plinthMaterial", "ldsp", "content/plinth.ts", "PLINTH_MATERIALS", "visualization"),
  cic("plinthMaterial", "mdf", "content/plinth.ts", "PLINTH_MATERIALS", "visualization"),
  cic("plinthMaterial", "plastic", "content/plinth.ts", "PLINTH_MATERIALS", "visualization"),
  cic("plinthMaterial", "aluminum", "content/plinth.ts", "PLINTH_MATERIALS", "visualization"),
  cic("plinthMaterial", "stainless", "content/plinth.ts", "PLINTH_MATERIALS", "visualization"),
  ci("plinthFinish", "pvc2", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthFinish", "pvc04", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthFinish", "paint", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthFinish", "film", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthFinish", "mat", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthFinish", "gloss", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthFinish", "anodized", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthFinish", "powder", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthFinish", "brushed", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthFinish", "mirror", "plinthRatePerMeter", "content/plinth.ts", "price"),
  ci("plinthMount", "clips", "computeSupports", SUP, "price", "CONFIRMED", { note: "клипсы цоколя (supports.ts:269)" }),
  ci("plinthMount", "hidden", "computeSupports", SUP, "price", "CONFIRMED", { note: "винты скрытого крепления (supports.ts:270)" }),
  ci("supportSystem", "standard", "computeSupports", SUP, "price", "CONFIRMED", { syncRisk: true, duplicatedIn: SUPPORT_DUP }),
  ci("supportSystem", "heavy", "computeSupports", SUP, "price", "CONFIRMED", { syncRisk: true, duplicatedIn: SUPPORT_DUP }),
  cic("supportSystem", "standard", "content/supports.ts", "SUPPORT_SYSTEMS", "visualization"),
  cic("supportSystem", "heavy", "content/supports.ts", "SUPPORT_SYSTEMS", "visualization"),
  ci("ledStrip", "led-24v-4w8", "computeLighting", LIGHT, "price"),
  ci("ledStrip", "led-24v-9w6", "computeLighting", LIGHT, "price"),
  ci("ledStrip", "led-24v-14w4", "computeLighting", LIGHT, "price"),
  ci("ledStrip", "led-24v-19w2", "computeLighting", LIGHT, "price"),
  ci("ledStrip", "led-12v-4w8", "computeLighting", LIGHT, "price"),
  ci("ledStrip", "led-12v-9w6", "computeLighting", LIGHT, "price"),
  ci("ledStrip", "led-12v-14w4", "computeLighting", LIGHT, "price"),
  ci("ledStrip", "led-12v-19w2", "computeLighting", LIGHT, "price"),
  ci("ledProfile", "surface", "computeLighting", LIGHT, "visualization"),
  ci("ledProfile", "recessed", "computeLighting", LIGHT, "visualization"),
  ci("ledProfile", "corner", "computeLighting", LIGHT, "visualization"),
  ci("ledDiffuser", "clear", "computeLighting", LIGHT, "visualization"),
  ci("ledDiffuser", "frosted", "computeLighting", LIGHT, "visualization"),
  ci("ledControl", "switch", "computeLighting", LIGHT, "visualization"),
  ci("ledControl", "sensor", "computeLighting", LIGHT, "visualization"),
  ci("ledControl", "dimmer", "computeLighting", LIGHT, "visualization"),
  ci("promo", "DEMO10", "calculatePromo", PRICING, "price"),
  ci("promo", "WARDROBE7", "calculatePromo", PRICING, "price"),
  ci("promo", "DEMO5000", "calculatePromo", PRICING, "price"),

  // ── Пресеты модулей (CA-T-205; priceRef → preset.basePrice) ──
  pr("kitchen", "base", "formula", "calculateKitchenPrice", PRICING, "price", "PARTIAL", "priceRef → PriceItem (CA-T-207); движок читает KITCHEN_MODULES.basePrice контента — связь через priceRef частично подтверждена"),
  pr("kitchen", "base", "component", "component:content/catalog.ts:KITCHEN_MODULES", "content/catalog.ts", "validation", "CONFIRMED", "диапазоны KITCHEN_MODULES в валидации (§3 №17)"),
  pr("kitchen", "sink", "formula", "calculateKitchenPrice", PRICING, "price", "PARTIAL", "priceRef → PriceItem (CA-T-207); движок читает KITCHEN_MODULES.basePrice контента"),
  pr("kitchen", "sink", "component", "component:content/catalog.ts:KITCHEN_MODULES", "content/catalog.ts", "validation", "CONFIRMED"),
];

/**
 * Источники с неверифицированным потребителем: НЕ импортируются в граф,
 * показываются в отчёте диагностики как UNKNOWN (§6 задачи).
 */
export interface UnknownSource {
  sourceType: DependencySourceType;
  sourceId: string;
  reason: string;
}

export const UNKNOWN_SOURCES: UnknownSource[] = [
  {
    sourceType: "parameter",
    sourceId: "plinthHeight",
    reason: "§5 №10: влияет на 2D-геометрию, цена «нет»; файл/функция-потребитель не верифицированы",
  },
  {
    sourceType: "catalogItem",
    sourceId: "sinkSize:*",
    reason: "C5: content-источник размеров мойки отсутствует (KITCHEN_MODULES не содержит размеров)",
  },
  {
    sourceType: "catalogItem",
    sourceId: "ledPsu:*",
    reason: "id ставок LED_PSU_PRICE — числовые рейтинги, не подтверждены как CatalogItem.id",
  },
  {
    sourceType: "parameter",
    sourceId: "modules[].width",
    reason: "§5 №2 (счётчик дверей): отдельный id не выделен — отражено рёбрами sourceId=modules",
  },
];

/** U-ключ карты/графа (§6.8 п.2). */
export function mapKey(
  row: Pick<MapRow, "sourceType" | "sourceId" | "targetType" | "targetId">,
): string {
  return [row.sourceType, row.sourceId, row.targetType, row.targetId].join("|");
}

export interface MapFilter {
  sourceType?: DependencySourceType;
  sourceId?: string;
  targetType?: DependencyTargetType;
  targetId?: string;
  effect?: DependencyEffect;
  evidence?: EvidenceStatus;
}

export function filterMapRows(filter: MapFilter = {}): MapRow[] {
  return MAP_ROWS.filter(
    (row) =>
      (filter.sourceType === undefined || row.sourceType === filter.sourceType) &&
      (filter.sourceId === undefined || row.sourceId === filter.sourceId) &&
      (filter.targetType === undefined || row.targetType === filter.targetType) &&
      (filter.targetId === undefined || row.targetId === filter.targetId) &&
      (filter.effect === undefined || row.effect === filter.effect) &&
      (filter.evidence === undefined || row.evidence === filter.evidence),
  );
}
