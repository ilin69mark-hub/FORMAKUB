import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { KitchenScene } from "@/components/configurator/KitchenScene";
import { KITCHEN_MODULES } from "@/content/catalog";
import { defaultKitchen, makeKitchenModule } from "@/lib/configurator/defaults";
import {
  KITCHEN_BACK_PANEL_THICKNESS_CM,
  KITCHEN_BACK_PANEL_THICKNESS_MM,
  kitchenFullDepthCm,
  kitchenLowerTotalHeightCm,
} from "./geometry";
import { furnitureConfigSchema } from "./schema";
import type { KitchenConfig } from "./types";
import { validateConfig } from "./validation";

function config(overrides: { height?: number; depth?: number; plinthHeight?: number } = {}): KitchenConfig {
  const base = defaultKitchen();
  return {
    ...base,
    plinth: true,
    plinthHeight: overrides.plinthHeight ?? 10,
    countertopThickness: 26,
    modules: [
      makeKitchenModule("base", {
        id: "m-base",
        width: 80,
        height: overrides.height ?? 70,
        depth: overrides.depth ?? 55.8,
        shelves: 1,
      }),
      makeKitchenModule("wall", { id: "m-wall", width: 80 }),
    ],
  };
}

function parsedConfig(overrides: Parameters<typeof config>[0] = {}) {
  const parsed = furnitureConfigSchema.safeParse(config(overrides));
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

function sceneHtml(overrides: Parameters<typeof config>[0] = {}): string {
  return renderToStaticMarkup(
    React.createElement(KitchenScene, {
      config: config(overrides),
      showDimensions: true,
    }),
  );
}

describe("нижняя геометрия: утверждённые диапазоны", () => {
  it("принимает глубину корпуса 40 и динамический максимум 55,8 см", () => {
    for (const depth of [40, 55.8]) {
      expect(validateConfig(parsedConfig({ depth }))).toEqual([]);
    }
  });

  it("отклоняет глубину вне 40–55,8 см для фасада 19 мм", () => {
    for (const depth of [39, 55.9]) {
      expect(
        validateConfig(parsedConfig({ depth })).some(
          (issue) => issue.severity === "error" && issue.message.includes("Глубина"),
        ),
      ).toBe(true);
    }
  });

  it("принимает высоту корпуса 700 и 850 мм", () => {
    for (const height of [70, 85]) {
      expect(validateConfig(parsedConfig({ height }))).toEqual([]);
    }
  });

  it("отклоняет высоту корпуса вне 700–850 мм", () => {
    for (const height of [69, 86]) {
      expect(
        validateConfig(parsedConfig({ height })).some(
          (issue) => issue.severity === "error" && issue.message.includes("Высота"),
        ),
      ).toBe(true);
    }
  });

  it("принимает высоту цоколя 100 и 150 мм", () => {
    for (const plinthHeight of [10, 15]) {
      expect(furnitureConfigSchema.safeParse(config({ plinthHeight })).success).toBe(true);
    }
  });

  it("отклоняет высоту цоколя вне 100–150 мм схемой", () => {
    for (const plinthHeight of [9, 16]) {
      expect(furnitureConfigSchema.safeParse(config({ plinthHeight })).success).toBe(false);
    }
  });

  it("все нижние модули имеют абсолютные границы 400–580 мм", () => {
    for (const type of ["base", "sink", "hob", "drawers", "bottle"] as const) {
      expect(KITCHEN_MODULES[type]).toMatchObject({
        minDepth: 40,
        maxDepth: 58,
      });
    }
  });

  it("tall/oven сохраняют прежнюю глубину 550–600 мм", () => {
    for (const type of ["tall", "oven"] as const) {
      expect(KITCHEN_MODULES[type]).toMatchObject({
        minDepth: 55,
        maxDepth: 60,
        defaultDepth: 60,
      });
    }
  });

  it("ХДФ 3 мм добавляется к глубине корпуса отдельно", () => {
    expect(KITCHEN_BACK_PANEL_THICKNESS_MM).toBe(3);
    expect(KITCHEN_BACK_PANEL_THICKNESS_CM).toBe(0.3);
    expect(kitchenFullDepthCm(55.8, 19)).toBeCloseTo(58, 10);
    expect(kitchenFullDepthCm(40, 16)).toBeCloseTo(41.9, 10);

    // Полная глубина с ХДФ и фасадом не должна попадать в глубину корпуса.
    expect(
      validateConfig(parsedConfig({ depth: 55.9 })).some(
        (issue) => issue.severity === "error" && issue.message.includes("Глубина"),
      ),
    ).toBe(true);
  });
});

describe("нижняя геометрия: независимость и итоговая высота", () => {
  it("высота корпуса и цоколь независимы", () => {
    const a = config({ height: 70, plinthHeight: 10 });
    const b = config({ height: 70, plinthHeight: 15 });
    const c = config({ height: 85, plinthHeight: 15 });

    const heightOf = (value: KitchenConfig) =>
      value.modules.find((module) => module.id === "m-base")?.height;

    expect(heightOf(a)).toBe(70);
    expect(heightOf(b)).toBe(70);
    expect(heightOf(c)).toBe(85);
    expect(a.plinthHeight).toBe(10);
    expect(b.plinthHeight).toBe(15);
    expect(c.plinthHeight).toBe(15);
  });

  it("общая высота нижней части = корпус + цоколь + столешница", () => {
    expect(kitchenLowerTotalHeightCm(config({ height: 70, plinthHeight: 15 }))).toBeCloseTo(
      70 + 15 + 2.6,
      6,
    );
    expect(kitchenLowerTotalHeightCm(config({ height: 85, plinthHeight: 10 }))).toBeCloseTo(
      85 + 10 + 2.6,
      6,
    );
  });

  it("2D-сцена отражает независимые высоты корпуса и цоколя", () => {
    const low = sceneHtml({ height: 70, plinthHeight: 10 });
    const highPlinth = sceneHtml({ height: 70, plinthHeight: 15 });
    const highBody = sceneHtml({ height: 85, plinthHeight: 15 });

    // contentTop = lowerHeight + wall gap 56 + wall 72; labels are rounded.
    expect(low).toContain("211 см");
    expect(highPlinth).toContain("216 см");
    expect(highBody).toContain("231 см");
  });
});
