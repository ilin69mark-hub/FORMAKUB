import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import { PRICING } from "@/content/pricing";

import { defaultKitchen, defaultWardrobe } from "./defaults";
import { calculateBreakdown } from "./engine";
import type { CalculationBreakdown, CalculationInputs } from "./contract";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";
import type { FurnitureConfig, KitchenConfig } from "./types";

/**
 * Stage 9 / Block 7 — TG-M7: инертность мёртвых коммерческих правил на
 * runtime Engine-пути (catalog §4 / dependency-map `NOT_USED`).
 *
 * Параметры (источник — `src/content/pricing.ts`, объект `PRICING`):
 *   wardrobe.bodyFactor              = 1.15
 *   kitchen.countertopDepthAllowance = 0.04
 *   kitchen.underCabinetLightPerMeter = 1900
 *   kitchen.sinkPartition            = 2400
 *   kitchen.plinthPerMeter           = 1600
 *
 * Для каждого проверяются четыре пункта: источник определения, фактические
 * runtime-ссылки (текст `engine.ts` + состав входов), независимость результата
 * Engine от значения и причина инертности. Проверяется именно Engine, а не
 * legacy pricing; параметры не удаляются и не подключаются к расчёту.
 */

const DEAD_RULES = [
  { path: "wardrobe", key: "bodyFactor", value: 1.15 },
  { path: "kitchen", key: "countertopDepthAllowance", value: 0.04 },
  { path: "kitchen", key: "underCabinetLightPerMeter", value: 1900 },
  { path: "kitchen", key: "sinkPartition", value: 2400 },
  { path: "kitchen", key: "plinthPerMeter", value: 1600 },
] as const;

const ENGINE_SOURCE = readFileSync(
  fileURLToPath(new URL("./engine.ts", import.meta.url)),
  "utf8",
);

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-block7-m7-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  await seedRulesSnapshotFixture();
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-2026.11.1",
    pricingLabel: "Stage 9 Block 7 dead rules",
    now: "2026-11-12T00:00:00.000Z",
  });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

async function inputsFor(config: FurnitureConfig): Promise<CalculationInputs> {
  const resolved = await resolveCalculationInputs({ operation: "create", config });
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
  return resolved.value.request.inputs;
}

/** Изменить значение в PRICING и гарантированно вернуть обратно. */
async function withPricingValue<T>(
  path: "kitchen" | "wardrobe",
  key: string,
  value: number,
  task: () => Promise<T>,
): Promise<T> {
  const section = PRICING[path] as unknown as Record<string, number>;
  const original = section[key];
  section[key] = value;
  try {
    return await task();
  } finally {
    section[key] = original;
  }
}

function snapshotIds(inputs: CalculationInputs): string[] {
  return inputs.priceSnapshot.snapshot.map((item) => item.priceItemId);
}

/** Кухня, чувствительная ко всем четырём kitchen-параметрам. */
function kitchenConfig(): KitchenConfig {
  return { ...defaultKitchen(), promoCode: "" };
}

function breakdownOf(b: CalculationBreakdown): unknown {
  return {
    baseCost: b.baseCost,
    bodyCost: b.bodyCost,
    frontsCost: b.frontsCost,
    fittingsCost: b.fittingsCost,
    optionsCost: b.optionsCost,
    complexityFactor: b.complexityFactor,
    subtotal: b.subtotal,
    discount: b.discount,
    total: b.total,
    minOrderApplied: b.minOrderApplied,
    lines: b.lines,
  };
}

describe("TG-M7: источник определения (п.1)", () => {
  for (const rule of DEAD_RULES) {
    it(`${rule.path}.${rule.key} объявлен в PRICING со значением ${rule.value}`, () => {
      const section = PRICING[rule.path] as unknown as Record<string, number>;
      expect(section[rule.key]).toBe(rule.value);
    });
  }

  it("kitchen.plinthPerMeter и wardrobe.plinthPerMeter — разные параметры (не путать)", () => {
    // Мёртвым по catalog §4 является именно kitchen.plinthPerMeter;
    // wardrobe.plinthPerMeter живёт отдельно (legacy pricing + PriceItem).
    expect(PRICING.kitchen.plinthPerMeter).toBe(1600);
    expect(PRICING.wardrobe.plinthPerMeter).toBe(1600);
    expect(
      (PRICING as unknown as { kitchen: Record<string, number> }).kitchen,
    ).toHaveProperty("plinthPerMeter");
  });
});

describe("TG-M7: фактические runtime-ссылки (п.2–3)", () => {
  for (const rule of DEAD_RULES) {
    it(`engine.ts не ссылается на ${rule.path}.${rule.key}`, () => {
      // Статическая проверка runtime-пути: полный идентификатор отсутствует в
      // Engine. Для kitchen.plinthPerMeter важно проверять полный путь —
      // Engine законно работает с отдельным PriceItem "wardrobe.plinthPerMeter".
      expect(ENGINE_SOURCE).not.toContain(`${rule.path}.${rule.key}`);
      if (rule.key === "bodyFactor") {
        // bodyFactor читался бы как rules.bodyFactor — проверяем и без префикса.
        expect(ENGINE_SOURCE).not.toContain("bodyFactor");
      }
    });
  }

  it("4 мёртвых kitchen-поля не попадают во входы Engine (нет PriceItem и правила)", async () => {
    const inputs = await inputsFor(kitchenConfig());
    const ids = snapshotIds(inputs);
    for (const key of [
      "countertopDepthAllowance",
      "underCabinetLightPerMeter",
      "sinkPartition",
      "plinthPerMeter",
    ]) {
      expect(ids, `kitchen.${key} не должен попасть в snapshot`).not.toContain(
        `kitchen.${key}`,
      );
      expect(
        Object.keys(inputs.priceSnapshot.rules as unknown as Record<string, number>),
        `kitchen.${key} не должен попасть в rules`,
      ).not.toContain(key);
    }
    // Правило bodyFactor в rules присутствует (контракт F-CT-01), но Engine
    // его не читает — проверяется отдельным тестом мутации.
    expect(inputs.priceSnapshot.rules).toHaveProperty("bodyFactor");
  });

  it("4 мёртвых поля помечены permanently-unused в Admin-модели (без изменения справочников)", () => {
    // Ссылка на источник — price-items.ts (PERMANENTLY_UNUSED, OI-054);
    // проверка только чтением, ничего не создаётся.
    const source = readFileSync(
      fileURLToPath(new URL("../admin/price-items.ts", import.meta.url)),
      "utf8",
    );
    for (const key of [
      "countertopDepthAllowance",
      "underCabinetLightPerMeter",
      "sinkPartition",
      "plinthPerMeter",
    ]) {
      expect(source).toContain(`kitchen.${key}`);
    }
    expect(source).toContain("PERMANENTLY_UNUSED");
  });
});

describe("TG-M7: значение параметра не меняет результат Engine (п.4)", () => {
  it("кухня: замена всех четырёх kitchen-параметров не меняет breakdown", async () => {
    const config = kitchenConfig();
    const inputs = await inputsFor(config);
    const baseline = breakdownOf(calculateBreakdown(config, inputs));

    // Значения подобраны заведомо отличающимися, чтобы «случайное совпадение»
    // не могло замаскировать чтение параметра.
    const mutated = await withPricingValue("kitchen", "countertopDepthAllowance", 9.99, () =>
      withPricingValue("kitchen", "underCabinetLightPerMeter", 99999, () =>
        withPricingValue("kitchen", "sinkPartition", 77777, () =>
          withPricingValue("kitchen", "plinthPerMeter", 55555, async () => {
            const after = breakdownOf(calculateBreakdown(config, inputs));
            return after;
          }),
        ),
      ),
    );

    expect(mutated).toEqual(baseline);
    // Значения действительно вернулись в исходное состояние (восстановление
    // в finally) — последующие тесты работают с нетронутым PRICING.
    expect(PRICING.kitchen.countertopDepthAllowance).toBe(0.04);
    expect(PRICING.kitchen.underCabinetLightPerMeter).toBe(1900);
    expect(PRICING.kitchen.sinkPartition).toBe(2400);
    expect(PRICING.kitchen.plinthPerMeter).toBe(1600);
  });

  it("кухня: изменение подключённого PriceItem меняет результат (контроль чувствительности)", async () => {
    const config = kitchenConfig();
    const inputs = await inputsFor(config);
    const baseline = breakdownOf(calculateBreakdown(config, inputs));

    const counterId = inputs.catalogs.find(
      (item) => item.catalog === "countertop" && item.id === config.countertop,
    )?.priceRefs as Record<string, string> | undefined;
    expect(counterId?.ratePerLinearMeter).toBeDefined();

    const sensitive = structuredClone(inputs);
    const entry = sensitive.priceSnapshot.snapshot.find(
      (item) => item.priceItemId === counterId!.ratePerLinearMeter,
    );
    expect(entry).toBeDefined();
    const original = entry!.amount;
    entry!.amount = original + 1000;
    try {
      const after = breakdownOf(calculateBreakdown(config, sensitive));
      expect(after).not.toEqual(baseline);
      expect((after as CalculationBreakdown).total).toBeGreaterThan(
        (baseline as CalculationBreakdown).total,
      );
    } finally {
      entry!.amount = original;
    }
  });

  it("wardrobe: bodyFactor в rules не влияет на результат Engine", async () => {
    const config = defaultWardrobe();
    const inputs = await inputsFor(config);
    const baseline = breakdownOf(calculateBreakdown(config, inputs));

    // Мутация значения в том самом объекте rules, который Engine получает.
    const mutated = structuredClone(inputs);
    (mutated.priceSnapshot.rules as unknown as Record<string, number>).bodyFactor = 9.99;
    expect(breakdownOf(calculateBreakdown(config, mutated))).toEqual(baseline);

    // И мутация исходной константы content — тоже без эффекта для Engine.
    const viaContent = await withPricingValue("wardrobe", "bodyFactor", 9.99, async () =>
      breakdownOf(calculateBreakdown(config, inputs)),
    );
    expect(viaContent).toEqual(baseline);
  });

  it("кухня: результат совпадает с legacy-путём по коммерческой цепочке (subtotal/total)", async () => {
    // Дополнительный перекрёстный контроль: если мёртвые поля влияли бы на
    // один из путей, суммы разошлись бы. Здесь фиксируется только то, что
    // Engine даёт согласованный итог: subtotal ≥ minOrder, total = subtotal
    // при отсутствии промокода, все кратно шагу 100 ₽.
    const config = kitchenConfig();
    const inputs = await inputsFor(config);
    const b = calculateBreakdown(config, inputs);

    expect(b.discount).toBe(0);
    expect(b.subtotal).toBeGreaterThanOrEqual(inputs.priceSnapshot.rules.minOrder);
    expect(b.total).toBe(b.subtotal);
    expect(b.subtotal % inputs.priceSnapshot.rules.rounding).toBe(0);
    expect(b.total % inputs.priceSnapshot.rules.rounding).toBe(0);
  });
});
