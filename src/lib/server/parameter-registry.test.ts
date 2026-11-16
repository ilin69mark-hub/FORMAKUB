import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BUILD_CALC_VERSION } from "@/lib/configurator/versions";
import { SINK_RULE_NAMES } from "@/lib/configurator/sink";

import {
  computeManifestIntegrity,
  getParameterManifest,
  listParameterManifestVersions,
  validateManifestSource,
  validateParameterManifest,
  type ParameterManifest,
} from "./parameter-registry";

function known(): ParameterManifest {
  const result = getParameterManifest(BUILD_CALC_VERSION);
  if (!result.ok) throw new Error(result.issue.message);
  return result.manifest;
}

function sourceOf(manifest: ParameterManifest) {
  return {
    formatVersion: manifest.formatVersion,
    calcVersion: manifest.calcVersion,
    parameters: structuredClone(manifest.parameters),
  };
}

describe("CA-T-306B: Versioned Parameter Registry", () => {
  it("загружает известный calcVersion, возвращает полный immutable manifest", () => {
    const manifest = known();
    expect(listParameterManifestVersions()).toContain(BUILD_CALC_VERSION);
    expect(manifest.calcVersion).toBe(BUILD_CALC_VERSION);
    expect(manifest.integrity).toBe(computeManifestIntegrity(manifest));
    expect(Object.keys(manifest.parameters)).toHaveLength(49);
    expect(manifest.parameters["engine.lighting.psuMargin"]).toBe(1.25);
    expect(manifest.parameters["engine.sink.standardWidths"]).toEqual([
      40, 45, 50, 60, 80, 90, 100, 120,
    ]);

    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.parameters)).toBe(true);
    expect(
      Object.isFrozen(manifest.parameters["engine.sink.standardWidths"]),
    ).toBe(true);
    expect(() => {
      (manifest.parameters as Record<string, unknown>)["engine.sink.minWidth"] = 1;
    }).toThrow();
  });

  it("неизвестный/отсутствующий calcVersion — fail-closed", () => {
    const unknown = getParameterManifest("calc-unknown");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.issue.code).toBe("PARAMETER_MANIFEST_UNAVAILABLE");
    }
    expect(getParameterManifest("").ok).toBe(false);
  });

  it("отсутствующий обязательный или неизвестный параметр — invalid", () => {
    const base = sourceOf(known());

    const missing = structuredClone(base);
    delete (missing.parameters as Record<string, unknown>)[
      "engine.lighting.psuMargin"
    ];
    expect(validateManifestSource(missing).ok).toBe(false);

    const extra = structuredClone(base);
    (extra.parameters as Record<string, unknown>)["engine.unknown"] = 1;
    expect(validateManifestSource(extra).ok).toBe(false);
  });

  it("неверный тип и значение вне диапазона — invalid", () => {
    const base = sourceOf(known());

    const wrongType = structuredClone(base);
    (wrongType.parameters as Record<string, unknown>)[
      "engine.lighting.psuMargin"
    ] = "1.25";
    expect(validateManifestSource(wrongType).ok).toBe(false);

    const negative = structuredClone(base);
    (negative.parameters as Record<string, unknown>)[
      "engine.lighting.psuMargin"
    ] = -1;
    expect(validateManifestSource(negative).ok).toBe(false);

    const badArray = structuredClone(base);
    (badArray.parameters as Record<string, unknown>)[
      "engine.lighting.psuRatings"
    ] = [];
    expect(validateManifestSource(badArray).ok).toBe(false);
  });

  it("нарушение integrity блокирует manifest", () => {
    const base = sourceOf(known());
    const correct = computeManifestIntegrity(base);
    const result = validateParameterManifest(base, "0".repeat(64));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("PARAMETER_MANIFEST_INTEGRITY");
    }
    expect(validateParameterManifest(base, correct).ok).toBe(true);
  });

  it("CA-RISK-010: whitelist полон относительно Engine/Sink/Supports/Lighting", () => {
    const manifest = known();
    const keys = Object.keys(manifest.parameters);

    // 25 SinkRules → engine.sink.*
    const sinkKeys = keys
      .filter((key) => key.startsWith("engine.sink."))
      .map((key) => key.slice("engine.sink.".length))
      .sort();
    expect(sinkKeys).toEqual([...SINK_RULE_NAMES].sort());

    // Support loads/reference widths — по всем типам модулей Engine.
    const moduleTypes = [
      "base",
      "sink",
      "hob",
      "drawers",
      "wall",
      "tall",
      "oven",
      "bottle",
    ];
    for (const type of moduleTypes) {
      expect(keys).toContain(`engine.supports.moduleLoadKg.${type}`);
      expect(keys).toContain(
        `engine.supports.moduleLoadReferenceWidth.${type}`,
      );
    }

    // Все остальные engine.* ключи, читаемые Engine, присутствуют.
    for (const key of [
      "engine.supports.minLegSpacingCm",
      "engine.supports.partitionSnapCm",
      "engine.supports.mergeToleranceCm",
      "engine.lighting.endMarginCm",
      "engine.lighting.psuMargin",
      "engine.lighting.psuMarginLow",
      "engine.lighting.psuRatings",
      "engine.kitchen.wallGapAboveCountertop",
    ]) {
      expect(keys).toContain(key);
    }

    // Нет неиспользуемых engine.* ключей: каждый входит в один из наборов.
    const expected = new Set<string>([
      ...SINK_RULE_NAMES.map((name) => `engine.sink.${name}`),
      ...moduleTypes.flatMap((type) => [
        `engine.supports.moduleLoadKg.${type}`,
        `engine.supports.moduleLoadReferenceWidth.${type}`,
      ]),
      "engine.supports.minLegSpacingCm",
      "engine.supports.partitionSnapCm",
      "engine.supports.mergeToleranceCm",
      "engine.lighting.endMarginCm",
      "engine.lighting.psuMargin",
      "engine.lighting.psuMarginLow",
      "engine.lighting.psuRatings",
      "engine.kitchen.wallGapAboveCountertop",
    ]);
    expect([...keys].sort()).toEqual([...expected].sort());
  });

  it("не читает live Admin/content и не импортируется Engine", () => {    const root = process.cwd();
    const registry = readFileSync(
      path.join(root, "src/lib/server/parameter-registry.ts"),
      "utf8",
    );
    expect(registry).not.toContain("@/lib/admin");
    expect(registry).not.toContain("@/content");
    expect(registry).not.toContain("@/lib/server/store");

    for (const file of [
      "src/lib/configurator/pricing.ts",
      "src/lib/configurator/supports.ts",
      "src/lib/configurator/lighting.ts",
      "src/lib/configurator/sink.ts",
    ]) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source).not.toContain("parameter-registry");
      expect(source).not.toContain("@/lib/server");
    }
  });
});
