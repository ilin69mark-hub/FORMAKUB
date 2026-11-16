import { describe, expect, it } from "vitest";

import { buildBootstrapPlan } from "./bootstrap";
import {
  CATALOG_GROUPS,
  KITCHEN_MODULE_GROUPS,
  MODULE_COMPOSITION,
  PROJECT_LEVEL_COMPONENTS,
  WARDROBE_MODEL,
  catalogPriceLinkIssues,
  getModuleComposition,
  moduleCoverageIssues,
  modulePriceReferences,
} from "./catalog-model";
import { catalogKindSchema, type CatalogItem } from "./schema";

describe("catalog-model: группы и покрытие", () => {
  it("каждый CatalogKind входит хотя бы в одну группу", () => {
    const kinds = catalogKindSchema.options;
    const covered = new Set(CATALOG_GROUPS.flatMap((group) => group.kinds));
    expect(kinds.filter((kind) => !covered.has(kind))).toEqual([]);
  });

  it("все 8 типов кухни описаны и сгруппированы без фиктивных модулей", () => {
    expect(MODULE_COMPOSITION.map((item) => item.type).sort()).toEqual(
      ["base", "bottle", "drawers", "hob", "oven", "sink", "tall", "wall"],
    );
    expect(moduleCoverageIssues()).toEqual([]);
    for (const group of KITCHEN_MODULE_GROUPS) {
      for (const type of group.kitchenTypes) {
        expect(getModuleComposition(type)?.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("шкаф описан как конфигурация, без ModulePreset", () => {
    expect(WARDROBE_MODEL.status).toBe("CONFIRMED");
    expect(WARDROBE_MODEL.note).toContain("не набор модулей");
    expect(WARDROBE_MODEL.elements.length).toBeGreaterThan(5);
  });

  it("у каждого компонента есть связь, источник количества и ссылка на реализацию", () => {
    for (const entry of [...MODULE_COMPOSITION]) {
      for (const component of entry.components) {
        expect(component.quantitySource.length).toBeGreaterThan(0);
        expect(component.evidence).toContain("src/");
        expect(["required", "conditional", "optional", "alternative"]).toContain(
          component.relation,
        );
        if (component.relation !== "optional" && component.relation !== "required") {
          expect(component.condition).toBeTruthy();
        }
      }
    }
  });

  it("состав отражает фактические ветки движка", () => {
    const sink = getModuleComposition("sink");
    expect(sink?.components.map((item) => item.id)).toEqual(
      expect.arrayContaining(["sink-cutout", "sink-storage", "sink-partition"]),
    );
    const drawers = getModuleComposition("drawers");
    expect(drawers?.components.map((item) => item.id)).toContain("drawer-slide");
    expect(drawers?.components.map((item) => item.id)).not.toContain("hinge");
    expect(getModuleComposition("oven")?.components.map((item) => item.id)).toContain("oven-niche");
    expect(getModuleComposition("hob")?.components.map((item) => item.id)).toContain("hob-cutout");
  });

  it("все ссылки состава и позиций проекта разрешаются в PriceItem bootstrap-плана", () => {
    const plan = buildBootstrapPlan("2026-11-13T00:00:00.000Z");
    expect(plan.issues).toEqual([]);
    const ids = new Set(plan.priceItems.map((item) => item.id));
    const missing = modulePriceReferences().filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
    for (const item of PROJECT_LEVEL_COMPONENTS) {
      for (const id of item.priceItemIds) {
        expect(ids.has(id)).toBe(true);
      }
    }
  });
});

describe("catalog-model: ссылки цен", () => {
  const base: CatalogItem = {
    id: "ldsp",
    catalog: "bodyMaterial",
    label: "ЛДСП",
    attrs: {},
    priceRefs: { ratePerSqm: "catalog.body.ldsp.ratePerSqm" },
    status: "active",
    version: "1",
    createdAt: "2026-11-13T00:00:00.000Z",
    updatedAt: "2026-11-13T00:00:00.000Z",
    updatedBy: "test",
  };

  it("не подставляет 0 ₽: отсутствующий тариф — ошибка ссылки", () => {
    const issues = catalogPriceLinkIssues([base], new Set());
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("CATALOG_PRICE_REF_MISSING");
    expect(issues[0].severity).toBe("error");
  });

  it("разрешённая ссылка не создаёт проблем", () => {
    const issues = catalogPriceLinkIssues(
      [base],
      new Set(["catalog.body.ldsp.ratePerSqm"]),
    );
    expect(issues).toEqual([]);
  });

  it("legacy string[] помечается предупреждением, а не молча принимается", () => {
    const legacy: CatalogItem = {
      ...base,
      priceRefs: ["catalog.body.ldsp.ratePerSqm"],
    };
    const issues = catalogPriceLinkIssues([legacy], new Set());
    expect(issues[0].code).toBe("CATALOG_LEGACY_PRICE_REF");
    expect(issues[0].severity).toBe("warning");
  });
});
