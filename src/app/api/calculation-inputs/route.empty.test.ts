import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/calculation-inputs/route";
import { defaultKitchen } from "@/lib/configurator/defaults";

let dir = "";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/calculation-inputs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-delivery-empty-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("CA-T-306C: fail-closed delivery", () => {
  it("отсутствующая PricingVersion/данные → 422, без fallback", async () => {
    const response = await POST(
      jsonRequest({ operation: "preview", config: defaultKitchen() }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      error: string;
      issues?: Array<{ code: string; path: string }>;
    };
    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.issues?.map((issue) => issue.code)).toContain(
      "ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE",
    );
    expect(body.issues?.map((issue) => issue.code)).toContain(
      "ENGINE_CONTRACT_MISSING_INPUT",
    );
  });

  it("несуществующий проект → 404", async () => {
    const response = await POST(
      jsonRequest({
        operation: "recalculate",
        projectId: "abcdefgh",
        expectedProjectCalcVersion: "calc-unknown",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("невалидный config не принимается", async () => {
    const response = await POST(
      jsonRequest({ operation: "preview", config: { kind: "kitchen" } }),
    );
    expect(response.status).toBe(422);
  });
});
