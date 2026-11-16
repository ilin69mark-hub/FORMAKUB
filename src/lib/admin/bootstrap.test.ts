import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PLINTH_MATERIALS } from "@/content/plinth";

import { defaultKitchen } from "@/lib/configurator/defaults";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";
import { rulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { buildBootstrapPlan, dryRunBootstrap } from "./bootstrap";

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-bootstrap-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "json-file";
});

afterEach(() => {
  for (const file of [
    "price-items.json",
    "pricing-versions.json",
    "catalog-items.json",
    "module-presets.json",
  ]) {
    rmSync(path.join(dir, file), { force: true });
  }
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, value: unknown): void {
  writeFileSync(path.join(dir, name), JSON.stringify(value), "utf8");
}

function installPlan(): ReturnType<typeof buildBootstrapPlan> {
  const plan = buildBootstrapPlan("2026-11-09T00:00:00.000Z");
  write("price-items.json", plan.priceItems);
  write("pricing-versions.json", [plan.pricingDraft]);
  write("catalog-items.json", plan.catalogItems);
  write("module-presets.json", plan.modulePresets);
  write("rules-snapshots.json", [rulesSnapshotFixture()]);
  return plan;
}

describe("CA-516-02: legacy-материалы не попадают в bootstrap", () => {
  it("bootstrap создаёт только активные body/facade материалы", () => {
    const plan = buildBootstrapPlan("2026-11-09T00:00:00.000Z");
    const catalogs = plan.catalogItems.map(
      (item) => `${item.catalog}:${item.id}`,
    );
    const priceItems = plan.priceItems.map((item) => item.id);
    for (const legacy of ["mdf", "plywood"]) {
      expect(catalogs).not.toContain(`bodyMaterial:${legacy}`);
      expect(priceItems).not.toContain(`catalog.body.${legacy}.ratePerSqm`);
    }
    for (const legacy of ["veneer", "glass", "solid"]) {
      expect(catalogs).not.toContain(`facadeMaterial:${legacy}`);
      expect(priceItems).not.toContain(`catalog.facade.${legacy}.ratePerSqm`);
    }
    expect(catalogs).toEqual(
      expect.arrayContaining([
        "bodyMaterial:ldsp",
        "facadeMaterial:mdf",
        "facadeMaterial:mdf_pvc",
      ]),
    );
  });
});

describe("CA-T-306A bootstrap dry-run", () => {
  it("строит полный план из content: 93 ставки, 60 catalog items, 8 пресетов", () => {
    const plan = buildBootstrapPlan("2026-11-09T00:00:00.000Z");

    expect(plan.issues).toEqual([]);
    expect(plan.priceItems).toHaveLength(93);
    expect(plan.priceSnapshot).toHaveLength(90);
    expect(plan.catalogItems).toHaveLength(60);
    expect(plan.modulePresets).toHaveLength(8);
    expect(plan.signedAdjustments).toHaveLength(10);
    expect(plan.promos).toHaveLength(3);
    expect(Object.keys(plan.rules)).toHaveLength(6);
    expect(plan.pricingDraft.status).toBe("draft");
    expect(plan.pricingDraft.id).toBe("price-demo-2026-01");

    // Все ценовые роли/priceRef разрешаются в план PriceItem.
    const priceIds = new Set(plan.priceItems.map((item) => item.id));
    for (const catalog of plan.catalogItems) {
      for (const priceRef of Object.values(catalog.priceRefs ?? {})) {
        expect(priceIds.has(priceRef), `${catalog.catalog}:${catalog.id}`).toBe(
          true,
        );
      }
    }
    for (const preset of plan.modulePresets) {
      expect(priceIds.has(preset.priceRef), preset.id).toBe(true);
    }
  });

  it("signedAdjustments: все пары, знак сохранён, включая отрицательную", () => {
    const plan = buildBootstrapPlan("2026-11-09T00:00:00.000Z");
    const byKey = new Map(plan.signedAdjustments.map((item) => [item.key, item.amount]));

    let pairs = 0;
    let negative = 0;
    for (const material of PLINTH_MATERIALS) {
      for (const finish of material.finishes) {
        pairs += 1;
        const key = `plinth:${material.id}:${finish.id}`;
        expect(byKey.get(key)).toBe(finish.rateDelta);
        if (finish.rateDelta < 0) negative += 1;
      }
    }
    expect(byKey.size).toBe(pairs);
    expect(byKey.get("plinth:ldsp:pvc04")).toBe(-120);
    expect(negative).toBe(1);
  });

  it("dry-run на пустом хранилище: всё готово, importable=true, запись не выполняется", async () => {
    const before = readdirSync(dir);
    const report = await dryRunBootstrap();
    const after = readdirSync(dir);

    expect(report.importable).toBe(true);
    expect(report.existing.total).toEqual({
      priceItems: 0,
      pricingVersions: 0,
      catalogItems: 0,
      modulePresets: 0,
    });
    expect(report.ready).toEqual({
      priceItems: 93,
      catalogItems: 60,
      modulePresets: 8,
      pricingVersions: 1,
    });
    expect(report.nextPublishedSeq).toBe(1);
    expect(report.ambiguous).toEqual([]);
    expect(report.corrupt).toEqual([]);
    expect(report.missingPriceItems).toEqual([]);
    expect(report.signedAdjustments).toMatchObject({
      total: 10,
      positive: 5,
      negative: 1,
      zero: 4,
    });
    expect(report.led).toMatchObject({
      strips: 8,
      profiles: 3,
      diffusers: 2,
      controls: 3,
      psu: 8,
    });
    expect(before).toEqual(after);
  });

  it("повторный dry-run идемпотентен: записи не дублируются, draft готов к публикации", async () => {
    const plan = installPlan();
    const first = await dryRunBootstrap();
    const second = await dryRunBootstrap();

    expect(first.importable).toBe(true);
    expect(first.existing.valid).toEqual({
      priceItems: plan.priceItems.length,
      pricingVersions: 1,
      catalogItems: plan.catalogItems.length,
      modulePresets: plan.modulePresets.length,
    });
    expect(first.ready).toEqual({
      priceItems: 0,
      catalogItems: 0,
      modulePresets: 0,
      pricingVersions: 1,
    });
    expect(first.unchanged).toEqual({
      priceItems: 93,
      catalogItems: 60,
      modulePresets: 8,
      pricingVersions: 0,
    });
    expect(second.ready).toEqual(first.ready);
    expect(second.unchanged).toEqual(first.unchanged);
    expect(second.nextPublishedSeq).toBe(1);
  });

  it("план достаточен для DataResolver: опубликованная версия + catalogs/presets/signed", async () => {
    const plan = installPlan();
    write("pricing-versions.json", [
      {
        ...plan.pricingDraft,
        status: "published",
        publishedSeq: 1,
        publishedAt: "2026-11-09T00:00:00.000Z",
        publishedBy: "test",
      },
    ]);

    const result = await resolveCalculationInputs({
      operation: "create",
      config: defaultKitchen(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request.inputs.priceSnapshot.priceVersion).toBe(
      "price-demo-2026-01",
    );
    expect(result.value.request.inputs.catalogs.length).toBeGreaterThan(0);
    expect(result.value.request.inputs.presets).toHaveLength(5);
    expect(
      result.value.request.inputs.priceSnapshot.signedAdjustments,
    ).toContainEqual({ key: "plinth:ldsp:pvc2", amount: 0 });
  });

  it("конфликт существующей CatalogItem блокирует импорт", async () => {
    const plan = installPlan();
    const changed = plan.catalogItems.map((item, index) =>
      index === 0 ? { ...item, attrs: { unexpected: true } } : item,
    );
    write("catalog-items.json", changed);

    const report = await dryRunBootstrap();
    expect(report.importable).toBe(false);
    expect(report.ambiguous.map((item) => item.code)).toContain(
      "BOOTSTRAP_CATALOG_CONFLICT",
    );
    expect(report.ambiguous.map((item) => item.id)).toContain(
      "bodyMaterial:ldsp",
    );
  });

  it("повреждённая существующая коллекция блокирует импорт", async () => {
    writeFileSync(path.join(dir, "catalog-items.json"), "{broken", "utf8");
    const report = await dryRunBootstrap();

    expect(report.importable).toBe(false);
    expect(report.corrupt.map((item) => item.code)).toContain(
      "BOOTSTRAP_CORRUPT_COLLECTION",
    );
  });
});
