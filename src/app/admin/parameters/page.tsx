import type { Metadata } from "next";

import Link from "next/link";
import { AlertTriangle, Search } from "lucide-react";

import { ParameterEditor } from "@/components/admin/parameters/ParameterEditor";
import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import {
  listParameters,
  parameterEditability,
} from "@/lib/admin/parameters";
import { diagnoseAdminParameterSeeds } from "@/lib/admin/parameter-seed";
import type { AdminParameter } from "@/lib/admin/schema";
import {
  filterParameters,
  formatParameterRange,
  formatParameterValue,
  PARAMETER_APPLIES_LABELS,
  PARAMETER_GROUP_LABELS,
  PARAMETER_GROUPS,
  PARAMETER_SCOPES,
  PARAMETER_SCOPE_LABELS,
  PARAMETER_STATUSES,
  PARAMETER_STATUS_HINTS,
  PARAMETER_STATUS_LABELS,
  parseParameterFilter,
} from "@/lib/admin/parameters-ui";

export const metadata: Metadata = {
  title: "01. Геометрия и параметры",
  description: ADMIN_SECTIONS[1].description,
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function hrefWith(
  base: Record<string, string | undefined>,
  extra: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...base, ...extra })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/admin/parameters?${query}` : "/admin/parameters";
}

const STATUS_STYLE: Record<AdminParameter["status"], string> = {
  active: "border-emerald-700/20 bg-emerald-600/10 text-emerald-900",
  readonly: "border-ink/15 bg-ink/5 text-ink/65",
  preliminary: "border-amber-700/25 bg-amber-500/12 text-amber-950",
  pending_release: "border-copper/35 bg-copper/12 text-[#7c4f2c]",
  dead: "border-red-700/20 bg-red-600/10 text-red-900",
};

function StatusBadge({ status }: { status: AdminParameter["status"] }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.08em] ${STATUS_STYLE[status]}`}
    >
      {PARAMETER_STATUS_LABELS[status]}
    </span>
  );
}

function Affects({ parameter }: { parameter: AdminParameter }) {
  return (
    <span className="text-[0.68rem] text-ink/55">
      {[
        parameter.affects.price ? "price" : null,
        parameter.affects.geometry ? "geometry" : null,
        parameter.affects.visualization ? "visualization" : null,
        parameter.affects.validation ? "validation" : null,
      ]
        .filter(Boolean)
        .join(", ") || "—"}
    </span>
  );
}

function DefinitionList({ parameter }: { parameter: AdminParameter }) {
  const rows: [string, React.ReactNode][] = [
    ["id", <code key="id">{parameter.id}</code>],
    ["Группа", PARAMETER_GROUP_LABELS[parameter.group]],
    ["scope", PARAMETER_SCOPE_LABELS[parameter.scope]],
    ["Категория", parameter.category],
    ["Тип", parameter.valueType],
    ["Значение", formatParameterValue(parameter)],
    ["Допустимо", formatParameterRange(parameter)],
    [
      "defaultValue",
      parameter.defaultValue === undefined
        ? "—"
        : formatParameterValue({
            ...parameter,
            value: parameter.defaultValue,
          } as AdminParameter),
    ],
    ["appliesTo", PARAMETER_APPLIES_LABELS[parameter.appliesTo]],
    ["affects", <Affects key="affects" parameter={parameter} />],
    ["editableInAdmin", parameter.editableInAdmin ? "true" : "false"],
    ["sourceRef", <code key="source">{parameter.sourceRef}</code>],
    ["version", parameter.version],
    ["updatedAt", parameter.updatedAt],
    ["updatedBy", parameter.updatedBy],
  ];

  return (
    <dl className="mt-4 grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-ink/8 bg-white/30 px-4 py-3">
          <dt className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/42">
            {label}
          </dt>
          <dd className="mt-1 break-words text-[0.78rem] text-ink/78">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ParameterDetail({ parameter }: { parameter: AdminParameter }) {
  const editability = parameterEditability(parameter);

  return (
    <section className="card-surface mt-4 px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-copper">
            Карточка параметра
          </p>
          <h2 className="mt-1 break-all text-lg font-semibold">{parameter.id}</h2>
        </div>
        <StatusBadge status={parameter.status} />
      </div>

      <p className="mt-3 text-[0.75rem] leading-relaxed text-ink/60">
        {PARAMETER_STATUS_HINTS[parameter.status]}
      </p>

      <DefinitionList parameter={parameter} />

      <div className="mt-5 border-t border-ink/8 pt-4">
        <p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-ink/42">
          Изменение значения
        </p>
        <ParameterEditor parameter={parameter} editability={editability} />
      </div>
    </section>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <section className="card-surface mt-6 px-6 py-10 text-center">
      <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
        {filtered ? "Нет совпадений" : "Нет данных"}
      </p>
      <h2 className="font-display mt-3 text-2xl">
        {filtered ? "Фильтры не дали результатов" : "Параметры отсутствуют"}
      </h2>
      <p className="body-copy mx-auto mt-3 max-w-2xl text-sm">
        {filtered
          ? "Измените условия поиска или сбросьте фильтры."
          : "Коллекция admin-parameters.json пуста. Импорт и создание параметров не входят в CA-T-502; панель не подставляет фиктивные значения."}
      </p>
      <Link
        href={filtered ? "/admin/parameters" : "/admin"}
        className="btn btn-glass btn-sm mt-6"
      >
        {filtered ? "Сбросить фильтры" : "Вернуться в обзор"}
      </Link>
    </section>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <section className="card-surface mt-6 px-6 py-8">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-copper" size={20} />
        <div>
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
            Ошибка чтения
          </p>
          <h2 className="mt-2 text-lg font-semibold">
            Не удалось прочитать параметры
          </h2>
          <p className="mt-2 break-words text-[0.78rem] text-ink/62">{message}</p>
          <Link href="/admin/parameters" className="btn btn-primary btn-sm mt-4">
            Повторить
          </Link>
        </div>
      </div>
    </section>
  );
}

export default async function AdminParametersPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const filter = parseParameterFilter({
    q: single(raw.q),
    status: single(raw.status),
    group: single(raw.group),
    scope: single(raw.scope),
  });
  const selectedId = single(raw.id);

  let items: AdminParameter[] = [];
  let loadError: string | null = null;
  try {
    items = await listParameters({ group: filter.group, status: filter.status });
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Неизвестная ошибка.";
  }

  const filtered = loadError ? [] : filterParameters(items, filter);
  const seedDiagnostics = loadError
    ? { unknownIds: [], incompatible: [] }
    : diagnoseAdminParameterSeeds(items);
  const selected = selectedId
    ? items.find((item) => item.id === selectedId)
    : undefined;

  const baseQuery = {
    q: filter.q,
    status: filter.status,
    group: filter.group,
    scope: filter.scope,
  };

  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">01 / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          Геометрия и параметры
        </h1>
        <p className="body-copy mt-3">
          Значения AdminParameter из фактического сервиса CA-T-203. Геометрия и
          параметры с запретом правки доступны только для просмотра.
        </p>
      </div>

      {!loadError &&
        (seedDiagnostics.unknownIds.length > 0 ||
          seedDiagnostics.incompatible.length > 0) && (
          <div className="mb-4 rounded-2xl border border-amber-700/25 bg-amber-500/12 px-5 py-4 text-[0.78rem] text-amber-950">
            <p className="font-semibold">Диагностика реестра параметров</p>
            {seedDiagnostics.unknownIds.length > 0 && (
              <p className="mt-1">
                Неизвестные ID: {seedDiagnostics.unknownIds.join(", ")}
              </p>
            )}
            {seedDiagnostics.incompatible.map((item) => (
              <p key={item.id} className="mt-1">
                {item.id}: {item.reason}
              </p>
            ))}
            <p className="mt-2 text-[0.7rem] opacity-80">
              Отсутствуют в AdminParameter: 3 числовых массива manifest
              (standardWidths, bottleBodies, psuRatings) — текущая схема
              поддерживает только string[].
            </p>
          </div>
        )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="chip chip-copper">Real data</span>
        <span className="chip">AdminParameter · CA-T-203</span>
        <span className="chip">optimistic locking</span>
        {!loadError ? (
          <span className="chip">
            Показано {filtered.length} из {items.length}
          </span>
        ) : null}
      </div>

      <form
        method="get"
        action="/admin/parameters"
        className="card-surface grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))_auto] md:items-end"
      >
        <label className="field">
          <span className="field-label">Поиск по id / sourceRef</span>
          <span className="flex items-center gap-2 rounded-[0.85rem] border border-ink/15 bg-white/55 px-3">
            <Search size={15} className="shrink-0 text-ink/38" />
            <input
              type="search"
              name="q"
              defaultValue={filter.q ?? ""}
              placeholder="kitchen.led"
              className="w-full bg-transparent py-2.5 text-[0.85rem] focus:outline-none"
            />
          </span>
        </label>
        <label className="field">
          <span className="field-label">Статус</span>
          <select name="status" defaultValue={filter.status ?? ""} className="select">
            <option value="">Все</option>
            {PARAMETER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PARAMETER_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Группа</span>
          <select name="group" defaultValue={filter.group ?? ""} className="select">
            <option value="">Все</option>
            {PARAMETER_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">scope</span>
          <select name="scope" defaultValue={filter.scope ?? ""} className="select">
            <option value="">Все</option>
            {PARAMETER_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {PARAMETER_SCOPE_LABELS[scope]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary btn-sm">
            Найти
          </button>
          <Link href="/admin/parameters" className="btn btn-glass btn-sm">
            Сброс
          </Link>
        </div>
      </form>

      {loadError ? <LoadError message={loadError} /> : null}

      {!loadError && selectedId && !selected ? (
        <p className="mt-4 rounded-xl border border-amber-700/20 bg-amber-500/10 px-4 py-3 text-[0.78rem] text-amber-950">
          Параметр «{selectedId}» не найден; данные не подменяются.
        </p>
      ) : null}

      {selected ? <ParameterDetail parameter={selected} /> : null}

      {!loadError && items.length === 0 ? <EmptyState filtered={false} /> : null}
      {!loadError && items.length > 0 && filtered.length === 0 ? (
        <EmptyState filtered />
      ) : null}

      {!loadError && filtered.length > 0 ? (
        <section className="card-surface mt-6 overflow-hidden">
          <div className="border-b border-ink/8 px-5 py-4">
            <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
              Параметры
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-left text-[0.78rem]">
              <thead className="bg-white/25 text-[0.6rem] uppercase tracking-[0.12em] text-ink/42">
                <tr>
                  <th className="px-5 py-3 font-semibold">Параметр</th>
                  <th className="px-4 py-3 font-semibold">Значение</th>
                  <th className="px-4 py-3 font-semibold">Тип</th>
                  <th className="px-4 py-3 font-semibold">Статус</th>
                  <th className="px-4 py-3 font-semibold">Группа / scope</th>
                  <th className="px-4 py-3 font-semibold">Версия</th>
                  <th className="px-5 py-3 font-semibold">Карточка</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((parameter) => (
                  <tr key={parameter.id} className="border-t border-ink/7">
                    <td className="max-w-[22rem] px-5 py-3">
                      <code className="break-all font-semibold">{parameter.id}</code>
                      <p className="mt-1 break-all text-[0.66rem] text-ink/42">
                        {parameter.sourceRef}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">
                        {formatParameterValue(parameter)}
                      </span>
                      {(parameter.valueType === "int" ||
                        parameter.valueType === "decimal") &&
                      parameter.unit !== "none" ? (
                        <span className="ml-1 text-ink/45">{parameter.unit}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-ink/62">{parameter.valueType}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={parameter.status} />
                    </td>
                    <td className="px-4 py-3 text-ink/62">
                      {parameter.group} / {PARAMETER_SCOPE_LABELS[parameter.scope]}
                    </td>
                    <td className="px-4 py-3 text-ink/62">{parameter.version}</td>
                    <td className="px-5 py-3">
                      <Link
                        href={hrefWith(baseQuery, { id: parameter.id })}
                        className="link-line text-copper"
                      >
                        Открыть
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
