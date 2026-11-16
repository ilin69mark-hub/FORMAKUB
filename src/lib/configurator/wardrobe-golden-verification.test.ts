import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import { BODY_MATERIALS, FACADE_MATERIALS, FACADE_STYLES, HANDLES } from "@/content/catalog";
import { PRICING } from "@/content/pricing";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";

import type { CalculationBreakdown, CalculationInputs } from "./contract";
import { calculateBreakdown } from "./engine";
import { GOLDEN_EXPECTED } from "./golden.expected";
import { GOLDEN_SCENARIOS } from "./golden.fixtures";
import { calculateWardrobePrice } from "./pricing";
import type { WardrobeConfig } from "./types";

/**
 * Stage 9 / Block 7 — Independent Wardrobe Golden Validation.
 *
 * Методика (без использования `golden.expected.ts` как источника expected):
 *  1) тарифы выписываются из опубликованных данных (PRICING + snapshot);
 *  2) компоненты стоимости считаются двумя независимыми реализациями —
 *     Engine (`calculateBreakdown`) и legacy (`calculateWardrobePrice`) —
 *     и обязаны совпасть;
 *  3) коммерческая цепочка воспроизводится вручную по опубликованным правилам
 *     F-PR-02 (без коэффициента сложности), F-PR-19/20 (WARDROBE7) и
 *     округлению 100 ₽ / minOrder 45 000 ₽;
 *  4) результат сравнивается с существующими golden-значениями.
 */

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-block7-wardrobe-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  await seedRulesSnapshotFixture();
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-2026.11.1",
    pricingLabel: "Stage 9 Block 7 wardrobe",
    now: "2026-11-12T00:00:00.000Z",
  });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

function scenarioConfig(name: string): WardrobeConfig {
  const scenario = GOLDEN_SCENARIOS.find((item) => item.name === name);
  if (!scenario) throw new Error(`нет сценария ${name}`);
  return scenario.config as WardrobeConfig;
}

async function inputsFor(config: WardrobeConfig): Promise<CalculationInputs> {
  const resolved = await resolveCalculationInputs({ operation: "create", config });
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
  return resolved.value.request.inputs;
}

function lineAmount(b: CalculationBreakdown, id: string): number {
  const line = b.lines.find((item) => item.id === id);
  if (!line) throw new Error(`нет строки ${id}`);
  return line.amount;
}

function rateOf(inputs: CalculationInputs, priceItemId: string): number {
  const entry = inputs.priceSnapshot.snapshot.find(
    (item) => item.priceItemId === priceItemId,
  );
  if (!entry) throw new Error(`нет PriceItem ${priceItemId} в snapshot`);
  return entry.amount;
}

function refOf(
  inputs: CalculationInputs,
  catalog: string,
  id: string,
  role: string,
): string {
  const item = inputs.catalogs.find(
    (candidate) => candidate.catalog === catalog && candidate.id === id,
  );
  if (!item) throw new Error(`нет CatalogItem ${catalog}:${id}`);
  const ref = (item.priceRefs as Record<string, string>)[role];
  if (!ref) throw new Error(`нет роли ${role} у ${catalog}:${id}`);
  return ref;
}

/** Ручная коммерческая цепочка F-PR-02/F-PR-19/F-PR-20. */
function manualChain(
  components: number,
  promo?: { value: number; minSubtotal: number; maxDiscount: number },
): { subtotal: number; discount: number; total: number; gatePassed: boolean } {
  const subtotal = Math.max(
    PRICING.minOrder,
    Math.round(components / PRICING.rounding) * PRICING.rounding,
  );
  if (!promo) return { subtotal, discount: 0, total: subtotal, gatePassed: false };
  const gatePassed = subtotal >= promo.minSubtotal;
  if (!gatePassed) return { subtotal, discount: 0, total: subtotal, gatePassed };
  const raw = (subtotal * promo.value) / 100;
  const capped = Math.min(raw, promo.maxDiscount);
  const discount = Math.round(Math.min(capped, subtotal) / PRICING.rounding) * PRICING.rounding;
  const total = Math.max(0, subtotal - discount);
  return { subtotal, discount, total, gatePassed };
}

describe("Wardrobe Golden: тарифы wardrobe-custom-promo (п.2)", () => {
  it("mdf_pvc 8 400 ₽/м², стиль handleless ×1.08, «Без ручек» 0 ₽", async () => {
    const config = scenarioConfig("wardrobe-custom-promo");
    expect(config.facadeMaterial).toBe("mdf_pvc");
    expect(config.facadeStyle).toBe("handleless");
    expect(config.handle).toBe("none");

    const inputs = await inputsFor(config);
    const facadeRate = rateOf(
      inputs,
      refOf(inputs, "facadeMaterial", "mdf_pvc", "ratePerSqm"),
    );
    expect(facadeRate).toBe(8400);
    expect(
      FACADE_MATERIALS.find((item) => item.id === "mdf_pvc")!.ratePerSqm,
    ).toBe(8400);

    const styleMultiplier = rateOf(
      inputs,
      refOf(inputs, "facadeStyle", "handleless", "multiplier"),
    );
    expect(styleMultiplier).toBeCloseTo(1.08, 10);

    const handleRate = rateOf(inputs, refOf(inputs, "handle", "none", "rate"));
    expect(handleRate).toBe(0); // реально бесплатный вариант каталога
  });
});

describe("Wardrobe Golden: опубликованные тарифы (п.2)", () => {
  it("правила прайса и опубликованные ставки соответствуют content-справочникам", async () => {
    const config = scenarioConfig("wardrobe-default");
    const inputs = await inputsFor(config);

    // Правила F-PR-02 / округление / минимальный заказ.
    expect(inputs.priceSnapshot.rules).toMatchObject({
      rounding: 100,
      minOrder: 45000,
    });
    expect(PRICING.wardrobe.baseCost).toBe(9000);

    // Тарифы из snapshot (опубликованная PricingVersion) ↔ content-справочники.
    // snapshot ↔ content для каждого тарифа этой конфигурации.
    const facadeRate = rateOf(inputs, refOf(inputs, "facadeMaterial", config.facadeMaterial, "ratePerSqm"));
    expect(facadeRate).toBe(
      FACADE_MATERIALS.find((item) => item.id === config.facadeMaterial)?.ratePerSqm,
    );
    expect(facadeRate).toBe(5600); // wardrobe-default: ldsp

    const styleMultiplier = rateOf(
      inputs,
      refOf(inputs, "facadeStyle", config.facadeStyle, "multiplier"),
    );
    expect(styleMultiplier).toBeCloseTo(
      FACADE_STYLES.find((item) => item.id === config.facadeStyle)!.multiplier,
      10,
    );

    const handleRate = rateOf(inputs, refOf(inputs, "handle", config.handle, "rate"));
    expect(handleRate).toBe(HANDLES.find((item) => item.id === config.handle)!.rate);

    const bodyRate = rateOf(inputs, refOf(inputs, "bodyMaterial", config.bodyMaterial, "ratePerSqm"));
    expect(bodyRate).toBe(
      BODY_MATERIALS.find((item) => item.id === config.bodyMaterial)!.ratePerSqm,
    );

    const promo = inputs.priceSnapshot.promos.find((item) => item.code === "WARDROBE7");
    expect(promo).toMatchObject({
      type: "percent",
      value: 7,
      minSubtotal: 70000,
      maxDiscount: 18000,
      appliesTo: ["wardrobe"],
      active: true,
    });
  });
});

for (const name of ["wardrobe-default", "wardrobe-custom-promo"] as const) {
  describe(`Wardrobe Golden: ${name}`, () => {
    it("компоненты двух независимых реализаций совпадают (Engine ↔ legacy)", async () => {
      const config = scenarioConfig(name);
      const inputs = await inputsFor(config);
      const engine = calculateBreakdown(config, inputs);
      const legacy = calculateWardrobePrice(config);

      expect(engine.baseCost).toBe(PRICING.wardrobe.baseCost);
      expect(lineAmount(engine, "wardrobe.base")).toBe(9000);

      // Два независимых расчёта обязаны дать одинаковые компоненты.
      expect({
        body: engine.bodyCost,
        fronts: engine.frontsCost,
        fittings: engine.fittingsCost,
        options: engine.optionsCost,
      }).toEqual({
        body: legacy.bodyCost,
        fronts: legacy.frontsCost,
        fittings: legacy.fittingsCost,
        options: legacy.optionsCost,
      });

      // F-PR-02: у шкафа нет коэффициента сложности.
      expect(engine.complexityFactor).toBe(1);
      expect(legacy.complexityFactor).toBe(1);
      expect(engine.lines.some((line) => line.id === "kitchen.complexity")).toBe(false);
    });

    it("ручная коммерческая цепочка совпадает с Engine и с golden", async () => {
      const config = scenarioConfig(name);
      const inputs = await inputsFor(config);
      const engine = calculateBreakdown(config, inputs);
      const golden = GOLDEN_EXPECTED[name];

      const components =
        engine.baseCost +
        engine.bodyCost +
        engine.frontsCost +
        engine.fittingsCost +
        engine.optionsCost;

      const promo =
        name === "wardrobe-custom-promo"
          ? { value: 7, minSubtotal: 70000, maxDiscount: 18000 }
          : undefined;
      const manual = manualChain(components, promo);

      // Порог и cap — по опубликованным правилам.
      if (promo) {
        expect(inputs.priceSnapshot.promos.find((item) => item.code === "WARDROBE7")).toMatchObject({
          value: 7,
          minSubtotal: 70000,
          maxDiscount: 18000,
        });
        expect(manual.gatePassed).toBe(true); // subtotal ≥ 70 000
        expect(manual.discount).toBeLessThanOrEqual(18000);
      }

      // Сравнение: ручной расчёт ↔ Engine ↔ golden.
      expect(engine.subtotal).toBe(manual.subtotal);
      expect(engine.discount).toBe(manual.discount);
      expect(engine.total).toBe(manual.total);

      expect(golden.subtotal).toBe(manual.subtotal);
      expect(golden.discount).toBe(manual.discount);
      expect(golden.total).toBe(manual.total);
      expect(golden.baseCost).toBe(9000);

      // Промежуточные значения (зафиксировать явно).
      expect(components).toBe(
        name === "wardrobe-default" ? 128287 : 154454,
      );
      expect(manual.subtotal).toBe(name === "wardrobe-default" ? 128300 : 154500);
      expect(manual.discount).toBe(name === "wardrobe-default" ? 0 : 10800);
      expect(manual.total).toBe(name === "wardrobe-default" ? 128300 : 143700);

      // Округление: все суммы кратны шагу 100 ₽, итог неотрицателен.
      expect(engine.subtotal % PRICING.rounding).toBe(0);
      expect(engine.discount % PRICING.rounding).toBe(0);
      expect(engine.total % PRICING.rounding).toBe(0);
      expect(engine.total).toBeGreaterThanOrEqual(0);
    });
  });
}
