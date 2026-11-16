import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { adminApiError, requireAdminApi } from "@/lib/admin/api-auth";
import { getParameter, updateParameterValue } from "@/lib/admin/parameters";
import { adminMutationRateLimit, isSameOriginRequest } from "@/lib/auth/csrf";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.strictObject({
  value: z.unknown(),
  expectedVersion: z.string().trim().min(1),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const parameter = await getParameter(id);
  if (!parameter) return adminApiError(404, "Параметр не найден.");
  return NextResponse.json(
    { ok: true, data: parameter },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (auth.session.role !== "calc-admin") {
    return adminApiError(403, "Недостаточно прав: требуется calc-admin.");
  }
  if (!isSameOriginRequest(request)) return adminApiError(403, "Запрос отклонён.");
  const limit = adminMutationRateLimit(request.headers);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Слишком много изменений. Повторите позже." },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminApiError(400, "Некорректный JSON.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return adminApiError(422, "Некорректное тело запроса.");

  const { id } = await context.params;
  try {
    const updated = await updateParameterValue(
      id,
      { value: parsed.data.value, expectedVersion: parsed.data.expectedVersion },
      actorFromSession(auth.session),
    );
    return NextResponse.json(
      { ok: true, data: updated },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить параметр.";
    const status = /найден/i.test(message)
      ? 404
      : /version|конфликт/i.test(message)
        ? 409
        : 422;
    return adminApiError(status, message);
  }
}
