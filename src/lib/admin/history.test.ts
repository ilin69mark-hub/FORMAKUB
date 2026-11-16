import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultKitchen } from "@/lib/configurator/defaults";
import { calculatePrice } from "@/lib/configurator/pricing";

import {
  getProjectPriceHistoryEvent,
  listProjectPriceHistory,
  readHistoryBreakdownV1,
} from "./history";

let dir = "";
const T = "2026-11-10T00:00:00.000Z";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-history-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeProject(breakdownVersion = 1) {
  const config = defaultKitchen();
  const breakdown = calculatePrice(config);
  writeFileSync(
    path.join(dir, "projects.json"),
    JSON.stringify([
      {
        id: "abcdefgh",
        config,
        schemaVersion: 1,
        calcVersion: "calc-2026.11.0",
        priceVersion: "price-1",
        price: breakdown,
        priceHistory: [
          {
            id: "hist-1",
            projectId: "abcdefgh",
            operationId: "op-1",
            reason: "create",
            fromPriceVersionId: null,
            toPriceVersionId: "price-1",
            schemaVersion: 1,
            calcVersion: "calc-2026.11.0",
            oldPrice: null,
            newPrice: breakdown.total,
            delta: null,
            breakdown,
            breakdownVersion,
            requestFingerprint: "a".repeat(64),
            requestFingerprintVersion: "sha256-canonical-json-v1",
            computedAt: T,
          },
        ],
        createdAt: T,
        updatedAt: T,
      },
    ]),
    "utf8",
  );
}

describe("CA-T-406: reader истории", () => {
  it("читает историю проекта без изменения файла", async () => {
    writeProject();
    const before = readFileSync(path.join(dir, "projects.json"), "utf8");
    const result = await listProjectPriceHistory("abcdefgh");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.id).toBe("hist-1");
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(before);
  });

  it("находит событие по id и сообщает об отсутствии", async () => {
    writeProject();
    const found = await getProjectPriceHistoryEvent("abcdefgh", "hist-1");
    expect(found.ok).toBe(true);
    const missing = await getProjectPriceHistoryEvent("abcdefgh", "hist-2");
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.code).toBe("HISTORY_EVENT_NOT_FOUND");
  });

  it("читает breakdownVersion=1 и отклоняет неизвестную версию", async () => {
    writeProject();
    const history = await listProjectPriceHistory("abcdefgh");
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    const v1 = readHistoryBreakdownV1(history.value[0]!);
    expect(v1.ok).toBe(true);

    const unsupported = readHistoryBreakdownV1({
      breakdown: history.value[0]!.breakdown,
      breakdownVersion: 2,
    });
    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) return;
    expect(unsupported.code).toBe("BREAKDOWN_VERSION_UNSUPPORTED");
    expect(unsupported.raw).toBeDefined();
  });

  it("отклоняет невалидный breakdown", () => {
    const result = readHistoryBreakdownV1({
      breakdown: { total: 1 } as never,
      breakdownVersion: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("BREAKDOWN_INVALID");
  });
});
