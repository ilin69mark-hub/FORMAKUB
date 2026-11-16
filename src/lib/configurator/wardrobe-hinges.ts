import type { WardrobeConfig } from "./types";
import {
  wardrobeFacadeGeometry,
  type WardrobeFacadePanel,
} from "./wardrobe-facade-geometry";

/**
 * Этап 4 / NEW-N1: масса двери и количество петель.
 *
 * Расчётные нормы (полосы петель 1.1 и плотности фасадов 1.2) перенесены в
 * Managed Rules (ADR-07, Q7-08а, D-3). Engine получает их из `rulesSnapshot`
 * через `wardrobeHingeNormsFromRules`; при отсутствии/повреждении норм —
 * fail-closed (Engine бросает ошибку).
 *
 * Константы ниже сохранены только как legacy/validation-defaults:
 * - legacy `pricing.ts` (не runtime) и серверная валидация предупреждения о
 *   перегрузе двери вызывают функции без `norms`;
 * - расчётный Engine всегда передаёт нормы из snapshot и константы не читает.
 */

/** кг/м² для фактической толщины фасада (legacy/validation default). */
export const WARDROBE_FACADE_DENSITY_KG_M2: Record<16 | 19 | 22, number> = {
  16: 11.5,
  19: 14.8,
  22: 16.8,
};

export interface WardrobeHingeBand {
  maxHeightMm: number;
  maxMassKg: number;
  count: number;
}

/** Верхние значения диапазонов ТЗ (legacy/validation default). */
export const WARDROBE_HINGE_BANDS: readonly WardrobeHingeBand[] = [
  { maxHeightMm: 600, maxMassKg: 5, count: 2 },
  { maxHeightMm: 900, maxMassKg: 8, count: 2 },
  { maxHeightMm: 1300, maxMassKg: 12, count: 3 },
  { maxHeightMm: 1600, maxMassKg: 15, count: 4 },
  { maxHeightMm: 2000, maxMassKg: 19, count: 4 },
  { maxHeightMm: 2200, maxMassKg: 22, count: 5 },
  { maxHeightMm: 2400, maxMassKg: 27, count: 5 },
  { maxHeightMm: 2700, maxMassKg: 35, count: 6 },
];

/** Идентификаторы Managed Rules, из которых Engine читает нормы. */
export const WARDROBE_HINGE_BAND_RULE_PREFIX = "rule-wardrobe-hinge-band";
export const WARDROBE_FACADE_DENSITY_RULE_PREFIX =
  "rule-wardrobe-facade-density";

/** Полный перечень обязательных правил норм 1.1/1.2 (диагностика). */
export function wardrobeRequiredRuleIds(): string[] {
  return [
    ...[16, 19, 22].map(
      (thickness) => `${WARDROBE_FACADE_DENSITY_RULE_PREFIX}-${thickness}`,
    ),
    ...WARDROBE_HINGE_BANDS.flatMap((_, index) => {
      const number = index + 1;
      return [
        `${WARDROBE_HINGE_BAND_RULE_PREFIX}-${number}-max-height`,
        `${WARDROBE_HINGE_BAND_RULE_PREFIX}-${number}-max-mass`,
        `${WARDROBE_HINGE_BAND_RULE_PREFIX}-${number}-count`,
      ];
    }),
  ];
}

export interface WardrobeHingeNorms {
  densities: Record<16 | 19 | 22, number>;
  bands: readonly WardrobeHingeBand[];
}

const LEGACY_NORMS: WardrobeHingeNorms = {
  densities: WARDROBE_FACADE_DENSITY_KG_M2,
  bands: WARDROBE_HINGE_BANDS,
};

function ruleNumber(
  byId: Map<string, { value: unknown; valueType: string }>,
  id: string,
  valueType: "int" | "decimal",
): number | null {
  const rule = byId.get(id);
  if (!rule || rule.valueType !== valueType || typeof rule.value !== "number") {
    return null;
  }
  if (valueType === "int" && !Number.isInteger(rule.value)) return null;
  return rule.value;
}

/**
 * Разбор норм 1.1/1.2 из `rulesSnapshot`. Возвращает `null`, если правила
 * отсутствуют, имеют неверный тип или нарушают монотонность полос —
 * вызывающий обязан применить fail-closed.
 */
export function wardrobeHingeNormsFromRules(
  rules: readonly { id: string; value: unknown; valueType: string }[] | undefined,
): WardrobeHingeNorms | null {
  if (!rules || rules.length === 0) return null;
  const byId = new Map(rules.map((rule) => [rule.id, rule]));

  const densities = {} as Record<16 | 19 | 22, number>;
  for (const thickness of [16, 19, 22] as const) {
    const value = ruleNumber(
      byId,
      `${WARDROBE_FACADE_DENSITY_RULE_PREFIX}-${thickness}`,
      "decimal",
    );
    if (value === null || value <= 0) return null;
    densities[thickness] = value;
  }

  const bands: WardrobeHingeBand[] = [];
  for (let index = 1; index <= WARDROBE_HINGE_BANDS.length; index += 1) {
    const prefix = `${WARDROBE_HINGE_BAND_RULE_PREFIX}-${index}`;
    const maxHeightMm = ruleNumber(byId, `${prefix}-max-height`, "int");
    const maxMassKg = ruleNumber(byId, `${prefix}-max-mass`, "decimal");
    const count = ruleNumber(byId, `${prefix}-count`, "int");
    if (maxHeightMm === null || maxMassKg === null || count === null) return null;
    if (maxHeightMm <= 0 || maxMassKg <= 0 || count < 2) return null;
    bands.push({ maxHeightMm, maxMassKg, count });
  }

  for (let index = 1; index < bands.length; index += 1) {
    const previous = bands[index - 1];
    const current = bands[index];
    if (
      current.maxHeightMm <= previous.maxHeightMm ||
      current.maxMassKg <= previous.maxMassKg ||
      current.count < previous.count
    ) {
      return null;
    }
  }

  return { densities, bands };
}

export const WARDROBE_MAX_DOOR_WIDTH_MM = 600;
export const WARDROBE_MAX_DOOR_MASS_KG = 35;

export interface WardrobeHingeDoor {
  panelId: string;
  kind: WardrobeFacadePanel["kind"];
  widthMm: number;
  heightMm: number;
  areaSqm: number;
  massKg: number;
  hingeCount: number;
  widthWarning: boolean;
  overload: boolean;
}

export interface WardrobeHingePlan {
  ok: boolean;
  doors: WardrobeHingeDoor[];
  totalHinges: number;
  maxMassKg: number;
  overloaded: boolean;
  reason?: string;
}

export function wardrobeDoorMassKg(
  panel: Pick<WardrobeFacadePanel, "areaSqm">,
  thicknessMm: 16 | 19 | 22,
  norms: WardrobeHingeNorms = LEGACY_NORMS,
): number {
  return panel.areaSqm * norms.densities[thicknessMm];
}

export function wardrobeHingeCountForDoor(
  heightMm: number,
  massKg: number,
  norms: WardrobeHingeNorms = LEGACY_NORMS,
): number | null {
  const band = norms.bands.find(
    (item) => heightMm <= item.maxHeightMm && massKg <= item.maxMassKg,
  );
  return band?.count ?? null;
}

export function wardrobeHingePlan(
  config: WardrobeConfig,
  norms: WardrobeHingeNorms = LEGACY_NORMS,
): WardrobeHingePlan {
  const facade = wardrobeFacadeGeometry(config);
  const thickness = config.facadeThickness as 16 | 19 | 22;
  const doors: WardrobeHingeDoor[] = [];
  for (const panel of facade.panels) {
    const massKg = wardrobeDoorMassKg(panel, thickness, norms);
    const computed = wardrobeHingeCountForDoor(panel.heightMm, massKg, norms);
    const hingeCount = computed ?? norms.bands.at(-1)!.count;
    doors.push({
      panelId: panel.id,
      kind: panel.kind,
      widthMm: panel.widthMm,
      heightMm: panel.heightMm,
      areaSqm: panel.areaSqm,
      massKg,
      hingeCount,
      widthWarning: panel.widthMm > WARDROBE_MAX_DOOR_WIDTH_MM,
      overload: computed === null,
    });
  }
  const overloaded = doors.filter((door) => door.overload);
  return {
    ok: true,
    doors,
    totalHinges: doors.reduce((sum, door) => sum + door.hingeCount, 0),
    maxMassKg: doors.reduce((max, door) => Math.max(max, door.massKg), 0),
    overloaded: overloaded.length > 0,
    ...(overloaded.length
      ? {
          reason: overloaded
            .map(
              (door) =>
                `дверь ${door.widthMm}×${door.heightMm} мм, ${door.massKg.toFixed(2)} кг`,
            )
            .join("; "),
        }
      : {}),
  };
}
