import type { KitchenConfig } from "./types";

/**
 * Толщина задней стенки ХДФ. Она не входит в глубину корпуса и
 * добавляется к ней отдельно.
 */
export const KITCHEN_BACK_PANEL_THICKNESS_MM = 3;
export const KITCHEN_BACK_PANEL_THICKNESS_CM = KITCHEN_BACK_PANEL_THICKNESS_MM / 10;

/** Утверждённые границы глубины нижнего модуля (CA-T-513). */
export const KITCHEN_MIN_BODY_DEPTH_MM = 400;
export const KITCHEN_MIN_BODY_DEPTH_CM = KITCHEN_MIN_BODY_DEPTH_MM / 10;
export const KITCHEN_MAX_FULL_DEPTH_MM = 580;
export const KITCHEN_MAX_FULL_DEPTH_CM = KITCHEN_MAX_FULL_DEPTH_MM / 10;
export const KITCHEN_COUNTERTOP_DEPTH_MM = 600;
export const KITCHEN_MIN_COUNTERTOP_OVERHANG_MM = 20;

/** Максимальная глубина корпуса при фактической толщине фасада. */
export function kitchenMaxBodyDepthMm(facadeThicknessMm: number): number {
  return (
    KITCHEN_MAX_FULL_DEPTH_MM -
    KITCHEN_BACK_PANEL_THICKNESS_MM -
    facadeThicknessMm
  );
}

export function kitchenMaxBodyDepthCm(facadeThicknessMm: number): number {
  return kitchenMaxBodyDepthMm(facadeThicknessMm) / 10;
}

/** Полная глубина модуля: корпус + ХДФ + фактическая толщина фасада. */
export function kitchenFullDepthMm(
  bodyDepthCm: number,
  facadeThicknessMm: number,
): number {
  return (
    bodyDepthCm * 10 +
    KITCHEN_BACK_PANEL_THICKNESS_MM +
    facadeThicknessMm
  );
}

export function kitchenFullDepthCm(
  bodyDepthCm: number,
  facadeThicknessMm: number,
): number {
  return kitchenFullDepthMm(bodyDepthCm, facadeThicknessMm) / 10;
}

/** Выступ столешницы глубиной 600 мм перед фасадом. */
export function kitchenCountertopOverhangMm(
  bodyDepthCm: number,
  facadeThicknessMm: number,
): number {
  return (
    KITCHEN_COUNTERTOP_DEPTH_MM -
    kitchenFullDepthMm(bodyDepthCm, facadeThicknessMm)
  );
}

/**
 * Geometry-only helper: total height of the standard lower row above the
 * floor, including plinth and countertop. It does not include wall cabinets.
 *
 * `height` is the carcass height; `plinthHeight` and `countertopThickness`
 * are independent config values (cm and mm respectively).
 */
export function kitchenLowerTotalHeightCm(config: KitchenConfig): number {
  const standardLower = config.modules.find(
    (module) => module.type !== "tall" && module.type !== "oven",
  );
  const body = standardLower?.height ?? 0;
  const plinth = config.plinth ? config.plinthHeight : 0;
  return body + plinth + config.countertopThickness / 10;
}
