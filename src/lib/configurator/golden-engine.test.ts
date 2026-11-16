import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import { readDisplayMetadata, seedDisplayMetadata } from "@/lib/admin/display-metadata";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";

import { calculateBreakdown } from "./engine";
import { toPriceBreakdown } from "./display-adapter";
import { GOLDEN_EXPECTED } from "./golden.expected";
import { GOLDEN_SCENARIOS } from "./golden.fixtures";
import { defaultKitchen } from "./defaults";
import type { CalculationBreakdown, CalculationInputs } from "./contract";
import { SINK_RULES } from "./sink";

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-golden-engine-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  await seedRulesSnapshotFixture();
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-2026.11.1",
    pricingLabel: "Golden engine test",
    now: "2026-11-09T00:00:00.000Z",
  });
  await seedDisplayMetadata({
    actorId: "test",
    actorRole: "system",
  });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

async function engineFor(name: string): Promise<CalculationBreakdown> {
  const scenario = GOLDEN_SCENARIOS.find((item) => item.name === name);
  if (!scenario) throw new Error(`scenario ${name}`);
  const resolved = await resolveCalculationInputs({
    operation: "create",
    config: scenario.config,
  });
  if (!resolved.ok) throw new Error(`${name}: ${JSON.stringify(resolved.issues)}`);
  return calculateBreakdown(scenario.config, resolved.value.request.inputs);
}

describe("CA-T-306D Phase 3A: Engine → CalculationBreakdown → Adapter", () => {
  for (const scenario of GOLDEN_SCENARIOS) {
    it(`${scenario.name}: полный PriceBreakdown совпадает с golden`, async () => {
      const metadata = await readDisplayMetadata();
      const breakdown = await engineFor(scenario.name);
      const before = structuredClone(breakdown);
      const adapted = toPriceBreakdown(breakdown, metadata);
      expect(adapted.ok).toBe(true);
      if (!adapted.ok) return;

      expect(adapted.price).toEqual(GOLDEN_EXPECTED[scenario.name]);
      expect(breakdown).toEqual(before);
      expect(adapted.price.total).toBe(GOLDEN_EXPECTED[scenario.name]!.total);
      expect(adapted.price.lines.map((line) => line.label)).toEqual(
        GOLDEN_EXPECTED[scenario.name]!.lines.map((line) => line.label),
      );
    });
  }

  it("CA-T-511: sink shelves не дублируются при наличии sinkStorage", async () => {
    const base = defaultKitchen();
    const sink = base.modules.find((module) => module.type === "sink")!;
    const config = {
      ...base,
      modules: base.modules.map((module) =>
        module.id === sink.id
          ? {
              ...module,
              shelves: 2,
              sinkStorage: [{ shelves: 2, drawers: 0 }],
            }
          : module,
      ),
    };
    const resolved = await resolveCalculationInputs({
      operation: "create",
      config,
    });
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));

    const breakdown = calculateBreakdown(config, resolved.value.request.inputs);
    expect(breakdown.optionsCost).toBe(49821);
    const options = breakdown.lines.find((line) => line.id === "kitchen.options");
    expect(options && "shelves" in options ? options.shelves : undefined).toBe(7);
  });

  it("Engine: SinkRules из inputs, фактический соседний зазор, fail-closed", async () => {
    const scenario = GOLDEN_SCENARIOS.find((item) => item.name === "kitchen-default");
    if (!scenario) throw new Error("scenario kitchen-default");
    const resolved = await resolveCalculationInputs({
      operation: "create",
      config: scenario.config,
    });
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));

    const inputs = resolved.value.request.inputs;
    const baseline = calculateBreakdown(scenario.config, inputs);
    const withParameters = (
      mutate: (parameters: Record<string, unknown>) => void,
    ): CalculationInputs => {
      const clone = structuredClone(inputs) as unknown as {
        parameters: Record<string, unknown>;
      };
      mutate(clone.parameters);
      return clone as unknown as CalculationInputs;
    };

    const edgeChanged = withParameters((parameters) => {
      parameters["engine.sink.facadeEdgeGap"] = 1;
    });
    const edge = calculateBreakdown(scenario.config, edgeChanged);
    expect(edge.frontsCost).not.toBe(baseline.frontsCost);

    const neighborChanged = withParameters((parameters) => {
      parameters["engine.sink.facadeNeighborGap"] = 5;
    });
    // CA-T-517: мойка в ряду использует фактический соседний зазор, поэтому
    // параметр влияет на площадь створок (раньше он был инертен).
    expect(calculateBreakdown(scenario.config, neighborChanged).frontsCost).not.toBe(
      baseline.frontsCost,
    );
    expect(SINK_RULES.facadeNeighborGap).toBe(0.1);

    const missing = withParameters((parameters) => {
      delete parameters["engine.sink.minWidth"];
    });
    expect(() => calculateBreakdown(scenario.config, missing)).toThrow(
      /engine\.sink\.minWidth/,
    );

    const unknown = withParameters((parameters) => {
      parameters["engine.sink.nope"] = 1;
    });
    expect(() => calculateBreakdown(scenario.config, unknown)).toThrow(
      /неизвестный параметр/,
    );

    const invalid = withParameters((parameters) => {
      parameters["engine.sink.sidePanel"] = -1;
    });
    expect(() => calculateBreakdown(scenario.config, invalid)).toThrow(
      /неотрицательное/,
    );
  });

  it("adapter: неизвестный line ID → DISPLAY_LINE_UNKNOWN", async () => {
    const metadata = await readDisplayMetadata();
    const breakdown: CalculationBreakdown = {
      currency: "RUB",
      baseCost: 0,
      bodyCost: 0,
      frontsCost: 0,
      fittingsCost: 0,
      optionsCost: 0,
      complexityFactor: 1,
      subtotal: 0,
      discount: 0,
      total: 0,
      minOrderApplied: false,
      promo: null,
      lines: [{ id: "unknown.line" as never, amount: 0 }],
    };
    const result = toPriceBreakdown(breakdown, metadata);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("DISPLAY_LINE_UNKNOWN");
    }
  });

  it("adapter: PSU psuCount > 1 сохраняет исторический дублирующий detail", async () => {
    const metadata = await readDisplayMetadata();
    const breakdown: CalculationBreakdown = {
      currency: "RUB",
      baseCost: 0,
      bodyCost: 0,
      frontsCost: 0,
      fittingsCost: 0,
      optionsCost: 0,
      complexityFactor: 1,
      subtotal: 0,
      discount: 0,
      total: 0,
      minOrderApplied: false,
      promo: null,
      lines: [
        { id: "kitchen.lighting.psu", amount: 300, psuW: 150, psuCount: 2 },
      ],
    };
    const result = toPriceBreakdown(breakdown, metadata);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.price.lines[0]?.detail).toBe("2 шт. · 150 Вт · 2 шт.");
  });

  it("adapter: kitchen.pushToOpen и wardrobe.minOrder поддержаны", async () => {
    const metadata = await readDisplayMetadata();
    const breakdown: CalculationBreakdown = {
      currency: "RUB",
      baseCost: 0,
      bodyCost: 0,
      frontsCost: 0,
      fittingsCost: 0,
      optionsCost: 0,
      complexityFactor: 1,
      subtotal: 0,
      discount: 0,
      total: 0,
      minOrderApplied: true,
      promo: null,
      lines: [
        { id: "kitchen.pushToOpen", amount: 0 },
        { id: "wardrobe.minOrder", amount: 0 },
      ],
    };
    const result = toPriceBreakdown(breakdown, metadata);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.price.lines.map((line) => line.label)).toEqual([
      "Push-to-open",
      "Минимальная стоимость заказа",
    ]);
  });

  it("adapter: cm-to-m только для wardrobe.plinth.widthCm", async () => {
    const metadata = await readDisplayMetadata();
    const breakdown: CalculationBreakdown = {
      currency: "RUB",
      baseCost: 0,
      bodyCost: 0,
      frontsCost: 0,
      fittingsCost: 0,
      optionsCost: 0,
      complexityFactor: 1,
      subtotal: 0,
      discount: 0,
      total: 0,
      minOrderApplied: false,
      promo: null,
      lines: [{ id: "wardrobe.plinth", amount: 0, widthCm: 240 }],
    };
    const result = toPriceBreakdown(breakdown, metadata);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.price.lines[0]?.detail).toBe("2.4 м учтено в опциях");
  });
});

describe("NEW-N1: расчётные нормы из rulesSnapshot", () => {
  async function wardrobeBase() {
    const scenario = GOLDEN_SCENARIOS.find((item) => item.name === "wardrobe-default");
    if (!scenario) throw new Error("scenario wardrobe-default");
    const resolved = await resolveCalculationInputs({
      operation: "create",
      config: scenario.config,
    });
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
    return { config: scenario.config, inputs: resolved.value.request.inputs };
  }

  it("fail-closed: отсутствие rulesSnapshot → Engine отклоняет расчёт", async () => {
    const { config, inputs } = await wardrobeBase();
    const withoutRules = { ...inputs, rulesSnapshot: undefined } as CalculationInputs;
    expect(() => calculateBreakdown(config, withoutRules)).toThrow(/rulesSnapshot/);
  });

  it("изменение норм в snapshot меняет результат (count-правила)", async () => {
    const { config, inputs } = await wardrobeBase();
    const baseline = calculateBreakdown(config, inputs);

    const changed = structuredClone(inputs) as CalculationInputs;
    if (!changed.rulesSnapshot) throw new Error("rulesSnapshot отсутствует");
    changed.rulesSnapshot = {
      rulesSnapshotId: changed.rulesSnapshot.rulesSnapshotId,
      rules: changed.rulesSnapshot.rules.map((rule) =>
        rule.id.endsWith("-count")
          ? { ...rule, value: Number(rule.value) + 1 }
          : rule,
      ),
    };
    const modified = calculateBreakdown(config, changed);

    expect(modified.total).not.toBe(baseline.total);
    const baselineFittings = baseline.lines.find((line) => line.id === "wardrobe.fittings");
    const modifiedFittings = modified.lines.find((line) => line.id === "wardrobe.fittings");
    expect(modifiedFittings?.amount ?? 0).toBeGreaterThan(baselineFittings?.amount ?? 0);
  });
});
