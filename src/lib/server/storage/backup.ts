import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

import { DatabaseSync, backup } from "node:sqlite";

import { dataDir } from "./paths";

/**
 * Резервное копирование и восстановление SQLite (INFRA-SQLITE-001; ADR-01/ADR-03).
 *
 * Объём: WAL-aware резервная копия **активной** базы (онлайн-снимок через
 * `node:sqlite.backup` — источник продолжает работать, снимок согласован),
 * проверка целостности (`PRAGMA integrity_check`), восстановление в целевой
 * каталог с удалением устаревших `-wal`/`-shm` чужой базы.
 *
 * Границы (вне INFRA-SQLITE-001, по карточке и ADR-03): выгрузка во
 * внешнее S3-совместимое хранилище, расписание retention (48 hourly /
 * 30 daily / 12 monthly), хранение исторических сборок движка и
 * регламент restore-drill выполняются отдельными эксплуатационными
 * задачами (CA-T-608, инфраструктура); здесь не создаются credentials и
 * не выдумываются провайдеры. Восстановление выполняется при
 * **остановленном** приложении (открытые handle СУБД исключаются).
 */

const DB_FILE = "formakub.db";

/** Retention резервных копий (ADR-03): 48 почасовых / 30 ежедневных / 12 ежемесячных. */
export const ADR03_RETENTION = { hourly: 48, daily: 30, monthly: 12 } as const;

export type BackupTier = keyof typeof ADR03_RETENTION;

/** Имя файла копии: `formakub-<tier>-<штамп>.db` (tier определяет корзину ротации). */
function backupFileName(tier: BackupTier, now = new Date()): string {
  const iso = now.toISOString().replace(/[:.]/g, "-");
  if (tier === "hourly") return `formakub-hourly-${iso}.db`;
  if (tier === "daily") return `formakub-daily-${now.toISOString().slice(0, 10)}.db`;
  return `formakub-monthly-${now.toISOString().slice(0, 7)}.db`;
}

/**
 * Ротация по корзинам ADR-03 (автоматическая — вызывается после каждого
 * успешного backup): в каждой корзине сохраняются retention последних
 * копий по mtime, излишки удаляются. Файлы без tier-префикса (ручные,
 * исторические) не трогаются.
 */
export function rotateBackups(
  destinationDir: string = path.join(dataDir(), "backups"),
  retention: Record<BackupTier, number> = ADR03_RETENTION,
): { removed: string[]; kept: number } {
  const removed: string[] = [];
  let kept = 0;
  if (!existsSync(destinationDir)) return { removed, kept };

  for (const tier of Object.keys(retention) as BackupTier[]) {
    const prefix = `formakub-${tier}-`;
    const files = readdirSync(destinationDir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".db"))
      .map((name) => ({ name, mtime: statSync(path.join(destinationDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime); // новые первыми
    kept += Math.min(files.length, retention[tier]);
    for (const file of files.slice(retention[tier])) {
      try {
        unlinkSync(path.join(destinationDir, file.name));
        removed.push(file.name);
      } catch {
        // Файл занят/удалён параллельно — следующая ротация подхватит.
      }
    }
  }
  return { removed, kept };
}

export interface BackupResult {
  /** Путь к файлу резервной копии. */
  file: string;
  /** Результат PRAGMA integrity_check: "ok" либо описание проблемы. */
  integrity: string;
}

function dbPathIn(dir: string): string {
  return path.join(dir, DB_FILE);
}

/**
 * Проверка целостности файла БД (`PRAGMA integrity_check`).
 * БД отсутствует → ошибка; файл не читается как БД или повреждён →
 * возвращается описание (восстановление/backup отклоняются, не падают на
 * неожидаемом исключении СУБД).
 */
export function verifyIntegrity(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`Резервная копия не найдена: ${file}`);
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (error) {
    return `файл не читается как база: ${(error as Error).message}`;
  }
  try {
    const row = db.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: string }
      | undefined;
    return row?.integrity_check ?? "unknown";
  } catch (error) {
    return `нечитаема: ${(error as Error).message}`;
  } finally {
    db.close();
  }
}

/**
 * Резервная копия активной базы (WAL-aware: снимок согласован при
 * активных записях). Каталог назначения создаётся; имя файла со штампом.
 */
export async function backupDatabase(
  destinationDir: string = path.join(dataDir(), "backups"),
  tier: BackupTier = "hourly",
): Promise<BackupResult> {
  const source = dbPathIn(dataDir());
  if (!existsSync(source)) {
    throw new Error(`База данных не найдена: ${source} — резервная копия невозможна.`);
  }
  mkdirSync(destinationDir, { recursive: true });

  const db = new DatabaseSync(source);
  try {
    const file = path.join(destinationDir, backupFileName(tier));
    await backup(db, file); // онлайн-снимок активной (WAL) базы
    const integrity = verifyIntegrity(file);
    if (integrity !== "ok") {
      throw new Error(`Резервная копия не прошла integrity_check: ${integrity} (${file})`);
    }
    // Спутники WAL-файла копии (появляются при integrity-проверке) — убираются:
    // сама копия согласована (онлайн-бэкап делает checkpointed-снимок).
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
    // Автоматическая ротация корзин ADR-03 (48/30/12) после успешного бэкапа.
    rotateBackups(destinationDir);
    return { file, integrity };
  } finally {
    db.close();
  }
}

/**
 * Восстановление из резервной копии в каталог данных (при остановленном
 * приложении). Копия предварительно проходит integrity_check; устаревшие
 * `-wal`/`-shm` целевой базы удаляются, чтобы WAL чужой базы не был
 * применён к восстановленному файлу. Исходная копия не удаляется.
 */
export function restoreDatabase(
  backupFile: string,
  targetDir: string = dataDir(),
): { restoredTo: string; integrity: string } {
  const integrity = verifyIntegrity(backupFile);
  if (integrity !== "ok") {
    throw new Error(
      `Восстановление отклонено: резервная копия повреждена (${integrity}) — ${backupFile}`,
    );
  }
  mkdirSync(targetDir, { recursive: true });
  const target = dbPathIn(targetDir);
  copyFileSync(backupFile, target);
  // WAL/SHM предыдущей базы целевого каталога не относятся к восстановленному файлу.
  rmSync(`${target}-wal`, { force: true });
  rmSync(`${target}-shm`, { force: true });

  let reopened: DatabaseSync;
  try {
    reopened = new DatabaseSync(target, { readOnly: true });
  } catch (error) {
    throw new Error(
      `Восстановление не удалось: файл не читается — ${target} (${(error as Error).message})`,
    );
  }
  try {
    const check = reopened.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: string }
      | undefined;
    const result = check?.integrity_check ?? "unknown";
    if (result !== "ok") {
      throw new Error(`Восстановленная база не прошла integrity_check: ${result}`);
    }
    return { restoredTo: target, integrity: result };
  } finally {
    reopened.close();
  }
}
