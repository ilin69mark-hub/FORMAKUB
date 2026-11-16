import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
  requireAdminApi,
} from "@/lib/admin/api-auth";
import { listVersions } from "@/lib/admin/pricing";
import { createDraftPricingVersion } from "@/lib/admin/publish";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.strictObject({
  fromVersionId: z.string().trim().min(1),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const status = request.nextUrl.searchParams.get("status");
  const data = (await listVersions()).filter(
    (version) => status === null || version.status === status,
  );
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "price.write");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = createSchema.safeParse(body.value);
  if (!parsed.success) return adminApiError(422, "Некорректное тело запроса.");

  try {
    const data = await createDraftPricingVersion(
      parsed.data.fromVersionId,
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
