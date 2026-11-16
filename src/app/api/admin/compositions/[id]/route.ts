import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
  requireAdminApi,
} from "@/lib/admin/api-auth";
import {
  deleteCompositionDraft,
  getCompositionVersion,
  updateCompositionDraft,
  validateCompositionVersion,
} from "@/lib/admin/composition";
import { compositionLineSchema } from "@/lib/admin/composition-schema";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  lines: z.array(compositionLineSchema).optional(),
  notes: z.string().trim().min(1).optional(),
});

const deleteSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const version = await getCompositionVersion(id);
  if (!version) return adminApiError(404, "Версия состава не найдена.");
  const validation = await validateCompositionVersion(version);
  return NextResponse.json(
    { ok: true, data: { version, validation } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminMutation(request, "catalog.write", "composition.update");
  if (!guard.ok) return guard.response;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = patchSchema.safeParse(body.value);
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
    const data = await updateCompositionDraft(
      id,
      parsed.data,
      actorFromSession(guard.session),
    );
    return NextResponse.json(
      { ok: true, data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mutationErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminMutation(request, "catalog.write", "composition.delete");
  if (!guard.ok) return guard.response;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = deleteSchema.safeParse(body.value);
  if (!parsed.success) return adminApiError(422, "Некорректное тело запроса.");
  const { id } = await context.params;
  const current = await getCompositionVersion(id);
  if (!current) return adminApiError(404, "Версия состава не найдена.");
  if (current.version !== parsed.data.expectedVersion) {
    return adminApiError(409, "Конфликт версии состава.");
  }
  try {
    await deleteCompositionDraft(
      id,
      parsed.data.expectedVersion,
      actorFromSession(guard.session),
    );
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
