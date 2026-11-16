import { describe, expect, it } from "vitest";

import {
  DEFAULT_FACADE_THICKNESS_MM,
  FACADE_MATERIALS,
  defaultFacadeThickness,
  facadeThicknesses,
  snapFacadeThickness,
} from "@/content/catalog";
import {
  defaultKitchen,
  makeKitchenModule,
  normalizeKitchen,
  withKitchenFacadeThickness,
} from "@/lib/configurator/defaults";
import {
  KITCHEN_COUNTERTOP_DEPTH_MM,
  KITCHEN_MAX_FULL_DEPTH_MM,
  KITCHEN_MIN_BODY_DEPTH_MM,
  KITCHEN_MIN_COUNTERTOP_OVERHANG_MM,
  kitchenCountertopOverhangMm,
  kitchenFullDepthMm,
  kitchenMaxBodyDepthCm,
  kitchenMaxBodyDepthMm,
} from "./geometry";
import { furnitureConfigSchema } from "./schema";
import type { KitchenConfig } from "./types";
import { validateConfig } from "./validation";

const FACADE_CASES = [
  { material: "ldsp", thickness: 16 },
  { material: "ldsp", thickness: 18 },
  { material: "mdf", thickness: 16 },
  { material: "mdf", thickness: 19 },
  { material: "mdf", thickness: 22 },
] as const;

function config(overrides: {
  material?: "ldsp" | "mdf";
  thickness?: number;
  depth?: number;
} = {}): KitchenConfig {
  const base = defaultKitchen();
  return {
    ...base,
    facadeMaterial: overrides.material ?? "mdf",
    facadeThickness: overrides.thickness ?? 19,
    modules: [
      makeKitchenModule("base", {
        id: "m-base",
        width: 80,
        height: 80,
        depth: overrides.depth ?? 55.8,
        shelves: 1,
      }),
      makeKitchenModule("wall", { id: "m-wall", width: 80 }),
    ],
  };
}

function parsed(value: KitchenConfig) {
  const result = furnitureConfigSchema.safeParse(value);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

describe("CA-T-513: динамический максимум глубины", () => {
  it("утверждённые толщины заданы только для ЛДСП и МДФ", () => {
    expect(facadeThicknesses("ldsp")).toEqual([16, 18]);
    expect(facadeThicknesses("mdf")).toEqual([16, 19, 22]);
    expect(facadeThicknesses("mdf_pvc")).toEqual([16, 19, 22]);
    for (const legacy of ["veneer", "glass", "solid"] as const) {
      expect(facadeThicknesses(legacy)).toEqual([]);
    }
    for (const material of FACADE_MATERIALS) {
      expect(material.thicknesses).toBeDefined();
    }
  });

  it("maxBodyDepth = 580 − 3 − толщина фасада", () => {
    const expected: Record<string, number> = {
      "16": 561,
      "18": 559,
      "19": 558,
      "22": 555,
    };
    for (const item of FACADE_CASES) {
      expect(kitchenMaxBodyDepthMm(item.thickness)).toBe(
        expected[String(item.thickness)],
      );
      expect(kitchenMaxBodyDepthCm(item.thickness)).toBeCloseTo(
        expected[String(item.thickness)] / 10,
        10,
      );
      expect(kitchenFullDepthMm(kitchenMaxBodyDepthCm(item.thickness), item.thickness)).toBe(
        KITCHEN_MAX_FULL_DEPTH_MM,
      );
    }
  });

  it("принимает минимум 400 мм и максимум для всех пяти толщин", () => {
    for (const item of FACADE_CASES) {
      const max = kitchenMaxBodyDepthCm(item.thickness);
      for (const depth of [KITCHEN_MIN_BODY_DEPTH_MM / 10, max]) {
        const issues = validateConfig(
          parsed(config({ material: item.material, thickness: item.thickness, depth })),
        );
        expect(issues).toEqual([]);
      }
    }
  });

  it("отклоняет 399 мм и глубину выше динамического максимума", () => {
    for (const item of FACADE_CASES) {
      const max = kitchenMaxBodyDepthCm(item.thickness);
      for (const depth of [39.9, max + 0.1]) {
        const issues = validateConfig(
          parsed(config({ material: item.material, thickness: item.thickness, depth })),
        );
        expect(
          issues.some(
            (issue) => issue.severity === "error" && issue.message.includes("Глубина"),
          ),
        ).toBe(true);
      }
    }
  });

  it("столешница 600 мм даёт выступ не меньше 20 мм", () => {
    expect(KITCHEN_COUNTERTOP_DEPTH_MM).toBe(600);
    expect(KITCHEN_MIN_COUNTERTOP_OVERHANG_MM).toBe(20);
    for (const item of FACADE_CASES) {
      const max = kitchenMaxBodyDepthCm(item.thickness);
      expect(kitchenCountertopOverhangMm(max, item.thickness)).toBe(20);
      expect(
        kitchenCountertopOverhangMm(max, item.thickness),
      ).toBeGreaterThanOrEqual(KITCHEN_MIN_COUNTERTOP_OVERHANG_MM);
    }
  });

  it("смена толщины фасада уменьшает глубину до допустимой", () => {
    const wide = config({ material: "ldsp", thickness: 16, depth: 56.1 });
    expect(validateConfig(parsed(wide))).toEqual([]);

    const thinFacade = { ...wide, facadeMaterial: "mdf" as const };
    const clamped = withKitchenFacadeThickness(thinFacade, 22);
    const lower = clamped.modules.find((module) => module.id === "m-base");

    expect(clamped.facadeThickness).toBe(22);
    expect(lower?.depth).toBe(55.5);
    expect(validateConfig(parsed(clamped))).toEqual([]);
  });

  it("толщина подбирается к ближайшему допустимому значению материала", () => {
    expect(snapFacadeThickness("ldsp", 19)).toBe(18);
    expect(snapFacadeThickness("ldsp", 17)).toBe(16);
    expect(snapFacadeThickness("mdf", 18)).toBe(19);
    expect(snapFacadeThickness("mdf", 23)).toBe(22);
  });

  it("предлагаемый default: МДФ 19 мм → корпус 55,8 см, полная глубина 58 см", () => {
    expect(defaultFacadeThickness("mdf")).toBe(19);
    expect(DEFAULT_FACADE_THICKNESS_MM).toBe(19);
    expect(kitchenMaxBodyDepthCm(19)).toBeCloseTo(55.8, 10);
    expect(kitchenFullDepthMm(55.8, 19)).toBe(580);
    expect(kitchenCountertopOverhangMm(55.8, 19)).toBe(20);

    const kitchen = defaultKitchen();
    const lower = kitchen.modules.find(
      (module) => module.type !== "tall" && module.type !== "oven",
    );
    expect(kitchen.facadeThickness).toBe(19);
    expect(lower?.depth).toBe(55.8);
  });

  it("нормализация не меняет глубину верхнего ряда", () => {
    const kitchen = config();
    const wall = kitchen.modules.find((module) => module.type === "wall");
    expect(wall?.depth).toBe(35);
    const normalized = normalizeKitchen(kitchen);
    expect(
      normalized.modules.find((module) => module.type === "wall")?.depth,
    ).toBe(35);
  });

  it("старый проект без facadeThickness получает default и нормализуется", () => {
    const raw = { ...config({ material: "ldsp", depth: 56 }) } as Record<string, unknown>;
    delete raw.facadeThickness;
    const result = furnitureConfigSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.kind).toBe("kitchen");
    if (result.data.kind !== "kitchen") return;

    expect(result.data.facadeThickness).toBe(DEFAULT_FACADE_THICKNESS_MM);
    const normalized = normalizeKitchen(result.data);
    expect(normalized.facadeThickness).toBe(18);
    expect(
      normalized.modules.find((module) => module.id === "m-base")?.depth,
    ).toBeLessThanOrEqual(kitchenMaxBodyDepthCm(18));
  });
});
