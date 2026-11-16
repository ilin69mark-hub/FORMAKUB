import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
  requireAdminApi,
} from "@/lib/admin/api-auth";
import { getModulePreset, updateModulePreset } from "@/lib/admin/presets";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dimsSchema = z.strictObject({
  min: z.number().finite(),
  max: z.number().finite(),
  default: z.number().finite(),
});

const patchSchema = z.strictObject({
  expectedVersion: z.string().trim().min(1),
  width: dimsSchema.optional(),
  height: dimsSchema.optional(),
  depth: dimsSchema.optional(),
  defaultShelves: z.number().int().optional(),
  defaultDrawers: z.number().int().optional(),
  zone: z.string().trim().min(1).optional(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ family: string; id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { family, id } = await context.params;
  const preset = await getModulePreset(family, id);
  if (!preset) return adminApiError(404, "Пресет не найден.");
  return NextResponse.json(
    { ok: true, data: preset },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ family: string; id: string }> },
) {
  const guard = await guardAdminMutation(request, "catalog.write");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = patchSchema.safeParse(body.value);
  if (!parsed.success) return adminApiError(422, "Некорректное тело запроса.");

  const { family, id } = await context.params;
  try {
    const data = await updateModulePreset(
      family,
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
