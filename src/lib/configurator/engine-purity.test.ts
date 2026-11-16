import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("CA-T-306D Phase 3A: architecture purity", () => {
  it("engine и adapter не импортируют content/Admin/Storage/FS", () => {
    for (const file of [
      "src/lib/configurator/engine.ts",
      "src/lib/configurator/display-adapter.ts",
      "src/lib/configurator/display-metadata.ts",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const forbidden of [
        "@/content",
        "@/lib/admin",
        "@/lib/server",
        "node:fs",
        "node:sqlite",
      ]) {
        expect(source, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("engine не использует compiled SINK_RULES и assertSinkRules", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/configurator/engine.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bSINK_RULES\b/);
    expect(source).not.toContain("assertSinkRules");
  });
});
