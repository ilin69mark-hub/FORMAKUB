import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
} from "@/lib/admin/api-auth";
import { verifyCriticalConfirmation } from "@/lib/admin/confirmations";
import { archivePriceItem, getPriceItem } from "@/lib/admin/price-items";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  confirmed: z.boolean(),
  expectedVersion: z.string().trim().min(1),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminMutation(request, "price.write");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) return adminApiError(422, "Некорректное тело запроса.");

  const { id } = await context.params;
  const current = await getPriceItem(id);
  if (!current) return adminApiError(404, "Ставка не найдена.");

  const confirmation = verifyCriticalConfirmation({
    operation: "archive",
    confirmed: parsed.data.confirmed,
    expectedVersion: parsed.data.expectedVersion,
    currentVersion: current.updatedAt,
  });
  if (!confirmation.ok) {
    return adminApiError(confirmation.status, confirmation.message);
  }

  try {
    const data = await archivePriceItem(
      id,
      actorFromSession(guard.session),
      current.updatedAt,
    );
    return NextResponse.json(
      { ok: true, data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
