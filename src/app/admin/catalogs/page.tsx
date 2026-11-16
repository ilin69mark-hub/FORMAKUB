import type { Metadata } from "next";
import Link from "next/link";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import { CatalogSection } from "@/components/admin/reference/CatalogSection";
import { CATALOG_GROUPS } from "@/lib/admin/catalog-model";
import type { CatalogItem } from "@/lib/admin/schema";

import { sectionMetadata } from "../_components/section-route";

export const metadata: Metadata = sectionMetadata("catalogs");
export const dynamic = "force-dynamic";

const KINDS: readonly CatalogItem["catalog"][] = [
  "bodyMaterial",
  "facadeMaterial",
  "facadeStyle",
  "countertop",
  "plinthMaterial",
  "plinthFinish",
  "plinthMount",
];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminCatalogsPage({ searchParams }: PageProps) {
  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">02 / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          {ADMIN_SECTIONS[2].title}
        </h1>
        <p className="body-copy mt-3">
          Материалы, фасады, столешницы и цоколь из фактического сервиса
          CatalogItem (CA-T-204). Архив и статусы доступны для просмотра.
        </p>
      </div>
      <section className="card-surface mb-6 px-5 py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
              Логические группы каталогов
            </h2>
            <p className="mt-1 text-[0.7rem] text-ink/45">
              Целевая группировка интерфейса. Группа без отдельной коллекции
              помечена PARTIAL/NOT_FOUND и не создаёт второй источник истины.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="chip">CONFIRMED: {CATALOG_GROUPS.filter((g) => g.coverage === "CONFIRMED").length}</span>
            <span className="chip">PARTIAL: {CATALOG_GROUPS.filter((g) => g.coverage === "PARTIAL").length}</span>
            <span className="chip">NOT_FOUND: {CATALOG_GROUPS.filter((g) => g.coverage === "NOT_FOUND").length}</span>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {CATALOG_GROUPS.map((group) => (
            <div
              key={group.id}
              className={`rounded-xl border px-3 py-2.5 ${
                group.coverage === "CONFIRMED"
                  ? "border-emerald-700/15 bg-emerald-600/5"
                  : group.coverage === "PARTIAL"
                    ? "border-amber-700/20 bg-amber-500/8"
                    : "border-ink/10 bg-ink/5"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.7rem] font-semibold text-ink/82">{group.label}</p>
                <span className="text-[0.52rem] font-bold uppercase tracking-[0.08em] text-ink/45">
                  {group.coverage}
                </span>
              </div>
              <p className="mt-1 text-[0.62rem] leading-relaxed text-ink/50">
                {group.coverageNote}
              </p>
              {group.kinds.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {group.kinds.map((kind) => (
                    <Link
                      key={kind}
                      href={`/admin/catalogs?catalog=${kind}`}
                      className="rounded-full border border-ink/10 bg-white/50 px-2 py-0.5 font-mono text-[0.56rem] text-ink/55 hover:border-copper/40"
                    >
                      {kind}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <CatalogSection route="/admin/catalogs" kinds={KINDS} searchParams={searchParams} />
    </>
  );
}
