import { NextResponse } from "next/server";

import { getStorage } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Minimal readiness probe: storage is available and its primary metadata
 * collection is not corrupt. It does not expose paths or secrets.
 */
export async function GET() {
  const storage = getStorage();
  const read = await storage.readStatus("pricing-versions.json");
  if (read.status === "corrupt") {
    return NextResponse.json(
      { ok: false, storage: storage.kind, error: "storage_corrupt" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      storage: storage.kind,
      pricingVersions: read.status,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
