import { describe, expect, it } from "vitest";

import { defaultWardrobe } from "./defaults";
import { calculatePrice } from "./pricing";
import { validateWardrobe } from "./validation";
import { wardrobeDrawerCount, wardrobeRodCount } from "./wardrobe-components";
import type { WardrobeConfig } from "./types";

function config(overrides: Partial<WardrobeConfig> = {}): WardrobeConfig {
  return { ...defaultWardrobe(), ...overrides };
}

function withDrawers(count: number): WardrobeConfig {
  const base = config();
  return {
    ...base,
    sections: base.sections.map((section, index) =>
      index === 1 ? { ...section, drawers: count } : section,
    ),
  };
}

describe("этап 5: ящики шкафа", () => {
  it("без ящиков счётчик равен нулю", () => {
    const base = config();
    const noDrawers = {
      ...base,
      sections: base.sections.map((section) => ({ ...section, drawers: 0 })),
    };
    expect(wardrobeDrawerCount(noDrawers)).toBe(0);
    expect(wardrobeDrawerCount(base)).toBe(3);
  });

  it("стоимость растёт ровно на стоимость ящиков", () => {
    const base = withDrawers(3);
    const none = withDrawers(0);
    const one = withDrawers(1);
    const difference = calculatePrice(base).fittingsCost - calculatePrice(none).fittingsCost;
    expect(difference).toBe(3 * 6200 + 3 * 650);
    expect(calculatePrice(one).fittingsCost - calculatePrice(none).fittingsCost).toBe(6200 + 650);
  });

  it("ширина секции не меняет поштучный тариф ящика", () => {
    const narrow = config({ widthMm: 1200, partition: null, sections: [{ id: "s-1", shelves: [], rods: [], drawers: 3 }] });
    const wide = config({ widthMm: 2400, partition: { positionMm: 1200 }, sections: config().sections.map((section, index) => index === 1 ? { ...section, drawers: 3 } : { ...section, drawers: 0 }) });
    expect(wardrobeDrawerCount(narrow)).toBe(3);
    expect(wardrobeDrawerCount(wide)).toBe(3);
  });

  it("недопустимый блок ящиков отклоняется", () => {
    const base = config();
    const invalid = {
      ...base,
      sections: base.sections.map((section, index) =>
        index === 1
          ? {
              ...section,
              drawers: 3,
              drawerBlock: {
                topMm: 900,
                frontHeightsMm: [300, 300, 300],
                frontType: "overlay" as const,
                box: {
                  sideThicknessMm: 16 as const,
                  frontThicknessMm: 16 as const,
                  backThicknessMm: 16 as const,
                  bottomThicknessMm: 3 as const,
                  bottomMount: "overlay-bottom" as const,
                },
                runner: {
                  type: "ball-bearing-side" as const,
                  lengthMm: 500 as const,
                  softClose: true,
                  loadClass: "standard" as const,
                },
              },
            }
          : section,
      ),
    };
    expect(validateWardrobe(invalid).some((issue) => issue.path.endsWith("drawerBlock"))).toBe(true);
  });
});

describe("этап 6: штанги шкафа", () => {
  it("без штанг счётчик равен нулю", () => {
    const base = config();
    const noRods = {
      ...base,
      sections: base.sections.map((section) => ({ ...section, rods: [] })),
    };
    expect(wardrobeRodCount(noRods)).toBe(0);
    expect(wardrobeRodCount(base)).toBe(1);
  });

  it("стоимость растёт ровно на стоимость штанги", () => {
    const base = config();
    const none = {
      ...base,
      sections: base.sections.map((section) => ({ ...section, rods: [] })),
    };
    const two = {
      ...base,
      sections: base.sections.map((section, index) =>
        index === 0 ? { ...section, rods: [160, 210] } : section,
      ),
    };
    expect(calculatePrice(two).optionsCost - calculatePrice(none).optionsCost).toBe(2 * 2400);
  });

  it("выдвижная штанга считается отдельной позицией", () => {
    const base = config({ fullDepth: 400 });
    const noRods = {
      ...base,
      sections: base.sections.map((section) => ({ ...section, rods: [] })),
    };
    const pullout = {
      ...noRods,
      sections: noRods.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              rodType: "pullout" as const,
              pulloutRod: {
                lengthMm: 300 as const,
                execution: "wire" as const,
                loadClass: "budget" as const,
              },
            }
          : section,
      ),
    };
    expect(wardrobeRodCount(pullout)).toBe(1);
    expect(calculatePrice(pullout).optionsCost - calculatePrice(noRods).optionsCost).toBe(2400);
  });

  it("выдвижная штанга при глубине вне 250–450 мм отклоняется", () => {
    const base = config();
    const invalid = {
      ...base,
      sections: base.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              rodType: "pullout" as const,
              pulloutRod: {
                lengthMm: 300 as const,
                execution: "wire" as const,
                loadClass: "budget" as const,
              },
            }
          : section,
      ),
    };
    expect(validateWardrobe(invalid).some((issue) => issue.path.endsWith("pulloutRod"))).toBe(true);
  });
});
