import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listPricingChanges, readPricingVersion, rollbackSourceId } from "./read";
import {
  getPublishedVersion,
  getVersion,
  listVersions,
} from "./pricing";

let dir = "";

const versionsPath = (): string => path.join(dir, "pricing-versions.json");
const changesPath = (): string => path.join(dir, "pricing-changes.json");
const priceItemsPath = (): string => path.join(dir, "price-items.json");
const projectsPath = (): string => path.join(dir, "projects.json");
const auditPath = (): string => path.join(dir, "admin-audit-log.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-read-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data), "utf8");
}

function bytes(file: string): string {
  return readFileSync(file, "utf8");
}

function readJson<T>(file: string): T {
  return JSON.parse(bytes(file)) as T;
}

function priceVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "price-2026.10.9",
    label: "Прайс",
    status: "published",
    snapshot: [{ priceItemId: "kitchen.shelf", amount: 1100 }],
    rules: { rounding: 100, minOrder: 45000 },
    promos: [],
    baseSchema: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: "seed",
    publishedAt: "2026-10-02T00:00:00.000Z",
    publishedBy: "seed",
    publishedSeq: 2,
    ...overrides,
  };
}

type Version = ReturnType<typeof priceVersion>;

function stored(): Version[] {
  return readJson(versionsPath());
}

function pricingChange(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ch-1",
    versionId: "price-a",
    targetType: "priceItem",
    targetKey: "kitchen.shelf",
    field: "amount",
    oldValue: 900,
    newValue: 1100,
    createdBy: "admin-1",
    createdAt: "2026-11-08T00:00:00.000Z",
    ...overrides,
  };
}

/** Типовой посев: три версии разных статусов. */
function seedThree(): void {
  writeJson(versionsPath(), [
    priceVersion({ id: "price-draft", status: "draft", publishedSeq: undefined, publishedAt: undefined, publishedBy: undefined }),
    priceVersion({ id: "price-pub", publishedSeq: 2 }),
    priceVersion({ id: "price-old", status: "superseded", publishedSeq: 1 }),
  ]);
}

describe("чтение версий (контракт карточки CA-T-213)", () => {
  it("получение списка версий: все записи, без создания файлов", async () => {
    seedThree();

    const versions = await listVersions();
    expect(versions.map((version) => version.id)).toEqual([
      "price-draft",
      "price-pub",
      "price-old",
    ]);
    expect(existsSync(auditPath())).toBe(false);
  });

  it("получение версии по явному id (readPricingVersion/getVersion)", async () => {
    seedThree();

    const byId = await readPricingVersion("price-old");
    expect(byId?.id).toBe("price-old");
    expect(await getVersion("price-old")).toEqual(byId);
  });

  it("несуществующий id → undefined; отсутствующая версия не подменяется текущей published", async () => {
    seedThree();

    expect(await readPricingVersion("price-ghost")).toBeUndefined();
    expect(await getVersion("price-ghost")).toBeUndefined();
    // Текущая published при этом доступна по явному запросу — но не как подмена.
    expect((await readPricingVersion("price-pub"))?.status).toBe("published");
  });

  it("несколько версий: draft/published/superseded читаются и различаются по статусу", async () => {
    seedThree();

    const draft = await readPricingVersion("price-draft");
    const published = await readPricingVersion("price-pub");
    const superseded = await readPricingVersion("price-old");

    expect(draft?.status).toBe("draft");
    expect(published?.status).toBe("published");
    expect(superseded?.status).toBe("superseded");
    expect(new Set([draft?.id, published?.id, superseded?.id]).size).toBe(3);
  });

  it("сортировка контрактом не предусмотрена: порядок соответствует хранилищу (без пересортировки)", async () => {
    writeJson(versionsPath(), [
      priceVersion({ id: "price-b", status: "superseded" }),
      priceVersion({ id: "price-a" }),
    ]);

    // Никакой сортировки по id/дате не применяется — карточка её не
    // предусматривает; потребитель (DataResolver) запрашивает по явному id.
    const versions = await listVersions();
    expect(versions.map((version) => version.id)).toEqual(["price-b", "price-a"]);
    expect((await readPricingVersion("price-a"))?.id).toBe("price-a");
  });

  it("«последняя» версия = единственная published по статусу; отсутствие → undefined", async () => {
    seedThree();

    const current = await readPricingVersion();
    expect(current?.id).toBe("price-pub");
    expect(await getPublishedVersion()).toEqual(current);

    writeJson(versionsPath(), [
      priceVersion({ id: "price-old", status: "superseded" }),
    ]);
    expect(await readPricingVersion()).toBeUndefined();
  });

  it("несколько published → отказ от случайного выбора (диагностика неоднозначности)", async () => {
    writeJson(versionsPath(), [
      priceVersion({ id: "price-pub-1", publishedSeq: 1 }),
      priceVersion({ id: "price-pub-2", publishedSeq: 2 }),
    ]);

    await expect(readPricingVersion()).rejects.toThrow(/опубликованных версий/);
    await expect(getPublishedVersion()).rejects.toThrow(/опубликованных версий/);
  });

  it("исторический snapshot возвращается в сохранённом виде, без подмены текущими данными", async () => {
    const historical = [
      { priceItemId: "kitchen.shelf", amount: 900 },
      { priceItemId: "kitchen.hingePerDoor", amount: 390 },
    ];
    writeJson(versionsPath(), [
      priceVersion({ id: "price-old", status: "superseded", snapshot: historical }),
      priceVersion({ id: "price-pub", snapshot: [{ priceItemId: "kitchen.shelf", amount: 1100 }] }),
    ]);
    writeJson(priceItemsPath(), [
      { id: "kitchen.shelf", unit: "RUB_PER_PCS", status: "active", usage: "used" },
    ]);

    const old = await readPricingVersion("price-old");
    const current = await readPricingVersion("price-pub");

    // Снимок выбранной версии — ровно её сохранённые значения (900), не
    // текущие (1100) и не из коллекции PriceItem; порядок и состав не меняются.
    expect(old?.snapshot).toEqual(historical);
    expect(current?.snapshot).toEqual([{ priceItemId: "kitchen.shelf", amount: 1100 }]);
    expect(old?.snapshot).not.toEqual(current?.snapshot);
  });
});

describe("история PricingChange (§6.6)", () => {
  it("чтение истории версии: только записи с её versionId", async () => {
    writeJson(changesPath(), [
      pricingChange({ id: "ch-a1", versionId: "price-a", oldValue: 900, newValue: 1100 }),
      pricingChange({ id: "ch-b1", versionId: "price-b", oldValue: 100, newValue: 200 }),
      pricingChange({ id: "ch-a2", versionId: "price-a", field: "rounding", targetKey: "rounding", targetType: "rule", oldValue: 100, newValue: 50 }),
    ]);

    const forA = await listPricingChanges("price-a");
    expect(forA.map((change) => change.id)).toEqual(["ch-a1", "ch-a2"]);
    expect(forA.every((change) => change.versionId === "price-a")).toBe(true);

    const forB = await listPricingChanges("price-b");
    expect(forB.map((change) => change.id)).toEqual(["ch-b1"]);
  });

  it("отсутствующий журнал → []; чтение не создаёт файл (нет фиктивной истории)", async () => {
    expect(await listPricingChanges("price-a")).toEqual([]);
    expect(existsSync(changesPath())).toBe(false);
    expect(existsSync(auditPath())).toBe(false);
  });

  it("разные версии не смешиваются: выборки disjoint", async () => {
    writeJson(changesPath(), [
      pricingChange({ id: "ch-1", versionId: "price-1" }),
      pricingChange({ id: "ch-2", versionId: "price-2" }),
      pricingChange({ id: "ch-3", versionId: "price-1" }),
    ]);

    const first = (await listPricingChanges("price-1")).map((change) => change.id);
    const second = (await listPricingChanges("price-2")).map((change) => change.id);
    expect(first).toEqual(["ch-1", "ch-3"]);
    expect(second).toEqual(["ch-2"]);
    expect(first.filter((id) => second.includes(id))).toEqual([]);
  });

  it("не создаёт и не изменяет записи: байт-в-байт журнала до/после чтения", async () => {
    writeJson(changesPath(), [pricingChange()]);
    const before = bytes(changesPath());

    await listPricingChanges("price-a");
    await listPricingChanges("price-a");

    expect(bytes(changesPath())).toBe(before);
  });
});

describe("rollback-источник из notes (§8.5, CA-T-212)", () => {
  it("rollback-версия: исходный id читается из notes", async () => {
    writeJson(versionsPath(), [
      priceVersion({ id: "price-rollback-abc", status: "draft", notes: "rollback to price-old", publishedSeq: undefined, publishedAt: undefined, publishedBy: undefined }),
    ]);

    const version = await readPricingVersion("price-rollback-abc");
    expect(version).toBeDefined();
    expect(rollbackSourceId(version!)).toBe("price-old");
  });

  it("обычная версия или чужой формат notes → null (данные не исправляются)", async () => {
    writeJson(versionsPath(), [
      priceVersion({ id: "price-pub" }),
      priceVersion({ id: "price-x", status: "superseded", notes: "просто заметка" }),
    ]);

    const plain = await readPricingVersion("price-pub");
    const foreign = await readPricingVersion("price-x");
    expect(rollbackSourceId(plain!)).toBeNull();
    expect(rollbackSourceId(foreign!)).toBeNull();
  });
});

describe("read-only поведение", () => {
  it("неизменность данных после чтений: версии, snapshot, журнал, проекты", async () => {
    seedThree();
    writeJson(changesPath(), [pricingChange({ versionId: "price-pub" })]);
    writeJson(projectsPath(), [
      { id: "p1", config: { version: 1, calcVersion: "calc-2026.11.0" }, price: 221600 },
    ]);
    const versionsBefore = bytes(versionsPath());
    const changesBefore = bytes(changesPath());
    const projectsBefore = bytes(projectsPath());

    await listVersions();
    await readPricingVersion();
    await readPricingVersion("price-old");
    await readPricingVersion("price-ghost");
    await listPricingChanges("price-pub");

    expect(bytes(versionsPath())).toBe(versionsBefore);
    expect(bytes(changesPath())).toBe(changesBefore);
    expect(bytes(projectsPath())).toBe(projectsBefore);
  });

  it("audit-события не создаются чтением", async () => {
    seedThree();

    await listVersions();
    await readPricingVersion("price-pub");
    await listPricingChanges("price-pub");

    expect(existsSync(auditPath())).toBe(false);
  });

  it("статусы и publishedSeq версий при чтении не меняются", async () => {
    seedThree();
    const before = stored().map(
      (version) => [version.id, version.status, version.publishedSeq] as const,
    );

    await readPricingVersion("price-pub");
    await readPricingVersion("price-draft");
    await readPricingVersion();

    const after = stored().map(
      (version) => [version.id, version.status, version.publishedSeq] as const,
    );
    expect(after).toEqual(before);
  });

  it("проекты и calcVersion не изменяются; пересчёт не запускается", async () => {
    seedThree();
    writeJson(projectsPath(), [
      { id: "p1", config: { version: 1, calcVersion: "calc-2026.11.0" } },
    ]);
    const projectsBefore = bytes(projectsPath());

    await readPricingVersion("price-pub");
    await listPricingChanges("price-pub");

    expect(bytes(projectsPath())).toBe(projectsBefore);
    // Ни одного audit-события — значит ни публикации, ни пересчёта.
    expect(existsSync(auditPath())).toBe(false);
  });

  it("повторное чтение возвращает идентичный результат", async () => {
    seedThree();
    writeJson(changesPath(), [pricingChange({ versionId: "price-pub" })]);

    const first = JSON.stringify(await listVersions());
    const second = JSON.stringify(await listVersions());
    expect(second).toBe(first);

    const versionFirst = JSON.stringify(await readPricingVersion("price-old"));
    const versionSecond = JSON.stringify(await readPricingVersion("price-old"));
    expect(versionSecond).toBe(versionFirst);

    const changesFirst = JSON.stringify(await listPricingChanges("price-pub"));
    const changesSecond = JSON.stringify(await listPricingChanges("price-pub"));
    expect(changesSecond).toBe(changesFirst);
  });
});
