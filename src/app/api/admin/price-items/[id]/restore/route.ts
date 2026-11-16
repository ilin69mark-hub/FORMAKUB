import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
} from "@/lib/admin/api-auth";
import { getPriceItem, restorePriceItem } from "@/lib/admin/price-items";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  expectedUpdatedAt: z.string().trim().min(1),
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

  try {
    const data = await restorePriceItem(
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
