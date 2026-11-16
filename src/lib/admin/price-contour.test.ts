import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBootstrap } from "./bootstrap";
import { seedDisplayMetadata } from "./display-metadata";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";
import {
  createProjectRecalculation,
  createRecalculationBatch,
  getProjectRecalculation,
} from "./jobs";
import {
  createDraftPricingVersion,
  publishPricingVersion,
} from "./publish";
import { updateDraftPriceAmount } from "./price-items";
import { validateDraftVersion } from "./pricing";
import { RecalculationWorker, operationIdForJob } from "./worker";
import { getPriceBoard } from "@/app/admin/prices/_data/source";
import { getRecalculationBoard } from "@/app/admin/projects/_data/source";
import { defaultKitchen } from "@/lib/configurator/defaults";
import { BUILD_CALC_VERSION } from "@/lib/configurator/versions";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";
import {
  calculatePriceFromInputs,
  getProject,
  recalculateProject,
  saveProject,
} from "@/lib/server/projects";

let dir = "";

const ACTOR = { actorId: "test-owner", actorRole: "calc-admin" };
const PRICE_ITEM = "kitchen.hingePerDoor";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-price-contour-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("CA-T-504/505: единый ценовой контур Admin → Public → Recalc", () => {
  it("draft → amount → publish → public price → worker recalc → идемпотентность", async () => {
    const bootstrap = await applyBootstrap({
      pricingVersionId: "price-contour.1",
      pricingLabel: "Price contour test",
      now: "2026-11-10T00:00:00.000Z",
    });
    await seedDisplayMetadata({ actorId: "test", actorRole: "system" });
    await seedRulesSnapshotFixture();

    const saved = await saveProject({ config: defaultKitchen() });
    if (!saved.ok) throw new Error("проект не сохранён");
    if (!saved.project.calcVersion) throw new Error("calcVersion не выставлен");

    const beforeResolution = await resolveCalculationInputs({
      operation: "create",
      config: saved.project.config,
    });
    if (!beforeResolution.ok) throw new Error("inputs до публикации не разрешены");
    const beforePrice = await calculatePriceFromInputs(
      beforeResolution.value.request,
    );
    if (!beforePrice.ok) throw new Error("цена до публикации не рассчитана");

    // 1. Draft = копия опубликованной версии.
    const draft = await createDraftPricingVersion(bootstrap.version.id, ACTOR);
    const hinge = draft.version.snapshot.find(
      (entry) => entry.priceItemId === PRICE_ITEM,
    );
    if (!hinge) throw new Error("hinge отсутствует в snapshot");

    // 2. Изменение тестовой цены только в draft.
    const nextAmount = hinge.amount + 100;
    await updateDraftPriceAmount(
      PRICE_ITEM,
      { amount: nextAmount, expectedAmount: hinge.amount },
      ACTOR,
    );

    // 3. Валидация и публикация.
    const validation = await validateDraftVersion(draft.version.id);
    expect(validation.passed).toBe(true);
    const published = await publishPricingVersion(draft.version.id, ACTOR);
    expect(published.publishedSeq).toBe(2);
    expect(published.supersededVersionId).toBe(bootstrap.version.id);

    // 4. Публичный расчёт использует опубликованную версию и новую ставку.
    const afterResolution = await resolveCalculationInputs({
      operation: "create",
      config: saved.project.config,
    });
    if (!afterResolution.ok) throw new Error("inputs после публикации не разрешены");
    const snapshot = afterResolution.value.request.inputs.priceSnapshot;
    expect(snapshot.priceVersion).toBe(draft.version.id);
    expect(
      snapshot.snapshot.find((entry) => entry.priceItemId === PRICE_ITEM)?.amount,
    ).toBe(nextAmount);

    const afterPrice = await calculatePriceFromInputs(
      afterResolution.value.request,
    );
    if (!afterPrice.ok) throw new Error("цена после публикации не рассчитана");
    expect(afterPrice.price.total).toBeGreaterThan(beforePrice.price.total);

    // 5. Админский прайс-борд видит новую published и отсутствие draft.
    const priceBoard = await getPriceBoard();
    expect(priceBoard.published?.id).toBe(draft.version.id);
    expect(priceBoard.draft).toBeNull();

    // 6. Батч + задание; пересчёт выполняет worker.
    const batch = await createRecalculationBatch({
      id: "batch-contour",
      priceVersionId: draft.version.id,
      trigger: "manual",
      createdBy: "test",
    });
    if (!batch.ok) throw new Error("batch не создан");
    const job = await createProjectRecalculation({
      batchId: "batch-contour",
      projectId: saved.project.id,
      toPriceVersionId: draft.version.id,
      calcVersion: saved.project.calcVersion,
      deltaReason: "manual",
      createdBy: "test",
    });
    if (!job.ok) throw new Error("job не создан");

    const worker = new RecalculationWorker({ reconcileIntervalMs: 60_000 });
    const report = await worker.runOnce("2026-11-10T00:00:10.000Z");
    expect(report.completed).toBe(1);

    const completed = await getProjectRecalculation(job.value.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.newPrice).toBe(afterPrice.price.total);

    const projectAfter = await getProject(saved.project.id);
    if (projectAfter.status !== "ok") throw new Error("проект не прочитан");
    expect(projectAfter.project.priceVersion).toBe(draft.version.id);
    expect(projectAfter.project.config).toEqual(saved.project.config);
    expect(projectAfter.project.pins).toEqual(saved.project.pins);
    const recalcHistory = (projectAfter.project.priceHistory ?? []).filter(
      (event) => event.reason === "manual_recalc",
    );
    expect(recalcHistory).toHaveLength(1);
    expect(recalcHistory[0]?.toPriceVersionId).toBe(draft.version.id);

    const projectsBoard = await getRecalculationBoard();
    expect(projectsBoard.batch?.id).toBe("batch-contour");
    expect(projectsBoard.jobs.map((item) => item.id)).toContain(job.value.id);

    // 7. Повтор с тем же operationId — replay без дублирования истории.
    const replay = await recalculateProject({
      projectId: saved.project.id,
      operationId: operationIdForJob(job.value.id),
      targetPriceVersionId: draft.version.id,
      expectedProjectCalcVersion: BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: saved.project.priceVersion ?? null,
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.replay).toBe(true);

    const projectAfterReplay = await getProject(saved.project.id);
    if (projectAfterReplay.status !== "ok") throw new Error("проект не прочитан");
    expect(
      (projectAfterReplay.project.priceHistory ?? []).filter(
        (event) => event.reason === "manual_recalc",
      ),
    ).toHaveLength(1);
    expect(projectAfterReplay.project.config).toEqual(saved.project.config);
  });
});
