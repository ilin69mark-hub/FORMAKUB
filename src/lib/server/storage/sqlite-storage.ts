import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { dataDir } from "./paths";
import type { CollectionRead, StorageAdapter, UpdateOutcome } from "./types";

const DB_FILE = "formakub.db";
const META_MIGRATED = "json_migrated";

/**
 * SQLite — целевой носитель ADR-01 (CA-T-103).
 *
 * Одна БД — один файл в каталоге данных; коллекции хранятся как JSON-массивы
 * записей (совместимость со структурой существующих проектов), транзакции —
 * SQL (`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`). Контролируемый переход:
 * при первом открытии свежей БД все `data/*.json` переносятся одной
 * транзакцией; при любой ошибке — отмена без изменения файлов; после успеха
 * исходные файлы переименовываются в `*.migrated-*` и больше не читаются
 * (JSON и SQLite не становятся параллельными источниками истины).
 */
export class SqliteStorage implements StorageAdapter {
  readonly kind = "sqlite" as const;

  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly dbs = new Map<string, DatabaseSync>();

  location(): string {
    return path.join(dataDir(), DB_FILE);
  }

  async readStatus<T>(file: string): Promise<CollectionRead<T>> {
    const db = this.db();
    const row = db
      .prepare("SELECT payload FROM collection_state WHERE collection = ?")
      .get(file) as { payload: string } | undefined;
    if (!row) return { status: "missing" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch (error) {
      return {
        status: "corrupt",
        reason: `некорректный JSON (${(error as Error).message})`,
      };
    }
    if (!Array.isArray(parsed)) {
      return { status: "corrupt", reason: "ожидался массив записей" };
    }
    return { status: "ok", items: parsed as T[] };
  }

  async read<T>(file: string): Promise<T[]> {
    const read = await this.readStatus<T>(file);
    if (read.status === "missing") return [];
    if (read.status === "corrupt") {
      throw new Error(`Хранилище ${file} повреждено: ${read.reason}.`);
    }
    return read.items;
  }

  async withLock<T>(file: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(file) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.locks.set(
      file,
      next.catch(() => undefined),
    );
    try {
      return await next;
    } finally {
      if (this.locks.get(file) === next) this.locks.delete(file);
    }
  }

  async update<T, R>(
    file: string,
    task: (items: T[]) => UpdateOutcome<T, R> | Promise<UpdateOutcome<T, R>>,
  ): Promise<R> {
    return this.withLock(file, async () => {
      const items = await this.read<T>(file);
      const { items: nextItems, result } = await task(items);
      this.writeCollection(file, nextItems);
      return result;
    });
  }

  /** Открытие (один раз на каталог данных) + контролируемый переход с JSON. */
  private db(): DatabaseSync {
    const dir = dataDir();
    const file = path.join(dir, DB_FILE);
    let db = this.dbs.get(file);
    if (!db) {
      // turbopackIgnore: каталог данных задан статически (data/), переопределяется
      // только тестами — сборка не должна трассировать весь проект.
      mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
      db = new DatabaseSync(file);
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA foreign_keys = ON;");
      db.exec(
        `CREATE TABLE IF NOT EXISTS collection_state (
           collection TEXT PRIMARY KEY,
           payload    TEXT NOT NULL,
           updated_at TEXT NOT NULL
         )`,
      );
      db.exec(
        `CREATE TABLE IF NOT EXISTS storage_meta (
           key   TEXT PRIMARY KEY,
           value TEXT NOT NULL
         )`,
      );
      this.dbs.set(file, db);
    }

    // Признак миграции проверяется при каждом обращении: если переход был
    // отменён (повреждённый JSON), следующая операция снова его пытается —
    // чтение не «умолкает» с пустой БД.
    const migrated = db
      .prepare("SELECT value FROM storage_meta WHERE key = ?")
      .get(META_MIGRATED) as { value: string } | undefined;
    if (!migrated) this.migrateJson(db, dir);
    return db;
  }

  /**
   * Контролируемый переход JSON → SQLite (ADR-01, п. 7): сначала чтение всех
   * файлов (ошибка → отмена, файлы не изменяются), затем одна транзакция
   * «данные + признак миграции», в конце — исходные файлы убираются из
   * обращения (переименование; данные сохраняются).
   */
  private migrateJson(db: DatabaseSync, dir: string): void {
    let files: string[];
    try {
      // turbopackIgnore: см. db() — каталог данных статичен для сборки.
      files = readdirSync(/* turbopackIgnore: true */ dir).filter((name) =>
        name.endsWith(".json"),
      );
    } catch (error) {
      throw this.migrationError(error);
    }
    if (files.length === 0) {
      this.markMigrated(db);
      return;
    }

    const payloads: Array<{ file: string; payload: string }> = [];
    for (const name of files) {
      try {
        const raw = readFileSync(
          /* turbopackIgnore: true */ path.join(dir, name),
          "utf8",
        );
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          throw new Error("ожидался массив записей");
        }
        payloads.push({ file: name, payload: JSON.stringify(parsed) });
      } catch (error) {
        throw this.migrationError(error, name);
      }
    }

    try {
      db.exec("BEGIN IMMEDIATE");
      const insert = db.prepare(
        "INSERT OR REPLACE INTO collection_state (collection, payload, updated_at) VALUES (?, ?, ?)",
      );
      const now = new Date().toISOString();
      for (const { file, payload } of payloads) {
        insert.run(file, payload, now);
      }
      this.markMigrated(db);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // откат уже выполнен транзакцией СУБД
      }
      throw this.migrationError(error);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const { file } of payloads) {
      try {
        // turbopackIgnore: см. db().
        renameSync(
          /* turbopackIgnore: true */ path.join(dir, file),
          /* turbopackIgnore: true */ path.join(dir, `${file}.migrated-${stamp}`),
        );
      } catch {
        // Данные уже в БД и помечены мигрированными: сбой переименования не
        // делает JSON источником истины — файл просто остаётся как артефакт.
      }
    }
  }

  private markMigrated(db: DatabaseSync): void {
    db.prepare(
      "INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)",
    ).run(META_MIGRATED, new Date().toISOString());
  }

  private migrationError(error: unknown, file?: string): Error {
    const detail = file ? `${file}: ${(error as Error).message}` : (error as Error).message;
    return new Error(
      `Миграция JSON → SQLite отменена: ${detail}. Файлы данных не изменены.`,
    );
  }

  /**
   * CA-T-306A: атомарная запись нескольких коллекций одной SQLite-транзакцией.
   * Используется только bootstrap-apply; обычные операции остаются на update().
   */
  applyBatch(entries: Array<{ file: string; items: unknown[] }>): void {
    const db = this.db();
    try {
      db.exec("BEGIN IMMEDIATE");
      const insert = db.prepare(
        "INSERT OR REPLACE INTO collection_state (collection, payload, updated_at) VALUES (?, ?, ?)",
      );
      const now = new Date().toISOString();
      for (const entry of entries) {
        insert.run(entry.file, JSON.stringify(entry.items), now);
      }
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // откат уже выполнен транзакцией СУБД
      }
      throw error;
    }
  }

  private writeCollection<T>(file: string, items: T[]): void {
    const db = this.db();
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(
        "INSERT OR REPLACE INTO collection_state (collection, payload, updated_at) VALUES (?, ?, ?)",
      ).run(file, JSON.stringify(items), new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // откат уже выполнен транзакцией СУБД
      }
      throw error;
    }
  }
}
