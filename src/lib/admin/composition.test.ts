import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import {
  CompositionValidationError,
  approveCompositionProduction,
  confirmCompositionLine,
  createCompositionDraft,
  deleteCompositionDraft,
  getDraftComposition,
  getPublishedComposition,
  listCompositionVersions,
  publishCompositionVersion,
  updateCompositionDraft,
  validateCompositionVersion,
} from "@/lib/admin/composition";
import {
  INITIAL_COMPOSITION_ID,
  buildInitialCompositionLines,
  seedInitialCompositionDraft,
} from "@/lib/admin/composition-seed";
import { transitionProjectComposition } from "@/lib/admin/composition-transition";
import { recoverCompositionPublications } from "@/lib/admin/composition-journal";
import { compositionContentHash } from "@/lib/admin/composition-hash";
import { validateCompositionForConfig } from "@/lib/admin/composition";
import { getInspectorProject } from "@/lib/admin/calculation-inspector";
import { getPublishedVersion } from "@/lib/admin/pricing";
import { managedRulesSeedSpecs } from "@/lib/admin/managed-rules-seed";
import { rulesSnapshotFixture } from "@/lib/server/rules-test-fixture";
import { recoverCompositionTransitions } from "@/lib/admin/composition-transition-journal";
import { defaultKitchen } from "@/lib/configurator/defaults";
import type { PriceBreakdown, StoredProject } from "@/lib/configurator/types";
import { listAuditEvents } from "@/lib/server/audit";
import { applyProjectPriceHistory } from "@/lib/server/projects";
import { readCollection, updateCollection } from "@/lib/server/store";
import type { CompositionVersion } from "@/lib/admin/composition-schema";

let dir = "";
const actor = { actorId: "test-admin", actorRole: "admin" as const };

function price(): PriceBreakdown {
  return {
    currency: "RUB",
    baseCost: 12000,
    bodyCost: 50000,
    frontsCost: 30000,
    fittingsCost: 10000,
    optionsCost: 40000,
    complexityFactor: 1,
    subtotal: 142000,
    discount: 0,
    total: 142000,
    minOrderApplied: false,
    lines: [{ label: "Корпус", amount: 50000 }],
    promo: null,
    disclaimer: "test",
  };
}

async function makeDraftDatasheet() {
  const draft = await getDraftComposition();
  if (!draft) throw new Error("draft not found");
  const lines = draft.lines.map((line) => ({
    ...line,
    source: "datasheet" as const,
    confirmation: undefined,
  }));
  return updateCompositionDraft(
    draft.id,
    { expectedVersion: draft.version, lines },
    actor,
  );
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-composition-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-composition.1",
    pricingLabel: "composition test",
    now: "2026-11-13T00:00:00.000Z",
  });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("Composition Management", () => {
  it("начальный импорт детерминирован, идемпотентен и не публикует", async () => {
    const first = await seedInitialCompositionDraft(actor);
    expect(first.created).toBe(true);
    expect(first.versionId).toBe(INITIAL_COMPOSITION_ID);
    expect(first.status).toBe("draft");
    const second = await seedInitialCompositionDraft(actor);
    expect(second.created).toBe(false);
    expect(second.versionId).toBe(INITIAL_COMPOSITION_ID);
    const draft = await getDraftComposition();
    expect(draft?.status).toBe("draft");
    expect(draft?.lines.length).toBeGreaterThan(10);
    expect(await getPublishedComposition()).toBeUndefined();

    const built = buildInitialCompositionLines();
    expect(built.skipped.some((item) => item.includes("sink-partition"))).toBe(true);
  });

  it("preliminary draft блокируется, datasheet — валиден; сумм в строках нет", async () => {
    const draft = await getDraftComposition();
    expect(draft).toBeDefined();
    if (!draft) return;
    const preliminaryValidation = await validateCompositionVersion(draft);
    expect(preliminaryValidation.ok).toBe(false);
    expect(
      preliminaryValidation.errors.some(
        (item) => item.code === "COMPOSITION_LINE_PRELIMINARY",
      ),
    ).toBe(true);
    for (const line of draft.lines) {
      expect("amount" in line).toBe(false);
    }

    const datasheet = await makeDraftDatasheet();
    const validation = await validateCompositionVersion(datasheet);
    expect(validation.errors).toEqual([]);
    expect(validation.warnings).toEqual([]);
  });

  it("Q3: owner_confirmed назначается только отдельной операцией", async () => {
    const draft = await getDraftComposition();
    expect(draft).toBeDefined();
    if (!draft) return;
    const target = draft.lines.find((line) => line.source === "datasheet");
    expect(target).toBeDefined();
    if (!target) return;
    const confirmed = await confirmCompositionLine(
      draft.id,
      {
        expectedVersion: draft.version,
        lineId: target.id,
        reference: "owner-doc-2026-11-16",
      },
      actor,
    );
    const line = confirmed.lines.find((item) => item.id === target.id);
    expect(line?.source).toBe("owner_confirmed");
    expect(line?.confirmation?.by).toBe(actor.actorId);
    expect(line?.confirmation?.reference).toBe("owner-doc-2026-11-16");
    await expect(
      updateCompositionDraft(
        confirmed.id,
        {
          expectedVersion: confirmed.version,
          lines: confirmed.lines.map((item) =>
            item.id === target.id ? { ...item, componentId: "mdf" } : item,
          ),
        },
        actor,
      ),
    ).rejects.toThrow(/owner_confirmed/);
  });

  it("A01: duplicate id не сохраняется и не портит коллекцию", async () => {
    const draft = await getDraftComposition();
    expect(draft).toBeDefined();
    if (!draft) return;
    await expect(
      updateCompositionDraft(
        draft.id,
        {
          expectedVersion: draft.version,
          lines: [draft.lines[0]!, { ...draft.lines[0]!, id: draft.lines[0]!.id }],
        },
        actor,
      ),
    ).rejects.toThrow(/дубликат id/);
  });

  it("A02/A05/A06/A12/Q8: hash, code, price link, conditional проверяются", async () => {
    const draft = await getDraftComposition();
    expect(draft).toBeDefined();
    if (!draft) return;
    const hashBroken = { ...draft, contentHash: "0".repeat(64) };
    expect((await validateCompositionVersion(hashBroken)).errors.map((item) => item.code)).toContain(
      "COMPOSITION_HASH_MISMATCH",
    );

    const unknownCodeLines = draft.lines.map((line, index) =>
      index === 0
        ? { ...line, quantityRef: { kind: "code" as const, implementationId: "unknown-handler" } }
        : line,
    );
    const unknownCode = {
      ...draft,
      lines: unknownCodeLines,
      contentHash: compositionContentHash(unknownCodeLines, draft.rulesSnapshotId, draft.pins),
    };
    expect((await validateCompositionVersion(unknownCode)).errors.map((item) => item.code)).toContain(
      "COMPOSITION_CODE_UNKNOWN",
    );

    const conditionCodeLines = draft.lines.map((line, index) =>
      index === 0
        ? {
            ...line,
            condition: { kind: "code" as const, implementationId: "unknown-condition" },
          }
        : line,
    );
    const conditionCode = {
      ...draft,
      lines: conditionCodeLines,
      contentHash: compositionContentHash(conditionCodeLines, draft.rulesSnapshotId, draft.pins),
    };
    expect((await validateCompositionVersion(conditionCode)).errors.map((item) => item.code)).toContain(
      "COMPOSITION_CONDITION_CODE_UNKNOWN",
    );

    const mismatchLines = draft.lines.map((line, index) =>
      index === 0
        ? { ...line, componentCatalog: "bodyMaterial" as const, componentId: "ldsp", priceItemId: "kitchen.hingePerDoor" }
        : line,
    );
    const mismatch = {
      ...draft,
      lines: mismatchLines,
      contentHash: compositionContentHash(mismatchLines, draft.rulesSnapshotId, draft.pins),
    };
    expect((await validateCompositionVersion(mismatch)).errors.map((item) => item.code)).toContain(
      "COMPOSITION_PRICE_NOT_LINKED",
    );

    const conditionalLines = draft.lines.map((line, index) =>
      index === 0 ? { ...line, relation: "conditional" as const, condition: undefined } : line,
    );
    const conditional = {
      ...draft,
      lines: conditionalLines,
      contentHash: compositionContentHash(conditionalLines, draft.rulesSnapshotId, draft.pins),
    };
    expect((await validateCompositionVersion(conditional)).errors.map((item) => item.code)).toContain(
      "COMPOSITION_CONDITION_REQUIRED",
    );
  });

  it("Q1: composition и project rules snapshot несовместимы", async () => {
    const draft = await getDraftComposition();
    const pricing = await getPublishedVersion();
    expect(draft).toBeDefined();
    expect(pricing).toBeDefined();
    if (!draft || !pricing) return;
    const versionWithRules = { ...draft, rulesSnapshotId: "rules-A", status: "published" as const };
    const issues = await validateCompositionForConfig(
      versionWithRules,
      defaultKitchen(),
      {
        priceVersion: pricing.id,
        snapshot: pricing.snapshot,
        rules: pricing.rules as never,
        signedAdjustments: (pricing.signedAdjustments ?? []) as never,
        promos: pricing.promos,
        baseSchema: pricing.baseSchema,
      },
      "rules-B",
    );
    expect(issues.map((item) => item.code)).toContain(
      "COMPOSITION_RULES_SNAPSHOT_MISMATCH",
    );
  });

  it("ожидаемая версия и contentHash защищают draft", async () => {
    const draft = await getDraftComposition();
    expect(draft).toBeDefined();
    if (!draft) return;
    const before = draft.contentHash;
    await expect(
      updateCompositionDraft(draft.id, { expectedVersion: 99, lines: draft.lines }, actor),
    ).rejects.toThrow(/Конфликт версии/);

    const extra = {
      ...draft.lines[0]!,
      id: "line-extra-check",
      source: "datasheet" as const,
      confirmation: undefined,
      priceItemId: "kitchen.shelf",
      condition: { kind: "text" as const, text: "отличающееся условие" },
      sortOrder: 9999,
    };
    const updated = await updateCompositionDraft(
      draft.id,
      { expectedVersion: draft.version, lines: [...draft.lines, extra] },
      actor,
    );
    expect(updated.version).toBe(draft.version + 1);
    expect(updated.contentHash).not.toBe(before);
  });

  it("некорректные ссылки и fixed-preliminary блокируются", async () => {
    const draft = await getDraftComposition();
    expect(draft).toBeDefined();
    if (!draft) return;
    const broken: CompositionVersion = {
      ...draft,
      lines: [
        {
          id: "line-broken",
          moduleType: "base",
          priceItemId: "missing.price",
          relation: "required",
          quantityRef: { kind: "fixed", value: 1, unit: "pcs" },
          sourceRef: "test",
          source: "preliminary",
          sortOrder: 1,
        },
      ],
    };
    const validation = await validateCompositionVersion(broken);
    expect(validation.ok).toBe(false);
    expect(validation.errors.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "COMPOSITION_PRICE_MISSING",
        "COMPOSITION_FIXED_NOT_CONFIRMED",
        "COMPOSITION_MODULE_COVERAGE",
      ]),
    );
  });

  it("дубли строк и preliminary-правило обнаруживаются", async () => {
    const draft = await getDraftComposition();
    expect(draft).toBeDefined();
    if (!draft) return;
    const duplicate = {
      ...draft,
      lines: [
        ...draft.lines,
        { ...draft.lines[0]!, id: "line-duplicate" },
      ],
    };
    const duplicateValidation = await validateCompositionVersion(duplicate);
    expect(duplicateValidation.errors.map((item) => item.code)).toContain(
      "COMPOSITION_DUPLICATE_LINE",
    );

    const spec = managedRulesSeedSpecs()[0]!;
    await updateCollection<Record<string, unknown>, void>(
      "managed-rules.json",
      () => ({
        items: [
          {
            ...spec,
            status: "draft",
            source: "preliminary",
            version: "1",
            createdAt: "2026-11-13T00:00:00.000Z",
            updatedAt: "2026-11-13T00:00:00.000Z",
            updatedBy: "test",
          },
        ],
        result: undefined,
      }),
    );
    const ruleLines = draft.lines.map((line, index) =>
      index === 0
        ? {
            ...line,
            quantityRef: { kind: "managed_rule" as const, ruleId: spec.id },
          }
        : line,
    );
    const withRule = {
      ...draft,
      lines: ruleLines,
      contentHash: compositionContentHash(ruleLines, draft.rulesSnapshotId, draft.pins),
    };
    const ruleValidation = await validateCompositionVersion(withRule);
    expect(ruleValidation.errors.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "COMPOSITION_RULES_SNAPSHOT_MISSING",
      ]),
    );
  });

  it("публикация: immutable, seq, hash и аудит", async () => {
    const draft = await getDraftComposition();
    expect(draft).toBeDefined();
    if (!draft) return;
    const published = await publishCompositionVersion(
      draft.id,
      { expectedVersion: draft.version, operationId: "publish-1" },
      actor,
    );
    expect(published.status).toBe("published");
    expect(published.publishedSeq).toBe(1);
    expect(published.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await getDraftComposition()).toBeUndefined();

    const audit = await listAuditEvents({ action: "composition.publish" });
    expect(audit.some((event) => event.requestId === "publish-1")).toBe(true);

    await expect(
      updateCompositionDraft(
        published.id,
        { expectedVersion: published.version, lines: published.lines },
        actor,
      ),
    ).rejects.toThrow(/статусе published/);

    await expect(
      deleteCompositionDraft(published.id, published.version, actor),
    ).rejects.toThrow(/удаление запрещено/);
  });

  it("Q1: отсутствующее правило в закреплённом снимке блокируется", async () => {
    await updateCollection<Record<string, unknown>, void>(
      "rules-snapshots.json",
      () => ({ items: [rulesSnapshotFixture()], result: undefined }),
    );
    const draft = await getPublishedComposition();
    expect(draft).toBeDefined();
    if (!draft) return;
    const lines = draft.lines.map((line, index) =>
      index === 0
        ? {
            ...line,
            quantityRef: { kind: "managed_rule" as const, ruleId: "rule-missing" },
          }
        : line,
    );
    const version = {
      ...draft,
      rulesSnapshotId: "rules-test-fixture",
      lines,
      contentHash: compositionContentHash(lines, "rules-test-fixture", draft.pins),
    };
    const validation = await validateCompositionVersion(version, {
      rulesSnapshotId: "rules-test-fixture",
    });
    expect(validation.errors.map((item) => item.code)).toContain(
      "COMPOSITION_RULE_NOT_IN_SNAPSHOT",
    );
  });

  it("Q4/Q5: публикация фиксирует commercial pins, Production Gate отдельный", async () => {
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    expect(published.pins?.priceVersionId).toBe("price-composition.1");
    expect(published.pins?.priceItemVersions).toBeTruthy();
    expect(published.production?.status).toBe("not_ready");
    const before = await validateCompositionForConfig(
      published,
      defaultKitchen(),
      {
        priceVersion: "price-composition.1",
        snapshot: [],
        rules: {} as never,
        signedAdjustments: [],
        promos: [],
        baseSchema: 2,
      },
      undefined,
      { requireProductionApproval: true },
    );
    expect(before.map((item) => item.code)).toContain(
      "COMPOSITION_PRODUCTION_NOT_APPROVED",
    );
    const approved = await approveCompositionProduction(
      published.id,
      { expectedVersion: published.version },
      actor,
    );
    expect(approved.production?.status).toBe("approved");
    expect(approved.production?.approvedBy).toBe(actor.actorId);
  });

  it("новый draft из published и публикация новой версии", async () => {
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    const draft = await createCompositionDraft(
      { sourceVersionId: published.id, notes: "next" },
      actor,
    );
    expect(draft.status).toBe("draft");
    expect(draft.lines.map((line) => line.id)).toEqual(
      published.lines.map((line) => line.id),
    );
    const next = await publishCompositionVersion(
      draft.id,
      { expectedVersion: draft.version, operationId: "publish-2" },
      actor,
    );
    expect(next.publishedSeq).toBe(2);
    const all = await listCompositionVersions();
    expect(all.filter((item) => item.status === "published")).toHaveLength(1);
    expect(all.find((item) => item.id === published.id)?.status).toBe("superseded");
  });

  it("A16: replay завершённой публикации после supersede идемпотентен", async () => {
    const versions = await listCompositionVersions();
    const superseded = versions.find((version) => version.status === "superseded");
    expect(superseded).toBeDefined();
    if (!superseded) return;
    const replay = await publishCompositionVersion(
      superseded.id,
      { expectedVersion: superseded.version, operationId: "publish-1" },
      actor,
    );
    expect(replay.id).toBe(superseded.id);
    expect(replay.status).toBe("superseded");
  });

  it("не публикует draft с ошибкой валидации", async () => {
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    const draft = await createCompositionDraft({ sourceVersionId: published.id }, actor);
    const broken = {
      ...draft.lines[0]!,
      id: "line-broken-publish",
      source: "datasheet" as const,
      confirmation: undefined,
      priceItemId: "missing.price",
      sortOrder: 99999,
    };
    const updated = await updateCompositionDraft(
      draft.id,
      { expectedVersion: draft.version, lines: [...draft.lines, broken] },
      actor,
    );
    await expect(
      publishCompositionVersion(
        draft.id,
        { expectedVersion: updated.version, operationId: "publish-broken" },
        actor,
      ),
    ).rejects.toBeInstanceOf(CompositionValidationError);
    await deleteCompositionDraft(draft.id, updated.version, actor);
  });

  it("pinning проекта: явный переход, аудит, idempotency, без изменения цены", async () => {
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    const project: StoredProject = {
      id: "p-composition",
      config: defaultKitchen(),
      schemaVersion: 2,
      calcVersion: "calc-2026.11.2",
      priceVersion: "price-composition.1",
      price: price(),
      createdAt: "2026-11-13T00:00:00.000Z",
      updatedAt: "2026-11-13T00:00:00.000Z",
    };
    await updateCollection<StoredProject, void>("projects.json", (items) => ({
      items: [...items, project],
      result: undefined,
    }));
    const result = await transitionProjectComposition({
      projectId: project.id,
      compositionVersionId: published.id,
      expectedUpdatedAt: project.updatedAt,
      operationId: "pin-1",
      actor,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.compositionVersionId).toBe(published.id);
    expect(result.project.price).toEqual(project.price);
    const stale = await transitionProjectComposition({
      projectId: project.id,
      compositionVersionId: published.id,
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      operationId: "pin-stale",
      actor,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.status).toBe(409);
    const replay = await transitionProjectComposition({
      projectId: project.id,
      compositionVersionId: published.id,
      expectedUpdatedAt: project.updatedAt,
      operationId: "pin-1",
      actor,
    });
    expect(replay.ok && replay.replay).toBe(true);
    const audit = await listAuditEvents({ action: "project.composition_transition" });
    expect(audit.some((event) => event.requestId === "pin-1")).toBe(true);
    const stored = (await readCollection<StoredProject>("projects.json")).find(
      (item) => item.id === project.id,
    );
    expect(stored?.compositionVersionId).toBe(published.id);
    expect(stored?.price).toEqual(project.price);
  });

  it("Q1/A21: recovery перехода дописывает audit для применённого pin", async () => {
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    const project = (await readCollection<StoredProject>("projects.json")).find(
      (item) => item.id === "p-composition",
    );
    expect(project).toBeDefined();
    if (!project) return;
    const operationId = "recover-pin-1";
    await updateCollection<Record<string, unknown>, void>(
      "composition-transition-journal.json",
      (items) => ({
        items: [
          ...items.filter((item) => item.operationId !== operationId),
          {
            operationId,
            projectId: project.id,
            targetVersionId: project.compositionVersionId,
            expectedUpdatedAt: project.updatedAt,
            previousCompositionVersionId: null,
            phase: "project_updated",
            createdAt: "2026-11-16T00:00:00.000Z",
            updatedAt: "2026-11-16T00:00:00.000Z",
          },
        ],
        result: undefined,
      }),
    );
    const recovery = await recoverCompositionTransitions();
    expect(recovery.failed).toBe(0);
    expect(recovery.finalized).toBeGreaterThanOrEqual(1);
    const audit = await listAuditEvents({
      action: "project.composition_transition",
    });
    expect(audit.some((event) => event.requestId === operationId)).toBe(true);
  });

  it("A08: worker-событие с другим composition pin не перезаписывает pin", async () => {
    const project = (await readCollection<StoredProject>("projects.json")).find(
      (item) => item.id === "p-composition",
    );
    expect(project?.compositionVersionId).toBeTruthy();
    if (!project) return;
    const result = await applyProjectPriceHistory({
      expectedSourcePriceVersion: project.priceVersion ?? null,
      event: {
        id: "event-pin-race",
        projectId: project.id,
        operationId: "event-pin-race-op",
        reason: "manual_recalc",
        fromPriceVersionId: project.priceVersion ?? null,
        toPriceVersionId: project.priceVersion ?? "price-composition.1",
        schemaVersion: 2,
        calcVersion: "calc-2026.11.2",
        oldPrice: project.price.total,
        newPrice: project.price.total,
        delta: 0,
        breakdown: project.price,
        breakdownVersion: 1,
        compositionVersionId: "other-composition",
        requestFingerprint: "a".repeat(64),
        requestFingerprintVersion: "sha256-canonical-json-v1",
        computedAt: "2026-11-16T00:00:00.000Z",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain(
        "COMPOSITION_PIN_CHANGED",
      );
    }
    const after = (await readCollection<StoredProject>("projects.json")).find(
      (item) => item.id === project.id,
    );
    expect(after?.compositionVersionId).toBe(project.compositionVersionId);
  });

  it("preflight состава: отсутствующий тариф в snapshot — ошибка", async () => {
    const published = await getPublishedComposition();
    const pricing = await getPublishedVersion();
    expect(published).toBeDefined();
    expect(pricing).toBeDefined();
    if (!published || !pricing) return;
    const target = published.lines.find(
      (line) => line.priceItemId && line.moduleType === "sink",
    );
    expect(target).toBeDefined();
    const broken = {
      ...published,
      lines: published.lines.map((line) =>
        line.id === target?.id ? { ...line, priceItemId: "missing.price" } : line,
      ),
    };
    const issues = await validateCompositionForConfig(broken, defaultKitchen(), {
      priceVersion: pricing.id,
      snapshot: pricing.snapshot,
      rules: pricing.rules as never,
      signedAdjustments: (pricing.signedAdjustments ?? []) as never,
      promos: pricing.promos,
      baseSchema: pricing.baseSchema,
    });
    expect(issues.map((item) => item.code)).toContain(
      "COMPOSITION_PRICE_NOT_IN_SNAPSHOT",
    );
  });

  it("recovery завершает audit для опубликованной версии", async () => {
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    const operationId = "recover-composition-1";
    await updateCollection<Record<string, unknown>, void>(
      "composition-publication-journal.json",
      (items) => ({
        items: [
          ...items.filter((item) => item.operationId !== operationId),
          {
            operationId,
            versionId: published.id,
            expectedVersion: published.version,
            contentHash: published.contentHash,
            actorId: actor.actorId,
            actorRole: actor.actorRole,
            phase: "version_published",
            createdAt: "2026-11-13T00:00:00.000Z",
            updatedAt: "2026-11-13T00:00:00.000Z",
          },
        ],
        result: undefined,
      }),
    );
    const result = await recoverCompositionPublications();
    expect(result.failed).toBe(0);
    expect(result.finalized).toBeGreaterThanOrEqual(1);
    const audit = await listAuditEvents({ action: "composition.publish" });
    expect(audit.some((event) => event.requestId === operationId)).toBe(true);
  });

  it("A21: recovery mutation journal дописывает audit идемпотентно", async () => {
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    const operationId = "recover-mutation-1";
    await updateCollection<Record<string, unknown>, void>(
      "composition-transition-journal.json",
      (items) => ({
        items: [
          ...items.filter((item) => item.operationId !== operationId),
          {
            operationId,
            action: "composition_update",
            entityId: published.id,
            actorId: actor.actorId,
            actorRole: actor.actorRole,
            auditAction: "composition.update",
            afterVersion: published.version,
            auditNewValue: { versionId: published.id, recovered: true },
            phase: "project_updated",
            createdAt: "2026-11-16T00:00:00.000Z",
            updatedAt: "2026-11-16T00:00:00.000Z",
          },
        ],
        result: undefined,
      }),
    );
    const first = await recoverCompositionTransitions();
    expect(first.failed).toBe(0);
    expect(first.finalized).toBeGreaterThanOrEqual(1);
    const second = await recoverCompositionTransitions();
    expect(second.failed).toBe(0);
    const audit = await listAuditEvents({ action: "composition.update" });
    expect(audit.filter((event) => event.requestId === operationId)).toHaveLength(1);
  });

  it("старый проект без compositionVersionId читается", async () => {
    const oldProject: StoredProject = {
      id: "p-old-composition",
      config: defaultKitchen(),
      schemaVersion: 2,
      calcVersion: "calc-2026.11.2",
      priceVersion: "price-composition.1",
      price: price(),
      createdAt: "2026-11-13T00:00:00.000Z",
      updatedAt: "2026-11-13T00:00:00.000Z",
    };
    await updateCollection<StoredProject, void>("projects.json", (items) => ({
      items: [...items, oldProject],
      result: undefined,
    }));
    const inspected = await getInspectorProject(oldProject.id);
    expect(inspected.ok).toBe(true);
    if (inspected.ok) {
      expect(inspected.data.project.compositionVersionId).toBeNull();
      expect(inspected.data.project.priceVersion).toBe("price-composition.1");
    }
  });

  it("нельзя закрепить неопубликованную версию", async () => {
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    const draft = await createCompositionDraft({ sourceVersionId: published.id }, actor);
    const result = await transitionProjectComposition({
      projectId: "p-composition",
      compositionVersionId: draft.id,
      expectedUpdatedAt: (await readCollection<StoredProject>("projects.json")).find(
        (item) => item.id === "p-composition",
      )!.updatedAt,
      operationId: "pin-draft",
      actor,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    await deleteCompositionDraft(draft.id, draft.version, actor);
  });
});
