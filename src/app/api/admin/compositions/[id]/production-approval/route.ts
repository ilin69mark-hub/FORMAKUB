import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
} from "@/lib/admin/api-auth";
import {
  CompositionValidationError,
  approveCompositionProduction,
} from "@/lib/admin/composition";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  confirmed: z.boolean(),
  criteria: z.array(z.string().trim().min(1)).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminMutation(request, "price.publish", "composition.production_approve");
  if (!guard.ok) return guard.response;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) {
    return adminApiError(
      422,
      `Некорректное тело запроса: ${parsed.error.issues
        .map((item) => `${item.path.join(".")}: ${item.message}`)
        .join("; ")}`,
    );
  }
  if (!parsed.data.confirmed) {
    return adminApiError(409, "Production Gate требует явного подтверждения.");
  }
  const { id } = await context.params;
  try {
    const data = await approveCompositionProduction(
      id,
      {
        expectedVersion: parsed.data.expectedVersion,
        ...(parsed.data.criteria ? { criteria: parsed.data.criteria } : {}),
      },
      actorFromSession(guard.session),
    );
    return NextResponse.json(
      { ok: true, data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof CompositionValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message, issues: error.issues },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    return mutationErrorResponse(error);
  }
}
