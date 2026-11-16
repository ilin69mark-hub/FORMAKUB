import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
  requireAdminApi,
} from "@/lib/admin/api-auth";
import { getPriceItem, updateDraftPriceAmount, updatePriceItem } from "@/lib/admin/price-items";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.strictObject({
  label: z.string().trim().min(1).optional(),
  unit: z
    .enum([
      "RUB",
      "RUB_PER_SQM",
      "RUB_PER_M",
      "RUB_PER_LINM",
      "RUB_PER_PCS",
      "FACTOR",
    ])
    .optional(),
  groupId: z.string().trim().min(1).optional(),
  expectedUpdatedAt: z.string().trim().min(1).optional(),
  amount: z.number().finite().nonnegative().optional(),
  expectedAmount: z.number().finite().nonnegative().optional(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const item = await getPriceItem(id);
  if (!item) return adminApiError(404, "Ставка не найдена.");
  return NextResponse.json(
    { ok: true, data: item },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminMutation(request, "price.write");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = patchSchema.safeParse(body.value);
  if (!parsed.success) return adminApiError(422, "Некорректное тело запроса.");

  const { id } = await context.params;
  try {
    if (parsed.data.amount !== undefined) {
      if (
        parsed.data.label !== undefined ||
        parsed.data.unit !== undefined ||
        parsed.data.groupId !== undefined ||
        parsed.data.expectedUpdatedAt !== undefined
      ) {
        return adminApiError(
          422,
          "Правка amount и метаданных должна выполняться отдельными запросами.",
        );
      }
      if (parsed.data.expectedAmount === undefined) {
        return adminApiError(422, "Для правки amount обязателен expectedAmount.");
      }
      const data = await updateDraftPriceAmount(
        id,
        { amount: parsed.data.amount, expectedAmount: parsed.data.expectedAmount },
        actorFromSession(guard.session),
      );
      return NextResponse.json(
        { ok: true, data },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!parsed.data.expectedUpdatedAt) {
      return adminApiError(422, "Для правки метаданных обязателен expectedUpdatedAt.");
    }
    const patch = {
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      ...(parsed.data.unit !== undefined ? { unit: parsed.data.unit } : {}),
      ...(parsed.data.groupId !== undefined ? { groupId: parsed.data.groupId } : {}),
    };
    const data = await updatePriceItem(
      id,
      patch,
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
