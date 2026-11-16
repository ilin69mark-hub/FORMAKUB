import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { ArchiveButton } from "./ArchiveButton";
import { archiveCatalogItemAction } from "@/app/admin/_actions/reference";
import { listCatalogItems } from "@/lib/admin/catalogs";
import { listManagedRules, type ManagedRule } from "@/lib/admin/managed-rules";
import { listPriceItems } from "@/lib/admin/price-items";
import { getPublishedVersion } from "@/lib/admin/pricing";
import { listAuditEvents, type AdminAuditEvent } from "@/lib/server/audit";
import type { PriceItem, PricingVersion } from "@/lib/admin/schema";
import type { CatalogItem } from "@/lib/admin/schema";
import {
  CATALOG_KIND_LABELS,
  CATALOG_STATUSES,
  CATALOG_STATUS_HINTS,
  CATALOG_STATUS_LABELS,
  catalogArchiveAvailability,
  filterCatalogItems,
  formatCatalogAttrs,
  parseCatalogFilter,
} from "@/lib/admin/reference-ui";

/**
 * CA-T-503 — раздел справочников (ТЗ §2.2, разделы 02/04/05) на реальном
 * `CatalogItem`-сервисе (CA-T-204). Мок-источник CA-T-501 для этого
 * раздела больше не используется.
 */

type Kind = CatalogItem["catalog"];

interface Props {
  route: string;
  kinds: readonly Kind[];
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function hrefWith(
  route: string,
  base: Record<string, string | undefined>,
  extra: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...base, ...extra })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${route}?${query}` : route;
}

const STATUS_STYLE: Record<CatalogItem["status"], string> = {
  active: "border-emerald-700/20 bg-emerald-600/10 text-emerald-900",
  archived: "border-ink/15 bg-ink/5 text-ink/65",
  preliminary: "border-amber-700/25 bg-amber-500/12 text-amber-950",
};

function StatusBadge({ status }: { status: CatalogItem["status"] }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.08em] ${STATUS_STYLE[status]}`}
    >
      {CATALOG_STATUS_LABELS[status]}
    </span>
  );
}

function DetailCard({
  item,
  route,
  prices,
  published,
  rules,
  events,
}: {
  item: CatalogItem;
  route: string;
  prices: PriceItem[];
  published: PricingVersion | undefined;
  rules: ManagedRule[];
  events: AdminAuditEvent[];
}) {
  const availability = catalogArchiveAvailability(item);
  const refs = item.priceRefs
    ? Array.isArray(item.priceRefs)
      ? item.priceRefs.map((ref) => ({ role: "legacy", ref }))
      : Object.entries(item.priceRefs)
          .filter(([, ref]) => Boolean(ref))
          .map(([role, ref]) => ({ role, ref: ref as string }))
    : [];
  const refIds = new Set(refs.map((entry) => entry.ref));
  const relatedRules = rules.filter(
    (rule) =>
      rule.assigns === `catalog:${item.catalog}:${item.id}` ||
      (rule.assigns.startsWith("priceItem:") && refIds.has(rule.assigns.slice("priceItem:".length))),
  );

  return (
    <section className="card-surface mt-4 px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-copper">
            Карточка элемента справочника
          </p>
          <h2 className="mt-1 break-all text-lg font-semibold">{item.label}</h2>
          <p className="mt-1 break-all font-mono text-[0.7rem] text-ink/45">
            {item.catalog}:{item.id}
          </p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <p className="mt-3 text-[0.75rem] leading-relaxed text-ink/60">
        {CATALOG_STATUS_HINTS[item.status]}
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-ink/8 bg-white/30 px-4 py-3 sm:col-span-2">
          <dt className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/42">
            attrs (полная замена при PATCH)
          </dt>
          <dd className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[0.72rem] text-ink/78">
            {formatCatalogAttrs(item)}
          </dd>
        </div>
        {[
          ["version", item.version],
          ["sortOrder", item.sortOrder === undefined ? "—" : String(item.sortOrder)],
          ["updatedAt", item.updatedAt],
          ["updatedBy", item.updatedBy],
          ["createdAt", item.createdAt],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-ink/8 bg-white/30 px-4 py-3"
          >
            <dt className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/42">
              {label}
            </dt>
            <dd className="mt-1 break-words text-[0.78rem] text-ink/78">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-ink/8 bg-white/30 px-4 py-3">
          <p className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/42">
            Тарифы (priceRefs → PriceItem)
          </p>
          {refs.length === 0 ? (
            <p className="mt-2 text-[0.74rem] text-ink/45">
              Ссылки на тарифы отсутствуют. Нулевая цена не подставляется.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {refs.map(({ role, ref }) => {
                const price = prices.find((itemPrice) => itemPrice.id === ref);
                const amount = published?.snapshot.find(
                  (entry) => entry.priceItemId === ref,
                )?.amount;
                return (
                  <li key={`${role}:${ref}`} className="text-[0.72rem]">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-ink/45">{role}</span>
                      <Link
                        href={`/admin/prices?q=${encodeURIComponent(ref)}`}
                        className="break-all font-mono text-[0.66rem] text-copper underline decoration-copper/30 underline-offset-2"
                      >
                        {ref}
                      </Link>
                    </div>
                    <p className="mt-0.5 text-[0.66rem] text-ink/50">
                      {price ? price.label : "PriceItem не найден"}
                      {" · "}
                      {amount === undefined
                        ? "нет в опубликованной версии"
                        : `${amount.toLocaleString("ru-RU")} ${price?.unit ?? ""}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-ink/8 bg-white/30 px-4 py-3">
          <p className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/42">
            Связанные правила
          </p>
          {relatedRules.length === 0 ? (
            <p className="mt-2 text-[0.74rem] text-ink/45">
              Прямых Managed Rules для этого элемента/тарифов нет; связь не
              предполагается.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {relatedRules.map((rule) => (
                <li key={rule.id} className="text-[0.72rem]">
                  <p className="font-medium">{rule.name}</p>
                  <p className="font-mono text-[0.62rem] text-ink/45">{rule.id}</p>
                  <p className="mt-0.5 text-[0.64rem] text-ink/50">
                    assigns {rule.assigns} · {rule.source} · v{rule.version}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/rules" className="link-line mt-2 text-copper">
            Правила комплектации →
          </Link>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-ink/8 bg-white/30 px-4 py-3">
        <p className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/42">
          История изменений (AdminAuditLog)
        </p>
        {events.length === 0 ? (
          <p className="mt-2 text-[0.74rem] text-ink/45">
            Событий аудита для элемента нет. Версия записи: {item.version};
            обновлено {item.updatedAt} ({item.updatedBy}).
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-[0.7rem]">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{event.action}</span>
                <span className="text-ink/45">
                  {event.actorId} · {event.createdAt.slice(0, 16).replace("T", " ")} · {event.result}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ArchiveButton
        action={archiveCatalogItemAction}
        fields={{ catalog: item.catalog, id: item.id }}
        available={availability.canArchive}
        reason={availability.canArchive ? undefined : availability.reason}
        entityLabel={`«${item.catalog}:${item.id}»`}
      />

      <p className="mt-3 text-[0.68rem] leading-relaxed text-ink/42">
        Источник: {route} · сервис CA-T-204; архивирование подтверждается и
        проверяет ссылки из проектов на сервере (ТЗ §8 → 409).
      </p>
    </section>
  );
}

export async function CatalogSection({ route, kinds, searchParams }: Props) {
  const raw = await searchParams;
  const filter = parseCatalogFilter({
    status: single(raw.status),
    q: single(raw.q),
  });
  const kind =
    kinds.find((candidate) => candidate === single(raw.catalog)) ?? kinds[0];
  const selectedId = single(raw.id);

  let items: CatalogItem[] = [];
  let prices: PriceItem[] = [];
  let rules: ManagedRule[] = [];
  let published: PricingVersion | undefined;
  let events: AdminAuditEvent[] = [];
  let loadError: string | null = null;
  try {
    [items, prices, rules, published, events] = await Promise.all([
      listCatalogItems(kind, { status: filter.status }),
      listPriceItems(),
      listManagedRules(),
      getPublishedVersion(),
      listAuditEvents(),
    ]);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Неизвестная ошибка.";
  }

  const filtered = loadError ? [] : filterCatalogItems(items, filter);
  const sort = single(raw.sort) ?? "id";
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "label") return a.label.localeCompare(b.label, "ru");
    if (sort === "status") return a.status.localeCompare(b.status);
    if (sort === "version") return a.version.localeCompare(b.version);
    return a.id.localeCompare(b.id);
  });
  const selected = selectedId
    ? items.find((item) => item.id === selectedId)
    : undefined;

  const baseQuery: Record<string, string | undefined> = {
    catalog: kind,
    status: filter.status,
    q: filter.q,
    sort,
  };

  return (
    <>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Виды справочников">
        {kinds.map((candidate) => (
          <Link
            key={candidate}
            href={hrefWith(route, {}, { catalog: candidate })}
            className={`chip ${candidate === kind ? "chip-copper" : ""}`}
            aria-current={candidate === kind ? "page" : undefined}
          >
            {CATALOG_KIND_LABELS[candidate]}
          </Link>
        ))}
      </nav>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="chip chip-copper">Real data</span>
        <span className="chip">CatalogItem · CA-T-204</span>
        {!loadError ? (
          <span className="chip">
            Показано {filtered.length} из {items.length}
          </span>
        ) : null}
      </div>

      <form
        method="get"
        action={route}
        className="card-surface grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-end"
      >
        <input type="hidden" name="catalog" value={kind} />
        <label className="field">
          <span className="field-label">Статус</span>
          <select name="status" defaultValue={filter.status ?? ""} className="select">
            <option value="">Все</option>
            {CATALOG_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CATALOG_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Поиск по id / названию</span>
          <input
            type="search"
            name="q"
            defaultValue={filter.q ?? ""}
            placeholder="ldsp"
            className="input"
          />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary btn-sm">
            Найти
          </button>
          <Link
            href={hrefWith(route, { catalog: kind })}
            className="btn btn-glass btn-sm"
          >
            Сброс
          </Link>
        </div>
        <label className="field">
          <span className="field-label">Сортировка</span>
          <select name="sort" defaultValue={sort} className="select">
            <option value="id">по id</option>
            <option value="label">по названию</option>
            <option value="status">по статусу</option>
            <option value="version">по версии</option>
          </select>
        </label>
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
                Не удалось прочитать справочник
              </h2>
              <p className="mt-2 break-words text-[0.78rem] text-ink/62">
                {loadError}
              </p>
              <Link
                href={hrefWith(route, { catalog: kind })}
                className="btn btn-primary btn-sm mt-4"
              >
                Повторить
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {!loadError && selectedId && !selected ? (
        <p className="mt-4 rounded-xl border border-amber-700/20 bg-amber-500/10 px-4 py-3 text-[0.78rem] text-amber-950">
          Элемент «{selectedId}» не найден в этом справочнике; данные не
          подменяются.
        </p>
      ) : null}

      {selected ? (
        <DetailCard
          item={selected}
          route={route}
          prices={prices}
          published={published}
          rules={rules}
          events={events
            .filter(
              (event) =>
                event.entityType === "catalog" &&
                event.entityId === `${selected.catalog}:${selected.id}`,
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 8)}
        />
      ) : null}

      {!loadError && items.length === 0 ? (
        <section className="card-surface mt-6 px-6 py-10 text-center">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
            Нет данных
          </p>
          <h2 className="font-display mt-3 text-2xl">Справочник пуст</h2>
          <p className="body-copy mx-auto mt-3 max-w-2xl text-sm">
            В «{CATALOG_KIND_LABELS[kind]}» нет записей коллекции
            catalog-items.json. Импорт и создание элементов не входят в
            CA-T-503; панель не подставляет фиктивные значения.
          </p>
          <Link href="/admin" className="btn btn-glass btn-sm mt-6">
            Вернуться в обзор
          </Link>
        </section>
      ) : null}

      {!loadError && items.length > 0 && filtered.length === 0 ? (
        <section className="card-surface mt-6 px-6 py-10 text-center">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
            Нет совпадений
          </p>
          <h2 className="font-display mt-3 text-2xl">Фильтры не дали результатов</h2>
          <p className="body-copy mx-auto mt-3 max-w-2xl text-sm">
            Измените условия поиска или сбросьте фильтры.
          </p>
          <Link
            href={hrefWith(route, { catalog: kind })}
            className="btn btn-glass btn-sm mt-6"
          >
            Сбросить фильтры
          </Link>
        </section>
      ) : null}

      {!loadError && sorted.length > 0 ? (
        <section className="card-surface mt-6 overflow-hidden">
          <div className="border-b border-ink/8 px-5 py-4">
            <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
              {CATALOG_KIND_LABELS[kind]}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-[0.78rem]">
              <thead className="bg-white/25 text-[0.6rem] uppercase tracking-[0.12em] text-ink/42">
                <tr>
                  <th className="px-5 py-3 font-semibold">Элемент</th>
                  <th className="px-4 py-3 font-semibold">Название</th>
                  <th className="px-4 py-3 font-semibold">Статус</th>
                  <th className="px-4 py-3 font-semibold">Атрибутов</th>
                  <th className="px-4 py-3 font-semibold">Версия</th>
                  <th className="px-5 py-3 font-semibold">Карточка</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => (
                  <tr key={item.id} className="border-t border-ink/7">
                    <td className="px-5 py-3">
                      <code className="break-all font-semibold">{item.id}</code>
                    </td>
                    <td className="max-w-[18rem] px-4 py-3 text-ink/72">
                      {item.label}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-3 text-ink/62">
                      {Object.keys(item.attrs).length}
                    </td>
                    <td className="px-4 py-3 text-ink/62">{item.version}</td>
                    <td className="px-5 py-3">
                      <Link
                        href={hrefWith(route, baseQuery, { id: item.id })}
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
