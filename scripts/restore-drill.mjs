#!/usr/bin/env node
/**
 * Isolated ADR-03 restore drill. Never touches data/formakub.db.
 * Usage: node scripts/restore-drill.mjs
 * Prints temp paths; cleans up only after successful verification.
 */
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

const root = mkdtempSync(path.join(os.tmpdir(), "formakub-restore-drill-script-"));
const sourceDir = path.join(root, "source");
const backupDir = path.join(root, "backups");
const restoreDir = path.join(root, "restored");
mkdirSync(sourceDir, { recursive: true });

function integrity(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "unknown";
  } finally {
    db.close();
  }
}

let ok = false;
try {
  const sourceFile = path.join(sourceDir, "formakub.db");
  const source = new DatabaseSync(sourceFile);
  source.exec("CREATE TABLE collection_state (collection TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)");
  source.exec("CREATE TABLE storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  source.prepare("INSERT INTO storage_meta (key, value) VALUES (?, ?)").run("json_migrated", "script");
  source.prepare("INSERT INTO collection_state (collection, payload, updated_at) VALUES (?, ?, ?)").run(
    "projects.json",
    JSON.stringify([{ id: "drill-script", price: { total: 12345, currency: "RUB" } }]),
    "2026-11-10T00:00:00.000Z",
  );
  source.close();

  if (integrity(sourceFile) !== "ok") throw new Error("source integrity != ok");

  mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, "formakub-hourly-drill.db");
  const db = new DatabaseSync(sourceFile);
  await backup(db, backupFile);
  db.close();
  if (integrity(backupFile) !== "ok") throw new Error("backup integrity != ok");

  mkdirSync(restoreDir, { recursive: true });
  const restoredFile = path.join(restoreDir, "formakub.db");
  copyFileSync(backupFile, restoredFile);
  if (integrity(restoredFile) !== "ok") throw new Error("restored integrity != ok");

  const restored = new DatabaseSync(restoredFile, { readOnly: true });
  const row = restored.prepare("SELECT payload FROM collection_state WHERE collection = ?").get("projects.json");
  const projects = JSON.parse(row.payload);
  restored.close();
  if (projects.length !== 1 || projects[0].id !== "drill-script") {
    throw new Error("restored data mismatch");
  }

  console.log("RESTORE DRILL PASS");
  console.log(`source=${sourceDir}`);
  console.log(`backup=${backupFile}`);
  console.log(`restored=${restoredFile}`);
  console.log(`integrity=ok projects=${projects.length}`);
  ok = true;
} catch (error) {
  console.error("RESTORE DRILL FAIL");
  console.error(`diagnostics retained at ${root}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (ok && existsSync(root)) rmSync(root, { recursive: true, force: true });
}
