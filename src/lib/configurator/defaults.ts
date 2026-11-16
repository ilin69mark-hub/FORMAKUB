import type {
  ConfigPreset,
  FurnitureConfig,
  KitchenConfig,
  KitchenLightingConfig,
  KitchenModule,
  KitchenModuleType,
  KitchenSupportSettings,
  PlinthMaterialId,
  PlinthMountId,
  WardrobeConfig,
} from "./types";
import {
  DEFAULT_FACADE_THICKNESS_MM,
  KITCHEN_LIMITS,
  KITCHEN_MODULES,
  WARDROBE_LIMITS,
  defaultFacadeThickness,
  snapCountertopThickness,
  snapFacadeThickness,
} from "@/content/catalog";
import { kitchenMaxBodyDepthCm, KITCHEN_MIN_BODY_DEPTH_CM } from "./geometry";
import { FIXED_BODY_MATERIAL_ID } from "./materials";
import {
  LED_COLOR_TEMPS,
  LED_DIFFUSERS,
  LED_CONTROLS,
  LED_POWERS,
  LED_PROFILES,
  LED_VOLTAGES,
} from "@/content/lighting";
import {
  PLINTH_DEFAULT_MATERIAL,
  findPlinthMaterial,
  snapPlinthFinish,
  snapPlinthThickness,
} from "@/content/plinth";
import { findSupportSystem, SUPPORT_SYSTEM_DEFAULT_ID } from "@/content/supports";
import { SINK_DEFAULTS, normalizeSinkModule, sinkRowContext } from "./sink";

export function createId(prefix = "m"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeKitchenModule(
  type: KitchenModuleType,
  overrides: Partial<KitchenModule> = {},
): KitchenModule {
  const preset = KITCHEN_MODULES[type];
  return {
    id: createId("m"),
    type,
    width: preset.defaultWidth,
    height: preset.defaultHeight,
    depth: preset.defaultDepth,
    shelves: preset.defaultShelves,
    drawers: preset.defaultDrawers,
    // Модуль под мойку: габариты чаши по умолчанию (мм), положение по центру.
    ...(type === "sink"
      ? {
          sinkWidth: SINK_DEFAULTS.width,
          sinkDepth: SINK_DEFAULTS.depth,
          sinkPosition: "center" as const,
        }
      : {}),
    ...overrides,
  };
}

/** Значения по умолчанию для настроек подсветки верхнего ряда. */
export function defaultKitchenLighting(): KitchenLightingConfig {
  return {
    voltage: 24,
    powerPerMeter: 9.6,
    colorTemp: 3000,
    profile: "surface",
    diffuser: "frosted",
    control: "switch",
  };
}

/**
 * Настройки системы опор по умолчанию — из каталога систем опор.
 * Значения можно заменить паспортными характеристиками выбранной фурнитуры.
 */
export function defaultKitchenSupports(): KitchenSupportSettings {
  const system = findSupportSystem(SUPPORT_SYSTEM_DEFAULT_ID);
  return {
    systemId: system.id,
    maxSpanCm: system.maxSpanCm,
    maxLoadKgPerLeg: system.maxLoadKgPerLeg,
  };
}

function pickFrom<T>(
  allowed: readonly T[],
  candidate: unknown,
  fallback: T,
): T {
  return allowed.includes(candidate as T) ? (candidate as T) : fallback;
}

/**
 * Нормализация настроек подсветки. Идемпотентна: корректный конфиг
 * возвращается без изменений, чужие/отсутствующие значения заменяются
 * допустимыми значениями по умолчанию.
 */
export function normalizeLighting(
  value: Partial<KitchenLightingConfig> | undefined | null,
): KitchenLightingConfig {
  const base = defaultKitchenLighting();
  if (!value || typeof value !== "object") return base;
  return {
    voltage: pickFrom(LED_VOLTAGES, value.voltage, base.voltage),
    powerPerMeter: pickFrom(LED_POWERS, value.powerPerMeter, base.powerPerMeter),
    colorTemp: pickFrom(LED_COLOR_TEMPS, value.colorTemp, base.colorTemp),
    profile: pickFrom(
      LED_PROFILES.map((item) => item.id),
      value.profile,
      base.profile,
    ),
    diffuser: pickFrom(
      LED_DIFFUSERS.map((item) => item.id),
      value.diffuser,
      base.diffuser,
    ),
    control: pickFrom(
      LED_CONTROLS.map((item) => item.id),
      value.control,
      base.control,
    ),
  };
}

/**
 * Нормализация настроек опор: приведение к доступным системам и разумным
 * диапазонам. Идемпотентна.
 */
export function normalizeSupportSettings(
  value: Partial<KitchenSupportSettings> | undefined | null,
): KitchenSupportSettings {
  const base = defaultKitchenSupports();
  if (!value || typeof value !== "object") return base;
  const systemId = pickFrom(
    ["standard", "heavy"] as const,
    value.systemId,
    base.systemId,
  );
  const system = findSupportSystem(systemId);
  const span = Number.isFinite(value.maxSpanCm)
    ? Math.min(200, Math.max(20, Math.round(value.maxSpanCm as number)))
    : system.maxSpanCm;
  const load = Number.isFinite(value.maxLoadKgPerLeg)
    ? Math.min(300, Math.max(10, Math.round(value.maxLoadKgPerLeg as number)))
    : system.maxLoadKgPerLeg;
  return { systemId, maxSpanCm: span, maxLoadKgPerLeg: load };
}

/**
 * Нормализация параметров цоколя: материал → толщина и исполнение из его
 * каталога. Идемпотентна.
 */
export function normalizePlinthOptions(config: {
  plinthMaterial?: string;
  plinthThickness?: number;
  plinthFinish?: string;
  plinthMount?: string;
}): {
  plinthMaterial: PlinthMaterialId;
  plinthThickness: number;
  plinthFinish: string;
  plinthMount: PlinthMountId;
} {
  const material =
    findPlinthMaterial(config.plinthMaterial ?? "")?.id ?? PLINTH_DEFAULT_MATERIAL;
  return {
    plinthMaterial: material,
    plinthThickness: snapPlinthThickness(material, config.plinthThickness ?? Number.NaN),
    plinthFinish: snapPlinthFinish(material, config.plinthFinish ?? ""),
    plinthMount: config.plinthMount === "hidden" ? "hidden" : "clips",
  };
}

export function defaultKitchen(): KitchenConfig {
  const plinth = normalizePlinthOptions({});
  return {
    version: 1,
    kind: "kitchen",
    modules: [
      makeKitchenModule("sink", { id: "m-sink", width: 60, shelves: 0 }),
      makeKitchenModule("hob", { id: "m-hob", width: 60, shelves: 1 }),
      makeKitchenModule("drawers", { id: "m-drawers", width: 60, drawers: 3 }),
      makeKitchenModule("tall", { id: "m-tall", width: 60, height: 220, shelves: 4 }),
      makeKitchenModule("wall", { id: "m-wall-1", width: 60, shelves: 1 }),
      makeKitchenModule("wall", { id: "m-wall-2", width: 60, shelves: 1 }),
    ],
    bodyMaterial: "ldsp",
    bodyFinish: "milk",
    facadeMaterial: "mdf",
    facadeFinish: "graphite",
    facadeStyle: "flat",
    facadeThickness: defaultFacadeThickness("mdf"),
    countertop: "ldsp_hpl",
    countertopThickness: 38,
    handle: "profile",
    hinge: "soft",
    pushToOpen: false,
    plinth: true,
    plinthHeight: KITCHEN_LIMITS.defaultPlinthHeight,
    ...plinth,
    underCabinetLighting: true,
    lighting: defaultKitchenLighting(),
    supports: defaultKitchenSupports(),
    sidePanels: 0,
    promoCode: "",
  };
}

function defaultSection(index: number): WardrobeConfig["sections"][number] {
  const shelves =
    index === 1 ? [80, 120] : [80, 120, 160];
  return {
    id: `s-${index}`,
    shelves,
    rods: index === 1 ? [210] : [],
    drawers: index === 2 ? 3 : 0,
  };
}

export function defaultWardrobe(): WardrobeConfig {
  return {
    version: 1,
    kind: "wardrobe",
    height: 240,
    widthMm: 2400,
    fullDepth: 600,
    sections: [defaultSection(1), defaultSection(2)],
    bodyMaterial: "ldsp",
    bodyFinish: "oak",
    bodyThicknessMm: 16,
    backPanelThicknessMm: 3,
    plinthHeightMm: 80,
    plinthInsetMm: 50,
    partition: { positionMm: 1200 },
    antresol: null,
    facadeMaterial: "ldsp",
    facadeThickness: 16,
    facadeMount: "overlay",
    facadeFinish: "milk",
    facadeStyle: "handleless",
    handle: "profile",
    hinge: "soft",
    pushToOpen: false,
    plinth: true,
    ledLighting: true,
    hardware: {},
    promoCode: "",
  };
}

export function defaultDressingRoom(): WardrobeConfig {
  const base = defaultWardrobe();
  return {
    ...base,
    height: 250,
    widthMm: 2400,
    partition: { positionMm: 1200 },
    sections: [
      {
        id: "s-1",
        shelves: [70, 110, 150, 190],
        rods: [225],
        drawers: 0,
      },
      {
        id: "s-2",
        shelves: [110, 150],
        rods: [225],
        drawers: 4,
      },
    ],
    facadeMaterial: "mdf_pvc",
    facadeThickness: 19,
    facadeFinish: "milk",
    facadeStyle: "flat",
    ledLighting: true,
  };
}

export function defaultConfig(preset: ConfigPreset): FurnitureConfig {
  if (preset === "wardrobe") return defaultWardrobe();
  if (preset === "dressing") return defaultDressingRoom();
  return defaultKitchen();
}

export function cloneConfig<T extends FurnitureConfig>(config: T): T {
  return JSON.parse(JSON.stringify(config)) as T;
}

export function normalizeKitchenDepth(
  config: KitchenConfig,
  facadeThickness = config.facadeThickness,
): KitchenConfig {
  const thickness = Number.isFinite(facadeThickness)
    ? facadeThickness
    : DEFAULT_FACADE_THICKNESS_MM;
  const targetFor = (zone: "floor" | "upper"): number | null => {
    const modules = config.modules.filter(
      (module) => KITCHEN_MODULES[module.type].zone === zone,
    );
    if (modules.length === 0) return null;
    const min =
      zone === "floor"
        ? Math.max(
            KITCHEN_MIN_BODY_DEPTH_CM,
            ...modules.map((module) => KITCHEN_MODULES[module.type].minDepth),
          )
        : Math.max(
            ...modules.map((module) => KITCHEN_MODULES[module.type].minDepth),
          );
    const staticMax = Math.min(
      ...modules.map((module) => KITCHEN_MODULES[module.type].maxDepth),
    );
    const hasStandardLower =
      zone === "floor" &&
      modules.some(
        (module) => module.type !== "tall" && module.type !== "oven",
      );
    const dynamicMax = hasStandardLower
      ? kitchenMaxBodyDepthCm(thickness)
      : staticMax;
    const max = Math.min(staticMax, dynamicMax);
    return Math.min(max, Math.max(min, modules[0].depth));
  };

  const depths = {
    floor: targetFor("floor"),
    upper: targetFor("upper"),
  };

  return {
    ...config,
    modules: config.modules.map((module) => {
      const depth = depths[KITCHEN_MODULES[module.type].zone];
      return depth === null ? module : { ...module, depth };
    }),
  };
}

/**
 * Нормализация кухни при загрузке черновика/проекта: общая глубина ряда
 * и геометрия модуля под мойку (зажим габаритов, снятие конфликтной
 * перегородки, обрезка наполнения секций).
 */
export function normalizeKitchen(config: KitchenConfig): KitchenConfig {
  const facadeThickness = snapFacadeThickness(
    config.facadeMaterial,
    config.facadeThickness,
  );
  const depthFixed = normalizeKitchenDepth(config, facadeThickness);
  const plinthHeight = Number.isFinite(config.plinthHeight)
    ? Math.min(
        KITCHEN_LIMITS.maxPlinthHeight,
        Math.max(KITCHEN_LIMITS.minPlinthHeight, Math.round(config.plinthHeight)),
      )
    : KITCHEN_LIMITS.defaultPlinthHeight;
  // Миграция старых конфигураций: новые поля цоколя, подсветки и опор
  // заполняются безопасными значениями по умолчанию. Идемпотентна: повторная
  // нормализация уже нормализованного конфига ничего не меняет, поэтому
  // данные не переписываются при загрузке — они сохраняются при обычном
  // сохранении проекта.
  const plinth = normalizePlinthOptions(config);
  const lighting = normalizeLighting(config.lighting);
  const supports = normalizeSupportSettings(config.supports);
  // R6 (DOMAIN_CONFIRMED): подсветка верхнего ряда существует только вместе
  // с верхними модулями. Удаление последнего верхнего модуля гасит опцию
  // (все LED-позиции обнуляются при расчёте), повторное добавление модулей
  // доступность возвращает, но подсветку само не включает.
  const hasUpperModules = depthFixed.modules.some(
    (module) => KITCHEN_MODULES[module.type]?.zone === "upper",
  );
  const underCabinetLighting =
    hasUpperModules && config.underCabinetLighting === true;
  return {
    ...depthFixed,
    bodyMaterial: FIXED_BODY_MATERIAL_ID,
    facadeThickness,
    plinthHeight,
    underCabinetLighting,
    ...plinth,
    lighting,
    supports,
    countertopThickness: snapCountertopThickness(
      config.countertop,
      config.countertopThickness,
    ),
    modules: depthFixed.modules.map((module) =>
      normalizeSinkModule(module, sinkRowContext(depthFixed.modules, module.id)),
    ),
  };
}

/**
 * Привести фасад и глубину только стандартных нижних модулей к допустимым
 * значениям (CA-T-513). `tall`/`oven` не меняются: их геометрия вне правила
 * глубины нижнего корпуса.
 */
export function normalizeKitchenFacadeDepth(
  config: KitchenConfig,
): KitchenConfig {
  const facadeThickness = snapFacadeThickness(
    config.facadeMaterial,
    config.facadeThickness,
  );
  const maxBodyDepth = kitchenMaxBodyDepthCm(facadeThickness);
  return {
    ...config,
    facadeThickness,
    modules: config.modules.map((module) => {
      const isStandardLower =
        KITCHEN_MODULES[module.type].zone === "floor" &&
        module.type !== "tall" &&
        module.type !== "oven";
      if (!isStandardLower) return module;
      const depth = Math.min(
        maxBodyDepth,
        Math.max(KITCHEN_MIN_BODY_DEPTH_CM, module.depth),
      );
      return depth === module.depth ? module : { ...module, depth };
    }),
  };
}

/** Применить толщину фасада и скорректировать глубину нижних модулей. */
export function withKitchenFacadeThickness(
  config: KitchenConfig,
  thickness: number,
): KitchenConfig {
  return normalizeKitchenFacadeDepth({
    ...config,
    facadeThickness: snapFacadeThickness(config.facadeMaterial, thickness),
  });
}

export function nextShelfPosition(
  section: WardrobeConfig["sections"][number],
  height: number,
): number {
  const drawerZone =
    WARDROBE_LIMITS.plinthHeight +
    WARDROBE_LIMITS.carcassThickness +
    section.drawers * WARDROBE_LIMITS.drawerHeight;
  const sorted = [...section.shelves].sort((a, b) => a - b);
  const points = [drawerZone + 8, ...sorted, height - 10];
  let bestGap = -1;
  let bestValue = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const gap = points[i + 1] - points[i];
    if (gap > bestGap) {
      bestGap = gap;
      bestValue = points[i] + gap / 2;
    }
  }
  return Math.round(Math.min(height - 10, Math.max(drawerZone + 8, bestValue)));
}
