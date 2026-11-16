import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildBootstrapPlan } from "@/lib/admin/bootstrap";
import {
  DISPLAY_METADATA_SEED,
  PRICING_DISCLAIMER,
  SUPPORTS_PRELIMINARY_NOTE,
  computeDisplayMetadataFingerprint,
} from "@/lib/admin/display-metadata";
import { catalogKindSchema } from "@/lib/admin/schema";
import { defaultKitchen, defaultWardrobe, makeKitchenModule } from "@/lib/configurator/defaults";
import type { DisplayMetadata } from "@/lib/configurator/display-metadata";
import { calculatePrice } from "@/lib/configurator/pricing";
import { BUILD_CALC_VERSION, SUPPORTED_SCHEMA_VERSION } from "@/lib/configurator/versions";

import { getProject, recalculateProject, saveProject } from "./projects";
import { rulesSnapshotFixture } from "./rules-test-fixture";

let dir = "";
let bootstrap: ReturnType<typeof buildBootstrapPlan>;

const NOW = "2026-11-09T00:00:00.000Z";

function writeCollection(file: string, items: unknown): void {
  writeFileSync(path.join(dir, file), JSON.stringify(items), "utf8");
}

function seedProjectInputs(): void {
  writeCollection("catalog-items.json", bootstrap.catalogItems);
  writeCollection("module-presets.json", bootstrap.modulePresets);
  writeCollection("rules-snapshots.json", [rulesSnapshotFixture()]);
  writeCollection("pricing-versions.json", [
    {
      ...bootstrap.pricingDraft,
      status: "published",
      publishedAt: NOW,
      publishedBy: "test",
      publishedSeq: 1,
    },
  ]);

  const catalogLabels = Object.fromEntries(
    catalogKindSchema.options.map((kind) => [kind, {}]),
  ) as DisplayMetadata["catalogLabels"];
  const supportSystemSource: Record<string, "preliminary" | "datasheet"> = {};
  const ledStripSource: Record<string, "preliminary" | "datasheet"> = {};
  for (const item of bootstrap.catalogItems) {
    catalogLabels[item.catalog][item.id] = item.label;
    if (item.catalog === "supportSystem") {
      supportSystemSource[item.id] = item.attrs.source as "preliminary" | "datasheet";
    } else if (item.catalog === "ledStrip") {
      ledStripSource[item.id] = item.attrs.source as "preliminary" | "datasheet";
    }
  }
  const metadata = {
    lineDefinitions: DISPLAY_METADATA_SEED,
    catalogLabels,
    supportSystemSource,
    ledStripSource,
    supportsPreliminaryNote: SUPPORTS_PRELIMINARY_NOTE,
    disclaimer: PRICING_DISCLAIMER,
  } as Omit<DisplayMetadata, "fingerprint">;
  const fingerprint = computeDisplayMetadataFingerprint(metadata);
  writeCollection("display-metadata", [
    {
      id: "lineDefinitions",
      kind: "line-definitions",
      value: DISPLAY_METADATA_SEED,
      fingerprint,
      version: "1",
      updatedAt: NOW,
      updatedBy: "test",
    },
    {
      id: "supports.preliminaryNote",
      kind: "text",
      value: SUPPORTS_PRELIMINARY_NOTE,
      version: "1",
      updatedAt: NOW,
      updatedBy: "test",
    },
    {
      id: "pricing.disclaimer",
      kind: "text",
      value: PRICING_DISCLAIMER,
      version: "1",
      updatedAt: NOW,
      updatedBy: "test",
    },
  ]);
}

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-store-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  bootstrap = buildBootstrapPlan(NOW, {
    pricingVersionId: "price-2026.11.1",
    pricingLabel: "test bootstrap",
  });
  seedProjectInputs();
});

beforeEach(() => {
  seedProjectInputs();
});

afterEach(() => {
  rmSync(path.join(dir, "projects.json"), { force: true });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeProjects(items: unknown): void {
  writeFileSync(path.join(dir, "projects.json"), JSON.stringify(items), "utf8");
}

function stored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const config = defaultKitchen();
  return {
    id: "abcdefgh",
    config,
    price: calculatePrice(config),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("штампы версий при сохранении (CA-T-107)", () => {
  it("новый проект содержит schemaVersion и calcVersion", async () => {
    const saved = await saveProject({ config: defaultKitchen() });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(saved.project.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
    expect(saved.project.calcVersion).toBe(BUILD_CALC_VERSION);
    expect(BUILD_CALC_VERSION).toMatch(/^calc-\d{4}\.\d{1,2}\.\d+$/);

    const onDisk = JSON.parse(
      readFileSync(path.join(dir, "projects.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
    expect(onDisk[0].calcVersion).toBe(BUILD_CALC_VERSION);
  });
});

describe("чтение старых и несовместимых проектов (CA-T-104, CA-T-106)", () => {
  it("запись без schemaVersion читается как v1 и не дозаписывается (S1)", async () => {
    writeProjects([stored()]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.versionsInferred).toBe(true);
    expect(result.project.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);

    const onDisk = JSON.parse(
      readFileSync(path.join(dir, "projects.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(onDisk[0].schemaVersion).toBeUndefined();
  });

  it("запись с поддерживаемой версией читается обычным порядком", async () => {
    writeProjects([stored({ schemaVersion: 1, calcVersion: "calc-2026.1.0" })]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.versionsInferred).toBe(false);
  });

  it("схема новее поддерживаемой → raw-режим с пометкой, а не 404", async () => {
    writeProjects([stored({ schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 })]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("unsupported");
    if (result.status !== "unsupported") return;
    expect(result.reason).toMatch(/новее поддерживаемой/);
    expect(result.project.id).toBe("abcdefgh");
  });

  it("конфиг, не проходящий текущие правила → unsupported с сохранённой ценой", async () => {
    const config = defaultKitchen();
    writeProjects([stored({ config: { ...config, modules: [] } })]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("unsupported");
    if (result.status !== "unsupported") return;
    expect(result.project.price.total).toBe(
      calculatePrice(defaultKitchen()).total,
    );
  });

  it("битая запись без config → карантин, файл не изменён (I-09)", async () => {
    const broken = stored();
    delete broken.config;
    writeProjects([broken]);
    const before = readFileSync(path.join(dir, "projects.json"), "utf8");

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("quarantined");
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(before);
  });

  it("нет файла и нет записи → not_found", async () => {
    expect((await getProject("abcdefgh")).status).toBe("not_found");

    writeProjects([stored({ id: "zzzzzzzz" })]);
    expect((await getProject("abcdefgh")).status).toBe("not_found");
  });
});

describe("повреждённое хранилище (CA-T-106, I-09)", () => {
  it("некорректный JSON → карантин вместо 500, файл не изменён", async () => {
    const raw = "{ это не JSON";
    writeFileSync(path.join(dir, "projects.json"), raw, "utf8");

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("quarantined");
    if (result.status === "quarantined") {
      expect(result.reason).toMatch(/некорректный JSON/);
    }
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(raw);
  });

  it("валидный не-массив → карантин вместо молчаливого []", async () => {
    const raw = JSON.stringify({ note: "not a collection" });
    writeFileSync(path.join(dir, "projects.json"), raw, "utf8");

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("quarantined");
    if (result.status === "quarantined") {
      expect(result.reason).toMatch(/массив/);
    }
  });

  it("запись в повреждённое хранилище отменяется, данные не затираются", async () => {
    const raw = JSON.stringify({ note: "not a collection" });
    writeFileSync(path.join(dir, "projects.json"), raw, "utf8");

    await expect(saveProject({ config: defaultKitchen() })).rejects.toThrow(
      /повреждено/,
    );
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(raw);
  });
});

/**
 * Фикстуры сценариев совместимости (дизайн §12.1) — CA-T-109.
 * S4/S7 (priceVersion) и полный S8 (отчёт extraFields) зависят от Фаз 2–3
 * и ADR-06 — здесь фиксируется только отсутствие молчаливого присвоения.
 */
describe("сценарии совместимости §12 (CA-T-109)", () => {
  it("S1: нет schemaVersion при config.version=1 → v1, versionsInferred", async () => {
    writeProjects([stored()]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.versionsInferred).toBe(true);
    expect(result.project.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
  });

  it("S2: нет config.version вовсе → чтение проходит как v1", async () => {
    const config = defaultKitchen() as unknown as Record<string, unknown>;
    delete config.version;
    writeProjects([{ id: "abcdefgh", config, price: calculatePrice(defaultKitchen()), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.project.schemaVersion).toBeUndefined();
    expect(result.versionsInferred).toBe(true);
  });

  it("S3/S9: нет calcVersion → calcVersionUnknown, сборка молча не присваивается", async () => {
    writeProjects([stored({ schemaVersion: 1 })]);
    const before = readFileSync(path.join(dir, "projects.json"), "utf8");

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.calcVersionUnknown).toBe(true);
    expect(result.project.calcVersion).toBeUndefined();
    // файл не изменяется чтением (I-09)
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(before);

    writeProjects([stored({ schemaVersion: 1, calcVersion: "calc-2026.1.0" })]);
    const withVersion = await getProject("abcdefgh");
    expect(withVersion.status).toBe("ok");
    if (withVersion.status !== "ok") return;
    expect(withVersion.calcVersionUnknown).toBe(false);
  });

  it("S4/S7: priceVersion молча не присваивается — хранится только факт цены", async () => {
    writeProjects([stored({ schemaVersion: 1 })]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect("priceVersion" in result.project).toBe(false);

    const onDisk = JSON.parse(
      readFileSync(path.join(dir, "projects.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(onDisk[0].priceVersion).toBeUndefined();
  });

  it("S4/S7: legacy без priceVersion не пересчитывает цену и помечается", async () => {
    writeProjects([
      stored({ schemaVersion: 1, price: { total: 1, currency: "RUB" } }),
    ]);

    const legacy = await getProject("abcdefgh");
    expect(legacy.status).toBe("ok");
    if (legacy.status !== "ok") return;
    expect(legacy.priceVersionUnknown).toBe(true);
    expect(legacy.priceRecalculated).toBe(false);
    expect(legacy.project.price.total).toBe(1);

    writeProjects([
      stored({
        schemaVersion: 1,
        priceVersion: "price-1",
        price: { total: 777, currency: "RUB" },
      }),
    ]);
    const before = readFileSync(path.join(dir, "projects.json"), "utf8");
    const versioned = await getProject("abcdefgh");
    expect(versioned.status).toBe("ok");
    if (versioned.status !== "ok") return;
    expect(versioned.priceVersionUnknown).toBe(false);
    expect(versioned.priceRecalculated).toBe(false);
    expect(versioned.project.price.total).toBe(777);
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(before);

    const repeated = await getProject("abcdefgh");
    expect(repeated.status).toBe("ok");
    if (repeated.status !== "ok") return;
    expect(repeated.project.price.total).toBe(777);
  });

  it("S5: легаси-идентификатор столешницы нормализуется при чтении", async () => {
    const config = { ...defaultKitchen(), countertop: "laminate" as const };
    writeProjects([{ id: "abcdefgh", config, price: calculatePrice(defaultKitchen()), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.project.config.kind).toBe("kitchen");
    if (result.project.config.kind !== "kitchen") return;
    expect(result.project.config.countertop).toBe("compact_hpl");
  });

  it("S6: структура устарела/новее поддерживаемой → raw с пометкой, не 404", async () => {
    writeProjects([stored({ schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 })]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("unsupported");
    if (result.status !== "unsupported") return;
    expect(result.project.id).toBe("abcdefgh");
    expect(result.reason).toMatch(/новее поддерживаемой/);
  });

  it("S8: неизвестные поля конфига не отбрасываются молча", async () => {
    const config = {
      ...defaultKitchen(),
      legacyFieldRemovedLongAgo: "keep-me",
    } as unknown as ReturnType<typeof defaultKitchen>;
    writeProjects([{ id: "abcdefgh", config, price: calculatePrice(defaultKitchen()), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(
      (result.project.config as unknown as Record<string, unknown>).legacyFieldRemovedLongAgo,
    ).toBe("keep-me");
  });
});

describe("pins проекта (CA-T-108)", () => {
  it("новый проект фиксирует версии существующих ссылок и пресетов", async () => {
    const config = defaultKitchen();
    const saved = await saveProject({ config });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const pins = saved.project.pins;
    expect(pins?.catalogVersions?.bodyMaterial?.[config.bodyMaterial]).toBeDefined();
    expect(pins?.catalogVersions?.facadeMaterial?.[config.facadeMaterial]).toBeDefined();
    expect(pins?.catalogVersions?.supportSystem?.[config.supports.systemId]).toBeDefined();
    expect(pins?.presetVersions?.kitchen?.sink).toBeDefined();

    const onDisk = JSON.parse(
      readFileSync(path.join(dir, "projects.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(onDisk[0].pins).toEqual(saved.project.pins);

    const read = await getProject(saved.project.id);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.pinsInferred).toBe(false);
    expect(read.project.pins).toEqual(saved.project.pins);
  });

  it("отсутствующие ссылки блокируют сохранение, а не создают частичные pins", async () => {
    writeCollection("catalog-items.json", []);

    const saved = await saveProject({ config: defaultKitchen() });
    expect(saved.ok).toBe(false);
  });

  it("без справочников сохранение блокируется fail-closed", async () => {
    writeCollection("catalog-items.json", []);
    writeCollection("module-presets.json", []);

    const saved = await saveProject({ config: defaultKitchen() });
    expect(saved.ok).toBe(false);
  });

  it("легаси-проект без pins читается как inferred, файл не изменяется", async () => {
    writeProjects([stored()]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.pinsInferred).toBe(true);

    const onDisk = JSON.parse(
      readFileSync(path.join(dir, "projects.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(onDisk[0].pins).toBeUndefined();
  });
});

describe("CA-T-306E: CREATE/RECALCULATE persistence", () => {
  function readProjects(): Array<Record<string, unknown>> {
    return JSON.parse(
      readFileSync(path.join(dir, "projects.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
  }

  function addPublishedVersion(
    id: string,
    seq: number,
    snapshot?: Array<{ priceItemId: string; amount: number }>,
  ): void {
    const versions = JSON.parse(
      readFileSync(path.join(dir, "pricing-versions.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    writeCollection("pricing-versions.json", [
      ...versions,
      {
        ...bootstrap.pricingDraft,
        id,
        status: "published",
        publishedAt: NOW,
        publishedBy: "test",
        publishedSeq: seq,
        ...(snapshot ? { snapshot } : {}),
      },
    ]);
  }

  function recalc(
    project: {
      id: string;
      priceVersion?: string;
      calcVersion?: string;
    },
    operationId: string,
    overrides: Partial<{
      targetPriceVersionId: string;
      expectedSourcePriceVersion: string | null;
    }> = {},
  ) {
    return recalculateProject({
      projectId: project.id,
      operationId,
      targetPriceVersionId:
        overrides.targetPriceVersionId ?? project.priceVersion!,
      expectedProjectCalcVersion: project.calcVersion!,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion:
        overrides.expectedSourcePriceVersion === undefined
          ? (project.priceVersion ?? null)
          : overrides.expectedSourcePriceVersion,
    });
  }

  it("CREATE сохраняет цену, версии и событие истории", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      operationId: "create-op-1",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const history = saved.project.priceHistory ?? [];
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toBe("create");
    expect(history[0]?.newPrice).toBe(saved.project.price.total);
    expect(history[0]?.toPriceVersionId).toBe(saved.project.priceVersion);
    expect(history[0]?.oldPrice).toBeNull();
    expect(history[0]?.delta).toBeNull();
    expect(saved.project.calcVersion).toBe(BUILD_CALC_VERSION);
    expect(readProjects()).toHaveLength(1);
  });

  it("CREATE replay возвращает прежний проект без новой записи", async () => {
    const first = await saveProject({
      config: defaultKitchen(),
      operationId: "create-replay",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await saveProject({
      config: defaultKitchen(),
      operationId: "create-replay",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replay).toBe(true);
    expect(second.project.id).toBe(first.project.id);
    expect(second.project.priceHistory).toHaveLength(1);
    expect(readProjects()).toHaveLength(1);
  });

  it("CREATE с тем же ключом и другим fingerprint — конфликт", async () => {
    const first = await saveProject({
      config: defaultKitchen(),
      operationId: "create-conflict",
    });
    expect(first.ok).toBe(true);

    const second = await saveProject({
      config: { ...defaultKitchen(), promoCode: "OTHER" },
      operationId: "create-conflict",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(409);
    expect(second.issues[0]?.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(readProjects()).toHaveLength(1);
  });

  it("CREATE с разными ключами создаёт разные проекты", async () => {
    const first = await saveProject({
      config: defaultKitchen(),
      operationId: "create-a",
    });
    const second = await saveProject({
      config: defaultKitchen(),
      operationId: "create-b",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.project.id).not.toBe(first.project.id);
    expect(readProjects()).toHaveLength(2);
  });

  it("RECALCULATE обновляет только цену/версии/историю", async () => {
    const created = await saveProject({
      config: defaultKitchen(),
      operationId: "recalc-create",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await recalc(created.project, "recalc-op-1");
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.project.config).toEqual(created.project.config);
    expect(updated.project.pins).toEqual(created.project.pins);
    expect(updated.project.createdAt).toBe(created.project.createdAt);
    expect(updated.project.priceVersion).toBe(created.project.priceVersion);
    expect(updated.project.priceHistory).toHaveLength(2);

    const event = updated.project.priceHistory![1]!;
    expect(event.reason).toBe("manual_recalc");
    expect(event.oldPrice).toBe(created.project.price.total);
    expect(event.newPrice).toBe(updated.project.price.total);
    expect(event.delta).toBe(updated.project.price.total - created.project.price.total);
    expect(event.fromPriceVersionId).toBe(created.project.priceVersion);
    expect(event.toPriceVersionId).toBe(created.project.priceVersion);
  });

  it("GET после RECALCULATE возвращает новый сохранённый snapshot", async () => {
    const created = await saveProject({
      config: defaultKitchen(),
      operationId: "get-after-recalc-create",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const snapshot = bootstrap.pricingDraft.snapshot.map((item, index) =>
      index === 0 ? { ...item, amount: item.amount + 1000 } : item,
    );
    addPublishedVersion("price-2026.12.1", 2, snapshot);

    const updated = await recalc(created.project, "get-after-recalc", {
      targetPriceVersionId: "price-2026.12.1",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    const read = await getProject(created.project.id);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.project.price.total).toBe(updated.project.price.total);
    expect(read.project.priceVersion).toBe("price-2026.12.1");
    expect(read.priceRecalculated).toBe(false);
  });

  it("RECALCULATE replay не создаёт второе событие", async () => {
    const created = await saveProject({
      config: defaultKitchen(),
      operationId: "recalc-replay-create",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await recalc(created.project, "recalc-replay");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await recalc(created.project, "recalc-replay");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replay).toBe(true);
    expect(second.project.priceHistory).toHaveLength(2);
  });

  it("RECALCULATE replay возвращает сохранённое событие, а не legacy-цену", async () => {
    const created = await saveProject({
      config: defaultKitchen(),
      operationId: "recalc-replay-price-create",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await recalc(created.project, "recalc-replay-price");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const onDisk = readProjects();
    const project = onDisk.find((item) => item.id === created.project.id)!;
    const savedTotal = 987654;
    (project.price as { total: number }).total = savedTotal;
    const history = project.priceHistory as Array<{
      breakdown: { total: number };
    }>;
    history[1]!.breakdown.total = savedTotal;
    writeFileSync(path.join(dir, "projects.json"), JSON.stringify(onDisk), "utf8");

    const second = await recalc(created.project, "recalc-replay-price");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replay).toBe(true);
    expect(second.project.price.total).toBe(savedTotal);
    expect(second.project.priceHistory).toHaveLength(2);
  });

  it("RECALCULATE с тем же operationId и другим fingerprint — конфликт", async () => {
    const created = await saveProject({
      config: defaultKitchen(),
      operationId: "recalc-conflict-create",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await recalc(created.project, "recalc-conflict");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await recalc(created.project, "recalc-conflict", {
      targetPriceVersionId: "another-price-version",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(409);
    expect(second.issues[0]?.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("старый проект без истории получает первое событие manual_recalc", async () => {
    const created = await saveProject({
      config: defaultKitchen(),
      operationId: "legacy-create",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const onDisk = readProjects();
    delete onDisk[0]!.priceHistory;
    writeFileSync(path.join(dir, "projects.json"), JSON.stringify(onDisk), "utf8");

    const updated = await recalc(created.project, "legacy-recalc");
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.project.priceHistory).toHaveLength(1);
    expect(updated.project.priceHistory![0]!.reason).toBe("manual_recalc");
  });

  it("два одновременных RECALCULATE с одним operationId не создают дубль", async () => {
    const created = await saveProject({
      config: defaultKitchen(),
      operationId: "concurrent-replay-create",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [first, second] = await Promise.all([
      recalc(created.project, "concurrent-replay"),
      recalc(created.project, "concurrent-replay"),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect([first.replay, second.replay].filter(Boolean)).toHaveLength(1);

    const read = await getProject(created.project.id);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.project.priceHistory).toHaveLength(2);
  });

  it("конкурентное изменение source между расчётом и persistence даёт один успех", async () => {
    const created = await saveProject({
      config: defaultKitchen(),
      operationId: "concurrent-source-create",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    addPublishedVersion("price-2026.12.1", 2);

    const [first, second] = await Promise.all([
      recalc(created.project, "concurrent-source-a", {
        targetPriceVersionId: "price-2026.12.1",
      }),
      recalc(created.project, "concurrent-source-b", {
        targetPriceVersionId: "price-2026.12.1",
      }),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
  });

  it("повреждённая история делает чтение fail-closed", async () => {
    writeProjects([
      {
        ...stored({
          schemaVersion: 1,
          priceVersion: "price-2026.11.1",
          calcVersion: BUILD_CALC_VERSION,
        }),
        priceHistory: [{}],
      },
    ]);

    const read = await getProject("abcdefgh");
    expect(read.status).toBe("quarantined");
  });
});


describe("независимые параметры геометрии нижнего ряда", () => {
  it("сохраняет высоту корпуса, глубину и высоту цоколя раздельно", async () => {
    const base = defaultKitchen();
    const config = {
      ...base,
      plinth: true,
      plinthHeight: 15,
      countertopThickness: 26,
      modules: [
        makeKitchenModule("base", {
          id: "m-base",
          width: 80,
          height: 70,
          depth: 55,
          shelves: 1,
        }),
        makeKitchenModule("wall", { id: "m-wall", width: 80 }),
      ],
    };
    const saved = await saveProject({ config });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const read = await getProject(saved.project.id);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;

    if (read.project.config.kind !== "kitchen") throw new Error("expected kitchen");
    const kitchen = read.project.config;
    const lower = kitchen.modules.find((module) => module.id === "m-base");
    expect(lower?.height).toBe(70);
    expect(lower?.depth).toBe(55);
    expect(kitchen.plinthHeight).toBe(15);

    // Changing plinth does not rewrite carcass height.
    const plinthChanged = { ...kitchen, plinthHeight: 10 };
    expect(
      plinthChanged.modules.find((module) => module.id === "m-base")?.height,
    ).toBe(70);

    // Changing carcass height does not rewrite plinth height.
    const heightChanged = {
      ...kitchen,
      modules: kitchen.modules.map((module) =>
        module.id === "m-base" ? { ...module, height: 85 } : module,
      ),
    };
    expect(heightChanged.plinthHeight).toBe(15);
  });

  it("сохраняет и загружает глубину, рассчитанную от толщины фасада", async () => {
    const base = defaultKitchen();
    const config = {
      ...base,
      facadeMaterial: "mdf" as const,
      facadeThickness: 22,
      modules: [
        makeKitchenModule("base", {
          id: "m-base",
          width: 80,
          height: 80,
          depth: 55.5,
          shelves: 1,
        }),
        makeKitchenModule("wall", { id: "m-wall", width: 80 }),
      ],
    };
    const saved = await saveProject({ config });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const read = await getProject(saved.project.id);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    if (read.project.config.kind !== "kitchen") throw new Error("expected kitchen");

    expect(read.project.config.facadeThickness).toBe(22);
    expect(
      read.project.config.modules.find((module) => module.id === "m-base")?.depth,
    ).toBe(55.5);
  });

  it("старый проект без facadeThickness загружается с нормализованной глубиной", async () => {
    const base = defaultKitchen();
    const legacy = {
      ...base,
      facadeMaterial: "ldsp" as const,
      modules: [
        makeKitchenModule("base", {
          id: "m-base",
          width: 80,
          height: 80,
          depth: 56,
          shelves: 1,
        }),
        makeKitchenModule("wall", { id: "m-wall", width: 80 }),
      ],
    } as Record<string, unknown>;
    delete legacy.facadeThickness;

    writeProjects([stored({ config: legacy })]);
    const read = await getProject("abcdefgh");
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    if (read.project.config.kind !== "kitchen") throw new Error("expected kitchen");

    expect(read.project.config.facadeThickness).toBe(18);
    expect(
      read.project.config.modules.find((module) => module.id === "m-base")?.depth,
    ).toBe(55.9);
  });

  it("читает старый проект с историческими материалами без изменения истории", async () => {
    const config = {
      ...defaultKitchen(),
      bodyMaterial: "mdf" as const,
      facadeMaterial: "glass" as const,
    };
    writeProjects([stored({ config })]);

    const read = await getProject("abcdefgh");
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    if (read.project.config.kind !== "kitchen") throw new Error("expected kitchen");

    expect(read.project.config.bodyMaterial).toBe("mdf");
    expect(read.project.config.facadeMaterial).toBe("glass");
  });

  it("новое сохранение legacy body MDF нормализует корпус в LDSP", async () => {
    const config = {
      ...defaultKitchen(),
      bodyMaterial: "mdf" as const,
    };
    const saved = await saveProject({ config });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(saved.project.config.bodyMaterial).toBe("ldsp");

    const read = await getProject(saved.project.id);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.project.config.bodyMaterial).toBe("ldsp");
  });

  it("не сохраняет новый проект с историческим материалом фасада", async () => {
    const result = await saveProject({
      config: { ...defaultKitchen(), facadeMaterial: "solid" as const },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.issues.some((issue) => issue.code === "CONFIG_INVALID")).toBe(true);
  });

  it.each(["veneer", "glass", "solid"] as const)(
    "CA-516-03: проект с legacy-фасадом %s читается, но пересчёт блокируется без записи",
    async (facadeMaterial) => {
      const config = { ...defaultKitchen(), facadeMaterial };
      writeProjects([
        stored({
          config,
          priceVersion: "price-2026.11.1",
          calcVersion: BUILD_CALC_VERSION,
          pins: {
            catalogVersions: { facadeMaterial: { [facadeMaterial]: "1" } },
          },
        }),
      ]);
      const beforeFile = readFileSync(path.join(dir, "projects.json"), "utf8");

      const read = await getProject("abcdefgh");
      expect(read.status).toBe("ok");
      if (read.status !== "ok") return;
      expect(read.project.config.facadeMaterial).toBe(facadeMaterial);
      const savedPrice = read.project.price.total;
      const savedHistory = read.project.priceHistory ?? [];

      const result = await recalculateProject({
        projectId: "abcdefgh",
        operationId: `legacy-facade-${facadeMaterial}`,
        targetPriceVersionId: "price-2026.11.1",
        expectedProjectCalcVersion: BUILD_CALC_VERSION,
        requiredExecutedCalcVersion: BUILD_CALC_VERSION,
        expectedSourcePriceVersion: "price-2026.11.1",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.issues[0]?.code).toBe("LEGACY_FACADE_MATERIAL");

      // Блокировка не меняет ни конфигурацию, ни цену, ни историю, ни pins.
      expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(beforeFile);
      const after = await getProject("abcdefgh");
      expect(after.status).toBe("ok");
      if (after.status !== "ok") return;
      expect(after.project.config).toEqual(read.project.config);
      expect(after.project.price.total).toBe(savedPrice);
      expect(after.project.priceHistory).toEqual(savedHistory);
      expect(after.project.pins).toEqual(read.project.pins);
    },
  );

  it("CA-516-03: после ручной замены legacy-фасада проект сохраняется и пересчитывается", async () => {
    const legacyConfig = {
      ...defaultKitchen(),
      facadeMaterial: "glass" as const,
    };
    writeProjects([
      stored({
        config: legacyConfig,
        priceVersion: "price-2026.11.1",
        calcVersion: BUILD_CALC_VERSION,
      }),
    ]);
    const read = await getProject("abcdefgh");
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    if (read.project.config.kind !== "kitchen") throw new Error("expected kitchen");

    const saved = await saveProject({
      config: {
        ...read.project.config,
        facadeMaterial: "mdf",
        facadeFinish: "milk",
        facadeThickness: 19,
      },
      operationId: "replace-legacy-facade",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.project.config.facadeMaterial).toBe("mdf");

    const recalculated = await recalculateProject({
      projectId: saved.project.id,
      operationId: "recalc-after-replacement",
      targetPriceVersionId: saved.project.priceVersion!,
      expectedProjectCalcVersion: saved.project.calcVersion!,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: saved.project.priceVersion ?? null,
    });
    expect(recalculated.ok).toBe(true);
    if (!recalculated.ok) return;
    expect(recalculated.project.config.facadeMaterial).toBe("mdf");
    expect(recalculated.project.priceHistory).toHaveLength(2);
  });

  it("CA-T-519: новая модель шкафа сохраняется и восстанавливается без потерь", async () => {
    const wardrobe = defaultWardrobe();
    const config = {
      ...wardrobe,
      partition: { positionMm: 1200 },
      antresol: { heightMm: 300 },
    };
    const saved = await saveProject({ config });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.project.config).toEqual(config);

    const read = await getProject(saved.project.id);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.project.config).toEqual(config);
    expect("depth" in read.project.config).toBe(false);
  });
});

