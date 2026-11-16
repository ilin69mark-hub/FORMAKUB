import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  adminParameterSchema,
  catalogItemSchema,
  catalogKindSchema,
  findDuplicates,
  modulePresetSchema,
  parameterDependencySchema,
  priceItemSchema,
  pricingChangeSchema,
  pricingSnapshotItemSchema,
  pricingVersionSchema,
  promoDefinitionSchema,
} from "./schema";
import { readCollection, updateCollection } from "@/lib/server/store";

const NOW = "2026-11-07T12:00:00.000Z";

function catalogItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "compact_hpl",
    catalog: "bodyMaterial",
    label: "Компакт HPL",
    attrs: { rate: 1.2, thicknesses: [16, 18] },
    priceRefs: ["catalog.body.compact.rate"],
    status: "active",
    sortOrder: 10,
    version: "v1",
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: "calc-admin",
    ...overrides,
  };
}

function priceItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "kitchen.hingePerDoor",
    scope: "kitchen",
    label: "Петля за дверцу",
    unit: "RUB_PER_PCS",
    usage: "used",
    status: "active",
    editable: true,
    sourceRef: "src/content/pricing.ts:PRICING.kitchen.hingePerDoor",
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: "calc-admin",
    ...overrides,
  };
}

function pricingVersion(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "price-2026.11.1",
    label: "demo-2026-11",
    status: "draft",
    snapshot: [{ priceItemId: "kitchen.hingePerDoor", amount: 390 }],
    rules: { rounding: 100, minOrder: 45000 },
    promos: [],
    baseSchema: 1,
    createdAt: NOW,
    createdBy: "calc-admin",
    ...overrides,
  };
}

function dependency(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "dep-1",
    sourceType: "parameter",
    sourceId: "kitchen.limit.maxModules",
    targetType: "calculation",
    targetId: "calculateKitchenPrice",
    effect: "price",
    syncRisk: false,
    ...overrides,
  };
}

describe("catalogItemSchema (CA-T-201)", () => {
  it("валидная запись принимается", () => {
    expect(catalogItemSchema.safeParse(catalogItem()).success).toBe(true);
  });

  it("все виды справочников из ТЗ §3.2 принимаются", () => {
    const supportAttrs = {
      edgeInsetCm: 4,
      maxSpanCm: 60,
      maxLoadKgPerLeg: 40,
      clipsPerLeg: 1,
      screwsPerLeg: 2,
      tallAnchorSpacingCm: 120,
      tallCenterLegWidthCm: 60,
      source: "preliminary",
    };
    const stripAttrs = {
      power: 9.6,
      voltage: 24,
      maxContinuousRunM: 10,
      voltageDropPct: 5,
      maxPsuW: 100,
      source: "preliminary",
    };
    for (const kind of catalogKindSchema.options) {
      const attrs =
        kind === "supportSystem"
          ? supportAttrs
          : kind === "ledStrip"
            ? stripAttrs
            : { rate: 1.2, thicknesses: [16, 18] };
      const parsed = catalogItemSchema.safeParse(
        catalogItem({ catalog: kind, attrs }),
      );
      expect(parsed.success, `catalog=${kind}`).toBe(true);
    }
    expect(catalogKindSchema.options).toHaveLength(16);
    expect(catalogKindSchema.safeParse("psu").success).toBe(false); // X: psu → ledPsu
  });

  it("граничные случаи: sortOrder дробный/пустой id/битый timestamp", () => {
    expect(
      catalogItemSchema.safeParse(catalogItem({ sortOrder: 1.5 })).success,
    ).toBe(false);
    expect(catalogItemSchema.safeParse(catalogItem({ id: "" })).success).toBe(
      false,
    );
    expect(
      catalogItemSchema.safeParse(catalogItem({ updatedAt: "07.11.2026" }))
        .success,
    ).toBe(false);
    expect(
      catalogItemSchema.safeParse(catalogItem({ sortOrder: 0 })).success,
    ).toBe(true);
  });

  it("неизвестное поле отклоняется (strict, без нормализации)", () => {
    const parsed = catalogItemSchema.safeParse(
      catalogItem({ unknownField: 1 }),
    );
    expect(parsed.success).toBe(false);
    expect(catalogItem().attrs).toEqual({ rate: 1.2, thicknesses: [16, 18] });
  });

  it("отсутствие обязательного поля отклоняется", () => {
    const record = catalogItem();
    delete (record as Record<string, unknown>).version;
    expect(catalogItemSchema.safeParse(record).success).toBe(false);
  });
});

describe("priceItemSchema (CA-T-201)", () => {
  it("валидные комбинации status/usage принимаются (§6.4)", () => {
    expect(
      priceItemSchema.safeParse(
        priceItem({ status: "active", usage: "used" }),
      ).success,
    ).toBe(true);
    expect(
      priceItemSchema.safeParse(
        priceItem({ status: "active", usage: "unused" }),
      ).success,
    ).toBe(true);
    expect(
      priceItemSchema.safeParse(
        priceItem({ status: "archived", usage: "unused" }),
      ).success,
    ).toBe(true);
  });

  it("archived+used отклоняется (целостность §6.4)", () => {
    const parsed = priceItemSchema.safeParse(
      priceItem({ status: "archived", usage: "used" }),
    );
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed)).toMatch(/archived\+used/);
  });

  it("unit — только перечисленные значения (ТЗ §3.2)", () => {
    expect(priceItemSchema.safeParse(priceItem({ unit: "RUB" })).success).toBe(
      true,
    );
    expect(priceItemSchema.safeParse(priceItem({ unit: "EUR" })).success).toBe(
      false,
    );
  });

  it("неизвестное поле и отсутствие status отклоняются", () => {
    expect(
      priceItemSchema.safeParse(priceItem({ amount: 390 })).success,
    ).toBe(false); // amount живёт в снимке версии (X-3)
    const record = priceItem();
    delete (record as Record<string, unknown>).status;
    expect(priceItemSchema.safeParse(record).success).toBe(false);
  });
});

describe("pricingVersionSchema (CA-T-201)", () => {
  it("draft принимается без published-метаданных", () => {
    expect(pricingVersionSchema.safeParse(pricingVersion()).success).toBe(true);
  });

  it("published требует publishedAt/publishedBy (ТЗ §3.2)", () => {
    expect(
      pricingVersionSchema.safeParse(
        pricingVersion({
          status: "published",
          publishedAt: NOW,
          publishedBy: "calc-admin",
        }),
      ).success,
    ).toBe(true);

    const withoutMeta = pricingVersion({ status: "published" });
    const parsed = pricingVersionSchema.safeParse(withoutMeta);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed)).toMatch(/publishedAt/);
  });

  it("снимок: только {priceItemId, amount} (X-2), amount — число", () => {
    expect(
      pricingSnapshotItemSchema.safeParse({
        priceItemId: "a",
        amount: 390,
      }).success,
    ).toBe(true);
    expect(
      pricingSnapshotItemSchema.safeParse({ priceItemId: "a", value: 390 })
        .success,
    ).toBe(false);
    expect(
      pricingSnapshotItemSchema.safeParse({ priceItemId: "a", amount: "390" })
        .success,
    ).toBe(false);
  });

  it("promos — по составу PromoDefinition (код)", () => {
    const promo = {
      code: "TEST10",
      title: "Тест",
      description: "тест",
      type: "percent",
      value: 10,
      minSubtotal: 0,
      appliesTo: "all",
      active: true,
      demo: true,
    };
    expect(promoDefinitionSchema.safeParse(promo).success).toBe(true);
    expect(
      promoDefinitionSchema.safeParse({ ...promo, demo: false }).success,
    ).toBe(false);
    expect(
      promoDefinitionSchema.safeParse({ ...promo, type: "amount" }).success,
    ).toBe(false);
  });

  it("правила — объект; baseSchema — целое; неизвестные поля отклоняются", () => {
    expect(
      pricingVersionSchema.safeParse(pricingVersion({ rules: "none" })).success,
    ).toBe(false);
    expect(
      pricingVersionSchema.safeParse(pricingVersion({ baseSchema: 1.5 }))
        .success,
    ).toBe(false);
    expect(
      pricingVersionSchema.safeParse(pricingVersion({ items: [] })).success,
    ).toBe(false); // items заменён снимком (X-2)
  });
});

describe("parameterDependencySchema (CA-T-201)", () => {
  it("валидная запись принимается", () => {
    expect(parameterDependencySchema.safeParse(dependency()).success).toBe(true);
    expect(
      parameterDependencySchema.safeParse(
        dependency({ syncRisk: true, duplicatedIn: ["KITCHEN_LIMITS.x"] }),
      ).success,
    ).toBe(true);
  });

  it("невалидные enum/типы отклоняются", () => {
    expect(
      parameterDependencySchema.safeParse(dependency({ effect: "critical" }))
        .success,
    ).toBe(false);
    expect(
      parameterDependencySchema.safeParse(
        dependency({ sourceType: "formula" }),
      ).success,
    ).toBe(false);
    expect(
      parameterDependencySchema.safeParse(dependency({ syncRisk: "yes" }))
        .success,
    ).toBe(false);
  });
});

describe("findDuplicates — U-ключи коллекций (§6)", () => {
  it("находит дубли и не репорит уникальные", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "a" }, { id: "c" }];
    expect(findDuplicates(items, (item) => item.id)).toEqual(["a"]);
    expect(findDuplicates([{ id: "a" }], (item) => item.id)).toEqual([]);
  });

  it("составные ключи (U(catalog,id))", () => {
    const items = [
      { catalog: "handle", id: "h1" },
      { catalog: "ledPsu", id: "h1" },
      { catalog: "handle", id: "h1" },
    ];
    expect(findDuplicates(items, (i) => `${i.catalog}:${i.id}`)).toEqual([
      "handle:h1",
    ]);
  });
});

/** ─── CA-T-201: AdminParameter (дизайн §6.1/§7.1, решения владельца) ─── */

const NOW_ = "2026-11-07T12:00:00.000Z";

function adminParameter(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "kitchen.limit.maxModules",
    scope: "kitchen",
    category: "technological",
    group: "01",
    valueType: "int",
    value: 25,
    unit: "pcs",
    min: 1,
    max: 40,
    sourceRef: "src/content/catalog.ts:KITCHEN_LIMITS.maxModules",
    appliesTo: "all_read_paths",
    affects: { price: false, geometry: false, visualization: false, validation: false },
    status: "active",
    editableInAdmin: true,
    version: "v1",
    updatedAt: NOW_,
    updatedBy: "calc-admin",
    ...overrides,
  };
}

/** Запись без числовых атрибутов (unit/min/max) — для нечисловых valueType. */
function withoutNumeric(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const record = adminParameter(overrides);
  delete (record as Record<string, unknown>).unit;
  delete (record as Record<string, unknown>).min;
  delete (record as Record<string, unknown>).max;
  return record;
}

describe("adminParameterSchema (CA-T-201)", () => {
  it("валидные int/decimal/boolean/string/enum/string[] принимаются", () => {
    expect(adminParameterSchema.safeParse(adminParameter()).success).toBe(true);
    expect(
      adminParameterSchema.safeParse(
        adminParameter({
          valueType: "decimal",
          value: 0.2,
          defaultValue: 0.5,
          min: 0,
          max: 1,
          step: 0.1,
        }),
      ).success,
    ).toBe(true);
    expect(
      adminParameterSchema.safeParse(
        withoutNumeric({ valueType: "boolean", value: true }),
      ).success,
    ).toBe(true);
    expect(
      adminParameterSchema.safeParse(
        withoutNumeric({
          valueType: "enum",
          value: "clips",
          enumValues: ["clips", "hidden"],
        }),
      ).success,
    ).toBe(true);
    expect(
      adminParameterSchema.safeParse(
        withoutNumeric({ valueType: "string[]", value: [40, 120].map(String) }),
      ).success,
    ).toBe(true);
    expect(
      adminParameterSchema.safeParse(
        withoutNumeric({ valueType: "string", value: "текст" }),
      ).success,
    ).toBe(true);
  });

  it("решения владельца: group — enum 01–06; valueType — decimal, не number", () => {
    expect(
      adminParameterSchema.safeParse(adminParameter({ group: "06" })).success,
    ).toBe(true);
    expect(
      adminParameterSchema.safeParse(adminParameter({ group: "07" })).success,
    ).toBe(false);
    const legacy = adminParameter({ valueType: "number", value: 1 });
    expect(adminParameterSchema.safeParse(legacy).success).toBe(false);
  });

  it("значение обязано соответствовать valueType (§7.1)", () => {
    expect(
      adminParameterSchema.safeParse(
        adminParameter({ valueType: "int", value: 1.5 }),
      ).success,
    ).toBe(false);
    expect(
      adminParameterSchema.safeParse(
        adminParameter({ valueType: "int", value: "25" }),
      ).success,
    ).toBe(false);
    // для чисел обязательны unit/min/max (§7.1)
    const withoutBounds = adminParameter({ valueType: "int", value: 5 });
    delete (withoutBounds as Record<string, unknown>).min;
    expect(adminParameterSchema.safeParse(withoutBounds).success).toBe(false);
    // boolean-вариант не принимает unit (strict)
    const boolWithUnit = withoutNumeric({ valueType: "boolean", value: true });
    (boolWithUnit as Record<string, unknown>).unit = "cm";
    expect(adminParameterSchema.safeParse(boolWithUnit).success).toBe(false);
  });

  it("граничные правила диапазонов и точности (§6.1/§7.1)", () => {
    expect(
      adminParameterSchema.safeParse(adminParameter({ min: 50, max: 10 }))
        .success,
    ).toBe(false);
    expect(
      adminParameterSchema.safeParse(adminParameter({ value: 100 })).success,
    ).toBe(false); // value > max
    expect(
      adminParameterSchema.safeParse(
        adminParameter({ valueType: "decimal", value: 0.1234, min: 0, max: 1, step: 0.001 }),
      ).success,
    ).toBe(false); // > 3 знаков
    expect(
      adminParameterSchema.safeParse(
        withoutNumeric({
          valueType: "enum",
          value: "hidden",
          enumValues: ["clips"],
        }),
      ).success,
    ).toBe(false); // value ∉ enumValues
    expect(
      adminParameterSchema.safeParse(
        withoutNumeric({ valueType: "enum", value: "clips", enumValues: [] }),
      ).success,
    ).toBe(false); // enumValues ≠ [] (§6.1)
  });

  it("geometric ∧ affects.price ⇒ editableInAdmin=false (§6.1, R-04/OI-063)", () => {
    const dangerous = adminParameter({
      category: "geometric",
      editableInAdmin: true,
      affects: { price: true, geometry: true, visualization: false, validation: false },
    });
    expect(adminParameterSchema.safeParse(dangerous).success).toBe(false);

    const safe = adminParameter({
      category: "geometric",
      editableInAdmin: false,
      affects: { price: true, geometry: true, visualization: false, validation: false },
    });
    expect(adminParameterSchema.safeParse(safe).success).toBe(true);
  });

  it("pending_release и readonly принимаются; неизвестное поле отклоняется", () => {
    expect(
      adminParameterSchema.safeParse(
        adminParameter({ status: "pending_release" }),
      ).success,
    ).toBe(true);
    expect(
      adminParameterSchema.safeParse(adminParameter({ status: "retired" }))
        .success,
    ).toBe(false);
    expect(
      adminParameterSchema.safeParse(adminParameter({ price: 1 })).success,
    ).toBe(false);
  });
});

/** ─── CA-T-201: ModulePreset (ТЗ §3.2, дизайн §6.3, решение: priceRef) ─── */

function modulePreset(
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
    version: "v1",
    updatedAt: NOW_,
    updatedBy: "calc-admin",
    ...overrides,
  };
}

describe("modulePresetSchema (CA-T-201)", () => {
  it("валидная запись принимается (решение: priceRef вместо basePrice)", () => {
    expect(modulePresetSchema.safeParse(modulePreset()).success).toBe(true);
    const withLegacyPrice = modulePreset({ basePrice: 8200 });
    expect(modulePresetSchema.safeParse(withLegacyPrice).success).toBe(false);
    const withoutRef = modulePreset();
    delete (withoutRef as Record<string, unknown>).priceRef;
    expect(modulePresetSchema.safeParse(withoutRef).success).toBe(false);
  });

  it("границы ≤ kitchenModuleSchema: width 15–200, height 40–280, depth 20–80 (§6.3)", () => {
    expect(
      modulePresetSchema.safeParse(
        modulePreset({ width: { min: 14, max: 120, default: 60 } }),
      ).success,
    ).toBe(false);
    expect(
      modulePresetSchema.safeParse(
        modulePreset({ height: { min: 80, max: 300, default: 90 } }),
      ).success,
    ).toBe(false);
    expect(
      modulePresetSchema.safeParse(
        modulePreset({ depth: { min: 10, max: 60, default: 55 } }),
      ).success,
    ).toBe(false);
    expect(
      modulePresetSchema.safeParse(
        modulePreset({ width: { min: 15, max: 200, default: 200 } }),
      ).success,
    ).toBe(true); // границы включительно
  });

  it("min ≤ default ≤ max для каждого измерения", () => {
    expect(
      modulePresetSchema.safeParse(
        modulePreset({ width: { min: 80, max: 60, default: 70 } }),
      ).success,
    ).toBe(false);
    expect(
      modulePresetSchema.safeParse(
        modulePreset({ depth: { min: 50, max: 60, default: 70 } }),
      ).success,
    ).toBe(false);
  });

  it("дефолты — целые; неизвестные поля отклоняются", () => {
    expect(
      modulePresetSchema.safeParse(modulePreset({ defaultShelves: 1.5 }))
        .success,
    ).toBe(false);
    expect(
      modulePresetSchema.safeParse(modulePreset({ zone: "floor", extra: 1 }))
        .success,
    ).toBe(false);
    expect(
      modulePresetSchema.safeParse(
        modulePreset({ family: "garage" }),
      ).success,
    ).toBe(false);
  });
});

/** ─── CA-T-201: PricingChange (дизайн §6.6, универсальная модель) ─── */

function pricingChange(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "chg-1",
    versionId: "price-2026.11.1",
    targetType: "priceItem",
    targetKey: "kitchen.hingePerDoor",
    field: "amount",
    oldValue: 390,
    newValue: 410,
    createdBy: "calc-admin",
    createdAt: NOW_,
    ...overrides,
  };
}

describe("pricingChangeSchema (CA-T-201)", () => {
  it("универсальная модель принимается: targetType/targetKey/field", () => {
    expect(pricingChangeSchema.safeParse(pricingChange()).success).toBe(true);
    expect(
      pricingChangeSchema.safeParse(
        pricingChange({ targetType: "rule", targetKey: "rounding", field: "value" }),
      ).success,
    ).toBe(true);
    expect(
      pricingChangeSchema.safeParse(
        pricingChange({ targetType: "promo", targetKey: "TEST10", field: "active" }),
      ).success,
    ).toBe(true);
  });

  it("удаление: newValue=null допустим (§6.6)", () => {
    expect(
      pricingChangeSchema.safeParse(
        pricingChange({ oldValue: "x", newValue: null }),
      ).success,
    ).toBe(true);
  });

  it("неоднозначные значения и отсутствия отклоняются", () => {
    expect(
      pricingChangeSchema.safeParse(
        pricingChange({ targetType: "priceVersion" }),
      ).success,
    ).toBe(false);
    const noKey = pricingChange();
    delete (noKey as Record<string, unknown>).targetKey;
    expect(pricingChangeSchema.safeParse(noKey).success).toBe(false);
    expect(pricingChangeSchema.safeParse(pricingChange({ field: "" })).success).toBe(
      false,
    );
    const noOld = pricingChange();
    delete (noOld as Record<string, unknown>).oldValue;
    expect(pricingChangeSchema.safeParse(noOld).success).toBe(false);
  });

  it("прежняя модель (priceItemId) и лишние поля отклоняются", () => {
    expect(
      pricingChangeSchema.safeParse(
        pricingChange({ priceItemId: "kitchen.hingePerDoor" }),
      ).success,
    ).toBe(false);
  });

  it("U-ключ §6.6: (versionId,targetType,targetKey,field)", () => {
    const items = [
      pricingChange(),
      pricingChange({ newValue: 450 }),
      pricingChange({ targetKey: "minOrder" }),
    ];
    expect(
      findDuplicates(items, (item) =>
        [item.versionId, item.targetType, item.targetKey, item.field].join("|"),
      ),
    ).toEqual(["price-2026.11.1|priceItem|kitchen.hingePerDoor|amount"]);
  });
});

describe("совместимость со Storage Adapter (CA-T-201)", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "formakub-admin-"));
    process.env.FORMAKUB_DATA_DIR = dir;
  });

  afterEach(() => {
    delete process.env.FORMAKUB_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("запись через адаптер читается и проходит валидацию схемы без изменений", async () => {
    const record = catalogItem();
    await updateCollection("projects.json", (items) => ({
      items: [...items, record],
      result: undefined,
    }));

    const items = await readCollection<Record<string, unknown>>(
      "projects.json",
    );
    expect(items).toHaveLength(1);
    const parsed = catalogItemSchema.safeParse(items[0]);
    expect(parsed.success).toBe(true);
    // схема не нормализует: данные после проверки идентичны исходным
    expect(parsed.success ? parsed.data : null).toEqual(record);
  });

  it("невалидная запись в хранилище отклоняется схемой (не теряется молча)", async () => {
    await updateCollection("projects.json", (items) => ({
      items: [...items, catalogItem({ catalog: "unknown" })],
      result: undefined,
    }));
    const items = await readCollection<Record<string, unknown>>(
      "projects.json",
    );
    expect(catalogItemSchema.safeParse(items[0]).success).toBe(false);
  });
});
