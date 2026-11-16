import { NextResponse, type NextRequest } from "next/server";

import { listParameters } from "@/lib/admin/parameters";
import { requireAdminApi } from "@/lib/admin/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const group = request.nextUrl.searchParams.get("group") ?? undefined;
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const data = await listParameters({
    ...(group ? { group } : {}),
    ...(status ? { status: status as never } : {}),
  });
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
