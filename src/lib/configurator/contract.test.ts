import { describe, expect, it } from "vitest";

import { defaultKitchen } from "./defaults";
import type {
  CalculationInputs,
  CatalogItemInput,
  ModulePresetInput,
  PriceSnapshotInput,
} from "./contract";
import {
  validateCalculationInputs,
  validateCalculationRequest,
  validateCatalogItemInput,
  validateModulePresetInput,
  validatePriceSnapshot,
} from "./contract";

const snapshot: PriceSnapshotInput = {
  priceVersion: "price-2026.11",
  snapshot: [
    { priceItemId: "catalog.body.ldsp.ratePerSqm", amount: 5200 },
    { priceItemId: "catalog.countertop.quartz.ratePerLinearMeter", amount: 29400 },
    { priceItemId: "catalog.plinth.ldsp.ratePerMeter", amount: 1600 },
    { priceItemId: "catalog.support.standard.legPrice", amount: 420 },
    { priceItemId: "catalog.support.standard.clipPrice", amount: 60 },
    { priceItemId: "catalog.support.standard.screwPrice", amount: 9 },
    { priceItemId: "catalog.support.standard.anchorPrice", amount: 350 },
    { priceItemId: "kitchen.module.base.basePrice", amount: 8200 },
  ],
  rules: {
    rounding: 100,
    minOrder: 45000,
    complexityPerExtraModule: 0.02,
    complexityMax: 1.12,
    bodyDepthReference: 60,
    bodyFactor: 1.15,
  },
  signedAdjustments: [
    { key: "plinth:ldsp:pvc2", amount: 0 },
    { key: "plinth:ldsp:pvc04", amount: -120 },
  ],
  promos: [],
  baseSchema: 1,
};

const catalogItems: CatalogItemInput[] = [
  { id: "ldsp", catalog: "bodyMaterial", attrs: {}, priceRefs: { ratePerSqm: "catalog.body.ldsp.ratePerSqm" } },
  { id: "quartz", catalog: "countertop", attrs: { thicknesses: [20, 38], defaultThickness: 38 }, priceRefs: { ratePerLinearMeter: "catalog.countertop.quartz.ratePerLinearMeter" } },
  { id: "ldsp", catalog: "plinthMaterial", attrs: { thicknesses: [16], defaultThickness: 16, finishIds: ["pvc2", "pvc04"] }, priceRefs: { ratePerMeter: "catalog.plinth.ldsp.ratePerMeter" } },
  { id: "standard", catalog: "supportSystem", attrs: { edgeInsetCm: 4, maxSpanCm: 60, maxLoadKgPerLeg: 40, clipsPerLeg: 1, screwsPerLeg: 2, tallAnchorSpacingCm: 120, tallCenterLegWidthCm: 60 }, priceRefs: { legPrice: "catalog.support.standard.legPrice", clipPrice: "catalog.support.standard.clipPrice", screwPrice: "catalog.support.standard.screwPrice", anchorPrice: "catalog.support.standard.anchorPrice" } },
];

const presets: ModulePresetInput[] = [
  {
    id: "base",
    family: "kitchen",
    zone: "floor",
    width: { min: 40, max: 120, default: 60 },
    height: { min: 80, max: 95, default: 90 },
    depth: { min: 50, max: 60, default: 60 },
    defaultShelves: 1,
    defaultDrawers: 0,
    priceRef: "kitchen.module.base.basePrice",
  },
];

const inputs: CalculationInputs = {
  priceSnapshot: snapshot,
  catalogs: catalogItems,
  parameters: {},
  presets,
};

describe("CA-T-302: контракт Engine", () => {
  it("валидный снимок, каталоги и пресеты проходят", () => {
    expect(validatePriceSnapshot(snapshot).ok).toBe(true);
    expect(validateCalculationInputs(inputs).ok).toBe(true);
    expect(validateCatalogItemInput(catalogItems[3]).ok).toBe(true);
    expect(validateModulePresetInput(presets[0]).ok).toBe(true);
  });

  it("request требует config/schemaVersion/inputs", () => {
    const result = validateCalculationRequest({
      config: defaultKitchen(),
      schemaVersion: 1,
      inputs,
    });
    expect(result.ok).toBe(true);
    expect(
      validateCalculationRequest({
        config: defaultKitchen(),
        schemaVersion: 0,
        inputs,
      }).ok,
    ).toBe(false);
    expect(
      validateCalculationRequest({
        config: defaultKitchen(),
        schemaVersion: inputs.priceSnapshot.baseSchema + 1,
        inputs,
      }).ok,
    ).toBe(false);
  });

  it("неизвестное правило и дубликат priceItemId отклоняются", () => {
    expect(
      validatePriceSnapshot({
        ...snapshot,
        rules: { ...snapshot.rules, extra: 1 },
      }).ok,
    ).toBe(false);

    expect(
      validatePriceSnapshot({
        ...snapshot,
        snapshot: [...snapshot.snapshot, snapshot.snapshot[0]],
      }).ok,
    ).toBe(false);
  });

  it("signed delta допускает отрицательное значение и проверяет ключ", () => {
    expect(
      validatePriceSnapshot({
        ...snapshot,
        signedAdjustments: [{ key: "plinth:ldsp:pvc04", amount: -120 }],
      }).ok,
    ).toBe(true);

    expect(
      validatePriceSnapshot({
        ...snapshot,
        signedAdjustments: [{ key: "wrong:key", amount: 1 }],
      }).ok,
    ).toBe(false);
  });

  it("supportSystem требует все четыре роли", () => {
    const invalid = {
      ...catalogItems[3],
      priceRefs: {
        ...catalogItems[3].priceRefs,
        anchorPrice: "",
      },
    };
    expect(validateCatalogItemInput(invalid).ok).toBe(false);
  });

  it("неизвестный priceRef в inputs отклоняется", () => {
    const invalid = {
      ...inputs,
      presets: [{ ...presets[0], priceRef: "missing.price" }],
    };
    expect(validateCalculationInputs(invalid).ok).toBe(false);
  });

  it("sinkSize/promo не входят в Engine input", () => {
    expect(
      validateCatalogItemInput({ id: "x", catalog: "promo", attrs: {}, priceRefs: {} }).ok,
    ).toBe(false);
    expect(
      validateCatalogItemInput({ id: "x", catalog: "sinkSize", attrs: {}, priceRefs: {} }).ok,
    ).toBe(false);
  });

  it("пресет проверяет zone и диапазоны", () => {
    expect(
      validateModulePresetInput({ ...presets[0], zone: "middle" }).ok,
    ).toBe(false);
    expect(
      validateModulePresetInput({
        ...presets[0],
        width: { min: 100, max: 10, default: 50 },
      }).ok,
    ).toBe(false);
  });
});
