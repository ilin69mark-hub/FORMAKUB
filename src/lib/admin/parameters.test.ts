import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createParameter,
  getParameter,
  listParameterHistory,
  listParameters,
  updateParameterStatus,
  updateParameterValue,
  type ActorContext,
} from "./parameters";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

const parametersPath = (): string => path.join(dir, "admin-parameters.json");
const auditPath = (): string => path.join(dir, "admin-audit-log.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-params-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

/** Вход create: без служебных полей (version/updatedAt/updatedBy штампует сервис). */
function createInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "kitchen.led.endMargin",
    scope: "kitchen",
    category: "technological",
    group: "03",
    valueType: "int",
    value: 2,
    unit: "cm",
    min: 0,
    max: 10,
    sourceRef: "src/content/catalog.ts:LED_END_MARGIN_CM",
    appliesTo: "all_read_paths",
    affects: {
      price: false,
      geometry: false,
      visualization: false,
      validation: false,
    },
    status: "active",
    editableInAdmin: true,
    ...overrides,
  };
}

async function setup(overrides: Record<string, unknown> = {}): Promise<string> {
  const created = await createParameter(createInput(overrides), ACTOR);
  return created.id;
}

describe("создание и чтение (CA-T-203)", () => {
  it("создание: version=1 (schemaVersion контента), updatedBy — из контекста, аудит param.create", async () => {
    const created = await createParameter(createInput(), ACTOR);

    expect(created.version).toBe("1");
    expect(created.updatedBy).toBe("admin-1");
    expect(await getParameter(created.id)).toEqual(created);

    const history = await listParameterHistory(created.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: "param.create",
      entityType: "parameter",
      entityId: created.id,
      actorId: "admin-1",
      actorRole: "calc-admin",
      result: "ok",
    });
  });

  it("дубликат id → отказ; чтение списка с фильтрами group/status (ТЗ §8)", async () => {
    await setup();
    await expect(createParameter(createInput(), ACTOR)).rejects.toThrow(
      /уже существует/,
    );

    await createParameter(
      createInput({ id: "wardrobe.limit.sections", group: "04" }),
      ACTOR,
    );

    expect(await getParameter("missing.id")).toBeUndefined();
    expect((await listParameters({ group: "03" })).map((p) => p.id)).toEqual([
      "kitchen.led.endMargin",
    ]);
    expect((await listParameters({ status: "active" })).length).toBe(2);
    expect(await listParameters({ status: "dead" })).toEqual([]);
  });
});

describe("обновление разрешённого параметра (CA-T-203)", () => {
  it("PATCH значения: инкремент version, expectedVersion, аудит с oldValue/newValue/paramVersion", async () => {
    const id = await setup();

    const updated = await updateParameterValue(
      id,
      { value: 5, expectedVersion: "1" },
      ACTOR,
    );

    expect(updated.value).toBe(5);
    expect(updated.version).toBe("2");
    expect(updated.updatedBy).toBe("admin-1");
    expect((await getParameter(id))?.value).toBe(5);

    const history = await listParameterHistory(id);
    const change = history.find((event) => event.action === "param.update");
    expect(change).toMatchObject({
      entityType: "parameter",
      entityId: id,
      oldValue: 2,
      newValue: 5,
      paramVersion: "2",
      actorId: "admin-1",
      actorRole: "calc-admin",
      result: "ok",
    });
  });

  it("неверный expectedVersion → конфликт, данные не изменяются, аудита нет", async () => {
    const id = await setup();
    const before = await getParameter(id);

    await expect(
      updateParameterValue(id, { value: 9, expectedVersion: "9" }, ACTOR),
    ).rejects.toThrow(/Конфликт версии/);

    expect(await getParameter(id)).toEqual(before);
    expect(await listParameterHistory(id)).toHaveLength(1); // только create
  });

  it("смена статуса active ⇄ readonly и active → dead; терминальный dead", async () => {
    const id = await setup();

    const readonly = await updateParameterStatus(
      id,
      { status: "readonly", expectedVersion: "1" },
      ACTOR,
    );
    expect(readonly.status).toBe("readonly");
    expect(readonly.version).toBe("2");

    // PATCH значения при status=readonly запрещён (§7.5.1)
    await expect(
      updateParameterValue(id, { value: 7, expectedVersion: "2" }, ACTOR),
    ).rejects.toThrow(/status=active/);

    const active = await updateParameterStatus(
      id,
      { status: "active", expectedVersion: "2" },
      ACTOR,
    );
    expect(active.status).toBe("active");
    expect(active.version).toBe("3");

    await updateParameterStatus(
      id,
      { status: "dead", expectedVersion: "3" },
      ACTOR,
    );
    // dead — терминальный (§6.1): ни значение, ни статус
    await expect(
      updateParameterValue(id, { value: 7, expectedVersion: "4" }, ACTOR),
    ).rejects.toThrow(/status=active/);
    await expect(
      updateParameterStatus(id, { status: "active", expectedVersion: "4" }, ACTOR),
    ).rejects.toThrow(/не разрешён/);
  });

  it("отказ валидации: значение вне тип/диапазона → ZodError, параметр и журнал не изменяются", async () => {
    const id = await setup();
    const before = await getParameter(id);

    await expect(
      updateParameterValue(id, { value: "не число", expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow();
    await expect(
      updateParameterValue(id, { value: 99, expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow(); // вне [min,max]

    expect(await getParameter(id)).toEqual(before);
    expect(await listParameterHistory(id)).toHaveLength(1);
  });
});

describe("запреты геометрии (R-04/§7.5, каждый путь)", () => {
  it("category=geometric: PATCH значения и смена статуса запрещены", async () => {
    const id = await setup({
      id: "kitchen.limit.totalWidth",
      category: "geometric",
      affects: { price: false, geometry: true, visualization: false, validation: false },
      sourceRef: "src/content/catalog.ts:KITCHEN_LIMITS.minTotalWidth",
    });
    const before = await getParameter(id);

    await expect(
      updateParameterValue(id, { value: 5, expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow(/геометрического параметра/);
    await expect(
      updateParameterStatus(id, { status: "readonly", expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow(/геометрического параметра/);

    expect(await getParameter(id)).toEqual(before);
    expect(await listParameterHistory(id)).toHaveLength(1); // только create
  });

  it("обход невозможен: affects.geometry блокирует и при category≠geometric", async () => {
    const id = await setup({
      id: "kitchen.visualization.edgeGap",
      category: "visualization",
      affects: { price: false, geometry: true, visualization: true, validation: false },
      sourceRef: "src/components/site/KitchenScene.tsx:EDGE_GAP",
    });

    await expect(
      updateParameterValue(id, { value: 6, expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow(/влияет на геометрию/);
    await expect(
      updateParameterStatus(id, { status: "dead", expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow(/влияет на геометрию/);
    expect((await getParameter(id))?.value).toBe(2);
  });

  it("editableInAdmin=false → правка запрещена (§7.5.1/§7.6.3)", async () => {
    const id = await setup({
      id: "kitchen.constructive.sidePanel",
      category: "constructive",
      editableInAdmin: false,
      status: "readonly",
      affects: { price: false, geometry: false, visualization: false, validation: true },
      sourceRef: "src/content/pricing.ts:PRICING.kitchen.sidePanel",
    });

    await expect(
      updateParameterValue(id, { value: 5, expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow(/editableInAdmin/);
    await expect(
      updateParameterStatus(id, { status: "active", expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow(/editableInAdmin/);
  });
});

describe("pending_release (R-08/§7.5.4, CA-T-203)", () => {
  it("изменение affects.price + all_read_paths принимается, но не вступает в силу: pending_release", async () => {
    const id = await setup({
      id: "kitchen.price.shelfRate",
      valueType: "decimal",
      value: 1100,
      defaultValue: 1100,
      unit: "rub",
      min: 0,
      max: 5000,
      step: 50,
      affects: { price: true, geometry: false, visualization: false, validation: false },
      sourceRef: "src/content/pricing.ts:PRICING.kitchen.shelf",
    });

    const updated = await updateParameterValue(
      id,
      { value: 1200, expectedVersion: "1" },
      ACTOR,
    );

    expect(updated.status).toBe("pending_release"); // «принято, но не действует»
    expect(updated.value).toBe(1200);
    expect(updated.version).toBe("2");
    // оператор видит пометку; последующие правки заблокированы до релиза
    expect((await getParameter(id))?.status).toBe("pending_release");
    expect(
      (await listParameters({ status: "pending_release" })).map((p) => p.id),
    ).toEqual([id]);
    await expect(
      updateParameterValue(id, { value: 1300, expectedVersion: "2" }, ACTOR),
    ).rejects.toThrow(/status=active/);
    // активация — только выпуском calcVersion (вне CA-T-203)
    await expect(
      updateParameterStatus(id, { status: "active", expectedVersion: "2" }, ACTOR),
    ).rejects.toThrow(/не разрешён/);
    expect((await getParameter(id))?.status).toBe("pending_release");
  });

  it("affects.price + appliesTo=new_projects: вступает в силу для новых проектов, статус не меняется", async () => {
    const id = await setup({
      id: "kitchen.price.newOnly",
      valueType: "decimal",
      value: 12000,
      unit: "rub",
      min: 0,
      max: 50000,
      step: 100,
      appliesTo: "new_projects",
      affects: { price: true, geometry: false, visualization: false, validation: false },
      sourceRef: "src/content/pricing.ts:PRICING.kitchen.baseCost",
    });

    const updated = await updateParameterValue(
      id,
      { value: 13000, expectedVersion: "1" },
      ACTOR,
    );
    expect(updated.status).toBe("active");
    expect(updated.value).toBe(13000);
  });

  it("preliminary → отклоняется (подтверждение — отдельный режим §7.6.4)", async () => {
    const id = await setup({
      id: "kitchen.preliminary.sample",
      status: "preliminary",
    });

    await expect(
      updateParameterValue(id, { value: 5, expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow(/status=active/);
    expect((await getParameter(id))?.status).toBe("preliminary");
  });
});

describe("конкурентность и блокировки (CA-T-203)", () => {
  it("два конкурентных PATCH с одинаковым expectedVersion: один успех, один конфликт, без двойного инкремента", async () => {
    const id = await setup();

    const results = await Promise.allSettled([
      updateParameterValue(id, { value: 5, expectedVersion: "1" }, ACTOR),
      updateParameterValue(id, { value: 6, expectedVersion: "1" }, ACTOR),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /Конфликт версии/,
    );

    const final = await getParameter(id);
    expect(final?.version).toBe("2"); // ровно один инкремент
    expect([5, 6]).toContain(final?.value);
    expect(await listParameterHistory(id)).toHaveLength(2); // create + 1 update
  });
});

describe("ошибки записи аудита и неизменность входов (CA-T-203)", () => {
  it("ошибка журналирования: изменение сохранено, ошибка пробрасывается, компенсации нет", async () => {
    const id = await setup();
    writeFileSync(auditPath(), JSON.stringify([{ id: "broken" }]), "utf8");

    await expect(
      updateParameterValue(id, { value: 7, expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow(/невалидна/);

    // правило фиксируется явно: запись предшествует журналу, отката нет
    expect((await getParameter(id))?.value).toBe(7);
    expect((await getParameter(id))?.version).toBe("2");
    expect(JSON.parse(readFileSync(auditPath(), "utf8"))).toEqual([
      { id: "broken" },
    ]);
  });

  it("входные объекты не мутируются ни при успехе, ни при отказе", async () => {
    const id = await setup();
    const input = createInput({ id: "kitchen.led.second", value: 4 });
    const inputSnapshot = JSON.stringify(input);
    await createParameter(input, ACTOR);
    expect(JSON.stringify(input)).toBe(inputSnapshot);

    const patch = Object.freeze({ value: 5, expectedVersion: "1" });
    await updateParameterValue(id, patch, ACTOR);
    expect(patch).toEqual({ value: 5, expectedVersion: "1" });

    const badPatch = Object.freeze({ value: 6, expectedVersion: "42" });
    await expect(
      updateParameterValue(id, badPatch, ACTOR),
    ).rejects.toThrow(/Конфликт версии/);
    expect(badPatch).toEqual({ value: 6, expectedVersion: "42" });

    const fileBefore = readFileSync(parametersPath(), "utf8");
    const badInput = createInput({ id });
    const badSnapshot = JSON.stringify(badInput);
    await expect(createParameter(badInput, ACTOR)).rejects.toThrow(
      /уже существует/,
    );
    expect(JSON.stringify(badInput)).toBe(badSnapshot);
    expect(readFileSync(parametersPath(), "utf8")).toBe(fileBefore);
  });
});
