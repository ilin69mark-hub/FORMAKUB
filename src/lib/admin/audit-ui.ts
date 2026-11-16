import {
  auditActionSchema,
  type AdminAuditEvent,
  type AuditAction,
  type AuditEventFilter,
} from "@/lib/server/audit";

/**
 * CA-T-508 — представление журнала `AdminAuditLog`.
 *
 * Только разбор query-параметров, поиск, сортировка и пагинация уже
 * прочитанных записей. Запись/изменение журнала не выполняется: источник —
 * append-only сервис CA-T-202 (`listAuditEvents`).
 */

export const AUDIT_PAGE_SIZE = 25;
export const AUDIT_ACTIONS: readonly AuditAction[] = auditActionSchema.options;

const ACTIONS = new Set<string>(AUDIT_ACTIONS);

export interface AuditFilter extends AuditEventFilter {
  /** Поиск по id/action/entity/actor (в памяти, после фильтров сервиса). */
  q?: string;
}

export type AuditSort = "asc" | "desc";

export interface AuditQuery extends AuditFilter {
  sort: AuditSort;
  page: number;
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** `YYYY-MM-DD` → границы суток в ISO (включительно). */
function startOfDay(value: string): string {
  return value.length === 10 ? `${value}T00:00:00.000Z` : value;
}

function endOfDay(value: string): string {
  return value.length === 10 ? `${value}T23:59:59.999Z` : value;
}

function isDateInput(value: string | undefined): value is string {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseAuditQuery(
  input: Record<string, string | undefined>,
): AuditQuery {
  const actionText = text(input.action);
  const from = isDateInput(input.from) ? startOfDay(input.from) : undefined;
  const to = isDateInput(input.to) ? endOfDay(input.to) : undefined;
  const pageNumber = Number.parseInt(input.page ?? "1", 10);

  return {
    ...(actionText !== undefined && ACTIONS.has(actionText)
      ? { action: actionText as AuditAction }
      : {}),
    ...(text(input.actorId) !== undefined ? { actorId: text(input.actorId) } : {}),
    ...(text(input.entityType) !== undefined
      ? { entityType: text(input.entityType) }
      : {}),
    ...(text(input.entityId) !== undefined
      ? { entityId: text(input.entityId) }
      : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(text(input.q) !== undefined ? { q: text(input.q) } : {}),
    sort: input.sort === "asc" ? "asc" : "desc",
    page: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1,
  };
}

/** Поиск по доступным полям модели события (без выдуманных атрибутов). */
export function searchAuditEvents(
  events: AdminAuditEvent[],
  query: string | undefined,
): AdminAuditEvent[] {
  const needle = query?.trim().toLowerCase();
  if (!needle) return events;
  return events.filter((event) =>
    [
      event.id,
      event.action,
      event.entityType,
      event.entityId,
      event.actorId,
      event.actorRole,
      event.result,
      event.paramVersion ?? "",
      event.requestId ?? "",
    ].some((value) => value.toLowerCase().includes(needle)),
  );
}

/** Сортировка по `createdAt`; при равенстве — по `id` для детерминизма. */
export function sortAuditEvents(
  events: AdminAuditEvent[],
  sort: AuditSort,
): AdminAuditEvent[] {
  const direction = sort === "asc" ? 1 : -1;
  return [...events].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? -direction : direction;
    }
    return a.id < b.id ? -direction : direction;
  });
}

export interface AuditPage {
  items: AdminAuditEvent[];
  page: number;
  pageCount: number;
  total: number;
  rangeStart: number;
  rangeEnd: number;
}

export function paginateAuditEvents(
  events: AdminAuditEvent[],
  page: number,
  pageSize: number = AUDIT_PAGE_SIZE,
): AuditPage {
  const total = events.length;
  const pageCount = total === 0 ? 0 : Math.ceil(total / pageSize);
  const current = pageCount === 0 ? 1 : Math.min(Math.max(page, 1), pageCount);
  const offset = (current - 1) * pageSize;
  const items = events.slice(offset, offset + pageSize);
  return {
    items,
    page: current,
    pageCount,
    total,
    rangeStart: total === 0 ? 0 : offset + 1,
    rangeEnd: offset + items.length,
  };
}

export function formatAuditValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
