import { NextResponse, type NextRequest } from "next/server";

import {
  adminApiError,
  guardAdminMutation,
} from "@/lib/admin/api-auth";
import { retryProjectRecalculation } from "@/lib/admin/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminMutation(request, "recalc.run");
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await retryProjectRecalculation(id);
  if (!result.ok) {
    const code = result.issues[0]?.code;
    return adminApiError(
      code === "JOB_NOT_FOUND" ? 404 : 409,
      result.issues.map((issue) => issue.message).join("; "),
    );
  }
  return NextResponse.json(
    { ok: true, data: result.value },
    { headers: { "Cache-Control": "no-store" } },
  );
}
