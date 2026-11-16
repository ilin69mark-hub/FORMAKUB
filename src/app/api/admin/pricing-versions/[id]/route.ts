import { NextResponse, type NextRequest } from "next/server";

import { adminApiError, requireAdminApi } from "@/lib/admin/api-auth";
import { getVersion } from "@/lib/admin/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const version = await getVersion(id);
  if (!version) return adminApiError(404, "Версия не найдена.");
  return NextResponse.json(
    { ok: true, data: version },
    { headers: { "Cache-Control": "no-store" } },
  );
}
