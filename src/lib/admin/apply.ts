import type { RecalculationStatus } from "./schema";

/**
 * CA-T-405 — проверки §10.5 перед применением результата пересчёта.
 *
 * Чистая функция: не пишет в Storage и не меняет job/project. Решение
 * `shouldWrite=false` означает, что устаревшее/конфликтное задание не
 * должно применять результат. Фактическая запись — CA-T-407.
 */

export type ApplyGateAction =
  | "apply"
  | "close"
  | "cancel"
  | "skip"
  | "noop";

export type ApplyGateCode =
  | "ALREADY_APPLIED"
  | "JOB_NOT_RUNNING"
  | "SOURCE_VERSION_MISMATCH"
  | "CALC_VERSION_UNKNOWN"
  | "CALC_VERSION_MISMATCH"
  | "SUPERSEDED"
  | "ALREADY_AT_TARGET";

export interface ApplyGateInput {
  jobStatus: RecalculationStatus;
  projectPriceVersion: string | null;
  expectedSourcePriceVersion: string | null;
  toPriceVersionId: string;
  /** publishedSeq текущей версии проекта. */
  projectPublishedSeq: number;
  /** publishedSeq целевой версии задания. */
  targetPublishedSeq: number;
  /** publishedSeq последней опубликованной версии. */
  latestPublishedSeq: number;
  /** Событие/применение этой попытки уже зафиксировано. */
  attemptAlreadyApplied: boolean;
  /** `calcVersion` проекта; `null` — версия не определена (§12 S3). */
  projectCalcVersion: string | null;
  /** `calcVersion`, фактически исполненный движком для результата задания. */
  eventCalcVersion: string;
}

export interface ApplyGateResult {
  shouldWrite: boolean;
  action: ApplyGateAction;
  code?: ApplyGateCode;
  message: string;
}

function result(
  shouldWrite: boolean,
  action: ApplyGateAction,
  message: string,
  code?: ApplyGateCode,
): ApplyGateResult {
  return {
    shouldWrite,
    action,
    message,
    ...(code === undefined ? {} : { code }),
  };
}

export function evaluateApplyGate(input: ApplyGateInput): ApplyGateResult {
  // 1. Задание должно быть в running (CAS не отозван другим обработчиком).
  if (input.jobStatus !== "running") {
    return result(
      false,
      "noop",
      `задание в статусе ${input.jobStatus}; применение не выполняется`,
      "JOB_NOT_RUNNING",
    );
  }

  // 2. Идемпотентное закрытие уже применённой попытки / чужого применения.
  if (input.projectPriceVersion === input.toPriceVersionId) {
    if (input.attemptAlreadyApplied) {
      return result(
        false,
        "close",
        "результат этой попытки уже применён; закрытие без записи",
        "ALREADY_APPLIED",
      );
    }
    return result(
      false,
      "skip",
      "проект уже на целевой версии, но применила другая операция/попытка",
      "ALREADY_AT_TARGET",
    );
  }

  // 3. Source не должен измениться после старта попытки.
  if (input.projectPriceVersion !== input.expectedSourcePriceVersion) {
    return result(
      false,
      "cancel",
      `source "${input.projectPriceVersion ?? "нет"}" ≠ ожидаемой "${input.expectedSourcePriceVersion ?? "нет"}"`,
      "SOURCE_VERSION_MISMATCH",
    );
  }

  // 4. Нет молчаливой подмены calcVersion (§5.7): автоматический
  //    прайс-пересчёт выполняется той же сборкой, что зафиксирована у
  //    проекта. Legacy без версии не получает её побочно.
  if (input.projectCalcVersion === null) {
    return result(
      false,
      "skip",
      "у проекта отсутствует calcVersion; обычный пересчёт заблокирован до retro_certification (§5.7/§12 S3)",
      "CALC_VERSION_UNKNOWN",
    );
  }
  if (input.projectCalcVersion !== input.eventCalcVersion) {
    return result(
      false,
      "skip",
      `calcVersion проекта "${input.projectCalcVersion}" ≠ исполненной "${input.eventCalcVersion}"; требуется явный engine_migration (§5.7)`,
      "CALC_VERSION_MISMATCH",
    );
  }

  // 5. Запрет отката: проект не должен быть новее target.
  if (input.targetPublishedSeq < input.projectPublishedSeq) {
    return result(
      false,
      "cancel",
      `target publishedSeq ${input.targetPublishedSeq} < текущего ${input.projectPublishedSeq}; откат запрещён`,
      "SUPERSEDED",
    );
  }

  // 6. Задание не должно быть устаревшим относительно последней публикации.
  if (input.targetPublishedSeq > input.latestPublishedSeq) {
    return result(
      false,
      "cancel",
      `target publishedSeq ${input.targetPublishedSeq} > последней опубликованной ${input.latestPublishedSeq}`,
      "SUPERSEDED",
    );
  }

  return result(true, "apply", "проверки §10.5 пройдены; результат можно применять");
}
