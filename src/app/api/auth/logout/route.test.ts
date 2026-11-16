import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/oidc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/oidc")>();
  return { ...actual, getOidcMetadata: vi.fn() };
});

import {
  SESSION_COOKIE,
  SESSIONS_COLLECTION,
  createAdminSession,
  getAdminSession,
} from "@/lib/auth/session-store";
import { getOidcMetadata } from "@/lib/auth/oidc";
import { POST } from "./route";

const mockedMetadata = vi.mocked(getOidcMetadata);
let dir = "";

const metadata = {
  issuer: "http://localhost:8080/realms/formakub",
  authorization_endpoint: "https://kc.example/auth",
  token_endpoint: "https://kc.example/token",
  jwks_uri: "https://kc.example/jwks",
  end_session_endpoint: "https://kc.example/logout",
};

function request(cookie?: string, origin = "http://localhost"): NextRequest {
  return new NextRequest("http://localhost/api/auth/logout", {
    method: "POST",
    headers: {
      origin,
      ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}),
    },
  });
}

async function session(idToken?: string) {
  return createAdminSession({
    actorId: "admin:test",
    role: "calc-admin",
    permissions: ["catalog.write"],
    ...(idToken ? { idToken } : {}),
  });
}

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-logout-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.KEYCLOAK_ISSUER_URL = "http://localhost:8080/realms/formakub";
  process.env.FORMAKUB_AUTH_SECRET = "x".repeat(32);
});

beforeEach(() => {
  mockedMetadata.mockReset();
  mockedMetadata.mockResolvedValue(metadata);
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.KEYCLOAK_ISSUER_URL;
  delete process.env.FORMAKUB_AUTH_SECRET;
  rmSync(path.join(dir, SESSIONS_COLLECTION), { force: true });
  rmSync(dir, { recursive: true, force: true });
});

describe("CA-T-511: RP-initiated logout", () => {
  it("удаляет app session и переходит на Keycloak end-session с id_token_hint", async () => {
    const created = await session("id-token-value");
    const response = await POST(request(created.id));
    expect(response.status).toBe(303);

    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const url = new URL(location!);
    expect(url.origin + url.pathname).toBe("https://kc.example/logout");
    expect(url.searchParams.get("client_id")).toBe("formakub-admin");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://localhost/",
    );
    expect(url.searchParams.get("id_token_hint")).toBe("id-token-value");

    expect(await getAdminSession(created.id, new Date(Date.now()+60_000).toISOString())).toBeNull();
    const body = await response.text();
    expect(body).not.toContain("id-token-value");
  });

  it("старая сессия без id_token_hint безопасно завершается", async () => {
    const created = await session();
    const response = await POST(request(created.id));
    expect(response.status).toBe(303);
    const url = new URL(response.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://kc.example/logout");
    expect(url.searchParams.has("id_token_hint")).toBe(false);
    expect(await getAdminSession(created.id, new Date(Date.now()+60_000).toISOString())).toBeNull();
  });

  it("недоступный OIDC discovery не мешает локальному logout", async () => {
    mockedMetadata.mockRejectedValueOnce(new Error("discovery down"));
    const created = await session("id-token-value");
    const response = await POST(request(created.id));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(await getAdminSession(created.id, new Date(Date.now()+60_000).toISOString())).toBeNull();
  });

  it("чужой origin отклоняется", async () => {
    const response = await POST(request(undefined, "https://evil.example"));
    expect(response.status).toBe(403);
  });
});
