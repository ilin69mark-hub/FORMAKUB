import type { WardrobeConfig } from "./types";

/** Этап 5: единый счётчик ящиков шкафа. */
export function wardrobeDrawerCount(config: WardrobeConfig): number {
  return config.sections.reduce((sum, section) => sum + Math.max(0, section.drawers), 0);
}

/**
 * Этап 6: единый счётчик штанг.
 *
 * Обычные штанги считаются по количеству позиций в секции. Выдвижная штанга
 * — отдельная позиция; отдельного подтверждённого тарифа для неё нет,
 * поэтому используется существующий тариф «Штанга» (UNKNOWN).
 */
export function wardrobeRodCount(config: WardrobeConfig): number {
  return config.sections.reduce(
    (sum, section) =>
      sum +
      Math.max(0, section.rods.length) +
      (section.rodType === "pullout" ? 1 : 0),
    0,
  );
}

export function wardrobePulloutRodCount(config: WardrobeConfig): number {
  return config.sections.filter((section) => section.rodType === "pullout").length;
}
