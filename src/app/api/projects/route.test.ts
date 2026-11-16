import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { POST } from "@/app/api/projects/route";
import { applyBootstrap } from "@/lib/admin/bootstrap";
import { seedDisplayMetadata } from "@/lib/admin/display-metadata";
import { defaultKitchen } from "@/lib/configurator/defaults";

let dir = "";

function request(body: unknown, key?: string, ip?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== undefined) headers["Idempotency-Key"] = key;
  if (ip !== undefined) headers["x-forwarded-for"] = ip;
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-create-route-"));
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

describe("CA-T-306E: POST /api/projects", () => {
  it("требует Idempotency-Key", async () => {
    const response = await POST(request({ config: defaultKitchen() }));
    expect(response.status).toBe(400);
  });

  it("CREATE сохраняет проект и replay по тому же ключу", async () => {
    const first = await POST(
      request({ config: defaultKitchen() }, "route-create-1"),
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      ok: boolean;
      id: string;
      replay: boolean;
    };
    expect(firstBody.ok).toBe(true);
    expect(firstBody.replay).toBe(false);

    const second = await POST(
      request({ config: defaultKitchen() }, "route-create-1"),
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      ok: boolean;
      id: string;
      replay: boolean;
    };
    expect(secondBody.ok).toBe(true);
    expect(secondBody.replay).toBe(true);
    expect(secondBody.id).toBe(firstBody.id);
  });

  it("возвращает 422 для исторического материала фасада", async () => {
    const response = await POST(
      request(
        {
          config: { ...defaultKitchen(), facadeMaterial: "glass" },
        },
        "route-legacy-facade",
      ),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      ok: boolean;
      issues: Array<{ path: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.issues.some((issue) => issue.path === "facadeMaterial")).toBe(true);
  });

  it("конфликтует при том же ключе и другом fingerprint", async () => {
    const first = await POST(
      request({ config: defaultKitchen() }, "route-create-conflict"),
    );
    expect(first.status).toBe(201);

    const second = await POST(
      request(
        { config: { ...defaultKitchen(), promoCode: "OTHER" } },
        "route-create-conflict",
      ),
    );
    expect(second.status).toBe(409);
  });

  it("replay не блокируется rate limit, новая операция — блокируется", async () => {
    const ip = "203.0.113.77";
    const first = await POST(
      request({ config: defaultKitchen() }, "limit-existing", ip),
    );
    expect(first.status).toBe(201);

    for (let index = 0; index < 5; index += 1) {
      const response = await POST(
        request({ config: defaultKitchen() }, `limit-new-${index}`, ip),
      );
      expect(response.status).toBe(201);
    }

    const blocked = await POST(
      request({ config: defaultKitchen() }, "limit-blocked", ip),
    );
    expect(blocked.status).toBe(429);

    const replay = await POST(
      request({ config: defaultKitchen() }, "limit-existing", ip),
    );
    expect(replay.status).toBe(200);
  });
});

describe("E2: compositionVersionId при сохранении проекта", () => {
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
    const actor = { actorId: "e2-save", actorRole: "admin" as const };
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
      { expectedVersion: datasheet.version, operationId: "e2-save-publish" },
      actor,
    );
    const published = await getPublishedComposition();
    if (!published) throw new Error("composition не опубликован");
    publishedId = published.id;
  });

  it("сохраняет существующее поле StoredProject.compositionVersionId", async () => {
    const response = await POST(
      request(
        { config: defaultKitchen(), compositionVersionId: publishedId },
        "e2-save-with-pin",
      ),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);

    const { getInspectorProject } = await import(
      "@/lib/admin/calculation-inspector"
    );
    const inspected = await getInspectorProject(body.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.data.project.compositionVersionId).toBe(publishedId);
    /* Повторное открытие: trace вычисляется после Engine. */
    expect(inspected.data.compositionTrace.compositionVersionId).toBe(
      publishedId,
    );
    expect(inspected.data.compositionTrace.status).toBe("blocked");
    expect(inspected.data.compositionTrace.trace).toBeNull();
    expect(inspected.data.compositionTrace.issues.length).toBeGreaterThan(0);
    expect(inspected.data.compositionTrace.message).toContain("fail-closed");
  });

  it("replay с тем же ключом и тем же pin идемпотентен", async () => {
    const first = await POST(
      request(
        { config: defaultKitchen(), compositionVersionId: publishedId },
        "e2-save-replay",
      ),
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };

    const replay = await POST(
      request(
        { config: defaultKitchen(), compositionVersionId: publishedId },
        "e2-save-replay",
      ),
    );
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { id: string; replay: boolean };
    expect(replayBody.replay).toBe(true);
    expect(replayBody.id).toBe(firstBody.id);

    /* Тот же ключ без pin — другой fingerprint → конфликт, не тихая подмена. */
    const conflict = await POST(
      request({ config: defaultKitchen() }, "e2-save-replay"),
    );
    expect(conflict.status).toBe(409);
  });

  it("проект без pin: Inspector показывает отсутствие trace (legacy)", async () => {
    const saved = await POST(
      request({ config: defaultKitchen() }, "e2-save-legacy"),
    );
    expect(saved.status).toBe(201);
    const body = (await saved.json()) as { id: string };

    const { getInspectorProject } = await import(
      "@/lib/admin/calculation-inspector"
    );
    const inspected = await getInspectorProject(body.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.data.project.compositionVersionId).toBeNull();
    expect(inspected.data.compositionTrace.status).toBe("absent");
    expect(inspected.data.compositionTrace.trace).toBeNull();
    expect(inspected.data.compositionTrace.issues).toEqual([]);
  });
});

describe("E2: Inspector показывает построенный trace (computed)", () => {
  const computedId = "composition-e2-inspector";
  const now = "2026-11-16T00:00:00.000Z";

  it("сохранённый проект с pin: Inspector отдаёт строки trace, не подменяя итог", async () => {
    const { compositionContentHash } = await import(
      "@/lib/admin/composition-hash"
    );
    const { getPublishedVersion } = await import("@/lib/admin/pricing");
    const { listPriceItems } = await import("@/lib/admin/price-items");
    const { updateCollection } = await import("@/lib/server/store");

    const version = await getPublishedVersion();
    const snapshot = version?.snapshot ?? [];
    const snapshotIds = new Set(snapshot.map((entry) => entry.priceItemId));
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
      id: `e2-insp-${moduleType}`,
      moduleType,
      relation: "required" as const,
      priceItemId: priceItem.id,
      quantityRef: {
        kind: "fixed" as const,
        value: index + 1,
        unit: "pcs" as const,
      },
      sourceRef: `e2-insp-${moduleType}`,
      source: "owner_confirmed" as const,
      confirmation: {
        by: "e2-test",
        at: now,
        reference: "e2 inspector fixture",
      },
      notes: `e2 insp ${moduleType}`,
      sortOrder: index + 1,
    }));
    await updateCollection<Record<string, unknown>, void>(
      "composition-versions.json",
      (items) => ({
        items: [
          ...items.filter((item) => item.id !== computedId),
          {
            id: computedId,
            schemaVersion: 1,
            status: "published",
            version: 1,
            lines,
            contentHash: compositionContentHash(lines, undefined, undefined),
            createdAt: now,
            createdBy: "e2-test",
            updatedAt: now,
            updatedBy: "e2-test",
            publishedAt: now,
            publishedBy: "e2-test",
            publishedSeq: 98,
          },
        ],
        result: undefined,
      }),
    );

    const saved = await POST(
      request(
        { config: defaultKitchen(), compositionVersionId: computedId },
        "e2-inspector-computed",
        "10.9.9.9",
      ),
    );
    expect(saved.status).toBe(201);
    const savedBody = (await saved.json()) as { id: string; total: number };

    const { getInspectorProject } = await import(
      "@/lib/admin/calculation-inspector"
    );
    const inspected = await getInspectorProject(savedBody.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.data.compositionTrace.status).toBe("computed");
    expect(inspected.data.compositionTrace.compositionVersionId).toBe(
      computedId,
    );
    const trace = inspected.data.compositionTrace.trace;
    expect(trace).not.toBeNull();
    expect(trace?.lines.length).toBeGreaterThan(0);
    expect(trace?.lines[0].status).toBe("resolved");
    expect(trace?.lines[0].unit).toBe("pcs");
    /* Trace не подменяет сохранённый итог Engine. */
    expect(inspected.data.project.total).toBe(savedBody.total);
  });
});

describe("E2: Inspector при неизвестном Composition pin", () => {
  it("проект с неизвестным pin: trace недоступен, ошибки нет", async () => {
    const saved = await POST(
      request({ config: defaultKitchen() }, "e2-unknown-pin", "10.9.9.10"),
    );
    expect(saved.status).toBe(201);
    const body = (await saved.json()) as { id: string };

    const { updateCollection } = await import("@/lib/server/store");
    const { getInspectorProject } = await import(
      "@/lib/admin/calculation-inspector"
    );

    await updateCollection<Record<string, unknown>, void>(
      "projects.json",
      (items) => ({
        items: items.map((item) =>
          item.id === body.id
            ? { ...item, compositionVersionId: "missing-composition-id" }
            : item,
        ),
        result: undefined,
      }),
    );

    const inspected = await getInspectorProject(body.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.data.project.compositionVersionId).toBe(
      "missing-composition-id",
    );
    /*
     * E4-fix: историческое чтение не резолвит pin и не пересчитывает trace.
     * Неизвестный pin здесь = «исторической трассировки нет» (`none`),
     * а не ошибка расчёта. Preflight-отказ по неизвестному pin проверяется
     * на расчётном API (`/api/calculation-inputs` → 422).
     */
    expect(inspected.data.compositionTrace.status).toBe("absent");
    expect(inspected.data.compositionTrace.source).toBe("none");
    expect(inspected.data.compositionTrace.trace).toBeNull();
    expect(inspected.data.compositionTrace.issues).toEqual([]);
    expect(inspected.data.compositionTrace.message).toContain(
      "не пересчитывается",
    );

    /* Восстановление, чтобы не влиять на другие прогоны. */
    await updateCollection<Record<string, unknown>, void>(
      "projects.json",
      (items) => ({
        items: items.map((item) =>
          item.id === body.id
            ? { ...item, compositionVersionId: undefined }
            : item,
        ),
        result: undefined,
      }),
    );
  });
});

describe("E3: Inspector — unresolved без нуля и без побочных записей", () => {
  const compositionId = "composition-e3-inspector";
  const now = "2026-11-16T00:00:00.000Z";

  it("optional code-строка даёт quantity_unresolved, чтение не пишет коллекции", async () => {
    const { compositionContentHash } = await import(
      "@/lib/admin/composition-hash"
    );
    const { getPublishedVersion } = await import("@/lib/admin/pricing");
    const { listPriceItems } = await import("@/lib/admin/price-items");
    const { readCollection, updateCollection } = await import(
      "@/lib/server/store"
    );

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
    const requiredLines = moduleTypes.map((moduleType, index) => ({
      id: `e3-insp-req-${moduleType}`,
      moduleType,
      relation: "required" as const,
      priceItemId: priceItem.id,
      quantityRef: {
        kind: "fixed" as const,
        value: index + 1,
        unit: "pcs" as const,
      },
      sourceRef: `e3-insp-req-${moduleType}`,
      source: "owner_confirmed" as const,
      confirmation: { by: "e3", at: now, reference: "e3 inspector fixture" },
      notes: `e3 insp req ${moduleType}`,
      sortOrder: index + 1,
    }));
    const optionalCodeLine = {
      id: "e3-insp-opt-sink",
      moduleType: "sink" as const,
      relation: "optional" as const,
      priceItemId: priceItem.id,
      quantityRef: { kind: "code" as const, implementationId: "not-executable" },
      sourceRef: "e3-insp-opt",
      source: "datasheet" as const,
      notes: "e3 insp optional",
      sortOrder: 100,
    };
    const lines = [...requiredLines, optionalCodeLine];

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
            publishedSeq: 95,
          },
        ],
        result: undefined,
      }),
    );

    const saved = await POST(
      request(
        { config: defaultKitchen(), compositionVersionId: compositionId },
        "e3-inspector-unresolved",
        "10.9.9.20",
      ),
    );
    expect(saved.status).toBe(201);
    const savedBody = (await saved.json()) as { id: string; total: number };

    const before = {
      projects: JSON.stringify(await readCollection("projects.json")),
      compositions: JSON.stringify(
        await readCollection("composition-versions.json"),
      ),
    };

    const { getInspectorProject } = await import(
      "@/lib/admin/calculation-inspector"
    );
    const inspected = await getInspectorProject(savedBody.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;

    const after = {
      projects: JSON.stringify(await readCollection("projects.json")),
      compositions: JSON.stringify(
        await readCollection("composition-versions.json"),
      ),
    };
    /* Inspector только читает. */
    expect(after).toEqual(before);

    const view = inspected.data.compositionTrace;
    expect(view.status).toBe("computed");
    const trace = view.trace;
    expect(trace).not.toBeNull();
    const unresolved = trace?.lines.find(
      (line) => line.lineId === "e3-insp-opt-sink",
    );
    expect(unresolved).toBeDefined();
    expect(unresolved?.quantity).toBeNull();
    expect(unresolved?.quantity).not.toBe(0);
    expect(unresolved?.priceAmount).toBeNull();
    expect(unresolved?.status).toBe("quantity_unresolved");
    expect(view.issues.map((item) => item.code)).toContain(
      "TRACE_QUANTITY_UNRESOLVED",
    );
    /* Остальные строки разрешены и не подменяют итог Engine. */
    /* defaultKitchen использует 5 типов модулей: sink/hob/drawers/tall/wall. */
    const resolved = trace?.lines.filter((line) => line.status === "resolved");
    expect(resolved?.length).toBe(5);
    expect(inspected.data.project.total).toBe(savedBody.total);
  });
});
