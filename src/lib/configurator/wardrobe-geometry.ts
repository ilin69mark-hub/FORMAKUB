import type { WardrobeConfig } from "./types";

/**
 * Этап 2: единая геометрическая модель корпуса шкафа.
 *
 * Все линейные размеры — миллиметры. Ширины секций выводятся из общего
 * внешнего размера и положения центральной перегородки; ширины секций
 * не хранятся в конфигурации.
 */

export const WARDROBE_BODY_THICKNESS_MM = 16;
export const WARDROBE_BACK_THICKNESS_MM = 3;
export const WARDROBE_PLINTH_HEIGHT_MM = 80;
export const WARDROBE_PLINTH_INSET_MM = 50;
export const WARDROBE_PARTITION_THICKNESS_MM = 16;
export const WARDROBE_MIN_SECTION_WIDTH_MM = 300;

export interface WardrobeGeometrySection {
  id: string;
  /** Внешняя ширина зоны секции (для фасадного поля этапа 3). */
  widthMm: number;
  /** Внутренняя ширина между боковиной/перегородкой. */
  innerWidthMm: number;
}

export interface WardrobeGeometryPart {
  id: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  areaSqm: number;
}

export interface WardrobeGeometry {
  widthMm: number;
  heightMm: number;
  fullDepthMm: number;
  bodyDepthMm: number;
  bodyThicknessMm: number;
  backThicknessMm: number;
  facadeThicknessMm: number;
  plinthHeightMm: number;
  plinthInsetMm: number;
  internalWidthMm: number;
  sections: WardrobeGeometrySection[];
  partition: {
    positionMm: number;
    thicknessMm: number;
  } | null;
  antresol: {
    heightMm: number;
    dividerThicknessMm: number;
    /** Нижняя граница разделительной полки от пола, мм. */
    dividerBottomMm: number;
    /** Внутренняя высота основной зоны от цоколя до полки. */
    mainHeightMm: number;
    /** Внутренняя высота антресоли. */
    innerHeightMm: number;
  } | null;
  /** Корпусные детали, входящие в стоимость корпуса (без полок/цоколя/ХДФ). */
  parts: WardrobeGeometryPart[];
}

function areaM2(widthMm: number, heightMm: number): number {
  return (Math.max(0, widthMm) * Math.max(0, heightMm)) / 1_000_000;
}

function part(
  id: string,
  widthMm: number,
  heightMm: number,
  depthMm: number,
): WardrobeGeometryPart {
  return { id, widthMm, heightMm, depthMm, areaSqm: areaM2(widthMm, heightMm) };
}

/**
 * Ширины секций: положение перегородки — расстояние от левого внешнего края
 * до осевой линии перегородки. Левая/правая внутренние ширины учитывают
 * боковины и половину толщины перегородки.
 */
export function wardrobeMinWidthMm(sectionCount: number): number {
  const n = Math.max(1, Math.floor(sectionCount));
  return n * WARDROBE_MIN_SECTION_WIDTH_MM + (n + 1) * WARDROBE_BODY_THICKNESS_MM;
}

export function wardrobeSectionWidths(
  widthMm: number,
  partition: { positionMm: number } | null,
  bodyThicknessMm = WARDROBE_BODY_THICKNESS_MM,
  partitionThicknessMm = WARDROBE_PARTITION_THICKNESS_MM,
): { outerWidthMm: number; innerWidthMm: number }[] {
  if (!partition) {
    return [
      {
        // Одна секция: зона фасада — весь внешний габарит, чистый проём —
        // минус две боковины.
        outerWidthMm: Math.max(0, widthMm),
        innerWidthMm: Math.max(0, widthMm - 2 * bodyThicknessMm),
      },
    ];
  }
  const halfPartition = partitionThicknessMm / 2;
  // Зона секции для фасада: от внешнего края до осевой перегородки.
  const leftOuter = Math.max(0, partition.positionMm - halfPartition);
  const rightOuter = Math.max(
    0,
    widthMm - partition.positionMm - halfPartition,
  );
  // Чистый проём: минус боковина/половина перегородки.
  const leftInner = Math.max(0, leftOuter - bodyThicknessMm);
  const rightInner = Math.max(0, rightOuter - bodyThicknessMm);
  return [
    { outerWidthMm: leftOuter, innerWidthMm: leftInner },
    { outerWidthMm: rightOuter, innerWidthMm: rightInner },
  ];
}

export function wardrobeGeometry(config: WardrobeConfig): WardrobeGeometry {
  const widthMm = config.widthMm;
  const heightMm = config.height * 10;
  const bodyThicknessMm = WARDROBE_BODY_THICKNESS_MM;
  const backThicknessMm = WARDROBE_BACK_THICKNESS_MM;
  const facadeThicknessMm = config.facadeThickness;
  const bodyDepthMm = Math.max(
    0,
    config.fullDepth - facadeThicknessMm - backThicknessMm,
  );
  const plinthHeightMm = config.plinth ? WARDROBE_PLINTH_HEIGHT_MM : 0;
  const internalWidthMm = Math.max(0, widthMm - 2 * bodyThicknessMm);

  const partition = config.partition
    ? {
        positionMm: config.partition.positionMm,
        thicknessMm: WARDROBE_PARTITION_THICKNESS_MM,
      }
    : null;

  const widths = wardrobeSectionWidths(
    widthMm,
    config.partition,
    bodyThicknessMm,
    WARDROBE_PARTITION_THICKNESS_MM,
  );
  const sections = config.sections.slice(0, widths.length).map((section, index) => ({
    id: section.id,
    widthMm: widths[index]!.outerWidthMm,
    innerWidthMm: widths[index]!.innerWidthMm,
  }));

  const antresol = config.antresol
    ? (() => {
        // Временное допущение: разделитель — ЛДСП 16 мм, как полка.
        // Точная конструкция/толщина разделителя остаётся UNKNOWN.
        const dividerThicknessMm = bodyThicknessMm;
        const dividerBottomMm = Math.max(
          0,
          heightMm - config.antresol!.heightMm - dividerThicknessMm,
        );
        return {
          heightMm: config.antresol!.heightMm,
          dividerThicknessMm,
          dividerBottomMm,
          mainHeightMm: Math.max(
            0,
            dividerBottomMm - plinthHeightMm - bodyThicknessMm,
          ),
          innerHeightMm: Math.max(0, config.antresol!.heightMm - bodyThicknessMm),
        };
      })()
    : null;

  const parts: WardrobeGeometryPart[] = [
    part("side-left", bodyDepthMm, heightMm, bodyDepthMm),
    part("side-right", bodyDepthMm, heightMm, bodyDepthMm),
    part("bottom", internalWidthMm, bodyDepthMm, bodyThicknessMm),
    part("top", widthMm, bodyDepthMm, bodyThicknessMm),
  ];
  if (partition) {
    parts.push(
      part("partition", bodyDepthMm, heightMm, bodyDepthMm),
    );
  }
  if (antresol) {
    parts.push(
      part(
        "antresol-divider",
        internalWidthMm,
        bodyDepthMm,
        antresol.dividerThicknessMm,
      ),
    );
  }

  return {
    widthMm,
    heightMm,
    fullDepthMm: config.fullDepth,
    bodyDepthMm,
    bodyThicknessMm,
    backThicknessMm,
    facadeThicknessMm,
    plinthHeightMm,
    plinthInsetMm: WARDROBE_PLINTH_INSET_MM,
    internalWidthMm,
    sections,
    partition,
    antresol,
    parts,
  };
}

export function wardrobeBodyAreaSqm(geometry: WardrobeGeometry): number {
  return geometry.parts.reduce((sum, item) => sum + item.areaSqm, 0);
}

export function wardrobeSectionByIndex(
  config: WardrobeConfig,
  index: number,
): WardrobeGeometrySection | undefined {
  return wardrobeGeometry(config).sections[index];
}
