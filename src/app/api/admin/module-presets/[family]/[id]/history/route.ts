import { NextResponse, type NextRequest } from "next/server";

import { requireAdminApi } from "@/lib/admin/api-auth";
import { listModulePresetHistory } from "@/lib/admin/presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ family: string; id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { family, id } = await context.params;
  const data = await listModulePresetHistory(family, id);
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
