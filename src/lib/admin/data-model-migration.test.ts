import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importPriceItems } from "./import";
import { migrateDataModel, planCatalogItem, planDataModelMigration } from "./data-model-migration";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-model-migration-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, value: unknown): void {
  writeFileSync(path.join(dir, name), JSON.stringify(value), "utf8");
}

function catalog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ldsp",
    catalog: "bodyMaterial",
    label: "ЛДСП",
    attrs: {},
    status: "active",
    version: "1",
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
    updatedBy: "seed",
    ...overrides,
  };
}

describe("CA-T-304A: миграция моделей", () => {
  it("legacy priceRefs string[] → именованная роль", () => {
    const result = planCatalogItem(
      catalog({ priceRefs: ["catalog.body.ldsp.ratePerSqm"] }),
    );
    expect(result.item?.priceRefs).toEqual({
      ratePerSqm: "catalog.body.ldsp.ratePerSqm",
    });
    expect(result.issue).toBeUndefined();
  });

  it("supportSystem: четыре роли только при точных ID", () => {
    const ok = planCatalogItem(
      catalog({
        id: "standard",
        catalog: "supportSystem",
        attrs: {
          edgeInsetCm: 4,
          maxSpanCm: 60,
          maxLoadKgPerLeg: 40,
          clipsPerLeg: 1,
          screwsPerLeg: 2,
          tallAnchorSpacingCm: 120,
          tallCenterLegWidthCm: 60,
          source: "preliminary",
        },
        priceRefs: [
          "catalog.support.standard.legPrice",
          "catalog.support.standard.clipPrice",
          "catalog.support.standard.screwPrice",
          "catalog.support.standard.anchorPrice",
        ],
      }),
    );
    expect(ok.item?.priceRefs).toEqual({
      legPrice: "catalog.support.standard.legPrice",
      clipPrice: "catalog.support.standard.clipPrice",
      screwPrice: "catalog.support.standard.screwPrice",
      anchorPrice: "catalog.support.standard.anchorPrice",
    });

    const ambiguous = planCatalogItem(
      catalog({
        id: "standard",
        catalog: "supportSystem",
        attrs: {
          edgeInsetCm: 4,
          maxSpanCm: 60,
          maxLoadKgPerLeg: 40,
          clipsPerLeg: 1,
          screwsPerLeg: 2,
          tallAnchorSpacingCm: 120,
          tallCenterLegWidthCm: 60,
          source: "preliminary",
        },
        priceRefs: ["catalog.support.standard.legPrice"],
      }),
    );
    expect(ambiguous.issue?.reason).toMatch(/неоднозначны/);
  });

  it("dry-run не пишет данные, apply мигрирует каталог; повтор идемпотентен", async () => {
    write("catalog-items.json", [catalog({ priceRefs: ["catalog.body.ldsp.ratePerSqm"] })]);
    write("pricing-versions.json", []);
    write("module-presets.json", []);
    write("projects.json", []);

    const dry = await migrateDataModel({ dryRun: true });
    expect(dry.migrated.catalogs).toBe(1);
    expect(JSON.parse(readFileSync(path.join(dir, "catalog-items.json"), "utf8"))[0].priceRefs).toEqual([
      "catalog.body.ldsp.ratePerSqm",
    ]);

    const applied = await migrateDataModel({ dryRun: false });
    expect(applied.migrated.catalogs).toBe(1);
    expect(JSON.parse(readFileSync(path.join(dir, "catalog-items.json"), "utf8"))[0].priceRefs).toEqual({
      ratePerSqm: "catalog.body.ldsp.ratePerSqm",
    });

    const second = await migrateDataModel({ dryRun: true });
    expect(second.migrated.catalogs).toBe(1);
    expect(second.issues).toEqual([]);
  });

  it("неоднозначные versions/presets/projects не мигрируются, а попадают в отчёт", () => {
    const plan = planDataModelMigration({
      catalogs: [],
      versions: [{ id: "price-1" }],
      presets: [{ id: "base", family: "kitchen" }],
      projects: [{ id: "project-1" }],
    });
    expect(plan.versions.issues[0]?.reason).toMatch(/signedAdjustments/);
    expect(plan.presets.issues[0]?.reason).toMatch(/priceRef/);
    expect(plan.projects.issues[0]?.reason).toMatch(/priceVersion/);
  });

  it("повреждённые записи не мигрируются и попадают в отчёт", async () => {
    const plan = planDataModelMigration({
      catalogs: [null, "broken", catalog({ catalog: "unknownKind", priceRefs: [] })],
      versions: [{ id: "v1", signedAdjustments: "not-array" }],
      presets: [{ id: "base", family: "kitchen", priceRef: "" }],
      projects: [{ id: "p1", priceVersion: "" }],
    });
    expect(plan.catalogs.migrated).toEqual([]);
    expect(plan.catalogs.issues).toHaveLength(3);
    expect(plan.versions.issues[0]?.id).toBe("v1");
    expect(plan.presets.issues[0]?.id).toBe("kitchen:base");
    expect(plan.projects.issues[0]?.id).toBe("p1");
  });

  it("импорт PriceItem добавляет signedAdjustments и не теряет отрицательные значения", async () => {
    await importPriceItems({ actorId: "admin-1", actorRole: "calc-admin" });
    const versions = JSON.parse(
      readFileSync(path.join(dir, "pricing-versions.json"), "utf8"),
    ) as Array<{ signedAdjustments?: Array<{ key: string; amount: number }> }>;
    const signed = versions[0]?.signedAdjustments ?? [];
    expect(signed).toEqual(
      expect.arrayContaining([{ key: "plinth:ldsp:pvc04", amount: -120 }]),
    );
    expect(new Set(signed.map((item) => item.key)).size).toBe(signed.length);
  });
});
