import { NextResponse, type NextRequest } from "next/server";

import { adminApiError, requireAdminApi } from "@/lib/admin/api-auth";
import { listProjectPriceHistory } from "@/lib/admin/history";
import { projectIdSchema } from "@/lib/configurator/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const parsed = projectIdSchema.safeParse((await context.params).id);
  if (!parsed.success) return adminApiError(404, "Проект не найден.");

  const history = await listProjectPriceHistory(parsed.data);
  if (!history.ok) {
    return adminApiError(
      history.code === "PROJECT_NOT_FOUND" ? 404 : 409,
      history.message,
    );
  }
  return NextResponse.json(
    { ok: true, data: history.value },
    { headers: { "Cache-Control": "no-store" } },
  );
}
