import { randomBytes, randomUUID } from "node:crypto";
import {
  normalizeKitchen,
  normalizeKitchenFacadeDepth,
} from "@/lib/configurator/defaults";
import { calculateBreakdown } from "@/lib/configurator/engine";
import { toPriceBreakdown } from "@/lib/configurator/display-adapter";
import { safeParseConfig, storedProjectSchema } from "@/lib/configurator/schema";
import {
  BUILD_CALC_VERSION,
  SUPPORTED_SCHEMA_VERSION,
} from "@/lib/configurator/versions";
import { isConfigValid, validateConfig } from "@/lib/configurator/validation";
import type {
  FurnitureConfig,
  ProjectPriceHistory,
  StoredProject,
} from "@/lib/configurator/types";
import { hasPins } from "@/lib/admin/pins";
import { readDisplayMetadata } from "@/lib/admin/display-metadata";
import {
  FIXED_BODY_MATERIAL_ID,
  LEGACY_FACADE_BLOCK_MESSAGE,
  isLegacyFacadeMaterial,
} from "@/lib/configurator/materials";
import { completeProjectRecalculation } from "@/lib/admin/jobs";
import type {
  CompositionPreflight,
  DataResolverIssue,
} from "./data-resolver";
import { resolveCalculationInputs } from "./data-resolver";
import {
  resolveCompositionTrace,
  toCompositionTraceSnapshot,
  type CompositionTraceResult,
} from "./composition-resolver";
import type { CompositionTraceSnapshot } from "@/lib/configurator/types";
import { listPriceItems } from "@/lib/admin/price-items";
import type {
  CalculationBreakdown,
  CalculationInputs,
} from "@/lib/configurator/contract";
import { applyMigrations, schemaVersionOf } from "./migrations";
import { readCollectionStatus, updateCollection } from "./store";
import {
  REQUEST_FINGERPRINT_VERSION,
  requestFingerprint,
} from "./operation-fingerprint";

function projectId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  let id = "";
  for (let i = 0; i < 8; i += 1) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

export interface OperationIssue {
  code: string;
  path: string;
  message: string;
  entityId?: string;
}

export type OperationResult =
  | { ok: true; project: StoredProject; replay: boolean }
  | { ok: false; issues: OperationIssue[]; status?: number };

function operationIssue(
  code: string,
  path: string,
  message: string,
  status?: number,
): { ok: false; issues: OperationIssue[]; status?: number } {
  return {
    ok: false,
    issues: [{ code, path, message }],
    ...(status === undefined ? {} : { status }),
  };
}

function validationIssues(
  issues: ReturnType<typeof validateConfig>,
): OperationIssue[] {
  return issues.map((issue) => ({
    code: issue.severity === "error" ? "CONFIG_INVALID" : "CONFIG_WARNING",
    path: issue.path,
    message: issue.message,
  }));
}

function resolverIssues(issues: readonly DataResolverIssue[]): OperationIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
    message: issue.message,
    ...(issue.entityId === undefined ? {} : { entityId: issue.entityId }),
  }));
}

/**
 * E2: контекст независимой компонентной трассировки. Передаётся **только** когда
 * preflight Composition прошёл блокирующие проверки (handoff из DataResolver).
 * Trace вычисляется после Engine и никогда не влияет на `price`/`breakdown`.
 */
export interface CompositionTraceContext {
  compositionPreflight?: CompositionPreflight;
}

export async function calculatePriceFromInputs(
  request: {
    config: FurnitureConfig;
    schemaVersion: number;
    inputs: Parameters<typeof calculateBreakdown>[1];
  },
  traceContext?: CompositionTraceContext,
): Promise<
  | {
      ok: true;
      price: StoredProject["price"];
      /** E2: сырой результат Engine — вход trace-резолвера. На price не влияет. */
      breakdown: CalculationBreakdown;
      /** E2: независимая трассировка; отсутствует без composition-pin (В-1). */
      compositionTrace?: CompositionTraceResult;
    }
  | { ok: false; issues: OperationIssue[] }
> {
  // A18-1: последний шлюз перед Engine. Исторический материал фасада не
  // рассчитывается даже при вручную собранном CalculationRequest — обход через
  // прямой вызов сервиса исключён (та же точка, что и в DataResolver).
  if (isLegacyFacadeMaterial(request.config.facadeMaterial)) {
    return {
      ok: false,
      issues: [
        {
          code: "ENGINE_CONTRACT_LEGACY_FACADE_MATERIAL",
          path: "config.facadeMaterial",
          message: LEGACY_FACADE_BLOCK_MESSAGE,
        },
      ],
    };
  }
  let metadata;
  try {
    metadata = await readDisplayMetadata();
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: "DISPLAY_METADATA_UNAVAILABLE",
          path: "displayMetadata",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  let breakdown: CalculationBreakdown;
  let adapted;
  try {
    breakdown = calculateBreakdown(request.config, request.inputs);
    adapted = toPriceBreakdown(breakdown, metadata);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: "CALCULATION_FAILED",
          path: "engine",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  if (!adapted.ok) {
    return {
      ok: false,
      issues: adapted.issues.map((issue) => ({
        code: issue.code,
        path: issue.lineId ? `lines.${issue.lineId}` : "displayAdapter",
        message: issue.message,
      })),
    };
  }
  /*
   * E2: trace строится строго ПОСЛЕ Engine на его готовом breakdown.
   * Наличие/отсутствие/блокировка trace на `price` и `breakdown` не влияет:
   * Engine остаётся единственным источником итогов (В-2).
   */
  const compositionTrace = traceContext?.compositionPreflight
    ? await buildCompositionTrace({
        compositionPreflight: traceContext.compositionPreflight,
        config: request.config,
        inputs: request.inputs,
        breakdown,
      })
    : undefined;

  return {
    ok: true,
    price: adapted.price,
    breakdown,
    ...(compositionTrace === undefined ? {} : { compositionTrace }),
  };
}

/**
 * E2: сборка trace поверх уже посчитанного Engine. Read-only; исключения не
 * пробрасываются: недоступность тарифов означает «единица неизвестна»
 * (fail-closed → `price_unresolved`), а не нулевую цену.
 */
async function buildCompositionTrace(input: {
  compositionPreflight: CompositionPreflight;
  config: FurnitureConfig;
  inputs: CalculationInputs;
  breakdown: CalculationBreakdown;
}): Promise<CompositionTraceResult> {
  let priceItems: Awaited<ReturnType<typeof listPriceItems>> | undefined;
  try {
    priceItems = await listPriceItems();
  } catch {
    priceItems = undefined;
  }
  return resolveCompositionTrace({
    config: input.config,
    compositionPreflight: input.compositionPreflight,
    ...(input.inputs.rulesSnapshot === undefined
      ? {}
      : { rulesSnapshot: input.inputs.rulesSnapshot }),
    priceSnapshot: input.inputs.priceSnapshot,
    breakdown: input.breakdown,
    ...(priceItems === undefined ? {} : { priceItems }),
  });
}

function findHistoryEvent(
  project: StoredProject,
  operationId: string,
): ProjectPriceHistory | undefined {
  return (project.priceHistory ?? []).find(
    (event) => event.operationId === operationId,
  );
}

function projectFromHistoryEvent(
  project: StoredProject,
  event: ProjectPriceHistory,
): StoredProject {
  return {
    ...project,
    price: event.breakdown,
    schemaVersion: event.schemaVersion,
    calcVersion: event.calcVersion,
    priceVersion: event.toPriceVersionId,
    ...(event.compositionVersionId
      ? { compositionVersionId: event.compositionVersionId }
      : project.compositionVersionId
        ? { compositionVersionId: project.compositionVersionId }
        : {}),
    updatedAt: event.computedAt,
  };
}

function replayOrConflict(
  project: StoredProject,
  event: ProjectPriceHistory,
  fingerprint: string,
): OperationResult {
  if (
    event.requestFingerprint !== fingerprint ||
    event.requestFingerprintVersion !== REQUEST_FINGERPRINT_VERSION
  ) {
    return operationIssue(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency-Key",
      "ключ идемпотентности уже использован с другим содержимым запроса",
      409,
    );
  }
  return { ok: true, project, replay: true };
}

function findCreateOperation(
  items: readonly StoredProject[],
  operationId: string,
): { project: StoredProject; event: ProjectPriceHistory } | undefined {
  for (const project of items) {
    const event = (project.priceHistory ?? []).find(
      (entry) => entry.operationId === operationId,
    );
    if (event) return { project, event };
  }
  return undefined;
}

/**
 * READ-ONLY предварительная проверка CREATE по Idempotency-Key.
 * Нужна API-маршруту, чтобы вернуть replay до применения rate limit.
 * Окончательная защита остаётся внутри saveProject/updater.
 */
export async function findCreateReplay(input: {
  config: FurnitureConfig;
  operationId: string;
  /** E2: тот же optional pin, что и в `saveProject` — иначе fingerprint
   *  разойдётся и повторный запрос получит ложный 409 conflict. */
  compositionVersionId?: string;
}): Promise<OperationResult | undefined> {
  const operationId = input.operationId.trim();
  if (!operationId) return undefined;

  const read = await readCollectionStatus<StoredProject>("projects.json");
  if (read.status !== "ok") return undefined;

  const existing = findCreateOperation(read.items, operationId);
  if (!existing) return undefined;

  return replayOrConflict(
    existing.project,
    existing.event,
    requestFingerprint({
      operation: "create",
      config: input.config,
      ...(input.compositionVersionId
        ? { compositionVersionId: input.compositionVersionId }
        : {}),
    }),
  );
}

function createHistoryEvent(input: {
  projectId: string;
  operationId: string;
  reason: ProjectPriceHistory["reason"];
  fromPriceVersionId: string | null;
  toPriceVersionId: string;
  schemaVersion: number;
  oldPrice: number | null;
  newPrice: number;
  breakdown: StoredProject["price"];
  compositionVersionId?: string;
  /** E4: снимок трассировки именно этого расчёта (optional). */
  compositionTrace?: CompositionTraceSnapshot;
  fingerprint: string;
  computedAt: string;
}): ProjectPriceHistory {
  return {
    id: randomUUID(),
    projectId: input.projectId,
    operationId: input.operationId,
    reason: input.reason,
    fromPriceVersionId: input.fromPriceVersionId,
    toPriceVersionId: input.toPriceVersionId,
    schemaVersion: input.schemaVersion,
    calcVersion: BUILD_CALC_VERSION,
    oldPrice: input.oldPrice,
    newPrice: input.newPrice,
    delta: input.oldPrice === null ? null : input.newPrice - input.oldPrice,
    breakdown: input.breakdown,
    breakdownVersion: 1,
    ...(input.compositionVersionId
      ? { compositionVersionId: input.compositionVersionId }
      : {}),
    ...(input.compositionTrace
      ? { compositionTrace: input.compositionTrace }
      : {}),
    requestFingerprint: input.fingerprint,
    requestFingerprintVersion: REQUEST_FINGERPRINT_VERSION,
    computedAt: input.computedAt,
  };
}

export async function saveProject(input: {
  config: FurnitureConfig;
  operationId?: string;
  /** Явно выбранная опубликованная версия состава (admin/API), optional. */
  compositionVersionId?: string;
}): Promise<OperationResult> {
  // CA-515-03: legacy body MDF/plywood нормализуется только в новой
  // сохраняемой версии. GET/просмотр старый проект не меняет.
  const config: FurnitureConfig = {
    ...input.config,
    bodyMaterial: FIXED_BODY_MATERIAL_ID,
  };

  if (isLegacyFacadeMaterial(config.facadeMaterial)) {
    return operationIssue(
      "CONFIG_INVALID",
      "facadeMaterial",
      LEGACY_FACADE_BLOCK_MESSAGE,
      422,
    );
  }
  const issues = validateConfig(config);
  if (!isConfigValid(issues)) {
    return { ok: false, issues: validationIssues(issues), status: 422 };
  }

  const operationId = input.operationId?.trim() || randomUUID();
  const fingerprint = requestFingerprint({
    operation: "create",
    config,
    ...(input.compositionVersionId
      ? { compositionVersionId: input.compositionVersionId }
      : {}),
  });

  // Быстрый предварительный ответ для повтора; окончательная проверка —
  // внутри атомарного updater ниже.
  const existingRead = await readCollectionStatus<StoredProject>("projects.json");
  if (existingRead.status === "corrupt") {
    throw new Error(`Хранилище projects.json повреждено: ${existingRead.reason}`);
  }
  if (existingRead.status === "ok") {
    const existing = findCreateOperation(existingRead.items, operationId);
    if (existing) {
      return replayOrConflict(existing.project, existing.event, fingerprint);
    }
  }

  let resolution;
  try {
    resolution = await resolveCalculationInputs({
      operation: "create",
      config,
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      ...(input.compositionVersionId
        ? { compositionVersionId: input.compositionVersionId }
        : {}),
    });
  } catch (error) {
    return operationIssue(
      "CALCULATION_INPUTS_FAILED",
      "inputs",
      error instanceof Error ? error.message : String(error),
      500,
    );
  }
  if (!resolution.ok) {
    return { ok: false, issues: resolverIssues(resolution.issues), status: 422 };
  }

  const calculated = await calculatePriceFromInputs(resolution.value.request, {
    compositionPreflight: resolution.value.compositionPreflight,
  });
  if (!calculated.ok) return { ok: false, issues: calculated.issues, status: 422 };

  const now = new Date().toISOString();
  const request = resolution.value.request;
  const priceVersion = request.inputs.priceSnapshot.priceVersion;
  /* E4: trace вычислен один раз для этого расчёта и сохраняется в его событии. */
  const compositionTrace = calculated.compositionTrace
    ? (toCompositionTraceSnapshot(calculated.compositionTrace, now) ?? undefined)
    : undefined;
  // ADR-07 Q7-07/Q7-11: новый проект закрепляет снимок правил, фактически
  // использованный при создании. Это не «автоназначение legacy-проекту» —
  // существующие проекты без привязки остаются заблокированными для расчёта.
  const rulesSnapshotId = request.inputs.rulesSnapshot?.rulesSnapshotId;
  const compositionVersionId = resolution.value.compositionVersionId;

  return updateCollection<StoredProject, OperationResult>(
    "projects.json",
    (items) => {
      const existing = findCreateOperation(items, operationId);
      if (existing) {
        return {
          items,
          result: replayOrConflict(existing.project, existing.event, fingerprint),
        };
      }

      let id = projectId();
      let attempt = 0;
      while (items.some((item) => item.id === id) && attempt < 5) {
        id = projectId();
        attempt += 1;
      }

      const history = createHistoryEvent({
        projectId: id,
        operationId,
        reason: "create",
        fromPriceVersionId: null,
        toPriceVersionId: priceVersion,
        schemaVersion: request.schemaVersion,
        oldPrice: null,
        newPrice: calculated.price.total,
        breakdown: calculated.price,
        ...(compositionVersionId ? { compositionVersionId } : {}),
        ...(compositionTrace ? { compositionTrace } : {}),
        fingerprint,
        computedAt: now,
      });

      const stored: StoredProject = {
        id,
        config: request.config,
        schemaVersion: request.schemaVersion,
        calcVersion: BUILD_CALC_VERSION,
        priceVersion,
        ...(hasPins(resolution.value.pins)
          ? { pins: resolution.value.pins }
          : {}),
        ...(rulesSnapshotId === undefined ? {} : { rulesSnapshotId }),
        ...(compositionVersionId ? { compositionVersionId } : {}),
        price: calculated.price,
        priceHistory: [history],
        createdAt: now,
        updatedAt: now,
      };

      return {
        items: [...items, stored].slice(-2000),
        result: { ok: true, project: stored, replay: false },
      };
    },
  );
}

export interface RecalculateProjectInput {
  projectId: string;
  operationId: string;
  targetPriceVersionId: string;
  expectedProjectCalcVersion: string;
  requiredExecutedCalcVersion: string;
  expectedSourcePriceVersion: string | null;
}

export async function recalculateProject(
  input: RecalculateProjectInput,
): Promise<OperationResult> {
  const operationId = input.operationId.trim();
  if (operationId.length === 0) {
    return operationIssue(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key",
      "operationId обязателен",
      400,
    );
  }

  const current = await getProject(input.projectId);
  if (current.status === "not_found") {
    return operationIssue(
      "PROJECT_NOT_FOUND",
      "projectId",
      "проект не найден",
      404,
    );
  }
  if (current.status === "quarantined") {
    return operationIssue(
      "PROJECT_QUARANTINED",
      "projectId",
      current.reason,
      409,
    );
  }
  if (current.status === "unsupported") {
    return operationIssue(
      "PROJECT_UNSUPPORTED",
      "projectId",
      current.reason,
      422,
    );
  }

  // CA-516-03: legacy-фасад нельзя пересчитывать до ручной замены материала.
  // Проверка стоит до replay/резолвера/расчёта и не пишет ни проект, ни
  // историю, ни pins. Автоматической подмены на МДФ эмаль нет.
  if (isLegacyFacadeMaterial(current.project.config.facadeMaterial)) {
    return operationIssue(
      "LEGACY_FACADE_MATERIAL",
      "facadeMaterial",
      LEGACY_FACADE_BLOCK_MESSAGE,
      422,
    );
  }

  const fingerprint = requestFingerprint({
    operation: "recalculate",
    projectId: input.projectId,
    targetPriceVersionId: input.targetPriceVersionId,
    expectedProjectCalcVersion: input.expectedProjectCalcVersion,
    requiredExecutedCalcVersion: input.requiredExecutedCalcVersion,
    expectedSourcePriceVersion: input.expectedSourcePriceVersion,
  });

  const existingEvent = findHistoryEvent(current.project, operationId);
  if (existingEvent) {
    return replayOrConflict(
      projectFromHistoryEvent(current.project, existingEvent),
      existingEvent,
      fingerprint,
    );
  }

  let resolution;
  try {
    resolution = await resolveCalculationInputs({
      operation: "recalculate",
      project: current.project,
      targetPriceVersionId: input.targetPriceVersionId,
      expectedProjectCalcVersion: input.expectedProjectCalcVersion,
      requiredExecutedCalcVersion: input.requiredExecutedCalcVersion,
      expectedSourcePriceVersion: input.expectedSourcePriceVersion,
    });
  } catch (error) {
    return operationIssue(
      "CALCULATION_INPUTS_FAILED",
      "inputs",
      error instanceof Error ? error.message : String(error),
      500,
    );
  }
  if (!resolution.ok) {
    return { ok: false, issues: resolverIssues(resolution.issues), status: 422 };
  }

  const calculated = await calculatePriceFromInputs(resolution.value.request, {
    compositionPreflight: resolution.value.compositionPreflight,
  });
  if (!calculated.ok) return { ok: false, issues: calculated.issues, status: 422 };

  const now = new Date().toISOString();
  const request = resolution.value.request;
  /* E4: новый trace для этой ревизии; прежние события не переписываются. */
  const compositionTrace = calculated.compositionTrace
    ? (toCompositionTraceSnapshot(calculated.compositionTrace, now) ?? undefined)
    : undefined;

  return updateCollection<StoredProject, OperationResult>(
    "projects.json",
    (items) => {
      const index = items.findIndex((item) => item.id === input.projectId);
      if (index < 0) {
        return {
          items,
          result: operationIssue(
            "PROJECT_NOT_FOUND",
            "projectId",
            "проект не найден",
            404,
          ),
        };
      }

      const stored = items[index]!;
      const replayEvent = findHistoryEvent(stored, operationId);
      if (replayEvent) {
        return {
          items,
          result: replayOrConflict(
            projectFromHistoryEvent(stored, replayEvent),
            replayEvent,
            fingerprint,
          ),
        };
      }

      if ((stored.priceVersion ?? null) !== input.expectedSourcePriceVersion) {
        return {
          items,
          result: operationIssue(
            "STALE_SOURCE_PRICE_VERSION",
            "expectedSourcePriceVersion",
            `source "${stored.priceVersion ?? "нет"}" ≠ ожидаемой "${input.expectedSourcePriceVersion ?? "нет"}"`,
            409,
          ),
        };
      }
      const expectedComposition = resolution.value.compositionVersionId ?? null;
      if ((stored.compositionVersionId ?? null) !== expectedComposition) {
        return {
          items,
          result: operationIssue(
            "COMPOSITION_PIN_CHANGED",
            "compositionVersionId",
            `pin состава изменён во время расчёта: "${stored.compositionVersionId ?? "нет"}" ≠ "${expectedComposition ?? "нет"}"`,
            409,
          ),
        };
      }
      if (stored.calcVersion !== input.expectedProjectCalcVersion) {
        return {
          items,
          result: operationIssue(
            "PROJECT_CALC_VERSION_MISMATCH",
            "expectedProjectCalcVersion",
            `project "${stored.calcVersion ?? "нет"}" ≠ ожидаемой "${input.expectedProjectCalcVersion}"`,
            409,
          ),
        };
      }

      const oldPrice = stored.price.total;
      const history = createHistoryEvent({
        projectId: stored.id,
        operationId,
        reason: "manual_recalc",
        fromPriceVersionId: stored.priceVersion ?? null,
        toPriceVersionId: request.inputs.priceSnapshot.priceVersion,
        schemaVersion: request.schemaVersion,
        oldPrice,
        newPrice: calculated.price.total,
        breakdown: calculated.price,
        ...(resolution.value.compositionVersionId
          ? { compositionVersionId: resolution.value.compositionVersionId }
          : {}),
        ...(compositionTrace ? { compositionTrace } : {}),
        fingerprint,
        computedAt: now,
      });

      const updated: StoredProject = {
        ...stored,
        schemaVersion: request.schemaVersion,
        calcVersion: BUILD_CALC_VERSION,
        priceVersion: request.inputs.priceSnapshot.priceVersion,
        ...(resolution.value.compositionVersionId
          ? { compositionVersionId: resolution.value.compositionVersionId }
          : {}),
        price: calculated.price,
        priceHistory: [...(stored.priceHistory ?? []), history],
        updatedAt: now,
      };

      const nextItems = [...items];
      nextItems[index] = updated;
      return {
        items: nextItems,
        result: { ok: true, project: updated, replay: false },
      };
    },
  );
}

/**
 * CA-T-407 — атомарная запись цены/версий/события истории в проект.
 * Закрытие job — отдельная запись после успешной записи проекта
 * (проект + история атомарны; job закрывается вторым шагом).
 */
export async function applyProjectPriceHistory(input: {
  jobId?: string;
  expectedSourcePriceVersion: string | null;
  event: ProjectPriceHistory;
}): Promise<OperationResult> {
  // Предварительная проверка позволяет не переписывать storage при заведомо
  // устаревшем source; окончательная проверка остаётся внутри updater.
  const preRead = await readCollectionStatus<StoredProject>("projects.json");
  if (preRead.status === "ok") {
    const project = preRead.items.find((item) => item.id === input.event.projectId);
    if (!project) {
      return operationIssue("PROJECT_NOT_FOUND", "projectId", "проект не найден", 404);
    }
    // CA-516-03: альтернативный путь сохранения результата пересчёта тоже
    // не применяет событие к проекту с legacy-фасадом.
    if (isLegacyFacadeMaterial(project.config.facadeMaterial)) {
      return operationIssue(
        "LEGACY_FACADE_MATERIAL",
        "facadeMaterial",
        LEGACY_FACADE_BLOCK_MESSAGE,
        422,
      );
    }
    if ((project.priceVersion ?? null) !== input.expectedSourcePriceVersion) {
      return operationIssue(
        "STALE_SOURCE_PRICE_VERSION",
        "expectedSourcePriceVersion",
        `source "${project.priceVersion ?? "нет"}" ≠ ожидаемой "${input.expectedSourcePriceVersion ?? "нет"}"`,
        409,
      );
    }
    const alreadyApplied = (project.priceHistory ?? []).some(
      (event) => event.id === input.event.id,
    );
    if (!alreadyApplied) {
      if (project.calcVersion === undefined) {
        return operationIssue(
          "CALC_VERSION_UNKNOWN",
          "calcVersion",
          `у проекта "${project.id}" отсутствует calcVersion; пересчёт результатом "${input.event.calcVersion}" заблокирован (§5.7)`,
          409,
        );
      }
      if (project.calcVersion !== input.event.calcVersion) {
        return operationIssue(
          "CALC_VERSION_MISMATCH",
          "calcVersion",
          `calcVersion проекта "${project.calcVersion}" ≠ исполненной "${input.event.calcVersion}"; требуется явный engine_migration (§5.7)`,
          409,
        );
      }
    }
  } else if (preRead.status === "corrupt") {
    throw new Error(`Хранилище projects.json повреждено: ${preRead.reason}`);
  }

  const result = await updateCollection<StoredProject, OperationResult>(
    "projects.json",
    (items) => {
      const index = items.findIndex((item) => item.id === input.event.projectId);
      if (index < 0) {
        return {
          items,
          result: operationIssue(
            "PROJECT_NOT_FOUND",
            "projectId",
            "проект не найден",
            404,
          ),
        };
      }
      const stored = items[index]!;
      if ((stored.compositionVersionId ?? null) !== (input.event.compositionVersionId ?? null)) {
        return {
          items,
          result: operationIssue(
            "COMPOSITION_PIN_CHANGED",
            "compositionVersionId",
            `pin состава изменён во время расчёта: "${stored.compositionVersionId ?? "нет"}" ≠ "${input.event.compositionVersionId ?? "нет"}"`,
            409,
          ),
        };
      }
      if (isLegacyFacadeMaterial(stored.config.facadeMaterial)) {
        return {
          items,
          result: operationIssue(
            "LEGACY_FACADE_MATERIAL",
            "facadeMaterial",
            LEGACY_FACADE_BLOCK_MESSAGE,
            422,
          ),
        };
      }
      if ((stored.compositionVersionId ?? null) !== (input.event.compositionVersionId ?? null)) {
        return {
          items,
          result: operationIssue(
            "COMPOSITION_PIN_CHANGED",
            "compositionVersionId",
            `pin состава изменён во время расчёта: "${stored.compositionVersionId ?? "нет"}" ≠ "${input.event.compositionVersionId ?? "нет"}"`,
            409,
          ),
        };
      }
      if ((stored.priceVersion ?? null) !== input.expectedSourcePriceVersion) {
        return {
          items,
          result: operationIssue(
            "STALE_SOURCE_PRICE_VERSION",
            "expectedSourcePriceVersion",
            `source "${stored.priceVersion ?? "нет"}" ≠ ожидаемой "${input.expectedSourcePriceVersion ?? "нет"}"`,
            409,
          ),
        };
      }
      const history = stored.priceHistory ?? [];
      const existing = history.find((event) => event.id === input.event.id);
      if (existing) {
        return {
          items,
          result: {
            ok: true,
            project: { ...stored, priceHistory: history },
            replay: true,
          },
        };
      }

      // CA-T-412 / §5.7: автоматический прайс-пересчёт не меняет
      // calcVersion. Отсутствующая версия не присваивается молча —
      // первое определение только через retro_certification/engine_migration.
      if (stored.calcVersion === undefined) {
        return {
          items,
          result: operationIssue(
            "CALC_VERSION_UNKNOWN",
            "calcVersion",
            `у проекта "${stored.id}" отсутствует calcVersion; пересчёт результатом "${input.event.calcVersion}" заблокирован (§5.7)`,
            409,
          ),
        };
      }
      if (stored.calcVersion !== input.event.calcVersion) {
        return {
          items,
          result: operationIssue(
            "CALC_VERSION_MISMATCH",
            "calcVersion",
            `calcVersion проекта "${stored.calcVersion}" ≠ исполненной "${input.event.calcVersion}"; требуется явный engine_migration (§5.7)`,
            409,
          ),
        };
      }

      const updated: StoredProject = {
        ...stored,
        schemaVersion: input.event.schemaVersion,
        calcVersion: input.event.calcVersion,
        priceVersion: input.event.toPriceVersionId,
        ...(input.event.compositionVersionId
          ? { compositionVersionId: input.event.compositionVersionId }
          : {}),
        price: input.event.breakdown,
        priceHistory: [...history, input.event],
        updatedAt: input.event.computedAt,
      };
      const next = [...items];
      next[index] = updated;
      return {
        items: next,
        result: { ok: true, project: updated, replay: false },
      };
    },
  );

  if (result.ok && input.jobId) {
    await completeProjectRecalculation(input.jobId, {
      newPrice: input.event.newPrice,
      now: input.event.computedAt,
    });
  }
  return result;
}

/**
 * Результат чтения проекта (CA-T-106, дизайн §12 S6, OI-064):
 * невалидный или несовместимый проект отдаётся с пометкой, а не теряется
 * за `null`-404; повреждённый файл квартируется, а не роняет чтение в 500.
 */
export type ProjectReadResult =
  | { status: "not_found" }
  | { status: "quarantined"; reason: string }
  | {
      status: "ok";
      project: StoredProject;
      versionsInferred: boolean;
      /** §12 S3/S9: у записи нет `calcVersion` — сборка не присваивается молча. */
      calcVersionUnknown: boolean;
      /** CA-T-304A: у записи нет `priceVersion` — источник цены не разрешён. */
      priceVersionUnknown: boolean;
      /** CA-T-304A: `false` для legacy-проектов — авто-пересчёт заблокирован. */
      priceRecalculated: boolean;
      /** CA-T-108: `pins` отсутствуют/пусты — версии ссылок выведены (inferred). */
      pinsInferred: boolean;
    }
  | { status: "unsupported"; project: StoredProject; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Конфиг узнаваем текущей схемой (есть поля, без которых обработка падает). */
function isRecognisedConfig(config: unknown): config is FurnitureConfig {
  if (!isRecord(config)) return false;
  if (config.kind === "kitchen") return Array.isArray(config.modules);
  if (config.kind === "wardrobe") return Array.isArray(config.sections);
  return false;
}

export async function getProject(id: string): Promise<ProjectReadResult> {
  const read = await readCollectionStatus<unknown>("projects.json");
  if (read.status === "missing") return { status: "not_found" };
  if (read.status === "corrupt") {
    return { status: "quarantined", reason: read.reason };
  }

  const raw = read.items.find(
    (item): item is Record<string, unknown> => isRecord(item) && item.id === id,
  );
  if (!raw) return { status: "not_found" };

  const parsed = storedProjectSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "quarantined",
      reason: `запись проекта повреждена (${
        issue ? `${issue.path.join(".")}: ${issue.message}` : "нет обязательных полей"
      })`,
    };
  }

  // raw-режим: содержимое config/price проверяется ниже, а не отбрасывается.
  const stored = parsed.data as unknown as StoredProject;
  const from = schemaVersionOf(stored);
  if (from > SUPPORTED_SCHEMA_VERSION) {
    return {
      status: "unsupported",
      project: stored,
      reason: `структура проекта v${from} новее поддерживаемой v${SUPPORTED_SCHEMA_VERSION}`,
    };
  }

  let migrated: StoredProject;
  try {
    migrated = applyMigrations(stored).project;
  } catch (error) {
    return {
      status: "unsupported",
      project: stored,
      reason: `миграция структуры не выполнена: ${(error as Error).message}`,
    };
  }

  if (!isRecognisedConfig(migrated.config)) {
    return {
      status: "unsupported",
      project: migrated,
      reason: "конфигурация проекта не распознана текущей схемой",
    };
  }

  try {
    // Строгий разбор (Zod): подставляет default-поля и нормализует легаси-
    // идентификаторы через COUNTERTOP_LEGACY_MAP (§12 S5). При провале —
    // мягкая ветка: неизвестные поля не отбрасываются молча (§12 S8),
    // решение о совместимости принимает validateConfig.
    const strict = safeParseConfig(migrated.config);
    const config: FurnitureConfig = strict.success
      ? strict.data.kind === "kitchen"
        ? // CA-T-513: старые проекты не содержат facadeThickness; после
          // Zod-default подбираем допустимую толщину и глубину корпуса.
          normalizeKitchenFacadeDepth(strict.data)
        : strict.data
      : migrated.config.kind === "kitchen"
        ? normalizeKitchen(migrated.config)
        : migrated.config;
    const issues = validateConfig(config);
    if (!isConfigValid(issues)) {
      return {
        status: "unsupported",
        project: migrated,
        reason: "конфигурация не проходит текущие правила валидации",
      };
    }
    // CA-T-413/R-01: GET всегда возвращает сохранённый snapshot.
    // Цена не пересчитывается ни для legacy, ни для versioned-проектов.
    const priceVersionUnknown = migrated.priceVersion == null;
    return {
      status: "ok",
      project: {
        ...migrated,
        config,
        price: migrated.price,
        priceHistory: migrated.priceHistory ?? [],
        updatedAt: migrated.updatedAt,
      },
      priceVersionUnknown,
      priceRecalculated: false,
      // Запись без schemaVersion → v1 (дизайн §12 S1), поле не дозаписывается.
      versionsInferred: parsed.data.schemaVersion === undefined,
      // §12 S3/S9: текущая сборка проекту молча не присваивается.
      calcVersionUnknown: migrated.calcVersion == null,
      // CA-T-108: легаси-проект без зафиксированных версий ссылок.
      pinsInferred: !hasPins(migrated.pins),
    };
  } catch {
    return {
      status: "unsupported",
      project: migrated,
      reason: "конфигурация проекта не может быть обработана текущей схемой",
    };
  }
}
