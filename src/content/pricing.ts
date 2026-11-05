import type { FurnitureType } from "@/lib/configurator/types";

export interface PromoDefinition {
  code: string;
  title: string;
  description: string;
  type: "percent" | "fixed";
  value: number;
  minSubtotal: number;
  maxDiscount?: number;
  appliesTo: FurnitureType[] | "all";
  active: boolean;
  demo: true;
}

export const PRICING = {
  version: "demo-2026-01",
  currency: "RUB" as const,
  rounding: 100,
  minOrder: 45000,
  kitchen: {
    baseCost: 12000,
    complexityPerExtraModule: 0.02,
    complexityMax: 1.12,
    bodyDepthReference: 60,
    countertopDepthAllowance: 0.04,
    plinthPerMeter: 1600,
    shelf: 1100,
    underCabinetLightPerMeter: 1900,
    sidePanel: 4800,
    sinkCutout: 3800,
    // Демо-ставка за внутреннюю вертикальную перегородку модуля под мойку.
    sinkPartition: 2400,
    // Бутылочница (наполнение секции или отдельный модуль) — 5000 ₽.
    bottleRack: 5000,
    hobCutout: 2800,
    ovenNiches: 2200,
    hingePerDoor: 390,
    softClosePerDoor: 460,
    pushToOpenPerDoor: 1350,
    drawerSlide: 1900,
    drawerSoftClose: 650,
  },
  wardrobe: {
    baseCost: 9000,
    bodyDepthReference: 60,
    bodyFactor: 1.15,
    plinthPerMeter: 1600,
    shelf: 1150,
    rod: 2400,
    drawer: 6200,
    drawerSoftClose: 650,
    ledPerSection: 3800,
    hingePerDoor: 390,
    softClosePerDoor: 460,
    pushToOpenPerDoor: 1350,
  },
} as const;

export const PROMOS: PromoDefinition[] = [
  {
    code: "DEMO10",
    title: "10% на кухню",
    description: "Демонстрационный промокод на кухонный гарнитур от 120 000 ₽.",
    type: "percent",
    value: 10,
    minSubtotal: 120000,
    maxDiscount: 30000,
    appliesTo: ["kitchen"],
    active: true,
    demo: true,
  },
  {
    code: "WARDROBE7",
    title: "7% на шкаф",
    description: "Демонстрационный промокод на корпусный шкаф от 70 000 ₽.",
    type: "percent",
    value: 7,
    minSubtotal: 70000,
    maxDiscount: 18000,
    appliesTo: ["wardrobe"],
    active: true,
    demo: true,
  },
  {
    code: "DEMO5000",
    title: "5 000 ₽ на проект",
    description: "Демонстрационная фиксированная скидка на заказ от 90 000 ₽.",
    type: "fixed",
    value: 5000,
    minSubtotal: 90000,
    appliesTo: "all",
    active: true,
    demo: true,
  },
];
