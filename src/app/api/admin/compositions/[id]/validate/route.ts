import { NextResponse, type NextRequest } from "next/server";

import { adminApiError, requireAdminApi } from "@/lib/admin/api-auth";
import {
  getCompositionVersion,
  validateCompositionVersion,
} from "@/lib/admin/composition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const version = await getCompositionVersion(id);
  if (!version) return adminApiError(404, "Версия состава не найдена.");
  const data = await validateCompositionVersion(version);
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
