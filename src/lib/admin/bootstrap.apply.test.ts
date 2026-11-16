import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { KITCHEN_MODULES } from "@/content/catalog";
import { defaultKitchen, makeKitchenModule } from "@/lib/configurator/defaults";
import { calculatePrice } from "@/lib/configurator/pricing";
import { readCollection } from "@/lib/server/store";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { applyBootstrap } from "./bootstrap";
import type {
  CatalogItem,
  ModulePreset,
  PriceItem,
  PricingVersion,
} from "./schema";

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-bootstrap-apply-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("CA-T-306A production apply (isolated SQLite)", () => {
  it("атомарно импортирует, публикует seq=1 и идемпотентен", async () => {
    const first = await applyBootstrap({
      pricingVersionId: "price-2026.11.1",
      pricingLabel: "Начальный production import",
      now: "2026-11-09T00:00:00.000Z",
    });
    await seedRulesSnapshotFixture();

    expect(first.written).toEqual({
      priceItems: 93,
      catalogItems: 60,
      modulePresets: 8,
      pricingVersions: 1,
    });
    expect(first.version.id).toBe("price-2026.11.1");
    expect(first.version.status).toBe("published");
    expect(first.publishedSeq).toBe(1);
    expect(first.published).toBe(true);
    expect(first.idempotent).toBe(false);

    const prices = await readCollection<PriceItem>("price-items.json");
    const catalogs = await readCollection<CatalogItem>("catalog-items.json");
    const presets = await readCollection<ModulePreset>("module-presets.json");
    const versions = await readCollection<PricingVersion>("pricing-versions.json");
    expect(prices).toHaveLength(93);
    expect(catalogs).toHaveLength(60);
    expect(presets).toHaveLength(8);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.signedAdjustments).toContainEqual({
      key: "plinth:ldsp:pvc04",
      amount: -120,
    });

    for (const [type] of Object.entries(KITCHEN_MODULES)) {
      const config = {
        ...defaultKitchen(),
        modules: [
          makeKitchenModule(type as keyof typeof KITCHEN_MODULES, {
            id: `m-${type}`,
          }),
        ],
      };
      const resolved = await resolveCalculationInputs({
        operation: "create",
        config,
      });
      expect(resolved.ok, type).toBe(true);
      if (!resolved.ok) continue;
      expect(
        resolved.value.request.inputs.presets.find((item) => item.id === type),
      ).toBeDefined();
      expect(calculatePrice(config, resolved.value.request.inputs).total).toBeGreaterThan(0);
    }

    const second = await applyBootstrap({
      pricingVersionId: "price-2026.11.1",
      pricingLabel: "Начальный production import",
      now: "2026-11-09T00:00:00.000Z",
    });
    expect(second.idempotent).toBe(true);
    expect(second.published).toBe(false);
    expect(second.written).toEqual({
      priceItems: 0,
      catalogItems: 0,
      modulePresets: 0,
      pricingVersions: 0,
    });
    expect(await readCollection("price-items.json")).toHaveLength(93);
    expect(await readCollection("catalog-items.json")).toHaveLength(60);
    expect(await readCollection("module-presets.json")).toHaveLength(8);
    expect(await readCollection("pricing-versions.json")).toHaveLength(1);
  });
});
