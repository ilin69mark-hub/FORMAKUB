import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createCatalogItem,
  getCatalogItem,
  listCatalogItems,
} from "./catalogs";
import { getModulePreset, listModulePresets } from "./presets";
import {
  applyCatalogArchive,
  applyPresetArchive,
} from "./reference-archive";
import {
  catalogArchiveAvailability,
  filterCatalogItems,
  filterModulePresets,
  formatCatalogAttrs,
  formatDimension,
  parseCatalogFilter,
  parsePresetFilter,
  presetArchiveAvailability,
} from "./reference-ui";
import type { ActorContext } from "./parameters";
import type { ModulePreset } from "./schema";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-ref-ui-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function catalogInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "quartz",
    catalog: "countertop",
    label: "Кварцевый агломерат",
    attrs: { rate: 29400, decor: ["white", "grey"] },
    status: "active",
    ...overrides,
  };
}

function presetFixture(overrides: Partial<ModulePreset> = {}): ModulePreset {
  return {
    id: "base",
    family: "kitchen",
    zone: "floor",
    width: { min: 15, max: 200, default: 60 },
    height: { min: 40, max: 280, default: 72 },
    depth: { min: 20, max: 80, default: 60 },
    defaultShelves: 1,
    defaultDrawers: 0,
    priceRef: "kitchen.module.base",
    status: "active",
    version: "1",
    updatedAt: "2026-11-09T00:00:00.000Z",
    updatedBy: "seed",
    ...overrides,
  };
}

function writeCollection(file: string, items: unknown[]): void {
  writeFileSync(path.join(dir, file), JSON.stringify(items), "utf8");
}

describe("представление справочников (CA-T-503)", () => {
  it("фильтры status/q и названия видов", async () => {
    const first = await createCatalogItem(catalogInput(), ACTOR);
    const second = await createCatalogItem(
      catalogInput({ id: "ldsp", label: "ЛДСП", attrs: {} }),
      ACTOR,
    );

    expect(parseCatalogFilter({ status: "unknown" }).status).toBeUndefined();
    expect(parseCatalogFilter({ q: "  quartz " }).q).toBe("quartz");
    expect(filterCatalogItems([first, second], { q: "лдсп" }).map((i) => i.id)).toEqual([
      "ldsp",
    ]);
    expect(filterCatalogItems([first, second], { status: "archived" })).toEqual([]);
    expect(formatCatalogAttrs(first)).toContain("rate: 29400");
    expect(formatCatalogAttrs(first)).toContain("decor: white, grey");
  });

  it("доступность архивирования: active — да, archived/preliminary — причина", async () => {
    const active = await createCatalogItem(catalogInput(), ACTOR);
    expect(catalogArchiveAvailability(active)).toEqual({ canArchive: true });

    expect(
      catalogArchiveAvailability({ ...active, status: "archived" }),
    ).toMatchObject({ canArchive: false });

    expect(
      catalogArchiveAvailability({ ...active, status: "preliminary" }),
    ).toMatchObject({ canArchive: false });
  });
});

describe("представление пресетов (CA-T-503)", () => {
  it("фильтры family/status/q, размеры и доступность архива", () => {
    const active = presetFixture();
    const archived = presetFixture({
      id: "tall",
      family: "wardrobe",
      status: "archived",
    });

    expect(parsePresetFilter({ family: "unknown" }).family).toBeUndefined();
    expect(parsePresetFilter({ family: "wardrobe", status: "archived" })).toMatchObject({
      family: "wardrobe",
      status: "archived",
    });
    expect(filterModulePresets([active, archived], { family: "kitchen" }).map((p) => p.id)).toEqual([
      "base",
    ]);
    expect(filterModulePresets([active, archived], { q: "tal" }).map((p) => p.id)).toEqual([
      "tall",
    ]);
    expect(formatDimension(active.width)).toBe("15 … 200 (по умолчанию 60)");
    expect(presetArchiveAvailability(active)).toEqual({ canArchive: true });
    expect(presetArchiveAvailability(archived)).toMatchObject({ canArchive: false });
  });
});

describe("архивирование через существующие сервисы (CA-T-503)", () => {
  it("элемент справочника: active → archived, запись сохраняется", async () => {
    const created = await createCatalogItem(catalogInput(), ACTOR);

    const result = await applyCatalogArchive({
      catalog: created.catalog,
      id: created.id,
      actor: ACTOR,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.status).toBe("archived");
    expect(result.message).toContain("archived");

    const stored = await getCatalogItem(created.catalog, created.id);
    expect(stored?.status).toBe("archived");
  });

  it("повторное архивирование и отсутствующий элемент возвращают ошибку", async () => {
    const created = await createCatalogItem(catalogInput(), ACTOR);
    await applyCatalogArchive({
      catalog: created.catalog,
      id: created.id,
      actor: ACTOR,
    });

    const again = await applyCatalogArchive({
      catalog: created.catalog,
      id: created.id,
      actor: ACTOR,
    });
    expect(again.ok).toBe(false);
    expect(again.ok ? "" : again.message).toMatch(/уже в архиве/);

    const missing = await applyCatalogArchive({
      catalog: "countertop",
      id: "missing",
      actor: ACTOR,
    });
    expect(missing.ok).toBe(false);
    expect(missing.ok ? "" : missing.message).toMatch(/не найден/);
  });

  it("ссылка из проекта блокирует архивирование (ТЗ §8 → 409)", async () => {
    const created = await createCatalogItem(catalogInput(), ACTOR);
    writeCollection("projects.json", [
      { id: "project-1", config: { countertop: created.id } },
    ]);

    const result = await applyCatalogArchive({
      catalog: created.catalog,
      id: created.id,
      actor: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(/используется в проектах/);
    expect((await getCatalogItem(created.catalog, created.id))?.status).toBe(
      "active",
    );
  });

  it("пресет: active → archived с инкрементом version; повторно — ошибка", async () => {
    writeCollection("module-presets.json", [presetFixture()]);

    const result = await applyPresetArchive({
      family: "kitchen",
      id: "base",
      actor: ACTOR,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.status).toBe("archived");
    expect(result.item.version).toBe("2");
    expect((await getModulePreset("kitchen", "base"))?.status).toBe("archived");

    const again = await applyPresetArchive({
      family: "kitchen",
      id: "base",
      actor: ACTOR,
    });
    expect(again.ok).toBe(false);
    expect(again.ok ? "" : again.message).toMatch(/уже в архиве/);

    const missing = await applyPresetArchive({
      family: "kitchen",
      id: "missing",
      actor: ACTOR,
    });
    expect(missing.ok).toBe(false);
    expect(missing.ok ? "" : missing.message).toMatch(/не найден/);
  });

  it("список читается из хранилища и содержит архивные записи", async () => {
    writeCollection("module-presets.json", [
      presetFixture(),
      presetFixture({ id: "tall", status: "archived" }),
    ]);

    const items = await listModulePresets({ family: "kitchen" });
    expect(items.map((item) => item.id)).toEqual(["base", "tall"]);
    expect(filterModulePresets(items, { status: "archived" }).map((p) => p.id)).toEqual([
      "tall",
    ]);

    await createCatalogItem(catalogInput(), ACTOR);
    expect((await listCatalogItems("countertop")).length).toBe(1);
  });
});
