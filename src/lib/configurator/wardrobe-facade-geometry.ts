import type { WardrobeConfig } from "./types";
import { wardrobeGeometry, type WardrobeGeometry } from "./wardrobe-geometry";

/**
 * Этап 3: накладные фасады шкафа.
 *
 * Все размеры — миллиметры. Координаты x — от левого внешнего края шкафа,
 * y — от верхнего внешнего края. Одна дверь на секцию; антресоль — одна
 * отдельная дверь на всю ширину.
 */

export const WARDROBE_FACADE_GAP_MM = 2;
export const WARDROBE_FACADE_PARTITION_GAP_MM = 1;

export interface WardrobeFacadePanel {
  id: string;
  kind: "main" | "antresol";
  sectionId?: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  areaSqm: number;
}

export interface WardrobeFacadeGeometry {
  panels: WardrobeFacadePanel[];
  mainPanels: WardrobeFacadePanel[];
  antresolPanel: WardrobeFacadePanel | null;
  totalAreaSqm: number;
}

function panel(
  id: string,
  kind: "main" | "antresol",
  xMm: number,
  yMm: number,
  widthMm: number,
  heightMm: number,
  sectionId?: string,
): WardrobeFacadePanel {
  return {
    id,
    kind,
    ...(sectionId ? { sectionId } : {}),
    xMm,
    yMm,
    widthMm: Math.max(0, widthMm),
    heightMm: Math.max(0, heightMm),
    areaSqm: (Math.max(0, widthMm) * Math.max(0, heightMm)) / 1_000_000,
  };
}

/** Горизонтальные границы дверей: сверху/снизу 2 мм, между зонами 2 мм. */
function verticalBounds(
  config: WardrobeConfig,
  geometry: WardrobeGeometry,
): { mainTopMm: number; mainBottomMm: number; antresolTopMm: number; antresolBottomMm: number } {
  const topGap = WARDROBE_FACADE_GAP_MM;
  const bottomGap = WARDROBE_FACADE_GAP_MM;
  const mainBottomMm = geometry.heightMm - geometry.plinthHeightMm - bottomGap;
  if (!geometry.antresol) {
    return {
      mainTopMm: topGap,
      mainBottomMm,
      antresolTopMm: 0,
      antresolBottomMm: 0,
    };
  }
  const center =
    geometry.heightMm -
    geometry.antresol.dividerBottomMm -
    geometry.antresol.dividerThicknessMm / 2;
  const antresolBottomMm = center - WARDROBE_FACADE_GAP_MM / 2;
  const mainTopMm = center + WARDROBE_FACADE_GAP_MM / 2;
  return {
    mainTopMm,
    mainBottomMm,
    antresolTopMm: topGap,
    antresolBottomMm,
  };
}

export function wardrobeFacadeGeometry(
  config: WardrobeConfig,
  geometry = wardrobeGeometry(config),
): WardrobeFacadeGeometry {
  const widthMm = geometry.widthMm;
  const gap = WARDROBE_FACADE_GAP_MM;
  const partitionGap = WARDROBE_FACADE_PARTITION_GAP_MM;
  const bounds = verticalBounds(config, geometry);
  const mainHeightMm = bounds.mainBottomMm - bounds.mainTopMm;

  const mainPanels: WardrobeFacadePanel[] = [];
  if (!geometry.partition) {
    // Одна секция: одна дверь на всю ширину с открытыми краями 2/2.
    const section = config.sections[0];
    mainPanels.push(
      panel(
        "facade-main-1",
        "main",
        gap,
        bounds.mainTopMm,
        widthMm - 2 * gap,
        mainHeightMm,
        section?.id,
      ),
    );
  } else {
    // Две секции: 2 мм у открытого края, 1 мм у перегородки с каждой стороны.
    const left = config.sections[0];
    const right = config.sections[1];
    mainPanels.push(
      panel(
        "facade-main-1",
        "main",
        gap,
        bounds.mainTopMm,
        geometry.partition.positionMm - gap - partitionGap,
        mainHeightMm,
        left?.id,
      ),
      panel(
        "facade-main-2",
        "main",
        geometry.partition.positionMm + partitionGap,
        bounds.mainTopMm,
        widthMm - geometry.partition.positionMm - gap - partitionGap,
        mainHeightMm,
        right?.id,
      ),
    );
  }

  const antresolPanel = geometry.antresol
    ? panel(
        "facade-antresol",
        "antresol",
        gap,
        bounds.antresolTopMm,
        widthMm - 2 * gap,
        bounds.antresolBottomMm - bounds.antresolTopMm,
      )
    : null;

  const panels = antresolPanel ? [...mainPanels, antresolPanel] : mainPanels;
  return {
    panels,
    mainPanels,
    antresolPanel,
    totalAreaSqm: panels.reduce((sum, item) => sum + item.areaSqm, 0),
  };
}
