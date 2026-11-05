import { KITCHEN_MODULES } from "@/content/catalog";
import type { KitchenConfig } from "./types";

/**
 * Перемещение модуля кухни на одну позицию влево/вправо внутри своего ряда
 * (нижний ряд/пеналы или верхний ряд). Существующая логика компоновки:
 * порядок модулей в массиве определяет порядок на схеме.
 */
export function moveKitchenModule(
  config: KitchenConfig,
  id: string,
  direction: -1 | 1,
): KitchenConfig {
  const target = config.modules.find((module) => module.id === id);
  if (!target) return config;
  const zone = KITCHEN_MODULES[target.type].zone;
  const zoneIds = config.modules
    .filter((module) => KITCHEN_MODULES[module.type].zone === zone)
    .map((module) => module.id);
  const index = zoneIds.indexOf(id);
  const swapId = zoneIds[index + direction];
  if (index < 0 || !swapId) return config;

  const modules = [...config.modules];
  const from = modules.findIndex((module) => module.id === id);
  const to = modules.findIndex((module) => module.id === swapId);
  if (from < 0 || to < 0) return config;
  [modules[from], modules[to]] = [modules[to], modules[from]];
  return { ...config, modules };
}

/** Доступно ли перемещение модуля в указанную сторону. */
export function canMoveKitchenModule(
  config: KitchenConfig,
  id: string,
  direction: -1 | 1,
): boolean {
  const target = config.modules.find((module) => module.id === id);
  if (!target) return false;
  const zone = KITCHEN_MODULES[target.type].zone;
  const zoneIds = config.modules
    .filter((module) => KITCHEN_MODULES[module.type].zone === zone)
    .map((module) => module.id);
  const index = zoneIds.indexOf(id);
  if (index < 0) return false;
  return direction === -1 ? index > 0 : index < zoneIds.length - 1;
}
