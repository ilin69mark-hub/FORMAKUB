import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";

import type { AuthConfig } from "./config";

export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

export interface OidcState {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
}

const DISCOVERY_TTL_MS = 5 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const metadataCache = new Map<string, { value: OidcMetadata; expiresAt: number }>();

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function decodeJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/$/, "");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildStateCookie(state: OidcState, secret: string): string {
  const payload = base64url(JSON.stringify(state));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function parseStateCookie(value: string, secret: string): OidcState | null {
  try {
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return null;
    const expected = createHmac("sha256", secret).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const state = decodeJson<OidcState>(payload);
    if (
      typeof state.state !== "string" ||
      typeof state.nonce !== "string" ||
      typeof state.codeVerifier !== "string" ||
      typeof state.returnTo !== "string" ||
      typeof state.createdAt !== "number" ||
      Date.now() - state.createdAt > STATE_TTL_MS
    ) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export async function getOidcMetadata(config: AuthConfig): Promise<OidcMetadata> {
  const cached = metadataCache.get(config.issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const response = await fetch(
    `${config.issuer}/.well-known/openid-configuration`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`OIDC discovery: ${config.issuer} → HTTP ${response.status}`);
  }
  const value = (await response.json()) as Partial<OidcMetadata>;
  if (
    typeof value.issuer !== "string" ||
    normalizeIssuer(value.issuer) !== config.issuer ||
    typeof value.authorization_endpoint !== "string" ||
    typeof value.token_endpoint !== "string" ||
    typeof value.jwks_uri !== "string"
  ) {
    throw new Error("OIDC discovery: некорректные issuer/endpoints");
  }
  const metadata: OidcMetadata = {
    issuer: normalizeIssuer(value.issuer),
    authorization_endpoint: value.authorization_endpoint,
    token_endpoint: value.token_endpoint,
    jwks_uri: value.jwks_uri,
    ...(typeof value.end_session_endpoint === "string" && value.end_session_endpoint
      ? { end_session_endpoint: value.end_session_endpoint }
      : {}),
  };
  metadataCache.set(config.issuer, {
    value: metadata,
    expiresAt: Date.now() + DISCOVERY_TTL_MS,
  });
  return metadata;
}

/**
 * RP-Initiated Logout URL (OIDC). `id_token_hint` is optional: sessions
 * created before this feature (or a missing token) still produce a safe
 * end-session redirect. The token is never logged or returned in response body.
 */
export function buildEndSessionUrl(input: {
  metadata: OidcMetadata;
  config: AuthConfig;
  idToken?: string;
  postLogoutRedirectUri: string;
}): string | undefined {
  if (!input.metadata.end_session_endpoint) return undefined;
  const url = new URL(input.metadata.end_session_endpoint);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("post_logout_redirect_uri", input.postLogoutRedirectUri);
  if (input.idToken) url.searchParams.set("id_token_hint", input.idToken);
  return url.toString();
}

export function authorizationUrl(input: {
  metadata: OidcMetadata;
  config: AuthConfig;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {  const url = new URL(input.metadata.authorization_endpoint);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCode(input: {
  config: AuthConfig;
  metadata: OidcMetadata;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<{ accessToken: string; idToken: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.config.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  if (input.config.clientSecret) {
    body.set("client_secret", input.config.clientSecret);
  }
  const response = await fetch(input.metadata.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`OIDC token exchange: HTTP ${response.status}`);
  }
  const value = (await response.json()) as {
    access_token?: unknown;
    id_token?: unknown;
  };
  if (typeof value.access_token !== "string" || typeof value.id_token !== "string") {
    throw new Error("OIDC token exchange: отсутствует access_token/id_token");
  }
  return { accessToken: value.access_token, idToken: value.id_token };
}

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

let jwksCache: { uri: string; keys: Jwk[]; expiresAt: number } | undefined;

async function getJwks(uri: string): Promise<Jwk[]> {
  if (jwksCache && jwksCache.uri === uri && jwksCache.expiresAt > Date.now()) {
    return jwksCache.keys;
  }
  const response = await fetch(uri, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`OIDC JWKS: HTTP ${response.status}`);
  const value = (await response.json()) as { keys?: unknown };
  const keys = Array.isArray(value.keys)
    ? value.keys.filter((key): key is Jwk => typeof key === "object" && key !== null)
    : [];
  if (keys.length === 0) throw new Error("OIDC JWKS: пустой набор ключей");
  jwksCache = { uri, keys, expiresAt: Date.now() + DISCOVERY_TTL_MS };
  return keys;
}

export interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  nonce?: string;
  [key: string]: unknown;
}

export async function verifyJwt(input: {
  token: string;
  config: AuthConfig;
  metadata: OidcMetadata;
  audience: string;
  nonce?: string;
}): Promise<JwtClaims> {
  const parts = input.token.split(".");
  if (parts.length !== 3) throw new Error("JWT: ожидалось три сегмента");
  const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]!);
  if (header.alg !== "RS256") throw new Error(`JWT: alg "${header.alg}" не поддерживается`);
  const keys = await getJwks(input.metadata.jwks_uri);
  const jwk = keys.find((key) => key.kid === header.kid) ?? keys.find((key) => key.kid === undefined);
  if (!jwk) throw new Error("JWT: ключ kid не найден");

  const key = createPublicKey({ key: jwk as never, format: "jwk" });
  const valid = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2]!, "base64url"),
  );
  if (!valid) throw new Error("JWT: подпись недействительна");

  const claims = decodeJson<JwtClaims>(parts[1]!);
  if (normalizeIssuer(String(claims.iss ?? "")) !== input.config.issuer) {
    throw new Error("JWT: issuer не совпадает");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(input.audience)) {
    throw new Error(`JWT: audience не содержит "${input.audience}"`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now - 30) {
    throw new Error("JWT: истёк");
  }
  if (typeof claims.nbf === "number" && claims.nbf > now + 30) {
    throw new Error("JWT: ещё не активен");
  }
  if (input.nonce !== undefined && claims.nonce !== input.nonce) {
    throw new Error("JWT: nonce не совпадает");
  }
  return claims;
}
