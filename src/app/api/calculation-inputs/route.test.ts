import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/calculation-inputs/route";
import { applyBootstrap } from "@/lib/admin/bootstrap";
import { seedDisplayMetadata } from "@/lib/admin/display-metadata";
import { defaultKitchen } from "@/lib/configurator/defaults";
import { BUILD_CALC_VERSION } from "@/lib/configurator/versions";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";
import { readCollection, updateCollection } from "@/lib/server/store";

let dir = "";
let pins: unknown;

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/calculation-inputs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function collections(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of [
    "price-items.json",
    "catalog-items.json",
    "module-presets.json",
    "pricing-versions.json",
    "projects.json",
  ]) {
    result[name] = JSON.stringify(await readCollection(name));
  }
  return result;
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-delivery-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";

  await applyBootstrap({
    pricingVersionId: "price-2026.11.1",
    pricingLabel: "Начальный production import",
    now: "2026-11-09T00:00:00.000Z",
  });
  await seedDisplayMetadata({ actorId: "test", actorRole: "system" });
  await seedRulesSnapshotFixture();

  const resolved = await resolveCalculationInputs({
    operation: "create",
    config: defaultKitchen(),
  });
  if (!resolved.ok) throw new Error("Не удалось получить pins для теста");
  pins = resolved.value.pins;
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("CA-T-306C: read-only CalculationInputs endpoint", () => {
  it("успешно отдаёт готовые CalculationInputs без внутренних полей", async () => {
    const before = await collections();
    const response = await POST(
      jsonRequest({ operation: "preview", config: defaultKitchen() }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Object.keys(body).sort()).toEqual([
      "inputs",
      "ok",
      "price",
      "schemaVersion",
    ]);
    expect(body.schemaVersion).toBe(1);
    expect(body.price).toBeDefined();
    const inputs = body.inputs as {
      priceSnapshot: { priceVersion: string; signedAdjustments: unknown[] };
      catalogs: unknown[];
      presets: unknown[];
      parameters: Record<string, unknown>;
    };
    expect(inputs.priceSnapshot.priceVersion).toBe("price-2026.11.1");
    expect(inputs.catalogs.length).toBeGreaterThan(0);
    expect(inputs.presets.length).toBeGreaterThan(0);
    expect(inputs.parameters["engine.lighting.psuMargin"]).toBe(1.25);
    expect(inputs.priceSnapshot.signedAdjustments).toContainEqual({
      key: "plinth:ldsp:pvc04",
      amount: -120,
    });
    expect(body).not.toHaveProperty("pins");
    expect(body).not.toHaveProperty("calcVersion");
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);

    expect(await collections()).toEqual(before);
  });

  it("recalculate использует project и серверные version checks", async () => {
    const config = defaultKitchen();
    await updateCollection<Record<string, unknown>, void>("projects.json", (items) => ({
      items: [
        ...items,
        {
          id: "abcdefgh",
          config,
          price: {},
          createdAt: "2026-11-09T00:00:00.000Z",
          updatedAt: "2026-11-09T00:00:00.000Z",
          schemaVersion: 1,
          calcVersion: BUILD_CALC_VERSION,
          priceVersion: "price-2026.11.1",
          rulesSnapshotId: "rules-test-fixture",
          pins,
        },
      ],
      result: undefined,
    }));

    const response = await POST(
      jsonRequest({
        operation: "recalculate",
        projectId: "abcdefgh",
        expectedProjectCalcVersion: BUILD_CALC_VERSION,
        expectedSourcePriceVersion: "price-2026.11.1",
      }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      inputs?: { priceSnapshot: { priceVersion: string } };
    };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.inputs?.priceSnapshot.priceVersion).toBe("price-2026.11.1");
  });

  it("несовместимый calcVersion проекта — fail-closed", async () => {
    await updateCollection<Record<string, unknown>, void>("projects.json", (items) => ({
      items: items.map((item) =>
        item.id === "abcdefgh" ? { ...item, calcVersion: "calc-unknown" } : item,
      ),
      result: undefined,
    }));

    const response = await POST(
      jsonRequest({
        operation: "recalculate",
        projectId: "abcdefgh",
        expectedProjectCalcVersion: "calc-unknown",
        expectedSourcePriceVersion: "price-2026.11.1",
      }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      issues?: Array<{ code: string; path: string }>;
    };
    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(
      body.issues?.some(
        (issue) =>
          issue.code === "ENGINE_CONTRACT_MISSING_INPUT" &&
          issue.path === "inputs.parameters",
      ),
    ).toBe(true);
  });

  it("запрещает клиентскую подмену parameters/catalogs/priceSnapshot/calcVersion", async () => {
    for (const extra of [
      { parameters: { "engine.sink.minWidth": 1 } },
      { catalogs: [] },
      { priceSnapshot: {} },
      { calcVersion: "calc-unknown" },
      { requiredExecutedCalcVersion: "calc-unknown" },
    ]) {
      const response = await POST(
        jsonRequest({
          operation: "preview",
          config: defaultKitchen(),
          ...extra,
        }),
      );
      expect(response.status, JSON.stringify(extra)).toBe(422);
    }

    const response = await POST(
      jsonRequest({
        operation: "preview",
        config: defaultKitchen(),
        operationId: "client",
      }),
    );
    expect(response.status).toBe(422);
  });

  it("не принимает не-JSON и не пишет данные", async () => {
    const before = await collections();
    const response = await POST(
      new Request("http://localhost/api/calculation-inputs", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(415);
    expect(await collections()).toEqual(before);
  });

  it("клиентский хук не импортирует Admin/Storage/Registry/content", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/configurator/use-calculation-inputs.ts"),
      "utf8",
    );
    for (const forbidden of [
      "@/lib/server/data-resolver",
      "@/lib/server/parameter-registry",
      "@/lib/admin",
      "@/lib/server/store",
      "@/content",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

describe("E2: compositionVersionId через /api/calculation-inputs", () => {
  let publishedId = "";

  beforeAll(async () => {
    const { seedInitialCompositionDraft } = await import(
      "@/lib/admin/composition-seed"
    );
    const {
      getDraftComposition,
      getPublishedComposition,
      publishCompositionVersion,
      updateCompositionDraft,
    } = await import("@/lib/admin/composition");
    const actor = { actorId: "e2-test", actorRole: "admin" as const };
    await seedInitialCompositionDraft(actor);
    const draft = await getDraftComposition();
    if (!draft) throw new Error("composition draft не создан");
    const datasheet = await updateCompositionDraft(
      draft.id,
      {
        expectedVersion: draft.version,
        lines: draft.lines.map((line) => ({
          ...line,
          source: "datasheet" as const,
          confirmation: undefined,
        })),
      },
      actor,
    );
    await publishCompositionVersion(
      datasheet.id,
      { expectedVersion: datasheet.version, operationId: "e2-publish" },
      actor,
    );
    const published = await getPublishedComposition();
    if (!published) throw new Error("composition не опубликован");
    publishedId = published.id;
  });

  it("preview с pin возвращает compositionTrace и НЕ меняет итог Engine", async () => {
    const legacy = await POST(
      jsonRequest({ operation: "preview", config: defaultKitchen() }),
    );
    expect(legacy.status).toBe(200);
    const legacyBody = (await legacy.json()) as {
      price: { total: number };
      compositionTrace?: unknown;
    };

    const pinned = await POST(
      jsonRequest({
        operation: "preview",
        config: defaultKitchen(),
        compositionVersionId: publishedId,
      }),
    );
    expect(pinned.status).toBe(200);
    const body = (await pinned.json()) as {
      price: { total: number };
      compositionTrace?: {
        blocked: boolean;
        trace: { compositionVersionId: string } | null;
        issues: Array<{ severity: string; code: string }>;
      };
    };

    /* Trace вычислен после Engine и присутствует в ответе. */
    expect(body.compositionTrace).toBeDefined();
    /* Итог Engine идентичен запросу без pin (В-2, E2-инвариант). */
    expect(body.price.total).toBe(legacyBody.price.total);
    /* Отсутствие trace у legacy-запроса подтверждено в соседнем тесте. */
    expect(legacyBody.compositionTrace).toBeUndefined();
    /* Seed-состав содержит code-quantityRef → trace fail-closed, но расчёт жив. */
    expect(body.compositionTrace?.blocked).toBe(true);
    expect(body.compositionTrace?.trace).toBeNull();
    expect(body.compositionTrace?.issues.length).toBeGreaterThan(0);
    expect(
      body.compositionTrace?.issues.every((item) => item.severity === "error"),
    ).toBe(true);
  });

  it("legacy-запрос без pin не содержит compositionTrace (В-1)", async () => {
    const response = await POST(
      jsonRequest({ operation: "preview", config: defaultKitchen() }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("compositionTrace");
  });

  it("неизвестный compositionVersionId блокирует расчёт (422)", async () => {
    const response = await POST(
      jsonRequest({
        operation: "preview",
        config: defaultKitchen(),
        compositionVersionId: "does-not-exist",
      }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      ok: boolean;
      issues: Array<{ code: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.issues.map((item) => item.code)).toContain(
      "COMPOSITION_VERSION_UNKNOWN",
    );
  });
});

describe("E2: trace успешно строится (computed) через реальный API", () => {
  const computedId = "composition-e2-computed";
  let expectedAmount: number | null = null;

  beforeAll(async () => {
    const { compositionContentHash } = await import(
      "@/lib/admin/composition-hash"
    );
    const { getPublishedVersion } = await import("@/lib/admin/pricing");
    const { listPriceItems } = await import("@/lib/admin/price-items");
    const version = await getPublishedVersion();
    const snapshot = version?.snapshot ?? [];
    const snapshotIds = new Set(snapshot.map((entry) => entry.priceItemId));
    const priceItem = (await listPriceItems({ status: "active" })).find(
      (item) => item.unit === "RUB_PER_PCS" && snapshotIds.has(item.id),
    );
    if (!priceItem) throw new Error("нет активного тарифа RUB_PER_PCS");
    expectedAmount =
      snapshot.find((entry) => entry.priceItemId === priceItem.id)?.amount ??
      null;

    const now = "2026-11-16T00:00:00.000Z";
    const moduleTypes = [
      "base",
      "sink",
      "hob",
      "drawers",
      "wall",
      "tall",
      "oven",
      "bottle",
    ] as const;
    /* Минимальный состав: по строке на каждый кухонный тип модуля, все
       количества — `fixed` с разрешённой единицей `pcs`. */
    const lines = moduleTypes.map((moduleType, index) => ({
      id: `e2-line-${moduleType}`,
      moduleType,
      relation: "required" as const,
      priceItemId: priceItem.id,
      quantityRef: {
        kind: "fixed" as const,
        value: index + 2,
        unit: "pcs" as const,
      },
      sourceRef: `e2-fixture-${moduleType}`,
      source: "owner_confirmed" as const,
      confirmation: {
        by: "e2-test",
        at: now,
        reference: "e2 computed fixture",
      },
      notes: `e2 ${moduleType}`,
      sortOrder: index + 1,
    }));
    const contentHash = compositionContentHash(lines, undefined, undefined);
    const record = {
      id: computedId,
      schemaVersion: 1 as const,
      status: "published" as const,
      version: 1,
      lines,
      contentHash,
      createdAt: now,
      createdBy: "e2-test",
      updatedAt: now,
      updatedBy: "e2-test",
      publishedAt: now,
      publishedBy: "e2-test",
      publishedSeq: 99,
    };
    await updateCollection<Record<string, unknown>, void>(
      "composition-versions.json",
      (items) => ({
        items: [...items.filter((item) => item.id !== computedId), record],
        result: undefined,
      }),
    );
  });

  it("trace построен: fixed-количество и разрешённая пара единиц", async () => {
    const response = await POST(
      jsonRequest({
        operation: "preview",
        config: defaultKitchen(),
        compositionVersionId: computedId,
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      price: { total: number };
      compositionTrace: {
        blocked: boolean;
        trace: {
          compositionVersionId: string;
          lines: Array<{
            quantity: number | null;
            unit: string | null;
            amount: number | null;
            priceAmount: number | null;
            status: string;
          }>;
        } | null;
        issues: unknown[];
      };
    };
    expect(body.compositionTrace.blocked).toBe(false);
    expect(body.compositionTrace.trace).not.toBeNull();
    expect(body.compositionTrace.trace?.compositionVersionId).toBe(computedId);
    const lines = body.compositionTrace.trace?.lines ?? [];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.status).toBe("resolved");
      expect(typeof line.quantity).toBe("number");
      expect(line.quantity).toBeGreaterThan(0);
      expect(line.unit).toBe("pcs");
      /* pcs × RUB_PER_PCS — разрешённая пара (design §22.3). */
      expect(line.amount).toBe(expectedAmount);
      expect(line.priceAmount).toBe(
        expectedAmount === null
          ? null
          : (line.quantity as number) * expectedAmount,
      );
      expect(line.priceAmount).not.toBe(0);
    }

    const legacy = await POST(
      jsonRequest({ operation: "preview", config: defaultKitchen() }),
    );
    const legacyBody = (await legacy.json()) as { price: { total: number } };
    expect(body.price.total).toBe(legacyBody.price.total);
  });
});

describe("E3: повреждённый Composition не обходится preflight", () => {
  const corruptedId = "composition-e3-corrupt";
  const now = "2026-11-16T00:00:00.000Z";

  it("запись с неверным contentHash исключается → 422", async () => {
    await updateCollection<Record<string, unknown>, void>(
      "composition-versions.json",
      (items) => ({
        items: [
          ...items.filter((item) => item.id !== corruptedId),
          {
            id: corruptedId,
            schemaVersion: 1,
            status: "published",
            version: 1,
            lines: [
              {
                id: "e3-corrupt-line",
                moduleType: "base",
                relation: "required",
                priceItemId: "p1",
                quantityRef: { kind: "fixed", value: 1, unit: "pcs" },
                sourceRef: "e3-corrupt",
                source: "datasheet",
                sortOrder: 1,
              },
            ],
            /* Намеренно неверный хеш: запись должна быть отброшена. */
            contentHash: "0".repeat(64),
            createdAt: now,
            createdBy: "e3",
            updatedAt: now,
            updatedBy: "e3",
            publishedAt: now,
            publishedBy: "e3",
            publishedSeq: 96,
          },
        ],
        result: undefined,
      }),
    );

    const response = await POST(
      jsonRequest({
        operation: "preview",
        config: defaultKitchen(),
        compositionVersionId: corruptedId,
      }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      ok: boolean;
      issues: Array<{ code: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.issues.map((item) => item.code)).toContain(
      "COMPOSITION_VERSION_UNKNOWN",
    );
  });
});
