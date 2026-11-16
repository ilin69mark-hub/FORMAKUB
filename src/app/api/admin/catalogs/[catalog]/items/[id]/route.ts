import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
  requireAdminApi,
} from "@/lib/admin/api-auth";
import { getCatalogItem, updateCatalogItem } from "@/lib/admin/catalogs";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.strictObject({
  expectedVersion: z.string().trim().min(1),
  attrs: z.record(z.string(), z.unknown()).optional(),
  label: z.string().trim().min(1).optional(),
  sortOrder: z.number().finite().optional(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ catalog: string; id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { catalog, id } = await context.params;
  const item = await getCatalogItem(catalog, id);
  if (!item) return adminApiError(404, "Элемент справочника не найден.");
  return NextResponse.json(
    { ok: true, data: item },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ catalog: string; id: string }> },
) {
  const guard = await guardAdminMutation(request, "catalog.write");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = patchSchema.safeParse(body.value);
  if (!parsed.success) return adminApiError(422, "Некорректное тело запроса.");

  const { catalog, id } = await context.params;
  try {
    const data = await updateCatalogItem(
      catalog,
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
