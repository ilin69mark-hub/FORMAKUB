import { describe, expect, it } from "vitest";

import { buildBootstrapPlan } from "./bootstrap";
import { buildDataSources } from "./data-sources";
import { buildAdminParameterSeeds } from "./parameter-seed";

describe("Data Sources: происхождение значений", () => {
  const plan = buildBootstrapPlan("2026-11-13T00:00:00.000Z");
  const parameters = buildAdminParameterSeeds({ now: "2026-11-13T00:00:00.000Z" });
  const catalogItems = plan.catalogItems.slice(0, 3);
  const priceItems = plan.priceItems.slice(0, 5);

  it("не выдумывает источник CatalogItem и помечает его missing", () => {
    const board = buildDataSources({
      parameters: [],
      catalogItems,
      priceItems,
      rules: [],
      projects: [],
    });
    const rows = board.rows.filter(
      (row) => row.kind === "catalogItem" && row.state !== "conflict",
    );
    expect(rows.length).toBe(catalogItems.length);
    expect(rows.every((row) => row.sourceRef === null)).toBe(true);
    expect(rows.every((row) => row.state === "missing")).toBe(true);
  });

  it("сохраняет sourceRef параметров и PriceItem без подстановки", () => {
    const board = buildDataSources({
      parameters,
      catalogItems: [],
      priceItems,
      rules: [],
      projects: [],
    });
    const parameterRows = board.rows.filter((row) => row.kind === "parameter");
    expect(parameterRows.length).toBe(parameters.length);
    expect(parameterRows.every((row) => row.sourceRef === parameters.find((p) => p.id === row.entityId)?.sourceRef)).toBe(true);
    const priceRows = board.rows.filter((row) => row.kind === "priceItem");
    expect(priceRows.every((row) => row.sourceRef !== null)).toBe(true);
  });

  it("отсутствующий тариф каталога — conflict, а не нулевая цена", () => {
    const board = buildDataSources({
      parameters: [],
      catalogItems,
      priceItems: [],
      rules: [],
      projects: [],
    });
    expect(board.counts.conflict).toBeGreaterThan(0);
    expect(board.issues.length).toBeGreaterThan(0);
    expect(
      board.rows.some((row) => row.state === "conflict" && row.note.includes("отсутствует")),
    ).toBe(true);
  });

  it("закрепление проекта за отсутствующей версией — missing", () => {
    const board = buildDataSources({
      parameters: [],
      catalogItems: [],
      priceItems: [],
      rules: [],
      projects: [
        {
          id: "p1",
          config: { kind: "kitchen", modules: [] } as never,
          price: { total: 0 } as never,
          createdAt: "2026-11-13T00:00:00.000Z",
          updatedAt: "2026-11-13T00:00:00.000Z",
        },
      ],
    });
    const row = board.rows.find((item) => item.kind === "projectPin");
    expect(row?.state).toBe("missing");
  });
});
