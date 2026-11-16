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
    const base = {
      ...defaultKitchen(),
      facadeMaterial: "ldsp" as const,
      facadeFinish: "milk",
    };
    const premium = {
      ...base,
      facadeMaterial: "mdf" as const,
      facadeFinish: "milk",
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

  it("не учитывает sink.shelves повторно при наличии sinkStorage (CA-T-511)", () => {
    const base = defaultKitchen();
    const sink = base.modules.find((module) => module.type === "sink")!;
    const withBoth = {
      ...base,
      modules: base.modules.map((module) =>
        module.id === sink.id
          ? {
              ...module,
              shelves: 2,
              sinkStorage: [{ shelves: 2, drawers: 0 }],
            }
          : module,
      ),
    };
    const price = calculateKitchenPrice(withBoth);
    expect(price.optionsCost).toBe(49821);
    expect(
      price.lines.find((line) => line.label === "Столешница, цоколь и опции")
        ?.detail,
    ).toContain("7 полок");
  });

  it("обычные полки без sinkStorage не меняются", () => {
    const price = calculateKitchenPrice(defaultKitchen());
    expect(price.optionsCost).toBe(49821);
    expect(
      price.lines.find((line) => line.label === "Столешница, цоколь и опции")
        ?.detail,
    ).toContain("7 полок");
  });

  it("sink.shelves без sinkStorage сохраняет прежнее поведение", () => {
    const base = defaultKitchen();
    const sink = base.modules.find((module) => module.type === "sink")!;
    const legacy = {
      ...base,
      modules: base.modules.map((module) =>
        module.id === sink.id ? { ...module, shelves: 2 } : module,
      ),
    };
    const price = calculateKitchenPrice(legacy);
    expect(price.optionsCost).toBe(52021);
    expect(
      price.lines.find((line) => line.label === "Столешница, цоколь и опции")
        ?.detail,
    ).toContain("9 полок");
  });

  it("при sinkStorage полки берутся из секций ровно один раз", () => {
    const base = defaultKitchen();
    const sink = base.modules.find((module) => module.type === "sink")!;
    const withStorage = (shelves: number, unitShelves: number) => ({
      ...base,
      modules: base.modules.map((module) =>
        module.id === sink.id
          ? {
              ...module,
              width: 120,
              shelves: unitShelves,
              sinkStorage: [{ shelves, drawers: 0 }],
            }
          : module,
      ),
    });
    const zero = calculateKitchenPrice(withStorage(0, 0));
    const sectionShelves = calculateKitchenPrice(withStorage(2, 0));
    const bothSources = calculateKitchenPrice(withStorage(2, 2));
    expect(sectionShelves.optionsCost).toBeGreaterThan(zero.optionsCost);
    expect(bothSources.optionsCost).toBe(sectionShelves.optionsCost);
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

    // Механизм бутылочницы тарифицируется отдельной опцией; фасады при этом
    // считаются по фактическим панелям секций (CA-T-517), поэтому разница
    // итогов не равна одной лишь цене механизма и здесь не проверяется.
    expect(bottle.optionsCost - plain.optionsCost).toBe(
      PRICING.kitchen.bottleRack,
    );
    expect(bottle.subtotal).toBeGreaterThan(plain.subtotal);
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
      widthMm: 600,
      partition: null,
      sections: [
        {
          id: "s-1",
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
