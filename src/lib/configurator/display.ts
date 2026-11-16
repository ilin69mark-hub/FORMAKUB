import { KITCHEN_MODULES } from "@/content/catalog";

import type { KitchenConfig, KitchenModule, WardrobeConfig } from "./types";
import { wardrobeGeometry } from "./wardrobe-geometry";

/**
 * Чистые display/UI-утилиты калькулятора: не считают стоимость и не
 * импортируют pricing/PRICING. Вынесены из legacy `pricing.ts`, чтобы
 * публичные компоненты не тянули legacy-модуль цен в runtime.
 */

export const PRICE_DISCLAIMER =
  "Предварительный расчёт. Итоговая стоимость будет подтверждена после проверки размеров, материалов, комплектации и технических условий менеджером.";

export function kitchenFloorModules(config: KitchenConfig): KitchenModule[] {
  return config.modules.filter((module) => KITCHEN_MODULES[module.type].zone === "floor");
}

export function kitchenUpperModules(config: KitchenConfig): KitchenModule[] {
  return config.modules.filter((module) => KITCHEN_MODULES[module.type].zone === "upper");
}

export function kitchenTotalWidth(config: KitchenConfig): number {
  const floor = kitchenFloorModules(config).reduce(
    (sum, module) => sum + module.width,
    0,
  );
  const upper = kitchenUpperModules(config).reduce(
    (sum, module) => sum + module.width,
    0,
  );
  return Math.max(floor, upper);
}

export function wardrobeWidth(config: WardrobeConfig): number {
  return wardrobeGeometry(config).widthMm / 10;
}

export function formatRub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} ₽`;
}

export function formatRange(value: number): string {
  return `${formatRub(value * 0.9)} — ${formatRub(value * 1.1)}`;
}
