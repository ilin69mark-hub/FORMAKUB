import { updateCollection } from "./store";
import { rulesSnapshotContentHash } from "@/lib/admin/managed-rules";
import {
  WARDROBE_FACADE_DENSITY_KG_M2,
  WARDROBE_HINGE_BANDS,
} from "@/lib/configurator/wardrobe-hinges";

/**
 * Тестовая фикстура опубликованного снимка правил (ADR-07).
 *
 * Нужна только интеграционным/сервисным тестам: после Slice 2 create/preview
 * требуют активный опубликованный снимок, а recalculate — закреплённый
 * `StoredProject.rulesSnapshotId`. Фикстура не является production-сидом и не
 * участвует в bootstrap.
 */
export const TEST_RULES_SNAPSHOT_ID = "rules-test-fixture";

const NOW = "2026-11-09T00:00:00.000Z";

export function rulesSnapshotFixture(): Record<string, unknown> {
  const base = (
    id: string,
    name: string,
    description: string,
    value: number,
    valueType: "int" | "decimal",
    assigns: string,
    sourceRef: string,
  ) => ({
    id,
    name,
    description,
    category: "norm",
    scope: "wardrobe",
    condition: { subject: "kind", operator: "equals", value: "wardrobe" },
    assigns,
    value,
    valueType,
    status: "published",
    sourceRef,
    source: "owner_confirmed",
    affects: ["quantity"],
    version: "1",
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: "test",
  });

  const rules = [
    {
      id: "rule-test-hinge-band",
      name: "Тестовая норма петель",
      description: "Тестовая фикстура; production-нормы сюда не добавляются",
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
      createdAt: NOW,
      updatedAt: NOW,
      updatedBy: "test",
    },
    ...([16, 19, 22] as const).map((thickness) =>
      base(
        `rule-wardrobe-facade-density-${thickness}`,
        `Плотность фасада ${thickness} мм`,
        "Норма 1.2 (тестовая фикстура, значения = подтверждённые)",
        WARDROBE_FACADE_DENSITY_KG_M2[thickness],
        "decimal",
        "line:wardrobe.fronts",
        "src/lib/configurator/wardrobe-hinges.ts:17-21",
      ),
    ),
    ...WARDROBE_HINGE_BANDS.flatMap((band, index) => {
      const number = index + 1;
      return [
        base(
          `rule-wardrobe-hinge-band-${number}-max-height`,
          `Полоса ${number}: макс. высота`,
          "Норма 1.1 (тестовая фикстура)",
          band.maxHeightMm,
          "int",
          "line:wardrobe.fittings",
          "src/lib/configurator/wardrobe-hinges.ts:30-39",
        ),
        base(
          `rule-wardrobe-hinge-band-${number}-max-mass`,
          `Полоса ${number}: макс. масса`,
          "Норма 1.1 (тестовая фикстура)",
          band.maxMassKg,
          "decimal",
          "line:wardrobe.fittings",
          "src/lib/configurator/wardrobe-hinges.ts:30-39",
        ),
        base(
          `rule-wardrobe-hinge-band-${number}-count`,
          `Полоса ${number}: количество петель`,
          "Норма 1.1 (тестовая фикстура)",
          band.count,
          "int",
          "line:wardrobe.fittings",
          "src/lib/configurator/wardrobe-hinges.ts:30-39",
        ),
      ];
    }),
  ];
  return {
    id: TEST_RULES_SNAPSHOT_ID,
    publishedSeq: 1,
    rules,
    contentHash: rulesSnapshotContentHash(rules),
    createdAt: NOW,
    createdBy: "test",
    publishedAt: NOW,
    publishedBy: "test",
  };
}

/** Идемпотентно добавляет фикстуру в Storage Adapter (JSON или SQLite). */
export async function seedRulesSnapshotFixture(): Promise<void> {
  const snapshot = rulesSnapshotFixture();
  await updateCollection<Record<string, unknown>, void>(
    "rules-snapshots.json",
    (items) => ({
      items: items.some((item) => item.id === TEST_RULES_SNAPSHOT_ID)
        ? items
        : [...items, snapshot],
      result: undefined,
    }),
  );
}
