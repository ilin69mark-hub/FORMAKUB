import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  readJsonBody,
  requireAdminApi,
} from "@/lib/admin/api-auth";
import {
  createProjectRecalculation,
  listProjectRecalculations,
} from "@/lib/admin/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.strictObject({
  batchId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  toPriceVersionId: z.string().trim().min(1),
  calcVersion: z.string().trim().min(1),
  deltaReason: z.enum(["price_publish", "manual"]),
  maxAttempts: z.number().int().positive().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const q = request.nextUrl.searchParams;
  const data = await listProjectRecalculations({
    ...(q.get("batchId") ? { batchId: q.get("batchId")! } : {}),
    ...(q.get("projectId") ? { projectId: q.get("projectId")! } : {}),
    ...(q.get("status") ? { status: q.get("status") as never } : {}),
  });
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "recalc.run");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = createSchema.safeParse(body.value);
  if (!parsed.success) return adminApiError(422, "Некорректное тело запроса.");

  const result = await createProjectRecalculation({
    ...parsed.data,
    createdBy: guard.session.actorId,
  });
  if (!result.ok) {
    const code = result.issues[0]?.code;
    return adminApiError(
      code === "BATCH_NOT_FOUND" ? 404 : code === "INVALID_INPUT" ? 422 : 409,
      result.issues.map((issue) => issue.message).join("; "),
    );
  }
  return NextResponse.json(
    { ok: true, data: result.value, created: result.created },
    { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
