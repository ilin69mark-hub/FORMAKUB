import { describe, expect, it } from "vitest";

import { PRICING, PROMOS } from "@/content/pricing";
import {
  BUILD_CALC_VERSION,
  SUPPORTED_SCHEMA_VERSION,
} from "./versions";
import { calculatePrice } from "./pricing";
import type { PriceBreakdown } from "./types";
import { GOLDEN_EXPECTED } from "./golden.expected";
import { GOLDEN_SCENARIOS } from "./golden.fixtures";

/**
 * CA-T-305 — golden-тесты kitchen/wardrobe.
 *
 * Фиксируют текущий Engine до CA-T-306. Эталоны — в golden.expected.ts;
 * входные конфигурации — в golden.fixtures.ts. Тесты не читают production
 * SQLite и не используют DataResolver: источник цен/версий текущей сборки —
 * content (PRICING.version), пока CA-T-306 не подключит PriceSnapshot.
 */

const scenarios = new Map(
  GOLDEN_SCENARIOS.map((scenario) => [scenario.name, scenario]),
);

function scenario(name: string) {
  const value = scenarios.get(name);
  if (!value) throw new Error(`Нет golden-сценария "${name}"`);
  return value;
}

function priceOf(name: string): PriceBreakdown {
  return calculatePrice(scenario(name).config);
}

function roundMoney(value: number): number {
  const step = PRICING.rounding;
  return Math.max(0, Math.round(value / step) * step);
}

function sumComponents(price: PriceBreakdown): number {
  return (
    price.baseCost +
    price.bodyCost +
    price.frontsCost +
    price.fittingsCost +
    price.optionsCost
  );
}

function expectedPromo(code: string, subtotal: number) {
  const promo = PROMOS.find((item) => item.code === code);
  if (!promo) throw new Error(`Нет промокода "${code}"`);
  let discount =
    promo.type === "percent" ? (subtotal * promo.value) / 100 : promo.value;
  if (promo.maxDiscount) discount = Math.min(discount, promo.maxDiscount);
  discount = Math.min(discount, subtotal);
  return { promo, discount: roundMoney(discount) };
}

describe("CA-T-305: golden kitchen/wardrobe", () => {
  it("фиксирует источник данных и три независимые версии", () => {
    expect(SUPPORTED_SCHEMA_VERSION).toBe(2);
    expect(BUILD_CALC_VERSION).toBe("calc-2026.11.2");
    // До CA-T-306 Engine использует content-прайс этой демо-версии, не production PriceVersion.
    expect(PRICING.version).toBe("demo-2026-01");
    for (const item of GOLDEN_SCENARIOS) {
      expect(item.config.version).toBe(1); // версия структуры config, не schemaVersion записи
    }
    expect(Object.keys(GOLDEN_EXPECTED)).toHaveLength(GOLDEN_SCENARIOS.length);
  });

  it("baseline CA-T-005 (kitchen/wardrobe) совпадает с зафиксированным снимком", () => {
    const kitchen = priceOf("kitchen-default");
    expect(kitchen).toMatchObject({
      baseCost: 12000,
      bodyCost: 80184,
      frontsCost: 30400,
      fittingsCost: 25800,
      optionsCost: 49821,
      complexityFactor: 1.06,
      subtotal: 210100,
      discount: 0,
      total: 210100,
      minOrderApplied: false,
      promo: null,
    });
    expect(kitchen.lines).toHaveLength(20);

    const wardrobe = priceOf("wardrobe-default");
    expect(wardrobe).toMatchObject({
      baseCost: 9000,
      bodyCost: 36158,
      frontsCost: 33533,
      fittingsCost: 29050,
      optionsCost: 20546,
      complexityFactor: 1,
      subtotal: 128300,
      discount: 0,
      total: 128300,
      minOrderApplied: false,
      promo: null,
    });
    expect(wardrobe.lines).toHaveLength(7);
  });

  for (const item of GOLDEN_SCENARIOS) {
    it(`${item.name}: полный breakdown совпадает с эталоном`, () => {
      expect(priceOf(item.name)).toEqual(GOLDEN_EXPECTED[item.name]);
    });

    it(`${item.name}: компоненты, строки и итог арифметически согласованы`, () => {
      const price = priceOf(item.name);
      const expected = GOLDEN_EXPECTED[item.name];
      expect(price).toEqual(expected);
      expect(price.currency).toBe("RUB");
      expect(Number.isFinite(price.total)).toBe(true);
      expect(price.total).toBeGreaterThanOrEqual(0);

      const raw = sumComponents(price) * price.complexityFactor;
      if (price.minOrderApplied) {
        expect(price.subtotal).toBe(PRICING.minOrder);
        expect(raw).toBeLessThan(PRICING.minOrder);
      } else {
        expect(Math.abs(roundMoney(raw) - price.subtotal)).toBeLessThanOrEqual(
          PRICING.rounding,
        );
      }
      expect(price.total).toBe(
        roundMoney(Math.max(0, price.subtotal - price.discount)),
      );

      // Первые пять строк — расчётные компоненты, а не декоративные под-строки.
      expect(price.lines[0]?.amount).toBe(price.baseCost);
      expect(price.lines[1]?.amount).toBe(price.bodyCost);
      expect(price.lines[2]?.amount).toBe(price.frontsCost);
      expect(price.lines[3]?.amount).toBe(price.fittingsCost);
      expect(price.lines[4]?.amount).toBe(price.optionsCost);
      for (const line of price.lines) {
        expect(typeof line.label).toBe("string");
        expect(line.label.length).toBeGreaterThan(0);
        expect(Number.isFinite(line.amount)).toBe(true);
        expect(typeof line.detail).toBe("string");
      }
    });
  }

  it("промокоды: DEMO10 ограничен maxDiscount, WARDROBE7 округлён, WARDROBE7 — только шкаф", () => {
    const kitchenPromo = priceOf("kitchen-promo-complexity");
    const demo10 = expectedPromo("DEMO10", kitchenPromo.subtotal);
    expect(kitchenPromo.promo).toMatchObject({
      code: "DEMO10",
      valid: true,
      discount: demo10.discount,
    });
    expect(demo10.discount).toBe(30000);
    expect(kitchenPromo.discount).toBe(demo10.discount);
    expect(kitchenPromo.total).toBe(kitchenPromo.subtotal - demo10.discount);

    const wardrobePromo = priceOf("wardrobe-custom-promo");
    const wardrobe7 = expectedPromo("WARDROBE7", wardrobePromo.subtotal);
    expect(wardrobePromo.promo).toMatchObject({
      code: "WARDROBE7",
      valid: true,
      discount: wardrobe7.discount,
    });
    expect(wardrobe7.discount).toBe(10800);
    expect(wardrobePromo.total).toBe(
      wardrobePromo.subtotal - wardrobe7.discount,
    );

    const kitchen = priceOf("kitchen-default");
    expect(kitchen.promo).toBeNull();
    expect(kitchen.discount).toBe(0);
  });

  it("граница минимального заказа и максимальная сложность зафиксированы", () => {
    const min = priceOf("kitchen-min-order");
    expect(min.minOrderApplied).toBe(true);
    expect(min.subtotal).toBe(PRICING.minOrder);
    expect(min.total).toBe(PRICING.minOrder);
    expect(min.lines.at(-1)?.label).toBe("Минимальная стоимость заказа");

    const complex = priceOf("kitchen-promo-complexity");
    expect(complex.complexityFactor).toBe(PRICING.kitchen.complexityMax);
    expect(complex.complexityFactor).toBe(1.12);
    expect(complex.lines.some((line) => line.label === "Сложность конфигурации")).toBe(
      true,
    );
  });

  it("детерминированность: повторный расчёт и повторный прогон дают тот же breakdown", () => {
    for (const item of GOLDEN_SCENARIOS) {
      const first = calculatePrice(item.config);
      const second = calculatePrice(item.config);
      expect(second).toEqual(first);
      expect(second).toEqual(GOLDEN_EXPECTED[item.name]);
    }
  });

  it("покрывает kitchen и wardrobe, включая материалы, фурнитуру, столешницы, цоколь, опоры, LED, мойку, пресеты, промо и границы", () => {
    const kitchen = GOLDEN_SCENARIOS.filter((item) =>
      item.name.startsWith("kitchen-"),
    );
    const wardrobe = GOLDEN_SCENARIOS.filter((item) =>
      item.name.startsWith("wardrobe-"),
    );
    expect(kitchen).toHaveLength(6);
    expect(wardrobe).toHaveLength(2);

    const covers = GOLDEN_SCENARIOS.map((item) => item.covers).join(" ");
    for (const marker of [
      "материалы",
      "фасады",
      "фурнитура",
      "столешница",
      "цоколь",
      "signed",
      "опоры",
      "LED",
      "мойка",
      "пресеты",
      "промокод",
      "минимальной стоимости",
      "шкаф",
    ]) {
      expect(covers).toContain(marker);
    }
  });
});
