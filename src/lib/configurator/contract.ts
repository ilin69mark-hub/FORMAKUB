import type { PromoDefinition } from "@/content/pricing";

import type { FurnitureConfig, PromoResult } from "./types";

/**
 * CA-T-302 — контракт входных данных Calculation Engine.
 *
 * Источник: ADR-06 Rev10 §5.8 (утверждено). Только типы и fail-closed
 * валидация; DataResolver, движок и формулы здесь не реализуются.
 *
 * Engine получает уже разрешённые данные: цены — через `priceSnapshot`,
 * ссылки на PriceItem разрешаются до вызова, display/Admin metadata в
 * контракт не входят.
 */

export type CatalogKind =
  | "bodyMaterial"
  | "facadeMaterial"
  | "facadeStyle"
  | "handle"
  | "countertop"
  | "plinthMaterial"
  | "plinthFinish"
  | "plinthMount"
  | "supportSystem"
  | "ledStrip"
  | "ledProfile"
  | "ledDiffuser"
  | "ledControl"
  | "ledPsu"
  | "sinkSize"
  | "promo";

export type PriceItemId = string;

export type EmptyAttrs = Record<never, never>;
export type EmptyPriceRefs = Record<never, never>;

export interface CatalogItemBase<K extends CatalogKind, A, R> {
  id: string;
  catalog: K;
  attrs: A;
  priceRefs: R;
}

export interface CountertopAttrs {
  thicknesses: readonly number[];
  defaultThickness: number;
}

export interface PlinthAttrs extends CountertopAttrs {
  finishIds: readonly string[];
}

export interface SupportAttrs {
  edgeInsetCm: number;
  maxSpanCm: number;
  maxLoadKgPerLeg: number;
  clipsPerLeg: number;
  screwsPerLeg: number;
  tallAnchorSpacingCm: number;
  tallCenterLegWidthCm: number;
}

export interface LedStripAttrs {
  power: number;
  voltage: 12 | 24;
  maxContinuousRunM: number;
  voltageDropPct: number;
  maxPsuW: number;
}

export interface IdAttrs {
  id: string;
}

export interface PsuAttrs {
  watt: number;
}

export type CatalogAttrsInput =
  | EmptyAttrs
  | CountertopAttrs
  | PlinthAttrs
  | SupportAttrs
  | LedStripAttrs
  | IdAttrs
  | PsuAttrs;

/**
 * Контракт Reference Data. `sinkSize`/`promo` намеренно не входят:
 * для `sinkSize` content-структура отсутствует, `promo` живёт в
 * `PricingVersion.promos`, а не в CatalogItem.
 */
export type CatalogItemInput =
  | CatalogItemBase<"bodyMaterial", EmptyAttrs, { ratePerSqm: PriceItemId }>
  | CatalogItemBase<"facadeMaterial", EmptyAttrs, { ratePerSqm: PriceItemId }>
  | CatalogItemBase<"facadeStyle", EmptyAttrs, { multiplier: PriceItemId }>
  | CatalogItemBase<"handle", EmptyAttrs, { rate: PriceItemId }>
  | CatalogItemBase<"countertop", CountertopAttrs, { ratePerLinearMeter: PriceItemId }>
  | CatalogItemBase<"plinthMaterial", PlinthAttrs, { ratePerMeter: PriceItemId }>
  | CatalogItemBase<"plinthFinish", IdAttrs, EmptyPriceRefs>
  | CatalogItemBase<"plinthMount", IdAttrs, EmptyPriceRefs>
  | CatalogItemBase<
      "supportSystem",
      SupportAttrs,
      {
        legPrice: PriceItemId;
        clipPrice: PriceItemId;
        screwPrice: PriceItemId;
        anchorPrice: PriceItemId;
      }
    >
  | CatalogItemBase<"ledStrip", LedStripAttrs, { pricePerMeter: PriceItemId }>
  | CatalogItemBase<"ledProfile", IdAttrs, { ratePerMeter: PriceItemId }>
  | CatalogItemBase<"ledDiffuser", IdAttrs, { ratePerMeter: PriceItemId }>
  | CatalogItemBase<"ledControl", IdAttrs, { price: PriceItemId }>
  | CatalogItemBase<"ledPsu", PsuAttrs, { price: PriceItemId }>;

export interface DimensionRange {
  min: number;
  max: number;
  default: number;
}

export interface ModulePresetInput {
  id: string;
  family: "kitchen" | "wardrobe";
  zone: "floor" | "upper";
  width: DimensionRange;
  height: DimensionRange;
  depth: DimensionRange;
  defaultShelves: number;
  defaultDrawers: number;
  /** Единственный источник base price: PriceItem → snapshot.amount. */
  priceRef: PriceItemId;
}

export type PlinthAdjustmentKey = `plinth:${string}:${string}`;

export interface SignedAdjustmentInput {
  /** «plinth:<materialId>:<finishId>» */
  key: PlinthAdjustmentKey;
  /** Signed; отрицательные значения допустимы. */
  amount: number;
}

export interface PriceRulesInput {
  rounding: number;
  minOrder: number;
  complexityPerExtraModule: number;
  complexityMax: number;
  bodyDepthReference: number;
  bodyFactor: number;
}

export interface PriceSnapshotInput {
  /** id PricingVersion. */
  priceVersion: string;
  snapshot: readonly { priceItemId: PriceItemId; amount: number }[];
  rules: PriceRulesInput;
  signedAdjustments: readonly SignedAdjustmentInput[];
  promos: readonly PromoDefinition[];
  /** Совместимость структуры снимка; не заменяет три версии контракта. */
  baseSchema: number;
}

export interface CalculationVersions {
  schemaVersion: number;
  calcVersion: string;
  priceVersion: string;
}

export interface CalculationInputs {
  priceSnapshot: PriceSnapshotInput;
  catalogs: readonly CatalogItemInput[];
  /** Временный контейнер: ключи обязаны входить в утверждённый реестр. */
  parameters: Readonly<Record<string, unknown>>;
  presets: readonly ModulePresetInput[];
  /**
   * Пятая группа (ADR-06 §5.3 addendum, ADR-07 §10.4): активный/закреплённый
   * снимок управляемых правил. `optional` — легаси-входы без слоя правил.
   */
  rulesSnapshot?: RulesSnapshotInput;
}

/* ─── ADR-07: контракт управляемых правил (Managed Assembly Rules) ─── */

export type ManagedRuleScope = "kitchen" | "wardrobe" | "shared";
export type ManagedRuleStatus = "draft" | "published" | "archived";
export type ManagedRuleSource = "preliminary" | "datasheet" | "owner_confirmed";
export type ManagedRuleCategory = "quantity" | "purpose" | "norm" | "condition";
export type ManagedRuleValueType = "int" | "decimal" | "boolean" | "enum" | "stringList";
export type ManagedRuleAffect = "price" | "quantity";

export type ManagedRuleConditionValue = string | number | boolean | readonly string[];

export interface ManagedRuleConditionPredicate {
  subject: string;
  operator: string;
  value: ManagedRuleConditionValue;
}

export type ManagedRuleCondition =
  | { all: readonly ManagedRuleCondition[] }
  | { any: readonly ManagedRuleCondition[] }
  | ManagedRuleConditionPredicate;

/** Логическая запись правила (ADR-07 §9, утверждено Q7-13). */
export interface ManagedRuleInput {
  id: string;
  name: string;
  description: string;
  category: ManagedRuleCategory;
  scope: ManagedRuleScope;
  condition: ManagedRuleCondition;
  assigns: string;
  value: ManagedRuleConditionValue;
  valueType: ManagedRuleValueType;
  unit?: string;
  status: ManagedRuleStatus;
  sourceRef: string;
  source: ManagedRuleSource;
  affects: readonly ManagedRuleAffect[];
  version: string;
}

/** Полный неизменяемый снимок опубликованных правил (ADR-07 §11.1). */
export interface RulesSnapshotInput {
  rulesSnapshotId: string;
  rules: readonly ManagedRuleInput[];
}

export interface CalculationRequest {
  config: FurnitureConfig;
  schemaVersion: number;
  inputs: CalculationInputs;
}

export const CALCULATION_LINE_IDS = [
  "kitchen.base", "kitchen.body", "kitchen.fronts", "kitchen.fittings",
  "kitchen.options", "kitchen.pushToOpen", "kitchen.plinth",
  "kitchen.supports", "kitchen.supportClips", "kitchen.supportScrews",
  "kitchen.supportAnchors", "kitchen.lighting", "kitchen.lighting.strip",
  "kitchen.lighting.profile", "kitchen.lighting.diffuser",
  "kitchen.lighting.endCaps", "kitchen.lighting.connectors",
  "kitchen.lighting.psu", "kitchen.lighting.control",
  "kitchen.lighting.install", "kitchen.supportPreliminary",
  "kitchen.sidePanels", "kitchen.complexity", "kitchen.minOrder",
  "wardrobe.base", "wardrobe.body", "wardrobe.fronts",
  "wardrobe.fittings", "wardrobe.options", "wardrobe.led",
  "wardrobe.plinth", "wardrobe.pushToOpen", "wardrobe.minOrder",
] as const;

export type CalculationLineId = (typeof CALCULATION_LINE_IDS)[number];

interface CalculationLineBase<ID extends CalculationLineId> { id: ID; amount: number }

export type CalculationLine =
  | CalculationLineBase<"kitchen.base"> | CalculationLineBase<"kitchen.pushToOpen">
  | (CalculationLineBase<"kitchen.body"> & { moduleCount: number; bodyMaterialId: string })
  | (CalculationLineBase<"kitchen.fronts"> & { doors: number; drawers: number })
  | (CalculationLineBase<"kitchen.fittings"> & { pushToOpen: boolean })
  | (CalculationLineBase<"kitchen.options"> & { countertopMeters: number; shelves: number })
  | (CalculationLineBase<"kitchen.plinth"> & {
      lengthM: number; thicknessMm: number; plinthMaterialId: string;
      plinthMountId: string; supportClips: number; supportFrontLegs: number;
    })
  | (CalculationLineBase<"kitchen.supports"> & {
      legs: number; frontLegs: number; backLegs: number; supportSystemId: string;
    })
  | (CalculationLineBase<"kitchen.supportClips"> & { clips: number })
  | (CalculationLineBase<"kitchen.supportScrews"> & { screws: number })
  | (CalculationLineBase<"kitchen.supportAnchors"> & { anchors: number; tallAnchorSpacingCm: number })
  | (CalculationLineBase<"kitchen.lighting"> & {
      lengthM: number; powerPerMeter: number; voltage: number;
      colorTemp: number; psuW: number;
    })
  | (CalculationLineBase<"kitchen.lighting.strip"> & { lengthM: number; powerPerMeter: number; voltage: number })
  | (CalculationLineBase<"kitchen.lighting.profile"> & { quantityM: number; profileId: string })
  | (CalculationLineBase<"kitchen.lighting.diffuser"> & { quantityM: number; diffuserId: string })
  | (CalculationLineBase<"kitchen.lighting.endCaps"> & { endCaps: number })
  | (CalculationLineBase<"kitchen.lighting.connectors"> & { connectors: number })
  | (CalculationLineBase<"kitchen.lighting.psu"> & { psuW: number; psuCount: number })
  | (CalculationLineBase<"kitchen.lighting.control"> & { controlId: string })
  | (CalculationLineBase<"kitchen.lighting.install"> & { quantityM: number })
  | CalculationLineBase<"kitchen.supportPreliminary">
  | (CalculationLineBase<"kitchen.sidePanels"> & { count: number })
  | (CalculationLineBase<"kitchen.complexity"> & { factor: number })
  | CalculationLineBase<"kitchen.minOrder">
  | CalculationLineBase<"wardrobe.base">
  | (CalculationLineBase<"wardrobe.body"> & { totalArea: number; bodyMaterialId: string })
  | (CalculationLineBase<"wardrobe.fronts"> & { doors: number; facadeMaterialId: string })
  | (CalculationLineBase<"wardrobe.fittings"> & { doors: number; drawers: number; softClose: boolean })
  | (CalculationLineBase<"wardrobe.options"> & { shelves: number; rods: number; ledLighting: boolean })
  | (CalculationLineBase<"wardrobe.led"> & { sections: number })
  | (CalculationLineBase<"wardrobe.plinth"> & { widthCm: number })
  | CalculationLineBase<"wardrobe.pushToOpen"> | CalculationLineBase<"wardrobe.minOrder">;

export interface CalculationBreakdown {
  currency: "RUB";
  baseCost: number;
  bodyCost: number;
  frontsCost: number;
  fittingsCost: number;
  optionsCost: number;
  complexityFactor: number;
  subtotal: number;
  discount: number;
  total: number;
  minOrderApplied: boolean;
  lines: CalculationLine[];
  promo: PromoResult | null;
}

export interface CalculationResult {
  breakdown: CalculationBreakdown;
  versions: CalculationVersions;
  usedPriceItems?: readonly { id: string; amount: number }[];
}

/* ─── Runtime fail-closed validation (только контракт; DataResolver — отдельно) ─── */

export interface ContractIssue {
  path: string;
  message: string;
}

export type ContractValidation<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly ContractIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fail(issues: ContractIssue[]): { ok: false; issues: ContractIssue[] } {
  return { ok: false, issues };
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  issues: ContractIssue[],
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, message: "неизвестное поле контракта" });
    }
  }
  for (const key of keys) {
    if (!(key in value)) {
      issues.push({ path: `${path}.${key}`, message: "обязательное поле отсутствует" });
    }
  }
}

function emptyObject(
  value: unknown,
  path: string,
  issues: ContractIssue[],
): boolean {
  if (!isRecord(value)) {
    issues.push({ path, message: "ожидался объект" });
    return false;
  }
  if (Object.keys(value).length > 0) {
    issues.push({ path, message: "объект должен быть пустым" });
    return false;
  }
  return true;
}

function checkPriceRefs(
  value: unknown,
  keys: readonly string[],
  path: string,
  issues: ContractIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "ожидался объект priceRefs" });
    return;
  }
  exactKeys(value, keys, path, issues);
  for (const key of keys) {
    if (!nonEmptyString(value[key])) {
      issues.push({ path: `${path}.${key}`, message: "priceRef обязателен и непуст" });
    }
  }
}

function checkDimension(
  value: unknown,
  path: string,
  issues: ContractIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "ожидался диапазон" });
    return;
  }
  exactKeys(value, ["min", "max", "default"], path, issues);
  for (const key of ["min", "max", "default"] as const) {
    if (!finiteNumber(value[key])) {
      issues.push({ path: `${path}.${key}`, message: "ожидалось конечное число" });
    }
  }
  if (finiteNumber(value.min) && finiteNumber(value.max) && value.min > value.max) {
    issues.push({ path, message: "min не может быть больше max" });
  }
  if (
    finiteNumber(value.min) &&
    finiteNumber(value.max) &&
    finiteNumber(value.default) &&
    (value.default < value.min || value.default > value.max)
  ) {
    issues.push({ path: `${path}.default`, message: "default вне [min,max]" });
  }
}

export function validatePriceSnapshot(
  input: unknown,
): ContractValidation<PriceSnapshotInput> {
  const issues: ContractIssue[] = [];
  if (!isRecord(input)) return fail([{ path: "priceSnapshot", message: "ожидался объект" }]);

  exactKeys(
    input,
    ["priceVersion", "snapshot", "rules", "signedAdjustments", "promos", "baseSchema"],
    "priceSnapshot",
    issues,
  );
  if (!nonEmptyString(input.priceVersion)) {
    issues.push({ path: "priceSnapshot.priceVersion", message: "непустой id версии обязателен" });
  }
  if (!Number.isInteger(input.baseSchema) || Number(input.baseSchema) < 1) {
    issues.push({ path: "priceSnapshot.baseSchema", message: "целое ≥ 1" });
  }

  if (!Array.isArray(input.snapshot)) {
    issues.push({ path: "priceSnapshot.snapshot", message: "ожидался массив" });
  } else {
    const seen = new Set<string>();
    input.snapshot.forEach((entry, index) => {
      const path = `priceSnapshot.snapshot[${index}]`;
      if (!isRecord(entry)) {
        issues.push({ path, message: "ожидалась запись ставки" });
        return;
      }
      exactKeys(entry, ["priceItemId", "amount"], path, issues);
      if (!nonEmptyString(entry.priceItemId)) {
        issues.push({ path: `${path}.priceItemId`, message: "непустой id обязателен" });
      } else if (seen.has(entry.priceItemId)) {
        issues.push({ path: `${path}.priceItemId`, message: "дубликат priceItemId" });
      } else {
        seen.add(entry.priceItemId);
      }
      if (!finiteNumber(entry.amount) || entry.amount < 0) {
        issues.push({ path: `${path}.amount`, message: "конечное неотрицательное число" });
      }
    });
  }

  if (!isRecord(input.rules)) {
    issues.push({ path: "priceSnapshot.rules", message: "ожидался объект" });
  } else {
    const ruleKeys = [
      "rounding",
      "minOrder",
      "complexityPerExtraModule",
      "complexityMax",
      "bodyDepthReference",
      "bodyFactor",
    ] as const;
    exactKeys(input.rules, ruleKeys, "priceSnapshot.rules", issues);
    for (const key of ruleKeys) {
      if (!finiteNumber(input.rules[key])) {
        issues.push({ path: `priceSnapshot.rules.${key}`, message: "конечное число" });
      }
    }
    if (finiteNumber(input.rules.rounding) && input.rules.rounding <= 0) {
      issues.push({ path: "priceSnapshot.rules.rounding", message: "должно быть > 0" });
    }
    if (finiteNumber(input.rules.minOrder) && input.rules.minOrder < 0) {
      issues.push({ path: "priceSnapshot.rules.minOrder", message: "должно быть ≥ 0" });
    }
    if (
      finiteNumber(input.rules.complexityPerExtraModule) &&
      input.rules.complexityPerExtraModule < 0
    ) {
      issues.push({ path: "priceSnapshot.rules.complexityPerExtraModule", message: "должно быть ≥ 0" });
    }
    if (finiteNumber(input.rules.complexityMax) && input.rules.complexityMax < 1) {
      issues.push({ path: "priceSnapshot.rules.complexityMax", message: "должно быть ≥ 1" });
    }
    if (finiteNumber(input.rules.bodyDepthReference) && input.rules.bodyDepthReference <= 0) {
      issues.push({ path: "priceSnapshot.rules.bodyDepthReference", message: "должно быть > 0" });
    }
  }

  if (!Array.isArray(input.signedAdjustments)) {
    issues.push({ path: "priceSnapshot.signedAdjustments", message: "ожидался массив" });
  } else {
    const seen = new Set<string>();
    input.signedAdjustments.forEach((entry, index) => {
      const path = `priceSnapshot.signedAdjustments[${index}]`;
      if (!isRecord(entry)) {
        issues.push({ path, message: "ожидалась корректировка" });
        return;
      }
      exactKeys(entry, ["key", "amount"], path, issues);
      if (!nonEmptyString(entry.key) || !/^plinth:[^:]+:[^:]+$/.test(entry.key)) {
        issues.push({ path: `${path}.key`, message: "ключ plinth:<materialId>:<finishId>" });
      } else if (seen.has(entry.key)) {
        issues.push({ path: `${path}.key`, message: "дубликат ключа корректировки" });
      } else {
        seen.add(entry.key);
      }
      if (!finiteNumber(entry.amount)) {
        issues.push({ path: `${path}.amount`, message: "конечное число" });
      }
    });
  }

  if (!Array.isArray(input.promos)) {
    issues.push({ path: "priceSnapshot.promos", message: "ожидался массив" });
  }

  return issues.length > 0 ? fail(issues) : { ok: true, value: input as unknown as PriceSnapshotInput };
}

export function validateCatalogItemInput(
  input: unknown,
): ContractValidation<CatalogItemInput> {
  const issues: ContractIssue[] = [];
  if (!isRecord(input)) return fail([{ path: "catalogItem", message: "ожидался объект" }]);
  if (!nonEmptyString(input.id)) issues.push({ path: "catalogItem.id", message: "непустой id обязателен" });
  if (!nonEmptyString(input.catalog)) {
    return fail([{ path: "catalogItem.catalog", message: "catalog обязателен" }]);
  }

  const catalog = input.catalog;
  const attrs = input.attrs;
  switch (catalog) {
    case "bodyMaterial":
    case "facadeMaterial":
      emptyObject(attrs, "catalogItem.attrs", issues);
      checkPriceRefs(input.priceRefs, ["ratePerSqm"], "catalogItem.priceRefs", issues);
      break;
    case "facadeStyle":
      emptyObject(attrs, "catalogItem.attrs", issues);
      checkPriceRefs(input.priceRefs, ["multiplier"], "catalogItem.priceRefs", issues);
      break;
    case "handle":
      emptyObject(attrs, "catalogItem.attrs", issues);
      checkPriceRefs(input.priceRefs, ["rate"], "catalogItem.priceRefs", issues);
      break;
    case "countertop":
      if (isRecord(attrs)) {
        exactKeys(attrs, ["thicknesses", "defaultThickness"], "catalogItem.attrs", issues);
        if (!Array.isArray(attrs.thicknesses) || !attrs.thicknesses.every(finiteNumber)) {
          issues.push({ path: "catalogItem.attrs.thicknesses", message: "массив чисел" });
        }
        if (!finiteNumber(attrs.defaultThickness)) {
          issues.push({ path: "catalogItem.attrs.defaultThickness", message: "число" });
        }
      } else {
        issues.push({ path: "catalogItem.attrs", message: "ожидался объект" });
      }
      checkPriceRefs(input.priceRefs, ["ratePerLinearMeter"], "catalogItem.priceRefs", issues);
      break;
    case "plinthMaterial":
      if (isRecord(attrs)) {
        exactKeys(attrs, ["thicknesses", "defaultThickness", "finishIds"], "catalogItem.attrs", issues);
        if (!Array.isArray(attrs.thicknesses) || !attrs.thicknesses.every(finiteNumber)) {
          issues.push({ path: "catalogItem.attrs.thicknesses", message: "массив чисел" });
        }
        if (!finiteNumber(attrs.defaultThickness)) {
          issues.push({ path: "catalogItem.attrs.defaultThickness", message: "число" });
        }
        if (!Array.isArray(attrs.finishIds) || !attrs.finishIds.every(nonEmptyString)) {
          issues.push({ path: "catalogItem.attrs.finishIds", message: "массив непустых строк" });
        }
      } else {
        issues.push({ path: "catalogItem.attrs", message: "ожидался объект" });
      }
      checkPriceRefs(input.priceRefs, ["ratePerMeter"], "catalogItem.priceRefs", issues);
      break;
    case "supportSystem": {
      if (isRecord(attrs)) {
        const supportKeys = [
          "edgeInsetCm",
          "maxSpanCm",
          "maxLoadKgPerLeg",
          "clipsPerLeg",
          "screwsPerLeg",
          "tallAnchorSpacingCm",
          "tallCenterLegWidthCm",
        ] as const;
        exactKeys(attrs, supportKeys, "catalogItem.attrs", issues);
        for (const key of supportKeys) {
          if (!finiteNumber(attrs[key])) {
            issues.push({ path: `catalogItem.attrs.${key}`, message: "конечное число" });
          }
        }
      } else {
        issues.push({ path: "catalogItem.attrs", message: "ожидался объект" });
      }
      checkPriceRefs(
        input.priceRefs,
        ["legPrice", "clipPrice", "screwPrice", "anchorPrice"],
        "catalogItem.priceRefs",
        issues,
      );
      break;
    }
    case "ledStrip":
      if (isRecord(attrs)) {
        const ledKeys = ["power", "voltage", "maxContinuousRunM", "voltageDropPct", "maxPsuW"] as const;
        exactKeys(attrs, ledKeys, "catalogItem.attrs", issues);
        for (const key of ledKeys) {
          if (!finiteNumber(attrs[key])) {
            issues.push({ path: `catalogItem.attrs.${key}`, message: "конечное число" });
          }
        }
        if (attrs.voltage !== 12 && attrs.voltage !== 24) {
          issues.push({ path: "catalogItem.attrs.voltage", message: "12 или 24" });
        }
      } else {
        issues.push({ path: "catalogItem.attrs", message: "ожидался объект" });
      }
      checkPriceRefs(input.priceRefs, ["pricePerMeter"], "catalogItem.priceRefs", issues);
      break;
    case "plinthFinish":
    case "plinthMount":
    case "ledProfile":
    case "ledDiffuser":
    case "ledControl":
      if (isRecord(attrs)) {
        exactKeys(attrs, ["id"], "catalogItem.attrs", issues);
        if (!nonEmptyString(attrs.id)) {
          issues.push({ path: "catalogItem.attrs.id", message: "непустой id" });
        }
      } else {
        issues.push({ path: "catalogItem.attrs", message: "ожидался объект" });
      }
      if (catalog === "plinthFinish" || catalog === "plinthMount") {
        if (!isRecord(input.priceRefs) || Object.keys(input.priceRefs).length > 0) {
          issues.push({ path: "catalogItem.priceRefs", message: "для этого вида цены не задаются" });
        }
      } else {
        checkPriceRefs(
          input.priceRefs,
          [catalog === "ledControl" ? "price" : "ratePerMeter"],
          "catalogItem.priceRefs",
          issues,
        );
      }
      break;
    case "ledPsu":
      if (isRecord(attrs)) {
        exactKeys(attrs, ["watt"], "catalogItem.attrs", issues);
        if (!finiteNumber(attrs.watt)) {
          issues.push({ path: "catalogItem.attrs.watt", message: "конечное число" });
        }
      } else {
        issues.push({ path: "catalogItem.attrs", message: "ожидался объект" });
      }
      checkPriceRefs(input.priceRefs, ["price"], "catalogItem.priceRefs", issues);
      break;
    case "sinkSize":
    case "promo":
      issues.push({
        path: "catalogItem.catalog",
        message: "вид не входит в Engine input (sinkSize/promo)",
      });
      break;
    default:
      issues.push({ path: "catalogItem.catalog", message: "неизвестный CatalogKind" });
  }

  return issues.length > 0 ? fail(issues) : { ok: true, value: input as unknown as CatalogItemInput };
}

export function validateModulePresetInput(
  input: unknown,
): ContractValidation<ModulePresetInput> {
  const issues: ContractIssue[] = [];
  if (!isRecord(input)) return fail([{ path: "modulePreset", message: "ожидался объект" }]);
  exactKeys(
    input,
    [
      "id",
      "family",
      "zone",
      "width",
      "height",
      "depth",
      "defaultShelves",
      "defaultDrawers",
      "priceRef",
    ],
    "modulePreset",
    issues,
  );
  if (!nonEmptyString(input.id)) issues.push({ path: "modulePreset.id", message: "непустой id" });
  if (input.family !== "kitchen" && input.family !== "wardrobe") {
    issues.push({ path: "modulePreset.family", message: "kitchen | wardrobe" });
  }
  if (input.zone !== "floor" && input.zone !== "upper") {
    issues.push({ path: "modulePreset.zone", message: "floor | upper" });
  }
  checkDimension(input.width, "modulePreset.width", issues);
  checkDimension(input.height, "modulePreset.height", issues);
  checkDimension(input.depth, "modulePreset.depth", issues);
  for (const key of ["defaultShelves", "defaultDrawers"] as const) {
    if (!Number.isInteger(input[key]) || Number(input[key]) < 0) {
      issues.push({ path: `modulePreset.${key}`, message: "целое ≥ 0" });
    }
  }
  if (!nonEmptyString(input.priceRef)) {
    issues.push({ path: "modulePreset.priceRef", message: "обязателен" });
  }
  return issues.length > 0 ? fail(issues) : { ok: true, value: input as unknown as ModulePresetInput };
}

function checkRuleConditionNode(
  value: unknown,
  path: string,
  issues: ContractIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "ожидался объект условия" });
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && (keys[0] === "all" || keys[0] === "any")) {
    const group = keys[0] as "all" | "any";
    const children = value[group];
    if (!Array.isArray(children) || children.length === 0) {
      issues.push({ path: `${path}.${group}`, message: "ожидался непустой массив" });
      return;
    }
    children.forEach((child, index) =>
      checkRuleConditionNode(child, `${path}.${group}[${index}]`, issues),
    );
    return;
  }
  exactKeys(value, ["subject", "operator", "value"], path, issues);
  if (!nonEmptyString(value.subject)) {
    issues.push({ path: `${path}.subject`, message: "непустой subject обязателен" });
  }
  if (!nonEmptyString(value.operator)) {
    issues.push({ path: `${path}.operator`, message: "непустой operator обязателен" });
  }
  const raw = value.value;
  const validValue =
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean" ||
    (Array.isArray(raw) && raw.every((item) => typeof item === "string"));
  if (!validValue) {
    issues.push({ path: `${path}.value`, message: "недопустимый тип значения условия" });
  }
}

/**
 * Контракт снимка правил (ADR-07 §10.4, ADR-06 §5.3 addendum):
 * снимок непустой, id уникальны, в расчётных входах допустимы только
 * `status=published` и `source≠preliminary` (draft/preliminary → блокировка).
 */
export function validateRulesSnapshot(
  input: unknown,
): ContractValidation<RulesSnapshotInput> {
  const issues: ContractIssue[] = [];
  if (!isRecord(input)) {
    return fail([{ path: "rulesSnapshot", message: "ожидался объект" }]);
  }
  exactKeys(input, ["rulesSnapshotId", "rules"], "rulesSnapshot", issues);
  if (!nonEmptyString(input.rulesSnapshotId)) {
    issues.push({
      path: "rulesSnapshot.rulesSnapshotId",
      message: "непустой id снимка обязателен",
    });
  }

  if (!Array.isArray(input.rules)) {
    issues.push({ path: "rulesSnapshot.rules", message: "ожидался массив" });
    return issues.length > 0 ? fail(issues) : { ok: true, value: input as unknown as RulesSnapshotInput };
  }
  if (input.rules.length === 0) {
    issues.push({ path: "rulesSnapshot.rules", message: "пустой снимок недопустим" });
  }

  const requiredKeys = [
    "id", "name", "description", "category", "scope", "condition", "assigns",
    "value", "valueType", "status", "sourceRef", "source", "affects", "version",
  ] as const;
  const allowedKeys = [...requiredKeys, "unit"];
  const ids = new Set<string>();

  input.rules.forEach((raw, index) => {
    const path = `rulesSnapshot.rules[${index}]`;
    if (!isRecord(raw)) {
      issues.push({ path, message: "ожидалась запись правила" });
      return;
    }
    for (const key of Object.keys(raw)) {
      if (!allowedKeys.includes(key)) {
        issues.push({ path: `${path}.${key}`, message: "неизвестное поле контракта" });
      }
    }
    for (const key of requiredKeys) {
      if (!(key in raw)) {
        issues.push({ path: `${path}.${key}`, message: "обязательное поле отсутствует" });
      }
    }

    if (!nonEmptyString(raw.id)) {
      issues.push({ path: `${path}.id`, message: "непустой id обязателен" });
    } else if (ids.has(raw.id)) {
      issues.push({ path: `${path}.id`, message: "дубликат id правила в снимке" });
    } else {
      ids.add(raw.id);
    }

    if (raw.status !== "published") {
      issues.push({
        path: `${path}.status`,
        message: "в расчётных входах допустим только status=published",
      });
    }
    if (raw.source === "preliminary") {
      issues.push({
        path: `${path}.source`,
        message: "preliminary-правило недопустимо в расчётных входах",
      });
    }
    if (!["quantity", "purpose", "norm", "condition"].includes(String(raw.category))) {
      issues.push({ path: `${path}.category`, message: "неизвестная категория" });
    }
    if (!["kitchen", "wardrobe", "shared"].includes(String(raw.scope))) {
      issues.push({ path: `${path}.scope`, message: "неизвестная область" });
    }
    if (!["int", "decimal", "boolean", "enum", "stringList"].includes(String(raw.valueType))) {
      issues.push({ path: `${path}.valueType`, message: "неизвестный тип значения" });
    }
    if (!nonEmptyString(raw.assigns)) {
      issues.push({ path: `${path}.assigns`, message: "assigns обязателен" });
    }
    if (!Array.isArray(raw.affects) || raw.affects.length === 0) {
      issues.push({ path: `${path}.affects`, message: "affects должен быть непустым массивом" });
    } else if (raw.affects.some((item) => item !== "price" && item !== "quantity")) {
      issues.push({ path: `${path}.affects`, message: "affects: price | quantity" });
    }
    if (!nonEmptyString(raw.sourceRef)) {
      issues.push({ path: `${path}.sourceRef`, message: "sourceRef обязателен" });
    }
    if (!["preliminary", "datasheet", "owner_confirmed"].includes(String(raw.source))) {
      issues.push({ path: `${path}.source`, message: "неизвестный источник" });
    }
    if (!nonEmptyString(raw.version)) {
      issues.push({ path: `${path}.version`, message: "version обязательна" });
    }
    checkRuleConditionNode(raw.condition, `${path}.condition`, issues);
  });

  return issues.length > 0
    ? fail(issues)
    : { ok: true, value: input as unknown as RulesSnapshotInput };
}

export function validateCalculationInputs(
  input: unknown,
): ContractValidation<CalculationInputs> {
  const issues: ContractIssue[] = [];
  if (!isRecord(input)) return fail([{ path: "inputs", message: "ожидался объект" }]);

  // `rulesSnapshot` — optional (легаси-входы), поэтому проверяются только
  // запрещённые ключи; обязательность четырёх групп валидируется ниже.
  const allowedInputKeys = new Set([
    "priceSnapshot",
    "catalogs",
    "parameters",
    "presets",
    "rulesSnapshot",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedInputKeys.has(key)) {
      issues.push({ path: `inputs.${key}`, message: "неизвестное поле контракта" });
    }
  }

  const snapshot = validatePriceSnapshot(input.priceSnapshot);
  if (!snapshot.ok) issues.push(...snapshot.issues);
  const priceIds = new Set(
    snapshot.ok ? snapshot.value.snapshot.map((entry) => entry.priceItemId) : [],
  );

  if (!Array.isArray(input.catalogs)) {
    issues.push({ path: "inputs.catalogs", message: "ожидался массив" });
  } else {
    const ids = new Set<string>();
    input.catalogs.forEach((item, index) => {
      const validated = validateCatalogItemInput(item);
      if (!validated.ok) {
        issues.push(...validated.issues.map((issue) => ({ ...issue, path: `inputs.catalogs[${index}].${issue.path.replace(/^catalogItem\.?/, "")}` })));
        return;
      }
      const value = validated.value;
      const key = `${value.catalog}:${value.id}`;
      if (ids.has(key)) {
        issues.push({ path: `inputs.catalogs[${index}].id`, message: "дубликат catalog:id" });
      }
      ids.add(key);
      for (const [role, priceItemId] of Object.entries(value.priceRefs)) {
        if (!priceIds.has(priceItemId)) {
          issues.push({
            path: `inputs.catalogs[${index}].priceRefs.${role}`,
            message: `PriceItem "${priceItemId}" отсутствует в priceSnapshot`,
          });
        }
      }
    });
  }

  if (!Array.isArray(input.presets)) {
    issues.push({ path: "inputs.presets", message: "ожидался массив" });
  } else {
    input.presets.forEach((item, index) => {
      const validated = validateModulePresetInput(item);
      if (!validated.ok) {
        issues.push(...validated.issues.map((issue) => ({ ...issue, path: `inputs.presets[${index}].${issue.path.replace(/^modulePreset\.?/, "")}` })));
        return;
      }
      if (!priceIds.has(validated.value.priceRef)) {
        issues.push({
          path: `inputs.presets[${index}].priceRef`,
          message: `PriceItem "${validated.value.priceRef}" отсутствует в priceSnapshot`,
        });
      }
    });
  }

  if (!isRecord(input.parameters)) {
    issues.push({ path: "inputs.parameters", message: "ожидался объект" });
  }

  if (input.rulesSnapshot !== undefined) {
    const rules = validateRulesSnapshot(input.rulesSnapshot);
    if (!rules.ok) {
      issues.push(
        ...rules.issues.map((item) => ({
          ...item,
          path: item.path.replace(/^rulesSnapshot/, "inputs.rulesSnapshot"),
        })),
      );
    }
  }

  return issues.length > 0 ? fail(issues) : { ok: true, value: input as unknown as CalculationInputs };
}

export function validateCalculationRequest(
  input: unknown,
): ContractValidation<CalculationRequest> {
  const issues: ContractIssue[] = [];
  if (!isRecord(input)) return fail([{ path: "request", message: "ожидался объект" }]);
  exactKeys(input, ["config", "schemaVersion", "inputs"], "request", issues);
  if (!isRecord(input.config)) {
    issues.push({ path: "request.config", message: "ожидался объект" });
  } else if (input.config.kind !== "kitchen" && input.config.kind !== "wardrobe") {
    issues.push({ path: "request.config.kind", message: "kitchen | wardrobe" });
  }
  if (!Number.isInteger(input.schemaVersion) || Number(input.schemaVersion) < 1) {
    issues.push({ path: "request.schemaVersion", message: "целое ≥ 1" });
  }
  const inputs = validateCalculationInputs(input.inputs);
  if (!inputs.ok) {
    issues.push(...inputs.issues);
  } else if (
    Number.isInteger(input.schemaVersion) &&
    Number(input.schemaVersion) > inputs.value.priceSnapshot.baseSchema
  ) {
    issues.push({
      path: "request.schemaVersion",
      message: "schemaVersion несовместима с baseSchema снимка",
    });
  }
  return issues.length > 0 ? fail(issues) : { ok: true, value: input as unknown as CalculationRequest };
}
