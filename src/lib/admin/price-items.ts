import { appendAuditEvent, listAuditEvents, type AdminAuditEvent } from "@/lib/server/audit";
import { readCollection, updateCollection } from "@/lib/server/store";

import type { ActorContext } from "./parameters";
import {
  priceItemSchema,
  pricingVersionSchema,
  type PriceItem,
  type PricingVersion,
} from "./schema";

/**
 * Сервис PriceItem (CA-T-207).
 *
 * Модель: дизайн §6.4, ТЗ §3.2. PriceItem — **определение** ставки (id,
 * метаданные, `usage`/`status`); суммы здесь не живут (X-3: `amount` в записи
 * отсутствует — strict-схема отклоняет). Правила §6.4:
 *  - `status`: `active → archived` — архивирование вместо удаления (OI-046);
 *    возврат `archived → active` допустим только для ставок, отсутствующих в
 *    `published`-версиях (иначе — явное решение оператора, механизм вне scope);
 *  - `usage`: `used → unused` — ставка перестала читаться движком (OI-054);
 *    `unused → used` — только через релиз/публикацию (CA-T-211, вне scope);
 *  - комбинация `archived+used` недопустима → архивирование используемой
 *    ставки запрещено (супервизор схемы + явная проверка в сервисе);
 *  - `editable=false` для permanently-unused (4 мёртвых поля §4 аудита).
 *
 * Ограничения (решения владельца, не обходятся):
 *  - **создание вне scope:** enum аудита не содержит `priceitem.create`
 *    (дизайн §6.11) — запись не журналируется; массовое создание ставок
 *    отнесено к импорту (CA-T-208);
 *  - `status` по §6.4 меняется отдельным правом `price.publish`-класса —
 *    RBAC вне scope (C-вопрос, HTTP — CA-T-609);
 *  - схема `priceItemSchema` не содержит `version` — метка optimistic
 *    locking (**R-16**, решение утверждено): **обязательный**
 *    `expectedUpdatedAt` для всех изменяющих операций; отсутствие метки →
 *    validation error, несовпадение → conflict — в обоих случаях без
 *    изменения данных и без успешного audit event; `updatedAt` — строго
 *    монотонен: новое значение всегда строго больше предыдущего, в том
 *    числе при нескольких изменениях в пределах одной миллисекунды.
 *
 * Запись — только через Storage Adapter (`updateCollection`, замок
 * сериализует конкурентные операции); аудит — `appendAuditEvent`
 * (`priceitem.update` — единственное действие enum для PriceItem), порядок
 * «данные → журнал», при ошибке аудита — проброс без компенсации.
 * Удаление запрещено всегда (guard, как в CA-T-204).
 */

const COLLECTION = "price-items.json";
const PRESETS = "module-presets.json";
const CATALOGS = "catalog-items.json";
const VERSIONS = "pricing-versions.json";

/**
 * 4 «мёртвых» ценовых поля (аудит §4, OI-054, CA-RISK-012):
 * `src/content/pricing.ts:26,27,29,33` — не читаются `calculateKitchenPrice`.
 * Идентификаторы — производные от ключей `PRICING.kitchen` (формат id
 * «kitchen.*» по ТЗ §3.2); при импорте (CA-T-208) сверяются с фактическим
 * набором ставок.
 */
export const PERMANENTLY_UNUSED: ReadonlyArray<{
  id: string;
  sourceRef: string;
}> = [
  {
    id: "kitchen.countertopDepthAllowance",
    sourceRef: "src/content/pricing.ts:PRICING.kitchen.countertopDepthAllowance",
  },
  {
    id: "kitchen.plinthPerMeter",
    sourceRef: "src/content/pricing.ts:PRICING.kitchen.plinthPerMeter",
  },
  {
    id: "kitchen.underCabinetLightPerMeter",
    sourceRef: "src/content/pricing.ts:PRICING.kitchen.underCabinetLightPerMeter",
  },
  {
    id: "kitchen.sinkPartition",
    sourceRef: "src/content/pricing.ts:PRICING.kitchen.sinkPartition",
  },
];

const DEAD_IDS = new Set(PERMANENTLY_UNUSED.map((item) => item.id));

function notFound(id: string): Error {
  return new Error(`Ставка "${id}" не найдена.`);
}

function conflict(id: string, expected: string, actual: string): Error {
  return new Error(
    `Конфликт optimistic locking "${id}": ожидался updatedAt "${expected}", фактически "${actual}".`,
  );
}

/** R-16: отсутствующая метка — validation error без изменения данных. */
function missingToken(id: string): Error {
  return new Error(
    `expectedUpdatedAt обязателен для изменяющей операции PriceItem "${id}" (R-16): отсутствующая метка — validation error, данные не изменяются, audit event не создаётся.`,
  );
}

function requireToken(id: string, expectedUpdatedAt: string | undefined): void {
  if (typeof expectedUpdatedAt !== "string" || expectedUpdatedAt === "") {
    throw missingToken(id);
  }
}

/**
 * Строго монотонный `updatedAt` (R-16): новое значение всегда строго
 * больше предыдущего — при нескольких изменениях в пределах одной
 * миллисекунды к предыдущему значению прибавляется 1 мс.
 */
function nextUpdatedAt(previous: string): string {
  const now = Date.now();
  const prev = Date.parse(previous);
  const base = Number.isFinite(prev) && now <= prev ? prev + 1 : now;
  return new Date(base).toISOString();
}

function matches(item: PriceItem, id: string): boolean {
  return item.id === id;
}

/** Снимки без `undefined` (z.json() отклоняет неопределённые значения). */
function compactSnapshot(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

function stamped(
  current: PriceItem,
  changes: Record<string, unknown>,
  actor: ActorContext,
): PriceItem {
  return priceItemSchema.parse({
    ...current,
    ...changes,
    updatedAt: nextUpdatedAt(current.updatedAt),
    updatedBy: actor.actorId,
  });
}

// ─── Аудит ───

async function appendEvent(
  id: string,
  input: { oldValue: Record<string, unknown>; newValue: Record<string, unknown> },
  actor: ActorContext,
): Promise<void> {
  await appendAuditEvent({
    action: "priceitem.update",
    entityType: "priceItem",
    entityId: id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    oldValue: compactSnapshot(input.oldValue),
    newValue: compactSnapshot(input.newValue),
  });
}

// ─── Чтение ───

export async function getPriceItem(id: string): Promise<PriceItem | undefined> {
  const items = await readCollection<PriceItem>(COLLECTION);
  return items.find((item) => matches(item, id));
}

export async function listPriceItems(
  filter: { scope?: PriceItem["scope"]; usage?: PriceItem["usage"]; status?: PriceItem["status"] } = {},
): Promise<PriceItem[]> {
  const items = await readCollection<PriceItem>(COLLECTION);
  return items.filter((item) => {
    if (filter.scope !== undefined && item.scope !== filter.scope) return false;
    if (filter.usage !== undefined && item.usage !== filter.usage) return false;
    if (filter.status !== undefined && item.status !== filter.status) return false;
    return true;
  });
}

/** История изменений ставки (ТЗ §8: .../history → AdminAuditLog[]). */
export async function listPriceItemHistory(id: string): Promise<AdminAuditEvent[]> {
  return listAuditEvents({ entityType: "priceItem", entityId: id });
}

// ─── Проверка связей (§6.2 `priceRefs`, §6.3 `priceRef`) ───

/** Ссылки на ставку: пресеты (`ModulePreset.priceRef`) и элементы справочников. */
export async function listPriceItemReferences(
  id: string,
): Promise<{ presets: string[]; catalogs: string[] }> {
  const [presets, catalogs] = await Promise.all([
    readCollection<Record<string, unknown>>(PRESETS),
    readCollection<Record<string, unknown>>(CATALOGS),
  ]);
  const presetHits = presets
    .filter((preset) => preset.priceRef === id)
    .map((preset) => `${String(preset.family)}:${String(preset.id)}`);
  const catalogHits = catalogs
    .filter(
      (item) =>
        Array.isArray(item.priceRefs)
          ? item.priceRefs.includes(id)
          : Object.values(item.priceRefs ?? {}).includes(id),
    )
    .map((item) => `${String(item.catalog)}:${String(item.id)}`);
  return { presets: presetHits, catalogs: catalogHits };
}

/**
 * CA-516-02: опубликованные версии прайса, в snapshot которых входит ставка.
 * Draft не считается исторической зависимостью (архивация вне draft-потока).
 */
async function publishedVersionsReferencing(id: string): Promise<string[]> {
  const versions = await readCollection<Record<string, unknown>>(VERSIONS);
  return versions
    .filter((version) => {
      if (version.status !== "published") return false;
      if (!Array.isArray(version.snapshot)) return false;
      return version.snapshot.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as { priceItemId?: unknown }).priceItemId === id,
      );
    })
    .map((version) => String(version.id));
}

/**
 * Проверка связей `ModulePreset.priceRef` → `PriceItem.id`: возвращает
 * пресеты, чья ссылка не разрешается в существующую ставку (диагностика
 * целостности; сам `priceRef` immutable — CA-T-205).
 */
export async function checkPresetPriceRefs(): Promise<
  Array<{ preset: string; priceRef: string }>
> {
  const [presets, items] = await Promise.all([
    readCollection<Record<string, unknown>>(PRESETS),
    readCollection<PriceItem>(COLLECTION),
  ]);
  const ids = new Set(items.map((item) => item.id));
  const broken: Array<{ preset: string; priceRef: string }> = [];
  for (const preset of presets) {
    const priceRef = preset.priceRef;
    if (typeof priceRef !== "string" || !ids.has(priceRef)) {
      broken.push({
        preset: `${String(preset.family)}:${String(preset.id)}`,
        priceRef: String(priceRef),
      });
    }
  }
  return broken;
}

// ─── Операции ───

/** Разрешённые поля PATCH метаданных; `usage`/`status` — отдельные операции. */
export interface PriceItemPatch {
  label?: string;
  unit?: PriceItem["unit"];
  groupId?: string;
  /** Обязательная метка сравнения (R-16); схема `version` не содержит. */
  expectedUpdatedAt: string;
}

const PATCHABLE = new Set(["label", "unit", "groupId", "expectedUpdatedAt"]);

/**
 * Редактирование метаданных (ТЗ §8 PATCH): `expectedUpdatedAt` обязателен
 * (R-16) → конфликт при несовпадении; `amount`/`usage`/`status`/
 * `sourceRef`/`scope`/`id` — вне патча (суммы в версиях §8.1, остальное —
 * immutable/отдельные операции). Только active.
 */
export async function updatePriceItem(
  id: string,
  patch: PriceItemPatch,
  actor: ActorContext,
): Promise<PriceItem> {
  for (const key of Object.keys(patch)) {
    if (!PATCHABLE.has(key)) {
      throw new Error(
        `Поле "${key}" изменять нельзя: вне scope CA-T-207 (разрешены label/unit/groupId; usage/status — отдельные операции; amount живёт в PricingVersion, §8.1).`,
      );
    }
  }
  if (patch.label === undefined && patch.unit === undefined && patch.groupId === undefined) {
    throw new Error("Патч не содержит изменяемых полей (label/unit/groupId).");
  }
  requireToken(id, patch.expectedUpdatedAt);

  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};

  const updated = await updateCollection<PriceItem, PriceItem>(
    COLLECTION,
    (items) => {
      const current = items.find((item) => matches(item, id));
      if (!current) throw notFound(id);
      if (current.status !== "active") {
        throw new Error(
          `Редактирование доступно только для status=active (§6.4); ставка "${id}" — "${current.status}".`,
        );
      }
      if (current.updatedAt !== patch.expectedUpdatedAt) {
        throw conflict(id, patch.expectedUpdatedAt, current.updatedAt);
      }

      const changes: Record<string, unknown> = {};
      if (patch.label !== undefined) {
        previous.label = current.label;
        next.label = patch.label;
        changes.label = patch.label;
      }
      if (patch.unit !== undefined) {
        previous.unit = current.unit;
        next.unit = patch.unit;
        changes.unit = patch.unit;
      }
      if (patch.groupId !== undefined) {
        previous.groupId = current.groupId;
        next.groupId = patch.groupId;
        changes.groupId = patch.groupId;
      }

      const validated = stamped(current, changes, actor);
      return { items: items.map((item) => (matches(item, id) ? validated : item)), result: validated };
    },
  );

  await appendEvent(id, { oldValue: previous, newValue: next }, actor);
  return updated;
}

/**
 * CA-T-504 / дизайн §8.2: правка `amount` применяется **только к draft-снимку**
 * (единственная draft-версия); published/superseded неизменяемы. CAS по
 * `expectedAmount` защищает от параллельной перезаписи. Аудит `price.update`.
 */
export async function updateDraftPriceAmount(
  priceItemId: string,
  patch: { amount: number; expectedAmount: number },
  actor: ActorContext,
): Promise<PricingVersion> {
  if (!Number.isFinite(patch.amount) || patch.amount < 0) {
    throw new Error(`Сумма ставки "${priceItemId}" должна быть конечным числом ≥ 0.`);
  }
  if (!Number.isFinite(patch.expectedAmount)) {
    throw new Error(`Для ставки "${priceItemId}" обязателен expectedAmount.`);
  }

  let previousAmount: number | undefined;
  const updated = await updateCollection<PricingVersion, PricingVersion>(
    VERSIONS,
    (versions) => {
      const drafts = versions.filter((version) => version.status === "draft");
      if (drafts.length === 0) {
        throw new Error("Draft-версия не найдена: правка amount возможна только в draft (§8.2).");
      }
      if (drafts.length > 1) {
        throw new Error(
          `Нарушение §8.2: обнаружено ${drafts.length} draft-версий — правка amount не выполняется.`,
        );
      }
      const draft = drafts[0]!;
      const index = draft.snapshot.findIndex(
        (entry) => entry.priceItemId === priceItemId,
      );
      if (index < 0) {
        throw new Error(
          `Ставка "${priceItemId}" отсутствует в draft-снимке "${draft.id}" — amount не подменяется.`,
        );
      }
      const current = draft.snapshot[index]!.amount;
      previousAmount = current;
      if (current !== patch.expectedAmount) {
        throw new Error(
          `Конфликт суммы "${priceItemId}": ожидалось ${patch.expectedAmount}, фактически ${current}; данные не изменены.`,
        );
      }
      const snapshot = draft.snapshot.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, amount: patch.amount } : entry,
      );
      const next = pricingVersionSchema.parse({ ...draft, snapshot });
      return {
        items: versions.map((version) => (version.id === draft.id ? next : version)),
        result: next,
      };
    },
  );

  await appendAuditEvent({
    action: "price.update",
    entityType: "pricingVersion",
    entityId: updated.id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    oldValue: { priceItemId, amount: previousAmount },
    newValue: { priceItemId, amount: patch.amount },
  });

  return updated;
}

/**
 * Управление `usage` (§6.4): `used → unused` — штатно; `unused → used` —
 * только через релиз/публикацию (CA-T-211) → отказ. Для 4 мёртвых полей
 * перевод в `unused` дополнительно выставляет `editable=false`
 * (схема: «`false` для permanently-unused»).
 */
export async function setPriceItemUsage(
  id: string,
  usage: PriceItem["usage"],
  actor: ActorContext,
  expectedUpdatedAt: string,
): Promise<PriceItem> {
  requireToken(id, expectedUpdatedAt);
  let previousUsage: PriceItem["usage"] | undefined;

  const updated = await updateCollection<PriceItem, PriceItem>(
    COLLECTION,
    (items) => {
      const current = items.find((item) => matches(item, id));
      if (!current) throw notFound(id);
      if (current.status !== "active") {
        throw new Error(
          `Смена usage доступна только для status=active (§6.4); ставка "${id}" — "${current.status}".`,
        );
      }
      if (current.updatedAt !== expectedUpdatedAt) {
        throw conflict(id, expectedUpdatedAt, current.updatedAt);
      }
      if (current.usage === usage) return { items, result: current };
      if (usage === "used") {
        throw new Error(
          `Перевод "${id}" в usage=used возможен только через релиз/публикацию (§6.4) — операция вне scope CA-T-207 (CA-T-211).`,
        );
      }

      previousUsage = current.usage;
      const changes: Record<string, unknown> = { usage };
      if (DEAD_IDS.has(id)) changes.editable = false;
      const validated = stamped(current, changes, actor);
      return { items: items.map((item) => (matches(item, id) ? validated : item)), result: validated };
    },
  );

  if (previousUsage !== undefined) {
    await appendEvent(
      id,
      { oldValue: { usage: previousUsage }, newValue: { usage } },
      actor,
    );
  }
  return updated;
}

/**
 * Архивирование вместо удаления (§6.4, OI-046):
 *  1. только `active → archived`;
 *  2. **запрет `archived+used`** — используемая ставка не архивируется;
 *  3. отказ при ссылках `ModulePreset.priceRef` / `CatalogItem.priceRefs`
 *     (целостность FK, §6.2/§6.3 → 409 при появлении API).
 * Операция выполняется **вне draft-потока** (§8.2): версии прайса не
 * читаются и не изменяются — архивирование не требует инфраструктуры
 * draft (CA-T-208+).
 */
export async function archivePriceItem(
  id: string,
  actor: ActorContext,
  expectedUpdatedAt: string,
): Promise<PriceItem> {
  requireToken(id, expectedUpdatedAt);
  const archived = await updateCollection<PriceItem, PriceItem>(
    COLLECTION,
    async (items) => {
      const current = items.find((item) => matches(item, id));
      if (!current) throw notFound(id);
      if (current.status === "archived") {
        throw new Error(`Ставка "${id}" уже в архиве.`);
      }
      if (current.updatedAt !== expectedUpdatedAt) {
        throw conflict(id, expectedUpdatedAt, current.updatedAt);
      }
      if (current.usage === "used") {
        throw new Error(
          `Архивирование "${id}" отклонено: ставка используется движком (usage=used) — комбинация archived+used недопустима (§6.4). Сначала пометьте usage=unused (OI-054).`,
        );
      }

      const refs = await listPriceItemReferences(id);
      const referenced = [...refs.presets, ...refs.catalogs];
      if (referenced.length > 0) {
        throw new Error(
          `Архивирование "${id}" отклонено: на ставку ссылаются ${referenced.join(", ")} (priceRef/priceRefs, §6.2/§6.3).`,
        );
      }

      // CA-516-02: опубликованный snapshot — историческая зависимость.
      // Ставка остаётся доступной для чтения/пересчёта старых проектов.
      const published = await publishedVersionsReferencing(id);
      if (published.length > 0) {
        throw new Error(
          `Архивирование "${id}" отклонено: ставка входит в опубликованные версии прайса (${published.join(", ")}) — исторические snapshots сохраняются (CA-516-02).`,
        );
      }

      const validated = stamped(current, { status: "archived" }, actor);
      return { items: items.map((item) => (matches(item, id) ? validated : item)), result: validated };
    },
  );

  await appendEvent(
    id,
    { oldValue: { status: "active" }, newValue: { status: "archived" } },
    actor,
  );
  return archived;
}

/**
 * Возврат `archived → active` (§6.4): допустим только для ставок,
 * отсутствующих в `published`-версиях; при наличии в опубликованном
 * снимке — отказ («явное решение оператора с журналом»: механизм
 * подтверждения вне scope CA-T-207 — вопрос владельцу). Файл версий
 * читается как есть; отсутствие (`missing` → `[]`) не блокирует.
 */
export async function restorePriceItem(
  id: string,
  actor: ActorContext,
  expectedUpdatedAt: string,
): Promise<PriceItem> {
  requireToken(id, expectedUpdatedAt);
  const restored = await updateCollection<PriceItem, PriceItem>(
    COLLECTION,
    async (items) => {
      const current = items.find((item) => matches(item, id));
      if (!current) throw notFound(id);
      if (current.status !== "archived") {
        throw new Error(`Ставка "${id}" не в архиве (текущий статус "${current.status}").`);
      }
      if (current.updatedAt !== expectedUpdatedAt) {
        throw conflict(id, expectedUpdatedAt, current.updatedAt);
      }

      const versions = await readCollection<Record<string, unknown>>(VERSIONS);
      const published = versions.filter((version) => version.status === "published");
      for (const version of published) {
        const snapshot = Array.isArray(version.snapshot) ? version.snapshot : [];
        const hit = snapshot.find(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            (entry as { priceItemId?: unknown }).priceItemId === id,
        );
        if (hit) {
          throw new Error(
            `Возврат "${id}" в active отклонён: ставка включена в опубликованную версию "${String(version.id)}" (§6.4) — допустим только как явное решение оператора с журналом; механизм подтверждения вне scope CA-T-207.`,
          );
        }
      }

      const validated = stamped(current, { status: "active" }, actor);
      return { items: items.map((item) => (matches(item, id) ? validated : item)), result: validated };
    },
  );

  await appendEvent(
    id,
    { oldValue: { status: "archived" }, newValue: { status: "active" } },
    actor,
  );
  return restored;
}

/**
 * Пометка 4 мёртвых полей (§4 аудита, OI-054): `usage: used → unused` +
 * `editable=false` (схема §6.4). Идемпотентно: уже неиспользуемые —
 * `unchanged`, отсутствующие в коллекции — `missing` (создание ставок вне
 * scope — enum не содержит `priceitem.create`). `expected` — id →
 * обязательная метка `expectedUpdatedAt` (R-16) для записей, которые
 * будут изменены; для `unchanged`/`missing` метка не требуется.
 */
export interface MarkUnusedReport {
  marked: string[];
  unchanged: string[];
  missing: string[];
}

export async function markPermanentlyUnused(
  actor: ActorContext,
  expected: Readonly<Record<string, string>>,
): Promise<MarkUnusedReport> {
  const report: MarkUnusedReport = { marked: [], unchanged: [], missing: [] };

  await updateCollection<PriceItem, PriceItem[]>(
    COLLECTION,
    (items) => {
      const byId = new Map(items.map((item) => [item.id, item]));
      const updates = new Map<string, PriceItem>();
      for (const dead of PERMANENTLY_UNUSED) {
        const current = byId.get(dead.id);
        if (!current) {
          report.missing.push(dead.id);
          continue;
        }
        if (current.usage === "unused" && current.editable === false) {
          report.unchanged.push(dead.id);
          continue;
        }
        // R-16: метка обязательна только для записей, которые будут изменены.
        const token = expected[dead.id];
        requireToken(dead.id, token);
        if (current.updatedAt !== token) {
          throw conflict(dead.id, token!, current.updatedAt);
        }
        updates.set(
          dead.id,
          stamped(current, { usage: "unused", editable: false }, actor),
        );
      }
      if (updates.size === 0) return { items, result: items };
      report.marked.push(...updates.keys());
      return {
        items: items.map((item) => updates.get(item.id) ?? item),
        result: items.map((item) => updates.get(item.id) ?? item),
      };
    },
  );

  for (const id of report.marked) {
    await appendEvent(
      id,
      { oldValue: { usage: "used", editable: true }, newValue: { usage: "unused", editable: false } },
      actor,
    );
  }
  return report;
}

/**
 * Удаление запрещено всегда (§6.4, OI-046): явный guard — операция не
 * выполняется и не обращается к хранилищу.
 */
export async function deletePriceItem(id: string): Promise<never> {
  throw new Error(
    `Удаление ставки "${id}" запрещено всегда (§6.4, OI-046) — используйте архивирование.`,
  );
}
