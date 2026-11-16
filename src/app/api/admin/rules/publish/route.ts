import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
} from "@/lib/admin/api-auth";
import { verifyCriticalConfirmation } from "@/lib/admin/confirmations";
import {
  publishRulesSnapshot,
  resolveActiveRulesSnapshot,
} from "@/lib/admin/managed-rules";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  selection: z
    .array(
      z.strictObject({
        id: z.string().trim().min(1),
        expectedVersion: z.string().trim().min(1),
      }),
    )
    .min(1),
  confirmed: z.boolean(),
  expectedStateVersion: z.string().trim().min(1),
  operationId: z.string().trim().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "price.publish");
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

  const active = await resolveActiveRulesSnapshot();
  const currentVersion = active.status === "ok" ? active.snapshot.id : "none";
  const confirmation = verifyCriticalConfirmation({
    operation: "publish",
    confirmed: parsed.data.confirmed,
    expectedVersion: parsed.data.expectedStateVersion,
    currentVersion,
  });
  if (!confirmation.ok) {
    return adminApiError(confirmation.status, confirmation.message);
  }

  try {
    const data = await publishRulesSnapshot(
      parsed.data.selection,
      actorFromSession(guard.session),
      parsed.data.operationId ? { operationId: parsed.data.operationId } : {},
    );
    return NextResponse.json(
      { ok: true, data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
