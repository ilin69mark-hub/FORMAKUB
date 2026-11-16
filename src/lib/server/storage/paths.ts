import path from "node:path";

/**
 * Каталог данных. Путь по умолчанию задан статически (`data/`), чтобы сборка
 * трассировала только этот каталог; тесты переопределяют его через
 * `FORMAKUB_DATA_DIR` (CA-T-103).
 */
export function dataDir(): string {
  const override = process.env.FORMAKUB_DATA_DIR;
  if (override) return override;
  return path.join(process.cwd(), "data");
}

/** Путь к файлу коллекции в каталоге данных. */
export function collectionPath(file: string): string {
  // turbopackIgnore: каталог данных статичен для сборки (data/), тесты
  // переопределяют его через FORMAKUB_DATA_DIR.
  return path.join(/* turbopackIgnore: true */ dataDir(), file);
}
