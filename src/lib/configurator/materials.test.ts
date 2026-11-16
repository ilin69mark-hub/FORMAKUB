import { describe, expect, it } from "vitest";

import {
  BODY_MATERIALS,
  FACADE_MATERIALS,
  LEGACY_FACADE_MATERIALS,
  MDF_FACADE_FINISHES,
  facadeThicknesses,
} from "@/content/catalog";
import { defaultKitchen, defaultWardrobe } from "@/lib/configurator/defaults";
import {
  ACTIVE_FACADE_MATERIAL_IDS,
  FIXED_BODY_MATERIAL_ID,
  FIXED_BODY_THICKNESS_MM,
  isActiveFacadeMaterial,
  isLegacyFacadeMaterial,
} from "@/lib/configurator/materials";
import { furnitureConfigSchema } from "./schema";
import { validateConfig } from "./validation";

describe("CA-T-514: материалы корпуса и фасадов", () => {
  it("корпус фиксирован: только ЛДСП 16 мм", () => {
    expect(FIXED_BODY_MATERIAL_ID).toBe("ldsp");
    expect(FIXED_BODY_THICKNESS_MM).toBe(16);
    expect(BODY_MATERIALS.map((item) => item.id)).toEqual(["ldsp"]);
    expect(BODY_MATERIALS[0]?.ratePerSqm).toBe(5200);
    expect(defaultKitchen().bodyMaterial).toBe("ldsp");
    expect(defaultWardrobe().bodyMaterial).toBe("ldsp");
    expect(defaultWardrobe().facadeMaterial).toBe("ldsp");
    expect(facadeThicknesses(defaultWardrobe().facadeMaterial)).toContain(16);
  });

  it("действующие фасады: ЛДСП, МДФ эмаль, МДФ ПВХ", () => {
    expect(FACADE_MATERIALS.map((item) => item.id)).toEqual([
      "ldsp",
      "mdf",
      "mdf_pvc",
    ]);
    expect(ACTIVE_FACADE_MATERIAL_IDS).toEqual(["ldsp", "mdf", "mdf_pvc"]);
    expect(facadeThicknesses("ldsp")).toEqual([16, 18]);
    expect(facadeThicknesses("mdf")).toEqual([16, 19, 22]);
    expect(facadeThicknesses("mdf_pvc")).toEqual([16, 19, 22]);
  });

  it("CA-516-01: палитры МДФ эмаль и МДФ ПВХ совпадают и используют единый источник", () => {
    const mdf = FACADE_MATERIALS.find((item) => item.id === "mdf");
    const pvc = FACADE_MATERIALS.find((item) => item.id === "mdf_pvc");
    expect(mdf).toBeDefined();
    expect(pvc).toBeDefined();
    if (!mdf || !pvc) return;

    // Один и тот же массив: обновление палитры невозможно развести по материалам.
    expect(mdf.finishes).toBe(MDF_FACADE_FINISHES);
    expect(pvc.finishes).toBe(MDF_FACADE_FINISHES);
    expect(pvc.finishes).toEqual(mdf.finishes);
    expect(pvc.finishes.map((finish) => finish.id)).toEqual(
      mdf.finishes.map((finish) => finish.id),
    );

    // Материалы и тарифы остаются отдельными записями.
    expect(mdf).not.toBe(pvc);
    expect(mdf.ratePerSqm).toBe(8400);
    expect(pvc.ratePerSqm).toBe(8400);
    const pvcRate = pvc.ratePerSqm;
    mdf.ratePerSqm = 9999;
    expect(pvc.ratePerSqm).toBe(pvcRate);
    mdf.ratePerSqm = 8400;
    expect(facadeThicknesses("mdf")).toEqual(facadeThicknesses("mdf_pvc"));
  });

  it("исторические фасады не входят в действующий каталог", () => {
    expect(LEGACY_FACADE_MATERIALS.map((item) => item.id)).toEqual([
      "veneer",
      "glass",
      "solid",
    ]);
    for (const legacy of ["veneer", "glass", "solid"] as const) {
      expect(isLegacyFacadeMaterial(legacy)).toBe(true);
      expect(isActiveFacadeMaterial(legacy)).toBe(false);
      expect(FACADE_MATERIALS.some((item) => item.id === legacy)).toBe(false);
      expect(facadeThicknesses(legacy)).toEqual([]);
    }
  });

  it("старые body/facade id читаются схемой, но дают предупреждение", () => {
    const legacy = {
      ...defaultKitchen(),
      bodyMaterial: "mdf" as const,
      facadeMaterial: "veneer" as const,
    };
    const parsed = furnitureConfigSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const issues = validateConfig(parsed.data);
    expect(issues.some((issue) => issue.severity === "error")).toBe(false);
    expect(
      issues.some(
        (issue) =>
          issue.path === "facadeMaterial" && issue.severity === "warning",
      ),
    ).toBe(true);
  });
});
