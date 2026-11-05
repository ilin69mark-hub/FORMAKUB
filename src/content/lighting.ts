import type { KitchenLightingConfig } from "@/lib/configurator/types";

/**
 * LED-подсветка верхнего ряда.
 *
 * Списки мощностей, напряжений и цветовых температур — варианты каталога
 * калькулятора, а не характеристики конкретной модели ленты.
 *
 * Поля со значением `source: "preliminary"` — предположения для предварительного
 * расчёта (максимальная длина непрерывного подключения, падение напряжения,
 * мощность блока питания). Они вынесены в параметры модели ленты, чтобы их
 * можно было заменить паспортными данными производителя без изменения расчёта.
 */

export const LED_VOLTAGES = [12, 24] as const;
export const LED_POWERS = [4.8, 9.6, 14.4, 19.2] as const;
export const LED_COLOR_TEMPS = [2700, 3000, 4000, 5000, 6000] as const;

/** Длина ленты, доступная к монтажу в торцах каждого шкафа, см. */
export const LED_END_MARGIN_CM = 2;

export interface LedProfileOption {
  id: KitchenLightingConfig["profile"];
  name: string;
  description: string;
  ratePerMeter: number;
}

export const LED_PROFILES: LedProfileOption[] = [
  {
    id: "surface",
    name: "Накладной",
    description: "Профиль крепится на дно шкафа, лента утоплена в алюминии.",
    ratePerMeter: 620,
  },
  {
    id: "recessed",
    name: "Врезной",
    description: "Профиль монтируется в паз дна шкафа, заподлицо с поверхностью.",
    ratePerMeter: 760,
  },
  {
    id: "corner",
    name: "Угловой",
    description: "Г-профиль в углу между дном шкафа и стеной — свет под углом.",
    ratePerMeter: 690,
  },
];

export interface LedDiffuserOption {
  id: KitchenLightingConfig["diffuser"];
  name: string;
  description: string;
  /** Стоимость рассеивателя, ₽/м. */
  ratePerMeter: number;
}

export const LED_DIFFUSERS: LedDiffuserOption[] = [
  {
    id: "clear",
    name: "Прозрачный",
    description: "Максимум света, точки диодов видны.",
    ratePerMeter: 420,
  },
  {
    id: "frosted",
    name: "Матовый",
    description: "Ровный световой пяток без точек от диодов.",
    ratePerMeter: 540,
  },
];

export interface LedControlOption {
  id: KitchenLightingConfig["control"];
  name: string;
  description: string;
  price: number;
}

export const LED_CONTROLS: LedControlOption[] = [
  {
    id: "switch",
    name: "Выключатель",
    description: "Механическое включение на стене или панели.",
    price: 780,
  },
  {
    id: "sensor",
    name: "Сенсор",
    description: "Включение касанием или взмахом руки под шкафом.",
    price: 1650,
  },
  {
    id: "dimmer",
    name: "Диммер",
    description: "Плавная регулировка яркости.",
    price: 2300,
  },
];

/** Доступная типоразмерная база блоков питания, Вт. */
export const LED_PSU_RATINGS = [20, 30, 60, 100, 150, 200, 300, 400] as const;

export const LED_PSU_PRICE: Record<number, number> = {
  20: 950,
  30: 1250,
  60: 1650,
  100: 2100,
  150: 2650,
  200: 3400,
  300: 4300,
  400: 5600,
};

/** Монтажные и вспомогательные компоненты. */
export const LED_END_CAP_PRICE = 110; // ₽/шт.
export const LED_CONNECTOR_PRICE = 260; // ₽/шт.
export const LED_INSTALL_PRICE_PER_METER = 450; // ₽/м

/** Резерв мощности блока питания: 20–25 % (берётся верхняя граница). */
export const LED_PSU_MARGIN = 1.25;
export const LED_PSU_MARGIN_LOW = 1.2;

export interface LedStripModel {
  id: string;
  power: (typeof LED_POWERS)[number];
  voltage: (typeof LED_VOLTAGES)[number];
  /** Цена ленты, ₽ за метр. */
  pricePerMeter: number;
  /**
   * Максимальная длина непрерывного подключения от одной точки питания, м.
   * Ограничение по падению напряжения.
   */
  maxContinuousRunM: number;
  /** Падение напряжения на максимально допустимой длине, %. */
  voltageDropPct: number;
  /** Допустимая суммарная мощность на один источник питания, Вт. */
  maxPsuW: number;
  /** Источник характеристик. */
  source: "preliminary" | "datasheet";
}

/**
 * Модели лент по мощности.
 *
 * `maxContinuousRunM`, `voltageDropPct` и `maxPsuW` — предварительные значения
 * для демонстрационного расчёта (`source: "preliminary"`). Заменяются на
 * паспортные характеристики выбранной ленты производителя.
 */
export const LED_STRIPS: LedStripModel[] = [
  {
    id: "led-24v-4w8",
    power: 4.8,
    voltage: 24,
    pricePerMeter: 780,
    maxContinuousRunM: 10,
    voltageDropPct: 6,
    maxPsuW: 120,
    source: "preliminary",
  },
  {
    id: "led-24v-9w6",
    power: 9.6,
    voltage: 24,
    pricePerMeter: 1150,
    maxContinuousRunM: 7.5,
    voltageDropPct: 8,
    maxPsuW: 150,
    source: "preliminary",
  },
  {
    id: "led-24v-14w4",
    power: 14.4,
    voltage: 24,
    pricePerMeter: 1500,
    maxContinuousRunM: 5,
    voltageDropPct: 8,
    maxPsuW: 200,
    source: "preliminary",
  },
  {
    id: "led-24v-19w2",
    power: 19.2,
    voltage: 24,
    pricePerMeter: 1900,
    maxContinuousRunM: 4,
    voltageDropPct: 9,
    maxPsuW: 300,
    source: "preliminary",
  },
  {
    id: "led-12v-4w8",
    power: 4.8,
    voltage: 12,
    pricePerMeter: 740,
    maxContinuousRunM: 5,
    voltageDropPct: 8,
    maxPsuW: 100,
    source: "preliminary",
  },
  {
    id: "led-12v-9w6",
    power: 9.6,
    voltage: 12,
    pricePerMeter: 1100,
    maxContinuousRunM: 3.5,
    voltageDropPct: 10,
    maxPsuW: 120,
    source: "preliminary",
  },
  {
    id: "led-12v-14w4",
    power: 14.4,
    voltage: 12,
    pricePerMeter: 1450,
    maxContinuousRunM: 2.5,
    voltageDropPct: 10,
    maxPsuW: 150,
    source: "preliminary",
  },
  {
    id: "led-12v-19w2",
    power: 19.2,
    voltage: 12,
    pricePerMeter: 1850,
    maxContinuousRunM: 2,
    voltageDropPct: 12,
    maxPsuW: 200,
    source: "preliminary",
  },
];

export function findLedStrip(
  power: number,
  voltage: number,
): LedStripModel | undefined {
  return (
    LED_STRIPS.find((item) => item.power === power && item.voltage === voltage) ??
    LED_STRIPS.find((item) => item.power === power)
  );
}

/**
 * Цвет свечения для выбранной цветовой температуры (приближение для
 * визуализации, K → HEX).
 */
export const LED_COLOR_HEX: Record<number, string> = {
  2700: "#ffd0a0",
  3000: "#ffdcac",
  4000: "#fff0dd",
  5000: "#fdf7ec",
  6000: "#e9f1ff",
};

export function ledColorHex(colorTemp: number): string {
  return LED_COLOR_HEX[colorTemp] ?? LED_COLOR_HEX[3000];
}
