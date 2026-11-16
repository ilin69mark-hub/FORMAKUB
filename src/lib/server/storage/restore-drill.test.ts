import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterAll, describe, expect, it } from "vitest";

import { backupDatabase, restoreDatabase, verifyIntegrity } from "./backup";
import { readCollection } from "@/lib/server/store";

/**
 * ADR-03 restore-drill (изолированно): backup активной SQLite → restore в
 * отдельный каталог → integrity_check → чтение через Storage Adapter.
 * Production `data/formakub.db` не используется.
 */
describe("ADR-03: restore-drill на изолированной копии", () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("backup → restore → integrity ok → данные читаются", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "formakub-restore-drill-"));
    dirs.push(root);
    const sourceDir = path.join(root, "source");
    const backupDir = path.join(root, "backups");
    const restoreDir = path.join(root, "restored");

    const previousDir = process.env.FORMAKUB_DATA_DIR;
    const previousStorage = process.env.FORMAKUB_STORAGE;
    process.env.FORMAKUB_STORAGE = "sqlite";

    try {
      // 1. Исходная БД с ожидаемыми данными.
      mkdirSync(sourceDir, { recursive: true });
      const sourceFile = path.join(sourceDir, "formakub.db");
      const source = new DatabaseSync(sourceFile);
      source.exec(
        "CREATE TABLE collection_state (collection TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
      );
      source.exec(
        "CREATE TABLE storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      const payload = JSON.stringify([
        { id: "drill-project", price: { total: 12345, currency: "RUB" } },
      ]);
      source
        .prepare(
          "INSERT INTO collection_state (collection, payload, updated_at) VALUES (?, ?, ?)",
        )
        .run("projects.json", payload, "2026-11-10T00:00:00.000Z");
      source.close();

      expect(verifyIntegrity(sourceFile)).toBe("ok");

      // 2. Backup активной базы.
      process.env.FORMAKUB_DATA_DIR = sourceDir;
      const backup = await backupDatabase(backupDir, "hourly");
      expect(backup.integrity).toBe("ok");
      expect(verifyIntegrity(backup.file)).toBe("ok");

      // 3. Restore в отдельный каталог (не поверх source/production).
      const restored = restoreDatabase(backup.file, restoreDir);
      expect(restored.integrity).toBe("ok");
      expect(restored.restoredTo).toBe(path.join(restoreDir, "formakub.db"));
      expect(verifyIntegrity(restored.restoredTo)).toBe("ok");

      // 4. Чтение через Storage Adapter из восстановленного каталога.
      process.env.FORMAKUB_DATA_DIR = restoreDir;
      const projects = await readCollection<{ id: string }>("projects.json");
      expect(projects).toHaveLength(1);
      expect(projects[0]?.id).toBe("drill-project");

      // 5. Исходная backup-копия не удалена.
      expect(verifyIntegrity(backup.file)).toBe("ok");
    } finally {
      if (previousDir === undefined) delete process.env.FORMAKUB_DATA_DIR;
      else process.env.FORMAKUB_DATA_DIR = previousDir;
      if (previousStorage === undefined) delete process.env.FORMAKUB_STORAGE;
      else process.env.FORMAKUB_STORAGE = previousStorage;
    }
  });
});
