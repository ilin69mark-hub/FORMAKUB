import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { listAuditEvents } from "@/lib/server/audit";

import { auditDenied } from "./audit-denied";

let dir = "";
const T = "2026-11-10T00:00:00.000Z";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-denied-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(path.join(dir, "admin-audit-log.json"), { force: true });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("CA-T-605: audit denied", () => {
  it("пишет result=denied с actor или anonymous", async () => {
    await auditDenied({
      action: "param.update",
      entityType: "parameter",
      entityId: "p1",
      actor: { actorId: "admin:test", actorRole: "calc-viewer" },
      reason: "calc-admin required",
      now: T,
    });
    await auditDenied({
      action: "catalog.archive",
      entityType: "catalogItem",
      entityId: "c1",
      actor: null,
      reason: "unauthenticated",
      now: T,
    });

    const events = await listAuditEvents({ action: "param.update" });
    expect(events).toHaveLength(1);
    expect(events[0]?.result).toBe("denied");
    expect(events[0]?.actorId).toBe("admin:test");

    const anonymous = await listAuditEvents({ action: "catalog.archive" });
    expect(anonymous[0]?.actorId).toBe("anonymous");
  });
});
