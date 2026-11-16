import { createHash } from "node:crypto";

import { canonicalJson } from "@/lib/server/operation-fingerprint";

import type { CompositionLine, CompositionPins } from "./composition-schema";

/**
 * Канонический contentHash состава: строки + снимок правил + коммерческие
 * пины. Функция вынесена отдельно, чтобы её могли использовать и сервис,
 * и publication journal без циклического импорта.
 */
export function compositionContentHash(
  lines: readonly CompositionLine[],
  rulesSnapshotId?: string,
  pins?: CompositionPins,
): string {
  const sorted = [...lines].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );
  return createHash("sha256")
    .update(
      canonicalJson({
        lines: sorted,
        rulesSnapshotId: rulesSnapshotId ?? null,
        ...(pins === undefined ? {} : { pins }),
      }),
      "utf8",
    )
    .digest("hex");
}
