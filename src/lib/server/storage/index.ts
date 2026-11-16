import { JsonFileStorage } from "./json-file-storage";
import { SqliteStorage } from "./sqlite-storage";
import type { StorageAdapter, StorageKind } from "./types";

export type { CollectionRead, StorageAdapter, StorageKind } from "./types";

const cache = new Map<StorageKind, StorageAdapter>();

/**
 * Выбор носителя (INFRA-SQLITE-001; ADR-01/R-12).
 *
 * - **production (`NODE_ENV=production`): только SQLite** — ADR-01:
 *   «SQLite — единственное основное хранилище». Отсутствие
 *   `FORMAKUB_STORAGE` включает SQLite (production не откатывается на JSON
 *   незаметно); любое иное значение — **явная ошибка запуска** (включая
 *   «json-file»: JSON допустим только вне production — тесты/миграция).
 * - Вне production: по умолчанию `json-file` (поведение разработки и
 *   тестов не меняется), `FORMAKUB_STORAGE=sqlite` — явное включение;
 *   неизвестное значение — ошибка, не «тихий» fallback.
 *
 * Функция чистая (тестируется без кэша адаптера).
 */
export function resolveStorageKind(
  nodeEnv: string | undefined,
  configured: string | undefined,
): StorageKind {
  const value = configured?.trim() || undefined;
  if (nodeEnv === "production") {
    if (value === undefined || value === "sqlite") return "sqlite";
    throw new Error(
      `Недопустимая конфигурация хранилища: FORMAKUB_STORAGE="${configured}" при NODE_ENV=production. ` +
        "ADR-01: SQLite — единственное основное хранилище; JSON допустим только вне production (тесты/миграция). " +
        "Приложение остановлено — тихий fallback на JSON исключён.",
    );
  }
  if (value === undefined || value === "json-file") return "json-file";
  if (value === "sqlite") return "sqlite";
  throw new Error(
    `Неизвестное значение FORMAKUB_STORAGE="${configured}" (допустимо: sqlite | json-file).`,
  );
}

/**
 * Активный носитель (CA-T-103, ADR-01; логика выбора — INFRA-SQLITE-001).
 *
 * Переключение — `FORMAKUB_STORAGE`; в production действует правило
 * resolveStorageKind выше. Работают одновременно только один носитель —
 * параллельных источников истины нет.
 */
export function getStorage(): StorageAdapter {
  const kind: StorageKind = resolveStorageKind(
    process.env.NODE_ENV,
    process.env.FORMAKUB_STORAGE,
  );
  const hit = cache.get(kind);
  if (hit) return hit;
  const created: StorageAdapter =
    kind === "sqlite" ? new SqliteStorage() : new JsonFileStorage();
  cache.set(kind, created);
  return created;
}
