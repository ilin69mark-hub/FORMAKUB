import { NextResponse, type NextRequest } from "next/server";

import { adminApiError, requireAdminApi } from "@/lib/admin/api-auth";
import { resolveRulesSnapshotById } from "@/lib/admin/managed-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const resolved = await resolveRulesSnapshotById(id);
  if (resolved.status === "error") {
    return adminApiError(
      resolved.code === "unknown" ? 404 : 409,
      resolved.issues.join("; "),
    );
  }
  return NextResponse.json(
    { ok: true, data: resolved.status === "ok" ? resolved.snapshot : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
