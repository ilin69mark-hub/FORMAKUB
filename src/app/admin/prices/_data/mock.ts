import type { PriceItem, PricingVersion } from "@/lib/admin/schema";

/**
 * CA-T-504 — изолированные mock-данные прайс-борда.
 *
 * Публикация и пересчёт не подключены: защищённый admin-API и auth
 * (CA-T-609/602) отсутствуют, поэтому раздел работает как UI-прототип на
 * изолированных данных. Реальные ставки в панель не подставляются и
 * production-операции не имитируются.
 *
 * Мёртвые поля из аудита (`plinthPerMeter`, `sinkPartition`,
 * `underCabinetLightPerMeter`, `countertopDepthAllowance`) не включены,
 * чтобы не показывать их действующими (ТЗ раздел 06, требование 5.9).
 */

const CREATED_AT = "2026-11-01T09:00:00.000Z";

function item(
  id: string,
  label: string,
  scope: PriceItem["scope"],
  unit: PriceItem["unit"],
  groupId: string,
  usage: PriceItem["usage"] = "used",
): PriceItem {
  return {
    id,
    scope,
    label,
    unit,
    usage,
    status: "active",
    editable: true,
    sourceRef: `src/content/pricing.ts:PRICING.${id}`,
    groupId,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    updatedBy: "seed",
  };
}

export const PRICE_ITEMS: PriceItem[] = [
  item("kitchen.body.ldsp.rate", "Корпус ЛДСП", "kitchen", "RUB_PER_SQM", "body"),
  item("kitchen.body.hpl.rate", "Корпус HPL", "kitchen", "RUB_PER_SQM", "body"),
  item("kitchen.facade.ldsp.rate", "Фасад ЛДСП", "kitchen", "RUB_PER_SQM", "facade"),
  item("kitchen.facade.mdf.rate", "Фасад МДФ", "kitchen", "RUB_PER_SQM", "facade"),
  item("kitchen.countertop.quartz.rate", "Столешница кварц", "kitchen", "RUB_PER_M", "countertop"),
  item("kitchen.hingePerDoor", "Петля на дверь", "kitchen", "RUB_PER_PCS", "hardware"),
  item("kitchen.drawerPerModule", "Направляющие на модуль", "kitchen", "RUB_PER_PCS", "hardware"),
  item("kitchen.hobCutout", "Вырез под варочную панель", "kitchen", "RUB_PER_PCS", "hardware"),
  item("kitchen.delivery", "Доставка", "shared", "RUB", "logistics", "unused"),
  item("wardrobe.body.ldsp.rate", "Корпус шкафа ЛДСП", "wardrobe", "RUB_PER_SQM", "body"),
  item("wardrobe.facade.ldsp.rate", "Фасад шкафа ЛДСП", "wardrobe", "RUB_PER_SQM", "facade"),
  item("wardrobe.hingePerDoor", "Петля шкафа", "wardrobe", "RUB_PER_PCS", "hardware"),
];

const ARCHIVED: PriceItem = {
  ...item("kitchen.countertop.acrylic.rate", "Столешница акрил (снята)", "kitchen", "RUB_PER_M", "countertop", "unused"),
  status: "archived",
  updatedAt: "2026-11-05T09:00:00.000Z",
};
PRICE_ITEMS.push(ARCHIVED);

export const PUBLISHED_VERSION: PricingVersion = {
  id: "price-2026.11",
  label: "Прайс 2026.11",
  status: "published",
  snapshot: [
    { priceItemId: "kitchen.body.ldsp.rate", amount: 5200 },
    { priceItemId: "kitchen.body.hpl.rate", amount: 7600 },
    { priceItemId: "kitchen.facade.ldsp.rate", amount: 5600 },
    { priceItemId: "kitchen.facade.mdf.rate", amount: 9200 },
    { priceItemId: "kitchen.countertop.quartz.rate", amount: 29400 },
    { priceItemId: "kitchen.hingePerDoor", amount: 320 },
    { priceItemId: "kitchen.drawerPerModule", amount: 2100 },
    { priceItemId: "kitchen.hobCutout", amount: 1800 },
    { priceItemId: "wardrobe.body.ldsp.rate", amount: 5200 },
    { priceItemId: "wardrobe.facade.ldsp.rate", amount: 5600 },
    { priceItemId: "wardrobe.hingePerDoor", amount: 280 },
  ],
  rules: {
    rounding: 100,
    minOrder: 45000,
    complexityPerExtraModule: 0.02,
    complexityMax: 1.12,
    bodyFactor: 1.15,
    bodyDepthReference: 60,
  },
  promos: [
    {
      code: "KITCHEN10",
      title: "Кухня −10%",
      description: "Скидка на кухни",
      type: "percent",
      value: 10,
      minSubtotal: 120000,
      maxDiscount: 30000,
      appliesTo: ["kitchen"],
      active: true,
      demo: true,
    },
    {
      code: "WARDROBE5",
      title: "Шкаф −5%",
      description: "Скидка на шкафы",
      type: "percent",
      value: 5,
      minSubtotal: 80000,
      maxDiscount: 15000,
      appliesTo: ["wardrobe"],
      active: true,
      demo: true,
    },
  ],
  baseSchema: 1,
  publishedSeq: 3,
  createdAt: "2026-11-01T09:00:00.000Z",
  createdBy: "seed",
  publishedAt: "2026-11-08T09:40:00.000Z",
  publishedBy: "seed",
};

export const DRAFT_VERSION: PricingVersion = {
  ...PUBLISHED_VERSION,
  id: "price-2026.12-draft",
  label: "Прайс 2026.12 (черновик)",
  status: "draft",
  publishedSeq: undefined,
  publishedAt: undefined,
  publishedBy: undefined,
  createdAt: "2026-11-09T08:00:00.000Z",
  createdBy: "seed",
  snapshot: [
    ...PUBLISHED_VERSION.snapshot.map((entry) =>
      entry.priceItemId === "kitchen.hingePerDoor"
        ? { ...entry, amount: 350 }
        : entry,
    ),
    { priceItemId: "kitchen.sinkCutout", amount: 2400 },
  ],
  rules: {
    ...PUBLISHED_VERSION.rules,
    minOrder: 47000,
  },
  promos: PUBLISHED_VERSION.promos.map((promo) =>
    promo.code === "WARDROBE5" ? { ...promo, value: 6 } : promo,
  ),
};

export interface MockAffectedProject {
  id: string;
  type: "kitchen" | "wardrobe";
  priceVersion: string;
}

/** Mock-число проектов для подтверждения; реальные данные — CA-T-505/609. */
export const AFFECTED_PROJECTS: MockAffectedProject[] = [
  { id: "project-001", type: "kitchen", priceVersion: "price-2026.11" },
  { id: "project-002", type: "kitchen", priceVersion: "price-2026.11" },
  { id: "project-003", type: "kitchen", priceVersion: "price-2026.11" },
  { id: "project-004", type: "wardrobe", priceVersion: "price-2026.11" },
  { id: "project-005", type: "wardrobe", priceVersion: "price-2026.11" },
  { id: "project-006", type: "kitchen", priceVersion: "price-2026.11" },
  { id: "project-007", type: "wardrobe", priceVersion: "price-2026.11" },
];
