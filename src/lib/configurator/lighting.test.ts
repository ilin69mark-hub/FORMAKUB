import { describe, expect, it } from "vitest";

import { LED_END_MARGIN_CM } from "@/content/lighting";
import { computeLighting } from "./lighting";
import { calculateKitchenPrice } from "./pricing";
import { defaultKitchen, makeKitchenModule } from "./defaults";
import type { KitchenConfig, KitchenModule } from "./types";

function withModules(modules: KitchenModule[]): KitchenConfig {
  return { ...defaultKitchen(), modules };
}

describe("lighting plan", () => {
  it("takes the length from the actual upper row minus mounting gaps", () => {
    const config = withModules([
      makeKitchenModule("wall", { id: "w1", width: 60 }),
      makeKitchenModule("wall", { id: "w2", width: 60 }),
    ]);
    const plan = computeLighting(config);

    const expected =
      (60 - LED_END_MARGIN_CM * 2 + (60 - LED_END_MARGIN_CM * 2)) / 100;
    expect(plan.lengthM).toBeCloseTo(expected, 3);
    expect(plan.segments).toBe(2);
    expect(plan.endCaps).toBe(4);
    // стыковка двух шкафов + точка подключения
    expect(plan.connectors).toBe(1 + plan.runs);
  });

  it("excludes sections blocked by tall cabinets", () => {
    const config = withModules([
      makeKitchenModule("tall", { id: "t", width: 60, height: 220 }),
      makeKitchenModule("base", { id: "b", width: 60 }),
      makeKitchenModule("wall", { id: "w", width: 120 }),
    ]);
    const plan = computeLighting(config);

    expect(plan.excludedM).toBeGreaterThan(0);
    // Без пенала под шкафом было бы 1.16 м.
    expect(plan.lengthM).toBeLessThan(1.16);
    expect(plan.notes.some((note) => note.includes("недоступные"))).toBe(true);
  });

  it("computes power, psu with 20–25% reserve and current", () => {
    const config = withModules([
      makeKitchenModule("wall", { id: "w", width: 100 }),
    ]);
    const plan = computeLighting(config);
    const lengthM = (100 - LED_END_MARGIN_CM * 2) / 100;

    expect(plan.lengthM).toBeCloseTo(lengthM, 3);
    expect(plan.powerW).toBeCloseTo(lengthM * 9.6, 1);
    expect(plan.psuRequiredW).toBeCloseTo(plan.powerW * 1.25, 2);
    expect(plan.psuW).toBeGreaterThanOrEqual(plan.psuRequiredW);
    expect(plan.currentA).toBeCloseTo(plan.powerW / 24, 2);
  });

  it("splits runs and adds feed points when the strip reaches its max length", () => {
    const base = withModules([
      makeKitchenModule("wall", { id: "w1", width: 100 }),
      makeKitchenModule("wall", { id: "w2", width: 100 }),
      makeKitchenModule("wall", { id: "w3", width: 100 }),
    ]);
    const config: KitchenConfig = {
      ...base,
      lighting: { ...base.lighting, voltage: 12, powerPerMeter: 19.2 },
    };
    const plan = computeLighting(config);

    expect(plan.stripSource).toBe("preliminary");
    expect(plan.runs).toBeGreaterThan(1);
    expect(plan.feedPoints).toBe(plan.runs);
    expect(plan.notes.some((note) => note.includes("точек питания"))).toBe(true);
    expect(plan.notes.some((note) => note.includes("предварительные"))).toBe(true);
  });

  it("changes the glow colour with the colour temperature", () => {
    const config = defaultKitchen();
    const warm = computeLighting({
      ...config,
      lighting: { ...config.lighting, colorTemp: 2700 },
    });
    const cold = computeLighting({
      ...config,
      lighting: { ...config.lighting, colorTemp: 6000 },
    });

    expect(warm.hex).not.toBe(cold.hex);
    expect(warm.hex).toMatch(/^#[0-9a-f]{6}$/i);
    expect(cold.hex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("lists every component in the price specification", () => {
    const config = defaultKitchen();
    const plan = computeLighting(config);
    const price = calculateKitchenPrice(config);

    const header = price.lines.find(
      (line) => line.label === "Подсветка верхнего ряда",
    );
    expect(header).toBeDefined();
    expect(header?.amount).toBe(Math.round(plan.cost));
    expect(plan.components.length).toBeGreaterThanOrEqual(7);

    for (const component of plan.components) {
      const line = price.lines.find(
        (item) => item.label === `— ${component.label}`,
      );
      expect(line, component.label).toBeDefined();
      expect(line?.amount).toBe(Math.round(component.amount));
    }
  });

  it("removes lighting cost and lines when the option is off", () => {
    const on = calculateKitchenPrice(defaultKitchen());
    const off = calculateKitchenPrice({
      ...defaultKitchen(),
      underCabinetLighting: false,
    });

    expect(
      off.lines.some((line) => line.label === "Подсветка верхнего ряда"),
    ).toBe(false);
    expect(on.total).toBeGreaterThan(off.total);
  });
});
