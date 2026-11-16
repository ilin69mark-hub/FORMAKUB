import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendAuditEvent, listAuditEvents } from "@/lib/server/audit";
import { defaultKitchen } from "@/lib/configurator/defaults";
import type { StoredProject } from "@/lib/configurator/types";
import { rulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

import { rulesSnapshotContentHash } from "./managed-rules";

import type { ActorContext } from "./parameters";
import { transitionProjectRulesSnapshot, recoverPendingRulesTransitions } from "./project-rules-transition";
import { requestFingerprint } from "@/lib/server/operation-fingerprint";

vi.mock("@/lib/server/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/audit")>();
  return { ...actual, appendAuditEvent: vi.fn(actual.appendAuditEvent) };
});

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };
const RULES_S1 = "rules-s1";
const RULES_S2 = "rules-s2";
const BASE_TIME = "2026-11-13T10:00:00.000Z";

let dir = "";

const projectsPath = (): string => path.join(dir, "projects.json");
const snapshotsPath = (): string => path.join(dir, "rules-snapshots.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-transition-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  delete process.env.FORMAKUB_STORAGE;
  writeJson(snapshotsPath(), [snapshot(RULES_S1, 1), snapshot(RULES_S2, 2)]);
  writeJson(projectsPath(), [project()]);
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  vi.mocked(appendAuditEvent).mockClear();
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data), "utf8");
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function bytes(file: string): string {
  return readFileSync(file, "utf8");
}

function snapshot(
  id: string,
  publishedSeq: number,
  ruleOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = rulesSnapshotFixture();
  const rule = (base.rules as Array<Record<string, unknown>>)[0];
  const rules = [{ ...rule, id: `rule-${id}`, ...ruleOverrides }];
  return {
    ...base,
    id,
    publishedSeq,
    rules,
    contentHash: rulesSnapshotContentHash(rules),
  };
}

function project(overrides: Partial<StoredProject> = {}): StoredProject {
  return {
    id: "project-1",
    config: defaultKitchen(),
    schemaVersion: 2,
    calcVersion: "calc-2026.11.1",
    priceVersion: "price-1",
    rulesSnapshotId: RULES_S1,
    pins: {},
    price: {
      currency: "RUB",
      baseCost: 0,
      bodyCost: 0,
      frontsCost: 0,
      fittingsCost: 0,
      optionsCost: 0,
      complexityFactor: 1,
      subtotal: 123456,
      discount: 0,
      total: 123456,
      minOrderApplied: false,
      lines: [],
      promo: null,
      disclaimer: "",
    },
    priceHistory: [],
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  };
}

function transition(
  overrides: Partial<Parameters<typeof transitionProjectRulesSnapshot>[0]> = {},
) {
  return transitionProjectRulesSnapshot({
    projectId: "project-1",
    targetRulesSnapshotId: RULES_S2,
    expectedVersion: BASE_TIME,
    operationId: "op-1",
    actor: ACTOR,
    ...overrides,
  });
}

describe("CA-T-612: переход проекта на другой RulesSnapshot", () => {
  it("успешный переход: меняются только закрепление и updatedAt, аудит записан", async () => {
    const result = await transition();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project?.rulesSnapshotId).toBe(RULES_S2);
    expect(result.previousRulesSnapshotId).toBe(RULES_S1);
    expect(result.replay).toBe(false);
    expect(result.project?.updatedAt).not.toBe(BASE_TIME);

    const persisted = readJson<StoredProject[]>(projectsPath())[0];
    expect(persisted.rulesSnapshotId).toBe(RULES_S2);
    expect(persisted.updatedAt).toBe(result.project?.updatedAt);

    const events = await listAuditEvents({ action: "project.rules_transition" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "project",
      entityId: "project-1",
      requestId: "op-1",
      result: "ok",
    });
    expect(events[0].oldValue).toMatchObject({
      rulesSnapshotId: RULES_S1,
      updatedAt: BASE_TIME,
    });
    expect(events[0].newValue).toMatchObject({
      projectId: "project-1",
      rulesSnapshotId: RULES_S2,
      previousRulesSnapshotId: RULES_S1,
    });
  });

  it("legacy-проект без прежнего rulesSnapshotId переводится с null в аудите", async () => {
    writeJson(projectsPath(), [project({ rulesSnapshotId: undefined })]);

    const result = await transition();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previousRulesSnapshotId).toBeNull();
    expect(result.project?.rulesSnapshotId).toBe(RULES_S2);

    const events = await listAuditEvents({ action: "project.rules_transition" });
    expect(events[0].oldValue).toMatchObject({ rulesSnapshotId: null });
  });

  it("несуществующий проект → PROJECT_NOT_FOUND, изменений нет", async () => {
    const before = bytes(projectsPath());
    const result = await transition({ projectId: "missing" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("PROJECT_NOT_FOUND");
    expect(result.status).toBe(404);
    expect(bytes(projectsPath())).toBe(before);
  });

  it("несуществующий snapshot → RULES_SNAPSHOT_UNKNOWN, проект не изменён", async () => {
    const before = bytes(projectsPath());
    const result = await transition({ targetRulesSnapshotId: "rules-missing" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("RULES_SNAPSHOT_UNKNOWN");
    expect(bytes(projectsPath())).toBe(before);
  });

  it("snapshot с draft-правилом → RULES_SNAPSHOT_CORRUPT, проект не изменён", async () => {
    writeJson(snapshotsPath(), [
      snapshot(RULES_S1, 1),
      snapshot(RULES_S2, 2, { status: "draft" }),
    ]);
    const before = bytes(projectsPath());

    const result = await transition();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("RULES_SNAPSHOT_CORRUPT");
    expect(bytes(projectsPath())).toBe(before);
  });

  it("повреждённый файл снимков → RULES_SNAPSHOT_CORRUPT, проект не изменён", async () => {
    writeFileSync(snapshotsPath(), "{broken", "utf8");
    const before = bytes(projectsPath());

    const result = await transition();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("RULES_SNAPSHOT_CORRUPT");
    expect(bytes(projectsPath())).toBe(before);
  });

  it("нерарешаемые ссылки snapshot → RULES_SNAPSHOT_REFERENCES_UNRESOLVED", async () => {
    writeJson(snapshotsPath(), [
      snapshot(RULES_S1, 1),
      snapshot(RULES_S2, 2, { assigns: "priceItem:missing.rate" }),
    ]);
    const before = bytes(projectsPath());

    const result = await transition();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("RULES_SNAPSHOT_REFERENCES_UNRESOLVED");
    expect(bytes(projectsPath())).toBe(before);
  });

  it("устаревший expectedVersion → 409, проект и аудит не изменены", async () => {
    const before = bytes(projectsPath());
    const result = await transition({ expectedVersion: "2026-01-01T00:00:00.000Z" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("PROJECT_VERSION_CONFLICT");
    expect(result.status).toBe(409);
    expect(bytes(projectsPath())).toBe(before);
    expect(await listAuditEvents({ action: "project.rules_transition" })).toHaveLength(0);
  });

  it("повтор с тем же operationId возвращает исходный результат без новой записи", async () => {
    const first = await transition();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const afterFirst = bytes(projectsPath());

    const replay = await transition();
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.replay).toBe(true);
    expect(replay.project).toBeNull();
    expect(replay.previousRulesSnapshotId).toBe(RULES_S1);
    expect(replay.rulesSnapshotId).toBe(RULES_S2);
    expect(replay.updatedAt).toBe(first.updatedAt);
    expect(bytes(projectsPath())).toBe(afterFirst);
    expect(await listAuditEvents({ action: "project.rules_transition" })).toHaveLength(1);
  });

  it("повтор operationId с другими параметрами → IDEMPOTENCY_CONFLICT", async () => {
    await transition();
    const afterFirst = bytes(projectsPath());

    const conflict = await transition({ targetRulesSnapshotId: RULES_S1 });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.issues[0].code).toBe("IDEMPOTENCY_CONFLICT");
    expect(conflict.status).toBe(409);
    expect(bytes(projectsPath())).toBe(afterFirst);
  });

  it("ошибка записи аудита не приводит к частичному изменению проекта", async () => {
    vi.mocked(appendAuditEvent).mockRejectedValueOnce(new Error("audit storage down"));
    const before = readJson<StoredProject[]>(projectsPath())[0];

    await expect(transition()).rejects.toThrow(/audit storage down/);

    const persisted = readJson<StoredProject[]>(projectsPath())[0];
    expect(persisted).toEqual(before);
    expect(persisted.rulesSnapshotId).toBe(RULES_S1);
    expect(persisted.updatedAt).toBe(BASE_TIME);
    expect(await listAuditEvents({ action: "project.rules_transition" })).toHaveLength(0);
  });

  it("коммерческий результат, конфигурация и геометрия не изменяются", async () => {
    const before = readJson<StoredProject[]>(projectsPath())[0];
    const result = await transition();
    expect(result.ok).toBe(true);

    const after = readJson<StoredProject[]>(projectsPath())[0];
    expect(after.config).toEqual(before.config);
    expect(after.price).toEqual(before.price);
    expect(after.priceHistory).toEqual(before.priceHistory);
    expect(after.priceVersion).toBe(before.priceVersion);
    expect(after.calcVersion).toBe(before.calcVersion);
    expect(after.pins).toEqual(before.pins);
    expect(after.schemaVersion).toBe(before.schemaVersion);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.rulesSnapshotId).not.toBe(before.rulesSnapshotId);
    expect(after.updatedAt).not.toBe(before.updatedAt);
  });

  it("переход на уже закреплённый снимок — no-op без записи аудита", async () => {
    const result = await transition({ targetRulesSnapshotId: RULES_S1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replay).toBe(true);
    expect(result.project?.updatedAt).toBe(BASE_TIME);
    expect(await listAuditEvents({ action: "project.rules_transition" })).toHaveLength(0);
  });

  it("replay после последующего перехода возвращает результат исходной операции", async () => {
    const first = await transition({ operationId: "op-a" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await transitionProjectRulesSnapshot({
      projectId: "project-1",
      targetRulesSnapshotId: RULES_S1,
      expectedVersion: first.updatedAt,
      operationId: "op-b",
      actor: ACTOR,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.rulesSnapshotId).toBe(RULES_S1);

    const replay = await transition({ operationId: "op-a" });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.replay).toBe(true);
    expect(replay.project).toBeNull();
    expect(replay.previousRulesSnapshotId).toBe(RULES_S1);
    expect(replay.rulesSnapshotId).toBe(RULES_S2);
    expect(replay.updatedAt).toBe(first.updatedAt);

    expect(await listAuditEvents({ action: "project.rules_transition" })).toHaveLength(2);
  });

  it("конкурентные переходы: ровно один успех, второй — конфликт версий", async () => {
    const [a, b] = await Promise.all([
      transition({ operationId: "op-c1" }),
      transition({ operationId: "op-c2" }),
    ]);
    const results = [a, b];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const failed = results.find((result) => !result.ok);
    expect(failed && !failed.ok && failed.issues[0].code).toBe("PROJECT_VERSION_CONFLICT");
    expect(await listAuditEvents({ action: "project.rules_transition" })).toHaveLength(1);
  });

  it("восстановление незавершённой операции: проект изменён, аудит отсутствует", async () => {
    const updatedAt = "2026-11-13T11:00:00.000Z";
    writeJson(projectsPath(), [
      project({ rulesSnapshotId: RULES_S2, updatedAt }),
    ]);
    writeJson(path.join(dir, "rules-transition-journal.json"), [
      {
        requestId: "op-recover",
        projectId: "project-1",
        expectedVersion: BASE_TIME,
        previousRulesSnapshotId: RULES_S1,
        targetRulesSnapshotId: RULES_S2,
        updatedAt,
        fingerprint: requestFingerprint({ projectId: "project-1", targetRulesSnapshotId: RULES_S2 }),
        fingerprintVersion: "sha256-canonical-json-v1",
        actorId: ACTOR.actorId,
        actorRole: ACTOR.actorRole,
        createdAt: BASE_TIME,
      },
    ]);

    const recovery = await recoverPendingRulesTransitions();
    expect(recovery.recovered).toBe(1);
    expect(recovery.discarded).toBe(0);

    const events = await listAuditEvents({ action: "project.rules_transition" });
    expect(events).toHaveLength(1);
    expect(events[0].requestId).toBe("op-recover");
    expect(readJson(path.join(dir, "rules-transition-journal.json"))).toEqual([]);

    const replay = await transition({ operationId: "op-recover" });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.replay).toBe(true);
    expect(replay.rulesSnapshotId).toBe(RULES_S2);
  });

  it("восстановление незавершённой операции: проект не изменён — запись отбрасывается", async () => {
    writeJson(path.join(dir, "rules-transition-journal.json"), [
      {
        requestId: "op-aborted",
        projectId: "project-1",
        expectedVersion: BASE_TIME,
        previousRulesSnapshotId: RULES_S1,
        targetRulesSnapshotId: RULES_S2,
        updatedAt: "2026-11-13T11:00:00.000Z",
        fingerprint: "f",
        fingerprintVersion: "sha256-canonical-json-v1",
        actorId: ACTOR.actorId,
        actorRole: ACTOR.actorRole,
        createdAt: BASE_TIME,
      },
    ]);

    const recovery = await recoverPendingRulesTransitions();
    expect(recovery.recovered).toBe(0);
    expect(recovery.discarded).toBe(1);
    expect(readJson(path.join(dir, "rules-transition-journal.json"))).toEqual([]);
    expect(await listAuditEvents({ action: "project.rules_transition" })).toHaveLength(0);
  });
});
