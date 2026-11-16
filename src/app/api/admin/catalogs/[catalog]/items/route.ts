import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
  requireAdminApi,
} from "@/lib/admin/api-auth";
import { createCatalogItem, listCatalogItems } from "@/lib/admin/catalogs";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.record(z.string(), z.unknown());

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ catalog: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const status = request.nextUrl.searchParams.get("status");
  const { catalog } = await context.params;
  const data = await listCatalogItems(
    catalog,
    status === null ? {} : { status: status as never },
  );
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ catalog: string }> },
) {
  const guard = await guardAdminMutation(request, "catalog.write");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = createSchema.safeParse(body.value);
  if (!parsed.success) return adminApiError(422, "Некорректное тело запроса.");

  const { catalog } = await context.params;
  try {
    const data = await createCatalogItem(
      { ...parsed.data, catalog },
      actorFromSession(guard.session),
    );
    return NextResponse.json(
      { ok: true, data },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
