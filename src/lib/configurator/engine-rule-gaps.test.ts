import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";

import type { CalculationBreakdown, CalculationInputs } from "./contract";
import { defaultKitchen, makeKitchenModule } from "./defaults";
import { calculateBreakdown } from "./engine";
import { kitchenCountertopWidth } from "./pricing";
import type { KitchenConfig } from "./types";

/**
 * Stage 9 / Block 3 — закрытие критических пробелов расчётного ядра.
 *
 * TG-C1  ограничение сложности `min(complexityMax, 1 + extra × perExtra)` на
 *        runtime-пути Engine;
 * TG-C2  порог `minSubtotal` промокода (строгое неравенство) на пути Engine;
 * TG-C3  правило столешницы для отдельного модуля `bottle` — вопрос владельцу
 *        из Block 3 получен ответ в Block 4 (см. блок TG-C3 ниже);
 * TG-H1  независимые копии supports/lighting внутри engine.ts;
 * TG-H2  негативные проверки guard-ов `fail()`.
 *
 * Источники ожидаемых значений (не реализация):
 *  - опубликованные бизнес-правила price-2026.11.1 → `src/content/pricing.ts`
 *    (rounding 100 ₽, minOrder 45 000 ₽, complexityPerExtraModule 0.02,
 *    complexityMax 1.12, DEMO10: 10 % / minSubtotal 120 000 ₽ / cap 30 000 ₽);
 *  - FORMULA_AND_ALGORITHM_CATALOG: F-PR-17 (сложность), F-PR-19/20 (промо),
 *    F-SL-01/02 (опоры), F-SL-04/05/06 (длина, разбивка бегов, PSU);
 *  - immutable parameter manifest (endMarginCm, psuMargin, psuRatings,
 *    minLegSpacingCm, moduleLoadKg.*) и каталоги PriceItem — это *данные*
 *    входа, а не логика под тестом.
 */

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-block3-gaps-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  await seedRulesSnapshotFixture();
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-2026.11.1",
    pricingLabel: "Stage 9 Block 3 gaps",
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

function rateOf(inputs: CalculationInputs, priceItemId: string): number {
  const entry = inputs.priceSnapshot.snapshot.find(
    (item) => item.priceItemId === priceItemId,
  );
  if (!entry) throw new Error(`нет PriceItem ${priceItemId} во входах`);
  return entry.amount;
}

function refRate(
  inputs: CalculationInputs,
  catalog: string,
  id: string,
  role: string,
): number {
  const item = inputs.catalogs.find(
    (candidate) => candidate.catalog === catalog && candidate.id === id,
  );
  if (!item) throw new Error(`нет CatalogItem ${catalog}:${id}`);
  const ref = (item.priceRefs as Record<string, string>)[role];
  if (!ref) throw new Error(`нет role ${role} у ${catalog}:${id}`);
  return rateOf(inputs, ref);
}

function lineAmount(breakdown: CalculationBreakdown, id: string): number {
  const line = breakdown.lines.find((item) => item.id === id);
  if (!line) throw new Error(`нет строки расчёта ${id}`);
  return line.amount;
}

function lineOf(breakdown: CalculationBreakdown, id: string) {
  const line = breakdown.lines.find((item) => item.id === id);
  if (!line) throw new Error(`нет строки расчёта ${id}`);
  return line;
}

/** Кухня из `count` модулей: нижний ряд — `base`, верхний — `wall`, 60 см. */
function kitchenWithModuleCount(count: number): KitchenConfig {
  const floorCount = Math.ceil(count / 2);
  const upperCount = count - floorCount;
  return {
    ...defaultKitchen(),
    modules: [
      ...Array.from({ length: floorCount }, (_, index) =>
        makeKitchenModule("base", { id: `f${index}`, width: 60 }),
      ),
      ...Array.from({ length: upperCount }, (_, index) =>
        makeKitchenModule("wall", { id: `u${index}`, width: 60 }),
      ),
    ],
    // Подсветка вне предмета проверки TG-C1.
    underCabinetLighting: false,
    promoCode: "",
  };
}

function withPromoThreshold(
  inputs: CalculationInputs,
  code: string,
  minSubtotal: number,
): CalculationInputs {
  const clone = structuredClone(inputs);
  const promo = clone.priceSnapshot.promos.find((item) => item.code === code);
  if (!promo) throw new Error(`нет промокода ${code} во входах`);
  promo.minSubtotal = minSubtotal;
  return clone;
}

describe("TG-C1: ограничение сложности конфигурации на пути Engine", () => {
  it("правила опубликованной версии соответствуют ожидаемым бизнес-правилам", async () => {
    const inputs = await inputsFor(defaultKitchen());
    expect(inputs.priceSnapshot.rules).toMatchObject({
      rounding: 100,
      minOrder: 45000,
      complexityPerExtraModule: 0.02,
      complexityMax: 1.12,
    });
  });

  // F-PR-17: extra = max(0, n − 3); factor = min(1.12, 1 + extra × 0.02).
  // Границы: 6 модулей → 1.06 (ниже ограничения), 9 → ровно 1.12 (граница),
  // 10 → 1.14 → ограничено 1.12, 25 → 1.44 → ограничено 1.12.
  const cases: Array<{ modules: number; factor: number; binds: boolean }> = [
    { modules: 6, factor: 1.06, binds: false },
    { modules: 9, factor: 1.12, binds: false },
    { modules: 10, factor: 1.12, binds: true },
    { modules: 25, factor: 1.12, binds: true },
  ];

  for (const testCase of cases) {
    it(`${testCase.modules} модулей: complexityFactor и итоговая стоимость`, async () => {
      const config = kitchenWithModuleCount(testCase.modules);
      expect(config.modules).toHaveLength(testCase.modules);

      const inputs = await inputsFor(config);
      const rules = inputs.priceSnapshot.rules;
      const breakdown = calculateBreakdown(config, inputs);

      const extra = Math.max(0, testCase.modules - 3);
      const uncapped = 1 + extra * rules.complexityPerExtraModule;
      const expectedFactor = Math.min(rules.complexityMax, uncapped);
      expect(expectedFactor).toBe(testCase.factor);
      expect(breakdown.complexityFactor).toBe(expectedFactor);

      // Итоговая стоимость пересчитывается из *опубликованных* правил:
      // Σ(база, корпус, фасады, фурнитура, опции) × factor → округление до
      // шага rounding → пол minOrder. Сумма берётся из строк расчёта; каждая
      // строка округлена до рубля, поэтому расхожшение с внутренними
      // неокруглёнными значениями ≤ 2 ₽ и не может изменить шаг 100 ₽.
      const componentIds = [
        "kitchen.base",
        "kitchen.body",
        "kitchen.fronts",
        "kitchen.fittings",
        "kitchen.options",
      ];
      const components = componentIds.reduce(
        (sum, id) => sum + lineAmount(breakdown, id),
        0,
      );
      const roundMoney = (value: number): number =>
        Math.max(0, Math.round(value / rules.rounding) * rules.rounding);
      const expectedSubtotal = Math.max(
        rules.minOrder,
        roundMoney(components * expectedFactor),
      );

      expect(breakdown.subtotal).toBe(expectedSubtotal);
      expect(breakdown.total).toBe(expectedSubtotal);
      expect(breakdown.discount).toBe(0);
      expect(breakdown.minOrderApplied).toBe(false);
      expect(breakdown.promo).toBeNull();

      if (testCase.binds) {
        // Доказательство, что ограничение реально меняет деньги: без min()
        // стоимость была бы другой. Именно это не ловил мутант M3.
        expect(roundMoney(components * uncapped)).not.toBe(expectedSubtotal);
        expect(uncapped).toBeGreaterThan(rules.complexityMax);
        expect(lineOf(breakdown, "kitchen.complexity")).toMatchObject({
          factor: 1.12,
        });
      }
    });
  }
});

describe("TG-C2: порог minSubtotal промокода на пути Engine", () => {
  it("сумма ниже опубликованного порога DEMO10: скидка не применяется", async () => {
    const config: KitchenConfig = {
      ...defaultKitchen(),
      modules: [
        makeKitchenModule("base", { id: "s-floor", width: 80 }),
        makeKitchenModule("wall", { id: "s-upper", width: 80 }),
      ],
      underCabinetLighting: false,
      promoCode: "DEMO10",
    };
    const inputs = await inputsFor(config);
    const breakdown = calculateBreakdown(config, inputs);
    const promo = inputs.priceSnapshot.promos.find((item) => item.code === "DEMO10");
    expect(promo).toMatchObject({ minSubtotal: 120000, value: 10, type: "percent" });

    // Предусловие: маленький заказ остаётся ниже опубликованного порога.
    expect(breakdown.subtotal).toBeLessThan(120000);

    expect(breakdown.discount).toBe(0);
    expect(breakdown.total).toBe(breakdown.subtotal);
    expect(breakdown.promo).toMatchObject({
      code: "DEMO10",
      valid: false,
      discount: 0,
    });
    expect(breakdown.promo?.reason).toContain("120000");
  });

  // F-PR-19: ворота `subtotal < minSubtotal` — строгое неравенство, поэтому
  // ровно на пороге промокод действует. Порог подвиган относительно
  // измеренного subtotal самой конфигурации: проверяется семантика ворот,
  // а не конкретное число 120 000.
  const boundaryCases: Array<{ shift: number; eligible: boolean }> = [
    { shift: 100, eligible: false },
    { shift: 0, eligible: true },
    { shift: -100, eligible: true },
  ];

  for (const testCase of boundaryCases) {
    const label =
      testCase.shift === 0
        ? "сумма ровно на пороге"
        : testCase.shift > 0
          ? "сумма ниже порога на 100 ₽"
          : "сумма выше порога на 100 ₽";
    it(`${label}: DEMO10 ${testCase.eligible ? "действует" : "не действует"}`, async () => {
      const config: KitchenConfig = {
        ...defaultKitchen(),
        modules: [
          makeKitchenModule("base", { id: "s-floor", width: 80 }),
          makeKitchenModule("wall", { id: "s-upper", width: 80 }),
        ],
        underCabinetLighting: false,
        promoCode: "DEMO10",
      };
      const plainInputs = await inputsFor(config);
      const subtotal = calculateBreakdown(config, plainInputs).subtotal;

      const inputs = withPromoThreshold(
        plainInputs,
        "DEMO10",
        subtotal + testCase.shift,
      );
      const breakdown = calculateBreakdown(config, inputs);

      // Промокод не меняет subtotal — только итог.
      expect(breakdown.subtotal).toBe(subtotal);

      if (testCase.eligible) {
        // F-PR-20: min(subtotal × 10 %, maxDiscount 30 000) → округление 100 ₽.
        const percent = (subtotal * 10) / 100;
        const expectedDiscount = Math.round(Math.min(percent, 30000) / 100) * 100;
        expect(expectedDiscount).toBeGreaterThan(0);
        expect(breakdown.discount).toBe(expectedDiscount);
        expect(breakdown.total).toBe(subtotal - expectedDiscount);
        expect(breakdown.promo).toMatchObject({ code: "DEMO10", valid: true });
      } else {
        expect(breakdown.discount).toBe(0);
        expect(breakdown.total).toBe(subtotal);
        expect(breakdown.promo).toMatchObject({
          code: "DEMO10",
          valid: false,
          discount: 0,
        });
      }
    });
  }
});

describe("TG-C3: столешница отдельного модуля bottle", () => {
  // Вопрос, заданный владельцу в Block 3 (сохранён для истории):
  // «Входит ли отдельный модуль `bottle` (бутылочница нижнего ряда) в длину
  //  столешницы?» — probe-замер дал 0.6 м против 0.8 м нижнего ряда (audit U-2).
  //
  // ОТВЕТ ПОЛУЧЕН (Block 4, DOMAIN_CONFIRMED): входит — по наружному габариту
  // (150/200/300 мм), а встроенный механизм `sinkStorage[].bottle` ширину не
  // добавляет. Реализация и полный набор тестов — `countertop-bottle.test.ts`;
  // здесь фиксируется пример владельца на исходной точке пробела.
  it("пример владельца: 600 + 800 + 150 мм → столешница 1550 мм", () => {
    const config: KitchenConfig = {
      ...defaultKitchen(),
      modules: [
        makeKitchenModule("base", { id: "q-600", width: 60 }),
        makeKitchenModule("base", { id: "q-800", width: 80 }),
        makeKitchenModule("bottle", { id: "q-bottle", width: 15 }),
      ],
      underCabinetLighting: false,
    };
    expect(kitchenCountertopWidth(config)).toBe(155);
  });

  it("пример владельца: мойка 800 мм со встроенной бутылочницей 200 мм → 800 мм", () => {
    const config: KitchenConfig = {
      ...defaultKitchen(),
      modules: [
        makeKitchenModule("sink", {
          id: "q-sink",
          width: 80,
          shelves: 0,
          sinkStorage: [{ shelves: 1, drawers: 0, bottle: 20 }],
        }),
      ],
      underCabinetLighting: false,
    };
    expect(kitchenCountertopWidth(config)).toBe(80);
  });
});

describe("TG-H1: независимые копии supports/lighting внутри engine.ts", () => {
  it("опоры: положения и количество по F-SL-01/02 для базового и пенала", async () => {
    const config: KitchenConfig = {
      ...defaultKitchen(),
      modules: [
        makeKitchenModule("base", { id: "h-base", width: 60 }),
        makeKitchenModule("tall", { id: "h-tall", width: 60, height: 220, shelves: 4 }),
        makeKitchenModule("wall", { id: "h-wall", width: 60 }),
      ],
      underCabinetLighting: false,
    };
    const inputs = await inputsFor(config);
    const system = inputs.catalogs.find(
      (item) => item.catalog === "supportSystem" && item.id === "standard",
    );
    if (!system) throw new Error("нет supportSystem:standard");
    const attrs = system.attrs as {
      edgeInsetCm: number;
      maxSpanCm: number;
      maxLoadKgPerLeg: number;
      clipsPerLeg: number;
      tallAnchorSpacingCm: number;
      tallCenterLegWidthCm: number;
    };
    expect(attrs).toMatchObject({
      edgeInsetCm: 4,
      maxSpanCm: 60,
      maxLoadKgPerLeg: 40,
      clipsPerLeg: 1,
      tallAnchorSpacingCm: 120,
      tallCenterLegWidthCm: 60,
    });
    const minLegSpacing = Number(inputs.parameters["engine.supports.minLegSpacingCm"]);
    const mergeTolerance = Number(inputs.parameters["engine.supports.mergeToleranceCm"]);
    expect(minLegSpacing).toBe(8);
    expect(mergeTolerance).toBe(1.5);

    // Ручной пересчёт по F-SL-01/02 (base 60 см):
    //   edgeInset = clamp(round(4), 1, floor(60/4)) = 4; inner = 52;
    //   span = max(2, ceil(52/60)+1) = 2;
    //   load = 55 × 60/60 = 55 → max(2, ceil(55/80)) = 2;
    //   maxBySpacing = floor(52/8)+1 = 7; target = 2 → count = 2;
    //   позиции: 4 и 56 → 2 опоры на переднюю стенку → 4 ноги.
    // Пенал 60 см (tall, высота 220):
    //   tallRule = 3 (60 ≥ tallCenterLegWidthCm); span = 2; load = 130 → 2;
    //   count = 3 → позиции 4 / 30 / 56 (tall-center сливается с span при
    //   |Δx| = 0 ≤ 1.5) → 3 опоры → 6 ног;
    //   anchors = max(1, ceil(220/120)) = 2.
    const breakdown = calculateBreakdown(config, inputs);
    const supports = lineOf(breakdown, "kitchen.supports");
    expect(supports).toMatchObject({ legs: 10, frontLegs: 5, backLegs: 5 });

    const legRate = refRate(inputs, "supportSystem", "standard", "legPrice");
    expect(legRate).toBeGreaterThan(0);
    expect(supports.amount).toBe(10 * legRate);

    const clips = lineOf(breakdown, "kitchen.supportClips");
    expect(clips).toMatchObject({ clips: 5, amount: 5 * refRate(inputs, "supportSystem", "standard", "clipPrice") });

    const anchors = lineOf(breakdown, "kitchen.supportAnchors");
    expect(anchors).toMatchObject({
      anchors: 2,
      amount: 2 * refRate(inputs, "supportSystem", "standard", "anchorPrice"),
    });

    // Опоры считаются только для нижнего ряда: верхний модуль не даёт ног.
    expect(breakdown.lines.filter((line) => line.id === "kitchen.supports")).toHaveLength(1);
  });

  it("опоры: верхняя граница maxBySpacing ограничивает count (параметрический тест)", async () => {
    const base = (width: number): KitchenConfig => ({
      ...defaultKitchen(),
      modules: [
        makeKitchenModule("base", { id: "c-base", width }),
        makeKitchenModule("wall", { id: "c-wall", width: 60 }),
      ],
      underCabinetLighting: false,
    });

    const inputs = await inputsFor(base(69));

    // Опубликованный minLegSpacingCm = 8: maxBySpacing = floor(61/8)+1 = 8,
    // target = span = ceil(61/60)+1 = 3 → count = 3 → позиции 4 / 34.5 / 65
    // → 3 опоры на переднюю стенку → 6 ног. Ветка ограничения не связана.
    const published = calculateBreakdown(base(69), inputs);
    expect(lineOf(published, "kitchen.supports")).toMatchObject({ legs: 6, frontLegs: 3 });

    // Гипотетический minLegSpacingCm = 60: maxBySpacing = floor(61/60)+1 = 2,
    // target = 3 → count = min(3, max(2, 2)) = 2 → только краевые позиции
    // 4 / 65 → 2 опоры → 4 ноги. Ровно эта ветка выживала у мутанта M17.
    const wide = structuredClone(inputs);
    (wide.parameters as Record<string, unknown>)["engine.supports.minLegSpacingCm"] = 60;
    const clamped = calculateBreakdown(base(69), wide);
    expect(lineOf(clamped, "kitchen.supports")).toMatchObject({ legs: 4, frontLegs: 2 });
  });

  it("подсветка: длина, разбивка бегов и комплект по F-SL-04/05/06 (короткий ряд)", async () => {
    const config: KitchenConfig = {
      ...defaultKitchen(),
      modules: [
        ...Array.from({ length: 3 }, (_, index) =>
          makeKitchenModule("base", { id: `l-f${index}`, width: 60 }),
        ),
        ...Array.from({ length: 3 }, (_, index) =>
          makeKitchenModule("wall", { id: `l-u${index}`, width: 60 }),
        ),
      ],
      underCabinetLighting: true,
    };
    const inputs = await inputsFor(config);
    const breakdown = calculateBreakdown(config, inputs);

    const endMargin = Number(inputs.parameters["engine.lighting.endMarginCm"]);
    const psuMargin = Number(inputs.parameters["engine.lighting.psuMargin"]);
    const ratings = inputs.parameters["engine.lighting.psuRatings"] as number[];
    expect(endMargin).toBe(2);
    expect(psuMargin).toBe(1.25);

    // F-SL-04: на каждый верхний модуль 60 − 2×2 = 56 см, 3 модуля → 1.68 м.
    // Блокировок нет (в нижнем ряду нет tall/oven).
    const lengthM = (3 * (60 - 2 * endMargin)) / 100;
    expect(lengthM).toBe(1.68);
    expect(lineOf(breakdown, "kitchen.lighting")).toMatchObject({ lengthM });

    const strip = inputs.catalogs.find(
      (item) =>
        item.catalog === "ledStrip" &&
        (item.attrs as { power: number; voltage: number }).power === 9.6 &&
        (item.attrs as { power: number; voltage: number }).voltage === 24,
    );
    if (!strip) throw new Error("нет ledStrip 9.6 Вт / 24 В");
    const stripAttrs = strip.attrs as { maxContinuousRunM: number; maxPsuW: number };
    expect(stripAttrs.maxContinuousRunM).toBe(7.5);

    // F-SL-05: 1.68 м ≤ 7.5 м → один бег; active = 3 →
    // endCaps = 3×2 = 6, connectors = (3−1) + 1 = 3.
    const runs = Math.ceil(lengthM / stripAttrs.maxContinuousRunM);
    expect(runs).toBe(1);
    expect(lineOf(breakdown, "kitchen.lighting.endCaps")).toMatchObject({
      endCaps: 6,
      amount: 6 * rateOf(inputs, "lighting.endCap"),
    });
    expect(lineOf(breakdown, "kitchen.lighting.connectors")).toMatchObject({
      connectors: 3,
      amount: 3 * rateOf(inputs, "lighting.connector"),
    });

    // F-SL-06: powerW = round(1.68 × 9.6, 1) = 16.1;
    // requiredW = round(16.1 × 1.25, 1) = 20.1 → первый номинал ≥ 20.1 = 30;
    // requiredW ≤ maxPsuW (150) → 1 блок питания.
    const powerW = Math.round(lengthM * 9.6 * 10) / 10;
    expect(powerW).toBe(16.1);
    const requiredW = Math.round(powerW * psuMargin * 10) / 10;
    expect(requiredW).toBe(20.1);
    const psuW = ratings.find((rating) => rating >= requiredW) ?? ratings[ratings.length - 1];
    expect(psuW).toBe(30);
    expect(requiredW).toBeLessThanOrEqual(stripAttrs.maxPsuW);
    expect(lineOf(breakdown, "kitchen.lighting.psu")).toMatchObject({
      psuW: 30,
      amount: rateOf(inputs, "lighting.psu.30"),
    });

    // Стоимости позиций — арифметика от тарифов входа.
    expect(lineOf(breakdown, "kitchen.lighting.strip")).toMatchObject({
      amount: Math.round(lengthM * refRate(inputs, "ledStrip", strip.id, "pricePerMeter")),
    });
    const profileId = config.lighting.profile;
    expect(lineOf(breakdown, "kitchen.lighting.profile")).toMatchObject({
      amount: Math.round(lengthM * refRate(inputs, "ledProfile", profileId, "ratePerMeter")),
      quantityM: 1.68,
    });
    const diffuserId = config.lighting.diffuser;
    expect(lineOf(breakdown, "kitchen.lighting.diffuser")).toMatchObject({
      amount: Math.round(lengthM * refRate(inputs, "ledDiffuser", diffuserId, "ratePerMeter")),
    });
    expect(lineOf(breakdown, "kitchen.lighting.control")).toMatchObject({
      amount: refRate(inputs, "ledControl", config.lighting.control, "price"),
    });
    expect(lineOf(breakdown, "kitchen.lighting.install")).toMatchObject({
      amount: Math.round(lengthM * rateOf(inputs, "lighting.install")),
    });

    // Сумма компонентов равна строке «подсветка» (все слагаемые целые).
    const componentIds = [
      "kitchen.lighting.strip",
      "kitchen.lighting.profile",
      "kitchen.lighting.diffuser",
      "kitchen.lighting.endCaps",
      "kitchen.lighting.connectors",
      "kitchen.lighting.psu",
      "kitchen.lighting.control",
      "kitchen.lighting.install",
    ];
    const components = componentIds.reduce(
      (sum, id) => sum + lineAmount(breakdown, id),
      0,
    );
    expect(lineAmount(breakdown, "kitchen.lighting")).toBe(components);
  });

  it("подсветка: длинный ряд разбивается на несколько бегов (ветка мутанта M18)", async () => {
    // 7 верхних модулей по 120 см: сегменты по 116 см → 8.12 м > 7.5 м
    // (maxContinuousRunM ленты 9.6 Вт/24 В) → ceil(8.12 / 7.5) = 2 бега.
    const config: KitchenConfig = {
      ...defaultKitchen(),
      modules: [
        ...Array.from({ length: 7 }, (_, index) =>
          makeKitchenModule("base", { id: `r-f${index}`, width: 120 }),
        ),
        ...Array.from({ length: 7 }, (_, index) =>
          makeKitchenModule("wall", { id: `r-u${index}`, width: 120 }),
        ),
      ],
      underCabinetLighting: true,
    };
    const inputs = await inputsFor(config);
    const breakdown = calculateBreakdown(config, inputs);

    const endMargin = Number(inputs.parameters["engine.lighting.endMarginCm"]);
    const segmentM = (120 - 2 * endMargin) / 100;
    const lengthM = Math.round(7 * segmentM * 1000) / 1000;
    expect(segmentM).toBe(1.16);
    expect(lengthM).toBe(8.12);

    const strip = inputs.catalogs.find(
      (item) =>
        item.catalog === "ledStrip" &&
        (item.attrs as { power: number; voltage: number }).power === 9.6 &&
        (item.attrs as { power: number; voltage: number }).voltage === 24,
    );
    if (!strip) throw new Error("нет ledStrip 9.6 Вт / 24 В");
    const maxRun = (strip.attrs as { maxContinuousRunM: number }).maxContinuousRunM;
    const runs = Math.ceil(lengthM / maxRun);
    expect(runs).toBe(2);

    expect(lineOf(breakdown, "kitchen.lighting")).toMatchObject({ lengthM });
    expect(lineOf(breakdown, "kitchen.lighting.connectors")).toMatchObject({
      // active = 7 → (7 − 1) + 2 бега = 8 соединителей.
      connectors: 6 + runs,
      amount: (6 + runs) * rateOf(inputs, "lighting.connector"),
    });
    expect(lineOf(breakdown, "kitchen.lighting.endCaps")).toMatchObject({
      endCaps: 14,
    });

    // PSU: powerW = round(8.12 × 9.6, 1) = 78; requiredW = round(78 × 1.25, 1)
    // = 97.5 → номинал 100 Вт; 97.5 ≤ maxPsuW 150 → 1 блок.
    const powerW = Math.round(lengthM * 9.6 * 10) / 10;
    const psuMargin = Number(inputs.parameters["engine.lighting.psuMargin"]);
    const requiredW = Math.round(powerW * psuMargin * 10) / 10;
    const ratings = inputs.parameters["engine.lighting.psuRatings"] as number[];
    expect(powerW).toBe(78);
    expect(requiredW).toBe(97.5);
    expect(ratings.find((rating) => rating >= requiredW)).toBe(100);
    expect(lineOf(breakdown, "kitchen.lighting.psu")).toMatchObject({ psuW: 100 });

    // Без разбивки строка ленты выросла бы: round(8.12 × тариф) ≠ round(7.5 × …)
    // здесь важно, что длина осталась фактической (8.12 м), а не усечённой.
    expect(lineOf(breakdown, "kitchen.lighting.strip")).toMatchObject({
      amount: Math.round(lengthM * refRate(inputs, "ledStrip", strip.id, "pricePerMeter")),
    });
  });
});

describe("TG-H2: негативные проверки guard-ов Engine (fail-closed)", () => {
  it("отсутствующий PriceItem → throw", async () => {
    const config = defaultKitchen();
    const inputs = await inputsFor(config);
    const broken = structuredClone(inputs);
    const snapshot = broken.priceSnapshot.snapshot as Array<{ priceItemId: string; amount: number }>;
    const index = snapshot.findIndex((item) => item.priceItemId === "kitchen.baseCost");
    expect(index).toBeGreaterThanOrEqual(0);
    snapshot.splice(index, 1);

    expect(() => calculateBreakdown(config, broken)).toThrow(
      /нет PriceItem "kitchen\.baseCost"/,
    );
  });

  it("дублирующийся PriceItem → throw", async () => {
    const config = defaultKitchen();
    const inputs = await inputsFor(config);
    const broken = structuredClone(inputs);
    const snapshot = broken.priceSnapshot.snapshot as Array<{ priceItemId: string; amount: number }>;
    snapshot.push({ ...snapshot[0] });

    expect(() => calculateBreakdown(config, broken)).toThrow(/дубликат PriceItem/);
  });

  it("отсутствующая роль priceRef → throw", async () => {
    const config = defaultKitchen();
    const inputs = await inputsFor(config);
    const broken = structuredClone(inputs);
    const item = broken.catalogs.find(
      (candidate) => candidate.catalog === "facadeMaterial" && candidate.id === config.facadeMaterial,
    );
    if (!item) throw new Error("нет CatalogItem facadeMaterial");
    delete (item.priceRefs as Record<string, string>)["ratePerSqm"];

    expect(() => calculateBreakdown(config, broken)).toThrow(
      /нет role "ratePerSqm"/,
    );
  });

  it("дублирующийся signedAdjustment → throw", async () => {
    const config = defaultKitchen();
    expect(config.plinth).toBe(true);
    const inputs = await inputsFor(config);
    const key = `plinth:${config.plinthMaterial}:${config.plinthFinish}`;
    const original = inputs.priceSnapshot.signedAdjustments.filter(
      (item) => item.key === key,
    );
    expect(original).toHaveLength(1);

    const broken = structuredClone(inputs);
    const adjustments = broken.priceSnapshot.signedAdjustments as Array<{ key: string; amount: number }>;
    adjustments.push({ ...original[0] });

    expect(() => calculateBreakdown(config, broken)).toThrow(
      /дубликат signedAdjustment/,
    );
  });

  it("невалидный rules.rounding → throw", async () => {
    const config = defaultKitchen();
    const inputs = await inputsFor(config);
    const broken = structuredClone(inputs);
    broken.priceSnapshot.rules.rounding = 0;

    expect(() => calculateBreakdown(config, broken)).toThrow(
      /rules\.rounding невалиден/,
    );
  });
});
