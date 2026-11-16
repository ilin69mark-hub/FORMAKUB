import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  mutationErrorResponse,
  readJsonBody,
} from "@/lib/admin/api-auth";
import { transitionProjectComposition } from "@/lib/admin/composition-transition";
import { projectIdSchema } from "@/lib/configurator/schema";
import { actorFromSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  compositionVersionId: z.string().trim().min(1),
  expectedUpdatedAt: z.string().trim().min(1),
  confirmed: z.boolean(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminMutation(request, "recalc.run", "project.composition_transition");
  if (!guard.ok) return guard.response;

  const operationId = request.headers.get("idempotency-key")?.trim();
  if (!operationId) {
    return adminApiError(400, "Заголовок Idempotency-Key обязателен.");
  }
  const { id } = await context.params;
  const parsedId = projectIdSchema.safeParse(id);
  if (!parsedId.success) return adminApiError(404, "Проект не найден.");

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
    return adminApiError(409, "Закрепление состава требует явного подтверждения.");
  }

  try {
    const result = await transitionProjectComposition({
      projectId: parsedId.data,
      compositionVersionId: parsed.data.compositionVersionId,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      operationId,
      actor: actorFromSession(guard.session),
    });
    if (!result.ok) {
      return adminApiError(result.status, `${result.code}: ${result.message}`);
    }
    return NextResponse.json(
      { ok: true, data: result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
