import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
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

import { GET as listRules, POST as createRule } from "./route";
import { GET as getRule, PATCH as patchRule } from "./[id]/route";
import { POST as createRevision } from "./[id]/revision/route";
import { POST as publishRules } from "./publish/route";
import { GET as listSnapshots } from "./snapshots/route";
import { GET as getActiveSnapshot } from "./snapshots/active/route";
import { GET as getSnapshot } from "./snapshots/[id]/route";
import { POST as transitionProject } from "@/app/api/admin/projects/[id]/rules-transition/route";
import { rulesPublicationBlocked } from "@/lib/admin/managed-rules";
import { POST as importSeed } from "./import/route";
import { defaultKitchen } from "@/lib/configurator/defaults";

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

const PUBLISHER: AdminSession = {
  ...ADMIN,
  id: "s-publisher",
  actorId: "publisher-1",
  permissions: ["price.publish"],
};

let dir = "";
let ip = 100;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-rules-api-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  delete process.env.FORMAKUB_STORAGE;
  getCurrentSession.mockReset();
  writeFileSync(
    path.join(dir, "projects.json"),
    JSON.stringify([
      {
        id: "project-1",
        config: defaultKitchen(),
        price: {},
        schemaVersion: 2,
        calcVersion: "calc-2026.11.2",
        priceVersion: "price-1",
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

function request(
  url: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
): NextRequest {
  const headers = new Headers(init?.headers);
  ip += 1;
  headers.set("x-forwarded-for", `10.0.0.${ip}`);
  return new NextRequest(url, { ...init, headers });
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

function ruleBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

async function createDraft(overrides: Record<string, unknown> = {}) {
  getCurrentSession.mockResolvedValue(ADMIN);
  const response = await createRule(
    request("http://localhost/api/admin/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ruleBody(overrides)),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).data as {
    id: string;
    version: string;
    status: string;
    source: string;
  };
}

async function publishDraft(draft: { id: string; version: string }) {
  const response = await publishRules(
    request("http://localhost/api/admin/rules/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selection: [{ id: draft.id, expectedVersion: draft.version }],
        confirmed: true,
        expectedStateVersion: "none",
      }),
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()).data as {
    snapshot: { id: string; rules: Array<{ id: string }> };
    replay: boolean;
  };
}

describe("CA-T-613: rules read API", () => {
  it("без сессии → 401; viewer читает", async () => {
    getCurrentSession.mockResolvedValue(null);
    expect((await listRules(request("http://localhost/api/admin/rules"))).status).toBe(401);

    getCurrentSession.mockResolvedValue(VIEWER);
    const response = await listRules(request("http://localhost/api/admin/rules"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([]);
  });

  it("карточка правила и редакции; 404 для неизвестного", async () => {
    const draft = await createDraft();
    getCurrentSession.mockResolvedValue(VIEWER);

    const response = await getRule(
      request(`http://localhost/api/admin/rules/${draft.id}`),
      params({ id: draft.id }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.rule.id).toBe(draft.id);
    expect(body.data.revisions).toHaveLength(1);

    const missing = await getRule(
      request("http://localhost/api/admin/rules/missing"),
      params({ id: "missing" }),
    );
    expect(missing.status).toBe(404);
  });

  it("снимки: пустой список, active=null, неизвестный id → 404", async () => {
    getCurrentSession.mockResolvedValue(VIEWER);
    const list = await listSnapshots();
    expect((await list.json()).data).toEqual([]);

    const active = await getActiveSnapshot();
    expect((await active.json()).data).toBeNull();

    const missing = await getSnapshot(
      request("http://localhost/api/admin/rules/snapshots/missing"),
      params({ id: "missing" }),
    );
    expect(missing.status).toBe(404);
  });
});

describe("CA-T-613: draft API и RBAC", () => {
  it("viewer не создаёт и не редактирует (403), admin создаёт", async () => {
    getCurrentSession.mockResolvedValue(VIEWER);
    const denied = await createRule(
      request("http://localhost/api/admin/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleBody()),
      }),
    );
    expect(denied.status).toBe(403);

    const created = await createDraft();
    expect(created.status).toBe("draft");
    expect(created.version).toBe("1");

    getCurrentSession.mockResolvedValue(VIEWER);
    const patchDenied = await patchRule(
      request(`http://localhost/api/admin/rules/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: "1", name: "x" }),
      }),
      params({ id: created.id }),
    );
    expect(patchDenied.status).toBe(403);
  });

  it("admin редактирует draft; published-редакция неизменяема", async () => {
    const draft = await createDraft();
    getCurrentSession.mockResolvedValue(ADMIN);

    const patched = await patchRule(
      request(`http://localhost/api/admin/rules/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: "1", value: 5 }),
      }),
      params({ id: draft.id }),
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).data.version).toBe("2");

    const published = await publishDraft({ ...draft, version: "2" });
    const denied = await patchRule(
      request(`http://localhost/api/admin/rules/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: "2", value: 7 }),
      }),
      params({ id: draft.id }),
    );
    expect(denied.status).toBe(409);
    expect(published.snapshot.rules[0].id).toBe(draft.id);
  });

  it("создаёт новую draft-редакцию published-правила", async () => {
    const draft = await createDraft();
    await publishDraft(draft);

    const response = await createRevision(
      request(`http://localhost/api/admin/rules/${draft.id}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: "1", value: 4 }),
      }),
      params({ id: draft.id }),
    );
    expect(response.status).toBe(201);
    const revision = (await response.json()).data;
    expect(revision.id).not.toBe(draft.id);
    expect(revision.status).toBe("draft");
    expect(revision.version).toBe("2");
  });

  it("отклоняет некорректное тело (422) и чужой origin (403)", async () => {
    getCurrentSession.mockResolvedValue(ADMIN);
    const invalid = await createRule(
      request("http://localhost/api/admin/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      }),
    );
    expect(invalid.status).toBe(422);

    const crossOrigin = await createRule(
      request("http://localhost/api/admin/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify(ruleBody()),
      }),
    );
    expect(crossOrigin.status).toBe(403);
  });

  it("rate-limit: 7-я мутация с одного IP → 429", async () => {
    getCurrentSession.mockResolvedValue(ADMIN);
    const payload = JSON.stringify(ruleBody());
    let last = 0;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const response = await createRule(
        new NextRequest("http://localhost/api/admin/rules", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "10.9.9.9",
          },
          body: payload,
        }),
      );
      last = response.status;
    }
    expect(last).toBe(429);
  });
});

describe("CA-T-613: publication API", () => {
  it("публикует явный выбор; replay без дубликата; нужен confirm", async () => {
    const draft = await createDraft();
    getCurrentSession.mockResolvedValue(ADMIN);

    const noConfirm = await publishRules(
      request("http://localhost/api/admin/rules/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selection: [{ id: draft.id, expectedVersion: "1" }],
          confirmed: false,
          expectedStateVersion: "none",
        }),
      }),
    );
    expect(noConfirm.status).toBe(409);

    const first = await publishDraft(draft);
    expect(first.replay).toBe(false);
    expect(first.snapshot.rules).toHaveLength(1);

    const replay = await publishRules(
      request("http://localhost/api/admin/rules/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selection: [{ id: draft.id, expectedVersion: "1" }],
          confirmed: true,
          expectedStateVersion: first.snapshot.id,
        }),
      }),
    );
    expect(replay.status).toBe(200);
    expect((await replay.json()).data.replay).toBe(true);
  });

  it("RBAC публикации: viewer → 403, publisher → 200", async () => {
    const draft = await createDraft();
    getCurrentSession.mockResolvedValue(VIEWER);
    const denied = await publishRules(
      request("http://localhost/api/admin/rules/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selection: [{ id: draft.id, expectedVersion: "1" }],
          confirmed: true,
          expectedStateVersion: "none",
        }),
      }),
    );
    expect(denied.status).toBe(403);

    getCurrentSession.mockResolvedValue(PUBLISHER);
    const allowed = await publishRules(
      request("http://localhost/api/admin/rules/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selection: [{ id: draft.id, expectedVersion: "1" }],
          confirmed: true,
          expectedStateVersion: "none",
        }),
      }),
    );
    expect(allowed.status).toBe(200);
  });

  it("production-публикация заблокирована серверным gate", () => {
    expect(rulesPublicationBlocked({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(
      rulesPublicationBlocked({
        NODE_ENV: "production",
        FORMAKUB_RULES_PUBLICATION_ENABLED: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(rulesPublicationBlocked({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("CA-T-613: project transition API", () => {
  it("выполняет переход; replay возвращает исходный результат; RBAC", async () => {
    const draft = await createDraft();
    const { snapshot } = await publishDraft(draft);

    getCurrentSession.mockResolvedValue(VIEWER);
    const denied = await transitionProject(
      request("http://localhost/api/admin/projects/project-1/rules-transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRulesSnapshotId: snapshot.id,
          expectedVersion: "2026-01-01T00:00:00.000Z",
          operationId: "op-1",
          confirmed: true,
        }),
      }),
      params({ id: "project-1" }),
    );
    expect(denied.status).toBe(403);

    getCurrentSession.mockResolvedValue(ADMIN);
    const first = await transitionProject(
      request("http://localhost/api/admin/projects/project-1/rules-transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRulesSnapshotId: snapshot.id,
          expectedVersion: "2026-01-01T00:00:00.000Z",
          operationId: "op-1",
          confirmed: true,
        }),
      }),
      params({ id: "project-1" }),
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.data.replay).toBe(false);
    expect(firstBody.data.rulesSnapshotId).toBe(snapshot.id);

    const replay = await transitionProject(
      request("http://localhost/api/admin/projects/project-1/rules-transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRulesSnapshotId: snapshot.id,
          expectedVersion: firstBody.data.updatedAt,
          operationId: "op-1",
          confirmed: true,
        }),
      }),
      params({ id: "project-1" }),
    );
    expect(replay.status).toBe(200);
    expect((await replay.json()).data.replay).toBe(true);
  });

  it("404 неизвестный проект; 409 устаревший expectedVersion", async () => {
    const draft = await createDraft();
    const { snapshot } = await publishDraft(draft);
    getCurrentSession.mockResolvedValue(ADMIN);

    const missing = await transitionProject(
      request("http://localhost/api/admin/projects/missing/rules-transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRulesSnapshotId: snapshot.id,
          expectedVersion: "x",
          operationId: "op-2",
          confirmed: true,
        }),
      }),
      params({ id: "missing" }),
    );
    expect(missing.status).toBe(404);

    const stale = await transitionProject(
      request("http://localhost/api/admin/projects/project-1/rules-transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRulesSnapshotId: snapshot.id,
          expectedVersion: "stale",
          operationId: "op-3",
          confirmed: true,
        }),
      }),
      params({ id: "project-1" }),
    );
    expect(stale.status).toBe(409);
  });
});

describe("NEW-N4: deterministic seed API", () => {
  it("viewer → 403; admin импортирует 27 draft; повтор идемпотентен; snapshot не создаётся", async () => {
    getCurrentSession.mockResolvedValue(VIEWER);
    const denied = await importSeed(
      request("http://localhost/api/admin/rules/import", { method: "POST" }),
    );
    expect(denied.status).toBe(403);

    getCurrentSession.mockResolvedValue(ADMIN);
    const first = await importSeed(
      request("http://localhost/api/admin/rules/import", { method: "POST" }),
    );
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.data.created).toHaveLength(27);
    expect(firstBody.data.expected).toBe(27);
    expect(existsSync(path.join(dir, "rules-snapshots.json"))).toBe(false);

    const second = await importSeed(
      request("http://localhost/api/admin/rules/import", { method: "POST" }),
    );
    expect(second.status).toBe(200);
    expect((await second.json()).data.created).toEqual([]);
  });
});
