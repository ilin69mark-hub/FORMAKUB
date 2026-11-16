import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Search } from "lucide-react";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import {
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  formatAuditValue,
  paginateAuditEvents,
  parseAuditQuery,
  searchAuditEvents,
  sortAuditEvents,
  type AuditQuery,
} from "@/lib/admin/audit-ui";
import { listAuditEvents, type AdminAuditEvent } from "@/lib/server/audit";
import { readCollection } from "@/lib/server/store";
import { listRulesSnapshots } from "@/lib/admin/managed-rules";
import { listRulesPublicationJournal } from "@/lib/admin/rules-publication-journal";
import type { PricingVersion } from "@/lib/admin/schema";
import { listCompositionVersions } from "@/lib/admin/composition";
import { listCompositionPublicationJournal } from "@/lib/admin/composition-journal";

import { sectionMetadata } from "../_components/section-route";

export const metadata: Metadata = sectionMetadata("versions");
export const dynamic = "force-dynamic";

const RESULT_STYLE: Record<AdminAuditEvent["result"], string> = {
  ok: "border-emerald-700/20 bg-emerald-600/10 text-emerald-900",
  denied: "border-amber-700/25 bg-amber-500/12 text-amber-950",
  error: "border-red-700/20 bg-red-600/10 text-red-900",
};

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const FILTER_KEYS = [
  "action",
  "actorId",
  "entityType",
  "entityId",
  "from",
  "to",
  "q",
  "sort",
] as const;

function queryParams(query: AuditQuery): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = query[key];
    if (value !== undefined) params[key] = String(value);
  }
  return params;
}

function hrefFor(query: AuditQuery, page: number): string {
  const params = new URLSearchParams(queryParams(query));
  params.set("page", String(page));
  return `/admin/versions?${params.toString()}`;
}

const FILTER_ONLY_KEYS = [
  "action",
  "actorId",
  "entityType",
  "entityId",
  "from",
  "to",
  "q",
] as const;

function hasFilters(query: AuditQuery): boolean {
  return FILTER_ONLY_KEYS.some((key) => query[key] !== undefined);
}

function ResultBadge({ result }: { result: AdminAuditEvent["result"] }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.08em] ${RESULT_STYLE[result]}`}
    >
      {result}
    </span>
  );
}

function Details({ event }: { event: AdminAuditEvent }) {
  const hasDetails =
    event.oldValue !== undefined ||
    event.newValue !== undefined ||
    event.paramVersion !== undefined ||
    event.requestId !== undefined;

  if (!hasDetails) {
    return <span className="text-[0.7rem] text-ink/35">—</span>;
  }

  return (
    <details className="group">
      <summary className="cursor-pointer text-[0.7rem] font-semibold text-copper">
        Детали
      </summary>
      <dl className="mt-2 min-w-[18rem] space-y-2 text-[0.68rem]">
        {event.paramVersion !== undefined ? (
          <div>
            <dt className="text-ink/42">paramVersion</dt>
            <dd className="font-mono">{event.paramVersion}</dd>
          </div>
        ) : null}
        {event.requestId !== undefined ? (
          <div>
            <dt className="text-ink/42">requestId</dt>
            <dd className="break-all font-mono">{event.requestId}</dd>
          </div>
        ) : null}
        {event.oldValue !== undefined ? (
          <div>
            <dt className="text-ink/42">oldValue</dt>
            <dd>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/45 p-2 font-mono">
                {formatAuditValue(event.oldValue)}
              </pre>
            </dd>
          </div>
        ) : null}
        {event.newValue !== undefined ? (
          <div>
            <dt className="text-ink/42">newValue</dt>
            <dd>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/45 p-2 font-mono">
                {formatAuditValue(event.newValue)}
              </pre>
            </dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

export default async function AdminVersionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const input: Record<string, string | undefined> = {};
  for (const key of [...FILTER_KEYS, "page"] as const) {
    input[key] = single(raw[key]);
  }
  const query = parseAuditQuery(input);

  let events: AdminAuditEvent[] = [];
  let loadError: string | null = null;
  try {
    events = await listAuditEvents({
      ...(query.action !== undefined ? { action: query.action } : {}),
      ...(query.actorId !== undefined ? { actorId: query.actorId } : {}),
      ...(query.entityType !== undefined ? { entityType: query.entityType } : {}),
      ...(query.entityId !== undefined ? { entityId: query.entityId } : {}),
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
    });
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Неизвестная ошибка.";
  }

  const filtered = loadError ? [] : searchAuditEvents(events, query.q);
  const sorted = loadError ? [] : sortAuditEvents(filtered, query.sort);
  const page = loadError
    ? { items: [], page: 1, pageCount: 0, total: 0, rangeStart: 0, rangeEnd: 0 }
    : paginateAuditEvents(sorted, query.page);

  const [versionsResult, snapshotsResult, journalResult] = await Promise.allSettled([
    readCollection<PricingVersion>("pricing-versions.json"),
    listRulesSnapshots(),
    listRulesPublicationJournal(),
  ]);
  const versions = versionsResult.status === "fulfilled" ? versionsResult.value : [];
  const snapshots = snapshotsResult.status === "fulfilled" ? snapshotsResult.value : [];
  const journal = journalResult.status === "fulfilled" ? journalResult.value : [];
  const [compositions, compositionJournal] = await Promise.all([
    listCompositionVersions(),
    listCompositionPublicationJournal(),
  ]);
  const [catalogItems, presets, parameters] = await Promise.all([
    readCollection<{ catalog?: string; version?: string }>("catalog-items.json"),
    readCollection<{ family?: string; version?: string }>("module-presets.json"),
    readCollection<{ sourceRef?: string; version?: string }>("admin-parameters.json"),
  ]);
  const transitions = events.filter((event) => event.action === "project.rules_transition");

  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">09 / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          {ADMIN_SECTIONS[9].title}
        </h1>
        <p className="body-copy mt-3">
          Журнал действий `AdminAuditLog` из append-only сервиса CA-T-202:
          кто, что и когда изменил. Записи только читаются; изменение и
          удаление отсутствуют.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="chip chip-copper">Real data</span>
        <span className="chip">AdminAuditLog · CA-T-202</span>
        <span className="chip">append-only</span>
        {!loadError ? (
          <span className="chip">
            Событий: {page.total} · страница {page.pageCount === 0 ? 0 : page.page}
            {page.pageCount > 0 ? ` из ${page.pageCount}` : ""}
          </span>
        ) : null}
      </div>

      <section className="mb-4 grid gap-4 xl:grid-cols-4">
        <div className="card-surface overflow-hidden">
          <div className="border-b border-ink/8 px-5 py-3">
            <h2 className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-ink/52">
              Reference Data
            </h2>
          </div>
          <dl className="space-y-2 px-5 py-4 text-[0.72rem]">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-ink/50">CatalogItem</dt>
              <dd className="font-semibold">{catalogItems.length}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-ink/50">ModulePreset</dt>
              <dd className="font-semibold">{presets.length}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-ink/50">AdminParameter</dt>
              <dd className="font-semibold">{parameters.length}</dd>
            </div>
          </dl>
          <p className="px-5 pb-4 text-[0.64rem] leading-relaxed text-ink/45">
            Версии элементом и пины проектов. Reference Data не объединяется с
            Commercial Snapshot и Rules Snapshot.
          </p>
        </div>

        <div className="card-surface overflow-hidden">
          <div className="border-b border-ink/8 px-5 py-3">
            <h2 className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-ink/52">
              Commercial Snapshot (PricingVersion)
            </h2>
          </div>
          {versions.length === 0 ? (
            <p className="px-5 py-4 text-[0.74rem] text-ink/50">Версии отсутствуют.</p>
          ) : (
            <ul className="divide-y divide-ink/7 text-[0.72rem]">
              {versions.slice(0, 8).map((version) => (
                <li key={version.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="break-all font-mono">{version.id}</span>
                    <span className="chip">{version.status}</span>
                  </div>
                  <p className="mt-1 text-[0.64rem] text-ink/45">
                    seq {version.publishedSeq ?? "—"} · снимок {version.snapshot.length} ·
                    {" "}{version.publishedAt?.slice(0, 10) ?? version.createdAt.slice(0, 10)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-surface overflow-hidden">
          <div className="border-b border-ink/8 px-5 py-3">
            <h2 className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-ink/52">
              Calculation Rules Snapshot
            </h2>
          </div>
          {snapshots.length === 0 ? (
            <p className="px-5 py-4 text-[0.74rem] text-ink/50">Снимки правил отсутствуют.</p>
          ) : (
            <ul className="divide-y divide-ink/7 text-[0.72rem]">
              {snapshots.slice(0, 8).map((snapshot) => (
                <li key={snapshot.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="break-all font-mono">{snapshot.id}</span>
                    <span className="chip">seq {snapshot.publishedSeq}</span>
                  </div>
                  <p className="mt-1 text-[0.64rem] text-ink/45">
                    правил: {snapshot.rules.length} · {snapshot.publishedAt.slice(0, 16).replace("T", " ")}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-[0.58rem] text-ink/35">
                    {snapshot.contentHash.slice(0, 16)}…
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-surface overflow-hidden">
          <div className="border-b border-ink/8 px-5 py-3">
            <h2 className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-ink/52">
              Publication journal
            </h2>
            <p className="mt-1 text-[0.62rem] text-ink/45">
              записей: {journal.length} · с проблемами:{" "}
              {journal.filter((entry) => (entry.issues?.length ?? 0) > 0).length}
            </p>
          </div>
          {journal.length === 0 ? (
            <p className="px-5 py-4 text-[0.74rem] text-ink/50">Журнал публикаций пуст.</p>
          ) : (
            <ul className="divide-y divide-ink/7 text-[0.72rem]">
              {journal.slice(0, 8).map((entry) => (
                <li key={entry.operationId} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="break-all font-mono text-[0.66rem]">{entry.operationId}</span>
                    <span className="chip">{entry.phase}</span>
                  </div>
                  <p className="mt-1 text-[0.64rem] text-ink/45">
                    snapshot {entry.snapshotId ?? "—"} · rules {entry.rulesCount ?? entry.selection.length}
                  </p>
                  {entry.issues && entry.issues.length > 0 ? (
                    <p className="mt-1 break-words text-[0.62rem] text-red-800">
                      {entry.issues.join("; ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mb-4 grid gap-4 xl:grid-cols-2">
        <div className="card-surface overflow-hidden">
          <div className="border-b border-ink/8 px-5 py-3">
            <h2 className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-ink/52">
              CompositionVersion
            </h2>
            <p className="mt-1 text-[0.62rem] text-ink/45">
              версий: {compositions.length} · опубликовано:{" "}
              {compositions.filter((version) => version.status === "published").length}
            </p>
          </div>
          {compositions.length === 0 ? (
            <p className="px-5 py-4 text-[0.74rem] text-ink/50">
              Версии состава отсутствуют.
            </p>
          ) : (
            <ul className="divide-y divide-ink/7 text-[0.72rem]">
              {compositions.map((version) => (
                <li key={version.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="break-all font-mono">{version.id}</span>
                    <span className="chip">{version.status}</span>
                  </div>
                  <p className="mt-1 text-[0.64rem] text-ink/45">
                    v{version.version} · строк {version.lines.length} · seq{" "}
                    {version.publishedSeq ?? "—"} · hash{" "}
                    {version.contentHash.slice(0, 12)}…
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card-surface overflow-hidden">
          <div className="border-b border-ink/8 px-5 py-3">
            <h2 className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-ink/52">
              Composition publication journal
            </h2>
            <p className="mt-1 text-[0.62rem] text-ink/45">
              записей: {compositionJournal.length} · с проблемами:{" "}
              {compositionJournal.filter((entry) => (entry.issues?.length ?? 0) > 0).length}
            </p>
          </div>
          {compositionJournal.length === 0 ? (
            <p className="px-5 py-4 text-[0.74rem] text-ink/50">Журнал пуст.</p>
          ) : (
            <ul className="divide-y divide-ink/7 text-[0.72rem]">
              {compositionJournal.map((entry) => (
                <li key={entry.operationId} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="break-all font-mono text-[0.66rem]">
                      {entry.operationId}
                    </span>
                    <span className="chip">{entry.phase}</span>
                  </div>
                  <p className="mt-1 text-[0.64rem] text-ink/45">
                    version {entry.versionId} · seq {entry.publishedSeq ?? "—"}
                  </p>
                  {entry.issues && entry.issues.length > 0 ? (
                    <p className="mt-1 text-[0.62rem] text-red-800">
                      {entry.issues.join("; ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {transitions.length > 0 ? (
        <section className="card-surface mb-4 overflow-hidden">
          <div className="border-b border-ink/8 px-5 py-3">
            <h2 className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-ink/52">
              Переходы проектов на снимки правил ({transitions.length})
            </h2>
          </div>
          <ul className="divide-y divide-ink/7 text-[0.72rem]">
            {transitions.slice(0, 8).map((event) => (
              <li key={event.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono">{event.entityId}</span>
                  <span className="text-[0.64rem] text-ink/45">
                    {event.actorId} · {event.createdAt.slice(0, 16).replace("T", " ")} · {event.result}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form
        method="get"
        action="/admin/versions"
        className="card-surface grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-12 lg:items-end"
      >
        <label className="field lg:col-span-3">
          <span className="field-label">Действие</span>
          <select name="action" defaultValue={query.action ?? ""} className="select">
            <option value="">Все</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </label>
        <label className="field lg:col-span-2">
          <span className="field-label">Актор (actorId)</span>
          <input
            type="text"
            name="actorId"
            defaultValue={query.actorId ?? ""}
            placeholder="local-ui"
            className="input"
          />
        </label>
        <label className="field lg:col-span-2">
          <span className="field-label">Тип объекта</span>
          <input
            type="text"
            name="entityType"
            defaultValue={query.entityType ?? ""}
            placeholder="parameter"
            className="input"
          />
        </label>
        <label className="field lg:col-span-2">
          <span className="field-label">ID объекта</span>
          <input
            type="text"
            name="entityId"
            defaultValue={query.entityId ?? ""}
            placeholder="kitchen.led.endMargin"
            className="input"
          />
        </label>
        <label className="field lg:col-span-1">
          <span className="field-label">С даты</span>
          <input
            type="date"
            name="from"
            defaultValue={query.from?.slice(0, 10) ?? ""}
            className="input"
          />
        </label>
        <label className="field lg:col-span-1">
          <span className="field-label">По дату</span>
          <input
            type="date"
            name="to"
            defaultValue={query.to?.slice(0, 10) ?? ""}
            className="input"
          />
        </label>
        <label className="field lg:col-span-3">
          <span className="field-label">Поиск по id / action / entity / actor</span>
          <span className="flex items-center gap-2 rounded-[0.85rem] border border-ink/15 bg-white/55 px-3">
            <Search size={15} className="shrink-0 text-ink/38" />
            <input
              type="search"
              name="q"
              defaultValue={query.q ?? ""}
              placeholder="pricing.publish"
              className="w-full bg-transparent py-2.5 text-[0.85rem] focus:outline-none"
            />
          </span>
        </label>
        <label className="field lg:col-span-2">
          <span className="field-label">Сортировка</span>
          <select name="sort" defaultValue={query.sort} className="select">
            <option value="desc">Сначала новые</option>
            <option value="asc">Сначала старые</option>
          </select>
        </label>
        <div className="flex gap-2 lg:col-span-3">
          <button type="submit" className="btn btn-primary btn-sm">
            Применить
          </button>
          <Link href="/admin/versions" className="btn btn-glass btn-sm">
            Сброс
          </Link>
        </div>
      </form>

      {loadError ? (
        <section className="card-surface mt-6 px-6 py-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-copper" size={20} />
            <div>
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
                Ошибка чтения
              </p>
              <h2 className="mt-2 text-lg font-semibold">
                Не удалось прочитать журнал
              </h2>
              <p className="mt-2 break-words text-[0.78rem] text-ink/62">
                {loadError}
              </p>
              <Link href="/admin/versions" className="btn btn-primary btn-sm mt-4">
                Повторить
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {!loadError && page.total === 0 ? (
        <section className="card-surface mt-6 px-6 py-10 text-center">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
            {hasFilters(query) ? "Нет совпадений" : "Нет данных"}
          </p>
          <h2 className="font-display mt-3 text-2xl">
            {hasFilters(query)
              ? "Фильтры не дали результатов"
              : "Журнал пока пуст"}
          </h2>
          <p className="body-copy mx-auto mt-3 max-w-2xl text-sm">
            {hasFilters(query)
              ? "Измените условия фильтрации или сбросьте их."
              : "В append-only журнале нет записей. События появляются только в результате реальных операций сервисов; панель не создаёт фиктивные записи."}
          </p>
          <Link
            href={hasFilters(query) ? "/admin/versions" : "/admin"}
            className="btn btn-glass btn-sm mt-6"
          >
            {hasFilters(query) ? "Сбросить фильтры" : "Вернуться в обзор"}
          </Link>
        </section>
      ) : null}

      {!loadError && page.total > 0 ? (
        <>
          <section className="card-surface mt-6 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/8 px-5 py-4">
              <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
                События журнала
              </h2>
              <span className="text-[0.68rem] text-ink/45">
                {page.rangeStart}–{page.rangeEnd} из {page.total} · по {AUDIT_PAGE_SIZE} на страницу
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[70rem] text-left text-[0.76rem]">
                <thead className="bg-white/25 text-[0.6rem] uppercase tracking-[0.12em] text-ink/42">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Время</th>
                    <th className="px-4 py-3 font-semibold">Действие</th>
                    <th className="px-4 py-3 font-semibold">Объект</th>
                    <th className="px-4 py-3 font-semibold">Актор</th>
                    <th className="px-4 py-3 font-semibold">Результат</th>
                    <th className="px-5 py-3 font-semibold">Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((event) => (
                    <tr key={event.id} className="border-t border-ink/7 align-top">
                      <td className="whitespace-nowrap px-5 py-3 text-ink/62">
                        <span className="font-mono text-[0.7rem]">
                          {event.createdAt}
                        </span>
                        <p className="mt-1 text-[0.62rem] text-ink/35">{event.id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-semibold">{event.action}</code>
                      </td>
                      <td className="max-w-[18rem] px-4 py-3">
                        <p className="text-[0.7rem] text-ink/45">{event.entityType}</p>
                        <code className="break-all text-[0.72rem]">
                          {event.entityId}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{event.actorId}</p>
                        <p className="text-[0.66rem] text-ink/45">{event.actorRole}</p>
                      </td>
                      <td className="px-4 py-3">
                        <ResultBadge result={event.result} />
                      </td>
                      <td className="px-5 py-3">
                        <Details event={event} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {page.pageCount > 1 ? (
            <nav
              className="mt-4 flex flex-wrap items-center justify-between gap-2"
              aria-label="Пагинация журнала"
            >
              <Link
                href={hrefFor(query, Math.max(1, page.page - 1))}
                aria-disabled={page.page === 1}
                className={`btn btn-glass btn-sm ${page.page === 1 ? "pointer-events-none opacity-40" : ""}`}
              >
                <ChevronLeft size={15} /> Назад
              </Link>
              <span className="text-[0.72rem] text-ink/55">
                Страница {page.page} из {page.pageCount}
              </span>
              <Link
                href={hrefFor(query, Math.min(page.pageCount, page.page + 1))}
                aria-disabled={page.page === page.pageCount}
                className={`btn btn-glass btn-sm ${page.page === page.pageCount ? "pointer-events-none opacity-40" : ""}`}
              >
                Вперёд <ChevronRight size={15} />
              </Link>
            </nav>
          ) : null}

          <div className="mt-4 rounded-2xl border border-ink/10 bg-white/25 px-4 py-3 text-[0.7rem] leading-relaxed text-ink/55">
            Журнал доступен только для чтения (append-only). Реестр версий
            прайса/`calcVersion` не входит в CA-T-508 и в этом разделе не
            отображается.
          </div>
        </>
      ) : null}
    </>
  );
}
