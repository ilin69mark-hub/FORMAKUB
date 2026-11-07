import { NextResponse } from "next/server";
import { projectIdSchema } from "@/lib/configurator/schema";
import { getProject } from "@/lib/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = projectIdSchema.safeParse(id);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Проект не найден." },
      { status: 404 },
    );
  }

  try {
    const result = await getProject(parsed.data);

    if (result.status === "not_found") {
      return NextResponse.json(
        { ok: false, error: "Проект не найден или больше недоступен." },
        { status: 404 },
      );
    }

    if (result.status === "quarantined") {
      // Квартирование вместо 500 (CA-T-106, дизайн §12 S6): файл не меняется.
      return NextResponse.json(
        {
          ok: false,
          error: "Данные проекта повреждены и помещены на карантин.",
          reason: result.reason,
        },
        { status: 409 },
      );
    }

    if (result.status === "unsupported") {
      // Проект отдаётся в raw-режиме с пометкой, а не теряется (OI-064).
      return NextResponse.json(
        {
          ok: true,
          project: {
            id: result.project.id,
            config: result.project.config,
            price: result.project.price,
            updatedAt: result.project.updatedAt,
            compatibility: "unsupported",
            reason: result.reason,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        project: {
          id: result.project.id,
          config: result.project.config,
          price: result.project.price,
          updatedAt: result.project.updatedAt,
          versionsInferred: result.versionsInferred,
          calcVersionUnknown: result.calcVersionUnknown,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Не удалось загрузить проект." },
      { status: 500 },
    );
  }
}
