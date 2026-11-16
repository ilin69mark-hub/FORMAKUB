import type { FurnitureConfig } from "./types";
import { defaultKitchen, defaultWardrobe, makeKitchenModule } from "./defaults";

/**
 * CA-T-305 — входные конфигурации golden-сценариев.
 *
 * Только детерминированные данные: явные id модулей/секций, фиксированные
 * материалы и настройки. Цены и версии берутся из текущего content-источника
 * Engine (до CA-T-306); production Storage не используется.
 */

export interface GoldenScenario {
  name: string;
  config: FurnitureConfig;
  /** Что именно фиксирует сценарий. */
  covers: string;
}

const defaultK = defaultKitchen();
const defaultW = defaultWardrobe();

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    name: "kitchen-default",
    config: defaultK,
    covers: "базовая кухня: материалы, фурнитура, столешница, цоколь, опоры, LED, мойка, пресеты",
  },
  {
    name: "kitchen-premium",
    config: {
      ...defaultK,
      bodyMaterial: "ldsp",
      bodyFinish: "oak",
      facadeMaterial: "mdf_pvc",
      facadeThickness: 19,
      facadeFinish: "graphite",
      facadeStyle: "shaker",
      handle: "bar",
      hinge: "soft",
      pushToOpen: false,
      countertop: "quartz",
      countertopThickness: 20,
      plinthMaterial: "aluminum",
      plinthThickness: 1.5,
      plinthFinish: "powder",
      plinthMount: "hidden",
      supports: { systemId: "heavy", maxSpanCm: 45, maxLoadKgPerLeg: 70 },
      sidePanels: 2,
      promoCode: "",
    },
    covers: "премиальные фасады МДФ ПВХ, ручки, столешница, алюминиевый цоколь, усиленные опоры, боковины",
  },
  {
    name: "kitchen-promo-complexity",
    config: {
      ...defaultK,
      modules: [
        ...defaultK.modules,
        makeKitchenModule("base", { id: "m-base", width: 60, shelves: 1 }),
        makeKitchenModule("oven", { id: "m-oven", width: 60 }),
        makeKitchenModule("bottle", { id: "m-bottle", width: 20 }),
      ],
      promoCode: "DEMO10",
    },
    covers: "9 модулей (максимальный коэффициент сложности), пресеты base/oven/bottle, промокод DEMO10",
  },
  {
    name: "kitchen-min-order",
    config: {
      ...defaultK,
      modules: [
        makeKitchenModule("bottle", { id: "m-bottle", width: 30, shelves: 0 }),
        makeKitchenModule("wall", { id: "m-wall-1", width: 80, shelves: 0 }),
      ],
      handle: "none",
      hinge: "standard",
      pushToOpen: false,
      plinth: false,
      underCabinetLighting: false,
      sidePanels: 0,
      promoCode: "",
    },
    covers: "граница минимальной стоимости заказа, кухня без цоколя/подсветки/ручек",
  },
  {
    name: "kitchen-led-12v",
    config: {
      ...defaultK,
      lighting: {
        voltage: 12,
        powerPerMeter: 4.8,
        colorTemp: 2700,
        profile: "recessed",
        diffuser: "clear",
        control: "dimmer",
      },
    },
    covers: "LED 12 В / 4.8 Вт·м, врезной профиль, прозрачный рассеиватель, диммер",
  },
  {
    name: "kitchen-plinth-negative-delta",
    config: {
      ...defaultK,
      plinthMaterial: "ldsp",
      plinthFinish: "pvc04",
      plinthThickness: 18,
    },
    covers: "цоколь ЛДСП с отрицательной signed-делью исполнения (pvc04, −120 ₽/м)",
  },
  {
    name: "wardrobe-default",
    config: defaultW,
    covers: "базовый шкаф: корпус, фасады, фурнитура, наполнение",
  },
  {
    name: "wardrobe-custom-promo",
    config: {
      ...defaultW,
      height: 260,
      widthMm: 2500,
      fullDepth: 650,
      partition: { positionMm: 1250 },
      sections: [
        { id: "s-1", shelves: [80, 120], rods: [], drawers: 0 },
        { id: "s-2", shelves: [100], rods: [210], drawers: 3 },
      ],
      bodyMaterial: "ldsp",
      bodyFinish: "oak",
      facadeMaterial: "mdf_pvc",
      facadeThickness: 19,
      facadeFinish: "graphite",
      facadeStyle: "handleless",
      handle: "none",
      hinge: "soft",
      pushToOpen: true,
      plinth: true,
      ledLighting: true,
      promoCode: "WARDROBE7",
    },
    covers: "нестандартный шкаф, фасады МДФ ПВХ, доводчики/push-to-open, цоколь, LED, промокод WARDROBE7",
  },
];
