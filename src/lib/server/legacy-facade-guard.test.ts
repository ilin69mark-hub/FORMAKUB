import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { POST as calculationInputsPOST } from "@/app/api/calculation-inputs/route";
import { POST as leadsPOST } from "@/app/api/leads/route";
import { applyBootstrap } from "@/lib/admin/bootstrap";
import { seedDisplayMetadata } from "@/lib/admin/display-metadata";
import { defaultKitchen } from "@/lib/configurator/defaults";
import { LEGACY_FACADE_BLOCK_MESSAGE } from "@/lib/configurator/materials";
import { calculateKitchenPrice, calculatePrice } from "@/lib/configurator/pricing";
import type { KitchenConfig } from "@/lib/configurator/types";
import { BUILD_CALC_VERSION } from "@/lib/configurator/versions";
import { createLead } from "@/lib/server/leads";
import {
  calculatePriceFromInputs,
  getProject,
  recalculateProject,
  saveProject,
} from "@/lib/server/projects";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";
import { readCollection, readCollectionStatus, updateCollection } from "@/lib/server/store";

/**
 * Stage 9 / Block 7A — A18-1: барьер исторических фасадных материалов.
 *
 * Утверждённое правило владельца: `veneer` / `glass` / `solid` запрещены для
 * **новых** расчётов (create, preview, лиды, сохранение, пересчёт). Исторические
 * тарифы (11 800 / 14 400 / 18 600 ₽/м²) — справочные, в новые расчёты не
 * поступают, материал автоматически не подменяется. Чтение старых проектов и их
 * исторический PriceSnapshot сохраняются.
 *
 * Ожидаемые значения берутся из этого правила (отказ + единое сообщение
 * `LEGACY_FACADE_BLOCK_MESSAGE`), а не из наблюдения за реализацией.
 */

const LEGACY_MATERIALS = ["veneer", "glass", "solid"] as const;
const ALLOWED_MATERIALS = ["ldsp", "mdf", "mdf_pvc"] as const;
const PRICE_VERSION = "price-2026.11.1";

let dir = "";

const customer = {
  name: "Тест Тестов",
  contact: "+70000000000",
  preferredContact: "phone" as const,
  consent: true as const,
};

function legacyConfig(material: (typeof LEGACY_MATERIALS)[number]): KitchenConfig {
  return { ...defaultKitchen(), facadeMaterial: material };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function leadCount(): Promise<number> {
  const read = await readCollectionStatus<unknown>("leads.json");
  return read.status === "ok" ? read.items.length : 0;
}

async function projectSnapshot(): Promise<string> {
  const read = await readCollectionStatus<unknown>("projects.json");
  return read.status === "ok" ? JSON.stringify(read.items) : `status:${read.status}`;
}

/** Старый проект с историческим материалом: читается, но не пересчитывается. */
async function writeLegacyProject(
  id: string,
  material: (typeof LEGACY_MATERIALS)[number],
): Promise<void> {
  const project = {
    id,
    config: legacyConfig(material),
    price: calculatePrice(defaultKitchen()),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await updateCollection<Record<string, unknown>, void>("projects.json", (items) => ({
    items: [...items.filter((item) => item.id !== id), project],
    result: undefined,
  }));
}

async function storedPrice(id: string): Promise<string> {
  const items = await readCollection<{ id: string; price?: unknown }>("projects.json");
  return JSON.stringify(items.find((item) => item.id === id)?.price ?? null);
}

function recalcInput(projectId: string, operationId: string) {
  return {
    projectId,
    operationId,
    targetPriceVersionId: PRICE_VERSION,
    expectedProjectCalcVersion: BUILD_CALC_VERSION,
    requiredExecutedCalcVersion: BUILD_CALC_VERSION,
    expectedSourcePriceVersion: null,
  };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-block7a-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  await seedRulesSnapshotFixture();
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: PRICE_VERSION,
    pricingLabel: "Stage 9 Block 7A",
    now: "2026-11-12T00:00:00.000Z",
  });
  await seedDisplayMetadata({ actorId: "test", actorRole: "system" });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("A18-1: create/preview отклоняют исторические материалы до расчёта", () => {
  for (const material of LEGACY_MATERIALS) {
    it(`create с ${material} → контролируемый отказ`, async () => {
      const result = await resolveCalculationInputs({
        operation: "create",
        config: legacyConfig(material),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        code: "ENGINE_CONTRACT_LEGACY_FACADE_MATERIAL",
        path: "config.facadeMaterial",
        message: LEGACY_FACADE_BLOCK_MESSAGE,
      });
    });

    it(`preview с ${material} → контролируемый отказ`, async () => {
      const result = await resolveCalculationInputs({
        operation: "preview",
        config: legacyConfig(material),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0]?.code).toBe("ENGINE_CONTRACT_LEGACY_FACADE_MATERIAL");
      expect(result.issues[0]?.message).toBe(LEGACY_FACADE_BLOCK_MESSAGE);
    });
  }

  it("API /api/calculation-inputs (preview) → 422 без inputs и без price", async () => {
    const response = await calculationInputsPOST(
      jsonRequest("http://localhost/api/calculation-inputs", {
        operation: "preview",
        config: legacyConfig("glass"),
      }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body).not.toHaveProperty("inputs");
    expect(body).not.toHaveProperty("price");
    expect(JSON.stringify(body.issues)).toContain(
      "ENGINE_CONTRACT_LEGACY_FACADE_MATERIAL",
    );
  });

  it("разрешённые материалы продолжают рассчитываться (create и preview)", async () => {
    for (const material of ALLOWED_MATERIALS) {
      const config: KitchenConfig = { ...defaultKitchen(), facadeMaterial: material };
      const created = await resolveCalculationInputs({ operation: "create", config });
      expect(created.ok, `create ${material}`).toBe(true);

      const previewed = await resolveCalculationInputs({ operation: "preview", config });
      expect(previewed.ok, `preview ${material}`).toBe(true);
      if (!previewed.ok) continue;
      expect(previewed.value.request.inputs.priceSnapshot.snapshot.length).toBeGreaterThan(0);
    }
  });
});

describe("A18-1: лиды с историческим материалом не создаются", () => {
  for (const material of LEGACY_MATERIALS) {
    it(`лид с ${material} → отказ, лид не записан`, async () => {
      const before = await leadCount();
      const result = await createLead({
        config: legacyConfig(material),
        customer,
        source: "block7a-test",
        interest: "kitchen",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        path: "facadeMaterial",
        severity: "error",
        message: LEGACY_FACADE_BLOCK_MESSAGE,
      });
      expect(await leadCount()).toBe(before);
    });
  }

  it("API /api/leads → 422 и лид не записан", async () => {
    const before = await leadCount();
    const response = await leadsPOST(
      jsonRequest("http://localhost/api/leads", {
        config: legacyConfig("veneer"),
        customer,
        source: "block7a-test",
        interest: "kitchen",
      }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
    expect(await leadCount()).toBe(before);
  });

  it("лид с разрешённым материалом создаётся с расчётом (позитивный контроль)", async () => {
    const before = await leadCount();
    const result = await createLead({
      config: defaultKitchen(),
      customer,
      source: "block7a-test",
      interest: "kitchen",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.price).not.toBeNull();
    expect(result.lead.price?.total).toBeGreaterThan(0);
    expect(await leadCount()).toBe(before + 1);
  });
});

describe("A18-1: обход через альтернативные входные точки исключён", () => {
  it("все серверные точки нового расчёта отказывают единообразно", async () => {
    const config = legacyConfig("solid");

    // 1) единая сборка входов — прямой вызов сервиса (create и preview)
    for (const operation of ["create", "preview"] as const) {
      const resolved = await resolveCalculationInputs({ operation, config });
      expect(resolved.ok, operation).toBe(false);
      if (resolved.ok) continue;
      expect(resolved.issues[0]?.message).toBe(LEGACY_FACADE_BLOCK_MESSAGE);
    }

    // 2) HTTP: публичный калькулятор /api/calculation-inputs
    const calc = await calculationInputsPOST(
      jsonRequest("http://localhost/api/calculation-inputs", { operation: "create", config }),
    );
    expect(calc.status).toBe(422);

    // 3) лиды: сервис и HTTP
    const lead = await createLead({ config, customer, source: "block7a-test", interest: "kitchen" });
    expect(lead.ok).toBe(false);
    const leadHttp = await leadsPOST(
      jsonRequest("http://localhost/api/leads", {
        config,
        customer,
        source: "block7a-test",
        interest: "kitchen",
      }),
    );
    expect(leadHttp.status).toBe(422);

    // 4) сохранение нового проекта
    const saved = await saveProject({ config });
    expect(saved.ok).toBe(false);
    if (saved.ok) throw new Error("ожидался отказ saveProject");
    expect(saved.status).toBe(422);
    expect(saved.issues[0]?.code).toBe("CONFIG_INVALID");

    // 5) прямой вызов финального сервиса расчёта с вручную собраным request
    const allowed = await resolveCalculationInputs({
      operation: "create",
      config: defaultKitchen(),
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) throw new Error("не удалось получить входы");
    const bypass = await calculatePriceFromInputs({
      config,
      schemaVersion: allowed.value.request.schemaVersion,
      inputs: allowed.value.request.inputs,
    });
    expect(bypass.ok).toBe(false);
    if (bypass.ok) throw new Error("ожидался отказ calculatePriceFromInputs");
    expect(bypass.issues[0]?.code).toBe("ENGINE_CONTRACT_LEGACY_FACADE_MATERIAL");
    expect(bypass.issues[0]?.message).toBe(LEGACY_FACADE_BLOCK_MESSAGE);

    // 6) пересчёт существующего проекта
    await writeLegacyProject("b7a00001", "solid");
    const recalculated = await recalculateProject(recalcInput("b7a00001", "block7a-recalc-1"));
    expect(recalculated.ok).toBe(false);
    if (recalculated.ok) throw new Error("ожидался отказ recalculateProject");
    expect(recalculated.status).toBe(422);
    expect(recalculated.issues[0]?.code).toBe("LEGACY_FACADE_MATERIAL");
  });
});

describe("A18-1: старые проекты остаются доступными только для чтения", () => {
  const projectId = "b7a00002";

  it("чтение старого проекта с историческим материалом работает", async () => {
    await writeLegacyProject(projectId, "glass");

    const read = await getProject(projectId);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.project.config.kind).toBe("kitchen");
    expect((read.project.config as KitchenConfig).facadeMaterial).toBe("glass");
    // Цена возвращена из сохранённого снимка, а не пересчитана.
    expect(read.priceRecalculated).toBe(false);
    expect(read.project.price?.total).toBeGreaterThan(0);
    expect(await storedPrice(projectId)).toBe(JSON.stringify(read.project.price));
  });

  it("исторический PriceSnapshot при чтении не меняется", async () => {
    const before = await projectSnapshot();

    const read = await getProject(projectId);
    expect(read.status).toBe("ok");

    expect(await projectSnapshot()).toBe(before);
  });

  it("сохранение старого проекта запрещено, хранилище не изменилось", async () => {
    const before = await projectSnapshot();

    const saved = await saveProject({ config: legacyConfig("glass") });
    expect(saved.ok).toBe(false);
    if (saved.ok) throw new Error("ожидался отказ saveProject");
    expect(saved.status).toBe(422);
    expect(saved.issues[0]?.code).toBe("CONFIG_INVALID");

    expect(await projectSnapshot()).toBe(before);
  });

  it("чтение не зависит от legacy pricing: старый проект читается, а расчёт фасадов отказывается (Q-A17-2.3)", async () => {
    const id = "b7a00003";
    await writeLegacyProject(id, "veneer");
    const before = await projectSnapshot();

    // Чтение старого проекта: цена берётся из сохранённого снимка.
    const read = await getProject(id);
    expect(read.status).toBe("ok");
    if (read.status === "ok") {
      expect(read.priceRecalculated).toBe(false);
      expect(read.project.price?.total).toBeGreaterThan(0);
    }

    // Legacy-расчёт фасадов при этом даёт контролируемую ошибку (не 0 ₽),
    // поэтому чтение от него не зависит и historical PriceSnapshot цел.
    expect(() => calculateKitchenPrice(legacyConfig("veneer"))).toThrow(
      /нет действующего тарифа для facadeMaterial "veneer"/,
    );
    expect(await projectSnapshot()).toBe(before);
  });

  it("пересчёт старого проекта запрещён, цена не изменилась", async () => {
    const before = await projectSnapshot();
    const priceBefore = await storedPrice(projectId);

    const recalculated = await recalculateProject(recalcInput(projectId, "block7a-recalc-2"));
    expect(recalculated.ok).toBe(false);
    if (recalculated.ok) throw new Error("ожидался отказ recalculateProject");
    expect(recalculated.status).toBe(422);
    expect(recalculated.issues[0]?.code).toBe("LEGACY_FACADE_MATERIAL");

    expect(await projectSnapshot()).toBe(before);
    expect(await storedPrice(projectId)).toBe(priceBefore);
  });
});
