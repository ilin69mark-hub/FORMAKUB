import {
  computePricingDiff,
  getDraftVersion,
  getPublishedVersion,
  type PricingDiffEntry,
} from "@/lib/admin/pricing";
import { listPriceItems } from "@/lib/admin/price-items";
import type { PriceItem, PricingVersion } from "@/lib/admin/schema";
import type { StoredProject } from "@/lib/configurator/types";
import { readCollection } from "@/lib/server/store";

/**
 * CA-T-504 — реальный источник прайс-борда.
 *
 * Чтение идёт через существующие сервисы PricingVersion/PriceItem и
 * Storage Adapter. Diff считается существующей `computePricingDiff`
 * (CA-T-210). Мутации (draft/amount/validate/publish) выполняются
 * защищёнными admin-API из клиентских компонентов.
 */

export interface AffectedProject {
  id: string;
  type: string;
  priceVersion: string;
}

export interface PriceBoard {
  published: PricingVersion | null;
  draft: PricingVersion | null;
  items: PriceItem[];
  diff: PricingDiffEntry[];
  affectedProjects: AffectedProject[];
}

export async function getPriceBoard(): Promise<PriceBoard> {
  const [published, draft, items, projects] = await Promise.all([
    getPublishedVersion(),
    getDraftVersion(),
    listPriceItems(),
    readCollection<StoredProject>("projects.json"),
  ]);

  const diff =
    published && draft ? computePricingDiff(published, draft) : [];

  const affectedProjects = draft
    ? projects
        .filter((project) => project.priceVersion !== draft.id)
        .map((project) => ({
          id: project.id,
          type: project.config.kind,
          priceVersion: project.priceVersion ?? "—",
        }))
    : [];

  return {
    published: published ?? null,
    draft: draft ?? null,
    items,
    diff,
    affectedProjects,
  };
}
