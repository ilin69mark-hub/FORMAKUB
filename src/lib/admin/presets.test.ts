import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultKitchen } from "@/lib/configurator/defaults";
import { calculatePrice } from "@/lib/configurator/pricing";
import { getProject } from "@/lib/server/projects";
import type { ActorContext } from "./parameters";
import {
  archiveModulePreset,
  deleteModulePreset,
  getModulePreset,
  listModulePresetHistory,
  listModulePresets,
  updateModulePreset,
  type ModulePresetPatch,
} from "./presets";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

const presetsPath = (): string => path.join(dir, "module-presets.json");
const projectsPath = (): string => path.join(dir, "projects.json");
const auditPath = (): string => path.join(dir, "admin-audit-log.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-presets-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

/** Фикстура записи (создание в сервисе не реализовано — CA-T-205 §2). */
function preset(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "base",
    family: "kitchen",
    zone: "floor",
    width: { min: 40, max: 120, default: 60 },
    height: { min: 80, max: 95, default: 90 },
    depth: { min: 50, max: 60, default: 60 },
    defaultShelves: 1,
    defaultDrawers: 0,
    priceRef: "preset.base.basePrice",
    status: "active",
    version: "1",
    updatedAt: "2026-11-07T00:00:00.000Z",
    updatedBy: "calc-admin",
    ...overrides,
  };
}

function writePresets(items: unknown[]): void {
  writeFileSync(presetsPath(), JSON.stringify(items, null, 2), "utf8");
}

const rawPresets = (): string => readFileSync(presetsPath(), "utf8");

describe("чтение и список (CA-T-205)", () => {
  it("получение пресета по (family, id); отсутствующие → undefined", async () => {
    writePresets([preset()]);

    const found = await getModulePreset("kitchen", "base");
    expect(found).toMatchObject({ id: "base", family: "kitchen", version: "1" });
    expect(await getModulePreset("wardrobe", "base")).toBeUndefined();
    expect(await getModulePreset("kitchen", "missing")).toBeUndefined();
  });

  it("список с фильтрацией по family (ТЗ §8)", async () => {
    writePresets([
      preset(),
      preset({ id: "sink" }),
      preset({ id: "tall", family: "wardrobe" }),
    ]);

    expect((await listModulePresets({ family: "kitchen" })).map((p) => p.id)).toEqual([
      "base",
      "sink",
    ]);
    expect((await listModulePresets()).length).toBe(3);
    expect((await listModulePresets({ family: "garage" })).length).toBe(0);
  });
});

describe("PATCH: размеры, дефолты, zone и границы (CA-T-205)", () => {
  it("изменение размеров: strict-валидация, version +1, аудит", async () => {
    writePresets([preset()]);

    const updated = await updateModulePreset(
      "kitchen",
      "base",
      { width: { min: 30, max: 150, default: 70 }, expectedVersion: "1" },
      ACTOR,
    );

    expect(updated.width).toEqual({ min: 30, max: 150, default: 70 });
    expect(updated.version).toBe("2");
    expect(updated.updatedBy).toBe("admin-1");
    expect((await getModulePreset("kitchen", "base"))?.width.default).toBe(70);
  });

  it("min/max/default: некорректные диапазоны и выход за границы → отказ, данные без изменений", async () => {
    writePresets([preset()]);
    const before = rawPresets();

    // min > max и default вне [min,max] — целостность §6.3 (схема)
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { width: { min: 80, max: 60, default: 70 }, expectedVersion: "1" },
        ACTOR,
      ),
    ).rejects.toThrow();
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { height: { min: 40, max: 280, default: 300 }, expectedVersion: "1" },
        ACTOR,
      ),
    ).rejects.toThrow();
    // границы размеров §6.3: width ≥ 15
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { depth: { min: 10, max: 60, default: 55 }, expectedVersion: "1" },
        ACTOR,
      ),
    ).rejects.toThrow();

    expect(rawPresets()).toBe(before);
    expect((await getModulePreset("kitchen", "base"))?.version).toBe("1");
    expect(await listModulePresetHistory("kitchen", "base")).toEqual([]);
  });

  it("shelves: 0 и 10 разрешены (version +1), −1 и 11 отклоняются (ТЗ §03)", async () => {
    writePresets([preset()]);

    const low = await updateModulePreset(
      "kitchen",
      "base",
      { defaultShelves: 0, expectedVersion: "1" },
      ACTOR,
    );
    expect(low.defaultShelves).toBe(0);
    expect(low.version).toBe("2");

    writePresets([preset()]);
    const high = await updateModulePreset(
      "kitchen",
      "base",
      { defaultShelves: 10, expectedVersion: "1" },
      ACTOR,
    );
    expect(high.defaultShelves).toBe(10);
    expect(high.version).toBe("2");

    writePresets([preset()]);
    const before = rawPresets();
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { defaultShelves: -1, expectedVersion: "1" },
        ACTOR,
      ),
    ).rejects.toThrow(/0–10/);
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { defaultShelves: 11, expectedVersion: "1" },
        ACTOR,
      ),
    ).rejects.toThrow(/0–10/);
    expect(rawPresets()).toBe(before);
  });

  it("drawers: 0 и 6 разрешены (version +1), −1 и 7 отклоняются (ТЗ §03)", async () => {
    writePresets([preset()]);

    const six = await updateModulePreset(
      "kitchen",
      "base",
      { defaultDrawers: 6, expectedVersion: "1" },
      ACTOR,
    );
    expect(six.defaultDrawers).toBe(6);
    expect(six.version).toBe("2");

    writePresets([preset()]);
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { defaultDrawers: -1, expectedVersion: "1" },
        ACTOR,
      ),
    ).rejects.toThrow(/0–6/);
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { defaultDrawers: 7, expectedVersion: "1" },
        ACTOR,
      ),
    ).rejects.toThrow(/0–6/);
    expect((await getModulePreset("kitchen", "base"))?.version).toBe("1");
  });

  it("zone: изменение разрешено (version +1), пустая зона отклоняется", async () => {
    writePresets([preset()]);

    const moved = await updateModulePreset(
      "kitchen",
      "base",
      { zone: "upper", expectedVersion: "1" },
      ACTOR,
    );
    expect(moved.zone).toBe("upper");
    expect(moved.version).toBe("2");

    const before = rawPresets();
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { zone: "", expectedVersion: "2" },
        ACTOR,
      ),
    ).rejects.toThrow();
    expect(rawPresets()).toBe(before);
  });

  it("immutable/id-поля и чужие ключи PATCH → отказ без изменений", async () => {
    writePresets([preset()]);
    const before = rawPresets();

    for (const forbidden of [
      { id: "sink" },
      { family: "wardrobe" },
      { priceRef: "other.ref" },
      { status: "archived" },
      { version: "99" },
    ]) {
      await expect(
        updateModulePreset(
          "kitchen",
          "base",
          { expectedVersion: "1", ...forbidden } as ModulePresetPatch,
          ACTOR,
        ),
      ).rejects.toThrow(/менять нельзя/);
    }
    expect(rawPresets()).toBe(before);
  });

  it("expectedVersion обязателен; PATCH без изменяемых полей → отказ", async () => {
    writePresets([preset()]);

    await expect(
      updateModulePreset("kitchen", "base", {} as ModulePresetPatch, ACTOR),
    ).rejects.toThrow(/expectedVersion обязателен/);
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { expectedVersion: "" } as ModulePresetPatch,
        ACTOR,
      ),
    ).rejects.toThrow(/expectedVersion обязателен/);
    await expect(
      updateModulePreset("kitchen", "base", { expectedVersion: "1" }, ACTOR),
    ).rejects.toThrow(/не содержит изменяемых полей/);
    expect((await getModulePreset("kitchen", "base"))?.version).toBe("1");
  });

  it("устаревший expectedVersion → конфликт, данные и журнал без изменений", async () => {
    writePresets([preset()]);
    const before = rawPresets();

    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { zone: "upper", expectedVersion: "42" },
        ACTOR,
      ),
    ).rejects.toThrow(/Конфликт версии/);

    expect(rawPresets()).toBe(before);
    expect(await listModulePresetHistory("kitchen", "base")).toEqual([]);
  });

  it("без фактических изменений: без новой версии, без записи журнала, файл не меняется", async () => {
    writePresets([preset()]);
    const before = rawPresets();

    // то же значение, другое порядок ключей — сравнение полевое
    const same = await updateModulePreset(
      "kitchen",
      "base",
      {
        width: { default: 60, min: 40, max: 120 } as {
          min: number;
          max: number;
          default: number;
        },
        expectedVersion: "1",
      },
      ACTOR,
    );
    expect(same.version).toBe("1");
    expect(rawPresets()).toBe(before);
    expect(await listModulePresetHistory("kitchen", "base")).toEqual([]);

    const sameZone = await updateModulePreset(
      "kitchen",
      "base",
      { zone: "floor", expectedVersion: "1" },
      ACTOR,
    );
    expect(sameZone.version).toBe("1");
    expect(await listModulePresetHistory("kitchen", "base")).toEqual([]);
  });

  it("конкурентные PATCH с одним expectedVersion: ровно один успех, один конфликт", async () => {
    writePresets([preset()]);

    const results = await Promise.allSettled([
      updateModulePreset(
        "kitchen",
        "base",
        { zone: "upper", expectedVersion: "1" },
        ACTOR,
      ),
      updateModulePreset(
        "kitchen",
        "base",
        { defaultShelves: 4, expectedVersion: "1" },
        ACTOR,
      ),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(/Конфликт версии/);

    const final = await getModulePreset("kitchen", "base");
    expect(final?.version).toBe("2"); // ровно один инкремент
    expect(await listModulePresetHistory("kitchen", "base")).toHaveLength(1);
  });
});

describe("архивирование и удаление (CA-T-205)", () => {
  it("active → archived: version +1, событие preset.update со снимками status", async () => {
    writePresets([preset()]);

    const archived = await archiveModulePreset("kitchen", "base", ACTOR);

    expect(archived.status).toBe("archived");
    expect(archived.version).toBe("2");
    expect(archived.updatedBy).toBe("admin-1");

    const history = await listModulePresetHistory("kitchen", "base");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: "preset.update",
      entityType: "preset",
      entityId: "kitchen:base",
      oldValue: { status: "active" },
      newValue: { status: "archived" },
      paramVersion: "2",
      actorId: "admin-1",
      actorRole: "calc-admin",
      result: "ok",
    });
  });

  it("повторное архивирование и любые операции с архивной записью → отказ", async () => {
    writePresets([preset()]);
    await archiveModulePreset("kitchen", "base", ACTOR);
    const before = rawPresets();

    await expect(archiveModulePreset("kitchen", "base", ACTOR)).rejects.toThrow(
      /уже в архиве/,
    );
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { zone: "upper", expectedVersion: "2" },
        ACTOR,
      ),
    ).rejects.toThrow(/только для status=active/);
    // восстановление не реализуется: поле status в PATCH запрещено (immutable)
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { status: "active", expectedVersion: "2" } as ModulePresetPatch,
        ACTOR,
      ),
    ).rejects.toThrow(/менять нельзя/);

    expect(rawPresets()).toBe(before);
  });

  it("физическое удаление запрещено всегда: ошибка без обращения к хранилищу", async () => {
    writePresets([preset()]);
    const before = rawPresets();

    await expect(deleteModulePreset("kitchen", "base")).rejects.toThrow(
      /запрещено всегда/,
    );

    expect(rawPresets()).toBe(before);
    expect(await getModulePreset("kitchen", "base")).toBeDefined();
    expect(await listModulePresetHistory("kitchen", "base")).toEqual([]);
  });

  it("старые проекты работоспособны после архивирования пресета (фактический путь загрузки)", async () => {
    // admin-запись пресета (id совпадает с type в конфиге проекта)
    writePresets([preset({ id: "sink" })]);
    // сохранённый проект со ссылкой config.modules[].type = "sink"
    const config = defaultKitchen();
    expect(config.kind).toBe("kitchen");
    if (config.kind !== "kitchen") return;
    expect(config.modules.some((module) => module.type === "sink")).toBe(true);
    writeFileSync(
      projectsPath(),
      JSON.stringify(
        [
          {
            id: "abcdefgh",
            config,
            price: calculatePrice(config),
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    await archiveModulePreset("kitchen", "sink", ACTOR);
    expect((await getModulePreset("kitchen", "sink"))?.status).toBe("archived");

    // путь getProject не читает admin-пресеты: загрузка и пересчёт успешны
    const loaded = await getProject("abcdefgh");
    expect(loaded.status).toBe("ok");
    if (loaded.status !== "ok") return;
    expect(loaded.project.config.kind).toBe("kitchen");
    if (loaded.project.config.kind !== "kitchen") return;
    expect(
      loaded.project.config.modules.some((module) => module.type === "sink"),
    ).toBe(true);
    // пересчёт дал результат (calculatePrice на конфиге проекта)
    expect(loaded.project.price.total).toBeGreaterThan(0);
  });
});

describe("аудит и неизменность входов (CA-T-205)", () => {
  it("история читается через listAuditEvents с составным entityId", async () => {
    writePresets([preset()]);

    await updateModulePreset(
      "kitchen",
      "base",
      { defaultShelves: 3, expectedVersion: "1" },
      ACTOR,
    );
    await updateModulePreset(
      "kitchen",
      "base",
      { zone: "upper", expectedVersion: "2" },
      ACTOR,
    );
    await archiveModulePreset("kitchen", "base", ACTOR);

    const history = await listModulePresetHistory("kitchen", "base");
    expect(history).toHaveLength(3);
    expect(history[0]).toMatchObject({
      action: "preset.update",
      oldValue: { defaultShelves: 1 },
      newValue: { defaultShelves: 3 },
      paramVersion: "2",
      actorId: "admin-1",
      actorRole: "calc-admin",
    });
    expect(history[1]).toMatchObject({
      oldValue: { zone: "floor" },
      newValue: { zone: "upper" },
      paramVersion: "3",
    });
    expect(history[2]).toMatchObject({
      oldValue: { status: "active" },
      newValue: { status: "archived" },
      paramVersion: "4",
    });
    expect(await listModulePresetHistory("wardrobe", "base")).toEqual([]);
  });

  it("ошибка записи аудита: изменение сохранено, ошибка пробрасывается без компенсации", async () => {
    writePresets([preset()]);
    writeFileSync(auditPath(), JSON.stringify([{ id: "broken" }]), "utf8");

    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        { zone: "upper", expectedVersion: "1" },
        ACTOR,
      ),
    ).rejects.toThrow(/невалидна/);

    const after = await getModulePreset("kitchen", "base");
    expect(after?.zone).toBe("upper");
    expect(after?.version).toBe("2");
    expect(JSON.parse(readFileSync(auditPath(), "utf8"))).toEqual([
      { id: "broken" },
    ]);
  });

  it("входные объекты не мутируются при отказах", async () => {
    writePresets([preset()]);

    const patch = Object.freeze({
      expectedVersion: "99",
      zone: "upper",
    });
    await expect(
      updateModulePreset("kitchen", "base", patch, ACTOR),
    ).rejects.toThrow(/Конфликт версии/);
    expect(patch).toEqual({ expectedVersion: "99", zone: "upper" });

    const dims = Object.freeze({ min: 40, max: 120, default: 60 });
    const dimsPatch = Object.freeze({ expectedVersion: "99", width: dims });
    await expect(
      updateModulePreset("kitchen", "base", dimsPatch, ACTOR),
    ).rejects.toThrow(/Конфликт версии/);
    expect(dimsPatch.width).toEqual({ min: 40, max: 120, default: 60 });

    const fileBefore = rawPresets();
    const forbidden = Object.freeze({ expectedVersion: "1", id: "sink" });
    await expect(
      updateModulePreset(
        "kitchen",
        "base",
        forbidden as ModulePresetPatch,
        ACTOR,
      ),
    ).rejects.toThrow(/менять нельзя/);
    expect(forbidden).toEqual({ expectedVersion: "1", id: "sink" });
    expect(rawPresets()).toBe(fileBefore);
  });
});
