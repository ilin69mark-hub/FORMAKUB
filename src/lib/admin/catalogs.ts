import { appendAuditEvent, listAuditEvents, type AdminAuditEvent } from "@/lib/server/audit";
import { readCollection, updateCollection, withFileLock } from "@/lib/server/store";
import { COUNTERTOP_LEGACY_MAP } from "@/content/catalog";

import type { ActorContext } from "./parameters";
import { catalogItemSchema, type CatalogItem } from "./schema";

/**
 * Сервис CatalogItem (CA-T-204).
 *
 * Модель: дизайн §6.2, ТЗ §3.2/§8. Правила: удаление запрещено всегда
 * (OI-046); жизненный цикл только `active → archived`; архивирование при
 * ссылках из проектов — отказ (ТЗ §8 → 409); `version` инкрементируется
 * только при правке `attrs` (§6.2/S-06 — как в CA-T-203, формат архитектурно
 * не утверждён). Блокировки — Storage Adapter (`updateCollection`/`withLock`).
 * Аудит — `appendAuditEvent` (`catalog.create/update/archive`), порядок
 * «данные → журнал», при ошибке аудита — проброс без компенсации.
 *
 * Границы: без HTTP (C11), без `priceRefs` (CA-T-207), без `pins` (CA-T-108),
 * preliminary-workflow не описан — отклоняется.
 */

const COLLECTION = "catalog-items.json";
const PROJECTS = "projects.json";
const PRICE_ITEMS = "price-items.json";
const VERSIONS = "pricing-versions.json";

function notFound(catalog: string, id: string): Error {
  return new Error(`Элемент справочника "${catalog}:${id}" не найден.`);
}

/** Числовой инкремент версии — контракт CA-T-203 (§6.1 + §7.5.3). */
function nextVersion(current: string): string {
  if (!/^\d+$/.test(current)) {
    throw new Error(
      `Не удалось инкрементировать version="${current}": формат не поддерживается (контракт CA-T-203).`,
    );
  }
  return String(Number(current) + 1);
}

function matches(item: CatalogItem, catalog: string, id: string): boolean {
  return item.catalog === catalog && item.id === id;
}

/** Снимки без `undefined` (z.json() отклоняет неопределённые значения). */
function compactSnapshot(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

// ─── Проверка ссылок (ТЗ §8: архивирование → 409 при ссылках в проектах) ───

function collectValues(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectValues(item, out));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectValues(item, out));
  }
}

/** В `pins.catalogVersions` идентификаторы — и ключи, и значения. */
function collectKeysAndValues(value: unknown, out: string[]): void {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      collectKeysAndValues(item, out);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectKeysAndValues(item, out));
  } else if (typeof value === "string") out.push(value);
}

/**
 * Идентификаторы, которым соответствует элемент: собственный `id` и легаси-
 * идентификаторы `COUNTERTOP_LEGACY_MAP`, указывающие на него (§12 S5).
 */
function referenceCandidates(id: string): Set<string> {
  const candidates = new Set<string>([id]);
  for (const [legacy, current] of Object.entries(COUNTERTOP_LEGACY_MAP)) {
    if (current === id) candidates.add(legacy);
  }
  return candidates;
}

/**
 * Проекты, ссылающиеся на элемент. Ссылки существующих сущностей:
 * строковые значения `StoredProject.config` (id входят в zod-enum проектов,
 * §6.2) и ключи/значения `pins` (когда появятся, CA-T-108). Свободный текст
 * (клиенты, лиды) не сканируется — это не ссылки.
 */
/**
 * CA-516-02: исторические зависимости связанных PriceItem. CatalogItem
 * нельзя архивировать, если его ставка используется движком или входит в
 * опубликованный snapshot — иначе нарушится чтение/пересчёт истории.
 */
async function historicalPriceReferences(
  item: CatalogItem,
): Promise<string[]> {
  const refs = Array.isArray(item.priceRefs)
    ? item.priceRefs
    : Object.values(item.priceRefs ?? {});
  const ids = refs.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (ids.length === 0) return [];

  const [priceItems, versions] = await Promise.all([
    readCollection<Record<string, unknown>>(PRICE_ITEMS),
    readCollection<Record<string, unknown>>(VERSIONS),
  ]);
  const hits: string[] = [];
  for (const id of ids) {
    const priceItem = priceItems.find((candidate) => candidate.id === id);
    if (priceItem?.status === "active" && priceItem.usage === "used") {
      hits.push(`${id} (usage=used)`);
    }
    const published = versions.find((version) => {
      if (version.status !== "published") return false;
      if (!Array.isArray(version.snapshot)) return false;
      return version.snapshot.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as { priceItemId?: unknown }).priceItemId === id,
      );
    });
    if (published) {
      hits.push(`${id} (published:${String(published.id)})`);
    }
  }
  return hits;
}

async function projectsReferencing(id: string): Promise<string[]> {
  const projects = await readCollection<Record<string, unknown>>(PROJECTS);
  const candidates = referenceCandidates(id);
  const hits: string[] = [];

  for (const project of projects) {
    const values: string[] = [];
    collectValues(project.config, values);
    // CA-516-02: исторические события цены — тоже ссылки на справочник.
    collectValues(project.priceHistory, values);
    if (project.pins !== undefined) collectKeysAndValues(project.pins, values);
    if (values.some((value) => candidates.has(value))) {
      hits.push(String(project.id));
    }
  }
  return hits;
}

// ─── Аудит ───

function entityOf(catalog: string, id: string): string {
  return `${catalog}:${id}`;
}

async function appendEvent(
  catalog: string,
  id: string,
  input: {
    action: "catalog.create" | "catalog.update" | "catalog.archive";
    oldValue?: unknown;
    newValue?: unknown;
    paramVersion?: string;
  },
  actor: ActorContext,
): Promise<void> {
  await appendAuditEvent({
    action: input.action,
    entityType: "catalog",
    entityId: entityOf(catalog, id),
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    ...(input.oldValue !== undefined ? { oldValue: input.oldValue } : {}),
    ...(input.newValue !== undefined ? { newValue: input.newValue } : {}),
    ...(input.paramVersion !== undefined
      ? { paramVersion: input.paramVersion }
      : {}),
  });
}

// ─── Операции ───

/**
 * Создание элемента (ТЗ §8 POST). Служебные поля штампует сервис;
 * `status` — только `active` (создание с иным статусом в §6.2 не описано).
 */
export async function createCatalogItem(
  input: Record<string, unknown>,
  actor: ActorContext,
): Promise<CatalogItem> {
  const candidate = {
    ...input,
    version: "1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.actorId,
  };
  const item = catalogItemSchema.parse(candidate);
  if (item.status !== "active") {
    throw new Error(
      `Создание элемента со статусом "${item.status}" не описано (§6.2: жизненный цикл active → archived).`,
    );
  }

  const stored = await updateCollection<CatalogItem, CatalogItem>(
    COLLECTION,
    (items) => {
      if (items.some((existing) => matches(existing, item.catalog, item.id))) {
        throw new Error(`Элемент "${item.catalog}:${item.id}" уже существует (U(catalog,id)).`);
      }
      return { items: [...items, item], result: item };
    },
  );

  await appendEvent(stored.catalog, stored.id, { action: "catalog.create" }, actor);
  return stored;
}

export async function getCatalogItem(
  catalog: string,
  id: string,
): Promise<CatalogItem | undefined> {
  const items = await readCollection<CatalogItem>(COLLECTION);
  return items.find((item) => matches(item, catalog, id));
}

export async function listCatalogItems(
  catalog: string,
  filter: { status?: CatalogItem["status"] } = {},
): Promise<CatalogItem[]> {
  const items = await readCollection<CatalogItem>(COLLECTION);
  return items.filter((item) => {
    if (item.catalog !== catalog) return false;
    if (filter.status !== undefined && item.status !== filter.status) return false;
    return true;
  });
}

export interface CatalogItemPatch {
  expectedVersion: string;
  /** Заменяет объект атрибутов целиком (PATCH «атрибуты», ТЗ §8). */
  attrs?: Record<string, unknown>;
  label?: string;
  sortOrder?: number;
}

/**
 * Редактирование (ТЗ §8 PATCH): `expectedVersion` → конфликт (409);
 * правка `attrs` → инкремент `version` (§6.2/S-06, контракт CA-T-203);
 * правка `label`/`sortOrder` — без инкремента (версия отражает `attrs`
 * для разрешения ссылок `pins`). Редактируется только `status=active`.
 */
export async function updateCatalogItem(
  catalog: string,
  id: string,
  patch: CatalogItemPatch,
  actor: ActorContext,
): Promise<CatalogItem> {
  const touchesAttrs = patch.attrs !== undefined;
  if (!touchesAttrs && patch.label === undefined && patch.sortOrder === undefined) {
    throw new Error("Патч не содержит изменяемых полей (attrs/label/sortOrder).");
  }

  const previous: Record<string, unknown> = {};

  const updated = await updateCollection<CatalogItem, CatalogItem>(
    COLLECTION,
    (items) => {
      const current = items.find((item) => matches(item, catalog, id));
      if (!current) throw notFound(catalog, id);
      if (current.status !== "active") {
        throw new Error(
          `Редактирование доступно только для status=active (§6.2); элемент "${entityOf(catalog, id)}" — "${current.status}". Архивные записи не возвращаются в активное состояние.`,
        );
      }
      if (current.version !== patch.expectedVersion) {
        throw new Error(
          `Конфликт версии "${entityOf(catalog, id)}": ожидалась "${patch.expectedVersion}", фактически "${current.version}".`,
        );
      }

      if (touchesAttrs) previous.attrs = current.attrs;
      if (patch.label !== undefined) previous.label = current.label;
      if (patch.sortOrder !== undefined) previous.sortOrder = current.sortOrder;

      const candidate = {
        ...current,
        ...(touchesAttrs ? { attrs: patch.attrs } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(touchesAttrs ? { version: nextVersion(current.version) } : {}),
        updatedAt: new Date().toISOString(),
        updatedBy: actor.actorId,
      };
      const validated = catalogItemSchema.parse(candidate);
      return {
        items: items.map((item) =>
          matches(item, catalog, id) ? validated : item,
        ),
        result: validated,
      };
    },
  );

  const next: Record<string, unknown> = {};
  if (touchesAttrs) next.attrs = updated.attrs;
  if (patch.label !== undefined) next.label = updated.label;
  if (patch.sortOrder !== undefined) next.sortOrder = updated.sortOrder;

  await appendEvent(
    catalog,
    id,
    {
      action: "catalog.update",
      oldValue: compactSnapshot(previous),
      newValue: compactSnapshot(next),
      ...(touchesAttrs ? { paramVersion: updated.version } : {}),
    },
    actor,
  );
  return updated;
}

/**
 * Архивирование вместо удаления (ТЗ §8 POST .../archive).
 *
 * Проверка ссылок выполняется в сервисе: бизнес-правило §6.2/ТЗ §8,
 * HTTP-слоя нет (C11), отказ маппится в 409 при появлении API (CA-T-609).
 * Проверка идёт под замком коллекции проектов (штатный `withFileLock`) —
 * исключает гонку «создание проекта ↔ архивирование»; читаются все
 * существующие ссылающиеся сущности (`StoredProject.config`, `pins`).
 * `version` не инкрементируется (архивирование не меняет `attrs`, §6.2/S-06).
 */
export async function archiveCatalogItem(
  catalog: string,
  id: string,
  actor: ActorContext,
): Promise<CatalogItem> {
  const archived = await withFileLock(PROJECTS, () =>
    updateCollection<CatalogItem, CatalogItem>(COLLECTION, async (items) => {
      const current = items.find((item) => matches(item, catalog, id));
      if (!current) throw notFound(catalog, id);
      if (current.status === "archived") {
        throw new Error(
          `Элемент "${entityOf(catalog, id)}" уже в архиве.`,
        );
      }
      if (current.status !== "active") {
        throw new Error(
          `Архивирование доступно только из status=active (§6.2); текущий статус "${current.status}".`,
        );
      }

      const refs = await projectsReferencing(id);
      if (refs.length > 0) {
        throw new Error(
          `Архивирование "${entityOf(catalog, id)}" отклонено: используется в проектах (${refs.join(", ")}) — ТЗ §8 → 409.`,
        );
      }

      const priceRefs = await historicalPriceReferences(current);
      if (priceRefs.length > 0) {
        throw new Error(
          `Архивирование "${entityOf(catalog, id)}" отклонено: связанные ставки имеют исторические зависимости (${priceRefs.join(", ")}) — CA-516-02.`,
        );
      }

      const candidate = {
        ...current,
        status: "archived" as const,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.actorId,
      };
      const validated = catalogItemSchema.parse(candidate);
      return {
        items: items.map((item) =>
          matches(item, catalog, id) ? validated : item,
        ),
        result: validated,
      };
    }),
  );

  await appendEvent(
    catalog,
    id,
    {
      action: "catalog.archive",
      oldValue: { status: "active" },
      newValue: { status: "archived" },
    },
    actor,
  );
  return archived;
}

/**
 * Удаление запрещено всегда (§6.2, ТЗ §3.2, OI-046): явный guard —
 * операция не выполняется и не обращается к хранилищу.
 */
export async function deleteCatalogItem(
  catalog: string,
  id: string,
): Promise<never> {
  throw new Error(
    `Удаление элемента "${entityOf(catalog, id)}" запрещено всегда (§6.2, OI-046) — используйте архивирование.`,
  );
}

/** История изменений элемента (ТЗ §8: .../history → AdminAuditLog[]). */
export async function listCatalogItemHistory(
  catalog: string,
  id: string,
): Promise<AdminAuditEvent[]> {
  return listAuditEvents({
    entityType: "catalog",
    entityId: entityOf(catalog, id),
  });
}
