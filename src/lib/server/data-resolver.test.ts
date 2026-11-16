import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { defaultKitchen } from "@/lib/configurator/defaults";
import type {
  FurnitureConfig,
  KitchenConfig,
  StoredProject,
} from "@/lib/configurator/types";
import { BUILD_CALC_VERSION } from "@/lib/configurator/versions";

import { normalizeSchemaVersion, resolveCalculationInputs } from "./data-resolver";
import { TEST_RULES_SNAPSHOT_ID, rulesSnapshotFixture } from "./rules-test-fixture";
import { rulesSnapshotContentHash } from "@/lib/admin/managed-rules";
import { getParameterManifest } from "./parameter-registry";

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-resolver-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  writeFileSync(
    path.join(dir, "rules-snapshots.json"),
    JSON.stringify([rulesSnapshotFixture()]),
    "utf8",
  );
});

afterEach(() => {
  for (const file of [
    "catalog-items.json",
    "module-presets.json",
    "pricing-versions.json",
  ]) {
    rmSync(path.join(dir, file), { force: true });
  }
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeCollection(name: string, items: unknown[]): void {
  writeFileSync(path.join(dir, name), JSON.stringify(items), "utf8");
}

const NOW = "2026-11-09T00:00:00.000Z";

function catalog(
  kind: string,
  id: string,
  attrs: Record<string, unknown>,
  priceRefs: Record<string, string>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    catalog: kind,
    label: id,
    attrs,
    priceRefs,
    status: "active",
    version: "1",
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: "test",
    ...overrides,
  };
}

function preset(
  id: string,
  priceRef: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    family: "kitchen",
    zone: "floor",
    width: { min: 40, max: 120, default: 60 },
    height: { min: 70, max: 90, default: 72 },
    depth: { min: 45, max: 70, default: 60 },
    defaultShelves: 0,
    defaultDrawers: 0,
    priceRef,
    status: "active",
    version: "1",
    updatedAt: NOW,
    updatedBy: "test",
    ...overrides,
  };
}

function version(
  snapshot: Record<string, number>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "price-1",
    label: "price-1",
    status: "published",
    snapshot: Object.entries(snapshot).map(([priceItemId, amount]) => ({
      priceItemId,
      amount,
    })),
    rules: {
      rounding: 10,
      minOrder: 1000,
      complexityPerExtraModule: 0.1,
      complexityMax: 2,
      bodyDepthReference: 60,
      bodyFactor: 1,
    },
    promos: [],
    signedAdjustments: [],
    baseSchema: 1,
    createdAt: NOW,
    createdBy: "test",
    publishedAt: NOW,
    publishedBy: "test",
    publishedSeq: 1,
    ...overrides,
  };
}

function simpleConfig(): KitchenConfig {
  const base = defaultKitchen();
  return {
    ...base,
    modules: [base.modules[0]!],
    plinth: false,
    underCabinetLighting: false,
    promoCode: "",
  };
}

interface Fixture {
  config: KitchenConfig;
  snapshot: Record<string, number>;
  catalogs: Record<string, unknown>[];
  presets: Record<string, unknown>[];
}

function successFixture(): Fixture {
  const config = simpleConfig();
  const catalogs = [
    catalog("bodyMaterial", "ldsp", {}, { ratePerSqm: "price.body" }),
    catalog("facadeMaterial", "mdf", {}, { ratePerSqm: "price.facade" }),
    catalog("facadeStyle", "flat", {}, { multiplier: "price.style" }),
    catalog("handle", "profile", {}, { rate: "price.handle" }),
    catalog(
      "countertop",
      "ldsp_hpl",
      { thicknesses: [38], defaultThickness: 38 },
      { ratePerLinearMeter: "price.counter" },
    ),
    catalog(
      "supportSystem",
      "standard",
      {
        edgeInsetCm: 4,
        maxSpanCm: 60,
        maxLoadKgPerLeg: 40,
        clipsPerLeg: 1,
        screwsPerLeg: 2,
        tallAnchorSpacingCm: 120,
        tallCenterLegWidthCm: 60,
        source: "preliminary",
      },
      {
        legPrice: "price.leg",
        clipPrice: "price.clip",
        screwPrice: "price.screw",
        anchorPrice: "price.anchor",
      },
    ),
  ];
  const presets = [preset("sink", "price.preset.sink")];
  const snapshot: Record<string, number> = {
    "price.body": 100,
    "price.facade": 200,
    "price.style": 1,
    "price.handle": 50,
    "price.counter": 300,
    "price.leg": 10,
    "price.clip": 2,
    "price.screw": 1,
    "price.anchor": 3,
    "price.preset.sink": 500,
  };
  return { config, snapshot, catalogs, presets };
}

function install(fixture: Fixture, versionOverrides: Record<string, unknown> = {}): void {
  writeCollection("catalog-items.json", fixture.catalogs);
  writeCollection("module-presets.json", fixture.presets);
  writeCollection("pricing-versions.json", [
    version(fixture.snapshot, versionOverrides),
  ]);
}

function projectFor(
  config: FurnitureConfig,
  pins: StoredProject["pins"],
  overrides: Record<string, unknown> = {},
): StoredProject {
  return {
    id: "abcdefgh",
    config,
    price: {} as StoredProject["price"],
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
    calcVersion: BUILD_CALC_VERSION,
    priceVersion: "price-1",
    rulesSnapshotId: TEST_RULES_SNAPSHOT_ID,
    pins,
    ...overrides,
  } as StoredProject;
}

describe("CA-T-304: DataResolver", () => {
  it("create: собирает inputs из Storage и возвращает pins", async () => {
    const fixture = successFixture();
    install(fixture);

    const result = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request.config).toBe(fixture.config);
    expect(result.value.request.schemaVersion).toBe(1);
    const manifest = getParameterManifest(BUILD_CALC_VERSION);
    expect(manifest.ok).toBe(true);
    expect(result.value.request.inputs.parameters).toEqual(
      manifest.ok ? manifest.manifest.parameters : {},
    );
    expect(result.value.request.inputs.catalogs).toHaveLength(6);
    expect(result.value.request.inputs.presets).toEqual([
      expect.objectContaining({ id: "sink", priceRef: "price.preset.sink" }),
    ]);
    expect(result.value.pins.catalogVersions?.supportSystem).toEqual({
      standard: "1",
    });
    expect(result.value.pins.presetVersions).toEqual({ kitchen: { sink: "1" } });
    expect(result.value.request.inputs.priceSnapshot.priceVersion).toBe(
      "price-1",
    );
  });

  async function recalcProject(
    fixture: Fixture,
    versions: Record<string, unknown>[],
    currentPriceVersionId: string,
  ): Promise<StoredProject> {
    install(fixture);
    const created = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    if (!created.ok) throw new Error("Не удалось собрать pins для теста");
    writeCollection("pricing-versions.json", versions);
    return projectFor(fixture.config, created.value.pins, {
      priceVersion: currentPriceVersionId,
    });
  }

  it("recalculate: разрешает более новую published target", async () => {
    const fixture = successFixture();
    const current = version(fixture.snapshot, {
      id: "price-1",
      publishedSeq: 1,
    });
    const target = version(fixture.snapshot, {
      id: "price-2",
      publishedSeq: 2,
    });
    const project = await recalcProject(fixture, [current, target], "price-1");

    const result = await resolveCalculationInputs({
      operation: "recalculate",
      project,
      targetPriceVersionId: "price-2",
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request.inputs.priceSnapshot.priceVersion).toBe(
      "price-2",
    );
  });

  it("recalculate: блокирует draft target", async () => {
    const fixture = successFixture();
    const current = version(fixture.snapshot, {
      id: "price-1",
      publishedSeq: 1,
    });
    const target = version(fixture.snapshot, {
      id: "price-2",
      status: "draft",
      publishedSeq: 2,
    });
    const project = await recalcProject(fixture, [current, target], "price-1");

    const result = await resolveCalculationInputs({
      operation: "recalculate",
      project,
      targetPriceVersionId: "price-2",
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE")).toBe(true);
  });

  it("recalculate: блокирует superseded target", async () => {
    const fixture = successFixture();
    const current = version(fixture.snapshot, {
      id: "price-1",
      publishedSeq: 1,
    });
    const target = version(fixture.snapshot, {
      id: "price-2",
      status: "superseded",
      publishedSeq: 2,
    });
    const project = await recalcProject(fixture, [current, target], "price-1");

    const result = await resolveCalculationInputs({
      operation: "recalculate",
      project,
      targetPriceVersionId: "price-2",
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE")).toBe(true);
  });

  it("recalculate: блокирует более старую published target", async () => {
    const fixture = successFixture();
    const older = version(fixture.snapshot, {
      id: "price-1",
      publishedSeq: 1,
    });
    const current = version(fixture.snapshot, {
      id: "price-2",
      publishedSeq: 2,
    });
    const project = await recalcProject(fixture, [older, current], "price-2");

    const result = await resolveCalculationInputs({
      operation: "recalculate",
      project,
      targetPriceVersionId: "price-1",
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-2",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "ENGINE_CONTRACT_PRICE_VERSION_TARGET_MISMATCH")).toBe(true);
  });

  it("recalculate: блокирует target без publishedSeq", async () => {
    const fixture = successFixture();
    const current = version(fixture.snapshot, {
      id: "price-1",
      publishedSeq: 1,
    });
    const target = version(fixture.snapshot, {
      id: "price-2",
      publishedSeq: undefined,
    });
    const project = await recalcProject(fixture, [current, target], "price-1");

    const result = await resolveCalculationInputs({
      operation: "recalculate",
      project,
      targetPriceVersionId: "price-2",
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE")).toBe(true);
  });

  it("recalculate: проверяет версии, pins и не меняет config/pins проекта", async () => {
    const fixture = successFixture();
    install(fixture);
    const created = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const project = projectFor(fixture.config, created.value.pins);
    const before = structuredClone(project);
    const result = await resolveCalculationInputs({
      operation: "recalculate",
      project,
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pins).toEqual(before.pins);
    expect(result.value.request.config).toEqual(before.config);
    expect(project).toEqual(before);
  });

  it("legacy без priceVersion блокируется и не получает текущую версию", async () => {
    const fixture = successFixture();
    install(fixture);
    const created = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const project = projectFor(fixture.config, created.value.pins, {
      priceVersion: undefined,
    });
    const result = await resolveCalculationInputs({
      operation: "recalculate",
      project,
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((item) => item.code)).toContain(
      "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE",
    );
  });

  it("calcVersion: отсутствие и несовпадения блокируются раздельно", async () => {
    const fixture = successFixture();
    install(fixture);
    const created = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    if (!created.ok) throw new Error("fixture");

    const unknown = await resolveCalculationInputs({
      operation: "recalculate",
      project: projectFor(fixture.config, created.value.pins, {
        calcVersion: undefined,
      }),
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.issues.map((item) => item.code)).toContain(
        "ENGINE_CONTRACT_CALC_VERSION_UNKNOWN",
      );
    }

    const projectMismatch = await resolveCalculationInputs({
      operation: "recalculate",
      project: projectFor(fixture.config, created.value.pins),
      expectedProjectCalcVersion: "calc-other",
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });
    expect(projectMismatch.ok).toBe(false);
    if (!projectMismatch.ok) {
      expect(projectMismatch.issues.map((item) => item.code)).toContain(
        "ENGINE_CONTRACT_PROJECT_CALC_VERSION_MISMATCH",
      );
    }

    const executedMismatch = await resolveCalculationInputs({
      operation: "recalculate",
      project: projectFor(fixture.config, created.value.pins),
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: "calc-other",
      expectedSourcePriceVersion: "price-1",
    });
    expect(executedMismatch.ok).toBe(false);
    if (!executedMismatch.ok) {
      expect(executedMismatch.issues.map((item) => item.code)).toContain(
        "ENGINE_CONTRACT_EXECUTED_CALC_VERSION_MISMATCH",
      );
    }
  });

  it("неизвестный calcVersion не получает параметры fallback", async () => {
    const fixture = successFixture();
    install(fixture);
    const created = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    if (!created.ok) throw new Error("fixture");

    const result = await resolveCalculationInputs({
      operation: "recalculate",
      project: projectFor(fixture.config, created.value.pins, {
        calcVersion: "calc-unknown",
      }),
      expectedProjectCalcVersion: "calc-unknown",
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ENGINE_CONTRACT_MISSING_INPUT",
          path: "inputs.parameters",
          entityId: "calc-unknown",
        }),
      ]),
    );
  });

  it("schemaVersion: отсутствие нормализуется один раз, невалидный — fail-closed", async () => {
    expect(
      normalizeSchemaVersion({ config: simpleConfig() }).value,
    ).toBe(1);
    expect(normalizeSchemaVersion({ schemaVersion: 2 }).value).toBe(2);
    expect(
      normalizeSchemaVersion({ schemaVersion: 3 }).issue?.code,
    ).toBe("ENGINE_CONTRACT_INCOMPATIBLE_SCHEMA");
    expect(
      normalizeSchemaVersion({
        project: { schemaVersion: 0 } as StoredProject,
      }).issue?.code,
    ).toBe("ENGINE_CONTRACT_INCOMPATIBLE_SCHEMA");
  });

  it("pins: отсутствие и недоступная версия блокируются", async () => {
    const fixture = successFixture();
    install(fixture);
    const created = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    if (!created.ok) throw new Error("fixture");

    const noPins = await resolveCalculationInputs({
      operation: "recalculate",
      project: projectFor(fixture.config, undefined),
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });
    expect(noPins.ok).toBe(false);
    if (!noPins.ok) {
      expect(noPins.issues.map((item) => item.code)).toContain(
        "ENGINE_CONTRACT_PINS_UNRESOLVED",
      );
    }

    const badPins = structuredClone(created.value.pins);
    badPins.catalogVersions!.bodyMaterial!.ldsp = "2";
    const versionMismatch = await resolveCalculationInputs({
      operation: "recalculate",
      project: projectFor(fixture.config, badPins),
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });
    expect(versionMismatch.ok).toBe(false);
    if (!versionMismatch.ok) {
      expect(versionMismatch.issues.map((item) => item.code)).toContain(
        "ENGINE_CONTRACT_REFERENCE_VERSION_UNAVAILABLE",
      );
    }
  });

  it("legacy без body pin: пересчёт берёт active LDSP, не меняя pins", async () => {
    const fixture = successFixture();
    install(fixture);
    const created = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    if (!created.ok) throw new Error("fixture");

    const legacyPins = structuredClone(created.value.pins);
    delete legacyPins.catalogVersions!.bodyMaterial;
    const result = await resolveCalculationInputs({
      operation: "recalculate",
      project: projectFor(fixture.config, legacyPins),
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.value.request.inputs.catalogs.find(
      (item) => item.catalog === "bodyMaterial",
    );
    expect(body?.id).toBe("ldsp");
    expect(result.value.pins.catalogVersions?.bodyMaterial).toBeUndefined();
  });

  it("CA-516-02: архивная запись не попадает в новые выборки (create)", async () => {
    const fixture = successFixture();
    fixture.catalogs = fixture.catalogs.map((item) =>
      item.catalog === "facadeMaterial" && item.id === "mdf"
        ? { ...item, status: "archived" }
        : item,
    );
    install(fixture);

    const result = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((item) => item.code)).toContain(
      "ENGINE_CONTRACT_REFERENCE_VERSION_UNAVAILABLE",
    );
  });

  it("CA-516-03: recalculate с legacy-фасадом блокируется в DataResolver", async () => {
    const fixture = successFixture();
    install(fixture);
    const created = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    if (!created.ok) throw new Error("fixture");

    const legacyConfig = {
      ...fixture.config,
      facadeMaterial: "veneer" as const,
    };
    const result = await resolveCalculationInputs({
      operation: "recalculate",
      project: projectFor(legacyConfig, created.value.pins),
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: "price-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("ENGINE_CONTRACT_LEGACY_FACADE_MATERIAL");
    expect(result.issues[0]?.path).toBe("config.facadeMaterial");
  });

  it("legacy priceRefs string[] не преобразуются автоматически", async () => {
    const fixture = successFixture();
    fixture.catalogs[0] = catalog(
      "bodyMaterial",
      "ldsp",
      {},
      {} as Record<string, string>,
      { priceRefs: ["price.body"] },
    );
    install(fixture);

    const result = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((item) => item.code)).toContain(
      "ENGINE_CONTRACT_UNKNOWN_ATTRIBUTE",
    );
  });

  it("не использует content/* при отсутствии записей Storage", async () => {
    const fixture = successFixture();
    writeCollection("catalog-items.json", []);
    writeCollection("module-presets.json", []);
    writeCollection("pricing-versions.json", [version(fixture.snapshot)]);

    const result = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((item) => item.code)).toContain(
      "ENGINE_CONTRACT_MISSING_INPUT",
    );
  });

  it("неизвестные attrs отклоняются", async () => {
    const fixture = successFixture();
    fixture.catalogs[0] = catalog(
      "bodyMaterial",
      "ldsp",
      { rate: 1 },
      { ratePerSqm: "price.body" },
    );
    install(fixture);

    const result = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((item) => item.code)).toContain(
      "ENGINE_CONTRACT_UNKNOWN_ATTRIBUTE",
    );
  });

  it("не читает live AdminParameter: parameters только из реестра операции", async () => {
    const fixture = successFixture();
    install(fixture);
    writeFileSync(
      path.join(dir, "admin-parameters.json"),
      JSON.stringify([
        {
          id: "led.endMarginCm",
          scope: "shared",
          category: "technological",
          group: "lighting",
          valueType: "int",
          value: 99,
          unit: "cm",
          min: 0,
          max: 100,
          sourceRef: "test",
          appliesTo: "all_read_paths",
          affects: {
            price: true,
            geometry: false,
            visualization: false,
            validation: false,
          },
          status: "active",
          editableInAdmin: false,
          version: "1",
          updatedAt: NOW,
          updatedBy: "test",
        },
      ]),
      "utf8",
    );

    const result = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.request.inputs.parameters["engine.lighting.endMarginCm"],
    ).toBe(2);
    expect(
      result.value.request.inputs.parameters["engine.lighting.endMarginCm"],
    ).not.toBe(99);
    rmSync(path.join(dir, "admin-parameters.json"), { force: true });
  });

  it("отсутствие пресета или published-версии — fail-closed", async () => {
    const fixture = successFixture();
    install(fixture);
    writeCollection("module-presets.json", []);

    const noPreset = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    expect(noPreset.ok).toBe(false);
    if (!noPreset.ok) {
      expect(noPreset.issues.map((item) => item.code)).toContain(
        "ENGINE_CONTRACT_MISSING_INPUT",
      );
    }

    writeCollection("module-presets.json", fixture.presets);
    writeCollection("pricing-versions.json", []);
    const noPrice = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
    });
    expect(noPrice.ok).toBe(false);
    if (!noPrice.ok) {
      expect(noPrice.issues.map((item) => item.code)).toContain(
        "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE",
      );
    }
  });

  it("plinth=true требует signedAdjustments без fallback", async () => {
    const fixture = successFixture();
    const config: KitchenConfig = {
      ...fixture.config,
      plinth: true,
      plinthMaterial: "ldsp",
      plinthFinish: "pvc04",
      plinthMount: "clips",
    };
    fixture.catalogs.push(
      catalog(
        "plinthMaterial",
        "ldsp",
        { thicknesses: [16], defaultThickness: 16, finishIds: ["pvc04"] },
        { ratePerMeter: "price.plinth" },
      ),
      catalog("plinthFinish", "pvc04", {}, {}),
      catalog("plinthMount", "clips", {}, {}),
    );
    fixture.snapshot["price.plinth"] = 100;
    install(fixture, { signedAdjustments: undefined });

    const result = await resolveCalculationInputs({
      operation: "create",
      config,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((item) => item.code)).toContain(
      "ENGINE_CONTRACT_REFERENCE_INTEGRITY",
    );
  });

  it("plinth=true с корректной signedAdjustment разрешается", async () => {
    const fixture = successFixture();
    const config: KitchenConfig = {
      ...fixture.config,
      plinth: true,
      plinthMaterial: "ldsp",
      plinthFinish: "pvc04",
      plinthMount: "clips",
    };
    fixture.catalogs.push(
      catalog(
        "plinthMaterial",
        "ldsp",
        { thicknesses: [16], defaultThickness: 16, finishIds: ["pvc04"] },
        { ratePerMeter: "price.plinth" },
      ),
      catalog("plinthFinish", "pvc04", {}, {}),
      catalog("plinthMount", "clips", {}, {}),
    );
    fixture.snapshot["price.plinth"] = 100;
    install(fixture, {
      signedAdjustments: [{ key: "plinth:ldsp:pvc04", amount: -120 }],
    });

    const result = await resolveCalculationInputs({
      operation: "create",
      config,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request.inputs.priceSnapshot.signedAdjustments).toEqual([
      { key: "plinth:ldsp:pvc04", amount: -120 },
    ]);
  });

  it("LED: выбирает strip по attrs и включает ledPsu", async () => {
    const fixture = successFixture();
    const config: KitchenConfig = {
      ...fixture.config,
      underCabinetLighting: true,
    };
    fixture.catalogs.push(
      catalog("ledProfile", "surface", {}, { ratePerMeter: "price.profile" }),
      catalog("ledDiffuser", "frosted", {}, { ratePerMeter: "price.diffuser" }),
      catalog("ledControl", "switch", {}, { price: "price.control" }),
      catalog(
        "ledStrip",
        "strip-24-96",
        {
          power: 9.6,
          voltage: 24,
          maxContinuousRunM: 10,
          voltageDropPct: 5,
          maxPsuW: 100,
          source: "preliminary",
        },
        { pricePerMeter: "price.strip" },
      ),
      catalog("ledPsu", "100", { watt: 100 }, { price: "price.psu" }),
    );
    fixture.snapshot["price.profile"] = 10;
    fixture.snapshot["price.diffuser"] = 5;
    fixture.snapshot["price.control"] = 20;
    fixture.snapshot["price.strip"] = 7;
    fixture.snapshot["price.psu"] = 30;
    install(fixture);

    const result = await resolveCalculationInputs({
      operation: "create",
      config,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.request.inputs.catalogs.filter(
        (item) => item.catalog === "ledStrip",
      ),
    ).toEqual([expect.objectContaining({ id: "strip-24-96" })]);
    expect(result.value.pins.catalogVersions?.ledPsu).toEqual({ "100": "1" });
  });

  it("target published обязателен для create и не подменяется", async () => {
    const fixture = successFixture();
    install(fixture);

    const result = await resolveCalculationInputs({
      operation: "create",
      config: fixture.config,
      targetPriceVersionId: "price-other",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((item) => item.code)).toContain(
      "ENGINE_CONTRACT_PRICE_VERSION_TARGET_MISMATCH",
    );
  });

  describe("ADR-07: снимок управляемых правил (Slice 2)", () => {
    async function resolveCreate(
      fixture: ReturnType<typeof successFixture>,
    ) {
      return resolveCalculationInputs({ operation: "create", config: fixture.config });
    }

    it("create: активный опубликованный снимок попадает в пятую группу", async () => {
      const fixture = successFixture();
      install(fixture);

      const result = await resolveCreate(fixture);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rulesSnapshot = result.value.request.inputs.rulesSnapshot;
      expect(rulesSnapshot?.rulesSnapshotId).toBe(TEST_RULES_SNAPSHOT_ID);
      expect(rulesSnapshot?.rules.length).toBeGreaterThanOrEqual(27);
      expect(rulesSnapshot?.rules.every((rule) => rule.status === "published")).toBe(true);
      expect(
        rulesSnapshot?.rules.some((rule) => rule.id === "rule-wardrobe-facade-density-16"),
      ).toBe(true);
    });

    it("create без опубликованного снимка → RULES_SNAPSHOT_MISSING, без подстановки", async () => {
      const fixture = successFixture();
      install(fixture);

      const file = path.join(dir, "rules-snapshots.json");
      const saved = readFileSync(file, "utf8");
      rmSync(file, { force: true });
      try {
        const result = await resolveCreate(fixture);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.issues.map((item) => item.code)).toContain(
          "RULES_SNAPSHOT_MISSING",
        );
        expect(result.issues.some((item) => /пустого набора/.test(item.message))).toBe(
          true,
        );
      } finally {
        writeFileSync(file, saved, "utf8");
      }
    });

    it("recalculate: использует закреплённый snapshot и фиксирует его в inputs", async () => {
      const fixture = successFixture();
      const current = version(fixture.snapshot, { id: "price-1", publishedSeq: 1 });
      const project = await recalcProject(fixture, [current], "price-1");

      const result = await resolveCalculationInputs({
        operation: "recalculate",
        project,
        expectedProjectCalcVersion: BUILD_CALC_VERSION,
        requiredExecutedCalcVersion: BUILD_CALC_VERSION,
        expectedSourcePriceVersion: "price-1",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.request.inputs.rulesSnapshot?.rulesSnapshotId).toBe(
        TEST_RULES_SNAPSHOT_ID,
      );
    });

    it("recalculate legacy без rulesSnapshotId → RULES_SNAPSHOT_MISSING, проект не мутируется", async () => {
      const fixture = successFixture();
      const current = version(fixture.snapshot, { id: "price-1", publishedSeq: 1 });
      const withPin = await recalcProject(fixture, [current], "price-1");
      const legacy = { ...withPin, rulesSnapshotId: undefined };
      const before = JSON.parse(JSON.stringify(legacy));

      const result = await resolveCalculationInputs({
        operation: "recalculate",
        project: legacy,
        expectedProjectCalcVersion: BUILD_CALC_VERSION,
        requiredExecutedCalcVersion: BUILD_CALC_VERSION,
        expectedSourcePriceVersion: "price-1",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues.map((item) => item.code)).toContain("RULES_SNAPSHOT_MISSING");
      expect(legacy).toEqual(before);
      // Историческое чтение (поля проекта/сохранённого результата) доступно.
      expect(legacy.price).toBeDefined();
      expect(legacy.priceVersion).toBe("price-1");
    });

    it("recalculate с неизвестным rulesSnapshotId → RULES_SNAPSHOT_UNKNOWN", async () => {
      const fixture = successFixture();
      const current = version(fixture.snapshot, { id: "price-1", publishedSeq: 1 });
      const project = await recalcProject(fixture, [current], "price-1");

      const result = await resolveCalculationInputs({
        operation: "recalculate",
        project: { ...project, rulesSnapshotId: "rules-missing" },
        expectedProjectCalcVersion: BUILD_CALC_VERSION,
        requiredExecutedCalcVersion: BUILD_CALC_VERSION,
        expectedSourcePriceVersion: "price-1",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues.map((item) => item.code)).toContain("RULES_SNAPSHOT_UNKNOWN");
    });

    it("повреждённый файл снимков → RULES_SNAPSHOT_CORRUPT", async () => {
      const fixture = successFixture();
      install(fixture);
      const file = path.join(dir, "rules-snapshots.json");
      const saved = readFileSync(file, "utf8");
      writeFileSync(file, "{broken", "utf8");
      try {
        const result = await resolveCreate(fixture);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.issues.map((item) => item.code)).toContain(
          "RULES_SNAPSHOT_CORRUPT",
        );
      } finally {
        writeFileSync(file, saved, "utf8");
      }
    });

    it("изменение исходного правила после публикации не меняет расчётный снимок", async () => {
      const fixture = successFixture();
      install(fixture);
      const snapshot = rulesSnapshotFixture();
      const original = (snapshot.rules as Array<Record<string, unknown>>)[0];
      writeCollection("managed-rules.json", [{ ...original, value: 99 }]);
      try {
        const result = await resolveCreate(fixture);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.request.inputs.rulesSnapshot?.rules[0].value).toBe(2);
      } finally {
        rmSync(path.join(dir, "managed-rules.json"), { force: true });
      }
    });

    it("смена active snapshot не меняет закреплённый snapshot проекта", async () => {
      const fixture = successFixture();
      install(fixture);
      const second = rulesSnapshotFixture() as {
        id: string;
        publishedSeq: number;
        rules: Array<Record<string, unknown>>;
        contentHash: string;
      };
      second.id = "rules-active-2";
      second.publishedSeq = 2;
      second.rules = second.rules.map((rule) =>
        String(rule.id).endsWith("-count")
          ? { ...rule, value: Number(rule.value) + 1 }
          : rule,
      );
      second.contentHash = rulesSnapshotContentHash(second.rules);
      writeCollection("rules-snapshots.json", [rulesSnapshotFixture(), second]);
      try {
        const created = await resolveCreate(fixture);
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        expect(created.value.request.inputs.rulesSnapshot?.rulesSnapshotId).toBe(
          "rules-active-2",
        );

        const current = version(fixture.snapshot, { id: "price-1", publishedSeq: 1 });
        const project = await recalcProject(fixture, [current], "price-1");
        const recalculated = await resolveCalculationInputs({
          operation: "recalculate",
          project,
          expectedProjectCalcVersion: BUILD_CALC_VERSION,
          requiredExecutedCalcVersion: BUILD_CALC_VERSION,
          expectedSourcePriceVersion: "price-1",
        });
        expect(recalculated.ok).toBe(true);
        if (!recalculated.ok) return;
        expect(
          recalculated.value.request.inputs.rulesSnapshot?.rulesSnapshotId,
        ).toBe(TEST_RULES_SNAPSHOT_ID);
      } finally {
        writeCollection("rules-snapshots.json", [rulesSnapshotFixture()]);
      }
    });
  });
});
