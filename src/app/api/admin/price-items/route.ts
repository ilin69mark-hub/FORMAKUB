import { NextResponse, type NextRequest } from "next/server";

import { requireAdminApi } from "@/lib/admin/api-auth";
import { listPriceItems } from "@/lib/admin/price-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const q = request.nextUrl.searchParams;
  const data = await listPriceItems({
    ...(q.get("scope") ? { scope: q.get("scope") as never } : {}),
    ...(q.get("usage") ? { usage: q.get("usage") as never } : {}),
    ...(q.get("status") ? { status: q.get("status") as never } : {}),
  });
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
