import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { calculatePrice } from "./pricing";
import { GOLDEN_SCENARIOS } from "./golden.fixtures";
describe("regen", () => {
  it("writes new golden", () => {
    const out: Record<string, unknown> = {};
    for (const s of GOLDEN_SCENARIOS) out[s.name] = calculatePrice(s.config);
    writeFileSync(process.env.TMPDIR + "/new-golden.json", JSON.stringify(out, null, 2));
  });
});
