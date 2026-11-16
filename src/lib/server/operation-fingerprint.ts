import { createHash } from "node:crypto";

/**
 * CA-T-306E — версионированный fingerprint запроса для идемпотентности.
 *
 * Canonical JSON: ключи объектов сортируются рекурсивно, порядок массивов
 * сохраняется; `undefined` в объекте опускается (как JSON), в массиве
 * становится `null` (как JSON.stringify); нечисловые числа → `null`.
 */
export const REQUEST_FINGERPRINT_VERSION = "sha256-canonical-json-v1";

function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      result[key] = canonicalize(source[key]);
    }
    return result;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
