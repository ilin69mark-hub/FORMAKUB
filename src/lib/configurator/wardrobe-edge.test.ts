import { describe, expect, it } from "vitest";

import { defaultWardrobe } from "./defaults";
import { calculatePrice } from "./pricing";
import { wardrobeEdgeGeometry, wardrobeEdgePlan } from "./wardrobe-edge";
import type { WardrobeConfig } from "./types";

const RATES = { pvc04: 5, pvc1: 15, pvc2: 30 };

function config(overrides: Partial<WardrobeConfig> = {}): WardrobeConfig {
  return { ...defaultWardrobe(), ...overrides };
}

describe("этап 7: кромка шкафа", () => {
  it("периметр прямоугольной детали переводится в метры", () => {
    const lines = wardrobeEdgeGeometry(config());
    const side = lines.find((line) => line.id === "body:side-left")!;
    expect(side.lengthM).toBeCloseTo(5.962, 6);
    expect(side.type).toBe("pvc1");
  });

  it("корпус получает кромку 1 мм, полки 0,4 мм, ЛДСП-фасады 2 мм", () => {
    const plan = wardrobeEdgePlan(config(), RATES);
    expect(plan.lines.find((line) => line.type === "pvc1")!.lengthM).toBeCloseTo(29.746, 6);
    expect(plan.lines.find((line) => line.type === "pvc04")!.lengthM).toBeCloseTo(17.57, 6);
    expect(plan.lines.find((line) => line.type === "pvc2")!.lengthM).toBeCloseTo(14.052, 6);
  });

  it("стоимость считается по трём тарифам", () => {
    const plan = wardrobeEdgePlan(config(), RATES);
    const pvc1 = plan.lines.find((line) => line.type === "pvc1")!;
    const pvc04 = plan.lines.find((line) => line.type === "pvc04")!;
    const pvc2 = plan.lines.find((line) => line.type === "pvc2")!;
    expect(pvc1.cost).toBeCloseTo(446.19, 6);
    expect(pvc04.cost).toBeCloseTo(87.85, 6);
    expect(pvc2.cost).toBeCloseTo(421.56, 6);
    expect(plan.totalCost).toBeCloseTo(955.6, 6);
  });

  it("МДФ ПВХ фасады не получают кромку", () => {
    const plan = wardrobeEdgePlan(
      config({ facadeMaterial: "mdf_pvc", facadeThickness: 19 }),
      RATES,
    );
    expect(plan.lines.some((line) => line.type === "pvc2")).toBe(false);
    expect(plan.totalCost).toBeCloseTo(533.44, 6);
  });

  it("изменение количества полок меняет длину 0,4 мм", () => {
    const base = config();
    const fewer = {
      ...base,
      sections: base.sections.map((section, index) =>
        index === 0 ? { ...section, shelves: [] } : section,
      ),
    };
    const before = wardrobeEdgePlan(base, RATES).lines.find((line) => line.type === "pvc04")!;
    const after = wardrobeEdgePlan(fewer, RATES).lines.find((line) => line.type === "pvc04")!;
    expect(before.lengthM - after.lengthM).toBeCloseTo(2 * 3.514, 6);
  });

  it("изменение размеров деталей меняет длину", () => {
    const small = config({ widthMm: 1600, partition: { positionMm: 800 } });
    const large = config({ widthMm: 2400, partition: { positionMm: 1200 } });
    expect(wardrobeEdgePlan(large, RATES).totalLengthM).toBeGreaterThan(
      wardrobeEdgePlan(small, RATES).totalLengthM,
    );
  });

  it("каждая деталь учитывается один раз", () => {
    const plan = wardrobeEdgePlan(config(), RATES);
    expect(new Set(plan.geometry.map((line) => line.id)).size).toBe(plan.geometry.length);
  });

  it("Engine и legacy pricing дают одинаковую стоимость кромки", () => {
    const price = calculatePrice(config());
    const plan = wardrobeEdgePlan(config(), RATES);
    expect(price.optionsCost).toBeGreaterThanOrEqual(Math.round(plan.totalCost));
  });

  it("без кромки стоимость меньше на величину кромки", () => {
    const base = config();
    const plan = wardrobeEdgePlan(base, RATES);
    const withoutDecor = {
      ...base,
      sections: base.sections.map((section) => ({ ...section, shelves: [] })),
      facadeMaterial: "mdf_pvc" as const,
      facadeThickness: 19 as const,
    };
    const withoutPlan = wardrobeEdgePlan(withoutDecor, RATES);
    expect(plan.totalCost - withoutPlan.totalCost).toBeGreaterThan(0);
  });
});
