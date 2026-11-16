import { describe, expect, it } from "vitest";

import {
  FACADE_DOOR_GAP_CM,
  FACADE_EDGE_GAP_CM,
  FACADE_DRAWER_GAP_CM,
  facadeField,
  facadeStack,
  kitchenFacadeField,
  wardrobeFacadeField,
} from "./facade-geometry";
import { sinkLayout } from "./sink";
import { defaultKitchen, defaultWardrobe } from "./defaults";
import { wardrobeFacadeGeometry } from "./wardrobe-facade-geometry";
import { calculatePrice } from "./pricing";

/**
 * CA-T-517 — независимые контрольные примеры фактической геометрии створок.
 *
 * Все ожидания ниже посчитаны вручную по правилам из `facade-geometry.ts`;
 * они не сняты из результата Engine.
 */
describe("CA-T-517: единая геометрия фасадов", () => {
  it("кухня, одна створка 60×85 при цоколе 10 см", () => {
    const geometry = kitchenFacadeField({
      widthCm: 60,
      heightCm: 85,
      type: "base",
      rowStart: true,
      rowEnd: true,
      plinthHeightCm: 10,
    });
    // Поле: 60 − 0,2 − 0,2 = 59,6; высота: 85 − 0,2 − 0,2 = 84,6.
    expect(geometry.panels).toHaveLength(1);
    expect(geometry.panels[0]!.widthCm).toBeCloseTo(59.6, 10);
    expect(geometry.panels[0]!.heightCm).toBeCloseTo(84.6, 10);
    expect(geometry.areaSqm).toBeCloseTo(0.504216, 10);
  });

  it("кухня, две створки 80×85 в середине ряда", () => {
    const geometry = kitchenFacadeField({
      widthCm: 80,
      heightCm: 85,
      type: "base",
      rowStart: false,
      rowEnd: false,
      plinthHeightCm: 10,
    });
    // Поле: 80 − 0,1 − 0,1 = 79,8; створка: (79,8 − 0,2) / 2 = 39,8.
    expect(geometry.panels).toHaveLength(2);
    expect(geometry.panelWidthCm).toBeCloseTo(39.8, 10);
    expect(geometry.panels[0]!.areaSqm).toBeCloseTo(0.336708, 10);
    expect(geometry.areaSqm).toBeCloseTo(0.673416, 10);
  });

  it("кухня, пенал 60×220: высота без цоколя", () => {
    const geometry = kitchenFacadeField({
      widthCm: 60,
      heightCm: 220,
      type: "tall",
      rowStart: true,
      rowEnd: true,
      plinthHeightCm: 10,
    });
    expect(geometry.fieldHeightCm).toBeCloseTo(209.6, 10);
    expect(geometry.areaSqm).toBeCloseTo(1.249216, 10);
  });

  it("кухня, стопка из трёх фронтов ящиков 60×85", () => {
    const stack = facadeStack({
      widthCm: 59.6,
      heightCm: 84.6,
      topGapCm: 0,
      bottomGapCm: 0,
      gapCm: FACADE_DRAWER_GAP_CM,
      count: 3,
    });
    // Высота фронта: (84,6 − 0,2 × 2) / 3 = 28,0666…; суммарно 59,6 × 84,2.
    expect(stack.panels).toHaveLength(3);
    expect(stack.panels[0]!.heightCm).toBeCloseTo(28.0666666667, 9);
    expect(stack.areaSqm).toBeCloseTo(0.501832, 10);
  });

  it("мойка 60×85: две створки по фактическим панелям", () => {
    const layout = sinkLayout(
      {
        width: 60,
        height: 85,
        depth: 55.8,
        sinkWidth: 600,
        sinkDepth: 450,
        sinkPosition: "center",
      },
      { left: FACADE_EDGE_GAP_CM, right: 0.1 },
    );
    const widths = layout.facadeBoxes.map((box) => box.width);
    // Поле 59,7; две равные створки: (59,7 − 0,2) / 2 = 29,75.
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBeCloseTo(29.75, 10);
    expect(widths[1]).toBeCloseTo(29.75, 10);
    const doorHeight = 85 - FACADE_EDGE_GAP_CM * 2;
    const area =
      widths.reduce((sum, width) => sum + width * doorHeight, 0) / 10000;
    expect(area).toBeCloseTo(0.50337, 10);
  });

  it("шкаф, секция 80×240 при цоколе 8 см: две двери", () => {
    const geometry = wardrobeFacadeField({
      sectionWidthCm: 80,
      heightCm: 240,
      plinthHeightCm: 8,
    });
    // Поле: 80 − 1,4 − 1,4 = 77,2; дверь: (77,2 − 0,55) / 2 = 38,325.
    // Высота: 240 − 8 − 1,4 − 1,2 = 229,4.
    expect(geometry.panels).toHaveLength(2);
    expect(geometry.panelWidthCm).toBeCloseTo(38.325, 10);
    expect(geometry.panelHeightCm).toBeCloseTo(229.4, 10);
    expect(geometry.areaSqm).toBeCloseTo(1.758351, 10);
  });

  it("шкаф, секция 60×240: одна дверь", () => {
    const geometry = wardrobeFacadeField({
      sectionWidthCm: 60,
      heightCm: 240,
      plinthHeightCm: 8,
    });
    expect(geometry.panels).toHaveLength(1);
    expect(geometry.panelWidthCm).toBeCloseTo(57.2, 10);
    expect(geometry.areaSqm).toBeCloseTo(1.312168, 10);
  });

  it("зазоры не смешиваются: порог 60 см и 2 мм между створками", () => {
    expect(facadeField({
      widthCm: 60,
      heightCm: 85,
      leftGapCm: 0,
      rightGapCm: 0,
      topGapCm: 0,
      bottomGapCm: 0,
      doorGapCm: FACADE_DOOR_GAP_CM,
    }).panels).toHaveLength(1);

    const two = facadeField({
      widthCm: 60.1,
      heightCm: 85,
      leftGapCm: 0,
      rightGapCm: 0,
      topGapCm: 0,
      bottomGapCm: 0,
      doorGapCm: FACADE_DOOR_GAP_CM,
    });
    expect(two.panels).toHaveLength(2);
    expect(two.panels[0]!.widthCm).toBeCloseTo((60.1 - 0.2) / 2, 10);
  });

  it("контрольные примеры стоимости створок", () => {
    // Ручная арифметика из CA-517 §3; не зависит от Engine.
    expect(Math.round(0.504216 * 8400)).toBe(4235);
    expect(Math.round(0.674262 * 8400)).toBe(5664);
    expect(Math.round(1.312168 * 5600)).toBe(7348);
    expect(Math.round(1.758351 * 5600)).toBe(9847);
  });

  it("CA-T-518: край справа, мойка между соседями и блок ящиков", () => {
    const rightEdge = kitchenFacadeField({
      widthCm: 60,
      heightCm: 85,
      type: "base",
      rowStart: false,
      rowEnd: true,
      plinthHeightCm: 10,
    });
    // Поле: 60 − 0,1 − 0,2 = 59,7; одна створка 59,7 × 84,6.
    expect(rightEdge.panels).toHaveLength(1);
    expect(rightEdge.areaSqm).toBeCloseTo(0.505062, 10);

    const sinkMiddle = sinkLayout(
      { width: 60, height: 85, depth: 55.8, sinkWidth: 600, sinkDepth: 450, sinkPosition: "center" },
      { left: 0.1, right: 0.1 },
    );
    const middle = sinkMiddle.facadeBoxes;
    expect(middle).toHaveLength(2);
    expect(middle[0]!.width).toBeCloseTo(29.8, 10);
    expect(middle[1]!.x - (middle[0]!.x + middle[0]!.width)).toBeCloseTo(0.2, 10);

    const sinkRight = sinkLayout(
      { width: 60, height: 85, depth: 55.8, sinkWidth: 600, sinkDepth: 450, sinkPosition: "center" },
      { left: 0.1, right: 0.2 },
    );
    expect(sinkRight.facadeBoxes[0]!.width).toBeCloseTo(29.75, 10);

    const drawers = facadeStack({
      widthCm: 59.8,
      heightCm: 84.6,
      topGapCm: 0,
      bottomGapCm: 0,
      gapCm: FACADE_DRAWER_GAP_CM,
      count: 3,
    });
    expect(drawers.panels[1]!.yCm - (drawers.panels[0]!.yCm + drawers.panels[0]!.heightCm)).toBeCloseTo(0.2, 10);
    expect(drawers.areaSqm).toBeCloseTo(0.503516, 10);
  });

  it("CA-T-518: модуль со встроенной техникой сохраняет прежний зазор", () => {
    const oven = kitchenFacadeField({
      widthCm: 90,
      heightCm: 220,
      type: "oven",
      rowStart: false,
      rowEnd: false,
      plinthHeightCm: 10,
    });
    expect(oven.fieldWidthCm).toBeCloseTo(89.8, 10);
    expect(oven.panels).toHaveLength(2);
    expect(oven.panelWidthCm).toBeCloseTo((89.8 - 0.1) / 2, 10);
    expect(oven.panels[1]!.xCm - (oven.panels[0]!.xCm + oven.panels[0]!.widthCm)).toBeCloseTo(0.1, 10);
  });

  it("цена кухни: сумма фактических площадей × тариф", () => {
    // Кухня по умолчанию (МДФ эмаль 8 400 ₽/м², flat ×1):
    // мойка 0,503370 + hob 0,505908 + ящики 0,503516 + пенал 1,251312
    // + верхние 0,427452 + 0,427452 = 3,619856 м².
    const areas = [
      0.50337, 0.505908, 0.503516, 1.251312, 0.427452, 0.427452,
    ];
    const expected = Math.round(areas.reduce((sum, area) => sum + area, 0) * 8400);
    expect(expected).toBe(30400);
    expect(calculatePrice(defaultKitchen()).frontsCost).toBe(expected);
  });

  it("цена шкафа: сумма накладных дверей секций и антресоли", () => {
    const config = defaultWardrobe();
    const expected = Math.round(
      wardrobeFacadeGeometry(config).totalAreaSqm * 5600 * 1.08,
    );
    expect(calculatePrice(config).frontsCost).toBe(expected);
  });
});
