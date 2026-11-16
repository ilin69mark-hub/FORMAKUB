import { readCollection } from "@/lib/server/store";
import type { StoredProject } from "@/lib/configurator/types";

import { catalogPriceLinkIssues } from "./catalog-model";
import { listManagedRules, type ManagedRule } from "./managed-rules";
import { listParameters } from "./parameters";
import { listPriceItems } from "./price-items";
import type { AdminParameter, CatalogItem, PriceItem } from "./schema";

/**
 * Data Sources — read-only агрегация фактического происхождения значений.
 *
 * Источники истины остаются прежними: AdminParameter.sourceRef,
 * PriceItem.sourceRef, ManagedRule.source/sourceRef, CatalogItem.updatedBy,
 * StoredProject.priceVersion/rulesSnapshotId. Ничего не домысливается:
 * отсутствующий источник помечается `missing`.
 */

export type DataSourceKind =
  | "parameter"
  | "catalogItem"
  | "priceItem"
  | "rule"
  | "pricingVersion"
  | "projectPin";

export type DataSourceState =
  | "confirmed"
  | "preliminary"
  | "legacy"
  | "missing"
  | "conflict";

export interface DataSourceRow {
  key: string;
  kind: DataSourceKind;
  entityId: string;
  label: string;
  sourceRef: string | null;
  state: DataSourceState;
  status: string;
  version: string;
  scope: string;
  impact: string;
  linked: string[];
  note: string;
  href: string | null;
}

export interface DataSourceBoard {
  rows: DataSourceRow[];
  counts: Record<DataSourceState, number>;
  issues: string[];
}

export interface DataSourceInput {
  parameters: readonly AdminParameter[];
  catalogItems: readonly CatalogItem[];
  priceItems: readonly PriceItem[];
  rules: readonly ManagedRule[];
  projects: readonly StoredProject[];
}

function parameterState(parameter: AdminParameter): DataSourceState {
  if (parameter.status === "preliminary") return "preliminary";
  if (parameter.status === "dead") return "legacy";
  if (parameter.status === "pending_release") return "preliminary";
  return "confirmed";
}

function impactOf(parameter: AdminParameter): string {
  const parts = Object.entries(parameter.affects)
    .filter(([, value]) => value)
    .map(([key]) => key);
  return parts.length > 0 ? parts.join(", ") : "нет";
}

export function buildDataSources(input: DataSourceInput): DataSourceBoard {
  const rows: DataSourceRow[] = [];
  const priceIds = new Set(input.priceItems.map((item) => item.id));
  const issues: string[] = [];

  for (const parameter of input.parameters) {
    rows.push({
      key: `parameter:${parameter.id}`,
      kind: "parameter",
      entityId: parameter.id,
      label: parameter.id,
      sourceRef: parameter.sourceRef || null,
      state: parameterState(parameter),
      status: parameter.status,
      version: parameter.version,
      scope: parameter.scope,
      impact: impactOf(parameter),
      linked: [parameter.group, parameter.category],
      note:
        parameter.status === "dead"
          ? "Мёртвый параметр: не читается расчётом."
          : parameter.editableInAdmin
            ? "Редактируется в разделе «Геометрия и параметры»."
            : "Только чтение в административном интерфейсе.",
      href: `/admin/parameters?id=${encodeURIComponent(parameter.id)}`,
    });
  }

  for (const item of input.catalogItems) {
    const refs = item.priceRefs
      ? Array.isArray(item.priceRefs)
        ? item.priceRefs
        : Object.values(item.priceRefs).filter((value): value is string => Boolean(value))
      : [];
    rows.push({
      key: `catalogItem:${item.catalog}:${item.id}`,
      kind: "catalogItem",
      entityId: `${item.catalog}:${item.id}`,
      label: item.label,
      sourceRef: null,
      state: item.status === "preliminary" ? "preliminary" : "missing",
      status: item.status,
      version: item.version,
      scope: item.catalog,
      impact: "price",
      linked: refs,
      note:
        "CatalogItem не хранит sourceRef. Происхождение подтверждается импортом/аудитом и полем updatedBy; источник не установлен автоматически.",
      href: `/admin/catalogs?catalog=${item.catalog}&id=${encodeURIComponent(item.id)}`,
    });
  }

  for (const item of input.priceItems) {
    const missing = !item.sourceRef;
    rows.push({
      key: `priceItem:${item.id}`,
      kind: "priceItem",
      entityId: item.id,
      label: item.label,
      sourceRef: item.sourceRef || null,
      state: missing ? "missing" : item.usage === "unused" ? "legacy" : "confirmed",
      status: item.status,
      version: item.updatedAt,
      scope: item.scope,
      impact: "price",
      linked: [],
      note:
        item.usage === "unused"
          ? "Ставка не читается движком (usage=unused)."
          : "Действующая ставка PriceSnapshot.",
      href: `/admin/prices?q=${encodeURIComponent(item.id)}`,
    });
  }

  for (const rule of input.rules) {
    rows.push({
      key: `rule:${rule.id}`,
      kind: "rule",
      entityId: rule.id,
      label: rule.name,
      sourceRef: rule.sourceRef || null,
      state:
        rule.source === "preliminary"
          ? "preliminary"
          : rule.status === "archived"
            ? "legacy"
            : "confirmed",
      status: rule.status,
      version: rule.version,
      scope: rule.scope,
      impact: rule.affects.join(", "),
      linked: rule.assigns ? [rule.assigns] : [],
      note:
        rule.source === "preliminary"
          ? "Предварительная норма: не публикуется до подтверждения (Q7-06)."
          : "Норма Managed Rules.",
      href: `/admin/rules?id=${encodeURIComponent(rule.id)}`,
    });
  }

  const projectPins = new Map<string, number>();
  for (const project of input.projects) {
    const key = project.priceVersion ?? "без priceVersion";
    projectPins.set(key, (projectPins.get(key) ?? 0) + 1);
  }
  for (const [versionId, count] of projectPins) {
    rows.push({
      key: `projectPin:${versionId}`,
      kind: "projectPin",
      entityId: versionId,
      label: `Проекты на версии ${versionId}`,
      sourceRef: null,
      state: versionId === "без priceVersion" ? "missing" : "confirmed",
      status: `${count} проект(ов)`,
      version: versionId,
      scope: "projects",
      impact: "price",
      linked: [],
      note:
        "Закрепление проекта за PricingVersion; изменение версии — только отдельной операцией перерасчёта.",
      href: `/admin/projects?priceVersion=${encodeURIComponent(versionId)}`,
    });
  }

  const priceIssues = catalogPriceLinkIssues(input.catalogItems, priceIds);
  for (const issue of priceIssues) {
    rows.push({
      key: `conflict:${issue.code}:${issue.entity}`,
      kind: "catalogItem",
      entityId: issue.entity,
      label: issue.entity,
      sourceRef: null,
      state: "conflict",
      status: issue.code,
      version: "—",
      scope: "catalog",
      impact: "price",
      linked: [],
      note: issue.message,
      href: null,
    });
    issues.push(`${issue.entity}: ${issue.message}`);
  }

  const counts: Record<DataSourceState, number> = {
    confirmed: 0,
    preliminary: 0,
    legacy: 0,
    missing: 0,
    conflict: 0,
  };
  for (const row of rows) counts[row.state] += 1;

  return { rows, counts, issues };
}

export async function getDataSources(): Promise<DataSourceBoard> {
  const [parameters, catalogItems, prices, rules, projects] = await Promise.all([
    listParameters({}),
    readCollection<CatalogItem>("catalog-items.json"),
    listPriceItems(),
    listManagedRules(),
    readCollection<StoredProject>("projects.json"),
  ]);

  return buildDataSources({
    parameters,
    catalogItems,
    priceItems: prices,
    rules,
    projects,
  });
}
