import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { ADMIN_SECTIONS, type AdminSection } from "@/components/admin/navigation";
import {
  CATALOG_GROUPS,
  KITCHEN_MODULE_GROUPS,
} from "@/lib/admin/catalog-model";
import { getAdminOverview } from "@/app/admin/_data/source";
import type { AdminAuditEvent } from "@/lib/server/audit";

function formatUtc(value: string): string {
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

function StatusChip({ result }: { result: AdminAuditEvent["result"] }) {
  const style =
    result === "ok"
      ? "border-emerald-700/20 bg-emerald-600/10 text-emerald-900"
      : result === "denied"
        ? "border-amber-700/20 bg-amber-500/10 text-amber-900"
        : "border-red-700/20 bg-red-600/10 text-red-900";
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.1em] ${style}`}
    >
      {result}
    </span>
  );
}

function SectionHeading({ section }: { section: AdminSection }) {
  return (
    <div className="mb-8 max-w-3xl">
      <p className="eyebrow">
        {section.index} / Calculation Admin
      </p>
      <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
        {section.title}
      </h1>
      <p className="body-copy mt-3">{section.description}</p>
    </div>
  );
}


export async function OverviewScreen() {
  const overview = await getAdminOverview();

  return (
    <>
      <SectionHeading section={ADMIN_SECTIONS[0]} />

      {overview.errors.length > 0 && (
        <div className="mb-4 rounded-2xl border border-red-700/20 bg-red-600/8 px-5 py-4 text-[0.78rem] text-red-900">
          <p className="font-semibold">Часть источников недоступна</p>
          <ul className="mt-2 list-disc pl-5">
            {overview.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {overview.counters.map((counter) => (
          <div key={counter.label} className="card-surface px-5 py-5">
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ink/42">
              {counter.label}
            </p>
            <p className="mt-2 font-display text-4xl text-ink">{counter.value}</p>
            <p className="mt-1 text-[0.7rem] text-ink/45">{counter.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card-surface px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ink/42">
                Текущий прайс
              </p>
              <h2 className="mt-2 text-lg font-semibold">
                {overview.currentPriceVersion?.id ?? "Нет опубликованной версии"}
              </h2>
            </div>
            {overview.currentPriceVersion ? (
              <span className="chip chip-copper">
                {overview.currentPriceVersion.status}
              </span>
            ) : null}
          </div>
          {overview.currentPriceVersion ? (
            <dl className="mt-5 grid grid-cols-2 gap-4 text-[0.78rem]">
              <div>
                <dt className="text-ink/42">publishedSeq</dt>
                <dd className="mt-0.5 font-semibold">
                  {overview.currentPriceVersion.publishedSeq}
                </dd>
              </div>
              <div>
                <dt className="text-ink/42">Опубликовал</dt>
                <dd className="mt-0.5 font-semibold">
                  {overview.currentPriceVersion.publishedBy}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-ink/42">Дата публикации</dt>
                <dd className="mt-0.5 font-semibold">
                  {formatUtc(overview.currentPriceVersion.publishedAt)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="body-copy mt-4 text-sm">
              Опубликованная версия отсутствует.
            </p>
          )}
        </section>

        <section className="card-surface px-6 py-6">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ink/42">
            Пересчёт проектов
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(overview.recalculations).map(([key, value]) => (
              <div key={key} className="rounded-xl border border-ink/8 bg-white/35 px-3 py-3">
                <p className="text-[0.6rem] uppercase tracking-[0.12em] text-ink/42">
                  {key}
                </p>
                <p className="mt-1 text-xl font-semibold">
                  {value === null ? "—" : value}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[0.72rem] leading-relaxed text-ink/48">
            Источник — существующие RecalculationBatch/Job. Управление
            retry/cancel доступно в разделе пересчёта с учётом RBAC.
          </p>
        </section>
      </div>

      <section className="card-surface mt-4 overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-ink/8 px-6 py-4">
          <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
            Последние события
          </h2>
          <Link href="/admin/versions" className="link-line text-copper">
            Журнал
            <ArrowUpRight size={13} />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-[0.78rem]">
            <thead className="bg-white/25 text-[0.62rem] uppercase tracking-[0.12em] text-ink/42">
              <tr>
                <th className="px-6 py-3 font-semibold">Событие</th>
                <th className="px-4 py-3 font-semibold">Объект</th>
                <th className="px-4 py-3 font-semibold">Автор</th>
                <th className="px-4 py-3 font-semibold">Время</th>
                <th className="px-6 py-3 font-semibold">Результат</th>
              </tr>
            </thead>
            <tbody>
              {overview.recentEvents.map((event) => (
                <tr key={event.id} className="border-t border-ink/7">
                  <td className="px-6 py-3 font-medium">{event.action}</td>
                  <td className="px-4 py-3 text-ink/62">{event.entityId}</td>
                  <td className="px-4 py-3 text-ink/62">
                    {event.actorId}
                    <span className="ml-2 text-ink/35">{event.actorRole}</span>
                  </td>
                  <td className="px-4 py-3 text-ink/62">{formatUtc(event.createdAt)}</td>
                  <td className="px-6 py-3">
                    <StatusChip result={event.result} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card-surface mt-4 px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ink/42">
              Состояние данных
            </p>
            <h2 className="mt-2 text-lg font-semibold">Каталоги, модули, правила и цены</h2>
          </div>
          <Link href="/admin/data-sources" className="link-line text-copper">
            Источники данных
            <ArrowUpRight size={13} />
          </Link>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              title: "Каталоги",
              rows: [
                ["Всего", String(overview.catalogCounts.total)],
                ["active", String(overview.catalogCounts.active)],
                ["preliminary", String(overview.catalogCounts.preliminary)],
                ["archived", String(overview.catalogCounts.archived)],
                ["видов", String(overview.catalogCounts.kinds)],
                ["логических групп", String(CATALOG_GROUPS.length)],
              ],
            },
            {
              title: "Модули",
              rows: [
                ["Кухня (пресеты)", String(overview.moduleCounts.kitchen)],
                ["Типов кухни", String(overview.moduleCounts.kitchenTypes)],
                ["Шкаф (пресеты)", String(overview.moduleCounts.wardrobe)],
                ["Шкаф — конфигурация", "1–2 секции"],
                ["групп модулей", String(KITCHEN_MODULE_GROUPS.length)],
              ],
            },
            {
              title: "Правила",
              rows: [
                ["Всего", String(overview.rules.total)],
                ["draft", String(overview.rules.draft)],
                ["published", String(overview.rules.published)],
                ["preliminary", String(overview.rules.preliminary)],
                ["снимков", String(overview.rules.snapshots)],
              ],
            },
            {
              title: "Цены",
              rows: [
                ["PriceItem", String(overview.pricing.priceItems)],
                ["published версий", String(overview.pricing.publishedVersions)],
                ["draft версий", String(overview.pricing.draftVersions)],
                ["битых priceRefs", String(overview.pricing.missingPriceRefs)],
                ["нет тарифа", String(overview.pricing.missingTariffs)],
              ],
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-ink/10 bg-white/30 px-4 py-4"
            >
              <p className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/42">
                {card.title}
              </p>
              <dl className="mt-3 space-y-1.5 text-[0.74rem]">
                {card.rows.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink/55">{label}</dt>
                    <dd className="font-semibold text-ink/80">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        {overview.pricing.missingPriceRefs > 0 || overview.pricing.missingTariffs > 0 ? (
          <p className="mt-4 rounded-xl border border-red-700/20 bg-red-600/8 px-4 py-3 text-[0.75rem] text-red-900">
            Обнаружены проблемы цен: ссылки каталогов на отсутствующие PriceItem —{" "}
            {overview.pricing.missingPriceRefs}; действующие ставки без значения в
            опубликованной версии — {overview.pricing.missingTariffs}. Это
            проблема данных, а не нулевая стоимость. Подробности — в «Источниках
            данных» и «Контроле и диагностике».
          </p>
        ) : null}
        <p className="mt-4 text-[0.7rem] text-ink/45">
          Активный снимок правил: {overview.rules.activeSnapshotId ?? "не опубликован"}.
          Показатели формируются из Storage Adapter; демонстрационные значения не
          используются.
        </p>
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="font-display text-2xl">Разделы панели</h2>
          <span className="text-[0.7rem] text-ink/42">
            {ADMIN_SECTIONS.length} разделов · реальные данные
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ADMIN_SECTIONS.map((section) => (
            <Link
              key={section.id}
              href={section.href}
              className="card-surface card-hover group flex flex-col px-5 py-5"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[0.62rem] tracking-widest text-copper">
                  {section.index}
                </span>
                <ArrowUpRight
                  size={15}
                  className="text-ink/30 transition-colors group-hover:text-copper"
                />
              </div>
              <h3 className="mt-3 text-[0.92rem] font-semibold">{section.title}</h3>
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink/55">
                {section.description}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

