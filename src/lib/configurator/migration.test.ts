import { describe, expect, it } from "vitest";

import { defaultKitchen, normalizeKitchen } from "./defaults";
import { safeParseConfig } from "./schema";
import { calculateKitchenPrice } from "./pricing";
import type { KitchenConfig } from "./types";

/** Проект, сохранённый до появления настроек цоколя, подсветки и опор. */
function legacyKitchen(): Record<string, unknown> {
  const legacy = { ...defaultKitchen() } as Record<string, unknown>;
  delete legacy.lighting;
  delete legacy.supports;
  delete legacy.plinthMaterial;
  delete legacy.plinthThickness;
  delete legacy.plinthFinish;
  delete legacy.plinthMount;
  delete legacy.modules; // старый конфиг: модули без флага ownSupports
  legacy.modules = [
    {
      id: "m-1",
      type: "base",
      width: 60,
      height: 90,
      depth: 60,
      shelves: 1,
      drawers: 0,
    },
    {
      id: "m-2",
      type: "wall",
      width: 60,
      height: 72,
      depth: 35,
      shelves: 1,
      drawers: 0,
    },
  ];
  return legacy;
}

describe("migration of older kitchen projects", () => {
  it("parses an old config and fills the new defaults", () => {
    const result = safeParseConfig(legacyKitchen());

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data;
    if (data.kind !== "kitchen") throw new Error("kitchen expected");

    expect(data.lighting).toEqual({
      voltage: 24,
      powerPerMeter: 9.6,
      colorTemp: 3000,
      profile: "surface",
      diffuser: "frosted",
      control: "switch",
    });
    expect(data.supports).toEqual({
      systemId: "standard",
      maxSpanCm: 60,
      maxLoadKgPerLeg: 40,
    });
    expect(data.plinthMaterial).toBe("ldsp");
    expect(data.plinthThickness).toBe(16);
    expect(data.plinthFinish).toBe("pvc2");
    expect(data.plinthMount).toBe("clips");
    // Старые модули без ownSupports получают обычные мебельные опоры.
    expect(data.modules.every((module) => module.ownSupports === undefined)).toBe(
      true,
    );
  });

  it("keeps rejecting unknown fields", () => {
    const result = safeParseConfig({
      ...legacyKitchen(),
      unexpectedOption: 1,
    });
    expect(result.success).toBe(false);
  });

  it("normalizes an old config idempotently", () => {
    const raw = legacyKitchen() as unknown as KitchenConfig;

    const once = normalizeKitchen(raw);
    const twice = normalizeKitchen(once);

    expect(twice).toEqual(once);
    expect(once.lighting).toBeDefined();
    expect(once.supports).toBeDefined();
    expect(once.plinthThickness).toBe(16);
    expect(once.plinthMaterial).toBe("ldsp");
  });

  it("keeps user settings when normalizing twice", () => {
    const custom = {
      ...(legacyKitchen() as unknown as KitchenConfig),
      plinthMaterial: "stainless" as const,
      plinthThickness: 1.5,
      plinthFinish: "mirror",
      plinthMount: "hidden" as const,
      lighting: {
        voltage: 12 as const,
        powerPerMeter: 14.4 as const,
        colorTemp: 4000 as const,
        profile: "corner" as const,
        diffuser: "clear" as const,
        control: "dimmer" as const,
      },
      supports: {
        systemId: "heavy" as const,
        maxSpanCm: 45,
        maxLoadKgPerLeg: 70,
      },
    };

    const normalized = normalizeKitchen(custom);

    expect(normalized.plinthMaterial).toBe("stainless");
    expect(normalized.plinthThickness).toBe(1.5);
    expect(normalized.plinthFinish).toBe("mirror");
    expect(normalized.plinthMount).toBe("hidden");
    expect(normalized.lighting).toEqual(custom.lighting);
    expect(normalized.supports).toEqual(custom.supports);
    expect(normalizeKitchen(normalized)).toEqual(normalized);
  });

  it("drops invalid option values instead of failing", () => {
    const broken = {
      ...(legacyKitchen() as unknown as KitchenConfig),
      plinthMaterial: "unknown-material" as never,
      plinthThickness: 99,
      plinthFinish: "nope",
      plinthMount: "glue" as never,
      lighting: { voltage: 400 } as never,
      supports: { systemId: "alien" } as never,
    };

    const normalized = normalizeKitchen(broken);

    expect(normalized.plinthMaterial).toBe("ldsp");
    // Недопустимая толщина подтягивается к ближайшей для материала (16/18 → 18).
    expect(normalized.plinthThickness).toBe(18);
    expect(normalized.plinthFinish).toBe("pvc2");
    expect(normalized.plinthMount).toBe("clips");
    expect(normalized.lighting.voltage).toBe(24);
    expect(normalized.supports.systemId).toBe("standard");
    // Расчёт старого конфига не падает и возвращает положительную стоимость.
    expect(calculateKitchenPrice(normalized).total).toBeGreaterThan(0);
  });
});
