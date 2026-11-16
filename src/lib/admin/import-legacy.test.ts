import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBootstrap } from "./bootstrap";
import { importPriceItems } from "./import";
import { publishPricingVersion } from "./publish";
import {
  priceItemSchema,
  pricingVersionSchema,
  type PriceItem,
  type PricingVersion,
} from "./schema";
import { readCollection, updateCollection } from "@/lib/server/store";

const ACTOR = { actorId: "legacy-test", actorRole: "calc-admin" as const };
const LEGACY = [
  ["catalog.body.mdf.ratePerSqm", 7600],
  ["catalog.body.plywood.ratePerSqm", 9200],
  ["catalog.facade.veneer.ratePerSqm", 11800],
  ["catalog.facade.glass.ratePerSqm", 14400],
  ["catalog.facade.solid.ratePerSqm", 18600],
] as const;

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-legacy-import-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-legacy-test",
    pricingLabel: "legacy import test",
    now: "2026-11-12T00:00:00.000Z",
  });
  const now = "2026-11-12T00:00:00.000Z";
  await updateCollection<PriceItem, void>("price-items.json", (items) => ({
    items: [
      ...items,
      ...LEGACY.map(([id]) =>
        priceItemSchema.parse({
          id,
          scope: "shared",
          label: id,
          unit: "RUB_PER_SQM",
          usage: "used",
          status: "active",
          editable: false,
          sourceRef: `src/content/catalog.ts:LEGACY.${id}`,
          createdAt: now,
          updatedAt: now,
          updatedBy: ACTOR.actorId,
        }),
      ),
    ],
    result: undefined,
  }));
  await updateCollection<PricingVersion, void>("pricing-versions.json", (versions) => ({
    items: versions.map((version) =>
      version.status === "published"
        ? pricingVersionSchema.parse({
            ...version,
            snapshot: [
              ...version.snapshot,
              ...LEGACY.map(([priceItemId, amount]) => ({ priceItemId, amount })),
            ],
          })
        : version,
    ),
    result: undefined,
  }));
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("CA-T-516: импорт при наличии legacy-ставок", () => {
  it("импорт не падает и сохраняет legacy без изменений", async () => {
    const before = await readCollection<PriceItem>("price-items.json");
    const report = await importPriceItems(ACTOR);
    expect(report.conflicts).toEqual([]);
    expect(report.snapshot).not.toBeNull();
    const after = await readCollection<PriceItem>("price-items.json");
    for (const [id] of LEGACY) {
      const old = before.find((item) => item.id === id)!;
      const next = after.find((item) => item.id === id)!;
      expect(next).toEqual(old);
    }
  });

  it("повторный импорт идемпотентен", async () => {
    const first = await importPriceItems(ACTOR);
    const second = await importPriceItems(ACTOR);
    expect(second.conflicts).toEqual([]);
    expect(second.snapshot?.entries).toBe(first.snapshot?.entries);
  });

  it("legacy входят в snapshot для исторической совместимости и публикуются", async () => {
    const report = await importPriceItems(ACTOR);
    expect(report.snapshot?.versionId).toBeTruthy();
    const published = await publishPricingVersion(report.snapshot!.versionId, ACTOR);
    const ids = new Set(published.version.snapshot.map((entry) => entry.priceItemId));
    for (const [id] of LEGACY) expect(ids.has(id)).toBe(true);
    expect(ids.has("wardrobe.edgePvc1")).toBe(true);
  });

  it("неизвестная active/used без источника по-прежнему конфликтует", async () => {
    await updateCollection<PriceItem, void>("price-items.json", (items) => ({
      items: [
        ...items,
        priceItemSchema.parse({
          id: "unknown.legacy.rate",
          scope: "shared",
          label: "unknown",
          unit: "RUB_PER_SQM",
          usage: "used",
          status: "active",
          editable: false,
          sourceRef: "src/content/unknown.ts:rate",
          createdAt: "2026-11-12T00:00:00.000Z",
          updatedAt: "2026-11-12T00:00:00.000Z",
          updatedBy: ACTOR.actorId,
        }),
      ],
      result: undefined,
    }));
    const report = await importPriceItems(ACTOR);
    expect(report.conflicts.some((item) => item.id === "unknown.legacy.rate")).toBe(true);
  });
});
