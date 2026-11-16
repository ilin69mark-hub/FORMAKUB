import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import {
  getDraftComposition,
  approveCompositionProduction,
  publishCompositionVersion,
  updateCompositionDraft,
} from "@/lib/admin/composition";
import { seedInitialCompositionDraft } from "@/lib/admin/composition-seed";
import { defaultKitchen } from "@/lib/configurator/defaults";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";
import { rulesSnapshotFixture } from "@/lib/server/rules-test-fixture";
import type { CompositionVersion } from "@/lib/admin/composition-schema";
import { updateCollection } from "@/lib/server/store";

let dir = "";
const actor = { actorId: "test-admin", actorRole: "admin" as const };

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-composition-resolver-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-composition-resolver.1",
    now: "2026-11-13T00:00:00.000Z",
  });
  await updateCollection<Record<string, unknown>, void>(
    "rules-snapshots.json",
    () => ({
      items: [rulesSnapshotFixture()],
      result: undefined,
    }),
  );
  await seedInitialCompositionDraft(actor);
  const draft = await getDraftComposition();
  if (draft) {
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
      { expectedVersion: datasheet.version, operationId: "resolver-publish-1" },
      actor,
    );
  }
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("DataResolver: composition preflight", () => {
  it("явно выбранная опубликованная версия проходит preflight", async () => {
    const draft = await getDraftComposition();
    expect(draft).toBeUndefined();
    const { getPublishedComposition } = await import("@/lib/admin/composition");
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    const result = await resolveCalculationInputs({
      operation: "preview",
      config: defaultKitchen(),
      compositionVersionId: published.id,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.compositionVersionId).toBe(published.id);
    }
  });

  it("неизвестная версия состава блокирует расчёт", async () => {
    const result = await resolveCalculationInputs({
      operation: "preview",
      config: defaultKitchen(),
      compositionVersionId: "missing-composition",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((item) => item.code)).toContain(
        "COMPOSITION_VERSION_UNKNOWN",
      );
    }
  });

  it("Q5: production расчёт блокируется без Production Gate", async () => {
    const { getPublishedComposition } = await import("@/lib/admin/composition");
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const blocked = await resolveCalculationInputs({
        operation: "preview",
        config: defaultKitchen(),
        compositionVersionId: published.id,
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.issues.map((item) => item.code)).toContain(
          "COMPOSITION_VERSION_INVALID",
        );
        expect(blocked.issues.map((item) => item.message)).toEqual(
          expect.arrayContaining([expect.stringContaining("Production Gate")]),
        );
      }
      const approved = await approveCompositionProduction(
        published.id,
        { expectedVersion: published.version },
        actor,
      );
      const allowed = await resolveCalculationInputs({
        operation: "preview",
        config: defaultKitchen(),
        compositionVersionId: approved.id,
      });
      expect(allowed.ok).toBe(true);
    } finally {
      env.NODE_ENV = previous;
    }
  });

  it("без compositionVersionId расчёт не блокируется", async () => {
    const result = await resolveCalculationInputs({
      operation: "preview",
      config: defaultKitchen(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.compositionVersionId).toBeUndefined();
    }
  });
});

describe("DataResolver: compositionPreflight handoff (E1)", () => {
  it("handoff содержит опубликованную версию и пустой массив warnings", async () => {
    const { getPublishedComposition } = await import("@/lib/admin/composition");
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    const result = await resolveCalculationInputs({
      operation: "preview",
      config: defaultKitchen(),
      compositionVersionId: published.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compositionPreflight).toBeDefined();
    expect(result.value.compositionPreflight?.compositionVersionId).toBe(
      published.id,
    );
    expect(result.value.compositionPreflight?.composition.id).toBe(published.id);
    expect(result.value.compositionPreflight?.warnings).toEqual([]);
    /* CalculationInputs/CalculationRequest не изменяются (E1-граница). */
    expect(result.value.request.inputs).not.toHaveProperty("composition");
    expect(result.value.request.inputs).not.toHaveProperty("compositionTrace");
  });

  it("проекты без Composition pin не получают handoff (В-1)", async () => {
    const result = await resolveCalculationInputs({
      operation: "preview",
      config: defaultKitchen(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compositionPreflight).toBeUndefined();
    expect(result.value.compositionVersionId).toBeUndefined();
  });

  it("drift pins — неблокирующее предупреждение, расчёт проходит (В-5/§8.5)", async () => {
    const { getPublishedComposition } = await import("@/lib/admin/composition");
    const { compositionContentHash } = await import(
      "@/lib/admin/composition-hash"
    );
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;

    const pins = { ...(published.pins ?? {}), priceVersionId: "price.drifted" };
    const contentHash = compositionContentHash(
      published.lines,
      published.rulesSnapshotId,
      pins,
    );
    await updateCollection<CompositionVersion, void>(
      "composition-versions.json",
      (items) => ({
        items: items.map((item) =>
          item.id === published.id
            ? { ...item, pins, contentHash }
            : item,
        ),
        result: undefined,
      }),
    );

    const result = await resolveCalculationInputs({
      operation: "preview",
      config: defaultKitchen(),
      compositionVersionId: published.id,
    });
    /* drift — warning: расчёт НЕ блокируется (§8.5). */
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warnings = result.value.compositionPreflight?.warnings ?? [];
    expect(warnings.map((item) => item.code)).toContain(
      "COMPOSITION_PRICE_SNAPSHOT_DRIFT",
    );
    expect(warnings.every((item) => item.code !== "COMPOSITION_VERSION_INVALID")).toBe(
      true,
    );
  });
});

describe("DataResolver: целостность и совместимость pins (E1, §8.5 block)", () => {
  it("повреждённый contentHash и несовместимый RulesSnapshot блокируют расчёт", async () => {
    const { getPublishedComposition } = await import("@/lib/admin/composition");
    const { compositionContentHash } = await import(
      "@/lib/admin/composition-hash"
    );
    const published = await getPublishedComposition();
    expect(published).toBeDefined();
    if (!published) return;
    const write = async (
      lines: CompositionVersion["lines"],
      rulesSnapshotId: string | undefined,
      pins: CompositionVersion["pins"],
    ): Promise<void> => {
      await updateCollection<CompositionVersion, void>(
        "composition-versions.json",
        (items) => ({
          items: items.map((item) =>
            item.id === published.id
              ? {
                  ...item,
                  lines,
                  rulesSnapshotId,
                  pins,
                  contentHash: compositionContentHash(
                    lines,
                    rulesSnapshotId,
                    pins,
                  ),
                }
              : item,
          ),
          result: undefined,
        }),
      );
    };

    /* (а) повреждение: строка изменена, hash не пересчитан → block. */
    await updateCollection<CompositionVersion, void>(
      "composition-versions.json",
      (items) => ({
        items: items.map((item) =>
          item.id === published.id
            ? {
                ...item,
                lines: item.lines.map((line, index) =>
                  index === 0
                    ? { ...line, sourceRef: `${line.sourceRef}-tampered` }
                    : line,
                ),
              }
            : item,
        ),
        result: undefined,
      }),
    );
    const corrupted = await resolveCalculationInputs({
      operation: "preview",
      config: defaultKitchen(),
      compositionVersionId: published.id,
    });
    expect(corrupted.ok).toBe(false);
    if (!corrupted.ok) {
      /*
       * Запись с неверным contentHash исключается из store
       * (`composition.ts:119–128`) → версия не находится → block.
       */
      expect(corrupted.issues.map((i) => i.code)).toContain(
        "COMPOSITION_VERSION_UNKNOWN",
      );
    }

    /* (б) hash пересчитан, но закреплённый RulesSnapshot чужой → block. */
    await write(published.lines, "rules.foreign", published.pins);
    const mismatch = await resolveCalculationInputs({
      operation: "preview",
      config: defaultKitchen(),
      compositionVersionId: published.id,
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.issues.map((i) => i.message).join(" ")).toContain(
        "RulesSnapshot",
      );
    }

    /* Восстановление: валидная запись снова проходит preflight. */
    await write(
      published.lines,
      published.rulesSnapshotId,
      published.pins,
    );
    const restored = await resolveCalculationInputs({
      operation: "preview",
      config: defaultKitchen(),
      compositionVersionId: published.id,
    });
    expect(restored.ok).toBe(true);
  });
});
