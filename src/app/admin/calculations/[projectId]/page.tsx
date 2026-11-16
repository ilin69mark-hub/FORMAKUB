import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getInspectorProject,
  type InspectorProject,
} from "@/lib/admin/calculation-inspector";
import { listCompositionVersions } from "@/lib/admin/composition";
import { CompositionPinForm } from "@/components/admin/projects/CompositionPinForm";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  ok: "ok",
  legacy_no_snapshot: "legacy без снимка",
  snapshot_unknown: "снимок не найден",
  snapshot_corrupt: "снимок повреждён",
  snapshot_invalid: "снимок невалиден",
  rules_invalid: "ошибки правил",
  required_rules_missing: "нет обязательных норм",
  project_invalid: "проект невалиден",
};

function money(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function utc(value: string): string {
  if (value === "—") return value;
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "warn" | "error";
}) {
  const style =
    tone === "ok"
      ? "border-emerald-700/20 bg-emerald-600/10 text-emerald-900"
      : tone === "warn"
        ? "border-amber-700/25 bg-amber-500/12 text-amber-950"
        : tone === "error"
          ? "border-red-700/20 bg-red-600/10 text-red-900"
          : "border-ink/15 bg-ink/5 text-ink/65";
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.08em] ${style}`}
    >
      {children}
    </span>
  );
}

function Card({
  title,
  children,
  hint,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface px-5 py-5">
      <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
        {title}
      </h2>
      {hint ? <p className="mt-1 text-[0.7rem] text-ink/45">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function traceTone(
  status: InspectorProject["compositionTrace"]["status"],
): "ok" | "warn" | "error" | "neutral" {
  if (status === "computed") return "ok";
  if (status === "blocked") return "error";
  if (status === "unavailable") return "warn";
  return "neutral";
}

const TRACE_STATUS_LABELS: Record<
  InspectorProject["compositionTrace"]["status"],
  string
> = {
  computed: "trace построен",
  blocked: "trace заблокирован",
  absent: "trace не применяется",
  unavailable: "trace недоступен",
};

const LINE_STATUS_LABELS: Record<string, string> = {
  resolved: "resolved",
  excluded: "excluded",
  quantity_unresolved: "quantity_unresolved",
  price_unresolved: "price_unresolved",
  blocked: "blocked",
};

const CONDITION_LABELS: Record<string, string> = {
  true: "true",
  false: "false",
  not_evaluated: "не вычислено",
  error: "ошибка",
  not_required: "без условия",
};

/**
 * E2: CompositionTrace — независимая диагностика. Значения показываются
 * только те, что реально вычислены; отсутствующее количество/цена выводятся
 * как «—», а не как 0.
 */
function CompositionTraceCard({ data }: { data: InspectorProject }) {
  const view = data.compositionTrace;
  const trace = view.trace;
  return (
    <Card
      title="Composition Trace"
      hint="Независимая компонентная трассировка; итоги остаются от Engine"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={traceTone(view.status)}>
          {TRACE_STATUS_LABELS[view.status]}
        </Badge>
        <Badge>composition: {view.compositionVersionId ?? "—"}</Badge>
        {trace ? (
          <>
            <Badge>lines: {trace.lines.length}</Badge>
            <Badge>warnings: {trace.warnings.length}</Badge>
          </>
        ) : null}
      </div>

      {view.message ? (
        <p className="mt-2 text-[0.74rem] text-ink/62">{view.message}</p>
      ) : null}

      {trace ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.7rem]">
          <div className="flex justify-between gap-2">
            <dt className="text-ink/45">contentHash</dt>
            <dd className="font-mono text-[0.66rem]">{trace.compositionContentHash.slice(0, 12)}…</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink/45">rulesSnapshotId</dt>
            <dd className="font-mono text-[0.66rem]">{trace.rulesSnapshotId ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink/45">engine priceVersion</dt>
            <dd className="font-mono text-[0.66rem]">{trace.enginePriceVersionId}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink/45">pinned priceVersion</dt>
            <dd className="font-mono text-[0.66rem]">{trace.pinnedPriceVersionId ?? "—"}</dd>
          </div>
        </dl>
      ) : null}

      {view.issues.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[0.7rem]">
          {view.issues.map((item, index) => (
            <li
              key={`${item.code}-${item.lineId ?? index}`}
              className={item.severity === "error" ? "text-red-800" : "text-amber-900"}
            >
              <span className="font-mono text-[0.64rem]">{item.code}</span>
              {item.lineId ? ` · ${item.lineId}` : ""} — {item.message}
            </li>
          ))}
        </ul>
      ) : null}

      {trace && trace.lines.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[64rem] text-left text-[0.72rem]">
            <thead className="bg-white/25 text-[0.54rem] uppercase tracking-[0.12em] text-ink/42">
              <tr>
                <th className="px-3 py-2 font-semibold">Строка Composition</th>
                <th className="px-3 py-2 font-semibold">Условие</th>
                <th className="px-3 py-2 font-semibold">Количество</th>
                <th className="px-3 py-2 font-semibold">PriceItem / единица</th>
                <th className="px-3 py-2 font-semibold">amount</th>
                <th className="px-3 py-2 font-semibold">priceAmount</th>
                <th className="px-3 py-2 font-semibold">Статус</th>
              </tr>
            </thead>
            <tbody>
              {trace.lines.map((line) => (
                <tr key={line.lineId} className="border-t border-ink/7">
                  <td className="px-3 py-2">
                    <span className="font-mono text-[0.66rem]">{line.lineId}</span>
                    <span className="ml-1 text-[0.64rem] text-ink/45">· {line.moduleType}</span>
                  </td>
                  <td className="px-3 py-2 text-ink/62">
                    {CONDITION_LABELS[line.condition] ?? line.condition}
                  </td>
                  <td className="px-3 py-2 text-ink/70">
                    {line.quantity === null ? "—" : line.quantity}
                    {line.unit ? ` ${line.unit}` : ""}
                    <span className="ml-1 text-[0.62rem] text-ink/40">
                      ({line.quantitySource})
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[0.66rem] text-ink/60">
                    {line.priceItemId ?? "—"}
                    {line.priceItemUnit ? ` · ${line.priceItemUnit}` : " · единица неизвестна"}
                  </td>
                  <td className="px-3 py-2 text-ink/62">
                    {line.amount === null ? "—" : money(line.amount)}
                  </td>
                  <td className="px-3 py-2 font-semibold text-ink/75">
                    {line.priceAmount === null ? "—" : money(line.priceAmount)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      tone={
                        line.status === "resolved"
                          ? "ok"
                          : line.status === "blocked"
                            ? "error"
                            : "warn"
                      }
                    >
                      {LINE_STATUS_LABELS[line.status] ?? line.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[0.68rem] leading-relaxed text-ink/45">
            Сопоставление CompositionLine → CalculationLineId/поле Engine не
            подтверждено (О-1) и здесь не показывается как установленный факт.
            «—» означает отсутствие подтверждённого значения, а не 0.
            При наличии сохранённого снимка показывается он (без пересчёта);
            live-пересчёт выполняется только для записей без снимка.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function Data({ data }: { data: InspectorProject }) {
  const totalDelta =
    data.latestHistory?.delta === null || data.latestHistory?.delta === undefined
      ? null
      : data.latestHistory.delta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge tone={data.rules?.status === "ok" ? "ok" : "warn"}>
          rules: {STATUS_LABELS[data.rules?.status ?? "unavailable"] ?? data.rules?.status ?? "unavailable"}
        </Badge>
        <Badge tone={data.priceVersion ? "ok" : "error"}>
          price: {data.project.priceVersion}
        </Badge>
        {data.project.rulesSnapshotId ? (
          <Badge tone="ok">snapshot: {data.project.rulesSnapshotId}</Badge>
        ) : (
          <Badge tone="warn">snapshot отсутствует</Badge>
        )}
        <Badge>calc: {data.project.calcVersion}</Badge>
        <Badge>schema: {data.project.schemaVersion}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Сохранённая цена" hint="StoredProject.price (PriceBreakdown)">
          <p className="font-display text-3xl text-ink">
            {money(data.project.total)} <span className="text-base">{data.project.currency}</span>
          </p>
          {data.breakdown ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.72rem]">
              {[
                ["baseCost", data.breakdown.baseCost],
                ["bodyCost", data.breakdown.bodyCost],
                ["frontsCost", data.breakdown.frontsCost],
                ["fittingsCost", data.breakdown.fittingsCost],
                ["optionsCost", data.breakdown.optionsCost],
                ["discount", data.breakdown.discount],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-2">
                  <dt className="text-ink/45">{label}</dt>
                  <dd className="font-semibold">{money(Number(value))}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {data.breakdown?.promo ? (
            <p className="mt-2 text-[0.7rem] text-ink/55">
              Промокод {data.breakdown.promo.code}: {data.breakdown.promo.valid ? "применён" : "не применён"}
              {data.breakdown.promo.reason ? ` · ${data.breakdown.promo.reason}` : ""}
            </p>
          ) : null}
        </Card>

        <Card title="Версии и закрепления" hint="Не изменяются Inspector-ом">
          <dl className="space-y-2 text-[0.74rem]">
            <div>
              <dt className="text-ink/42">PricingVersion</dt>
              <dd className="font-mono">{data.project.priceVersion}</dd>
              {data.priceVersion ? (
                <dd className="mt-1 text-[0.68rem] text-ink/50">
                  {data.priceVersion.status} · seq {data.priceVersion.publishedSeq ?? "—"} ·{" "}
                  {data.priceVersion.snapshotItems ?? "—"} позиций снимка
                </dd>
              ) : (
                <dd className="mt-1 text-[0.68rem] text-red-800">
                  {data.priceVersionError ?? "Версия не найдена"}
                </dd>
              )}
            </div>
            <div>
              <dt className="text-ink/42">rulesSnapshotId</dt>
              <dd className="font-mono">{data.project.rulesSnapshotId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/42">compositionVersionId</dt>
              <dd className="font-mono">{data.project.compositionVersionId ?? "—"}</dd>
              {data.composition ? (
                <dd className="mt-1 text-[0.68rem] text-ink/50">
                  {data.composition.status} · rules{" "}
                  {data.composition.rulesSnapshotId ?? "—"} · production{" "}
                  {data.composition.production ?? "not_ready"}
                </dd>
              ) : data.compositionError ? (
                <dd className="mt-1 text-[0.68rem] text-red-800">
                  {data.compositionError}
                </dd>
              ) : null}
            </div>
            <div>
              <dt className="text-ink/42">calcVersion / schemaVersion</dt>
              <dd className="font-mono">
                {data.project.calcVersion} · {data.project.schemaVersion}
              </dd>
            </div>
            <div>
              <dt className="text-ink/42">priceHistory</dt>
              <dd>
                {data.project.historyCount} событий
                {data.latestHistory ? ` · последнее ${utc(data.latestHistory.computedAt)}` : ""}
              </dd>
              {totalDelta !== null ? (
                <dd className="mt-1 text-[0.68rem] text-ink/50">
                  delta последнего расчёта: {money(totalDelta)} ₽
                </dd>
              ) : null}
            </div>
          </dl>
        </Card>

        <Card title="Диагностика" hint="Существующие проверки, без мутаций">
          {data.issues.length === 0 ? (
            <p className="text-[0.76rem] text-emerald-900">Проблем не обнаружено.</p>
          ) : (
            <ul className="list-disc space-y-1.5 pl-4 text-[0.74rem] text-ink/65">
              {data.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {data.rulesError ? (
            <p className="mt-2 text-[0.72rem] text-red-800">{data.rulesError}</p>
          ) : null}
          <Link
            href={`/admin/rules/diagnostics/${encodeURIComponent(data.project.id)}`}
            className="link-line mt-3 text-copper"
          >
            Диагностика правил проекта →
          </Link>
        </Card>
      </div>

      <CompositionTraceCard data={data} />

      <Card
        title="Состав проекта"
        hint="StoredProject.config — сохранённая конфигурация; Inspector не меняет геометрию"
      >
        {data.modules.length === 0 ? (
          <p className="text-[0.76rem] text-ink/50">
            Состав не восстановлен из config (тип проекта неизвестен).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-[0.74rem]">
              <thead className="bg-white/25 text-[0.56rem] uppercase tracking-[0.12em] text-ink/42">
                <tr>
                  <th className="px-4 py-2 font-semibold">Элемент</th>
                  <th className="px-3 py-2 font-semibold">Тип</th>
                  <th className="px-3 py-2 font-semibold">Ш × В × Г, см</th>
                  <th className="px-3 py-2 font-semibold">Полки / ящики</th>
                  <th className="px-3 py-2 font-semibold">Детали</th>
                  <th className="px-3 py-2 font-semibold">Состав</th>
                </tr>
              </thead>
              <tbody>
                {data.modules.map((module) => (
                  <tr key={module.id} className="border-t border-ink/7">
                    <td className="px-4 py-2 font-medium">{module.label}</td>
                    <td className="px-3 py-2 font-mono text-[0.66rem] text-ink/55">{module.type}</td>
                    <td className="px-3 py-2 text-ink/62">
                      {module.width} × {module.height} × {module.depth}
                    </td>
                    <td className="px-3 py-2 text-ink/62">
                      {module.shelves ?? "—"} / {module.drawers ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-ink/55">{module.detail || "—"}</td>
                    <td className="px-3 py-2">
                      {module.compositionHref ? (
                        <Link href={module.compositionHref} className="link-line text-copper">
                          Открыть →
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Строки расчёта"
        hint={
          data.latestHistory
            ? "Последний сохранённый CalculationBreakdown (priceHistory)"
            : "Доступен только PriceBreakdown без идентификаторов строк"
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-left text-[0.74rem]">
            <thead className="bg-white/25 text-[0.56rem] uppercase tracking-[0.12em] text-ink/42">
              <tr>
                <th className="px-4 py-2 font-semibold">Строка</th>
                <th className="px-3 py-2 font-semibold">ID</th>
                <th className="px-3 py-2 font-semibold">Сумма</th>
                <th className="px-3 py-2 font-semibold">Ед.</th>
                <th className="px-3 py-2 font-semibold">Метаданные / detail</th>
                <th className="px-3 py-2 font-semibold">Источник количества</th>
                <th className="px-3 py-2 font-semibold">Правило</th>
                <th className="px-3 py-2 font-semibold">Источник цены</th>
                <th className="px-3 py-2 font-semibold">Трассировка</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, index) => (
                <tr key={`${line.id ?? "line"}-${index}`} className="border-t border-ink/7 align-top">
                  <td className="px-4 py-2 font-medium">{line.label}</td>
                  <td className="px-3 py-2 font-mono text-[0.64rem] text-ink/55">
                    {line.id ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-semibold">{money(line.amount)} ₽</td>
                  <td className="px-3 py-2 text-ink/45">— не сохранено</td>
                  <td className="px-3 py-2 text-ink/55">{line.detail ?? "—"}</td>
                  <td className="px-3 py-2 text-ink/45">— не сохранено</td>
                  <td className="px-3 py-2">
                    {line.appliedRuleIds.length === 0 ? (
                      <span className="text-ink/40">не зафиксировано</span>
                    ) : (
                      <ul className="space-y-0.5 font-mono text-[0.62rem]">
                        {line.appliedRuleIds.map((id) => (
                          <li key={id}>{id}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink/55">
                    PriceSnapshot {data.project.priceVersion};
                    <br />
                    цена компонента не сохранена
                  </td>
                  <td className="px-3 py-2 text-[0.66rem] text-amber-900">
                    {line.traceable ? "частичная" : "нет"}
                    <p className="mt-1 text-ink/45">{line.traceGap}</p>
                  </td>
                </tr>
              ))}
              {data.lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-ink/50">
                    Строки расчёта отсутствуют.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-3 rounded-xl border border-amber-700/20 bg-amber-500/8 px-4 py-3 text-[0.72rem] leading-relaxed text-amber-950">
          {data.traceability.note}
        </p>
      </Card>

      {data.rules ? (
        <Card
          title="Правила и снимок"
          hint="Статическая связь assigns=line:<id>; правила не редактируются в Inspector-е"
        >
          <dl className="grid gap-2 text-[0.74rem] sm:grid-cols-2">
            <div>
              <dt className="text-ink/42">Статус</dt>
              <dd>
                {STATUS_LABELS[data.rules.status] ?? data.rules.status}: {data.rules.reason}
              </dd>
            </div>
            <div>
              <dt className="text-ink/42">Снимки</dt>
              <dd className="font-mono">
                pinned={data.rules.pinnedSnapshotId ?? "—"} · active=
                {data.rules.activeSnapshotId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-ink/42">Применённых правил</dt>
              <dd>{data.rules.appliedRules.length}</dd>
            </div>
            <div>
              <dt className="text-ink/42">Отсутствующих обязательных норм</dt>
              <dd>{data.rules.missingRequiredRuleIds.length}</dd>
            </div>
          </dl>
          {data.rules.appliedRules.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[48rem] text-left text-[0.72rem]">
                <thead className="bg-white/25 text-[0.54rem] uppercase tracking-[0.12em] text-ink/42">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Правило</th>
                    <th className="px-3 py-2 font-semibold">Назначение</th>
                    <th className="px-3 py-2 font-semibold">Строки</th>
                    <th className="px-3 py-2 font-semibold">Источник</th>
                    <th className="px-3 py-2 font-semibold">Версия</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rules.appliedRules.map((rule) => (
                    <tr key={rule.id} className="border-t border-ink/7">
                      <td className="px-3 py-2">
                        <p className="font-medium">{rule.name}</p>
                        <p className="font-mono text-[0.6rem] text-ink/45">{rule.id}</p>
                      </td>
                      <td className="px-3 py-2 font-mono text-[0.64rem]">{rule.assigns}</td>
                      <td className="px-3 py-2 font-mono text-[0.64rem]">
                        {rule.lineIds.join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2 text-ink/55">{rule.source}</td>
                      <td className="px-3 py-2 text-ink/55">{rule.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-[0.74rem] text-ink/50">
              Применённые правила не зафиксированы (legacy-проект или снимок не
              разрешён).
            </p>
          )}
        </Card>
      ) : null}
    </div>
  );
}

export default async function CalculationInspectorPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const result = await getInspectorProject(projectId);
  if (!result.ok) notFound();
  const versions = (await listCompositionVersions()).filter(
    (version) => version.status === "published",
  );

  return (
    <main className="space-y-4">
      <header className="space-y-2">
        <Link href="/admin/calculations" className="link-line text-copper">
          ← Инспектор расчётов
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Проект → модули → строки → правила → цена</p>
            <h1 className="font-display mt-2 text-3xl leading-tight">
              {result.data.project.title}
            </h1>
            <p className="mt-1 break-all font-mono text-[0.7rem] text-ink/45">
              {result.data.project.id}
            </p>
          </div>
          <div className="text-right text-[0.7rem] text-ink/45">
            <p>создан {utc(result.data.project.createdAt)}</p>
            <p>обновлён {utc(result.data.project.updatedAt)}</p>
          </div>
        </div>
      </header>
      <section className="card-surface px-5 py-5">
        <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
          Закреплённый состав модулей
        </h2>
        <div className="mt-3">
          <CompositionPinForm
            projectId={result.data.project.id}
            currentVersionId={result.data.project.compositionVersionId}
            expectedUpdatedAt={result.data.project.updatedAt}
            supported={result.data.project.kind === "kitchen"}
            projectRulesSnapshotId={result.data.project.rulesSnapshotId}
            versions={versions.map((version) => ({
              id: version.id,
              publishedSeq: version.publishedSeq ?? null,
              publishedAt: version.publishedAt ?? null,
              lines: version.lines.length,
              rulesSnapshotId: version.rulesSnapshotId ?? null,
            }))}
          />
        </div>
        <p className="mt-3 text-[0.68rem] text-ink/45">
          Inspector не пересчитывает проект. Если состав закреплён, следующий
          пересчёт выполнит preflight-проверку состава; формулы и суммы Engine
          не меняются.
        </p>
      </section>
      <Data data={result.data} />
    </main>
  );
}
