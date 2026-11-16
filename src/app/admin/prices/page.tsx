import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import { ConfirmPublish } from "@/components/admin/prices/ConfirmPublish";
import { PriceDraftEditor } from "@/components/admin/prices/PriceDraftEditor";
import {
  amountInVersion,
  filterPriceItems,
  formatDiffValue,
  formatPriceAmount,
  parsePriceItemFilter,
  PRICE_SCOPE_LABELS,
  PRICE_STATUS_LABELS,
  PRICE_UNIT_LABELS,
  PRICE_USAGE_LABELS,
  priceCapabilities,
  summarizeDiff,
  type PriceItemFilter,
} from "@/lib/admin/prices-ui";
import type { PriceItem } from "@/lib/admin/schema";

import { getCurrentSession } from "@/lib/auth/session";

import { sectionMetadata } from "../_components/section-route";
import { getPriceBoard, type PriceBoard } from "./_data/source";

export const metadata: Metadata = sectionMetadata("prices");
export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function hrefWith(filter: PriceItemFilter): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.scope) params.set("scope", filter.scope);
  if (filter.status) params.set("status", filter.status);
  if (filter.usage) params.set("usage", filter.usage);
  const query = params.toString();
  return query ? `/admin/prices?${query}` : "/admin/prices";
}

const STATUS_STYLE: Record<PriceItem["status"], string> = {
  active: "border-emerald-700/20 bg-emerald-600/10 text-emerald-900",
  archived: "border-ink/15 bg-ink/5 text-ink/65",
};

function StatusBadge({ item }: { item: PriceItem }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span
        className={`inline-flex rounded-full border px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.08em] ${STATUS_STYLE[item.status]}`}
      >
        {PRICE_STATUS_LABELS[item.status]}
      </span>
      <span className="inline-flex rounded-full border border-ink/12 bg-white/35 px-2.5 py-1 text-[0.6rem] font-semibold text-ink/55">
        {PRICE_USAGE_LABELS[item.usage]}
      </span>
    </div>
  );
}

function VersionCard({
  title,
  badge,
  rows,
}: {
  title: string;
  badge: React.ReactNode;
  rows: [string, React.ReactNode][];
}) {
  return (
    <section className="card-surface px-5 py-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
          {title}
        </h2>
        {badge}
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
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
    </section>
  );
}

function Board({
  board,
  filter,
  caps,
}: {
  board: PriceBoard;
  filter: PriceItemFilter;
  caps: { canWrite: boolean; canPublish: boolean };
}) {
  const filtered = filterPriceItems(board.items, filter);
  const summary = summarizeDiff(board.diff);

  if (!board.published) {
    return (
      <section className="card-surface px-6 py-8">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-copper" size={20} />
          <div>
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
              Нет опубликованной версии
            </p>
            <h2 className="mt-2 text-lg font-semibold">
              Прайс ещё не опубликован
            </h2>
            <p className="mt-2 text-[0.78rem] text-ink/62">
              Публичный калькулятор и пересчёт проектов не могут работать без
              опубликованной PricingVersion. Создайте версию через bootstrap
              или импорт — fallback-цены не подставляются.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const amountOf = (itemId: string) => amountInVersion(board.published!, itemId);
  const missingUsed = board.items.filter(
    (item) => item.usage === "used" && amountOf(item.id) === undefined,
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="chip chip-copper">PricingVersion</span>
        <span className="chip">real data</span>
        <span className="chip">
          черновик: {board.draft?.id ?? "нет"} · изменений {summary.total}
        </span>
        {missingUsed.length > 0 ? (
          <Link href="/admin/data-sources?state=conflict" className="chip">
            нет тарифа в версии: {missingUsed.length}
          </Link>
        ) : null}
      </div>

      {missingUsed.length > 0 ? (
        <div className="mb-3 rounded-2xl border border-red-700/20 bg-red-600/8 px-5 py-4 text-[0.76rem] text-red-900">
          <p className="font-semibold">
            У {missingUsed.length} действующих ставок нет значения в
            опубликованной версии
          </p>
          <p className="mt-1 text-[0.72rem]">
            Это проблема данных, а не нулевая стоимость. Отсутствующие ставки не
            подставляются как 0 ₽: {missingUsed.slice(0, 8).map((item) => item.id).join(", ")}
            {missingUsed.length > 8 ? " …" : ""}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <VersionCard
          title="Опубликованная версия"
          badge={
            <span className="chip chip-copper">
              {board.published.publishedSeq !== undefined
                ? `seq ${board.published.publishedSeq}`
                : "published"}
            </span>
          }
          rows={[
            ["id", <code key="id">{board.published.id}</code>],
            ["label", board.published.label],
            ["status", board.published.status],
            ["publishedAt", board.published.publishedAt ?? "—"],
            ["publishedBy", board.published.publishedBy ?? "—"],
            ["ставок в снимке", board.published.snapshot.length],
          ]}
        />
        <VersionCard
          title="Черновик"
          badge={
            <span className="chip">{board.draft ? "draft" : "не создан"}</span>
          }
          rows={
            board.draft
              ? [
                  ["id", <code key="id">{board.draft.id}</code>],
                  ["label", board.draft.label],
                  ["status", board.draft.status],
                  ["createdAt", board.draft.createdAt],
                  ["createdBy", board.draft.createdBy],
                  ["ставок в снимке", board.draft.snapshot.length],
                ]
              : [["id", "—"]]
          }
        />
      </div>

      <PriceDraftEditor
        canWrite={caps.canWrite}
        published={board.published}
        draft={board.draft}
        items={board.items}
      />

      <section className="card-surface mt-4 overflow-hidden">
        <div className="border-b border-ink/8 px-5 py-4">
          <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
            Ставки прайса
          </h2>
          <p className="mt-1 text-[0.7rem] text-ink/45">
            Суммы — из опубликованного снимка. 4 мёртвых поля аудита не
            показываются как действующие (ТЗ раздел 06).
          </p>
        </div>

        <form
          method="get"
          action="/admin/prices"
          className="grid gap-3 border-b border-ink/8 px-5 py-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))_auto] lg:items-end"
        >
          <label className="field">
            <span className="field-label">Поиск по id / названию / sourceRef</span>
            <input
              type="search"
              name="q"
              defaultValue={filter.q ?? ""}
              placeholder="hinge"
              className="input"
            />
          </label>
          <label className="field">
            <span className="field-label">scope</span>
            <select name="scope" defaultValue={filter.scope ?? ""} className="select">
              <option value="">Все</option>
              {(["kitchen", "wardrobe", "shared"] as const).map((scope) => (
                <option key={scope} value={scope}>
                  {PRICE_SCOPE_LABELS[scope]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Статус</span>
            <select name="status" defaultValue={filter.status ?? ""} className="select">
              <option value="">Все</option>
              {(["active", "archived"] as const).map((status) => (
                <option key={status} value={status}>
                  {PRICE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Использование</span>
            <select name="usage" defaultValue={filter.usage ?? ""} className="select">
              <option value="">Все</option>
              {(["used", "unused"] as const).map((usage) => (
                <option key={usage} value={usage}>
                  {PRICE_USAGE_LABELS[usage]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm">
              Найти
            </button>
            <Link href="/admin/prices" className="btn btn-glass btn-sm">
              Сброс
            </Link>
          </div>
        </form>

        {filtered.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
              Нет совпадений
            </p>
            <h3 className="font-display mt-3 text-xl">
              Фильтры не дали результатов
            </h3>
            <Link
              href={hrefWith({ q: filter.q })}
              className="btn btn-glass btn-sm mt-4"
            >
              Сбросить фильтры
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[62rem] text-left text-[0.76rem]">
              <thead className="bg-white/25 text-[0.6rem] uppercase tracking-[0.12em] text-ink/42">
                <tr>
                  <th className="px-5 py-3 font-semibold">Ставка</th>
                  <th className="px-4 py-3 font-semibold">Название</th>
                  <th className="px-4 py-3 font-semibold">scope</th>
                  <th className="px-4 py-3 font-semibold">Сумма</th>
                  <th className="px-4 py-3 font-semibold">Статус</th>
                  <th className="px-5 py-3 font-semibold">sourceRef</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-t border-ink/7 align-top">
                    <td className="px-5 py-3">
                      <code className="break-all font-semibold">{item.id}</code>
                      {item.groupId ? (
                        <p className="mt-1 text-[0.64rem] text-ink/40">
                          группа: {item.groupId}
                        </p>
                      ) : null}
                      <Link
                        href={`/admin/versions?entityType=priceItem&entityId=${encodeURIComponent(item.id)}`}
                        className="link-line mt-1 inline-flex text-[0.64rem] text-copper"
                      >
                        История
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink/72">{item.label}</td>
                    <td className="px-4 py-3 text-ink/62">
                      {PRICE_SCOPE_LABELS[item.scope]}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatPriceAmount(item, amountOf(item.id))}
                      <p className="text-[0.62rem] text-ink/40">
                        {PRICE_UNIT_LABELS[item.unit]}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge item={item} />
                    </td>
                    <td className="max-w-[18rem] px-5 py-3">
                      <code className="break-all text-[0.66rem] text-ink/45">
                        {item.sourceRef}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-surface mt-4 overflow-hidden">
        <div className="border-b border-ink/8 px-5 py-4">
          <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
            Diff: опубликованная ↔ черновик
          </h2>
          <p className="mt-1 text-[0.7rem] text-ink/45">
            Рассчитан `computePricingDiff` (CA-T-210): ставки, правила, промо и
            метаданные.
          </p>
        </div>
        {board.diff.length === 0 ? (
          <p className="px-6 py-8 text-[0.78rem] text-ink/55">
            Изменений между версиями нет.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-[0.76rem]">
              <thead className="bg-white/25 text-[0.6rem] uppercase tracking-[0.12em] text-ink/42">
                <tr>
                  <th className="px-5 py-3 font-semibold">Тип</th>
                  <th className="px-4 py-3 font-semibold">Ключ</th>
                  <th className="px-4 py-3 font-semibold">Поле</th>
                  <th className="px-4 py-3 font-semibold">Было</th>
                  <th className="px-5 py-3 font-semibold">Стало</th>
                </tr>
              </thead>
              <tbody>
                {board.diff.map((change) => (
                  <tr
                    key={`${change.targetType}:${change.targetKey}:${change.field}`}
                    className="border-t border-ink/7 align-top"
                  >
                    <td className="px-5 py-3 text-ink/55">{change.targetType}</td>
                    <td className="px-4 py-3">
                      <code className="break-all">{change.targetKey}</code>
                    </td>
                    <td className="px-4 py-3 text-ink/62">{change.field}</td>
                    <td className="max-w-[16rem] break-words px-4 py-3 text-ink/62">
                      {formatDiffValue(change.oldValue)}
                    </td>
                    <td className="max-w-[16rem] break-words px-5 py-3 font-medium">
                      {formatDiffValue(change.newValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-surface mt-4 px-5 py-5 sm:px-6">
        <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
          Подтверждение публикации
        </h2>
        <p className="mt-2 max-w-3xl text-[0.78rem] leading-relaxed text-ink/62">
          Публикация выполняется защищённым admin-API с отдельным правом
          `price.publish`; diff ({summary.total} изменений) и число затронутых
          проектов ({board.affectedProjects.length}) показаны до подтверждения.
        </p>
        <div className="mt-4">
          {board.draft ? (
            <ConfirmPublish
              canPublish={caps.canPublish}
              publishedId={board.published.id}
              draftId={board.draft.id}
              draftExpectedVersion={board.draft.createdAt}
              changes={board.diff}
              summary={summary}
              projects={board.affectedProjects}
            />
          ) : (
            <p className="text-[0.78rem] text-ink/55">
              Черновик не создан — публиковать нечего.
            </p>
          )}
        </div>
      </section>
    </>
  );
}

export default async function AdminPricesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getCurrentSession();
  const caps = priceCapabilities(session?.permissions ?? []);

  const raw = await searchParams;
  const filter = parsePriceItemFilter({
    q: single(raw.q),
    scope: single(raw.scope),
    status: single(raw.status),
    usage: single(raw.usage),
  });

  let board: PriceBoard | null = null;
  let loadError: string | null = null;
  try {
    board = await getPriceBoard();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Неизвестная ошибка.";
  }

  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">06 / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          {ADMIN_SECTIONS[6].title}
        </h1>
        <p className="body-copy mt-3">
          Ставки, правила и diff черновика прайса. Публикация выполняется
          защищённым admin-API с отдельным правом `price.publish`.
        </p>
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
                Не удалось загрузить прайс-борд
              </h2>
              <p className="mt-2 break-words text-[0.78rem] text-ink/62">
                {loadError}
              </p>
              <Link href="/admin/prices" className="btn btn-primary btn-sm mt-4">
                Повторить
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {board ? <Board board={board} filter={filter}   caps={caps}
        /> : null}
    </>
  );
}
