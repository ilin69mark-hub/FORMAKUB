import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminSession } from "@/lib/auth/session-store";

const { getCurrentSession } = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentSession,
  actorFromSession: (session: AdminSession) => ({
    actorId: session.actorId,
    actorRole: session.role,
  }),
}));

import { GET as getParameters } from "./parameters/route";
import { PATCH as patchParameter } from "./parameters/[id]/route";
import { POST as publishVersion } from "./pricing-versions/[id]/publish/route";
import { POST as archiveCatalogItem } from "./catalogs/[catalog]/items/[id]/archive/route";
import { POST as recalculateProject } from "./projects/[id]/recalculate/route";

const ADMIN: AdminSession = {
  id: "s-admin",
  actorId: "admin-1",
  actorName: "Admin",
  role: "calc-admin",
  permissions: ["catalog.write", "price.write", "price.publish", "recalc.run"],
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  absoluteExpiresAt: "2026-01-01T08:00:00.000Z",
};

const VIEWER: AdminSession = {
  ...ADMIN,
  id: "s-viewer",
  actorId: "viewer-1",
  role: "calc-viewer",
  permissions: [],
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-admin-api-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  getCurrentSession.mockReset();
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function request(
  url: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
): NextRequest {
  return new NextRequest(url, init);
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

function draftVersion() {
  return {
    id: "price-draft",
    label: "Draft",
    status: "draft",
    snapshot: [],
    rules: {},
    promos: [],
    baseSchema: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "seed",
  };
}

describe("CA-T-609 admin API guard", () => {
  it("без сессии GET /parameters → 401", async () => {
    getCurrentSession.mockResolvedValue(null);
    const response = await getParameters(
      request("http://localhost/api/admin/parameters"),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("viewer GET /parameters → 200 (чтение разрешено)", async () => {
    getCurrentSession.mockResolvedValue(VIEWER);
    const response = await getParameters(
      request("http://localhost/api/admin/parameters"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: [] });
  });

  it("viewer PATCH параметра → 403 без записи", async () => {
    getCurrentSession.mockResolvedValue(VIEWER);
    const response = await patchParameter(
      request("http://localhost/api/admin/parameters/p1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: 1, expectedVersion: "1" }),
      }),
      params({ id: "p1" }),
    );
    expect(response.status).toBe(403);
  });

  it("PATCH с чужим Origin → 403", async () => {
    getCurrentSession.mockResolvedValue(ADMIN);
    const response = await patchParameter(
      request("http://localhost/api/admin/parameters/p1", {
        method: "PATCH",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ value: 1, expectedVersion: "1" }),
      }),
      params({ id: "p1" }),
    );
    expect(response.status).toBe(403);
  });

  it("publish без confirmed → 409 CONFIRMATION_REQUIRED", async () => {
    getCurrentSession.mockResolvedValue(ADMIN);
    writeFileSync(
      path.join(dir, "pricing-versions.json"),
      JSON.stringify([draftVersion()]),
      "utf8",
    );
    const response = await publishVersion(
      request("http://localhost/api/admin/pricing-versions/price-draft/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmed: false,
          expectedVersion: "2026-01-01T00:00:00.000Z",
        }),
      }),
      params({ id: "price-draft" }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("publish с несовпадающей версией → 409", async () => {
    getCurrentSession.mockResolvedValue(ADMIN);
    writeFileSync(
      path.join(dir, "pricing-versions.json"),
      JSON.stringify([draftVersion()]),
      "utf8",
    );
    const response = await publishVersion(
      request("http://localhost/api/admin/pricing-versions/price-draft/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true, expectedVersion: "stale" }),
      }),
      params({ id: "price-draft" }),
    );
    expect(response.status).toBe(409);
  });

  it("viewer archive элемента справочника → 403", async () => {
    getCurrentSession.mockResolvedValue(VIEWER);
    const response = await archiveCatalogItem(
      request("http://localhost/api/admin/catalogs/hardware/items/h1/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true, expectedVersion: "1" }),
      }),
      params({ catalog: "hardware", id: "h1" }),
    );
    expect(response.status).toBe(403);
  });

  it("recalculate без Idempotency-Key → 400", async () => {
    getCurrentSession.mockResolvedValue(ADMIN);
    const response = await recalculateProject(
      request("http://localhost/api/admin/projects/p1/recalculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          priceVersionId: "v1",
          confirmed: true,
          expectedVersion: "1",
        }),
      }),
      params({ id: "p1" }),
    );
    expect(response.status).toBe(400);
  });
});
