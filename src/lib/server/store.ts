import { getStorage } from "./storage";
import type { CollectionRead, UpdateOutcome } from "./storage/types";

export type { CollectionRead } from "./storage/types";

/**
 * Фасад хранилища (CA-T-103): все вызовы чтения/записи идут через
 * StorageAdapter (`storage/index.ts` — json-file | sqlite, ADR-01).
 * Контракты чтения/записи не изменялись: карантин повреждённых данных,
 * исключение на пути записи, сериализация операций замком.
 */

export async function readCollectionStatus<T>(
  file: string,
): Promise<CollectionRead<T>> {
  return getStorage().readStatus<T>(file);
}

export async function readCollection<T>(file: string): Promise<T[]> {
  return getStorage().read<T>(file);
}

export async function withFileLock<T>(
  file: string,
  task: () => Promise<T>,
): Promise<T> {
  return getStorage().withLock(file, task);
}

export async function updateCollection<T, R>(
  file: string,
  task: (
    items: T[],
  ) => UpdateOutcome<T, R> | Promise<UpdateOutcome<T, R>>,
): Promise<R> {
  return getStorage().update<T, R>(file, task);
}

export function dataFilePath(file: string): string {
  return getStorage().location(file);
}
