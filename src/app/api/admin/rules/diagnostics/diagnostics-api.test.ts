import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminSession } from "@/lib/auth/session-store";

const { getCurrentSession } = vi.hoisted(() => ({ getCurrentSession: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  getCurrentSession,
  actorFromSession: (session: AdminSession) => ({
    actorId: session.actorId,
    actorRole: session.role,
  }),
}));

import { GET as listDiagnostics } from "./projects/route";
import { GET as projectDiagnostics } from "./projects/[id]/route";
import { GET as snapshotDiagnostics } from "./snapshots/[id]/route";
import { rulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

const VIEWER: AdminSession = {
  id: "s-viewer",
  actorId: "viewer-1",
  actorName: "Viewer",
  role: "calc-viewer",
  permissions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  absoluteExpiresAt: "2026-01-01T08:00:00.000Z",
};

let dir = "";

const projectsPath = (): string => path.join(dir, "projects.json");
const snapshotsPath = (): string => path.join(dir, "rules-snapshots.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-diag-api-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  delete process.env.FORMAKUB_STORAGE;
  getCurrentSession.mockReset();
  writeFileSync(snapshotsPath(), JSON.stringify([rulesSnapshotFixture()]), "utf8");
  writeFileSync(
    projectsPath(),
    JSON.stringify([
      {
        id: "p-ok",
        config: { kind: "wardrobe" },
        price: {},
        rulesSnapshotId: "rules-test-fixture",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "p-legacy",
        config: { kind: "wardrobe" },
        price: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]),
    "utf8",
  );
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function request(url: string) {
  return new NextRequest(url);
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

describe("NEW-N2: diagnostics API", () => {
  it("без сессии → 401", async () => {
    getCurrentSession.mockResolvedValue(null);
    const response = await listDiagnostics();
    expect(response.status).toBe(401);
  });

  it("viewer читает список проектов с причинами", async () => {
    getCurrentSession.mockResolvedValue(VIEWER);
    const response = await listDiagnostics();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.projects).toHaveLength(2);
    const statuses = body.data.projects.map(
      (item: { status: string }) => item.status,
    );
    expect(statuses).toContain("ok");
    expect(statuses).toContain("legacy_no_snapshot");
  });

  it("детали проекта: 200 и 404", async () => {
    getCurrentSession.mockResolvedValue(VIEWER);
    const ok = await projectDiagnostics(
      request("http://localhost/api/admin/rules/diagnostics/projects/p-ok"),
      params({ id: "p-ok" }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.pinnedSnapshotId).toBe("rules-test-fixture");

    const missing = await projectDiagnostics(
      request("http://localhost/api/admin/rules/diagnostics/projects/missing"),
      params({ id: "missing" }),
    );
    expect(missing.status).toBe(404);
  });

  it("детали снимка: 200 и 404", async () => {
    getCurrentSession.mockResolvedValue(VIEWER);
    const ok = await snapshotDiagnostics(
      request("http://localhost/api/admin/rules/diagnostics/snapshots/rules-test-fixture"),
      params({ id: "rules-test-fixture" }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.usedByProjectIds).toEqual(["p-ok"]);

    const missing = await snapshotDiagnostics(
      request("http://localhost/api/admin/rules/diagnostics/snapshots/missing"),
      params({ id: "missing" }),
    );
    expect(missing.status).toBe(404);
  });

  it("диагностика не мутирует проекты и снимки", async () => {
    getCurrentSession.mockResolvedValue(VIEWER);
    const beforeProjects = readFileSync(projectsPath(), "utf8");
    const beforeSnapshots = readFileSync(snapshotsPath(), "utf8");

    await listDiagnostics();
    await projectDiagnostics(
      request("http://localhost/api/admin/rules/diagnostics/projects/p-ok"),
      params({ id: "p-ok" }),
    );
    await snapshotDiagnostics(
      request("http://localhost/api/admin/rules/diagnostics/snapshots/rules-test-fixture"),
      params({ id: "rules-test-fixture" }),
    );

    expect(readFileSync(projectsPath(), "utf8")).toBe(beforeProjects);
    expect(readFileSync(snapshotsPath(), "utf8")).toBe(beforeSnapshots);
  });
});
