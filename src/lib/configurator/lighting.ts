import { KITCHEN_LIMITS, KITCHEN_MODULES } from "@/content/catalog";
import {
  defaultKitchenLighting,
} from "./defaults";
import {
  LED_CONNECTOR_PRICE,
  LED_CONTROLS,
  LED_DIFFUSERS,
  LED_END_CAP_PRICE,
  LED_END_MARGIN_CM,
  LED_INSTALL_PRICE_PER_METER,
  LED_PROFILES,
  LED_PSU_MARGIN,
  LED_PSU_MARGIN_LOW,
  LED_PSU_PRICE,
  LED_PSU_RATINGS,
  findLedStrip,
  ledColorHex,
} from "@/content/lighting";
import type { KitchenConfig, KitchenModule } from "./types";

/**
 * Расчёт подсветки верхнего ряда.
 *
 * Длина ленты определяется по фактической длине верхнего ряда с исключением
 * недоступных участков:
 *  - торцевые отступы внутри каждого шкафа (`LED_END_MARGIN_CM`);
 *  - участки, закрытые пеналами, высота которых доходит до зоны верхнего ряда.
 *
 * Мощность: `P = L × W/m`. Блок питания подбирается с запасом 20–25 %:
 * `PSU = P × 1.2–1.25` (берётся верхняя граница, выбирается ближайший
 * типоразмер из каталога). Ток: `I = P / U`.
 *
 * Максимальная длина непрерывного подключения, падение напряжения и
 * допустимая мощность блока питания берутся из выбранной модели ленты
 * (`findLedStrip`) и до подтверждения паспортными данными помечены как
 * предварительные (`source: "preliminary"`).
 */

export interface LightingComponent {
  id: string;
  label: string;
  detail: string;
  qty: number;
  unit: string;
  amount: number;
}

export interface LightingPlan {
  /** Подсветка включена в конфигурации. */
  enabled: boolean;
  /** Фактическая длина ленты, м. */
  lengthM: number;
  /** Исключённые как недоступные участки, м. */
  excludedM: number;
  /** Количество шкафов с подсветкой. */
  segments: number;
  profileM: number;
  diffuserM: number;
  /** Заглушки профиля, шт. */
  endCaps: number;
  /** Соединители, шт. */
  connectors: number;
  /** Участки непрерывного подключения (ограничение по падению напряжения). */
  runs: number;
  /** Точки питания. */
  feedPoints: number;
  /** Общая мощность ленты, Вт. */
  powerW: number;
  /** Требуемая мощность блока питания с запасом, Вт. */
  psuRequiredW: number;
  /** Выбранный типоразмер блока питания, Вт. */
  psuW: number;
  /** Количество блоков питания. */
  psuCount: number;
  /** Рабочий ток, А. */
  currentA: number;
  voltage: 12 | 24;
  powerPerMeter: number;
  colorTemp: number;
  /** Цвет свечения для выбранной температуры (HEX). */
  hex: string;
  profile: string;
  diffuser: string;
  control: string;
  stripId: string;
  stripSource: "preliminary" | "datasheet";
  components: LightingComponent[];
  cost: number;
  preliminary: boolean;
  notes: string[];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Раскладка рядов: позиция модуля от начала ряда, см. */
function rowLayout(
  config: KitchenConfig,
  zone: "floor" | "upper",
): { module: KitchenModule; x0: number; x1: number }[] {
  let cursor = 0;
  const items: { module: KitchenModule; x0: number; x1: number }[] = [];
  for (const item of config.modules) {
    if (KITCHEN_MODULES[item.type]?.zone !== zone) continue;
    const width = item.width;
    items.push({ module: item, x0: cursor, x1: cursor + width });
    cursor += width;
  }
  return items;
}

interface UsableSegment {
  module: KitchenModule;
  /** Доступный к монтажу участок, см (после торцевых отступов). */
  start: number;
  end: number;
  /** Длина, занятая пеналами, см. */
  blocked: number;
}

function availableLength(config: KitchenConfig): {
  segments: UsableSegment[];
  excludedM: number;
} {
  const floor = rowLayout(config, "floor");
  const upper = rowLayout(config, "upper");

  const counterCm = Math.max(0.4, config.countertopThickness / 10);
  // Низ верхнего ряда над полом: высота нижнего ряда + столешница + технологический зазор.
  const baseHeight =
    floor
      .filter(({ module }) => !["tall", "oven"].includes(module.type))
      .reduce((max, { module }) => Math.max(max, module.height), 0) || 90;
  const upperBottomCm =
    baseHeight + counterCm + KITCHEN_LIMITS.wallGapAboveCountertop;

  // Пеналы, доходящие до зоны верхнего ряда, перекрывают подсветку.
  const blockers = floor
    .filter(
      ({ module }) =>
        ["tall", "oven"].includes(module.type) && module.height >= upperBottomCm,
    )
    .map(({ x0, x1 }) => ({ x0, x1 }));

  const segments: UsableSegment[] = [];
  let excludedCm = 0;

  for (const { module, x0, x1 } of upper) {
    const start = x0 + LED_END_MARGIN_CM;
    const end = x1 - LED_END_MARGIN_CM;
    if (end - start <= 0.5) {
      // Шкаф уже узче монтажного отступа — подсветка не ставится.
      continue;
    }
    let blocked = 0;
    for (const blocker of blockers) {
      const overlap =
        Math.min(end, blocker.x1) - Math.max(start, blocker.x0);
      if (overlap > 0) blocked += overlap;
    }
    blocked = Math.min(blocked, end - start);
    if (blocked > 0) excludedCm += blocked;
    segments.push({ module, start, end, blocked });
  }

  return {
    segments,
    excludedM: round(excludedCm / 100, 3),
  };
}

/** Разбивает сегменты на участки не длиннее допустимого подключения. */
function countRuns(lengths: number[], maxRunM: number): number {
  if (lengths.length === 0) return 0;
  if (!Number.isFinite(maxRunM) || maxRunM <= 0) return lengths.length;
  let runs = 1;
  let current = 0;
  for (const value of lengths) {
    let remaining = value;
    while (remaining > 1e-9) {
      const capacity = maxRunM - current;
      if (capacity <= 1e-9) {
        runs += 1;
        current = 0;
        continue;
      }
      const used = Math.min(capacity, remaining);
      current += used;
      remaining -= used;
    }
  }
  return runs;
}

export function computeLighting(config: KitchenConfig): LightingPlan {
  const settings = config.lighting ?? defaultKitchenLighting();
  const strip = findLedStrip(settings.powerPerMeter, settings.voltage);
  const profile = LED_PROFILES.find((item) => item.id === settings.profile)!;
  const diffuser = LED_DIFFUSERS.find((item) => item.id === settings.diffuser)!;
  const control = LED_CONTROLS.find((item) => item.id === settings.control)!;

  const { segments, excludedM } = availableLength(config);
  const lengths = segments.map((segment) =>
    Math.max(0, (segment.end - segment.start - segment.blocked) / 100),
  );
  const lengthM = round(
    lengths.reduce((sum, value) => sum + value, 0),
    3,
  );
  const activeSegments = lengths.filter((value) => value > 0).length;

  const maxRunM = strip?.maxContinuousRunM ?? 0;
  const runs = lengthM > 0 ? countRuns(lengths.filter((v) => v > 0), maxRunM) : 0;
  const feedPoints = runs;

  const endCaps = activeSegments * 2;
  const connectors =
    activeSegments > 0 ? Math.max(0, activeSegments - 1) + runs : 0;

  const powerW = round(lengthM * settings.powerPerMeter, 1);
  const psuRequiredW = round(powerW * LED_PSU_MARGIN, 1);
  const psuLowW = round(powerW * LED_PSU_MARGIN_LOW, 1);

  let psuW = LED_PSU_RATINGS[LED_PSU_RATINGS.length - 1];
  for (const rating of LED_PSU_RATINGS) {
    if (rating >= psuRequiredW) {
      psuW = rating;
      break;
    }
  }
  const psuCount =
    strip && strip.maxPsuW > 0 && psuRequiredW > strip.maxPsuW
      ? Math.ceil(psuRequiredW / strip.maxPsuW)
      : 1;

  const currentA = settings.voltage > 0 ? round(powerW / settings.voltage, 2) : 0;

  const components: LightingComponent[] = [];

  if (lengthM > 0) {
    components.push({
      id: "tape",
      label: "Светодиодная лента",
      detail: `${settings.powerPerMeter} Вт/м · ${settings.voltage} В`,
      qty: lengthM,
      unit: "м",
      amount: Math.round(lengthM * (strip?.pricePerMeter ?? 0)),
    });
    components.push({
      id: "profile",
      label: "Профиль",
      detail: profile.name,
      qty: round(lengthM, 2),
      unit: "м",
      amount: Math.round(lengthM * profile.ratePerMeter),
    });
    components.push({
      id: "diffuser",
      label: "Рассеиватель",
      detail: diffuser.name,
      qty: round(lengthM, 2),
      unit: "м",
      amount: Math.round(lengthM * diffuser.ratePerMeter),
    });
    if (endCaps > 0) {
      components.push({
        id: "end-caps",
        label: "Заглушки профиля",
        detail: "по 2 шт. на каждый шкаф",
        qty: endCaps,
        unit: "шт.",
        amount: endCaps * LED_END_CAP_PRICE,
      });
    }
    if (connectors > 0) {
      components.push({
        id: "connectors",
        label: "Соединители",
        detail: "стыки профилей и подключения к блоку питания",
        qty: connectors,
        unit: "шт.",
        amount: connectors * LED_CONNECTOR_PRICE,
      });
    }
    if (psuW > 0) {
      components.push({
        id: "psu",
        label: "Блок питания",
        detail: `${psuW} Вт${psuCount > 1 ? ` · ${psuCount} шт.` : ""}`,
        qty: psuCount,
        unit: "шт.",
        amount: (LED_PSU_PRICE[psuW] ?? 0) * psuCount,
      });
    }
    components.push({
      id: "control",
      label: "Управление",
      detail: control.name,
      qty: 1,
      unit: "шт.",
      amount: control.price,
    });
    components.push({
      id: "install",
      label: "Монтаж подсветки",
      detail: "профиль, лента и электрика под верхним рядом",
      qty: round(lengthM, 2),
      unit: "м",
      amount: Math.round(lengthM * LED_INSTALL_PRICE_PER_METER),
    });
  }

  const cost = components.reduce((sum, item) => sum + item.amount, 0);

  const notes: string[] = [];
  if (excludedM > 0) {
    notes.push(
      `Исключены недоступные участки (закрыты пеналами): ${excludedM} м.`,
    );
  }
  if (strip?.source === "preliminary") {
    notes.push(
      `Характеристики ленты предварительные: максимум непрерывного подключения ${maxRunM} м, падение напряжения ${strip.voltageDropPct} %.`,
    );
  }
  if (lengthM > 0 && runs > 1) {
    notes.push(
      `Требуется ${runs} участков подключения и ${feedPoints} точек питания из-за ограничения длины ленты.`,
    );
  }
  if (psuCount > 1) {
    notes.push(
      `Мощность превышает допустимую для одного блока питания — подбирается ${psuCount} блока.`,
    );
  }
  if (lengthM > 0) {
    notes.push(
      `Расчётная мощность ${powerW} Вт, запас 20–25 %: ${psuLowW}–${psuRequiredW} Вт (выбрано ${psuW} Вт), ток ${currentA} А.`,
    );
  }

  return {
    enabled: config.underCabinetLighting,
    lengthM,
    excludedM,
    segments: activeSegments,
    profileM: round(lengthM, 3),
    diffuserM: round(lengthM, 3),
    endCaps,
    connectors,
    runs,
    feedPoints,
    powerW,
    psuRequiredW,
    psuW,
    psuCount,
    currentA,
    voltage: settings.voltage,
    powerPerMeter: settings.powerPerMeter,
    colorTemp: settings.colorTemp,
    hex: ledColorHex(settings.colorTemp),
    profile: settings.profile,
    diffuser: settings.diffuser,
    control: settings.control,
    stripId: strip?.id ?? "",
    stripSource: strip?.source ?? "preliminary",
    components,
    cost,
    preliminary: strip?.source !== "datasheet",
    notes,
  };
}
