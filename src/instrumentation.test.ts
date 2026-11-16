import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { INSTANCE_LOCK_FILE } from "@/lib/server/storage/instance-lock";
import {
  isRecalculationRuntimeWorkerRunning,
  stopRecalculationRuntimeWorker,
} from "@/lib/admin/worker";
import { register, resolveBackupIntervalMs } from "./instrumentation";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-instr-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveBackupIntervalMs (ADR-03: hourly в production)", () => {
  it("production: по умолчанию 3600000 мс; явное переопределение учитывается", () => {
    expect(resolveBackupIntervalMs("production", undefined)).toBe(3_600_000);
    expect(resolveBackupIntervalMs("production", "120000")).toBe(120_000);
    expect(resolveBackupIntervalMs("production", "0")).toBe(0); // явное выключение
    expect(resolveBackupIntervalMs("production", "мусор")).toBe(0);
  });

  it("вне production: по умолчанию выключено (0), явное значение — включено", () => {
    expect(resolveBackupIntervalMs("test", undefined)).toBe(0);
    expect(resolveBackupIntervalMs("development", undefined)).toBe(0);
    expect(resolveBackupIntervalMs("test", "5000")).toBe(5_000);
  });
});

describe("register(): защита второго экземпляра (R-03)", () => {
  it("живой чужой lock-файл → register() отказывает (сервис не стартует)", async () => {
    writeFileSync(
      path.join(dir, INSTANCE_LOCK_FILE),
      JSON.stringify({
        pid: 777777,
        hostname: "other",
        acquiredAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      }),
      "utf8",
    );

    await expect(register()).rejects.toThrow(/второй экземпляр/);
    // Чужой лок не тронут.
    expect(JSON.parse(readFileSync(path.join(dir, INSTANCE_LOCK_FILE), "utf8")).pid).toBe(777777);
  });

  it("register() запускает in-process runtime worker (CA-T-404)", async () => {
    process.env.FORMAKUB_RECALC_WORKER = "1";
    try {
      await register();
      expect(isRecalculationRuntimeWorkerRunning()).toBe(true);
    } finally {
      stopRecalculationRuntimeWorker();
      delete process.env.FORMAKUB_RECALC_WORKER;
    }
  });
});
