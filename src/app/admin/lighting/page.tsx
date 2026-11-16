import type { Metadata } from "next";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import { CatalogSection } from "@/components/admin/reference/CatalogSection";
import type { CatalogItem } from "@/lib/admin/schema";

import { sectionMetadata } from "../_components/section-route";

export const metadata: Metadata = sectionMetadata("lighting");
export const dynamic = "force-dynamic";

const KINDS: readonly CatalogItem["catalog"][] = [
  "ledStrip",
  "ledProfile",
  "ledDiffuser",
  "ledControl",
  "ledPsu",
];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminLightingPage({ searchParams }: PageProps) {
  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">05 / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          {ADMIN_SECTIONS[5].title}
        </h1>
        <p className="body-copy mt-3">
          Ленты, профили, рассеиватели, управление и блоки питания из сервиса
          CatalogItem (CA-T-204). preliminary-данные не выдаются за
          подтверждённые.
        </p>
      </div>
      <CatalogSection route="/admin/lighting" kinds={KINDS} searchParams={searchParams} />
    </>
  );
}
