import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { POST } from "@/app/api/projects/[id]/recalculate/route";
import { applyBootstrap } from "@/lib/admin/bootstrap";
import { seedDisplayMetadata } from "@/lib/admin/display-metadata";
import { defaultKitchen } from "@/lib/configurator/defaults";
import { BUILD_CALC_VERSION } from "@/lib/configurator/versions";
import { getProject, saveProject } from "@/lib/server/projects";

let dir = "";

function request(
  id: string,
  body: unknown,
  key?: string,
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== undefined) headers["Idempotency-Key"] = key;
  return new Request(`http://localhost/api/projects/${id}/recalculate`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-recalc-route-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  await seedRulesSnapshotFixture();
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-2026.11.1",
    pricingLabel: "test bootstrap",
    now: "2026-11-09T00:00:00.000Z",
  });
  await seedDisplayMetadata({ actorId: "test", actorRole: "system" });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("CA-T-306E: POST /api/projects/[id]/recalculate", () => {
  it("требует Idempotency-Key", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      operationId: "recalc-route-create-0",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const response = await POST(
      request(
        saved.project.id,
        {
          targetPriceVersionId: saved.project.priceVersion,
          expectedProjectCalcVersion: saved.project.calcVersion,
          requiredExecutedCalcVersion: BUILD_CALC_VERSION,
          expectedSourcePriceVersion: saved.project.priceVersion,
        },
      ),
      context(saved.project.id),
    );
    expect(response.status).toBe(400);
  });

  it("пересчитывает проект и поддерживает replay", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      operationId: "recalc-route-create-1",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const body = {
      targetPriceVersionId: saved.project.priceVersion,
      expectedProjectCalcVersion: saved.project.calcVersion,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: saved.project.priceVersion,
    };

    const first = await POST(
      request(saved.project.id, body, "recalc-route-1"),
      context(saved.project.id),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      ok: boolean;
      replay: boolean;
      project: { total: number };
    };
    expect(firstBody.ok).toBe(true);
    expect(firstBody.replay).toBe(false);

    const second = await POST(
      request(saved.project.id, body, "recalc-route-1"),
      context(saved.project.id),
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      ok: boolean;
      replay: boolean;
    };
    expect(secondBody.ok).toBe(true);
    expect(secondBody.replay).toBe(true);

    const read = await getProject(saved.project.id);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.project.priceHistory).toHaveLength(2);
  });

  it("конфликтует при том же ключе и другом fingerprint", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      operationId: "recalc-route-create-2",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const body = {
      targetPriceVersionId: saved.project.priceVersion,
      expectedProjectCalcVersion: saved.project.calcVersion,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: saved.project.priceVersion,
    };

    const first = await POST(
      request(saved.project.id, body, "recalc-route-conflict"),
      context(saved.project.id),
    );
    expect(first.status).toBe(200);

    const second = await POST(
      request(
        saved.project.id,
        { ...body, targetPriceVersionId: "another-price-version" },
        "recalc-route-conflict",
      ),
      context(saved.project.id),
    );
    expect(second.status).toBe(409);
  });
});

describe("E3: recalculate использует Composition pin сохранённого проекта", () => {
  const compositionId = "composition-e3-recalc";
  const now = "2026-11-16T00:00:00.000Z";
  let savedId = "";

  beforeAll(async () => {
    const { compositionContentHash } = await import(
      "@/lib/admin/composition-hash"
    );
    const { getPublishedVersion } = await import("@/lib/admin/pricing");
    const { listPriceItems } = await import("@/lib/admin/price-items");
    const { updateCollection } = await import("@/lib/server/store");

    const version = await getPublishedVersion();
    const snapshotIds = new Set(
      (version?.snapshot ?? []).map((entry) => entry.priceItemId),
    );
    const priceItem = (await listPriceItems({ status: "active" })).find(
      (item) => item.unit === "RUB_PER_PCS" && snapshotIds.has(item.id),
    );
    if (!priceItem) throw new Error("нет активного тарифа RUB_PER_PCS");

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
    const lines = moduleTypes.map((moduleType, index) => ({
      id: `e3-recalc-${moduleType}`,
      moduleType,
      relation: "required" as const,
      priceItemId: priceItem.id,
      quantityRef: {
        kind: "fixed" as const,
        value: index + 1,
        unit: "pcs" as const,
      },
      sourceRef: `e3-recalc-${moduleType}`,
      source: "owner_confirmed" as const,
      confirmation: { by: "e3", at: now, reference: "e3 recalc fixture" },
      notes: `e3 recalc ${moduleType}`,
      sortOrder: index + 1,
    }));
    await updateCollection<Record<string, unknown>, void>(
      "composition-versions.json",
      (items) => ({
        items: [
          ...items.filter((item) => item.id !== compositionId),
          {
            id: compositionId,
            schemaVersion: 1,
            status: "published",
            version: 1,
            lines,
            contentHash: compositionContentHash(lines, undefined, undefined),
            createdAt: now,
            createdBy: "e3",
            updatedAt: now,
            updatedBy: "e3",
            publishedAt: now,
            publishedBy: "e3",
            publishedSeq: 97,
          },
        ],
        result: undefined,
      }),
    );

    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: compositionId,
      operationId: "e3-recalc-create",
    });
    if (!saved.ok) throw new Error("проект с pin не сохранён");
    savedId = saved.project.id;
  });

  it("пересчёт сохраняет pin проекта и не меняет итог Engine", async () => {
    const before = await getProject(savedId);
    expect(before.status).toBe("ok");
    if (before.status !== "ok") return;
    expect(before.project.compositionVersionId).toBe(compositionId);

    const body = {
      targetPriceVersionId: before.project.priceVersion,
      expectedProjectCalcVersion: before.project.calcVersion,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: before.project.priceVersion,
    };
    const response = await POST(
      request(savedId, body, "e3-recalc-1"),
      context(savedId),
    );
    expect(response.status).toBe(200);
    const bodyJson = (await response.json()) as { ok: boolean };
    expect(bodyJson.ok).toBe(true);

    const after = await getProject(savedId);
    expect(after.status).toBe("ok");
    if (after.status !== "ok") return;
    expect(after.project.compositionVersionId).toBe(compositionId);
    expect(after.project.price.total).toBe(before.project.price.total);
  });

  it("клиент не может подменить pin через тело recalculate (422)", async () => {
    const before = await getProject(savedId);
    if (before.status !== "ok") throw new Error("проект не найден");
    const response = await POST(
      request(
        savedId,
        {
          targetPriceVersionId: before.project.priceVersion,
          expectedProjectCalcVersion: before.project.calcVersion,
          requiredExecutedCalcVersion: BUILD_CALC_VERSION,
          expectedSourcePriceVersion: before.project.priceVersion,
          compositionVersionId: "composition-attacker",
        },
        "e3-recalc-2",
      ),
      context(savedId),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});
