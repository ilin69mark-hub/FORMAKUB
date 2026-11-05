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
    const project = await getProject(parsed.data);
    if (!project) {
      return NextResponse.json(
        { ok: false, error: "Проект не найден или больше недоступен." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        project: {
          id: project.id,
          config: project.config,
          price: project.price,
          updatedAt: project.updatedAt,
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
