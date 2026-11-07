import type { StoredProject } from "@/lib/configurator/types";
import { SUPPORTED_SCHEMA_VERSION } from "@/lib/configurator/versions";

/** Шаг цепочки миграций: ровно одна ступень `from → to` (дизайн §5.6). */
export interface SchemaMigration {
  from: number;
  to: number;
  migrate: (project: StoredProject) => StoredProject;
}

/**
 * Цепочка миграций структуры проекта, привязанная к `schemaVersion`
 * (дизайн §5.6, CA-T-105).
 *
 * `v1 → v2` — пустая ступень: данные не меняются, механизм проверяется
 * идемпотентностью. Шаг не применяется, пока `SUPPORTED_SCHEMA_VERSION = 1`.
 */
export const MIGRATIONS: SchemaMigration[] = [
  { from: 1, to: 2, migrate: (project) => project },
];

/**
 * Версия структуры записи (дизайн §12 S1): без `schemaVersion` ⇒ версия
 * берётся из `config.version`, при его отсутствии — 1.
 */
export function schemaVersionOf(
  project: Pick<StoredProject, "schemaVersion" | "config">,
): number {
  if (typeof project.schemaVersion === "number") return project.schemaVersion;
  const version = (project.config as { version?: unknown } | null | undefined)
    ?.version;
  return typeof version === "number" && Number.isInteger(version) && version >= 1
    ? version
    : SUPPORTED_SCHEMA_VERSION;
}

export interface MigrationOutcome {
  project: StoredProject;
  /** Применённые ступени (целевые версии) в порядке применения. */
  applied: number[];
}

/**
 * Применяет цепочку миграций от версии записи до `targetVersion`.
 *
 * Ступени последовательны и идемпотентны: повторный прогон того же входа
 * даёт глубоко равный результат. Запись новее целевой версии не мигрируется.
 */
export function applyMigrations(
  project: StoredProject,
  targetVersion: number = SUPPORTED_SCHEMA_VERSION,
): MigrationOutcome {
  let current = schemaVersionOf(project);
  if (current > targetVersion) {
    throw new Error(
      `Запись v${current} новее целевой версии v${targetVersion} — миграция невозможна.`,
    );
  }

  let next = project;
  const applied: number[] = [];
  while (current < targetVersion) {
    const step = MIGRATIONS.find(
      (migration) => migration.from === current && migration.to === current + 1,
    );
    if (!step) {
      throw new Error(`Отсутствует миграция v${current} → v${current + 1}.`);
    }
    next = { ...step.migrate(next), schemaVersion: step.to };
    current = step.to;
    applied.push(step.to);
  }
  return { project: next, applied };
}
