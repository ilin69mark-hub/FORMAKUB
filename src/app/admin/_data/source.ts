import type { AdminSectionId } from "@/components/admin/navigation";

import { listModulePresets } from "@/lib/admin/presets";
import { listPriceItems } from "@/lib/admin/price-items";
import { listParameters } from "@/lib/admin/parameters";
import { getPublishedVersion } from "@/lib/admin/pricing";
import { listProjectRecalculations, listRecalculationBatches } from "@/lib/admin/jobs";
import { catalogPriceLinkIssues } from "@/lib/admin/catalog-model";
import { listManagedRules, listRulesSnapshots } from "@/lib/admin/managed-rules";
import { listAuditEvents, type AdminAuditEvent } from "@/lib/server/audit";
import { readCollection } from "@/lib/server/store";
import type { CatalogItem, PricingVersion } from "@/lib/admin/schema";

export interface AdminCounter {
  label: string;
  value: string;
  hint: string;
}

export interface AdminPriceVersion {
  id: string;
  status: "draft" | "published" | "superseded";
  publishedAt: string;
  publishedBy: string;
  publishedSeq: number;
}

export interface AdminRecalculationCounts {
  queued: number | null;
  running: number | null;
  failed: number | null;
  completed: number | null;
}

export interface AdminSectionMetric {
  label: string;
  value: string;
}

export interface AdminCatalogCounts {
  total: number;
  active: number;
  archived: number;
  preliminary: number;
  kinds: number;
}

export interface AdminModuleCounts {
  kitchen: number;
  wardrobe: number;
  kitchenTypes: number;
}

export interface AdminPricingHealth {
  publishedVersions: number;
  draftVersions: number;
  priceItems: number;
  missingPriceRefs: number;
  /** used-ставки, отсутствующие в опубликованном PriceSnapshot. */
  missingTariffs: number;
}

export interface AdminRulesHealth {
  total: number;
  draft: number;
  published: number;
  preliminary: number;
  snapshots: number;
  activeSnapshotId: string | null;
}

export interface AdminOverviewData {
  counters: AdminCounter[];
  currentPriceVersion: AdminPriceVersion | null;
  recalculations: AdminRecalculationCounts;
  recentEvents: AdminAuditEvent[];
  sectionMetrics: Record<AdminSectionId, AdminSectionMetric[]>;
  catalogCounts: AdminCatalogCounts;
  moduleCounts: AdminModuleCounts;
  pricing: AdminPricingHealth;
  rules: AdminRulesHealth;
  errors: string[];
}

export async function getAdminOverview(): Promise<AdminOverviewData> {
  const errors: string[] = [];
  const [params, catalogs, presets, prices, published, batches, jobs, events, rules, snapshots, versions] =
    await Promise.allSettled([
      listParameters({}),
      readCollection<CatalogItem>("catalog-items.json"),
      listModulePresets(),
      listPriceItems(),
      getPublishedVersion(),
      listRecalculationBatches(),
      listProjectRecalculations(),
      listAuditEvents(),
      listManagedRules(),
      listRulesSnapshots(),
      readCollection<PricingVersion>("pricing-versions.json"),
    ]);

  const count = (result: PromiseSettledResult<unknown[]>, label: string): string => {
    if (result.status === "fulfilled") return String(result.value.length);
    errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    return "—";
  };

  const counters: AdminCounter[] = [
    { label: "Параметры", value: count(params, "AdminParameter"), hint: "Раздел 01" },
    { label: "Справочники", value: count(catalogs, "CatalogItem"), hint: "Раздел 02" },
    { label: "Пресеты модулей", value: count(presets, "ModulePreset"), hint: "Раздел 03" },
    { label: "Позиции прайса", value: count(prices, "PriceItem"), hint: "Раздел 06" },
  ];

  const catalogList = catalogs.status === "fulfilled" ? catalogs.value : [];
  const catalogCounts: AdminCatalogCounts = {
    total: catalogList.length,
    active: catalogList.filter((item) => item.status === "active").length,
    archived: catalogList.filter((item) => item.status === "archived").length,
    preliminary: catalogList.filter((item) => item.status === "preliminary").length,
    kinds: new Set(catalogList.map((item) => item.catalog)).size,
  };
  const presetList = presets.status === "fulfilled" ? presets.value : [];
  const moduleCounts: AdminModuleCounts = {
    kitchen: presetList.filter((item) => item.family === "kitchen").length,
    wardrobe: presetList.filter((item) => item.family === "wardrobe").length,
    kitchenTypes: new Set(
      presetList.filter((item) => item.family === "kitchen").map((item) => item.id),
    ).size,
  };
  const priceList = prices.status === "fulfilled" ? prices.value : [];
  const versionList = versions.status === "fulfilled" ? versions.value : [];
  const priceIds = new Set(priceList.map((item) => item.id));
  const missingRefs =
    catalogs.status === "fulfilled"
      ? catalogPriceLinkIssues(catalogList, priceIds).filter(
          (issue) => issue.severity === "error",
        ).length
      : 0;
  const pricing: AdminPricingHealth = {
    publishedVersions: versionList.filter((item) => item.status === "published").length,
    draftVersions: versionList.filter((item) => item.status === "draft").length,
    priceItems: priceList.length,
    missingPriceRefs: missingRefs,
    missingTariffs:
      published.status === "fulfilled" && published.value
        ? priceList.filter(
            (item) =>
              item.usage === "used" &&
              !published.value!.snapshot.some((entry) => entry.priceItemId === item.id),
          ).length
        : 0,
  };
  const ruleList = rules.status === "fulfilled" ? rules.value : [];
  const snapshotList = snapshots.status === "fulfilled" ? snapshots.value : [];
  const rulesHealth: AdminRulesHealth = {
    total: ruleList.length,
    draft: ruleList.filter((rule) => rule.status === "draft").length,
    published: ruleList.filter((rule) => rule.status === "published").length,
    preliminary: ruleList.filter((rule) => rule.source === "preliminary").length,
    snapshots: snapshotList.length,
    activeSnapshotId: null,
  };
  for (const result of [rules, snapshots]) {
    if (result.status === "rejected") {
      errors.push(
        `Managed Rules: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
    }
  }
  rulesHealth.activeSnapshotId =
    [...snapshotList].sort((a, b) => b.publishedSeq - a.publishedSeq)[0]?.id ?? null;
  if (versions.status === "rejected") {
    errors.push(
      `PricingVersion: ${versions.reason instanceof Error ? versions.reason.message : String(versions.reason)}`,
    );
  }

  counters.push(
    { label: "Элементы каталогов", value: String(catalogCounts.total), hint: "статусы: active / preliminary / archived" },
    { label: "Мебельные модули", value: String(moduleCounts.kitchen), hint: `типов кухни: ${moduleCounts.kitchenTypes}` },
    { label: "Preliminary-нормы", value: String(rulesHealth.preliminary), hint: "не публикуются до подтверждения" },
    { label: "Опубликованные версии", value: String(pricing.publishedVersions), hint: `draft: ${pricing.draftVersions}` },
  );


  let currentPriceVersion: AdminPriceVersion | null = null;
  if (published.status === "fulfilled") {
    const version = published.value;
    if (version) {
      currentPriceVersion = {
        id: version.id,
        status: version.status,
        publishedAt: version.publishedAt ?? version.createdAt,
        publishedBy: version.publishedBy ?? version.createdBy,
        publishedSeq: version.publishedSeq ?? 0,
      };
    }
  } else {
    errors.push(`PricingVersion: ${published.reason instanceof Error ? published.reason.message : String(published.reason)}`);
  }

  const failedResults = [batches, jobs].filter(
    (item): item is PromiseRejectedResult => item.status === "rejected",
  );
  for (const item of failedResults) {
    errors.push(`Пересчёт: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`);
  }
  const jobList = jobs.status === "fulfilled" ? jobs.value : [];
  const recalculations: AdminRecalculationCounts = {
    queued: jobs.status === "fulfilled" ? jobList.filter((job) => job.status === "pending").length : null,
    running: jobs.status === "fulfilled" ? jobList.filter((job) => job.status === "running").length : null,
    failed:
      jobs.status === "fulfilled"
        ? jobList.filter((job) => job.status === "failed" || job.status === "dead_letter").length
        : null,
    completed: jobs.status === "fulfilled" ? jobList.filter((job) => job.status === "completed").length : null,
  };

  const recentEvents =
    events.status === "fulfilled"
      ? [...events.value]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 10)
      : [];
  if (events.status === "rejected") {
    errors.push(`AdminAuditLog: ${events.reason instanceof Error ? events.reason.message : String(events.reason)}`);
  }

  const batchList = batches.status === "fulfilled" ? batches.value : [];
  const sectionMetrics: Record<AdminSectionId, AdminSectionMetric[]> = {
    overview: [
      { label: "Ошибок источников", value: String(errors.length) },
      { label: "Batch", value: batches.status === "fulfilled" ? String(batchList.length) : "—" },
      { label: "Jobs", value: jobs.status === "fulfilled" ? String(jobList.length) : "—" },
    ],
    parameters: [
      { label: "Параметров", value: count(params, "AdminParameter") },
      { label: "Readonly", value: params.status === "fulfilled" ? String(params.value.filter((item) => item.status === "readonly").length) : "—" },
    ],
    catalogs: [
      { label: "Элементов", value: count(catalogs, "CatalogItem") },
      { label: "Групп", value: String(catalogCounts.kinds) },
    ],
    materials: [
      { label: "Элементов материалов", value: String(catalogCounts.total) },
      { label: "Preliminary", value: String(catalogCounts.preliminary) },
    ],
    modules: [
      { label: "Пресетов", value: count(presets, "ModulePreset") },
      { label: "Типов кухни", value: String(moduleCounts.kitchenTypes) },
    ],
    hardware: [{ label: "Справочники", value: "см. раздел 04" }],
    lighting: [{ label: "Справочники", value: "см. раздел 05" }],
    rules: [
      { label: "Правил", value: String(rulesHealth.total) },
      { label: "Draft", value: String(rulesHealth.draft) },
      { label: "Снимков", value: String(rulesHealth.snapshots) },
    ],
    prices: [
      { label: "Позиций", value: count(prices, "PriceItem") },
      { label: "Битых priceRefs", value: String(pricing.missingPriceRefs) },
    ],
    dataSources: [
      { label: "Preliminary-нормы", value: String(rulesHealth.preliminary) },
      { label: "Битых ссылок", value: String(pricing.missingPriceRefs) },
    ],
    calculations: [{ label: "Источник", value: "projects.json" }],
    versions: [{ label: "Журнал", value: "append-only" }],
    projects: [
      { label: "Batch", value: batches.status === "fulfilled" ? String(batchList.length) : "—" },
      { label: "Jobs", value: jobs.status === "fulfilled" ? String(jobList.length) : "—" },
    ],
    diagnostics: [{ label: "Ошибок источников", value: String(errors.length) }],
    formulas: [{ label: "Формулы", value: "readonly" }],
  };

  return {
    counters,
    currentPriceVersion,
    recalculations,
    recentEvents,
    sectionMetrics,
    catalogCounts,
    moduleCounts,
    pricing,
    rules: rulesHealth,
    errors,
  };
}

export async function getSectionMetrics(
  id: AdminSectionId,
): Promise<AdminSectionMetric[]> {
  const overview = await getAdminOverview();
  return overview.sectionMetrics[id] ?? [];
}
