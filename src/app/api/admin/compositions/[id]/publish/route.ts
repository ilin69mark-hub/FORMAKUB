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
  getCompositionVersion,
  publishCompositionVersion,
} from "@/lib/admin/composition";
import { verifyCriticalConfirmation } from "@/lib/admin/confirmations";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  expectedStateVersion: z.string().trim().min(1),
  confirmed: z.boolean(),
  operationId: z.string().trim().min(1).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminMutation(request, "price.publish", "composition.publish");
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
  const { id } = await context.params;

  try {
    const current = await getCompositionVersion(id);
    if (!current) return adminApiError(404, "Версия состава не найдена.");
    const confirmation = verifyCriticalConfirmation({
      operation: "publish",
      confirmed: parsed.data.confirmed,
      expectedVersion: parsed.data.expectedStateVersion,
      currentVersion: `${current.id}@${current.version}`,
    });
    if (!confirmation.ok) {
      return adminApiError(confirmation.status, confirmation.message);
    }

    const data = await publishCompositionVersion(
      id,
      {
        expectedVersion: parsed.data.expectedVersion,
        ...(parsed.data.operationId
          ? { operationId: parsed.data.operationId }
          : {}),
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
        {
          ok: false,
          error: "Состав не прошёл проверку.",
          issues: error.issues,
        },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    return mutationErrorResponse(error);
  }
}
