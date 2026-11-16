import type { FacadeMaterialId, ValidationIssue } from "./types";

/**
 * A18-1 — единый барьер исторических фасадов.
 *
 * Правило владельца: `veneer` / `glass` / `solid` запрещены для **новых**
 * расчётов (создание, предпросмотр, лиды, сохранение, пересчёт). Подтверждённые
 * исторические тарифы (11 800 / 14 400 / 18 600 ₽/м²) — справочные и в новые
 * расчёты не поступают; материал автоматически не подменяется.
 *
 * Чтение старых проектов и их исторический PriceSnapshot барьер не затрагивает:
 * `validateConfig` для legacy-материала остаётся **warning**, поскольку
 * `getProject` использует эту валидацию при чтении (`projects.ts`) и повышение
 * severity заблокировало бы просмотр исторических проектов.
 *
 * Сообщение используется всеми серверными точками отказа, чтобы поведение
 * барьера не различалось между маршрутами.
 */
export const LEGACY_FACADE_BLOCK_MESSAGE =
  "Исторический материал фасада запрещён для новых расчётов. Замените материал на ЛДСП или МДФ.";

/** Единственная форма отказа для серверной валидации конфигурации/лида. */
export function legacyFacadeBlockIssue(path = "facadeMaterial"): ValidationIssue {
  return { path, message: LEGACY_FACADE_BLOCK_MESSAGE, severity: "error" };
}

/** Корпус всегда ЛДСП 16 мм (CA-T-514). */
export const FIXED_BODY_MATERIAL_ID = "ldsp" as const;
export const FIXED_BODY_THICKNESS_MM = 16;

/** Действующие материалы фасадов для новых конфигураций. */
export const ACTIVE_FACADE_MATERIAL_IDS = [
  "ldsp",
  "mdf",
  "mdf_pvc",
] as const satisfies readonly FacadeMaterialId[];

export type ActiveFacadeMaterialId = (typeof ACTIVE_FACADE_MATERIAL_IDS)[number];

/** Исторические id: только чтение старых проектов/снимков. */
export const LEGACY_FACADE_MATERIAL_IDS = [
  "veneer",
  "glass",
  "solid",
] as const satisfies readonly FacadeMaterialId[];

export function isActiveFacadeMaterial(
  id: string,
): id is ActiveFacadeMaterialId {
  return (ACTIVE_FACADE_MATERIAL_IDS as readonly string[]).includes(id);
}

export function isLegacyFacadeMaterial(id: string): boolean {
  return (LEGACY_FACADE_MATERIAL_IDS as readonly string[]).includes(id);
}
