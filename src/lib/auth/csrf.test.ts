import { describe, expect, it } from "vitest";

import { adminMutationRateLimit, isSameOriginRequest } from "./csrf";

function request(origin?: string): Request {
  return new Request("http://localhost/api/auth/logout", {
    method: "POST",
    headers: origin ? { origin } : undefined,
  });
}

describe("CA-T-604: CSRF/origin and admin rate-limit", () => {
  it("принимает same-origin и отсутствие origin", () => {
    expect(isSameOriginRequest(request("http://localhost"))).toBe(true);
    expect(isSameOriginRequest(request())).toBe(true);
  });

  it("принимает настроенный публичный origin за прокси", () => {
    process.env.FORMAKUB_AUTH_REDIRECT_URI = "http://localhost:3000/api/auth/callback";
    try {
      const req = new Request("http://0.0.0.0:3000/api/admin/parameters", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      });
      expect(isSameOriginRequest(req)).toBe(true);
    } finally {
      delete process.env.FORMAKUB_AUTH_REDIRECT_URI;
    }
  });

  it("отклоняет чужой origin", () => {
    expect(isSameOriginRequest(request("https://evil.example"))).toBe(false);
  });

  it("ограничивает admin-мутации rate-limit", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
    for (let index = 0; index < 6; index += 1) {
      expect(adminMutationRateLimit(headers).allowed).toBe(true);
    }
    expect(adminMutationRateLimit(headers).allowed).toBe(false);
  });
});
