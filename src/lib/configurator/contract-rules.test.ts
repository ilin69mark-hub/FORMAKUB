import { describe, expect, it } from "vitest";

import type {
  CalculationInputs,
  ManagedRuleInput,
  PriceSnapshotInput,
} from "./contract";
import { validateCalculationInputs, validateRulesSnapshot } from "./contract";

const snapshot: PriceSnapshotInput = {
  priceVersion: "price-2026.11",
  snapshot: [],
  rules: {
    rounding: 100,
    minOrder: 45000,
    complexityPerExtraModule: 0.02,
    complexityMax: 1.12,
    bodyDepthReference: 60,
    bodyFactor: 1.15,
  },
  signedAdjustments: [],
  promos: [],
  baseSchema: 1,
};

const baseInputs: CalculationInputs = {
  priceSnapshot: snapshot,
  catalogs: [],
  parameters: {},
  presets: [],
};

function rule(overrides: Partial<ManagedRuleInput> = {}): ManagedRuleInput {
  return {
    id: "rule-hinge-band-1",
    name: "Полоса петель",
    description: "Высота/масса двери → количество петель",
    category: "quantity",
    scope: "wardrobe",
    condition: { subject: "kind", operator: "equals", value: "wardrobe" },
    assigns: "line:wardrobe.fittings",
    value: 2,
    valueType: "int",
    status: "published",
    sourceRef: "src/lib/configurator/wardrobe-hinges.ts:30-39",
    source: "owner_confirmed",
    affects: ["quantity"],
    version: "1",
    ...overrides,
  };
}

describe("ADR-07: rulesSnapshot в CalculationInputs", () => {
  it("легаси-входы без rulesSnapshot по-прежнему валидны", () => {
    expect(validateCalculationInputs(baseInputs).ok).toBe(true);
  });

  it("валидный опубликованный снимок проходит", () => {
    const inputs: CalculationInputs = {
      ...baseInputs,
      rulesSnapshot: { rulesSnapshotId: "rules-abc", rules: [rule()] },
    };
    expect(validateCalculationInputs(inputs).ok).toBe(true);
    expect(
      validateRulesSnapshot({ rulesSnapshotId: "rules-abc", rules: [rule()] }).ok,
    ).toBe(true);
  });

  it("draft и preliminary в расчётных входах блокируются", () => {
    const draft: CalculationInputs = {
      ...baseInputs,
      rulesSnapshot: { rulesSnapshotId: "rules-abc", rules: [rule({ status: "draft" })] },
    };
    const draftResult = validateCalculationInputs(draft);
    expect(draftResult.ok).toBe(false);
    if (!draftResult.ok) {
      expect(draftResult.issues.some((item) => /status=published/.test(item.message))).toBe(true);
    }

    const preliminary: CalculationInputs = {
      ...baseInputs,
      rulesSnapshot: {
        rulesSnapshotId: "rules-abc",
        rules: [rule({ source: "preliminary" })],
      },
    };
    const preliminaryResult = validateCalculationInputs(preliminary);
    expect(preliminaryResult.ok).toBe(false);
    if (!preliminaryResult.ok) {
      expect(
        preliminaryResult.issues.some((item) => /preliminary/.test(item.message)),
      ).toBe(true);
    }
  });

  it("пустой снимок и дубликаты id блокируются", () => {
    expect(
      validateRulesSnapshot({ rulesSnapshotId: "rules-abc", rules: [] }).ok,
    ).toBe(false);

    const duplicated = validateRulesSnapshot({
      rulesSnapshotId: "rules-abc",
      rules: [rule(), rule()],
    });
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) {
      expect(duplicated.issues.some((item) => /дубликат id/.test(item.message))).toBe(true);
    }
  });

  it("отсутствие обязательного поля и неизвестное поле блокируются", () => {
    const missing = rule() as unknown as Record<string, unknown>;
    delete missing.assigns;
    expect(
      validateRulesSnapshot({ rulesSnapshotId: "rules-abc", rules: [missing] }).ok,
    ).toBe(false);

    expect(
      validateRulesSnapshot({
        rulesSnapshotId: "rules-abc",
        rules: [rule() as unknown as Record<string, unknown>],
      }).ok,
    ).toBe(true);

    const unknown = { ...rule(), extra: 1 };
    expect(
      validateRulesSnapshot({ rulesSnapshotId: "rules-abc", rules: [unknown] }).ok,
    ).toBe(false);
  });

  it("некорректное условие (пустая группа all) блокируется", () => {
    const broken = rule({ condition: { all: [] } });
    expect(
      validateRulesSnapshot({ rulesSnapshotId: "rules-abc", rules: [broken] }).ok,
    ).toBe(false);
  });

  it("неизвестное поле верхнего уровня inputs блокируется (fail-closed)", () => {
    const inputs = {
      ...baseInputs,
      unknownGroup: {},
    } as unknown as CalculationInputs;
    expect(validateCalculationInputs(inputs).ok).toBe(false);
  });
});
