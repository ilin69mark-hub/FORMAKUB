import { getPublishedVersion, getVersion } from "@/lib/admin/pricing";
import {
  resolveActiveRulesSnapshot,
  resolveRulesSnapshotById,
  type RulesSnapshot,
} from "@/lib/admin/managed-rules";
import {
  getCompositionVersion,
  validateCompositionForConfig,
  validateCompositionVersion,
} from "@/lib/admin/composition";
import type { CompositionVersion } from "@/lib/admin/composition-schema";
import {
  catalogItemSchema,
  modulePresetSchema,
  pricingVersionSchema,
  type CatalogItem,
  type ModulePreset,
  type PricingVersion,
} from "@/lib/admin/schema";
import { validateCalculationRequest } from "@/lib/configurator/contract";
import {
  FIXED_BODY_MATERIAL_ID,
  LEGACY_FACADE_BLOCK_MESSAGE,
  isLegacyFacadeMaterial,
} from "@/lib/configurator/materials";
import type {
  CalculationInputs,
  CalculationRequest,
  CatalogItemInput,
  ManagedRuleInput,
  ModulePresetInput,
  PriceSnapshotInput,
  RulesSnapshotInput,
} from "@/lib/configurator/contract";
import type {
  FurnitureConfig,
  KitchenConfig,
  ProjectPins,
  StoredProject,
} from "@/lib/configurator/types";
import {
  BUILD_CALC_VERSION,
  SUPPORTED_SCHEMA_VERSION,
} from "@/lib/configurator/versions";
import { readCollectionStatus } from "@/lib/server/store";

import { getParameterManifest } from "./parameter-registry";

/**
 * CA-T-304 — DataResolver.
 *
 * Единственный серверный слой, собирающий `CalculationInputs` из Storage
 * Adapter. Engine не обращается к Admin/Storage/content; сюда же сведены
 * проверки версий, pins и fail-closed диагностика. Резолвер ничего не
 * записывает и не меняет `config`, геометрию или `pins` проекта.
 *
 * `parameters` — утверждённый реестр сборки (`calcVersion`), переданный
 * вызывающим слоем. Живые `AdminParameter.value` не используются: ADR-06
 * §9.5 запрещает подмену реестра live-значениями. Хранилища реестра в коде
 * пока нет (ADR-06 §9.5, CA-RISK-010), поэтому по умолчанию контейнер пуст.
 */

export type DataResolverOperation = "create" | "preview" | "recalculate";

export type DataResolverErrorCode =
  | "ENGINE_CONTRACT_MISSING_INPUT"
  | "ENGINE_CONTRACT_UNKNOWN_ATTRIBUTE"
  | "ENGINE_CONTRACT_INCOMPATIBLE_SCHEMA"
  | "ENGINE_CONTRACT_PROJECT_CALC_VERSION_MISMATCH"
  | "ENGINE_CONTRACT_EXECUTED_CALC_VERSION_MISMATCH"
  | "ENGINE_CONTRACT_CALC_VERSION_INCOMPATIBLE"
  | "ENGINE_CONTRACT_CALC_VERSION_UNKNOWN"
  | "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE"
  | "ENGINE_CONTRACT_PRICE_VERSION_TARGET_MISMATCH"
  | "ENGINE_CONTRACT_STALE_SOURCE_PRICE_VERSION"
  | "ENGINE_CONTRACT_PINS_UNRESOLVED"
  | "ENGINE_CONTRACT_REFERENCE_VERSION_UNAVAILABLE"
  | "ENGINE_CONTRACT_REFERENCE_INTEGRITY"
  | "ENGINE_CONTRACT_LEGACY_FACADE_MATERIAL"
  | "RULES_SNAPSHOT_MISSING"
  | "RULES_SNAPSHOT_UNKNOWN"
  | "RULES_SNAPSHOT_CORRUPT"
  | "COMPOSITION_VERSION_MISSING"
  | "COMPOSITION_VERSION_UNKNOWN"
  | "COMPOSITION_VERSION_CORRUPT"
  | "COMPOSITION_VERSION_INVALID"
  /** Неблокирующие drift-предупреждения (Q4/В-5, §8.5). */
  | "COMPOSITION_PRICE_VERSION_DRIFT"
  | "COMPOSITION_PRICE_SNAPSHOT_DRIFT"
  | "COMPOSITION_CATALOG_VERSION_DRIFT";

export interface DataResolverIssue {
  code: DataResolverErrorCode;
  path: string;
  message: string;
  /** Идентификатор проблемной записи, если он известен. */
  entityId?: string;
}

export interface ResolveCalculationInput {
  operation: DataResolverOperation;
  /** create/preview: исходный config; для recalculate берётся из project. */
  config?: FurnitureConfig;
  /** recalculate: сохранённый проект (read-only). */
  project?: StoredProject;
  /** recalculate: версия-цель; create/preview: должна совпасть с published. */
  targetPriceVersionId?: string;
  /** recalculate: обязательна, независима от requiredExecutedCalcVersion. */
  expectedProjectCalcVersion?: string;
  /** recalculate: обязательна, независима от expectedProjectCalcVersion. */
  requiredExecutedCalcVersion?: string;
  /** recalculate: ожидаемая source-версия (null допустим только для legacy). */
  expectedSourcePriceVersion?: string | null;
  /** Явно нормализованный schemaVersion; иначе один раз выводится ниже. */
  schemaVersion?: number;
  /**
   * Явно выбранная опубликованная версия состава (create/preview/admin).
   * Для recalculate при отсутствии берётся `project.compositionVersionId`.
   */
  compositionVersionId?: string;
}

export interface ResolvedCalculation {
  request: CalculationRequest;
  /** Для create/preview — версии, которые фиксируются при сохранении. */
  pins: ProjectPins;
  catalogVersions: Record<string, Record<string, string>>;
  presetVersions: Record<string, Record<string, string>>;
  /** Версия состава, использованная в preflight (если закреплена/выбрана). */
  compositionVersionId?: string;
  /**
   * E1 — типизированный handoff preflight Composition для последующего
   * `resolveCompositionTrace` (design rev.4 §8.1). Присутствует только когда
   * закреплённая/выбранная версия прошла блокирующие проверки.
   * `CalculationInputs` и `CalculationRequest` при этом не изменяются.
   */
  compositionPreflight?: CompositionPreflight;
}

/**
 * Результат preflight Composition (ADR-08, design rev.4 §8.1).
 *
 * Разделение по В-5/§8.5:
 * - блокирующие ошибки возвращаются отдельным массивом `issues` и останавливают
 *   расчёт (прежняя семантика `data-resolver` сохранена байт-в-байт);
 * - drift-предупреждения (Q4) — `warnings`, на расчёт **не** влияют.
 */
export interface CompositionPreflight {
  compositionVersionId: string;
  /** Опубликованная версия состава — read-only источник строк trace. */
  composition: CompositionVersion;
  /** Неблокирующие предупреждения (drift pins, Q4/В-5). */
  warnings: DataResolverIssue[];
}

export type DataResolverResult =
  | { ok: true; value: ResolvedCalculation }
  | { ok: false; issues: DataResolverIssue[] };

const CATALOGS = "catalog-items.json";
const PRESETS = "module-presets.json";

interface CatalogRef {
  catalog: CatalogItem["catalog"];
  id: string;
}

const ID_ATTR_KINDS = new Set<CatalogItem["catalog"]>([
  "plinthFinish",
  "plinthMount",
  "ledProfile",
  "ledDiffuser",
  "ledControl",
]);

const NO_PRICE_KINDS = new Set<CatalogItem["catalog"]>([
  "plinthFinish",
  "plinthMount",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  code: DataResolverErrorCode,
  path: string,
  message: string,
  entityId?: string,
): DataResolverIssue {
  return entityId === undefined
    ? { code, path, message }
    : { code, path, message, entityId };
}

function operationOf(value: unknown): DataResolverOperation | null {
  return value === "create" || value === "preview" || value === "recalculate"
    ? value
    : null;
}

/**
 * ADR-06 §10.2: нормализация выполняется один раз в слое чтения.
 * Присутствующий, но невалидный `schemaVersion` — fail-closed без fallback.
 */
export function normalizeSchemaVersion(input: {
  schemaVersion?: number;
  project?: StoredProject;
  config?: FurnitureConfig;
}): { value?: number; issue?: DataResolverIssue } {
  if (input.schemaVersion !== undefined) {
    if (
      !Number.isInteger(input.schemaVersion) ||
      input.schemaVersion < 1
    ) {
      return {
        issue: issue(
          "ENGINE_CONTRACT_INCOMPATIBLE_SCHEMA",
          "request.schemaVersion",
          "schemaVersion обязан быть целым ≥ 1",
        ),
      };
    }
    if (input.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
      return {
        issue: issue(
          "ENGINE_CONTRACT_INCOMPATIBLE_SCHEMA",
          "request.schemaVersion",
          `schemaVersion ${input.schemaVersion} новее поддерживаемой ${SUPPORTED_SCHEMA_VERSION}`,
        ),
      };
    }
    return { value: input.schemaVersion };
  }

  const explicit = input.project?.schemaVersion;
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit < 1) {
      return {
        issue: issue(
          "ENGINE_CONTRACT_INCOMPATIBLE_SCHEMA",
          "project.schemaVersion",
          "project.schemaVersion обязан быть целым ≥ 1",
        ),
      };
    }
    if (explicit > SUPPORTED_SCHEMA_VERSION) {
      return {
        issue: issue(
          "ENGINE_CONTRACT_INCOMPATIBLE_SCHEMA",
          "project.schemaVersion",
          `project.schemaVersion ${explicit} новее поддерживаемой ${SUPPORTED_SCHEMA_VERSION}`,
        ),
      };
    }
    return { value: explicit };
  }

  const configVersion = input.config?.version;
  const value =
    Number.isInteger(configVersion) && Number(configVersion) >= 1
      ? Number(configVersion)
      : SUPPORTED_SCHEMA_VERSION;
  if (value > SUPPORTED_SCHEMA_VERSION) {
    return {
      issue: issue(
        "ENGINE_CONTRACT_INCOMPATIBLE_SCHEMA",
        "request.schemaVersion",
        `schemaVersion ${value} новее поддерживаемой ${SUPPORTED_SCHEMA_VERSION}`,
      ),
    };
  }
  return { value };
}

function baseCatalogRefs(config: FurnitureConfig): CatalogRef[] {
  const refs: CatalogRef[] = [
    { catalog: "bodyMaterial", id: FIXED_BODY_MATERIAL_ID },
    { catalog: "facadeMaterial", id: config.facadeMaterial },
    { catalog: "facadeStyle", id: config.facadeStyle },
    { catalog: "handle", id: config.handle },
  ];
  if (config.kind === "kitchen") {
    refs.push(
      { catalog: "countertop", id: config.countertop },
      { catalog: "supportSystem", id: config.supports.systemId },
    );
    if (config.plinth) {
      refs.push(
        { catalog: "plinthMaterial", id: config.plinthMaterial },
        { catalog: "plinthFinish", id: config.plinthFinish },
        { catalog: "plinthMount", id: config.plinthMount },
      );
    }
    if (config.underCabinetLighting) {
      refs.push(
        { catalog: "ledProfile", id: config.lighting.profile },
        { catalog: "ledDiffuser", id: config.lighting.diffuser },
        { catalog: "ledControl", id: config.lighting.control },
      );
    }
  }
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.catalog}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function presetRefs(config: FurnitureConfig): Array<{
  family: ModulePreset["family"];
  id: string;
}> {
  if (config.kind !== "kitchen") return [];
  const seen = new Set<string>();
  const refs: Array<{ family: ModulePreset["family"]; id: string }> = [];
  for (const kitchenModule of config.modules) {
    const key = `kitchen:${kitchenModule.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ family: "kitchen", id: kitchenModule.type });
  }
  return refs;
}

function toCatalogInput(item: CatalogItem): CatalogItemInput {
  // source — display/reference metadata, не входит в CatalogItemInput.
  const engineAttrs =
    item.catalog === "supportSystem" || item.catalog === "ledStrip"
      ? Object.fromEntries(
          Object.entries(item.attrs).filter(([key]) => key !== "source"),
        )
      : item.attrs;
  const attrs = ID_ATTR_KINDS.has(item.catalog)
    ? Object.keys(engineAttrs).length === 0
      ? { id: item.id }
      : engineAttrs
    : engineAttrs;
  const priceRefs = NO_PRICE_KINDS.has(item.catalog)
    ? (item.priceRefs ?? {})
    : (item.priceRefs ?? {});
  return {
    id: item.id,
    catalog: item.catalog,
    attrs,
    priceRefs,
  } as CatalogItemInput;
}

function toPresetInput(preset: ModulePreset): ModulePresetInput {
  return {
    id: preset.id,
    family: preset.family,
    zone: preset.zone as ModulePresetInput["zone"],
    width: preset.width,
    height: preset.height,
    depth: preset.depth,
    defaultShelves: preset.defaultShelves,
    defaultDrawers: preset.defaultDrawers,
    priceRef: preset.priceRef,
  };
}

function pinFor(
  pins: ProjectPins | undefined,
  ref: CatalogRef,
): string | undefined {
  return pins?.catalogVersions?.[ref.catalog]?.[ref.id];
}

function presetPinFor(
  pins: ProjectPins | undefined,
  ref: { family: ModulePreset["family"]; id: string },
): string | undefined {
  return pins?.presetVersions?.[ref.family]?.[ref.id];
}

function buildPins(
  catalogs: readonly CatalogItem[],
  presets: readonly ModulePreset[],
): ProjectPins {
  const catalogVersions: Record<string, Record<string, string>> = {};
  for (const item of catalogs) {
    (catalogVersions[item.catalog] ??= {})[item.id] = item.version;
  }
  const presetVersions: Record<string, Record<string, string>> = {};
  for (const preset of presets) {
    (presetVersions[preset.family] ??= {})[preset.id] = preset.version;
  }
  const pins: ProjectPins = {};
  if (Object.keys(catalogVersions).length > 0) pins.catalogVersions = catalogVersions;
  if (Object.keys(presetVersions).length > 0) pins.presetVersions = presetVersions;
  return pins;
}

function parseCatalog(
  raw: unknown,
  path: string,
  issues: DataResolverIssue[],
): CatalogItem | null {
  const parsed = catalogItemSchema.safeParse(raw);
  if (!parsed.success) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_REFERENCE_INTEGRITY",
        path,
        `запись справочника не проходит схему: ${parsed.error.message}`,
        isRecord(raw) ? String(raw.id ?? "") : undefined,
      ),
    );
    return null;
  }
  return parsed.data;
}

function parsePreset(
  raw: unknown,
  path: string,
  issues: DataResolverIssue[],
): ModulePreset | null {
  const parsed = modulePresetSchema.safeParse(raw);
  if (!parsed.success) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_REFERENCE_INTEGRITY",
        path,
        `запись пресета не проходит схему: ${parsed.error.message}`,
        isRecord(raw) ? String(raw.id ?? "") : undefined,
      ),
    );
    return null;
  }
  return parsed.data;
}

async function readCollectionItems(
  file: string,
  path: string,
  issues: DataResolverIssue[],
): Promise<unknown[]> {
  const read = await readCollectionStatus<unknown>(file);
  if (read.status === "corrupt") {
    issues.push(
      issue(
        "ENGINE_CONTRACT_REFERENCE_INTEGRITY",
        path,
        `коллекция повреждена: ${read.reason}`,
        file,
      ),
    );
    return [];
  }
  return read.status === "ok" ? read.items : [];
}

function selectCatalog(
  items: readonly CatalogItem[],
  ref: CatalogRef,
  options: {
    operation: DataResolverOperation;
    versionPin?: string;
  },
  path: string,
  issues: DataResolverIssue[],
): CatalogItem | undefined {
  const item = items.find(
    (candidate) => candidate.catalog === ref.catalog && candidate.id === ref.id,
  );
  const entityId = `${ref.catalog}:${ref.id}`;

  // CA-515-06: старые проекты не содержат pin фиксированного корпуса LDSP.
  // Для пересчёта разрешён fallback на актуальную опубликованную (active)
  // запись LDSP. Draft-цены здесь не участвуют: CatalogItem не имеет
  // draft-состояния, а archived/preliminary не подставляются.
  const bodyFallback =
    options.operation === "recalculate" &&
    options.versionPin === undefined &&
    ref.catalog === "bodyMaterial" &&
    ref.id === FIXED_BODY_MATERIAL_ID &&
    item?.status === "active"
      ? item.version
      : undefined;
  const effectivePin = options.versionPin ?? bodyFallback;

  if (options.operation === "recalculate" && effectivePin === undefined) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_PINS_UNRESOLVED",
        path,
        `pin для ${entityId} отсутствует; текущая версия не подставляется`,
        entityId,
      ),
    );
    return undefined;
  }
  if (!item) {
    issues.push(
      issue(
        options.operation === "recalculate"
          ? "ENGINE_CONTRACT_PINS_UNRESOLVED"
          : "ENGINE_CONTRACT_MISSING_INPUT",
        path,
        `элемент справочника ${entityId} не найден`,
        entityId,
      ),
    );
    return undefined;
  }
  if (
    options.operation === "recalculate" &&
    effectivePin !== item.version
  ) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_REFERENCE_VERSION_UNAVAILABLE",
        path,
        `версия ${entityId}=${effectivePin} недоступна (текущая ${item.version}); история не подставляется`,
        entityId,
      ),
    );
    return undefined;
  }
  if (options.operation !== "recalculate" && item.status !== "active") {
    issues.push(
      issue(
        "ENGINE_CONTRACT_REFERENCE_VERSION_UNAVAILABLE",
        path,
        `элемент ${entityId} в статусе ${item.status}; для нового расчёта нужен active`,
        entityId,
      ),
    );
    return undefined;
  }
  if (item.status === "preliminary") {
    issues.push(
      issue(
        "ENGINE_CONTRACT_REFERENCE_INTEGRITY",
        path,
        `элемент ${entityId} preliminary; расчётный вход не подтверждён`,
        entityId,
      ),
    );
    return undefined;
  }
  if (Array.isArray(item.priceRefs)) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_UNKNOWN_ATTRIBUTE",
        path,
        `legacy priceRefs string[] у ${entityId}; требуется миграция CA-T-304A`,
        entityId,
      ),
    );
    return undefined;
  }
  if (
    ID_ATTR_KINDS.has(item.catalog) &&
    isRecord(item.attrs) &&
    item.attrs.id !== undefined &&
    item.attrs.id !== item.id
  ) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_REFERENCE_INTEGRITY",
        path,
        `attrs.id "${String(item.attrs.id)}" не совпадает с id "${item.id}"`,
        entityId,
      ),
    );
    return undefined;
  }
  return item;
}

function selectPreset(
  items: readonly ModulePreset[],
  ref: { family: ModulePreset["family"]; id: string },
  options: {
    operation: DataResolverOperation;
    versionPin?: string;
  },
  path: string,
  issues: DataResolverIssue[],
): ModulePreset | undefined {
  const entityId = `${ref.family}:${ref.id}`;
  if (options.operation === "recalculate" && options.versionPin === undefined) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_PINS_UNRESOLVED",
        path,
        `pin для пресета ${entityId} отсутствует; текущая версия не подставляется`,
        entityId,
      ),
    );
    return undefined;
  }
  const preset = items.find(
    (candidate) => candidate.family === ref.family && candidate.id === ref.id,
  );
  if (!preset) {
    issues.push(
      issue(
        options.operation === "recalculate"
          ? "ENGINE_CONTRACT_PINS_UNRESOLVED"
          : "ENGINE_CONTRACT_MISSING_INPUT",
        path,
        `пресет ${entityId} не найден`,
        entityId,
      ),
    );
    return undefined;
  }
  if (
    options.operation === "recalculate" &&
    options.versionPin !== preset.version
  ) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_REFERENCE_VERSION_UNAVAILABLE",
        path,
        `версия пресета ${entityId}=${options.versionPin} недоступна (текущая ${preset.version})`,
        entityId,
      ),
    );
    return undefined;
  }
  if (options.operation !== "recalculate" && preset.status !== "active") {
    issues.push(
      issue(
        "ENGINE_CONTRACT_REFERENCE_VERSION_UNAVAILABLE",
        path,
        `пресет ${entityId} в статусе ${preset.status}; для нового расчёта нужен active`,
        entityId,
      ),
    );
    return undefined;
  }
  if (!preset.priceRef.trim()) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_MISSING_INPUT",
        path,
        `у пресета ${entityId} отсутствует priceRef`,
        entityId,
      ),
    );
    return undefined;
  }
  return preset;
}

function selectLedStrip(
  items: readonly CatalogItem[],
  config: KitchenConfig,
  operation: DataResolverOperation,
  pins: ProjectPins | undefined,
  issues: DataResolverIssue[],
): CatalogItem | undefined {
  const pinnedIds = pins?.catalogVersions?.ledStrip;
  if (operation === "recalculate" && pinnedIds !== undefined) {
    const ids = Object.keys(pinnedIds);
    if (ids.length !== 1) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_PINS_UNRESOLVED",
          "inputs.catalogs.ledStrip",
          `ожидался ровно один pin ledStrip, найдено ${ids.length}`,
          "ledStrip",
        ),
      );
      return undefined;
    }
    const id = ids[0]!;
    const item = items.find(
      (candidate) => candidate.catalog === "ledStrip" && candidate.id === id,
    );
    if (!item) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_PINS_UNRESOLVED",
          "inputs.catalogs.ledStrip",
          `ledStrip ${id} из pins не найден`,
          `ledStrip:${id}`,
        ),
      );
      return undefined;
    }
    return selectCatalog(
      items,
      { catalog: "ledStrip", id },
      { operation, versionPin: pinnedIds[id] },
      "inputs.catalogs.ledStrip",
      issues,
    );
  }

  if (operation === "recalculate" && pinnedIds === undefined) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_PINS_UNRESOLVED",
        "inputs.catalogs.ledStrip",
        "pins ledStrip отсутствуют; текущая версия не подставляется",
        "ledStrip",
      ),
    );
    return undefined;
  }

  const matches = items.filter((item) => {
    if (item.catalog !== "ledStrip") return false;
    if (operation !== "recalculate" && item.status !== "active") return false;
    if (!isRecord(item.attrs)) return false;
    return (
      item.attrs.power === config.lighting.powerPerMeter &&
      item.attrs.voltage === config.lighting.voltage
    );
  });
  if (matches.length === 0) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_MISSING_INPUT",
        "inputs.catalogs.ledStrip",
        `нет ledStrip с power=${config.lighting.powerPerMeter}, voltage=${config.lighting.voltage}`,
      ),
    );
    return undefined;
  }
  if (matches.length > 1) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_REFERENCE_INTEGRITY",
        "inputs.catalogs.ledStrip",
        `неоднозначный выбор ledStrip: ${matches.map((item) => item.id).join(", ")}`,
      ),
    );
    return undefined;
  }
  return selectCatalog(
    items,
    { catalog: "ledStrip", id: matches[0]!.id },
    { operation, versionPin: undefined },
    "inputs.catalogs.ledStrip",
    issues,
  );
}

async function resolvePriceVersion(
  input: ResolveCalculationInput,
  project: StoredProject | undefined,
  issues: DataResolverIssue[],
): Promise<PricingVersion | undefined> {
  if (input.operation === "recalculate") {
    if (project?.priceVersion === undefined) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE",
          "project.priceVersion",
          "priceVersion отсутствует; пересчёт legacy-проекта заблокирован",
          project?.id,
        ),
      );
      return undefined;
    }
    if (input.expectedSourcePriceVersion === undefined) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_MISSING_INPUT",
          "expectedSourcePriceVersion",
          "для пересчёта обязательна ожидаемая source-версия",
          project?.id,
        ),
      );
      return undefined;
    }
    if (input.expectedSourcePriceVersion !== project.priceVersion) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_STALE_SOURCE_PRICE_VERSION",
          "expectedSourcePriceVersion",
          `source "${project.priceVersion}" ≠ ожидаемой "${input.expectedSourcePriceVersion}"`,
          project?.id,
        ),
      );
      return undefined;
    }
  }

  let version: PricingVersion | undefined;
  try {
    if (input.operation === "recalculate") {
      const targetId = input.targetPriceVersionId ?? project!.priceVersion!;
      version = await getVersion(targetId);
    } else {
      version = await getPublishedVersion();
      if (
        input.targetPriceVersionId !== undefined &&
        version?.id !== input.targetPriceVersionId
      ) {
        issues.push(
          issue(
            "ENGINE_CONTRACT_PRICE_VERSION_TARGET_MISMATCH",
            "targetPriceVersionId",
            `target "${input.targetPriceVersionId}" ≠ published "${version?.id ?? "нет"}"`,
          ),
        );
        return undefined;
      }
    }
  } catch (error) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE",
        "priceSnapshot.priceVersion",
        `версия прайса не разрешена: ${(error as Error).message}`,
      ),
    );
    return undefined;
  }

  if (!version) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE",
        "priceSnapshot.priceVersion",
        input.operation === "recalculate"
          ? `версия прайса "${input.targetPriceVersionId ?? project!.priceVersion}" не найдена`
          : "опубликованная версия прайса отсутствует",
        input.targetPriceVersionId ?? project?.priceVersion,
      ),
    );
    return undefined;
  }

  const parsed = pricingVersionSchema.safeParse(version);
  if (!parsed.success) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_REFERENCE_INTEGRITY",
        "priceSnapshot",
        `PricingVersion "${version.id}" не проходит схему: ${parsed.error.message}`,
        version.id,
      ),
    );
    return undefined;
  }

  if (input.operation === "recalculate") {
    const target = parsed.data;
    if (target.status !== "published") {
      issues.push(
        issue(
          "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE",
          "targetPriceVersionId",
          `target "${target.id}" в статусе ${target.status}; для пересчёта допустима только published`,
          target.id,
        ),
      );
      return undefined;
    }

    let currentRaw: PricingVersion | undefined;
    try {
      currentRaw = await getVersion(project!.priceVersion!);
    } catch (error) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE",
          "project.priceVersion",
          `текущая версия проекта не разрешена: ${(error as Error).message}`,
          project?.id,
        ),
      );
      return undefined;
    }
    if (!currentRaw) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE",
          "project.priceVersion",
          `текущая версия проекта "${project!.priceVersion}" не найдена`,
          project?.id,
        ),
      );
      return undefined;
    }
    const currentParsed = pricingVersionSchema.safeParse(currentRaw);
    if (!currentParsed.success) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_REFERENCE_INTEGRITY",
          "project.priceVersion",
          `текущая версия проекта "${currentRaw.id}" не проходит схему: ${currentParsed.error.message}`,
          currentRaw.id,
        ),
      );
      return undefined;
    }
    if (
      target.publishedSeq === undefined ||
      currentParsed.data.publishedSeq === undefined
    ) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE",
          "targetPriceVersionId",
          "publishedSeq отсутствует у target или текущей версии; сравнение порядка невозможно",
          target.id,
        ),
      );
      return undefined;
    }
    if (target.publishedSeq < currentParsed.data.publishedSeq) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_PRICE_VERSION_TARGET_MISMATCH",
          "targetPriceVersionId",
          `target publishedSeq ${target.publishedSeq} < текущего ${currentParsed.data.publishedSeq}; откат версии запрещён`,
          target.id,
        ),
      );
      return undefined;
    }
  }

  return parsed.data;
}

function checkCalcVersions(
  input: ResolveCalculationInput,
  project: StoredProject | undefined,
  issues: DataResolverIssue[],
): void {
  if (input.operation !== "recalculate") {
    if (
      input.expectedProjectCalcVersion !== undefined ||
      input.requiredExecutedCalcVersion !== undefined ||
      input.expectedSourcePriceVersion !== undefined
    ) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_MISSING_INPUT",
          "operation",
          "expected* запрещены для create/preview",
        ),
      );
    }
    return;
  }

  if (project?.calcVersion === undefined) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_CALC_VERSION_UNKNOWN",
        "project.calcVersion",
        "calcVersion отсутствует; обычный пересчёт заблокирован",
        project?.id,
      ),
    );
  } else if (
    input.expectedProjectCalcVersion === undefined ||
    input.requiredExecutedCalcVersion === undefined
  ) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_MISSING_INPUT",
        "operation",
        "для пересчёта обязательны expectedProjectCalcVersion и requiredExecutedCalcVersion",
        project.id,
      ),
    );
  } else {
    if (project.calcVersion !== input.expectedProjectCalcVersion) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_PROJECT_CALC_VERSION_MISMATCH",
          "expectedProjectCalcVersion",
          `project "${project.calcVersion}" ≠ ожидаемой "${input.expectedProjectCalcVersion}"`,
          project.id,
        ),
      );
    }
    if (input.requiredExecutedCalcVersion !== BUILD_CALC_VERSION) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_EXECUTED_CALC_VERSION_MISMATCH",
          "requiredExecutedCalcVersion",
          `исполняемая "${BUILD_CALC_VERSION}" ≠ требуемой "${input.requiredExecutedCalcVersion}"`,
          project.id,
        ),
      );
    }
    if (project.calcVersion !== BUILD_CALC_VERSION) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_CALC_VERSION_INCOMPATIBLE",
          "project.calcVersion",
          `обычный пересчёт ${project.calcVersion} сборкой ${BUILD_CALC_VERSION} недоступен`,
          project.id,
        ),
      );
    }
  }
}

function buildSnapshot(
  version: PricingVersion,
  config: FurnitureConfig,
  issues: DataResolverIssue[],
): PriceSnapshotInput | undefined {
  const signed = version.signedAdjustments;
  if (config.kind === "kitchen" && config.plinth) {
    if (signed === undefined) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_REFERENCE_INTEGRITY",
          "priceSnapshot.signedAdjustments",
          "signedAdjustments отсутствуют; legacy-нормализация из content запрещена",
          version.id,
        ),
      );
      return undefined;
    }
    const key = `plinth:${config.plinthMaterial}:${config.plinthFinish}`;
    if (!signed.some((entry) => entry.key === key)) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_MISSING_INPUT",
          "priceSnapshot.signedAdjustments",
          `нет обязательной корректировки "${key}"`,
          version.id,
        ),
      );
      return undefined;
    }
  }

  return {
    priceVersion: version.id,
    snapshot: version.snapshot,
    rules: version.rules as unknown as PriceSnapshotInput["rules"],
    signedAdjustments: (signed ?? []) as PriceSnapshotInput["signedAdjustments"],
    promos: version.promos,
    baseSchema: version.baseSchema,
  };
}

function toRulesSnapshotInput(snapshot: RulesSnapshot): RulesSnapshotInput {
  const rules: ManagedRuleInput[] = snapshot.rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    category: rule.category,
    scope: rule.scope,
    condition: rule.condition,
    assigns: rule.assigns,
    value: rule.value,
    valueType: rule.valueType,
    unit: rule.unit,
    status: rule.status,
    sourceRef: rule.sourceRef,
    source: rule.source,
    affects: rule.affects,
    version: rule.version,
  }));
  return { rulesSnapshotId: snapshot.id, rules };
}

function fromContractIssue(contract: {
  path: string;
  message: string;
}): DataResolverIssue {
  let code: DataResolverErrorCode = "ENGINE_CONTRACT_MISSING_INPUT";
  if (
    contract.message.includes("неизвестное") ||
    contract.message.includes("не входит") ||
    contract.path.includes(".attrs") ||
    contract.path.includes(".priceRefs")
  ) {
    code = "ENGINE_CONTRACT_UNKNOWN_ATTRIBUTE";
  } else if (
    contract.path.includes("schemaVersion") ||
    contract.path.includes("baseSchema")
  ) {
    code = "ENGINE_CONTRACT_INCOMPATIBLE_SCHEMA";
  }
  return issue(code, contract.path, contract.message);
}

/**
 * E1 — выделенный preflight Composition (design rev.4 §8.1, замечание A-01).
 *
 * Прежняя семантика блокирующих проверок сохранена без изменений:
 * unknown / не-published / ошибки `validateCompositionForConfig` / corrupt
 * по-прежнему блокируют расчёт ровно теми же кодами и сообщениями.
 * Дополнительно собираются **неблокирующие** drift-предупреждения (Q4, §A-06
 * вид 3): они возвращаются отдельно и в `issues` не попадают (В-5/§8.5).
 *
 * Изолировано от Engine: функция не импортирует `engine.ts` и не изменяет
 * `CalculationInputs`/`CalculationRequest`.
 */
async function resolveCompositionPreflight(
  requestedCompositionId: string | undefined,
  context: {
    config: FurnitureConfig;
    priceSnapshot: PriceSnapshotInput;
    rulesSnapshotId?: string;
  },
): Promise<{
  compositionVersionId?: string;
  compositionPreflight?: CompositionPreflight;
  issues: DataResolverIssue[];
}> {
  const issues: DataResolverIssue[] = [];
  if (!requestedCompositionId) return { issues };

  let compositionVersionId: string | undefined;
  let composition: CompositionVersion | undefined;
  let warnings: DataResolverIssue[] = [];

  try {
    const version = await getCompositionVersion(requestedCompositionId);
    if (!version) {
      issues.push(
        issue(
          "COMPOSITION_VERSION_UNKNOWN",
          "inputs.composition",
          `Версия состава "${requestedCompositionId}" не найдена; подстановка запрещена.`,
          requestedCompositionId,
        ),
      );
    } else if (version.status !== "published") {
      issues.push(
        issue(
          "COMPOSITION_VERSION_INVALID",
          "inputs.composition",
          `Версия состава "${version.id}" имеет статус ${version.status}; для расчёта требуется published.`,
          version.id,
        ),
      );
    } else {
      const compositionIssues = await validateCompositionForConfig(
        version,
        context.config,
        context.priceSnapshot,
        context.rulesSnapshotId,
        { requireProductionApproval: process.env.NODE_ENV === "production" },
      );
      for (const item of compositionIssues) {
        issues.push(
          issue(
            "COMPOSITION_VERSION_INVALID",
            `inputs.composition.${item.lineId ?? item.entityId ?? "line"}`,
            item.message,
            item.entityId ?? item.lineId,
          ),
        );
      }
      if (compositionIssues.length === 0) {
        compositionVersionId = version.id;
        composition = version;
        warnings = await collectCompositionDriftWarnings(
          version,
          context.rulesSnapshotId,
        );
      }
    }
  } catch (error) {
    issues.push(
      issue(
        "COMPOSITION_VERSION_CORRUPT",
        "inputs.composition",
        error instanceof Error ? error.message : String(error),
        requestedCompositionId,
      ),
    );
  }

  if (compositionVersionId === undefined || composition === undefined) {
    return { issues };
  }
  return {
    compositionVersionId,
    compositionPreflight: { compositionVersionId, composition, warnings },
    issues,
  };
}

/** Коды drift-предупреждений, адаптируемые в DataResolverIssue. */
const COMPOSITION_DRIFT_CODES = new Set<string>([
  "COMPOSITION_PRICE_VERSION_DRIFT",
  "COMPOSITION_PRICE_SNAPSHOT_DRIFT",
  "COMPOSITION_CATALOG_VERSION_DRIFT",
]);

/**
 * Неблокирующие drift-предупреждения (Q4, §A-06 вид 3, В-5).
 *
 * Берутся **только** `warnings` из существующей admin-валидации
 * `validateCompositionVersion`; её блокирующие результаты в расчётном пути не
 * используются — блокирующая семантика preflight от этого не меняется.
 * Сбой сбора не блокирует расчёт: предупреждения необязательны.
 */
async function collectCompositionDriftWarnings(
  version: CompositionVersion,
  rulesSnapshotId?: string,
): Promise<DataResolverIssue[]> {
  try {
    const validation = await validateCompositionVersion(version, {
      rulesSnapshotId,
    });
    return validation.warnings
      .filter((item) => COMPOSITION_DRIFT_CODES.has(item.code))
      .map((item) => ({
        code: item.code as DataResolverErrorCode,
        path: `inputs.composition.${item.lineId ?? item.entityId ?? "line"}`,
        message: item.message,
        ...(item.entityId === undefined ? {} : { entityId: item.entityId }),
      }));
  } catch {
    return [];
  }
}

/**
 * Единственная точка сборки `CalculationInputs`.
 * Fail-closed: при любой неразрешённой ссылке/версии возвращает issues и
 * не формирует частичный Request.
 */
export async function resolveCalculationInputs(
  input: ResolveCalculationInput,
): Promise<DataResolverResult> {
  const issues: DataResolverIssue[] = [];
  const operation = operationOf(input.operation);
  if (operation === null) {
    return {
      ok: false,
      issues: [
        issue(
          "ENGINE_CONTRACT_MISSING_INPUT",
          "operation",
          "operation обязан быть create | preview | recalculate",
        ),
      ],
    };
  }

  let config: FurnitureConfig | undefined;
  let project: StoredProject | undefined;
  if (operation === "recalculate") {
    project = input.project;
    if (!project) {
      return {
        ok: false,
        issues: [
          issue(
            "ENGINE_CONTRACT_MISSING_INPUT",
            "project",
            "для пересчёта обязателен сохранённый project",
          ),
        ],
      };
    }
    config = project.config;
  } else {
    config = input.config;
    if (!config) {
      return {
        ok: false,
        issues: [
          issue(
            "ENGINE_CONTRACT_MISSING_INPUT",
            "config",
            "для create/preview обязателен config",
          ),
        ],
      };
    }
  }

  // A18-1 / CA-516-03: DataResolver — единая точка сборки входов. Исторический
  // материал фасада запрещён для **любого** расчёта: create/preview (новые
  // конфигурации) и recalculate (старые проекты). Отказ происходит до сборки
  // входов и до расчёта, поэтому исторический PriceItem не читается, а материал
  // не подменяется автоматически. Правило одно для всех вызывающих слоёв.
  if (config && isLegacyFacadeMaterial(config.facadeMaterial)) {
    return {
      ok: false,
      issues: [
        issue(
          "ENGINE_CONTRACT_LEGACY_FACADE_MATERIAL",
          "config.facadeMaterial",
          LEGACY_FACADE_BLOCK_MESSAGE,
          project?.id,
        ),
      ],
    };
  }

  checkCalcVersions(input, project, issues);

  const schema = normalizeSchemaVersion({
    schemaVersion: input.schemaVersion,
    project,
    config,
  });
  if (schema.issue) issues.push(schema.issue);

  // CA-T-306B: parameters — только immutable manifest для calcVersion
  // операции. Live AdminParameter и content/* не участвуют.
  const parameterCalcVersion =
    operation === "recalculate" ? project?.calcVersion : BUILD_CALC_VERSION;
  let parameters: Readonly<Record<string, unknown>> = {};
  if (parameterCalcVersion === undefined) {
    issues.push(
      issue(
        "ENGINE_CONTRACT_MISSING_INPUT",
        "inputs.parameters",
        "calcVersion для разрешения parameter manifest отсутствует",
        project?.id,
      ),
    );
  } else {
    const manifest = getParameterManifest(parameterCalcVersion);
    if (!manifest.ok) {
      issues.push(
        issue(
          manifest.issue.code === "PARAMETER_MANIFEST_UNAVAILABLE"
            ? "ENGINE_CONTRACT_MISSING_INPUT"
            : "ENGINE_CONTRACT_REFERENCE_INTEGRITY",
          "inputs.parameters",
          `${manifest.issue.code}: ${manifest.issue.message}`,
          parameterCalcVersion,
        ),
      );
    } else {
      parameters = manifest.manifest.parameters;
    }
  }

  const version = await resolvePriceVersion(input, project, issues);
  const snapshot = version ? buildSnapshot(version, config, issues) : undefined;

  // ADR-07 §10.4 / Q7-07, Q7-11: снимок правил разрешается независимо от цен.
  //  - create/preview: только активный опубликованный снимок;
  //  - recalculate: только закреплённый `StoredProject.rulesSnapshotId`;
  //  - legacy без привязки → RULES_SNAPSHOT_MISSING (расчёт блокируется,
  //    чтение сохранённых данных остаётся доступным);
  //  - отсутствие/неизвестность/повреждение → fail-closed без подстановки.
  let rulesSnapshot: RulesSnapshotInput | undefined;
  if (operation === "recalculate" && project?.rulesSnapshotId === undefined) {
    issues.push(
      issue(
        "RULES_SNAPSHOT_MISSING",
        "inputs.rulesSnapshot",
        "у проекта нет rulesSnapshotId (legacy): новый расчёт запрещён (ADR-07 Q7-11); чтение сохранённых данных разрешено",
        project?.id,
      ),
    );
  } else {
    const rulesResolution =
      operation === "recalculate"
        ? await resolveRulesSnapshotById(project!.rulesSnapshotId!)
        : await resolveActiveRulesSnapshot();

    if (rulesResolution.status === "none") {
      issues.push(
        issue(
          "RULES_SNAPSHOT_MISSING",
          "inputs.rulesSnapshot",
          "нет активного опубликованного снимка правил: новый расчёт запрещён (ADR-07 §10.4); подстановка пустого набора запрещена",
          project?.id,
        ),
      );
    } else if (rulesResolution.status === "error") {
      const code: DataResolverErrorCode =
        rulesResolution.code === "unknown"
          ? "RULES_SNAPSHOT_UNKNOWN"
          : "RULES_SNAPSHOT_CORRUPT";
      issues.push(
        issue(
          code,
          "inputs.rulesSnapshot",
          `${rulesResolution.issues.join("; ")} (подстановка актуального снимка запрещена)`,
          project?.id ?? project?.rulesSnapshotId,
        ),
      );
    } else {
      rulesSnapshot = toRulesSnapshotInput(rulesResolution.snapshot);
    }
  }

  const catalogRaw = await readCollectionItems(
    CATALOGS,
    "catalogs",
    issues,
  );
  const presetRaw = await readCollectionItems(PRESETS, "presets", issues);

  const catalogItems: CatalogItem[] = [];
  for (const raw of catalogRaw) {
    const parsed = parseCatalog(raw, "catalogs", issues);
    if (parsed) catalogItems.push(parsed);
  }
  const presetItems: ModulePreset[] = [];
  for (const raw of presetRaw) {
    const parsed = parsePreset(raw, "presets", issues);
    if (parsed) presetItems.push(parsed);
  }

  const resolvedCatalogs: CatalogItem[] = [];
  for (const ref of baseCatalogRefs(config)) {
    const selected = selectCatalog(
      catalogItems,
      ref,
      {
        operation,
        versionPin:
          operation === "recalculate"
            ? pinFor(project?.pins, ref)
            : undefined,
      },
      `inputs.catalogs.${ref.catalog}.${ref.id}`,
      issues,
    );
    if (selected) resolvedCatalogs.push(selected);
  }

  if (config.kind === "kitchen" && config.underCabinetLighting) {
    const strip = selectLedStrip(
      catalogItems,
      config,
      operation,
      project?.pins,
      issues,
    );
    if (strip) resolvedCatalogs.push(strip);

    const psuPins = project?.pins?.catalogVersions?.ledPsu;
    const psuItems =
      operation === "recalculate"
        ? psuPins === undefined
          ? []
          : catalogItems.filter(
              (item) =>
                item.catalog === "ledPsu" && Object.hasOwn(psuPins, item.id),
            )
        : catalogItems.filter(
            (item) => item.catalog === "ledPsu" && item.status === "active",
          );
    if (operation === "recalculate" && psuPins === undefined) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_PINS_UNRESOLVED",
          "inputs.catalogs.ledPsu",
          "pins ledPsu отсутствуют; текущие версии не подставляются",
          "ledPsu",
        ),
      );
    } else if (psuItems.length === 0) {
      issues.push(
        issue(
          "ENGINE_CONTRACT_MISSING_INPUT",
          "inputs.catalogs.ledPsu",
          "нет доступных ledPsu для включённой подсветки",
          "ledPsu",
        ),
      );
    } else {
      for (const psu of psuItems) {
        const selected = selectCatalog(
          catalogItems,
          { catalog: "ledPsu", id: psu.id },
          {
            operation,
            versionPin:
              operation === "recalculate" ? psuPins?.[psu.id] : undefined,
          },
          `inputs.catalogs.ledPsu.${psu.id}`,
          issues,
        );
        if (selected) resolvedCatalogs.push(selected);
      }
    }
  }

  const resolvedPresets: ModulePreset[] = [];
  for (const ref of presetRefs(config)) {
    const selected = selectPreset(
      presetItems,
      ref,
      {
        operation,
        versionPin:
          operation === "recalculate"
            ? presetPinFor(project?.pins, ref)
            : undefined,
      },
      `inputs.presets.${ref.family}.${ref.id}`,
      issues,
    );
    if (selected) resolvedPresets.push(selected);
  }

  if (issues.length > 0 || !snapshot || schema.value === undefined) {
    return { ok: false, issues };
  }

  const inputs: CalculationInputs = {
    priceSnapshot: snapshot,
    catalogs: resolvedCatalogs.map(toCatalogInput),
    parameters,
    presets: resolvedPresets.map(toPresetInput),
    ...(rulesSnapshot === undefined ? {} : { rulesSnapshot }),
  };
  const request: CalculationRequest = {
    config,
    schemaVersion: schema.value,
    inputs,
  };

  const requestedCompositionId =
    input.compositionVersionId ??
    (operation === "recalculate" ? project?.compositionVersionId : undefined);
  const preflight = await resolveCompositionPreflight(requestedCompositionId, {
    config,
    priceSnapshot: inputs.priceSnapshot,
    rulesSnapshotId: inputs.rulesSnapshot?.rulesSnapshotId,
  });
  issues.push(...preflight.issues);
  const compositionPreflight = preflight.compositionPreflight;
  const compositionVersionId = preflight.compositionVersionId;
  if (issues.length > 0) return { ok: false, issues };

  const validated = validateCalculationRequest(request);
  if (!validated.ok) {
    return {
      ok: false,
      issues: validated.issues.map(fromContractIssue),
    };
  }

  const pins =
    operation === "recalculate"
      ? (project?.pins ?? {})
      : buildPins(resolvedCatalogs, resolvedPresets);

  return {
    ok: true,
    value: {
      request: validated.value,
      pins,
      catalogVersions: pins.catalogVersions ?? {},
      presetVersions: pins.presetVersions ?? {},
      ...(compositionVersionId === undefined ? {} : { compositionVersionId }),
      ...(compositionPreflight === undefined ? {} : { compositionPreflight }),
    },
  };
}
