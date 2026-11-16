import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorContext } from "./parameters";
import {
  PERMANENTLY_UNUSED,
  archivePriceItem,
  checkPresetPriceRefs,
  deletePriceItem,
  getPriceItem,
  listPriceItemHistory,
  listPriceItemReferences,
  listPriceItems,
  markPermanentlyUnused,
  restorePriceItem,
  setPriceItemUsage,
  updatePriceItem,
} from "./price-items";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

/** Метка optimistic locking = updatedAt сидовой записи (R-16). */
const TOKEN = "2026-01-01T00:00:00.000Z";

/** Метки для всех 4 мёртвых полей (R-16: обязательны для изменяемых записей). */
function deadTokens(value: string = TOKEN): Record<string, string> {
  return Object.fromEntries(PERMANENTLY_UNUSED.map((dead) => [dead.id, value]));
}

let dir = "";

const priceItemsPath = (): string => path.join(dir, "price-items.json");
const presetsPath = (): string => path.join(dir, "module-presets.json");
const catalogsPath = (): string => path.join(dir, "catalog-items.json");
const versionsPath = (): string => path.join(dir, "pricing-versions.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-priceitems-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data), "utf8");
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function priceItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "kitchen.hingePerDoor",
    scope: "kitchen",
    label: "Петля за дверь",
    unit: "RUB_PER_PCS",
    usage: "used",
    status: "active",
    editable: true,
    sourceRef: "src/content/pricing.ts:PRICING.kitchen.hingePerDoor",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "seed",
    ...overrides,
  };
}

function seed(items: Record<string, unknown>[]): void {
  writeJson(priceItemsPath(), items);
}

function deadItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const dead = PERMANENTLY_UNUSED[0]!;
  return priceItem({
    id: dead.id,
    label: dead.id,
    sourceRef: dead.sourceRef,
    ...overrides,
  });
}

describe("чтение и фильтры", () => {
  it("list/get: фильтры scope/usage/status, отсутствующая ставка → undefined", async () => {
    seed([
      priceItem(),
      priceItem({
        id: "wardrobe.shelf",
        scope: "wardrobe",
        usage: "unused",
        sourceRef: "src/content/pricing.ts:PRICING.wardrobe.shelf",
      }),
      priceItem({ id: "shared.delivery", scope: "shared", status: "archived", usage: "unused" }),
    ]);

    expect((await listPriceItems()).length).toBe(3);
    expect((await listPriceItems({ scope: "kitchen" })).map((i) => i.id)).toEqual([
      "kitchen.hingePerDoor",
    ]);
    expect((await listPriceItems({ usage: "unused" })).length).toBe(2);
    expect((await listPriceItems({ status: "archived" })).map((i) => i.id)).toEqual([
      "shared.delivery",
    ]);
    expect((await listPriceItems({ scope: "kitchen", usage: "used" })).length).toBe(1);

    expect(await getPriceItem("kitchen.hingePerDoor")).toMatchObject({
      id: "kitchen.hingePerDoor",
      usage: "used",
    });
    expect(await getPriceItem("ghost")).toBeUndefined();
  });
});

describe("метаданные и optimistic locking", () => {
  it("PATCH метаданных: поля применяются, updatedAt/updatedBy штампуются, аудит priceitem.update", async () => {
    seed([priceItem()]);

    const updated = await updatePriceItem(
      "kitchen.hingePerDoor",
      { label: "Петля (новая)", unit: "RUB", groupId: "hinges", expectedUpdatedAt: TOKEN },
      ACTOR,
    );

    expect(updated.label).toBe("Петля (новая)");
    expect(updated.unit).toBe("RUB");
    expect(updated.groupId).toBe("hinges");
    expect(updated.updatedBy).toBe("admin-1");
    expect(updated.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    expect(await getPriceItem("kitchen.hingePerDoor")).toEqual(updated);

    const history = await listPriceItemHistory("kitchen.hingePerDoor");
    expect(history.length).toBe(1);
    expect(history[0]?.action).toBe("priceitem.update");
    expect(history[0]?.entityType).toBe("priceItem");
    expect(history[0]?.oldValue).toEqual({ label: "Петля за дверь", unit: "RUB_PER_PCS" });
    expect(history[0]?.newValue).toEqual({
      label: "Петля (новая)",
      unit: "RUB",
      groupId: "hinges",
    });
  });

  it("запрещённые поля патча (amount/usage/status/sourceRef/scope/id/неизвестные) → отказ", async () => {
    seed([priceItem()]);

    await expect(
      updatePriceItem("kitchen.hingePerDoor", { amount: 100 } as never, ACTOR),
    ).rejects.toThrow(/amount/);
    await expect(
      updatePriceItem("kitchen.hingePerDoor", { usage: "unused" } as never, ACTOR),
    ).rejects.toThrow(/usage/);
    await expect(
      updatePriceItem("kitchen.hingePerDoor", { status: "archived" } as never, ACTOR),
    ).rejects.toThrow(/status/);
    await expect(
      updatePriceItem("kitchen.hingePerDoor", { sourceRef: "x" } as never, ACTOR),
    ).rejects.toThrow(/sourceRef/);
    await expect(
      updatePriceItem("kitchen.hingePerDoor", { scope: "shared" } as never, ACTOR),
    ).rejects.toThrow(/scope/);
    await expect(
      updatePriceItem("kitchen.hingePerDoor", { id: "other" } as never, ACTOR),
    ).rejects.toThrow(/id/);
    await expect(
      updatePriceItem("kitchen.hingePerDoor", { extra: 1 } as never, ACTOR),
    ).rejects.toThrow(/extra/);
    await expect(
      updatePriceItem("kitchen.hingePerDoor", { expectedUpdatedAt: TOKEN }, ACTOR),
    ).rejects.toThrow(/не содержит изменяемых полей/);

    const stored = readJson<Record<string, unknown>[]>(priceItemsPath());
    expect(stored[0]).toEqual(priceItem());
    expect(await listPriceItemHistory("kitchen.hingePerDoor")).toEqual([]);
  });

  it("optimistic locking: несовпадающий expectedUpdatedAt → конфликт, данные не меняются", async () => {
    seed([priceItem()]);

    await expect(
      updatePriceItem(
        "kitchen.hingePerDoor",
        { label: "X", expectedUpdatedAt: "2026-02-02T00:00:00.000Z" },
        ACTOR,
      ),
    ).rejects.toThrow(/Конфликт optimistic locking/);

    expect(readJson<Record<string, unknown>[]>(priceItemsPath())[0]?.label).toBe(
      "Петля за дверь",
    );
    expect(await listPriceItemHistory("kitchen.hingePerDoor")).toEqual([]);
  });

  it("конкурентные правки с одним expectedUpdatedAt: ровно одна применяется, журнал без ошибочных событий", async () => {
    seed([priceItem()]);
    const token = "2026-01-01T00:00:00.000Z";

    const results = await Promise.allSettled([
      updatePriceItem("kitchen.hingePerDoor", { label: "A", expectedUpdatedAt: token }, ACTOR),
      updatePriceItem("kitchen.hingePerDoor", { label: "B", expectedUpdatedAt: token }, ACTOR),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /Конфликт optimistic locking/,
    );

    const stored = readJson<Record<string, unknown>[]>(priceItemsPath());
    expect(stored.length).toBe(1);
    expect(["A", "B"]).toContain(stored[0]?.label);
    expect((await listPriceItemHistory("kitchen.hingePerDoor")).length).toBe(1);
  });

  it("правка архивной ставки → отказ (только active)", async () => {
    seed([priceItem({ status: "archived", usage: "unused" })]);

    await expect(
      updatePriceItem(
        "kitchen.hingePerDoor",
        { label: "X", expectedUpdatedAt: TOKEN },
        ACTOR,
      ),
    ).rejects.toThrow(/status=active/);
  });
});

describe("управление usage (§6.4)", () => {
  it("used → unused: штатный переход, аудит со снимками", async () => {
    seed([priceItem()]);

    const updated = await setPriceItemUsage(
      "kitchen.hingePerDoor",
      "unused",
      ACTOR,
      TOKEN,
    );
    expect(updated.usage).toBe("unused");

    const history = await listPriceItemHistory("kitchen.hingePerDoor");
    expect(history.length).toBe(1);
    expect(history[0]?.oldValue).toEqual({ usage: "used" });
    expect(history[0]?.newValue).toEqual({ usage: "unused" });
  });

  it("unused → used → отказ: только через релиз/публикацию (CA-T-211)", async () => {
    seed([priceItem({ usage: "unused" })]);

    await expect(
      setPriceItemUsage("kitchen.hingePerDoor", "used", ACTOR, TOKEN),
    ).rejects.toThrow(/релиз\/публикацию/);

    expect(readJson<Record<string, unknown>[]>(priceItemsPath())[0]?.usage).toBe("unused");
    expect(await listPriceItemHistory("kitchen.hingePerDoor")).toEqual([]);
  });

  it("повторный перевод в текущее значение — no-op без события журнала", async () => {
    seed([priceItem({ usage: "unused" })]);

    const result = await setPriceItemUsage("kitchen.hingePerDoor", "unused", ACTOR, TOKEN);
    expect(result.usage).toBe("unused");
    expect(await listPriceItemHistory("kitchen.hingePerDoor")).toEqual([]);
  });

  it("смена usage архивной ставки и конфликт метки → отказ", async () => {
    seed([priceItem({ status: "archived", usage: "unused" })]);
    await expect(
      setPriceItemUsage("kitchen.hingePerDoor", "unused", ACTOR, TOKEN),
    ).rejects.toThrow(/status=active/);

    seed([priceItem()]);
    await expect(
      setPriceItemUsage("kitchen.hingePerDoor", "unused", ACTOR, "2026-03-03T00:00:00.000Z"),
    ).rejects.toThrow(/Конфликт optimistic locking/);
    expect(readJson<Record<string, unknown>[]>(priceItemsPath())[0]?.usage).toBe("used");
    expect(await listPriceItemHistory("kitchen.hingePerDoor")).toEqual([]);
  });
});

describe("4 мёртвых поля (§4 аудита, OI-054)", () => {
  it("markPermanentlyUnused: все 4 → unused + editable=false, аудит по каждой, идемпотентно", async () => {
    seed([
      priceItem(),
      ...PERMANENTLY_UNUSED.map((dead) =>
        priceItem({
          id: dead.id,
          label: dead.id,
          sourceRef: dead.sourceRef,
        }),
      ),
    ]);

    const first = await markPermanentlyUnused(ACTOR, deadTokens());
    expect(first.marked).toEqual(PERMANENTLY_UNUSED.map((dead) => dead.id));
    expect(first.unchanged).toEqual([]);
    expect(first.missing).toEqual([]);

    const items = readJson<Record<string, unknown>[]>(priceItemsPath());
    for (const dead of PERMANENTLY_UNUSED) {
      const record = items.find((item) => item.id === dead.id);
      expect(record?.usage, dead.id).toBe("unused");
      expect(record?.editable, dead.id).toBe(false);
      const history = await listPriceItemHistory(dead.id);
      expect(history.length, dead.id).toBe(1);
      expect(history[0]?.action).toBe("priceitem.update");
    }
    // Обычная ставка не тронута.
    expect(items.find((item) => item.id === "kitchen.hingePerDoor")?.usage).toBe("used");

    // Повторный запуск с устаревшими метками: неизменяемые записи метки
    // не требуют (R-16 — метка для изменяющих операций) → unchanged.
    const second = await markPermanentlyUnused(ACTOR, deadTokens());
    expect(second.marked).toEqual([]);
    expect(second.unchanged).toEqual(PERMANENTLY_UNUSED.map((dead) => dead.id));
    expect((await listPriceItemHistory(PERMANENTLY_UNUSED[0]!.id)).length).toBe(1);
  });

  it("markPermanentlyUnused: отсутствующие ставки попадают в missing (создание вне scope)", async () => {
    seed([priceItem()]);

    const report = await markPermanentlyUnused(ACTOR, {});
    expect(report.marked).toEqual([]);
    expect(report.missing).toEqual(PERMANENTLY_UNUSED.map((dead) => dead.id));
  });

  it("прямой перевод мёртвого поля в unused выставляет editable=false", async () => {
    seed([deadItem()]);

    const updated = await setPriceItemUsage(
      PERMANENTLY_UNUSED[0]!.id,
      "unused",
      ACTOR,
      TOKEN,
    );
    expect(updated.usage).toBe("unused");
    expect(updated.editable).toBe(false);
  });
});

describe("архивирование (§6.4)", () => {
  it("используемая ставка (usage=used) не архивируется: archived+used → отказ, без журнала", async () => {
    seed([priceItem()]);

    await expect(archivePriceItem("kitchen.hingePerDoor", ACTOR, TOKEN)).rejects.toThrow(
      /archived\+used/,
    );

    expect(readJson<Record<string, unknown>[]>(priceItemsPath())[0]?.status).toBe("active");
    expect(await listPriceItemHistory("kitchen.hingePerDoor")).toEqual([]);
  });

  it("архивирование блокируется ссылками ModulePreset.priceRef и CatalogItem.priceRefs", async () => {
    seed([priceItem({ usage: "unused" }), deadItem()]);
    writeJson(presetsPath(), [
      {
        id: "base",
        family: "kitchen",
        zone: "floor",
        priceRef: "kitchen.hingePerDoor",
        status: "active",
      },
    ]);

    await expect(archivePriceItem("kitchen.hingePerDoor", ACTOR, TOKEN)).rejects.toThrow(
      /ссылаются kitchen:base/,
    );

    writeJson(presetsPath(), []);
    writeJson(catalogsPath(), [
      {
        id: "compact_hpl",
        catalog: "bodyMaterial",
        label: "Компакт HPL",
        attrs: {},
        priceRefs: ["kitchen.hingePerDoor"],
        status: "active",
      },
    ]);
    await expect(archivePriceItem("kitchen.hingePerDoor", ACTOR, TOKEN)).rejects.toThrow(
      /bodyMaterial:compact_hpl/,
    );

    expect(readJson<Record<string, unknown>[]>(priceItemsPath())[0]?.status).toBe("active");
  });

  it("штатное архивирование: active → archived, аудит; повтор → отказ", async () => {
    seed([priceItem({ usage: "unused" })]);

    const archived = await archivePriceItem("kitchen.hingePerDoor", ACTOR, TOKEN);
    expect(archived.status).toBe("archived");
    expect(archived.usage).toBe("unused");

    const history = await listPriceItemHistory("kitchen.hingePerDoor");
    expect(history.length).toBe(1);
    expect(history[0]?.oldValue).toEqual({ status: "active" });
    expect(history[0]?.newValue).toEqual({ status: "archived" });

    await expect(archivePriceItem("kitchen.hingePerDoor", ACTOR, TOKEN)).rejects.toThrow(
      /уже в архиве/,
    );
    expect((await listPriceItemHistory("kitchen.hingePerDoor")).length).toBe(1);
  });

  it("CA-516-02: ставка из published snapshot не архивируется и остаётся читаемой", async () => {
    seed([priceItem({ usage: "unused" })]);
    writeJson(versionsPath(), [
      {
        id: "price-published-1",
        status: "published",
        snapshot: [{ priceItemId: "kitchen.hingePerDoor", amount: 390 }],
      },
    ]);
    const before = readFileSync(versionsPath(), "utf8");

    await expect(archivePriceItem("kitchen.hingePerDoor", ACTOR, TOKEN)).rejects.toThrow(
      /опубликованные версии прайса \(price-published-1\)/,
    );

    expect((await getPriceItem("kitchen.hingePerDoor"))?.status).toBe("active");
    expect(await listPriceItemHistory("kitchen.hingePerDoor")).toEqual([]);
    expect(readFileSync(versionsPath(), "utf8")).toBe(before);
  });

  it("архив работает вне draft: файл версий не читается и не изменяется", async () => {
    seed([priceItem({ usage: "unused" })]);
    writeJson(versionsPath(), [
      {
        id: "price-draft-1",
        status: "draft",
        snapshot: [{ priceItemId: "kitchen.hingePerDoor", amount: 390 }],
      },
    ]);
    const before = readFileSync(versionsPath(), "utf8");

    const archived = await archivePriceItem("kitchen.hingePerDoor", ACTOR, TOKEN);
    expect(archived.status).toBe("archived");
    expect(readFileSync(versionsPath(), "utf8")).toBe(before);
  });

  it("архивирование с несовпадающей меткой → конфликт, без данных и журнала", async () => {
    seed([priceItem({ usage: "unused" })]);

    await expect(
      archivePriceItem("kitchen.hingePerDoor", ACTOR, "2026-04-04T00:00:00.000Z"),
    ).rejects.toThrow(/Конфликт optimistic locking/);
    expect(readJson<Record<string, unknown>[]>(priceItemsPath())[0]?.status).toBe("active");
    expect(await listPriceItemHistory("kitchen.hingePerDoor")).toEqual([]);
  });
});

describe("возврат из архива (§6.4)", () => {
  it("без published-версий: archived → active, аудит", async () => {
    seed([priceItem({ status: "archived", usage: "unused" })]);

    const restored = await restorePriceItem("kitchen.hingePerDoor", ACTOR, TOKEN);
    expect(restored.status).toBe("active");
    const history = await listPriceItemHistory("kitchen.hingePerDoor");
    expect(history.length).toBe(1);
    expect(history[0]?.newValue).toEqual({ status: "active" });
  });

  it("наличие в published-версии → отказ (явное решение оператора вне scope)", async () => {
    seed([priceItem({ status: "archived", usage: "unused" })]);
    writeJson(versionsPath(), [
      {
        id: "price-2026.11.1",
        status: "published",
        snapshot: [{ priceItemId: "kitchen.hingePerDoor", amount: 390 }],
      },
    ]);

    await expect(restorePriceItem("kitchen.hingePerDoor", ACTOR, TOKEN)).rejects.toThrow(
      /явное решение оператора/,
    );
    expect(readJson<Record<string, unknown>[]>(priceItemsPath())[0]?.status).toBe("archived");
    expect(await listPriceItemHistory("kitchen.hingePerDoor")).toEqual([]);
  });

  it("наличие только в draft-версии не блокирует возврат", async () => {
    seed([priceItem({ status: "archived", usage: "unused" })]);
    writeJson(versionsPath(), [
      {
        id: "price-draft-1",
        status: "draft",
        snapshot: [{ priceItemId: "kitchen.hingePerDoor", amount: 390 }],
      },
    ]);

    const restored = await restorePriceItem("kitchen.hingePerDoor", ACTOR, TOKEN);
    expect(restored.status).toBe("active");
  });

  it("возврат неархивной ставки → отказ", async () => {
    seed([priceItem()]);

    await expect(restorePriceItem("kitchen.hingePerDoor", ACTOR, TOKEN)).rejects.toThrow(
      /не в архиве/,
    );
  });
});

describe("удаление и проверка связей", () => {
  it("физическое удаление запрещено всегда (OI-046)", async () => {
    await expect(deletePriceItem("kitchen.hingePerDoor")).rejects.toThrow(
      /запрещено всегда/,
    );
    expect(existsSync(priceItemsPath())).toBe(false);
  });

  it("listPriceItemReferences: пресеты и справочники по priceRef/priceRefs", async () => {
    seed([priceItem({ usage: "unused" }), deadItem()]);
    writeJson(presetsPath(), [
      { id: "base", family: "kitchen", priceRef: "kitchen.hingePerDoor" },
      { id: "sink", family: "kitchen", priceRef: "kitchen.hingePerDoor" },
      { id: "wall", family: "kitchen", priceRef: "other.price" },
    ]);
    writeJson(catalogsPath(), [
      { id: "compact_hpl", catalog: "bodyMaterial", priceRefs: ["kitchen.hingePerDoor"] },
    ]);

    const refs = await listPriceItemReferences("kitchen.hingePerDoor");
    expect(refs.presets.sort()).toEqual(["kitchen:base", "kitchen:sink"]);
    expect(refs.catalogs).toEqual(["bodyMaterial:compact_hpl"]);
  });

  it("checkPresetPriceRefs: неразрешённые priceRef → список, разрешённые → пусто", async () => {
    seed([priceItem({ usage: "unused" })]);
    writeJson(presetsPath(), [
      { id: "base", family: "kitchen", priceRef: "kitchen.hingePerDoor" },
      { id: "sink", family: "kitchen", priceRef: "ghost.price" },
    ]);

    expect(await checkPresetPriceRefs()).toEqual([
      { preset: "kitchen:sink", priceRef: "ghost.price" },
    ]);

    writeJson(presetsPath(), [{ id: "base", family: "kitchen", priceRef: "kitchen.hingePerDoor" }]);
    expect(await checkPresetPriceRefs()).toEqual([]);
  });
});

describe("строгая валидация схемы", () => {
  it("запись с amount (X-3) отклоняется strict-схемой при любой операции", async () => {
    seed([priceItem({ amount: 390 })]);

    await expect(
      updatePriceItem(
        "kitchen.hingePerDoor",
        { label: "X", expectedUpdatedAt: TOKEN },
        ACTOR,
      ),
    ).rejects.toThrow();
    await expect(
      setPriceItemUsage("kitchen.hingePerDoor", "unused", ACTOR, TOKEN),
    ).rejects.toThrow();
    expect(
      readJson<Record<string, unknown>[]>(priceItemsPath())[0],
    ).toHaveProperty("amount", 390);
  });
});

describe("R-16: обязательный expectedUpdatedAt и монотонный updatedAt", () => {
  it("отсутствие метки → validation error для всех изменяющих операций, без данных и журнала", async () => {
    seed([
      priceItem(),
      priceItem({ id: "shared.delivery", scope: "shared", status: "archived", usage: "unused" }),
      ...PERMANENTLY_UNUSED.map((dead) =>
        priceItem({ id: dead.id, label: dead.id, sourceRef: dead.sourceRef }),
      ),
    ]);
    const before = readFileSync(priceItemsPath(), "utf8");

    await expect(
      updatePriceItem("kitchen.hingePerDoor", { label: "X" } as never, ACTOR),
    ).rejects.toThrow(/expectedUpdatedAt обязателен/);
    await expect(
      setPriceItemUsage(
        "kitchen.hingePerDoor",
        "unused",
        ACTOR,
        undefined as unknown as string,
      ),
    ).rejects.toThrow(/expectedUpdatedAt обязателен/);
    await expect(
      archivePriceItem("kitchen.hingePerDoor", ACTOR, undefined as unknown as string),
    ).rejects.toThrow(/expectedUpdatedAt обязателен/);
    await expect(
      restorePriceItem("shared.delivery", ACTOR, undefined as unknown as string),
    ).rejects.toThrow(/expectedUpdatedAt обязателен/);
    await expect(markPermanentlyUnused(ACTOR, {})).rejects.toThrow(
      /expectedUpdatedAt обязателен/,
    );

    expect(readFileSync(priceItemsPath(), "utf8")).toBe(before);
    expect(await listPriceItemHistory("kitchen.hingePerDoor")).toEqual([]);
    expect(await listPriceItemHistory(PERMANENTLY_UNUSED[0]!.id)).toEqual([]);
  });

  it("несколько изменений в пределах одной миллисекунды → строго растущий updatedAt", async () => {
    seed([priceItem()]);
    const fixed = Date.parse("2026-11-08T12:00:00.000Z");
    const spy = vi.spyOn(Date, "now").mockReturnValue(fixed);

    try {
      let token = TOKEN;
      const stamps: string[] = [];
      for (let i = 0; i < 3; i++) {
        const item = await updatePriceItem(
          "kitchen.hingePerDoor",
          { label: `Метка ${i}`, expectedUpdatedAt: token },
          ACTOR,
        );
        token = item.updatedAt;
        stamps.push(item.updatedAt);
      }

      // Один и тот же «момент» времени: значения идут с шагом 1 мс.
      expect(stamps).toEqual([
        "2026-11-08T12:00:00.000Z",
        "2026-11-08T12:00:00.001Z",
        "2026-11-08T12:00:00.002Z",
      ]);
      for (let i = 1; i < stamps.length; i++) {
        expect(Date.parse(stamps[i]!)).toBeGreaterThan(Date.parse(stamps[i - 1]!));
      }
      expect((await listPriceItemHistory("kitchen.hingePerDoor")).length).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });

  it("устаревшая метка в markPermanentlyUnused → конфликт, без данных и журнала", async () => {
    seed(
      PERMANENTLY_UNUSED.map((dead) =>
        priceItem({ id: dead.id, label: dead.id, sourceRef: dead.sourceRef }),
      ),
    );
    const before = readFileSync(priceItemsPath(), "utf8");

    await expect(
      markPermanentlyUnused(ACTOR, deadTokens("2026-02-02T00:00:00.000Z")),
    ).rejects.toThrow(/Конфликт optimistic locking/);

    expect(readFileSync(priceItemsPath(), "utf8")).toBe(before);
    expect(await listPriceItemHistory(PERMANENTLY_UNUSED[0]!.id)).toEqual([]);
  });
});
