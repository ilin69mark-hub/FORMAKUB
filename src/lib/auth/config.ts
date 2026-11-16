/**
 * CA-T-602 — Keycloak/OIDC configuration.
 *
 * Issuer задаётся только через окружение; hostname не фиксируется в коде.
 * Отсутствие обязательных параметров — fail-closed (исключение при вызове).
 */

export interface AuthConfig {
  issuer: string;
  clientId: string;
  audience: string;
  clientSecret?: string;
  redirectUri?: string;
  cookieSecret: string;
}

const DEFAULT_CLIENT_ID = "formakub-admin";
const DEFAULT_AUDIENCE = "formakub-admin-api";

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Auth configuration: обязательная переменная ${name} отсутствует`);
  }
  return value;
}

function optional(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function getAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AuthConfig {
  const issuer = required(env, "KEYCLOAK_ISSUER_URL");
  let parsed: URL;
  try {
    parsed = new URL(issuer);
  } catch {
    throw new Error("Auth configuration: KEYCLOAK_ISSUER_URL должен быть абсолютным URL");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("Auth configuration: KEYCLOAK_ISSUER_URL должен быть http(s) URL");
  }

  const cookieSecret = required(env, "FORMAKUB_AUTH_SECRET");
  if (cookieSecret.length < 32) {
    throw new Error("Auth configuration: FORMAKUB_AUTH_SECRET должен быть не короче 32 символов");
  }

  return {
    issuer: parsed.toString().replace(/\/$/, ""),
    clientId: optional(env, "KEYCLOAK_CLIENT_ID") ?? DEFAULT_CLIENT_ID,
    audience: optional(env, "KEYCLOAK_AUDIENCE") ?? DEFAULT_AUDIENCE,
    ...(optional(env, "KEYCLOAK_CLIENT_SECRET")
      ? { clientSecret: optional(env, "KEYCLOAK_CLIENT_SECRET")! }
      : {}),
    ...(optional(env, "FORMAKUB_AUTH_REDIRECT_URI")
      ? { redirectUri: optional(env, "FORMAKUB_AUTH_REDIRECT_URI")! }
      : {}),
    cookieSecret,
  };
}
