import { readCollectionStatus } from "@/lib/server/store";
import {
  priceBreakdownSchema,
  storedProjectSchema,
} from "@/lib/configurator/schema";
import type {
  PriceBreakdown,
  ProjectPriceHistory,
  StoredProject,
} from "@/lib/configurator/types";

/**
 * CA-T-406 — read-only reader истории стоимости проекта.
 *
 * Append выполняется доменной операцией сохранения/пересчёта (E3,
 * `projects.ts`); этот модуль не пишет и не меняет историю.
 */

export type HistoryReadCode =
  | "PROJECT_NOT_FOUND"
  | "STORAGE_CORRUPT"
  | "PROJECT_INVALID"
  | "HISTORY_EVENT_NOT_FOUND"
  | "BREAKDOWN_VERSION_UNSUPPORTED"
  | "BREAKDOWN_INVALID";

export type HistoryReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: HistoryReadCode; message: string; raw?: unknown };

export async function listProjectPriceHistory(
  projectId: string,
): Promise<HistoryReadResult<ProjectPriceHistory[]>> {
  const read = await readCollectionStatus<unknown>("projects.json");
  if (read.status === "missing") {
    return {
      ok: false,
      code: "PROJECT_NOT_FOUND",
      message: `проект "${projectId}" не найден`,
    };
  }
  if (read.status === "corrupt") {
    return {
      ok: false,
      code: "STORAGE_CORRUPT",
      message: `projects.json повреждён: ${read.reason}`,
    };
  }

  const raw = read.items.find(
    (item): item is Record<string, unknown> =>
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).id === projectId,
  );
  if (!raw) {
    return {
      ok: false,
      code: "PROJECT_NOT_FOUND",
      message: `проект "${projectId}" не найден`,
    };
  }

  const parsed = storedProjectSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "PROJECT_INVALID",
      message: `проект "${projectId}" не проходит схему: ${parsed.error.message}`,
      raw,
    };
  }

  const project = parsed.data as unknown as StoredProject;
  return { ok: true, value: project.priceHistory ?? [] };
}

export async function getProjectPriceHistoryEvent(
  projectId: string,
  eventId: string,
): Promise<HistoryReadResult<ProjectPriceHistory>> {
  const history = await listProjectPriceHistory(projectId);
  if (!history.ok) return history;
  const event = history.value.find((item) => item.id === eventId);
  if (!event) {
    return {
      ok: false,
      code: "HISTORY_EVENT_NOT_FOUND",
      message: `событие "${eventId}" не найдено`,
    };
  }
  return { ok: true, value: event };
}

/** Reader v1: поддерживается breakdownVersion=1; иначе — raw без подмены. */
export function readHistoryBreakdownV1(
  event: ProjectPriceHistory | Pick<ProjectPriceHistory, "breakdown" | "breakdownVersion">,
): HistoryReadResult<PriceBreakdown> {
  if (event.breakdownVersion !== 1) {
    return {
      ok: false,
      code: "BREAKDOWN_VERSION_UNSUPPORTED",
      message: `breakdownVersion=${String(event.breakdownVersion)} не поддерживается`,
      raw: event.breakdown,
    };
  }
  const parsed = priceBreakdownSchema.safeParse(event.breakdown);
  if (!parsed.success) {
    return {
      ok: false,
      code: "BREAKDOWN_INVALID",
      message: `breakdown не проходит схему v1: ${parsed.error.message}`,
      raw: event.breakdown,
    };
  }
  return { ok: true, value: parsed.data as PriceBreakdown };
}
