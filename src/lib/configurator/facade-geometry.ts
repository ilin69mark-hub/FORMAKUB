import type { KitchenModuleType } from "./types";

/**
 * CA-T-517 — единый источник геометрии фасадов для цены и 2D.
 *
 * Все размеры — в сантиметрах. Площадь створки считается по её фактическим
 * размерам: width × height / 10 000 (м²). Зазоры и вставки не изобретены:
 * они перенесены из существующей геометрии `KitchenScene.tsx`,
 * `WardrobeScene.tsx` и `SINK_RULES` (см. MATERIalS_AND_FACADES_AUDIT §2.3).
 */

/** Порог деления модуля/секции на две створки (было `width > 60`). */
export const FACADE_SPLIT_WIDTH_CM = 60;

/** Зазор у края ряда (2 мм). */
export const FACADE_EDGE_GAP_CM = 0.2;
/** Зазор к соседнему модулю (1 мм). */
export const FACADE_NEIGHBOR_GAP_CM = 0.1;
/** Зазор между распашными створками одного поля: 2 мм суммарно (по 1 мм на створку). */
export const FACADE_DOOR_GAP_CM = 0.2;
/**
 * Модули со встроенной техникой: правило не меняется до отдельного решения.
 * Оставлен исторический центральный зазор 1 мм.
 */
export const FACADE_OVEN_DOOR_GAP_CM = 0.1;
/** Зазор между вертикально stacked фронтами ящиков: 2 мм (по 1 мм на фасад). */
export const FACADE_DRAWER_GAP_CM = 0.2;

/** Зазор между дверями шкафа (5,5 мм) — из `WardrobeScene.tsx`. */
export const WARDROBE_DOOR_GAP_CM = 0.55;
/** Высота цоколя шкафа (8 см) — единый источник для цены и 2D. */
export const WARDROBE_PLINTH_HEIGHT_CM = 8;
/** Вставка корпуса шкафа по бокам (14 мм на сторону). */
export const WARDROBE_SIDE_REVEAL_CM = 1.4;
/** Вставка корпуса шкафа сверху (14 мм). */
export const WARDROBE_TOP_REVEAL_CM = 1.4;
/** Вставка корпуса шкафа снизу (12 мм). */
export const WARDROBE_BOTTOM_REVEAL_CM = 1.2;

function safe(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Площадь створки в м² по фактическим размерам. */
export function facadeAreaSqm(widthCm: number, heightCm: number): number {
  return (safe(widthCm) * safe(heightCm)) / 10000;
}

/** Одна фактическая створка/фронт с положением относительно поля фасада. */
export interface FacadePanel {
  /** Смещение от левого края модуля/секции. */
  xCm: number;
  /** Смещение от верхнего края поля. */
  yCm: number;
  widthCm: number;
  heightCm: number;
  areaSqm: number;
}

export interface FacadeGeometry {
  /** Полезное поле фасада без зазоров. */
  fieldWidthCm: number;
  fieldHeightCm: number;
  leftGapCm: number;
  rightGapCm: number;
  panelWidthCm: number;
  panelHeightCm: number;
  /** Фактически сформированные створки/фронты. */
  panels: FacadePanel[];
  /** Суммарная площадь всех створок, м². */
  areaSqm: number;
}

export interface FacadeFieldInput {
  widthCm: number;
  heightCm: number;
  leftGapCm: number;
  rightGapCm: number;
  topGapCm: number;
  bottomGapCm: number;
  /** Зазор между створками одного поля. */
  doorGapCm: number;
  /** По умолчанию — `facadeDoorCount(widthCm)`. */
  doors?: number;
}

/** Число распашных створок по ширине модуля/секции. */
export function facadeDoorCount(widthCm: number): number {
  return widthCm > FACADE_SPLIT_WIDTH_CM ? 2 : 1;
}

/**
 * Поле распашных створок: створки делят ширину поля, высота — общая.
 * Каждая створка возвращается отдельно со своей площадью.
 */
export function facadeField(input: FacadeFieldInput): FacadeGeometry {
  const left = safe(input.leftGapCm);
  const right = safe(input.rightGapCm);
  const top = safe(input.topGapCm);
  const bottom = safe(input.bottomGapCm);
  const gap = safe(input.doorGapCm);
  const fieldWidthCm = safe(input.widthCm - left - right);
  const fieldHeightCm = safe(input.heightCm - top - bottom);
  const doors = Math.max(1, Math.floor(input.doors ?? facadeDoorCount(input.widthCm)));
  const panelWidthCm = safe((fieldWidthCm - gap * (doors - 1)) / doors);
  const panels = Array.from({ length: doors }, (_, index) => {
    const widthCm = panelWidthCm;
    return {
      xCm: left + index * (panelWidthCm + gap),
      yCm: top,
      widthCm,
      heightCm: fieldHeightCm,
      areaSqm: facadeAreaSqm(widthCm, fieldHeightCm),
    };
  });
  return {
    fieldWidthCm,
    fieldHeightCm,
    leftGapCm: left,
    rightGapCm: right,
    panelWidthCm,
    panelHeightCm: fieldHeightCm,
    panels,
    areaSqm: panels.reduce((sum, panel) => sum + panel.areaSqm, 0),
  };
}

export interface FacadeStackInput {
  widthCm: number;
  heightCm: number;
  topGapCm: number;
  bottomGapCm: number;
  /** Зазор между соседними фронтами по высоте. */
  gapCm: number;
  /** Количество фронтов в стопке (минимум 1). */
  count: number;
}

/**
 * Вертикальная стопка фронтов (ящики): каждый фронт — отдельная деталь.
 * Ширина — общая ширина поля, высота делится с учётом зазоров.
 */
export function facadeStack(input: FacadeStackInput): FacadeGeometry {
  const top = safe(input.topGapCm);
  const bottom = safe(input.bottomGapCm);
  const gap = safe(input.gapCm);
  const count = Math.max(1, Math.floor(input.count));
  const fieldWidthCm = safe(input.widthCm);
  const fieldHeightCm = safe(input.heightCm - top - bottom);
  const panelHeightCm = safe((fieldHeightCm - gap * (count - 1)) / count);
  const panels = Array.from({ length: count }, (_, index) => {
    const heightCm = panelHeightCm;
    return {
      xCm: 0,
      yCm: top + index * (panelHeightCm + gap),
      widthCm: fieldWidthCm,
      heightCm,
      areaSqm: facadeAreaSqm(fieldWidthCm, heightCm),
    };
  });
  return {
    fieldWidthCm,
    fieldHeightCm,
    leftGapCm: 0,
    rightGapCm: 0,
    panelWidthCm: fieldWidthCm,
    panelHeightCm,
    panels,
    areaSqm: panels.reduce((sum, panel) => sum + panel.areaSqm, 0),
  };
}

export interface KitchenFacadeInput {
  widthCm: number;
  heightCm: number;
  type: KitchenModuleType;
  /** Первый модуль своего ряда (нижнего/верхнего). */
  rowStart: boolean;
  /** Последний модуль своего ряда. */
  rowEnd: boolean;
  /** Высота цоколя: у tall/oven высота включает цоколь. */
  plinthHeightCm: number;
}

/** Фасадное поле модуля кухни по фактическому месту в ряду. */
export function kitchenFacadeField(input: KitchenFacadeInput): FacadeGeometry {
  const tall = input.type === "tall" || input.type === "oven";
  const bodyHeightCm = safe(input.heightCm - (tall ? input.plinthHeightCm : 0));
  return facadeField({
    widthCm: input.widthCm,
    heightCm: bodyHeightCm,
    leftGapCm: input.rowStart ? FACADE_EDGE_GAP_CM : FACADE_NEIGHBOR_GAP_CM,
    rightGapCm: input.rowEnd ? FACADE_EDGE_GAP_CM : FACADE_NEIGHBOR_GAP_CM,
    topGapCm: FACADE_EDGE_GAP_CM,
    bottomGapCm: FACADE_EDGE_GAP_CM,
    doorGapCm:
      input.type === "oven" ? FACADE_OVEN_DOOR_GAP_CM : FACADE_DOOR_GAP_CM,
  });
}

export interface WardrobeFacadeInput {
  sectionWidthCm: number;
  heightCm: number;
  plinthHeightCm: number;
}

/** Фасадное поле секции шкафа: створки внутри проёма корпуса. */
export function wardrobeFacadeField(input: WardrobeFacadeInput): FacadeGeometry {
  return facadeField({
    widthCm: input.sectionWidthCm,
    heightCm: safe(input.heightCm - input.plinthHeightCm),
    leftGapCm: WARDROBE_SIDE_REVEAL_CM,
    rightGapCm: WARDROBE_SIDE_REVEAL_CM,
    topGapCm: WARDROBE_TOP_REVEAL_CM,
    bottomGapCm: WARDROBE_BOTTOM_REVEAL_CM,
    doorGapCm: WARDROBE_DOOR_GAP_CM,
  });
}

/** Панель фасада мойки из `sinkLayout().facadeBoxes`. */
export interface SinkFacadeBoxInput {
  width: number;
  kind: "door" | "bottle" | "drawers";
  fronts?: number;
}

/**
 * Фактическая площадь всех панелей фасада мойки.
 * Распашные створки и бутылочница — на всю высоту поля; фронты ящиков —
 * стопкой с зазором `FACADE_DRAWER_GAP_CM`.
 */
export function sinkFacadeArea(
  boxes: readonly SinkFacadeBoxInput[],
  fieldHeightCm: number,
): number {
  let total = 0;
  for (const box of boxes) {
    if (box.kind === "drawers") {
      total += facadeStack({
        widthCm: box.width,
        heightCm: fieldHeightCm,
        topGapCm: 0,
        bottomGapCm: 0,
        gapCm: FACADE_DRAWER_GAP_CM,
        count: box.fronts ?? 1,
      }).areaSqm;
    } else {
      total += facadeAreaSqm(box.width, fieldHeightCm);
    }
  }
  return total;
}
