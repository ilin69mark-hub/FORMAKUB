import { existsSync } from "node:fs";
import path from "node:path";

import {
  EXCLUDED_FORMULAS,
  FORMULA_REGISTRY,
  MAP_ROWS,
  type FormulaRegistryEntry,
} from "./dependency-map";

/**
 * CA-T-307 — read-only реестр CalculationReference/формул.
 *
 * Источник — подтверждённый FORMULA_REGISTRY (CA-T-206). Сервис не читает
 * и не меняет формулы, не предоставляет create/update/delete и не пишет
 * в Storage. Единственная операция — чтение сведений реестра.
 */
export interface FormulaView extends FormulaRegistryEntry {
  name: string;
  fileRef: string;
  editable: false;
  source: "code";
  dependsOn: string[];
  /** Файл существует в текущей сборке. */
  fileExists: boolean;
  /** Формула исключена из критерия покрытия (§3/CA-T-206). */
  excluded: boolean;
  excludedReason?: string;
}

export function listFormulas(): FormulaView[] {
  const excluded = new Map(EXCLUDED_FORMULAS.map((item) => [item.id, item.reason]));
  return FORMULA_REGISTRY.map((entry) => ({
    ...entry,
    name: entry.id,
    fileRef: `${entry.file}:${entry.id}`,
    editable: false,
    source: "code",
    dependsOn: MAP_ROWS.filter(
      (row) => row.targetType === "calculation" && row.targetId === entry.id,
    ).map((row) => row.sourceId),
    fileExists: existsSync(path.join(process.cwd(), "src", entry.file)),
    excluded: excluded.has(entry.id),
    ...(excluded.has(entry.id) ? { excludedReason: excluded.get(entry.id) } : {}),
  }));
}

export function getFormula(id: string): FormulaView | undefined {
  return listFormulas().find((entry) => entry.id === id);
}
