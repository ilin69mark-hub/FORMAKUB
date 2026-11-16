import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatAuditValue,
  paginateAuditEvents,
  parseAuditQuery,
  searchAuditEvents,
  sortAuditEvents,
  AUDIT_PAGE_SIZE,
} from "./audit-ui";
import {
  appendAuditEvent,
  listAuditEvents,
  type AdminAuditEvent,
} from "@/lib/server/audit";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-audit-ui-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function event(
  id: string,
  createdAt: string,
  overrides: Partial<AdminAuditEvent> = {},
): AdminAuditEvent {
  return {
    id,
    action: "param.update",
    entityType: "parameter",
    entityId: "kitchen.led.endMargin",
    actorId: "admin-1",
    actorRole: "calc-admin",
    result: "ok",
    paramVersion: "2",
    oldValue: 2,
    newValue: 5,
    createdAt,
    ...overrides,
  };
}

describe("разбор фильтров журнала (CA-T-508)", () => {
  it("валидные action/даты/поиск; неизвестные значения игнорируются", () => {
    const query = parseAuditQuery({
      action: "pricing.publish",
      actorId: " local-ui ",
      entityType: "parameter",
      entityId: "",
      from: "2026-11-01",
      to: "2026-11-09",
      q: "  endMargin ",
      sort: "asc",
      page: "3",
    });

    expect(query).toMatchObject({
      action: "pricing.publish",
      actorId: "local-ui",
      entityType: "parameter",
      q: "endMargin",
      sort: "asc",
      page: 3,
    });
    expect(query.entityId).toBeUndefined();
    expect(query.from).toBe("2026-11-01T00:00:00.000Z");
    expect(query.to).toBe("2026-11-09T23:59:59.999Z");
  });

  it("неизвестное действие, невалидная дата и страница → безопасные значения по умолчанию", () => {
    const query = parseAuditQuery({
      action: "unknown.action",
      from: "вчера",
      page: "-4",
      sort: "random",
    });
    expect(query.action).toBeUndefined();
    expect(query.from).toBeUndefined();
    expect(query.page).toBe(1);
    expect(query.sort).toBe("desc");
  });
});

describe("поиск, сортировка и пагинация (CA-T-508)", () => {
  const events = [
    event("a", "2026-11-08T10:00:00.000Z", { action: "param.create", paramVersion: undefined, oldValue: undefined, newValue: undefined }),
    event("b", "2026-11-09T10:00:00.000Z", { actorId: "local-ui", entityId: "kitchen.supports.psMargin" }),
    event("c", "2026-11-09T10:00:00.000Z", { action: "pricing.publish", entityType: "pricingVersion", entityId: "price-1", paramVersion: undefined, oldValue: undefined, newValue: undefined }),
  ];

  it("поиск по id/action/entity/actor без учёта регистра", () => {
    expect(searchAuditEvents(events, "PSMARGIN").map((item) => item.id)).toEqual(["b"]);
    expect(searchAuditEvents(events, "pricing").map((item) => item.id)).toEqual(["c"]);
    expect(searchAuditEvents(events, "local").map((item) => item.id)).toEqual(["b"]);
    expect(searchAuditEvents(events, "")).toEqual(events);
  });

  it("сортировка по createdAt и стабильный порядок при равенстве", () => {
    expect(sortAuditEvents(events, "asc").map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(sortAuditEvents(events, "desc").map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(events.map((item) => item.id)).toEqual(["a", "b", "c"]); // вход не мутируется
  });

  it("пагинация: границы, суммарные счётчики, пустой журнал", () => {
    const many = Array.from({ length: AUDIT_PAGE_SIZE + 5 }, (_, index) =>
      event(`e-${index}`, `2026-11-09T10:${String(index).padStart(2, "0")}:00.000Z`),
    );

    const first = paginateAuditEvents(many, 1);
    expect(first.items).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.pageCount).toBe(2);
    expect(first.rangeStart).toBe(1);
    expect(first.rangeEnd).toBe(AUDIT_PAGE_SIZE);

    const second = paginateAuditEvents(many, 2);
    expect(second.items).toHaveLength(5);
    expect(second.rangeStart).toBe(AUDIT_PAGE_SIZE + 1);
    expect(second.rangeEnd).toBe(many.length);

    expect(paginateAuditEvents(many, 99).page).toBe(2);
    const empty = paginateAuditEvents([], 5);
    expect(empty).toMatchObject({ total: 0, page: 1, pageCount: 0, rangeStart: 0, rangeEnd: 0 });
  });

  it("formatAuditValue не выдумывает данные", () => {
    expect(formatAuditValue(undefined)).toBe("—");
    expect(formatAuditValue(null)).toBe("null");
    expect(formatAuditValue("text")).toBe("text");
    expect(formatAuditValue({ a: 1 })).toContain('"a": 1');
  });
});

describe("журнал из фактического append-only источника (CA-T-508)", () => {
  it("фильтры сервиса + поиск/сортировка/пагинация; чтение не изменяет файл", async () => {
    await appendAuditEvent({
      action: "param.update",
      entityType: "parameter",
      entityId: "kitchen.led.endMargin",
      actorId: "local-ui",
      actorRole: "local-prototype",
      result: "ok",
      oldValue: 2,
      newValue: 5,
      paramVersion: "2",
      createdAt: "2026-11-08T10:00:00.000Z",
    });
    await appendAuditEvent({
      action: "catalog.archive",
      entityType: "catalog",
      entityId: "countertop:marble",
      actorId: "admin-2",
      actorRole: "calc-admin",
      result: "ok",
      oldValue: { status: "active" },
      newValue: { status: "archived" },
      createdAt: "2026-11-09T10:00:00.000Z",
    });

    const file = path.join(dir, "admin-audit-log.json");
    const before = readFileSync(file);

    const query = parseAuditQuery({ from: "2026-11-09", q: "marble", sort: "desc" });
    const events = await listAuditEvents({
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
    });
    const view = paginateAuditEvents(
      sortAuditEvents(searchAuditEvents(events, query.q), query.sort),
      query.page,
    );

    expect(view.total).toBe(1);
    expect(view.items[0]).toMatchObject({
      action: "catalog.archive",
      entityId: "countertop:marble",
      actorId: "admin-2",
    });
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("UI-модуль не содержит операций изменения журнала", async () => {
    const loaded = await import("./audit-ui");
    const mutating = Object.keys(loaded).filter((name) =>
      /^(append|create|update|delete|write|remove)/i.test(name),
    );
    expect(mutating).toEqual([]);
  });
});
