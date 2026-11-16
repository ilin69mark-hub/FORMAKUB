import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { KitchenOptionsPanel } from "@/components/configurator/SharedPanels";
import { applyBootstrap } from "@/lib/admin/bootstrap";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";

import type { CalculationBreakdown, CalculationInputs } from "./contract";
import { defaultKitchen, makeKitchenModule, normalizeKitchen } from "./defaults";
import { calculateBreakdown } from "./engine";
import type { KitchenConfig } from "./types";

/**
 * Stage 9 / Block 3 — LED / подсветка верхнего ряда, DOMAIN_CONFIRMED.
 *
 * Правила владельца продукта (зафиксированы в задании блока):
 *  R1 без верхних модулей переключатель недоступен;
 *  R2 без верхних модулей все LED-позиции равны нулю, стоимость 0 ₽
 *     (нельзя начислять блок питания, контроллер и прочее при нулевой длине);
 *  R3 с верхними модулями переключатель доступен;
 *  R4 при включённой подсветке считается полный фактический комплект;
 *  R5 при выключенной подсветке все LED-позиции обнуляются;
 *  R6 удаление последнего верхнего модуля при включённой подсветке гасит опцию;
 *  R7 повторное добавление верхних модулей возвращает доступность, но не
 *     включает подсветку самопроизвольно.
 *
 * UI-слой и расчётное ядро проверяются раздельно: наличие `disabled` в разметке
 * не доказывает корректность расчёта, и наоборот.
 *
 * В Block 4 дефекты R1/R2/R6 исправлены в production-коде, поэтому три
 * проверки, оформленные здесь ранее как `it.fails`, переведены в обычные.
 */

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-block3-led-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  await seedRulesSnapshotFixture();
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-2026.11.1",
    pricingLabel: "Stage 9 Block 3 LED",
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
  if (!entry) throw new Error(`нет PriceItem ${priceItemId}`);
  return entry.amount;
}

function lineOf(breakdown: CalculationBreakdown, id: string) {
  const line = breakdown.lines.find((item) => item.id === id);
  if (!line) throw new Error(`нет строки расчёта ${id}`);
  return line;
}

function ledLines(breakdown: CalculationBreakdown) {
  return breakdown.lines.filter((line) => line.id.startsWith("kitchen.lighting"));
}

function kitchenWithUpper(withUpper: boolean, lighting: boolean): KitchenConfig {
  const base = defaultKitchen();
  return {
    ...base,
    modules: withUpper
      ? base.modules
      : base.modules.filter((module) => module.type !== "wall"),
    underCabinetLighting: lighting,
  };
}

/** Разметка панели вариантов (UI-слой, без DOM-библиотек). */
function panelMarkup(config: KitchenConfig): string {
  return renderToStaticMarkup(
    createElement(KitchenOptionsPanel, { config, onChange: () => {} }),
  );
}

function lightingSwitchTag(markup: string): string {
  const label = 'aria-label="Подсветка верхнего ряда"';
  const labelAt = markup.indexOf(label);
  expect(labelAt, "переключатель подсветки не найден в разметке").toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<button", labelAt);
  const end = markup.indexOf(">", labelAt);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return markup.slice(start, end + 1);
}

describe("LED: расчётное ядро (DOMAIN_CONFIRMED)", () => {
  it("R2: без верхних модулей при включённой подсветке стоимость LED равна 0 ₽", async () => {
    const config = kitchenWithUpper(false, true);
    expect(config.modules.some((module) => module.type === "wall")).toBe(false);

    const inputs = await inputsFor(config);
    const breakdown = calculateBreakdown(config, inputs);
    const lines = ledLines(breakdown);
    const total = lines.reduce((sum, line) => sum + line.amount, 0);

    // Правило R2: ни ленты, ни профиля, ни блока питания, ни контроллера.
    // Исправлено в Block 4: lightingPlanned возвращает нулевой комплект при
    // lengthM = 0 (ранее начислялись psu + control = 1730 ₽, дефект D1).
    expect(total).toBe(0);
    for (const line of lines) {
      expect(line.amount, `строка ${line.id} должна быть нулевой`).toBe(0);
    }
    const psu = breakdown.lines.find((line) => line.id === "kitchen.lighting.psu");
    if (psu) {
      expect(psu).toMatchObject({ amount: 0, psuCount: 0, psuW: 0 });
    }
  });

  it("R2/R5: без верхних модулей при выключенной подсветке строк LED нет", async () => {
    const config = kitchenWithUpper(false, false);
    const inputs = await inputsFor(config);
    const breakdown = calculateBreakdown(config, inputs);
    expect(ledLines(breakdown)).toHaveLength(0);
    expect(breakdown.discount).toBe(0);
  });

  it("R4: при включённой подсветке считается полный комплект позиций", async () => {
    const config = kitchenWithUpper(true, true);
    const inputs = await inputsFor(config);
    const breakdown = calculateBreakdown(config, inputs);

    const required = [
      "kitchen.lighting",
      "kitchen.lighting.strip",
      "kitchen.lighting.profile",
      "kitchen.lighting.diffuser",
      "kitchen.lighting.endCaps",
      "kitchen.lighting.connectors",
      "kitchen.lighting.psu",
      "kitchen.lighting.control",
      "kitchen.lighting.install",
    ];
    for (const id of required) {
      const line = lineOf(breakdown, id);
      expect(line.amount, `строка ${id} должна быть ненулевой`).toBeGreaterThan(0);
    }

    // Длина верхнего ряда default-кухни: 2 модуля по 60 см, отступ 2 см
    // с каждой стороны, блокировок от пенала нет в этой конфигурации?
    // Пенал (tall) есть — поэтому длина берётся из расчёта и проверяется
    // инвариантом: длина строго положительная и не превышает ширину ряда.
    const lighting = lineOf(breakdown, "kitchen.lighting") as {
      amount: number;
      lengthM: number;
    };
    const upperWidthCm = config.modules
      .filter((module) => module.type === "wall")
      .reduce((sum, module) => sum + module.width, 0);
    expect(lighting.lengthM).toBeGreaterThan(0);
    expect(lighting.lengthM).toBeLessThanOrEqual(upperWidthCm / 100);

    // Лента и PSU считаются от фактической длины по тарифам входа.
    const strip = inputs.catalogs.find(
      (item) =>
        item.catalog === "ledStrip" &&
        (item.attrs as { power: number; voltage: number }).power === config.lighting.powerPerMeter &&
        (item.attrs as { power: number; voltage: number }).voltage === config.lighting.voltage,
    );
    if (!strip) throw new Error("нет подобранной ledStrip");
    expect(lineOf(breakdown, "kitchen.lighting.strip").amount).toBe(
      Math.round(
        lighting.lengthM *
          rateOf(
            inputs,
            (strip.priceRefs as Record<string, string>)["pricePerMeter"]!,
          ),
      ),
    );

    // Сумма компонентов равна строке «подсветка».
    const components = required
      .filter((id) => id !== "kitchen.lighting")
      .reduce((sum, id) => sum + lineOf(breakdown, id).amount, 0);
    expect(lineOf(breakdown, "kitchen.lighting").amount).toBe(components);
  });

  it("R5: при выключенной подсветке при наличии верхних модулей строк LED нет", async () => {
    const config = kitchenWithUpper(true, false);
    const inputs = await inputsFor(config);
    const breakdown = calculateBreakdown(config, inputs);
    expect(ledLines(breakdown)).toHaveLength(0);
  });

  it("R6: удаление последнего верхнего модуля гасит подсветку после нормализации", () => {
    const withUpper = kitchenWithUpper(true, true);
    const withoutUpper: KitchenConfig = {
      ...withUpper,
      modules: withUpper.modules.filter((module) => module.type !== "wall"),
    };
    expect(withoutUpper.underCabinetLighting).toBe(true);

    // KitchenPanel пропускает каждое изменение через normalizeKitchen
    // (KitchenPanel.tsx: onChange(normalizeKitchen(next))), поэтому правило R6
    // выполняется в normalizeKitchen: опция гасится, LED-позиции обнуляются
    // при расчёте (R2). Исправлено в Block 4.
    const normalized = normalizeKitchen(withoutUpper);
    expect(normalized.underCabinetLighting).toBe(false);

    // После гашения повторное нормализация идемпотентна.
    expect(normalizeKitchen(normalized).underCabinetLighting).toBe(false);
  });

  it("R7: повторное добавление верхних модулей не включает подсветку само", () => {
    const withUpper = kitchenWithUpper(true, true);
    const normalizedOff = normalizeKitchen({
      ...withUpper,
      modules: withUpper.modules.filter((module) => module.type !== "wall"),
    });
    expect(normalizedOff.underCabinetLighting).toBe(false);

    // Возвращаем верхний ряд: опция остаётся выключенной (переключатель при
    // этом снова становится доступным — проверяется в UI-блоке).
    const restored = normalizeKitchen({
      ...normalizedOff,
      modules: [...normalizedOff.modules, makeKitchenModule("wall", { id: "u-back", width: 60 })],
    });
    expect(restored.underCabinetLighting).toBe(false);
    expect(restored.modules.some((module) => module.type === "wall")).toBe(true);
  });
});

describe("LED: UI-доступность (разметка панели вариантов)", () => {
  it("R1: без верхних модулей переключатель недоступен и показана подсказка", () => {
    const markup = panelMarkup(kitchenWithUpper(false, true));
    const tag = lightingSwitchTag(markup);
    // Атрибут disabled, а не класс disabled:* из Tailwind.
    expect(tag).toMatch(/\sdisabled(\s|=|\/|>)/);
    expect(tag).toContain('aria-checked="false"');
    // Подсказка интерфейса о необходимости добавить верхние модули.
    expect(markup).toContain("Чтобы включить подсветку, добавьте верхние модули.");
    // Органы управления подсветкой недоступны без верхних модулей.
    expect(markup).not.toContain("Выключить подсветку");
    expect(markup).not.toContain("Напряжение");
  });

  it("R3/R7: с верхними модулями переключатель доступен и выключен по умолчанию", () => {
    const markup = panelMarkup(kitchenWithUpper(true, false));
    const tag = lightingSwitchTag(markup);
    expect(tag).not.toMatch(/\sdisabled(\s|=|\/|>)/);
    expect(tag).toContain('aria-checked="false"');
    expect(markup).not.toContain("Выключить подсветку");
  });

  it("R4: включённая подсветка показывает состояние и органы управления", () => {
    const markup = panelMarkup(kitchenWithUpper(true, true));
    const tag = lightingSwitchTag(markup);
    expect(tag).toContain('aria-checked="true"');
    expect(markup).toContain("Выключить подсветку");
    expect(markup).toContain("Включено");
    expect(markup).toContain("Напряжение");
  });
});
