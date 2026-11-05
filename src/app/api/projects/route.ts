import { NextResponse } from "next/server";
import { projectPayloadSchema } from "@/lib/configurator/schema";
import { saveProject } from "@/lib/server/projects";
import { checkRateLimit, clientKey } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = checkRateLimit(`project:${clientKey(request.headers)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Слишком много сохранений подряд. Подождите немного." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
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
      { ok: false, error: "Некорректный запрос." },
      { status: 400 },
    );
  }

  const parsed = projectPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Конфигурация не прошла проверку.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  try {
    const saved = await saveProject({ config: parsed.data.config });
    if (!saved.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Конфигурация не прошла проверку. Исправьте отмеченные параметры.",
          issues: saved.issues,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        id: saved.project.id,
        total: saved.project.price.total,
        createdAt: saved.project.createdAt,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to save project", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { ok: false, error: "Не удалось сохранить проект. Попробуйте ещё раз." },
      { status: 500 },
    );
  }
}
