import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import {
  collectDiagnosticIssues,
  coverageLabel,
  splitParametersByStatus,
  summarizeIssues,
  type DiagnosticSeverity,
} from "@/lib/admin/diagnostics-ui";
import { diagnoseGraph, type GraphDiagnostic } from "@/lib/admin/dependencies";
import { listParameters } from "@/lib/admin/parameters";
import { getDataSources, type DataSourceBoard } from "@/lib/admin/data-sources";
import { getPublishedVersion } from "@/lib/admin/pricing";
import { listPriceItems } from "@/lib/admin/price-items";
import { moduleCoverageIssues } from "@/lib/admin/catalog-model";
import { getCompositionBoard, type CompositionBoard } from "@/lib/admin/composition-board";
import {
  adminParameterSchema,
  catalogItemSchema,
  modulePresetSchema,
  priceItemSchema,
} from "@/lib/admin/schema";
import { readCollectionStatus } from "@/lib/server/store";
import type { PriceItem, PricingVersion } from "@/lib/admin/schema";

import { sectionMetadata } from "../_components/section-route";

export const metadata: Metadata = sectionMetadata("diagnostics");
export const dynamic = "force-dynamic";

const EFFECT_KEYS = ["price", "geometry", "validation", "visualization"] as const;

const SEVERITY_STYLE: Record<DiagnosticSeverity, string> = {
  error: "border-red-700/20 bg-red-600/10 text-red-900",
  warning: "border-amber-700/25 bg-amber-500/12 text-amber-950",
  info: "border-ink/15 bg-ink/5 text-ink/65",
};

function SeverityBadge({ severity }: { severity: DiagnosticSeverity }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.08em] ${SEVERITY_STYLE[severity]}`}
    >
      {severity}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="card-surface px-5 py-4">
      <p className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/42">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
      {hint ? <p className="mt-1 text-[0.68rem] text-ink/45">{hint}</p> : null}
    </div>
  );
}

function CountRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink/7 py-2 last:border-b-0">
      <div>
        <p className="text-[0.78rem] text-ink/78">{label}</p>
        {detail ? (
          <p className="mt-0.5 text-[0.68rem] text-ink/45">{detail}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-[0.78rem] font-semibold">{value}</span>
    </div>
  );
}

function BucketCard({
  name,
  bucket,
}: {
  name: string;
  bucket: GraphDiagnostic["coverage"]["effects"][keyof GraphDiagnostic["coverage"]["effects"]];
}) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white/30 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[0.72rem] font-semibold">affects.{name}</p>
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-[0.08em] ${
            bucket.complete
              ? "border-emerald-700/20 bg-emerald-600/10 text-emerald-900"
              : "border-amber-700/25 bg-amber-500/12 text-amber-950"
          }`}
        >
          {bucket.complete ? "полно" : "неполно"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.7rem] text-ink/62">
        <span>всего: {bucket.total}</span>
        <span>подтверждено: {bucket.confirmed}</span>
        <span>partial: {bucket.partial}</span>
        <span>unknown: {bucket.unknown}</span>
        <span className="col-span-2">не покрыто: {bucket.notCovered}</span>
      </div>
      {bucket.notCoveredIds.length > 0 ? (
        <p className="mt-2 break-words text-[0.66rem] text-ink/45">
          {bucket.notCoveredIds.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function SectionCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface px-5 py-5 sm:px-6">
      <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
        {title}
      </h2>
      {hint ? <p className="mt-1 text-[0.7rem] text-ink/45">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ParameterList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: { id: string; label: string }[];
  emptyText: string;
}) {
  return (
    <div>
      <p className="text-[0.72rem] font-semibold text-ink/78">
        {title}: {items.length}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-[0.7rem] text-ink/45">{emptyText}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.map((item) => (
            <li key={item.id} className="text-[0.72rem]">
              <Link
                href={`/admin/parameters?id=${encodeURIComponent(item.id)}`}
                className="link-line break-all text-copper"
              >
                {item.id}
              </Link>
              <span className="ml-2 text-ink/45">{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function AdminDiagnosticsPage() {
  let graph: GraphDiagnostic | null = null;
  let parameters: Awaited<ReturnType<typeof listParameters>> = [];
  let dataBoard: DataSourceBoard | null = null;
  let compositionBoard: CompositionBoard | null = null;
  let published: PricingVersion | undefined;
  let prices: PriceItem[] = [];
  let loadError: string | null = null;

  try {
    [graph, parameters, dataBoard, published, prices, compositionBoard] = await Promise.all([
      diagnoseGraph(),
      listParameters({}),
      getDataSources(),
      getPublishedVersion(),
      listPriceItems(),
      getCompositionBoard(),
    ]);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Неизвестная ошибка.";
  }

  const missingTariffs = published
    ? prices.filter(
        (item) =>
          item.usage === "used" &&
          !published!.snapshot.some((entry) => entry.priceItemId === item.id),
      )
    : [];
  const compositionIssues = moduleCoverageIssues();

  const [catalogRead, presetRead, priceRead, parameterRead] = await Promise.all([
    readCollectionStatus<unknown>("catalog-items.json"),
    readCollectionStatus<unknown>("module-presets.json"),
    readCollectionStatus<unknown>("price-items.json"),
    readCollectionStatus<unknown>("admin-parameters.json"),
  ]);
  const invalidCount = (
    read: { status: string; items?: unknown[] },
    schema: { safeParse: (value: unknown) => { success: boolean } },
  ): number =>
    read.status !== "ok" || !read.items
      ? 0
      : read.items.filter((item) => !schema.safeParse(item).success).length;
  const schemaIssues =
    invalidCount(catalogRead, catalogItemSchema) +
    invalidCount(presetRead, modulePresetSchema) +
    invalidCount(priceRead, priceItemSchema) +
    invalidCount(parameterRead, adminParameterSchema);

  const issues = graph ? collectDiagnosticIssues(graph) : [];
  const summary = summarizeIssues(issues);
  const { dead, preliminary } = splitParametersByStatus(parameters);
  const hasData = graph !== null && (graph.totals.rows > 0 || parameters.length > 0);

  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">10 / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          {ADMIN_SECTIONS[10].title}
        </h1>
        <p className="body-copy mt-3">
          Отчёт из фактического сервиса диагностики CA-T-206: целостность
          графа зависимостей, покрытие `affects.*` и формул, мёртвые и
          неподтверждённые параметры. Только чтение.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="chip chip-copper">Real data</span>
        <span className="chip">diagnoseGraph · CA-T-206</span>
        <span className="chip">read-only</span>
        {graph ? (
          <span className="chip">generatedAt: {graph.generatedAt}</span>
        ) : null}
      </div>

      {loadError ? (
        <section className="card-surface px-6 py-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-copper" size={20} />
            <div>
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
                Ошибка чтения
              </p>
              <h2 className="mt-2 text-lg font-semibold">
                Не удалось сформировать отчёт диагностики
              </h2>
              <p className="mt-2 break-words text-[0.78rem] text-ink/62">
                {loadError}
              </p>
              <Link href="/admin/diagnostics" className="btn btn-primary btn-sm mt-4">
                Повторить
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {!loadError && graph ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Статус графа"
              value={
                summary.status === "critical"
                  ? "critical"
                  : summary.status === "attention"
                    ? "attention"
                    : "ok"
              }
              hint={graph.coverage.complete ? "инвариант §6.8 п.6 выполнен" : "инвариант §6.8 п.6 не выполнен"}
            />
            <SummaryCard
              label="Связи"
              value={`${graph.totals.valid} / ${graph.totals.rows}`}
              hint="валидные / всего записей"
            />
            <SummaryCard
              label="Проблемы"
              value={`${summary.errors} / ${summary.warnings}`}
              hint="errors / warnings"
            />
            <SummaryCard
              label="Информационные"
              value={summary.infos}
              hint="excluded, PARTIAL, архивные источники"
            />
          </div>

          {!hasData ? (
            <section className="card-surface mt-4 px-6 py-8 text-center">
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
                Нет данных
              </p>
              <h2 className="font-display mt-3 text-2xl">
                Проверять пока нечего
              </h2>
              <p className="body-copy mx-auto mt-3 max-w-2xl text-sm">
                Коллекции параметров и зависимостей пусты. Импорт карты и
                создание параметров не входят в CA-T-506; отчёт не подменяется
                фиктивными данными.
              </p>
              <Link href="/admin" className="btn btn-glass btn-sm mt-6">
                Вернуться в обзор
              </Link>
            </section>
          ) : null}

          {hasData ? (
            <>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <SectionCard
                  title="Структурная целостность"
                  hint="схема CA-T-201, U-ключи, существование источников и целей"
                >
                  <CountRow
                    label="Невалидные записи"
                    value={graph.structural.invalid.length}
                  />
                  <CountRow
                    label="Дубли U-ключа"
                    value={graph.structural.duplicates.length}
                  />
                  <CountRow
                    label="Осиротевшие связи"
                    value={graph.structural.orphans.length}
                  />
                  <CountRow
                    label="Связи архивных источников"
                    value={graph.structural.archivedSources.length}
                    detail="сохраняются, не считаются осиротевшими"
                  />
                  <CountRow
                    label="Циклы"
                    value={graph.structural.cycles.length}
                    detail="структурно невозможны: рёбра «данные → расчёт»"
                  />
                  <div className="mt-2 flex items-center gap-2 text-[0.7rem] text-ink/55">
                    {graph.structural.invalid.length === 0 &&
                    graph.structural.duplicates.length === 0 &&
                    graph.structural.orphans.length === 0 ? (
                      <>
                        <CheckCircle2 size={14} className="text-emerald-700" />
                        Структурных ошибок нет.
                      </>
                    ) : (
                      <>
                        <ShieldAlert size={14} className="text-red-700" />
                        Есть структурные ошибки — см. список ниже.
                      </>
                    )}
                  </div>
                </SectionCard>

                <SectionCard
                  title="Покрытие формул"
                  hint="реестр §3 аудита; исключения перечислены явно"
                >
                  <CountRow
                    label="Основных формул"
                    value={graph.coverage.formulas.total}
                  />
                  <CountRow
                    label="Проверяемых"
                    value={graph.coverage.formulas.evaluable}
                  />
                  <CountRow
                    label="Подтверждено"
                    value={graph.coverage.formulas.confirmed}
                  />
                  <CountRow
                    label="PARTIAL"
                    value={graph.coverage.formulas.partial}
                  />
                  <CountRow
                    label="Без рёбер"
                    value={graph.coverage.formulas.uncovered.length}
                  />
                  <CountRow
                    label="Исключено"
                    value={graph.coverage.formulas.excluded.length}
                  />
                </SectionCard>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {EFFECT_KEYS.map((key) => (
                  <BucketCard
                    key={key}
                    name={coverageLabel(key)}
                    bucket={graph.coverage.effects[key]}
                  />
                ))}
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <SectionCard
                  title="Пробелы и источники"
                  hint="неподтверждённые и мёртвые позиции фактического графа"
                >
                  <CountRow
                    label="Параметры без зависимостей"
                    value={graph.coverage.paramsWithoutDependencies.length}
                  />
                  <CountRow
                    label="UNKNOWN-источники карты"
                    value={graph.coverage.unknownSources.length}
                  />
                  <CountRow
                    label="PARTIAL-рёбра"
                    value={graph.coverage.partialEdges.length}
                  />
                  <CountRow
                    label="Компоненты без рёбер"
                    value={graph.coverage.unconfirmedComponents.length}
                  />
                  <CountRow
                    label="Мёртвые источники"
                    value={graph.coverage.deadSources.length}
                  />
                </SectionCard>

                <SectionCard
                  title="Параметры по статусам"
                  hint="из существующего AdminParameter-сервиса (CA-T-203)"
                >
                  <ParameterList
                    title="dead"
                    items={dead.map((item) => ({
                      id: item.id,
                      label: `${item.group}/${item.scope}`,
                    }))}
                    emptyText="Нет параметров со статусом dead."
                  />
                  <div className="mt-4">
                    <ParameterList
                      title="preliminary"
                      items={preliminary.map((item) => ({
                        id: item.id,
                        label: `${item.group}/${item.scope}`,
                      }))}
                      emptyText="Нет параметров со статусом preliminary."
                    />
                  </div>
                </SectionCard>
              </div>

              <SectionCard
                title="Данные каталогов, цен и норм"
                hint="проверки реальных ссылок и статусов; отсутствие тарифа — проблема, а не 0 ₽"
              >
                <CountRow
                  label="Ссылки каталогов на отсутствующие PriceItem"
                  value={dataBoard?.counts.conflict ?? 0}
                  detail="catalogPriceLinkIssues"
                />
                <CountRow
                  label="Действующие ставки без значения в опубликованной версии"
                  value={missingTariffs.length}
                  detail={
                    published
                      ? `PricingVersion ${published.id}`
                      : "опубликованная версия отсутствует"
                  }
                />
                <CountRow
                  label="Элементы каталога preliminary"
                  value={dataBoard?.counts.preliminary ?? 0}
                  detail="не считаются подтверждёнными"
                />
                <CountRow
                  label="Preliminary-нормы Managed Rules"
                  value={dataBoard?.rows.filter((row) => row.kind === "rule" && row.state === "preliminary").length ?? 0}
                  detail="не публикуются до подтверждения"
                />
                <CountRow
                  label="Проблемы состава модулей"
                  value={compositionIssues.length}
                  detail="MODULE_COMPOSITION ↔ KITCHEN_MODULE_GROUPS"
                />
                <CountRow
                  label="Записи вне схемы / некорректные диапазоны"
                  value={schemaIssues}
                  detail="catalog-items, module-presets, price-items, admin-parameters"
                />
                <CountRow
                  label="Ошибки управляемого состава"
                  value={
                    (compositionBoard?.validation.draft ?? []).filter(
                      (issue) => issue.severity === "error",
                    ).length +
                    (compositionBoard?.validation.published ?? []).filter(
                      (issue) => issue.severity === "error",
                    ).length
                  }
                  detail="CompositionVersion draft/published"
                />
                {missingTariffs.length > 0 ? (
                  <p className="mt-2 break-words rounded-xl border border-red-700/20 bg-red-600/8 px-3 py-2 text-[0.7rem] text-red-900">
                    {missingTariffs.slice(0, 12).map((item) => item.id).join(", ")}
                    {missingTariffs.length > 12 ? " …" : ""}
                  </p>
                ) : (
                  <p className="mt-2 flex items-center gap-2 text-[0.72rem] text-emerald-900">
                    <CheckCircle2 size={14} /> Действующие ставки присутствуют в
                    опубликованной версии.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-3 text-[0.72rem]">
                  <Link href="/admin/data-sources" className="link-line text-copper">
                    Источники данных →
                  </Link>
                  <Link href="/admin/calculations" className="link-line text-copper">
                    Инспектор расчётов →
                  </Link>
                  <Link href="/admin/rules/diagnostics" className="link-line text-copper">
                    Диагностика правил →
                  </Link>
                </div>
              </SectionCard>

              <SectionCard
                title="Выявленные проблемы"
                hint="каждая строка — поле отчёта diagnoseGraph, без дополнительных проверок"
              >
                {issues.length === 0 ? (
                  <p className="flex items-center gap-2 text-[0.78rem] text-emerald-900">
                    <CheckCircle2 size={16} /> Проблем не выявлено.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {issues.map((issue) => (
                      <li
                        key={issue.id}
                        className="rounded-xl border border-ink/8 bg-white/30 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={issue.severity} />
                          <span className="text-[0.78rem] font-semibold text-ink/82">
                            {issue.title}
                          </span>
                          <span className="text-[0.62rem] uppercase tracking-[0.1em] text-ink/35">
                            {issue.area}
                          </span>
                        </div>
                        <p className="mt-1 break-words text-[0.72rem] leading-relaxed text-ink/58">
                          {issue.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <div className="mt-4 flex items-start gap-2 rounded-2xl border border-ink/10 bg-white/25 px-4 py-3 text-[0.72rem] leading-relaxed text-ink/55">
                <Info size={15} className="mt-0.5 shrink-0 text-copper" />
                <p>
                  Отчёт формируется при открытии страницы из действующих
                  коллекций; сохранение отчёта и автоматическое исправление
                  находок в CA-T-506 не реализованы (нет согласованного
                  хранилища/операции). Диагностика ничего не изменяет.
                </p>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
