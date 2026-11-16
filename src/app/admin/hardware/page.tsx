import type { Metadata } from "next";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import { CatalogSection } from "@/components/admin/reference/CatalogSection";
import type { CatalogItem } from "@/lib/admin/schema";

import { sectionMetadata } from "../_components/section-route";

export const metadata: Metadata = sectionMetadata("hardware");
export const dynamic = "force-dynamic";

const KINDS: readonly CatalogItem["catalog"][] = ["handle", "supportSystem"];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminHardwarePage({ searchParams }: PageProps) {
  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">04 / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          {ADMIN_SECTIONS[4].title}
        </h1>
        <p className="body-copy mt-3">
          Ручки и системы опор из фактического сервиса CatalogItem (CA-T-204).
          Атрибуты preliminary отображаются с пометкой.
        </p>
      </div>
      <CatalogSection route="/admin/hardware" kinds={KINDS} searchParams={searchParams} />
    </>
  );
}
