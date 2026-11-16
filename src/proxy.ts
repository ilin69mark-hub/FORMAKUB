import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/session-store";

/**
 * CA-T-602 — deny-by-default для admin UI/API.
 * Полная проверка сессии выполняется server-side (layout/handlers).
 */
export function proxy(request: NextRequest) {
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSessionCookie) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    return NextResponse.json(
      { ok: false, error: "Требуется аутентификация." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const login = new URL("/api/auth/login", request.nextUrl.origin);
  login.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
