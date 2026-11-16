import { NextResponse, type NextRequest } from "next/server";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
  requireAdminApi,
} from "@/lib/admin/api-auth";
import {
  createManagedRule,
  listManagedRules,
  managedRuleDraftInputSchema,
} from "@/lib/admin/managed-rules";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase();
  const rules = await listManagedRules();
  const data = rules.filter((rule) => {
    if (status && rule.status !== status) return false;
    if (q && !`${rule.id} ${rule.name} ${rule.description}`.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog.write");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = managedRuleDraftInputSchema.safeParse(body.value);
  if (!parsed.success) {
    return adminApiError(
      422,
      `Некорректное тело запроса: ${parsed.error.issues
        .map((item) => `${item.path.join(".")}: ${item.message}`)
        .join("; ")}`,
    );
  }

  try {
    const created = await createManagedRule(
      parsed.data,
      actorFromSession(guard.session),
    );
    return NextResponse.json(
      { ok: true, data: created },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
