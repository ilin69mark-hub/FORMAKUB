import { describe, expect, it } from "vitest";

import * as formulaApi from "./formulas";
import { getFormula, listFormulas } from "./formulas";

describe("CA-T-307: read-only CalculationReference", () => {
  it("отдаёт реестр формул и 17 основных записей", () => {
    const formulas = listFormulas();
    expect(formulas.length).toBeGreaterThan(17);
    expect(formulas.filter((formula) => formula.primary)).toHaveLength(17);
    expect(formulas.every((formula) => formula.fileExists)).toBe(true);
  });

  it("помечает исключённые формулы без изменения реестра", () => {
    const formulas = listFormulas();
    const excluded = formulas.filter((formula) => formula.excluded);
    expect(excluded.map((formula) => formula.id).sort()).toEqual([
      "calculatePrice",
      "roundMoney",
    ]);
    expect(excluded.every((formula) => Boolean(formula.excludedReason))).toBe(true);
  });

  it("getFormula возвращает только чтение", () => {
    const formula = getFormula("calculateKitchenPrice");
    expect(formula?.file).toBe("lib/configurator/pricing.ts");
    expect(formula?.editable).toBe(false);
    expect(formula?.source).toBe("code");
    expect(formula?.dependsOn).toContain("modules");
    expect(getFormula("unknown-formula")).toBeUndefined();
  });

  it("не предоставляет create/update/delete-операции", () => {
    const mutationKeys = Object.keys(formulaApi).filter((key) =>
      /^(create|update|delete|save|write|remove)/i.test(key),
    );
    expect(mutationKeys).toEqual([]);
  });
});
