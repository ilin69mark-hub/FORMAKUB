import { NextResponse, type NextRequest } from "next/server";

import { adminApiError, requireAdminApi } from "@/lib/admin/api-auth";
import { getRecalculationBatch } from "@/lib/admin/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const batch = await getRecalculationBatch(id);
  if (!batch) return adminApiError(404, "Батч не найден.");
  return NextResponse.json(
    { ok: true, data: batch },
    { headers: { "Cache-Control": "no-store" } },
  );
}
