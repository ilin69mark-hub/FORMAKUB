import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin/api-auth";
import { diffDraftWithPublished } from "@/lib/admin/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const result = await diffDraftWithPublished();
  if (result.status !== "ok") {
    return NextResponse.json(
      { ok: false, status: result.status },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: true, data: result.diff },
    { headers: { "Cache-Control": "no-store" } },
  );
}
