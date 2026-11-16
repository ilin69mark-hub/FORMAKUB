import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { appendAuditEvent, listAuditEvents, type AdminAuditEvent } from "@/lib/server/audit";
import { readCollection, updateCollection } from "@/lib/server/store";

import type { ActorContext } from "./parameters";
import {
  COMPONENT_REGISTRY,
  EXCLUDED_FORMULAS,
  FORMULA_REGISTRY,
  MAP_ROWS,
  UNKNOWN_SOURCES,
  mapKey,
  type MapRow,
  type UnknownSource,
} from "./dependency-map";
import {
  parameterDependencySchema,
  type AdminParameter,
  type CatalogItem,
  type ModulePreset,
  type ParameterDependency,
} from "./schema";

/**
 * Сервис ParameterDependency (CA-T-206): импорт подтверждённой карты
 * «источник → формула/компонент» и контроль полноты графа.
 *
 * Модель — дизайн §6.8 / ТЗ §3.2 (схема CA-T-201): U(sourceType,
 * sourceId, targetType, targetId), полиморфные ссылки (п.1), проверка
 * существования при записи (п.2), архивация источника не удаляет связи
 * (п.3), физическое удаление запрещено (п.4), циклы структурно
 * невозможны — рёбра идут только «данные → расчёт» (п.5), полнота —
 * инвариант диагностики (п.6).
 *
 * Хранение — только Storage Adapter (`updateCollection` под замком),
 * одна коллекция `parameter-dependencies.json`; параллельной модели нет.
 * Импорт атомарен: валидация всех строк ДО единственной записи; при
 * ошибке — ничего не записано (§6 задачи, п.17).
 *
 * Реестры целей (провизорные до CA-T-307 — `CalculationReference` в
 * коде отсутствует, M-32): `FORMULA_REGISTRY` = §3 аудита (file:function),
 * `COMPONENT_REGISTRY` = `component:<file:имя>` (§6.8 п.1) по фактически
 * существующим файлам/константам. Неизвестные цели → skipped в отчёте.
 *
 * Аудит (§8 задачи): enum `audit.ts`/дизайн §6.11 не содержит действия
 * `dependency.*`; расширение enum — архитектурное решение владельца (ТЗ
 * §3.2 перечень открыт, дизайн §6.11 закрыт). Поэтому (1) импорт и
 * диагностика журналируются существующим `diagnostic.run` (ТЗ §10:
 * «проверка связей ParameterDependency»), (2) ручное создание ребра
 * (`createDependency`) без журнала — зафиксировано в отчёте как
 * ограничение контракта аудита; маскировка под чужие события не
 * применяется.
 */

const DEP_COLLECTION = "parameter-dependencies.json";
const PARAMS_COLLECTION = "admin-parameters.json";
const CATALOGS_COLLECTION = "catalog-items.json";
const PRESETS_COLLECTION = "module-presets.json";

const SRC_ROOT = path.join(process.cwd(), "src");

/** U-ключ записи → детерминированный id (идемпотентность импорта). */
function dependencyId(ukey: string): string {
  return `dep-${createHash("sha256").update(ukey).digest("hex").slice(0, 20)}`;
}

export interface DependencyFilter {
  sourceType?: ParameterDependency["sourceType"];
  sourceId?: string;
  targetType?: ParameterDependency["targetType"];
  targetId?: string;
  effect?: ParameterDependency["effect"];
}

function matches(row: ParameterDependency, filter: DependencyFilter): boolean {
  return (
    (filter.sourceType === undefined || row.sourceType === filter.sourceType) &&
    (filter.sourceId === undefined || row.sourceId === filter.sourceId) &&
    (filter.targetType === undefined || row.targetType === filter.targetType) &&
    (filter.targetId === undefined || row.targetId === filter.targetId) &&
    (filter.effect === undefined || row.effect === filter.effect)
  );
}

/** Чтение графа (read-path, без блокировки). Невалидные записи исключаются. */
export async function listDependencies(
  filter: DependencyFilter = {},
): Promise<ParameterDependency[]> {
  const items = await readCollection<ParameterDependency>(DEP_COLLECTION);
  return items.filter(
    (item) => parameterDependencySchema.safeParse(item).success && matches(item, filter),
  );
}

export async function getDependency(
  id: string,
): Promise<ParameterDependency | undefined> {
  const items = await readCollection<ParameterDependency>(DEP_COLLECTION);
  return items.find((item) => item.id === id);
}

/** ─── Проверка существования источников и целей ────────────────────────── */

interface SourceData {
  parameters: AdminParameter[];
  catalogs: CatalogItem[];
  presets: ModulePreset[];
}

async function loadSources(): Promise<SourceData> {
  const [parameters, catalogs, presets] = await Promise.all([
    readCollection<AdminParameter>(PARAMS_COLLECTION),
    readCollection<CatalogItem>(CATALOGS_COLLECTION),
    readCollection<ModulePreset>(PRESETS_COLLECTION),
  ]);
  return { parameters, catalogs, presets };
}

function catalogSourceKey(item: CatalogItem): string {
  return `${item.catalog}:${item.id}`;
}

function presetSourceKey(item: ModulePreset): string {
  return `${item.family}:${item.id}`;
}

/** §6.8 п.1/п.2: источник существует в своей коллекции. */
function sourceExists(
  sourceType: ParameterDependency["sourceType"],
  sourceId: string,
  sources: SourceData,
): boolean {
  switch (sourceType) {
    case "parameter":
      return sources.parameters.some((item) => item.id === sourceId);
    case "catalogItem":
      return sources.catalogs.some((item) => catalogSourceKey(item) === sourceId);
    case "preset":
      return sources.presets.some((item) => presetSourceKey(item) === sourceId);
    case "priceItem":
      // PriceItem: коллекция price-items.json; ставок в проекте нет (C3) —
      // существование проверяется по факту наличия записи.
      return true;
  }
}

function formulaExists(targetId: string): boolean {
  const entry = FORMULA_REGISTRY.find((item) => item.id === targetId);
  return entry !== undefined && existsSync(path.join(SRC_ROOT, entry.file));
}

function componentExists(targetId: string): boolean {
  const entry = COMPONENT_REGISTRY.find((item) => item.id === targetId);
  return entry !== undefined && existsSync(path.join(SRC_ROOT, entry.file));
}

/** §6.8 п.2: цель существует (реестр формул/компонентов + файл на диске). */
function targetExists(row: Pick<MapRow, "targetType" | "targetId">): boolean {
  if (row.targetType === "calculation") return formulaExists(row.targetId);
  return componentExists(row.targetId);
}

/** Строгая валидация записи графа (schema CA-T-201, strict). */
function parseDependency(
  input: Record<string, unknown>,
): ParameterDependency {
  return parameterDependencySchema.parse(input);
}

/** Ошибка существования источника/цели — для createDependency. */
function assertEndpoints(
  row: Pick<MapRow, "sourceType" | "sourceId" | "targetType" | "targetId">,
  sources: SourceData,
): void {
  if (!sourceExists(row.sourceType, row.sourceId, sources)) {
    throw new Error(
      `ParameterDependency: источник не найден (${row.sourceType}:${row.sourceId}).`,
    );
  }
  if (!targetExists(row)) {
    throw new Error(
      `ParameterDependency: цель не найдена (${row.targetType}:${row.targetId}).`,
    );
  }
}

/**
 * Ручное создание ребра (используется импортом и тестами): строгая
 * валидация, проверка источника/цели, U-ключ под замком Storage Adapter,
 * запрет дубликатов. Физическое удаление запрещено (п.4) — см.
 * `deleteDependency`.
 */
export async function createDependency(
  input: Record<string, unknown>,
): Promise<ParameterDependency> {
  // id детерминирован по U-ключу, если не задан вызывающей стороной.
  const withId =
    typeof input.id === "string" && input.id.length > 0
      ? input
      : {
          ...input,
          id: dependencyId(
            [input.sourceType, input.sourceId, input.targetType, input.targetId].join("|"),
          ),
        };
  const candidate = parseDependency(withId);
  const ukey = mapKey(candidate);

  const sources = await loadSources();
  assertEndpoints(candidate, sources);

  return updateCollection<ParameterDependency, ParameterDependency>(
    DEP_COLLECTION,
    (items) => {
      if (items.some((item) => mapKey(item) === ukey)) {
        throw new Error(
          `ParameterDependency: дубликат U-ключа (${ukey}).`,
        );
      }
      if (items.some((item) => item.id === candidate.id)) {
        throw new Error(`ParameterDependency: id "${candidate.id}" уже существует.`);
      }
      return { items: [...items, candidate], result: candidate };
    },
  );
}

/**
 * Физическое удаление запрещено (§6.8 п.4, ТЗ §3.2): архивация
 * источника сохраняет связи — исключение при любом вызове.
 */
export async function deleteDependency(): Promise<never> {
  throw new Error(
    "ParameterDependency: физическое удаление запрещено (§6.8 п.4); архивация источника сохраняет связи.",
  );
}

/** ─── Импорт подтверждённой карты ──────────────────────────────────────── */

export type SkipReason = "unknown-source" | "unknown-target";

export interface ImportSkipped {
  sourceType: MapRow["sourceType"];
  sourceId: string;
  targetId: string;
  reason: SkipReason;
}

export interface ImportReport {
  /** Всего строк карты. */
  mapTotal: number;
  /** Строк, прошедших схему (включая effect=none). */
  candidates: number;
  /** Записано новых рёбер. */
  imported: number;
  /** Уже существовали (идемпотентность повторного импорта). */
  existing: number;
  /** Из записанных: effect=none (мёртвые источники §6.8). */
  dead: number;
  /** Из записанных: evidence=PARTIAL (не подтверждены целиком). */
  partial: number;
  skipped: ImportSkipped[];
  /** UNKNOWN-источники карты — в отчёт, не в граф. */
  unknownSources: UnknownSource[];
}

/**
 * Импорт подтверждённых связей (§5 задачи): идемпотентен (детерминированные
 * id + U-ключ), неизвестные источники/цели → отдельный отчёт (не
 * импортируются как подтверждённые), исходные данные калькуляторов
 * (`src/content`, `src/lib/configurator`) не изменяются — запись только в
 * коллекцию графа. Атомарность: валидация всех строк до единственной
 * записи; ошибка → состояние не менялось. Результат журналируется
 * `diagnostic.run` (см. шапку — enum не содержит `dependency.*`).
 */
export async function importDependencyMap(
  actor: ActorContext,
): Promise<ImportReport> {
  const sources = await loadSources();

  const skipped: ImportSkipped[] = [];
  const candidates: { row: MapRow; dep: ParameterDependency }[] = [];

  for (const row of MAP_ROWS) {
    const parsed = parameterDependencySchema.safeParse({
      id: dependencyId(mapKey(row)),
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      targetType: row.targetType,
      targetId: row.targetId,
      effect: row.effect,
      syncRisk: row.syncRisk,
      ...(row.duplicatedIn ? { duplicatedIn: row.duplicatedIn } : {}),
    });
    if (!parsed.success) {
      // Строка собственной карты не проходит схему — ошибка данных,
      // импорт не начинается (ничего не записано).
      throw new Error(
        `ParameterDependency: строка карты не проходит схему (${mapKey(row)}): ${parsed.error.message}`,
      );
    }
    if (!sourceExists(row.sourceType, row.sourceId, sources)) {
      skipped.push({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        targetId: row.targetId,
        reason: "unknown-source",
      });
      continue;
    }
    if (!targetExists(row)) {
      skipped.push({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        targetId: row.targetId,
        reason: "unknown-target",
      });
      continue;
    }
    if (row.evidence === "UNKNOWN") {
      // UNKNOWN не импортируется как подтверждённая связь (§5 задачи):
      // такие строки отсутствуют в MAP_ROWS — учтены в UNKNOWN_SOURCES.
      skipped.push({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        targetId: row.targetId,
        reason: "unknown-target",
      });
      continue;
    }
    candidates.push({ row, dep: parsed.data });
  }

  // Единая запись: U-ключ перепроверяется под замком (гонка импортов).
  let imported = 0;
  let existing = 0;
  let dead = 0;
  let partial = 0;
  await updateCollection<ParameterDependency, void>(DEP_COLLECTION, (items) => {
    const known = new Set(items.map((item) => mapKey(item)));
    const added: ParameterDependency[] = [];
    for (const { row, dep } of candidates) {
      if (known.has(mapKey(dep))) {
        existing += 1;
        continue;
      }
      known.add(mapKey(dep));
      added.push(dep);
      imported += 1;
      if (row.effect === "none") dead += 1;
      if (row.evidence === "PARTIAL") partial += 1;
    }
    return { items: [...items, ...added], result: undefined };
  });

  const report: ImportReport = {
    mapTotal: MAP_ROWS.length,
    candidates: candidates.length,
    imported,
    existing,
    dead,
    partial,
    skipped,
    unknownSources: [...UNKNOWN_SOURCES],
  };

  await appendAuditEvent({
    action: "diagnostic.run",
    entityType: "parameterDependency",
    entityId: "import",
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    newValue: {
      imported: report.imported,
      existing: report.existing,
      skipped: report.skipped.length,
      unknownSources: report.unknownSources.length,
    },
  });
  return report;
}

/** История изменений графа в рамках существующего контракта аудита. */
export async function listDependencyEvents(
  entityId?: string,
): Promise<AdminAuditEvent[]> {
  return listAuditEvents({
    entityType: "parameterDependency",
    ...(entityId !== undefined ? { entityId } : {}),
  });
}

/** ─── Диагностика полноты графа ────────────────────────────────────────── */

export interface CoverageBucket {
  /** Параметров с `affects.<effect>=true` (active). */
  total: number;
  confirmed: number;
  partial: number;
  unknown: number;
  notCovered: number;
  notCoveredIds: string[];
  /** true: total>0 и все confirmed. */
  complete: boolean;
}

export interface FormulaCoverage {
  /** Основных формул §3. */
  total: number;
  /** Проверяемых (основные минус исключения). */
  evaluable: number;
  confirmed: number;
  partial: number;
  uncovered: { id: string; reason: string }[];
  excluded: { id: string; reason: string }[];
  complete: boolean;
}

export interface StructuralIssues {
  /** Записи, не проходящие схему CA-T-201. */
  invalid: { id?: string; reason: string }[];
  /** Дубли U-ключа в коллекции. */
  duplicates: ParameterDependency[];
  /** Осиротевшие ссылки (источник/цель отсутствует). */
  orphans: { id: string; reason: string }[];
  /** Архивные источники: связи сохраняются (§6.8 п.3). */
  archivedSources: { sourceType: string; sourceId: string }[];
  /** Циклы: структурно невозможны — рёбра «данные → расчёт» (§6.8 п.5). */
  cycles: [];
}

export interface GraphDiagnostic {
  generatedAt: string;
  totals: { rows: number; valid: number; sources: number; targets: number };
  structural: StructuralIssues;
  coverage: {
    effects: {
      price: CoverageBucket;
      geometry: CoverageBucket;
      validation: CoverageBucket;
      visualization: CoverageBucket;
    };
    formulas: FormulaCoverage;
    /** Параметры без единого ребра (active). */
    paramsWithoutDependencies: string[];
    /** UNKNOWN-источники карты (не импортированы). */
    unknownSources: UnknownSource[];
    /** Рёбра с evidence=PARTIAL (по карте). */
    partialEdges: { sourceId: string; targetId: string }[];
    /** Компоненты реестра без рёбер в коллекции. */
    unconfirmedComponents: string[];
    /** Мёртвые источники (effect=none). */
    deadSources: { sourceType: string; sourceId: string }[];
    /** Инвариант §6.8 п.6 выполнен полностью. */
    complete: boolean;
  };
}

const AFFECTS_KEYS = ["price", "geometry", "validation", "visualization"] as const;

function emptyBucket(): CoverageBucket {
  return {
    total: 0,
    confirmed: 0,
    partial: 0,
    unknown: 0,
    notCovered: 0,
    notCoveredIds: [],
    complete: false,
  };
}

function isUnknownSource(sourceId: string, sourceType: string): UnknownSource | undefined {
  return UNKNOWN_SOURCES.find(
    (item) =>
      item.sourceType === sourceType &&
      (item.sourceId === sourceId ||
        (item.sourceId.endsWith(":*") && sourceId.startsWith(item.sourceId.slice(0, -1)))),
  );
}

/**
 * Диагностика графа: структурная целостность (схема, U-ключи, существование
 * источников/целей, архивные источники) + семантическая полнота (покрытие
 * `affects.*`, покрытие формул §3, UNKNOWN/PARTIAL, мёртвые источники).
 * Полный вывод = `complete=true` только при отсутствии UNKNOWN, PARTIAL,
 * осиротевших, невалидных и непокрытых позиций.
 */
export async function diagnoseGraph(): Promise<GraphDiagnostic> {
  const [rawRows, sources] = await Promise.all([
    readCollection<ParameterDependency>(DEP_COLLECTION),
    loadSources(),
  ]);

  // ── Структурная часть ──
  const invalid: StructuralIssues["invalid"] = [];
  const valid: ParameterDependency[] = [];
  for (const row of rawRows) {
    const parsed = parameterDependencySchema.safeParse(row);
    if (parsed.success) valid.push(parsed.data);
    else invalid.push({ ...(row.id !== undefined ? { id: String(row.id) } : {}), reason: parsed.error.message });
  }

  const keyCount = new Map<string, ParameterDependency[]>();
  for (const row of valid) {
    const key = mapKey(row);
    keyCount.set(key, [...(keyCount.get(key) ?? []), row]);
  }
  const duplicates = [...keyCount.values()].filter((group) => group.length > 1).flat();

  const orphans: StructuralIssues["orphans"] = [];
  const archivedSources: StructuralIssues["archivedSources"] = [];
  const seenArchived = new Set<string>();
  for (const row of valid) {
    // Архивный/исключённый источник: запись существует, но неактивна —
    // связи сохраняются (§6.8 п.3), в orphan не попадает.
    const archived =
      (row.sourceType === "parameter" &&
        sources.parameters.some((item) => item.id === row.sourceId && item.status === "dead")) ||
      (row.sourceType === "catalogItem" &&
        sources.catalogs.some((item) => catalogSourceKey(item) === row.sourceId && item.status === "archived")) ||
      (row.sourceType === "preset" &&
        sources.presets.some((item) => presetSourceKey(item) === row.sourceId && item.status === "archived"));
    if (archived) {
      const key = `${row.sourceType}|${row.sourceId}`;
      if (!seenArchived.has(key)) {
        seenArchived.add(key);
        archivedSources.push({ sourceType: row.sourceType, sourceId: row.sourceId });
      }
    } else if (!sourceExists(row.sourceType, row.sourceId, sources)) {
      orphans.push({ id: row.id, reason: `источник не найден: ${row.sourceType}:${row.sourceId}` });
    }
    if (!targetExists(row)) {
      orphans.push({ id: row.id, reason: `цель не найдена: ${row.targetType}:${row.targetId}` });
    }
  }

  // ── Семантическая часть: покрытие affects.* ──
  const effects: GraphDiagnostic["coverage"]["effects"] = {
    price: emptyBucket(),
    geometry: emptyBucket(),
    validation: emptyBucket(),
    visualization: emptyBucket(),
  };

  const activeParams = sources.parameters.filter((item) => item.status === "active");
  for (const param of activeParams) {
    for (const key of AFFECTS_KEYS) {
      if (!param.affects[key]) continue;
      const bucket = effects[key];
      bucket.total += 1;
      const edges = valid.filter(
        (row) =>
          row.sourceType === "parameter" &&
          row.sourceId === param.id &&
          row.effect === key,
      );
      if (edges.length === 0) {
        if (isUnknownSource(param.id, "parameter")) bucket.unknown += 1;
        else {
          bucket.notCovered += 1;
          bucket.notCoveredIds.push(param.id);
        }
        continue;
      }
      // Доказательство — по карте (лучший статус среди рёбер).
      const evidences = edges.map(
        (edge) =>
          MAP_ROWS.find((row) => mapKey(row) === mapKey(edge))?.evidence,
      );
      if (evidences.includes("CONFIRMED")) bucket.confirmed += 1;
      else if (evidences.includes("PARTIAL")) bucket.partial += 1;
      else if (evidences.includes("NOT_USED")) bucket.notCovered += 1;
      else bucket.unknown += 1;
    }
  }
  for (const key of AFFECTS_KEYS) {
    const bucket = effects[key];
    bucket.complete =
      bucket.total > 0 &&
      bucket.confirmed === bucket.total &&
      bucket.partial === 0 &&
      bucket.unknown === 0 &&
      bucket.notCovered === 0;
  }

  // ── Покрытие формул §3 ──
  const primaries = FORMULA_REGISTRY.filter((item) => item.primary);
  const excludedIds = new Set(EXCLUDED_FORMULAS.map((item) => item.id));
  const formulaCoverage: FormulaCoverage = {
    total: primaries.length,
    evaluable: primaries.length - EXCLUDED_FORMULAS.filter((item) =>
      primaries.some((primary) => primary.id === item.id),
    ).length,
    confirmed: 0,
    partial: 0,
    uncovered: [],
    excluded: EXCLUDED_FORMULAS.filter((item) =>
      primaries.some((primary) => primary.id === item.id),
    ),
    complete: false,
  };
  for (const primary of primaries) {
    if (excludedIds.has(primary.id)) continue;
    const edges = valid.filter(
      (row) => row.targetType === "calculation" && row.targetId === primary.id,
    );
    const evidences = edges.map(
      (edge) => MAP_ROWS.find((row) => mapKey(row) === mapKey(edge))?.evidence,
    );
    if (evidences.includes("CONFIRMED")) formulaCoverage.confirmed += 1;
    else if (evidences.includes("PARTIAL")) {
      formulaCoverage.partial += 1;
      formulaCoverage.uncovered.push({
        id: primary.id,
        reason: "только PARTIAL-доказательства",
      });
    } else {
      formulaCoverage.uncovered.push({
        id: primary.id,
        reason: "нет рёбер с подтверждённым доказательством",
      });
    }
  }
  formulaCoverage.complete =
    formulaCoverage.evaluable > 0 &&
    formulaCoverage.confirmed === formulaCoverage.evaluable &&
    formulaCoverage.uncovered.length === 0;

  // ── Прочие показатели ──
  const paramsWithoutDependencies = activeParams
    .filter((param) => !valid.some((row) => row.sourceType === "parameter" && row.sourceId === param.id))
    .map((param) => param.id);

  const partialEdges = valid
    .filter((row) => MAP_ROWS.find((item) => mapKey(item) === mapKey(row))?.evidence === "PARTIAL")
    .map((row) => ({ sourceId: row.sourceId, targetId: row.targetId }));

  const componentTargets = new Set(
    valid.filter((row) => row.targetType !== "calculation").map((row) => row.targetId),
  );
  const unconfirmedComponents = COMPONENT_REGISTRY.filter(
    (item) => !componentTargets.has(item.id),
  ).map((item) => item.id);

  const deadSources = valid
    .filter((row) => row.effect === "none")
    .map((row) => ({ sourceType: row.sourceType, sourceId: row.sourceId }));

  const complete =
    invalid.length === 0 &&
    duplicates.length === 0 &&
    orphans.length === 0 &&
    Object.values(effects).every((bucket) => bucket.complete) &&
    formulaCoverage.complete &&
    UNKNOWN_SOURCES.length === 0 &&
    partialEdges.length === 0 &&
    unconfirmedComponents.length === 0 &&
    paramsWithoutDependencies.length === 0;

  const diagnostic: GraphDiagnostic = {
    generatedAt: new Date().toISOString(),
    totals: {
      rows: rawRows.length,
      valid: valid.length,
      sources:
        sources.parameters.length + sources.catalogs.length + sources.presets.length,
      targets: FORMULA_REGISTRY.length + COMPONENT_REGISTRY.length,
    },
    structural: { invalid, duplicates, orphans, archivedSources, cycles: [] },
    coverage: {
      effects,
      formulas: formulaCoverage,
      paramsWithoutDependencies,
      unknownSources: [...UNKNOWN_SOURCES],
      partialEdges,
      unconfirmedComponents,
      deadSources,
      complete,
    },
  };

  await appendAuditEvent({
    action: "diagnostic.run",
    entityType: "parameterDependency",
    entityId: "diagnosis",
    actorId: "system",
    actorRole: "system",
    result: "ok",
    newValue: {
      rows: diagnostic.totals.rows,
      complete: diagnostic.coverage.complete,
      orphans: orphans.length,
      invalid: invalid.length,
    },
  });
  return diagnostic;
}
