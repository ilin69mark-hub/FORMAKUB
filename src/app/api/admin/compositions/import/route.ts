import { NextResponse, type NextRequest } from "next/server";

import {
  guardAdminMutation,
  mutationErrorResponse,
} from "@/lib/admin/api-auth";
import { seedInitialCompositionDraft } from "@/lib/admin/composition-seed";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog.write", "composition.create");
  if (!guard.ok) return guard.response;
  try {
    const data = await seedInitialCompositionDraft(
      actorFromSession(guard.session),
    );
    return NextResponse.json(
      { ok: true, data },
      { status: data.created ? 201 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
