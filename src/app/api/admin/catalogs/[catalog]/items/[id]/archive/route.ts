import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { adminApiError, requireAdminApi } from "@/lib/admin/api-auth";
import { archiveCatalogItem, getCatalogItem } from "@/lib/admin/catalogs";
import { verifyCriticalConfirmation } from "@/lib/admin/confirmations";
import { adminMutationRateLimit, isSameOriginRequest } from "@/lib/auth/csrf";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  confirmed: z.boolean(),
  expectedVersion: z.string().trim().min(1),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ catalog: string; id: string }> },
) {
  const auth = await requireAdminApi("catalog.write");
  if (!auth.ok) return auth.response;
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return adminApiError(422, "Некорректное тело запроса.");

  const { catalog, id } = await context.params;
  const current = await getCatalogItem(catalog, id);
  if (!current) return adminApiError(404, "Элемент справочника не найден.");

  const confirmation = verifyCriticalConfirmation({
    operation: "archive",
    confirmed: parsed.data.confirmed,
    expectedVersion: parsed.data.expectedVersion,
    currentVersion: current.version,
  });
  if (!confirmation.ok) {
    return adminApiError(confirmation.status, confirmation.message);
  }

  try {
    const archived = await archiveCatalogItem(
      catalog,
      id,
      actorFromSession(auth.session),
    );
    return NextResponse.json(
      { ok: true, data: archived },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось архивировать.";
    const status = /не найден/i.test(message) ? 404 : /используется|уже в архиве/i.test(message) ? 409 : 422;
    return adminApiError(status, message);
  }
}
