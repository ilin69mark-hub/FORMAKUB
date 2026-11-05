import type { KitchenModuleType, SupportSystemId } from "@/lib/configurator/types";

/**
 * Система опор и крепление цоколя.
 *
 * Расчёт строится не по правилу «4 ножки на модуль», а от несущих вертикальных
 * элементов корпуса (боковин и внутренних перегородок), допустимого
 * расстояния между опорами и предполагаемой нагрузки.
 *
 * ⚠️ `maxSpanCm` и `maxLoadKgPerLeg` — предварительные допущения. Они
 * вынесены в настройки конфигурации (`config.supports`), чтобы позднее
 * подставить паспортные характеристики конкретной производственной системы.
 * Расчёт не является инженерно подтверждённым до привязки к конкретной
 * фурнитуре и её паспортным данным.
 */

export interface SupportSystem {
  id: SupportSystemId;
  label: string;
  description: string;
  /** Отступ крайней опоры от торца корпуса, см. */
  edgeInsetCm: number;
  /** Допустимое расстояние между опорами вдоль несущей линии, см. */
  maxSpanCm: number;
  /** Допустимая нагрузка на одну опору, кг. */
  maxLoadKgPerLeg: number;
  /** Клипс цоколя на одну переднюю опору. */
  clipsPerLeg: number;
  /** Винтов на опору при скрытом креплении цоколя. */
  screwsPerLeg: number;
  /** Шаг креплений пенала к стене, см. */
  tallAnchorSpacingCm: number;
  /** Ширина пенала, начиная с которой нужна промежуточная опора. */
  tallCenterLegWidthCm: number;
  /** Цена мебельной опоры, ₽/шт. */
  legPrice: number;
  /** Цена клипсы цоколя, ₽/шт. */
  clipPrice: number;
  /** Цена винта скрытого крепления цоколя, ₽/шт. */
  screwPrice: number;
  /** Цена крепления к стене, ₽/шт. */
  anchorPrice: number;
  /** Источник характеристик. */
  source: "preliminary" | "datasheet";
}

export const SUPPORT_SYSTEMS: SupportSystem[] = [
  {
    id: "standard",
    label: "Стандартные регулируемые",
    description:
      "Базовые ножки с регулировкой по высоте и клипсами под цоколь. Для рядовых корпусов.",
    edgeInsetCm: 4,
    maxSpanCm: 60,
    maxLoadKgPerLeg: 40,
    clipsPerLeg: 1,
    screwsPerLeg: 2,
    tallAnchorSpacingCm: 120,
    tallCenterLegWidthCm: 60,
    legPrice: 420,
    clipPrice: 60,
    screwPrice: 9,
    anchorPrice: 350,
    source: "preliminary",
  },
  {
    id: "heavy",
    label: "Усиленные (нагруженные корпуса)",
    description:
      "Опоры повышенной несущей способности с более частым шагом. Для широких и высоких корпусов.",
    edgeInsetCm: 5,
    maxSpanCm: 45,
    maxLoadKgPerLeg: 70,
    clipsPerLeg: 2,
    screwsPerLeg: 2,
    tallAnchorSpacingCm: 110,
    tallCenterLegWidthCm: 50,
    legPrice: 690,
    clipPrice: 65,
    screwPrice: 12,
    anchorPrice: 400,
    source: "preliminary",
  },
];

export const SUPPORT_SYSTEM_DEFAULT_ID: SupportSystemId = "standard";

export function findSupportSystem(id?: string): SupportSystem {
  return (
    SUPPORT_SYSTEMS.find((item) => item.id === id) ??
    SUPPORT_SYSTEMS.find((item) => item.id === SUPPORT_SYSTEM_DEFAULT_ID)!
  );
}

/**
 * Предполагаемая нагрузка на модуль, кг: собственный вес конструкции и
 * содержимое при типовой наполняемости. Для модулей под технику указана
 * нагрузка самой техники.
 *
 * Значения предварительные и масштабируются по фактической ширине модуля к
 * типовой ширине.
 */
export const MODULE_LOAD_KG: Record<KitchenModuleType, number> = {
  base: 55,
  sink: 75,
  hob: 65,
  drawers: 80,
  wall: 0,
  tall: 130,
  oven: 110,
  bottle: 35,
};

/** Типовая ширина, для которой указана нагрузка. */
export const MODULE_LOAD_REFERENCE_WIDTH: Record<KitchenModuleType, number> = {
  base: 60,
  sink: 60,
  hob: 60,
  drawers: 60,
  wall: 60,
  tall: 60,
  oven: 60,
  bottle: 20,
};

/** Крепление цоколя к опорам. */
export type PlinthMountKind = "clips" | "hidden";

export interface PlinthMountOption {
  id: PlinthMountKind;
  label: string;
  description: string;
}

export const PLINTH_MOUNTS: PlinthMountOption[] = [
  {
    id: "clips",
    label: "Клипсы",
    description:
      "Цоколь защёлкивается на клипсы, зафиксированные на передних ножках. Можно снять без инструмента.",
  },
  {
    id: "hidden",
    label: "Скрытое",
    description:
      "Цоколь прикручивается винтами сзади к опорам. Отметок на лицевой поверхности нет.",
  },
];

export const PLINTH_MOUNT_DEFAULT: PlinthMountKind = "clips";

export function findPlinthMount(id?: string): PlinthMountOption {
  return PLINTH_MOUNTS.find((item) => item.id === id) ?? PLINTH_MOUNTS[0];
}

/** Предупреждение о предварительности инженерных допущений по опорам. */
export const SUPPORTS_PRELIMINARY_NOTE =
  "Количества опор — предварительный расчёт. Итоговые характеристики опор и допустимые нагрузки подтверждаются паспортными данными выбранной системы фурнитуры.";
