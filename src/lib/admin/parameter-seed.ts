import { BUILD_CALC_VERSION } from "@/lib/configurator/versions";
import { getParameterManifest } from "@/lib/server/parameter-registry";

import {
  adminParameterSchema,
  type AdminParameter,
} from "./schema";

/**
 * Stage 8 / Block 3: реестр AdminParameter для кухни и шкафа.
 *
 * Все параметры, читаемые Engine, классифицированы как readonly: их изменение
 * меняет расчёт без изменения StoredProject.config и требует release
 * (ADR-04). Редактируемые параметры не добавляются, пока нет безопасного
 * кандидата, не влияющего на действующий расчёт.
 */

export interface AdminParameterSeedOptions {
  now?: string;
  updatedBy?: string;
}

type SeedBase = {
  id: string;
  scope: AdminParameter["scope"];
  category: AdminParameter["category"];
  group: AdminParameter["group"];
  sourceRef: string;
  affects: AdminParameter["affects"];
  unit: "cm" | "mm" | "m" | "m2" | "pcs" | "kg" | "rub" | "rubPerM" | "rubPerM2" | "none";
  status?: AdminParameter["status"];
  appliesTo?: AdminParameter["appliesTo"];
};

function numeric(
  base: SeedBase,
  value: number,
  min: number,
  max: number,
  now: string,
  updatedBy: string,
): AdminParameter {
  const integer = Number.isInteger(value);
  return adminParameterSchema.parse({
    ...base,
    valueType: integer ? "int" : "decimal",
    value,
    defaultValue: value,
    min,
    max,
    ...(integer ? {} : { step: 0.01 }),
    status: base.status ?? "readonly",
    appliesTo: base.appliesTo ?? "all_read_paths",
    editableInAdmin: false,
    version: "1",
    updatedAt: now,
    updatedBy,
    enumValues: null,
  });
}

function numericSeed(
  id: string,
  value: number,
  min: number,
  max: number,
  now: string,
  updatedBy: string,
  category: AdminParameter["category"] = "geometric",
  scope: AdminParameter["scope"] = "wardrobe",
  unit: "cm" | "mm" | "m" | "m2" | "pcs" | "kg" | "rub" | "rubPerM" | "rubPerM2" | "none" = "mm",
): AdminParameter {
  return numeric(
    {
      id,
      scope,
      category,
      group: "01",
      sourceRef: `src/lib/configurator/wardrobe-geometry.ts:${id}`,
      affects: { price: true, geometry: true, visualization: false, validation: false },
      unit,
    },
    value,
    min,
    max,
    now,
    updatedBy,
  );
}

export function buildAdminParameterSeeds(
  options: AdminParameterSeedOptions = {},
): AdminParameter[] {
  const now = options.now ?? new Date().toISOString();
  const updatedBy = options.updatedBy ?? "bootstrap";
  const seeds: AdminParameter[] = [];

  const manifest = getParameterManifest(BUILD_CALC_VERSION);
  if (!manifest.ok) {
    throw new Error(`AdminParameter seed: ${manifest.issue.message}`);
  }
  for (const [id, value] of Object.entries(manifest.manifest.parameters)) {
    if (typeof value !== "number") continue; // массивы пока не поддержаны AdminParameter
    const min = value < 0 ? value * 2 : 0;
    const max = value === 0 ? 1 : Math.max(value * 10, value + 1000);
    seeds.push(
      numeric(
        {
          id,
          scope: "kitchen",
          category: "geometric",
          group: "01",
          sourceRef: `src/lib/server/parameter-registry.ts:${id}`,
          affects: {
            price: true,
            geometry: true,
            visualization: false,
            validation: false,
          },
          unit: "none",
        },
        value,
        min,
        max,
        now,
        updatedBy,
      ),
    );
  }

  const wardrobe = [
    ["wardrobe.bodyThicknessMm", 16, 1, 100],
    ["wardrobe.backPanelThicknessMm", 3, 1, 20],
    ["wardrobe.plinthHeightMm", 80, 1, 300],
    ["wardrobe.plinthInsetMm", 50, 0, 500],
    ["wardrobe.minSectionWidthMm", 300, 1, 2000],
    ["wardrobe.partitionThicknessMm", 16, 1, 100],
    ["wardrobe.facadeGapMm", 2, 0, 50],
    ["wardrobe.facadePartitionGapMm", 1, 0, 50],
    ["wardrobe.antresolDividerThicknessMm", 16, 1, 100],
    ["wardrobe.drawerCountMin", 3, 1, 10],
    ["wardrobe.drawerCountMax", 5, 1, 10],
    ["wardrobe.drawerTopMinMm", 800, 0, 3000],
    ["wardrobe.drawerTopMaxMm", 1100, 0, 3000],
    ["wardrobe.drawerStartOffsetMm", 20, 0, 200],
    ["wardrobe.runnerSideClearanceMm", 26, 0, 200],
  ] as const;
  for (const [id, value, min, max] of wardrobe) {
    seeds.push(
      numericSeed(
        id,
        value,
        min,
        max,
        now,
        updatedBy,
        "geometric",
        "wardrobe",
        "mm",
      ),
    );
  }

  return seeds;
}

export interface AdminParameterSeedDiagnostic {
  unknownIds: string[];
  incompatible: Array<{ id: string; reason: string }>;
}

/** Диагностика существующих AdminParameter относительно текущего seed. */
export function diagnoseAdminParameterSeeds(
  existing: readonly AdminParameter[],
  seeds: readonly AdminParameter[] = buildAdminParameterSeeds(),
): AdminParameterSeedDiagnostic {
  const seedById = new Map(seeds.map((item) => [item.id, item]));
  const unknownIds: string[] = [];
  const incompatible: Array<{ id: string; reason: string }> = [];
  for (const item of existing) {
    const seed = seedById.get(item.id);
    if (!seed) {
      unknownIds.push(item.id);
      continue;
    }
    if (item.valueType !== seed.valueType) {
      incompatible.push({ id: item.id, reason: "valueType отличается от реестра" });
    } else if (item.scope !== seed.scope) {
      incompatible.push({ id: item.id, reason: "scope отличается от реестра" });
    }
  }
  return { unknownIds, incompatible };
}
