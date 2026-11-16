import { appendAuditEvent, listAuditEvents, type AdminAuditEvent } from "@/lib/server/audit";
import { readCollection, updateCollection } from "@/lib/server/store";

import type { ActorContext } from "./parameters";
import { modulePresetSchema, type ModulePreset } from "./schema";

/**
 * Сервис ModulePreset (CA-T-205).
 *
 * Scope (согласован): чтение, список по family, PATCH диапазонов/дефолтов/zone,
 * архивирование, история, запрет удаления. **Создание не реализуется** (нет
 * согласованного POST и нет `preset.create` в enum аудита — enum не расширяется).
 *
 * Правила: дизайн §6.3 (U(family,id), границы ≤ kitchenModuleSchema, архив
 * вместо удаления, удаление запрещено), ТЗ §03/§8 (shelves 0–10, drawers 0–6,
 * PATCH → 422). Версия записи — числовая строка, инкремент по контракту
 * CA-T-203 (формат архитектурно не утверждён); `expectedVersion` обязателен
 * для PATCH, любое фактическое изменение → ровно +1; без фактических
 * изменений — без записи, без версии, без журнала.
 *
 * Архивирование безопасно для старых проектов (проверено фактически):
 * загрузка/пересчёт (`getProject` → normalize/validate/calculatePrice) читают
 * только кодовый `KITCHEN_MODULES` (`@/content/catalog`) и не обращаются к
 * admin-хранилищу пресетов; значения существующих проектов зафиксированы в
 * `config` (§6.3/S-06).
 */

const COLLECTION = "module-presets.json";

/** Только эти поля доступны в PATCH; `id`/`family`/`priceRef` — immutable. */
const PATCH_FIELDS = new Set([
  "expectedVersion",
  "width",
  "height",
  "depth",
  "defaultShelves",
  "defaultDrawers",
  "zone",
]);

/** Границы ТЗ §03 (схема проверяет тип, но не диапазон этих полей). */
const SHELVES_MIN = 0;
const SHELVES_MAX = 10;
const DRAWERS_MIN = 0;
const DRAWERS_MAX = 6;

function entityOf(family: string, id: string): string {
  return `${family}:${id}`;
}

function notFound(family: string, id: string): Error {
  return new Error(`Пресет "${entityOf(family, id)}" не найден.`);
}

function matches(preset: ModulePreset, family: string, id: string): boolean {
  return preset.family === family && preset.id === id;
}

/** Числовой инкремент — контракт CA-T-203 (формат не архитектурно утверждён). */
function nextVersion(current: string): string {
  if (!/^\d+$/.test(current)) {
    throw new Error(
      `Не удалось инкрементировать version="${current}": формат не поддерживается (контракт CA-T-203).`,
    );
  }
  return String(Number(current) + 1);
}

function compactSnapshot(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

function dimsEqual(
  a: { min: number; max: number; default: number },
  b: { min: number; max: number; default: number },
): boolean {
  return a.min === b.min && a.max === b.max && a.default === b.default;
}

export interface ModulePresetPatch {
  expectedVersion: string;
  width?: { min: number; max: number; default: number };
  height?: { min: number; max: number; default: number };
  depth?: { min: number; max: number; default: number };
  defaultShelves?: number;
  defaultDrawers?: number;
  zone?: string;
}

/**
 * Проверка контракта PATCH: только разрешённые поля, обязательный
 * `expectedVersion`, непустой набор изменений, границы shelves/drawers
 * (ТЗ §03: 0–10 / 0–6 — вне схемы, поэтому на уровне сервиса).
 */
function assertPatch(patch: ModulePresetPatch): void {
  for (const key of Object.keys(patch)) {
    if (!PATCH_FIELDS.has(key)) {
      throw new Error(
        `Поле "${key}" изменять нельзя: immutable или вне scope CA-T-205 (id/family/priceRef/status/version).`,
      );
    }
  }
  if (!patch.expectedVersion) {
    throw new Error("expectedVersion обязателен для PATCH (ТЗ §8).");
  }
  const hasChanges =
    patch.width !== undefined ||
    patch.height !== undefined ||
    patch.depth !== undefined ||
    patch.defaultShelves !== undefined ||
    patch.defaultDrawers !== undefined ||
    patch.zone !== undefined;
  if (!hasChanges) {
    throw new Error("PATCH не содержит изменяемых полей.");
  }
  if (
    patch.defaultShelves !== undefined &&
    (patch.defaultShelves < SHELVES_MIN || patch.defaultShelves > SHELVES_MAX)
  ) {
    throw new Error(
      `defaultShelves=${patch.defaultShelves} вне границ ${SHELVES_MIN}–${SHELVES_MAX} (ТЗ §03).`,
    );
  }
  if (
    patch.defaultDrawers !== undefined &&
    (patch.defaultDrawers < DRAWERS_MIN || patch.defaultDrawers > DRAWERS_MAX)
  ) {
    throw new Error(
      `defaultDrawers=${patch.defaultDrawers} вне границ ${DRAWERS_MIN}–${DRAWERS_MAX} (ТЗ §03).`,
    );
  }
}

// ─── Чтение ───

export async function getModulePreset(
  family: string,
  id: string,
): Promise<ModulePreset | undefined> {
  const items = await readCollection<ModulePreset>(COLLECTION);
  return items.find((item) => matches(item, family, id));
}

export async function listModulePresets(
  filter: { family?: string } = {},
): Promise<ModulePreset[]> {
  const items = await readCollection<ModulePreset>(COLLECTION);
  return items.filter((item) =>
    filter.family === undefined ? true : item.family === filter.family,
  );
}

// ─── Аудит ───

async function appendEvent(
  family: string,
  id: string,
  input: {
    oldValue: Record<string, unknown>;
    newValue: Record<string, unknown>;
    paramVersion?: string;
  },
  actor: ActorContext,
): Promise<void> {
  await appendAuditEvent({
    action: "preset.update",
    entityType: "preset",
    entityId: entityOf(family, id),
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    oldValue: compactSnapshot(input.oldValue),
    newValue: compactSnapshot(input.newValue),
    ...(input.paramVersion !== undefined
      ? { paramVersion: input.paramVersion }
      : {}),
  });
}

// ─── Изменение ───

/**
 * PATCH (ТЗ §8, 422): диапазоны/дефолты/zone. Полная strict-валидация
 * `modulePresetSchema` (границы размеров §6.3), сервисные границы
 * shelves/drawers. `expectedVersion` обязателен; фактическое изменение →
 * version +1; отсутствие изменений → без записи/версии/журнала.
 */
export async function updateModulePreset(
  family: string,
  id: string,
  patch: ModulePresetPatch,
  actor: ActorContext,
): Promise<ModulePreset> {
  assertPatch(patch);

  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};

  const updated = await updateCollection<ModulePreset, ModulePreset>(
    COLLECTION,
    (items) => {
      const current = items.find((item) => matches(item, family, id));
      if (!current) throw notFound(family, id);
      if (current.status !== "active") {
        throw new Error(
          `Редактирование доступно только для status=active (§6.3); пресет "${entityOf(family, id)}" — "${current.status}".`,
        );
      }
      if (current.version !== patch.expectedVersion) {
        throw new Error(
          `Конфликт версии "${entityOf(family, id)}": ожидалась "${patch.expectedVersion}", фактически "${current.version}".`,
        );
      }

      // Фактическое изменение: сравниваем предоставляемые поля с текущими.
      let changed = false;
      if (patch.width !== undefined && !dimsEqual(current.width, patch.width)) {
        changed = true;
        previous.width = current.width;
        next.width = patch.width;
      }
      if (patch.height !== undefined && !dimsEqual(current.height, patch.height)) {
        changed = true;
        previous.height = current.height;
        next.height = patch.height;
      }
      if (patch.depth !== undefined && !dimsEqual(current.depth, patch.depth)) {
        changed = true;
        previous.depth = current.depth;
        next.depth = patch.depth;
      }
      if (patch.defaultShelves !== undefined && patch.defaultShelves !== current.defaultShelves) {
        changed = true;
        previous.defaultShelves = current.defaultShelves;
        next.defaultShelves = patch.defaultShelves;
      }
      if (patch.defaultDrawers !== undefined && patch.defaultDrawers !== current.defaultDrawers) {
        changed = true;
        previous.defaultDrawers = current.defaultDrawers;
        next.defaultDrawers = patch.defaultDrawers;
      }
      if (patch.zone !== undefined && patch.zone !== current.zone) {
        changed = true;
        previous.zone = current.zone;
        next.zone = patch.zone;
      }

      if (!changed) return { items, result: current };

      const candidate = {
        ...current,
        ...(next.width !== undefined ? { width: next.width } : {}),
        ...(next.height !== undefined ? { height: next.height } : {}),
        ...(next.depth !== undefined ? { depth: next.depth } : {}),
        ...(next.defaultShelves !== undefined
          ? { defaultShelves: next.defaultShelves }
          : {}),
        ...(next.defaultDrawers !== undefined
          ? { defaultDrawers: next.defaultDrawers }
          : {}),
        ...(next.zone !== undefined ? { zone: next.zone } : {}),
        version: nextVersion(current.version),
        updatedAt: new Date().toISOString(),
        updatedBy: actor.actorId,
      };
      const validated = modulePresetSchema.parse(candidate);
      return {
        items: items.map((item) =>
          matches(item, family, id) ? validated : item,
        ),
        result: validated,
      };
    },
  );

  // Нет фактического изменения → без журнала (ничего не изменилось).
  if (Object.keys(previous).length === 0) return updated;

  await appendEvent(
    family,
    id,
    { oldValue: previous, newValue: next, paramVersion: updated.version },
    actor,
  );
  return updated;
}

// ─── Архивирование / удаление ───

/**
 * Архивирование `active → archived` (§6.3). Обратный переход не
 * реализуется. Версия записи увеличивается на 1 (изменение status —
 * фактическое изменение записи, контракт CA-T-205 §4). Событие —
 * существующее `preset.update` (enum не расширяется). Проверка ссылок не
 * требуется: путь загрузки/пересчёта проектов не читает admin-пресеты
 * (проверено — см. шапку модуля).
 */
export async function archiveModulePreset(
  family: string,
  id: string,
  actor: ActorContext,
): Promise<ModulePreset> {
  const archived = await updateCollection<ModulePreset, ModulePreset>(
    COLLECTION,
    (items) => {
      const current = items.find((item) => matches(item, family, id));
      if (!current) throw notFound(family, id);
      if (current.status === "archived") {
        throw new Error(`Пресет "${entityOf(family, id)}" уже в архиве.`);
      }
      if (current.status !== "active") {
        throw new Error(
          `Архивирование доступно только из status=active (§6.3); текущий статус "${current.status}".`,
        );
      }
      const candidate = {
        ...current,
        status: "archived" as const,
        version: nextVersion(current.version),
        updatedAt: new Date().toISOString(),
        updatedBy: actor.actorId,
      };
      const validated = modulePresetSchema.parse(candidate);
      return {
        items: items.map((item) =>
          matches(item, family, id) ? validated : item,
        ),
        result: validated,
      };
    },
  );

  await appendEvent(
    family,
    id,
    {
      oldValue: { status: "active" },
      newValue: { status: "archived" },
      paramVersion: archived.version,
    },
    actor,
  );
  return archived;
}

/**
 * Физическое удаление запрещено всегда (§6.3: на пресеты ссылаются конфиги
 * проектов через `type`): явный guard без обращения к хранилищу.
 */
export async function deleteModulePreset(
  family: string,
  id: string,
): Promise<never> {
  throw new Error(
    `Удаление пресета "${entityOf(family, id)}" запрещено всегда (§6.3) — используйте архивирование.`,
  );
}

/** История изменений пресета (существующий аудит, `listAuditEvents`). */
export async function listModulePresetHistory(
  family: string,
  id: string,
): Promise<AdminAuditEvent[]> {
  return listAuditEvents({
    entityType: "preset",
    entityId: entityOf(family, id),
  });
}
