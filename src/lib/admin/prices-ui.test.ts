import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyBootstrap } from "./bootstrap";
import type { PricingDiffEntry } from "./pricing";
import type { PriceItem, PricingVersion } from "./schema";
import {
  amountInVersion,
  filterPriceItems,
  formatDiffValue,
  formatPriceAmount,
  parsePriceItemFilter,
  summarizeDiff,
} from "./prices-ui";
import { getPriceBoard } from "@/app/admin/prices/_data/source";

function priceItem(input: Partial<PriceItem> & { id: string }): PriceItem {
  return {
    id: input.id,
    label: input.label ?? input.id,
    scope: input.scope ?? "kitchen",
    unit: input.unit ?? "RUB",
    groupId: input.groupId ?? "test",
    sourceRef: input.sourceRef ?? "test",
    usage: input.usage ?? "used",
    status: input.status ?? "active",
    editable: input.editable ?? true,
    updatedAt: input.updatedAt ?? "2026-11-10T00:00:00.000Z",
  } as PriceItem;
}

function version(
  id: string,
  status: PricingVersion["status"],
  amount: number,
): PricingVersion {
  return {
    id,
    label: id,
    status,
    snapshot: [{ priceItemId: "kitchen.hingePerDoor", amount }],
    rules: {},
    promos: [],
    baseSchema: 1,
    createdAt: "2026-11-10T00:00:00.000Z",
    createdBy: "test",
  } as PricingVersion;
}

describe("представление ставок (CA-T-504)", () => {
  it("сумма берётся из конкретной версии; отсутствие — undefined", () => {
    const published = version("price-1", "published", 320);
    expect(amountInVersion(published, "kitchen.hingePerDoor")).toBe(320);
    expect(amountInVersion(published, "kitchen.unknown")).toBeUndefined();

    const hinge = priceItem({ id: "kitchen.hingePerDoor" });
    expect(formatPriceAmount(hinge, 320)).toContain("320");
    expect(formatPriceAmount(hinge, undefined)).toBe("нет в версии");
  });

  it("фильтры q/scope/status/usage; неизвестные значения игнорируются", () => {
    const items = [
      priceItem({ id: "kitchen.hingePerDoor", label: "Петля" }),
      priceItem({ id: "wardrobe.hingePerDoor", scope: "wardrobe", label: "Петля" }),
      priceItem({ id: "kitchen.archived", status: "archived" }),
      priceItem({ id: "kitchen.unused", usage: "unused" }),
    ];

    expect(parsePriceItemFilter({ status: "unknown" }).status).toBeUndefined();
    expect(parsePriceItemFilter({ q: "  hinge " }).q).toBe("hinge");

    expect(
      filterPriceItems(items, { q: "hinge" }).map((item) => item.id),
    ).toEqual(["kitchen.hingePerDoor", "wardrobe.hingePerDoor"]);
    expect(
      filterPriceItems(items, { scope: "wardrobe" }).every(
        (item) => item.scope === "wardrobe",
      ),
    ).toBe(true);
    expect(
      filterPriceItems(items, { status: "archived" }).map((item) => item.id),
    ).toEqual(["kitchen.archived"]);
    expect(
      filterPriceItems(items, { usage: "unused" }).map((item) => item.id),
    ).toEqual(["kitchen.unused"]);
    expect(filterPriceItems(items, { q: "zzz" })).toEqual([]);
  });

  it("formatDiffValue и пустой diff", () => {
    expect(formatDiffValue(null)).toBe("—");
    expect(formatDiffValue(350)).toBe("350");
    expect(formatDiffValue({ a: 1 })).toContain('"a":1');
    expect(summarizeDiff([])).toEqual({
      total: 0,
      priceItems: 0,
      rules: 0,
      promos: 0,
      metadata: 0,
      changedPriceItemKeys: [],
    });
  });

  it("summarizeDiff классифицирует реальные записи diff", () => {
    const diff: PricingDiffEntry[] = [
      {
        targetType: "priceItem",
        targetKey: "kitchen.hingePerDoor",
        field: "amount",
        oldValue: 320,
        newValue: 350,
      },
      {
        targetType: "rule",
        targetKey: "minOrder",
        field: "value",
        oldValue: 45000,
        newValue: 47000,
      },
      {
        targetType: "promo",
        targetKey: "WARDROBE5",
        field: "value",
        oldValue: 5,
        newValue: 6,
      },
      {
        targetType: "metadata",
        targetKey: "price-1",
        field: "label",
        oldValue: "old",
        newValue: "new",
      },
    ];
    const summary = summarizeDiff(diff);
    expect(summary.total).toBe(4);
    expect(summary.priceItems).toBe(1);
    expect(summary.rules).toBe(1);
    expect(summary.promos).toBe(1);
    expect(summary.metadata).toBe(1);
    expect(summary.changedPriceItemKeys).toEqual(["kitchen.hingePerDoor"]);
  });
});

describe("реальный источник прайс-борда (CA-T-504)", () => {
  it("читает опубликованную версию и ставки через Storage Adapter", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "formakub-prices-ui-"));
    const previousDir = process.env.FORMAKUB_DATA_DIR;
    const previousStorage = process.env.FORMAKUB_STORAGE;
    process.env.FORMAKUB_DATA_DIR = dir;
    process.env.FORMAKUB_STORAGE = "sqlite";
    try {
      await applyBootstrap({
        pricingVersionId: "price-prices-ui.1",
        pricingLabel: "Prices UI test",
        now: "2026-11-10T00:00:00.000Z",
      });
      const board = await getPriceBoard();
      expect(board.published?.id).toBe("price-prices-ui.1");
      expect(board.published?.status).toBe("published");
      expect(board.draft).toBeNull();
      expect(board.items.length).toBeGreaterThan(0);
      expect(board.diff).toEqual([]);
      expect(board.affectedProjects).toEqual([]);
    } finally {
      if (previousDir === undefined) delete process.env.FORMAKUB_DATA_DIR;
      else process.env.FORMAKUB_DATA_DIR = previousDir;
      if (previousStorage === undefined) delete process.env.FORMAKUB_STORAGE;
      else process.env.FORMAKUB_STORAGE = previousStorage;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
