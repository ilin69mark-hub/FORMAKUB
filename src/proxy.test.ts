import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";
import { SESSION_COOKIE } from "@/lib/auth/session-store";

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("CA-T-602: proxy deny-by-default", () => {
  it("без cookie перенаправляет /admin на login", () => {
    const response = proxy(request("/admin/parameters"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/api/auth/login");
    expect(response.headers.get("location")).toContain(
      encodeURIComponent("/admin/parameters"),
    );
  });

  it("без cookie возвращает 401 для /api/admin", async () => {
    const response = proxy(request("/api/admin/parameters"));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("с cookie пропускает запрос", () => {
    const response = proxy(request("/admin", `${SESSION_COOKIE}=session-id`));
    expect(response.status).toBe(200);
  });
});
