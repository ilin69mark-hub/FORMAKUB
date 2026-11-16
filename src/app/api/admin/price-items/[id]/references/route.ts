import { NextResponse, type NextRequest } from "next/server";

import { requireAdminApi } from "@/lib/admin/api-auth";
import { listPriceItemReferences } from "@/lib/admin/price-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const data = await listPriceItemReferences(id);
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
