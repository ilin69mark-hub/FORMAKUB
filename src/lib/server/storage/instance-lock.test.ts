import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { INSTANCE_LOCK_FILE, InstanceLock, acquireAppInstanceLock } from "./instance-lock";

let dir = "";
let lockFile = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-lock-"));
  lockFile = path.join(dir, INSTANCE_LOCK_FILE);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readLock(): { pid: number; hostname: string; acquiredAt: string; heartbeatAt: string } {
  return JSON.parse(readFileSync(lockFile, "utf8"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("InstanceLock: захват и освобождение", () => {
  it("захват → второй захват отказывает; release → повторный захват проходит", () => {
    const first = new InstanceLock({ file: lockFile, heartbeatMs: 0 });
    const second = new InstanceLock({ file: lockFile, heartbeatMs: 0 });

    expect(first.acquire()).toBe(true);
    expect(first.isHeld).toBe(true);
    expect(existsSync(lockFile)).toBe(true);
    // Живой второй экземпляр не стартует.
    expect(second.acquire()).toBe(false);

    first.release();
    expect(existsSync(lockFile)).toBe(false);

    expect(second.acquire()).toBe(true);
    second.release();
  });

  it("release не удаляет чужой лок (после перехвата файлом другого процесса)", () => {
    const lock = new InstanceLock({ file: lockFile, heartbeatMs: 0 });
    expect(lock.acquire()).toBe(true);

    // Файл перехвачен другим процессом (наш heartbeat потерян).
    writeFileSync(
      lockFile,
      JSON.stringify({
        pid: 999999,
        hostname: "other-host",
        acquiredAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      }),
    );

    lock.release();
    // Чужой лок не удалён.
    expect(existsSync(lockFile)).toBe(true);
    expect(readLock().pid).toBe(999999);
  });

  it("heartbeat обновляет heartbeatAt своего лока", async () => {
    const lock = new InstanceLock({ file: lockFile, heartbeatMs: 25, ttlMs: 60_000 });
    expect(lock.acquire()).toBe(true);
    const before = readLock().heartbeatAt;

    await sleep(90);

    const after = readLock();
    expect(after.heartbeatAt > before).toBe(true);
    expect(after.pid).toBe(process.pid);
    expect(after.heartbeatAt >= after.acquiredAt).toBe(true);
    lock.release();
  });
});

describe("InstanceLock: аварийное завершение и восстановление", () => {
  it("живой чужой (свежий heartbeat в пределах ttl) → отказ, файл не трогается", () => {
    writeFileSync(
      lockFile,
      JSON.stringify({
        pid: 424242,
        hostname: "live-host",
        acquiredAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      }),
    );
    const before = readFileSync(lockFile, "utf8");
    const lock = new InstanceLock({ file: lockFile, ttlMs: 60_000, heartbeatMs: 0 });

    expect(lock.acquire()).toBe(false);
    expect(readFileSync(lockFile, "utf8")).toBe(before);
    expect(lock.isHeld).toBe(false);
  });

  it("реальное SIGKILL второго процесса → остаточный лок снимается по TTL (восстановление)", async () => {
    // Дочерний процесс: записывает лок с «прошлым» heartbeat и умирает по
    // SIGKILL без корректного завершения (аварийный сценарий R-03).
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const fs=require("fs");
         fs.writeFileSync(process.argv[1], JSON.stringify({
           pid: process.pid, hostname: "victim",
           acquiredAt: new Date(Date.now()-120000).toISOString(),
           heartbeatAt: new Date(Date.now()-120000).toISOString(),
         }));
         setInterval(()=>{},1000);`,
        lockFile,
      ],
      { stdio: "ignore" },
    );
    // Ждём появления лока (реальный запуск процесса).
    for (let i = 0; i < 100 && !existsSync(lockFile); i++) await sleep(20);
    expect(existsSync(lockFile)).toBe(true);

    child.kill("SIGKILL");
    await sleep(100); // завершение процесса

    // Остаточный лок: возраст heartbeat (120с) > ttl (50мс) → восстановление.
    const lock = new InstanceLock({ file: lockFile, ttlMs: 50, heartbeatMs: 0 });
    expect(lock.acquire()).toBe(true);
    expect(readLock().pid).toBe(process.pid);
    lock.release();
    expect(existsSync(lockFile)).toBe(false);
  });

  it("битый файл лока → восстановление перехвата", () => {
    writeFileSync(lockFile, "не json {", "utf8");
    const lock = new InstanceLock({ file: lockFile, ttlMs: 60_000, heartbeatMs: 0 });

    expect(lock.acquire()).toBe(true);
    expect(readLock().pid).toBe(process.pid);
    lock.release();
  });
});

describe("acquireAppInstanceLock (точка приложения)", () => {
  it("первый процесс получает лок; второй — исключение (не стартует)", () => {
    const first = acquireAppInstanceLock({ file: lockFile, heartbeatMs: 0 });
    expect(first.isHeld).toBe(true);

    expect(() => acquireAppInstanceLock({ file: lockFile, heartbeatMs: 0 })).toThrow(
      /второй экземпляр/,
    );

    first.release();
    const third = acquireAppInstanceLock({ file: lockFile, heartbeatMs: 0 });
    expect(third.isHeld).toBe(true);
    third.release();
  });

  it("последовательные захваты: ровно один владелец, release идемпотентен", () => {
    // Симуляция: два последовательных экземпляра без освобождения первого.
    const winner = new InstanceLock({ file: lockFile, heartbeatMs: 0 });
    const loser = new InstanceLock({ file: lockFile, heartbeatMs: 0 });
    expect([winner.acquire(), loser.acquire()]).toEqual([true, false]);
    winner.release();
    winner.release(); // идемпотентный повтор
    expect(existsSync(lockFile)).toBe(false);
    // Повторный цикл — без «прилипшего» состояния.
    expect(loser.acquire()).toBe(true);
    loser.release();
  });
});
