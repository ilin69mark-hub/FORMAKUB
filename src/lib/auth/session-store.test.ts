import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  SESSIONS_COLLECTION,
  createAdminSession,
  deleteAdminSession,
  getAdminSession,
} from "./session-store";

let dir = "";
const T = "2026-11-10T00:00:00.000Z";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-sessions-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(path.join(dir, SESSIONS_COLLECTION), { force: true });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

async function session(now = T) {
  return createAdminSession({
    actorId: "admin:test",
    role: "calc-admin",
    permissions: ["catalog.write", "price.write", "recalc.run"],
    now,
  });
}

describe("CA-T-602: server-side sessions", () => {
  it("создаёт/читает/удаляет сессию", async () => {
    const created = await session();
    const read = await getAdminSession(created.id, "2026-11-10T00:10:00.000Z");
    expect(read?.actorId).toBe("admin:test");
    await deleteAdminSession(created.id);
    expect(await getAdminSession(created.id, "2026-11-10T00:11:00.000Z")).toBeNull();
  });

  it("idle timeout 30 минут", async () => {
    const created = await session();
    expect(await getAdminSession(created.id, "2026-11-10T00:29:00.000Z")).not.toBeNull();
    expect(await getAdminSession(created.id, "2026-11-10T01:00:00.000Z")).toBeNull();
  });

  it("absolute timeout 8 часов", async () => {
    const created = await session();
    // Touch every 29 minutes: idle timeout не срабатывает, absolute — да.
    for (let minutes = 29; minutes <= 7 * 60 + 44; minutes += 29) {
      const at = new Date(Date.parse(T) + minutes * 60_000).toISOString();
      expect(await getAdminSession(created.id, at)).not.toBeNull();
    }
    expect(await getAdminSession(created.id, "2026-11-10T07:49:00.000Z")).not.toBeNull();
    expect(await getAdminSession(created.id, "2026-11-10T08:01:00.000Z")).toBeNull();
  });
});
