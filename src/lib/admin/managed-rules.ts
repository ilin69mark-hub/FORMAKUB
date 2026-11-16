import { randomBytes } from "node:crypto";

import { z } from "zod";

import { appendAuditEvent, listAuditEvents } from "@/lib/server/audit";
import {
  readCollection,
  readCollectionStatus,
  updateCollection,
} from "@/lib/server/store";
import { CALCULATION_LINE_IDS } from "@/lib/configurator/contract";

import type { ActorContext } from "./parameters";
import { canonicalJson } from "@/lib/server/operation-fingerprint";
import { evaluateRulesPublicationConfig } from "./rules-publication-config";
import {
  beginPublication,
  listRulesPublicationJournal,
  recoverRulesPublications,
  updatePublicationEntry,
} from "./rules-publication-journal";

/**
 * Managed Assembly Rules — первый срез ADR-07 (MVP-контур админки).
 *
 * Реализовано без HTTP и без интеграции в DataResolver:
 *  - контракт `ManagedRule` (утверждён Q7-13, ADR-07 §9);
 *  - хранение draft-правил (`managed-rules.json`);
 *  - валидация условий по закрытому whitelist (ADR-07 §10.1, Q7-03);
 *  - публикация полного неизменяемого снимка (`rules-snapshots.json`,
 *    ADR-07 §11.1 п.8, Q7-10);
 *  - разрешение опубликованного снимка (fail-closed, ADR-07 §10.4).
 *
 * Границы среза: нормы в расчёт не переносятся, движок и формулы не
 * меняются, `PricingVersion` не затрагивается, автопересчёт не запускается,
 * RBAC в сервисе не проверяется (как в существующих сервисах админки —
 * проверка прав остаётся на вызывающем слое/CA-T-602/603).
 */

const RULES = "managed-rules.json";
const SNAPSHOTS = "rules-snapshots.json";
const LINEAGE = "managed-rule-lineage.json";
const PRICE_ITEMS = "price-items.json";
const CATALOG_ITEMS = "catalog-items.json";

const nonEmptySchema = z.string().min(1);
const timestampSchema = z.string().datetime({ offset: true });

export const RULE_CATEGORIES = ["quantity", "purpose", "norm", "condition"] as const;
export const RULE_SCOPES = ["kitchen", "wardrobe", "shared"] as const;
export const RULE_STATUSES = ["draft", "published", "archived"] as const;
export const RULE_SOURCES = ["preliminary", "datasheet", "owner_confirmed"] as const;
export const RULE_VALUE_TYPES = ["int", "decimal", "boolean", "enum", "stringList"] as const;
export const RULE_UNITS = [
  "RUB",
  "RUB_PER_SQM",
  "RUB_PER_M",
  "RUB_PER_LINM",
  "RUB_PER_PCS",
  "FACTOR",
] as const;
export const RULE_AFFECTS = ["price", "quantity"] as const;

/** Whitelist ADR-07 §10.1 (Q7-03): операторы и предметы условия. */
export const RULE_CONDITION_OPERATORS = [
  "equals",
  "notEquals",
  "in",
  "greaterThan",
  "lessThan",
] as const;
export const RULE_CONDITION_SUBJECTS = [
  "kind",
  "moduleType",
  "zone",
  "option",
  "material",
  "facadeStyle",
  "handle",
  "dimension",
  "attribute",
  "ref",
] as const;

export const RULE_CONDITION_MAX_DEPTH = 2;
export const RULE_CONDITION_MAX_PREDICATES = 8;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];
export type RuleScope = (typeof RULE_SCOPES)[number];
export type RuleStatus = (typeof RULE_STATUSES)[number];
export type RuleSource = (typeof RULE_SOURCES)[number];
export type RuleValueType = (typeof RULE_VALUE_TYPES)[number];
export type RuleUnit = (typeof RULE_UNITS)[number];
export type RuleAffect = (typeof RULE_AFFECTS)[number];
export type RuleConditionOperator = (typeof RULE_CONDITION_OPERATORS)[number];
export type RuleConditionSubject = (typeof RULE_CONDITION_SUBJECTS)[number];

export type RuleConditionValue = string | number | boolean | string[];

export interface RuleConditionPredicate {
  readonly subject: RuleConditionSubject;
  readonly operator: RuleConditionOperator;
  readonly value: RuleConditionValue;
}

export type RuleConditionNode =
  | { readonly all: readonly RuleConditionNode[] }
  | { readonly any: readonly RuleConditionNode[] }
  | RuleConditionPredicate;

const conditionValueSchema = z.union([
  nonEmptySchema,
  z.number().finite(),
  z.boolean(),
  z.array(nonEmptySchema).min(1),
]);

const conditionPredicateSchema = z.strictObject({
  subject: z.enum(RULE_CONDITION_SUBJECTS),
  operator: z.enum(RULE_CONDITION_OPERATORS),
  value: conditionValueSchema,
});

export const ruleConditionSchema: z.ZodType<RuleConditionNode> = z.lazy(() =>
  z.union([
    conditionPredicateSchema,
    z.strictObject({ all: z.array(ruleConditionSchema).min(1) }),
    z.strictObject({ any: z.array(ruleConditionSchema).min(1) }),
  ]),
) as z.ZodType<RuleConditionNode>;

const assignsSchema = z
  .string()
  .regex(
    /^(catalog:[a-z]+:[^:]+|priceItem:[^:]+|line:[^:]+)$/,
    "assigns: catalog:<kind>:<id> | priceItem:<id> | line:<CalculationLineId>",
  );

const ruleValueSchema = z.union([
  nonEmptySchema,
  z.number().finite(),
  z.boolean(),
  z.array(nonEmptySchema),
]);

export const managedRuleSchema = z
  .strictObject({
    id: nonEmptySchema,
    name: nonEmptySchema,
    description: nonEmptySchema,
    category: z.enum(RULE_CATEGORIES),
    scope: z.enum(RULE_SCOPES),
    condition: ruleConditionSchema,
    assigns: assignsSchema,
    value: ruleValueSchema,
    valueType: z.enum(RULE_VALUE_TYPES),
    unit: z.enum(RULE_UNITS).optional(),
    status: z.enum(RULE_STATUSES),
    sourceRef: nonEmptySchema,
    source: z.enum(RULE_SOURCES),
    affects: z.array(z.enum(RULE_AFFECTS)).min(1),
    version: z.string().regex(/^\d+$/, "version: строка целого ≥ 1"),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    updatedBy: nonEmptySchema,
  })
  .superRefine((rule, ctx) => {
    if (new Set(rule.affects).size !== rule.affects.length) {
      ctx.addIssue({
        code: "custom",
        path: ["affects"],
        message: "affects не должен содержать дубликаты",
      });
    }

    const valueIssue = valueTypeIssue(rule.valueType, rule.value);
    if (valueIssue) {
      ctx.addIssue({ code: "custom", path: ["value"], message: valueIssue });
    }

    if (rule.assigns.startsWith("line:")) {
      const lineId = rule.assigns.slice("line:".length);
      if (!(CALCULATION_LINE_IDS as readonly string[]).includes(lineId)) {
        ctx.addIssue({
          code: "custom",
          path: ["assigns"],
          message: `line:"${lineId}" отсутствует в CalculationLineId`,
        });
      }
    }
  });

export type ManagedRule = z.infer<typeof managedRuleSchema>;

/** Снимок: полные копии опубликованных правил (ADR-07 §11.1 п.2/п.8). */
export const rulesSnapshotSchema = z.strictObject({
  id: nonEmptySchema,
  publishedSeq: z.number().int().positive(),
  rules: z.array(managedRuleSchema).min(1),
  /** Хеш содержимого снимка (canonical JSON правил) — проверка целостности. */
  contentHash: nonEmptySchema,
  createdAt: timestampSchema,
  createdBy: nonEmptySchema,
  publishedAt: timestampSchema,
  publishedBy: nonEmptySchema,
});

export type RulesSnapshot = z.infer<typeof rulesSnapshotSchema>;

/** Канонический хеш содержимого снимка (порядок правил — по `id`). */
export function rulesSnapshotContentHash(
  rules: readonly { id?: unknown }[],
): string {
  const sorted = [...rules].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  );
  return canonicalJson(sorted);
}

export interface RuleConditionIssue {
  path: string;
  message: string;
}

function valueTypeIssue(
  valueType: RuleValueType,
  value: unknown,
): string | undefined {
  switch (valueType) {
    case "int":
      return typeof value === "number" && Number.isInteger(value)
        ? undefined
        : "valueType=int требует целое число";
    case "decimal":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : "valueType=decimal требует конечное число";
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : "valueType=boolean требует boolean";
    case "enum":
      return typeof value === "string" && value.length > 0
        ? undefined
        : "valueType=enum требует непустую строку";
    case "stringList":
      return Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => typeof item === "string" && item.length > 0) &&
        new Set(value).size === value.length
        ? undefined
        : "valueType=stringList требует непустой массив уникальных строк";
    default:
      return undefined;
  }
}

const STRING_SUBJECTS: readonly RuleConditionSubject[] = [
  "moduleType",
  "zone",
  "material",
  "facadeStyle",
  "handle",
  "attribute",
  "ref",
];

/**
 * Структурная валидация условия по whitelist ADR-07 §10.1:
 * операторы/предметы/типы значений, глубина ≤ 2, ≤ 8 предикатов.
 * Fail-closed: любой неизвестный/несовместимый элемент — ошибка.
 */
export function validateRuleCondition(
  condition: RuleConditionNode,
): RuleConditionIssue[] {
  const issues: RuleConditionIssue[] = [];
  let predicates = 0;

  const walk = (node: RuleConditionNode, depth: number, path: string): void => {
    if ("all" in node || "any" in node) {
      const group = "all" in node ? "all" : "any";
      if (depth > RULE_CONDITION_MAX_DEPTH) {
        issues.push({
          path,
          message: `глубина вложенности > ${RULE_CONDITION_MAX_DEPTH}`,
        });
        return;
      }
      const children = "all" in node ? node.all : node.any;
      children.forEach((child, index) =>
        walk(child, depth + 1, `${path}.${group}[${index}]`),
      );
      return;
    }

    predicates += 1;
    const { subject, operator, value } = node;
    const scalarArray = Array.isArray(value);

    if (operator === "in") {
      if (!scalarArray) {
        issues.push({ path, message: "оператор in требует массив значений" });
      } else if (subject === "kind") {
        const invalid = value.filter(
          (item) => item !== "kitchen" && item !== "wardrobe",
        );
        if (invalid.length > 0) {
          issues.push({ path, message: "kind: допустимы kitchen | wardrobe" });
        }
      } else if (subject === "dimension" || subject === "option") {
        issues.push({
          path,
          message: `оператор in недопустим для subject=${subject}`,
        });
      }
      return;
    }

    if (scalarArray) {
      issues.push({
        path,
        message: "массив значений допустим только для оператора in",
      });
      return;
    }

    if (operator === "greaterThan" || operator === "lessThan") {
      if (subject !== "dimension") {
        issues.push({
          path,
          message: `${operator} допустим только для subject=dimension`,
        });
        return;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push({ path, message: `${operator} требует конечное число` });
      }
      return;
    }

    if (subject === "dimension") {
      issues.push({
        path,
        message: "dimension допускает только greaterThan | lessThan",
      });
      return;
    }

    if (subject === "kind") {
      if (value !== "kitchen" && value !== "wardrobe") {
        issues.push({ path, message: "kind: допустимы kitchen | wardrobe" });
      }
      return;
    }

    if (subject === "option") {
      if (typeof value !== "boolean") {
        issues.push({ path, message: "option требует boolean" });
      }
      return;
    }

    if (STRING_SUBJECTS.includes(subject)) {
      if (typeof value !== "string" || value.length === 0) {
        issues.push({ path, message: `${subject} требует непустую строку` });
      }
      return;
    }
  };

  walk(condition, 1, "condition");

  if (predicates > RULE_CONDITION_MAX_PREDICATES) {
    issues.push({
      path: "condition",
      message: `предикатов ${predicates} > ${RULE_CONDITION_MAX_PREDICATES}`,
    });
  }

  return issues;
}

function assertCondition(condition: RuleConditionNode): void {
  const issues = validateRuleCondition(condition);
  if (issues.length > 0) {
    throw new Error(
      `Условие правила отклонено whitelist (ADR-07 §10.1): ${issues
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ")}`,
    );
  }
}

/** Публичный ввод при создании/редактировании правила (draft). */
export const managedRuleDraftInputSchema = z.strictObject({
  name: nonEmptySchema,
  description: nonEmptySchema,
  category: z.enum(RULE_CATEGORIES),
  scope: z.enum(RULE_SCOPES),
  condition: ruleConditionSchema,
  assigns: assignsSchema,
  value: ruleValueSchema,
  valueType: z.enum(RULE_VALUE_TYPES),
  unit: z.enum(RULE_UNITS).optional(),
  sourceRef: nonEmptySchema,
  source: z.enum(RULE_SOURCES),
  affects: z.array(z.enum(RULE_AFFECTS)).min(1),
});

export type ManagedRuleDraftInput = z.infer<typeof managedRuleDraftInputSchema>;

export const managedRulePatchSchema = managedRuleDraftInputSchema
  .partial()
  .extend({ expectedVersion: nonEmptySchema });

export type ManagedRulePatch = z.infer<typeof managedRulePatchSchema>;

function nextVersion(version: string): string {
  const current = Number.parseInt(version, 10);
  if (!Number.isFinite(current) || current < 1) {
    throw new Error(`Некорректная версия правила "${version}".`);
  }
  return String(current + 1);
}

/** Список правил (все статусы) — read-only. */
export async function listManagedRules(): Promise<ManagedRule[]> {
  const raw = await readCollection<unknown>(RULES);
  return raw.map((item) => managedRuleSchema.parse(item));
}

/** Правило по id — read-only; `undefined`, если не найдено. */
export async function getManagedRule(id: string): Promise<ManagedRule | undefined> {
  const rules = await listManagedRules();
  return rules.find((rule) => rule.id === id);
}

/** Все опубликованные снимки (для admin read API), новые первыми. */
export async function listRulesSnapshots(): Promise<RulesSnapshot[]> {
  const raw = await readCollection<unknown>(SNAPSHOTS);
  return raw
    .map((item) => rulesSnapshotSchema.parse(item))
    .sort((a, b) => b.publishedSeq - a.publishedSeq);
}

/**
 * Редакции одной линии правил: корень линии и все ревизии.
 * Связь хранится в `managed-rule-lineage.json` (вне состава правила).
 */
export async function listRuleRevisions(ruleId: string): Promise<ManagedRule[]> {
  const [rules, lineage] = await Promise.all([
    listManagedRules(),
    readRuleLineage(),
  ]);
  const parentByRule = new Map(lineage.map((entry) => [entry.ruleId, entry.parentId]));
  const rootOf = (id: string): string => {
    let current = id;
    let guard = 0;
    while (parentByRule.has(current) && guard < 50) {
      current = parentByRule.get(current)!;
      guard += 1;
    }
    return current;
  };
  const target = rules.find((rule) => rule.id === ruleId);
  if (!target) return [];
  const root = rootOf(ruleId);
  return rules
    .filter((rule) => rootOf(rule.id) === root)
    .sort((a, b) => Number(a.version) - Number(b.version));
}

/**
 * Production-публикация: см. `rules-publication-config.ts` (D-9).
 * Совместимый ре-экспорт предиката сохранён для вызывающих/тестов.
 */
export { rulesPublicationBlocked } from "./rules-publication-config";

/** Создание правила: всегда `draft`, без публикации и без влияния на расчёт. */
export async function createManagedRule(
  input: ManagedRuleDraftInput,
  actor: ActorContext,
): Promise<ManagedRule> {
  assertCondition(input.condition);
  const now = new Date().toISOString();
  const id = `rule-${randomBytes(6).toString("hex")}`;

  const created = await updateCollection<ManagedRule, ManagedRule>(
    RULES,
    (items) => {
      if (items.some((item) => item.id === id)) {
        throw new Error(`Правило "${id}" уже существует.`);
      }
      const parsed = managedRuleSchema.parse({
        ...input,
        id,
        status: "draft",
        version: "1",
        createdAt: now,
        updatedAt: now,
        updatedBy: actor.actorId,
      });
      return { items: [...items, parsed], result: parsed };
    },
  );

  await appendAuditEvent({
    action: "rule.create",
    entityType: "managedRule",
    entityId: created.id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    newValue: { id: created.id, status: created.status, version: created.version },
  });

  return created;
}

/**
 * Редактирование **draft**-правила (инкремент `version`).
 * Опубликованная редакция неизменяема: изменение — только через
 * `createManagedRuleRevision` (новая draft-редакция). `archived` не редактируется.
 * Публикация снимка не выполняется — только отдельной операцией.
 */
export async function updateManagedRule(
  id: string,
  patch: ManagedRulePatch,
  actor: ActorContext,
): Promise<ManagedRule> {
  let previous: ManagedRule | undefined;

  const updated = await updateCollection<ManagedRule, ManagedRule>(
    RULES,
    (items) => {
      const current = items.find((item) => item.id === id);
      if (!current) throw new Error(`Правило "${id}" не найдено.`);
      if (current.status === "archived") {
        throw new Error(`Правило "${id}" архивировано — редактирование запрещено.`);
      }
      if (current.status === "published") {
        throw new Error(
          `Правило "${id}" опубликовано и неизменяемо: изменение — только новой draft-редакцией (createManagedRuleRevision).`,
        );
      }
      if (current.version !== patch.expectedVersion) {
        throw new Error(
          `Конфликт версий правила "${id}": ожидалась "${patch.expectedVersion}", текущая "${current.version}" (409).`,
        );
      }

      const candidate = {
        ...current,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.category === undefined ? {} : { category: patch.category }),
        ...(patch.scope === undefined ? {} : { scope: patch.scope }),
        ...(patch.condition === undefined ? {} : { condition: patch.condition }),
        ...(patch.assigns === undefined ? {} : { assigns: patch.assigns }),
        ...(patch.value === undefined ? {} : { value: patch.value }),
        ...(patch.valueType === undefined ? {} : { valueType: patch.valueType }),
        ...(patch.unit === undefined ? {} : { unit: patch.unit }),
        ...(patch.sourceRef === undefined ? {} : { sourceRef: patch.sourceRef }),
        ...(patch.source === undefined ? {} : { source: patch.source }),
        ...(patch.affects === undefined ? {} : { affects: patch.affects }),
        version: nextVersion(current.version),
        updatedAt: new Date().toISOString(),
        updatedBy: actor.actorId,
      };

      assertCondition(candidate.condition);
      const parsed = managedRuleSchema.parse(candidate);
      previous = current;
      return {
        items: items.map((item) => (item.id === id ? parsed : item)),
        result: parsed,
      };
    },
  );

  await appendAuditEvent({
    action: "rule.update",
    entityType: "managedRule",
    entityId: id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    oldValue: previous
      ? { id, version: previous.version, status: previous.status }
      : undefined,
    newValue: { id, version: updated.version, status: updated.status },
  });

  return updated;
}

interface AssignsTarget {
  kind: "catalog" | "priceItem" | "line";
  ref: string;
}

function parseAssigns(assigns: string): AssignsTarget {
  if (assigns.startsWith("catalog:")) {
    return { kind: "catalog", ref: assigns.slice("catalog:".length) };
  }
  if (assigns.startsWith("priceItem:")) {
    return { kind: "priceItem", ref: assigns.slice("priceItem:".length) };
  }
  if (assigns.startsWith("line:")) {
    return { kind: "line", ref: assigns.slice("line:".length) };
  }
  throw new Error(`Некорректная ссылка assigns "${assigns}".`);
}

async function assignsIssues(rule: ManagedRule): Promise<string[]> {
  const issues: string[] = [];
  const target = parseAssigns(rule.assigns);

  if (rule.affects.includes("price") && target.kind !== "priceItem") {
    issues.push(
      `Правило "${rule.id}" влияет на цену: assigns обязан быть priceItem:<id>, получено "${rule.assigns}" (ADR-07 §12 п.4).`,
    );
    return issues;
  }

  if (target.kind === "priceItem") {
    const items = await readCollection<Record<string, unknown>>(PRICE_ITEMS);
    if (!items.some((item) => item.id === target.ref)) {
      issues.push(
        `Правило "${rule.id}": PriceItem "${target.ref}" не найден (fail-closed).`,
      );
    }
    return issues;
  }

  if (target.kind === "catalog") {
    const [catalog, ...rest] = target.ref.split(":");
    const catalogId = rest.join(":");
    const items = await readCollection<Record<string, unknown>>(CATALOG_ITEMS);
    if (
      !items.some(
        (item) => item.catalog === catalog && item.id === catalogId,
      )
    ) {
      issues.push(
        `Правило "${rule.id}": CatalogItem "${target.ref}" не найден (fail-closed).`,
      );
    }
    return issues;
  }

  if (!(CALCULATION_LINE_IDS as readonly string[]).includes(target.ref)) {
    issues.push(
      `Правило "${rule.id}": CalculationLineId "${target.ref}" не существует.`,
    );
  }
  return issues;
}

/**
 * Проверка ссылок и состава снимка для preflight перехода проекта (Q7-11).
 * Публикация использует тот же набор проверок; здесь он возвращает список
 * проблем вместо throw, чтобы вызывающий слой принял решение и не изменил
 * проект при любой ошибке.
 */
export async function rulesSnapshotReferenceIssues(
  rules: readonly ManagedRule[],
): Promise<string[]> {
  const issues: string[] = [];
  for (const rule of rules) {
    if (rule.status !== "published" || rule.source === "preliminary") {
      issues.push(
        `Правило "${rule.id}": в снимке допустимы только status=published и source≠preliminary.`,
      );
      continue;
    }
    issues.push(...(await assignsIssues(rule)));
  }
  return issues;
}

function deepCopyRule(rule: ManagedRule): ManagedRule {
  return JSON.parse(JSON.stringify(rule)) as ManagedRule;
}

export type ManagedRuleRevisionInput = Partial<ManagedRuleDraftInput> & {
  /** Версия опубликованной редакции, от которой создаётся новая draft. */
  expectedVersion: string;
};

/** Связь «новая редакция → предыдущая опубликованная» (вне состава правила). */
interface RuleLineageEntry {
  ruleId: string;
  parentId: string;
  createdAt: string;
}

async function readRuleLineage(): Promise<RuleLineageEntry[]> {
  const read = await readCollectionStatus<RuleLineageEntry>(LINEAGE);
  return read.status === "ok" ? read.items : [];
}

function collectAncestors(
  ruleId: string,
  parentByRule: Map<string, string>,
): Set<string> {
  const ancestors = new Set<string>();
  let current = parentByRule.get(ruleId);
  let guard = 0;
  while (current && !ancestors.has(current) && guard < 50) {
    ancestors.add(current);
    current = parentByRule.get(current);
    guard += 1;
  }
  return ancestors;
}

/**
 * Новая draft-редакция опубликованного правила (immutable published-revision).
 * Создаётся отдельная запись (`id` новый, `version` = parent+1), исходная
 * опубликованная запись не изменяется. Публикация — отдельной операцией.
 */
export async function createManagedRuleRevision(
  publishedRuleId: string,
  patch: ManagedRuleRevisionInput,
  actor: ActorContext,
): Promise<ManagedRule> {
  const now = new Date().toISOString();
  const newId = `rule-${randomBytes(6).toString("hex")}`;

  const created = await updateCollection<ManagedRule, ManagedRule>(
    RULES,
    (items) => {
      const parent = items.find((item) => item.id === publishedRuleId);
      if (!parent) throw new Error(`Правило "${publishedRuleId}" не найдено.`);
      if (parent.status !== "published") {
        throw new Error(
          `Новая редакция создаётся только от опубликованного правила; "${publishedRuleId}" имеет status="${parent.status}".`,
        );
      }
      if (parent.version !== patch.expectedVersion) {
        throw new Error(
          `Конфликт версий правила "${publishedRuleId}": ожидалась "${patch.expectedVersion}", текущая "${parent.version}" (409).`,
        );
      }

      const candidate = {
        ...parent,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.category === undefined ? {} : { category: patch.category }),
        ...(patch.scope === undefined ? {} : { scope: patch.scope }),
        ...(patch.condition === undefined ? {} : { condition: patch.condition }),
        ...(patch.assigns === undefined ? {} : { assigns: patch.assigns }),
        ...(patch.value === undefined ? {} : { value: patch.value }),
        ...(patch.valueType === undefined ? {} : { valueType: patch.valueType }),
        ...(patch.unit === undefined ? {} : { unit: patch.unit }),
        ...(patch.sourceRef === undefined ? {} : { sourceRef: patch.sourceRef }),
        ...(patch.source === undefined ? {} : { source: patch.source }),
        ...(patch.affects === undefined ? {} : { affects: patch.affects }),
        id: newId,
        status: "draft",
        version: nextVersion(parent.version),
        createdAt: now,
        updatedAt: now,
        updatedBy: actor.actorId,
      };

      assertCondition(candidate.condition);
      const parsed = managedRuleSchema.parse(candidate);
      return { items: [...items, parsed], result: parsed };
    },
  );

  await appendAuditEvent({
    action: "rule.create",
    entityType: "managedRule",
    entityId: created.id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    newValue: {
      id: created.id,
      status: created.status,
      version: created.version,
      revisionOf: publishedRuleId,
    },
  });

  await updateCollection<RuleLineageEntry, void>(LINEAGE, (items) => ({
    items: [
      ...items,
      { ruleId: created.id, parentId: publishedRuleId, createdAt: now },
    ],
    result: undefined,
  }));

  return created;
}

export interface RuleSelectionItem {
  id: string;
  /** Ожидаемая версия выбранного правила (optimistic locking публикации). */
  expectedVersion: string;
}

interface PublishRulesResult {
  snapshot: RulesSnapshot;
  rulesCount: number;
  publishedRuleIds: string[];
  replay: boolean;
}

/**
 * Публикация выбранных draft-правил и полного неизменяемого снимка.
 *
 * Правила:
 *  - выбор **явный**: `selection` непустой, без дубликатов; каждое правило
 *    существует, не archived, `version` совпадает с `expectedVersion`;
 *  - публикуются только выбранные draft-правила; автоматическая публикация
 *    всех draft-правил не выполняется;
 *  - `preliminary` не публикуется (Q7-06);
 *  - в снимок входят **все** опубликованные правила (ранее + выбранные) —
 *    полная копия содержимого (Q7-10), `contentHash` фиксирует целостность;
 *  - повторная публикация того же содержимого не создаёт дубликат снимка —
 *    возвращается существующий (`replay: true`), выбранные draft-правила
 *    доводятся до `published` (восстановление после сбоя между записями);
 *  - опубликованные редакции неизменяемы; status меняется один раз
 *    (`draft → published`), `version`/`updatedAt` не переписываются.
 */
export async function publishRulesSnapshot(
  selection: readonly RuleSelectionItem[],
  actor: ActorContext,
  options: { operationId?: string } = {},
): Promise<PublishRulesResult> {
  const publication = evaluateRulesPublicationConfig();
  if (publication.blocked) {
    throw new Error(publication.reason ?? "Публикация правил заблокирована.");
  }
  if (!Array.isArray(selection) || selection.length === 0) {
    throw new Error(
      "Публикация требует явного непустого выбора draft-правил (автоматическая публикация всех draft запрещена).",
    );
  }
  const selectedIds = selection.map((item) => item.id.trim());
  if (selectedIds.some((id) => id.length === 0)) {
    throw new Error("Выбор публикации содержит пустой id правила.");
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error("Выбор публикации содержит дубликаты id правил.");
  }

  const rules = await listManagedRules();
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const selected: ManagedRule[] = [];
  for (const item of selection) {
    const rule = byId.get(item.id.trim());
    if (!rule) throw new Error(`Правило "${item.id}" не найдено.`);
    if (rule.status === "archived") {
      throw new Error(`Правило "${rule.id}" архивировано — публикация запрещена.`);
    }
    if (rule.version !== item.expectedVersion) {
      throw new Error(
        `Конфликт версий правила "${rule.id}": ожидалась "${item.expectedVersion}", текущая "${rule.version}" (409).`,
      );
    }
    if (rule.status === "draft" && rule.source === "preliminary") {
      throw new Error(
        `Правило "${rule.id}" имеет source=preliminary и не может быть опубликовано (Q7-06).`,
      );
    }
    selected.push(rule);
  }

  const draftSelected = selected.filter((rule) => rule.status === "draft");
  const lineage = await readRuleLineage();
  const parentByRule = new Map(lineage.map((entry) => [entry.ruleId, entry.parentId]));
  const superseded = new Set<string>();
  for (const draft of draftSelected) {
    for (const ancestor of collectAncestors(draft.id, parentByRule)) {
      superseded.add(ancestor);
    }
  }

  const candidate = new Map<string, ManagedRule>();
  for (const rule of rules) {
    if (rule.status === "published" && !superseded.has(rule.id)) {
      candidate.set(rule.id, { ...rule, status: "published" });
    }
  }
  for (const rule of draftSelected) {
    candidate.set(rule.id, { ...rule, status: "published" });
  }

  if (candidate.size === 0) {
    throw new Error(
      "Публикация невозможна: в выборе нет draft-правил и нет опубликованных правил.",
    );
  }

  const content = [...candidate.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(deepCopyRule);

  for (const rule of content) {
    assertCondition(rule.condition);
  }
  const referenceIssues = await rulesSnapshotReferenceIssues(content);
  if (referenceIssues.length > 0) {
    throw new Error(
      `Публикация снимка запрещена (fail-closed): ${referenceIssues.join("; ")}`,
    );
  }

  const contentHash = rulesSnapshotContentHash(content);
  const now = new Date().toISOString();

  function normalizeSelection(
    value: readonly { id: string; expectedVersion: string }[],
  ): string {
    return value
      .map((item) => `${item.id.trim()}@${item.expectedVersion}`)
      .sort()
      .join("|");
  }

  // D-10: journal обязателен для любой успешной публикации. Если operationId
  // не передан доверенным серверным клиентом, он генерируется здесь.
  let operationId = options.operationId?.trim();

  if (!operationId) {
    await recoverRulesPublications();
    const normalized = normalizeSelection(selection);
    const reusable = (await listRulesPublicationJournal()).find(
      (entry) =>
        entry.phase === "completed" &&
        entry.contentHash === contentHash &&
        normalizeSelection(entry.selection) === normalized &&
        entry.auditEventId !== undefined &&
        entry.snapshotId !== undefined,
    );
    if (reusable) {
      const snapshots = await listRulesSnapshots();
      const snapshot = snapshots.find((item) => item.id === reusable.snapshotId);
      if (snapshot) {
        return {
          snapshot,
          rulesCount: snapshot.rules.length,
          publishedRuleIds: reusable.publishedRuleIds ?? selection.map((item) => item.id),
          replay: true,
        };
      }
    }
    operationId = `rules-publish-${randomBytes(8).toString("hex")}`;
  }

  await recoverRulesPublications();
  const existingAudit = (
    await listAuditEvents({ action: "rule.publish" })
  ).find((event) => event.requestId === operationId);
  if (existingAudit) {
    const snapshots = await listRulesSnapshots();
    const snapshot = snapshots.find(
      (item) => item.id === existingAudit.entityId,
    );
    if (!snapshot) {
      throw new Error(
        `Аудит публикации "${operationId}" существует, но snapshot "${existingAudit.entityId}" не найден — требуется восстановление из backup.`,
      );
    }
    const journalEntry = (await listRulesPublicationJournal()).find(
      (entry) => entry.operationId === operationId,
    );
    if (!journalEntry) {
      await beginPublication({
        operationId,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        selection: selection.map((item) => ({
          id: item.id.trim(),
          expectedVersion: item.expectedVersion,
        })),
        contentHash,
      });
    }
    await updatePublicationEntry(operationId, {
      phase: "completed",
      snapshotId: snapshot.id,
      publishedSeq: snapshot.publishedSeq,
      rulesCount: snapshot.rules.length,
      publishedRuleIds: selection.map((item) => item.id),
      auditEventId: existingAudit.id,
    });
    const payload = (existingAudit.newValue ?? {}) as {
      publishedRuleIds?: unknown;
    };
    return {
      snapshot,
      rulesCount: snapshot.rules.length,
      publishedRuleIds: Array.isArray(payload.publishedRuleIds)
        ? (payload.publishedRuleIds as string[])
        : selection.map((item) => item.id),
      replay: true,
    };
  }

  await beginPublication({
    operationId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    selection: selection.map((item) => ({
      id: item.id.trim(),
      expectedVersion: item.expectedVersion,
    })),
    contentHash,
  });

  let replay = false;

  const snapshot = await updateCollection<RulesSnapshot, RulesSnapshot>(
    SNAPSHOTS,
    (items) => {
      const existing = items.find((item) => item.contentHash === contentHash);
      if (existing) {
        replay = true;
        return { items, result: existing };
      }
      const publishedSeq =
        items.reduce((max, item) => Math.max(max, item.publishedSeq), 0) + 1;
      const parsed = rulesSnapshotSchema.parse({
        id: `rules-${randomBytes(8).toString("hex")}`,
        publishedSeq,
        rules: content,
        contentHash,
        createdAt: now,
        createdBy: actor.actorId,
        publishedAt: now,
        publishedBy: actor.actorId,
      });
      return { items: [...items, parsed], result: parsed };
    },
  );

  await updatePublicationEntry(operationId, {
    phase: "snapshot_created",
    snapshotId: snapshot.id,
    publishedSeq: snapshot.publishedSeq,
    rulesCount: snapshot.rules.length,
    publishedRuleIds: draftSelected.map((rule) => rule.id),
  });

  // Публикация выбранных draft-правил: status; предыдущие опубликованные
  // редакции той же линии переводятся в archived (содержимое неизменно).
  if (draftSelected.length > 0) {
    const expected = new Map(
      selection.map((item) => [item.id.trim(), item.expectedVersion]),
    );
    await updateCollection<ManagedRule, void>(RULES, (items) => ({
      items: items.map((rule) => {
        const draft = draftSelected.find((entry) => entry.id === rule.id);
        if (
          draft &&
          rule.status === "draft" &&
          rule.version === expected.get(rule.id)
        ) {
          return { ...rule, status: "published" as const };
        }
        if (rule.status === "published" && superseded.has(rule.id)) {
          return { ...rule, status: "archived" as const };
        }
        return rule;
      }),
      result: undefined,
    }));
  }

  await updatePublicationEntry(operationId, {
    phase: "rules_promoted",
    publishedRuleIds: draftSelected.map((rule) => rule.id),
  });
  await updatePublicationEntry(operationId, { phase: "audit_pending" });
  const event = await appendAuditEvent({
    action: "rule.publish",
    entityType: "rulesSnapshot",
    entityId: snapshot.id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    requestId: operationId,
    newValue: {
      snapshotId: snapshot.id,
      publishedSeq: snapshot.publishedSeq,
      rulesCount: snapshot.rules.length,
      publishedRuleIds: draftSelected.map((rule) => rule.id),
      contentHash,
    },
  });
  await updatePublicationEntry(operationId, {
    phase: "completed",
    auditEventId: event.id,
  });

  return {
    snapshot,
    rulesCount: snapshot.rules.length,
    publishedRuleIds: draftSelected.map((rule) => rule.id),
    replay,
  };
}

export type RulesSnapshotResolution =
  | { status: "none" }
  | { status: "ok"; snapshot: RulesSnapshot }
  | {
      status: "error";
      code: "unknown" | "corrupt" | "invalid";
      issues: string[];
    };

function parseSnapshot(
  raw: unknown,
): { ok: true; snapshot: RulesSnapshot } | { ok: false; issues: string[] } {
  const parsed = rulesSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (item) => `${item.path.join(".")}: ${item.message}`,
      ),
    };
  }
  const invalid = parsed.data.rules.filter(
    (rule) => rule.status !== "published" || rule.source === "preliminary",
  );
  if (invalid.length > 0) {
    return {
      ok: false,
      issues: [
        `снимок содержит недопустимые записи (draft/preliminary): ${invalid
          .map((rule) => rule.id)
          .join(", ")}`,
      ],
    };
  }
  if (rulesSnapshotContentHash(parsed.data.rules) !== parsed.data.contentHash) {
    return {
      ok: false,
      issues: ["contentHash снимка не совпадает с содержимым — целостность нарушена"],
    };
  }
  return { ok: true, snapshot: parsed.data };
}

/**
 * Активный опубликованный снимок: запись с максимальным `publishedSeq`.
 * `none` — слой ещё не активирован (ни одной публикации).
 * `error` — чтение/формат повреждены (fail-closed, без подстановки).
 */
export async function resolveActiveRulesSnapshot(): Promise<RulesSnapshotResolution> {
  const read = await readCollectionStatus<unknown>(SNAPSHOTS);
  if (read.status === "missing") return { status: "none" };
  if (read.status === "corrupt") {
    return {
      status: "error",
      code: "corrupt",
      issues: [`rules-snapshots.json повреждён: ${read.reason}`],
    };
  }
  if (read.items.length === 0) return { status: "none" };

  let active: RulesSnapshot | undefined;
  for (const raw of read.items) {
    const parsed = parseSnapshot(raw);
    if (!parsed.ok) {
      return { status: "error", code: "invalid", issues: parsed.issues };
    }
    if (!active || parsed.snapshot.publishedSeq > active.publishedSeq) {
      active = parsed.snapshot;
    }
  }

  return active ? { status: "ok", snapshot: active } : { status: "none" };
}

/** Разрешение снимка по id (закрепление проекта) — fail-closed. */
export async function resolveRulesSnapshotById(
  rulesSnapshotId: string,
): Promise<RulesSnapshotResolution> {
  if (typeof rulesSnapshotId !== "string" || rulesSnapshotId.length === 0) {
    return { status: "error", code: "unknown", issues: ["rulesSnapshotId пуст"] };
  }
  const read = await readCollectionStatus<unknown>(SNAPSHOTS);
  if (read.status === "missing") {
    return {
      status: "error",
      code: "unknown",
      issues: ["rules-snapshots.json отсутствует: снимок неразрешим"],
    };
  }
  if (read.status === "corrupt") {
    return {
      status: "error",
      code: "corrupt",
      issues: [`rules-snapshots.json повреждён: ${read.reason}`],
    };
  }
  const raw = read.items.find(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (item as { id?: unknown }).id === rulesSnapshotId,
  );
  if (!raw) {
    return {
      status: "error",
      code: "unknown",
      issues: [`снимок "${rulesSnapshotId}" не найден — подстановка запрещена`],
    };
  }
  const parsed = parseSnapshot(raw);
  return parsed.ok
    ? { status: "ok", snapshot: parsed.snapshot }
    : { status: "error", code: "invalid", issues: parsed.issues };
}
