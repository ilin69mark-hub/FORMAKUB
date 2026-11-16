import { readCollection, readCollectionStatus } from "@/lib/server/store";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";
import { calculatePriceFromInputs } from "@/lib/server/projects";
import {
  toCompositionTraceSnapshot,
  type CompositionTraceResult,
} from "@/lib/server/composition-resolver";
import type {
  CompositionTraceSnapshot,
  CompositionTraceSnapshotIssue,
} from "@/lib/configurator/types";
import { BUILD_CALC_VERSION } from "@/lib/configurator/versions";
import type {
  PriceBreakdown,
  ProjectPriceHistory,
  StoredProject,
} from "@/lib/configurator/types";

import { getModuleComposition } from "./catalog-model";
import { getCompositionVersion } from "./composition";
import { diagnoseProjectRules, type ProjectRulesDiagnosis } from "./rules-diagnostics";
import type { PricingVersion } from "./schema";

/**
 * Calculation Inspector — read-only сборка доступной трассировки.
 *
 * Что действительно есть в сохранённых данных:
 * - `StoredProject.config` — состав проекта (модули/секции/параметры);
 * - `StoredProject.price` — отображаемый PriceBreakdown (label/detail/amount);
 * - `StoredProject.priceHistory[-1].breakdown` — PriceBreakdown прошлого расчёта;
 * - `priceVersion` / `calcVersion` / `schemaVersion` / `rulesSnapshotId`.
 *
 * Чего нет и что нельзя придумывать:
 * - id строки и `priceItemId` в сохранённом Breakdown;
 * - количество конкретного компонента и применившая его норма;
 * - runtime-трассировка «правило → строка». Единственная документированная
 *   связь — статическая `ManagedRule.assigns = line:<CalculationLineId>`;
 *   сопоставить её со строкой проекта нельзя без сохранённого line id.
 *
 * Поэтому строки помечаются `traceable=false` и `traceGap` явно.
 */

const PROJECTS = "projects.json";
const VERSIONS = "pricing-versions.json";

export interface InspectorProjectRow {
  id: string;
  kind: "kitchen" | "wardrobe" | "unknown";
  title: string;
  total: number;
  currency: string;
  schemaVersion: string;
  calcVersion: string;
  priceVersion: string;
  compositionVersionId: string | null;
  rulesSnapshotId: string | null;
  historyCount: number;
  createdAt: string;
  updatedAt: string;
  diagnosticsStatus: string;
}

export interface InspectorModuleRow {
  id: string;
  type: string;
  label: string;
  width: number;
  height: number;
  depth: number;
  shelves: number | null;
  drawers: number | null;
  detail: string;
  compositionHref: string | null;
}

export interface InspectorLineRow {
  id: string | null;
  label: string;
  amount: number;
  detail: string | null;
  /** Статически связанные правила (assigns=line:<id>). */
  appliedRuleIds: string[];
  /** Есть ли у строки сохранённый идентификатор и метаданные. */
  traceable: boolean;
  traceGap: string | null;
}

export interface InspectorPriceVersion {
  id: string;
  status: string;
  publishedAt: string | null;
  publishedSeq: number | null;
  snapshotItems: number | null;
}

/**
 * E2: представление компонентной трассировки в Inspector.
 *
 * `status`:
 * - `computed` — trace построен и пригоден для показа;
 * - `blocked`  — trace построен быть не мог (fail-closed диагностики);
 * - `absent`   — composition-pin отсутствует, trace не применяется (В-1);
 * - `unavailable` — расчётные входы/Engine недоступны, trace не вычислен.
 *
 * Trace в E2 вычисляется **live** при открытии Inspector: сохранение trace в
 * истории (`ProjectPriceHistory`) — отдельный этап E4 и здесь не выполняется.
 */
export interface CompositionTraceView {
  status: "computed" | "blocked" | "absent" | "unavailable";
  compositionVersionId: string | null;
  trace: CompositionTraceSnapshot | null;
  issues: CompositionTraceSnapshotIssue[];
  message: string | null;
  /**
   * Источник данных: `history` — сохранённый снимок события (E4),
   * `live` — пересчёт для записи без снимка, `none` — trace не применяется.
   */
  source: "history" | "live" | "none";
}

export interface InspectorProject {
  project: InspectorProjectRow;
  rules: ProjectRulesDiagnosis | null;
  rulesError: string | null;
  priceVersion: InspectorPriceVersion | null;
  priceVersionError: string | null;
  composition: {
    id: string;
    status: string;
    rulesSnapshotId: string | null;
    production: string | null;
  } | null;
  compositionError: string | null;
  /** E2: независимая компонентная трассировка (не влияет на итоги Engine). */
  compositionTrace: CompositionTraceView;
  breakdown: PriceBreakdown | null;
  latestHistory: ProjectPriceHistory | null;
  modules: InspectorModuleRow[];
  lines: InspectorLineRow[];
  issues: string[];
  traceability: {
    moduleComposition: boolean;
    componentQuantity: boolean;
    componentPrice: boolean;
    appliedRulePerLine: boolean;
    note: string;
  };
}

function kindOf(project: StoredProject): InspectorProjectRow["kind"] {
  const kind = project.config?.kind;
  return kind === "kitchen" || kind === "wardrobe" ? kind : "unknown";
}

function titleOf(project: StoredProject): string {
  const kind = kindOf(project);
  const typeLabel = kind === "kitchen" ? "Кухня" : kind === "wardrobe" ? "Шкаф" : "Проект";
  return `${typeLabel} ${project.id}`;
}

function upcomingHistory(project: StoredProject): ProjectPriceHistory | null {
  const history = project.priceHistory ?? [];
  if (history.length === 0) return null;
  return [...history].sort((a, b) =>
    a.computedAt.localeCompare(b.computedAt),
  )[history.length - 1];
}

function lineRows(
  project: StoredProject,
  latest: ProjectPriceHistory | null,
): InspectorLineRow[] {
  const lines = latest?.breakdown?.lines ?? project.price?.lines ?? [];
  return lines.map((line) => ({
    id: null,
    label: line.label,
    amount: typeof line.amount === "number" ? line.amount : 0,
    detail: line.detail ?? null,
    appliedRuleIds: [],
    traceable: false,
    traceGap: latest
      ? "Сохранённый PriceBreakdown не содержит id строки, priceItemId и нормы количества: доступны только label, detail и сумма. Связь с правилом статически не разрешается."
      : "У проекта нет priceHistory: доступен только отображаемый PriceBreakdown без идентификаторов строк, правил и источников количества.",
  }));
}

function moduleRows(project: StoredProject): InspectorModuleRow[] {
  const config = project.config;
  if (!config) return [];
  if (config.kind === "kitchen") {
    return config.modules.map((unit) => {
      const composition = getModuleComposition(unit.type);
      return {
        id: unit.id,
        type: unit.type,
        label: composition?.label ?? unit.type,
        width: unit.width,
        height: unit.height,
        depth: unit.depth,
        shelves: unit.shelves,
        drawers: unit.drawers,
        detail: [
          unit.type === "sink" ? `мойка ${unit.sinkWidth ?? "—"}×${unit.sinkDepth ?? "—"} мм` : null,
          unit.type === "sink" && unit.sinkStorage
            ? `секций: ${unit.sinkStorage.length}`
            : null,
          unit.type === "drawers" ? `ящиков: ${unit.drawers}` : null,
          unit.ownSupports ? "собственные опоры" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        compositionHref: composition ? `/admin/modules/${unit.type}` : null,
      };
    });
  }
  if (config.kind === "wardrobe") {
    return config.sections.map((section, index) => ({
      id: section.id,
      type: "section",
      label: `Секция ${index + 1}`,
      width: config.widthMm,
      height: config.height,
      depth: config.fullDepth,
      shelves: section.shelves.length,
      drawers: section.drawers,
      detail: [
        `полок: ${section.shelves.length}`,
        `штанг: ${section.rods.length}${section.rodType === "pullout" ? " (выдвижная)" : ""}`,
        `ящиков: ${section.drawers}`,
      ].join(" · "),
      compositionHref: "/admin/modules/wardrobe",
    }));
  }
  return [];
}

export async function listInspectorProjects(): Promise<{
  projects: InspectorProjectRow[];
  issues: string[];
}> {
  const read = await readCollectionStatus<StoredProject>(PROJECTS);
  if (read.status === "missing") {
    return { projects: [], issues: ["projects.json отсутствует: сохранённых расчётов нет."] };
  }
  if (read.status === "corrupt") {
    return { projects: [], issues: [`projects.json повреждён: ${read.reason}`] };
  }
  const projects = read.items
    .map((project) => {
      const history = project.priceHistory ?? [];
      return {
        id: project.id,
        kind: kindOf(project),
        title: titleOf(project),
        total: typeof project.price?.total === "number" ? project.price.total : 0,
        currency: project.price?.currency ?? "RUB",
        schemaVersion:
          typeof project.schemaVersion === "number"
            ? String(project.schemaVersion)
            : "1 (legacy)",
        calcVersion: project.calcVersion ?? "—",
        priceVersion: project.priceVersion ?? "—",
        compositionVersionId: project.compositionVersionId ?? null,
        rulesSnapshotId: project.rulesSnapshotId ?? null,
        historyCount: history.length,
        createdAt: project.createdAt ?? "—",
        updatedAt: project.updatedAt ?? "—",
        diagnosticsStatus: project.rulesSnapshotId
          ? "требуется проверка"
          : "legacy_no_snapshot",
      } satisfies InspectorProjectRow;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { projects, issues: [] };
}

/**
 * E4: представление уже сохранённого исторического снимка.
 *
 * Ничего не пересчитывает и не обращается к текущим Composition/
 * RulesSnapshot/PricingVersion/PriceItem — источник только запись истории.
 */
function viewFromSnapshot(
  snapshot: CompositionTraceSnapshot,
): CompositionTraceView {
  return {
    status: snapshot.status,
    source: "history",
    compositionVersionId: snapshot.compositionVersionId,
    /* Для `blocked` построчных данных нет — view отдаёт null, диагностика ниже. */
    trace: snapshot.status === "computed" ? snapshot : null,
    issues: snapshot.warnings,
    message:
      snapshot.status === "blocked"
        ? "Трассировка заблокирована fail-closed диагностиками (ни одна строка не подставлена и не обнулена)."
        : null,
  };
}

/**
 * E2/E4: live-вычисление trace для проектов, у которых ещё нет сохранённого
 * снимка (история до E4 либо расчёт без записи истории).
 *
 * Последовательность — та же, что и в расчётном пути:
 * DataResolver (preflight) → Engine → `resolveCompositionTrace`.
 * Результат помечается как live и в историю не пишется.
 */
async function computeLiveCompositionTrace(
  project: StoredProject,
): Promise<Omit<CompositionTraceView, "source">> {
  const pinned = project.compositionVersionId ?? null;
  if (!pinned) {
    return {
      status: "absent",
      compositionVersionId: null,
      trace: null,
      issues: [],
      message:
        "Composition pin отсутствует — компонентная трассировка не применяется (В-1, legacy).",
    };
  }

  const failed = (
    issues: CompositionTraceSnapshotIssue[],
    message: string,
  ): Omit<CompositionTraceView, "source"> => ({
    status: "unavailable",
    compositionVersionId: pinned,
    trace: null,
    issues,
    message,
  });

  const toIssues = (
    items: ReadonlyArray<{ code: string; message: string; entityId?: string }>,
  ): CompositionTraceSnapshotIssue[] =>
    items.map((item) => ({
      severity: "error" as const,
      code: "TRACE_ENGINE_BREAKDOWN_INVALID" as const,
      message: `${item.code}: ${item.message}`,
      ...(item.entityId === undefined ? {} : { entityId: item.entityId }),
    }));

  try {
    const resolution = await resolveCalculationInputs({
      operation: "recalculate",
      project,
      expectedProjectCalcVersion: project.calcVersion ?? BUILD_CALC_VERSION,
      requiredExecutedCalcVersion: BUILD_CALC_VERSION,
      expectedSourcePriceVersion: project.priceVersion ?? null,
    });
    if (!resolution.ok) {
      return failed(
        toIssues(resolution.issues),
        "Расчётные входы не разрешены (preflight/контракт): trace не вычислен.",
      );
    }

    const calculated = await calculatePriceFromInputs(
      resolution.value.request,
      { compositionPreflight: resolution.value.compositionPreflight },
    );
    if (!calculated.ok) {
      return failed(
        toIssues(calculated.issues),
        "Расчёт Engine не выполнен: trace не вычислен.",
      );
    }

    const result: CompositionTraceResult | undefined =
      calculated.compositionTrace;
    if (!result) {
      return {
        status: "absent",
        compositionVersionId: pinned,
        trace: null,
        issues: [],
        message:
          "Preflight Composition не дал handoff — trace не построен (расчёт остался legacy-путём).",
      };
    }

    const snapshot = toCompositionTraceSnapshot(
      result,
      new Date().toISOString(),
    );
    if (!snapshot) {
      return {
        status: "absent",
        compositionVersionId: pinned,
        trace: null,
        issues: [],
        message: "Контекст трассировки отсутствует — сохранять нечего.",
      };
    }
    return viewFromSnapshot(snapshot);
  } catch (error) {
    return failed(
      [],
      error instanceof Error
        ? `Ошибка вычисления trace: ${error.message}`
        : "Ошибка вычисления trace.",
    );
  }
}

/**
 * E2/E4: **текущий** (live) расчёт трассировки — вне исторического чтения.
 *
 * Экспортируется как отдельный путь: `getInspectorProject` исторические записи
 * не пересчитывает, а live-режим остаётся доступен явно (`source: "live"`).
 */
export async function computeLiveCompositionTraceView(
  project: StoredProject,
): Promise<CompositionTraceView> {
  const view = await computeLiveCompositionTrace(project);
  return { ...view, source: view.status === "absent" ? "none" : "live" };
}

export async function getInspectorProject(
  projectId: string,
): Promise<
  | { ok: true; data: InspectorProject }
  | { ok: false; reason: string }
> {
  const read = await readCollectionStatus<StoredProject>(PROJECTS);
  if (read.status === "corrupt") {
    return { ok: false, reason: `projects.json повреждён: ${read.reason}` };
  }
  if (read.status === "missing") {
    return { ok: false, reason: "projects.json отсутствует." };
  }
  const project = read.items.find((item) => item.id === projectId);
  if (!project) return { ok: false, reason: "Проект не найден." };

  const diagnosed = await diagnoseProjectRules(projectId);
  const rules = diagnosed.ok ? diagnosed.data : null;
  const rulesError = diagnosed.ok ? null : diagnosed.reason;
  const latest = upcomingHistory(project);

  let priceVersion: InspectorPriceVersion | null = null;
  let priceVersionError: string | null = null;
  try {
    if (project.priceVersion) {
      const versions = await readCollection<PricingVersion>(VERSIONS);
      const found = versions.find((version) => version.id === project.priceVersion);
      priceVersion = found
        ? {
            id: found.id,
            status: found.status,
            publishedAt: found.publishedAt ?? null,
            publishedSeq: found.publishedSeq ?? null,
            snapshotItems: Array.isArray(found.snapshot) ? found.snapshot.length : null,
          }
        : null;
      if (!found) {
        priceVersionError = `PricingVersion "${project.priceVersion}" отсутствует в хранилище — цена сохранена в проекте, но версия не восстановима.`;
      }
    } else {
      priceVersionError = "У проекта нет priceVersion: происхождение сохранённой цены не установлено.";
    }
  } catch (error) {
    priceVersionError = error instanceof Error ? error.message : "Ошибка чтения PricingVersion.";
  }

  let composition: InspectorProject["composition"] = null;
  let compositionError: string | null = null;
  if (project.compositionVersionId) {
    try {
      const version = await getCompositionVersion(project.compositionVersionId);
      if (!version) {
        compositionError = `CompositionVersion "${project.compositionVersionId}" не найдена.`;
      } else {
        composition = {
          id: version.id,
          status: version.status,
          rulesSnapshotId: version.rulesSnapshotId ?? null,
          production: version.production?.status ?? null,
        };
      }
    } catch (error) {
      compositionError = error instanceof Error ? error.message : String(error);
    }
  }

  /*
   * E4: историческое чтение использует ТОЛЬКО сохранённый снимок события.
   * Если снимка нет — трассировка не пересчитывается и не создаётся: запись
   * помечается `source: "none"`. Live-пересчёт доступен отдельно
   * (`computeLiveCompositionTraceView`) и в историческом чтении не участвует.
   */
  const compositionTrace: CompositionTraceView = latest?.compositionTrace
    ? viewFromSnapshot(latest.compositionTrace)
    : {
        status: "absent",
        source: "none",
        compositionVersionId: project.compositionVersionId ?? null,
        trace: null,
        issues: [],
        message: project.compositionVersionId
          ? "В этой исторической записи нет сохранённого CompositionTrace: историческая трассировка недоступна и не пересчитывается."
          : "Composition pin отсутствует — компонентная трассировка не применяется (В-1, legacy).",
      };

  const issues: string[] = [];
  if (typeof project.schemaVersion !== "number") {
    issues.push("schemaVersion отсутствует — проект трактуется как legacy (schemaVersion=1).");
  }
  if (!project.calcVersion) {
    issues.push("calcVersion отсутствует — версия движка, выполнившего расчёт, не зафиксирована.");
  }
  if (!latest) {
    issues.push("priceHistory отсутствует — доступна только сохранённая итоговая цена.");
  }
  if (!project.rulesSnapshotId) {
    issues.push(
      "rulesSnapshotId отсутствует — проект legacy; новый расчёт заблокирован, чтение разрешено (Q7-11).",
    );
  }
  if (priceVersionError) issues.push(priceVersionError);
  if (compositionError) issues.push(compositionError);
  if (composition && composition.status !== "published") {
    issues.push(
      `CompositionVersion "${composition.id}" имеет статус ${composition.status}; пересчёт с ней заблокирован.`,
    );
  }

  const lines = lineRows(project, latest);

  return {
    ok: true,
    data: {
      project: {
        id: project.id,
        kind: kindOf(project),
        title: titleOf(project),
        total: typeof project.price?.total === "number" ? project.price.total : 0,
        currency: project.price?.currency ?? "RUB",
        schemaVersion:
          typeof project.schemaVersion === "number"
            ? String(project.schemaVersion)
            : "1 (legacy)",
        calcVersion: project.calcVersion ?? "—",
        priceVersion: project.priceVersion ?? "—",
        compositionVersionId: project.compositionVersionId ?? null,
        rulesSnapshotId: project.rulesSnapshotId ?? null,
        historyCount: (project.priceHistory ?? []).length,
        createdAt: project.createdAt ?? "—",
        updatedAt: project.updatedAt ?? "—",
        diagnosticsStatus: rules?.status ?? "unavailable",
      },
      rules,
      rulesError,
      priceVersion,
      priceVersionError,
      composition,
      compositionError,
      compositionTrace,
      breakdown: project.price ?? null,
      latestHistory: latest,
      modules: moduleRows(project),
      lines,
      issues,
      traceability: {
        moduleComposition: moduleRows(project).length > 0,
        componentQuantity: false,
        componentPrice: false,
        appliedRulePerLine: false,
        note:
          "Сохранённый Breakdown агрегирует строки. Количество и цена конкретного компонента, а также правило, применившее количество, в данных проекта не сохраняются. Inspector показывает доступную связь «правило → строка» и не восстанавливает отсутствующую трассировку задним числом.",
      },
    },
  };
}
