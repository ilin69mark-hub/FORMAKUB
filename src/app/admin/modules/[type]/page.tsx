import Link from "next/link";
import { notFound } from "next/navigation";

import {
  WARDROBE_MODEL,
  getModuleComposition,
  type ModuleComponent,
} from "@/lib/admin/catalog-model";
import { listManagedRules, type ManagedRule } from "@/lib/admin/managed-rules";
import { listModulePresets } from "@/lib/admin/presets";
import {
  getCompositionBoard,
  getCompositionOptions,
} from "@/lib/admin/composition-board";
import { CompositionActions } from "@/components/admin/modules/CompositionActions";
import { CompositionEditor } from "@/components/admin/modules/CompositionEditor";
import { CompositionProductionActions } from "@/components/admin/modules/CompositionProductionActions";
import type {
  CompositionIssue,
  CompositionLine,
  CompositionModuleType,
  CompositionVersion,
} from "@/lib/admin/composition-schema";

export const dynamic = "force-dynamic";

const RELATION_LABELS: Record<ModuleComponent["relation"], string> = {
  required: "обязательный",
  conditional: "условный",
  optional: "опциональный",
  alternative: "альтернативный",
};

const RELATION_STYLE: Record<ModuleComponent["relation"], string> = {
  required: "border-emerald-700/20 bg-emerald-600/10 text-emerald-900",
  conditional: "border-amber-700/25 bg-amber-500/12 text-amber-950",
  optional: "border-ink/15 bg-ink/5 text-ink/65",
  alternative: "border-sky-700/20 bg-sky-600/10 text-sky-950",
};

function RuleList({ rules }: { rules: ManagedRule[] }) {
  if (rules.length === 0) {
    return (
      <p className="text-[0.74rem] text-ink/50">
        Прямых Managed Rules с условием `moduleType` для этого типа нет.
        Нормы проекта — в разделе «Правила комплектации».
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {rules.map((rule) => (
        <li key={rule.id} className="rounded-xl border border-ink/8 bg-white/30 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.72rem] font-semibold">{rule.name}</p>
            <span className="font-mono text-[0.58rem] text-ink/40">{rule.status}</span>
          </div>
          <p className="mt-0.5 break-all font-mono text-[0.62rem] text-ink/45">{rule.id}</p>
          <p className="mt-1 text-[0.66rem] text-ink/55">
            assigns: {rule.assigns} · source: {rule.source} · v{rule.version}
          </p>
        </li>
      ))}
    </ul>
  );
}

function ruleMatchesModule(rule: ManagedRule, type: string): boolean {
  const text = JSON.stringify(rule.condition);
  return text.includes(`"subject":"moduleType"`) && text.includes(`"value":"${type}"`);
}

function ruleMatchesPriceItems(rule: ManagedRule, ids: readonly string[]): boolean {
  return rule.assigns.startsWith("priceItem:")
    ? ids.includes(rule.assigns.slice("priceItem:".length))
    : false;
}

function moduleIssues(
  issues: readonly CompositionIssue[],
  version: CompositionVersion | null,
  moduleType: string,
): CompositionIssue[] {
  const ids = new Set(
    version?.lines
      .filter((line) => line.moduleType === moduleType)
      .map((line) => line.id) ?? [],
  );
  return issues.filter(
    (issue) =>
      (issue.lineId !== undefined && ids.has(issue.lineId)) ||
      issue.entityId === moduleType,
  );
}

function CompositionLineTable({ lines }: { lines: CompositionLine[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-left text-[0.72rem]">
        <thead className="bg-white/25 text-[0.52rem] uppercase tracking-[0.1em] text-ink/42">
          <tr>
            <th className="px-3 py-2 font-semibold">Компонент</th>
            <th className="px-3 py-2 font-semibold">Связь</th>
            <th className="px-3 py-2 font-semibold">Тариф</th>
            <th className="px-3 py-2 font-semibold">Количество</th>
            <th className="px-3 py-2 font-semibold">Условие</th>
            <th className="px-3 py-2 font-semibold">Источник</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-t border-ink/7 align-top">
              <td className="px-3 py-2">
                <p className="font-medium">{line.notes ?? line.id}</p>
                <p className="font-mono text-[0.6rem] text-ink/45">
                  {line.componentCatalog ?? "—"}
                  {line.componentId ? `:${line.componentId}` : " (слот)"}
                </p>
              </td>
              <td className="px-3 py-2">{line.relation}{line.alternativeGroup ? ` / ${line.alternativeGroup}` : ""}</td>
              <td className="px-3 py-2 font-mono text-[0.62rem]">
                {line.priceItemId ?? "из каталога/конфига"}
              </td>
              <td className="px-3 py-2 text-ink/60">
                {line.quantityRef.kind === "fixed"
                  ? `${line.quantityRef.value} ${line.quantityRef.unit}`
                  : line.quantityRef.kind === "managed_rule"
                    ? `rule:${line.quantityRef.ruleId}`
                    : `code:${line.quantityRef.implementationId}`}
              </td>
              <td className="px-3 py-2 text-ink/60">
                {line.condition?.kind === "text"
                  ? line.condition.text
                  : line.condition
                    ? `${line.condition.kind}:${"ruleId" in line.condition ? line.condition.ruleId : line.condition.implementationId}`
                    : "—"}
              </td>
              <td className="px-3 py-2 text-ink/55">
                {line.source} · {line.sourceRef}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ModuleDetailPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (type === "wardrobe") {
    return <WardrobeCard />;
  }

  const composition = getModuleComposition(type);
  if (!composition) notFound();

  const [presets, rules, board, options] = await Promise.all([
    listModulePresets(),
    listManagedRules(),
    getCompositionBoard(),
    getCompositionOptions(),
  ]);
  const preset = presets.find(
    (item) => item.family === "kitchen" && item.id === composition.type,
  );
  const priceItemIds = [...new Set(composition.components.flatMap((item) => item.priceItemIds))];
  const related = rules.filter(
    (rule) => ruleMatchesModule(rule, composition.type) || ruleMatchesPriceItems(rule, priceItemIds),
  );
  const versionForDisplay = board.draft ?? board.published;
  const moduleLines = (versionForDisplay?.lines ?? []).filter(
    (line) => line.moduleType === composition.type,
  );
  const draftIssues = moduleIssues(
    [...board.validation.draft],
    board.draft,
    composition.type,
  );
  const publishedIssues = moduleIssues(
    [...board.validation.published],
    board.published,
    composition.type,
  );

  return (
    <main className="space-y-4">
      <header className="space-y-2">
        <Link href="/admin/modules" className="link-line text-copper">
          ← Мебельные модули
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Модуль кухни</p>
            <h1 className="font-display mt-2 text-3xl leading-tight">
              {composition.label}
            </h1>
            <p className="mt-1 font-mono text-[0.7rem] text-ink/45">
              kitchen:{composition.type} · зона {composition.zone}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="chip chip-copper">состав CONFIRMED</span>
            <span className="chip">{composition.components.length} компонентов</span>
          </div>
        </div>
      </header>

      <section className="card-surface px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
              Управляемый состав модуля
            </h2>
            <p className="mt-1 text-[0.68rem] leading-relaxed text-ink/45">
              Draft редактируется; published неизменяем. Нормы и условия не
              вычисляются в админке.
            </p>
          </div>
          <CompositionActions
            hasDraft={Boolean(board.draft)}
            hasAnyVersion={board.versions.length > 0}
            publishedId={board.published?.id ?? null}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="chip">published: {board.published?.id ?? "нет"}</span>
          <span className="chip">draft: {board.draft?.id ?? "нет"}</span>
          <span className="chip">строк модуля: {moduleLines.length}</span>
          <span className="chip">
            ошибок: {draftIssues.filter((issue) => issue.severity === "error").length}
          </span>
        </div>
        {board.issues.length > 0 ? (
          <p className="mt-3 rounded-xl border border-red-700/20 bg-red-600/8 px-4 py-2 text-[0.72rem] text-red-900">
            {board.issues.join("; ")}
          </p>
        ) : null}
        {board.draft?.migration?.skipped.length ? (
          <div className="mt-3 rounded-xl border border-amber-700/20 bg-amber-500/8 px-4 py-2 text-[0.7rem] text-amber-950">
            <p className="font-semibold">Не мигрировано (сохранено в migration report):</p>
            <ul className="mt-1 list-disc pl-4">
              {board.draft.migration.skipped.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {(draftIssues.length > 0 || publishedIssues.length > 0) &&
        !board.draft ? (
          <ul className="mt-3 space-y-1 rounded-xl border border-amber-700/20 bg-amber-500/8 px-4 py-3 text-[0.7rem]">
            {[...publishedIssues].map((issue, index) => (
              <li key={`${issue.code}-${index}`} className={issue.severity === "error" ? "text-red-900" : "text-amber-900"}>
                {issue.severity} · {issue.message}
              </li>
            ))}
          </ul>
        ) : null}

        {board.published ? (
          <div className="mt-3 space-y-2">
            <p className="text-[0.68rem] text-ink/45">
              published seq {board.published.publishedSeq ?? "—"} · строк{" "}
              {board.published.lines.length} · hash{" "}
              {board.published.contentHash.slice(0, 12)}…
              {board.published.rulesSnapshotId
                ? ` · rules ${board.published.rulesSnapshotId}`
                : ""}
              {board.published.pins?.priceVersionId
                ? ` · price ${board.published.pins.priceVersionId}`
                : ""}
            </p>
            <CompositionProductionActions
              versionId={board.published.id}
              expectedVersion={board.published.version}
              status={board.published.production?.status ?? "missing"}
              approvedBy={board.published.production?.approvedBy ?? null}
            />
          </div>
        ) : null}

        {board.draft ? (
          <CompositionEditor
            moduleType={composition.type as CompositionModuleType}
            moduleLabel={composition.label}
            draft={board.draft}
            initialIssues={draftIssues}
            catalogs={options.catalogs.map((item) => ({
              id: item.id,
              catalog: item.catalog,
              label: item.label,
              status: item.status,
            }))}
            prices={options.prices.map((item) => ({
              id: item.id,
              label: item.label,
              unit: item.unit,
              status: item.status,
              usage: item.usage,
            }))}
            rules={options.rules.map((item) => ({
              id: item.id,
              name: item.name,
              status: item.status,
              source: item.source,
              scope: item.scope,
              version: item.version,
            }))}
          />
        ) : board.published ? (
          <div className="mt-4">
            <CompositionLineTable lines={moduleLines} />
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-700/20 bg-amber-500/8 px-4 py-3 text-[0.72rem] leading-relaxed text-amber-950">
            Управляемой версии состава нет. Ниже показан статический
            read-model `MODULE_COMPOSITION` как справка; он не является
            источником истины и не участвует в расчёте. Для управления
            импортируйте начальный draft.
          </div>
        )}

        {board.versions.length > 0 ? (
          <div className="mt-5 border-t border-ink/8 pt-4">
            <h3 className="text-[0.64rem] font-bold uppercase tracking-[0.12em] text-ink/45">
              История версий состава
            </h3>
            <ul className="mt-2 space-y-1 text-[0.68rem]">
              {board.versions.map((version) => (
                <li key={version.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono">{version.id}</span>
                  <span className="text-ink/45">
                    {version.status} · v{version.version} · строк {version.lines.length}
                    {version.publishedSeq ? ` · seq ${version.publishedSeq}` : ""}
                    {version.publishedAt ? ` · ${version.publishedAt.slice(0, 16).replace("T", " ")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card-surface px-5 py-5">
          <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
            Размеры, ограничения и параметры
          </h2>
          {preset ? (
            <dl className="mt-3 grid gap-2 text-[0.74rem] sm:grid-cols-2">
              {[
                ["Ширина, см", `${preset.width.min}–${preset.width.max} (по умолчанию ${preset.width.default})`],
                ["Высота, см", `${preset.height.min}–${preset.height.max} (по умолчанию ${preset.height.default})`],
                ["Глубина, см", `${preset.depth.min}–${preset.depth.max} (по умолчанию ${preset.depth.default})`],
                ["Полки по умолчанию", String(preset.defaultShelves)],
                ["Ящики по умолчанию", String(preset.defaultDrawers)],
                ["priceRef", preset.priceRef],
                ["Версия пресета", preset.version],
                ["Статус", preset.status],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-ink/8 bg-white/30 px-3 py-2">
                  <dt className="text-[0.58rem] font-bold uppercase tracking-[0.12em] text-ink/42">
                    {label}
                  </dt>
                  <dd className="mt-0.5 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-[0.76rem] text-amber-900">
              ModulePreset для типа «{composition.type}» отсутствует. Диапазоны из
              кода не подставляются как административные данные; создание пресета
              не входит в текущие операции.
            </p>
          )}
          <p className="mt-3 text-[0.68rem] leading-relaxed text-ink/45">
            Источник диапазонов — ModulePreset. Состав и количества — код
            `engine.ts`; формулы в интерфейс не переносятся.
          </p>
        </div>

        <div className="card-surface px-5 py-5">
          <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
            Связанные правила
          </h2>
          <div className="mt-3">
            <RuleList rules={related} />
          </div>
          <Link href="/admin/rules" className="link-line mt-3 inline-flex text-copper">
            Все правила комплектации →
          </Link>
        </div>
      </section>

      {!board.published && !board.draft ? (
      <section className="card-surface overflow-hidden">
        <div className="border-b border-ink/8 px-5 py-4">
          <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
            Статический read-model (справка)
          </h2>
          <p className="mt-1 text-[0.68rem] text-ink/45">
            Тип связи, условие, источник количества и тарифы. Суммы не
            рассчитываются в админке.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[68rem] text-left text-[0.74rem]">
            <thead className="bg-white/25 text-[0.56rem] uppercase tracking-[0.12em] text-ink/42">
              <tr>
                <th className="px-5 py-3 font-semibold">Компонент</th>
                <th className="px-4 py-3 font-semibold">Тип связи</th>
                <th className="px-4 py-3 font-semibold">Условие</th>
                <th className="px-4 py-3 font-semibold">Количество / единица</th>
                <th className="px-4 py-3 font-semibold">Тариф (PriceItem)</th>
                <th className="px-4 py-3 font-semibold">Каталог</th>
                <th className="px-4 py-3 font-semibold">Реализация</th>
              </tr>
            </thead>
            <tbody>
              {composition.components.map((component) => (
                <tr key={component.id} className="border-t border-ink/7 align-top">
                  <td className="px-5 py-3">
                    <p className="font-medium">{component.label}</p>
                    <p className="mt-0.5 font-mono text-[0.62rem] text-ink/40">
                      {component.id}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.56rem] font-bold uppercase tracking-[0.08em] ${RELATION_STYLE[component.relation]}`}
                    >
                      {RELATION_LABELS[component.relation]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink/58">{component.condition ?? "—"}</td>
                  <td className="px-4 py-3 text-ink/58">
                    {component.quantitySource}
                    <p className="mt-0.5 text-[0.64rem] text-ink/40">
                      ед.: {component.unit}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {component.priceItemIds.length === 0 ? (
                      component.priceReference ? (
                        <span className="break-all font-mono text-[0.62rem] text-ink/55">
                          {component.priceReference}
                        </span>
                      ) : (
                        <span className="text-ink/40">не тарифицируется отдельно</span>
                      )
                    ) : (
                      <ul className="space-y-0.5">
                        {component.priceItemIds.map((id) => (
                          <li key={id}>
                            <Link
                              href={`/admin/prices?q=${encodeURIComponent(id)}`}
                              className="break-all font-mono text-[0.62rem] text-copper underline decoration-copper/30 underline-offset-2"
                            >
                              {id}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[0.68rem] text-ink/55">
                    {component.catalog ? (
                      <Link
                        href={`/admin/catalogs?catalog=${component.catalog.kind}${
                          component.catalog.id ? `&id=${encodeURIComponent(component.catalog.id)}` : ""
                        }`}
                        className="link-line text-copper"
                      >
                        {component.catalog.kind}
                        {component.catalog.id ? `:${component.catalog.id}` : ""}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 break-all font-mono text-[0.6rem] text-ink/40">
                    {component.evidence}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}
    </main>
  );
}

function WardrobeCard() {
  return (
    <main className="space-y-4">
      <header className="space-y-2">
        <Link href="/admin/modules" className="link-line text-copper">
          ← Мебельные модули
        </Link>
        <p className="eyebrow">Конфигурация шкафа</p>
        <h1 className="font-display mt-2 text-3xl leading-tight">Шкаф</h1>
        <p className="mt-1 max-w-3xl text-[0.8rem] leading-relaxed text-ink/60">
          {WARDROBE_MODEL.note}
        </p>
        <span className="chip chip-copper">CONFIRMED · не модульная система</span>
      </header>

      <section className="card-surface px-5 py-5">
        <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
          Элементы конфигурации
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[58rem] text-left text-[0.74rem]">
            <thead className="bg-white/25 text-[0.56rem] uppercase tracking-[0.12em] text-ink/42">
              <tr>
                <th className="px-4 py-3 font-semibold">Элемент</th>
                <th className="px-4 py-3 font-semibold">Связь</th>
                <th className="px-4 py-3 font-semibold">Описание</th>
                <th className="px-4 py-3 font-semibold">Тарифы</th>
                <th className="px-4 py-3 font-semibold">Реализация</th>
              </tr>
            </thead>
            <tbody>
              {WARDROBE_MODEL.elements.map((element) => (
                <tr key={element.id} className="border-t border-ink/7 align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium">{element.label}</p>
                    <p className="font-mono text-[0.62rem] text-ink/40">{element.id}</p>
                  </td>
                  <td className="px-4 py-3 text-ink/58">{element.relation}</td>
                  <td className="px-4 py-3 text-ink/58">{element.detail}</td>
                  <td className="px-4 py-3">
                    {element.priceItemIds.length === 0 ? (
                      element.priceReference ? (
                        <span className="break-all font-mono text-[0.62rem] text-ink/55">
                          {element.priceReference}
                        </span>
                      ) : (
                        <span className="text-ink/40">—</span>
                      )
                    ) : (
                      <ul className="space-y-0.5">
                        {element.priceItemIds.map((id) => (
                          <li key={id}>
                            <Link
                              href={`/admin/prices?q=${encodeURIComponent(id)}`}
                              className="break-all font-mono text-[0.62rem] text-copper underline decoration-copper/30 underline-offset-2"
                            >
                              {id}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3 break-all font-mono text-[0.6rem] text-ink/40">
                    {element.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[0.72rem] leading-relaxed text-ink/55">
          Нормы петель и плотности фасадов шкафа хранятся в Managed Rules
          (`rule-wardrobe-hinge-band-*`, `rule-wardrobe-facade-density-*`) и
          обязательны для расчёта (fail-closed).
        </p>
        <Link href="/admin/rules" className="link-line mt-3 inline-flex text-copper">
          Открыть правила комплектации →
        </Link>
      </section>
    </main>
  );
}
