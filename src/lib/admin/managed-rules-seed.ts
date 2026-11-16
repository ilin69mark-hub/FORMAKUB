import { appendAuditEvent } from "@/lib/server/audit";
import { readCollection, updateCollection } from "@/lib/server/store";
import { canonicalJson } from "@/lib/server/operation-fingerprint";
import {
  WARDROBE_FACADE_DENSITY_KG_M2,
  WARDROBE_HINGE_BANDS,
} from "@/lib/configurator/wardrobe-hinges";

import type { ActorContext } from "./parameters";
import {
  managedRuleSchema,
  type ManagedRule,
  type ManagedRuleDraftInput,
} from "./managed-rules";

/**
 * NEW-N4 / D-7 — детерминированный seed Managed Rules.
 *
 * Контракт:
 *  - фиксированные id, которые ожидает Engine (27 правил 1.1/1.2);
 *  - создаются **только draft**;
 *  - повторный запуск идемпотентен; идентичные записи не изменяются;
 *  - конфликт id/содержимого/статуса → контролируемая ошибка, без частичной записи;
 *  - active snapshot, snapshots и проекты не затрагиваются.
 *
 * D-8: source = preliminary (неподтверждённые нормы). Численные значения
 * берутся из существующих констант без изменения.
 */

const RULES = "managed-rules.json";
/**
 * D-1 (WP-2.1): sourceRef указывает на фактическую строку значения, а не на
 * широкий диапазон файла. Значения норм 1.1/1.2 хранятся константами в коде —
 * это единственный существующий артефакт; подтверждение норм владельцем
 * (OD-13) отсутствует, поэтому `source` остаётся `preliminary`.
 */
const SEED_SOURCE_FILE = "src/lib/configurator/wardrobe-hinges.ts";
/** Строки значений плотности по толщине фасада. */
const DENSITY_SOURCE_LINE: Record<16 | 19 | 22, number> = {
  16: 23,
  19: 24,
  22: 25,
};
/** Строка полосы N = BANDS_FIRST_LINE + N - 1 (8 полос подряд). */
const BANDS_FIRST_LINE = 36;

function sourceAt(line: number): string {
  return `${SEED_SOURCE_FILE}:${line}`;
}

export interface ManagedRuleSeedSpec extends ManagedRuleDraftInput {
  id: string;
}

interface SeedContent {
  name: string;
  description: string;
  category: string;
  scope: string;
  condition: unknown;
  assigns: string;
  value: unknown;
  valueType: string;
  unit: string | null;
  sourceRef: string;
  source: string;
  affects: string[];
}

function contentOf(rule: ManagedRule | SeedContent): string {
  return canonicalJson({
    name: rule.name,
    description: rule.description,
    category: rule.category,
    scope: rule.scope,
    condition: rule.condition,
    assigns: rule.assigns,
    value: rule.value,
    valueType: rule.valueType,
    unit: "unit" in rule ? (rule.unit ?? null) : null,
    sourceRef: rule.sourceRef,
    source: rule.source,
    affects: [...rule.affects],
  });
}

function baseSpec(
  id: string,
  name: string,
  description: string,
  value: number,
  valueType: "int" | "decimal",
  assigns: string,
  sourceRef: string,
): ManagedRuleSeedSpec {
  return {
    id,
    name,
    description,
    category: "norm",
    scope: "wardrobe",
    condition: { subject: "kind", operator: "equals", value: "wardrobe" },
    assigns,
    value,
    valueType,
    sourceRef,
    source: "preliminary",
    affects: ["quantity"],
  };
}

/** Ровно 27 правил (3 плотности + 8×3 полосы). */
export function managedRulesSeedSpecs(): ManagedRuleSeedSpec[] {
  const specs: ManagedRuleSeedSpec[] = [];
  for (const thickness of [16, 19, 22] as const) {
    specs.push(
      baseSpec(
        `rule-wardrobe-facade-density-${thickness}`,
        `Плотность фасада ${thickness} мм`,
        "Норма 1.2: плотность фасада для расчёта массы двери (source=preliminary до подтверждения)",
        WARDROBE_FACADE_DENSITY_KG_M2[thickness],
        "decimal",
        "line:wardrobe.fronts",
        sourceAt(DENSITY_SOURCE_LINE[thickness]),
      ),
    );
  }

  WARDROBE_HINGE_BANDS.forEach((band, index) => {
    const number = index + 1;
    specs.push(
      baseSpec(
        `rule-wardrobe-hinge-band-${number}-max-height`,
        `Полоса петель ${number}: макс. высота`,
        "Норма 1.1: верхняя граница высоты двери (source=preliminary)",
        band.maxHeightMm,
        "int",
        "line:wardrobe.fittings",
        sourceAt(BANDS_FIRST_LINE + number - 1),
      ),
      baseSpec(
        `rule-wardrobe-hinge-band-${number}-max-mass`,
        `Полоса петель ${number}: макс. масса`,
        "Норма 1.1: верхняя граница массы двери (source=preliminary)",
        band.maxMassKg,
        "decimal",
        "line:wardrobe.fittings",
        sourceAt(BANDS_FIRST_LINE + number - 1),
      ),
      baseSpec(
        `rule-wardrobe-hinge-band-${number}-count`,
        `Полоса петель ${number}: количество петель`,
        "Норма 1.1: количество петель (source=preliminary)",
        band.count,
        "int",
        "line:wardrobe.fittings",
        sourceAt(BANDS_FIRST_LINE + number - 1),
      ),
    );
  });

  return specs;
}

export interface ManagedRulesSeedResult {
  created: string[];
  skipped: string[];
}

export class ManagedRulesSeedConflictError extends Error {
  constructor(readonly conflicts: string[]) {
    super(
      `Конфликт seed Managed Rules (записи не изменены): ${conflicts.join("; ")}`,
    );
    this.name = "ManagedRulesSeedConflictError";
  }
}

/**
 * Импорт/повторный импорт seed. Атомарен в пределах коллекции правил:
 * конфликт любого id отменяет весь импорт.
 */
export async function importManagedRulesSeed(
  actor: ActorContext,
): Promise<ManagedRulesSeedResult> {
  const specs = managedRulesSeedSpecs();
  if (specs.length !== 27) {
    throw new Error(`Seed Managed Rules ожидает 27 правил, сформировано ${specs.length}.`);
  }

  const existing = await readCollection<ManagedRule>(RULES);
  const byId = new Map(existing.map((rule) => [rule.id, rule]));
  const conflicts: string[] = [];
  const missing: ManagedRuleSeedSpec[] = [];
  const skipped: string[] = [];

  for (const spec of specs) {
    const current = byId.get(spec.id);
    if (!current) {
      missing.push(spec);
      continue;
    }
    if (current.status !== "draft") {
      conflicts.push(`${spec.id}: status="${current.status}" (ожидался draft)`);
      continue;
    }
    if (contentOf(current) !== contentOf({ ...spec, unit: null })) {
      conflicts.push(`${spec.id}: содержимое отличается от seed`);
      continue;
    }
    skipped.push(spec.id);
  }

  if (conflicts.length > 0) {
    throw new ManagedRulesSeedConflictError(conflicts);
  }
  if (missing.length === 0) {
    return { created: [], skipped };
  }

  const now = new Date().toISOString();
  const created: string[] = [];
  await updateCollection<ManagedRule, void>(RULES, (items) => {
    const next = [...items];
    for (const spec of missing) {
      if (next.some((rule) => rule.id === spec.id)) {
        throw new ManagedRulesSeedConflictError([
          `${spec.id}: запись появилась во время импорта`,
        ]);
      }
      const parsed = managedRuleSchema.parse({
        ...spec,
        status: "draft",
        version: "1",
        createdAt: now,
        updatedAt: now,
        updatedBy: actor.actorId,
      });
      next.push(parsed);
      created.push(spec.id);
    }
    return { items: next, result: undefined };
  });

  await appendAuditEvent({
    action: "rule.create",
    entityType: "managedRule",
    entityId: "managed-rules-seed",
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    newValue: { import: "new-n4-seed", created, skipped, total: specs.length },
  });

  return { created, skipped };
}

/** Диагностика seed: ожидаемые id и их состояние (read-only). */
export async function inspectManagedRulesSeed(): Promise<
  Array<{ id: string; status: "missing" | "draft" | "published" | "archived" | "conflict" }>
> {
  const rules = await readCollection<ManagedRule>(RULES);
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  return managedRulesSeedSpecs().map((spec) => {
    const current = byId.get(spec.id);
    if (!current) return { id: spec.id, status: "missing" };
    if (current.status !== "draft") return { id: spec.id, status: current.status };
    return {
      id: spec.id,
      status:
        contentOf(current) === contentOf({ ...spec, unit: null })
          ? "draft"
          : "conflict",
    };
  });
}
