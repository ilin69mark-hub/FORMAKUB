import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const locks = new Map<string, Promise<unknown>>();

/**
 * Путь к файлу коллекции. Каталог по умолчанию задан статически, чтобы сборка
 * трассировала только `data/`; тесты переопределяют каталог через
 * `FORMAKUB_DATA_DIR`.
 */
function collectionPath(file: string): string {
  const override = process.env.FORMAKUB_DATA_DIR;
  if (override) return path.join(override, file);
  return path.join(process.cwd(), "data", file);
}

function dataDirOfFile(file: string): string {
  return path.dirname(collectionPath(file));
}

async function ensureDir(file: string): Promise<void> {
  await mkdir(dataDirOfFile(file), { recursive: true });
}

export type CollectionRead<T> =
  | { status: "ok"; items: T[] }
  | { status: "missing" }
  | { status: "corrupt"; reason: string };

/**
 * Безопасное чтение коллекции (CA-T-106, дизайн §12 S6, OI-064).
 *
 * Повреждённые данные квартируются сообщением, а не исключением (HTTP 500)
 * и не молчаливым `[]` (коллекция «исчезала» из выдачи). Файл при этом не
 * изменяется — инвариант I-09.
 */
export async function readCollectionStatus<T>(
  file: string,
): Promise<CollectionRead<T>> {
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

/**
 * Чтение для пути записи: повреждённый файл → исключение, чтобы молча не
 * затереть данные (раньше валидный не-массив давал `[]` и перезаписывался).
 */
export async function readCollection<T>(file: string): Promise<T[]> {
  const read = await readCollectionStatus<T>(file);
  if (read.status === "missing") return [];
  if (read.status === "corrupt") {
    throw new Error(`Хранилище ${file} повреждено: ${read.reason}.`);
  }
  return read.items;
}

async function writeCollection<T>(file: string, items: T[]): Promise<void> {
  await ensureDir(file);
  const target = collectionPath(file);
  const temp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, JSON.stringify(items, null, 2), "utf8");
  await rename(temp, target);
}

export async function withFileLock<T>(
  file: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(file) ?? Promise.resolve();
  const next = previous.then(task, task);
  locks.set(
    file,
    next.catch(() => undefined),
  );
  try {
    return await next;
  } finally {
    if (locks.get(file) === next) locks.delete(file);
  }
}

export async function updateCollection<T, R>(
  file: string,
  task: (items: T[]) => Promise<{ items: T[]; result: R }> | { items: T[]; result: R },
): Promise<R> {
  return withFileLock(file, async () => {
    const items = await readCollection<T>(file);
    const { items: nextItems, result } = await task(items);
    await writeCollection(file, nextItems);
    return result;
  });
}

export function dataFilePath(file: string): string {
  return collectionPath(file);
}
