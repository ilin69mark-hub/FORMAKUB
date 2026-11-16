import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import { PROMOS, PRICING } from "@/content/pricing";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";

import type { CalculationBreakdown, CalculationInputs } from "./contract";
import { defaultKitchen } from "./defaults";
import { calculateBreakdown } from "./engine";
import { GOLDEN_SCENARIOS } from "./golden.fixtures";
import type { KitchenConfig } from "./types";

/**
 * Stage 9 / Block 7 — TG-M1: матрица правил промокодов на runtime Engine-пути.
 *
 * Правила F-PR-19 (ворота допуска) и F-PR-20 (расчёт скидки) из
 * опубликованной версии price-2026.11.1 (`src/content/pricing.ts`):
 *
 *   ворота по порядку: нет кода → неизвестный → неактивный → чужая категория →
 *   `subtotal < minSubtotal`; каждое возвращает `discount = 0`;
 *   `discount = type === "percent" ? subtotal × value / 100 : value`;
 *   `if (maxDiscount) discount = min(discount, maxDiscount)`;
 *   `discount = roundMoney(min(discount, subtotal), rounding)`;
 *   `total = roundMoney(max(0, subtotal − discount), rounding)`.
 *
 * Публикованные значения (сверяются assert-ом в тестах):
 *   PRICING.rounding = 100 ₽, PRICING.minOrder = 45 000 ₽;
 *   DEMO10   — percent 10,  minSubtotal 120 000, maxDiscount 30 000, kitchen;
 *   WARDROBE7 — percent 7,  minSubtotal 70 000,  maxDiscount 18 000, wardrobe;
 *   DEMO5000 — fixed 5 000, minSubtotal 90 000,  caps нет, all.
 *
 * Ожидаемые значения выводятся вручную из этих правил; `Engine` используется
 * только как объект сопоставления. `subtotal` считается дважды: из строк
 * расчёта по цепочке «Σ компонент × коэффициент → округление → пол minOrder»
 * и через поле `breakdown.subtotal` — оба обязаны совпасть.
 */

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-block7-m1-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  await seedRulesSnapshotFixture();
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-2026.11.1",
    pricingLabel: "Stage 9 Block 7 promo matrix",
    now: "2026-11-12T00:00:00.000Z",
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

function lineAmount(b: CalculationBreakdown, id: string): number {
  const line = b.lines.find((item) => item.id === id);
  if (!line) throw new Error(`нет строки ${id}`);
  return line.amount;
}

/** Ручная проверка subtotal: Σ компонент × коэффициент → round100 → пол minOrder. */
function manualSubtotal(b: CalculationBreakdown): number {
  const rules = { rounding: PRICING.rounding, minOrder: PRICING.minOrder };
  const sum = (
    ["kitchen.base", "kitchen.body", "kitchen.fronts", "kitchen.fittings", "kitchen.options"] as const
  ).reduce((acc, id) => acc + lineAmount(b, id), 0);
  const raw = sum * b.complexityFactor;
  return Math.max(rules.minOrder, Math.round(raw / rules.rounding) * rules.rounding);
}

/** Ручное правило F-PR-20 (без обращения к Engine). */
function manualDiscount(
  subtotal: number,
  promo: { type: "percent" | "fixed"; value: number; maxDiscount?: number },
): number {
  const raw = promo.type === "percent" ? (subtotal * promo.value) / 100 : promo.value;
  const capped = promo.maxDiscount !== undefined ? Math.min(raw, promo.maxDiscount) : raw;
  return Math.round(Math.min(capped, subtotal) / PRICING.rounding) * PRICING.rounding;
}

function withPromo(
  inputs: CalculationInputs,
  code: string,
  patch: Partial<{ active: boolean; minSubtotal: number; value: number; type: "percent" | "fixed" }>,
): CalculationInputs {
  const clone = structuredClone(inputs);
  const promo = clone.priceSnapshot.promos.find((item) => item.code === code);
  if (!promo) throw new Error(`нет промокода ${code}`);
  Object.assign(promo, patch);
  return clone;
}

function publishedPromo(code: string) {
  const fromContent = PROMOS.find((item) => item.code === code);
  if (!fromContent) throw new Error(`нет промокода ${code} в content`);
  return fromContent;
}

/** Базовая кухня с заданным промокодом (параметры по умолчанию из Block 4). */
function kitchen(promoCode: string): KitchenConfig {
  return { ...defaultKitchen(), promoCode };
}

/** Конфиг с известной ручной суммой: см. PROJECT (Block 5) — raw 39 359 ₽. */
function minOrderKitchen(promoCode: string): KitchenConfig {
  const golden = GOLDEN_SCENARIOS.find((item) => item.name === "kitchen-min-order");
  if (!golden) throw new Error("нет golden kitchen-min-order");
  return { ...golden.config, promoCode } as KitchenConfig;
}

describe("TG-M1: опубликованные правила промокодов соответствуют ожидаемым", () => {
  it("контстанты прайса и определения DEMO10 / WARDROBE7 / DEMO5000", () => {
    expect(PRICING.rounding).toBe(100);
    expect(PRICING.minOrder).toBe(45000);
    expect(publishedPromo("DEMO10")).toMatchObject({
      type: "percent",
      value: 10,
      minSubtotal: 120000,
      maxDiscount: 30000,
      appliesTo: ["kitchen"],
      active: true,
    });
    expect(publishedPromo("WARDROBE7")).toMatchObject({
      type: "percent",
      value: 7,
      minSubtotal: 70000,
      maxDiscount: 18000,
      appliesTo: ["wardrobe"],
    });
    expect(publishedPromo("DEMO5000")).toMatchObject({
      type: "fixed",
      value: 5000,
      minSubtotal: 90000,
      appliesTo: "all",
    });
  });
});

describe("TG-M1: ворота допуска (F-PR-19)", () => {
  it("1. неизвестный промокод → invalid, скидки нет", async () => {
    const config = kitchen("NOSUCH2026");
    const inputs = await inputsFor(config);
    const b = calculateBreakdown(config, inputs);
    const subtotal = manualSubtotal(b);

    expect(b.subtotal).toBe(subtotal);
    expect(b.discount).toBe(0);
    expect(b.promo).toMatchObject({
      code: "NOSUCH2026",
      valid: false,
      discount: 0,
      title: "Промокод не найден",
      reason: "Проверьте код. Демо-промокоды указаны в разделе «Предложения».",
    });
    expect(b.total).toBe(subtotal);
  });

  it("2. неактивный промокод → invalid, скидки нет", async () => {
    const config = kitchen("DEMO10");
    const plain = await inputsFor(config);
    const inputs = withPromo(plain, "DEMO10", { active: false });
    const b = calculateBreakdown(config, inputs);
    const subtotal = manualSubtotal(b);

    expect(b.subtotal).toBe(subtotal);
    expect(b.discount).toBe(0);
    expect(b.promo).toMatchObject({
      code: "DEMO10",
      valid: false,
      discount: 0,
      reason: "Промокод неактивен.",
    });
    expect(b.total).toBe(subtotal);
  });

  it("3. промокод другой категории (кухня + WARDROBE7) → invalid", async () => {
    const config = kitchen("WARDROBE7");
    const inputs = await inputsFor(config);
    const b = calculateBreakdown(config, inputs);
    const subtotal = manualSubtotal(b);

    expect(publishedPromo("WARDROBE7").appliesTo).toEqual(["wardrobe"]);
    expect(b.discount).toBe(0);
    expect(b.promo).toMatchObject({
      code: "WARDROBE7",
      valid: false,
      discount: 0,
      reason: "Промокод действует для другой категории мебели.",
    });
    expect(b.total).toBe(subtotal);
  });

  it("4. сумма ниже minSubtotal → invalid, скидки нет", async () => {
    const config = kitchen("DEMO10");
    const plain = await inputsFor(config);
    const baseline = calculateBreakdown(config, plain);
    const subtotal = manualSubtotal(baseline);

    const inputs = withPromo(plain, "DEMO10", { minSubtotal: subtotal + 100 });
    const b = calculateBreakdown(config, inputs);

    expect(b.subtotal).toBe(subtotal);
    expect(b.discount).toBe(0);
    expect(b.promo).toMatchObject({
      valid: false,
      discount: 0,
      reason: `Промокод действует при предварительной стоимости от ${subtotal + 100} ₽.`,
    });
    expect(b.total).toBe(subtotal);
  });

  it("5. сумма ровно на пороге minSubtotal → скидка применяется (строгое «<»)", async () => {
    // Порог подвиган под измеренный subtotal самой конфигурации — проверяется
    // семантика ворот, а не конкретное число.
    const config = kitchen("DEMO10");
    const plain = await inputsFor(config);
    const baseline = calculateBreakdown(config, plain);
    const subtotal = manualSubtotal(baseline);

    const inputs = withPromo(plain, "DEMO10", { minSubtotal: subtotal });
    const b = calculateBreakdown(config, inputs);

    const expectedDiscount = manualDiscount(subtotal, {
      type: "percent",
      value: 10,
      maxDiscount: 30000,
    });
    expect(b.subtotal).toBe(subtotal);
    expect(b.discount).toBe(expectedDiscount);
    expect(b.total).toBe(subtotal - expectedDiscount);
    expect(b.promo).toMatchObject({ valid: true, discount: expectedDiscount });
  });
});

describe("TG-M1: расчёт скидки (F-PR-20)", () => {
  it("6. percent-промокод: скидка = 10 %, округлена до 100 ₽", async () => {
    const config = kitchen("DEMO10");
    const plain = await inputsFor(config);
    const inputs = withPromo(plain, "DEMO10", { minSubtotal: 0 });
    const b = calculateBreakdown(config, inputs);
    const subtotal = manualSubtotal(b);

    // Ручной расчёт: 10 % от subtotal, не выше cap 30 000 ₽, затем шаг 100 ₽.
    const percent = (subtotal * 10) / 100;
    const expected = Math.round(Math.min(percent, 30000) / 100) * 100;

    expect(b.subtotal).toBe(subtotal);
    expect(b.discount).toBe(expected);
    expect(b.discount % PRICING.rounding).toBe(0);
    expect(b.total).toBe(subtotal - expected);
    expect(b.total % PRICING.rounding).toBe(0);
    expect(b.promo).toMatchObject({ code: "DEMO10", valid: true });
  });

  it("7. fixed-промокод DEMO5000: скидка ровно 5 000 ₽", async () => {
    // Ветка type:"fixed" ранее не выполнялась ни одним тестом (TG-M1).
    const config = kitchen("DEMO5000");
    const plain = await inputsFor(config);
    const inputs = withPromo(plain, "DEMO5000", { minSubtotal: 0 });
    const b = calculateBreakdown(config, inputs);
    const subtotal = manualSubtotal(b);

    const expected = manualDiscount(subtotal, { type: "fixed", value: 5000 });
    expect(expected).toBe(5000); // round100(min(5 000, subtotal)) = 5 000
    expect(b.discount).toBe(5000);
    expect(b.total).toBe(subtotal - 5000);
    expect(b.promo).toMatchObject({ code: "DEMO5000", valid: true, discount: 5000 });
  });

  it("8. ограничение maxDiscount (cap 30 000 ₽) срабатывает", async () => {
    // Конфиг известен и проверен вручную в Block 5 (§2.2):
    // Σ компонент 281 593 × 1.12 = 315 384.16 → round100 → subtotal 315 400.
    const golden = GOLDEN_SCENARIOS.find((item) => item.name === "kitchen-promo-complexity");
    if (!golden) throw new Error("нет golden kitchen-promo-complexity");
    const config = { ...golden.config, promoCode: "DEMO10" } as KitchenConfig;
    const inputs = await inputsFor(config);
    const b = calculateBreakdown(config, inputs);
    const subtotal = manualSubtotal(b);

    expect(subtotal).toBe(315400); // подтверждено ручным расчётом Block 5
    const uncapped = Math.round(((subtotal * 10) / 100) / 100) * 100; // 31 500
    expect(uncapped).toBe(31500);
    expect(uncapped).toBeGreaterThan(30000);

    expect(b.discount).toBe(30000); // cap
    expect(b.total).toBe(285400);
    expect(b.promo).toMatchObject({ code: "DEMO10", valid: true, discount: 30000 });
  });

  it("9. скидка больше стоимости заказа → итог 0, не отрицательный", async () => {
    // Конфиг с ручной суммой 45 000 ₽ (Block 5 §2.3): пол минимального заказа.
    const config = minOrderKitchen("DEMO5000");
    const plain = await inputsFor(config);
    // fixed-скидка 60 000 ₽ превышает стоимость заказа 45 000 ₽.
    const inputs = withPromo(plain, "DEMO5000", { minSubtotal: 0, value: 60000 });
    const b = calculateBreakdown(config, inputs);
    const subtotal = manualSubtotal(b);

    expect(subtotal).toBe(45000);
    expect(subtotal).toBeLessThan(60000);
    // min(discount, subtotal) → скидка равна всей сумме заказа.
    expect(b.discount).toBe(subtotal);
    expect(b.total).toBe(0);
    expect(b.total).toBeGreaterThanOrEqual(0);
    expect(b.promo).toMatchObject({ valid: true, discount: subtotal });
  });

  it("10. итоговая последовательность: minOrder → ворота → скидка → округление", async () => {
    // golden kitchen-min-order: неокруглённая сумма 39 359 ₽ < minOrder 45 000 ₽
    // (подтверждено в Block 5 §2.3) → subtotal доведён до 45 000 ₽ ДО ворот.
    const config = minOrderKitchen("DEMO10");
    const plain = await inputsFor(config);
    const baseline = calculateBreakdown(config, plain);

    expect(baseline.minOrderApplied).toBe(true);
    expect(baseline.subtotal).toBe(PRICING.minOrder);
    expect(baseline.total).toBe(PRICING.minOrder);

    // Порог ровно на доведённой сумме: ворота сравнивают subtotal (45 000),
    // а не неокруглённое raw (39 359).
    const atThreshold = calculateBreakdown(config, withPromo(plain, "DEMO10", { minSubtotal: 45000 }));
    const expectedDiscount = manualDiscount(45000, { type: "percent", value: 10, maxDiscount: 30000 });
    expect(expectedDiscount).toBe(4500);
    expect(atThreshold.discount).toBe(4500);
    expect(atThreshold.total).toBe(40500);

    // Ниже доведённой суммы на 100 ₽ → скидки нет, итог по-прежнему 45 000.
    const below = calculateBreakdown(config, withPromo(plain, "DEMO10", { minSubtotal: 45100 }));
    expect(below.discount).toBe(0);
    expect(below.total).toBe(PRICING.minOrder);

    // Отрицательного итога не бывает: total = round100(max(0, subtotal − discount)).
    expect(below.total).toBeGreaterThanOrEqual(0);
    expect(atThreshold.total).toBeGreaterThanOrEqual(0);
  });
});
