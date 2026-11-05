import type { PlinthMaterialId } from "@/lib/configurator/types";

/**
 * Цоколь: материалы, толщины и варианты исполнения.
 *
 * Геометрия и логика расчёта цоколя (длина = ширина нижнего ряда, высота =
 * `config.plinthHeight`) не меняются — каталог описывает только материал и
 * цену погонного метра.
 *
 * Ставки — демо-данные для калькулятора; на цену можно повлиять заменой
 * значения в этом каталоге.
 */

export interface PlinthFinish {
  id: string;
  name: string;
  /** Наценка за исполнение, ₽/м к базовой ставке материала. */
  rateDelta: number;
}

export interface PlinthMaterialOption {
  id: PlinthMaterialId;
  name: string;
  shortName: string;
  description: string;
  /** Базовая цена цоколя из этого материала, ₽ за погонный метр. */
  ratePerMeter: number;
  /** Доступные толщины, мм. */
  thicknesses: number[];
  /** Толщина, выбираемая по умолчанию при выборе материала. */
  defaultThickness: number;
  /** Варианты исполнения. */
  finishes: PlinthFinish[];
}

export const PLINTH_MATERIALS: PlinthMaterialOption[] = [
  {
    id: "ldsp",
    name: "ЛДСП",
    shortName: "ЛДСП",
    description:
      "Классический цоколь из ЛДСП. Влагостойкая плита, торцы закрыты кромкой.",
    ratePerMeter: 1600,
    thicknesses: [16, 18],
    defaultThickness: 16,
    finishes: [
      { id: "pvc2", name: "Кромка ПВХ 2 мм", rateDelta: 0 },
      { id: "pvc04", name: "Кромка ПВХ 0,4 мм", rateDelta: -120 },
    ],
  },
  {
    id: "mdf",
    name: "МДФ",
    shortName: "МДФ",
    description: "Ровная кромка без шва. Хорошо перекрашивается под фасады.",
    ratePerMeter: 2200,
    thicknesses: [16],
    defaultThickness: 16,
    finishes: [
      { id: "paint", name: "Эмаль матовая", rateDelta: 700 },
      { id: "film", name: "Плёнка ПВХ", rateDelta: 250 },
    ],
  },
  {
    id: "plastic",
    name: "Пластик",
    shortName: "Пластик",
    description: "ПВХ-профиль по ЛДСП или МДФ: не боится влаги, легко моется.",
    ratePerMeter: 2600,
    thicknesses: [8, 10],
    defaultThickness: 8,
    finishes: [
      { id: "mat", name: "Матовый", rateDelta: 0 },
      { id: "gloss", name: "Глянцевый", rateDelta: 200 },
    ],
  },
  {
    id: "aluminum",
    name: "Алюминий",
    shortName: "Алюминий",
    description: "Профиль с креплением на клипсы к опорам. Для влажных зон и вентилируемого цоколя.",
    ratePerMeter: 4400,
    thicknesses: [1, 1.5, 2],
    defaultThickness: 1.5,
    finishes: [
      { id: "anodized", name: "Анодированный", rateDelta: 0 },
      { id: "powder", name: "Порошковый", rateDelta: 350 },
    ],
  },
  {
    id: "stainless",
    name: "Нержавеющая сталь",
    shortName: "Нерж.",
    description: "Стойкий к ударам и моющим средствам цоколь для интенсивной эксплуатации.",
    ratePerMeter: 6200,
    thicknesses: [0.8, 1, 1.5],
    defaultThickness: 1,
    finishes: [
      { id: "brushed", name: "Шлифованный", rateDelta: 0 },
      { id: "mirror", name: "Зеркальный", rateDelta: 600 },
    ],
  },
];

export const PLINTH_DEFAULT_MATERIAL: PlinthMaterialId = "ldsp";

export function findPlinthMaterial(id: string): PlinthMaterialOption | undefined {
  return PLINTH_MATERIALS.find((item) => item.id === id);
}

/** Ближайшая допустимая толщина для выбранного материала. */
export function snapPlinthThickness(material: string, thickness: number): number {
  const option = findPlinthMaterial(material);
  if (!option) return thickness;
  if (!Number.isFinite(thickness)) return option.defaultThickness;
  return option.thicknesses.reduce((best, value) =>
    Math.abs(value - thickness) < Math.abs(best - thickness) ? value : best,
  );
}

/** Исполнение цоколя: первое допустимое, если выбрано чужое для материала. */
export function snapPlinthFinish(material: string, finish: string): string {
  const option = findPlinthMaterial(material);
  if (!option) return finish;
  return option.finishes.some((item) => item.id === finish)
    ? finish
    : option.finishes[0].id;
}

/** Итоговая ставка: базовый материал + исполнение. */
export function plinthRatePerMeter(
  material: string,
  finish: string,
): number {
  const option = findPlinthMaterial(material) ?? findPlinthMaterial(PLINTH_DEFAULT_MATERIAL)!;
  const delta = option.finishes.find((item) => item.id === finish)?.rateDelta ?? 0;
  return option.ratePerMeter + delta;
}
