import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createParameter,
  getParameter,
  parameterEditability,
  updateParameterStatus,
  type ActorContext,
} from "./parameters";
import { applyParameterValueEdit } from "./parameters-edit";
import {
  filterParameters,
  formatParameterValue,
  parseParameterFilter,
  parseParameterInput,
} from "./parameters-ui";
import type { AdminParameter } from "./schema";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-params-ui-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

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

async function create(overrides: Record<string, unknown> = {}): Promise<AdminParameter> {
  return createParameter(createInput(overrides), ACTOR);
}

/** Нечисловые варианты не имеют unit/min/max (strict-схема §7.1). */
function nonNumericInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = createInput(overrides);
  delete base.unit;
  delete base.min;
  delete base.max;
  delete base.step;
  return base;
}

describe("доступность правки для UI (CA-T-502)", () => {
  it("active + editableInAdmin=true → редактируется; calc-влияющий помечается pending_release", async () => {
    const plain = await create();
    expect(parameterEditability(plain)).toEqual({
      editable: true,
      willRequireRelease: false,
    });

    const priced = await create({
      id: "kitchen.labor.rate",
      affects: {
        price: true,
        geometry: false,
        visualization: false,
        validation: false,
      },
    });
    expect(parameterEditability(priced)).toEqual({
      editable: true,
      willRequireRelease: true,
    });
  });

  it("геометрия запрещена на обоих признаках (R-04/§7.5)", async () => {
    const geometric = await create({
      id: "kitchen.limit.width",
      category: "geometric",
      affects: {
        price: false,
        geometry: true,
        visualization: false,
        validation: false,
      },
    });
    expect(parameterEditability(geometric)).toMatchObject({
      editable: false,
      reason: "geometry",
    });

    const visual = await create({
      id: "kitchen.visual.edgeGap",
      category: "visualization",
      affects: {
        price: false,
        geometry: true,
        visualization: true,
        validation: false,
      },
    });
    expect(parameterEditability(visual)).toMatchObject({
      editable: false,
      reason: "geometry",
    });
  });

  it("editableInAdmin=false и статусы readonly/preliminary/pending_release/dead объясняют запрет", async () => {
    const locked = await create({
      id: "kitchen.system.lock",
      editableInAdmin: false,
    });
    expect(parameterEditability(locked)).toMatchObject({
      editable: false,
      reason: "notEditableInAdmin",
    });

    for (const status of [
      "readonly",
      "preliminary",
      "pending_release",
      "dead",
    ] as const) {
      const parameter = await create({
        id: `kitchen.status.${status}`,
        status,
      });
      const editability = parameterEditability(parameter);
      expect(editability).toMatchObject({ editable: false, reason: "status" });
      expect(editability.editable ? "" : editability.message.length).toBeGreaterThan(0);
    }
  });
});

describe("разбор ввода формы (CA-T-502)", () => {
  it("int/decimal: числа и отказ для нечисловых", async () => {
    const int = await create();
    expect(parseParameterInput(int, "5")).toBe(5);
    expect(() => parseParameterInput(int, "5.5")).toThrow(/целым/);

    const decimal = await create({
      id: "kitchen.led.margin",
      valueType: "decimal",
      value: 1.25,
      step: 0.01,
    });
    expect(parseParameterInput(decimal, "2.125")).toBe(2.125);
    expect(() => parseParameterInput(decimal, "abc")).toThrow(/числом/);
  });

  it("boolean/enum/string[] разбираются по типу; enum вне списка отклоняется", async () => {
    const boolean = await createParameter(
      nonNumericInput({
        id: "kitchen.flag",
        valueType: "boolean",
        value: true,
      }),
      ACTOR,
    );
    expect(parseParameterInput(boolean, "on")).toBe(true);
    expect(parseParameterInput(boolean, null)).toBe(false);

    const enumParameter = await createParameter(
      nonNumericInput({
        id: "kitchen.edge",
        valueType: "enum",
        value: "straight",
        enumValues: ["straight", "rounded"],
      }),
      ACTOR,
    );
    expect(parseParameterInput(enumParameter, "rounded")).toBe("rounded");
    expect(() => parseParameterInput(enumParameter, "other")).toThrow(/допустимых/);

    const list = await createParameter(
      nonNumericInput({
        id: "kitchen.list",
        valueType: "string[]",
        value: ["a"],
      }),
      ACTOR,
    );
    expect(parseParameterInput(list, "a\n b \n\n")).toEqual(["a", "b"]);
    expect(formatParameterValue(list)).toBe("a");
  });
});

describe("фильтры списка (ТЗ §7.3, CA-T-502)", () => {
  it("поиск по id/sourceRef, фильтры status/group/scope", async () => {
    const first = await create();
    const second = await create({
      id: "wardrobe.limit.sections",
      scope: "wardrobe",
      group: "04",
      sourceRef: "src/content/wardrobe.ts:WARDROBE_LIMITS.sections",
    });

    expect(parseParameterFilter({ status: "unknown" })).toEqual({
      status: undefined,
      group: undefined,
      scope: undefined,
    });
    expect(parseParameterFilter({ q: "  ledger  ", status: "active" })).toEqual({
      q: "ledger",
      status: "active",
      group: undefined,
      scope: undefined,
    });

    expect(filterParameters([first, second], { q: "led.end" }).map((p) => p.id)).toEqual([
      first.id,
    ]);
    expect(filterParameters([first, second], { group: "04" }).map((p) => p.id)).toEqual([
      second.id,
    ]);
    expect(filterParameters([first, second], { scope: "kitchen" }).map((p) => p.id)).toEqual([
      first.id,
    ]);
    expect(filterParameters([first, second], { q: "LED_END_MARGIN" }).map((p) => p.id)).toEqual([
      first.id,
    ]);
  });
});

describe("применение правки из формы (CA-T-502)", () => {
  it("разрешённая правка сохраняется и перечитывается из источника", async () => {
    const created = await create();

    const result = await applyParameterValueEdit({
      id: created.id,
      expectedVersion: "1",
      rawValue: "5",
      actor: ACTOR,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parameter.version).toBe("2");
    expect(result.message).toContain("version 2");

    const stored = await getParameter(created.id);
    expect(stored?.value).toBe(5);
    expect(stored?.version).toBe("2");
  });

  it("конфликт версий не перезаписывает чужое изменение", async () => {
    const created = await create();
    await applyParameterValueEdit({
      id: created.id,
      expectedVersion: "1",
      rawValue: "4",
      actor: ACTOR,
    });

    const conflict = await applyParameterValueEdit({
      id: created.id,
      expectedVersion: "1",
      rawValue: "9",
      actor: ACTOR,
    });

    expect(conflict.ok).toBe(false);
    expect(conflict.ok ? "" : conflict.message).toMatch(/Конфликт версии/);
    expect((await getParameter(created.id))?.value).toBe(4);
  });

  it("readonly/preliminary отклоняются до записи и объясняют причину", async () => {
    const readonly = await create({ id: "kitchen.readonly.param" });
    await updateParameterStatus(
      readonly.id,
      { status: "readonly", expectedVersion: "1" },
      ACTOR,
    );
    const before = await getParameter(readonly.id);

    const readonlyResult = await applyParameterValueEdit({
      id: readonly.id,
      expectedVersion: "2",
      rawValue: "3",
      actor: ACTOR,
    });
    expect(readonlyResult.ok).toBe(false);
    expect(readonlyResult.ok ? "" : readonlyResult.message).toMatch(/readonly/);
    expect(await getParameter(readonly.id)).toEqual(before);

    const preliminary = await create({
      id: "kitchen.preliminary.param",
      status: "preliminary",
    });
    const preliminaryResult = await applyParameterValueEdit({
      id: preliminary.id,
      expectedVersion: "1",
      rawValue: "3",
      actor: ACTOR,
    });
    expect(preliminaryResult.ok).toBe(false);
    expect(preliminaryResult.ok ? "" : preliminaryResult.message).toMatch(
      /preliminary/,
    );
  });

  it("клиентский разбор не заменяет сервер: значение вне диапазона отклоняется", async () => {
    const created = await create();

    const result = await applyParameterValueEdit({
      id: created.id,
      expectedVersion: "1",
      rawValue: "99",
      actor: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect((await getParameter(created.id))?.value).toBe(2);
    expect((await getParameter(created.id))?.version).toBe("1");
  });

  it("неизвестный id → явная ошибка, данные не создаются", async () => {
    const result = await applyParameterValueEdit({
      id: "missing.id",
      expectedVersion: "1",
      rawValue: "1",
      actor: ACTOR,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(/не найден/);
  });
});
