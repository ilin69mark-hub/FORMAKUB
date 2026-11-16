import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listAuditEvents } from "@/lib/server/audit";
import { readCollection } from "@/lib/server/store";

import { buildBootstrapPlan } from "./bootstrap";
import { migrateCatalogSources } from "./catalog-source-migration";
import type { CatalogItem } from "./schema";

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-source-migration-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "json-file";
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

function seed(): CatalogItem[] {
  const plan = buildBootstrapPlan("2026-11-09T00:00:00.000Z");
  const items = plan.catalogItems.map((item) => {
    if (item.catalog !== "supportSystem" && item.catalog !== "ledStrip") return item;
    const { source, ...attrs } = item.attrs;
    void source;
    return { ...item, attrs };
  });
  writeFileSync(
    path.join(dir, "catalog-items.json"),
    JSON.stringify(items),
    "utf8",
  );
  return items;
}

describe("CA-T-306D source migration", () => {
  it("заполняет source у 10 записей, сохраняет attrs и идемпотентен", async () => {
    const before = seed();
    const actor = { actorId: "migration", actorRole: "system" };

    const first = await migrateCatalogSources(actor, "2026-11-09T01:00:00.000Z");
    expect(first.migrated).toHaveLength(10);
    expect(first.unchanged).toHaveLength(0);

    const after = await readCollection<CatalogItem>("catalog-items.json");
    for (const target of after.filter(
      (item) => item.catalog === "supportSystem" || item.catalog === "ledStrip",
    )) {
      expect(target.attrs.source).toBe("preliminary");
    }
    const support = after.find(
      (item) => item.catalog === "supportSystem" && item.id === "standard",
    )!;
    expect(support.attrs).toMatchObject({
      edgeInsetCm: 4,
      maxSpanCm: 60,
      source: "preliminary",
    });
    const strip = after.find(
      (item) => item.catalog === "ledStrip" && item.id === "led-24v-9w6",
    )!;
    expect(strip.attrs).toMatchObject({
      power: 9.6,
      voltage: 24,
      source: "preliminary",
    });
    expect(
      after.filter((item) => item.catalog === "supportSystem" || item.catalog === "ledStrip").length,
    ).toBe(10);
    expect(after.length).toBe(before.length);

    const audits = await listAuditEvents({ action: "catalog.update" });
    expect(audits).toHaveLength(10);
    expect(audits.every((event) => event.entityType === "catalog")).toBe(true);

    const second = await migrateCatalogSources(actor, "2026-11-09T02:00:00.000Z");
    expect(second.migrated).toHaveLength(0);
    expect(second.unchanged).toHaveLength(10);
    expect(await listAuditEvents({ action: "catalog.update" })).toHaveLength(10);
  });
});
