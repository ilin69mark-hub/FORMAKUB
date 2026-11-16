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
  LED_DIFFUSERS,
  LED_PROFILES,
  LED_PSU_PRICE,
  LED_STRIPS,
} from "@/content/lighting";
import { PLINTH_MATERIALS } from "@/content/plinth";
import { PROMOS, PRICING, type PromoDefinition } from "@/content/pricing";
import { PLINTH_MOUNTS, SUPPORT_SYSTEMS } from "@/content/supports";
import {
  validateCatalogItemInput,
  validateModulePresetInput,
  type PriceRulesInput,
  type CatalogItemInput,
} from "@/lib/configurator/contract";
import { SUPPORTED_SCHEMA_VERSION } from "@/lib/configurator/versions";
import { readCollection, readCollectionStatus } from "@/lib/server/store";
import { getStorage, resolveStorageKind } from "@/lib/server/storage";
import { SqliteStorage } from "@/lib/server/storage/sqlite-storage";
import { publishPricingVersion } from "./publish";
import type { ActorContext } from "./parameters";
import type { AdminParameter } from "./schema";
import { buildAdminParameterSeeds } from "./parameter-seed";

import { buildImportSpec } from "./import";
import {
  catalogItemSchema,
  modulePresetSchema,
  priceItemSchema,
  pricingVersionSchema,
  promoDefinitionSchema,
  signedAdjustmentSchema,
  type CatalogItem,
  type ModulePreset,
  type PriceItem,
  type PricingVersion,
  type SignedAdjustment,
} from "./schema";

/**
 * CA-T-306A — Data Bootstrap из `content/*` в Admin/SQLite.
 *
 * Модуль только **планирует** начальную загрузку и выполняет read-only
 * dry-run. Запись (backup → apply → verify → publish) выполняется отдельной
 * операцией только после разрешения владельца. Runtime content не читается:
 * content используется только как источник этого bootstrap.
 */

const PRICE_ITEMS = "price-items.json";
const VERSIONS = "pricing-versions.json";
const CATALOGS = "catalog-items.json";
const PRESETS = "module-presets.json";

const BOOTSTRAP_ACTOR = "bootstrap:ca-t-306a";

export type BootstrapSeverity = "error" | "warning";

export interface BootstrapIssue {
  code: string;
  severity: BootstrapSeverity;
  entity: string;
  id: string;
  message: string;
  action: string;
}

export interface BootstrapPlanOptions {
  /** Production id начальной версии; по умолчанию — import-id `price-<PRICING.version>`. */
  pricingVersionId?: string;
  pricingLabel?: string;
}

export interface BootstrapPlan {
  priceItems: PriceItem[];
  pricingDraft: PricingVersion;
  catalogItems: CatalogItem[];
  modulePresets: ModulePreset[];
  signedAdjustments: SignedAdjustment[];
  promos: PromoDefinition[];
  rules: PriceRulesInput;
  priceSnapshot: Array<{ priceItemId: string; amount: number }>;
  adminParameters: AdminParameter[];
  issues: BootstrapIssue[];
}

export interface BootstrapDryRunReport {
  generatedAt: string;
  storageKind: string;
  planned: {
    priceItems: number;
    priceSnapshot: number;
    pricingVersions: number;
    catalogItems: number;
    modulePresets: number;
    signedAdjustments: number;
    promos: number;
    rules: number;
  };
  existing: {
    total: {
      priceItems: number;
      pricingVersions: number;
      catalogItems: number;
      modulePresets: number;
    };
    valid: {
      priceItems: number;
      pricingVersions: number;
      catalogItems: number;
      modulePresets: number;
    };
  };
  ready: {
    priceItems: number;
    catalogItems: number;
    modulePresets: number;
    pricingVersions: number;
  };
  unchanged: {
    priceItems: number;
    catalogItems: number;
    modulePresets: number;
    pricingVersions: number;
  };
  ambiguous: BootstrapIssue[];
  corrupt: BootstrapIssue[];
  missingPriceItems: string[];
  unresolvedCatalogRefs: Array<{
    entity: string;
    role: string;
    priceRef: string;
  }>;
  unresolvedPresetRefs: Array<{ entity: string; priceRef: string }>;
  signedAdjustments: {
    total: number;
    positive: number;
    negative: number;
    zero: number;
    issues: BootstrapIssue[];
  };
  led: {
    strips: number;
    profiles: number;
    diffusers: number;
    controls: number;
    psu: number;
    issues: BootstrapIssue[];
  };
  referenceData: {
    supportSystems: number;
    plinthFinishes: number;
    plinthMounts: number;
    rules: number;
    promos: number;
    issues: BootstrapIssue[];
  };
  nextPublishedSeq: number;
  importable: boolean;
  blockers: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  code: string,
  entity: string,
  id: string,
  message: string,
  action: string,
  severity: BootstrapSeverity = "error",
): BootstrapIssue {
  return { code, severity, entity, id, message, action };
}

function canon(value: unknown): string {
  return JSON.stringify(value);
}

function snapshotCanon(
  snapshot: ReadonlyArray<{ priceItemId: string; amount: number }>,
): string {
  return canon(
    [...snapshot].sort((a, b) => a.priceItemId.localeCompare(b.priceItemId)),
  );
}

function sameSnapshot(
  a: ReadonlyArray<{ priceItemId: string; amount: number }>,
  b: ReadonlyArray<{ priceItemId: string; amount: number }>,
): boolean {
  return snapshotCanon(a) === snapshotCanon(b);
}

function sameVersionCore(a: PricingVersion, b: PricingVersion): boolean {
  return (
    sameSnapshot(a.snapshot, b.snapshot) &&
    canon(a.rules) === canon(b.rules) &&
    canon(a.promos) === canon(b.promos) &&
    canon(a.signedAdjustments ?? []) === canon(b.signedAdjustments ?? []) &&
    a.baseSchema === b.baseSchema
  );
}

function samePriceItem(a: PriceItem, b: PriceItem): boolean {
  return (
    a.id === b.id &&
    a.scope === b.scope &&
    a.label === b.label &&
    a.unit === b.unit &&
    a.usage === b.usage &&
    a.status === b.status &&
    a.editable === b.editable &&
    a.sourceRef === b.sourceRef
  );
}

function sameCatalog(a: CatalogItem, b: CatalogItem): boolean {
  return (
    a.id === b.id &&
    a.catalog === b.catalog &&
    a.label === b.label &&
    canon(a.attrs) === canon(b.attrs) &&
    canon(a.priceRefs ?? {}) === canon(b.priceRefs ?? {}) &&
    a.status === b.status &&
    a.version === b.version
  );
}

function samePreset(a: ModulePreset, b: ModulePreset): boolean {
  return (
    a.id === b.id &&
    a.family === b.family &&
    a.zone === b.zone &&
    canon(a.width) === canon(b.width) &&
    canon(a.height) === canon(b.height) &&
    canon(a.depth) === canon(b.depth) &&
    a.defaultShelves === b.defaultShelves &&
    a.defaultDrawers === b.defaultDrawers &&
    a.priceRef === b.priceRef &&
    a.status === b.status &&
    a.version === b.version
  );
}

function catalogKey(item: Pick<CatalogItem, "catalog" | "id">): string {
  return `${item.catalog}:${item.id}`;
}

function presetKey(item: Pick<ModulePreset, "family" | "id">): string {
  return `${item.family}:${item.id}`;
}

function addIssue(list: BootstrapIssue[], value: BootstrapIssue): void {
  list.push(value);
}

function parseOrIssue<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: unknown } },
  raw: unknown,
  entity: string,
  id: string,
  issues: BootstrapIssue[],
): T | null {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    addIssue(
      issues,
      issue(
        "BOOTSTRAP_INVALID_PLANNED_RECORD",
        entity,
        id,
        `запись не проходит схему: ${String(parsed.error)}`,
        "исправить mapping/данные до apply",
      ),
    );
    return null;
  }
  return parsed.data;
}

function buildCatalogItems(
  now: string,
  issues: BootstrapIssue[],
): CatalogItem[] {
  const items: CatalogItem[] = [];
  const seen = new Map<string, string>();
  let sortOrder = 0;

  const add = (
    catalog: CatalogItem["catalog"],
    id: string,
    label: string,
    attrs: Record<string, unknown>,
    priceRefs: Record<string, string> | undefined,
  ): void => {
    const key = `${catalog}:${id}`;
    if (seen.has(key)) {
      addIssue(
        issues,
        issue(
          "BOOTSTRAP_DUPLICATE_CATALOG_ID",
          "CatalogItem",
          key,
          `id повторяется в content (${seen.get(key)} и ${key})`,
          "не мигрировать автоматически; требуется явное решение",
        ),
      );
      return;
    }
    seen.set(key, key);
    const parsed = parseOrIssue(
      catalogItemSchema,
      {
        id,
        catalog,
        label,
        attrs,
        ...(priceRefs === undefined ? {} : { priceRefs }),
        status: "active",
        sortOrder: sortOrder++,
        version: "1",
        createdAt: now,
        updatedAt: now,
        updatedBy: BOOTSTRAP_ACTOR,
      },
      "CatalogItem",
      key,
      issues,
    );
    if (parsed) items.push(parsed);
  };

  for (const item of BODY_MATERIALS) {
    add("bodyMaterial", item.id, item.name, {}, {
      ratePerSqm: `catalog.body.${item.id}.ratePerSqm`,
    });
  }
  for (const item of FACADE_MATERIALS) {
    add("facadeMaterial", item.id, item.name, {}, {
      ratePerSqm: `catalog.facade.${item.id}.ratePerSqm`,
    });
  }
  for (const item of FACADE_STYLES) {
    add("facadeStyle", item.id, item.name, {}, {
      multiplier: `catalog.facadeStyle.${item.id}.multiplier`,
    });
  }
  for (const item of HANDLES) {
    add("handle", item.id, item.name, {}, {
      rate: `catalog.handle.${item.id}.rate`,
    });
  }
  for (const item of COUNTERTOPS) {
    add(
      "countertop",
      item.id,
      item.name,
      {
        thicknesses: item.thicknesses,
        defaultThickness: item.defaultThickness,
      },
      { ratePerLinearMeter: `catalog.countertop.${item.id}.ratePerLinearMeter` },
    );
  }
  for (const item of PLINTH_MATERIALS) {
    add(
      "plinthMaterial",
      item.id,
      item.name,
      {
        thicknesses: item.thicknesses,
        defaultThickness: item.defaultThickness,
        finishIds: item.finishes.map((finish) => finish.id),
      },
      { ratePerMeter: `catalog.plinth.${item.id}.ratePerMeter` },
    );
    for (const finish of item.finishes) {
      add("plinthFinish", finish.id, finish.name, { id: finish.id }, undefined);
    }
  }
  for (const item of PLINTH_MOUNTS) {
    add("plinthMount", item.id, item.label, { id: item.id }, undefined);
  }
  for (const item of SUPPORT_SYSTEMS) {
    add(
      "supportSystem",
      item.id,
      item.label,
      {
        edgeInsetCm: item.edgeInsetCm,
        maxSpanCm: item.maxSpanCm,
        maxLoadKgPerLeg: item.maxLoadKgPerLeg,
        clipsPerLeg: item.clipsPerLeg,
        screwsPerLeg: item.screwsPerLeg,
        tallAnchorSpacingCm: item.tallAnchorSpacingCm,
        tallCenterLegWidthCm: item.tallCenterLegWidthCm,
        source: item.source,
      },
      {
        legPrice: `catalog.support.${item.id}.legPrice`,
        clipPrice: `catalog.support.${item.id}.clipPrice`,
        screwPrice: `catalog.support.${item.id}.screwPrice`,
        anchorPrice: `catalog.support.${item.id}.anchorPrice`,
      },
    );
  }
  for (const item of LED_STRIPS) {
    add(
      "ledStrip",
      item.id,
      `Лента ${item.voltage} В ${item.power} Вт/м`,
      {
        power: item.power,
        voltage: item.voltage,
        maxContinuousRunM: item.maxContinuousRunM,
        voltageDropPct: item.voltageDropPct,
        maxPsuW: item.maxPsuW,
        source: item.source,
      },
      { pricePerMeter: `lighting.strip.${item.id}` },
    );
  }
  for (const item of LED_PROFILES) {
    add("ledProfile", item.id, item.name, { id: item.id }, {
      ratePerMeter: `lighting.profile.${item.id}`,
    });
  }
  for (const item of LED_DIFFUSERS) {
    add("ledDiffuser", item.id, item.name, { id: item.id }, {
      ratePerMeter: `lighting.diffuser.${item.id}`,
    });
  }
  for (const item of LED_CONTROLS) {
    add("ledControl", item.id, item.name, { id: item.id }, {
      price: `lighting.control.${item.id}`,
    });
  }
  for (const watts of Object.keys(LED_PSU_PRICE).map(Number).sort((a, b) => a - b)) {
    add(
      "ledPsu",
      String(watts),
      `Блок питания ${watts} Вт`,
      { watt: watts },
      { price: `lighting.psu.${watts}` },
    );
  }

  return items;
}

function buildModulePresets(
  now: string,
  issues: BootstrapIssue[],
): ModulePreset[] {
  const presets: ModulePreset[] = [];
  for (const [id, preset] of Object.entries(KITCHEN_MODULES)) {
    const parsed = parseOrIssue(
      modulePresetSchema,
      {
        id,
        family: "kitchen",
        zone: preset.zone,
        width: { min: preset.minWidth, max: preset.maxWidth, default: preset.defaultWidth },
        height: { min: preset.minHeight, max: preset.maxHeight, default: preset.defaultHeight },
        depth: { min: preset.minDepth, max: preset.maxDepth, default: preset.defaultDepth },
        defaultShelves: preset.defaultShelves,
        defaultDrawers: preset.defaultDrawers,
        priceRef: `kitchen.module.${id}.basePrice`,
        status: "active",
        version: "1",
        updatedAt: now,
        updatedBy: BOOTSTRAP_ACTOR,
      },
      "ModulePreset",
      `kitchen:${id}`,
      issues,
    );
    if (parsed) presets.push(parsed);
  }
  return presets;
}

/**
 * Чистое построение плана bootstrap. Не читает и не пишет Storage.
 * Content читается только здесь — как источник начального импорта.
 */
export function buildBootstrapPlan(
  now = new Date().toISOString(),
  options: BootstrapPlanOptions = {},
): BootstrapPlan {
  const issues: BootstrapIssue[] = [];
  const pricingVersionId =
    options.pricingVersionId ?? `price-${PRICING.version}`;
  const pricingLabel =
    options.pricingLabel ??
    `Начальный импорт src/content/* (PRICING ${PRICING.version})`;
  const spec = buildImportSpec();

  const priceItems: PriceItem[] = [];
  const priceSnapshot: Array<{ priceItemId: string; amount: number }> = [];
  for (const entry of spec.entries) {
    if (!Number.isFinite(entry.value)) {
      addIssue(
        issues,
        issue(
          "BOOTSTRAP_INVALID_PRICE_VALUE",
          "PriceItem",
          entry.id,
          `не-конечное значение ${String(entry.value)}`,
          "исправить content/импорт; apply запрещён",
        ),
      );
      continue;
    }
    const parsed = parseOrIssue(
      priceItemSchema,
      {
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
        updatedBy: BOOTSTRAP_ACTOR,
      },
      "PriceItem",
      entry.id,
      issues,
    );
    if (!parsed) continue;
    priceItems.push(parsed);
    if (entry.usage === "used") {
      if (entry.value < 0) {
        addIssue(
          issues,
          issue(
            "BOOTSTRAP_NEGATIVE_PRICE_ITEM",
            "PriceItem",
            entry.id,
            `amount ${entry.value} < 0 запрещён для PriceSnapshot`,
            "не переносить в snapshot; требуется решение",
          ),
        );
      } else {
        priceSnapshot.push({ priceItemId: entry.id, amount: entry.value });
      }
    }
  }

  const signedAdjustments: SignedAdjustment[] = [];
  const signedKeys = new Set<string>();
  for (const material of PLINTH_MATERIALS) {
    for (const finish of material.finishes) {
      const key = `plinth:${material.id}:${finish.id}`;
      if (signedKeys.has(key)) {
        addIssue(
          issues,
          issue(
            "BOOTSTRAP_DUPLICATE_SIGNED_ADJUSTMENT",
            "SignedAdjustment",
            key,
            "ключ корректировки повторяется",
            "остановить импорт; устранить дубль вручную",
          ),
        );
        continue;
      }
      signedKeys.add(key);
      const parsed = parseOrIssue(
        signedAdjustmentSchema,
        { key, amount: finish.rateDelta },
        "SignedAdjustment",
        key,
        issues,
      );
      if (parsed) signedAdjustments.push(parsed);
    }
  }

  const promos: PromoDefinition[] = [];
  for (const promo of PROMOS) {
    const parsed = parseOrIssue(
      promoDefinitionSchema,
      promo,
      "Promo",
      promo.code,
      issues,
    );
    if (parsed) promos.push(parsed);
  }

  const rules: PriceRulesInput = {
    rounding: PRICING.rounding,
    minOrder: PRICING.minOrder,
    complexityPerExtraModule: PRICING.kitchen.complexityPerExtraModule,
    complexityMax: PRICING.kitchen.complexityMax,
    bodyDepthReference: PRICING.kitchen.bodyDepthReference,
    bodyFactor: PRICING.wardrobe.bodyFactor,
  };

  const catalogItems = buildCatalogItems(now, issues);
  const modulePresets = buildModulePresets(now, issues);

  const pricingDraft = parseOrIssue(
    pricingVersionSchema,
    {
      id: pricingVersionId,
      label: pricingLabel,
      status: "draft",
      snapshot: priceSnapshot,
      rules,
      promos,
      signedAdjustments,
      baseSchema: SUPPORTED_SCHEMA_VERSION,
      createdAt: now,
      createdBy: BOOTSTRAP_ACTOR,
    },
    "PricingVersion",
    pricingVersionId,
    issues,
  );

  if (!pricingDraft) {
    // Тип-заглушка недостижима при валидном content; выбрасываем, чтобы
    // вызывающий код не получил частичный план.
    throw new Error("Bootstrap: PricingVersion не собрана — см. issues.");
  }

  return {
    priceItems,
    pricingDraft,
    catalogItems,
    modulePresets,
    signedAdjustments,
    promos,
    rules,
    priceSnapshot,
    adminParameters: buildAdminParameterSeeds({ now, updatedBy: "bootstrap" }),
    issues,
  };
}

function validCollection<T>(
  read: { status: "ok"; items: unknown[] } | { status: "missing" } | { status: "corrupt"; reason: string },
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: unknown } },
  entity: string,
  corrupt: BootstrapIssue[],
): { raw: number; items: T[] } {
  if (read.status === "missing") return { raw: 0, items: [] };
  if (read.status === "corrupt") {
    addIssue(
      corrupt,
      issue(
        "BOOTSTRAP_CORRUPT_COLLECTION",
        entity,
        entity,
        `коллекция повреждена: ${read.reason}`,
        "восстановить из backup до apply",
      ),
    );
    return { raw: 0, items: [] };
  }
  const items: T[] = [];
  for (const raw of read.items) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      addIssue(
        corrupt,
        issue(
          "BOOTSTRAP_CORRUPT_EXISTING_RECORD",
          entity,
          isRecord(raw) ? String(raw.id ?? raw.catalog ?? "unknown") : "unknown",
          `существующая запись не проходит схему: ${String(parsed.error)}`,
          "квартировать/исправить вручную; apply запрещён",
        ),
      );
      continue;
    }
    items.push(parsed.data);
  }
  return { raw: read.items.length, items };
}

function buildLinkChecks(
  plan: BootstrapPlan,
  existingPriceItems: readonly PriceItem[],
  issues: BootstrapIssue[],
): {
  missingPriceItems: string[];
  unresolvedCatalogRefs: Array<{ entity: string; role: string; priceRef: string }>;
  unresolvedPresetRefs: Array<{ entity: string; priceRef: string }>;
} {
  const priceIds = new Set<string>([
    ...plan.priceItems.map((item) => item.id),
    ...existingPriceItems.map((item) => item.id),
  ]);
  const missing = new Set<string>();
  const unresolvedCatalogRefs: Array<{ entity: string; role: string; priceRef: string }> = [];
  const unresolvedPresetRefs: Array<{ entity: string; priceRef: string }> = [];

  for (const item of plan.catalogItems) {
    const engineAttrs =
      item.catalog === "supportSystem" || item.catalog === "ledStrip"
        ? Object.fromEntries(
            Object.entries(item.attrs).filter(([key]) => key !== "source"),
          )
        : item.attrs;
    const input: CatalogItemInput = {
      id: item.id,
      catalog: item.catalog,
      attrs: engineAttrs,
      priceRefs: (item.priceRefs ?? {}) as CatalogItemInput["priceRefs"],
    } as CatalogItemInput;
    const validated = validateCatalogItemInput(input);
    if (!validated.ok) {
      for (const itemIssue of validated.issues) {
        addIssue(
          issues,
          issue(
            "BOOTSTRAP_INVALID_CATALOG_CONTRACT",
            "CatalogItem",
            catalogKey(item),
            `${itemIssue.path}: ${itemIssue.message}`,
            "исправить mapping/attrs; не подставлять значения",
          ),
        );
      }
    }
    for (const [role, priceRef] of Object.entries(item.priceRefs ?? {})) {
      if (!priceIds.has(priceRef)) {
        missing.add(priceRef);
        unresolvedCatalogRefs.push({ entity: catalogKey(item), role, priceRef });
      }
    }
  }

  for (const preset of plan.modulePresets) {
    const validated = validateModulePresetInput({
      id: preset.id,
      family: preset.family,
      zone: preset.zone,
      width: preset.width,
      height: preset.height,
      depth: preset.depth,
      defaultShelves: preset.defaultShelves,
      defaultDrawers: preset.defaultDrawers,
      priceRef: preset.priceRef,
    });
    if (!validated.ok) {
      for (const itemIssue of validated.issues) {
        addIssue(
          issues,
          issue(
            "BOOTSTRAP_INVALID_PRESET_CONTRACT",
            "ModulePreset",
            presetKey(preset),
            `${itemIssue.path}: ${itemIssue.message}`,
            "исправить mapping/границы; не подставлять значения",
          ),
        );
      }
    }
    if (!priceIds.has(preset.priceRef)) {
      missing.add(preset.priceRef);
      unresolvedPresetRefs.push({ entity: presetKey(preset), priceRef: preset.priceRef });
    }
  }

  return {
    missingPriceItems: [...missing].sort(),
    unresolvedCatalogRefs,
    unresolvedPresetRefs,
  };
}

/**
 * Read-only dry-run по текущему Storage Adapter. Ничего не пишет.
 * `FORMAKUB_STORAGE=sqlite` + штатный `FORMAKUB_DATA_DIR` направляют его
 * на реальную БД; без переменной используется обычный адаптер окружения.
 */
export async function dryRunBootstrap(
  options: BootstrapPlanOptions = {},
): Promise<BootstrapDryRunReport> {
  const now = new Date().toISOString();
  const plan = buildBootstrapPlan(now, options);
  const ambiguous: BootstrapIssue[] = [];
  const corrupt: BootstrapIssue[] = [];
  const issues: BootstrapIssue[] = [...plan.issues];

  const [priceRead, versionRead, catalogRead, presetRead] = await Promise.all([
    readCollectionStatus<unknown>(PRICE_ITEMS),
    readCollectionStatus<unknown>(VERSIONS),
    readCollectionStatus<unknown>(CATALOGS),
    readCollectionStatus<unknown>(PRESETS),
  ]);

  const existingPrice = validCollection(priceRead, priceItemSchema, "PriceItem", corrupt);
  const existingVersions = validCollection(
    versionRead,
    pricingVersionSchema,
    "PricingVersion",
    corrupt,
  );
  const existingCatalogs = validCollection(
    catalogRead,
    catalogItemSchema,
    "CatalogItem",
    corrupt,
  );
  const existingPresets = validCollection(
    presetRead,
    modulePresetSchema,
    "ModulePreset",
    corrupt,
  );

  const existingPriceById = new Map(existingPrice.items.map((item) => [item.id, item]));
  const existingCatalogByKey = new Map(
    existingCatalogs.items.map((item) => [catalogKey(item), item]),
  );
  const existingPresetByKey = new Map(
    existingPresets.items.map((item) => [presetKey(item), item]),
  );
  const existingVersionById = new Map(
    existingVersions.items.map((item) => [item.id, item]),
  );

  let readyPriceItems = 0;
  let unchangedPriceItems = 0;
  for (const planned of plan.priceItems) {
    const existing = existingPriceById.get(planned.id);
    if (!existing) {
      readyPriceItems += 1;
    } else if (samePriceItem(existing, planned)) {
      unchangedPriceItems += 1;
    } else {
      const item = issue(
        "BOOTSTRAP_PRICE_ITEM_CONFLICT",
        "PriceItem",
        planned.id,
        "существующая ставка отличается от content (label/unit/scope/usage/status/editable/sourceRef)",
        "не перезаписывать автоматически; требуется решение владельца",
      );
      ambiguous.push(item);
      issues.push(item);
    }
  }

  let readyCatalogs = 0;
  let unchangedCatalogs = 0;
  for (const planned of plan.catalogItems) {
    const existing = existingCatalogByKey.get(catalogKey(planned));
    if (!existing) {
      readyCatalogs += 1;
    } else if (sameCatalog(existing, planned)) {
      unchangedCatalogs += 1;
    } else {
      const item = issue(
        "BOOTSTRAP_CATALOG_CONFLICT",
        "CatalogItem",
        catalogKey(planned),
        "существующая запись отличается от content (attrs/priceRefs/status/version/label)",
        "не перезаписывать автоматически; требуется решение владельца",
      );
      ambiguous.push(item);
      issues.push(item);
    }
  }

  let readyPresets = 0;
  let unchangedPresets = 0;
  for (const planned of plan.modulePresets) {
    const existing = existingPresetByKey.get(presetKey(planned));
    if (!existing) {
      readyPresets += 1;
    } else if (samePreset(existing, planned)) {
      unchangedPresets += 1;
    } else {
      const item = issue(
        "BOOTSTRAP_PRESET_CONFLICT",
        "ModulePreset",
        presetKey(planned),
        "существующий пресет отличается от content (границы/priceRef/status/version)",
        "не перезаписывать автоматически; требуется решение владельца",
      );
      ambiguous.push(item);
      issues.push(item);
    }
  }

  const published = existingVersions.items.filter((item) => item.status === "published");
  const drafts = existingVersions.items.filter((item) => item.status === "draft");
  if (published.length > 1) {
    const item = issue(
      "BOOTSTRAP_MULTIPLE_PUBLISHED",
      "PricingVersion",
      published.map((version) => version.id).join(", "),
      `обнаружено ${published.length} published-версий`,
      "не выбирать одну автоматически; требуется решение владельца",
    );
    ambiguous.push(item);
    issues.push(item);
  }
  if (drafts.length > 1) {
    const item = issue(
      "BOOTSTRAP_MULTIPLE_DRAFTS",
      "PricingVersion",
      drafts.map((version) => version.id).join(", "),
      `обнаружено ${drafts.length} draft-версий`,
      "не выбирать один автоматически; требуется решение владельца",
    );
    ambiguous.push(item);
    issues.push(item);
  }

  let readyVersions = 0;
  let unchangedVersions = 0;
  const target = existingVersionById.get(plan.pricingDraft.id);
  if (!target) {
    readyVersions = 1;
  } else if (!sameVersionCore(target, plan.pricingDraft)) {
    const item = issue(
      "BOOTSTRAP_PRICING_VERSION_CONFLICT",
      "PricingVersion",
      target.id,
      "существующая версия с тем же id отличается по snapshot/rules/promos/signedAdjustments/baseSchema",
      "не перезаписывать автоматически; требуется решение владельца",
    );
    ambiguous.push(item);
    issues.push(item);
  } else if (target.status === "published") {
    unchangedVersions = 1;
  } else if (target.status === "draft") {
    readyVersions = 1;
  } else {
    const item = issue(
      "BOOTSTRAP_PRICING_VERSION_STATUS",
      "PricingVersion",
      target.id,
      `версия имеет статус ${target.status}; bootstrap ожидает draft/published`,
      "требуется решение владельца",
    );
    ambiguous.push(item);
    issues.push(item);
  }

  const links = buildLinkChecks(plan, existingPrice.items, issues);

  const signedIssues: BootstrapIssue[] = plan.issues.filter(
    (item) => item.entity === "SignedAdjustment",
  );
  const signedPositive = plan.signedAdjustments.filter((item) => item.amount > 0).length;
  const signedNegative = plan.signedAdjustments.filter((item) => item.amount < 0).length;
  const signedZero = plan.signedAdjustments.filter((item) => item.amount === 0).length;

  const ledIssues: BootstrapIssue[] = [];
  const ledItems = plan.catalogItems.filter((item) =>
    ["ledStrip", "ledProfile", "ledDiffuser", "ledControl", "ledPsu"].includes(item.catalog),
  );
  const ledStrips = ledItems.filter((item) => item.catalog === "ledStrip");
  const ledPsu = ledItems.filter((item) => item.catalog === "ledPsu");
  const ledPsuIds = new Set<string>();
  for (const item of ledPsu) {
    if (ledPsuIds.has(item.id)) {
      ledIssues.push(
        issue(
          "BOOTSTRAP_DUPLICATE_LED_PSU",
          "ledPsu",
          item.id,
          "дубликат мощности БП",
          "остановить импорт",
        ),
      );
    }
    ledPsuIds.add(item.id);
  }
  for (const item of ledStrips) {
    const attrs = item.attrs;
    const ok =
      isRecord(attrs) &&
      Number.isFinite(attrs.power) &&
      (attrs.voltage === 12 || attrs.voltage === 24) &&
      Number.isFinite(attrs.maxContinuousRunM) &&
      Number.isFinite(attrs.voltageDropPct) &&
      Number.isFinite(attrs.maxPsuW);
    if (!ok) {
      ledIssues.push(
        issue(
          "BOOTSTRAP_INVALID_LED_STRIP",
          "ledStrip",
          item.id,
          "неполные/некорректные технические attrs",
          "исправить content/mapping; apply запрещён",
        ),
      );
    }
  }
  issues.push(...ledIssues);

  const referenceIssues: BootstrapIssue[] = [];
  const supportItems = plan.catalogItems.filter((item) => item.catalog === "supportSystem");
  for (const item of supportItems) {
    const refs = item.priceRefs ?? {};
    for (const role of ["legPrice", "clipPrice", "screwPrice", "anchorPrice"] as const) {
      if (!(role in refs)) {
        referenceIssues.push(
          issue(
            "BOOTSTRAP_SUPPORT_MISSING_ROLE",
            "supportSystem",
            catalogKey(item),
            `отсутствует роль ${role}`,
            "исправить mapping; не подставлять цену",
          ),
        );
      }
    }
  }
  const plinthFinishIds = new Set(
    plan.catalogItems
      .filter((item) => item.catalog === "plinthFinish")
      .map((item) => item.id),
  );
  for (const item of plan.catalogItems.filter((item) => item.catalog === "plinthMaterial")) {
    const attrs = item.attrs;
    const finishIds = isRecord(attrs) && Array.isArray(attrs.finishIds) ? attrs.finishIds : [];
    for (const finishId of finishIds) {
      if (typeof finishId !== "string" || !plinthFinishIds.has(finishId)) {
        referenceIssues.push(
          issue(
            "BOOTSTRAP_PLINTH_FINISH_UNRESOLVED",
            "plinthMaterial",
            catalogKey(item),
            `finishId "${String(finishId)}" не разрешается в plinthFinish`,
            "исправить mapping; не подставлять отделку",
          ),
        );
      }
    }
  }
  issues.push(...referenceIssues);

  const rulesKeys = Object.keys(plan.rules);
  if (rulesKeys.length !== 6) {
    referenceIssues.push(
      issue(
        "BOOTSTRAP_RULES_INVALID",
        "PriceRules",
        "rules",
        `ожидалось 6 правил, получено ${rulesKeys.length}`,
        "исправить mapping",
      ),
    );
  }

  const blockers = [
    ...issues
      .filter((item) => item.severity === "error")
      .map((item) => `${item.code}:${item.entity}:${item.id}`),
  ];
  const importable =
    blockers.length === 0 &&
    ambiguous.length === 0 &&
    corrupt.length === 0 &&
    links.missingPriceItems.length === 0 &&
    links.unresolvedCatalogRefs.length === 0 &&
    links.unresolvedPresetRefs.length === 0 &&
    signedIssues.length === 0 &&
    ledIssues.length === 0 &&
    referenceIssues.length === 0;

  const nextPublishedSeq =
    existingVersions.items.reduce(
      (max, version) =>
        version.publishedSeq !== undefined && version.publishedSeq > max
          ? version.publishedSeq
          : max,
      0,
    ) + 1;

  return {
    generatedAt: now,
    storageKind: resolveStorageKind(process.env.NODE_ENV, process.env.FORMAKUB_STORAGE),
    planned: {
      priceItems: plan.priceItems.length,
      priceSnapshot: plan.priceSnapshot.length,
      pricingVersions: 1,
      catalogItems: plan.catalogItems.length,
      modulePresets: plan.modulePresets.length,
      signedAdjustments: plan.signedAdjustments.length,
      promos: plan.promos.length,
      rules: rulesKeys.length,
    },
    existing: {
      total: {
        priceItems: existingPrice.raw,
        pricingVersions: existingVersions.raw,
        catalogItems: existingCatalogs.raw,
        modulePresets: existingPresets.raw,
      },
      valid: {
        priceItems: existingPrice.items.length,
        pricingVersions: existingVersions.items.length,
        catalogItems: existingCatalogs.items.length,
        modulePresets: existingPresets.items.length,
      },
    },
    ready: {
      priceItems: readyPriceItems,
      catalogItems: readyCatalogs,
      modulePresets: readyPresets,
      pricingVersions: readyVersions,
    },
    unchanged: {
      priceItems: unchangedPriceItems,
      catalogItems: unchangedCatalogs,
      modulePresets: unchangedPresets,
      pricingVersions: unchangedVersions,
    },
    ambiguous,
    corrupt,
    missingPriceItems: links.missingPriceItems,
    unresolvedCatalogRefs: links.unresolvedCatalogRefs,
    unresolvedPresetRefs: links.unresolvedPresetRefs,
    signedAdjustments: {
      total: plan.signedAdjustments.length,
      positive: signedPositive,
      negative: signedNegative,
      zero: signedZero,
      issues: signedIssues,
    },
    led: {
      strips: ledStrips.length,
      profiles: ledItems.filter((item) => item.catalog === "ledProfile").length,
      diffusers: ledItems.filter((item) => item.catalog === "ledDiffuser").length,
      controls: ledItems.filter((item) => item.catalog === "ledControl").length,
      psu: ledPsu.length,
      issues: ledIssues,
    },
    referenceData: {
      supportSystems: supportItems.length,
      plinthFinishes: plinthFinishIds.size,
      plinthMounts: plan.catalogItems.filter((item) => item.catalog === "plinthMount").length,
      rules: rulesKeys.length,
      promos: plan.promos.length,
      issues: referenceIssues,
    },
    nextPublishedSeq,
    importable,
    blockers,
  };
}

export interface ApplyBootstrapOptions extends BootstrapPlanOptions {
  actor?: ActorContext;
  now?: string;
}

export interface ApplyBootstrapResult {
  plan: BootstrapPlan;
  version: PricingVersion;
  publishedSeq: number;
  published: boolean;
  idempotent: boolean;
  written: {
    priceItems: number;
    catalogItems: number;
    modulePresets: number;
    pricingVersions: number;
  };
}

function mergePlanned<T>(
  existing: readonly T[],
  planned: readonly T[],
  keyOf: (item: T) => string,
  same: (a: T, b: T) => boolean,
  entity: string,
): { items: T[]; added: number } {
  const byKey = new Map(existing.map((item) => [keyOf(item), item]));
  const result = [...existing];
  let added = 0;
  for (const item of planned) {
    const key = keyOf(item);
    const current = byKey.get(key);
    if (current === undefined) {
      byKey.set(key, item);
      result.push(item);
      added += 1;
    } else if (!same(current, item)) {
      throw new Error(
        `Bootstrap apply: конфликт ${entity} "${key}" с существующей записью — apply отменён.`,
      );
    }
  }
  return { items: result, added };
}

/**
 * Production apply: preflight → атомарная запись четырёх коллекций →
 * проверка связей → publicация начальной версии. Backup создаётся
 * вызывающей стороной до вызова (штатный backupDatabase).
 *
 * Идемпотентность: повторный вызов при том же плане и опубликованной
 * версии не создаёт записей и не публикует повторно. Draft с тем же
 * содержимым публикуется один раз.
 */
export async function applyBootstrap(
  options: ApplyBootstrapOptions = {},
): Promise<ApplyBootstrapResult> {
  const now = options.now ?? new Date().toISOString();
  const planOptions: BootstrapPlanOptions = {
    ...(options.pricingVersionId !== undefined
      ? { pricingVersionId: options.pricingVersionId }
      : {}),
    ...(options.pricingLabel !== undefined ? { pricingLabel: options.pricingLabel } : {}),
  };
  const plan = buildBootstrapPlan(now, planOptions);
  if (plan.issues.length > 0) {
    throw new Error(
      `Bootstrap apply: план содержит ошибки: ${plan.issues
        .map((item) => `${item.code}:${item.id}`)
        .join("; ")}`,
    );
  }

  const preflight = await dryRunBootstrap(planOptions);
  if (!preflight.importable) {
    throw new Error(
      `Bootstrap apply: preflight не пройден: ${preflight.blockers.join("; ") || "см. report"}`,
    );
  }

  const storage = getStorage();
  if (!(storage instanceof SqliteStorage)) {
    throw new Error(
      "Bootstrap apply: production apply разрешён только для SQLite Storage Adapter.",
    );
  }

  const [existingPrice, existingCatalogs, existingPresets, existingVersions, existingParameters] =
    await Promise.all([
      readCollection<PriceItem>(PRICE_ITEMS),
      readCollection<CatalogItem>(CATALOGS),
      readCollection<ModulePreset>(PRESETS),
      readCollection<PricingVersion>(VERSIONS),
      readCollection<AdminParameter>("admin-parameters.json"),
    ]);

  const price = mergePlanned(
    existingPrice,
    plan.priceItems,
    (item) => item.id,
    samePriceItem,
    "PriceItem",
  );
  const catalogs = mergePlanned(
    existingCatalogs,
    plan.catalogItems,
    catalogKey,
    sameCatalog,
    "CatalogItem",
  );
  const presets = mergePlanned(
    existingPresets,
    plan.modulePresets,
    presetKey,
    samePreset,
    "ModulePreset",
  );
  // AdminParameter: только добавление отсутствующих, без перезаписи ручных правок.
  const existingParameterIds = new Set(existingParameters.map((item) => item.id));
  const missingParameters = plan.adminParameters.filter(
    (item) => !existingParameterIds.has(item.id),
  );

  const target = existingVersions.find((item) => item.id === plan.pricingDraft.id);
  if (target && !sameVersionCore(target, plan.pricingDraft)) {
    throw new Error(
      `Bootstrap apply: существующая PricingVersion "${target.id}" отличается от плана — apply отменён.`,
    );
  }
  if (target && target.status !== "draft" && target.status !== "published") {
    throw new Error(
      `Bootstrap apply: PricingVersion "${target.id}" имеет статус ${target.status} — apply отменён.`,
    );
  }
  if (!target) {
    const otherPublished = existingVersions.find((item) => item.status === "published");
    if (otherPublished) {
      throw new Error(
        `Bootstrap apply: уже существует published-версия "${otherPublished.id}" — начальный bootstrap не должен создавать вторую.`,
      );
    }
  }

  const versions = target ? existingVersions : [...existingVersions, plan.pricingDraft];
  const noChanges =
    price.added === 0 &&
    catalogs.added === 0 &&
    presets.added === 0 &&
    missingParameters.length === 0 &&
    target !== undefined &&
    target.status === "published";

  if (!noChanges) {
    storage.applyBatch([
      { file: PRICE_ITEMS, items: price.items },
      { file: CATALOGS, items: catalogs.items },
      { file: PRESETS, items: presets.items },
      { file: VERSIONS, items: versions },
      {
        file: "admin-parameters.json",
        items: [...existingParameters, ...missingParameters],
      },
    ]);
  }

  // Проверка связей до публикации — по фактически записанным PriceItem.
  const postWriteIssues: BootstrapIssue[] = [];
  const links = buildLinkChecks(plan, price.items, postWriteIssues);
  if (
    postWriteIssues.some((item) => item.severity === "error") ||
    links.missingPriceItems.length > 0 ||
    links.unresolvedCatalogRefs.length > 0 ||
    links.unresolvedPresetRefs.length > 0
  ) {
    throw new Error(
      "Bootstrap apply: связи после записи не разрешаются — публикация отменена; восстановите backup.",
    );
  }

  const actor: ActorContext = options.actor ?? {
    actorId: BOOTSTRAP_ACTOR,
    actorRole: "system",
  };

  const current = (await readCollection<PricingVersion>(VERSIONS)).find(
    (item) => item.id === plan.pricingDraft.id,
  );
  if (!current) {
    throw new Error("Bootstrap apply: версия не найдена после записи.");
  }

  let published = false;
  let publishedSeq = current.publishedSeq ?? 0;
  let version = current;
  if (current.status === "draft") {
    const result = await publishPricingVersion(current.id, actor);
    version = result.version;
    publishedSeq = result.publishedSeq;
    published = true;
  } else if (current.status === "published") {
    publishedSeq = current.publishedSeq ?? 0;
  } else {
    throw new Error(
      `Bootstrap apply: версия "${current.id}" в статусе ${current.status} — публикация невозможна.`,
    );
  }

  return {
    plan,
    version,
    publishedSeq,
    published,
    idempotent: noChanges,
    written: {
      priceItems: price.added,
      catalogItems: catalogs.added,
      modulePresets: presets.added,
      pricingVersions: target ? 0 : 1,
    },
  };
}
