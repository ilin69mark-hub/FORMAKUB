import { FIXED_BODY_MATERIAL_ID } from "@/lib/configurator/materials";
import type { FurnitureConfig, ProjectPins } from "@/lib/configurator/types";
import { readCollectionStatus } from "@/lib/server/store";

import type { CatalogItem, ModulePreset } from "./schema";

/**
 * CA-T-108 — `pins` проекта: фиксация версий Reference Data (дизайн §6.2,
 * §6.3, §7.7).
 *
 * `pins` разрешает ссылки проекта строго по зафиксированным `version`
 * элементов `CatalogItem`/`ModulePreset`, а не по «живым» значениям. Правка
 * `attrs`/границ пресета не действует на старые проекты (A5).
 *
 * Версии не изобретаются: фиксируется только существующий элемент хранилища
 * с непустым `version`. Отсутствующий/повреждённый справочник не блокирует
 * сохранение проекта — такой проект остаётся без соответствующего пина и при
 * чтении помечается `pinsInferred` (легаси-семантика).
 */

const CATALOGS = "catalog-items.json";
const PRESETS = "module-presets.json";

interface CatalogReference {
  catalog: CatalogItem["catalog"];
  id: string;
}

interface PresetReference {
  family: ModulePreset["family"];
  id: string;
}

type CatalogVersions = NonNullable<ProjectPins["catalogVersions"]>;
type PresetVersions = NonNullable<ProjectPins["presetVersions"]>;

/** Ссылки конфига на справочники (`<catalog>: <id>`). Дубли отбрасываются. */
export function configCatalogReferences(config: FurnitureConfig): CatalogReference[] {
  const refs: CatalogReference[] = [
    { catalog: "bodyMaterial", id: FIXED_BODY_MATERIAL_ID },
    { catalog: "facadeMaterial", id: config.facadeMaterial },
    { catalog: "facadeStyle", id: config.facadeStyle },
    { catalog: "handle", id: config.handle },
  ];

  if (config.kind === "kitchen") {
    refs.push(
      { catalog: "countertop", id: config.countertop },
      { catalog: "plinthMaterial", id: config.plinthMaterial },
      { catalog: "plinthMount", id: config.plinthMount },
      { catalog: "supportSystem", id: config.supports.systemId },
      { catalog: "ledProfile", id: config.lighting.profile },
      { catalog: "ledDiffuser", id: config.lighting.diffuser },
      { catalog: "ledControl", id: config.lighting.control },
    );
  }

  const promo = config.promoCode?.trim();
  if (promo) refs.push({ catalog: "promo", id: promo });

  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.catalog}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Ссылки конфига на пресеты модулей (`<family>: <id>`). Дубли отбрасываются. */
export function configPresetReferences(config: FurnitureConfig): PresetReference[] {
  if (config.kind !== "kitchen") return [];
  const seen = new Set<string>();
  const refs: PresetReference[] = [];
  for (const presetModule of config.modules) {
    const key = `kitchen:${presetModule.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ family: "kitchen", id: presetModule.type });
  }
  return refs;
}

/**
 * Чистая сборка `pins`: только реально существующие элементы с непустой
 * версией. Пустые группы не включаются; полностью пустой результат — `{}`.
 */
export function buildProjectPins(
  config: FurnitureConfig,
  catalogs: readonly CatalogItem[],
  presets: readonly ModulePreset[],
): ProjectPins {
  const catalogVersions: CatalogVersions = {};
  for (const ref of configCatalogReferences(config)) {
    const item = catalogs.find(
      (candidate) => candidate.catalog === ref.catalog && candidate.id === ref.id,
    );
    const version = item?.version.trim();
    if (!version) continue;
    (catalogVersions[ref.catalog] ??= {})[ref.id] = version;
  }

  const presetVersions: PresetVersions = {};
  for (const ref of configPresetReferences(config)) {
    const preset = presets.find(
      (candidate) => candidate.family === ref.family && candidate.id === ref.id,
    );
    const version = preset?.version.trim();
    if (!version) continue;
    (presetVersions[ref.family] ??= {})[ref.id] = version;
  }

  const pins: ProjectPins = {};
  if (Object.keys(catalogVersions).length > 0) {
    pins.catalogVersions = catalogVersions;
  }
  if (Object.keys(presetVersions).length > 0) {
    pins.presetVersions = presetVersions;
  }
  return pins;
}

/**
 * `pins` для сохраняемого проекта по текущему состоянию справочников.
 * Повреждённая коллекция не роняет сохранение: её данные не используются,
 * версии не подменяются (проект останется `inferred`).
 */
export async function readProjectPins(config: FurnitureConfig): Promise<ProjectPins> {
  const catalogs = await readCollectionStatus<CatalogItem>(CATALOGS);
  const presets = await readCollectionStatus<ModulePreset>(PRESETS);
  return buildProjectPins(
    config,
    catalogs.status === "ok" ? catalogs.items : [],
    presets.status === "ok" ? presets.items : [],
  );
}

/** Есть ли хотя бы одна зафиксированная версия. */
export function hasPins(pins: ProjectPins | undefined): boolean {
  if (!pins) return false;
  return (
    Object.keys(pins.catalogVersions ?? {}).length > 0 ||
    Object.keys(pins.presetVersions ?? {}).length > 0
  );
}
