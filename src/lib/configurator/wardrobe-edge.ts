import type { WardrobeConfig } from "./types";
import { wardrobeGeometry, type WardrobeGeometry } from "./wardrobe-geometry";
import {
  wardrobeFacadeGeometry,
  type WardrobeFacadeGeometry,
} from "./wardrobe-facade-geometry";

/**
 * Этап 7: ориентировочная длина и стоимость кромки.
 *
 * Упрощение: кромится весь периметр каждой прямоугольной детали.
 * Приоритет категорий: корпус → полки → фасады; одна деталь — одна кромка.
 */

export type WardrobeEdgeType = "pvc04" | "pvc1" | "pvc2";

export interface WardrobeEdgeRates {
  pvc04: number;
  pvc1: number;
  pvc2: number;
}

export interface WardrobeEdgeLine {
  type: WardrobeEdgeType;
  lengthM: number;
  rate: number;
  cost: number;
}

export interface WardrobeEdgeGeometryLine {
  id: string;
  category: "body" | "shelf" | "facade";
  widthMm: number;
  heightMm: number;
  type: WardrobeEdgeType;
  lengthM: number;
}

export interface WardrobeEdgePlan {
  geometry: WardrobeEdgeGeometryLine[];
  lines: WardrobeEdgeLine[];
  totalLengthM: number;
  totalCost: number;
}

function perimeterM(widthMm: number, heightMm: number): number {
  return (2 * (Math.max(0, widthMm) + Math.max(0, heightMm))) / 1000;
}

export function wardrobeEdgeGeometry(
  config: WardrobeConfig,
  geometry: WardrobeGeometry = wardrobeGeometry(config),
  facade: WardrobeFacadeGeometry = wardrobeFacadeGeometry(config, geometry),
): WardrobeEdgeGeometryLine[] {
  const result: WardrobeEdgeGeometryLine[] = [];

  // Корпусные панели: все торцы, ПВХ 1 мм.
  for (const part of geometry.parts) {
    result.push({
      id: `body:${part.id}`,
      category: "body",
      widthMm: part.widthMm,
      heightMm: part.heightMm,
      type: "pvc1",
      lengthM: perimeterM(part.widthMm, part.heightMm),
    });
  }

  // Полки: каждая физическая полка, ПВХ 0,4 мм.
  config.sections.forEach((section, index) => {
    const sectionGeometry = geometry.sections[index];
    if (!sectionGeometry) return;
    for (let shelf = 0; shelf < section.shelves.length; shelf += 1) {
      result.push({
        id: `shelf:${section.id}:${shelf}`,
        category: "shelf",
        widthMm: sectionGeometry.innerWidthMm,
        heightMm: geometry.bodyDepthMm,
        type: "pvc04",
        lengthM: perimeterM(sectionGeometry.innerWidthMm, geometry.bodyDepthMm),
      });
    }
  });

  // Фасады ЛДСП: ПВХ 2 мм. МДФ ПВХ — без дополнительной кромки.
  if (config.facadeMaterial === "ldsp") {
    for (const door of facade.panels) {
      result.push({
        id: `facade:${door.id}`,
        category: "facade",
        widthMm: door.widthMm,
        heightMm: door.heightMm,
        type: "pvc2",
        lengthM: perimeterM(door.widthMm, door.heightMm),
      });
    }
  }

  return result;
}

export function wardrobeEdgePlan(
  config: WardrobeConfig,
  rates: WardrobeEdgeRates,
  geometry: WardrobeGeometry = wardrobeGeometry(config),
  facade: WardrobeFacadeGeometry = wardrobeFacadeGeometry(config, geometry),
): WardrobeEdgePlan {
  const geometryLines = wardrobeEdgeGeometry(config, geometry, facade);
  const byType: Record<WardrobeEdgeType, number> = {
    pvc04: 0,
    pvc1: 0,
    pvc2: 0,
  };
  for (const line of geometryLines) byType[line.type] += line.lengthM;
  const lines: WardrobeEdgeLine[] = (Object.keys(byType) as WardrobeEdgeType[])
    .filter((type) => byType[type] > 0)
    .map((type) => {
      const rate = type === "pvc04" ? rates.pvc04 : type === "pvc1" ? rates.pvc1 : rates.pvc2;
      return { type, lengthM: byType[type], rate, cost: byType[type] * rate };
    });
  return {
    geometry: geometryLines,
    lines,
    totalLengthM: geometryLines.reduce((sum, line) => sum + line.lengthM, 0),
    totalCost: lines.reduce((sum, line) => sum + line.cost, 0),
  };
}
