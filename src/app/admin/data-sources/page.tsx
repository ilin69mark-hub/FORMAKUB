import type { Metadata } from "next";
import Link from "next/link";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import {
  getDataSources,
  type DataSourceRow,
  type DataSourceState,
} from "@/lib/admin/data-sources";

import { sectionMetadata } from "../_components/section-route";

export const metadata: Metadata = sectionMetadata("dataSources");
export const dynamic = "force-dynamic";

const STATE_LABELS: Record<DataSourceState, string> = {
  confirmed: "подтверждено",
  preliminary: "предварительно",
  legacy: "legacy",
  missing: "источник не установлен",
  conflict: "конфликт",
};

const STATE_STYLE: Record<DataSourceState, string> = {
  confirmed: "border-emerald-700/20 bg-emerald-600/10 text-emerald-900",
  preliminary: "border-amber-700/25 bg-amber-500/12 text-amber-950",
  legacy: "border-ink/15 bg-ink/5 text-ink/65",
  missing: "border-red-700/20 bg-red-600/10 text-red-900",
  conflict: "border-red-700/30 bg-red-600/15 text-red-950",
};

const KIND_LABELS: Record<DataSourceRow["kind"], string> = {
  parameter: "Параметр",
  catalogItem: "Элемент каталога",
  priceItem: "Тариф",
  rule: "Правило",
  pricingVersion: "Версия прайса",
  projectPin: "Закрепление проекта",
};

const STATE_ORDER: readonly DataSourceState[] = [
  "conflict",
  "missing",
  "preliminary",
  "legacy",
  "confirmed",
];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function DataSourcesPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const state = STATE_ORDER.find((candidate) => candidate === single(raw.state));
  const kind = Object.keys(KIND_LABELS).find(
    (candidate) => candidate === single(raw.kind),
  ) as DataSourceRow["kind"] | undefined;
  const query = (single(raw.q) ?? "").trim().toLowerCase();

  const board = await getDataSources();
  const rows = board.rows.filter(
    (row) =>
      (state === undefined || row.state === state) &&
      (kind === undefined || row.kind === kind) &&
      (query.length === 0 ||
        row.entityId.toLowerCase().includes(query) ||
        row.label.toLowerCase().includes(query) ||
        (row.sourceRef ?? "").toLowerCase().includes(query)),
  );

  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">{ADMIN_SECTIONS.find((s) => s.id === "dataSources")?.index} / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          {ADMIN_SECTIONS.find((s) => s.id === "dataSources")?.title}
        </h1>
        <p className="body-copy mt-3">
          Происхождение параметров, норм и цен. Подтверждённые, предварительные,
          legacy и отсутствующие источники показаны раздельно; значения не
          подставляются.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <span className="chip chip-copper">read-only</span>
        {STATE_ORDER.map((candidate) => (
          <Link
            key={candidate}
            href={`/admin/data-sources?state=${candidate}`}
            className={`chip ${state === candidate ? "chip-copper" : ""}`}
          >
            {STATE_LABELS[candidate]}: {board.counts[candidate]}
          </Link>
        ))}
      </div>

      {board.issues.length > 0 ? (
        <section className="mb-4 rounded-2xl border border-red-700/20 bg-red-600/8 px-5 py-4 text-[0.78rem] text-red-900">
          <p className="font-semibold">Проблемы ссылок «каталог → тариф»</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {board.issues.slice(0, 10).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          {board.issues.length > 10 ? (
            <p className="mt-2 text-[0.7rem]">
              Показано 10 из {board.issues.length}.
            </p>
          ) : null}
        </section>
      ) : null}

      <form
        method="get"
        action="/admin/data-sources"
        className="card-surface grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
      >
        <label className="field">
          <span className="field-label">Поиск по id / названию / источнику</span>
          <input
            type="search"
            name="q"
            defaultValue={single(raw.q) ?? ""}
            placeholder="kitchen.hinge…"
            className="input"
          />
        </label>
        <label className="field">
          <span className="field-label">Тип</span>
          <select name="kind" defaultValue={kind ?? ""} className="select">
            <option value="">Все</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Состояние</span>
          <select name="state" defaultValue={state ?? ""} className="select">
            <option value="">Все</option>
            {STATE_ORDER.map((value) => (
              <option key={value} value={value}>
                {STATE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary btn-sm">
          Применить
        </button>
      </form>

      <p className="mt-3 text-[0.7rem] text-ink/45">
        Показано {rows.length} из {board.rows.length}. Источник не придумывается:
        `CatalogItem` не хранит `sourceRef`, поэтому для него состояние
        «источник не установлен».
      </p>

      <section className="card-surface mt-3 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[68rem] text-left text-[0.74rem]">
            <thead className="bg-white/25 text-[0.58rem] uppercase tracking-[0.12em] text-ink/42">
              <tr>
                <th className="px-5 py-3 font-semibold">Сущность</th>
                <th className="px-4 py-3 font-semibold">Тип</th>
                <th className="px-4 py-3 font-semibold">Источник</th>
                <th className="px-4 py-3 font-semibold">Состояние</th>
                <th className="px-4 py-3 font-semibold">Версия / статус</th>
                <th className="px-4 py-3 font-semibold">Влияние</th>
                <th className="px-4 py-3 font-semibold">Примечание</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-ink/7 align-top">
                  <td className="px-5 py-3">
                    {row.href ? (
                      <Link
                        href={row.href}
                        className="font-semibold text-ink/85 underline decoration-ink/20 underline-offset-2 hover:decoration-copper"
                      >
                        {row.label}
                      </Link>
                    ) : (
                      <span className="font-semibold text-ink/85">{row.label}</span>
                    )}
                    <p className="mt-0.5 break-all font-mono text-[0.64rem] text-ink/45">
                      {row.entityId}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-ink/62">{KIND_LABELS[row.kind]}</td>
                  <td className="px-4 py-3">
                    <p className="break-all font-mono text-[0.66rem] text-ink/62">
                      {row.sourceRef ?? "Источник не установлен"}
                    </p>
                    {row.linked.length > 0 ? (
                      <p className="mt-1 break-all font-mono text-[0.62rem] text-ink/40">
                        {row.linked.join(" · ")}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.56rem] font-bold uppercase tracking-[0.08em] ${STATE_STYLE[row.state]}`}
                    >
                      {STATE_LABELS[row.state]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink/62">
                    <p>{row.status}</p>
                    <p className="mt-0.5 font-mono text-[0.62rem] text-ink/40">
                      {row.version}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-ink/62">{row.impact}</td>
                  <td className="px-4 py-3 text-ink/55">{row.note}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-ink/50">
                    Источники не найдены. Пустой результат не заменяется
                    демонстрационными данными.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
