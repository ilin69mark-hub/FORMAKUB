import { randomBytes } from "node:crypto";
import { z } from "zod";

import { readCollection, updateCollection } from "./store";

/**
 * AdminAuditLog — журнал административных действий (CA-T-202).
 *
 * Модель: ТЗ §3.2 + дизайн §6.11 (Revision 1), `paramVersion` и ключ
 * событий изменений — дизайн §6.1; `result` — X-7 (R-10).
 *
 * **Append-only:** публикуются только `appendAuditEvent` (создание) и
 * `listAuditEvents` (чтение/фильтры). Методов изменения/удаления нет;
 * запись выполняется строго как «прочитать → провалидировать существующие →
 * добавить в конец», существующие события передаются без изменений.
 */

/** Имя коллекции журнала (StorageAdapter, CA-T-103). */
const AUDIT_COLLECTION = "admin-audit-log.json";

const timestampSchema = z.string().datetime({ offset: true });
const nonEmptySchema = z.string().min(1);

/**
 * Действия: значения из дизайна §6.11 (полный перечень Revision 1) и ТЗ §3.2
 * (перечень ТЗ открыт «…»). Расхождения нумерации (`price.update` vs
 * `priceitem.update`, `project.recalc.run` vs `recalc.run`) — в отчёте к
 * задаче: значения не выдумывались, приняты оба документальных перечня.
 */
export const auditActionSchema = z.enum([
  // дизайн §6.11
  "param.create",
  "param.update",
  "catalog.create",
  "catalog.update",
  "catalog.archive",
  "display.update",
  "preset.update",
  "priceitem.update",
  "pricing.create",
  "pricing.validate",
  "pricing.publish",
  "pricing.rollback",
  // ADR-07 (managed assembly rules): операции слоя управляемых правил
  "rule.create",
  "rule.update",
  "rule.publish",
  "composition.create",
  "composition.update",
  "composition.publish",
  "composition.production_approve",
  "composition.line_confirm",
  "composition.delete",
  "recalc.run",
  "recalc.retry",
  "recalc.cancel",
  "project.view",
  "project.rules_transition",
  "project.composition_transition",
  "diagnostic.run",
  // ТЗ §3.2 (прежняя нумерация, перечень открыт «…»)
  "price.update",
  "price.publish",
  "project.recalc.run",
]);

export type AuditAction = z.infer<typeof auditActionSchema>;

export const adminAuditLogSchema = z
  .strictObject({
    /** Уникальный идентификатор события (PK). */
    id: nonEmptySchema,
    action: auditActionSchema,
    /** Объект действия (§6.11: enum/string — значения не задокументированы). */
    entityType: nonEmptySchema,
    entityId: nonEmptySchema,
    /** Снимки до/после (json|null; «для изменений» — обязательно). */
    oldValue: z.json().optional(),
    newValue: z.json().optional(),
    /** Версия параметра: подмножество `param.update` (§6.1). */
    paramVersion: nonEmptySchema.optional(),
    actorId: nonEmptySchema,
    /** Роли не enum: полная модель ролей открыта (Q4/ADR-02). */
    actorRole: nonEmptySchema,
    /** Итог, включая отказы прав (X-7). */
    result: z.enum(["ok", "denied", "error"]),
    requestId: nonEmptySchema.optional(),
    createdAt: timestampSchema,
  })
  .superRefine((event, ctx) => {
    // §6.1/§3.2: событие изменения параметра несёт обязательные атрибуты.
    if (event.action === "param.update") {
      if (event.entityType !== "parameter") {
        ctx.addIssue({
          code: "custom",
          message: "param.update ⇒ entityType=parameter (§6.1)",
          path: ["entityType"],
        });
      }
      if (event.paramVersion === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "param.update ⇒ обязателен paramVersion (§6.1)",
          path: ["paramVersion"],
        });
      }
      if (event.oldValue === undefined || event.newValue === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "param.update ⇒ обязательны oldValue и newValue (§3.2/§6.11)",
          path: ["oldValue"],
        });
      }
    }
  });

export type AdminAuditEvent = z.infer<typeof adminAuditLogSchema>;

export interface AppendAuditInput {
  action: AuditAction;
  entityType: string;
  entityId: string;
  actorId: string;
  actorRole: string;
  result: "ok" | "denied" | "error";
  oldValue?: unknown;
  newValue?: unknown;
  paramVersion?: string;
  requestId?: string;
  /** Опционально: генерируется криптостойко, уникальность проверяется. */
  id?: string;
  /** Опционально: время события (для тестов/миграций); иначе — текущее. */
  createdAt?: string;
}

/**
 * Создание события журнала (append-only).
 *
 * Существующие записи не изменяются: в возврате `updateCollection` они
 * попадают в новый массив без правок, а перед записью каждый из них
 * провалидируется схемой (порча/подделка ⇒ отказ без изменения файла).
 * Дубликат `id` или ключа событий `U(entityType,entityId,paramVersion)`
 * (§6.1) ⇒ исключение, запись не выполняется.
 */
export async function appendAuditEvent(
  input: AppendAuditInput,
): Promise<AdminAuditEvent> {
  const candidate = {
    id: input.id ?? randomBytes(8).toString("hex"),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId,
    actorRole: input.actorRole,
    result: input.result,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.oldValue !== undefined ? { oldValue: input.oldValue } : {}),
    ...(input.newValue !== undefined ? { newValue: input.newValue } : {}),
    ...(input.paramVersion !== undefined
      ? { paramVersion: input.paramVersion }
      : {}),
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  };
  // Валидация входа (включая межпроверки param.update) до обращения к storage.
  const event = adminAuditLogSchema.parse(candidate);

  return updateCollection<AdminAuditEvent, AdminAuditEvent>(
    AUDIT_COLLECTION,
    (items) => {
      for (const [index, existing] of items.entries()) {
        const check = adminAuditLogSchema.safeParse(existing);
        if (!check.success) {
          throw new Error(
            `AdminAuditLog: существующая запись №${index} невалидна, журнал не изменяется: ${check.error.message}`,
          );
        }
      }
      if (items.some((existing) => existing.id === event.id)) {
        throw new Error(`AdminAuditLog: дубликат id "${event.id}"`);
      }
      if (event.action === "param.update") {
        const duplicate = items.some(
          (existing) =>
            existing.action === "param.update" &&
            existing.entityType === event.entityType &&
            existing.entityId === event.entityId &&
            existing.paramVersion === event.paramVersion,
        );
        if (duplicate) {
          throw new Error(
            `AdminAuditLog: событие изменения уже существует (U(entityType,entityId,paramVersion): ${event.entityType}/${event.entityId}/${event.paramVersion})`,
          );
        }
      }
      // Существующие события передаются как есть — только добавление в конец.
      return { items: [...items, event], result: event };
    },
  );
}

export interface AuditEventFilter {
  action?: AuditAction;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  /** Диапазон `createdAt` включительно (ISO-строки, ТЗ §8: date range). */
  from?: string;
  to?: string;
}

/**
 * Чтение журнала с фильтрами ТЗ §8 (`GET /api/admin/audit-log`:
 * `action`, `actor`, date range) и по объекту (история сущности, §8).
 */
export async function listAuditEvents(
  filter: AuditEventFilter = {},
): Promise<AdminAuditEvent[]> {
  const events = await readCollection<AdminAuditEvent>(AUDIT_COLLECTION);
  return events.filter((event) => {
    if (filter.action !== undefined && event.action !== filter.action) {
      return false;
    }
    if (filter.actorId !== undefined && event.actorId !== filter.actorId) {
      return false;
    }
    if (filter.entityType !== undefined && event.entityType !== filter.entityType) {
      return false;
    }
    if (filter.entityId !== undefined && event.entityId !== filter.entityId) {
      return false;
    }
    if (filter.from !== undefined && event.createdAt < filter.from) {
      return false;
    }
    if (filter.to !== undefined && event.createdAt > filter.to) {
      return false;
    }
    return true;
  });
}
