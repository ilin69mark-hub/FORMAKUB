import { describe, expect, it } from "vitest";

import { defaultKitchen, defaultWardrobe } from "./defaults";
import { calculatePrice } from "./pricing";

/**
 * Фактические значения baseline (CA-T-005, прогон 2026-11-07).
 *
 * Снимок структуры и сумм `PriceBreakdown` для конфигов по умолчанию.
 * Значения записаны в плане (§10.4); изменение ожиданий здесь — только вместе
 * с записью в журнале плана (инвариант I-02).
 */
describe("baseline PriceBreakdown (CA-T-005)", () => {
  it("kitchen: defaultKitchen()", () => {
    const price = calculatePrice(defaultKitchen());

    expect(price.currency).toBe("RUB");
    expect(price).toMatchObject({
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
    expect(price.lines).toHaveLength(20);
  });

  it("wardrobe: defaultWardrobe()", () => {
    const price = calculatePrice(defaultWardrobe());

    expect(price.currency).toBe("RUB");
    expect(price).toMatchObject({
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
    expect(price.lines).toHaveLength(7);
  });
});
