import { randomUUID } from "node:crypto";

import { appendAuditEvent, listAuditEvents } from "@/lib/server/audit";
import { readCollection, readCollectionStatus, updateCollection } from "@/lib/server/store";
import type { ActorContext } from "./parameters";
import { getPublishedVersion } from "./pricing";
import { listPriceItems } from "./price-items";
import {
  resolveActiveRulesSnapshot,
  resolveRulesSnapshotById,
  type RulesSnapshot,
} from "./managed-rules";
import type { CatalogItem, PricingVersion } from "./schema";
import type { FurnitureConfig, StoredProject } from "@/lib/configurator/types";
import type { PriceSnapshotInput } from "@/lib/configurator/contract";

import {
  compositionLineSchema,
  compositionVersionSchema,
  type CompositionConfirmation,
  type CompositionIssue,
  type CompositionLine,
  type CompositionPins,
  type CompositionProduction,
  type CompositionValidationResult,
  type CompositionVersion,
} from "./composition-schema";
import { compositionContentHash } from "./composition-hash";
import { isCompositionCodeRef } from "./composition-code-registry";
import {
  beginCompositionPublication,
  listCompositionPublicationJournal,
  recoverCompositionPublications,
  updateCompositionPublication,
} from "./composition-journal";
import {
  beginCompositionOperation,
  updateCompositionOperation,
} from "./composition-transition-journal";

/**
 * Composition Management — управляемый, версионируемый состав модулей.
 *
 * Границы:
 * - физический компонент → CatalogItem;
 * - тариф → PriceItem; сумма → PricingVersion.snapshot;
 * - норма/условие → ManagedRule/RulesSnapshot;
 * - CompositionLine не хранит ни сумму, ни формулу, ни норму количества;
 * - Engine не читает состав; DataResolver выполняет только preflight.
 */

export const COMPOSITION_COLLECTION = "composition-versions.json";
export const COMPOSITION_SCHEMA_VERSION = 1;

export class CompositionValidationError extends Error {
  readonly issues: CompositionIssue[];
  constructor(issues: CompositionIssue[]) {
    super(
      issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join("; ") || "Состав не прошёл проверку.",
    );
    this.name = "CompositionValidationError";
    this.issues = issues;
  }
}

export { compositionContentHash };

function sortLines(lines: readonly CompositionLine[]): CompositionLine[] {
  return [...lines].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );
}

function lineContentKey(line: CompositionLine): string {
  return JSON.stringify({
    id: line.id,
    moduleType: line.moduleType,
    componentCatalog: line.componentCatalog ?? null,
    componentId: line.componentId ?? null,
    priceItemId: line.priceItemId ?? null,
    relation: line.relation,
    alternativeGroup: line.alternativeGroup ?? null,
    quantityRef: line.quantityRef,
    condition: line.condition ?? null,
    sourceRef: line.sourceRef,
    source: line.source,
    confirmation: line.confirmation ?? null,
  });
}

interface CompositionStoreRead {
  versions: CompositionVersion[];
  issues: string[];
}

async function readCompositionStore(): Promise<CompositionStoreRead> {
  const read = await readCollectionStatus<unknown>(COMPOSITION_COLLECTION);
  if (read.status === "missing") return { versions: [], issues: [] };
  if (read.status === "corrupt") {
    return {
      versions: [],
      issues: [`composition-versions.json повреждён: ${read.reason}`],
    };
  }
  const versions: CompositionVersion[] = [];
  const issues: string[] = [];
  for (const raw of read.items) {
    const parsed = compositionVersionSchema.safeParse(raw);
    if (!parsed.success) {
      issues.push(
        `composition-versions.json: запись не проходит schema: ${parsed.error.message}`,
      );
      continue;
    }
    const expected = compositionContentHash(
      parsed.data.lines,
      parsed.data.rulesSnapshotId,
      parsed.data.pins,
    );
    if (expected !== parsed.data.contentHash) {
      issues.push(
        `composition-versions.json: "${parsed.data.id}" имеет неверный contentHash.`,
      );
      continue;
    }
    versions.push(parsed.data);
  }
  return { versions, issues };
}

async function readVersions(): Promise<CompositionVersion[]> {
  return (await readCompositionStore()).versions;
}

export async function listCompositionIssues(): Promise<string[]> {
  return (await readCompositionStore()).issues;
}

export async function listCompositionVersions(): Promise<CompositionVersion[]> {
  return [...(await readVersions())].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export async function getCompositionVersion(
  id: string,
): Promise<CompositionVersion | undefined> {
  return (await readVersions()).find((version) => version.id === id);
}

export async function getPublishedComposition(): Promise<
  CompositionVersion | undefined
> {
  const published = (await readVersions()).filter(
    (version) => version.status === "published",
  );
  if (published.length > 1) {
    throw new Error(
      `Обнаружено несколько published-версий состава (${published
        .map((item) => item.id)
        .join(", ")}); active composition не определён.`,
    );
  }
  return published[0];
}

export async function getDraftComposition(): Promise<
  CompositionVersion | undefined
> {
  const drafts = (await readVersions()).filter(
    (version) => version.status === "draft",
  );
  if (drafts.length > 1) {
    throw new Error(
      `Обнаружено несколько draft-версий состава (${drafts
        .map((item) => item.id)
        .join(", ")}); необходима ручная нормализация.`,
    );
  }
  return drafts[0];
}

function newDraftId(): string {
  return `composition-${new Date().toISOString().slice(0, 10).replace(/-/g, ".")}-${randomUUID().slice(0, 8)}`;
}

function parseFullVersion(version: CompositionVersion): CompositionVersion {
  const parsed = compositionVersionSchema.safeParse(version);
  if (!parsed.success) {
    throw new Error(
      `CompositionVersion не проходит schema: ${parsed.error.issues
        .map((item) => `${item.path.join(".")}: ${item.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

function usesRules(version: CompositionVersion): boolean {
  return version.lines.some(
    (line) =>
      line.quantityRef.kind === "managed_rule" ||
      line.condition?.kind === "managed_rule",
  );
}

function issue(
  severity: CompositionIssue["severity"],
  code: string,
  message: string,
  lineId?: string,
  entityId?: string,
): CompositionIssue {
  return {
    severity,
    code,
    message,
    ...(lineId ? { lineId } : {}),
    ...(entityId ? { entityId } : {}),
  };
}

interface SnapshotResolution {
  snapshot: RulesSnapshot | null;
  issues: CompositionIssue[];
}

async function resolveSnapshotForValidation(
  version: CompositionVersion,
  overrideId?: string,
): Promise<SnapshotResolution> {
  if (!usesRules(version) && !overrideId) {
    return { snapshot: null, issues: [] };
  }
  const id = overrideId ?? version.rulesSnapshotId;
  if (id) {
    const resolved = await resolveRulesSnapshotById(id);
    if (resolved.status !== "ok") {
      const reason =
        resolved.status === "none"
          ? "снимок не найден"
          : resolved.issues.join("; ");
      return {
        snapshot: null,
        issues: [
          issue(
            "error",
            "COMPOSITION_RULES_SNAPSHOT_UNRESOLVED",
            `RulesSnapshot "${id}" не разрешён: ${reason}`,
          ),
        ],
      };
    }
    return { snapshot: resolved.snapshot, issues: [] };
  }
  const active = await resolveActiveRulesSnapshot();
  if (active.status === "ok") return { snapshot: active.snapshot, issues: [] };
  return {
    snapshot: null,
    issues: usesRules(version)
      ? [
          issue(
            "error",
            "COMPOSITION_RULES_SNAPSHOT_MISSING",
            "Для rule-ref строк требуется активный или закреплённый RulesSnapshot.",
          ),
        ]
      : [],
  };
}

function checkRuleReference(
  snapshot: RulesSnapshot | null,
  ruleId: string,
  lineId: string,
  path: string,
): CompositionIssue[] {
  if (!snapshot) {
    return [
      issue(
        "error",
        "COMPOSITION_RULES_SNAPSHOT_MISSING",
        `${path}: нет RulesSnapshot для "${ruleId}".`,
        lineId,
        ruleId,
      ),
    ];
  }
  const rule = snapshot.rules.find((item) => item.id === ruleId);
  if (!rule) {
    return [
      issue(
        "error",
        "COMPOSITION_RULE_NOT_IN_SNAPSHOT",
        `${path}: правило "${ruleId}" отсутствует в снимке "${snapshot.id}".`,
        lineId,
        ruleId,
      ),
    ];
  }
  const issues: CompositionIssue[] = [];
  if (rule.status !== "published") {
    issues.push(
      issue(
        "error",
        "COMPOSITION_RULE_NOT_PUBLISHED",
        `${path}: правило "${ruleId}" в снимке имеет статус ${rule.status}.`,
        lineId,
        ruleId,
      ),
    );
  }
  if (rule.source === "preliminary") {
    issues.push(
      issue(
        "error",
        "COMPOSITION_RULE_PRELIMINARY",
        `${path}: preliminary-правило "${ruleId}" недопустимо.`,
        lineId,
        ruleId,
      ),
    );
  }
  return issues;
}

async function buildPins(
  lines: readonly CompositionLine[],
  priceVersionId?: string,
): Promise<CompositionPins> {
  const [catalogs, prices] = await Promise.all([
    readCollection<CatalogItem>("catalog-items.json"),
    listPriceItems(),
  ]);
  const catalogVersions: Record<string, Record<string, string>> = {};
  const priceItemVersions: Record<string, string> = {};
  for (const line of lines) {
    if (line.componentCatalog && line.componentId) {
      const item = catalogs.find(
        (candidate) =>
          candidate.catalog === line.componentCatalog &&
          candidate.id === line.componentId,
      );
      if (item) {
        (catalogVersions[item.catalog] ??= {})[item.id] = item.version;
        if (item.priceRefs && !Array.isArray(item.priceRefs)) {
          for (const ref of Object.values(item.priceRefs)) {
            const price = prices.find((candidate) => candidate.id === ref);
            if (price) priceItemVersions[price.id] = price.updatedAt;
          }
        }
      }
    }
    if (line.priceItemId) {
      const price = prices.find((candidate) => candidate.id === line.priceItemId);
      if (price) priceItemVersions[price.id] = price.updatedAt;
    }
  }
  return {
    ...(Object.keys(catalogVersions).length > 0 ? { catalogVersions } : {}),
    ...(Object.keys(priceItemVersions).length > 0 ? { priceItemVersions } : {}),
    ...(priceVersionId ? { priceVersionId } : {}),
  };
}

function validateOwnerConfirmationChanges(
  previous: readonly CompositionLine[],
  next: readonly CompositionLine[],
): void {
  const byId = new Map(previous.map((line) => [line.id, line]));
  for (const line of next) {
    if (line.source === "owner_confirmed") {
      const old = byId.get(line.id);
      if (!old || old.source !== "owner_confirmed") {
        throw new Error(
          `owner_confirmed для строки "${line.id}" назначается только отдельной операцией подтверждения.`,
        );
      }
      if (lineContentKey(old) !== lineContentKey(line)) {
        throw new Error(
          `Строка "${line.id}" подтверждена owner_confirmed и не может быть изменена обычным PATCH; создайте новую строку/подтверждение.`,
        );
      }
    } else {
      const old = byId.get(line.id);
      if (old?.source === "owner_confirmed") {
        throw new Error(
          `Строка "${line.id}" уже owner_confirmed; снятие подтверждения обычным PATCH запрещено.`,
        );
      }
    }
  }
}

export interface CreateCompositionDraftInput {
  sourceVersionId?: string;
  id?: string;
  notes?: string;
  lines?: CompositionLine[];
  migration?: CompositionVersion["migration"];
}

export async function createCompositionDraft(
  input: CreateCompositionDraftInput,
  actor: ActorContext,
): Promise<CompositionVersion> {
  const versions = await readVersions();
  let source: CompositionVersion | undefined;
  if (input.sourceVersionId) {
    source = versions.find((version) => version.id === input.sourceVersionId);
    if (!source) throw new Error(`Версия состава "${input.sourceVersionId}" не найдена.`);
    if (source.status !== "published") {
      throw new Error(
        "Новый draft создаётся только из опубликованной версии состава.",
      );
    }
  }
  if (versions.some((version) => version.status === "draft")) {
    throw new Error("Draft-версия состава уже существует; измените её или опубликуйте.");
  }
  const id = input.id ?? newDraftId();
  if (versions.some((version) => version.id === id)) {
    throw new Error(`Версия состава "${id}" уже существует.`);
  }
  if (input.lines?.some((line) => line.source === "owner_confirmed")) {
    throw new Error(
      "owner_confirmed назначается только отдельной операцией подтверждения.",
    );
  }
  const now = new Date().toISOString();
  const lines = source
    ? sortLines(source.lines)
    : sortLines(
        (input.lines ?? []).map((line) => compositionLineSchema.parse(line)),
      );
  const draft: CompositionVersion = parseFullVersion({
    id,
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    status: "draft",
    version: 1,
    lines,
    contentHash: compositionContentHash(lines, source?.rulesSnapshotId),
    ...(source?.rulesSnapshotId ? { rulesSnapshotId: source.rulesSnapshotId } : {}),
    ...(source ? { sourceVersionId: source.id } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.migration ? { migration: input.migration } : {}),
    createdAt: now,
    createdBy: actor.actorId,
    updatedAt: now,
    updatedBy: actor.actorId,
  });

  const operationId = `composition-create-${id}-${randomUUID()}`;
  await beginCompositionOperation({
    operationId,
    action: "composition_create",
    entityId: id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    auditAction: "composition.create",
    afterVersion: 1,
    afterHash: draft.contentHash,
    auditNewValue: {
      versionId: id,
      sourceVersionId: source?.id ?? null,
      linesCount: lines.length,
      contentHash: draft.contentHash,
    },
  });

  try {
    await updateCollection<CompositionVersion, void>(
      COMPOSITION_COLLECTION,
      (items) => {
        if (items.some((item) => item.id === id)) {
          throw new Error(`Версия состава "${id}" уже существует.`);
        }
        if (items.some((item) => item.status === "draft")) {
          throw new Error("Draft-версия состава уже существует; измените её или опубликуйте.");
        }
        return { items: [...items, draft], result: undefined };
      },
    );
  } catch (error) {
    await updateCompositionOperation(operationId, {
      phase: "aborted",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    throw error;
  }

  await updateCompositionOperation(operationId, { phase: "project_updated" });
  try {
    await appendAuditEvent({
      action: "composition.create",
      entityType: "compositionVersion",
      entityId: id,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      result: "ok",
      requestId: operationId,
      newValue: {
        versionId: id,
        sourceVersionId: source?.id ?? null,
        linesCount: lines.length,
        contentHash: draft.contentHash,
      },
    });
    await updateCompositionOperation(operationId, { phase: "completed" });
  } catch (error) {
    await updateCompositionOperation(operationId, {
      phase: "audit_pending",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    throw error;
  }
  return draft;
}

export interface UpdateCompositionDraftInput {
  expectedVersion: number;
  lines?: CompositionLine[];
  notes?: string;
}

export async function updateCompositionDraft(
  id: string,
  input: UpdateCompositionDraftInput,
  actor: ActorContext,
): Promise<CompositionVersion> {
  const versions = await readVersions();
  const current = versions.find((version) => version.id === id);
  if (!current) throw new Error(`Версия состава "${id}" не найдена.`);
  if (current.status !== "draft") {
    throw new Error(`Версия состава "${id}" в статусе ${current.status}: редактирование запрещено.`);
  }
  if (current.version !== input.expectedVersion) {
    throw new Error(
      `Конфликт версии состава "${id}": ожидалась ${input.expectedVersion}, текущая ${current.version}.`,
    );
  }
  const lines = input.lines === undefined ? current.lines : sortLines(input.lines);
  if (input.lines !== undefined) validateOwnerConfirmationChanges(current.lines, lines);

  const contentHash = compositionContentHash(
    lines,
    current.rulesSnapshotId,
    current.pins,
  );
  const notes = input.notes === undefined ? current.notes : input.notes;
  if (
    contentHash === current.contentHash &&
    (notes ?? null) === (current.notes ?? null)
  ) {
    return current;
  }

  const now = new Date().toISOString();
  const updated = parseFullVersion({
    ...current,
    lines,
    contentHash,
    ...(notes ? { notes } : {}),
    version: current.version + 1,
    updatedAt: now,
    updatedBy: actor.actorId,
  });

  const operationId = `composition-update-${id}-${randomUUID()}`;
  await beginCompositionOperation({
    operationId,
    action: "composition_update",
    entityId: id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    auditAction: "composition.update",
    afterVersion: updated.version,
    afterHash: updated.contentHash,
    auditOldValue: {
      version: current.version,
      contentHash: current.contentHash,
      linesCount: current.lines.length,
    },
    auditNewValue: {
      version: updated.version,
      contentHash: updated.contentHash,
      linesCount: updated.lines.length,
    },
  });

  try {
    await updateCollection<CompositionVersion, void>(
      COMPOSITION_COLLECTION,
      (items) => {
        const item = items.find((entry) => entry.id === id);
        if (!item) throw new Error(`Версия состава "${id}" не найдена.`);
        if (item.status !== "draft") {
          throw new Error(`Версия состава "${id}" больше не является draft.`);
        }
        if (item.version !== input.expectedVersion) {
          throw new Error(
            `Конфликт версии состава "${id}": ожидалась ${input.expectedVersion}, текущая ${item.version}.`,
          );
        }
        return {
          items: items.map((entry) => (entry.id === id ? updated : entry)),
          result: undefined,
        };
      },
    );
  } catch (error) {
    await updateCompositionOperation(operationId, {
      phase: "aborted",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    throw error;
  }

  await updateCompositionOperation(operationId, { phase: "project_updated" });
  try {
    await appendAuditEvent({
      action: "composition.update",
      entityType: "compositionVersion",
      entityId: id,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      result: "ok",
      requestId: operationId,
      oldValue: {
        version: current.version,
        contentHash: current.contentHash,
        linesCount: current.lines.length,
      },
      newValue: {
        version: updated.version,
        contentHash: updated.contentHash,
        linesCount: updated.lines.length,
      },
    });
    await updateCompositionOperation(operationId, { phase: "completed" });
  } catch (error) {
    await updateCompositionOperation(operationId, {
      phase: "audit_pending",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    throw error;
  }
  return updated;
}

export interface ValidateCompositionOptions {
  rulesSnapshotId?: string;
  requireProductionApproval?: boolean;
}

export async function validateCompositionVersion(
  version: CompositionVersion,
  options: ValidateCompositionOptions = {},
): Promise<CompositionValidationResult> {
  const errors: CompositionIssue[] = [];
  const warnings: CompositionIssue[] = [];

  const expectedHash = compositionContentHash(
    version.lines,
    version.rulesSnapshotId,
    version.pins,
  );
  if (expectedHash !== version.contentHash) {
    errors.push(
      issue(
        "error",
        "COMPOSITION_HASH_MISMATCH",
        `contentHash версии "${version.id}" не совпадает с содержимым.`,
        undefined,
        version.id,
      ),
    );
  }

  const catalogRead = await readCollectionStatus<CatalogItem>("catalog-items.json");
  const catalogItems = catalogRead.status === "ok" ? catalogRead.items : [];
  if (catalogRead.status === "corrupt") {
    errors.push(issue("error", "COMPOSITION_CATALOG_CORRUPT", "catalog-items.json повреждён."));
  }
  const priceItems = await listPriceItems();
  const published: PricingVersion | undefined = await getPublishedVersion();
  const snapshotIds = new Set(published?.snapshot.map((entry) => entry.priceItemId) ?? []);
  const snapshotResolution = await resolveSnapshotForValidation(
    version,
    options.rulesSnapshotId,
  );
  errors.push(...snapshotResolution.issues);
  const snapshot = snapshotResolution.snapshot;

  if (options.requireProductionApproval && version.production?.status !== "approved") {
    errors.push(
      issue(
        "error",
        "COMPOSITION_PRODUCTION_NOT_APPROVED",
        `Версия состава "${version.id}" не прошла Production Gate.`,
        undefined,
        version.id,
      ),
    );
  }

  const moduleTypes = new Set<string>();
  const duplicateKeys = new Map<string, string>();
  const alternativeGroups = new Map<string, string[]>();

  for (const line of version.lines) {
    moduleTypes.add(line.moduleType);
    if (line.source === "preliminary") {
      errors.push(
        issue(
          "error",
          "COMPOSITION_LINE_PRELIMINARY",
          `Строка "${line.id}" preliminary; публикация запрещена до подтверждения.`,
          line.id,
        ),
      );
    }
    if (line.relation === "conditional" && !line.condition) {
      errors.push(
        issue("error", "COMPOSITION_CONDITION_REQUIRED", `Строка "${line.id}": conditional требует condition.`, line.id),
      );
    }
    if (line.source === "owner_confirmed" && !line.confirmation) {
      errors.push(
        issue("error", "COMPOSITION_CONFIRMATION_REQUIRED", `Строка "${line.id}": owner_confirmed без confirmation.`, line.id),
      );
    }

    const catalogItem =
      line.componentCatalog && line.componentId
        ? catalogItems.find(
            (item) =>
              item.catalog === line.componentCatalog && item.id === line.componentId,
          )
        : undefined;
    if (line.componentId) {
      if (!catalogItem) {
        errors.push(
          issue(
            "error",
            "COMPOSITION_COMPONENT_MISSING",
            `Строка "${line.id}": CatalogItem "${line.componentCatalog}:${line.componentId}" не найден.`,
            line.id,
            line.componentId,
          ),
        );
      } else {
        if (catalogItem.status === "archived") {
          errors.push(
            issue("error", "COMPOSITION_COMPONENT_ARCHIVED", `Строка "${line.id}": CatalogItem archived.`, line.id, line.componentId),
          );
        } else if (catalogItem.status === "preliminary") {
          errors.push(
            issue("error", "COMPOSITION_COMPONENT_PRELIMINARY", `Строка "${line.id}": CatalogItem preliminary.`, line.id, line.componentId),
          );
        }
      }
    }

    if (line.componentCatalog && !line.componentId && line.priceItemId) {
      errors.push(
        issue(
          "error",
          "COMPOSITION_SLOT_PRICE_AMBIGUOUS",
          `Строка "${line.id}": configurable-слот не может иметь один явный PriceItem; тариф выбирается конфигурацией (Q6).`,
          line.id,
          line.priceItemId,
        ),
      );
    }

    if (line.priceItemId) {
      const price = priceItems.find((item) => item.id === line.priceItemId);
      if (!price) {
        errors.push(
          issue("error", "COMPOSITION_PRICE_MISSING", `Строка "${line.id}": PriceItem "${line.priceItemId}" не найден.`, line.id, line.priceItemId),
        );
      } else if (price.status === "archived") {
        errors.push(
          issue("error", "COMPOSITION_PRICE_ARCHIVED", `Строка "${line.id}": PriceItem archived.`, line.id, line.priceItemId),
        );
      } else if (!published) {
        errors.push(
          issue("error", "COMPOSITION_PRICE_VERSION_MISSING", `Строка "${line.id}": нет опубликованной PricingVersion.`, line.id, line.priceItemId),
        );
      } else if (!snapshotIds.has(line.priceItemId)) {
        errors.push(
          issue("error", "COMPOSITION_PRICE_NOT_IN_SNAPSHOT", `Строка "${line.id}": PriceItem "${line.priceItemId}" отсутствует в published "${published.id}".`, line.id, line.priceItemId),
        );
      }
      if (catalogItem) {
        const refs = catalogItem.priceRefs;
        const allowed = refs
          ? Array.isArray(refs)
            ? refs
            : Object.values(refs)
          : [];
        if (!allowed.includes(line.priceItemId)) {
          errors.push(
            issue(
              "error",
              "COMPOSITION_PRICE_NOT_LINKED",
              `Строка "${line.id}": PriceItem "${line.priceItemId}" не входит в priceRefs компонента "${catalogItem.catalog}:${catalogItem.id}".`,
              line.id,
              line.priceItemId,
            ),
          );
        }
      }
    } else if (catalogItem) {
      const refs = catalogItem.priceRefs;
      if (refs) {
        const list = Array.isArray(refs) ? refs : Object.values(refs);
        for (const ref of list) {
          if (ref && !priceItems.some((item) => item.id === ref)) {
            errors.push(
              issue(
                "error",
                "COMPOSITION_COMPONENT_PRICE_REF_MISSING",
                `Строка "${line.id}": priceRef "${ref}" не разрешается в PriceItem.`,
                line.id,
                ref,
              ),
            );
          }
        }
      }
    }

    if (line.quantityRef.kind === "managed_rule") {
      errors.push(
        ...checkRuleReference(snapshot, line.quantityRef.ruleId, line.id, `quantityRef строки "${line.id}"`),
      );
    } else if (line.quantityRef.kind === "code") {
      if (!isCompositionCodeRef(line.quantityRef.implementationId, "quantity")) {
        errors.push(
          issue(
            "error",
            "COMPOSITION_CODE_UNKNOWN",
            `Строка "${line.id}": неизвестный quantityRef.code "${line.quantityRef.implementationId}".`,
            line.id,
            line.quantityRef.implementationId,
          ),
        );
      }
    } else if (line.quantityRef.kind === "fixed") {
      if (line.source !== "owner_confirmed") {
        errors.push(
          issue("error", "COMPOSITION_FIXED_NOT_CONFIRMED", `Строка "${line.id}": fixed требует owner_confirmed.`, line.id),
        );
      }
      if (line.quantityRef.value <= 0) {
        errors.push(issue("error", "COMPOSITION_FIXED_INVALID", `Строка "${line.id}": fixed > 0.`, line.id));
      }
      if (line.quantityRef.unit === "none") {
        errors.push(issue("error", "COMPOSITION_FIXED_UNIT_MISSING", `Строка "${line.id}": fixed требует единицу.`, line.id));
      }
    }

    if (line.condition?.kind === "managed_rule") {
      errors.push(
        ...checkRuleReference(snapshot, line.condition.ruleId, line.id, `condition строки "${line.id}"`),
      );
    } else if (line.condition?.kind === "code") {
      if (!isCompositionCodeRef(line.condition.implementationId, "condition")) {
        errors.push(
          issue(
            "error",
            "COMPOSITION_CONDITION_CODE_UNKNOWN",
            `Строка "${line.id}": неизвестный condition.code "${line.condition.implementationId}".`,
            line.id,
            line.condition.implementationId,
          ),
        );
      }
    }

    const key = [
      line.moduleType,
      line.componentCatalog ?? "",
      line.componentId ?? "",
      line.priceItemId ?? "",
      line.relation,
      JSON.stringify(line.condition ?? null),
      JSON.stringify(line.quantityRef),
    ].join("|");
    if (line.relation === "alternative" && line.alternativeGroup) {
      const groupKey = `${line.moduleType}|${line.alternativeGroup}`;
      alternativeGroups.set(groupKey, [
        ...(alternativeGroups.get(groupKey) ?? []),
        line.id,
      ]);
    }
    const duplicate = duplicateKeys.get(key);
    if (duplicate) {
      errors.push(
        issue("error", "COMPOSITION_DUPLICATE_LINE", `Строки "${duplicate}" и "${line.id}" дублируют друг друга.`, line.id),
      );
    } else {
      duplicateKeys.set(key, line.id);
    }
  }

  for (const [groupKey, ids] of alternativeGroups) {
    if (ids.length < 2) {
      errors.push(
        issue(
          "error",
          "COMPOSITION_ALTERNATIVE_GROUP_INCOMPLETE",
          `Группа альтернатив "${groupKey}" содержит менее двух строк (${ids.join(", ")}).`,
        ),
      );
    }
  }
  for (const moduleType of [
    "base", "sink", "hob", "drawers", "wall", "tall", "oven", "bottle",
  ] as const) {
    if (!moduleTypes.has(moduleType)) {
      errors.push(
        issue("error", "COMPOSITION_MODULE_COVERAGE", `В составе отсутствуют строки для модуля "${moduleType}".`, undefined, moduleType),
      );
    }
  }
  if (version.lines.length === 0) {
    errors.push(issue("error", "COMPOSITION_EMPTY", "Версия состава не содержит строк."));
  }

  if (version.pins) {
    for (const [priceId, pinnedVersion] of Object.entries(
      version.pins.priceItemVersions ?? {},
    )) {
      const price = priceItems.find((item) => item.id === priceId);
      if (price && price.updatedAt !== pinnedVersion) {
        warnings.push(
          issue(
            "warning",
            "COMPOSITION_PRICE_VERSION_DRIFT",
            `PriceItem "${priceId}" изменился после публикации (${pinnedVersion} → ${price.updatedAt}).`,
            undefined,
            priceId,
          ),
        );
      }
    }
    if (
      version.pins.priceVersionId &&
      published &&
      version.pins.priceVersionId !== published.id
    ) {
      warnings.push(
        issue(
          "warning",
          "COMPOSITION_PRICE_SNAPSHOT_DRIFT",
          `Composition проверялась против PricingVersion "${version.pins.priceVersionId}", текущая published "${published.id}".`,
        ),
      );
    }
    for (const [catalog, entries] of Object.entries(version.pins.catalogVersions ?? {})) {
      for (const [itemId, pinnedVersion] of Object.entries(entries)) {
        const item = catalogItems.find(
          (candidate) => candidate.catalog === catalog && candidate.id === itemId,
        );
        if (item && item.version !== pinnedVersion) {
          warnings.push(
            issue(
              "warning",
              "COMPOSITION_CATALOG_VERSION_DRIFT",
              `CatalogItem "${catalog}:${itemId}" изменился после публикации (${pinnedVersion} → ${item.version}).`,
              undefined,
              itemId,
            ),
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export async function validateCompositionForConfig(
  version: CompositionVersion,
  config: FurnitureConfig,
  snapshot: PriceSnapshotInput,
  rulesSnapshotId?: string,
  options: { requireProductionApproval?: boolean } = {},
): Promise<CompositionIssue[]> {
  const issues: CompositionIssue[] = [];
  if (
    compositionContentHash(version.lines, version.rulesSnapshotId, version.pins) !==
    version.contentHash
  ) {
    issues.push(
      issue(
        "error",
        "COMPOSITION_HASH_MISMATCH",
        `contentHash версии "${version.id}" не совпадает с содержимым.`,
        undefined,
        version.id,
      ),
    );
  }
  if (version.status !== "published") {
    issues.push(issue("error", "COMPOSITION_NOT_PUBLISHED", `Версия состава "${version.id}" не опубликована.`, undefined, version.id));
  }
  if (version.lines.some((line) => line.source === "preliminary")) {
    issues.push(
      issue(
        "error",
        "COMPOSITION_LINE_PRELIMINARY",
        `Версия состава "${version.id}" содержит preliminary-строки.`,
        undefined,
        version.id,
      ),
    );
  }
  if (config.kind !== "kitchen") {
    issues.push(issue("error", "COMPOSITION_NOT_APPLICABLE", "Состав модулей применим только к кухонной конфигурации.", undefined, version.id));
    return issues;
  }
  if (version.rulesSnapshotId && version.rulesSnapshotId !== (rulesSnapshotId ?? "")) {
    issues.push(
      issue(
        "error",
        "COMPOSITION_RULES_SNAPSHOT_MISMATCH",
        `Composition "${version.id}" закреплена за RulesSnapshot "${version.rulesSnapshotId}", проект использует "${rulesSnapshotId ?? "нет"}".`,
        undefined,
        version.id,
      ),
    );
  }
  if (options.requireProductionApproval && version.production?.status !== "approved") {
    issues.push(
      issue("error", "COMPOSITION_PRODUCTION_NOT_APPROVED", `Composition "${version.id}" не прошла Production Gate.`, undefined, version.id),
    );
  }
  const types = new Set(config.modules.map((module) => module.type));
  const lines = version.lines.filter((line) => types.has(line.moduleType));
  for (const type of types) {
    if (!lines.some((line) => line.moduleType === type)) {
      issues.push(issue("error", "COMPOSITION_MODULE_COVERAGE", `В закреплённом составе нет строк для модуля "${type}".`, undefined, type));
    }
  }
  const amounts = new Set(snapshot.snapshot.map((entry) => entry.priceItemId));
  for (const line of lines) {
    if (line.relation !== "required") continue;
    if (line.priceItemId && !amounts.has(line.priceItemId)) {
      issues.push(
        issue(
          "error",
          "COMPOSITION_PRICE_NOT_IN_SNAPSHOT",
          `Строка "${line.id}": тариф "${line.priceItemId}" отсутствует в PriceSnapshot проекта.`,
          line.id,
          line.priceItemId,
        ),
      );
    }
  }
  return issues;
}

export interface PublishCompositionInput {
  expectedVersion: number;
  operationId?: string;
  notes?: string;
}

export async function publishCompositionVersion(
  id: string,
  input: PublishCompositionInput,
  actor: ActorContext,
): Promise<CompositionVersion> {
  await recoverCompositionPublications();
  const versions = await readVersions();
  const current = versions.find((version) => version.id === id);
  if (!current) throw new Error(`Версия состава "${id}" не найдена.`);
  if (current.status !== "draft") {
    if (input.operationId) {
      const journal = await listCompositionPublicationJournal();
      const replay = journal.find(
        (entry) =>
          entry.operationId === input.operationId &&
          entry.versionId === id &&
          entry.phase === "completed",
      );
      if (replay) return current;
    }
    throw new Error(`Версия состава "${id}" в статусе ${current.status}: публикация запрещена.`);
  }
  if (current.version !== input.expectedVersion) {
    throw new Error(`Конфликт версии состава "${id}": ожидалась ${input.expectedVersion}, текущая ${current.version}.`);
  }

  const activeResolution = await resolveActiveRulesSnapshot();
  const activeSnapshot = activeResolution.status === "ok" ? activeResolution.snapshot : null;
  const rulesSnapshotId = usesRules(current)
    ? (current.rulesSnapshotId ?? activeSnapshot?.id)
    : undefined;
  const validation = await validateCompositionVersion(current, {
    rulesSnapshotId,
    requireProductionApproval: false,
  });
  if (!validation.ok) {
    throw new CompositionValidationError([...validation.errors, ...validation.warnings]);
  }

  const publishedPrice = await getPublishedVersion();
  const pins = await buildPins(current.lines, publishedPrice?.id);
  const contentHash = compositionContentHash(current.lines, rulesSnapshotId, pins);
  const operationId = input.operationId?.trim() || `composition-publish-${randomUUID()}`;

  const begun = await beginCompositionPublication({
    operationId,
    versionId: id,
    expectedVersion: current.version,
    contentHash,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
  });
  if (!begun.created) {
    const completed = await getCompositionVersion(id);
    if (completed?.status === "published" || completed?.status === "superseded") {
      return completed;
    }
    throw new Error(`Публикация состава "${operationId}" уже выполняется; выполните recovery.`);
  }

  const now = new Date().toISOString();
  await updateCompositionPublication(operationId, { phase: "version_published" });

  let published!: CompositionVersion;
  try {
    await updateCollection<CompositionVersion, void>(
      COMPOSITION_COLLECTION,
      (items) => {
        const item = items.find((entry) => entry.id === id);
        if (!item) throw new Error(`Версия состава "${id}" не найдена.`);
        if (item.status !== "draft") throw new Error(`Версия состава "${id}" больше не является draft.`);
        if (item.version !== input.expectedVersion) {
          throw new Error(`Конфликт версии состава "${id}": ожидалась ${input.expectedVersion}, текущая ${item.version}.`);
        }
        if (item.contentHash !== current.contentHash) {
          throw new Error(`Конфликт содержимого состава "${id}": draft изменён во время публикации.`);
        }
        const nextSeq =
          Math.max(
            0,
            ...items
              .filter((entry) => entry.status !== "draft")
              .map((entry) => entry.publishedSeq ?? 0),
          ) + 1;
        const next = parseFullVersion({
          ...item,
          status: "published",
          ...(rulesSnapshotId ? { rulesSnapshotId } : {}),
          pins,
          production: { status: "not_ready" },
          contentHash,
          publishedAt: now,
          publishedBy: actor.actorId,
          publishedSeq: nextSeq,
          updatedAt: now,
          updatedBy: actor.actorId,
          ...(input.notes ? { notes: input.notes } : {}),
        });
        published = next;
        return {
          items: items.map((entry) => {
            if (entry.id === id) return next;
            if (entry.status === "published") {
              return { ...entry, status: "superseded", supersededAt: now };
            }
            return entry;
          }),
          result: undefined,
        };
      },
    );
  } catch (error) {
    await updateCompositionPublication(operationId, {
      phase: "aborted",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    throw error;
  }

  await updateCompositionPublication(operationId, {
    phase: "audit_pending",
    publishedSeq: published.publishedSeq,
  });

  try {
    const event = await appendAuditEvent({
      action: "composition.publish",
      entityType: "compositionVersion",
      entityId: id,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      result: "ok",
      requestId: operationId,
      newValue: {
        versionId: id,
        publishedSeq: published.publishedSeq,
        linesCount: published.lines.length,
        contentHash,
        rulesSnapshotId: rulesSnapshotId ?? null,
        pins,
      },
    });
    await updateCompositionPublication(operationId, {
      phase: "completed",
      auditEventId: event.id,
    });
  } catch (error) {
    await updateCompositionPublication(operationId, {
      phase: "audit_pending",
      issues: [error instanceof Error ? error.message : String(error)],
    });
    throw error;
  }

  return published;
}

export async function approveCompositionProduction(
  id: string,
  input: { expectedVersion: number; criteria?: string[] },
  actor: ActorContext,
): Promise<CompositionVersion> {
  const versions = await readVersions();
  const current = versions.find((version) => version.id === id);
  if (!current) throw new Error(`Версия состава "${id}" не найдена.`);
  if (current.status !== "published") {
    throw new Error(`Версия состава "${id}" не опубликована; Production Gate применим только к published.`);
  }
  if (current.version !== input.expectedVersion) {
    throw new Error(`Конфликт версии состава "${id}": ожидалась ${input.expectedVersion}, текущая ${current.version}.`);
  }
  if (current.production?.status === "approved") return current;
  const validation = await validateCompositionVersion(current, {
    rulesSnapshotId: current.rulesSnapshotId,
    requireProductionApproval: false,
  });
  if (!validation.ok) throw new CompositionValidationError([...validation.errors, ...validation.warnings]);
  if (!current.pins) {
    throw new Error(`Версия состава "${id}" не содержит commercial pins; Production Gate не пройден.`);
  }
  const now = new Date().toISOString();
  const production: CompositionProduction = {
    status: "approved",
    approvedAt: now,
    approvedBy: actor.actorId,
    criteria: input.criteria ?? [
      "published",
      "contentHash verified",
      "no preliminary lines",
      "commercial pins present",
      "no validation errors",
    ],
  };
  const updated = parseFullVersion({
    ...current,
    production,
    version: current.version + 1,
    updatedAt: now,
    updatedBy: actor.actorId,
  });
  const operationId = `composition-approve-${id}-${randomUUID()}`;
  await beginCompositionOperation({
    operationId,
    action: "composition_approve",
    entityId: id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    auditAction: "composition.production_approve",
    afterVersion: updated.version,
    afterHash: updated.contentHash,
    auditNewValue: { versionId: id, production },
  });
  try {
    await updateCollection<CompositionVersion, void>(
      COMPOSITION_COLLECTION,
      (items) => ({
        items: items.map((entry) => (entry.id === id ? updated : entry)),
        result: undefined,
      }),
    );
  } catch (error) {
    await updateCompositionOperation(operationId, {
      phase: "aborted",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    throw error;
  }
  await updateCompositionOperation(operationId, { phase: "project_updated" });
  try {
    await appendAuditEvent({
      action: "composition.production_approve",
      entityType: "compositionVersion",
      entityId: id,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      result: "ok",
      requestId: operationId,
      newValue: { versionId: id, production },
    });
    await updateCompositionOperation(operationId, { phase: "completed" });
  } catch (error) {
    await updateCompositionOperation(operationId, {
      phase: "audit_pending",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    throw error;
  }
  return updated;
}

export async function confirmCompositionLine(
  id: string,
  input: { expectedVersion: number; lineId: string; reference: string },
  actor: ActorContext,
): Promise<CompositionVersion> {
  const versions = await readVersions();
  const current = versions.find((version) => version.id === id);
  if (!current) throw new Error(`Версия состава "${id}" не найдена.`);
  if (current.status !== "draft") {
    throw new Error(`Версия состава "${id}" не является draft.`);
  }
  if (current.version !== input.expectedVersion) {
    throw new Error(`Конфликт версии состава "${id}": ожидалась ${input.expectedVersion}, текущая ${current.version}.`);
  }
  const line = current.lines.find((entry) => entry.id === input.lineId);
  if (!line) throw new Error(`Строка состава "${input.lineId}" не найдена.`);
  if (line.source === "owner_confirmed") return current;
  const confirmation: CompositionConfirmation = {
    by: actor.actorId,
    at: new Date().toISOString(),
    reference: input.reference,
  };
  const lines = current.lines.map((entry) =>
    entry.id === input.lineId
      ? { ...entry, source: "owner_confirmed" as const, confirmation }
      : entry,
  );
  const contentHash = compositionContentHash(lines, current.rulesSnapshotId, current.pins);
  const updated = parseFullVersion({
    ...current,
    lines,
    contentHash,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.actorId,
  });
  const operationId = `composition-confirm-${id}-${randomUUID()}`;
  await beginCompositionOperation({
    operationId,
    action: "composition_confirm",
    entityId: id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    auditAction: "composition.line_confirm",
    afterVersion: updated.version,
    afterHash: updated.contentHash,
    auditNewValue: { versionId: id, lineId: input.lineId, reference: input.reference },
  });
  try {
    await updateCollection<CompositionVersion, void>(
      COMPOSITION_COLLECTION,
      (items) => ({
        items: items.map((entry) => (entry.id === id ? updated : entry)),
        result: undefined,
      }),
    );
  } catch (error) {
    await updateCompositionOperation(operationId, {
      phase: "aborted",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    throw error;
  }
  await updateCompositionOperation(operationId, { phase: "project_updated" });
  try {
    await appendAuditEvent({
      action: "composition.line_confirm",
      entityType: "compositionVersion",
      entityId: id,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      result: "ok",
      requestId: operationId,
      newValue: { versionId: id, lineId: input.lineId, reference: input.reference },
    });
    await updateCompositionOperation(operationId, { phase: "completed" });
  } catch (error) {
    await updateCompositionOperation(operationId, {
      phase: "audit_pending",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    throw error;
  }
  return updated;
}

export async function deleteCompositionDraft(
  id: string,
  expectedVersion: number,
  actor: ActorContext,
): Promise<void> {
  const versions = await readVersions();
  const current = versions.find((version) => version.id === id);
  if (!current) throw new Error(`Версия состава "${id}" не найдена.`);
  if (current.status !== "draft") {
    throw new Error(`Версия состава "${id}" в статусе ${current.status}: удаление запрещено.`);
  }
  if (current.version !== expectedVersion) {
    throw new Error(`Конфликт версии состава "${id}": ожидалась ${expectedVersion}, текущая ${current.version}.`);
  }
  const projects = await readCollection<StoredProject>("projects.json");
  if (projects.some((project) => project.compositionVersionId === id)) {
    throw new Error(`Версия состава "${id}" используется проектами и не может быть удалена.`);
  }
  const operationId = `composition-delete-${id}-${randomUUID()}`;
  await beginCompositionOperation({
    operationId,
    action: "composition_delete",
    entityId: id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    auditAction: "composition.delete",
    auditOldValue: { versionId: id, version: current.version, linesCount: current.lines.length },
  });
  try {
    await updateCollection<CompositionVersion, void>(
      COMPOSITION_COLLECTION,
      (items) => {
        const item = items.find((entry) => entry.id === id);
        if (!item) throw new Error(`Версия состава "${id}" не найдена.`);
        if (item.status !== "draft") throw new Error(`Версия состава "${id}" больше не draft.`);
        if (item.version !== expectedVersion) {
          throw new Error(`Конфликт версии состава "${id}": ожидалась ${expectedVersion}, текущая ${item.version}.`);
        }
        return { items: items.filter((entry) => entry.id !== id), result: undefined };
      },
    );
  } catch (error) {
    await updateCompositionOperation(operationId, {
      phase: "aborted",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    throw error;
  }
  await updateCompositionOperation(operationId, { phase: "project_updated" });
  try {
    await appendAuditEvent({
      action: "composition.delete",
      entityType: "compositionVersion",
      entityId: id,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      result: "ok",
      requestId: operationId,
      oldValue: { versionId: id, version: current.version, linesCount: current.lines.length },
    });
    await updateCompositionOperation(operationId, { phase: "completed" });
  } catch (error) {
    await updateCompositionOperation(operationId, {
      phase: "audit_pending",
      issues: [error instanceof Error ? error.message : String(error)],
    }).catch(() => undefined);
    throw error;
  }
}

export async function listCompositionHistory(): Promise<
  Array<{ id: string; status: string; version: number; lines: number; createdAt: string; publishedAt: string | null; publishedSeq: number | null }>
> {
  const versions = await listCompositionVersions();
  return versions.map((version) => ({
    id: version.id,
    status: version.status,
    version: version.version,
    lines: version.lines.length,
    createdAt: version.createdAt,
    publishedAt: version.publishedAt ?? null,
    publishedSeq: version.publishedSeq ?? null,
  }));
}

export async function listCompositionAudit(versionId: string) {
  const events = await listAuditEvents({ entityType: "compositionVersion" });
  return events.filter((event) => event.entityId === versionId);
}
