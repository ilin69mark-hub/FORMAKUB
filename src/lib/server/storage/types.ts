/**
 * Единый интерфейс физического хранилища (CA-T-103, ADR-01).
 *
 * Бизнес-код (`projects.ts`, `leads.ts`) обращается к данным только через
 * этот контракт и не знает, используется JSON-файл или SQLite. Существующие
 * контракты чтения/записи (карантин, исключение на пути записи, замок)
 * сохранены без изменений.
 */
export type CollectionRead<T> =
  | { status: "ok"; items: T[] }
  | { status: "missing" }
  | { status: "corrupt"; reason: string };

export type UpdateOutcome<T, R> = { items: T[]; result: R };

export type StorageKind = "json-file" | "sqlite";

export interface StorageAdapter {
  /** Физический носитель. */
  readonly kind: StorageKind;

  /** Безопасное чтение: повреждённые данные квартируются, а не роняют чтение. */
  readStatus<T>(collection: string): Promise<CollectionRead<T>>;

  /** Чтение для пути записи: `missing` → `[]`, `corrupt` → исключение. */
  read<T>(collection: string): Promise<T[]>;

  /**
   * Атомарное «прочесть → изменить → записать» под замком коллекции;
   * транзакционная целостность обеспечивается носителем (SQLite — SQL-транзакция).
   */
  update<T, R>(
    collection: string,
    task: (
      items: T[],
    ) => UpdateOutcome<T, R> | Promise<UpdateOutcome<T, R>>,
  ): Promise<R>;

  /** Сериализация операций по коллекции внутри процесса (один инстанс — ADR-01). */
  withLock<T>(collection: string, task: () => Promise<T>): Promise<T>;

  /** Диагностический путь к физическому носителю. */
  location(collection: string): string;
}
