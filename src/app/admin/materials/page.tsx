import type { Metadata } from "next";
import Link from "next/link";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import {
  CATALOG_GROUPS,
  catalogPriceLinkIssues,
} from "@/lib/admin/catalog-model";
import { listPriceItems } from "@/lib/admin/price-items";
import type { CatalogItem } from "@/lib/admin/schema";
import { readCollection } from "@/lib/server/store";

import { sectionMetadata } from "../_components/section-route";

export const metadata: Metadata = sectionMetadata("materials");
export const dynamic = "force-dynamic";

const MATERIAL_KINDS: readonly CatalogItem["catalog"][] = [
  "bodyMaterial",
  "facadeMaterial",
  "countertop",
  "plinthMaterial",
];

const STATUS_LABELS: Record<CatalogItem["status"], string> = {
  active: "active",
  archived: "archived",
  preliminary: "preliminary",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function attrsSummary(item: CatalogItem): string {
  const attrs = item.attrs ?? {};
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      parts.push(`${key}=${String(value)}`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}=[${value.map(String).join(", ")}]`);
    } else {
      parts.push(`${key}=${JSON.stringify(value)}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function priceRefs(item: CatalogItem): string[] {
  if (!item.priceRefs) return [];
  if (Array.isArray(item.priceRefs)) return [...item.priceRefs];
  return Object.entries(item.priceRefs)
    .filter(([, value]) => Boolean(value))
    .map(([role, value]) => `${role}: ${value}`);
}

export default async function MaterialsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const query = (single(raw.q) ?? "").trim().toLowerCase();
  const status = single(raw.status);

  const [items, prices] = await Promise.all([
    readCollection<CatalogItem>("catalog-items.json"),
    listPriceItems(),
  ]);
  const priceIds = new Set(prices.map((item) => item.id));
  const linkIssues = catalogPriceLinkIssues(items, priceIds);

  const materials = items.filter(
    (item) =>
      MATERIAL_KINDS.includes(item.catalog) &&
      (status === undefined || item.status === status) &&
      (query.length === 0 ||
        item.id.toLowerCase().includes(query) ||
        item.label.toLowerCase().includes(query) ||
        item.catalog.toLowerCase().includes(query)),
  );

  const groups = CATALOG_GROUPS.filter((group) =>
    group.kinds.some((kind) => MATERIAL_KINDS.includes(kind)),
  );

  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">{ADMIN_SECTIONS.find((s) => s.id === "materials")?.index} / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          {ADMIN_SECTIONS.find((s) => s.id === "materials")?.title}
        </h1>
        <p className="body-copy mt-3">
          Фактические материалы из CatalogItem: толщины и характеристики — в
          `attrs`, тарифы — через `priceRefs`. Произвольные характеристики не
          добавляются.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <span className="chip chip-copper">CatalogItem · read-only</span>
        <span className="chip">всего: {materials.length}</span>
        <span className="chip">
          preliminary: {materials.filter((item) => item.status === "preliminary").length}
        </span>
        <span className="chip">
          archived: {materials.filter((item) => item.status === "archived").length}
        </span>
        <span className="chip">
          битых priceRefs: {linkIssues.filter((issue) => issue.severity === "error").length}
        </span>
      </div>

      <form
        method="get"
        action="/admin/materials"
        className="card-surface grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end"
      >
        <label className="field">
          <span className="field-label">Поиск по id / названию / виду</span>
          <input
            type="search"
            name="q"
            defaultValue={single(raw.q) ?? ""}
            placeholder="mdf, столешница…"
            className="input"
          />
        </label>
        <label className="field">
          <span className="field-label">Статус</span>
          <select name="status" defaultValue={status ?? ""} className="select">
            <option value="">Все</option>
            <option value="active">active</option>
            <option value="preliminary">preliminary</option>
            <option value="archived">archived</option>
          </select>
        </label>
        <button type="submit" className="btn btn-primary btn-sm">
          Применить
        </button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {groups.map((group) => (
          <span key={group.id} className="chip">
            {group.label}:{" "}
            {items.filter((item) => group.kinds.includes(item.catalog)).length}
          </span>
        ))}
      </div>

      <section className="card-surface mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-left text-[0.76rem]">
            <thead className="bg-white/25 text-[0.6rem] uppercase tracking-[0.12em] text-ink/42">
              <tr>
                <th className="px-5 py-3 font-semibold">Материал</th>
                <th className="px-4 py-3 font-semibold">Вид</th>
                <th className="px-4 py-3 font-semibold">Характеристики (attrs)</th>
                <th className="px-4 py-3 font-semibold">Тарифы (priceRefs)</th>
                <th className="px-4 py-3 font-semibold">Статус</th>
                <th className="px-4 py-3 font-semibold">Источник</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((item) => (
                <tr key={`${item.catalog}:${item.id}`} className="border-t border-ink/7 align-top">
                  <td className="px-5 py-3">
                    <p className="font-semibold text-ink/85">{item.label}</p>
                    <p className="mt-0.5 break-all font-mono text-[0.66rem] text-ink/45">
                      {item.catalog}:{item.id}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-ink/62">{item.catalog}</td>
                  <td className="px-4 py-3 text-ink/62">{attrsSummary(item)}</td>
                  <td className="px-4 py-3">
                    {priceRefs(item).length === 0 ? (
                      <span className="text-ink/40">—</span>
                    ) : (
                      <ul className="space-y-1">
                        {priceRefs(item).map((ref) => (
                          <li
                            key={ref}
                            className={`break-all font-mono text-[0.66rem] ${
                              ref.includes(": ")
                                ? priceIds.has(ref.split(": ")[1] ?? "")
                                  ? "text-ink/62"
                                  : "text-red-800"
                                : ""
                            }`}
                          >
                            {ref}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.08em] ${
                        item.status === "active"
                          ? "border-emerald-700/20 bg-emerald-600/10 text-emerald-900"
                          : item.status === "preliminary"
                            ? "border-amber-700/25 bg-amber-500/12 text-amber-950"
                            : "border-ink/15 bg-ink/5 text-ink/65"
                      }`}
                    >
                      {STATUS_LABELS[item.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink/55">
                    <p>CatalogItem не хранит sourceRef.</p>
                    <p className="mt-0.5 font-mono text-[0.64rem]">
                      updatedBy={item.updatedBy}
                    </p>
                    <Link
                      href={`/admin/catalogs?catalog=${item.catalog}&id=${encodeURIComponent(item.id)}`}
                      className="link-line mt-1 text-copper"
                    >
                      Карточка каталога →
                    </Link>
                  </td>
                </tr>
              ))}
              {materials.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-ink/50">
                    Материалы не найдены. Пустой результат не заменяется
                    демонстрационными данными.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card-surface mt-4 px-5 py-5">
        <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
          Ограничения модели
        </h2>
        <ul className="mt-3 space-y-2 text-[0.76rem] leading-relaxed text-ink/62">
          <li>
            Плотность и произвольные физические характеристики в текущих
            CatalogItem отсутствуют; они не добавляются в интерфейс.
          </li>
          <li>
            Толщины столешниц и цоколя хранятся в `attrs` конкретного элемента;
            сводный вид не создаёт второй источник истины.
          </li>
          <li>
            Источник значения у CatalogItem не зафиксирован схемой — отображается
            «Источник не установлен» либо `updatedBy`.
          </li>
        </ul>
      </section>
    </>
  );
}
