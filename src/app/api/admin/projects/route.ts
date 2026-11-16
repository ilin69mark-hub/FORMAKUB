import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin/api-auth";
import type { StoredProject } from "@/lib/configurator/types";
import { readCollection } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const projects = await readCollection<StoredProject>("projects.json");
  const data = projects.map((project) => ({
    id: project.id,
    kind: project.config.kind,
    priceVersion: project.priceVersion ?? null,
    calcVersion: project.calcVersion ?? null,
    compositionVersionId: project.compositionVersionId ?? null,
    total: project.price.total,
    updatedAt: project.updatedAt,
  }));
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
