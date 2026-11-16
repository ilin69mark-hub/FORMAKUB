import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ActorContext } from "./parameters";
import { publishPricingVersion, rollbackPricingVersion } from "./publish";
import { validateDraftVersion } from "./pricing";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

const versionsPath = (): string => path.join(dir, "pricing-versions.json");
const changesPath = (): string => path.join(dir, "pricing-changes.json");
const priceItemsPath = (): string => path.join(dir, "price-items.json");
const projectsPath = (): string => path.join(dir, "projects.json");
const auditPath = (): string => path.join(dir, "admin-audit-log.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-rollback-"));
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
    publishedSeq: 1,
    ...overrides,
  };
}

type Version = ReturnType<typeof priceVersion>;

function stored(): Version[] {
  return readJson(versionsPath());
}

function findVersion(id: string): Version {
  const version = stored().find((item) => item.id === id);
  if (!version) throw new Error(`Версия ${id} не найдена в файле`);
  return version;
}

function recordOf(id: string): string {
  return JSON.stringify(stored().find((item) => item.id === id));
}

function auditEvents(): Array<{ action: string; entityType: string; entityId: string; newValue?: Record<string, unknown> }> {
  return existsSync(auditPath()) ? readJson(auditPath()) : [];
}

/** Типовой посев: ставка + одна published-версия (источник/текущая). */
function seed(versions: unknown[]): void {
  writeJson(priceItemsPath(), [priceItem()]);
  writeJson(versionsPath(), versions);
}

describe("rollback: контракт и допустимые источники (§8.5)", () => {
  it("успешный rollback опубликованной версии: новая draft, результат со ссылкой на источник", async () => {
    seed([priceVersion({ id: "price-source", publishedSeq: 3 })]);

    const result = await rollbackPricingVersion("price-source", ACTOR);

    expect(result.sourceVersionId).toBe("price-source");
    expect(result.version.id).not.toBe("price-source");
    expect(result.version.id).toMatch(/^price-rollback-[0-9a-f]{12}$/);
    expect(result.version.status).toBe("draft");
    expect(findVersion("price-source").status).toBe("published");
  });

  it("rollback superseded-версии разрешён (историческая, §8.5)", async () => {
    seed([
      priceVersion({ id: "price-current", publishedSeq: 2 }),
      priceVersion({
        id: "price-old",
        status: "superseded",
        publishedSeq: 1,
        snapshot: [{ priceItemId: "kitchen.shelf", amount: 900 }],
      }),
    ]);

    const result = await rollbackPricingVersion("price-old", ACTOR);

    expect(result.sourceVersionId).toBe("price-old");
    expect(result.version.status).toBe("draft");
    expect(result.version.snapshot).toEqual([{ priceItemId: "kitchen.shelf", amount: 900 }]);
    expect(findVersion("price-old").status).toBe("superseded");
  });

  it("источник в статусе draft → отказ (не историческая версия)", async () => {
    seed([priceVersion({ id: "price-draft-one", status: "draft", publishedSeq: undefined })]);

    await expect(rollbackPricingVersion("price-draft-one", ACTOR)).rejects.toThrow(
      /статус "draft"/,
    );
    expect(stored().length).toBe(1);
    expect(auditEvents()).toEqual([]);
  });

  it("несуществующий id → отказ; текущая published не подменяется, новых версий нет", async () => {
    seed([priceVersion({ id: "price-current", publishedSeq: 1 })]);
    const before = bytes(versionsPath());

    await expect(rollbackPricingVersion("price-ghost", ACTOR)).rejects.toThrow(
      /не найдена/,
    );
    expect(bytes(versionsPath())).toBe(before);
    expect(stored().length).toBe(1);
    expect(auditEvents()).toEqual([]);
  });

  it("явный выбор исходной версии по id: копия берёт snapshot выбранной", async () => {
    seed([
      priceVersion({ id: "price-a", publishedSeq: 2, snapshot: [{ priceItemId: "kitchen.shelf", amount: 1100 }] }),
      priceVersion({ id: "price-b", status: "superseded", publishedSeq: 1, snapshot: [{ priceItemId: "kitchen.shelf", amount: 777 }] }),
    ]);

    const result = await rollbackPricingVersion("price-b", ACTOR);

    expect(result.version.snapshot).toEqual([{ priceItemId: "kitchen.shelf", amount: 777 }]);
    expect(result.version.snapshot).not.toEqual(findVersion("price-a").snapshot);
  });

  it("новая версия: собственный id, notes-источник по §8.5, без публикационных атрибутов", async () => {
    seed([priceVersion({ id: "price-source", publishedSeq: 4 })]);

    const result = await rollbackPricingVersion("price-source", ACTOR);

    const storedDraft = findVersion(result.version.id);
    expect(storedDraft.id).not.toBe("price-source");
    expect(storedDraft.notes).toBe("rollback to price-source");
    expect(storedDraft.status).toBe("draft");
    expect(storedDraft.publishedSeq).toBeUndefined();
    expect(storedDraft.publishedAt).toBeUndefined();
    expect(storedDraft.publishedBy).toBeUndefined();
    expect(storedDraft.createdBy).toBe("admin-1");
  });

  it("snapshot новой версии байт-в-байт соответствует исходному (копия 1:1)", async () => {
    const sourceSnapshot = [
      { priceItemId: "kitchen.shelf", amount: 1100 },
      { priceItemId: "kitchen.hingePerDoor", amount: 390 },
    ];
    seed([priceVersion({ id: "price-source", snapshot: sourceSnapshot })]);

    const result = await rollbackPricingVersion("price-source", ACTOR);

    expect(result.version.snapshot).toEqual(sourceSnapshot);
    expect(JSON.stringify(result.version.snapshot)).toBe(
      JSON.stringify(findVersion("price-source").snapshot),
    );
  });
});

describe("неизменность исторических данных (§8.5 append-only)", () => {
  it("исходная версия байт-в-байт не изменяется (id/status/snapshot/seq/всё)", async () => {
    seed([priceVersion({ id: "price-source", publishedSeq: 5 })]);
    const sourceBefore = recordOf("price-source");

    await rollbackPricingVersion("price-source", ACTOR);

    expect(recordOf("price-source")).toBe(sourceBefore);
  });

  it("текущая published-версия не изменяется", async () => {
    seed([
      priceVersion({ id: "price-current", publishedSeq: 2 }),
      priceVersion({ id: "price-old", status: "superseded", publishedSeq: 1 }),
    ]);
    const currentBefore = recordOf("price-current");

    await rollbackPricingVersion("price-old", ACTOR);

    expect(recordOf("price-current")).toBe(currentBefore);
    expect(findVersion("price-current").status).toBe("published");
  });

  it("publishedSeq не меняется: остальные версии сохраняют seq, новая draft без seq", async () => {
    seed([
      priceVersion({ id: "price-current", publishedSeq: 2 }),
      priceVersion({ id: "price-old", status: "superseded", publishedSeq: 1 }),
    ]);
    const seqBefore = stored().map((version) => [version.id, version.publishedSeq] as const);

    const result = await rollbackPricingVersion("price-old", ACTOR);

    const seqAfter = stored()
      .filter((version) => version.id !== result.version.id)
      .map((version) => [version.id, version.publishedSeq] as const);
    expect(seqAfter).toEqual(seqBefore);
    expect(result.version.publishedSeq).toBeUndefined();
  });

  it("существующий draft → отказ (§8.2), его запись не перезаписывается", async () => {
    seed([
      priceVersion({ id: "price-current", publishedSeq: 2 }),
      priceVersion({ id: "price-old", status: "superseded", publishedSeq: 1 }),
      priceVersion({ id: "price-existing-draft", status: "draft", publishedSeq: undefined }),
    ]);
    const draftBefore = recordOf("price-existing-draft");
    const countBefore = stored().length;

    await expect(rollbackPricingVersion("price-old", ACTOR)).rejects.toThrow(
      /уже существует draft/,
    );
    expect(recordOf("price-existing-draft")).toBe(draftBefore);
    expect(stored().length).toBe(countBefore);
    expect(auditEvents()).toEqual([]);
  });
});

describe("конкурентность и повтор", () => {
  it("конкурентные попытки rollback: ровно одна успешна, одна новая запись", async () => {
    seed([
      priceVersion({ id: "price-current", publishedSeq: 2 }),
      priceVersion({ id: "price-old", status: "superseded", publishedSeq: 1 }),
    ]);

    const results = await Promise.allSettled([
      rollbackPricingVersion("price-old", ACTOR),
      rollbackPricingVersion("price-old", ACTOR),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /уже существует draft/,
    );
    expect(stored().filter((version) => version.status === "draft").length).toBe(1);
    expect(auditEvents().length).toBe(1);
  });

  it("повторный rollback той же версии → отказ, пока draft не опубликован (контракт §8.2)", async () => {
    seed([priceVersion({ id: "price-source", publishedSeq: 1 })]);

    const first = await rollbackPricingVersion("price-source", ACTOR);
    await expect(rollbackPricingVersion("price-source", ACTOR)).rejects.toThrow(
      /уже существует draft/,
    );

    expect(stored().filter((version) => version.status === "draft").length).toBe(1);
    expect(stored().find((version) => version.status === "draft")?.id).toBe(first.version.id);
    expect(auditEvents().length).toBe(1);
  });
});

describe("аудит и ошибки (порядок «данные → журнал»)", () => {
  it("корректная audit-запись: pricing.rollback, entityId новой версии, rollbackTo источника", async () => {
    seed([priceVersion({ id: "price-source", publishedSeq: 1 })]);

    const result = await rollbackPricingVersion("price-source", ACTOR);

    const events = auditEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.action).toBe("pricing.rollback");
    expect(events[0]?.entityType).toBe("pricingVersion");
    expect(events[0]?.entityId).toBe(result.version.id);
    expect(events[0]?.newValue).toMatchObject({
      id: result.version.id,
      status: "draft",
      rollbackTo: "price-source",
    });
  });

  it("ошибка audit: копия создана, ошибка проброшена (документированный порядок), журнал не перезаписан", async () => {
    seed([priceVersion({ id: "price-source", publishedSeq: 1 })]);
    writeFileSync(auditPath(), "{битый json", "utf8");

    await expect(rollbackPricingVersion("price-source", ACTOR)).rejects.toThrow();

    const drafts = stored().filter((version) => version.status === "draft");
    expect(drafts.length).toBe(1);
    expect(drafts[0]?.notes).toBe("rollback to price-source");
    expect(bytes(auditPath())).toBe("{битый json");

    // Повтор предсказуем: конфликтующий draft → отказ, копий не больше.
    await expect(rollbackPricingVersion("price-source", ACTOR)).rejects.toThrow(
      /уже существует draft/,
    );
    expect(stored().filter((version) => version.status === "draft").length).toBe(1);
  });

  it("ошибка Storage Adapter: битый файл версий → отказ до каких-либо записей", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeFileSync(versionsPath(), "{битый json", "utf8");

    await expect(rollbackPricingVersion("price-source", ACTOR)).rejects.toThrow();
    expect(existsSync(changesPath())).toBe(false);
    expect(auditEvents()).toEqual([]);
  });
});

describe("взаимодействие с Validate и Publish", () => {
  it("некорректный исторический snapshot копируется без исправлений; Validate новой draft → passed=false", async () => {
    seed([
      priceVersion({
        id: "price-source",
        snapshot: [
          { priceItemId: "kitchen.shelf", amount: 1100 },
          { priceItemId: "ghost.item", amount: 10 },
        ],
      }),
    ]);

    const result = await rollbackPricingVersion("price-source", ACTOR);
    // Копия как есть: ghost сохранён, автоматических «исправлений» нет.
    expect(result.version.snapshot).toEqual(findVersion("price-source").snapshot);

    const validation = await validateDraftVersion(result.version.id);
    expect(validation.passed).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("price_item_unknown");
  });

  it("новая draft доступна существующему Validate (passed=true для валидной копии)", async () => {
    seed([priceVersion({ id: "price-source", publishedSeq: 1 })]);

    const result = await rollbackPricingVersion("price-source", ACTOR);
    const validation = await validateDraftVersion(result.version.id);

    expect(validation.targetId).toBe(result.version.id);
    expect(validation.passed).toBe(true);
    expect(validation.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("автоматическая публикация отсутствует: status=draft, нет pricing.publish в аудите", async () => {
    seed([
      priceVersion({ id: "price-current", publishedSeq: 2 }),
      priceVersion({ id: "price-old", status: "superseded", publishedSeq: 1 }),
    ]);

    await rollbackPricingVersion("price-old", ACTOR);

    const drafts = stored().filter((version) => version.status === "draft");
    expect(drafts.length).toBe(1);
    expect(drafts[0]?.status).toBe("draft");
    expect(drafts[0]?.publishedAt).toBeUndefined();
    expect(auditEvents().map((event) => event.action)).toEqual(["pricing.rollback"]);
    // Текущая published остаётся единственной опубликованной.
    expect(stored().filter((version) => version.status === "published").length).toBe(1);
  });

  it("PricingChange до публикации не создаётся (§6.6 — при публикации, CA-T-211)", async () => {
    seed([
      priceVersion({ id: "price-current", publishedSeq: 2 }),
      priceVersion({ id: "price-old", status: "superseded", publishedSeq: 1, snapshot: [{ priceItemId: "kitchen.shelf", amount: 500 }] }),
    ]);

    await rollbackPricingVersion("price-old", ACTOR);

    expect(existsSync(changesPath())).toBe(false);
  });

  it("rollback + publish (отдельным вызовом): копия публикуется штатным механизмом §8.5", async () => {
    seed([
      priceVersion({ id: "price-current", publishedSeq: 2 }),
      priceVersion({ id: "price-old", status: "superseded", publishedSeq: 1, snapshot: [{ priceItemId: "kitchen.shelf", amount: 500 }] }),
    ]);

    const rollback = await rollbackPricingVersion("price-old", ACTOR);
    const published = await publishPricingVersion(rollback.version.id, ACTOR);

    expect(published.version.status).toBe("published");
    expect(published.publishedSeq).toBe(3);
    expect(published.supersededVersionId).toBe("price-current");
    // Diff текущей published → копия: изменение amount ставки + появление
    // метаданных notes ("rollback to …", §6.6 metadata).
    expect(published.changesCount).toBe(2);
    // Источник отката по-прежнему не мутирован.
    expect(findVersion("price-old").status).toBe("superseded");
  });
});

describe("неизменность данных вне прайса", () => {
  it("проекты не изменяются", async () => {
    seed([priceVersion({ id: "price-source", publishedSeq: 1 })]);
    writeJson(projectsPath(), [
      { id: "p1", config: { version: 1, calcVersion: "calc-2026.11.0" }, price: 221600 },
    ]);
    const before = bytes(projectsPath());

    await rollbackPricingVersion("price-source", ACTOR);

    expect(bytes(projectsPath())).toBe(before);
  });

  it("пересчёт проектов не запускается: в аудите только pricing.rollback", async () => {
    seed([priceVersion({ id: "price-source", publishedSeq: 1 })]);

    await rollbackPricingVersion("price-source", ACTOR);

    const actions = auditEvents().map((event) => event.action);
    expect(actions).toEqual(["pricing.rollback"]);
    expect(actions.some((action) => action.includes("recalc"))).toBe(false);
  });

  it("calcVersion в проектах сохраняется", async () => {
    seed([priceVersion({ id: "price-source", publishedSeq: 1 })]);
    writeJson(projectsPath(), [
      { id: "p1", config: { version: 1, calcVersion: "calc-2026.11.0" } },
    ]);

    await rollbackPricingVersion("price-source", ACTOR);

    const projects = readJson<Array<{ config: { calcVersion: string } }>>(projectsPath());
    expect(projects[0]?.config.calcVersion).toBe("calc-2026.11.0");
  });
});
