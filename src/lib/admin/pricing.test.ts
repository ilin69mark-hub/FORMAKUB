import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importPriceItems } from "./import";
import type { ActorContext } from "./parameters";
import {
  diffDraftWithPublished,
  getDraftVersion,
  getPublishedVersion,
  getVersion,
  listVersions,
} from "./pricing";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

const versionsPath = (): string => path.join(dir, "pricing-versions.json");
const auditPath = (): string => path.join(dir, "admin-audit-log.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-pricing-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeVersions(versions: unknown[]): void {
  writeFileSync(versionsPath(), JSON.stringify(versions), "utf8");
}

function bytes(file: string): string {
  return readFileSync(file, "utf8");
}

function promo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: "DEMO10",
    title: "10% на кухню",
    description: "Демонстрационный промокод.",
    type: "percent",
    value: 10,
    minSubtotal: 120000,
    maxDiscount: 30000,
    appliesTo: ["kitchen"],
    active: true,
    demo: true,
    ...overrides,
  };
}

function publishedVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "price-2026.10.9",
    label: "Опубликованная",
    status: "published",
    snapshot: [
      { priceItemId: "kitchen.shelf", amount: 1100 },
      { priceItemId: "kitchen.hingePerDoor", amount: 390 },
    ],
    rules: { rounding: 100, minOrder: 45000 },
    promos: [promo()],
    baseSchema: 1,
    disclaimer: "Цены демо.",
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: "seed",
    publishedAt: "2026-10-02T00:00:00.000Z",
    publishedBy: "seed",
    ...overrides,
  };
}

function draftVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return publishedVersion({
    id: "price-demo-2026-01",
    status: "draft",
    createdAt: "2026-11-08T00:00:00.000Z",
    createdBy: "admin-1",
    publishedAt: undefined,
    publishedBy: undefined,
    ...overrides,
  });
}

function changesOf(result: Awaited<ReturnType<typeof diffDraftWithPublished>>) {
  if (result.status !== "ok") {
    throw new Error(`Ожидался ok, получен ${result.status}`);
  }
  return result.diff.changes;
}

describe("чтение версий (draft management)", () => {
  it("получение существующего draft после импорта CA-T-208; listVersions/getVersion", async () => {
    await importPriceItems(ACTOR);

    const draft = await getDraftVersion();
    expect(draft?.id).toBe("price-demo-2026-01");
    expect(draft?.status).toBe("draft");

    const versions = await listVersions();
    expect(versions.length).toBe(1);
    expect(await getVersion("price-demo-2026-01")).toEqual(draft);
    expect(await getVersion("ghost")).toBeUndefined();
  });

  it("отсутствие draft: undefined, diff → no_draft, ничего не создаётся", async () => {
    writeVersions([publishedVersion()]);
    const before = bytes(versionsPath());

    expect(await getDraftVersion()).toBeUndefined();
    expect(await diffDraftWithPublished()).toEqual({ status: "no_draft" });
    expect(bytes(versionsPath())).toBe(before);
    // Повторные вызовы не создают draft и не дублируют записи.
    expect(await getDraftVersion()).toBeUndefined();
    expect((await listVersions()).length).toBe(1);
  });

  it("получение опубликованной версии; отсутствующая → undefined", async () => {
    writeVersions([publishedVersion(), draftVersion()]);

    const published = await getPublishedVersion();
    expect(published?.id).toBe("price-2026.10.9");
    expect(published?.status).toBe("published");
    expect(await getVersion("нет-такой")).toBeUndefined();
  });

  it("отсутствие опубликованной версии: undefined, diff → no_published", async () => {
    writeVersions([draftVersion()]);

    expect(await getPublishedVersion()).toBeUndefined();
    expect(await diffDraftWithPublished()).toEqual({ status: "no_published" });
    expect((await listVersions()).length).toBe(1);
  });

  it("несколько draft / нескольких published — отказ, без молчаливой подмены", async () => {
    writeVersions([draftVersion(), draftVersion({ id: "price-other" })]);
    await expect(getDraftVersion()).rejects.toThrow(/несколько draft|draft-версий/);

    writeVersions([
      publishedVersion(),
      publishedVersion({ id: "price-2026.11.9" }),
    ]);
    await expect(getPublishedVersion()).rejects.toThrow(/опубликованных версий/);
  });
});

describe("diff draft ↔ published (§6.6)", () => {
  it("diff без изменений: changes пуст", async () => {
    writeVersions([publishedVersion(), draftVersion()]);

    const result = await diffDraftWithPublished();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.diff.fromVersionId).toBe("price-2026.10.9");
    expect(result.diff.toVersionId).toBe("price-demo-2026-01");
    expect(result.diff.changes).toEqual([]);
  });

  it("добавленный элемент snapshot → oldValue=null", async () => {
    writeVersions([
      publishedVersion(),
      draftVersion({
        snapshot: [
          { priceItemId: "kitchen.shelf", amount: 1100 },
          { priceItemId: "kitchen.hingePerDoor", amount: 390 },
          { priceItemId: "lighting.psu.400", amount: 5600 },
        ],
      }),
    ]);

    expect(changesOf(await diffDraftWithPublished())).toEqual([
      {
        targetType: "priceItem",
        targetKey: "lighting.psu.400",
        field: "amount",
        oldValue: null,
        newValue: 5600,
      },
    ]);
  });

  it("удалённый элемент snapshot → newValue=null (§6.6)", async () => {
    writeVersions([
      publishedVersion(),
      draftVersion({
        snapshot: [{ priceItemId: "kitchen.shelf", amount: 1100 }],
      }),
    ]);

    expect(changesOf(await diffDraftWithPublished())).toEqual([
      {
        targetType: "priceItem",
        targetKey: "kitchen.hingePerDoor",
        field: "amount",
        oldValue: 390,
        newValue: null,
      },
    ]);
  });

  it("изменённые значения: amount ставки, правило, поле промокода, метаданные", async () => {
    writeVersions([
      publishedVersion(),
      draftVersion({
        snapshot: [
          { priceItemId: "kitchen.shelf", amount: 1250 },
          { priceItemId: "kitchen.hingePerDoor", amount: 390 },
        ],
        rules: { rounding: 50, minOrder: 45000 },
        promos: [promo({ value: 15 })],
        label: "Draft 2",
      }),
    ]);

    expect(changesOf(await diffDraftWithPublished())).toEqual([
      {
        targetType: "priceItem",
        targetKey: "kitchen.shelf",
        field: "amount",
        oldValue: 1100,
        newValue: 1250,
      },
      { targetType: "rule", targetKey: "rounding", field: "rounding", oldValue: 100, newValue: 50 },
      { targetType: "promo", targetKey: "DEMO10", field: "value", oldValue: 10, newValue: 15 },
      { targetType: "metadata", targetKey: "label", field: "label", oldValue: "Опубликованная", newValue: "Draft 2" },
    ]);
  });

  it("изменение нескольких полей одного объекта (promo) — отдельные записи по field", async () => {
    writeVersions([
      publishedVersion(),
      draftVersion({
        promos: [promo({ value: 15, minSubtotal: 100000 })],
      }),
    ]);

    const changes = changesOf(await diffDraftWithPublished());
    const promoChanges = changes.filter(
      (change) => change.targetType === "promo" && change.targetKey === "DEMO10",
    );
    expect(promoChanges).toEqual([
      { targetType: "promo", targetKey: "DEMO10", field: "minSubtotal", oldValue: 120000, newValue: 100000 },
      { targetType: "promo", targetKey: "DEMO10", field: "value", oldValue: 10, newValue: 15 },
    ]);
    // Контракт snapshot (§6.5/X-2): у priceItem ровно одно поле amount —
    // множественность полей применима к rules/promos (§6.6 field).
    expect(changes.filter((change) => change.targetType === "priceItem")).toEqual([]);
  });

  it("сопоставление по ID: порядок элементов снимка не значим", async () => {
    writeVersions([
      publishedVersion(),
      draftVersion({
        snapshot: [
          { priceItemId: "kitchen.hingePerDoor", amount: 390 },
          { priceItemId: "kitchen.shelf", amount: 1100 },
        ],
      }),
    ]);

    expect(changesOf(await diffDraftWithPublished())).toEqual([]);
  });

  it("одинаковые суммы при разных ID — не идентичность: удаление + добавление", async () => {
    writeVersions([
      publishedVersion({
        snapshot: [{ priceItemId: "preset.a.basePrice", amount: 5000 }],
        promos: [],
      }),
      draftVersion({
        snapshot: [{ priceItemId: "kitchen.bottleRack", amount: 5000 }],
        promos: [],
      }),
    ]);

    // Совпадение amount не доказывает эквивалентности (R-15): это две
    // разные сущности → ровно две записи.
    expect(changesOf(await diffDraftWithPublished())).toEqual([
      {
        targetType: "priceItem",
        targetKey: "kitchen.bottleRack",
        field: "amount",
        oldValue: null,
        newValue: 5000,
      },
      {
        targetType: "priceItem",
        targetKey: "preset.a.basePrice",
        field: "amount",
        oldValue: 5000,
        newValue: null,
      },
    ]);
  });
});

describe("неизменность данных и read-only поведение", () => {
  it("draft не изменяется после diff (байт-в-байт)", async () => {
    writeVersions([publishedVersion(), draftVersion({ snapshot: [{ priceItemId: "x", amount: 1 }] })]);
    const before = bytes(versionsPath());

    await diffDraftWithPublished();
    await diffDraftWithPublished();

    expect(bytes(versionsPath())).toBe(before);
  });

  it("опубликованный snapshot не изменяется после diff", async () => {
    writeVersions([publishedVersion(), draftVersion({ rules: { rounding: 50, minOrder: 45000 } })]);
    const before = bytes(versionsPath());

    const result = await diffDraftWithPublished();
    expect(result.status).toBe("ok");

    expect(bytes(versionsPath())).toBe(before);
    const stored = JSON.parse(bytes(versionsPath())) as Array<{ status: string; snapshot: unknown }>;
    const published = stored.find((version) => version.status === "published")!;
    expect(published.snapshot).toEqual([
      { priceItemId: "kitchen.shelf", amount: 1100 },
      { priceItemId: "kitchen.hingePerDoor", amount: 390 },
    ]);
  });

  it("read-only diff: audit-события не создаются", async () => {
    writeVersions([publishedVersion(), draftVersion({ label: "Другой" })]);

    expect(await diffDraftWithPublished()).toMatchObject({ status: "ok" });
    expect(await listVersions());
    expect(await getDraftVersion());
    expect(await getPublishedVersion());

    expect(existsSync(auditPath())).toBe(false);
  });
});

describe("граничные и некорректные данные", () => {
  it("пустой snapshot draft против непустого published — все удалённые", async () => {
    writeVersions([publishedVersion(), draftVersion({ snapshot: [] })]);

    const changes = changesOf(await diffDraftWithPublished());
    expect(changes.length).toBe(2);
    expect(changes.every((change) => change.newValue === null)).toBe(true);
  });

  it("оба snapshot пусты — ok, изменений нет", async () => {
    writeVersions([
      publishedVersion({ snapshot: [], promos: [] }),
      draftVersion({ snapshot: [], promos: [] }),
    ]);

    expect(changesOf(await diffDraftWithPublished())).toEqual([]);
  });

  it("битый файл версий: исключение пробрасывается, данные не меняются", async () => {
    writeFileSync(versionsPath(), "{не json", "utf8");
    const before = bytes(versionsPath());

    await expect(listVersions()).rejects.toThrow();
    await expect(diffDraftWithPublished()).rejects.toThrow();
    expect(bytes(versionsPath())).toBe(before);
  });

  it("дубликат priceItemId в снимке (нарушение §8.3) → отказ, не скрывается", async () => {
    writeVersions([
      publishedVersion(),
      draftVersion({
        snapshot: [
          { priceItemId: "kitchen.shelf", amount: 1100 },
          { priceItemId: "kitchen.shelf", amount: 1200 },
        ],
      }),
    ]);

    await expect(diffDraftWithPublished()).rejects.toThrow(/дубликат priceItemId/);
  });

  it("дубликат промокода (§8.3) → отказ", async () => {
    writeVersions([
      publishedVersion({ promos: [promo(), promo()] }),
      draftVersion(),
    ]);

    await expect(diffDraftWithPublished()).rejects.toThrow(/дубликат промокода/);
  });

  it("добавленный и удалённый промокод — записи field=promo", async () => {
    writeVersions([
      publishedVersion({ promos: [promo({ code: "OLD7" })] }),
      draftVersion({ promos: [promo({ code: "NEW7" })] }),
    ]);

    const changes = changesOf(await diffDraftWithPublished()).filter(
      (change) => change.targetType === "promo",
    );
    expect(changes).toEqual([
      {
        targetType: "promo",
        targetKey: "NEW7",
        field: "promo",
        oldValue: null,
        newValue: expect.objectContaining({ value: 10, active: true }),
      },
      {
        targetType: "promo",
        targetKey: "OLD7",
        field: "promo",
        oldValue: expect.objectContaining({ value: 10, active: true }),
        newValue: null,
      },
    ]);
  });
});
