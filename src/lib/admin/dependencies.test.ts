import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EXCLUDED_FORMULAS,
  FORMULA_REGISTRY,
  MAP_ROWS,
  UNKNOWN_SOURCES,
  mapKey,
} from "./dependency-map";
import {
  createDependency,
  deleteDependency,
  diagnoseGraph,
  getDependency,
  importDependencyMap,
  listDependencies,
  listDependencyEvents,
  type ImportReport,
} from "./dependencies";
import type { ActorContext } from "./parameters";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

const parametersPath = (): string => path.join(dir, "admin-parameters.json");
const catalogsPath = (): string => path.join(dir, "catalog-items.json");
const presetsPath = (): string => path.join(dir, "module-presets.json");
const dependenciesPath = (): string => path.join(dir, "parameter-dependencies.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-deps-"));
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

function sha(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Параметры из вокабуляры §5 аудита; affects — по фактическим эффектам карты. */
function seedParameters(extraIds: string[] = []): void {
  const ids = new Set(
    MAP_ROWS.filter((row) => row.sourceType === "parameter").map((row) => row.sourceId),
  );
  for (const id of extraIds) ids.add(id);
  const records = [...ids].map((id) => {
    const rows = MAP_ROWS.filter((row) => row.sourceType === "parameter" && row.sourceId === id);
    const flag = (effect: string): boolean =>
      rows.some((row) => row.effect === effect);
    // UNKNOWN-источники без строк карты: флаги — по документу (§5 №10:
    // plinthHeight влияет на 2D-геометрию, стоимость «нет»).
    const unknown = rows.length === 0;
    return {
      id,
      scope: "kitchen",
      category: "technological",
      group: "03",
      valueType: "boolean",
      value: true,
      sourceRef: `CALCULATOR_TECHNICAL_AUDIT.md §5:${id}`,
      appliesTo: "all_read_paths",
      affects: {
        price: unknown ? false : flag("price"),
        geometry: unknown ? true : flag("geometry"),
        visualization: unknown ? false : flag("visualization"),
        validation: unknown ? false : flag("validation"),
      },
      status: "active",
      editableInAdmin: true,
      version: "1",
      updatedAt: "2026-11-08T00:00:00.000Z",
      updatedBy: "test",
    };
  });
  writeJson(parametersPath(), records);
}

function seedCatalogs(statusById: Record<string, "active" | "archived"> = {}): void {
  const keys = new Set(
    MAP_ROWS.filter((row) => row.sourceType === "catalogItem").map((row) => row.sourceId),
  );
  const records = [...keys].map((key) => {
    const [catalog, id] = key.split(":");
    return {
      id,
      catalog,
      label: id,
      attrs: {},
      status: statusById[key] ?? "active",
      version: "1",
      createdAt: "2026-11-08T00:00:00.000Z",
      updatedAt: "2026-11-08T00:00:00.000Z",
      updatedBy: "test",
    };
  });
  writeJson(catalogsPath(), records);
}

function seedPresets(): void {
  const keys = new Set(
    MAP_ROWS.filter((row) => row.sourceType === "preset").map((row) => row.sourceId),
  );
  const records = [...keys].map((key) => {
    const [family, id] = key.split(":");
    return {
      id,
      family,
      zone: "floor",
      width: { min: 40, max: 120, default: 60 },
      height: { min: 80, max: 95, default: 90 },
      depth: { min: 50, max: 60, default: 60 },
      defaultShelves: 1,
      defaultDrawers: 0,
      priceRef: `preset.${id}.basePrice`,
      status: "active",
      version: "1",
      updatedAt: "2026-11-08T00:00:00.000Z",
      updatedBy: "test",
    };
  });
  writeJson(presetsPath(), records);
}

function seedAll(extraParams: string[] = []): void {
  seedParameters(extraParams);
  seedCatalogs();
  seedPresets();
}

async function imported(): Promise<ImportReport> {
  return importDependencyMap(ACTOR);
}

function validDep(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceType: "parameter",
    sourceId: "sidePanels",
    targetType: "calculation",
    targetId: "calculateKitchenPrice",
    effect: "price",
    syncRisk: false,
    ...overrides,
  };
}

describe("карта (dependency-map)", () => {
  it("U-ключи карты уникальны — дубликатов связей нет", () => {
    const keys = MAP_ROWS.map((row) => mapKey(row));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("все цели карты входят в реестры формул/компонентов", () => {
    const formulas = new Set(FORMULA_REGISTRY.map((item) => item.id));
    for (const row of MAP_ROWS) {
      if (row.targetType === "calculation") {
        expect(formulas.has(row.targetId), row.targetId).toBe(true);
      } else {
        expect(row.targetId.startsWith("component:"), row.targetId).toBe(true);
      }
    }
    expect(EXCLUDED_FORMULAS.map((item) => item.id)).toEqual([
      "calculatePrice",
      "roundMoney",
    ]);
    expect(UNKNOWN_SOURCES.length).toBeGreaterThan(0);
  });
});

describe("создание, чтение, валидация (§9 п.1–5, 8)", () => {
  it("создание: запись сохраняется, id детерминирован по U-ключу", async () => {
    seedAll();
    const created = await createDependency(validDep());
    expect(created.id.startsWith("dep-")).toBe(true);
    expect(await getDependency(created.id)).toEqual(created);
    // Повторное создание той же пары отклоняется (защита от дублирования)
    // — см. следующий тест.
  });

  it("повторное создание той же связи — отказ по U-ключи", async () => {
    seedAll();
    await createDependency(validDep());
    await expect(createDependency(validDep())).rejects.toThrow(/дубликат U-ключа/);
  });

  it("strict-валидация: неизвестное effect и лишнее поле отклоняются", async () => {
    await expect(createDependency(validDep({ effect: "bogus" }))).rejects.toThrow();
    await expect(createDependency(validDep({ extra: 1 }))).rejects.toThrow();
  });

  it("проверка существования источника и цели", async () => {
    seedAll();
    await expect(
      createDependency(validDep({ sourceId: "ghost-param" })),
    ).rejects.toThrow(/источник не найден/);
    await expect(
      createDependency(validDep({ targetId: "ghostFormula" })),
    ).rejects.toThrow(/цель не найдена/);
    await expect(
      createDependency(validDep({ sourceType: "catalogItem", sourceId: "countertop:ghost" })),
    ).rejects.toThrow(/источник не найден/);
  });

  it("чтение и фильтрация", async () => {
    seedAll();
    await imported();

    const all = await listDependencies();
    expect(all.length).toBe(MAP_ROWS.length);

    const params = await listDependencies({ sourceType: "parameter" });
    expect(params.length).toBe(
      MAP_ROWS.filter((row) => row.sourceType === "parameter").length,
    );
    expect(params.every((row) => row.sourceType === "parameter")).toBe(true);

    const dead = await listDependencies({ effect: "none" });
    expect(dead.length).toBe(MAP_ROWS.filter((row) => row.effect === "none").length);

    const price = await listDependencies({
      sourceType: "parameter",
      sourceId: "sidePanels",
      targetType: "calculation",
      targetId: "calculateKitchenPrice",
      effect: "price",
    });
    expect(price.length).toBe(1);
  });

  it("физическое удаление запрещено (§6.8 п.4)", async () => {
    await expect(deleteDependency()).rejects.toThrow(/физическое удаление запрещено/);
  });
});

describe("импорт (§9 п.6–7, 9, 17–18)", () => {
  it("импорт подтверждённой карты: skipped пуст, аудит diagnostic.run", async () => {
    seedAll();
    const report = await imported();

    expect(report.mapTotal).toBe(MAP_ROWS.length);
    expect(report.candidates).toBe(MAP_ROWS.length);
    expect(report.skipped).toEqual([]);
    expect(report.imported).toBe(MAP_ROWS.length);
    expect(report.existing).toBe(0);
    expect(report.dead).toBe(MAP_ROWS.filter((row) => row.effect === "none").length);
    expect(report.partial).toBe(MAP_ROWS.filter((row) => row.evidence === "PARTIAL").length);
    expect(report.unknownSources.length).toBe(UNKNOWN_SOURCES.length);

    expect((await listDependencies()).length).toBe(MAP_ROWS.length);

    const events = await listDependencyEvents("import");
    expect(events.length).toBe(1);
    expect(events[0]?.action).toBe("diagnostic.run");
    expect(events[0]?.result).toBe("ok");
  });

  it("повторный импорт идемпотентен: дубликаты не создаются", async () => {
    seedAll();
    await imported();
    const second = await imported();

    expect(second.imported).toBe(0);
    expect(second.existing).toBe(MAP_ROWS.length);
    expect((await listDependencies()).length).toBe(MAP_ROWS.length);
  });

  it("конкурентные импорты не создают дубликатов", async () => {
    seedAll();
    const [first, second] = await Promise.all([imported(), imported()]);

    const rows = await listDependencies();
    expect(rows.length).toBe(MAP_ROWS.length);
    expect(new Set(rows.map((row) => row.id)).size).toBe(MAP_ROWS.length);
    expect(first.imported + second.imported).toBe(MAP_ROWS.length);
  });

  it("неизвестный источник не импортируется как подтверждённый, отчёт восстановим", async () => {
    seedParametersMissingSidePanels();
    seedCatalogs();
    seedPresets();

    const first = await imported();
    expect(first.skipped).toEqual([
      {
        sourceType: "parameter",
        sourceId: "sidePanels",
        targetId: "calculateKitchenPrice",
        reason: "unknown-source",
      },
    ]);
    expect(first.imported).toBe(MAP_ROWS.length - 1);

    // Источник добавлен → повторный импорт догоняет без дубликатов.
    seedAll();
    const second = await imported();
    expect(second.skipped).toEqual([]);
    expect(second.imported).toBe(1);
    expect((await listDependencies()).length).toBe(MAP_ROWS.length);
  });

  it("ошибка создания не оставляет частично записанное состояние", async () => {
    seedAll();
    const before = existsSync(dependenciesPath())
      ? readFileSync(dependenciesPath(), "utf8")
      : null;

    await expect(createDependency(validDep({ effect: "bogus" }))).rejects.toThrow();

    const after = existsSync(dependenciesPath())
      ? readFileSync(dependenciesPath(), "utf8")
      : null;
    expect(after).toBe(before);
  });

  it("исходные данные калькуляторов не изменяются импортом", async () => {
    const files = [
      "src/content/catalog.ts",
      "src/content/pricing.ts",
      "src/lib/configurator/pricing.ts",
      "src/lib/configurator/sink.ts",
    ];
    const before = files.map((file) => sha(path.join(process.cwd(), file)));

    seedAll();
    await imported();

    const after = files.map((file) => sha(path.join(process.cwd(), file)));
    expect(after).toEqual(before);

    // В каталоге данных создаются только штатные коллекции.
    const created = readdirSync(dir).sort();
    expect(created).toEqual([
      "admin-audit-log.json",
      "admin-parameters.json",
      "catalog-items.json",
      "module-presets.json",
      "parameter-dependencies.json",
    ]);
  });
});

function seedParametersMissingSidePanels(): void {
  seedParameters();
  const records = readJson<Record<string, unknown>[]>(parametersPath()).filter(
    (item) => item.id !== "sidePanels",
  );
  writeJson(parametersPath(), records);
}

describe("диагностика полноты графа (§9 п.10–16)", () => {
  it("до импорта: параметры без рёбер — notCovered, граф не полон", async () => {
    seedAll();
    const diagnostic = await diagnoseGraph();

    expect(diagnostic.totals.rows).toBe(0);
    expect(diagnostic.coverage.effects.price.notCovered).toBeGreaterThan(0);
    expect(diagnostic.coverage.effects.price.complete).toBe(false);
    expect(diagnostic.coverage.complete).toBe(false);
    expect(diagnostic.structural.cycles).toEqual([]);
  });

  it("после импорта: структурная часть чистая (схема, U-ключи, ссылки)", async () => {
    seedAll();
    await imported();
    const diagnostic = await diagnoseGraph();

    expect(diagnostic.structural.invalid).toEqual([]);
    expect(diagnostic.structural.duplicates).toEqual([]);
    expect(diagnostic.structural.orphans).toEqual([]);
    expect(diagnostic.structural.archivedSources).toEqual([]);
    expect(diagnostic.structural.cycles).toEqual([]);
    expect(diagnostic.totals.rows).toBe(MAP_ROWS.length);
    expect(diagnostic.totals.valid).toBe(MAP_ROWS.length);
  });

  it("полнота affects.price: все активные параметры подтверждены", async () => {
    seedAll();
    await imported();
    const bucket = (await diagnoseGraph()).coverage.effects.price;

    expect(bucket.total).toBeGreaterThan(0);
    expect(bucket.confirmed).toBe(bucket.total);
    expect(bucket.partial).toBe(0);
    expect(bucket.unknown).toBe(0);
    expect(bucket.notCovered).toBe(0);
    expect(bucket.complete).toBe(true);
  });

  it("полнота affects.validation: подтверждена; affects.geometry — UNKNOWN (plinthHeight)", async () => {
    seedAll(["plinthHeight"]);
    await imported();
    const diagnostic = await diagnoseGraph();

    const validation = diagnostic.coverage.effects.validation;
    expect(validation.total).toBeGreaterThan(0);
    expect(validation.confirmed).toBe(validation.total);
    expect(validation.complete).toBe(true);

    const geometry = diagnostic.coverage.effects.geometry;
    expect(geometry.total).toBeGreaterThan(0);
    expect(geometry.unknown).toBe(1); // plinthHeight — UNKNOWN-потребитель
    expect(geometry.notCovered).toBe(0);
    expect(geometry.complete).toBe(false);
  });

  it("полнота affects.visualization: подтверждена", async () => {
    seedAll();
    await imported();
    const bucket = (await diagnoseGraph()).coverage.effects.visualization;

    expect(bucket.total).toBeGreaterThan(0);
    expect(bucket.confirmed).toBe(bucket.total);
    expect(bucket.complete).toBe(true);
  });

  it("покрытие формул §3: 15 проверяемых подтверждены, исключения явно перечислены", async () => {
    seedAll();
    await imported();
    const formulas = (await diagnoseGraph()).coverage.formulas;

    expect(formulas.total).toBe(17);
    expect(formulas.evaluable).toBe(15);
    expect(formulas.confirmed).toBe(15);
    expect(formulas.uncovered).toEqual([]);
    expect(formulas.complete).toBe(true);
    expect(formulas.excluded.map((item) => item.id)).toEqual([
      "calculatePrice",
      "roundMoney",
    ]);

    // Формулы шкафов покрыты отдельно.
    const wardrobe = FORMULA_REGISTRY.filter(
      (item) => item.primary && item.family === "wardrobe",
    );
    expect(wardrobe.length).toBeGreaterThan(0);
    for (const item of wardrobe) {
      const edges = await listDependencies({
        targetType: "calculation",
        targetId: item.id,
      });
      expect(edges.length, item.id).toBeGreaterThan(0);
    }
  });

  it("UNKNOWN и PARTIAL видны отдельно; граф не объявляется полным", async () => {
    seedAll(["plinthHeight"]);
    await imported();
    const coverage = (await diagnoseGraph()).coverage;

    expect(coverage.unknownSources.length).toBe(UNKNOWN_SOURCES.length);
    expect(coverage.partialEdges.length).toBe(
      MAP_ROWS.filter((row) => row.evidence === "PARTIAL").length,
    );
    expect(coverage.partialEdges.length).toBeGreaterThan(0);
    expect(coverage.paramsWithoutDependencies).toEqual(["plinthHeight"]);
    expect(coverage.deadSources.length).toBe(
      MAP_ROWS.filter((row) => row.effect === "none").length,
    );
    // Неподтверждённые потребители: WARDROBE_LIMITS без рёбер (§5 не
    // содержит wardrobe-параметров — ограничение, а не полнота).
    expect(coverage.unconfirmedComponents).toEqual([
      "component:content/catalog.ts:WARDROBE_LIMITS",
    ]);
    expect(coverage.complete).toBe(false);
  });

  it("архивный источник: связи сохраняются, не считаются осиротевшими (§6.8 п.3)", async () => {
    seedAll();
    seedCatalogs({ "countertop:acrylic": "archived" });
    await imported();

    const diagnostic = await diagnoseGraph();
    expect(diagnostic.structural.orphans).toEqual([]);
    expect(diagnostic.structural.archivedSources).toContainEqual({
      sourceType: "catalogItem",
      sourceId: "countertop:acrylic",
    });
    const edges = await listDependencies({ sourceId: "countertop:acrylic" });
    expect(edges.length).toBeGreaterThan(0);
  });

  it("осиротевшие связи (источник и цель) выявляются", async () => {
    seedAll();
    await imported();

    const rows = readJson<Record<string, unknown>[]>(dependenciesPath());
    rows.push({
      id: "dep-ghost-source",
      sourceType: "parameter",
      sourceId: "ghost-param",
      targetType: "calculation",
      targetId: "calculateKitchenPrice",
      effect: "price",
      syncRisk: false,
    });
    rows.push({
      id: "dep-ghost-target",
      sourceType: "parameter",
      sourceId: "sidePanels",
      targetType: "calculation",
      targetId: "ghostFormula",
      effect: "price",
      syncRisk: false,
    });
    writeJson(dependenciesPath(), rows);

    const diagnostic = await diagnoseGraph();
    const reasons = diagnostic.structural.orphans.map((item) => item.reason).join("\n");
    expect(reasons).toContain("ghost-param");
    expect(reasons).toContain("ghostFormula");
    expect(diagnostic.coverage.complete).toBe(false);
  });

  it("невалидная запись: попадает в structural.invalid, не теряется при записи", async () => {
    seedAll();
    await imported();

    const rows = readJson<Record<string, unknown>[]>(dependenciesPath());
    rows.push({
      id: "dep-invalid",
      sourceType: "parameter",
      sourceId: "sidePanels",
      targetType: "calculation",
      targetId: "calculateKitchenPrice",
      effect: "bogus",
      syncRisk: false,
    });
    writeJson(dependenciesPath(), rows);

    const before = await diagnoseGraph();
    expect(before.structural.invalid.length).toBe(1);
    expect((await listDependencies()).length).toBe(MAP_ROWS.length);

    await createDependency(
      validDep({ sourceId: "modules", targetId: "kitchenCountertopWidth" }),
    );
    const after = readFileSync(dependenciesPath(), "utf8");
    expect(after).toContain("dep-invalid");
    expect(after).toContain("bogus");
  });

  it("история изменений: журнал diagnostic.run в рамках контракта аудита", async () => {
    seedAll();
    await imported();
    await diagnoseGraph();

    const events = await listDependencyEvents();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((event) => event.action === "diagnostic.run")).toBe(true);
    expect(events.every((event) => event.entityType === "parameterDependency")).toBe(true);
  });
});
