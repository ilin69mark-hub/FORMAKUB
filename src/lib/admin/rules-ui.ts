import type { ManagedRule, RulesSnapshot } from "./managed-rules";

/**
 * CA-T-613 — чистые UI-хелперы раздела «Правила».
 * Не содержат бизнес-логики: фильтрация, подписи, сбор выбора публикации.
 */

export interface RuleFilter {
  q?: string;
  status?: string;
  scope?: string;
  source?: string;
}

export function filterRules(
  rules: readonly ManagedRule[],
  filter: RuleFilter,
): ManagedRule[] {
  const q = filter.q?.trim().toLowerCase();
  return rules.filter((rule) => {
    if (filter.status && rule.status !== filter.status) return false;
    if (filter.scope && rule.scope !== filter.scope) return false;
    if (filter.source && rule.source !== filter.source) return false;
    if (q && !`${rule.id} ${rule.name} ${rule.description}`.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}

export function buildSelection(
  rules: readonly ManagedRule[],
  ids: readonly string[],
): Array<{ id: string; expectedVersion: string }> {
  return ids
    .map((id) => rules.find((rule) => rule.id === id))
    .filter((rule): rule is ManagedRule => rule !== undefined)
    .map((rule) => ({ id: rule.id, expectedVersion: rule.version }));
}

/**
 * Проверки перед публикацией на клиенте (сервер валидирует повторно).
 * Возвращает список сообщений; пустой список — можно отправлять.
 */
export function validateSelection(
  rules: readonly ManagedRule[],
  ids: readonly string[],
): string[] {
  const issues: string[] = [];
  if (ids.length === 0) issues.push("Выберите хотя бы одно draft-правило.");
  const selected = rules.filter((rule) => ids.includes(rule.id));
  if (selected.some((rule) => rule.status !== "draft")) {
    issues.push("Публиковать можно только draft-правила.");
  }
  if (selected.some((rule) => rule.source === "preliminary")) {
    issues.push("preliminary-правила не публикуются.");
  }
  if (new Set(ids).size !== ids.length) {
    issues.push("Выбор содержит дубликаты.");
  }
  return issues;
}

export function formatRuleValue(rule: ManagedRule): string {
  if (Array.isArray(rule.value)) return rule.value.join(", ");
  if (typeof rule.value === "boolean") return rule.value ? "да" : "нет";
  return String(rule.value);
}

export function snapshotLabel(snapshot: RulesSnapshot): string {
  return `#${snapshot.publishedSeq} · ${snapshot.id} · ${snapshot.rules.length} правил`;
}

export function sortRevisions(revisions: readonly ManagedRule[]): ManagedRule[] {
  return [...revisions].sort((a, b) => Number(a.version) - Number(b.version));
}
