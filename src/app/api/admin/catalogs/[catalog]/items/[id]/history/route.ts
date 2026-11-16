import { NextResponse, type NextRequest } from "next/server";

import { requireAdminApi } from "@/lib/admin/api-auth";
import { listCatalogItemHistory } from "@/lib/admin/catalogs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ catalog: string; id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { catalog, id } = await context.params;
  const data = await listCatalogItemHistory(catalog, id);
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
