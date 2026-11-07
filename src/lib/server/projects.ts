import { randomBytes } from "node:crypto";
import { normalizeKitchen } from "@/lib/configurator/defaults";
import { calculatePrice } from "@/lib/configurator/pricing";
import { storedProjectSchema } from "@/lib/configurator/schema";
import {
  BUILD_CALC_VERSION,
  SUPPORTED_SCHEMA_VERSION,
} from "@/lib/configurator/versions";
import { isConfigValid, validateConfig } from "@/lib/configurator/validation";
import type { FurnitureConfig, StoredProject } from "@/lib/configurator/types";
import { applyMigrations, schemaVersionOf } from "./migrations";
import { readCollectionStatus, updateCollection } from "./store";

function projectId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  let id = "";
  for (let i = 0; i < 8; i += 1) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

export async function saveProject(input: {
  config: FurnitureConfig;
}): Promise<
  | { ok: true; project: StoredProject }
  | { ok: false; issues: ReturnType<typeof validateConfig> }
> {
  const issues = validateConfig(input.config);
  if (!isConfigValid(issues)) {
    return { ok: false, issues };
  }

  const price = calculatePrice(input.config);
  const now = new Date().toISOString();

  const project = await updateCollection<StoredProject, StoredProject>(
    "projects.json",
    (items) => {
      let id = projectId();
      let attempt = 0;
      while (items.some((item) => item.id === id) && attempt < 5) {
        id = projectId();
        attempt += 1;
      }
      // Штампы версий (CA-T-107): структура записи и сборка движка.
      const stored: StoredProject = {
        id,
        config: input.config,
        schemaVersion: SUPPORTED_SCHEMA_VERSION,
        calcVersion: BUILD_CALC_VERSION,
        price,
        createdAt: now,
        updatedAt: now,
      };
      return { items: [...items, stored].slice(-2000), result: stored };
    },
  );

  return { ok: true, project };
}

/**
 * Результат чтения проекта (CA-T-106, дизайн §12 S6, OI-064):
 * невалидный или несовместимый проект отдаётся с пометкой, а не теряется
 * за `null`-404; повреждённый файл квартируется, а не роняет чтение в 500.
 */
export type ProjectReadResult =
  | { status: "not_found" }
  | { status: "quarantined"; reason: string }
  | { status: "ok"; project: StoredProject; versionsInferred: boolean }
  | { status: "unsupported"; project: StoredProject; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Конфиг узнаваем текущей схемой (есть поля, без которых обработка падает). */
function isRecognisedConfig(config: unknown): config is FurnitureConfig {
  if (!isRecord(config)) return false;
  if (config.kind === "kitchen") return Array.isArray(config.modules);
  if (config.kind === "wardrobe") return Array.isArray(config.sections);
  return false;
}

export async function getProject(id: string): Promise<ProjectReadResult> {
  const read = await readCollectionStatus<unknown>("projects.json");
  if (read.status === "missing") return { status: "not_found" };
  if (read.status === "corrupt") {
    return { status: "quarantined", reason: read.reason };
  }

  const raw = read.items.find(
    (item): item is Record<string, unknown> => isRecord(item) && item.id === id,
  );
  if (!raw) return { status: "not_found" };

  const parsed = storedProjectSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "quarantined",
      reason: `запись проекта повреждена (${
        issue ? `${issue.path.join(".")}: ${issue.message}` : "нет обязательных полей"
      })`,
    };
  }

  // raw-режим: содержимое config/price проверяется ниже, а не отбрасывается.
  const stored = parsed.data as unknown as StoredProject;
  const from = schemaVersionOf(stored);
  if (from > SUPPORTED_SCHEMA_VERSION) {
    return {
      status: "unsupported",
      project: stored,
      reason: `структура проекта v${from} новее поддерживаемой v${SUPPORTED_SCHEMA_VERSION}`,
    };
  }

  let migrated: StoredProject;
  try {
    migrated = applyMigrations(stored).project;
  } catch (error) {
    return {
      status: "unsupported",
      project: stored,
      reason: `миграция структуры не выполнена: ${(error as Error).message}`,
    };
  }

  if (!isRecognisedConfig(migrated.config)) {
    return {
      status: "unsupported",
      project: migrated,
      reason: "конфигурация проекта не распознана текущей схемой",
    };
  }

  try {
    const config =
      migrated.config.kind === "kitchen"
        ? normalizeKitchen(migrated.config)
        : migrated.config;
    const issues = validateConfig(config);
    if (!isConfigValid(issues)) {
      return {
        status: "unsupported",
        project: migrated,
        reason: "конфигурация не проходит текущие правила валидации",
      };
    }
    return {
      status: "ok",
      project: {
        ...migrated,
        config,
        price: calculatePrice(config),
        updatedAt: migrated.updatedAt,
      },
      // Запись без schemaVersion → v1 (дизайн §12 S1), поле не дозаписывается.
      versionsInferred: parsed.data.schemaVersion === undefined,
    };
  } catch {
    return {
      status: "unsupported",
      project: migrated,
      reason: "конфигурация проекта не может быть обработана текущей схемой",
    };
  }
}
