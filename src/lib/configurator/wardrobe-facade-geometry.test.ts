import { describe, expect, it } from "vitest";

import { defaultWardrobe } from "./defaults";
import { calculatePrice } from "./pricing";
import { validateWardrobe } from "./validation";
import {
  wardrobeFacadeGeometry,
  WARDROBE_FACADE_GAP_MM,
} from "./wardrobe-facade-geometry";
import type { WardrobeConfig } from "./types";

function config(overrides: Partial<WardrobeConfig> = {}): WardrobeConfig {
  return { ...defaultWardrobe(), ...overrides };
}

describe("этап 3: накладные фасады шкафа", () => {
  it("одна секция: одна дверь с зазорами 2 мм", () => {
    const facade = wardrobeFacadeGeometry(
      config({ widthMm: 1200, partition: null, sections: [{ id: "s-1", shelves: [], rods: [], drawers: 0 }] }),
    );
    expect(facade.panels).toHaveLength(1);
    const door = facade.panels[0]!;
    expect(door.xMm).toBe(2);
    expect(door.yMm).toBe(2);
    expect(door.widthMm).toBe(1196);
    expect(door.heightMm).toBe(2316);
    expect(door.areaSqm).toBeCloseTo(2.769936, 9);
  });

  it("две секции: по одной двери, центральный зазор 2 мм", () => {
    const facade = wardrobeFacadeGeometry(config());
    expect(facade.panels).toHaveLength(2);
    const [left, right] = facade.panels;
    expect(left!.xMm).toBe(2);
    expect(left!.widthMm).toBe(1197);
    expect(right!.xMm).toBe(1201);
    expect(right!.widthMm).toBe(1197);
    expect(left!.xMm + left!.widthMm + 2).toBe(right!.xMm);
    expect(right!.xMm + right!.widthMm + 2).toBe(2400);
    expect(left!.areaSqm).toBeCloseTo(2.772252, 9);
  });

  it("верхний и нижний зазоры одинаковы для всех секций", () => {
    const facade = wardrobeFacadeGeometry(config());
    for (const door of facade.panels) {
      expect(door.yMm).toBe(2);
      expect(door.yMm + door.heightMm).toBe(2400 - 80 - 2);
    }
  });

  it("антресоль: отдельная дверь, изменение высоты меняет обе зоны", () => {
    const low = wardrobeFacadeGeometry(config({ antresol: { heightMm: 400 } }));
    const high = wardrobeFacadeGeometry(config({ antresol: { heightMm: 500 } }));
    expect(low.panels).toHaveLength(3);
    expect(low.antresolPanel).not.toBeNull();
    expect(low.antresolPanel!.widthMm).toBe(2396);
    expect(low.antresolPanel!.heightMm).toBe(405);
    expect(low.mainPanels[0]!.heightMm).toBe(1909);
    expect(high.mainPanels[0]!.heightMm).toBe(1809);
    expect(high.antresolPanel!.heightMm).toBe(505);
    expect(
      low.antresolPanel!.yMm + low.antresolPanel!.heightMm + 2,
    ).toBe(low.mainPanels[0]!.yMm);
  });

  it("толщина фасада не меняет геометрию дверей", () => {
    const areas = [16, 19, 22].map(
      (thickness) =>
        wardrobeFacadeGeometry(
          config({ facadeThickness: thickness as 16 | 19 | 22 }),
        ).totalAreaSqm,
    );
    expect(areas[1]).toBeCloseTo(areas[0]!, 12);
    expect(areas[2]).toBeCloseTo(areas[0]!, 12);
  });

  it("стоимость фасадов считается по фактической площади всех дверей", () => {
    const base = config();
    const facade = wardrobeFacadeGeometry(base);
    const price = calculatePrice(base);
    expect(price.frontsCost).toBe(
      Math.round(facade.totalAreaSqm * 5600 * 1.08),
    );
  });

  it("зазоры не вычитаются повторно", () => {
    const facade = wardrobeFacadeGeometry(config());
    const totalWidth = facade.panels.reduce((sum, door) => sum + door.widthMm, 0);
    expect(totalWidth + WARDROBE_FACADE_GAP_MM * 3).toBe(2400);
  });

  it("минимальная/максимальная высота антресоли ограничена", () => {
    const zero = config({ antresol: { heightMm: 0 } });
    const tooHigh = config({ antresol: { heightMm: 2400 } });
    expect(validateWardrobe(zero).some((issue) => issue.path === "antresol.heightMm")).toBe(true);
    expect(validateWardrobe(tooHigh).some((issue) => issue.path === "antresol.heightMm")).toBe(true);
    const facade = wardrobeFacadeGeometry(config({ antresol: { heightMm: 400 } }));
    expect(facade.mainPanels.every((panel) => panel.heightMm > 0)).toBe(true);
    expect(facade.antresolPanel!.heightMm).toBeGreaterThan(0);
  });

  it("материал влияет на стоимость, но не на геометрию дверей", () => {
    const ldsp = config({ facadeMaterial: "ldsp", facadeThickness: 16 });
    const pvc = config({ facadeMaterial: "mdf_pvc", facadeThickness: 19 });
    expect(wardrobeFacadeGeometry(ldsp).totalAreaSqm).toBeCloseTo(
      wardrobeFacadeGeometry(pvc).totalAreaSqm,
      12,
    );
    expect(calculatePrice(pvc).frontsCost).toBeGreaterThan(
      calculatePrice(ldsp).frontsCost,
    );
  });
});
