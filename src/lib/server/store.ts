import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const locks = new Map<string, Promise<unknown>>();

async function ensureDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function readCollection<T>(file: string): Promise<T[]> {
  try {
    const raw = await readFile(path.join(DATA_DIR, file), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
}

async function writeCollection<T>(file: string, items: T[]): Promise<void> {
  await ensureDir();
  const target = path.join(DATA_DIR, file);
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
  return path.join(DATA_DIR, file);
}
