/**
 * E1 — изолированный read-only resolver компонентной трассировки
 * (design rev.4 §8.2–§8.5, §A-05, §A-08, §22.3).
 *
 * Границы (вариант B):
 * - модуль **не** импортирует `engine.ts` и не влияет на его контракты;
 * - не изменяет `CalculationRequest`/`CalculationInputs`/`CalculationBreakdown`;
 * - итоговая стоимость всегда остаётся результатом Engine (В-2): trace только
 *   читает `breakdown` и ни в коем случае не суммирует его вместо Engine;
 * - никаких нулевых подстановок: отсутствие количества/тарифа → `null` +
 *   issue (В-3, инвариант 9);
 * - неисполняемое условие **никогда** не превращается в unconditional
 *   (инвариант 8).
 *
 * Resolver вызывается **после** Engine (получает готовый `breakdown`); в E1 он
 * подключается к расчётному пути только на этапе E2/E4.
 */

import type {
  CompositionRelation,
  CompositionUnit,
  CompositionVersion,
} from "@/lib/admin/composition-schema";
import type { PriceItem } from "@/lib/admin/schema";
import type {
  CalculationBreakdown,
  PriceSnapshotInput,
  RulesSnapshotInput,
} from "@/lib/configurator/contract";
import type {
  CompositionTraceCondition,
  CompositionTraceIssueCode,
  CompositionTraceLineStatus,
  CompositionTraceSnapshot,
  FurnitureConfig,
} from "@/lib/configurator/types";

import type { CompositionPreflight } from "./data-resolver";

/* ─── Публичные типы trace ─────────────────────────────────────────────── */
/*
 * E4: типы-листья (condition/status/issue code) и схема хранения объявлены в
 * `@/lib/configurator/types` — единственный контракт сохранённого снимка.
 * Здесь они ре-экспортируются, чтобы существующие потребители не менялись.
 */

export type {
  CompositionTraceCondition,
  CompositionTraceIssueCode,
  CompositionTraceLineStatus,
  CompositionTraceSnapshot,
} from "@/lib/configurator/types";

/**
 * Идентификаторы расчётного контекста trace (R-05). Присутствуют и при
 * `blocked` — чтобы историческая запись сохраняла контекст, даже когда
 * построчной трассировки нет.
 */
export interface CompositionTraceContext {
  compositionVersionId: string;
  compositionContentHash: string;
  /** Закреплённый снимок правил Composition (null — не закреплён). */
  compositionRulesSnapshotId: string | null;
  /** Снимок правил, использованный в этом расчёте (null — legacy). */
  rulesSnapshotId: string | null;
  /** PricingVersion, использованная Engine (`PriceSnapshot.priceVersion`). */
  enginePriceVersionId: string;
  /** Версия структуры снимка (`PriceSnapshot.baseSchema`). */
  enginePriceBaseSchema: number;
  /** PricingVersion, закреплённая в Composition (В-7; null — legacy). */
  pinnedPriceVersionId: string | null;
  catalogVersions?: Record<string, Record<string, string>>;
  priceItemVersions?: Record<string, string>;
}

export interface CompositionTraceIssue {
  severity: "error" | "warning";
  code: CompositionTraceIssueCode;
  message: string;
  lineId?: string;
  entityId?: string;
}

export interface CompositionTraceLine {
  lineId: string;
  moduleType: string;
  relation: CompositionRelation;
  /** Результат оценки условия (A-05). */
  condition: CompositionTraceCondition;
  /** `null` ⇔ `quantity_unresolved` (В-3). Никогда 0 вместо отсутствия. */
  quantity: number | null;
  unit: CompositionUnit | null;
  quantitySource: "fixed" | "unresolved";
  priceItemId?: string;
  /** Сырой `amount` из PriceSnapshot; `null` ⇔ тарифа нет/не разрешён. */
  amount: number | null;
  /** `PriceItem.unit` на момент расчёта (R-05/R-03); `null` — неизвестна. */
  priceItemUnit: string | null;
  /** `quantity × amount` **только** при подтверждённой паре единиц (§22.3). */
  priceAmount: number | null;
  status: CompositionTraceLineStatus;
}

export interface CompositionTrace extends CompositionTraceContext {
  traceVersion: 1;
  lines: CompositionTraceLine[];
  warnings: CompositionTraceIssue[];
}

export interface CompositionTraceResult {
  /** `null` — trace не создан: нет composition-pin (В-1) либо есть block (В-5). */
  trace: CompositionTrace | null;
  /** Идентификаторы контекста; `null` — composition-pin отсутствует. */
  context: CompositionTraceContext | null;
  /** Все диагностики; наличие `severity: "error"` означает block (§8.5). */
  issues: CompositionTraceIssue[];
  blocked: boolean;
}

/**
 * E4: собирает самодостаточный исторический снимок из результата расчёта.
 *
 * `computedAt` фиксируется вызывающей стороной (в той же операции, что и
 * `ProjectPriceHistory`), поэтому сама трассировка остаётся детерминированной.
 * `null` — pin отсутствовал, сохранять нечего.
 */
export function toCompositionTraceSnapshot(
  result: CompositionTraceResult,
  computedAt: string,
): CompositionTraceSnapshot | null {
  const context = result.context;
  if (!context) return null;
  if (result.trace) {
    return {
      ...context,
      traceVersion: 1,
      status: "computed",
      lines: result.trace.lines,
      warnings: result.trace.warnings,
      computedAt,
    };
  }
  return {
    ...context,
    traceVersion: 1,
    status: "blocked",
    lines: [],
    warnings: result.issues,
    computedAt,
  };
}

export interface ResolveCompositionTraceInput {
  config: FurnitureConfig;
  /** Handoff из `resolveCalculationInputs`; `undefined` ⇔ pin отсутствует. */
  compositionPreflight?: CompositionPreflight;
  rulesSnapshot?: RulesSnapshotInput;
  priceSnapshot: PriceSnapshotInput;
  /** Результат Engine — единственный источник totals (В-2). */
  breakdown: CalculationBreakdown;
  /**
   * Единицы тарифов PriceItem. Вход необходим для проверки совместимости
   * единиц (R-03/§22.3): `PriceSnapshot` хранит `{priceItemId, amount}` **без**
   * единицы. Если не передан либо тариф не найден — совместимость **не
   * подтверждена**, умножение не выполняется (fail-closed, `price_unresolved`).
   */
  priceItems?: readonly Pick<PriceItem, "id" | "unit">[];
}

/* ─── Правила E1 ───────────────────────────────────────────────────────── */

/**
 * Разрешённые комбинации «единица количества ↔ единица тарифа» (design §5,
 * §22.3). Всё остальное — `RUB_PER_M`, `RUB`, `FACTOR`, `cm`, `mm`, `kg` и
 * неизвестные единицы — **не умножается** и не получает произвольной
 * интерпретации.
 */
const ALLOWED_UNIT_PAIRS: ReadonlyArray<readonly [CompositionUnit, string]> = [
  ["pcs", "RUB_PER_PCS"],
  ["m", "RUB_PER_LINM"],
  ["m2", "RUB_PER_SQM"],
];

/** Обязательные/условные relation: неисполнимость → block (§A-05). */
function isBlockingRelation(relation: CompositionRelation): boolean {
  return relation === "required" || relation === "conditional";
}

function issue(
  severity: "error" | "warning",
  code: CompositionTraceIssueCode,
  message: string,
  lineId?: string,
  entityId?: string,
): CompositionTraceIssue {
  return {
    severity,
    code,
    message,
    ...(lineId === undefined ? {} : { lineId }),
    ...(entityId === undefined ? {} : { entityId }),
  };
}

function isAllowedUnitPair(quantityUnit: CompositionUnit, priceUnit: string) {
  return ALLOWED_UNIT_PAIRS.some(
    ([unit, tariff]) => unit === quantityUnit && tariff === priceUnit,
  );
}

/**
 * Коды preflight-предупреждений, которые переносятся в trace без изменения
 * (drift pins, Q4/В-5). Остальные коды preflight в trace не участвуют.
 */
const PROPAGATED_PREFLIGHT_CODES = new Set<string>([
  "COMPOSITION_PRICE_VERSION_DRIFT",
  "COMPOSITION_PRICE_SNAPSHOT_DRIFT",
  "COMPOSITION_CATALOG_VERSION_DRIFT",
]);

/* ─── Resolver ─────────────────────────────────────────────────────────── */

/**
 * Строит независимую компонентную трассировку поверх уже посчитанного Engine.
 *
 * Никогда не бросает исключений: любая неопределённость превращается в
 * контролируемый статус либо block, но не в 0 и не в молчаливое включение.
 */
export function resolveCompositionTrace(
  input: ResolveCompositionTraceInput,
): CompositionTraceResult {
  const issues: CompositionTraceIssue[] = [];
  const warnings: CompositionTraceIssue[] = [];

  /*
   * Дедупликация: одна и та же диагностика не должна появляться дважды
   * (preflight-предупреждения и собственные проверки могут пересекаться).
   */
  const record = (item: CompositionTraceIssue): void => {
    const duplicate = [...issues, ...warnings].some(
      (existing) =>
        existing.severity === item.severity &&
        existing.code === item.code &&
        existing.lineId === item.lineId &&
        existing.message === item.message,
    );
    if (duplicate) return;
    (item.severity === "error" ? issues : warnings).push(item);
  };

  /* В-1: без composition-pin trace не создаётся — это не блокировка. */
  const preflight = input.compositionPreflight;
  if (!preflight) {
    return { trace: null, context: null, issues: [], blocked: false };
  }

  /*
   * Идентификаторы контекста фиксируются ДО построчного разбора: они нужны и
   * при `blocked`, чтобы историческая запись сохраняла расчётный контекст.
   */
  const composition: CompositionVersion = preflight.composition;
  const context: CompositionTraceContext = {
    compositionVersionId: preflight.compositionVersionId,
    compositionContentHash: composition.contentHash,
    compositionRulesSnapshotId: composition.rulesSnapshotId ?? null,
    rulesSnapshotId: input.rulesSnapshot?.rulesSnapshotId ?? null,
    enginePriceVersionId: input.priceSnapshot.priceVersion,
    enginePriceBaseSchema: input.priceSnapshot.baseSchema,
    pinnedPriceVersionId: composition.pins?.priceVersionId ?? null,
    ...(composition.pins?.catalogVersions === undefined
      ? {}
      : { catalogVersions: composition.pins.catalogVersions }),
    ...(composition.pins?.priceItemVersions === undefined
      ? {}
      : { priceItemVersions: composition.pins.priceItemVersions }),
  };

  /*
   * 2.1: drift-предупреждения preflight (Q4) переносятся в trace как есть —
   * коды не переименовываются, чтобы историческая диагностика не теряла смысл.
   */
  for (const item of preflight.warnings) {
    if (!PROPAGATED_PREFLIGHT_CODES.has(item.code)) continue;
    record({
      severity: "warning",
      code: item.code as CompositionTraceIssueCode,
      message: item.message,
      ...(item.entityId === undefined ? {} : { entityId: item.entityId }),
    });
  }

  /*
   * 2.2: Composition закреплена за проектом, но версия прайса на момент
   * публикации не зафиксирована. Это диагностика, а не блокировка.
   */
  if (context.pinnedPriceVersionId === null) {
    record(
      issue(
        "warning",
        "PRICE_VERSION_PIN_MISSING",
        "Composition закреплена за проектом, но pins.priceVersionId отсутствует: версия прайса на момент публикации состава не зафиксирована.",
      ),
    );
  } else if (context.pinnedPriceVersionId !== context.enginePriceVersionId) {
    /*
     * 2.3: расхождение закреплённой и фактически использованной версии.
     * Не является доказательством неверной стоимости — только диагностика.
     */
    record(
      issue(
        "warning",
        "PRICE_VERSION_DRIFT",
        `Закреплённая в Composition PricingVersion "${context.pinnedPriceVersionId}" расходится с использованной Engine "${context.enginePriceVersionId}": расхождение фиксируется как диагностика, стоимость остаётся результатом Engine.`,
      ),
    );
  }

  const blocked = (): CompositionTraceResult => ({
    trace: null,
    context,
    issues: [...issues, ...warnings],
    blocked: true,
  });

  /* Целостность: breakdown обязан быть валидным результатом Engine. */
  if (!Number.isFinite(input.breakdown.total)) {
    record(
      issue(
        "error",
        "TRACE_ENGINE_BREAKDOWN_INVALID",
        "CalculationBreakdown.total не является конечным числом — trace невозможен.",
      ),
    );
    return blocked();
  }

  const moduleTypes = new Set(
    input.config.kind === "kitchen"
      ? input.config.modules.map((module) => module.type)
      : [],
  );
  const lines = composition.lines.filter((line) =>
    moduleTypes.has(line.moduleType),
  );

  /* ── AlternativeGroup: без выбора первой строки и без суммирования ─── */
  const alternativeKeys = new Set<string>();
  const alternativeGroups = new Map<string, typeof lines>();
  for (const line of lines) {
    if (line.relation !== "alternative") continue;
    const key = `${line.moduleType}|${line.alternativeGroup ?? ""}`;
    alternativeKeys.add(line.id);
    alternativeGroups.set(key, [
      ...(alternativeGroups.get(key) ?? []),
      line,
    ]);
  }
  for (const [key, group] of alternativeGroups) {
    if (group.length < 2 || group.some((line) => !line.alternativeGroup)) {
      record(
        issue(
          "error",
          "TRACE_ALTERNATIVE_INVALID",
          `Группа альтернатив "${key}": менее 2 строк либо отсутствует alternativeGroup — нарушение целостности.`,
          group[0]?.id,
          key,
        ),
      );
      continue;
    }
    /*
     * Применимость альтернативы устанавливается только условием, а
     * executor'а в E1 нет (R-02/§A-08). Ни одно основание выбора не доказано:
     * - несколько потенциально применимых → неоднозначность → block;
     * - ни одного доказанного применимого → контролируемый статус, не выбор.
     * «Первая строка не выбирается», «альтернативы не суммируются».
     */
    const withoutCondition = group.filter((line) => !line.condition);
    const message =
      withoutCondition.length >= 2
        ? `Группа альтернатив "${key}": одновременно применимы ${withoutCondition.length} строк без условий — неоднозначность.`
        : withoutCondition.length === 1
          ? `Группа альтернатив "${key}": условие(я) прочих строк неисполнимы, единственный применимый вариант не доказан.`
          : `Группа альтернатив "${key}": условия всех строк неисполнимы, применимость не доказана — выбор не выполняется.`;
    record(
      issue("error", "TRACE_ALTERNATIVE_AMBIGUOUS", message, group[0]?.id, key),
    );
  }
  if (issues.length > 0) return blocked();

  /* ── Построчное разрешение ──────────────────────────────────────────── */
  const traceLines: CompositionTraceLine[] = [];
  const priceUnits = new Map(
    (input.priceItems ?? []).map((item) => [item.id, item.unit]),
  );
  const snapshotAmounts = new Map(
    input.priceSnapshot.snapshot.map((entry) => [entry.priceItemId, entry.amount]),
  );

  for (const line of lines) {
    if (alternativeKeys.has(line.id)) continue; // уже обработаны группой

    const blocking = isBlockingRelation(line.relation);
    const base = {
      lineId: line.id,
      moduleType: line.moduleType,
      relation: line.relation,
    };

    /* Условие: в E1 executor отсутствует для любого kind (R-02, §A-05). */
    if (line.condition) {
      if (blocking) {
        record(
          issue(
            "error",
            "TRACE_CONDITION_NOT_EXECUTABLE",
            `Строка "${line.id}": условие kind="${line.condition.kind}" неисполнимо (executor отсутствует); обязательное/условное применение блокируется.`,
            line.id,
          ),
        );
        return blocked();
      }
      record(
        issue(
          "warning",
          "TRACE_CONDITION_NOT_EXECUTABLE",
          `Строка "${line.id}": условие kind="${line.condition.kind}" неисполнимо; необязательная строка исключена (не применяется всегда).`,
          line.id,
        ),
      );
      traceLines.push({
        ...base,
        condition: "not_evaluated",
        quantity: null,
        unit: null,
        quantitySource: "unresolved",
        amount: null,
        priceItemUnit: null,
        priceAmount: null,
        status: "excluded",
      });
      continue;
    }

    /* Количество: только `fixed` (В-3/A-04); managed_rule/code не исполняются. */
    let quantity: number | null = null;
    let unit: CompositionUnit | null = null;
    if (line.quantityRef.kind === "fixed") {
      const value = line.quantityRef.value;
      const refUnit = line.quantityRef.unit;
      if (
        Number.isFinite(value) &&
        value > 0 &&
        refUnit !== "none"
      ) {
        quantity = value;
        unit = refUnit;
      } else if (blocking) {
        record(
          issue(
            "error",
            "TRACE_QUANTITY_INVALID",
            `Строка "${line.id}": fixed-количество ${value} (unit="${refUnit}") не допустимо правилами публикации; ноль не подставляется.`,
            line.id,
          ),
        );
        return blocked();
      } else {
        record(
          issue(
            "warning",
            "TRACE_QUANTITY_INVALID",
            `Строка "${line.id}": fixed-количество ${value} (unit="${refUnit}") не допустимо; строка без количества.`,
            line.id,
          ),
        );
      }
    } else if (blocking) {
      record(
        issue(
          "error",
          "TRACE_QUANTITY_UNRESOLVED",
          `Строка "${line.id}": quantityRef.kind="${line.quantityRef.kind}" не исполняется в E1; подтверждённого количества нет (не 0).`,
          line.id,
        ),
      );
      return blocked();
    } else {
      record(
        issue(
          "warning",
          "TRACE_QUANTITY_UNRESOLVED",
          `Строка "${line.id}": quantityRef.kind="${line.quantityRef.kind}" не исполняется в E1; количество отсутствует (не 0).`,
          line.id,
        ),
      );
    }

    /* Тариф. */
    let priceItemId: string | undefined;
    let amount: number | null = null;
    let priceItemUnit: string | null = null;
    let priceAmount: number | null = null;
    let status: CompositionTraceLineStatus =
      quantity === null ? "quantity_unresolved" : "resolved";

    if (line.priceItemId) {
      priceItemId = line.priceItemId;
      const snapshotAmount = snapshotAmounts.get(line.priceItemId);
      if (snapshotAmount === undefined || !Number.isFinite(snapshotAmount)) {
        /* Тарифа в snapshot нет → `amount = null` + issue, никогда 0. */
        if (blocking) {
          record(
            issue(
              "error",
              "TRACE_PRICE_UNRESOLVED",
              `Строка "${line.id}": тариф "${line.priceItemId}" отсутствует в PriceSnapshot; цена не подставляется (не 0).`,
              line.id,
              line.priceItemId,
            ),
          );
          return blocked();
        }
        record(
          issue(
            "warning",
            "TRACE_PRICE_UNRESOLVED",
            `Строка "${line.id}": тариф "${line.priceItemId}" отсутствует в PriceSnapshot; цена не подставляется (не 0).`,
            line.id,
            line.priceItemId,
          ),
        );
        status = "price_unresolved";
      } else {
        amount = snapshotAmount;
        priceItemUnit = priceUnits.get(line.priceItemId) ?? null;

        if (priceItemUnit === null) {
          /* Совместимость единиц не подтверждена → умножение не выполняется. */
          if (blocking) {
            record(
              issue(
                "error",
                "TRACE_PRICE_UNIT_UNKNOWN",
                `Строка "${line.id}": единица тарифа "${line.priceItemId}" неизвестна — совместимость не подтверждена, умножение не выполняется.`,
                line.id,
                line.priceItemId,
              ),
            );
            return blocked();
          }
          record(
            issue(
              "warning",
              "TRACE_PRICE_UNIT_UNKNOWN",
              `Строка "${line.id}": единица тарифа "${line.priceItemId}" неизвестна — умножение не выполняется.`,
              line.id,
              line.priceItemId,
            ),
          );
          status = "price_unresolved";
        } else if (quantity === null || unit === null) {
          status = "quantity_unresolved";
        } else if (!isAllowedUnitPair(unit, priceItemUnit)) {
          /* Запрещённая комбинация единиц: не умножаем, 0 не подставляем. */
          if (blocking) {
            record(
              issue(
                "error",
                "TRACE_UNIT_INCOMPATIBLE",
                `Строка "${line.id}": единицы несовместимы (количество "${unit}" × тариф "${priceItemUnit}") — умножение запрещено.`,
                line.id,
                line.priceItemId,
              ),
            );
            return blocked();
          }
          record(
            issue(
              "warning",
              "TRACE_UNIT_INCOMPATIBLE",
              `Строка "${line.id}": единицы несовместимы (количество "${unit}" × тариф "${priceItemUnit}") — умножение запрещено.`,
              line.id,
              line.priceItemId,
            ),
          );
          status = "price_unresolved";
        } else {
          priceAmount = quantity * amount;
        }
      }
    }

    traceLines.push({
      ...base,
      condition: "not_required",
      quantity,
      unit,
      quantitySource: quantity === null ? "unresolved" : "fixed",
      ...(priceItemId === undefined ? {} : { priceItemId }),
      amount,
      priceItemUnit,
      priceAmount,
      status,
    });
  }

  if (issues.length > 0) return blocked();

  const trace: CompositionTrace = {
    ...context,
    traceVersion: 1,
    lines: traceLines,
    warnings,
  };

  return { trace, context, issues: [...issues, ...warnings], blocked: false };
}
