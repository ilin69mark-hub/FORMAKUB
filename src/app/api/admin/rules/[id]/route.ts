import { NextResponse, type NextRequest } from "next/server";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
  requireAdminApi,
} from "@/lib/admin/api-auth";
import {
  getManagedRule,
  listRuleRevisions,
  managedRulePatchSchema,
  updateManagedRule,
} from "@/lib/admin/managed-rules";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const rule = await getManagedRule(id);
  if (!rule) return adminApiError(404, "Правило не найдено.");
  const revisions = await listRuleRevisions(id);
  return NextResponse.json(
    { ok: true, data: { rule, revisions } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminMutation(request, "catalog.write");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = managedRulePatchSchema.safeParse(body.value);
  if (!parsed.success) {
    return adminApiError(
      422,
      `Некорректное тело запроса: ${parsed.error.issues
        .map((item) => `${item.path.join(".")}: ${item.message}`)
        .join("; ")}`,
    );
  }

  const { id } = await context.params;
  try {
    const updated = await updateManagedRule(
      id,
      parsed.data,
      actorFromSession(guard.session),
    );
    return NextResponse.json(
      { ok: true, data: updated },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
