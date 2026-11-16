import { NextResponse, type NextRequest } from "next/server";

import { requireAdminApi } from "@/lib/admin/api-auth";
import { listFormulas } from "@/lib/admin/formulas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const family = request.nextUrl.searchParams.get("family");
  const data = listFormulas().filter(
    (formula) => family === null || formula.family === family,
  );
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
