import { describe, expect, it } from "vitest";

import { defaultWardrobe } from "./defaults";
import { calculatePrice } from "./pricing";
import { validateWardrobe } from "./validation";
import {
  wardrobeBodyAreaSqm,
  wardrobeMinWidthMm,
  wardrobeGeometry,
  wardrobeSectionWidths,
} from "./wardrobe-geometry";
import type { WardrobeConfig } from "./types";

function config(overrides: Partial<WardrobeConfig> = {}): WardrobeConfig {
  return { ...defaultWardrobe(), ...overrides };
}

describe("этап 2: геометрия корпуса шкафа", () => {
  it("D_body учитывает фасад и ХДФ для 16/19/22 мм", () => {
    expect(wardrobeGeometry(config({ fullDepth: 600, facadeThickness: 16 })).bodyDepthMm).toBe(581);
    expect(wardrobeGeometry(config({ fullDepth: 600, facadeThickness: 19 })).bodyDepthMm).toBe(578);
    expect(wardrobeGeometry(config({ fullDepth: 600, facadeThickness: 22 })).bodyDepthMm).toBe(575);
  });

  it("D_body не вычитает фасад/ХДФ дважды", () => {
    const geometry = wardrobeGeometry(
      config({ fullDepth: 600, facadeThickness: 19 }),
    );
    expect(geometry.bodyDepthMm).toBe(578);
    expect(geometry.bodyDepthMm).not.toBe(600 - 19 - 3 - 19 - 3);
  });

  it("ширины секций выводятся из положения перегородки", () => {
    const left = wardrobeSectionWidths(2400, { positionMm: 800 });
    const right = wardrobeSectionWidths(2400, { positionMm: 1600 });
    expect(left[0]!.outerWidthMm).toBe(792);
    expect(left[1]!.outerWidthMm).toBe(1592);
    expect(right[0]!.outerWidthMm).toBe(1592);
    expect(right[1]!.outerWidthMm).toBe(792);
    expect(left[0]!.innerWidthMm).toBe(776);
    expect(left[1]!.innerWidthMm).toBe(1576);
  });


  it("минимальная ширина для 1–4 секций по формуле", () => {
    expect([1, 2, 3, 4].map(wardrobeMinWidthMm)).toEqual([332, 648, 964, 1280]);
  });

  it("границы положения перегородки дают ровно 300 мм чистой ширины", () => {
    const left = wardrobeSectionWidths(2400, { positionMm: 324 });
    const right = wardrobeSectionWidths(2400, { positionMm: 2400 - 324 });
    expect(left[0]!.innerWidthMm).toBe(300);
    expect(right[1]!.innerWidthMm).toBe(300);
  });

  it("сумма секций и перегородки сохраняет общую ширину", () => {
    const geometry = wardrobeGeometry(config({ widthMm: 2400, partition: { positionMm: 1000 } }));
    const [first, second] = geometry.sections;
    expect(first!.widthMm + second!.widthMm + 16).toBe(2400);
  });

  it("изменение положения перегородки не меняет общую ширину", () => {
    const a = wardrobeGeometry(config({ widthMm: 2400, partition: { positionMm: 1000 } }));
    const b = wardrobeGeometry(config({ widthMm: 2400, partition: { positionMm: 1400 } }));
    expect(a.widthMm).toBe(b.widthMm);
    expect(a.sections[0]!.widthMm).not.toBe(b.sections[0]!.widthMm);
  });

  it("положение меньше 300 мм блокируется", () => {
    const issues = validateWardrobe(
      config({ widthMm: 2400, partition: { positionMm: 200 } }),
    );
    expect(issues.some((issue) => issue.path === "partition.positionMm")).toBe(true);
  });

  it("антресоль не создаёт второй комплект боковин", () => {
    const without = wardrobeGeometry(config());
    const withAntresol = wardrobeGeometry(
      config({ antresol: { heightMm: 400 } }),
    );
    expect(without.parts.filter((part) => part.id.startsWith("side-"))).toHaveLength(2);
    expect(withAntresol.parts.filter((part) => part.id.startsWith("side-"))).toHaveLength(2);
    expect(withAntresol.parts.some((part) => part.id === "antresol-divider")).toBe(true);
    const divider = withAntresol.parts.find((part) => part.id === "antresol-divider");
    expect(divider?.depthMm).toBe(16);
  });

  it("высота антресоли меняет основную зону, но не общую высоту", () => {
    const low = wardrobeGeometry(config({ antresol: { heightMm: 300 } }));
    const high = wardrobeGeometry(config({ antresol: { heightMm: 500 } }));
    expect(low.heightMm).toBe(high.heightMm);
    expect(low.antresol!.mainHeightMm).toBeGreaterThan(high.antresol!.mainHeightMm);
    expect(high.antresol!.mainHeightMm).toBe(low.antresol!.mainHeightMm - 200);
    // 2400 − 400 − 16 (разделитель) − 80 (цоколь) − 16 (дно).
    expect(low.antresol!.mainHeightMm).toBe(1988);
  });

  it("площадь корпуса зависит от глубины и не использует bodyFactor", () => {
    const shallow = wardrobeGeometry(config({ fullDepth: 500 }));
    const deep = wardrobeGeometry(config({ fullDepth: 600 }));
    expect(wardrobeBodyAreaSqm(deep)).toBeGreaterThan(wardrobeBodyAreaSqm(shallow));
    expect(calculatePrice(config({ fullDepth: 600 })).bodyCost).toBe(
      Math.round(wardrobeBodyAreaSqm(deep) * 5200),
    );
  });
});
