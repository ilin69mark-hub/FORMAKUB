import { NextResponse } from "next/server";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
} from "@/lib/admin/api-auth";
import {
  importManagedRulesSeed,
  ManagedRulesSeedConflictError,
  managedRulesSeedSpecs,
} from "@/lib/admin/managed-rules-seed";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await guardAdminMutation(
    request as Parameters<typeof guardAdminMutation>[0],
    "catalog.write",
  );
  if (!guard.ok) return guard.response;

  try {
    const data = await importManagedRulesSeed(actorFromSession(guard.session));
    return NextResponse.json(
      {
        ok: true,
        data: { ...data, expected: managedRulesSeedSpecs().length },
      },
      { status: data.created.length > 0 ? 201 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ManagedRulesSeedConflictError) {
      return adminApiError(409, error.message);
    }
    return mutationErrorResponse(error);
  }
}
