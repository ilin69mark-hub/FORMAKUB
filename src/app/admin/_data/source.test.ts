import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import { seedDisplayMetadata } from "@/lib/admin/display-metadata";
import { buildAdminParameterSeeds } from "@/lib/admin/parameter-seed";
import { getAdminOverview } from "./source";

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-overview-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-overview.1",
    pricingLabel: "overview test",
    now: "2026-11-12T00:00:00.000Z",
  });
  await seedDisplayMetadata({ actorId: "test", actorRole: "system" });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("Admin Overview: реальные данные", () => {
  it("читает counters, published version и параметры из сервисов", async () => {
    const overview = await getAdminOverview();
    expect(overview.errors).toEqual([]);
    expect(overview.counters.find((item) => item.label === "Параметры")?.value).toBe(
      String(buildAdminParameterSeeds().length),
    );
    expect(overview.counters.find((item) => item.label === "Справочники")?.value).not.toBe("42");
    expect(overview.counters.find((item) => item.label === "Позиции прайса")?.value).toBeTruthy();
    expect(overview.currentPriceVersion?.id).toBe("price-overview.1");
    expect(overview.recalculations.queued).toBe(0);
    expect(overview.recentEvents).toBeInstanceOf(Array);
  });

  it("не использует mock-значения", () => {
    const source = String(getAdminOverview);
    expect(source).not.toContain("MOCK_OVERVIEW");
  });
});
