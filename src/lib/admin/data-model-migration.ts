import { readCollection, updateCollection } from "@/lib/server/store";

import {
  catalogItemSchema,
  type CatalogItem,
  type PricingVersion,
} from "./schema";

/**
 * CA-T-304A — миграция моделей данных для DataResolver.
 *
 * Миграция намеренно консервативна: неоднозначные legacy-записи **не**
 * преобразуются автоматически и попадают в отчёт. Запись каталогов
 * выполняется одной операцией Storage Adapter; при ошибке восстанавливается
 * исходный массив (rollback в пределах операции).
 */

const CATALOGS = "catalog-items.json";
const VERSIONS = "pricing-versions.json";
const PRESETS = "module-presets.json";
const PROJECTS = "projects.json";

export interface MigrationIssue {
  collection: string;
  id: string;
  reason: string;
  action: string;
}

export interface MigrationPlan {
  catalogs: { migrated: CatalogItem[]; issues: MigrationIssue[] };
  versions: { migrated: PricingVersion[]; issues: MigrationIssue[] };
  presets: { migrated: Record<string, unknown>[]; issues: MigrationIssue[] };
  projects: { migrated: Record<string, unknown>[]; issues: MigrationIssue[] };
}

export interface MigrationReport {
  dryRun: boolean;
  migrated: Record<string, number>;
  issues: MigrationIssue[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function roleMap(item: Record<string, unknown>): Record<string, string> | null {
  if (record(item.priceRefs)) {
    const entries = Object.entries(item.priceRefs);
    if (entries.every(([, ref]) => nonEmpty(ref))) {
      return Object.fromEntries(entries) as Record<string, string>;
    }
    return null;
  }
  if (!Array.isArray(item.priceRefs)) return null;
  const refs = item.priceRefs.filter(nonEmpty);
  if (refs.length === 0) return {};

  const catalog = String(item.catalog);
  const id = String(item.id);
  switch (catalog) {
    case "bodyMaterial":
    case "facadeMaterial":
      return refs.length === 1 ? { ratePerSqm: refs[0]! } : null;
    case "facadeStyle":
      return refs.length === 1 ? { multiplier: refs[0]! } : null;
    case "handle":
      return refs.length === 1 ? { rate: refs[0]! } : null;
    case "countertop":
      return refs.length === 1 ? { ratePerLinearMeter: refs[0]! } : null;
    case "plinthMaterial":
      return refs.length === 1 ? { ratePerMeter: refs[0]! } : null;
    case "ledStrip":
      return refs.length === 1 ? { pricePerMeter: refs[0]! } : null;
    case "ledProfile":
    case "ledDiffuser":
      return refs.length === 1 ? { ratePerMeter: refs[0]! } : null;
    case "ledControl":
    case "ledPsu":
      return refs.length === 1 ? { price: refs[0]! } : null;
    case "supportSystem": {
      const prefix = `catalog.support.${id}.`;
      const result: Record<string, string> = {};
      for (const ref of refs) {
        if (!ref.startsWith(prefix)) return null;
        const role = ref.slice(prefix.length);
        if (!["legPrice", "clipPrice", "screwPrice", "anchorPrice"].includes(role)) {
          return null;
        }
        result[role] = ref;
      }
      return Object.keys(result).length === 4 ? result : null;
    }
    case "plinthFinish":
    case "plinthMount":
      return refs.length === 0 ? {} : null;
    default:
      return null;
  }
}

export function planCatalogItem(
  input: unknown,
): { item?: CatalogItem; issue?: MigrationIssue } {
  if (!record(input)) {
    return { issue: { collection: CATALOGS, id: "", reason: "запись не объект", action: "исправить вручную" } };
  }
  const id = String(input.id ?? "");
  const roles = roleMap(input);
  if (!roles) {
    return {
      issue: {
        collection: CATALOGS,
        id,
        reason: "priceRefs неоднозначны или содержат неизвестные роли",
        action: "указать явные роли вручную; автоматическая миграция запрещена",
      },
    };
  }
  const candidate = { ...input, priceRefs: roles };
  const parsed = catalogItemSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      issue: {
        collection: CATALOGS,
        id,
        reason: `запись не проходит схему: ${parsed.error.message}`,
        action: "исправить attrs/priceRefs вручную",
      },
    };
  }
  return { item: parsed.data };
}

export function planDataModelMigration(input: {
  catalogs: unknown[];
  versions: unknown[];
  presets: unknown[];
  projects: unknown[];
}): MigrationPlan {
  const plan: MigrationPlan = {
    catalogs: { migrated: [], issues: [] },
    versions: { migrated: [], issues: [] },
    presets: { migrated: [], issues: [] },
    projects: { migrated: [], issues: [] },
  };

  for (const raw of input.catalogs) {
    const result = planCatalogItem(raw);
    if (result.item) plan.catalogs.migrated.push(result.item);
    else if (result.issue) plan.catalogs.issues.push(result.issue);
  }

  for (const raw of input.versions) {
    if (!record(raw)) continue;
    if (Array.isArray(raw.signedAdjustments)) {
      plan.versions.migrated.push(raw as unknown as PricingVersion);
    } else {
      plan.versions.issues.push({
        collection: VERSIONS,
        id: String(raw.id ?? ""),
        reason: "signedAdjustments отсутствуют; источник rateDelta не хранится в версии",
        action: "выполнить контролируемый импорт/миграцию с подтверждением; автоматически не добавлять",
      });
    }
  }

  for (const raw of input.presets) {
    if (!record(raw)) continue;
    if (nonEmpty(raw.priceRef)) {
      plan.presets.migrated.push(raw);
    } else {
      plan.presets.issues.push({
        collection: PRESETS,
        id: `${String(raw.family ?? "")}:${String(raw.id ?? "")}`,
        reason: "priceRef отсутствует",
        action: "связать с PriceItem вручную по явному соответствию",
      });
    }
  }

  for (const raw of input.projects) {
    if (!record(raw)) continue;
    if (nonEmpty(raw.priceVersion)) {
      plan.projects.migrated.push(raw);
    } else {
      plan.projects.issues.push({
        collection: PROJECTS,
        id: String(raw.id ?? ""),
        reason: "priceVersion отсутствует (legacy)",
        action: "оставить без версии; автоматический пересчёт блокируется до разрешения",
      });
    }
  }

  return plan;
}

export async function migrateDataModel(options: { dryRun: boolean }): Promise<MigrationReport> {
  const [catalogs, versions, presets, projects] = await Promise.all([
    readCollection<unknown>(CATALOGS),
    readCollection<unknown>(VERSIONS),
    readCollection<unknown>(PRESETS),
    readCollection<unknown>(PROJECTS),
  ]);

  const plan = planDataModelMigration({ catalogs, versions, presets, projects });
  if (!options.dryRun && plan.catalogs.migrated.length > 0) {
    const original = [...catalogs];
    try {
      await updateCollection<CatalogItem, void>(CATALOGS, () => ({
        items: plan.catalogs.migrated,
        result: undefined,
      }));
    } catch (error) {
      // Rollback в пределах операции: восстановить исходный массив.
      await updateCollection<unknown, void>(CATALOGS, () => ({
        items: original,
        result: undefined,
      }));
      throw error;
    }
  }

  const issues = [
    ...plan.catalogs.issues,
    ...plan.versions.issues,
    ...plan.presets.issues,
    ...plan.projects.issues,
  ];
  return {
    dryRun: options.dryRun,
    migrated: {
      catalogs: plan.catalogs.migrated.length,
      versions: plan.versions.migrated.length,
      presets: plan.presets.migrated.length,
      projects: plan.projects.migrated.length,
    },
    issues,
  };
}
