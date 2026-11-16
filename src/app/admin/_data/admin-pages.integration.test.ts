import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import { seedDisplayMetadata } from "@/lib/admin/display-metadata";
import { getDataSources } from "@/lib/admin/data-sources";
import {
  getInspectorProject,
  listInspectorProjects,
} from "@/lib/admin/calculation-inspector";
import { listCatalogItems } from "@/lib/admin/catalogs";
import { defaultKitchen } from "@/lib/configurator/defaults";
import type { PriceBreakdown, StoredProject } from "@/lib/configurator/types";
import { updateCollection } from "@/lib/server/store";

import { getAdminOverview } from "./source";

let dir = "";

function breakdown(): PriceBreakdown {
  return {
    currency: "RUB",
    baseCost: 12000,
    bodyCost: 50000,
    frontsCost: 30000,
    fittingsCost: 10000,
    optionsCost: 40000,
    complexityFactor: 1,
    subtotal: 142000,
    discount: 0,
    total: 142000,
    minOrderApplied: false,
    lines: [{ label: "Корпус", amount: 50000, detail: "2 модул. · ЛДСП" }],
    promo: null,
    disclaimer: "test",
  };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-admin-pages-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-pages.1",
    pricingLabel: "pages test",
    now: "2026-11-13T00:00:00.000Z",
  });
  await seedDisplayMetadata({ actorId: "test", actorRole: "system" });
  await updateCollection<StoredProject, void>("projects.json", () => ({
    items: [
      {
        id: "p-pages",
        config: defaultKitchen(),
        schemaVersion: 2,
        calcVersion: "calc-2026.11.2",
        priceVersion: "price-pages.1",
        price: breakdown(),
        createdAt: "2026-11-13T00:00:00.000Z",
        updatedAt: "2026-11-13T00:00:00.000Z",
      },
    ],
    result: undefined,
  }));
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("Admin pages: реальные источники после bootstrap", () => {
  it("обзор не содержит ошибок источников и считает каталоги/модули", async () => {
    const overview = await getAdminOverview();
    expect(overview.errors).toEqual([]);
    expect(overview.catalogCounts.total).toBeGreaterThan(0);
    expect(overview.moduleCounts.kitchenTypes).toBe(8);
    expect(overview.pricing.publishedVersions).toBe(1);
    expect(overview.pricing.missingPriceRefs).toBe(0);
  });

  it("каталоги и источники данных читаются без подстановок", async () => {
    const materialItems = await listCatalogItems("bodyMaterial");
    expect(materialItems.length).toBeGreaterThan(0);
    const board = await getDataSources();
    expect(board.rows.length).toBeGreaterThan(0);
    expect(board.issues).toEqual([]);
    expect(board.counts.conflict).toBe(0);
    expect(
      board.rows.filter((row) => row.kind === "catalogItem").every((row) => row.sourceRef === null),
    ).toBe(true);
  });

  it("инспектор открывает сохранённый проект и не выдумывает трассировку", async () => {
    const list = await listInspectorProjects();
    expect(list.issues).toEqual([]);
    expect(list.projects.map((project) => project.id)).toContain("p-pages");
    const result = await getInspectorProject("p-pages");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.project.priceVersion).toBe("price-pages.1");
    expect(result.data.priceVersion?.id).toBe("price-pages.1");
    expect(result.data.lines.length).toBeGreaterThan(0);
    expect(result.data.lines.every((line) => line.traceable === false)).toBe(true);
    expect(result.data.rules?.status).toBe("legacy_no_snapshot");
  });
});
