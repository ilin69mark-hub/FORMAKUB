import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROMOS, PRICING } from "@/content/pricing";
import {
  BODY_MATERIALS,
  COUNTERTOPS,
  FACADE_MATERIALS,
  FACADE_STYLES,
  HANDLES,
  KITCHEN_MODULES,
} from "@/content/catalog";
import { PLINTH_MATERIALS } from "@/content/plinth";
import { SUPPORT_SYSTEMS } from "@/content/supports";
import {
  LED_CONNECTOR_PRICE,
  LED_CONTROLS,
  LED_DIFFUSERS,
  LED_END_CAP_PRICE,
  LED_INSTALL_PRICE_PER_METER,
  LED_PROFILES,
  LED_PSU_PRICE,
  LED_STRIPS,
} from "@/content/lighting";
import { buildImportSpec, importPriceItems } from "./import";
import { validateDraftVersion } from "./pricing";
import type { ActorContext } from "./parameters";
import { MAP_ROWS } from "./dependency-map";
import { PERMANENTLY_UNUSED } from "./price-items";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

const priceItemsPath = (): string => path.join(dir, "price-items.json");
const versionsPath = (): string => path.join(dir, "pricing-versions.json");
const presetsPath = (): string => path.join(dir, "module-presets.json");
const auditPath = (): string => path.join(dir, "admin-audit-log.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-priceimport-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function bytes(file: string): string {
  return readFileSync(file, "utf8");
}

function draft() {
  const versions = readJson<
    Array<{ id: string; status: string; snapshot: Array<{ priceItemId: string; amount: number }> }>
  >(versionsPath());
  return versions.find((version) => version.status === "draft");
}

function amountOf(id: string): number | undefined {
  return draft()?.snapshot.find((entry) => entry.priceItemId === id)?.amount;
}

describe("CA-516-02: legacy-материалы не попадают в импорт", () => {
  it("импорт содержит только активные body/facade материалы", () => {
    const ids = buildImportSpec().entries.map((entry) => entry.id);
    for (const legacy of ["mdf", "plywood"]) {
      expect(ids).not.toContain(`catalog.body.${legacy}.ratePerSqm`);
    }
    for (const legacy of ["veneer", "glass", "solid"]) {
      expect(ids).not.toContain(`catalog.facade.${legacy}.ratePerSqm`);
    }
    expect(ids).toContain("catalog.body.ldsp.ratePerSqm");
    expect(ids).toContain("catalog.facade.mdf.ratePerSqm");
    expect(ids).toContain("catalog.facade.mdf_pvc.ratePerSqm");
  });
});

describe("спецификация импорта (§4: реестр цен)", () => {
  it("spec 93 + excluded 21 = позиции content; исключения — rules/promos/дельта/allowance", () => {
    const spec = buildImportSpec();

    // §4 заявляет 118 позиций; фактический content даёт 111: группировка
    // №60–72 в §4 нумерует 13 позиций при 10 rateDelta в PLINTH_MATERIALS
    // (расхождение документа зафиксировано в отчёте CA-T-208).
    expect(spec.entries.length).toBe(93);
    expect(spec.excluded.length).toBe(21);
    expect(spec.entries.length + spec.excluded.length).toBe(114);

    const reasons = spec.excluded.map((item) => item.reason);
    expect(reasons.filter((r) => r.includes("PricingVersion.rules")).length).toBe(7);
    expect(reasons.filter((r) => r.includes("PricingVersion.promos")).length).toBe(3);
    expect(spec.excluded.filter((e) => e.sourceRef.includes("rateDelta")).length).toBe(10);
    expect(
      reasons.filter((r) => r.includes("№7")).length,
    ).toBe(1);

    // Уникальность идентификаторов и источников.
    expect(new Set(spec.entries.map((e) => e.id)).size).toBe(93);
    expect(new Set(spec.entries.map((e) => e.sourceRef)).size).toBe(93);

    const bodyIds = spec.entries
      .map((entry) => entry.id)
      .filter((id) => id.startsWith("catalog.body."));
    expect(bodyIds).toEqual(["catalog.body.ldsp.ratePerSqm"]);
    const facadeIds = spec.entries
      .map((entry) => entry.id)
      .filter((id) => id.startsWith("catalog.facade."))
      .sort();
    expect(facadeIds).toEqual([
      "catalog.facade.ldsp.ratePerSqm",
      "catalog.facade.mdf.ratePerSqm",
      "catalog.facade.mdf_pvc.ratePerSqm",
    ]);
    const mdfPvc = spec.entries.find(
      (entry) => entry.id === "catalog.facade.mdf_pvc.ratePerSqm",
    );
    expect(mdfPvc?.value).toBe(8400);
    expect(mdfPvc?.usage).toBe("used");
    expect(mdfPvc?.editable).toBe(true);
  });
});

describe("импорт реальных определений (CA-T-208)", () => {
  it("импорт: 93 определения, значения снимка — из реального content", async () => {
    const report = await importPriceItems(ACTOR);

    expect(report.conflicts).toEqual([]);
    expect(report.specTotal).toBe(93);
    expect(report.imported.length).toBe(93);

    const items = readJson<Array<{ id: string }>>(priceItemsPath());
    expect(items.length).toBe(93);

    // Сверка сумм с реальными источниками (тест читает content напрямую).
    expect(amountOf("kitchen.shelf")).toBe(PRICING.kitchen.shelf);
    expect(amountOf("wardrobe.plinthPerMeter")).toBe(PRICING.wardrobe.plinthPerMeter);
    expect(amountOf("catalog.body.ldsp.ratePerSqm")).toBe(BODY_MATERIALS[0]!.ratePerSqm);
    expect(amountOf("catalog.facadeStyle.shaker.multiplier")).toBe(
      FACADE_STYLES.find((s) => s.id === "shaker")!.multiplier,
    );
    expect(amountOf("catalog.countertop.acrylic.ratePerLinearMeter")).toBe(
      COUNTERTOPS.find((c) => c.id === "acrylic")!.ratePerLinearMeter,
    );
    expect(amountOf("kitchen.module.base.basePrice")).toBe(KITCHEN_MODULES.base.basePrice);
    expect(amountOf("lighting.psu.400")).toBe(5600);
    expect(amountOf("lighting.strip.led-24v-4w8")).toBe(780);
    expect(amountOf("catalog.support.standard.legPrice")).toBe(420);
    expect(amountOf("catalog.plinth.mdf.ratePerMeter")).toBe(2200);

    // Черновик: правила §8.7 и промокоды — из content.
    const version = draft()!;
    expect(version.id).toBe("price-demo-2026-01");
    const rules = readJson<Record<string, unknown>[]>(versionsPath())[0]!.rules;
    expect(rules).toMatchObject({
      rounding: PRICING.rounding,
      minOrder: PRICING.minOrder,
      complexityPerExtraModule: PRICING.kitchen.complexityPerExtraModule,
      complexityMax: PRICING.kitchen.complexityMax,
      bodyFactor: PRICING.wardrobe.bodyFactor,
      bodyDepthReference: PRICING.kitchen.bodyDepthReference,
    });
    const promos = readJson<Array<{ promos: Array<{ code: string }> }>>(
      versionsPath(),
    )[0]!.promos;
    expect(promos.map((promo) => promo.code)).toEqual(PROMOS.map((promo) => promo.code));
  });

  it("исходные ID и sourceRef сохранены; мёртвые поля — unused", async () => {
    await importPriceItems(ACTOR);
    const items = readJson<
      Array<{ id: string; sourceRef: string; label: string; unit: string; usage: string; editable: boolean; scope: string }>
    >(priceItemsPath());

    const shelf = items.find((item) => item.id === "kitchen.shelf")!;
    expect(shelf.sourceRef).toBe("src/content/pricing.ts:PRICING.kitchen.shelf");
    expect(shelf.scope).toBe("kitchen");
    expect(shelf.unit).toBe("RUB_PER_PCS");
    expect(shelf.usage).toBe("used");

    const body = items.find((item) => item.id === "catalog.body.ldsp.ratePerSqm")!;
    expect(body.sourceRef).toBe("src/content/catalog.ts:BODY_MATERIALS.ldsp.ratePerSqm");
    expect(body.label).toBe("ЛДСП");
    expect(body.scope).toBe("shared");

    // 3 из 4 мёртвых полей импортируются (allowance исключён по единице §4).
    for (const dead of PERMANENTLY_UNUSED) {
      if (dead.id === "kitchen.countertopDepthAllowance") continue;
      const item = items.find((entry) => entry.id === dead.id)!;
      expect(item, dead.id).toBeDefined();
      expect(item.usage).toBe("unused");
      expect(item.editable).toBe(false);
      expect(item.sourceRef).toBe(dead.sourceRef);
    }
    expect(
      items.find((item) => item.id === "kitchen.countertopDepthAllowance"),
    ).toBeUndefined();
    expect(items.some((item) => item.sourceRef.includes("rateDelta"))).toBe(false);
  });

  it("повторный запуск: без дубликатов, без изменений файлов и журнала", async () => {
    await importPriceItems(ACTOR);
    const itemsBefore = bytes(priceItemsPath());
    const versionsBefore = bytes(versionsPath());
    const auditBefore = bytes(auditPath());

    const second = await importPriceItems(ACTOR);

    expect(second.imported).toEqual([]);
    expect(second.unchanged.length).toBe(93);
    expect(second.conflicts).toEqual([]);
    expect(second.snapshot).toEqual({
      versionId: "price-demo-2026-01",
      created: false,
      updated: false,
      entries: 90,
    });
    expect(bytes(priceItemsPath())).toBe(itemsBefore);
    expect(bytes(versionsPath())).toBe(versionsBefore);
    expect(bytes(auditPath())).toBe(auditBefore);
  });
});

describe("draft PricingVersion.snapshot", () => {
  it("состав снимка — ровно active ∧ used (90 из 93)", async () => {
    await importPriceItems(ACTOR);

    const items = readJson<Array<{ id: string; status: string; usage: string }>>(
      priceItemsPath(),
    );
    const expected = items
      .filter((item) => item.status === "active" && item.usage === "used")
      .map((item) => item.id)
      .sort();

    const version = draft()!;
    const actual = version.snapshot.map((entry) => entry.priceItemId).sort();
    expect(actual).toEqual(expected);
    expect(actual.length).toBe(90);

    // Мёртвые (unused) в снимке отсутствуют (S-01).
    for (const dead of PERMANENTLY_UNUSED) {
      expect(actual, dead.id).not.toContain(dead.id);
    }
    // Диапазоны §8.3: суммы ≥ 0, FACTOR ∈ [0.1, 10].
    for (const entry of version.snapshot) {
      expect(entry.amount).toBeGreaterThanOrEqual(0);
      if (entry.priceItemId.includes("facadeStyle")) {
        expect(entry.amount).toBeGreaterThanOrEqual(0.1);
        expect(entry.amount).toBeLessThanOrEqual(10);
      }
    }
  });

  it("опубликованный snapshot не изменяется при импорте", async () => {
    const published = {
      id: "price-2026.10.9",
      label: "Опубликованная",
      status: "published",
      snapshot: [{ priceItemId: "kitchen.shelf", amount: 999 }],
      rules: {},
      promos: [],
      baseSchema: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      createdBy: "seed",
      publishedAt: "2026-10-02T00:00:00.000Z",
      publishedBy: "seed",
    };
    writeFileSync(
      versionsPath(),
      JSON.stringify([published]),
      "utf8",
    );
    const before = bytes(versionsPath());

    const report = await importPriceItems(ACTOR);

    expect(report.snapshot?.created).toBe(true);
    expect(report.untouchedVersionIds).toEqual(["price-2026.10.9"]);
    const versions = readJson<typeof published[]>(versionsPath());
    const stored = versions.find((version) => version.id === "price-2026.10.9")!;
    // Опубликованная запись не перезаписана (снимок 999 сохранён).
    expect(stored.snapshot).toEqual([{ priceItemId: "kitchen.shelf", amount: 999 }]);
    expect(stored.publishedAt).toBe("2026-10-02T00:00:00.000Z");
    // Импорт создал отдельный draft рядом с published.
    expect(versions.find((version) => version.status === "draft")).toBeDefined();
    expect(before).not.toBe(bytes(versionsPath())); // добавлен draft, published — нетронут
  });
});

describe("конфликты: без молчаливой перезаписи и частичных данных", () => {
  function conflictingItem(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      id: "kitchen.shelf",
      scope: "kitchen",
      label: "Полка (кухня)",
      unit: "RUB_PER_PCS",
      usage: "used",
      status: "active",
      editable: true,
      sourceRef: "src/content/pricing.ts:PRICING.kitchen.shelf",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "seed",
      ...overrides,
    };
  }

  it("конфликт источника: запись не перезаписана, ни одной записи, snapshot не создан", async () => {
    writeFileSync(
      priceItemsPath(),
      JSON.stringify([conflictingItem({ sourceRef: "custom:source" })]),
      "utf8",
    );
    const before = bytes(priceItemsPath());

    const report = await importPriceItems(ACTOR);

    expect(
      report.conflicts.some(
        (c) => c.id === "kitchen.shelf" && c.reason.includes("конфликт источника"),
      ),
    ).toBe(true);
    expect(report.imported).toEqual([]);
    expect(report.snapshot).toBeNull();
    expect(bytes(priceItemsPath())).toBe(before);
    expect(existsSync(versionsPath())).toBe(false);
    expect(existsSync(auditPath())).toBe(false);
  });

  it("конфликт идентичности (label отличается): без перезаписи и записи", async () => {
    writeFileSync(
      priceItemsPath(),
      JSON.stringify([conflictingItem({ label: "Чужая правка" })]),
      "utf8",
    );
    const before = bytes(priceItemsPath());

    const report = await importPriceItems(ACTOR);

    expect(report.conflicts[0]?.reason).toContain("конфликт идентичности");
    expect(report.snapshot).toBeNull();
    expect(bytes(priceItemsPath())).toBe(before);
    expect(existsSync(versionsPath())).toBe(false);
  });

  it("битый файл версий: исключение до записи, price-items не создан", async () => {
    writeFileSync(versionsPath(), "{не json", "utf8");

    await expect(importPriceItems(ACTOR)).rejects.toThrow();
    expect(existsSync(priceItemsPath())).toBe(false);
  });

  it("активная used-ставка вне спецификации: блокировка полноты снимка", async () => {
    writeFileSync(
      priceItemsPath(),
      JSON.stringify([
        {
          id: "foreign.item",
          scope: "shared",
          label: "Чужая",
          unit: "RUB",
          usage: "used",
          status: "active",
          editable: true,
          sourceRef: "custom:foreign",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          updatedBy: "seed",
        },
      ]),
      "utf8",
    );
    const before = bytes(priceItemsPath());

    const report = await importPriceItems(ACTOR);

    expect(report.conflicts.some((c) => c.reason.includes("источника суммы"))).toBe(true);
    expect(report.snapshot).toBeNull();
    expect(bytes(priceItemsPath())).toBe(before);
    expect(existsSync(versionsPath())).toBe(false);
  });
});

describe("связи priceRef (R-15): без подбора по amount", () => {
  it("контентные пресеты без priceRef → unresolved; amount-совпадение не создаёт связь", async () => {
    const report = await importPriceItems(ACTOR);

    // 8 пресетов KITCHEN_MODULES — без priceRef в источнике.
    const contentUnresolved = report.links.unresolved.filter((link) =>
      link.preset.startsWith("kitchen:"),
    );
    expect(contentUnresolved.length).toBe(8);
    expect(contentUnresolved.every((link) => link.reason.includes("priceRef"))).toBe(true);

    // basePrice «Бутылочница» = 5000 = PRICING.kitchen.bottleRack →
    // совпадение amount НЕ создаёт связь.
    expect(amountOf("kitchen.bottleRack")).toBe(5000);
    expect(amountOf("kitchen.module.bottle.basePrice")).toBe(5000);
    expect(report.links.matched).toEqual([]);
  });

  it("админ-пресет: точное совпадение priceRef = PriceItem.id → matched; битый id → unresolved", async () => {
    await importPriceItems(ACTOR);
    writeFileSync(
      presetsPath(),
      JSON.stringify([
        { id: "base", family: "kitchen", priceRef: "kitchen.shelf" },
        { id: "sink", family: "kitchen", priceRef: "ghost.price" },
      ]),
      "utf8",
    );

    const report = await importPriceItems(ACTOR);

    expect(report.links.matched).toEqual([
      { preset: "kitchen:base", priceRef: "kitchen.shelf" },
    ]);
    expect(report.links.unresolved).toContainEqual({
      preset: "kitchen:sink",
      reason: 'PriceItem "ghost.price" не найден',
    });
    // Идемпотентность: без изменений → без новых audit-событий.
    const events = readJson<unknown[]>(auditPath());
    expect(events.length).toBe(2);
  });

  it("PARTIAL-ребра priceRef в карте зависимостей остаются PARTIAL", async () => {
    const report = await importPriceItems(ACTOR);

    const partial = MAP_ROWS.filter(
      (row) =>
        row.evidence === "PARTIAL" && JSON.stringify(row).includes("priceRef"),
    );
    expect(partial.length).toBe(2);
    expect(partial.every((row) => row.evidence === "PARTIAL")).toBe(true);
    // Импорт не заявляет о разрешении связей: только matched/unresolved.
    expect(Object.keys(report.links).sort()).toEqual(["matched", "unresolved"]);
  });
});

describe("аудит импорта", () => {
  it("первый запуск: diagnostic.run + pricing.create; повтор — без событий", async () => {
    const first = await importPriceItems(ACTOR);
    expect(first.snapshot?.created).toBe(true);

    const events = readJson<
      Array<{ action: string; entityType: string; entityId: string; result: string }>
    >(auditPath());
    expect(events.length).toBe(2);
    const diagnostic = events.find((event) => event.action === "diagnostic.run")!;
    expect(diagnostic.entityType).toBe("priceItem");
    expect(diagnostic.entityId).toBe("import");
    expect(diagnostic.result).toBe("ok");
    const created = events.find((event) => event.action === "pricing.create")!;
    expect(created.entityType).toBe("pricingVersion");
    expect(created.entityId).toBe("price-demo-2026-01");

    await importPriceItems(ACTOR);
    expect(readJson<unknown[]>(auditPath()).length).toBe(2);
  });
});

// ─── P2-QA-001 (AUDIT-P2-003): полная сверка snapshot с src/content ───
// Независимый «оракул»: строится прямым обходом фактических источников,
// БЕЗ использования buildImportSpec()/логики импорта — сверка «snapshot ↔
// content» не является самопроверкой import.ts.

/** Мёртвые ставки (OI-054): usage=unused → в active∧used-снимок не входят. */
const SNAPSHOT_DEAD = new Set([
  "kitchen.plinthPerMeter",
  "kitchen.underCabinetLightPerMeter",
  "kitchen.sinkPartition",
]);

/** Правила §8.7 внутри family-секций PRICING (не ставки). */
const FAMILY_RULE_KEYS: Record<"kitchen" | "wardrobe", ReadonlySet<string>> = {
  kitchen: new Set(["complexityPerExtraModule", "complexityMax", "bodyDepthReference"]),
  wardrobe: new Set(["bodyDepthReference", "bodyFactor"]),
};

interface ExpectedEntry {
  amount: number;
  sourceRef: string;
}

function buildExpectedFromContent(): Map<string, ExpectedEntry> {
  const expected = new Map<string, ExpectedEntry>();
  const add = (id: string, amount: number, sourceRef: string): void => {
    if (expected.has(id)) throw new Error(`Оракул: дубликат id ${id}`);
    expected.set(id, { amount, sourceRef });
  };

  // PRICING kitchen/wardrobe (§4 №3–33): правила и allowance исключены,
  // мёртвые ставки — вне снимка (usage=unused).
  for (const family of ["kitchen", "wardrobe"] as const) {
    const section = PRICING[family] as unknown as Record<string, number>;
    for (const key of Object.keys(section)) {
      if (key === "countertopDepthAllowance" || FAMILY_RULE_KEYS[family].has(key)) continue;
      const id = `${family}.${key}`;
      if (SNAPSHOT_DEAD.has(id)) continue;
      add(id, section[key]!, `src/content/pricing.ts:PRICING.${family}.${key}`);
    }
  }

  for (const item of BODY_MATERIALS) {
    add(
      `catalog.body.${item.id}.ratePerSqm`,
      item.ratePerSqm!,
      `src/content/catalog.ts:BODY_MATERIALS.${item.id}.ratePerSqm`,
    );
  }
  for (const item of FACADE_MATERIALS) {
    add(
      `catalog.facade.${item.id}.ratePerSqm`,
      item.ratePerSqm!,
      `src/content/catalog.ts:FACADE_MATERIALS.${item.id}.ratePerSqm`,
    );
  }
  for (const item of FACADE_STYLES) {
    add(
      `catalog.facadeStyle.${item.id}.multiplier`,
      item.multiplier,
      `src/content/catalog.ts:FACADE_STYLES.${item.id}.multiplier`,
    );
  }
  for (const item of HANDLES) {
    add(
      `catalog.handle.${item.id}.rate`,
      item.rate,
      `src/content/catalog.ts:HANDLES.${item.id}.rate`,
    );
  }
  for (const item of COUNTERTOPS) {
    add(
      `catalog.countertop.${item.id}.ratePerLinearMeter`,
      item.ratePerLinearMeter!,
      `src/content/catalog.ts:COUNTERTOPS.${item.id}.ratePerLinearMeter`,
    );
  }
  for (const item of PLINTH_MATERIALS) {
    add(
      `catalog.plinth.${item.id}.ratePerMeter`,
      item.ratePerMeter,
      `src/content/plinth.ts:PLINTH_MATERIALS.${item.id}.ratePerMeter`,
    );
  }
  for (const system of SUPPORT_SYSTEMS) {
    add(
      `catalog.support.${system.id}.legPrice`,
      system.legPrice,
      `src/content/supports.ts:SUPPORT_SYSTEMS.${system.id}.legPrice`,
    );
    add(
      `catalog.support.${system.id}.clipPrice`,
      system.clipPrice,
      `src/content/supports.ts:SUPPORT_SYSTEMS.${system.id}.clipPrice`,
    );
    add(
      `catalog.support.${system.id}.screwPrice`,
      system.screwPrice,
      `src/content/supports.ts:SUPPORT_SYSTEMS.${system.id}.screwPrice`,
    );
    add(
      `catalog.support.${system.id}.anchorPrice`,
      system.anchorPrice,
      `src/content/supports.ts:SUPPORT_SYSTEMS.${system.id}.anchorPrice`,
    );
  }
  for (const item of LED_PROFILES) {
    add(
      `lighting.profile.${item.id}`,
      item.ratePerMeter,
      `src/content/lighting.ts:LED_PROFILES.${item.id}.ratePerMeter`,
    );
  }
  for (const item of LED_DIFFUSERS) {
    add(
      `lighting.diffuser.${item.id}`,
      item.ratePerMeter,
      `src/content/lighting.ts:LED_DIFFUSERS.${item.id}.ratePerMeter`,
    );
  }
  for (const item of LED_CONTROLS) {
    add(
      `lighting.control.${item.id}`,
      item.price,
      `src/content/lighting.ts:LED_CONTROLS.${item.id}.price`,
    );
  }
  for (const watts of Object.keys(LED_PSU_PRICE).map(Number)) {
    add(
      `lighting.psu.${watts}`,
      LED_PSU_PRICE[watts]!,
      `src/content/lighting.ts:LED_PSU_PRICE.${watts}`,
    );
  }
  for (const item of LED_STRIPS) {
    add(
      `lighting.strip.${item.id}`,
      item.pricePerMeter,
      `src/content/lighting.ts:LED_STRIPS.${item.id}.pricePerMeter`,
    );
  }
  add(
    "lighting.endCap",
    LED_END_CAP_PRICE,
    "src/content/lighting.ts:LED_END_CAP_PRICE",
  );
  add(
    "lighting.connector",
    LED_CONNECTOR_PRICE,
    "src/content/lighting.ts:LED_CONNECTOR_PRICE",
  );
  add(
    "lighting.install",
    LED_INSTALL_PRICE_PER_METER,
    "src/content/lighting.ts:LED_INSTALL_PRICE_PER_METER",
  );
  for (const key of Object.keys(KITCHEN_MODULES)) {
    const preset = KITCHEN_MODULES[key as keyof typeof KITCHEN_MODULES];
    add(
      `kitchen.module.${key}.basePrice`,
      preset.basePrice,
      `src/content/catalog.ts:KITCHEN_MODULES.${key}.basePrice`,
    );
  }

  return expected;
}

/**
 * Сверка snapshot против ожиданий из источников. Возвращает конкретные
 * расхождения (id, ожидаемое/фактическое значение), а не общий false.
 * Сравнение по стабильным id; суммы — строгое равенство без допусков.
 */
function compareSnapshot(
  snapshot: Array<{ priceItemId: string; amount: number }>,
  expected: Map<string, ExpectedEntry>,
): string[] {
  const issues: string[] = [];
  const seen = new Map<string, number>();
  for (const entry of snapshot) {
    seen.set(entry.priceItemId, (seen.get(entry.priceItemId) ?? 0) + 1);
  }
  for (const [id, count] of [...seen].sort()) {
    if (count > 1) issues.push(`дубликат ${id}: встречается ${count} раза, ожидается ровно 1`);
  }
  const snapshotById = new Map(snapshot.map((entry) => [entry.priceItemId, entry]));
  for (const [id, want] of [...expected].sort()) {
    if (!snapshotById.has(id)) {
      issues.push(`пропущен ${id}: ожидался amount=${want.amount} (sourceRef ${want.sourceRef})`);
      continue;
    }
    if (seen.get(id) === 1) {
      const actual = snapshotById.get(id)!.amount;
      if (actual !== want.amount) {
        issues.push(
          `сумма ${id}: ожидалось ${want.amount}, найдено ${actual} (sourceRef ${want.sourceRef})`,
        );
      }
    }
  }
  const expectedIds = new Set(expected.keys());
  for (const entry of snapshot) {
    if (!expectedIds.has(entry.priceItemId)) {
      issues.push(
        `лишний ${entry.priceItemId}: amount=${entry.amount} — отсутствует в источниках src/content`,
      );
    }
  }
  return issues.sort();
}

describe("P2-QA-001: полная сверка draft snapshot с src/content (AUDIT-P2-003)", () => {
  it("все 90 элемент: id и amount из источников, единственность, полнота, sourceRef сохранён", async () => {
    await importPriceItems(ACTOR);

    const expected = buildExpectedFromContent();
    expect(expected.size).toBe(90); // контроль состава оракула (93 − 3 unused)

    const snapshot = draft()!.snapshot as Array<{ priceItemId: string; amount: number }>;
    expect(snapshot.length).toBe(90);
    // Полная сверка: пропусков, лишних, дублей и расхождений сумм нет.
    expect(compareSnapshot(snapshot, expected)).toEqual([]);

    // Каждый элемент снимка связан с источником: sourceRef в коллекции
    // PriceItem соответствует источнику, из которого получена сумма.
    const items = readJson<Array<{ id: string; sourceRef: string; status: string; usage: string }>>(
      priceItemsPath(),
    );
    for (const entry of snapshot) {
      const record = items.find((item) => item.id === entry.priceItemId);
      expect(record, entry.priceItemId).toBeDefined();
      expect(record!.sourceRef, entry.priceItemId).toBe(expected.get(entry.priceItemId)!.sourceRef);
    }

    // Состав снимка = ровно active ∧ used (§6.4/S-01).
    const activeUsed = items
      .filter((item) => item.status === "active" && item.usage === "used")
      .map((item) => item.id)
      .sort();
    expect(snapshot.map((entry) => entry.priceItemId).sort()).toEqual(activeUsed);
  });

  it("исключённые CA-T-208 не требуются в snapshot (rules/promos/rateDelta/allowance)", async () => {
    await importPriceItems(ACTOR);

    const expected = buildExpectedFromContent();
    const spec = buildImportSpec();
    const excludedRefs = new Set(spec.excluded.map((entry) => entry.sourceRef));

    // Ни один исключённый sourceRef не входит в ожидаемые 90.
    for (const [id, want] of expected) {
      expect(excludedRefs.has(want.sourceRef), id).toBe(false);
    }
    // Причины исключения §5 задания присутствуют и не «требуются» снимком.
    expect(expected.has("kitchen.countertopDepthAllowance")).toBe(false);
    expect([...expected.values()].some((want) => want.sourceRef.includes("rateDelta"))).toBe(false);
    expect([...excludedRefs].filter((ref) => ref.includes("rateDelta")).length).toBe(10);
    expect([...excludedRefs].some((ref) => ref.includes("countertopDepthAllowance"))).toBe(true);
    expect([...excludedRefs].filter((ref) => ref.includes("PROMOS.")).length).toBe(PROMOS.length);
    expect(
      [...excludedRefs].filter(
        (ref) =>
          ref.includes("rounding") ||
          ref.includes("minOrder") ||
          ref.includes("complexity") ||
          ref.includes("bodyDepthReference") ||
          ref.includes("bodyFactor"),
      ).length,
    ).toBe(7); // 7 правил §8.7 (rounding, minOrder, complexity×2, bodyDepth×2, bodyFactor)

    // Контроль состава: 93 импортируемых − 3 unused = 90 элемент снимка.
    expect(spec.entries.length - SNAPSHOT_DEAD.size).toBe(90);
    const snapshotIds = new Set(
      (draft()!.snapshot as Array<{ priceItemId: string }>).map((entry) => entry.priceItemId),
    );
    expect([...snapshotIds].some((id) => SNAPSHOT_DEAD.has(id))).toBe(false);
  });
});

describe("P2-QA-001: диагностика сверки (негативные проверки)", () => {
  function validSnapshot(): Array<{ priceItemId: string; amount: number }> {
    return [...buildExpectedFromContent()].map(([id, want]) => ({
      priceItemId: id,
      amount: want.amount,
    }));
  }

  it("корректный snapshot (все 90) → пустой список расхождений", () => {
    expect(compareSnapshot(validSnapshot(), buildExpectedFromContent())).toEqual([]);
  });

  it("отсутствующий ID → строка с id, ожидаемой суммой и источником", () => {
    const expected = buildExpectedFromContent();
    const snapshot = validSnapshot().filter((entry) => entry.priceItemId !== "kitchen.shelf");

    const issues = compareSnapshot(snapshot, expected);
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("пропущен kitchen.shelf");
    expect(issues[0]).toContain(String(expected.get("kitchen.shelf")!.amount));
    expect(issues[0]).toContain("PRICING.kitchen.shelf");
  });

  it("лишний ID → строка с id и фактической суммой", () => {
    const snapshot = [
      ...validSnapshot(),
      { priceItemId: "ghost.item", amount: 12345 },
    ];

    const issues = compareSnapshot(snapshot, buildExpectedFromContent());
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("лишний ghost.item");
    expect(issues[0]).toContain("12345");
  });

  it("дублирующийся ID → строка с количеством вхождений", () => {
    const base = validSnapshot();
    const snapshot = [...base, base.find((entry) => entry.priceItemId === "kitchen.shelf")!];

    const issues = compareSnapshot(snapshot, buildExpectedFromContent());
    expect(issues.some((issue) => issue.includes("дубликат kitchen.shelf") && issue.includes("2"))).toBe(
      true,
    );
  });

  it("неправильная сумма → строка с id, ожиданием и фактом", () => {
    const snapshot = validSnapshot().map((entry) =>
      entry.priceItemId === "kitchen.shelf" ? { ...entry, amount: entry.amount + 1 } : entry,
    );

    const issues = compareSnapshot(snapshot, buildExpectedFromContent());
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("сумма kitchen.shelf");
    expect(issues[0]).toContain(String(buildExpectedFromContent().get("kitchen.shelf")!.amount));
    expect(issues[0]).toContain(String(buildExpectedFromContent().get("kitchen.shelf")!.amount + 1));
  });
});

// ─── P2-QA-002 (AUDIT-P2-004): конкурентный импорт ───

function auditEvents(): Array<{ action: string; entityId: string; newValue?: Record<string, unknown> }> {
  return existsSync(auditPath())
    ? readJson<Array<{ action: string; entityId: string; newValue?: Record<string, unknown> }>>(
        auditPath(),
      )
    : [];
}

/** Общая проверка данных после (возможно) конкурентных запусков. */
async function expectIntactImport(): Promise<void> {
  const items = readJson<Array<{ id: string }>>(priceItemsPath());
  expect(items.length).toBe(93);
  expect(new Set(items.map((item) => item.id)).size).toBe(93);

  const snapshot = draft()!.snapshot as Array<{ priceItemId: string; amount: number }>;
  expect(snapshot.length).toBe(90);
  expect(new Set(snapshot.map((entry) => entry.priceItemId)).size).toBe(90);

  // Целостность §8.3 подтверждается валидацией, а не только длиной массива.
  const validation = await validateDraftVersion("price-demo-2026-01");
  expect(validation.passed).toBe(true);
}

describe("P2-QA-002: конкурентный импорт (AUDIT-P2-004)", () => {
  // Три изолированных повтора (своя temp-директория у каждого it) —
  // проверка стабильности результата без случайных задержек.
  it.each([1, 2, 3])(
    "параллельные запуски %i: 93/90 без дублей, отчёты согласованы с состоянием",
    async () => {
      const reports = await Promise.all([
        importPriceItems(ACTOR),
        importPriceItems(ACTOR),
      ]);

      // 1-2) Оба вызова завершились по контракту (отчёт, не исключение).
      for (const report of reports) {
        expect(report.specTotal).toBe(93);
        expect(report.conflicts).toEqual([]);
        expect(report.imported.length + report.unchanged.length).toBe(93);
        expect(report.snapshot?.entries).toBe(90);
        // 8) Заявленные id существуют в фактическом состоянии хранилища.
        const actualIds = new Set(
          readJson<Array<{ id: string }>>(priceItemsPath()).map((item) => item.id),
        );
        for (const id of report.imported) expect(actualIds.has(id), id).toBe(true);
      }

      // 3-6) Нет дубликатов, каждая запись ровно один раз, snapshot цел.
      await expectIntactImport();
    },
  );

  it("повторные импорты идемпотентны: 1-й → 2-й → 3-й без изменений и дублей", async () => {
    const first = await importPriceItems(ACTOR);
    expect(first.imported.length).toBe(93);
    const itemsAfterFirst = bytes(priceItemsPath());
    const versionsAfterFirst = bytes(versionsPath());
    const auditAfterFirst = bytes(auditPath());

    for (let run = 2; run <= 3; run++) {
      const repeat = await importPriceItems(ACTOR);
      expect(repeat.imported, `запуск ${run}`).toEqual([]);
      expect(repeat.unchanged.length, `запуск ${run}`).toBe(93);
      expect(bytes(priceItemsPath()), `запуск ${run}`).toBe(itemsAfterFirst);
      expect(bytes(versionsPath()), `запуск ${run}`).toBe(versionsAfterFirst);
      expect(bytes(auditPath()), `запуск ${run}`).toBe(auditAfterFirst);
    }

    const items = readJson<Array<{ id: string }>>(priceItemsPath());
    expect(items.length).toBe(93);
    expect(new Set(items.map((item) => item.id)).size).toBe(93);
  });

  it("аудит конкурентного запуска: один факт создания draft → одно pricing.create", async () => {
    await Promise.all([importPriceItems(ACTOR), importPriceItems(ACTOR)]);

    const events = auditEvents();
    // Контракт §10.1 CA-T-208: «создание черновика → pricing.create» —
    // черновик создаётся ровно один раз; два события описывали бы одно
    // и то же создание (ложное дублирование факта).
    const creations = events.filter((event) => event.action === "pricing.create");
    expect(creations.length).toBe(1);
    expect(creations[0]?.entityId).toBe("price-demo-2026-01");

    // Контракт P2-FIX-002: по одному diagnostic.run на каждый из двух
    // конкурентных вызовов; payload отражает ФАКТ каждого вызова —
    // первый импортировал 93, второй (после замка) — 0.
    const diagnostics = events.filter((event) => event.action === "diagnostic.run");
    expect(diagnostics.length).toBe(2);
    expect(
      diagnostics.map((event) => event.newValue?.imported).sort((a, b) => Number(a) - Number(b)),
    ).toEqual([0, 93]);
    expect(
      diagnostics.filter(
        (event) => event.newValue !== undefined && event.newValue.createdVersion !== undefined,
      ).length,
    ).toBe(creations.length);
  });
});
