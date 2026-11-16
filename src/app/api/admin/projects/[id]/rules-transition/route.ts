import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  adminApiError,
  guardAdminMutation,
  readJsonBody,
} from "@/lib/admin/api-auth";
import { verifyCriticalConfirmation } from "@/lib/admin/confirmations";
import { transitionProjectRulesSnapshot } from "@/lib/admin/project-rules-transition";
import { actorFromSession } from "@/lib/auth/session";
import { getProject } from "@/lib/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  targetRulesSnapshotId: z.string().trim().min(1),
  expectedVersion: z.string().trim().min(1),
  operationId: z.string().trim().min(1),
  confirmed: z.boolean(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminMutation(request, "recalc.run");
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
  const project = await getProject(id);
  if (project.status === "not_found") return adminApiError(404, "Проект не найден.");
  if (project.status === "quarantined") return adminApiError(409, project.reason);
  if (project.status === "unsupported") return adminApiError(422, project.reason);

  const confirmation = verifyCriticalConfirmation({
    operation: "recalc",
    confirmed: parsed.data.confirmed,
    expectedVersion: parsed.data.expectedVersion,
    currentVersion: project.project.updatedAt,
  });
  if (!confirmation.ok) {
    return adminApiError(confirmation.status, confirmation.message);
  }

  const result = await transitionProjectRulesSnapshot({
    projectId: id,
    targetRulesSnapshotId: parsed.data.targetRulesSnapshotId,
    expectedVersion: parsed.data.expectedVersion,
    operationId: parsed.data.operationId,
    actor: actorFromSession(guard.session),
  });

  if (!result.ok) {
    return adminApiError(
      result.status,
      result.issues.map((item) => `${item.code}: ${item.message}`).join("; "),
    );
  }

  return NextResponse.json(
    { ok: true, data: result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
