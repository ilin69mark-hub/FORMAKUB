import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultKitchen } from "@/lib/configurator/defaults";
import type {
  PriceBreakdown,
  ProjectPriceHistory,
  StoredProject,
} from "@/lib/configurator/types";
import { dataFilePath } from "@/lib/server/store";

import { getInspectorProject, listInspectorProjects } from "./calculation-inspector";

let dir = "";

function breakdown(overrides: Partial<PriceBreakdown> = {}): PriceBreakdown {
  return {
    currency: "RUB",
    baseCost: 12000,
    bodyCost: 50000,
    frontsCost: 30000,
    fittingsCost: 10000,
    optionsCost: 40000,
    complexityFactor: 1,
    subtotal: 142000,
    discount: 0,
    total: 142000,
    minOrderApplied: false,
    lines: [{ label: "Корпус", amount: 50000, detail: "2 модул." }],
    promo: null,
    disclaimer: "test",
    ...overrides,
  };
}

function project(id: string, extra: Partial<StoredProject> = {}): StoredProject {
  const config = defaultKitchen();
  return {
    id,
    config,
    schemaVersion: 2,
    calcVersion: "calc-2026.11.2",
    priceVersion: "price-2026.11.1",
    price: breakdown(),
    createdAt: "2026-11-13T00:00:00.000Z",
    updatedAt: "2026-11-13T00:00:00.000Z",
    ...extra,
  };
}

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-inspector-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  delete process.env.FORMAKUB_STORAGE;
  const legacy = project("p-legacy");
  const traced = project("p-traced", {
    priceHistory: [
      {
        id: "h1",
        projectId: "p-traced",
        operationId: "op1",
        reason: "create",
        fromPriceVersionId: null,
        toPriceVersionId: "price-2026.11.1",
        schemaVersion: 2,
        calcVersion: "calc-2026.11.2",
        oldPrice: null,
        newPrice: 142000,
        delta: null,
        breakdown: {
          currency: "RUB",
          baseCost: 12000,
          bodyCost: 50000,
          frontsCost: 30000,
          fittingsCost: 10000,
          optionsCost: 40000,
          complexityFactor: 1,
          subtotal: 142000,
          discount: 0,
          total: 142000,
          minOrderApplied: false,
          lines: [
            { label: "Корпус", amount: 50000, detail: "2 модул. · ЛДСП" },
            { label: "Фасады", amount: 30000, detail: "3 фасад. · 0 ящ." },
          ],
          promo: null,
          disclaimer: "test",
        },
        breakdownVersion: 1,
        requestFingerprint: "fp",
        requestFingerprintVersion: "1",
        computedAt: "2026-11-13T00:00:00.000Z",
      } satisfies ProjectPriceHistory,
    ],
  });
  writeFileSync(
    dataFilePath("projects.json"),
    JSON.stringify([legacy, traced], null, 2),
  );
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("Calculation Inspector", () => {
  it("список показывает сохранённые проекты и legacy-диагностику без выдуманных значений", async () => {
    const { projects, issues } = await listInspectorProjects();
    expect(issues).toEqual([]);
    expect(projects).toHaveLength(2);
    const legacy = projects.find((item) => item.id === "p-legacy");
    expect(legacy?.diagnosticsStatus).toBe("legacy_no_snapshot");
    expect(legacy?.rulesSnapshotId).toBeNull();
  });

  it("legacy без priceHistory: строки без id, трассировка помечена как отсутствующая", async () => {
    const result = await getInspectorProject("p-legacy");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lines).toHaveLength(1);
    expect(result.data.lines[0].id).toBeNull();
    expect(result.data.lines[0].traceable).toBe(false);
    expect(result.data.lines[0].traceGap).toContain("нет priceHistory");
    expect(result.data.traceability.componentQuantity).toBe(false);
    expect(result.data.traceability.componentPrice).toBe(false);
    expect(result.data.rules?.status).toBe("legacy_no_snapshot");
    expect(result.data.issues.join(" ")).toContain("rulesSnapshotId");
  });

  it("priceHistory даёт сохранённые строки, но без id/цены компонента", async () => {
    const result = await getInspectorProject("p-traced");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lines.map((line) => line.id)).toEqual([null, null]);
    expect(result.data.lines[0].label).toBe("Корпус");
    expect(result.data.lines[0].detail).toContain("ЛДСП");
    expect(result.data.lines[0].traceable).toBe(false);
    expect(result.data.lines[0].traceGap).toContain("не содержит id строки");
    expect(result.data.latestHistory?.operationId).toBe("op1");
    expect(result.data.traceability.appliedRulePerLine).toBe(false);
    expect(result.data.modules.length).toBeGreaterThan(0);
    expect(result.data.modules[0].compositionHref).toBe(
      `/admin/modules/${result.data.modules[0].type}`,
    );
  });

  it("неизвестный проект не маскируется пустым расчётом", async () => {
    const result = await getInspectorProject("missing");
    expect(result).toEqual({ ok: false, reason: "Проект не найден." });
  });
});
