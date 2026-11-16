import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ActorContext } from "./parameters";
import {
  archiveCatalogItem,
  createCatalogItem,
  deleteCatalogItem,
  getCatalogItem,
  listCatalogItemHistory,
  listCatalogItems,
  updateCatalogItem,
} from "./catalogs";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

const itemsPath = (): string => path.join(dir, "catalog-items.json");
const projectsPath = (): string => path.join(dir, "projects.json");
const auditPath = (): string => path.join(dir, "admin-audit-log.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-catalogs-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function createInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "compact_hpl",
    catalog: "bodyMaterial",
    label: "Компакт HPL",
    attrs: { rate: 9500, finishes: ["white"] },
    status: "active",
    ...overrides,
  };
}

async function setup(overrides: Record<string, unknown> = {}): Promise<string> {
  const created = await createCatalogItem(createInput(overrides), ACTOR);
  return created.id;
}

function writeProjects(projects: unknown[]): void {
  writeFileSync(projectsPath(), JSON.stringify(projects), "utf8");
}

describe("создание и чтение (CA-T-204)", () => {
  it("создание: version=1, служебные поля из контекста, аудит catalog.create", async () => {
    const created = await createCatalogItem(createInput(), ACTOR);

    expect(created.version).toBe("1");
    expect(created.updatedBy).toBe("admin-1");
    expect(created.status).toBe("active");
    expect(await getCatalogItem("bodyMaterial", "compact_hpl")).toEqual(created);

    const history = await listCatalogItemHistory("bodyMaterial", "compact_hpl");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: "catalog.create",
      entityType: "catalog",
      entityId: "bodyMaterial:compact_hpl",
      actorId: "admin-1",
      actorRole: "calc-admin",
      result: "ok",
    });
  });

  it("чтение по паре (catalog,id); другой каталог — не найдено", async () => {
    await setup();
    expect(await getCatalogItem("bodyMaterial", "missing")).toBeUndefined();
    expect(await getCatalogItem("facadeMaterial", "compact_hpl")).toBeUndefined();
  });

  it("U(catalog,id): дубль в том же каталоге — отказ; тот же id в другом каталоге — допустим", async () => {
    await setup();
    await expect(createCatalogItem(createInput(), ACTOR)).rejects.toThrow(
      /уже существует/,
    );
    const other = await createCatalogItem(
      createInput({ catalog: "facadeMaterial", label: "Компакт (фасад)" }),
      ACTOR,
    );
    expect(other.catalog).toBe("facadeMaterial");
  });

  it("список элементов с фильтром по status (ТЗ §8)", async () => {
    await setup();
    await createCatalogItem(createInput({ id: "porcelain" }), ACTOR);

    expect((await listCatalogItems("bodyMaterial")).map((i) => i.id)).toEqual([
      "compact_hpl",
      "porcelain",
    ]);
    expect(
      (await listCatalogItems("bodyMaterial", { status: "archived" })).length,
    ).toBe(0);
    expect(await listCatalogItems("facadeMaterial")).toEqual([]);
  });
});

describe("редактирование (CA-T-204)", () => {
  it("обновление attrs/label/sortOrder: замена attrs целиком, инкремент version только при attrs", async () => {
    const id = await setup();

    const withAttrs = await updateCatalogItem(
      "bodyMaterial",
      id,
      { attrs: { rate: 9800 }, expectedVersion: "1" },
      ACTOR,
    );
    expect(withAttrs.attrs).toEqual({ rate: 9800 }); // замена, не merge
    expect(withAttrs.version).toBe("2");

    const labelOnly = await updateCatalogItem(
      "bodyMaterial",
      id,
      { label: "Компакт HPL 2", sortOrder: 5, expectedVersion: "2" },
      ACTOR,
    );
    expect(labelOnly.label).toBe("Компакт HPL 2");
    expect(labelOnly.sortOrder).toBe(5);
    expect(labelOnly.version).toBe("2"); // §6.2/S-06: версия отражает attrs
    expect(withAttrs.attrs).toEqual({ rate: 9800 });
  });

  it("конфликт expectedVersion: данные и журнал не изменяются", async () => {
    const id = await setup();
    const before = await getCatalogItem("bodyMaterial", id);
    const historyBefore = await listCatalogItemHistory("bodyMaterial", id);

    await expect(
      updateCatalogItem(
        "bodyMaterial",
        id,
        { label: "x", expectedVersion: "42" },
        ACTOR,
      ),
    ).rejects.toThrow(/Конфликт версии/);

    expect(await getCatalogItem("bodyMaterial", id)).toEqual(before);
    expect(await listCatalogItemHistory("bodyMaterial", id)).toEqual(historyBefore);
  });

  it("полная валидация схемой: некорректные поля → отказ, данные не изменяются", async () => {
    const id = await setup();
    const before = await getCatalogItem("bodyMaterial", id);

    await expect(
      updateCatalogItem("bodyMaterial", id, { label: "", expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow();
    await expect(
      updateCatalogItem(
        "bodyMaterial",
        id,
        { sortOrder: 1.5, expectedVersion: "1" },
        ACTOR,
      ),
    ).rejects.toThrow();
    await expect(
      updateCatalogItem("bodyMaterial", id, { expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow(/не содержит изменяемых полей/);

    expect(await getCatalogItem("bodyMaterial", id)).toEqual(before);
    expect(await listCatalogItemHistory("bodyMaterial", id)).toHaveLength(1);
  });

  it("конкурентные обновления attrs с одним expectedVersion: один успех, один конфликт", async () => {
    const id = await setup();

    const results = await Promise.allSettled([
      updateCatalogItem(
        "bodyMaterial",
        id,
        { attrs: { rate: 1 }, expectedVersion: "1" },
        ACTOR,
      ),
      updateCatalogItem(
        "bodyMaterial",
        id,
        { attrs: { rate: 2 }, expectedVersion: "1" },
        ACTOR,
      ),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(/Конфликт версии/);

    const final = await getCatalogItem("bodyMaterial", id);
    expect(final?.version).toBe("2"); // ровно один инкремент
    expect([1, 2]).toContain((final?.attrs as { rate: number }).rate);
  });
});

describe("удаление и архивирование (CA-T-204)", () => {
  it("физическое удаление запрещено всегда: ошибка без изменения данных", async () => {
    const id = await setup();
    const before = readFileSync(itemsPath(), "utf8");

    await expect(deleteCatalogItem("bodyMaterial", id)).rejects.toThrow(
      /запрещено всегда/,
    );

    expect(readFileSync(itemsPath(), "utf8")).toBe(before);
    expect(await getCatalogItem("bodyMaterial", id)).toBeDefined();
    expect(await listCatalogItemHistory("bodyMaterial", id)).toHaveLength(1);
  });

  it("архивирование: active → archived, version не меняется, аудит catalog.archive", async () => {
    const id = await setup();

    const archived = await archiveCatalogItem("bodyMaterial", id, ACTOR);

    expect(archived.status).toBe("archived");
    expect(archived.version).toBe("1"); // архив не правит attrs (§6.2/S-06)
    expect(archived.updatedBy).toBe("admin-1");

    const history = await listCatalogItemHistory("bodyMaterial", id);
    expect(history.map((event) => event.action)).toEqual([
      "catalog.create",
      "catalog.archive",
    ]);
    expect(history[1]).toMatchObject({
      oldValue: { status: "active" },
      newValue: { status: "archived" },
    });

    expect(
      (await listCatalogItems("bodyMaterial", { status: "archived" })).map(
        (i) => i.id,
      ),
    ).toEqual([id]);
    expect(await listCatalogItems("bodyMaterial", { status: "active" })).toEqual(
      [],
    );
  });

  it("недопустимые переходы: повторное архивирование и любые операции с архивной записью", async () => {
    const id = await setup();
    await archiveCatalogItem("bodyMaterial", id, ACTOR);

    await expect(archiveCatalogItem("bodyMaterial", id, ACTOR)).rejects.toThrow(
      /уже в архиве/,
    );
    await expect(
      updateCatalogItem(
        "bodyMaterial",
        id,
        { label: "возврат", expectedVersion: "1" },
        ACTOR,
      ),
    ).rejects.toThrow(/только для status=active/);
    // статус нельзя подменить через патч — поле status в контракте отсутствует
    expect((await getCatalogItem("bodyMaterial", id))?.status).toBe("archived");
  });

  it("preliminary при создании не описан → отказ (§6.2)", async () => {
    await expect(
      createCatalogItem(createInput({ status: "preliminary" }), ACTOR),
    ).rejects.toThrow(/не описано/);
    expect(await getCatalogItem("bodyMaterial", "compact_hpl")).toBeUndefined();
  });
});

describe("проверка ссылок при архивировании (ТЗ §8 → 409)", () => {
  it("проект ссылается на id в config → архивирование отклонено, данные и журнал без изменений", async () => {
    const id = await setup();
    writeProjects([
      {
        id: "abcdefgh",
        config: { kind: "kitchen", body: { material: "compact_hpl" } },
        price: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const before = readFileSync(itemsPath(), "utf8");

    await expect(archiveCatalogItem("bodyMaterial", id, ACTOR)).rejects.toThrow(
      /используется в проектах \(abcdefgh\)/,
    );

    expect(readFileSync(itemsPath(), "utf8")).toBe(before);
    expect(
      (await listCatalogItemHistory("bodyMaterial", id)).map((e) => e.action),
    ).toEqual(["catalog.create"]);
  });

  it("легаси-идентификатор проекта (laminate → compact_hpl) учитывается", async () => {
    const id = await setup(); // compact_hpl
    writeProjects([
      { id: "zzzzzzzz", config: { kind: "kitchen", countertop: "laminate" } },
    ]);

    await expect(archiveCatalogItem("bodyMaterial", id, ACTOR)).rejects.toThrow(
      /используется в проектах \(zzzzzzzz\)/,
    );
  });

  it("ссылка в pins (ключи catalogVersions) учитывается", async () => {
    const id = await setup();
    writeProjects([
      {
        id: "pppppppp",
        config: { kind: "kitchen" },
        pins: { catalogVersions: { bodyMaterial: { compact_hpl: "3" } } },
      },
    ]);

    await expect(archiveCatalogItem("bodyMaterial", id, ACTOR)).rejects.toThrow(
      /используется в проектах \(pppppppp\)/,
    );
  });

  it("CA-516-02: ссылка в историческом priceHistory учитывается", async () => {
    const id = await setup();
    writeProjects([
      {
        id: "hhhhhhhh",
        config: { kind: "kitchen", facadeMaterial: "mdf" },
        priceHistory: [
          {
            id: "hist-1",
            oldPrice: 100,
            newPrice: 200,
            breakdown: { lines: [{ materialId: "compact_hpl" }] },
          },
        ],
      },
    ]);

    await expect(archiveCatalogItem("bodyMaterial", id, ACTOR)).rejects.toThrow(
      /используется в проектах \(hhhhhhhh\)/,
    );
  });

  it("CA-516-02: legacy-запись без ссылок архивируется и остаётся читаемой", async () => {
    const id = await createCatalogItem(
      createInput({ id: "veneer", catalog: "facadeMaterial", label: "Шпон" }),
      ACTOR,
    ).then((item) => item.id);

    const archived = await archiveCatalogItem("facadeMaterial", id, ACTOR);
    expect(archived.status).toBe("archived");

    // Новые выборки active не содержат запись, но чтение по id доступно.
    expect(
      await listCatalogItems("facadeMaterial", { status: "active" }),
    ).toEqual([]);
    expect((await getCatalogItem("facadeMaterial", id))?.status).toBe("archived");
  });

  it("CA-516-02: legacy-запись с проектом не архивируется и остаётся читаемой", async () => {
    const id = await createCatalogItem(
      createInput({ id: "glass", catalog: "facadeMaterial", label: "Стекло" }),
      ACTOR,
    ).then((item) => item.id);
    writeProjects([
      {
        id: "gggggggg",
        config: { kind: "kitchen", facadeMaterial: "glass" },
      },
    ]);

    await expect(archiveCatalogItem("facadeMaterial", id, ACTOR)).rejects.toThrow(
      /используется в проектах \(gggggggg\)/,
    );
    expect((await getCatalogItem("facadeMaterial", id))?.status).toBe("active");
  });

  it("CA-516-02: CatalogItem со связанной used-ставкой не архивируется", async () => {
    const id = await createCatalogItem(
      createInput({
        id: "veneer",
        catalog: "facadeMaterial",
        priceRefs: { ratePerSqm: "catalog.facade.veneer.ratePerSqm" },
      }),
      ACTOR,
    ).then((item) => item.id);
    writeFileSync(
      path.join(dir, "price-items.json"),
      JSON.stringify([
        {
          id: "catalog.facade.veneer.ratePerSqm",
          status: "active",
          usage: "used",
        },
      ]),
      "utf8",
    );

    await expect(archiveCatalogItem("facadeMaterial", id, ACTOR)).rejects.toThrow(
      /исторические зависимости.*usage=used/,
    );
    expect((await getCatalogItem("facadeMaterial", id))?.status).toBe("active");
  });

  it("CA-516-02: CatalogItem со ставкой из published snapshot не архивируется", async () => {
    const id = await createCatalogItem(
      createInput({
        id: "solid",
        catalog: "facadeMaterial",
        priceRefs: { ratePerSqm: "catalog.facade.solid.ratePerSqm" },
      }),
      ACTOR,
    ).then((item) => item.id);
    writeFileSync(
      path.join(dir, "price-items.json"),
      JSON.stringify([
        {
          id: "catalog.facade.solid.ratePerSqm",
          status: "active",
          usage: "unused",
        },
      ]),
      "utf8",
    );
    writeFileSync(
      path.join(dir, "pricing-versions.json"),
      JSON.stringify([
        {
          id: "price-published-1",
          status: "published",
          snapshot: [{ priceItemId: "catalog.facade.solid.ratePerSqm", amount: 1 }],
        },
      ]),
      "utf8",
    );

    await expect(archiveCatalogItem("facadeMaterial", id, ACTOR)).rejects.toThrow(
      /published:price-published-1/,
    );
  });

  it("нет ссылок → архивирование проходит; посторонние значения не считаются ссылкой", async () => {
    const id = await setup();
    writeProjects([
      {
        id: "kkkkkkkk",
        config: { kind: "kitchen", body: { material: "porcelain" } },
        customer: { name: "compact_hpl" }, // свободный текст — не ссылка
      },
    ]);

    const archived = await archiveCatalogItem("bodyMaterial", id, ACTOR);
    expect(archived.status).toBe("archived");
  });
});

describe("аудит и неизменность входов (CA-T-204)", () => {
  it("история собирается из существующего аудита (create/update/archive)", async () => {
    const id = await setup();
    await updateCatalogItem(
      "bodyMaterial",
      id,
      { attrs: { rate: 9700 }, expectedVersion: "1" },
      ACTOR,
    );
    await archiveCatalogItem("bodyMaterial", id, ACTOR);

    const history = await listCatalogItemHistory("bodyMaterial", id);
    expect(history.map((event) => event.action)).toEqual([
      "catalog.create",
      "catalog.update",
      "catalog.archive",
    ]);
    expect(history[1]).toMatchObject({
      oldValue: { attrs: { rate: 9500, finishes: ["white"] } },
      newValue: { attrs: { rate: 9700 } },
      paramVersion: "2",
      actorId: "admin-1",
    });
  });

  it("ошибка записи аудита: изменение сохранено, ошибка пробрасывается без компенсации", async () => {
    const id = await setup();
    writeFileSync(auditPath(), JSON.stringify([{ id: "broken" }]), "utf8");

    await expect(
      updateCatalogItem(
        "bodyMaterial",
        id,
        { label: "после сбоя", expectedVersion: "1" },
        ACTOR,
      ),
    ).rejects.toThrow(/невалидна/);

    expect(
      (await getCatalogItem("bodyMaterial", id))?.label,
    ).toBe("после сбоя");
    expect(JSON.parse(readFileSync(auditPath(), "utf8"))).toEqual([
      { id: "broken" },
    ]);
  });

  it("входные объекты не мутируются при отказах", async () => {
    const id = await setup();
    const input = createInput({ id: "porcelain" });
    const inputSnapshot = JSON.stringify(input);
    await createCatalogItem(input, ACTOR);
    expect(JSON.stringify(input)).toBe(inputSnapshot);

    const patch = Object.freeze({
      expectedVersion: "99",
      label: "x",
    });
    await expect(
      updateCatalogItem("bodyMaterial", id, patch, ACTOR),
    ).rejects.toThrow(/Конфликт версии/);
    expect(patch).toEqual({ expectedVersion: "99", label: "x" });

    const fileBefore = readFileSync(itemsPath(), "utf8");
    const duplicate = createInput(); // compact_hpl/bodyMaterial уже существует
    const duplicateSnapshot = JSON.stringify(duplicate);
    await expect(createCatalogItem(duplicate, ACTOR)).rejects.toThrow(
      /уже существует/,
    );
    expect(JSON.stringify(duplicate)).toBe(duplicateSnapshot);
    expect(readFileSync(itemsPath(), "utf8")).toBe(fileBefore);
  });
});
