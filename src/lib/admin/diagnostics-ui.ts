import type { CoverageBucket, GraphDiagnostic } from "./dependencies";
import type { AdminParameter } from "./schema";

/**
 * CA-T-506 — представление отчёта диагностики.
 *
 * Только классификация и подписи для UI. Проверки и выводы выполняет
 * существующий сервис CA-T-206 (`diagnoseGraph`); здесь ничего не
 * вычисляется заново и не создаются новые проверки.
 */

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticIssue {
  id: string;
  severity: DiagnosticSeverity;
  area: "structure" | "coverage" | "formulas" | "sources" | "parameters";
  title: string;
  detail: string;
}

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
  infos: number;
  status: "ok" | "attention" | "critical";
}

const EFFECT_LABELS: Record<string, string> = {
  price: "price",
  geometry: "geometry",
  validation: "validation",
  visualization: "visualization",
};

export function coverageLabel(key: keyof GraphDiagnostic["coverage"]["effects"]): string {
  return EFFECT_LABELS[key] ?? key;
}

function bucketDetail(bucket: CoverageBucket): string {
  return [
    `всего ${bucket.total}`,
    `подтверждено ${bucket.confirmed}`,
    `partial ${bucket.partial}`,
    `unknown ${bucket.unknown}`,
    `не покрыто ${bucket.notCovered}`,
    bucket.notCoveredIds.length > 0
      ? `без рёбер: ${bucket.notCoveredIds.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Плоский список проблем из фактического отчёта. Каждая запись — прямое
 * отражение поля `GraphDiagnostic`; отсутствующие проблемы не создаются.
 */
export function collectDiagnosticIssues(
  graph: GraphDiagnostic,
): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  for (const [index, item] of graph.structural.invalid.entries()) {
    issues.push({
      id: `invalid-${item.id ?? index}`,
      severity: "error",
      area: "structure",
      title: "Невалидная запись связи",
      detail: `${item.id ?? "без id"}: ${item.reason}`,
    });
  }

  for (const [index, row] of graph.structural.duplicates.entries()) {
    issues.push({
      id: `duplicate-${row.id}-${index}`,
      severity: "error",
      area: "structure",
      title: "Дубль U-ключа",
      detail: `${row.sourceType}:${row.sourceId} → ${row.targetType}:${row.targetId}`,
    });
  }

  for (const [index, item] of graph.structural.orphans.entries()) {
    issues.push({
      id: `orphan-${item.id}-${index}`,
      severity: "error",
      area: "structure",
      title: "Осиротевшая связь",
      detail: `${item.id}: ${item.reason}`,
    });
  }

  for (const key of Object.keys(graph.coverage.effects) as (keyof GraphDiagnostic["coverage"]["effects"])[]) {
    const bucket = graph.coverage.effects[key];
    if (bucket.total === 0 || bucket.complete) continue;
    issues.push({
      id: `coverage-${key}`,
      severity: "warning",
      area: "coverage",
      title: `Покрытие affects.${coverageLabel(key)} неполное`,
      detail: bucketDetail(bucket),
    });
  }

  for (const [index, item] of graph.coverage.formulas.uncovered.entries()) {
    issues.push({
      id: `formula-uncovered-${index}`,
      severity: "warning",
      area: "formulas",
      title: "Формула без подтверждённых рёбер",
      detail: `${item.id}: ${item.reason}`,
    });
  }

  for (const [index, item] of graph.coverage.formulas.excluded.entries()) {
    issues.push({
      id: `formula-excluded-${index}`,
      severity: "info",
      area: "formulas",
      title: "Формула исключена из проверки",
      detail: `${item.id}: ${item.reason}`,
    });
  }

  for (const item of graph.coverage.unknownSources) {
    issues.push({
      id: `unknown-${item.sourceType}-${item.sourceId}`,
      severity: "warning",
      area: "sources",
      title: "UNKNOWN-источник карты",
      detail: `${item.sourceType}:${item.sourceId}`,
    });
  }

  if (graph.coverage.partialEdges.length > 0) {
    issues.push({
      id: "partial-edges",
      severity: "info",
      area: "sources",
      title: "PARTIAL-рёбра",
      detail: graph.coverage.partialEdges
        .map((edge) => `${edge.sourceId} → ${edge.targetId}`)
        .join("; "),
    });
  }

  if (graph.coverage.unconfirmedComponents.length > 0) {
    issues.push({
      id: "unconfirmed-components",
      severity: "info",
      area: "coverage",
      title: "Компоненты реестра без рёбер",
      detail: graph.coverage.unconfirmedComponents.join("; "),
    });
  }

  for (const item of graph.coverage.deadSources) {
    issues.push({
      id: `dead-${item.sourceType}-${item.sourceId}`,
      severity: "warning",
      area: "sources",
      title: "Мёртвый источник (effect=none)",
      detail: `${item.sourceType}:${item.sourceId}`,
    });
  }

  if (graph.coverage.paramsWithoutDependencies.length > 0) {
    issues.push({
      id: "params-without-dependencies",
      severity: "warning",
      area: "parameters",
      title: "Параметры без зависимостей",
      detail: graph.coverage.paramsWithoutDependencies.join(", "),
    });
  }

  if (graph.structural.archivedSources.length > 0) {
    issues.push({
      id: "archived-sources",
      severity: "info",
      area: "structure",
      title: "Связи архивных источников сохранены",
      detail: graph.structural.archivedSources
        .map((item) => `${item.sourceType}:${item.sourceId}`)
        .join("; "),
    });
  }

  return issues;
}

export function summarizeIssues(
  issues: DiagnosticIssue[],
): DiagnosticSummary {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const infos = issues.filter((issue) => issue.severity === "info").length;
  return {
    errors,
    warnings,
    infos,
    status: errors > 0 ? "critical" : warnings > 0 ? "attention" : "ok",
  };
}

export interface StatusParameterLists {
  dead: AdminParameter[];
  preliminary: AdminParameter[];
}

/** Разделение уже прочитанных параметров по статусу (без новых проверок). */
export function splitParametersByStatus(
  parameters: AdminParameter[],
): StatusParameterLists {
  return {
    dead: parameters.filter((item) => item.status === "dead"),
    preliminary: parameters.filter((item) => item.status === "preliminary"),
  };
}
