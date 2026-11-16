import { NextResponse, type NextRequest } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { publicOrigin } from "@/lib/auth/public-origin";
import {
  exchangeCode,
  getOidcMetadata,
  parseStateCookie,
  verifyJwt,
} from "@/lib/auth/oidc";
import { mapKeycloakRoles } from "@/lib/auth/permissions";
import {
  OIDC_STATE_COOKIE,
  SESSION_COOKIE,
  createAdminSession,
  sessionCookieOptions,
} from "@/lib/auth/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/admin";
}

function fail(status: number, error: string) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function actorIdFromClaims(claims: Record<string, unknown>): string | undefined {
  for (const key of ["preferred_username", "email", "sub"]) {
    const value = claims[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");
  if (error) return fail(401, `Keycloak: ${error}`);

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) return fail(400, "Некорректный callback: нет code/state.");

  try {
    const config = getAuthConfig();
    const stateCookie = request.cookies.get(OIDC_STATE_COOKIE)?.value;
    const savedState = stateCookie ? parseStateCookie(stateCookie, config.cookieSecret) : null;
    if (!savedState || savedState.state !== state) {
      return fail(401, "Некорректный или истёкший OIDC state.");
    }

    const metadata = await getOidcMetadata(config);
    const redirectUri =
      config.redirectUri ??
      new URL("/api/auth/callback", request.nextUrl.origin).toString();
    const tokens = await exchangeCode({
      config,
      metadata,
      code,
      codeVerifier: savedState.codeVerifier,
      redirectUri,
    });

    const accessClaims = await verifyJwt({
      token: tokens.accessToken,
      config,
      metadata,
      audience: config.audience,
    });
    const idClaims = await verifyJwt({
      token: tokens.idToken,
      config,
      metadata,
      audience: config.clientId,
      nonce: savedState.nonce,
    });

    const mapping = mapKeycloakRoles(accessClaims, config.audience);
    if (!mapping.ok || !mapping.identity) {
      return fail(403, mapping.reason ?? "Нет разрешённых client roles.");
    }
    const actorId =
      actorIdFromClaims(idClaims) ??
      actorIdFromClaims(accessClaims) ??
      "keycloak:unknown";

    const session = await createAdminSession({
      actorId,
      actorName:
        typeof idClaims.name === "string" && idClaims.name.trim()
          ? idClaims.name
          : actorId,
      role: mapping.identity.role,
      permissions: mapping.identity.permissions,
      idToken: tokens.idToken,
    });

    const response = NextResponse.redirect(
      new URL(
        safeReturnTo(savedState.returnTo),
        publicOrigin(config, request.nextUrl.origin),
      ),
      303,
    );
    response.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions());
    response.cookies.delete(OIDC_STATE_COOKIE);
    return response;
  } catch (error) {
    return fail(
      503,
      error instanceof Error ? error.message : "Не удалось завершить аутентификацию.",
    );
  }
}
