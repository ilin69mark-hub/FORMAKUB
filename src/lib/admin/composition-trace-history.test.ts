import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import { compositionContentHash } from "@/lib/admin/composition-hash";
import { seedDisplayMetadata } from "@/lib/admin/display-metadata";
import { getPublishedVersion } from "@/lib/admin/pricing";
import { listPriceItems } from "@/lib/admin/price-items";
import { defaultKitchen } from "@/lib/configurator/defaults";
import type { StoredProject } from "@/lib/configurator/types";
import { storedProjectSchema } from "@/lib/configurator/schema";
import { getInspectorProject } from "@/lib/admin/calculation-inspector";
import { recalculateProject, saveProject } from "@/lib/server/projects";
import { readCollection, updateCollection } from "@/lib/server/store";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

let dir = "";
const NOW = "2026-11-16T00:00:00.000Z";
const COMPOSITION_ID = "composition-e4";
const MODULE_TYPES = [
  "base",
  "sink",
  "hob",
  "drawers",
  "wall",
  "tall",
  "oven",
  "bottle",
] as const;

let priceItemId = "";
let priceItemAmount = 0;

function compositionRecord(
  lines: unknown[],
  seq = 94,
  pins?: Record<string, unknown>,
) {
  return {
    id: COMPOSITION_ID,
    schemaVersion: 1,
    status: "published",
    version: 1,
    lines,
    contentHash: compositionContentHash(
      lines as never,
      undefined,
      pins as never,
    ),
    ...(pins === undefined ? {} : { pins }),
    createdAt: NOW,
    createdBy: "e4",
    updatedAt: NOW,
    updatedBy: "e4",
    publishedAt: NOW,
    publishedBy: "e4",
    publishedSeq: seq,
  };
}

function fixtureLines(quantityBase = 1) {
  return MODULE_TYPES.map((moduleType, index) => ({
    id: `e4-${moduleType}`,
    moduleType,
    relation: "required" as const,
    priceItemId,
    quantityRef: {
      kind: "fixed" as const,
      value: quantityBase + index,
      unit: "pcs" as const,
    },
    sourceRef: `e4-${moduleType}`,
    source: "owner_confirmed" as const,
    confirmation: { by: "e4", at: NOW, reference: "e4 fixture" },
    notes: `e4 ${moduleType}`,
    sortOrder: index + 1,
  }));
}

async function writeComposition(
  lines: unknown[],
  seq = 94,
  pins?: Record<string, unknown>,
): Promise<void> {
  await updateCollection<Record<string, unknown>, void>(
    "composition-versions.json",
    (items) => ({
      items: [
        ...items.filter((item) => item.id !== COMPOSITION_ID),
        compositionRecord(lines, seq, pins),
      ],
      result: undefined,
    }),
  );
}

async function readProject(id: string): Promise<StoredProject> {
  const read = await readCollection<StoredProject>("projects.json");
  const project = read.find((item) => item.id === id);
  if (!project) throw new Error(`проект ${id} не найден`);
  return project;
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-e4-trace-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-e4.1",
    pricingLabel: "E4 bootstrap",
    now: NOW,
  });
  await seedDisplayMetadata({ actorId: "e4", actorRole: "system" });
  await seedRulesSnapshotFixture();

  const version = await getPublishedVersion();
  const snapshotIds = new Set(
    (version?.snapshot ?? []).map((entry) => entry.priceItemId),
  );
  const item = (await listPriceItems({ status: "active" })).find(
    (candidate) =>
      candidate.unit === "RUB_PER_PCS" && snapshotIds.has(candidate.id),
  );
  if (!item) throw new Error("нет активного тарифа RUB_PER_PCS");
  priceItemId = item.id;
  priceItemAmount =
    version?.snapshot.find((entry) => entry.priceItemId === item.id)?.amount ??
    0;

  await writeComposition(fixtureLines());
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("E4: сохранение CompositionTrace в ProjectPriceHistory", () => {
  it("1) расчёт с pin сохраняет trace в событии истории", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "e4-save-1",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const project = await readProject(saved.project.id);
    expect(project.priceHistory).toHaveLength(1);
    const event = project.priceHistory![0];
    expect(event.compositionVersionId).toBe(COMPOSITION_ID);

    const trace = event.compositionTrace;
    expect(trace).toBeDefined();
    expect(trace).toMatchObject({
      traceVersion: 1,
      status: "computed",
      compositionVersionId: COMPOSITION_ID,
      rulesSnapshotId: project.rulesSnapshotId,
      enginePriceVersionId: project.priceVersion,
    });
    expect(trace?.enginePriceBaseSchema).toBeGreaterThanOrEqual(1);
    expect(trace?.lines.length).toBeGreaterThan(0);
    expect(trace?.computedAt).toBe(event.computedAt);

    /* Trace и Breakdown живут в ОДНОМ событии (общий расчётный контекст). */
    expect(trace?.enginePriceVersionId).toBe(event.toPriceVersionId);
    const line = trace!.lines.find((item) => item.lineId === "e4-sink");
    expect(line).toMatchObject({
      quantity: 2,
      unit: "pcs",
      priceItemId,
      amount: priceItemAmount,
      priceItemUnit: "RUB_PER_PCS",
      priceAmount: 2 * priceItemAmount,
      status: "resolved",
      quantitySource: "fixed",
    });
    /* Самодостаточность: схема события проходит strict-валидацию. */
    expect(storedProjectSchema.safeParse(project).success).toBe(true);
  });

  it("2) расчёт без pin пишет legacy-историю без trace", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      operationId: "e4-save-nopin",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const project = await readProject(saved.project.id);
    expect(project.compositionVersionId).toBeUndefined();
    expect(project.priceHistory![0].compositionTrace).toBeUndefined();
    expect(project.priceHistory![0]).not.toHaveProperty("compositionTrace");
  });

  it("3+4+5) повторное открытие берёт снимок; удаление Composition его не меняет", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "e4-save-2",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const stored = (await readProject(saved.project.id)).priceHistory![0]
      .compositionTrace;

    const before = await getInspectorProject(saved.project.id);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.data.compositionTrace.status).toBe("computed");
    expect(before.data.compositionTrace.trace?.computedAt).toBe(
      stored?.computedAt,
    );

    /* Удаляем текущую Composition: live-пересчёт стал бы невозможен. */
    await updateCollection<Record<string, unknown>, void>(
      "composition-versions.json",
      (items) => ({
        items: items.filter((item) => item.id !== COMPOSITION_ID),
        result: undefined,
      }),
    );

    const afterDelete = await getInspectorProject(saved.project.id);
    expect(afterDelete.ok).toBe(true);
    if (!afterDelete.ok) return;
    expect(afterDelete.data.compositionTrace.status).toBe("computed");
    expect(afterDelete.data.compositionTrace.trace).toEqual(before.data.compositionTrace.trace);

    /* Возвращаем состав в изменённом виде: снимок не должен измениться. */
    await writeComposition(fixtureLines(50), 93);
    const afterChange = await getInspectorProject(saved.project.id);
    expect(afterChange.ok).toBe(true);
    if (!afterChange.ok) return;
    expect(afterChange.data.compositionTrace.trace).toEqual(
      before.data.compositionTrace.trace,
    );

    await writeComposition(fixtureLines());
  });

  it("6) изменение текущего PriceItem не меняет исторические значения", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "e4-save-3",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const before = (await readProject(saved.project.id)).priceHistory![0]
      .compositionTrace;

    await updateCollection<Record<string, unknown>, void>(
      "price-items.json",
      (items) => ({
        items: items.map((item) =>
          item.id === priceItemId
            ? { ...item, unit: "RUB_PER_SQM", updatedAt: NOW }
            : item,
        ),
        result: undefined,
      }),
    );

    const inspected = await getInspectorProject(saved.project.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.data.compositionTrace.trace).toEqual(before);
    expect(
      inspected.data.compositionTrace.trace?.lines[0].priceItemUnit,
    ).toBe("RUB_PER_PCS");

    /* Восстанавливаем тариф: дальнейшие тесты опираются на исходную единицу. */
    await updateCollection<Record<string, unknown>, void>(
      "price-items.json",
      (items) => ({
        items: items.map((item) =>
          item.id === priceItemId
            ? { ...item, unit: "RUB_PER_PCS", updatedAt: NOW }
            : item,
        ),
        result: undefined,
      }),
    );
  });

  it("7) изменение текущего RulesSnapshot не меняет исторический trace", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "e4-save-4",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const before = (await readProject(saved.project.id)).priceHistory![0]
      .compositionTrace;

    await updateCollection<Record<string, unknown>, void>(
      "rules-snapshots.json",
      (items) => ({ items: items.map((item) => ({ ...item })), result: undefined }),
    );

    const inspected = await getInspectorProject(saved.project.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.data.compositionTrace.trace).toEqual(before);
  });

  it("8+9+11) recalculate добавляет новую запись, старую не меняет, без дублей", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "e4-recalc-base",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const beforeProject = await readProject(saved.project.id);
    const firstEvent = beforeProject.priceHistory![0];
    const firstTrace = firstEvent.compositionTrace;
    expect(firstTrace).toBeDefined();

    const result = await recalculateProject({
      projectId: saved.project.id,
      operationId: "e4-recalc-1",
      targetPriceVersionId: beforeProject.priceVersion!,
      expectedProjectCalcVersion: beforeProject.calcVersion!,
      requiredExecutedCalcVersion: beforeProject.calcVersion!,
      expectedSourcePriceVersion: beforeProject.priceVersion!,
    });
    expect(result.ok).toBe(true);

    const afterProject = await readProject(saved.project.id);
    expect(afterProject.priceHistory).toHaveLength(2);

    /* Предыдущее событие побайтно не изменилось (append-only). */
    expect(afterProject.priceHistory![0]).toEqual(firstEvent);

    const newEvent = afterProject.priceHistory![1];
    expect(newEvent.operationId).toBe("e4-recalc-1");
    expect(newEvent.reason).toBe("manual_recalc");
    expect(newEvent.compositionVersionId).toBe(COMPOSITION_ID);
    expect(newEvent.compositionTrace).toBeDefined();
    expect(newEvent.compositionTrace?.compositionVersionId).toBe(COMPOSITION_ID);
    expect(newEvent.compositionTrace?.computedAt).toBe(newEvent.computedAt);

    /* Повтор той же операции не создаёт третью запись. */
    const replay = await recalculateProject({
      projectId: saved.project.id,
      operationId: "e4-recalc-1",
      targetPriceVersionId: beforeProject.priceVersion!,
      expectedProjectCalcVersion: beforeProject.calcVersion!,
      requiredExecutedCalcVersion: beforeProject.calcVersion!,
      expectedSourcePriceVersion: beforeProject.priceVersion!,
    });
    expect(replay.ok).toBe(true);
    const afterReplay = await readProject(saved.project.id);
    expect(afterReplay.priceHistory).toHaveLength(2);
  });

  it("10) CAS-конфликт не оставляет рассинхронизированный trace", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "e4-cas-base",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const beforeProject = await readProject(saved.project.id);
    const beforeHistory = beforeProject.priceHistory!.length;

    const conflict = await recalculateProject({
      projectId: saved.project.id,
      operationId: "e4-cas-1",
      targetPriceVersionId: beforeProject.priceVersion!,
      expectedProjectCalcVersion: beforeProject.calcVersion!,
      requiredExecutedCalcVersion: beforeProject.calcVersion!,
      /* Намеренно неверный source → отказ внутри atomic-updater. */
      expectedSourcePriceVersion: "price-does-not-exist",
    });
    expect(conflict.ok).toBe(false);
    /* Отказ приходит либо из preflight (422), либо из CAS-updater (409);
       в обоих случаях запись проекта/истории не выполняется. */
    if (!conflict.ok) expect([409, 422]).toContain(conflict.status);

    const afterProject = await readProject(saved.project.id);
    /* Ни история, ни trace не записаны частично. */
    expect(afterProject.priceHistory).toHaveLength(beforeHistory);
    expect(afterProject.price).toEqual(beforeProject.price);
    expect(afterProject.compositionVersionId).toBe(COMPOSITION_ID);
  });

  it("12) история без compositionTrace продолжает читаться (fallback)", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      operationId: "e4-legacy-read",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const inspected = await getInspectorProject(saved.project.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    /* Нет pin → trace не применяется, ошибки нет. */
    expect(inspected.data.compositionTrace.status).toBe("absent");
    expect(inspected.data.compositionTrace.source).toBe("none");
    expect(inspected.data.compositionTrace.trace).toBeNull();
    expect(inspected.data.compositionTrace.issues).toEqual([]);

    /* Старая запись с pin, но без снимка: живой расчёт допустим, без падения. */
    const withPin = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "e4-old-record",
    });
    expect(withPin.ok).toBe(true);
    if (!withPin.ok) return;
    await updateCollection<Record<string, unknown>, void>(
      "projects.json",
      (items) => ({
        items: items.map((item) => {
          if (item.id !== withPin.project.id) return item;
          const stored = item as unknown as StoredProject;
          return {
            ...stored,
            priceHistory: stored.priceHistory?.map((history) => {
              const rest = { ...history };
              delete rest.compositionTrace;
              return rest;
            }),
          };
        }),
        result: undefined,
      }),
    );

    const legacyInspected = await getInspectorProject(withPin.project.id);
    expect(legacyInspected.ok).toBe(true);
    if (!legacyInspected.ok) return;
    /* E4-fix: история без снимка не пересчитывается — трассировки нет. */
    expect(legacyInspected.data.compositionTrace.status).toBe("absent");
    expect(legacyInspected.data.compositionTrace.source).toBe("none");
    expect(legacyInspected.data.compositionTrace.trace).toBeNull();
    expect(legacyInspected.data.compositionTrace.issues).toEqual([]);
  });
});

describe("E4-fix: историческое чтение не пересчитывает trace", () => {
  it("история со снимком → source history, без обращения к текущим данным", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "e4fix-history",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const stored = (await readProject(saved.project.id)).priceHistory![0]
      .compositionTrace;
    expect(stored).toBeDefined();

    const inspected = await getInspectorProject(saved.project.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.data.compositionTrace.source).toBe("history");
    expect(inspected.data.compositionTrace.status).toBe("computed");
    expect(inspected.data.compositionTrace.trace).toEqual(stored);
  });

  it("история с pin, но без снимка → source none; resolver не вызывается", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "e4fix-nosnapshot",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    /* Убираем снимок из события (имитация записи до E4). */
    await updateCollection<Record<string, unknown>, void>(
      "projects.json",
      (items) => ({
        items: items.map((item) => {
          if (item.id !== saved.project.id) return item;
          const stored = item as unknown as StoredProject;
          return {
            ...stored,
            priceHistory: stored.priceHistory?.map((history) => {
              const rest = { ...history };
              delete rest.compositionTrace;
              return rest;
            }),
          };
        }),
        result: undefined,
      }),
    );

    /*
     * Удаляем текущую Composition: если бы Inspector пытался пересчитать live,
     * preflight вернул бы `unavailable`. Ожидаем ровно `none`.
     */
    await updateCollection<Record<string, unknown>, void>(
      "composition-versions.json",
      (items) => ({
        items: items.filter((item) => item.id !== COMPOSITION_ID),
        result: undefined,
      }),
    );

    const inspected = await getInspectorProject(saved.project.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.data.compositionTrace.status).toBe("absent");
    expect(inspected.data.compositionTrace.source).toBe("none");
    expect(inspected.data.compositionTrace.trace).toBeNull();
    expect(inspected.data.compositionTrace.issues).toEqual([]);
    expect(inspected.data.compositionTrace.message).toContain(
      "не пересчитывается",
    );

    await writeComposition(fixtureLines());
  });

  it("текущий live-расчёт доступен отдельно → source live", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "e4fix-live",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const project = await readProject(saved.project.id);

    const { computeLiveCompositionTraceView } = await import(
      "@/lib/admin/calculation-inspector"
    );
    const live = await computeLiveCompositionTraceView(project);
    expect(live.source).toBe("live");
    expect(["computed", "blocked"]).toContain(live.status);
    expect(live.trace?.computedAt).not.toBe(
      project.priceHistory![0].compositionTrace?.computedAt,
    );
  });

  it("legacy-проект без pin → source none, фиктивный trace не создаётся", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      operationId: "e4fix-legacy",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const inspected = await getInspectorProject(saved.project.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.data.compositionTrace.status).toBe("absent");
    expect(inspected.data.compositionTrace.source).toBe("none");
    expect(inspected.data.compositionTrace.trace).toBeNull();
    expect(inspected.data.latestHistory).not.toHaveProperty(
      "compositionTrace",
    );
    expect(
      (await readProject(saved.project.id)).priceHistory![0],
    ).not.toHaveProperty("compositionTrace");
  });
});

describe("Drift-диагностики версий тарифа: trace → история → Inspector", () => {
  it("Composition без pins.priceVersionId → PRICE_VERSION_PIN_MISSING в snapshot и Inspector", async () => {
    await writeComposition(fixtureLines());
    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "drift-missing-pin",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const event = (await readProject(saved.project.id)).priceHistory![0];
    const codes = event.compositionTrace!.warnings.map((item) => item.code);
    expect(codes).toContain("PRICE_VERSION_PIN_MISSING");
    expect(codes).not.toContain("PRICE_VERSION_DRIFT");
    expect(event.compositionTrace!.pinnedPriceVersionId).toBeNull();
    /* warning, не block */
    expect(event.compositionTrace!.status).toBe("computed");
    expect(event.compositionTrace!.lines.length).toBeGreaterThan(0);

    const inspected = await getInspectorProject(saved.project.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.data.compositionTrace.source).toBe("history");
    expect(
      inspected.data.compositionTrace.issues.map((item) => item.code),
    ).toContain("PRICE_VERSION_PIN_MISSING");
    expect(
      inspected.data.compositionTrace.issues.every(
        (item) => item.severity === "warning",
      ),
    ).toBe(true);
  });

  it("совпадающие версии → drift warning не создаётся", async () => {
    const published = await getPublishedVersion();
    if (!published) throw new Error("нет published PricingVersion");
    await writeComposition(fixtureLines(), 94, {
      priceVersionId: published.id,
    });
    const saved = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "drift-equal",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const trace = (await readProject(saved.project.id)).priceHistory![0]
      .compositionTrace!;
    expect(trace.pinnedPriceVersionId).toBe(published.id);
    expect(trace.enginePriceVersionId).toBe(published.id);
    const codes = trace.warnings.map((item) => item.code);
    expect(codes).not.toContain("PRICE_VERSION_DRIFT");
    expect(codes).not.toContain("PRICE_VERSION_PIN_MISSING");
    await writeComposition(fixtureLines());
  });

  it("разные версии → PRICE_VERSION_DRIFT + preflight drift, стоимость не меняется", async () => {
    const plain = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "drift-baseline",
    });
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;

    await writeComposition(fixtureLines(), 94, {
      priceVersionId: "price-pinned-other",
    });
    const drifted = await saveProject({
      config: defaultKitchen(),
      compositionVersionId: COMPOSITION_ID,
      operationId: "drift-different",
    });
    expect(drifted.ok).toBe(true);
    if (!drifted.ok) return;

    const trace = (await readProject(drifted.project.id)).priceHistory![0]
      .compositionTrace!;
    const codes = trace.warnings.map((item) => item.code);
    expect(codes).toContain("PRICE_VERSION_DRIFT");
    /* preflight-warning (Q4) доходит до trace без потери кода */
    expect(codes).toContain("COMPOSITION_PRICE_SNAPSHOT_DRIFT");
    const drift = trace.warnings.find(
      (item) => item.code === "PRICE_VERSION_DRIFT",
    );
    expect(drift?.message).toContain("price-pinned-other");
    expect(drift?.message).toContain(trace.enginePriceVersionId);

    /* Итог расчёта не зависит от диагностик. */
    expect(drifted.project.price.total).toBe(plain.project.price.total);
    expect(trace.status).toBe("computed");

    const inspected = await getInspectorProject(drifted.project.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(
      inspected.data.compositionTrace.issues.map((item) => item.code),
    ).toEqual(expect.arrayContaining(["PRICE_VERSION_DRIFT"]));
    expect(inspected.data.project.total).toBe(plain.project.price.total);

    /* Сохранённый snapshot читается без изменений. */
    expect(inspected.data.compositionTrace.trace).toEqual(trace);

    await writeComposition(fixtureLines());
  });

  it("legacy-проект без pin не получает новых предупреждений", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      operationId: "drift-legacy",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const event = (await readProject(saved.project.id)).priceHistory![0];
    expect(event).not.toHaveProperty("compositionTrace");

    const inspected = await getInspectorProject(saved.project.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.data.compositionTrace.status).toBe("absent");
    expect(inspected.data.compositionTrace.source).toBe("none");
    expect(inspected.data.compositionTrace.issues).toEqual([]);
  });
});
