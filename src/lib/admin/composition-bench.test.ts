import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, it } from "vitest";

import { compositionContentHash } from "./composition-hash";
import type { CompositionLine, CompositionVersion } from "./composition-schema";
import {
  getCompositionVersion,
  listCompositionVersions,
  validateCompositionVersion,
} from "./composition";
import { getCompositionBoard } from "./composition-board";
import { updateCollection } from "@/lib/server/store";

let dir = "";
const types = ["base", "sink", "hob", "drawers", "wall", "tall", "oven", "bottle"] as const;

function lines(): CompositionLine[] {
  return types.map((moduleType, i) => ({
    id: `l-${moduleType}`,
    moduleType,
    componentCatalog: "bodyMaterial",
    relation: "required",
    quantityRef: { kind: "code", implementationId: "calculateKitchenBreakdown" },
    sourceRef: "bench",
    source: "datasheet",
    sortOrder: i,
  }));
}

function version(index: number, status: "published" | "superseded"): CompositionVersion {
  const ls = lines();
  const now = "2026-11-16T00:00:00.000Z";
  return {
    id: `composition-bench-${index}`,
    schemaVersion: 1,
    status,
    version: 1,
    lines: ls,
    contentHash: compositionContentHash(ls),
    createdAt: now,
    createdBy: "bench",
    updatedAt: now,
    updatedBy: "bench",
    ...(status === "published"
      ? { publishedAt: now, publishedBy: "bench", publishedSeq: 1 }
      : { publishedAt: now, publishedBy: "bench", publishedSeq: 1, supersededAt: now }),
  };
}

async function seed(count: number) {
  const items = Array.from({ length: count }, (_, i) =>
    version(i, i === 0 ? "published" : "superseded"),
  );
  await updateCollection<CompositionVersion, void>("composition-versions.json", () => ({
    items,
    result: undefined,
  }));
}

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-comp-bench-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
});
afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("composition benchmark", () => {
  it("measures 100/500/1000", async () => {
    for (const count of [100, 500, 1000]) {
      await seed(count);
      let t = performance.now();
      const all = await listCompositionVersions();
      const listMs = performance.now() - t;
      t = performance.now();
      await getCompositionVersion("composition-bench-0");
      const oneMs = performance.now() - t;
      const published = all.find((item) => item.status === "published")!;
      t = performance.now();
      await validateCompositionVersion(published);
      const validateMs = performance.now() - t;
      t = performance.now();
      await getCompositionBoard();
      const boardMs = performance.now() - t;
      console.info(
        `[composition-bench] n=${count} list=${listMs.toFixed(1)}ms one=${oneMs.toFixed(1)}ms validate=${validateMs.toFixed(1)}ms board=${boardMs.toFixed(1)}ms`,
      );
    }
  });
});
