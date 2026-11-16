import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ActorContext } from "./parameters";
import {
  createManagedRule,
  createManagedRuleRevision,
  listManagedRules,
  managedRuleSchema,
  publishRulesSnapshot,
  resolveActiveRulesSnapshot,
  resolveRulesSnapshotById,
  rulesSnapshotContentHash,
  updateManagedRule,
  type ManagedRule,
  type ManagedRuleDraftInput,
} from "./managed-rules";
import { listAuditEvents } from "@/lib/server/audit";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

const rulesPath = (): string => path.join(dir, "managed-rules.json");
const snapshotsPath = (): string => path.join(dir, "rules-snapshots.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-rules-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data), "utf8");
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function draftRule(
  overrides: Partial<ManagedRuleDraftInput> = {},
): ManagedRuleDraftInput {
  return {
    name: "Количество петель по полосе",
    description: "Высота/масса двери → количество петель (перенос нормы 1.1)",
    category: "quantity",
    scope: "wardrobe",
    condition: { subject: "kind", operator: "equals", value: "wardrobe" },
    assigns: "line:wardrobe.fittings",
    value: 2,
    valueType: "int",
    sourceRef: "src/lib/configurator/wardrobe-hinges.ts:30-39",
    source: "owner_confirmed",
    affects: ["quantity"],
    ...overrides,
  };
}

async function createDraft(
  overrides: Partial<ManagedRuleDraftInput> = {},
): Promise<ManagedRule> {
  return createManagedRule(draftRule(overrides), ACTOR);
}

function publishingRuleVersion(
  rule: ManagedRule,
): Array<{ id: string; expectedVersion: string }> {
  return [{ id: rule.id, expectedVersion: rule.version }];
}

describe("ManagedRule: контракт и draft-хранение", () => {
  it("создаёт правило только в status=draft с version=1 и пишет аудит", async () => {
    const created = await createDraft();

    expect(created.id).toMatch(/^rule-[a-f0-9]{12}$/);
    expect(created.status).toBe("draft");
    expect(created.version).toBe("1");
    expect(created.updatedBy).toBe(ACTOR.actorId);

    const stored = readJson<ManagedRule[]>(rulesPath());
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(created.id);

    const events = await listAuditEvents({ action: "rule.create" });
    expect(events).toHaveLength(1);
    expect(events[0].entityId).toBe(created.id);
    expect(events[0].newValue).toMatchObject({ status: "draft", version: "1" });
  });

  it("listManagedRules возвращает сохранённые записи", async () => {
    await createDraft();
    const items = await listManagedRules();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("draft");
  });

  it("отклоняет глубину вложенности > 2", async () => {
    await expect(
      createDraft({
        condition: {
          all: [
            {
              any: [
                { all: [{ subject: "kind", operator: "equals", value: "wardrobe" }] },
              ],
            },
          ],
        },
      }),
    ).rejects.toThrow(/глубина вложенности/);
  });

  it("отклоняет > 8 предикатов", async () => {
    const predicate = { subject: "kind" as const, operator: "equals" as const, value: "wardrobe" as const };
    await expect(
      createDraft({ condition: { all: Array.from({ length: 9 }, () => predicate) } }),
    ).rejects.toThrow(/предикатов 9 > 8/);
  });

  it("отклоняет неизвестный оператор", async () => {
    await expect(
      createDraft({
        condition: { subject: "kind", operator: "matches" as never, value: "wardrobe" },
      }),
    ).rejects.toThrow();
  });

  it("отклоняет in со скалярным значением и диапазон для не-dimension", async () => {
    await expect(
      createDraft({ condition: { subject: "kind", operator: "in", value: "wardrobe" } }),
    ).rejects.toThrow(/массив значений/);

    await expect(
      createDraft({ condition: { subject: "zone", operator: "greaterThan", value: 10 } }),
    ).rejects.toThrow(/только для subject=dimension/);

    await expect(
      createDraft({
        condition: { subject: "dimension", operator: "in", value: ["100"] },
      }),
    ).rejects.toThrow(/недопустим для subject=dimension/);
  });

  it("отклоняет dimension со строкой и option со строкой", async () => {
    await expect(
      createDraft({
        condition: { subject: "dimension", operator: "greaterThan", value: "100" },
      }),
    ).rejects.toThrow(/конечное число/);

    await expect(
      createDraft({ condition: { subject: "option", operator: "equals", value: "on" } }),
    ).rejects.toThrow(/option требует boolean/);
  });

  it("отклоняет несовпадение valueType и value", async () => {
    await expect(createDraft({ value: "два", valueType: "int" })).rejects.toThrow(
      /valueType=int/,
    );
  });

  it("отклоняет неизвестные поля записи", async () => {
    await expect(
      createManagedRule(
        { ...draftRule(), extra: true } as unknown as ManagedRuleDraftInput,
        ACTOR,
      ),
    ).rejects.toThrow();
  });

  it("отклоняет assigns на несуществующий CalculationLineId", async () => {
    await expect(
      createDraft({ assigns: "line:wardrobe.unknown" }),
    ).rejects.toThrow(/CalculationLineId/);
  });
});

describe("ManagedRule: редактирование и неизменяемость", () => {
  it("инкрементирует version draft-правила и соблюдает expectedVersion", async () => {
    const created = await createDraft();

    await expect(
      updateManagedRule(created.id, { expectedVersion: "0", name: "x" }, ACTOR),
    ).rejects.toThrow(/Конфликт версий/);

    const updated = await updateManagedRule(
      created.id,
      { expectedVersion: "1", value: 3 },
      ACTOR,
    );
    expect(updated.version).toBe("2");
    expect(updated.value).toBe(3);
    expect(updated.status).toBe("draft");

    const events = await listAuditEvents({ action: "rule.update" });
    expect(events).toHaveLength(1);
    expect(events[0].oldValue).toMatchObject({ version: "1" });
    expect(events[0].newValue).toMatchObject({ version: "2" });
  });

  it("опубликованная редакция неизменяема: update запрещён", async () => {
    const rule = await createDraft();
    await publishRulesSnapshot(publishingRuleVersion(rule), ACTOR);

    await expect(
      updateManagedRule(rule.id, { expectedVersion: rule.version, name: "x" }, ACTOR),
    ).rejects.toThrow(/неизменяемо/);
  });

  it("новая draft-редакция создаётся отдельной записью, оригинал не меняется", async () => {
    const rule = await createDraft();
    await publishRulesSnapshot(publishingRuleVersion(rule), ACTOR);

    const revision = await createManagedRuleRevision(
      rule.id,
      { expectedVersion: rule.version, value: 5 },
      ACTOR,
    );
    expect(revision.id).not.toBe(rule.id);
    expect(revision.version).toBe("2");
    expect(revision.status).toBe("draft");
    expect(revision.value).toBe(5);
    expect(revision.assigns).toBe(rule.assigns);

    const stored = readJson<ManagedRule[]>(rulesPath());
    expect(stored.find((item) => item.id === rule.id)?.value).toBe(2);
    expect(stored.find((item) => item.id === rule.id)?.status).toBe("published");

    const events = await listAuditEvents({ action: "rule.create" });
    expect(events.some((event) => event.newValue && (event.newValue as { revisionOf?: string }).revisionOf === rule.id)).toBe(true);
  });

  it("запрещает редактирование archived", async () => {
    const created = await createDraft();
    const stored = readJson<ManagedRule[]>(rulesPath());
    writeJson(rulesPath(), [{ ...stored[0], status: "archived" }]);

    await expect(
      updateManagedRule(created.id, { expectedVersion: "1", name: "x" }, ACTOR),
    ).rejects.toThrow(/архивировано/);
  });
});

describe("RulesSnapshot: lifecycle публикации", () => {
  it("требует явный непустой выбор; авто-публикация всех draft запрещена", async () => {
    await createDraft();
    await expect(publishRulesSnapshot([], ACTOR)).rejects.toThrow(/явного непустого выбора/);

    const rule = await createDraft();
    await expect(
      publishRulesSnapshot([{ id: rule.id, expectedVersion: rule.version }, { id: rule.id, expectedVersion: rule.version }], ACTOR),
    ).rejects.toThrow(/дубликаты/);
  });

  it("публикует выбранные draft-правила, остальные остаются draft", async () => {
    const selected = await createDraft();
    const untouched = await createDraft({ value: 9 });

    const result = await publishRulesSnapshot(publishingRuleVersion(selected), ACTOR);
    expect(result.rulesCount).toBe(1);
    expect(result.publishedRuleIds).toEqual([selected.id]);
    expect(result.snapshot.contentHash).toBe(
      rulesSnapshotContentHash(result.snapshot.rules),
    );

    const stored = readJson<ManagedRule[]>(rulesPath());
    expect(stored.find((item) => item.id === selected.id)?.status).toBe("published");
    expect(stored.find((item) => item.id === untouched.id)?.status).toBe("draft");
    expect(result.snapshot.rules.map((rule) => rule.id)).toEqual([selected.id]);

    const events = await listAuditEvents({ action: "rule.publish" });
    expect(events).toHaveLength(1);
    expect(events[0].newValue).toMatchObject({ rulesCount: 1 });
  });

  it("отклоняет unknown, preliminary, archived и устаревший expectedVersion", async () => {
    const rule = await createDraft();
    await expect(
      publishRulesSnapshot([{ id: "rule-missing", expectedVersion: "1" }], ACTOR),
    ).rejects.toThrow(/не найдено/);

    const preliminary = await createDraft({ source: "preliminary" });
    await expect(publishRulesSnapshot(publishingRuleVersion(preliminary), ACTOR)).rejects.toThrow(
      /preliminary/,
    );

    const stale = await createDraft();
    await expect(
      publishRulesSnapshot([{ id: stale.id, expectedVersion: "999" }], ACTOR),
    ).rejects.toThrow(/Конфликт версий/);

    const archived = await createDraft();
    const stored = readJson<ManagedRule[]>(rulesPath());
    writeJson(
      rulesPath(),
      stored.map((item) => (item.id === archived.id ? { ...item, status: "archived" } : item)),
    );
    await expect(publishRulesSnapshot(publishingRuleVersion(archived), ACTOR)).rejects.toThrow(
      /архивировано/,
    );
    expect(rule.id).toBeTruthy();
  });

  it("fail-closed: affects.price требует priceItem и существующий тариф", async () => {
    const rule = await createDraft({ affects: ["price"], assigns: "priceItem:missing.rate" });
    await expect(publishRulesSnapshot(publishingRuleVersion(rule), ACTOR)).rejects.toThrow(
      /PriceItem .* не найден/,
    );

    const wrong = await createDraft({ affects: ["price"], assigns: "line:wardrobe.fittings" });
    await expect(publishRulesSnapshot(publishingRuleVersion(wrong), ACTOR)).rejects.toThrow(
      /обязан быть priceItem/,
    );
  });

  it("в снимок входят ранее опубликованные и выбранные правила; publishedSeq растёт", async () => {
    const first = await createDraft({ value: 2 });
    const second = await createDraft({ value: 3, condition: { subject: "kind", operator: "equals", value: "kitchen" } });

    const one = await publishRulesSnapshot(publishingRuleVersion(first), ACTOR);
    expect(one.snapshot.publishedSeq).toBe(1);
    expect(one.snapshot.rules).toHaveLength(1);

    const two = await publishRulesSnapshot(publishingRuleVersion(second), ACTOR);
    expect(two.snapshot.publishedSeq).toBe(2);
    expect(two.snapshot.rules.map((rule) => rule.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );

    const snapshots = readJson<Array<{ publishedSeq: number }>>(snapshotsPath());
    expect(snapshots.map((item) => item.publishedSeq)).toEqual([1, 2]);
  });

  it("повтор публикации того же содержимого не создаёт дубликат и не дублирует аудит", async () => {
    const rule = await createDraft();
    const first = await publishRulesSnapshot(publishingRuleVersion(rule), ACTOR);
    expect(first.replay).toBe(false);

    const replay = await publishRulesSnapshot(publishingRuleVersion(rule), ACTOR);
    expect(replay.replay).toBe(true);
    expect(replay.snapshot.id).toBe(first.snapshot.id);

    expect(readJson(snapshotsPath())).toHaveLength(1);
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(1);
  });

  it("ошибка записи снимка: правила остаются draft, аудит не создаётся", async () => {
    const rule = await createDraft();
    writeFileSync(snapshotsPath(), "{broken", "utf8");
    await expect(publishRulesSnapshot(publishingRuleVersion(rule), ACTOR)).rejects.toThrow();
    expect(readJson<ManagedRule[]>(rulesPath())[0].status).toBe("draft");
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(0);
  });

  it("восстановление после сбоя: снимок создан, правила остались draft", async () => {
    const rule = await createDraft();
    const content = [{ ...rule, status: "published" }];
    writeJson(snapshotsPath(), [
      {
        id: "rules-recovery",
        publishedSeq: 1,
        rules: content,
        contentHash: rulesSnapshotContentHash(content),
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "seed",
        publishedAt: "2026-01-01T00:00:00.000Z",
        publishedBy: "seed",
      },
    ]);

    const result = await publishRulesSnapshot(publishingRuleVersion(rule), ACTOR);
    expect(result.replay).toBe(true);
    expect(result.snapshot.id).toBe("rules-recovery");
    expect(result.publishedRuleIds).toEqual([rule.id]);
    expect(readJson<ManagedRule[]>(rulesPath())[0].status).toBe("published");
    // D-10: successful publication must have a completed audit even when the
    // snapshot already existed without journal (repair path).
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(1);
  });

  it("снимок неизменяем; новая редакция публикуется новым снимком, старая archived", async () => {
    const rule = await createDraft();
    const first = await publishRulesSnapshot(publishingRuleVersion(rule), ACTOR);
    const revision = await createManagedRuleRevision(
      rule.id,
      { expectedVersion: rule.version, value: 5 },
      ACTOR,
    );
    const second = await publishRulesSnapshot(publishingRuleVersion(revision), ACTOR);

    expect(second.snapshot.id).not.toBe(first.snapshot.id);
    expect(second.snapshot.rules).toHaveLength(1);
    expect(second.snapshot.rules[0].id).toBe(revision.id);
    expect(second.snapshot.rules[0].value).toBe(5);

    const stored = readJson<ManagedRule[]>(rulesPath());
    expect(stored.find((item) => item.id === rule.id)?.value).toBe(2);
    expect(stored.find((item) => item.id === rule.id)?.status).toBe("archived");

    const persistedFirst = readJson<Array<{ id: string; rules: ManagedRule[] }>>(snapshotsPath()).find(
      (snapshot) => snapshot.id === first.snapshot.id,
    );
    expect(persistedFirst?.rules.find((item) => item.id === rule.id)?.value).toBe(2);
  });
});

describe("RulesSnapshot: разрешение (fail-closed)", () => {
  it("none до первой публикации", async () => {
    const resolved = await resolveActiveRulesSnapshot();
    expect(resolved.status).toBe("none");
  });

  it("возвращает активный снимок (максимальный publishedSeq)", async () => {
    const first = await createDraft({ value: 2 });
    const second = await createDraft({ value: 3, condition: { subject: "kind", operator: "equals", value: "kitchen" } });
    await publishRulesSnapshot(publishingRuleVersion(first), ACTOR);
    const secondPublish = await publishRulesSnapshot(publishingRuleVersion(second), ACTOR);

    const resolved = await resolveActiveRulesSnapshot();
    expect(resolved.status).toBe("ok");
    if (resolved.status === "ok") {
      expect(resolved.snapshot.id).toBe(secondPublish.snapshot.id);
      expect(resolved.snapshot.publishedSeq).toBe(2);
      expect(resolved.snapshot.rules).toHaveLength(2);
    }
  });

  it("error при повреждённом файле снимков", async () => {
    writeFileSync(snapshotsPath(), "{not json", "utf8");
    const resolved = await resolveActiveRulesSnapshot();
    expect(resolved.status).toBe("error");
  });

  it("error при подмене contentHash (целостность нарушена)", async () => {
    const rule = await createDraft();
    const { snapshot } = await publishRulesSnapshot(publishingRuleVersion(rule), ACTOR);
    const stored = readJson<Array<Record<string, unknown>>>(snapshotsPath());
    writeJson(
      snapshotsPath(),
      stored.map((item) =>
        item.id === snapshot.id ? { ...item, contentHash: "tampered" } : item,
      ),
    );
    const resolved = await resolveActiveRulesSnapshot();
    expect(resolved.status).toBe("error");
    if (resolved.status === "error") {
      expect(resolved.issues.join(" ")).toMatch(/contentHash/);
    }
  });

  it("error при снимке с draft/preliminary внутри", async () => {
    const rule = await createDraft();
    const snapshotRules = [{ ...readJson<ManagedRule[]>(rulesPath())[0], status: "draft" }];
    writeJson(snapshotsPath(), [
      {
        id: "rules-broken",
        publishedSeq: 1,
        rules: snapshotRules,
        contentHash: rulesSnapshotContentHash(snapshotRules),
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "seed",
        publishedAt: "2026-01-01T00:00:00.000Z",
        publishedBy: "seed",
      },
    ]);
    const resolved = await resolveActiveRulesSnapshot();
    expect(resolved.status).toBe("error");
    expect(rule.id).toBeTruthy();
  });

  it("resolveRulesSnapshotById: найден / не найден", async () => {
    const rule = await createDraft();
    const { snapshot } = await publishRulesSnapshot(publishingRuleVersion(rule), ACTOR);

    const found = await resolveRulesSnapshotById(snapshot.id);
    expect(found.status).toBe("ok");

    const missing = await resolveRulesSnapshotById("rules-missing");
    expect(missing.status).toBe("error");
  });

  it("снимок проходит схему managedRuleSchema (контракт Q7-13)", async () => {
    await createDraft();
    const stored = readJson<ManagedRule[]>(rulesPath());
    const parsed = managedRuleSchema.parse(stored[0]);
    expect(parsed.assigns).toBe("line:wardrobe.fittings");
    expect(parsed.affects).toEqual(["quantity"]);
  });
});
