import { NextResponse } from "next/server";

import { adminApiError, requireAdminApi } from "@/lib/admin/api-auth";
import { resolveActiveRulesSnapshot } from "@/lib/admin/managed-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const resolved = await resolveActiveRulesSnapshot();
  if (resolved.status === "error") {
    return adminApiError(409, resolved.issues.join("; "));
  }
  return NextResponse.json(
    {
      ok: true,
      data: resolved.status === "ok" ? resolved.snapshot : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
