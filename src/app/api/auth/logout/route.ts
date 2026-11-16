import { NextResponse, type NextRequest } from "next/server";

import { isSameOriginRequest } from "@/lib/auth/csrf";
import { getAuthConfig } from "@/lib/auth/config";
import { publicOrigin } from "@/lib/auth/public-origin";
import { buildEndSessionUrl, getOidcMetadata } from "@/lib/auth/oidc";
import {
  SESSION_COOKIE,
  deleteAdminSession,
  getAdminSession,
} from "@/lib/auth/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { ok: false, error: "Запрос отклонён." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const id = request.cookies.get(SESSION_COOKIE)?.value;
  const session = id ? await getAdminSession(id).catch(() => null) : null;
  if (id) await deleteAdminSession(id);

  let target: URL;
  let origin = request.nextUrl.origin;
  if (id) {
    try {
      const config = getAuthConfig();
      origin = publicOrigin(config, request.nextUrl.origin);
      target = new URL("/", origin);
      const metadata = await getOidcMetadata(config);
      target = new URL("/", origin);
      const endSession = buildEndSessionUrl({
        metadata,
        config,
        ...(session?.idToken ? { idToken: session.idToken } : {}),
        postLogoutRedirectUri: new URL("/", origin).toString(),
      });
      if (endSession) target = new URL(endSession);
    } catch {
      // Keycloak/OIDC недоступны — локальный logout всё равно состоялся.
      // Токены и детали ошибки не логируются.
      target = new URL("/", origin);
    }
  } else {
    target = new URL("/", origin);
  }

  const response = NextResponse.redirect(target, 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
