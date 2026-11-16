import { describe, expect, it } from "vitest";

import { priceBreakdownSchema } from "./schema";

const valid = {
  currency: "RUB",
  baseCost: 100,
  bodyCost: 200,
  frontsCost: 300,
  fittingsCost: 400,
  optionsCost: 500,
  complexityFactor: 1,
  subtotal: 1500,
  discount: 0,
  total: 1500,
  minOrderApplied: false,
  lines: [{ label: "Строка", amount: 1500, detail: "деталь" }],
  promo: null,
  disclaimer: "Предварительный расчёт",
};

describe("CA-T-306E: строгая схема PriceBreakdown", () => {
  it("принимает полный breakdown", () => {
    expect(priceBreakdownSchema.safeParse(valid).success).toBe(true);
  });

  it("отклоняет пустой объект", () => {
    expect(priceBreakdownSchema.safeParse({}).success).toBe(false);
  });

  it("отклоняет отсутствие обязательного поля", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.total;
    expect(priceBreakdownSchema.safeParse(rest).success).toBe(false);
  });

  it("отклоняет неверный тип числового значения", () => {
    expect(
      priceBreakdownSchema.safeParse({ ...valid, total: "1500" }).success,
    ).toBe(false);
  });
});
