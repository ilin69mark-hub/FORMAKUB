import { describe, expect, it } from "vitest";

import { defaultWardrobe } from "./defaults";
import { calculatePrice } from "./pricing";
import { validateWardrobe } from "./validation";
import {
  WARDROBE_FACADE_DENSITY_KG_M2,
  WARDROBE_HINGE_BANDS,
  wardrobeDoorMassKg,
  wardrobeHingeCountForDoor,
  wardrobeHingeNormsFromRules,
  wardrobeHingePlan,
} from "./wardrobe-hinges";
import type { WardrobeConfig } from "./types";

function config(overrides: Partial<WardrobeConfig> = {}): WardrobeConfig {
  return { ...defaultWardrobe(), ...overrides };
}

function panel(widthMm: number, heightMm: number) {
  return { areaSqm: (widthMm * heightMm) / 1_000_000 };
}

describe("этап 4: петли шкафа", () => {
  it("масса двери считается по площади и плотности", () => {
    expect(wardrobeDoorMassKg(panel(500, 600), 16)).toBeCloseTo(3.45, 9);
    expect(wardrobeDoorMassKg(panel(500, 600), 19)).toBeCloseTo(4.44, 9);
    expect(wardrobeDoorMassKg(panel(500, 600), 22)).toBeCloseTo(5.04, 9);
    expect(WARDROBE_FACADE_DENSITY_KG_M2[16]).toBe(11.5);
  });

  it("небольшая дверь получает две петли", () => {
    expect(wardrobeHingeCountForDoor(600, 3.45)).toBe(2);
  });

  it("широкая дверь не меняет количество петель сама по себе", () => {
    expect(wardrobeHingeCountForDoor(600, 6.21)).toBe(2);
  });

  it("высокая дверь переходит на три петли", () => {
    expect(wardrobeHingeCountForDoor(1200, 8.28)).toBe(3);
  });

  it("материал и толщина влияют на массу и количество петель", () => {
    const light = wardrobeDoorMassKg(panel(600, 1200), 16);
    const heavy = wardrobeDoorMassKg(panel(600, 1200), 22);
    expect(light).toBeCloseTo(8.28, 9);
    expect(heavy).toBeCloseTo(12.096, 9);
    expect(wardrobeHingeCountForDoor(1200, light)).toBe(3);
    expect(wardrobeHingeCountForDoor(1200, heavy)).toBe(4);
  });

  it("план учитывает каждую дверь отдельно", () => {
    const base = config();
    const plan = wardrobeHingePlan(base);
    expect(plan.ok).toBe(true);
    expect(plan.doors).toHaveLength(2);
    expect(plan.doors[0]!.massKg).toBeCloseTo(31.88, 1);
    expect(plan.doors.every((door) => door.hingeCount === 6)).toBe(true);
    expect(plan.totalHinges).toBe(12);
    expect(plan.doors[0]!.widthWarning).toBe(true);
  });

  it("антресольная дверь считается отдельно", () => {
    const plan = wardrobeHingePlan(config({ antresol: { heightMm: 400 } }));
    expect(plan.doors).toHaveLength(3);
    expect(plan.doors.filter((door) => door.kind === "antresol")).toHaveLength(1);
    expect(plan.totalHinges).toBe(13);
  });

  it("две двери разного размера дают разное количество петель", () => {
    const plan = wardrobeHingePlan(config({ antresol: { heightMm: 400 } }));
    const main = plan.doors.find((door) => door.kind === "main")!;
    const antresol = plan.doors.find((door) => door.kind === "antresol")!;
    expect(main.hingeCount).toBe(5);
    expect(antresol.hingeCount).toBe(3);
  });

  it("переход размеров меняет количество петель", () => {
    expect(wardrobeHingeCountForDoor(600, 3.45)).toBe(2);
    expect(wardrobeHingeCountForDoor(1000, 5.75)).toBe(3);
  });

  it("превышение предельной массы помечается как UNKNOWN", () => {
    const tooHeavy = config({
      widthMm: 1800,
      partition: null,
      sections: [{ id: "s-1", shelves: [], rods: [], drawers: 0 }],
      facadeMaterial: "mdf_pvc",
      facadeThickness: 22,
      antresol: null,
    });
    const plan = wardrobeHingePlan(tooHeavy);
    expect(plan.ok).toBe(true);
    expect(plan.overloaded).toBe(true);
    expect(plan.reason).toBeDefined();
    expect(
      validateWardrobe(tooHeavy).some(
        (issue) => issue.path === "facadeHinges" && issue.severity === "warning",
      ),
    ).toBe(true);
  });

  it("стоимость петель равна количеству петель × тариф", () => {
    const base = config();
    const plan = wardrobeHingePlan(base);
    const price = calculatePrice(base);
    expect(plan.totalHinges).toBe(12);
    expect(price.fittingsCost).toBeGreaterThanOrEqual(12 * 390);
  });
});

describe("NEW-N1: нормы петель/плотностей из rulesSnapshot", () => {
  function ruleSet(mutate?: (rules: Array<{ id: string; value: unknown; valueType: string }>) => void) {
    const rules: Array<{ id: string; value: unknown; valueType: string }> = [
      ...([16, 19, 22] as const).map((thickness) => ({
        id: `rule-wardrobe-facade-density-${thickness}`,
        value: WARDROBE_FACADE_DENSITY_KG_M2[thickness],
        valueType: "decimal",
      })),
      ...WARDROBE_HINGE_BANDS.flatMap((band, index) => {
        const number = index + 1;
        return [
          { id: `rule-wardrobe-hinge-band-${number}-max-height`, value: band.maxHeightMm, valueType: "int" },
          { id: `rule-wardrobe-hinge-band-${number}-max-mass`, value: band.maxMassKg, valueType: "decimal" },
          { id: `rule-wardrobe-hinge-band-${number}-count`, value: band.count, valueType: "int" },
        ];
      }),
    ];
    mutate?.(rules);
    return rules;
  }

  it("разбирает полный набор и совпадает с кодовыми значениями (parity)", () => {
    const norms = wardrobeHingeNormsFromRules(ruleSet());
    expect(norms).not.toBeNull();
    expect(norms!.densities).toEqual(WARDROBE_FACADE_DENSITY_KG_M2);
    expect(norms!.bands).toEqual(WARDROBE_HINGE_BANDS);
  });

  it("fail-closed: отсутствие, неверный тип и немонотонные полосы → null", () => {
    expect(wardrobeHingeNormsFromRules(undefined)).toBeNull();
    expect(wardrobeHingeNormsFromRules([])).toBeNull();
    expect(
      wardrobeHingeNormsFromRules(
        ruleSet((rules) => {
          const density = rules.find((rule) => rule.id.endsWith("density-16"))!;
          density.valueType = "int";
        }),
      ),
    ).toBeNull();
    expect(
      wardrobeHingeNormsFromRules(
        ruleSet((rules) => {
          const count = rules.find((rule) => rule.id.endsWith("band-8-count"))!;
          count.value = 1;
        }),
      ),
    ).toBeNull();
    expect(
      wardrobeHingeNormsFromRules(
        ruleSet((rules) => {
          const height = rules.find((rule) => rule.id.endsWith("band-2-max-height"))!;
          height.value = 500;
        }),
      ),
    ).toBeNull();
  });

  it("другие допустимые значения меняют массу и количество петель", () => {
    const norms = wardrobeHingeNormsFromRules(
      ruleSet((rules) => {
        for (const rule of rules) {
          if (rule.id.endsWith("-count")) rule.value = Number(rule.value) + 1;
        }
      }),
    )!;
    const base = wardrobeHingeNormsFromRules(ruleSet())!;
    expect(wardrobeDoorMassKg(panel(600, 1200), 16, norms)).toBeCloseTo(
      (600 * 1200 / 1_000_000) * base.densities[16],
      9,
    );
    expect(wardrobeHingeCountForDoor(600, 3.45, norms)).toBe(
      wardrobeHingeCountForDoor(600, 3.45, base)! + 1,
    );
  });
});
