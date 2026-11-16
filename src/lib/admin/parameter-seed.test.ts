import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBootstrap, buildBootstrapPlan } from "./bootstrap";
import { buildAdminParameterSeeds, diagnoseAdminParameterSeeds } from "./parameter-seed";
import { getParameter, updateParameterValue } from "./parameters";
import type { AdminParameter } from "./schema";
import { readCollection, updateCollection } from "@/lib/server/store";

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-param-seed-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("Stage 8 / Block 3: parameter registry и seed", () => {
  it("реестр покрывает кухню и шкаф, ID уникальны", () => {
    const seeds = buildAdminParameterSeeds({ now: "2026-11-12T00:00:00.000Z" });
    expect(seeds.length).toBeGreaterThan(40);
    expect(new Set(seeds.map((item) => item.id)).size).toBe(seeds.length);
    expect(seeds.some((item) => item.scope === "kitchen")).toBe(true);
    expect(seeds.some((item) => item.scope === "wardrobe")).toBe(true);
    expect(seeds.every((item) => item.editableInAdmin === false)).toBe(true);
    expect(
      seeds
        .filter((item) => item.affects.price && item.affects.geometry)
        .every(
          (item) =>
            (item.category === "geometric" || item.category === "technological") &&
            item.status === "readonly" &&
            item.editableInAdmin === false,
        ),
    ).toBe(true);
  });

  it("bootstrap plan содержит параметры, apply создаёт их и повторно не перезаписывает", async () => {
    const plan = buildBootstrapPlan("2026-11-12T00:00:00.000Z", {
      pricingVersionId: "price-param-seed.1",
    });
    expect(plan.adminParameters.length).toBeGreaterThan(40);
    await applyBootstrap({
      pricingVersionId: "price-param-seed.1",
      now: "2026-11-12T00:00:00.000Z",
    });
    const before = await readCollection<AdminParameter>("admin-parameters.json");
    expect(before.length).toBe(plan.adminParameters.length);
    const first = before[0]!;
    await updateCollection<AdminParameter, void>("admin-parameters.json", (items) => ({
      items: items.map((item) =>
        item.id === first.id ? { ...item, updatedBy: "manual-test" } : item,
      ),
      result: undefined,
    }));
    await applyBootstrap({
      pricingVersionId: "price-param-seed.1",
      now: "2026-11-13T00:00:00.000Z",
    });
    const after = await readCollection<AdminParameter>("admin-parameters.json");
    expect(after.find((item) => item.id === first.id)?.updatedBy).toBe("manual-test");
  });

  it("readonly-параметр нельзя изменить через сервис", async () => {
    const seed = buildAdminParameterSeeds({ now: "2026-11-12T00:00:00.000Z" })[0]!;
    const current = await getParameter(seed.id);
    expect(current).toBeDefined();
    await expect(
      updateParameterValue(seed.id, {
        value: typeof current!.value === "number" ? current!.value + 1 : current!.value,
        expectedVersion: current!.version,
      }, { actorId: "test", actorRole: "calc-admin" }),
    ).rejects.toThrow(/геометрического|редактируется|readonly/);
  });

  it("диагностирует неизвестные и несовместимые записи", () => {
    const seeds = buildAdminParameterSeeds({ now: "2026-11-12T00:00:00.000Z" });
    const existing = [
      { ...seeds[0]!, id: "unknown.param" },
      { ...seeds[1]!, scope: "wardrobe" as const },
    ];
    const report = diagnoseAdminParameterSeeds(existing, seeds);
    expect(report.unknownIds).toContain("unknown.param");
    expect(report.incompatible.some((item) => item.id === seeds[1]!.id)).toBe(true);
  });
});
