import { randomBytes } from "node:crypto";

import { appendAuditEvent } from "@/lib/server/audit";
import { ensurePublishRecalculationBatch } from "./publish-recalc";
import { readCollection, updateCollection } from "@/lib/server/store";

import type { ActorContext } from "./parameters";
import { computePricingDiff, validateDraftVersion } from "./pricing";
import {
  pricingVersionSchema,
  type PricingChange,
  type PricingVersion,
} from "./schema";

/**
 * CA-T-211 — публикация draft PricingVersion (карточка: «атомарная запись
 * прайса; журнал после; superseded», «невозможна при passed=false; повтор →
 * 409»; дизайн §8.4).
 *
 * Порядок операций (§8.4 + R-09/§13.2 «журнал после»):
 *  1. `validateDraftVersion(id)` — актуальная валидация **именно этой**
 *     версии; `passed=false` (errors) → отказ (§8.3 «passed=false → 422» —
 *     маппинг при HTTP, CA-T-609/C11); info-сообщения `price_ref_*`
 *     (R-15) не блокируют — §8.3 определяет блокером только passed.
 *  2. Канонический токен snapshot; под замком Storage Adapter версия
 *     перечитывается: статус должен остаться `draft`, snapshot —
 *     неизменен после валидации (§8.4 «финальная валидация»).
 *  3. **История до фиксации:** `PricingChange[]` (§6.6, diff с предыдущей
 *     published-версией через `computePricingDiff`, сопоставление по
 *     стабильным ID) добавляется в append-only коллекцию **до** записи
 *     версии — при ошибке истории публикация не фиксируется (§3.5).
 *  4. Одна атомарная запись файла версий (temp+rename, Storage Adapter):
 *     draft → `published` + `publishedSeq` (R-07/C8: монотонное число,
 *     max(seq)+1, без переиспользования) + `publishedAt/publishedBy`;
 *     предыдущая `published` → `superseded` в той же записи (раздельного
 *     supersede не бывает).
 *  5. Аудит `pricing.publish` **после** записи (R-09/§13.2: публикация и
 *     журнал — отдельные операции; при сбое журнала данные сохраняются,
 *     ошибка пробрасывается без компенсации — документированное
 *     ограничение, не транзакционность).
 *
 * Границы: пересчёт проектов не запускается (CA-T-404+), проекты и
 * `calcVersion` не изменяются, RBAC не проверяется (R-18: право
 * `price.publish` остаётся, CA-T-602/603 — операция НЕ production-safe),
 * прошлые `PricingChange` не мутируются (append-only). Ограничение
 * JSON-хранилища: «история + версия» — две записи разных файлов; порядок
 * «история → версия» исключает published без истории, но сбой между
 * записями может оставить историю без версии (межфайровой транзакции нет
 * — §13.1; документировано, не заявляется транзакционность).
 */

const VERSIONS = "pricing-versions.json";
const CHANGES = "pricing-changes.json";

/** Результат создания draft-копии из версии-источника. */
export interface CreateDraftResult {
  version: PricingVersion;
  sourceVersionId: string;
}

/**
 * CA-T-504 / дизайн §8.2: создание единственного draft копией полного
 * снимка выбранной версии. Существующий draft не перезаписывается;
 * источник не мутируется. Аудит `pricing.create` — после записи.
 */
export async function createDraftPricingVersion(
  sourceVersionId: string,
  actor: ActorContext,
): Promise<CreateDraftResult> {
  if (typeof sourceVersionId !== "string" || sourceVersionId.length === 0) {
    throw new Error(
      "Создание draft требует явного id версии-источника (§8.2: fromVersionId).",
    );
  }
  const now = new Date().toISOString();
  const created = await updateCollection<PricingVersion, PricingVersion>(
    VERSIONS,
    (versions) => {
      const source = versions.find((version) => version.id === sourceVersionId);
      if (!source) {
        throw new Error(`Версия-источник "${sourceVersionId}" не найдена.`);
      }
      const existingDraft = versions.find((version) => version.status === "draft");
      if (existingDraft) {
        throw new Error(
          `Draft уже существует ("${existingDraft.id}") — допускается не более одной draft-версии (§8.2); существующий draft не перезаписывается.`,
        );
      }
      const id = `price-draft-${randomBytes(6).toString("hex")}`;
      if (versions.some((version) => version.id === id)) {
        throw new Error(`Не удалось создать draft: id "${id}" уже существует.`);
      }
      const copy = JSON.parse(JSON.stringify(source)) as PricingVersion;
      const next = pricingVersionSchema.parse({
        ...copy,
        id,
        status: "draft",
        notes: `draft from ${sourceVersionId}`,
        createdAt: now,
        createdBy: actor.actorId,
        publishedSeq: undefined,
        publishedAt: undefined,
        publishedBy: undefined,
      });
      return { items: [...versions, next], result: next };
    },
  );

  await appendAuditEvent({
    action: "pricing.create",
    entityType: "pricingVersion",
    entityId: created.id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    newValue: { id: created.id, status: "draft", fromVersionId: sourceVersionId },
  });

  return { version: created, sourceVersionId };
}

/** Результат публикации. */
export interface PublishResult {
  /** Опубликованная запись (status=published, publishedSeq, publishedAt/By). */
  version: PricingVersion;
  publishedSeq: number;
  /** Версия, переведённая в superseded (null — первой публикации). */
  supersededVersionId: string | null;
  /** Число записанных PricingChange (0 — без изменений/первая публикация). */
  changesCount: number;
}

/** Канонический токен snapshot для проверки «не изменился после валидации». */
function snapshotToken(snapshot: PricingVersion["snapshot"]): string {
  return JSON.stringify(
    [...snapshot].sort((a, b) => a.priceItemId.localeCompare(b.priceItemId)),
  );
}

function changeKey(record: {
  versionId: string;
  targetKey: string;
  field: string;
  targetType: string;
}): string {
  return [record.versionId, record.targetType, record.targetKey, record.field].join(" ");
}

/**
 * Публикация конкретной draft-версии по id (§8.4).
 *
 * Только по id — случайный draft не выбирается. Повторная публикация уже
 * опубликованной версии → отказ «повтор → 409» без изменения данных.
 */
export async function publishPricingVersion(
  id: string,
  actor: ActorContext,
  options: { enqueueRecalculation?: boolean } = {},
): Promise<PublishResult> {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(
      "Публикация требует явного id draft-версии (случайный draft не выбирается, §8.2).",
    );
  }

  // 1) Актуальная валидация именно этой версии (§8.4: финальная валидация).
  const validation = await validateDraftVersion(id);
  const errors = validation.issues.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    if (errors.some((item) => item.code === "version_not_found")) {
      throw new Error(`Версия "${id}" не найдена — публикация невозможна.`);
    }
    if (errors.some((item) => item.code === "not_draft")) {
      throw new Error(
        `Версия "${id}" не является draft (повторная публикация либо иной статус) — повтор → 409; данные не изменяются.`,
      );
    }
    throw new Error(
      `Публикация "${id}" запрещена: валидация §8.3 не пройдена (passed=false → 422): ` +
        errors.map((item) => `${item.path}: ${item.message}`).join("; "),
    );
  }

  const versionsBefore = await readCollection<PricingVersion>(VERSIONS);
  const target = versionsBefore.find((version) => version.id === id);
  if (!target) {
    throw new Error(`Версия "${id}" не найдена — публикация невозможна.`);
  }
  const token = snapshotToken(target.snapshot);

  // Предыдущая published — база diff (§6.6 «между версиями»); отсутствие
  // базы → без PricingChange (не генерировать фиктивные изменения).
  const previous = versionsBefore.find((version) => version.status === "published");
  const diff = previous ? computePricingDiff(previous, target) : [];

  const now = new Date().toISOString();
  const changeRecords: PricingChange[] = diff.map((entry) => ({
    id: randomBytes(8).toString("hex"),
    versionId: id,
    targetType: entry.targetType,
    targetKey: entry.targetKey,
    field: entry.field,
    // Значения версий — сериализованный JSON (snapshot/rules/promos/
    // metadata): приведение unknown → JSONType типобезопасно по источнику.
    oldValue: entry.oldValue as PricingChange["oldValue"],
    newValue: entry.newValue as PricingChange["newValue"],
    createdBy: actor.actorId,
    createdAt: now,
  }));

  // 2–4) Критическая секция под замком версий; история — до фиксации.
  let supersededVersionId: string | null = null;
  let publishedSeq = 0;
  const published = await updateCollection<PricingVersion, PricingVersion>(
    VERSIONS,
    async (versions) => {
      const current = versions.find((version) => version.id === id);
      if (!current) {
        throw new Error(`Версия "${id}" не найдена (повторная проверка под замком).`);
      }
      if (current.status === "published") {
        throw new Error(
          `Версия "${id}" уже опубликована — повторная публикация невозможна (повтор → 409).`,
        );
      }
      if (current.status !== "draft") {
        throw new Error(
          `Версия "${id}" имеет статус "${current.status}" — публикация только из draft (§8.2); повтор → 409.`,
        );
      }
      // Защита единственной активной версии (§8.4.2; P2-FIX-001 по
      // AUDIT-P2-002): проверка выполнена ПОД тем же замком Storage
      // Adapter, что и публикация, — вне замка конкурентная запись могла
      // бы изменить состав published-версий. При >1 — отказ без выбора
      // «первой» записи и до каких-либо записей (PricingChange, версия,
      // журнал не создаются); конфликт не разрешается автоматически.
      const activeOnes = versions.filter((version) => version.status === "published");
      if (activeOnes.length > 1) {
        throw new Error(
          `Публикация "${id}" отклонена: обнаружено ${activeOnes.length} опубликованных версий (${activeOnes
            .map((version) => version.id)
            .join(", ")}) — §8.4.2 требует единственной активной версии; конфликт не разрешается автоматически, статусы не изменяются.`,
        );
      }
      if (snapshotToken(current.snapshot) !== token) {
        throw new Error(
          `Draft "${id}" изменился после валидации (snapshot не идентичен) — публикация отменена (§8.4).`,
        );
      }

      // История ДО фиксации публикации (§3.5): при её ошибке версия не
      // станет published.
      if (changeRecords.length > 0) {
        await updateCollection<PricingChange, void>(CHANGES, (existing) => {
          for (const record of changeRecords) {
            if (existing.some((item) => changeKey(item) === changeKey(record))) {
              throw new Error(
                `Конфликт U(versionId,targetType,targetKey,field) для PricingChange "${record.targetKey}.${record.field}" версии "${id}" — дубликат.`,
              );
            }
          }
          return { items: [...existing, ...changeRecords], result: undefined };
        });
      }

      const previousPublished = versions.find((version) => version.status === "published");
      if (previousPublished) supersededVersionId = previousPublished.id;
      publishedSeq =
        versions.reduce((max, version) => Math.max(max, version.publishedSeq ?? 0), 0) + 1;

      const next = pricingVersionSchema.parse({
        ...current,
        status: "published",
        publishedSeq,
        publishedAt: now,
        publishedBy: actor.actorId,
      });
      const items = versions.map((version) => {
        if (version.id === id) return next;
        if (version.status === "published") {
          return pricingVersionSchema.parse({ ...version, status: "superseded" });
        }
        return version;
      });
      return { items, result: next };
    },
  );

  // 5) Журнал после записи (R-09/§13.2): при сбое — данные сохранены,
  // ошибка пробрасывается без компенсации.
  await appendAuditEvent({
    action: "pricing.publish",
    entityType: "pricingVersion",
    entityId: id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    oldValue: { status: "draft" },
    newValue: { status: "published", publishedSeq },
  });

  // Stage 8 / Block 2: batch создаётся в publish workflow (API/оператор).
  // Прямой вызов сервиса в тестах не обязан запускать пересчёт.
  if (options.enqueueRecalculation) {
    try {
      await ensurePublishRecalculationBatch(published, actor.actorId);
    } catch {
      // Публикация уже зафиксирована; восстановление — на worker-start.
    }
  }

  return {
    version: published,
    publishedSeq,
    supersededVersionId,
    changesCount: changeRecords.length,
  };
}

// ─── Откат (CA-T-212, дизайн §8.5) ───

/** Результат отката: новая draft-копия и явно указанный источник. */
export interface RollbackResult {
  /** Новая draft-версия (собственный id, status=draft, publishedSeq отсутствует). */
  version: PricingVersion;
  /** Исходная (историческая) версия-источник — по её id. */
  sourceVersionId: string;
}

/**
 * Откат — создание новой draft-версии со snapshot выбранной исторической
 * опубликованной версии (карточка CA-T-212 «Откат = новая версия-копия»,
 * дизайн §8.5).
 *
 * Правила §8.5: история append-only — исходная версия не мутирует (статус,
 * snapshot, publishedSeq не меняются); альтернатива «переключить статус
 * старой версии обратно на draft» отклонена документом; источник
 * фиксируется в `notes` новой версии строкой §8.5 `rollback to <id>`
 * (поле `notes` — контракт §6.5, новых полей не вводится).
 *
 * Допустимые источники: версии, побывавшие опубликованными (`published`
 * или `superseded`) — «историческая» §8.5; `draft` → отказ (не история
 * публикаций). Конфликтующий draft (§8.2: не более одной draft-версии) →
 * отказ: существующий draft не перезаписывается. Публикация, пересчёт,
 * `PricingChange` НЕ выполняются (создание копии ≠ публикация; §6.6 —
 * при публикации, CA-T-211); валидация — отдельным вызовом
 * `validateDraftVersion(новый id)` (§6 задания), publish валидирует
 * повторно. RBAC не проверяется (R-18 — не production-safe).
 *
 * Атомарность: создание версии — одна запись файла версий (Storage
 * Adapter, замок исключает гонки); аудит `pricing.rollback` ПОСЛЕ записи
 * (порядок «данные → журнал» §13.2/R-09: при сбое журнала копия
 * сохраняется, ошибка пробрасывается — документировано, межфайровой
 * транзакции нет).
 */
export async function rollbackPricingVersion(
  sourceId: string,
  actor: ActorContext,
): Promise<RollbackResult> {
  if (typeof sourceId !== "string" || sourceId.length === 0) {
    throw new Error(
      "Откат требует явного id исходной (исторической) версии — подмена текущей опубликованной не допускается.",
    );
  }

  const now = new Date().toISOString();
  const created = await updateCollection<PricingVersion, PricingVersion>(
    VERSIONS,
    (versions) => {
      const source = versions.find((version) => version.id === sourceId);
      if (!source) {
        throw new Error(
          `Версия "${sourceId}" не найдена — откат невозможен; исходная версия не подменяется текущей опубликованной.`,
        );
      }
      if (source.status === "draft") {
        throw new Error(
          `Версия "${sourceId}" имеет статус "draft" — откат выполняется от исторической опубликованной версии (§8.5: published|superseded).`,
        );
      }
      const existingDraft = versions.find((version) => version.status === "draft");
      if (existingDraft) {
        throw new Error(
          `Откат невозможен: уже существует draft-версия "${existingDraft.id}" (§8.2: не более одной) — существующий draft не перезаписывается.`,
        );
      }

      // Глубокая копия источника: исходная запись и её snapshot не
      // разделяются по памяти и не мутируются (§8.5: копия 1:1, без
      // семантической подмены и без «исправления» исторических данных).
      const copy = JSON.parse(JSON.stringify(source)) as PricingVersion;
      const id = `price-rollback-${randomBytes(6).toString("hex")}`;
      if (versions.some((version) => version.id === id)) {
        throw new Error(`Не удалось создать откат: id "${id}" уже существует.`);
      }

      const next = pricingVersionSchema.parse({
        ...copy,
        id,
        status: "draft",
        notes: `rollback to ${sourceId}`,
        createdAt: now,
        createdBy: actor.actorId,
        // Дraft не наследует публикационные атрибуты источника: seq
        // выдаёт только publish (R-07), publishedAt/By — только при
        // публикации (§8.4); тест проверяет неизменность seq остальных.
        publishedSeq: undefined,
        publishedAt: undefined,
        publishedBy: undefined,
      });
      return { items: [...versions, next], result: next };
    },
  );

  await appendAuditEvent({
    action: "pricing.rollback",
    entityType: "pricingVersion",
    entityId: created.id,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    newValue: { id: created.id, status: "draft", rollbackTo: sourceId },
  });

  return { version: created, sourceVersionId: sourceId };
}
