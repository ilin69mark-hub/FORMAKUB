import { describe, expect, it } from "vitest";

import { KITCHEN_MODULES } from "@/content/catalog";
import { PRICING } from "@/content/pricing";
import {
  migratePresetBasePrice,
  type PriceRefCandidate,
} from "./module-preset-migration";
import { modulePresetSchema } from "./schema";

/** Полная валидная запись пресета (дизайн §6.3, с priceRef). */
function preset(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "base",
    family: "kitchen",
    zone: "floor",
    width: { min: 40, max: 120, default: 60 },
    height: { min: 80, max: 95, default: 90 },
    depth: { min: 50, max: 60, default: 60 },
    defaultShelves: 1,
    defaultDrawers: 0,
    priceRef: "preset.base.basePrice",
    status: "active",
    version: "v1",
    updatedAt: "2026-11-07T12:00:00.000Z",
    updatedBy: "calc-admin",
    ...overrides,
  };
}

/** Запись пресета до миграции: basePrice вместо priceRef. */
function legacyPreset(
  id: string,
  basePrice: number,
): { id: string; basePrice: number; version: string } {
  return { id, basePrice, version: "v1" };
}

describe("migratePresetBasePrice (CA-T-201)", () => {
  it("однозначное соответствие → конвертация: basePrice удалён, priceRef добавлен", () => {
    const presets = [legacyPreset("base", 8200), legacyPreset("sink", 11400)];
    const priceItems: PriceRefCandidate[] = [
      { id: "preset.base.basePrice", amount: 8200 },
      { id: "preset.sink.basePrice", amount: 11400 },
    ];

    const result = migratePresetBasePrice(presets, priceItems);

    expect(result.ok).toBe(true);
    expect(result.unresolved).toEqual([]);
    expect(result.migrated).toEqual([
      { id: "base", version: "v1", priceRef: "preset.base.basePrice" },
      { id: "sink", version: "v1", priceRef: "preset.sink.basePrice" },
    ]);
    expect(result.migrated[0]).not.toHaveProperty("basePrice");
    // каждая конвертированная запись валидна по схеме ModulePreset
    for (const record of result.migrated) {
      expect(modulePresetSchema.safeParse({ ...preset(), ...record }).success).toBe(
        true,
      );
    }
  });

  it("нет соответствия → ok=false, ничего не конвертируется, записи сохранены", () => {
    const presets = [legacyPreset("base", 8200)];
    const before = JSON.stringify(presets);

    const result = migratePresetBasePrice(presets, []);

    expect(result.ok).toBe(false);
    expect(result.migrated).toEqual([]);
    expect(result.unresolved).toEqual([
      { id: "base", basePrice: 8200, reason: "no_match", candidates: [] },
    ]);
    expect(JSON.stringify(presets)).toBe(before);
    expect(result.unchanged).toBe(presets);
  });

  it("неоднозначное соответствие (2 кандидата) → ok=false с перечнем id", () => {
    const presets = [legacyPreset("bottle", 5000)];
    const priceItems: PriceRefCandidate[] = [
      { id: "kitchen.bottleRack", amount: 5000 },
      { id: "other.stavka", amount: 5000 },
    ];

    const result = migratePresetBasePrice(presets, priceItems);

    expect(result.ok).toBe(false);
    expect(result.migrated).toEqual([]);
    expect(result.unresolved).toEqual([
      {
        id: "bottle",
        basePrice: 5000,
        reason: "ambiguous",
        candidates: ["kitchen.bottleRack", "other.stavka"],
      },
    ]);
  });

  it("частичное соответствие не пишется: при одной проблемной записи ok=false и migrated пуст", () => {
    const presets = [legacyPreset("base", 8200), legacyPreset("wall", 6800)];
    const priceItems: PriceRefCandidate[] = [
      { id: "preset.base.basePrice", amount: 8200 },
    ];

    const result = migratePresetBasePrice(presets, priceItems);

    expect(result.ok).toBe(false);
    expect(result.migrated).toEqual([]);
    expect(result.unresolved.map((item) => item.id)).toEqual(["wall"]);
  });

  it("входные данные не мутируются", () => {
    const presets = [legacyPreset("base", 8200)];
    const priceItems: PriceRefCandidate[] = [
      { id: "p1", amount: 8200 },
    ];
    const presetsBefore = JSON.stringify(presets);
    const itemsBefore = JSON.stringify(priceItems);

    migratePresetBasePrice(presets, priceItems);

    expect(JSON.stringify(presets)).toBe(presetsBefore);
    expect(JSON.stringify(priceItems)).toBe(itemsBefore);
  });
});

/**
 * Существующие данные: KITCHEN_MODULES (8 пресетов, src/content/catalog.ts).
 * Фиксируется фактический результат запуска миграции на реальных записях.
 */
describe("миграция на существующих данных KITCHEN_MODULES (CA-T-201)", () => {
  const existing = Object.entries(KITCHEN_MODULES).map(([id, module]) => ({
    id,
    basePrice: module.basePrice,
  }));

  it("все 8 записей несут basePrice; суммы соответствуют аудиту 5000–15800", () => {
    expect(existing).toHaveLength(8);
    expect(existing.map((item) => item.basePrice).sort((a, b) => a - b)).toEqual([
      5000, 6800, 8200, 10400, 11400, 12100, 14600, 15800,
    ]);
  });

  it("без PriceItem-записей (снимок прайса не создан): ни одно соответствие не определено, данные не тронуты", () => {
    const before = JSON.stringify(existing);

    const result = migratePresetBasePrice(existing, []);

    expect(result.ok).toBe(false);
    expect(result.migrated).toEqual([]);
    expect(result.unresolved).toHaveLength(8);
    expect(result.unresolved.every((item) => item.reason === "no_match")).toBe(
      true,
    );
    expect(JSON.stringify(existing)).toBe(before);
  });

  it("в PRICING нет ставок с суммами 7 из 8 basePrice — однозначное сопоставление невозможно", () => {
    const numbers = new Set<number>();
    (function walk(value: unknown): void {
      if (typeof value === "number") numbers.add(value);
      else if (value && typeof value === "object") {
        Object.values(value).forEach(walk);
      }
    })(PRICING);

    const sums = existing.map((item) => item.basePrice);
    const withoutMatch = sums.filter((sum) => !numbers.has(sum));
    // 7 из 8 сумм в прайсе отсутствуют; единственное числовое совпадение —
    // 5000 (PRICING.kitchen.bottleRack — «наполнение секции», не корпус
    // пресета): подбор соответствия по одной сумме без решения владельца
    // запрещён, поэтому кандидаты не поставляются (см. тест выше).
    expect(withoutMatch).toHaveLength(7);
    expect(sums.filter((sum) => numbers.has(sum))).toEqual([5000]);
  });
});
