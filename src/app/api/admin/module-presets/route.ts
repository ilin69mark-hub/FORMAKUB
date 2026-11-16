import { NextResponse, type NextRequest } from "next/server";

import { requireAdminApi } from "@/lib/admin/api-auth";
import { listModulePresets } from "@/lib/admin/presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const family = request.nextUrl.searchParams.get("family");
  const data = await listModulePresets(
    family === null ? {} : { family },
  );
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
