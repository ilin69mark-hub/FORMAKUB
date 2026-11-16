import { NextResponse, type NextRequest } from "next/server";

import { guardAdminMutation } from "@/lib/admin/api-auth";
import { validateDraftVersion } from "@/lib/admin/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminMutation(request, "price.write");
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const data = await validateDraftVersion(id);
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
