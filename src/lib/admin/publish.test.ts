import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ActorContext } from "./parameters";
import { publishPricingVersion } from "./publish";
import { pricingVersionSchema } from "./schema";
import { validateDraftVersion } from "./pricing";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

const versionsPath = (): string => path.join(dir, "pricing-versions.json");
const changesPath = (): string => path.join(dir, "pricing-changes.json");
const priceItemsPath = (): string => path.join(dir, "price-items.json");
const projectsPath = (): string => path.join(dir, "projects.json");
const auditPath = (): string => path.join(dir, "admin-audit-log.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-publish-"));
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

function priceItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "kitchen.shelf",
    scope: "kitchen",
    label: "Полка (кухня)",
    unit: "RUB_PER_PCS",
    usage: "used",
    status: "active",
    editable: true,
    sourceRef: "src/content/pricing.ts:PRICING.kitchen.shelf",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "seed",
    ...overrides,
  };
}

function priceVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "price-2026.10.9",
    label: "Прайс",
    status: "published",
    snapshot: [{ priceItemId: "kitchen.shelf", amount: 1100 }],
    rules: {
      rounding: 100,
      minOrder: 45000,
      complexityPerExtraModule: 0.02,
      complexityMax: 1.12,
    },
    promos: [],
    baseSchema: 1,
    disclaimer: "Демо-цены.",
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: "seed",
    publishedAt: "2026-10-02T00:00:00.000Z",
    publishedBy: "seed",
    ...overrides,
  };
}

function draftVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return priceVersion({
    id: "price-demo-2026-01",
    status: "draft",
    createdAt: "2026-11-08T00:00:00.000Z",
    createdBy: "admin-1",
    publishedAt: undefined,
    publishedBy: undefined,
    ...overrides,
  });
}

/** Посев: ставка + draft (по умолчанию без предыдущей published). */
function seedDraft(draft: Record<string, unknown> = draftVersion()): void {
  writeJson(priceItemsPath(), [priceItem()]);
  writeJson(versionsPath(), [draft]);
}

function storedVersions(): Array<{ id: string; status: string; publishedSeq?: number; snapshot: Array<{ priceItemId: string; amount: number }> }> {
  return readJson(versionsPath());
}

function auditEvents(): Array<{ action: string; entityType: string; entityId: string; newValue?: Record<string, unknown> }> {
  return existsSync(auditPath()) ? readJson(auditPath()) : [];
}

describe("публикация draft (§8.4)", () => {
  it("успешная публикация валидного draft: статус, publishedSeq=1, publishedAt/By, аудит pricing.publish", async () => {
    seedDraft();

    const result = await publishPricingVersion("price-demo-2026-01", ACTOR);

    expect(result.version.status).toBe("published");
    expect(result.version.publishedSeq).toBe(1);
    expect(result.version.publishedBy).toBe("admin-1");
    expect(result.publishedSeq).toBe(1);
    expect(result.supersededVersionId).toBeNull();
    expect(result.changesCount).toBe(0); // предыдущей published нет — без фиктивных изменений

    const stored = storedVersions().find((version) => version.id === "price-demo-2026-01")!;
    expect(stored.status).toBe("published");
    expect(stored.publishedSeq).toBe(1);

    const events = auditEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.action).toBe("pricing.publish");
    expect(events[0]?.entityType).toBe("pricingVersion");
    expect(events[0]?.entityId).toBe("price-demo-2026-01");
    expect(events[0]?.newValue).toMatchObject({ status: "published", publishedSeq: 1 });
  });

  it("публикация строго по конкретному id", async () => {
    seedDraft();

    const result = await publishPricingVersion("price-demo-2026-01", ACTOR);
    expect(result.version.id).toBe("price-demo-2026-01");
    expect(
      storedVersions().filter((version) => version.status === "published").length,
    ).toBe(1);
  });

  it("отсутствующий draft (id не найден) → отказ", async () => {
    seedDraft();

    await expect(publishPricingVersion("price-ghost", ACTOR)).rejects.toThrow(/не найдена/);
    expect(storedVersions()[0]?.status).toBe("draft");
    expect(auditEvents()).toEqual([]);
  });

  it("несколько draft: публикуется ровно указанный id, второй остаётся draft", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      draftVersion(),
      draftVersion({ id: "price-second", label: "Второй" }),
    ]);

    const result = await publishPricingVersion("price-second", ACTOR);
    expect(result.version.id).toBe("price-second");

    const versions = storedVersions();
    expect(versions.find((version) => version.id === "price-demo-2026-01")?.status).toBe("draft");
    expect(versions.find((version) => version.id === "price-second")?.status).toBe("published");
  });

  it("не-draft (superseded) → отказ «не является draft», без изменений", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      priceVersion({ id: "price-old", status: "superseded" }),
    ]);
    const before = bytes(versionsPath());

    await expect(publishPricingVersion("price-old", ACTOR)).rejects.toThrow(
      /не является draft/,
    );
    expect(bytes(versionsPath())).toBe(before);
    expect(auditEvents()).toEqual([]);
  });

  it("passed=false → отказ (§8.3), версия не публикуется, аудита нет", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      draftVersion({ snapshot: [{ priceItemId: "kitchen.shelf", amount: -1 }] }),
    ]);
    const before = bytes(versionsPath());

    await expect(publishPricingVersion("price-demo-2026-01", ACTOR)).rejects.toThrow(
      /passed=false/,
    );
    expect(bytes(versionsPath())).toBe(before);
    expect(auditEvents()).toEqual([]);
  });

  it("draft изменился после внешней валидации: публикация отвергает по актуальным данным", async () => {
    seedDraft();
    const external = await validateDraftVersion();
    expect(external.passed).toBe(true);

    // Изменение после внешней валидации: невалидный amount.
    writeJson(versionsPath(), [
      draftVersion({ snapshot: [{ priceItemId: "kitchen.shelf", amount: -5 }] }),
    ]);

    await expect(publishPricingVersion("price-demo-2026-01", ACTOR)).rejects.toThrow(
      /passed=false/,
    );
    expect(storedVersions()[0]?.status).toBe("draft");
    expect(auditEvents()).toEqual([]);
  });

  it("повторная публикация уже опубликованной версии → отказ «повтор → 409», без изменений", async () => {
    seedDraft();
    await publishPricingVersion("price-demo-2026-01", ACTOR);
    const before = bytes(versionsPath());

    await expect(publishPricingVersion("price-demo-2026-01", ACTOR)).rejects.toThrow(
      /повтор → 409/,
    );
    expect(bytes(versionsPath())).toBe(before);
    expect(auditEvents().length).toBe(1); // без нового события
  });
});

describe("publishedSeq и supersede (R-07/§8.4)", () => {
  it("монотонность publishedSeq: 1, 2; без переиспользования после supersede", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      draftVersion({ id: "price-first", label: "Первая" }),
      draftVersion({ id: "price-second", label: "Вторая" }),
    ]);

    const first = await publishPricingVersion("price-first", ACTOR);
    expect(first.publishedSeq).toBe(1);

    const second = await publishPricingVersion("price-second", ACTOR);
    expect(second.publishedSeq).toBe(2);
    expect(second.supersededVersionId).toBe("price-first");

    expect(storedVersions().map((version) => version.publishedSeq)).toEqual([1, 2]);
  });

  it("корректный supersede предыдущей published; её snapshot неизменен", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    const previousSnapshot = [{ priceItemId: "kitchen.shelf", amount: 999 }];
    writeJson(versionsPath(), [
      priceVersion({ snapshot: previousSnapshot }),
      draftVersion(),
    ]);
    const oldSnapshotBefore = JSON.stringify(storedVersions()[0]?.snapshot);

    const result = await publishPricingVersion("price-demo-2026-01", ACTOR);

    expect(result.supersededVersionId).toBe("price-2026.10.9");
    const old = storedVersions().find((version) => version.id === "price-2026.10.9")!;
    expect(old.status).toBe("superseded");
    expect(JSON.stringify(old.snapshot)).toBe(oldSnapshotBefore);
    expect(old.snapshot).toEqual(previousSnapshot);
  });

  it("отсутствие предыдущей published: seq=1, superseded нет, PricingChange не создаётся", async () => {
    seedDraft();

    const result = await publishPricingVersion("price-demo-2026-01", ACTOR);

    expect(result.publishedSeq).toBe(1);
    expect(result.supersededVersionId).toBeNull();
    expect(result.changesCount).toBe(0);
    expect(existsSync(changesPath())).toBe(false);
  });
});

describe("PricingChange (§6.6)", () => {
  /**
   * Два состояния: предыдущая published + отличающийся draft. Состав
   * `items` — ровно активные used-ставки draft-снимка (§8.3/S-01:
   * полнота проверяется только по публикуемому draft; предыдущая
   * published не валидируется).
   */
  function seedPair(
    previousSnapshot: Array<{ priceItemId: string; amount: number }>,
    draftSnapshot: Array<{ priceItemId: string; amount: number }>,
    items: Record<string, unknown>[] = [priceItem()],
  ): void {
    writeJson(priceItemsPath(), items);
    writeJson(versionsPath(), [
      priceVersion({ snapshot: previousSnapshot }),
      draftVersion({ snapshot: draftSnapshot }),
    ]);
  }

  it("PricingChange для добавления: oldValue=null, versionId публикуемой версии", async () => {
    seedPair(
      [{ priceItemId: "kitchen.shelf", amount: 1100 }],
      [
        { priceItemId: "kitchen.shelf", amount: 1100 },
        { priceItemId: "lighting.psu.400", amount: 5600 },
      ],
      [
        priceItem(),
        priceItem({
          id: "lighting.psu.400",
          unit: "RUB",
          sourceRef: "src/content/lighting.ts:LED_PSU_PRICE.400",
        }),
      ],
    );

    const result = await publishPricingVersion("price-demo-2026-01", ACTOR);
    expect(result.changesCount).toBe(1);

    const changes = readJson<Array<Record<string, unknown>>>(changesPath());
    expect(changes.length).toBe(1);
    expect(changes[0]).toMatchObject({
      versionId: "price-demo-2026-01",
      targetType: "priceItem",
      targetKey: "lighting.psu.400",
      field: "amount",
      oldValue: null,
      newValue: 5600,
      createdBy: "admin-1",
    });
    expect(typeof changes[0]?.id).toBe("string");
  });

  it("PricingChange для удаления: newValue=null (§6.6)", async () => {
    seedPair(
      [
        { priceItemId: "kitchen.shelf", amount: 1100 },
        { priceItemId: "lighting.psu.400", amount: 5600 },
      ],
      [{ priceItemId: "kitchen.shelf", amount: 1100 }],
    );

    const result = await publishPricingVersion("price-demo-2026-01", ACTOR);
    expect(result.changesCount).toBe(1);

    const changes = readJson<Array<Record<string, unknown>>>(changesPath());
    expect(changes[0]).toMatchObject({
      targetKey: "lighting.psu.400",
      field: "amount",
      oldValue: 5600,
      newValue: null,
    });
  });

  it("PricingChange для изменения: старое/новое значение по полю amount", async () => {
    seedPair(
      [{ priceItemId: "kitchen.shelf", amount: 1100 }],
      [{ priceItemId: "kitchen.shelf", amount: 1250 }],
    );

    const result = await publishPricingVersion("price-demo-2026-01", ACTOR);
    expect(result.changesCount).toBe(1);

    const changes = readJson<Array<Record<string, unknown>>>(changesPath());
    expect(changes[0]).toMatchObject({
      targetType: "priceItem",
      targetKey: "kitchen.shelf",
      field: "amount",
      oldValue: 1100,
      newValue: 1250,
      versionId: "price-demo-2026-01",
    });
  });

  it("идентичные версии → без фиктивных PricingChange (файл не создаётся)", async () => {
    seedPair(
      [{ priceItemId: "kitchen.shelf", amount: 1100 }],
      [{ priceItemId: "kitchen.shelf", amount: 1100 }],
    );

    const result = await publishPricingVersion("price-demo-2026-01", ACTOR);

    expect(result.changesCount).toBe(0);
    expect(existsSync(changesPath())).toBe(false);
  });

  it("сопоставление по ID, не по сумме: равные amount при разных ID → удаление + добавление", async () => {
    seedPair(
      [{ priceItemId: "preset.a.basePrice", amount: 5000 }],
      [{ priceItemId: "kitchen.bottleRack", amount: 5000 }],
      [
        priceItem({
          id: "kitchen.bottleRack",
          unit: "RUB",
          sourceRef: "src/content/pricing.ts:PRICING.kitchen.bottleRack",
        }),
      ],
    );

    const result = await publishPricingVersion("price-demo-2026-01", ACTOR);
    expect(result.changesCount).toBe(2);

    const changes = readJson<Array<{ targetKey: string; oldValue: unknown; newValue: unknown }>>(
      changesPath(),
    );
    expect(changes.map((change) => change.targetKey).sort()).toEqual([
      "kitchen.bottleRack",
      "preset.a.basePrice",
    ]);
    expect(changes.find((change) => change.targetKey === "kitchen.bottleRack")?.oldValue).toBeNull();
    expect(changes.find((change) => change.targetKey === "preset.a.basePrice")?.newValue).toBeNull();
  });
});

describe("ошибки и атомарность", () => {
  it("ошибка записи истории: битый pricing-changes.json → версия НЕ публикуется", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      priceVersion({ snapshot: [{ priceItemId: "kitchen.shelf", amount: 999 }] }),
      draftVersion({ snapshot: [{ priceItemId: "kitchen.shelf", amount: 1100 }] }),
    ]);
    const versionsBefore = bytes(versionsPath());
    writeFileSync(changesPath(), "{битый json", "utf8");

    await expect(publishPricingVersion("price-demo-2026-01", ACTOR)).rejects.toThrow(
      /повреждено/,
    );
    // Опубликованной версии без истории не осталось: запись versions не выполнялась.
    expect(bytes(versionsPath())).toBe(versionsBefore);
    expect(storedVersions().find((version) => version.id === "price-demo-2026-01")?.status).toBe("draft");
    expect(auditEvents()).toEqual([]);
  });

  it("ошибка audit: данные опубликованы, журнал отстаёт (R-09/§13.2), повтор безопасен", async () => {
    seedDraft();
    writeFileSync(auditPath(), "{битый json", "utf8");

    await expect(publishPricingVersion("price-demo-2026-01", ACTOR)).rejects.toThrow();

    // Документированное поведение: публикация записана ДО журнала.
    expect(storedVersions()[0]?.status).toBe("published");
    expect(bytes(auditPath())).toBe("{битый json"); // журнал не перезаписан

    // Повтор предсказуем и безопасен.
    await expect(publishPricingVersion("price-demo-2026-01", ACTOR)).rejects.toThrow(
      /повтор → 409/,
    );
  });

  it("ошибка хранилища: битый pricing-versions.json → отказ до всех записей", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeFileSync(versionsPath(), "{битый json", "utf8");

    await expect(publishPricingVersion("price-demo-2026-01", ACTOR)).rejects.toThrow();
    expect(existsSync(changesPath())).toBe(false);
    expect(auditEvents()).toEqual([]);
  });

  it("конкурентные попытки публикации: ровно одна успешна, история однократна", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      priceVersion({ snapshot: [{ priceItemId: "kitchen.shelf", amount: 999 }] }),
      draftVersion({ snapshot: [{ priceItemId: "kitchen.shelf", amount: 1100 }] }),
    ]);

    const results = await Promise.allSettled([
      publishPricingVersion("price-demo-2026-01", ACTOR),
      publishPricingVersion("price-demo-2026-01", ACTOR),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/409|не является draft/);

    // История записана ровно один раз (не продублирована второй попыткой).
    const changes = readJson<Array<{ targetKey: string }>>(changesPath());
    expect(changes.length).toBe(1);
    expect(changes[0]?.targetKey).toBe("kitchen.shelf");
    expect(storedVersions().filter((version) => version.status === "published").length).toBe(1);
    expect(auditEvents().length).toBe(1);
  });
});

describe("неизменность данных вне прайса", () => {
  it("проекты и их конфигурации не изменяются", async () => {
    seedDraft();
    const project = {
      id: "p1",
      config: { version: 1, calcVersion: "calc-2026.11.0", schemaVersion: 1 },
      price: 221600,
    };
    writeJson(projectsPath(), [project]);
    const before = bytes(projectsPath());

    await publishPricingVersion("price-demo-2026-01", ACTOR);

    expect(bytes(projectsPath())).toBe(before);
  });

  it("пересчёт проектов не запускается: в аудите только pricing.publish", async () => {
    seedDraft();

    await publishPricingVersion("price-demo-2026-01", ACTOR);

    const actions = auditEvents().map((event) => event.action);
    expect(actions).toEqual(["pricing.publish"]);
    expect(actions.some((action) => action.includes("recalc"))).toBe(false);
  });

  it("исторические calcVersion сохраняются", async () => {
    seedDraft();
    writeJson(projectsPath(), [
      { id: "p1", config: { version: 1, calcVersion: "calc-2026.11.0" } },
    ]);

    await publishPricingVersion("price-demo-2026-01", ACTOR);

    const projects = readJson<Array<{ config: { calcVersion: string } }>>(projectsPath());
    expect(projects[0]?.config.calcVersion).toBe("calc-2026.11.0");
  });

  it("опубликованный snapshot неизменен: равен draft-снимку, повторные чтения идентичны", async () => {
    seedDraft();
    const draftSnapshot = storedVersions()[0]?.snapshot;

    await publishPricingVersion("price-demo-2026-01", ACTOR);

    const first = storedVersions()[0]?.snapshot;
    const second = storedVersions()[0]?.snapshot;
    expect(first).toEqual(draftSnapshot);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    // Повторная проверка опубликованной версии (read-only) ничего не меняет.
    const before = bytes(versionsPath());
    const revalidation = await validateDraftVersion("price-demo-2026-01");
    expect(revalidation.passed).toBe(false);
    expect(revalidation.issues.map((item) => item.code)).toContain("not_draft");
    expect(bytes(versionsPath())).toBe(before);
  });
});

describe("P2-FIX-001: несколько published-версий (§8.4.2, AUDIT-P2-002)", () => {
  it("2 published + 1 draft → отказ: без выбора версии, без записей PricingChange и журнала", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      priceVersion({
        id: "price-pub-1",
        publishedSeq: 1,
        snapshot: [{ priceItemId: "kitchen.shelf", amount: 900 }],
      }),
      priceVersion({
        id: "price-pub-2",
        publishedSeq: 2,
        snapshot: [{ priceItemId: "kitchen.shelf", amount: 1000 }],
      }),
      draftVersion({ snapshot: [{ priceItemId: "kitchen.shelf", amount: 1100 }] }),
    ]);
    writeJson(projectsPath(), [
      { id: "p1", config: { version: 1, calcVersion: "calc-2026.11.0" }, price: 221600 },
    ]);
    const versionsBefore = bytes(versionsPath());
    const projectsBefore = bytes(projectsPath());

    await expect(publishPricingVersion("price-demo-2026-01", ACTOR)).rejects.toThrow(
      /2 опубликованных версий/,
    );

    // Обе опубликованные остались published, draft — draft; seq не изменились.
    const versions = storedVersions();
    expect(
      versions.filter((version) => version.status === "published").map((version) => version.id),
    ).toEqual(["price-pub-1", "price-pub-2"]);
    expect(versions.find((version) => version.id === "price-demo-2026-01")?.status).toBe("draft");
    expect(versions.map((version) => [version.id, version.publishedSeq])).toEqual([
      ["price-pub-1", 1],
      ["price-pub-2", 2],
      ["price-demo-2026-01", undefined],
    ]);

    // Отказ без частичных записей: файл версий идентичен, PricingChange не
    // созданы, audit без pricing.publish, проекты не изменены.
    expect(bytes(versionsPath())).toBe(versionsBefore);
    expect(existsSync(changesPath())).toBe(false);
    expect(auditEvents()).toEqual([]);
    expect(bytes(projectsPath())).toBe(projectsBefore);
  });
});


// ─── P2-QA-003 (AUDIT-P2-005): schema-тест publishedSeq ───
// Фактический контракт (schema.ts:155): `z.number().int().positive()
// .optional()` — решение R-07 (CA-Q-003) + C8; тесты фиксируют контракт,
// схема не изменяется.

describe("P2-QA-003: schema-тест publishedSeq (R-07/C8)", () => {
  function parse(publishedSeq: unknown) {
    const candidate = { ...priceVersion(), publishedSeq } as Record<string, unknown>;
    if (publishedSeq === undefined) delete candidate.publishedSeq;
    return pricingVersionSchema.safeParse(candidate);
  }

  it.each([
    ["положительное целое 1", 1],
    ["положительное целое 12", 12],
  ])("%s → PASS", (_name, value) => {
    expect(parse(value).success).toBe(true);
  });

  it.each([
    ["дробное 1.5", 1.5], // int() → отказ
    ["ноль", 0], // positive() → отказ
    ["отрицательное -1", -1], // positive() → отказ
    ["строка \"1\"", "1"], // z.number() → отказ
    ["null", null], // optional принимает только undefined → отказ
  ])("%s → REJECT", (_name, value) => {
    const result = parse(value);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Отказ приходит из проверки publishedSeq, а не из другого поля.
      expect(result.error.issues.some((issue) => issue.path.includes("publishedSeq"))).toBe(true);
    }
  });

  it("отсутствующее поле → PASS (optional: исторические версии без поля остаются валидными)", () => {
    expect(parse(undefined).success).toBe(true);
  });

  it("регрессия: publish генерирует только положительные целые (монотонность R-07)", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      draftVersion({ id: "price-a", publishedSeq: undefined }),
      draftVersion({ id: "price-b", publishedSeq: undefined }),
    ]);
    const first = await publishPricingVersion("price-a", ACTOR);
    const second = await publishPricingVersion("price-b", ACTOR);

    for (const seq of [first.publishedSeq, second.publishedSeq]) {
      expect(Number.isInteger(seq)).toBe(true);
      expect(seq).toBeGreaterThan(0);
      expect(parse(seq).success).toBe(true);
    }
    expect(second.publishedSeq).toBe(first.publishedSeq + 1);
  });
});
