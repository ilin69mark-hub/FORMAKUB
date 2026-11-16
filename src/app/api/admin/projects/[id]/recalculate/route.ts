import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { adminApiError, requireAdminApi } from "@/lib/admin/api-auth";
import { verifyCriticalConfirmation } from "@/lib/admin/confirmations";
import { adminMutationRateLimit, isSameOriginRequest } from "@/lib/auth/csrf";
import { projectIdSchema } from "@/lib/configurator/schema";
import { BUILD_CALC_VERSION } from "@/lib/configurator/versions";
import { getProject, recalculateProject } from "@/lib/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  priceVersionId: z.string().trim().min(1),
  confirmed: z.boolean(),
  expectedVersion: z.string().trim().min(1),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi("recalc.run");
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

  const operationId = request.headers.get("idempotency-key")?.trim();
  if (!operationId) return adminApiError(400, "Заголовок Idempotency-Key обязателен.");

  const id = (await context.params).id;
  const parsedId = projectIdSchema.safeParse(id);
  if (!parsedId.success) return adminApiError(404, "Проект не найден.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminApiError(400, "Некорректный JSON.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return adminApiError(422, "Некорректное тело запроса.");

  const project = await getProject(parsedId.data);
  if (project.status === "not_found") return adminApiError(404, "Проект не найден.");
  if (project.status === "quarantined") return adminApiError(409, project.reason);
  if (project.status === "unsupported") return adminApiError(422, project.reason);
  if (!project.project.calcVersion) {
    return adminApiError(409, "У проекта отсутствует calcVersion; пересчёт заблокирован.");
  }

  const confirmation = verifyCriticalConfirmation({
    operation: "recalc",
    confirmed: parsed.data.confirmed,
    expectedVersion: parsed.data.expectedVersion,
    currentVersion: project.project.calcVersion,
  });
  if (!confirmation.ok) {
    return adminApiError(confirmation.status, confirmation.message);
  }

  const result = await recalculateProject({
    projectId: parsedId.data,
    operationId,
    targetPriceVersionId: parsed.data.priceVersionId,
    expectedProjectCalcVersion: project.project.calcVersion,
    requiredExecutedCalcVersion: BUILD_CALC_VERSION,
    expectedSourcePriceVersion: project.project.priceVersion ?? null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: "Пересчёт не выполнен.", issues: result.issues },
      { status: result.status ?? 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        id: result.project.id,
        total: result.project.price.total,
        priceVersion: result.project.priceVersion,
        calcVersion: result.project.calcVersion,
        replay: result.replay,
      },
    },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
