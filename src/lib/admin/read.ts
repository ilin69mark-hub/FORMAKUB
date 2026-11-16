import { readCollection } from "@/lib/server/store";

import { getPublishedVersion, getVersion } from "./pricing";
import type { PricingChange, PricingVersion } from "./schema";

/**
 * CA-T-213 — чтение PricingVersion для `DataResolver` (карточка: «по
 * явному id; „последняя" = единственная `published` по статусу»;
 * «не зависит от порядка ID; не требует CA-T-402»).
 *
 * **Read-only:** только чтение через Storage Adapter; версии, snapshot,
 * `publishedSeq`, `PricingChange`, audit-журнал, проекты, `calcVersion`
 * не создаются/не изменяются; валидация, публикация и откат не
 * запускаются. Уже реализованные операции переиспользуются из `pricing.ts`
 * (`getVersion`, `getPublishedVersion`) — дублирующие API не создаются.
 *
 * «Последняя» версия определяется **по статусу** (единственная
 * `published`, §8.4.2), а не по лексикографическому порядку id (CA-T-402
 * не требуется); несколько `published` → отказ (диагностика неоднозначности,
 * без случайного выбора). Исторические snapshots возвращаются в
 * сохранённом виде — без подмены текущими ставками и без пересчёта.
 */

const CHANGES = "pricing-changes.json";

/**
 * Чтение версии: по явному `id` (не найдено → `undefined`, отсутствующая
 * версия не подменяется текущей опубликованной); без `id` — «последняя» =
 * единственная `published` (нет → `undefined`; несколько → отказ).
 */
export async function readPricingVersion(
  id?: string,
): Promise<PricingVersion | undefined> {
  if (id !== undefined) return getVersion(id);
  return getPublishedVersion();
}

/**
 * История `PricingChange` (§6.6, append-only) версии по точной связи
 * `versionId`. Отсутствие журнала → `[]` (чтение не создаёт файлы и
 * фиктивных записей); записи других версий не включаются; порядок —
 * порядок хранилища (append-only), сортировка контрактом не предусмотрена.
 */
export async function listPricingChanges(
  versionId: string,
): Promise<PricingChange[]> {
  const changes = await readCollection<PricingChange>(CHANGES);
  return changes.filter((change) => change.versionId === versionId);
}

/**
 * Источник отката из `notes` версии (§8.5: `rollback to <id>` — строка
 * фиксируется при создании копии, CA-T-212). Несовпадение формата или
 * отсутствие `notes` → `null` (не гадается, данные не исправляются).
 */
export function rollbackSourceId(version: PricingVersion): string | null {
  const prefix = "rollback to ";
  if (typeof version.notes === "string" && version.notes.startsWith(prefix)) {
    const source = version.notes.slice(prefix.length);
    return source.length > 0 ? source : null;
  }
  return null;
}
