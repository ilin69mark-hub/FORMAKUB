import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendAuditEvent, listAuditEvents } from "@/lib/server/audit";
import type { ActorContext } from "./parameters";
import {
  createManagedRule,
  publishRulesSnapshot,
  type ManagedRule,
  type ManagedRuleDraftInput,
} from "./managed-rules";
import {
  listRulesPublicationJournal,
  recoverRulesPublications,
} from "./rules-publication-journal";

vi.mock("@/lib/server/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/audit")>();
  return { ...actual, appendAuditEvent: vi.fn(actual.appendAuditEvent) };
});

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };
let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-pub-journal-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  delete process.env.FORMAKUB_STORAGE;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  vi.mocked(appendAuditEvent).mockClear();
  rmSync(dir, { recursive: true, force: true });
});

function draft(overrides: Partial<ManagedRuleDraftInput> = {}): ManagedRuleDraftInput {
  return {
    name: "Правило",
    description: "Описание",
    category: "quantity",
    scope: "wardrobe",
    condition: { subject: "kind", operator: "equals", value: "wardrobe" },
    assigns: "line:wardrobe.fittings",
    value: 2,
    valueType: "int",
    sourceRef: "src/x.ts",
    source: "owner_confirmed",
    affects: ["quantity"],
    ...overrides,
  };
}

async function createRule(): Promise<ManagedRule> {
  return createManagedRule(draft(), ACTOR);
}

function selection(rule: ManagedRule) {
  return [{ id: rule.id, expectedVersion: rule.version }];
}

describe("NEW-N4 / D-10: publication journal + audit recovery", () => {
  it("успешная публикация: snapshot + завершённый audit + completed journal", async () => {
    const rule = await createRule();
    const result = await publishRulesSnapshot(selection(rule), ACTOR, {
      operationId: "pub-1",
    });
    expect(result.replay).toBe(false);

    const [entry] = await listRulesPublicationJournal();
    expect(entry).toMatchObject({
      operationId: "pub-1",
      phase: "completed",
      snapshotId: result.snapshot.id,
    });
    expect(entry.auditEventId).toBeTruthy();

    const events = await listAuditEvents({ action: "rule.publish" });
    expect(events).toHaveLength(1);
    expect(events[0].requestId).toBe("pub-1");
    expect(events[0].entityId).toBe(result.snapshot.id);
  });

  it("повтор с тем же operationId не создаёт повторный snapshot/audit", async () => {
    const rule = await createRule();
    const first = await publishRulesSnapshot(selection(rule), ACTOR, {
      operationId: "pub-1",
    });
    const replay = await publishRulesSnapshot(selection(rule), ACTOR, {
      operationId: "pub-1",
    });
    expect(replay.replay).toBe(true);
    expect(replay.snapshot.id).toBe(first.snapshot.id);
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(1);
    expect(await listRulesPublicationJournal()).toHaveLength(1);
  });

  it("без operationId: journal и audit создаются; повтор без operationId — replay без дублей", async () => {
    const rule = await createRule();
    const first = await publishRulesSnapshot(selection(rule), ACTOR);
    expect(first.replay).toBe(false);

    const journal = await listRulesPublicationJournal();
    expect(journal).toHaveLength(1);
    expect(journal[0].phase).toBe("completed");
    expect(journal[0].auditEventId).toBeTruthy();
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(1);

    const replay = await publishRulesSnapshot(selection(rule), ACTOR);
    expect(replay.replay).toBe(true);
    expect(replay.snapshot.id).toBe(first.snapshot.id);
    expect(await listRulesPublicationJournal()).toHaveLength(1);
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(1);
  });

  it("сбой audit: snapshot остаётся, journal audit_pending; recovery дописывает audit", async () => {
    const rule = await createRule();
    vi.mocked(appendAuditEvent).mockRejectedValueOnce(new Error("audit down"));

    await expect(
      publishRulesSnapshot(selection(rule), ACTOR, { operationId: "pub-2" }),
    ).rejects.toThrow(/audit down/);

    const pending = await listRulesPublicationJournal();
    expect(pending[0]).toMatchObject({ phase: "audit_pending" });
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(0);

    const recovery = await recoverRulesPublications();
    expect(recovery.finalized).toBe(1);
    expect(recovery.failed).toBe(0);
    const events = await listAuditEvents({ action: "rule.publish" });
    expect(events).toHaveLength(1);
    expect(events[0].requestId).toBe("pub-2");

    const again = await recoverRulesPublications();
    expect(again.finalized).toBe(0);
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(1);
    expect((await listRulesPublicationJournal())[0].phase).toBe("completed");
  });

  it("сбой до создания snapshot: journal закрывается как aborted, audit не создаётся", async () => {
    const rule = await createRule();
    writeFileSync(path.join(dir, "rules-snapshots.json"), "{broken", "utf8");

    await expect(
      publishRulesSnapshot(selection(rule), ACTOR, { operationId: "pub-3" }),
    ).rejects.toThrow();

    const recovery = await recoverRulesPublications();
    expect(recovery.aborted).toBe(1);
    const [entry] = await listRulesPublicationJournal();
    expect(entry.phase).toBe("aborted");
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(0);
  });

  it("повторный replay после восстановления возвращает результат и не пишет audit", async () => {
    const rule = await createRule();
    vi.mocked(appendAuditEvent).mockRejectedValueOnce(new Error("audit down"));
    await expect(
      publishRulesSnapshot(selection(rule), ACTOR, { operationId: "pub-4" }),
    ).rejects.toThrow();

    await recoverRulesPublications();
    const replay = await publishRulesSnapshot(selection(rule), ACTOR, {
      operationId: "pub-4",
    });
    expect(replay.replay).toBe(true);
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(1);
  });

  it("конкурентные публикации: один snapshot, audit не дублируется", async () => {
    const rule = await createRule();
    const results = await Promise.allSettled([
      publishRulesSnapshot(selection(rule), ACTOR, { operationId: "pub-c1" }),
      publishRulesSnapshot(selection(rule), ACTOR, { operationId: "pub-c1" }),
    ]);
    const ok = results.filter((item) => item.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(1);
    expect(
      (await listRulesPublicationJournal()).filter((entry) => entry.phase === "completed"),
    ).toHaveLength(1);
  });

  it("параллельный recovery не дублирует audit", async () => {
    const rule = await createRule();
    vi.mocked(appendAuditEvent).mockRejectedValueOnce(new Error("audit down"));
    await expect(
      publishRulesSnapshot(selection(rule), ACTOR, { operationId: "pub-r" }),
    ).rejects.toThrow();

    await Promise.all([recoverRulesPublications(), recoverRulesPublications()]);
    expect(await listAuditEvents({ action: "rule.publish" })).toHaveLength(1);
  });
});
