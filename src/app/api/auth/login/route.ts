import { NextResponse, type NextRequest } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import {
  authorizationUrl,
  buildStateCookie,
  getOidcMetadata,
  pkceChallenge,
  randomToken,
} from "@/lib/auth/oidc";
import { OIDC_STATE_COOKIE } from "@/lib/auth/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/admin";
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const metadata = await getOidcMetadata(config);
    const redirectUri =
      config.redirectUri ??
      new URL("/api/auth/callback", request.nextUrl.origin).toString();
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken(48);
    const stateCookie = buildStateCookie(
      {
        state,
        nonce,
        codeVerifier,
        returnTo: safeReturnTo(request.nextUrl.searchParams.get("returnTo")),
        createdAt: Date.now(),
      },
      config.cookieSecret,
    );

    const response = NextResponse.redirect(
      authorizationUrl({
        metadata,
        config,
        redirectUri,
        state,
        nonce,
        codeChallenge: pkceChallenge(codeVerifier),
      }),
    );
    response.cookies.set(OIDC_STATE_COOKIE, stateCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не удалось начать аутентификацию.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
