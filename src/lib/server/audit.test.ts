import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as audit from "./audit";
import {
  adminAuditLogSchema,
  appendAuditEvent,
  listAuditEvents,
  type AppendAuditInput,
} from "./audit";

let dir = "";

const journalPath = (): string => path.join(dir, "admin-audit-log.json");
const rawJournal = (): string => readFileSync(journalPath(), "utf8");
const journal = (): unknown[] => JSON.parse(rawJournal()) as unknown[];

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-audit-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function input(overrides: Partial<AppendAuditInput> = {}): AppendAuditInput {
  return {
    action: "param.update",
    entityType: "parameter",
    entityId: "kitchen.limit.maxModules",
    actorId: "admin-1",
    actorRole: "calc-admin",
    result: "ok",
    oldValue: { value: 24 },
    newValue: { value: 25 },
    paramVersion: "v2",
    ...overrides,
  };
}

describe("создание и чтение события (CA-T-202)", () => {
  it("создание: событие валидно, присутствуют id и createdAt; чтение возвращает его", async () => {
    const event = await appendAuditEvent(input());

    expect(event.id).toMatch(/^[0-9a-f]{16}$/);
    expect(event.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(adminAuditLogSchema.safeParse(event).success).toBe(true);

    const events = await listAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });

  it("result=denied фиксируется (отказы прав — X-7)", async () => {
    const event = await appendAuditEvent(
      input({
        action: "catalog.update",
        entityType: "catalog",
        entityId: "compact_hpl",
        oldValue: undefined,
        newValue: undefined,
        paramVersion: undefined,
        result: "denied",
      }),
    );
    expect(event.result).toBe("denied");
    expect((await listAuditEvents())[0]?.result).toBe("denied");
  });

  it("фильтры ТЗ §8: action, actor, date range, объект", async () => {
    await appendAuditEvent(
      input({ id: "e1", actorId: "admin-1", createdAt: "2026-11-07T10:00:00.000Z" }),
    );
    await appendAuditEvent(
      input({
        id: "e2",
        action: "project.view",
        entityType: "project",
        entityId: "abcdefgh",
        actorId: "viewer-1",
        actorRole: "calc-viewer",
        oldValue: undefined,
        newValue: undefined,
        paramVersion: undefined,
        createdAt: "2026-11-07T12:00:00.000Z",
      }),
    );
    await appendAuditEvent(
      input({
        id: "e3",
        entityId: "wardrobe.limit.maxSections",
        createdAt: "2026-11-07T13:00:00.000Z",
      }),
    );

    expect((await listAuditEvents({ action: "project.view" })).map((e) => e.id)).toEqual(["e2"]);
    expect((await listAuditEvents({ actorId: "admin-1" })).map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(
      (await listAuditEvents({ from: "2026-11-07T11:00:00.000Z" })).map((e) => e.id),
    ).toEqual(["e2", "e3"]);
    expect(
      (await listAuditEvents({ to: "2026-11-07T10:00:00.000Z" })).map((e) => e.id),
    ).toEqual(["e1"]);
    expect(
      (await listAuditEvents({ entityType: "parameter", entityId: "kitchen.limit.maxModules" })).map(
        (e) => e.id,
      ),
    ).toEqual(["e1"]);
    expect(await listAuditEvents({ action: "catalog.update" })).toEqual([]);
  });
});

describe("append-only: без изменения и удаления (CA-T-202)", () => {
  it("модуль не экспортирует методов изменения/удаления", async () => {
    const keys = Object.keys(audit);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toMatch(/update|delete|remove|modify|overwrite|patch/i);
    }
  });

  it("несколько записей: предыдущие события не изменяются", async () => {
    const first = await appendAuditEvent(
      input({ id: "a1", createdAt: "2026-11-07T09:00:00.000Z" }),
    );

    const second = await appendAuditEvent(
      input({ id: "a2", entityId: "other.entity", createdAt: "2026-11-07T09:01:00.000Z" }),
    );
    await appendAuditEvent(
      input({ id: "a3", entityId: "third.entity", createdAt: "2026-11-07T09:02:00.000Z" }),
    );

    const all = journal();
    expect(all).toHaveLength(3);
    // первое событие сохранено без изменений (добавление только в конец)
    expect(all[0]).toEqual(first);
    expect(all[1]).toEqual(second);
    expect(all[2]).toMatchObject({ id: "a3" });
  });

  it("удаление невозможно: после удаления «через интерфейс» журнал только растёт", async () => {
    await appendAuditEvent(input({ id: "r1" }));
    await appendAuditEvent(input({ id: "r2", entityId: "e2" }));
    await appendAuditEvent(input({ id: "r3", entityId: "e3" }));

    expect(journal()).toHaveLength(3);
    expect((await listAuditEvents()).map((e) => e.id)).toEqual(["r1", "r2", "r3"]);
  });
});

describe("уникальность и конфликты (CA-T-202)", () => {
  it("дубликат id → исключение, журнал не изменяется", async () => {
    await appendAuditEvent(input({ id: "dup-1" }));
    const before = rawJournal();

    await expect(appendAuditEvent(input({ id: "dup-1" }))).rejects.toThrow(
      /дубликат id/,
    );
    expect(rawJournal()).toBe(before);
    expect(journal()).toHaveLength(1);
  });

  it("U(entityType,entityId,paramVersion) для param.update → исключение (§6.1)", async () => {
    await appendAuditEvent(input({ id: "u1", paramVersion: "v2" }));
    const before = rawJournal();

    await expect(
      appendAuditEvent(input({ id: "u2", paramVersion: "v2" })),
    ).rejects.toThrow(/уже существует/);
    expect(rawJournal()).toBe(before);

    // другая версия — допустимо
    await expect(
      appendAuditEvent(input({ id: "u3", paramVersion: "v3" })),
    ).resolves.toMatchObject({ id: "u3" });
  });

  it("невалидный вход → исключение до обращения к storage, файл не создаётся", async () => {
    await expect(
      appendAuditEvent({
        ...input(),
        action: "hack.perform",
      } as unknown as AppendAuditInput),
    ).rejects.toThrow();
    expect(existsSync(journalPath())).toBe(false);
  });

  it("порченная существующая запись → отказ без изменения журнала", async () => {
    await appendAuditEvent(input({ id: "ok-1" }));
    writeFileSync(journalPath(), JSON.stringify([{ id: "tampered" }]), "utf8");
    const tampered = rawJournal();

    await expect(appendAuditEvent(input({ id: "ok-2" }))).rejects.toThrow(
      /невалидна/,
    );
    expect(rawJournal()).toBe(tampered);
  });
});

describe("модель: обязательные поля и param.update (CA-T-202)", () => {
  it("отклоняются: отсутствующие обязательные поля, неизвестный result, лишнее поле", () => {
    const base = input();
    const valid = {
      id: "x1",
      action: base.action,
      entityType: base.entityType,
      entityId: base.entityId,
      actorId: base.actorId,
      actorRole: base.actorRole,
      result: "ok",
      createdAt: "2026-11-07T12:00:00.000Z",
      oldValue: { value: 1 },
      newValue: { value: 2 },
      paramVersion: "v1",
    };
    expect(adminAuditLogSchema.safeParse(valid).success).toBe(true);

    const withoutActorRole = { ...valid };
    delete (withoutActorRole as Record<string, unknown>).actorRole;
    expect(adminAuditLogSchema.safeParse(withoutActorRole).success).toBe(false);
    expect(
      adminAuditLogSchema.safeParse({ ...valid, result: "failed" }).success,
    ).toBe(false);
    expect(
      adminAuditLogSchema.safeParse({ ...valid, extra: 1 }).success,
    ).toBe(false);
    expect(
      adminAuditLogSchema.safeParse({ ...valid, createdAt: "07.11.2026" })
        .success,
    ).toBe(false);
  });

  it("param.update: обязательны paramVersion, oldValue/newValue, entityType=parameter", async () => {
    await expect(
      appendAuditEvent(
        input({ paramVersion: undefined, oldValue: 1, newValue: 2 }),
      ),
    ).rejects.toThrow(/paramVersion/);

    await expect(
      appendAuditEvent(
        input({ entityType: "project", oldValue: 1, newValue: 2 }),
      ),
    ).rejects.toThrow(/entityType/);

    await expect(
      appendAuditEvent(
        input({ oldValue: undefined, newValue: undefined }),
      ),
    ).rejects.toThrow(/oldValue/);

    const saved = await appendAuditEvent(input({ id: "p1" }));
    expect(saved).toMatchObject({
      action: "param.update",
      entityType: "parameter",
      entityId: "kitchen.limit.maxModules",
      paramVersion: "v2",
      oldValue: { value: 24 },
      newValue: { value: 25 },
      result: "ok",
    });
    // событие сохранено и не перезаписано
    expect(journal()[0]).toEqual(saved);
  });
});
