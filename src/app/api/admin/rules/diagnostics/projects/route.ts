import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin/api-auth";
import { diagnoseProjectRulesList } from "@/lib/admin/rules-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const data = await diagnoseProjectRulesList();
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
