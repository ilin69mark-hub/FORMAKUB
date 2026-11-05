import { describe, expect, it } from "vitest";
import { PRICING } from "@/content/pricing";
import {
  defaultDressingRoom,
  defaultKitchen,
  defaultWardrobe,
  makeKitchenModule,
} from "./defaults";
import {
  calculateKitchenPrice,
  calculatePrice,
  calculateWardrobePrice,
  formatRange,
  formatRub,
  kitchenTotalWidth,
  wardrobeWidth,
} from "./pricing";
import type { WardrobeConfig } from "./types";

describe("kitchen pricing", () => {
  it("returns a complete breakdown for the default kitchen", () => {
    const config = defaultKitchen();
    const price = calculateKitchenPrice(config);

    expect(price.currency).toBe("RUB");
    expect(price.total).toBeGreaterThanOrEqual(PRICING.minOrder);
    expect(price.subtotal).toBeGreaterThanOrEqual(PRICING.minOrder);
    expect(price.lines.length).toBeGreaterThanOrEqual(5);
    expect(price.disclaimer).toContain("Предварительный расчёт");
    expect(price.total).toBe(price.subtotal - price.discount);
  });

  it("increases the total when the facade material becomes more expensive", () => {
    const base = defaultKitchen();
    const premium = {
      ...base,
      facadeMaterial: "solid" as const,
      facadeFinish: "oak",
    };

    expect(calculateKitchenPrice(premium).total).toBeGreaterThan(
      calculateKitchenPrice(base).total,
    );
  });

  it("increases the total when a module gets wider", () => {
    const base = defaultKitchen();
    const wider = {
      ...base,
      modules: base.modules.map((module) =>
        module.type === "drawers" ? { ...module, width: 80 } : module,
      ),
    };

    expect(kitchenTotalWidth(wider)).toBeGreaterThan(kitchenTotalWidth(base));
    expect(calculateKitchenPrice(wider).total).toBeGreaterThan(
      calculateKitchenPrice(base).total,
    );
  });

  it("prices the bottle rack as the mechanism only — facade like other facades", () => {
    const base = defaultKitchen();
    const sinkModule = (bottle: boolean) =>
      makeKitchenModule("sink", {
        id: "m-sink",
        width: 120,
        shelves: 0,
        sinkStorage: [
          { shelves: 0, drawers: 0 },
          { shelves: 0, drawers: 0, ...(bottle ? { bottle: 15 as const } : {}) },
        ],
      });
    const withModules = (bottle: boolean) => ({
      ...base,
      modules: base.modules.map((module) =>
        module.type === "sink" ? sinkModule(bottle) : module,
      ),
    });
    const plain = calculateKitchenPrice(withModules(false));
    const bottle = calculateKitchenPrice(withModules(true));

    // Механизм бутылочницы — ровно его цена (с коэффициентом сложности
    // конфигурации); фасады/петли/перегородки/полки не меняются: фасад секции
    // считается по площади модуля как остальные, перегородка реза — как
    // корпус, отдельной опцией не тарифицируется.
    const factor =
      1 +
      Math.max(0, base.modules.length - 3) *
        PRICING.kitchen.complexityPerExtraModule;
    const expected = Math.round(PRICING.kitchen.bottleRack * factor);
    expect(bottle.subtotal - plain.subtotal).toBe(expected);
    expect(bottle.total - plain.total).toBe(expected);
  });

  it("applies an eligible percentage promo with a cap", () => {
    const config = { ...defaultKitchen(), promoCode: "DEMO10" };
    const price = calculateKitchenPrice(config);

    expect(price.promo?.valid).toBe(true);
    expect(price.discount).toBeGreaterThan(0);
    expect(price.discount).toBeLessThanOrEqual(30000);
    expect(price.total).toBe(price.subtotal - price.discount);
  });

  it("reports an unknown promo without changing the total", () => {
    const plain = calculateKitchenPrice(defaultKitchen());
    const price = calculateKitchenPrice({
      ...defaultKitchen(),
      promoCode: "NOPE",
    });

    expect(price.promo?.valid).toBe(false);
    expect(price.discount).toBe(0);
    expect(price.total).toBe(plain.total);
  });

  it("rejects a kitchen promo for a wardrobe", () => {
    const config = {
      ...defaultWardrobe(),
      promoCode: "DEMO10",
    };
    const price = calculateWardrobePrice(config);

    expect(price.promo?.valid).toBe(false);
    expect(price.discount).toBe(0);
  });
});

describe("wardrobe pricing", () => {
  it("returns a complete breakdown for the default wardrobe", () => {
    const price = calculateWardrobePrice(defaultWardrobe());

    expect(price.total).toBeGreaterThanOrEqual(PRICING.minOrder);
    expect(price.lines.some((line) => line.label === "Корпус")).toBe(true);
    expect(price.lines.some((line) => line.label === "Фасады")).toBe(true);
    expect(price.minOrderApplied).toBe(false);
  });

  it("applies the minimum order to a small wardrobe", () => {
    const small: WardrobeConfig = {
      ...defaultWardrobe(),
      height: 180,
      sections: [
        {
          id: "s-1",
          width: 60,
          shelves: [],
          rods: [],
          drawers: 0,
        },
      ],
      bodyMaterial: "ldsp",
      bodyFinish: "milk",
      facadeMaterial: "ldsp",
      facadeFinish: "milk",
      plinth: false,
      ledLighting: false,
    };
    const price = calculateWardrobePrice(small);

    expect(price.minOrderApplied).toBe(true);
    expect(price.subtotal).toBe(PRICING.minOrder);
    expect(price.total).toBe(PRICING.minOrder);
  });

  it("calculates total width from all sections", () => {
    expect(wardrobeWidth(defaultWardrobe())).toBe(240);
  });

  it("prices the dressing preset", () => {
    const price = calculatePrice(defaultDressingRoom());
    expect(price.total).toBeGreaterThan(0);
  });
});

describe("pricing helpers", () => {
  it("formats rubles and ranges consistently", () => {
    expect(formatRub(45000)).toContain("45");
    expect(formatRub(45000)).toContain("₽");
    expect(formatRange(100000)).toContain("—");
  });

  it("adds a generated module with preset dimensions", () => {
    const item = makeKitchenModule("wall");
    expect(item.type).toBe("wall");
    expect(item.width).toBeGreaterThan(0);
    expect(item.depth).toBeLessThan(60);
  });
});
