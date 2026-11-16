import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectDiagnosticIssues,
  splitParametersByStatus,
  summarizeIssues,
} from "./diagnostics-ui";
import { diagnoseGraph, type CoverageBucket, type GraphDiagnostic } from "./dependencies";
import {
  createParameter,
  listParameters,
  type ActorContext,
} from "./parameters";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-diag-ui-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function bucket(overrides: Partial<CoverageBucket> = {}): CoverageBucket {
  return {
    total: 0,
    confirmed: 0,
    partial: 0,
    unknown: 0,
    notCovered: 0,
    notCoveredIds: [],
    complete: true,
    ...overrides,
  };
}

function emptyGraph(): GraphDiagnostic {
  return {
    generatedAt: "2026-11-09T00:00:00.000Z",
    totals: { rows: 0, valid: 0, sources: 0, targets: 0 },
    structural: {
      invalid: [],
      duplicates: [],
      orphans: [],
      archivedSources: [],
      cycles: [],
    },
    coverage: {
      effects: {
        price: bucket(),
        geometry: bucket(),
        validation: bucket(),
        visualization: bucket(),
      },
      formulas: {
        total: 17,
        evaluable: 15,
        confirmed: 0,
        partial: 0,
        uncovered: [],
        excluded: [],
        complete: true,
      },
      paramsWithoutDependencies: [],
      unknownSources: [],
      partialEdges: [],
      unconfirmedComponents: [],
      deadSources: [],
      complete: true,
    },
  };
}

function input(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    scope: "kitchen",
    category: "technological",
    group: "03",
    valueType: "int",
    value: 1,
    unit: "cm",
    min: 0,
    max: 10,
    sourceRef: `src/content/x.ts:${id}`,
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

describe("представление диагностики (CA-T-506)", () => {
  it("пустой отчёт: проблем нет, статус ok", () => {
    const issues = collectDiagnosticIssues(emptyGraph());
    expect(issues).toEqual([]);
    expect(summarizeIssues(issues)).toEqual({
      errors: 0,
      warnings: 0,
      infos: 0,
      status: "ok",
    });
  });

  it("классификация проблем по полям отчёта: error/warning/info", () => {
    const graph = emptyGraph();
    graph.totals = { rows: 6, valid: 4, sources: 2, targets: 2 };
    graph.structural.invalid = [{ id: "bad", reason: "schema" }];
    graph.structural.duplicates = [
      {
        id: "dup",
        sourceType: "parameter",
        sourceId: "p",
        targetType: "calculation",
        targetId: "f",
        effect: "price",
        syncRisk: false,
      },
    ];
    graph.structural.orphans = [{ id: "orphan", reason: "источник не найден" }];
    graph.structural.archivedSources = [{ sourceType: "parameter", sourceId: "old" }];
    graph.coverage.effects.price = bucket({
      total: 2,
      confirmed: 1,
      notCovered: 1,
      notCoveredIds: ["p2"],
      complete: false,
    });
    graph.coverage.formulas.uncovered = [{ id: "f2", reason: "нет рёбер" }];
    graph.coverage.formulas.excluded = [{ id: "f3", reason: "не проверяется" }];
    graph.coverage.unknownSources = [
      { sourceType: "parameter", sourceId: "unknown", reason: "not confirmed" } as GraphDiagnostic["coverage"]["unknownSources"][number],
    ];
    graph.coverage.partialEdges = [{ sourceId: "p", targetId: "f" }];
    graph.coverage.unconfirmedComponents = ["component:x"];
    graph.coverage.deadSources = [{ sourceType: "parameter", sourceId: "dead" }];
    graph.coverage.paramsWithoutDependencies = ["p9"];

    const issues = collectDiagnosticIssues(graph);
    const summary = summarizeIssues(issues);

    expect(summary.status).toBe("critical");
    expect(summary.errors).toBe(3); // invalid + duplicate + orphan
    expect(summary.warnings).toBeGreaterThanOrEqual(4); // coverage, formula, unknown, dead, params
    expect(issues.map((issue) => issue.title)).toEqual(
      expect.arrayContaining([
        "Невалидная запись связи",
        "Дубль U-ключа",
        "Осиротевшая связь",
        "Покрытие affects.price неполное",
        "Формула без подтверждённых рёбер",
        "UNKNOWN-источник карты",
        "Мёртвый источник (effect=none)",
        "Параметры без зависимостей",
      ]),
    );
    expect(issues.some((issue) => issue.severity === "info")).toBe(true);
  });

  it("отчёт строится из фактических коллекций, статусы параметров разделяются", async () => {
    await createParameter(
      input("p.price", {
        affects: { price: true, geometry: false, visualization: false, validation: false },
      }),
      ACTOR,
    );
    await createParameter(input("p.uncovered"), ACTOR);
    await createParameter(input("p.dead", { status: "dead" }), ACTOR);
    await createParameter(input("p.prelim", { status: "preliminary" }), ACTOR);

    const baseRow = {
      sourceType: "parameter",
      sourceId: "p.price",
      targetType: "calculation",
      targetId: "calculateKitchenPrice",
      effect: "price",
      syncRisk: false,
    };
    writeFileSync(
      path.join(dir, "parameter-dependencies.json"),
      JSON.stringify([
        { id: "dep-1", ...baseRow },
        { id: "dep-2", ...baseRow },
        { id: "bad-row", foo: true },
        {
          id: "orphan",
          ...baseRow,
          sourceId: "missing.param",
        },
      ]),
      "utf8",
    );

    const graph = await diagnoseGraph();
    const issues = collectDiagnosticIssues(graph);

    expect(graph.structural.invalid.length).toBe(1);
    expect(graph.structural.duplicates.length).toBe(2);
    expect(graph.structural.orphans.length).toBe(1);
    expect(graph.coverage.paramsWithoutDependencies).toContain("p.uncovered");

    const titles = issues.map((issue) => issue.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Невалидная запись связи",
        "Дубль U-ключа",
        "Осиротевшая связь",
        "Параметры без зависимостей",
      ]),
    );

    const lists = splitParametersByStatus(await listParameters({}));
    expect(lists.dead.map((item) => item.id)).toEqual(["p.dead"]);
    expect(lists.preliminary.map((item) => item.id)).toEqual(["p.prelim"]);
  });
});
