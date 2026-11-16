import { describe, expect, it } from "vitest";

import type {
  CompositionLine,
  CompositionVersion,
} from "@/lib/admin/composition-schema";
import type {
  CalculationBreakdown,
  PriceSnapshotInput,
  RulesSnapshotInput,
} from "@/lib/configurator/contract";
import { defaultKitchen } from "@/lib/configurator/defaults";

import { resolveCompositionTrace } from "./composition-resolver";
import type { CompositionPreflight } from "./data-resolver";

const NOW = "2026-11-16T00:00:00.000Z";
const HASH = "a".repeat(64);

const config = defaultKitchen();
const moduleType =
  config.kind === "kitchen" ? config.modules[0].type : ("base" as const);

function makeLine(overrides: Partial<CompositionLine> = {}): CompositionLine {
  return {
    id: `line-${Math.random().toString(36).slice(2, 8)}`,
    moduleType,
    relation: "required",
    quantityRef: { kind: "fixed", value: 1, unit: "pcs" },
    sourceRef: "test",
    source: "datasheet",
    sortOrder: 1,
    ...overrides,
  } as CompositionLine;
}

function makeVersion(
  lines: CompositionLine[],
  priceVersionId: string | null = "price.engine.1",
): CompositionVersion {
  return {
    id: "comp-1",
    schemaVersion: 1,
    status: "published",
    version: 1,
    lines,
    contentHash: HASH,
    createdAt: NOW,
    createdBy: "test",
    updatedAt: NOW,
    updatedBy: "test",
    publishedAt: NOW,
    publishedBy: "test",
    publishedSeq: 1,
    ...(priceVersionId === null
      ? {}
      : { pins: { priceVersionId } }),
  };
}

function makePreflight(
  lines: CompositionLine[],
  options: {
    priceVersionId?: string | null;
    warnings?: CompositionPreflight["warnings"];
  } = {},
): CompositionPreflight {
  return {
    compositionVersionId: "comp-1",
    composition: makeVersion(lines, options.priceVersionId),
    warnings: options.warnings ?? [],
  };
}

function makePriceSnapshot(): PriceSnapshotInput {
  return {
    priceVersion: "price.engine.1",
    snapshot: [
      { priceItemId: "p.pcs", amount: 100 },
      { priceItemId: "p.linm", amount: 50 },
      { priceItemId: "p.sqm", amount: 30 },
      { priceItemId: "p.perM", amount: 70 },
      { priceItemId: "p.rub", amount: 1000 },
      { priceItemId: "p.factor", amount: 1.2 },
      { priceItemId: "p.onlySnapshot", amount: 42 },
    ],
    rules: {
      rounding: 1,
      minOrder: 0,
      complexityPerExtraModule: 0,
      complexityMax: 1,
      bodyDepthReference: 60,
      bodyFactor: 1,
    },
    signedAdjustments: [],
    promos: [],
    baseSchema: 1,
  };
}

const priceItems = [
  { id: "p.pcs", unit: "RUB_PER_PCS" as const },
  { id: "p.linm", unit: "RUB_PER_LINM" as const },
  { id: "p.sqm", unit: "RUB_PER_SQM" as const },
  { id: "p.perM", unit: "RUB_PER_M" as const },
  { id: "p.rub", unit: "RUB" as const },
  { id: "p.factor", unit: "FACTOR" as const },
];

function makeRulesSnapshot(): RulesSnapshotInput {
  return { rulesSnapshotId: "rules.1", rules: [] };
}

function makeBreakdown(total = 1000): CalculationBreakdown {
  return {
    currency: "RUB",
    baseCost: 0,
    bodyCost: 0,
    frontsCost: 0,
    fittingsCost: 0,
    optionsCost: 0,
    complexityFactor: 1,
    subtotal: total,
    discount: 0,
    total,
    minOrderApplied: false,
    lines: [],
    promo: null,
  };
}

function traceOf(lines: CompositionLine[], extra: Record<string, unknown> = {}) {
  return resolveCompositionTrace({
    config,
    compositionPreflight: makePreflight(lines),
    priceSnapshot: makePriceSnapshot(),
    breakdown: makeBreakdown(),
    priceItems,
    ...extra,
  });
}

describe("resolveCompositionTrace (E1)", () => {
  it("legacy без composition-pin: trace не создаётся и не блокируется (В-1)", () => {
    const result = resolveCompositionTrace({
      config,
      priceSnapshot: makePriceSnapshot(),
      breakdown: makeBreakdown(),
    });
    expect(result.trace).toBeNull();
    expect(result.blocked).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it("fixed quantity + все разрешённые комбинации единиц дают priceAmount", () => {
    const result = traceOf([
      makeLine({
        id: "l-pcs",
        relation: "required",
        quantityRef: { kind: "fixed", value: 4, unit: "pcs" },
        priceItemId: "p.pcs",
        sortOrder: 1,
      }),
      makeLine({
        id: "l-m",
        relation: "required",
        quantityRef: { kind: "fixed", value: 2.5, unit: "m" },
        priceItemId: "p.linm",
        sortOrder: 2,
      }),
      makeLine({
        id: "l-m2",
        relation: "required",
        quantityRef: { kind: "fixed", value: 12, unit: "m2" },
        priceItemId: "p.sqm",
        sortOrder: 3,
      }),
    ]);
    expect(result.blocked).toBe(false);
    expect(result.trace).not.toBeNull();
    const byId = new Map(result.trace!.lines.map((l) => [l.lineId, l]));
    expect(byId.get("l-pcs")).toMatchObject({
      quantity: 4,
      unit: "pcs",
      amount: 100,
      priceItemUnit: "RUB_PER_PCS",
      priceAmount: 400,
      status: "resolved",
    });
    expect(byId.get("l-m")).toMatchObject({
      quantity: 2.5,
      priceAmount: 125,
      status: "resolved",
    });
    expect(byId.get("l-m2")).toMatchObject({
      quantity: 12,
      priceAmount: 360,
      status: "resolved",
    });
  });

  it("запрещённые комбинации единиц не умножаются и не заменяются нулём", () => {
    const result = traceOf([
      makeLine({
        id: "f-perM",
        relation: "optional",
        quantityRef: { kind: "fixed", value: 3, unit: "m" },
        priceItemId: "p.perM",
        sortOrder: 1,
      }),
      makeLine({
        id: "f-rub",
        relation: "optional",
        quantityRef: { kind: "fixed", value: 3, unit: "pcs" },
        priceItemId: "p.rub",
        sortOrder: 2,
      }),
      makeLine({
        id: "f-factor",
        relation: "optional",
        quantityRef: { kind: "fixed", value: 3, unit: "m2" },
        priceItemId: "p.factor",
        sortOrder: 3,
      }),
      makeLine({
        id: "f-cm",
        relation: "optional",
        quantityRef: { kind: "fixed", value: 30, unit: "cm" },
        priceItemId: "p.pcs",
        sortOrder: 4,
      }),
      makeLine({
        id: "f-kg",
        relation: "optional",
        quantityRef: { kind: "fixed", value: 3, unit: "kg" },
        priceItemId: "p.pcs",
        sortOrder: 5,
      }),
      makeLine({
        id: "f-unknown-unit",
        relation: "optional",
        quantityRef: { kind: "fixed", value: 3, unit: "pcs" },
        priceItemId: "p.onlySnapshot",
        sortOrder: 6,
      }),
    ]);
    expect(result.blocked).toBe(false);
    expect(result.trace).not.toBeNull();
    for (const line of result.trace!.lines) {
      expect(line.priceAmount).toBeNull();
      expect(line.status).toBe("price_unresolved");
      expect(line.amount === 0).toBe(false);
    }
    expect(new Set(result.trace!.warnings.map((w) => w.code))).toEqual(
      new Set(["TRACE_UNIT_INCOMPATIBLE", "TRACE_PRICE_UNIT_UNKNOWN"]),
    );
  });

  it("отсутствие тарифа в snapshot → amount = null, никогда 0", () => {
    const result = traceOf([
      makeLine({
        id: "no-tariff",
        relation: "optional",
        quantityRef: { kind: "fixed", value: 2, unit: "pcs" },
        priceItemId: "p.missing",
        sortOrder: 1,
      }),
    ]);
    expect(result.blocked).toBe(false);
    const line = result.trace!.lines[0];
    expect(line.amount).toBeNull();
    expect(line.priceAmount).toBeNull();
    expect(line.status).toBe("price_unresolved");
    expect(result.issues.map((i) => i.code)).toContain(
      "TRACE_PRICE_UNRESOLVED",
    );
  });

  it("исполняется только fixed; code/managed_rule → quantity_unresolved, не 0", () => {
    const result = traceOf([
      makeLine({
        id: "opt-code",
        relation: "optional",
        quantityRef: { kind: "code", implementationId: "x" },
        sortOrder: 1,
      }),
      makeLine({
        id: "opt-rule",
        relation: "optional",
        quantityRef: { kind: "managed_rule", ruleId: "r" },
        sortOrder: 2,
      }),
    ]);
    expect(result.blocked).toBe(false);
    for (const line of result.trace!.lines) {
      expect(line.quantity).toBeNull();
      expect(line.unit).toBeNull();
      expect(line.quantitySource).toBe("unresolved");
      expect(line.status).toBe("quantity_unresolved");
      expect(line.quantity).not.toBe(0);
    }
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "TRACE_QUANTITY_UNRESOLVED",
        "TRACE_QUANTITY_UNRESOLVED",
      ]),
    );
  });

  it("обязательная строка с неисполняемым quantityRef блокирует trace", () => {
    const result = traceOf([
      makeLine({
        id: "req-code",
        relation: "required",
        quantityRef: { kind: "code", implementationId: "x" },
        sortOrder: 1,
      }),
    ]);
    expect(result.blocked).toBe(true);
    expect(result.trace).toBeNull();
    expect(result.issues[0].code).toBe("TRACE_QUANTITY_UNRESOLVED");
    expect(result.issues[0].severity).toBe("error");
  });

  it("fixed вне правил публикации (0 / unit=none) не подставляется", () => {
    const zero = traceOf([
      makeLine({
        id: "zero",
        relation: "optional",
        quantityRef: { kind: "fixed", value: 0, unit: "pcs" },
        sortOrder: 1,
      }),
    ]);
    expect(zero.blocked).toBe(false);
    expect(zero.trace!.lines[0].quantity).toBeNull();
    expect(zero.trace!.lines[0].status).toBe("quantity_unresolved");

    const none = traceOf([
      makeLine({
        id: "none",
        relation: "required",
        quantityRef: { kind: "fixed", value: 5, unit: "none" },
        sortOrder: 1,
      }),
    ]);
    expect(none.blocked).toBe(true);
    expect(none.trace).toBeNull();
    expect(none.issues[0].code).toBe("TRACE_QUANTITY_INVALID");
  });

  it("text/code/managed_rule условия fail-closed (§A-05)", () => {
    const requiredText = traceOf([
      makeLine({
        id: "req-text",
        relation: "required",
        condition: { kind: "text", text: "если нужно" },
        sortOrder: 1,
      }),
    ]);
    expect(requiredText.blocked).toBe(true);
    expect(requiredText.issues[0].code).toBe("TRACE_CONDITION_NOT_EXECUTABLE");

    const conditionalCode = traceOf([
      makeLine({
        id: "cond-code",
        relation: "conditional",
        condition: { kind: "code", implementationId: "x" },
        sortOrder: 1,
      }),
    ]);
    expect(conditionalCode.blocked).toBe(true);
    expect(conditionalCode.trace).toBeNull();

    const conditionalRule = traceOf([
      makeLine({
        id: "cond-rule",
        relation: "conditional",
        condition: { kind: "managed_rule", ruleId: "r" },
        sortOrder: 1,
      }),
    ]);
    expect(conditionalRule.blocked).toBe(true);

    const optionalText = traceOf([
      makeLine({
        id: "opt-text",
        relation: "optional",
        condition: { kind: "text", text: "если нужно" },
        sortOrder: 1,
      }),
    ]);
    expect(optionalText.blocked).toBe(false);
    const line = optionalText.trace!.lines[0];
    /* Не превращается в unconditional (инвариант 8). */
    expect(line.status).toBe("excluded");
    expect(line.condition).toBe("not_evaluated");
    expect(line.quantity).toBeNull();
    expect(optionalText.issues[0].severity).toBe("warning");
    expect(optionalText.issues[0].code).toBe("TRACE_CONDITION_NOT_EXECUTABLE");
  });

  it("AlternativeGroup: без выбора первой строки и без суммирования", () => {
    const alternatives: CompositionLine[] = [
      makeLine({
        id: "alt-a",
        relation: "alternative",
        alternativeGroup: "grp",
        sortOrder: 1,
      }),
      makeLine({
        id: "alt-b",
        relation: "alternative",
        alternativeGroup: "grp",
        sortOrder: 2,
      }),
    ];
    const result = traceOf(alternatives);
    expect(result.blocked).toBe(true);
    expect(result.trace).toBeNull();
    expect(result.issues[0].code).toBe("TRACE_ALTERNATIVE_AMBIGUOUS");

    const conditioned = traceOf([
      makeLine({
        id: "alt-c",
        relation: "alternative",
        alternativeGroup: "grp",
        condition: { kind: "text", text: "вариант 1" },
        sortOrder: 1,
      }),
      makeLine({
        id: "alt-d",
        relation: "alternative",
        alternativeGroup: "grp",
        condition: { kind: "text", text: "вариант 2" },
        sortOrder: 2,
      }),
    ]);
    expect(conditioned.blocked).toBe(true);
    expect(conditioned.trace).toBeNull();

    const single = traceOf([
      makeLine({
        id: "alt-solo",
        relation: "alternative",
        alternativeGroup: "grp",
        sortOrder: 1,
      }),
    ]);
    expect(single.blocked).toBe(true);
    expect(single.issues[0].code).toBe("TRACE_ALTERNATIVE_INVALID");
  });

  it("trace фиксирует идентификаторы контекста (R-05)", () => {
    const result = traceOf(
      [
        makeLine({
          id: "ctx",
          relation: "required",
          quantityRef: { kind: "fixed", value: 1, unit: "pcs" },
          priceItemId: "p.pcs",
          sortOrder: 1,
        }),
      ],
      { rulesSnapshot: makeRulesSnapshot() },
    );
    expect(result.trace).toMatchObject({
      traceVersion: 1,
      compositionVersionId: "comp-1",
      compositionContentHash: HASH,
      compositionRulesSnapshotId: null,
      rulesSnapshotId: "rules.1",
      enginePriceVersionId: "price.engine.1",
      enginePriceBaseSchema: 1,
      pinnedPriceVersionId: "price.engine.1",
    });
    /* Итог стоимости trace не подменяет Engine (В-2). */
    expect(result.trace).not.toHaveProperty("total");
  });

  it("некорректный breakdown блокирует trace (целостность)", () => {
    const result = resolveCompositionTrace({
      config,
      compositionPreflight: makePreflight([
        makeLine({ id: "x", sortOrder: 1 }),
      ]),
      priceSnapshot: makePriceSnapshot(),
      breakdown: makeBreakdown(Number.NaN),
      priceItems,
    });
    expect(result.blocked).toBe(true);
    expect(result.trace).toBeNull();
    expect(result.issues[0].code).toBe("TRACE_ENGINE_BREAKDOWN_INVALID");
  });
});

describe("диагностика версий тарифа (warning, не block)", () => {
  function run(options: {
    priceVersionId?: string | null;
    warnings?: CompositionPreflight["warnings"];
  }) {
    const lines = [
      makeLine({
        id: "pv-line",
        relation: "required",
        quantityRef: { kind: "fixed", value: 1, unit: "pcs" },
        priceItemId: "p.pcs",
        sortOrder: 1,
      }),
    ];
    return resolveCompositionTrace({
      config,
      compositionPreflight: makePreflight(lines, options),
      priceSnapshot: makePriceSnapshot(),
      breakdown: makeBreakdown(),
      priceItems,
    });
  }

  it("Composition без pins.priceVersionId → PRICE_VERSION_PIN_MISSING", () => {
    const result = run({ priceVersionId: null });
    expect(result.blocked).toBe(false);
    expect(result.trace).not.toBeNull();
    expect(result.trace?.pinnedPriceVersionId).toBeNull();
    const codes = result.trace!.warnings.map((item) => item.code);
    expect(codes).toContain("PRICE_VERSION_PIN_MISSING");
    expect(codes).not.toContain("PRICE_VERSION_DRIFT");
    expect(
      result.trace!.warnings.find(
        (item) => item.code === "PRICE_VERSION_PIN_MISSING",
      )?.severity,
    ).toBe("warning");
  });

  it("одинаковые версии → drift warning отсутствует", () => {
    const result = run({ priceVersionId: "price.engine.1" });
    expect(result.trace).not.toBeNull();
    const codes = result.trace!.warnings.map((item) => item.code);
    expect(codes).not.toContain("PRICE_VERSION_DRIFT");
    expect(codes).not.toContain("PRICE_VERSION_PIN_MISSING");
  });

  it("разные версии → PRICE_VERSION_DRIFT с обеими версиями", () => {
    const result = run({ priceVersionId: "price.pinned.other" });
    expect(result.blocked).toBe(false);
    const drift = result.trace!.warnings.find(
      (item) => item.code === "PRICE_VERSION_DRIFT",
    );
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe("warning");
    expect(drift?.message).toContain("price.pinned.other");
    expect(drift?.message).toContain("price.engine.1");
  });

  it("preflight warnings (drift pins) доходят до trace без потери кода", () => {
    const result = run({
      priceVersionId: "price.engine.1",
      warnings: [
        {
          code: "COMPOSITION_CATALOG_VERSION_DRIFT",
          path: "inputs.composition.catalog",
          message: 'CatalogItem "bodyMaterial:ldsp" изменился после публикации.',
          entityId: "ldsp",
        },
      ],
    });
    const propagated = result.trace!.warnings.find(
      (item) => item.code === "COMPOSITION_CATALOG_VERSION_DRIFT",
    );
    expect(propagated).toBeDefined();
    expect(propagated?.severity).toBe("warning");
    expect(propagated?.entityId).toBe("ldsp");
  });

  it("диагностики не блокируют trace и не меняют строки/цену", () => {
    const missing = run({ priceVersionId: null });
    const drift = run({ priceVersionId: "price.other" });
    expect(missing.blocked).toBe(false);
    expect(drift.blocked).toBe(false);
    expect(missing.trace!.lines).toEqual(drift.trace!.lines);
    expect(missing.trace!.lines[0]).toMatchObject({
      status: "resolved",
      quantity: 1,
      priceAmount: 100,
    });
    /* Trace не содержит собственного итога и не подменяет Engine. */
    expect(missing.trace).not.toHaveProperty("total");
  });
});
