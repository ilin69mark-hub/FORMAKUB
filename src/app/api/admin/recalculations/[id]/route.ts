import { NextResponse, type NextRequest } from "next/server";

import { adminApiError, requireAdminApi } from "@/lib/admin/api-auth";
import { getProjectRecalculation } from "@/lib/admin/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const job = await getProjectRecalculation(id);
  if (!job) return adminApiError(404, "Задание не найдено.");
  return NextResponse.json(
    { ok: true, data: job },
    { headers: { "Cache-Control": "no-store" } },
  );
}
