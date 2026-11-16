import { describe, expect, it } from "vitest";

import type { ManagedRule } from "./managed-rules";
import {
  buildSelection,
  filterRules,
  formatRuleValue,
  snapshotLabel,
  sortRevisions,
  validateSelection,
} from "./rules-ui";

function rule(overrides: Partial<ManagedRule> = {}): ManagedRule {
  return {
    id: "rule-1",
    name: "Правило",
    description: "Описание",
    category: "quantity",
    scope: "wardrobe",
    condition: { subject: "kind", operator: "equals", value: "wardrobe" },
    assigns: "line:wardrobe.fittings",
    value: 2,
    valueType: "int",
    status: "draft",
    sourceRef: "src/x.ts",
    source: "owner_confirmed",
    affects: ["quantity"],
    version: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "test",
    ...overrides,
  };
}

describe("CA-T-613: rules UI helpers", () => {
  it("фильтрует по тексту/статусу/scope/source", () => {
    const rules = [
      rule(),
      rule({ id: "rule-2", name: "Другое", status: "published", scope: "kitchen" }),
    ];
    expect(filterRules(rules, { q: "друг" }).map((item) => item.id)).toEqual(["rule-2"]);
    expect(filterRules(rules, { status: "draft" }).map((item) => item.id)).toEqual(["rule-1"]);
    expect(filterRules(rules, { scope: "kitchen" })).toHaveLength(1);
    expect(filterRules(rules, { source: "owner_confirmed" })).toHaveLength(2);
  });

  it("собирает выбор публикации с expectedVersion", () => {
    const rules = [rule({ version: "3" })];
    expect(buildSelection(rules, ["rule-1", "missing"])).toEqual([
      { id: "rule-1", expectedVersion: "3" },
    ]);
  });

  it("валидирует выбор публикации", () => {
    expect(validateSelection([rule()], [])).toContain("Выберите хотя бы одно draft-правило.");
    expect(validateSelection([rule({ status: "published" })], ["rule-1"])).toContain(
      "Публиковать можно только draft-правила.",
    );
    expect(
      validateSelection([rule({ source: "preliminary" })], ["rule-1"]),
    ).toContain("preliminary-правила не публикуются.");
    expect(validateSelection([rule()], ["rule-1"])).toEqual([]);
  });

  it("форматирует значения и сортирует редакции", () => {
    expect(formatRuleValue(rule({ value: 2 }))).toBe("2");
    expect(formatRuleValue(rule({ value: ["a", "b"], valueType: "stringList" }))).toBe("a, b");
    expect(formatRuleValue(rule({ value: true, valueType: "boolean" }))).toBe("да");

    const revisions = [rule({ id: "r2", version: "2" }), rule({ id: "r1", version: "1" })];
    expect(sortRevisions(revisions).map((item) => item.version)).toEqual(["1", "2"]);
  });

  it("подписывает снимок", () => {
    expect(
      snapshotLabel({
        id: "rules-1",
        publishedSeq: 2,
        rules: [],
        contentHash: "x",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "a",
        publishedAt: "2026-01-01T00:00:00.000Z",
        publishedBy: "a",
      }),
    ).toBe("#2 · rules-1 · 0 правил");
  });
});
