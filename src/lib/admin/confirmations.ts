/**
 * CA-T-606 — подтверждения критических admin-операций.
 * Чистая проверка для будущих admin API (CA-T-609); не выполняет операцию.
 */

export type CriticalOperation = "publish" | "recalc" | "archive" | "rollback";

export type ConfirmationCode =
  | "CONFIRMATION_REQUIRED"
  | "VERSION_CONFLICT";

export type ConfirmationResult =
  | { ok: true }
  | { ok: false; status: 409 | 422; code: ConfirmationCode; message: string };

export interface ConfirmationInput {
  operation: CriticalOperation;
  confirmed: boolean;
  expectedVersion: string;
  currentVersion: string;
}

export function requiresConfirmation(operation: CriticalOperation): boolean {
  return operation === "publish" || operation === "recalc" || operation === "archive" || operation === "rollback";
}

export function verifyCriticalConfirmation(
  input: ConfirmationInput,
): ConfirmationResult {
  if (!requiresConfirmation(input.operation)) {
    return { ok: true };
  }
  if (!input.confirmed) {
    return {
      ok: false,
      status: 409,
      code: "CONFIRMATION_REQUIRED",
      message: `Операция ${input.operation} требует явного подтверждения.`,
    };
  }
  if (!input.expectedVersion || input.expectedVersion !== input.currentVersion) {
    return {
      ok: false,
      status: 409,
      code: "VERSION_CONFLICT",
      message: "Версия изменилась; повторите подтверждение с актуальной версией.",
    };
  }
  return { ok: true };
}
