import { NextResponse, type NextRequest } from "next/server";

import { adminApiError, requireAdminApi } from "@/lib/admin/api-auth";
import { diagnoseProjectRules } from "@/lib/admin/rules-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const result = await diagnoseProjectRules(id);
  if (!result.ok) return adminApiError(result.status, result.reason);
  return NextResponse.json(
    { ok: true, data: result.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
