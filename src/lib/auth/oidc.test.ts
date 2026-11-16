import { describe, expect, it } from "vitest";

import {
  buildEndSessionUrl,
  buildStateCookie,
  parseStateCookie,
  pkceChallenge,
} from "./oidc";

const secret = "x".repeat(32);

describe("CA-T-602: OIDC PKCE/state", () => {
  it("PKCE S256 совпадает с RFC 7636 вектором", () => {
    expect(
      pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("подписывает/проверяет state и отклоняет подделку", () => {
    const state = {
      state: "s",
      nonce: "n",
      codeVerifier: "v",
      returnTo: "/admin",
      createdAt: Date.now(),
    };
    const cookie = buildStateCookie(state, secret);
    expect(parseStateCookie(cookie, secret)).toEqual(state);
    expect(parseStateCookie(`${cookie}x`, secret)).toBeNull();
  });

  it("отклоняет истёкший state", () => {
    const cookie = buildStateCookie(
      {
        state: "s",
        nonce: "n",
        codeVerifier: "v",
        returnTo: "/admin",
        createdAt: Date.now() - 11 * 60 * 1000,
      },
      secret,
    );
    expect(parseStateCookie(cookie, secret)).toBeNull();
  });

  it("RP-initiated logout: end_session + redirect + optional id_token_hint", () => {
    const metadata = {
      issuer: "https://kc.example/realms/formakub",
      authorization_endpoint: "https://kc.example/auth",
      token_endpoint: "https://kc.example/token",
      jwks_uri: "https://kc.example/jwks",
      end_session_endpoint: "https://kc.example/logout",
    };
    const config = {
      issuer: metadata.issuer,
      clientId: "formakub-admin",
      audience: "formakub-admin-api",
      cookieSecret: secret,
    };
    const withToken = buildEndSessionUrl({
      metadata,
      config,
      idToken: "id-token-value",
      postLogoutRedirectUri: "https://admin.example/",
    });
    expect(withToken).toBeDefined();
    const url = new URL(withToken!);
    expect(url.origin + url.pathname).toBe("https://kc.example/logout");
    expect(url.searchParams.get("client_id")).toBe("formakub-admin");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://admin.example/",
    );
    expect(url.searchParams.get("id_token_hint")).toBe("id-token-value");

    const withoutToken = buildEndSessionUrl({
      metadata,
      config,
      postLogoutRedirectUri: "https://admin.example/",
    });
    expect(withoutToken).toBeDefined();
    expect(new URL(withoutToken!).searchParams.has("id_token_hint")).toBe(false);

    expect(
      buildEndSessionUrl({
        metadata: { ...metadata, end_session_endpoint: undefined },
        config,
        postLogoutRedirectUri: "https://admin.example/",
      }),
    ).toBeUndefined();
  });
});
