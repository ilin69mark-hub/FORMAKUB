import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import { seedDisplayMetadata } from "@/lib/admin/display-metadata";
import { defaultKitchen } from "@/lib/configurator/defaults";
import { applyMigrations } from "@/lib/server/migrations";
import { getProject, saveProject } from "@/lib/server/projects";
import { calculatePrice } from "@/lib/configurator/pricing";
import { buildImportSpec } from "@/lib/admin/import";
import { BUILD_CALC_VERSION, SUPPORTED_SCHEMA_VERSION } from "@/lib/configurator/versions";
import { readCollection, updateCollection } from "@/lib/server/store";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";
import type { PriceItem, PricingVersion } from "@/lib/admin/schema";

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-release-gate-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("Stage 8 Block 1: release gate", () => {
  it("calcVersion и schemaVersion обновлены", () => {
    expect(BUILD_CALC_VERSION).toBe("calc-2026.11.2");
    expect(SUPPORTED_SCHEMA_VERSION).toBe(2);
  });

  it("published snapshot содержит все статические price(...) Engine и edge-тарифы", async () => {
    const boot = await applyBootstrap({
      pricingVersionId: "price-2026.11.1",
      pricingLabel: "release gate",
      now: "2026-11-12T00:00:00.000Z",
    });
    await seedRulesSnapshotFixture();
    expect(boot.version.status).toBe("published");
    const items = await readCollection<PriceItem>("price-items.json");
    const versions = await readCollection<PricingVersion>("pricing-versions.json");
    const published = versions.find((version) => version.status === "published")!;
    expect(published).toBeDefined();
    const snapshotIds = new Set(published.snapshot.map((entry) => entry.priceItemId));
    const itemIds = new Set(items.map((item) => item.id));
    const specIds = new Set(buildImportSpec().entries.map((entry) => entry.id));

    const source = readFileSync(
      path.join(process.cwd(), "src/lib/configurator/engine.ts"),
      "utf8",
    );
    const staticIds = [...source.matchAll(/price\(map, "([^"]+)"/g)].map(
      (match) => match[1]!,
    );
    for (const rating of [20, 30, 60, 100, 150, 200, 300, 400]) {
      staticIds.push(`lighting.psu.${rating}`);
    }
    for (const id of staticIds) {
      expect(specIds.has(id), `spec ${id}`).toBe(true);
      expect(itemIds.has(id), `item ${id}`).toBe(true);
      expect(snapshotIds.has(id), `snapshot ${id}`).toBe(true);
    }
    expect(itemIds.has("wardrobe.edgePvc04")).toBe(true);
    expect(itemIds.has("wardrobe.edgePvc1")).toBe(true);
    expect(itemIds.has("wardrobe.edgePvc2")).toBe(true);
  });

  it("старый проект сохраняет calcVersion и config, schemaVersion мигрирует", () => {
    const config = defaultKitchen();
    const project = {
      id: "old00001",
      config,
      price: calculatePrice(config),
      schemaVersion: 1,
      calcVersion: "calc-2026.11.0",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const migrated = applyMigrations(project).project;
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.calcVersion).toBe("calc-2026.11.0");
    expect(migrated.config).toEqual(config);
  });

  it("новый проект получает calc-2026.11.2, старый не мигрирует по calcVersion", async () => {
    await seedDisplayMetadata({ actorId: "test", actorRole: "system" });
    const saved = await saveProject({ config: defaultKitchen() });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.project.calcVersion).toBe("calc-2026.11.2");
    expect(saved.project.schemaVersion).toBe(2);

    await updateCollection("projects.json", (items: Array<Record<string, unknown>>) => ({
      items: items.map((project) =>
        project.id === saved.project.id
          ? { ...project, schemaVersion: 1, calcVersion: "calc-2026.11.0" }
          : project,
      ),
      result: undefined,
    }));
    const read = await getProject(saved.project.id);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.project.calcVersion).toBe("calc-2026.11.0");
    expect(read.project.schemaVersion).toBe(2);
    expect(read.project.config).toEqual(saved.project.config);
  });
});
