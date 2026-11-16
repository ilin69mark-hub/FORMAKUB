import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ActorContext } from "./parameters";
import {
  importManagedRulesSeed,
  ManagedRulesSeedConflictError,
  managedRulesSeedSpecs,
} from "./managed-rules-seed";
import { managedRuleSchema, type ManagedRule } from "./managed-rules";
import { wardrobeRequiredRuleIds } from "@/lib/configurator/wardrobe-hinges";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };
let dir = "";

const rulesPath = (): string => path.join(dir, "managed-rules.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-rules-seed-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  delete process.env.FORMAKUB_STORAGE;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function readRules(): ManagedRule[] {
  return JSON.parse(readFileSync(rulesPath(), "utf8")) as ManagedRule[];
}

describe("NEW-N4 / D-7: deterministic seed", () => {
  it("первый импорт создаёт ровно 27 draft-правил с id контракта Engine", async () => {
    const result = await importManagedRulesSeed(ACTOR);
    expect(result.created).toHaveLength(27);
    expect(result.skipped).toEqual([]);

    const rules = readRules();
    expect(rules).toHaveLength(27);
    expect(rules.every((rule) => rule.status === "draft")).toBe(true);
    expect(rules.every((rule) => rule.source === "preliminary")).toBe(true);

    const ids = new Set(rules.map((rule) => rule.id));
    for (const expected of wardrobeRequiredRuleIds()) {
      expect(ids.has(expected)).toBe(true);
    }
    expect(managedRulesSeedSpecs()).toHaveLength(27);

    // Никаких snapshot/публикации.
    expect(existsSync(path.join(dir, "rules-snapshots.json"))).toBe(false);
  });

  it("повторный импорт идемпотентен и не меняет идентичные записи", async () => {
    await importManagedRulesSeed(ACTOR);
    const before = readFileSync(rulesPath(), "utf8");

    const second = await importManagedRulesSeed(ACTOR);
    expect(second.created).toEqual([]);
    expect(second.skipped).toHaveLength(27);
    expect(readFileSync(rulesPath(), "utf8")).toBe(before);
  });

  it("конфликт содержимого → контролируемая ошибка без перезаписи", async () => {
    await importManagedRulesSeed(ACTOR);
    const rules = readRules();
    const changed = rules.map((rule) =>
      rule.id === "rule-wardrobe-facade-density-16"
        ? { ...rule, value: 99 }
        : rule,
    );
    writeFileSync(rulesPath(), JSON.stringify(changed), "utf8");
    const before = readFileSync(rulesPath(), "utf8");

    await expect(importManagedRulesSeed(ACTOR)).rejects.toBeInstanceOf(
      ManagedRulesSeedConflictError,
    );
    expect(readFileSync(rulesPath(), "utf8")).toBe(before);
  });

  it("конфликт статуса (published) → ошибка; lifecycle не обходится", async () => {
    await importManagedRulesSeed(ACTOR);
    const rules = readRules();
    const published = rules.map((rule) =>
      rule.id === "rule-wardrobe-hinge-band-1-count"
        ? { ...rule, status: "published" as const }
        : rule,
    );
    writeFileSync(rulesPath(), JSON.stringify(published), "utf8");

    await expect(importManagedRulesSeed(ACTOR)).rejects.toThrow(/status="published"/);
    expect(readRules().filter((rule) => rule.status === "published")).toHaveLength(1);
  });

  it("seed-записи проходят managedRuleSchema", async () => {
    await importManagedRulesSeed(ACTOR);
    for (const rule of readRules()) {
      expect(() => managedRuleSchema.parse(rule)).not.toThrow();
    }
  });
});

describe("D-1 (WP-2.1): sourceRef указывает на фактическую строку значения", () => {
  it("все 27 sourceRef существуют и содержат своё значение", () => {
    const root = path.resolve(process.cwd());
    const specs = managedRulesSeedSpecs();
    expect(specs).toHaveLength(27);

    for (const spec of specs) {
      const match = /^(.+):(\d+)$/.exec(spec.sourceRef);
      expect(match, `${spec.id}: sourceRef="${spec.sourceRef}"`).not.toBeNull();
      const file = path.resolve(root, match![1]);
      expect(existsSync(file), `${spec.id}: файл ${match![1]}`).toBe(true);

      const lines = readFileSync(file, "utf8").split("\n");
      const line = lines[Number(match![2]) - 1];
      expect(line, `${spec.id}: строка ${spec.sourceRef} вне файла`).toBeDefined();
      expect(
        line,
        `${spec.id}: значение ${spec.value} отсутствует в ${spec.sourceRef}`,
      ).toContain(String(spec.value));
    }
  });

  it("sourceRef различает плотности и полосы (не один общий диапазон)", () => {
    const specs = managedRulesSeedSpecs();
    const density = specs.filter((spec) =>
      spec.id.startsWith("rule-wardrobe-facade-density-"),
    );
    expect(new Set(density.map((spec) => spec.sourceRef)).size).toBe(3);

    for (let band = 1; band <= 8; band += 1) {
      const refs = specs
        .filter((spec) => spec.id.startsWith(`rule-wardrobe-hinge-band-${band}-`))
        .map((spec) => spec.sourceRef);
      expect(new Set(refs).size, `полоса ${band}`).toBe(1);
      expect(refs[0]).toBe(
        `src/lib/configurator/wardrobe-hinges.ts:${35 + band}`,
      );
    }
  });

  it("исправление sourceRef не меняет значения, scope, category и affects", () => {
    const specs = managedRulesSeedSpecs();
    expect(specs.every((spec) => spec.scope === "wardrobe")).toBe(true);
    expect(specs.every((spec) => spec.category === "norm")).toBe(true);
    expect(specs.every((spec) => spec.source === "preliminary")).toBe(true);
    expect(
      specs.every(
        (spec) =>
          Array.isArray(spec.affects) &&
          spec.affects.length === 1 &&
          spec.affects[0] === "quantity",
      ),
    ).toBe(true);
    expect(specs.filter((spec) => spec.valueType === "decimal")).toHaveLength(11);
    expect(specs.filter((spec) => spec.valueType === "int")).toHaveLength(16);
  });
});
