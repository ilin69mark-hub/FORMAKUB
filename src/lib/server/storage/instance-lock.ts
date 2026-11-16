import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { dataDir } from "./paths";

/**
 * Защита от запуска второго экземпляра (R-03: «lock-файл + heartbeat;
 * второй экземпляр без корректного завершения первого запрещён»;
 * CA-RISK-007; привязка плана — CA-T-608).
 *
 * Механика:
 *  - захват — атомарное создание файла `formakub.lock` (O_EXCL/`wx`);
 *  - heartbeat — периодическое обновление `heartbeatAt` владельцем;
 *  - живой чужой лок (возраст heartbeat ≤ ttl) → захват невозможен —
 *    второй экземпляр не стартует;
 *  - остаточный лок (аварийное завершение: возраст > ttl) либо битый
 *    файл → восстановление: перехват с предупреждением в журнал
 *    процесса (не молча);
 *  - корректное освобождение: `release()` удаляет только лок со своим
 *    pid; подключается к `exit`/`SIGTERM`/`SIGINT`.
 *
 * In-process блокировки Storage Adapter (один инстанс, R-03) остаются
 * без изменений — lock-файл закрывает межпроцессный уровень (два
 * процесса/инстанса приложения на одном каталоге данных).
 */

/** Файл блокировки по умолчанию — в каталоге данных (один инстанс = одна БД). */
export const INSTANCE_LOCK_FILE = "formakub.lock";

export interface InstanceLockRecord {
  pid: number;
  hostname: string;
  acquiredAt: string;
  heartbeatAt: string;
}

export interface InstanceLockOptions {
  /** Файл блокировки; по умолчанию `<dataDir>/formakub.lock`. */
  file?: string;
  /** Возраст heartbeat, после которого лок считается остаточным (авария). */
  ttlMs?: number;
  /** Период обновления heartbeat; 0 — без heartbeat (только тесты). */
  heartbeatMs?: number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 10_000;

export class InstanceLock {
  private readonly file: string;
  private readonly ttlMs: number;
  private readonly heartbeatMs: number;
  private timer: NodeJS.Timeout | undefined;
  private held = false;
  private acquiredAt: string | undefined;

  constructor(options: InstanceLockOptions = {}) {
    this.file = options.file ?? path.join(dataDir(), INSTANCE_LOCK_FILE);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  }

  get filePath(): string {
    return this.file;
  }

  get isHeld(): boolean {
    return this.held;
  }

  private record(): InstanceLockRecord {
    const now = new Date().toISOString();
    return { pid: process.pid, hostname: os.hostname(), acquiredAt: now, heartbeatAt: now };
  }

  private readRecord(): InstanceLockRecord | undefined {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as InstanceLockRecord;
    } catch {
      return undefined;
    }
  }

  private ageMs(record: InstanceLockRecord | undefined): number {
    const stamp = Date.parse(record?.heartbeatAt ?? record?.acquiredAt ?? "");
    return Number.isNaN(stamp) ? Infinity : Date.now() - stamp;
  }

  /**
   * Попытка захвата. `true` — лок наш (захвачен или восстановлен);
   * `false` — живой второй экземпляр, старт запрещён.
   */
  acquire(): boolean {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const mine = this.record();

    let fd: number;
    try {
      fd = openSync(this.file, "wx");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      const other = this.readRecord();
      const age = this.ageMs(other);
      if (other && age <= this.ttlMs) {
        // Живой чужой экземпляр (heartbeat свежий) — второй не стартует.
        return false;
      }
      // Остаточный лок после аварийного завершения либо битый файл →
      // восстановление перехвата (с предупреждением — не молча).
      writeFileSync(this.file, JSON.stringify(mine));
      this.held = true;
      this.acquiredAt = mine.acquiredAt;
      this.startHeartbeat();
      process.emitWarning(
        `InstanceLock: восстановлен остаточный лок "${this.file}" ` +
          `(возраст ${Number.isFinite(age) ? age : "не определён"} мс > ttl ${this.ttlMs} мс, ` +
          `предыдущий pid ${other?.pid ?? "неизвестен"}).`,
      );
      return true;
    }

    try {
      writeSync(fd, JSON.stringify(mine));
    } finally {
      closeSync(fd);
    }
    this.held = true;
    this.acquiredAt = mine.acquiredAt;
    this.startHeartbeat();
    return true;
  }

  /** Периодическое обновление `heartbeatAt` своим локом (межпроцессная видимость). */
  private startHeartbeat(): void {
    if (this.heartbeatMs <= 0) return;
    this.timer = setInterval(() => {
      if (!this.held) return;
      const current = this.readRecord();
      // Файл утерян или принадлежит другому — фиксируем только свой лок.
      if (!current || current.pid === process.pid) {
        const next: InstanceLockRecord = {
          pid: process.pid,
          hostname: os.hostname(),
          acquiredAt: current?.acquiredAt ?? this.acquiredAt ?? new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        };
        try {
          writeFileSync(this.file, JSON.stringify(next));
        } catch {
          // Каталог данных временно недоступен — следующий тик повторит.
        }
      }
    }, this.heartbeatMs);
    this.timer.unref?.();
  }

  /**
   * Корректное освобождение: удаляется только собственный лок; чужой
   * (перехваченный после сбоя нашего heartbeat) не трогается.
   */
  release(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (!this.held) return;
    this.held = false;
    this.acquiredAt = undefined;
    try {
      const current = this.readRecord();
      if (current && current.pid === process.pid && existsSync(this.file)) {
        unlinkSync(this.file);
      }
    } catch {
      // Остаточный файл будет восстановлен следующим экземпляром по TTL.
    }
  }

  /** Подключение к жизненному циклу процесса (exit/SIGTERM/SIGINT). */
  attachProcessHooks(): void {
    process.once("exit", () => this.release());
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        this.release();
        // Дальнейшую обработку сигнала выполняет существующий обработчик
        // приложения (Next); освобождение лока не отменяется.
      });
    }
  }
}

/**
 * Единая точка для приложения: захват лока процессом-инициатором.
 * При живом втором экземпляре — исключение (запуск невозможен, R-03).
 */
export function acquireAppInstanceLock(options: InstanceLockOptions = {}): InstanceLock {
  const lock = new InstanceLock(options);
  if (!lock.acquire()) {
    throw new Error(
      `Запуск отклонён: второй экземпляр приложения удерживает "${lock.filePath}" ` +
        "(R-03: один инстанс; дождитесь корректного завершения первого — лок освобождается при выходе, " +
        "остаточный лок снимается по истечении TTL).",
    );
  }
  lock.attachProcessHooks();
  return lock;
}
