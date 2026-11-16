import { NextResponse, type NextRequest } from "next/server";

import { requireAdminApi } from "@/lib/admin/api-auth";
import { listAuditEvents } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const q = request.nextUrl.searchParams;
  const data = await listAuditEvents({
    ...(q.get("action") ? { action: q.get("action") as never } : {}),
    ...(q.get("actor") ? { actorId: q.get("actor")! } : {}),
    ...(q.get("entityType") ? { entityType: q.get("entityType")! } : {}),
    ...(q.get("entityId") ? { entityId: q.get("entityId")! } : {}),
    ...(q.get("from") ? { from: q.get("from")! } : {}),
    ...(q.get("to") ? { to: q.get("to")! } : {}),
  });
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
