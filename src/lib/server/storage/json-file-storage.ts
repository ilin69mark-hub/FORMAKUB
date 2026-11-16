import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import { collectionPath, dataDir } from "./paths";
import type { CollectionRead, StorageAdapter, UpdateOutcome } from "./types";

/**
 * JSON-файлы `data/*.json` — носитель, действующий до активации SQLite
 * (ADR-01, контролируемый переход). Поведение в точности повторяет прежний
 * `store.ts` (CA-T-103 — «без изменения поведения»).
 */
export class JsonFileStorage implements StorageAdapter {
  readonly kind = "json-file" as const;

  private readonly locks = new Map<string, Promise<unknown>>();

  location(file: string): string {
    return collectionPath(file);
  }

  async readStatus<T>(file: string): Promise<CollectionRead<T>> {
    let raw: string;
    try {
      // turbopackIgnore: путь собирается через collectionPath() — каталог данных
      // задан статически (data/), переопределяется только тестами.
      raw = await readFile(/* turbopackIgnore: true */ collectionPath(file), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { status: "missing" };
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
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
      await this.writeCollection(file, nextItems);
      return result;
    });
  }

  private async writeCollection<T>(file: string, items: T[]): Promise<void> {
    await mkdir(dataDir(), { recursive: true });
    const target = collectionPath(file);
    const temp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temp, JSON.stringify(items, null, 2), "utf8");
    await rename(temp, target);
  }
}
