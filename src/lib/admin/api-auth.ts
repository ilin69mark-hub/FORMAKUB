import { NextResponse } from "next/server";

import type { AdminPermission } from "@/lib/auth/permissions";
import { authorizePermission } from "@/lib/auth/permissions";
import { auditDenied } from "@/lib/auth/audit-denied";
import { adminMutationRateLimit, isSameOriginRequest } from "@/lib/auth/csrf";
import { getCurrentSession } from "@/lib/auth/session";
import type { AdminSession } from "@/lib/auth/session-store";
import type { AuditAction } from "@/lib/server/audit";

function deniedAction(permission: AdminPermission): AuditAction {
  switch (permission) {
    case "catalog.write":
      return "catalog.update";
    case "price.write":
      return "price.update";
    case "price.publish":
      return "pricing.publish";
    case "recalc.run":
      return "recalc.run";
  }
}

async function recordDenied(
  permission: AdminPermission,
  session: AdminSession | null,
  reason: string,
  actionOverride?: AuditAction,
): Promise<void> {
  try {
    await auditDenied({
      action: actionOverride ?? deniedAction(permission),
      entityType: "adminApi",
      entityId: permission,
      actor: session
        ? { actorId: session.actorId, actorRole: session.role }
        : null,
      reason,
    });
  } catch {
    // Аудит не должен превращать отказ в 500.
  }
}

/** CA-T-609: общий auth-guard для admin API (session + optional permission). */
export async function requireAdminApi(
  permission?: AdminPermission,
  actionOverride?: AuditAction,
): Promise<{ ok: true; session: AdminSession } | { ok: false; response: NextResponse }> {
  const session = await getCurrentSession();
  if (!session) {
    if (permission) {
      await recordDenied(permission, null, "Требуется аутентификация.", actionOverride);
    }
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Требуется аутентификация." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  if (permission) {
    const allowed = authorizePermission(session, permission);
    if (!allowed.ok) {
      await recordDenied(permission, session, allowed.message, actionOverride);
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: allowed.message },
          { status: allowed.status, headers: { "Cache-Control": "no-store" } },
        ),
      };
    }
  }
  return { ok: true, session };
}

export function adminApiError(status: number, error: string) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * CA-T-609: единый guard для admin-мутаций — session + permission,
 * same-origin и rate-limit. Возвращает сессию для actor-контекста.
 */
export async function guardAdminMutation(
  request: Request,
  permission?: AdminPermission,
  actionOverride?: AuditAction,
): Promise<
  { ok: true; session: AdminSession } | { ok: false; response: NextResponse }
> {
  const auth = await requireAdminApi(permission, actionOverride);
  if (!auth.ok) return auth;
  if (!isSameOriginRequest(request)) {
    return { ok: false, response: adminApiError(403, "Запрос отклонён.") };
  }
  const limit = adminMutationRateLimit(request.headers);
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Слишком много изменений. Повторите позже." },
        {
          status: 429,
          headers: {
            "Retry-After": String(limit.retryAfterSeconds),
            "Cache-Control": "no-store",
          },
        },
      ),
    };
  }
  return { ok: true, session: auth.session };
}

export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: adminApiError(400, "Некорректный JSON.") };
  }
}

/** Маппинг доменных ошибок сервисов в HTTP-статусы (409/404/422). */
export function mutationErrorResponse(error: unknown): NextResponse {
  const message =
    error instanceof Error ? error.message : "Не удалось выполнить операцию.";
  const status = /не найден|not found/i.test(message)
    ? 404
    : /конфликт|conflict|уже|повтор|статус|version|используется|опубликован/i.test(
          message,
        )
      ? 409
      : 422;
  return adminApiError(status, message);
}
