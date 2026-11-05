import { NextResponse } from "next/server";
import { leadPayloadSchema } from "@/lib/configurator/schema";
import { createLead } from "@/lib/server/leads";
import { checkRateLimit, clientKey } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "Запрос отклонён." },
      { status: 403 },
    );
  }

  const limit = checkRateLimit(`lead:${clientKey(request.headers)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "Слишком много попыток. Попробуйте позже или свяжитесь с нами другим способом.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
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

  const parsed = leadPayloadSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return NextResponse.json(
      {
        ok: false,
        error:
          issues[0]?.message ??
          "Проверьте заполнение формы и корректность конфигурации.",
        issues,
      },
      { status: 422 },
    );
  }

  try {
    const created = await createLead({
      config: parsed.data.config,
      customer: parsed.data.customer,
      source: parsed.data.source,
      interest: parsed.data.interest,
    });

    if (!created.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Конфигурация не прошла проверку. Обновите параметры и попробуйте снова.",
          issues: created.issues,
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        leadId: created.lead.id,
        total: created.lead.price?.total ?? null,
        createdAt: created.lead.createdAt,
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
    );
  } catch (error) {
    console.error("Failed to store lead", error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        ok: false,
        error: "Не удалось сохранить заявку. Попробуйте ещё раз или свяжитесь с нами напрямую.",
      },
      { status: 500 },
    );
  }
}
