import { describe, expect, it } from "vitest";

import { getAuthConfig } from "./config";

const base = {
  KEYCLOAK_ISSUER_URL: "https://keycloak.example/realms/formakub",
  FORMAKUB_AUTH_SECRET: "x".repeat(32),
};

describe("CA-T-602: auth config", () => {
  it("fail-closed без issuer/secret", () => {
    expect(() => getAuthConfig({})).toThrow(/KEYCLOAK_ISSUER_URL/);
    expect(() => getAuthConfig({ KEYCLOAK_ISSUER_URL: base.KEYCLOAK_ISSUER_URL })).toThrow(
      /FORMAKUB_AUTH_SECRET/,
    );
  });

  it("использует согласованные defaults client/audience", () => {
    const config = getAuthConfig(base);
    expect(config.issuer).toBe("https://keycloak.example/realms/formakub");
    expect(config.clientId).toBe("formakub-admin");
    expect(config.audience).toBe("formakub-admin-api");
  });

  it("поддерживает env overrides и убирает trailing slash", () => {
    const config = getAuthConfig({
      ...base,
      KEYCLOAK_ISSUER_URL: "https://keycloak.example/realms/formakub/",
      KEYCLOAK_CLIENT_ID: "client-x",
      KEYCLOAK_AUDIENCE: "aud-x",
      KEYCLOAK_CLIENT_SECRET: "secret",
    });
    expect(config.issuer).toBe("https://keycloak.example/realms/formakub");
    expect(config.clientId).toBe("client-x");
    expect(config.audience).toBe("aud-x");
    expect(config.clientSecret).toBe("secret");
  });

  it("отклоняет короткий secret", () => {
    expect(() =>
      getAuthConfig({ ...base, FORMAKUB_AUTH_SECRET: "short" }),
    ).toThrow(/32/);
  });
});
