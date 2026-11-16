import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readCollection, updateCollection } from "@/lib/server/store";

import { buildBootstrapPlan } from "./bootstrap";
import {
  DISPLAY_LINE_IDS,
  DISPLAY_METADATA_SEED,
  computePersistedMetadataFingerprint,
  displayMetadataRecordSchema,
  lineDefinitionsSchema,
  readDisplayMetadata,
  saveDisplayMetadata,
  seedDisplayMetadata,
  validateLineDefinitions,
  type DisplayMetadataRecord,
  type LineDefinitions,
} from "./display-metadata";
import type { CatalogItem } from "./schema";

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-display-metadata-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
  const plan = buildBootstrapPlan("2026-11-09T00:00:00.000Z");
  await updateCollection<CatalogItem, void>("catalog-items.json", () => ({
    items: plan.catalogItems,
    result: undefined,
  }));
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("CA-T-306D Phase 2: display-metadata", () => {
  it("seed: 33 lineDefinitions, exact texts, fingerprint, catalog labels/source", async () => {
    const metadata = await seedDisplayMetadata({
      actorId: "bootstrap:ca-t-306d",
      actorRole: "system",
    });

    expect(Object.keys(metadata.lineDefinitions)).toHaveLength(33);
    expect(DISPLAY_LINE_IDS).toHaveLength(33);
    expect(metadata.supportsPreliminaryNote).toContain("Количества опор — предварительный расчёт");
    expect(metadata.disclaimer).toContain("Предварительный расчёт");
    expect(metadata.catalogLabels.bodyMaterial.ldsp).toBe("ЛДСП");
    expect(metadata.supportSystemSource.standard).toBe("preliminary");
    expect(metadata.ledStripSource["led-24v-9w6"]).toBe("preliminary");
    expect(metadata.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    /* CA-GL-24: отпечаток покрывает только персистентное содержимое. */
    expect(metadata.fingerprint).toBe(
      computePersistedMetadataFingerprint({
        lineDefinitions: metadata.lineDefinitions,
        supportsPreliminaryNote: metadata.supportsPreliminaryNote,
        disclaimer: metadata.disclaimer,
      }),
    );

    const records = await readCollection<DisplayMetadataRecord>("display-metadata");
    expect(records).toHaveLength(3);
    expect(records.map((record) => record.id).sort()).toEqual([
      "lineDefinitions",
      "pricing.disclaimer",
      "supports.preliminaryNote",
    ]);
  });

  it("повторный seed идемпотентен, audit не дублируется", async () => {
    const firstAudit = await readCollection<Record<string, unknown>>("admin-audit-log.json");
    const first = await readDisplayMetadata();
    const second = await seedDisplayMetadata({
      actorId: "bootstrap:ca-t-306d",
      actorRole: "system",
    });
    const secondAudit = await readCollection<Record<string, unknown>>("admin-audit-log.json");

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(secondAudit).toHaveLength(firstAudit.length);
    expect(secondAudit.filter((event) => event.action === "display.update")).toHaveLength(1);
  });

  it("lineDefinitions: все 33 ID, unknown ID/field отклоняются", () => {
    expect(validateLineDefinitions(DISPLAY_METADATA_SEED)).toEqual([]);

    const unknownId = structuredClone(DISPLAY_METADATA_SEED) as Record<string, unknown>;
    unknownId["unknown.line"] = unknownId["kitchen.base"];
    expect(lineDefinitionsSchema.safeParse(unknownId).success).toBe(false);

    const record = {
      id: "pricing.disclaimer",
      kind: "text",
      value: "x",
      version: "1",
      updatedAt: "2026-11-09T00:00:00.000Z",
      updatedBy: "test",
      extra: true,
    };
    expect(displayMetadataRecordSchema.safeParse(record).success).toBe(false);
  });

  it("cm-to-m разрешён только для wardrobe.plinth.widthCm/fixed1/м", () => {
    const valid = structuredClone(DISPLAY_METADATA_SEED) as LineDefinitions;
    expect(validateLineDefinitions(valid)).toEqual([]);

    const badField = structuredClone(DISPLAY_METADATA_SEED) as LineDefinitions;
    const segment = badField["wardrobe.plinth"].detailSegments[0];
    if (segment?.kind === "numberWithUnit") segment.field = "widthM";
    expect(validateLineDefinitions(badField).length).toBeGreaterThan(0);

    const badConversion = structuredClone(DISPLAY_METADATA_SEED) as LineDefinitions;
    const other = badConversion["kitchen.body"].detailSegments[0];
    if (other?.kind === "number") {
      badConversion["kitchen.body"].detailSegments[0] = {
        kind: "numberWithUnit",
        field: "moduleCount",
        format: "fixed1",
        unit: "м",
        conversion: "cm-to-m",
      };
    }
    expect(validateLineDefinitions(badConversion).length).toBeGreaterThan(0);
  });

  it("fingerprint mismatch блокирует чтение без fallback", async () => {
    const records = await readCollection<DisplayMetadataRecord>("display-metadata");
    const line = records.find(
      (record): record is Extract<DisplayMetadataRecord, { kind: "line-definitions" }> =>
        record.kind === "line-definitions",
    );
    if (!line) throw new Error("lineDefinitions missing");
    line.fingerprint = "0".repeat(64);
    await updateCollection<DisplayMetadataRecord, void>("display-metadata", () => ({
      items: records,
      result: undefined,
    }));

    await expect(readDisplayMetadata()).rejects.toThrow(/fingerprint/);
  });

  it("save с изменённым disclaimer пишет новую версию и audit", async () => {
    const before = await readCollection<Record<string, unknown>>("admin-audit-log.json");
    const metadata = await saveDisplayMetadata(
      {
        lineDefinitions: DISPLAY_METADATA_SEED,
        supportsPreliminaryNote:
          "Количества опор — предварительный расчёт. Итоговые характеристики опор и допустимые нагрузки подтверждаются паспортными данными выбранной системы фурнитуры.",
        disclaimer: "Новый утверждённый display disclaimer.",
      },
      { actorId: "admin", actorRole: "calc-admin" },
      "2026-11-09T03:00:00.000Z",
    );
    const after = await readCollection<Record<string, unknown>>("admin-audit-log.json");
    expect(metadata.disclaimer).toBe("Новый утверждённый display disclaimer.");
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)?.action).toBe("display.update");

    const records = await readCollection<DisplayMetadataRecord>("display-metadata");
    expect(records.find((record) => record.id === "pricing.disclaimer")?.version).toBe("2");
  });
});

describe("CA-GL-24: каталог не инвалидирует Display Metadata", () => {
  it("изменение label и добавление CatalogItem не ломают чтение", async () => {
    await seedDisplayMetadata({
      actorId: "ca-gl-24",
      actorRole: "system",
    });
    const before = await readDisplayMetadata();

    /* 1. Меняем отображаемое название существующего материала. */
    await updateCollection<CatalogItem, void>("catalog-items.json", (items) => ({
      items: items.map((item) =>
        item.catalog === "bodyMaterial" && item.id === "ldsp"
          ? { ...item, label: "ЛДСП (новое название)" }
          : item,
      ),
      result: undefined,
    }));

    const afterRename = await readDisplayMetadata();
    expect(afterRename.catalogLabels.bodyMaterial.ldsp).toBe(
      "ЛДСП (новое название)",
    );
    expect(afterRename.fingerprint).toBe(before.fingerprint);
    expect(afterRename.lineDefinitions).toEqual(before.lineDefinitions);

    /* 2. Добавляем новый CatalogItem. */
    await updateCollection<CatalogItem, void>("catalog-items.json", (items) => ({
      items: [
        ...items,
        {
          ...items[0],
          catalog: "facadeMaterial",
          id: "mdf_pvc",
          label: "МДФ в плёнке ПВХ",
        },
      ],
      result: undefined,
    }));

    const afterAdd = await readDisplayMetadata();
    expect(afterAdd.catalogLabels.facadeMaterial.mdf_pvc).toBe("МДФ в плёнке ПВХ");
    expect(afterAdd.fingerprint).toBe(before.fingerprint);
    expect(afterAdd.lineDefinitions).toEqual(before.lineDefinitions);
  });

  it("повреждение lineDefinitions по-прежнему отклоняется", async () => {
    await seedDisplayMetadata({ actorId: "ca-gl-24", actorRole: "system" });
    await updateCollection<DisplayMetadataRecord, void>(
      "display-metadata",
      (items) => ({
        items: items.map((record) =>
          record.kind === "line-definitions"
            ? {
                ...record,
                value: {
                  ...(record.value as LineDefinitions),
                  "kitchen.base": {
                    ...(record.value as LineDefinitions)["kitchen.base"],
                    label: "ПОДМЕНЕНО",
                  },
                },
              }
            : record,
        ),
        result: undefined,
      }),
    );
    await expect(readDisplayMetadata()).rejects.toThrow(/fingerprint/);
  });
});
