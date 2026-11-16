import { NextResponse } from "next/server";
import { z } from "zod";

import { projectIdSchema } from "@/lib/configurator/schema";
import { recalculateProject } from "@/lib/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recalculateRequestSchema = z.strictObject({
  targetPriceVersionId: z.string().trim().min(1),
  expectedProjectCalcVersion: z.string().trim().min(1),
  requiredExecutedCalcVersion: z.string().trim().min(1),
  expectedSourcePriceVersion: z.string().trim().min(1).nullable(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsedId = projectIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { ok: false, error: "Проект не найден." },
      { status: 404 },
    );
  }

  const operationId = request.headers.get("idempotency-key")?.trim();
  if (!operationId) {
    return NextResponse.json(
      { ok: false, error: "Заголовок Idempotency-Key обязателен." },
      { status: 400 },
    );
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json(
      { ok: false, error: "Ожидается JSON-запрос." },
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Некорректный JSON." },
      { status: 400 },
    );
  }

  const parsed = recalculateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Запрос пересчёта не прошёл проверку.",
        issues: parsed.error.issues.map((issue) => ({
          code: "INVALID_REQUEST",
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  try {
    const result = await recalculateProject({
      projectId: parsedId.data,
      operationId,
      targetPriceVersionId: parsed.data.targetPriceVersionId,
      expectedProjectCalcVersion: parsed.data.expectedProjectCalcVersion,
      requiredExecutedCalcVersion: parsed.data.requiredExecutedCalcVersion,
      expectedSourcePriceVersion: parsed.data.expectedSourcePriceVersion,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            result.status === 409
              ? "Пересчёт конфликтует с текущим состоянием проекта."
              : result.status === 404
                ? "Проект не найден."
                : "Не удалось пересчитать проект.",
          issues: result.issues,
        },
        { status: result.status ?? 422, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        replay: result.replay,
        project: {
          id: result.project.id,
          total: result.project.price.total,
          priceVersion: result.project.priceVersion,
          calcVersion: result.project.calcVersion,
          updatedAt: result.project.updatedAt,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "Failed to recalculate project",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { ok: false, error: "Не удалось пересчитать проект." },
      { status: 500 },
    );
  }
}
