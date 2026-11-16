import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import { KITCHEN_MODULES } from "@/content/catalog";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";

import type { CalculationBreakdown, CalculationInputs } from "./contract";
import { defaultKitchen, makeKitchenModule } from "./defaults";
import { calculateBreakdown } from "./engine";
import { calculateKitchenPrice, kitchenCountertopWidth } from "./pricing";
import type { KitchenConfig } from "./types";

/**
 * Stage 9 / Block 4 — TG-C3: столешница и бутылочница.
 *
 * Правило владельца продукта (DOMAIN_CONFIRMED):
 *  А) самостоятельная напольная бутылочница (`type === "bottle"`,
 *     наружные габариты 150/200/300 мм) входит в общую длину столешницы;
 *  Б) встроенный механизм бутылочки внутри существующего модуля
 *     (`sinkStorage[].bottle`, 15/20/30 см) ширину отдельно не прибавляет —
 *     модуль мойки уже посчитан по своему габариту.
 *
 * Примеры владельца: 600 + 800 + 150 мм → 1550 мм; мойка 800 мм со встроенной
 * бутылочницей 200 мм → 800 мм, а не 1000 мм.
 *
 * Структурный признак различия — существующая модель данных: тип модуля
 * (`KitchenModuleType = "bottle"`) против поля наполнения секции
 * (`KitchenSinkStorage.bottle`). Новых признаков не вводится, тип не
 * определяется по текстовому названию.
 *
 * Ожидаемые значения — арифметика примеров владельца и габариты пресета
 * `KITCHEN_MODULES.bottle`, а не результат проверяемой функции.
 */

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-block4-top-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  await seedRulesSnapshotFixture();
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-2026.11.1",
    pricingLabel: "Stage 9 Block 4 countertop",
    now: "2026-11-09T00:00:00.000Z",
  });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

async function inputsFor(config: KitchenConfig): Promise<CalculationInputs> {
  const resolved = await resolveCalculationInputs({ operation: "create", config });
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
  return resolved.value.request.inputs;
}

function optionsLine(breakdown: CalculationBreakdown): {
  amount: number;
  countertopMeters: number;
} {
  const line = breakdown.lines.find((item) => item.id === "kitchen.options");
  if (!line || !("countertopMeters" in line)) {
    throw new Error("нет строки kitchen.options");
  }
  return { amount: line.amount, countertopMeters: line.countertopMeters };
}

function countertopRate(inputs: CalculationInputs, id: string): number {
  const item = inputs.catalogs.find(
    (candidate) => candidate.catalog === "countertop" && candidate.id === id,
  );
  if (!item) throw new Error(`нет CatalogItem countertop:${id}`);
  const ref = (item.priceRefs as Record<string, string>)["ratePerLinearMeter"];
  if (!ref) throw new Error(`нет role ratePerLinearMeter у countertop:${id}`);
  const entry = inputs.priceSnapshot.snapshot.find(
    (snapshot) => snapshot.priceItemId === ref,
  );
  if (!entry) throw new Error(`нет PriceItem ${ref}`);
  return entry.amount;
}

/** Сценарий А: отдельная напольная бутылочница в общем ряду. */
function scenarioStandalone(bottleWidthCm: 15 | 20 | 30): KitchenConfig {
  return {
    ...defaultKitchen(),
    modules: [
      makeKitchenModule("base", { id: "a-base-60", width: 60 }),
      makeKitchenModule("base", { id: "a-base-80", width: 80 }),
      makeKitchenModule("bottle", { id: "a-bottle", width: bottleWidthCm }),
      makeKitchenModule("wall", { id: "a-upper", width: 100 }),
    ],
    underCabinetLighting: false,
    promoCode: "",
  };
}

/** Сценарий Б: встроенный механизм бутылочки в модуле мойки. */
function scenarioBuiltIn(
  bottleCm: 15 | 20 | 30 | undefined,
  countertop: KitchenConfig["countertop"] = "ldsp_hpl",
): KitchenConfig {
  return {
    ...defaultKitchen(),
    modules: [
      makeKitchenModule("sink", {
        id: "b-sink",
        width: 80,
        shelves: 0,
        sinkStorage: [{ shelves: 1, drawers: 0, ...(bottleCm ? { bottle: bottleCm } : {}) }],
      }),
      makeKitchenModule("wall", { id: "b-upper", width: 80 }),
    ],
    countertop,
    countertopThickness: 38,
    underCabinetLighting: false,
    promoCode: "",
  };
}

describe("TG-C3 А: самостоятельная бутылочница входит в длину столешницы", () => {
  it("стандартные наружные габариты пресета — 150/200/300 мм", () => {
    expect(KITCHEN_MODULES.bottle.zone).toBe("floor");
    expect({ min: KITCHEN_MODULES.bottle.minWidth, max: KITCHEN_MODULES.bottle.maxWidth }).toEqual({
      min: 15,
      max: 30,
    });
    expect(KITCHEN_MODULES.bottle.defaultWidth).toBe(20);
  });

  // 600 + 800 + 150 мм → 1550 мм; 200 мм → 1600 мм; 300 мм → 1700 мм.
  const expectedWidthCm: Array<{ width: 15 | 20 | 30; cm: number }> = [
    { width: 15, cm: 155 },
    { width: 20, cm: 160 },
    { width: 30, cm: 170 },
  ];

  for (const item of expectedWidthCm) {
    it(`бутылочка ${item.width * 10} мм → столешница ${item.cm * 10} мм (legacy)`, () => {
      expect(kitchenCountertopWidth(scenarioStandalone(item.width))).toBe(item.cm);
    });

    it(`бутылочка ${item.width * 10} мм → столешница ${item.cm * 10} мм (Engine)`, async () => {
      const config = scenarioStandalone(item.width);
      const inputs = await inputsFor(config);
      const breakdown = calculateBreakdown(config, inputs);
      expect(optionsLine(breakdown).countertopMeters).toBeCloseTo(item.cm / 100, 10);
      // Legacy и Engine считают одну и ту же длину.
      expect(kitchenCountertopWidth(config) / 100).toBeCloseTo(
        optionsLine(breakdown).countertopMeters,
        10,
      );
    });
  }
});

describe("TG-C3 Б: встроенный механизм не удваивает ширину", () => {
  for (const bottle of [15, 20, 30] as const) {
    it(`мойка 800 мм + встроенная бутылочка ${bottle * 10} мм → 800 мм`, async () => {
      const config = scenarioBuiltIn(bottle);
      // Габарит модуля не меняется встроенным механизмом.
      expect(config.modules.find((module) => module.id === "b-sink")?.width).toBe(80);
      expect(kitchenCountertopWidth(config)).toBe(80);

      const inputs = await inputsFor(config);
      const breakdown = calculateBreakdown(config, inputs);
      expect(optionsLine(breakdown).countertopMeters).toBeCloseTo(0.8, 10);
    });
  }

  it("контраст: та же бутылочка 200 мм отдельным модулем добавляет 200 мм", async () => {
    const builtIn = scenarioBuiltIn(20);
    const standalone: KitchenConfig = {
      ...builtIn,
      modules: [
        ...builtIn.modules.filter((module) => module.id !== "b-sink"),
        makeKitchenModule("sink", { id: "b-sink", width: 80, shelves: 0 }),
        makeKitchenModule("bottle", { id: "b-bottle", width: 20 }),
      ],
    };
    expect(kitchenCountertopWidth(builtIn)).toBe(80);
    expect(kitchenCountertopWidth(standalone)).toBe(100);

    const inputs = await inputsFor(standalone);
    expect(optionsLine(calculateBreakdown(standalone, inputs)).countertopMeters).toBeCloseTo(
      1,
      10,
    );
  });

  it("ширина встроенной бутылочки не влияет на длину столешницы", async () => {
    const config = scenarioBuiltIn(30);
    const inputs = await inputsFor(config);
    expect(optionsLine(calculateBreakdown(config, inputs)).countertopMeters).toBeCloseTo(0.8, 10);
  });
});

describe("TG-C3: стоимость столешницы = длина × тариф", () => {
  it("Engine: смена материала меняет опции ровно на длину × разницу тарифов", async () => {
    const cheap = scenarioBuiltIn(20, "ldsp_hpl");
    const premium = scenarioBuiltIn(20, "quartz");
    expect(kitchenCountertopWidth(cheap)).toBe(80);

    const inputsCheap = await inputsFor(cheap);
    const inputsPremium = await inputsFor(premium);
    const rateCheap = countertopRate(inputsCheap, "ldsp_hpl");
    const ratePremium = countertopRate(inputsPremium, "quartz");
    expect(ratePremium).toBeGreaterThan(rateCheap);

    const delta =
      optionsLine(calculateBreakdown(premium, inputsPremium)).amount -
      optionsLine(calculateBreakdown(cheap, inputsCheap)).amount;
    const expected = (80 / 100) * (ratePremium - rateCheap);
    // Строка «опции» округляется до рубля, поэтому допуск ≤ 1 ₽.
    expect(Math.abs(delta - expected)).toBeLessThanOrEqual(1);
  });

  it("legacy: та же арифметика на длинном ряду со свободной бутылочницей", async () => {
    const cheap = { ...scenarioStandalone(30), countertop: "ldsp_hpl" as const };
    const premium = { ...scenarioStandalone(30), countertop: "quartz" as const };
    const inputsCheap = await inputsFor(cheap);
    const inputsPremium = await inputsFor(premium);

    const line = (config: KitchenConfig): number => {
      const found = calculateKitchenPrice(config).lines.find(
        (item) => item.label === "Столешница, цоколь и опции",
      );
      if (!found) throw new Error("нет строки опций");
      return found.amount;
    };

    const delta = line(premium) - line(cheap);
    const expected =
      (kitchenCountertopWidth(cheap) / 100) *
      (countertopRate(inputsPremium, "quartz") - countertopRate(inputsCheap, "ldsp_hpl"));
    expect(Math.abs(delta - expected)).toBeLessThanOrEqual(1);
  });
});
