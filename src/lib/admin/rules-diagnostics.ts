import {
  readCollectionStatus,
} from "@/lib/server/store";
import type { StoredProject } from "@/lib/configurator/types";
import { wardrobeRequiredRuleIds } from "@/lib/configurator/wardrobe-hinges";

import {
  listManagedRules,
  rulesSnapshotContentHash,
  rulesSnapshotReferenceIssues,
  rulesSnapshotSchema,
  validateRuleCondition,
  type ManagedRule,
  type RulesSnapshot,
} from "./managed-rules";
import {
  inspectManagedRulesSeed,
  managedRulesSeedSpecs,
} from "./managed-rules-seed";

/**
 * NEW-N2 — ограниченная диагностика Managed Rules (read-only).
 *
 * Ничего не изменяет: не публикует, не назначает снимки, не пересчитывает
 * проекты. Источник данных — существующие коллекции Storage Adapter и
 * расчётный контракт. Трассировка «правило → строка результата» ограничена
 * статической связью `assigns: line:<CalculationLineId>` (ADR-07 §10.2);
 * производные количества/трассы в проекте не хранятся.
 */

export type ProjectRulesDiagnosisStatus =
  | "ok"
  | "legacy_no_snapshot"
  | "snapshot_unknown"
  | "snapshot_corrupt"
  | "snapshot_invalid"
  | "rules_invalid"
  | "required_rules_missing"
  | "project_invalid";

export interface AppliedRuleSummary {
  id: string;
  name: string;
  version: string;
  status: string;
  source: string;
  assigns: string;
  lineIds: string[];
  valueType: string;
}

export interface ProjectRulesDiagnosis {
  projectId: string;
  kind: string | null;
  status: ProjectRulesDiagnosisStatus;
  reason: string;
  pinnedSnapshotId: string | null;
  activeSnapshotId: string | null;
  appliedRules: AppliedRuleSummary[];
  missingRequiredRuleIds: string[];
  issues: string[];
}

export interface RulesSnapshotDiagnosis {
  snapshotId: string;
  status: "ok" | "unknown" | "corrupt" | "invalid";
  reason: string;
  publishedSeq: number | null;
  rules: AppliedRuleSummary[];
  missingRequiredRuleIds: string[];
  usedByProjectIds: string[];
  issues: string[];
}

interface SnapshotEntry {
  snapshot?: RulesSnapshot;
  status: "ok" | "corrupt" | "invalid";
  issues: string[];
}

interface SnapshotIndex {
  status: "ok" | "missing" | "corrupt";
  issues: string[];
  byId: Map<string, SnapshotEntry>;
  activeId: string | null;
}

function lineIdsOf(assigns: string): string[] {
  return assigns.startsWith("line:") ? [assigns.slice("line:".length)] : [];
}

function toSummary(rule: ManagedRule): AppliedRuleSummary {
  return {
    id: rule.id,
    name: rule.name,
    version: rule.version,
    status: rule.status,
    source: rule.source,
    assigns: rule.assigns,
    lineIds: lineIdsOf(rule.assigns),
    valueType: rule.valueType,
  };
}

async function loadSnapshotIndex(): Promise<SnapshotIndex> {
  const read = await readCollectionStatus<unknown>("rules-snapshots.json");
  if (read.status === "missing") {
    return { status: "missing", issues: [], byId: new Map(), activeId: null };
  }
  if (read.status === "corrupt") {
    return {
      status: "corrupt",
      issues: [`rules-snapshots.json повреждён: ${read.reason}`],
      byId: new Map(),
      activeId: null,
    };
  }

  const byId = new Map<string, SnapshotEntry>();
  const issues: string[] = [];
  let active: RulesSnapshot | null = null;

  for (const raw of read.items) {
    try {
      const candidate = raw as RulesSnapshot;
      const validated = rulesSnapshotSchema.safeParse(raw);
      if (!validated.success) {
        const id = typeof candidate.id === "string" ? candidate.id : "unknown";
        byId.set(id, {
          status: "invalid",
          issues: validated.error.issues.map(
            (item) => `${item.path.join(".")}: ${item.message}`,
          ),
        });
        issues.push(`снимок ${id}: структура невалидна`);
        continue;
      }
      if (
        rulesSnapshotContentHash(validated.data.rules) !==
        validated.data.contentHash
      ) {
        byId.set(validated.data.id, {
          status: "invalid",
          issues: ["contentHash не совпадает с содержимым"],
        });
        issues.push(`снимок ${validated.data.id}: нарушена целостность`);
        continue;
      }
      byId.set(validated.data.id, { snapshot: validated.data, status: "ok", issues: [] });
      if (!active || validated.data.publishedSeq > active.publishedSeq) {
        active = validated.data;
      }
    } catch (error) {
      const id =
        raw !== null && typeof raw === "object" && "id" in raw
          ? String((raw as { id?: unknown }).id)
          : "unknown";
      byId.set(id, {
        status: "invalid",
        issues: [error instanceof Error ? error.message : "неизвестная ошибка"],
      });
      issues.push(`снимок ${id}: не удалось прочитать`);
    }
  }

  return { status: "ok", issues, byId, activeId: active?.id ?? null };
}

async function inspectRules(
  snapshot: RulesSnapshot,
  kind: string,
): Promise<{ issues: string[]; missing: string[]; applied: AppliedRuleSummary[] }> {
  const issues: string[] = [];
  for (const rule of snapshot.rules) {
    const conditionIssues = validateRuleCondition(rule.condition);
    issues.push(
      ...conditionIssues.map((item) => `${rule.id}: ${item.path}: ${item.message}`),
    );
  }
  issues.push(...(await rulesSnapshotReferenceIssues(snapshot.rules)));

  const required = kind === "wardrobe" ? wardrobeRequiredRuleIds() : [];
  const present = new Set(snapshot.rules.map((rule) => rule.id));
  const missing = required.filter((id) => !present.has(id));
  if (missing.length > 0) {
    issues.push(`отсутствуют обязательные правила норм: ${missing.join(", ")}`);
  }

  return {
    issues,
    missing,
    applied: snapshot.rules.map(toSummary),
  };
}

async function readProjects(): Promise<
  | { status: "ok"; projects: StoredProject[] }
  | { status: "missing" }
  | { status: "corrupt"; reason: string }
> {
  const read = await readCollectionStatus<StoredProject>("projects.json");
  if (read.status === "missing") return { status: "missing" };
  if (read.status === "corrupt") return { status: "corrupt", reason: read.reason };
  return { status: "ok", projects: read.items };
}

export async function diagnoseProjectRules(
  projectId: string,
): Promise<
  | { ok: true; data: ProjectRulesDiagnosis }
  | { ok: false; reason: string; status: 404 | 500 }
> {
  const projects = await readProjects();
  if (projects.status === "corrupt") {
    return { ok: false, reason: projects.reason ?? "projects.json повреждён", status: 500 };
  }
  if (projects.status === "missing") {
    return { ok: false, reason: "Проекты отсутствуют.", status: 404 };
  }
  const project = projects.projects.find((item) => item.id === projectId);
  if (!project) return { ok: false, reason: "Проект не найден.", status: 404 };

  const index = await loadSnapshotIndex();
  const kind =
    project.config && typeof project.config === "object" && "kind" in project.config
      ? String((project.config as { kind?: unknown }).kind)
      : null;
  const pinned = project.rulesSnapshotId ?? null;
  const base: ProjectRulesDiagnosis = {
    projectId,
    kind,
    status: "ok",
    reason: "Снимок разрешён, нормы корректны.",
    pinnedSnapshotId: pinned,
    activeSnapshotId: index.activeId,
    appliedRules: [],
    missingRequiredRuleIds: [],
    issues: [],
  };

  if (!pinned) {
    return {
      ok: true,
      data: {
        ...base,
        status: "legacy_no_snapshot",
        reason:
          "У проекта нет rulesSnapshotId (legacy): новый расчёт заблокирован, чтение сохранённых данных разрешено.",
        issues: ["Q7-11: требуется отдельная операция перехода на снимок."],
      },
    };
  }

  if (index.status === "corrupt") {
    return {
      ok: true,
      data: {
        ...base,
        status: "snapshot_corrupt",
        reason: "Хранилище снимков повреждено — снимок неразрешим.",
        issues: index.issues,
      },
    };
  }

  const entry = index.byId.get(pinned);
  if (!entry) {
    return {
      ok: true,
      data: {
        ...base,
        status: "snapshot_unknown",
        reason: `Закреплённый снимок "${pinned}" не найден; подстановка запрещена.`,
      },
    };
  }
  if (entry.status === "invalid" || !entry.snapshot) {
    return {
      ok: true,
      data: {
        ...base,
        status: "snapshot_corrupt",
        reason: "Закреплённый снимок повреждён или невалиден.",
        issues: entry.issues,
      },
    };
  }

  const inspection = await inspectRules(entry.snapshot, kind ?? "");
  return {
    ok: true,
    data: {
      ...base,
      status:
        inspection.issues.length === 0
          ? "ok"
          : inspection.missing.length > 0
            ? "required_rules_missing"
            : "rules_invalid",
      reason:
        inspection.issues.length === 0
          ? "Снимок разрешён, нормы корректны."
          : inspection.missing.length > 0
            ? "В снимке отсутствуют обязательные нормы для расчёта."
            : "Снимок содержит ошибки правил/ссылок.",
      appliedRules: inspection.applied,
      missingRequiredRuleIds: inspection.missing,
      issues: inspection.issues,
    },
  };
}

export async function diagnoseProjectRulesList(): Promise<{
  projects: ProjectRulesDiagnosis[];
  storageIssues: string[];
}> {
  const projects = await readProjects();
  if (projects.status !== "ok") {
    return {
      projects: [],
      storageIssues: [
        projects.status === "corrupt"
          ? projects.reason ?? "projects.json повреждён"
          : "projects.json отсутствует",
      ],
    };
  }

  const index = await loadSnapshotIndex();
  const result: ProjectRulesDiagnosis[] = [];
  for (const project of projects.projects) {
    const diagnosed = await diagnoseProjectRules(project.id);
    if (diagnosed.ok) result.push(diagnosed.data);
  }
  return { projects: result, storageIssues: index.issues };
}

export async function diagnoseRulesSnapshot(
  snapshotId: string,
): Promise<
  | { ok: true; data: RulesSnapshotDiagnosis }
  | { ok: false; reason: string; status: 404 | 500 }
> {
  const index = await loadSnapshotIndex();
  if (index.status === "corrupt") {
    return { ok: false, reason: index.issues.join("; "), status: 500 };
  }
  const entry = index.byId.get(snapshotId);
  if (!entry) return { ok: false, reason: "Снимок не найден.", status: 404 };
  if (entry.status !== "ok" || !entry.snapshot) {
    return {
      ok: true,
      data: {
        snapshotId,
        status: entry.status === "invalid" ? "invalid" : "corrupt",
        reason: "Снимок повреждён или невалиден.",
        publishedSeq: null,
        rules: [],
        missingRequiredRuleIds: [],
        usedByProjectIds: [],
        issues: entry.issues,
      },
    };
  }

  const projects = await readProjects();
  const usedByProjectIds =
    projects.status === "ok"
      ? projects.projects
          .filter((project) => project.rulesSnapshotId === snapshotId)
          .map((project) => project.id)
      : [];

  const inspection = await inspectRules(entry.snapshot, "wardrobe");
  return {
    ok: true,
    data: {
      snapshotId,
      status: "ok",
      reason:
        inspection.issues.length === 0
          ? "Снимок валиден."
          : "Снимок содержит ошибки правил/ссылок.",
      publishedSeq: entry.snapshot.publishedSeq,
      rules: inspection.applied,
      missingRequiredRuleIds: inspection.missing,
      usedByProjectIds,
      issues: inspection.issues,
    },
  };
}

export interface ManagedRuleDiagnosis {
  id: string;
  name: string;
  status: string;
  source: string;
  version: string;
  publishable: boolean;
  reason: string;
}

/**
 * NEW-N4 / D-8: состояние seed и правила с признаком публикуемости.
 * Preliminary-правила видны администратору, но публиковать их нельзя.
 */
export async function diagnoseManagedRules(): Promise<{
  expected: number;
  seed: Awaited<ReturnType<typeof inspectManagedRulesSeed>>;
  rules: ManagedRuleDiagnosis[];
}> {
  const [seed, rules] = await Promise.all([
    inspectManagedRulesSeed(),
    listManagedRules(),
  ]);
  return {
    expected: managedRulesSeedSpecs().length,
    seed,
    rules: rules.map((rule) => {
      const preliminary = rule.source === "preliminary";
      const publishable =
        rule.status === "draft" &&
        !preliminary &&
        rule.source !== "preliminary";
      return {
        id: rule.id,
        name: rule.name,
        status: rule.status,
        source: rule.source,
        version: rule.version,
        publishable,
        reason: preliminary
          ? "source=preliminary: публикация запрещена до подтверждения владельцем (Q7-06/D-8)."
          : rule.status !== "draft"
            ? `status=${rule.status}: публикуются только draft-правила.`
            : "Готово к публикации (требуется явный выбор).",
      };
    }),
  };
}
