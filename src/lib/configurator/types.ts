export type FurnitureType = "kitchen" | "wardrobe";

export type KitchenModuleType =
  | "base"
  | "sink"
  | "hob"
  | "drawers"
  | "wall"
  | "tall"
  | "oven"
  | "bottle";

export type FacadeStyle = "flat" | "shaker" | "handleless";
export type HandleType = "bar" | "knob" | "profile" | "none";
export type HingeType = "standard" | "soft";
export type BodyMaterialId = "ldsp" | "mdf" | "plywood";
export type FacadeMaterialId = "ldsp" | "mdf" | "veneer" | "glass" | "solid";

/** Материал цоколя. */
export type PlinthMaterialId =
  | "ldsp"
  | "mdf"
  | "plastic"
  | "aluminum"
  | "stainless";

/** Крепление цоколя к опорам. */
export type PlinthMountId = "clips" | "hidden";

/** Система опор (ножек) нижнего ряда. */
export type SupportSystemId = "standard" | "heavy";

/** Настройки LED-подсветки верхнего ряда. */
export interface KitchenLightingConfig {
  /** Напряжение питания ленты, В. */
  voltage: 12 | 24;
  /** Линейная мощность ленты, Вт/м. */
  powerPerMeter: 4.8 | 9.6 | 14.4 | 19.2;
  /** Цветовая температура, K. */
  colorTemp: 2700 | 3000 | 4000 | 5000 | 6000;
  /** Профиль подсветки. */
  profile: "surface" | "recessed" | "corner";
  /** Рассеиватель. */
  diffuser: "clear" | "frosted";
  /** Управление. */
  control: "switch" | "sensor" | "dimmer";
}

/**
 * Настройки системы опор. Значения вынесены в конфигурацию, чтобы можно было
 * подставить паспортные характеристики конкретной производственной системы.
 */
export interface KitchenSupportSettings {
  systemId: SupportSystemId;
  /** Допустимое расстояние между опорами, см. */
  maxSpanCm: number;
  /** Допустимая нагрузка на одну опору, кг. */
  maxLoadKgPerLeg: number;
}

export type CountertopId =
  | "ldsp_hpl"
  | "compact_hpl"
  | "acrylic"
  | "quartz"
  | "porcelain"
  | "solid_wood";

/** Наполнение одной свободной секции модуля под мойку. */
export interface KitchenSinkStorage {
  shelves: number;
  drawers: number;
  /**
   * Бутылочница: корпус, см (15/20/30; чистый проём = корпус − 32 мм).
   * Занимает секцию целиком — полки и ящики не сочетаются. 0 — не выбрана.
   */
  bottle?: 15 | 20 | 30;
}

/** Положение мойки внутри модуля: слева, по центру или справа. */
export type KitchenSinkPosition = "left" | "center" | "right";

/** Монтажный вырез столешницы по данным производителя. Все размеры в миллиметрах. */
export interface KitchenSinkCutout {
  width: number;
  depth: number;
}

export interface KitchenModule {
  id: string;
  type: KitchenModuleType;
  width: number;
  height: number;
  depth: number;
  shelves: number;
  drawers: number;
  /**
   * Модуль под мойку: количество распашных фасадов (2 или 3).
   * Не задано — выводится из ширины модуля (по умолчанию 2).
   */
  sinkFacades?: 2 | 3;
  /**
   * Модуль под мойку (2 фасада): дополнительная внутренняя перегородка.
   * При трёх фасадах перегородки конструктивно обязательны и этим флагом не дублируются.
   */
  sinkPartition?: boolean;
  /**
   * Модуль под мойку: наполнение свободных секций (зона коммуникаций не заполняется).
   * Индекс 0 — первая свободная секция слева направо.
   */
  sinkStorage?: KitchenSinkStorage[];
  /**
   * Модуль под мойку: габариты мойки в миллиметрах.
   * В интерфейсе отображаются в сантиметрах (шаг 1 см).
   * Не заданы — берутся значения по умолчанию (см. SINK_DEFAULTS).
   */
  sinkWidth?: number;
  /** Глубина мойки в миллиметрах (от переднего до заднего края). */
  sinkDepth?: number;
  /** Положение мойки внутри модуля. По умолчанию — по центру. */
  sinkPosition?: KitchenSinkPosition;
  /**
   * Отступ от бокового края корпуса до внешнего края мойки, в миллиметрах.
   * Используется при положении слева/справа; при центральном — игнорируется.
   */
  sinkOffset?: number;
  /** Монтажный вырез (по документации производителя), в миллиметрах. */
  sinkCutout?: KitchenSinkCutout;
  /**
   * Способ опирания модуля, не зависит от типа модуля.
   * `true` — техника (например, встроенная ПММ или стиральная машина в нише)
   * опирается на собственные регулируемые ножки, мебельные опоры модулю не
   * нужны. Признак задаётся характеристиками оборудования и способом монтажа,
   * а не названием модуля: если техника не имеет собственных опор или её
   * монтажная схема требует мебельных опор, флаг не устанавливается.
   */
  ownSupports?: boolean;
}

export interface KitchenConfig {
  version: 1;
  kind: "kitchen";
  modules: KitchenModule[];
  bodyMaterial: BodyMaterialId;
  bodyFinish: string;
  facadeMaterial: FacadeMaterialId;
  facadeFinish: string;
  facadeStyle: FacadeStyle;
  countertop: CountertopId;
  /** Толщина столешницы в миллиметрах. */
  countertopThickness: number;
  handle: HandleType;
  hinge: HingeType;
  pushToOpen: boolean;
  plinth: boolean;
  /** Высота цоколя в сантиметрах (10–15). */
  plinthHeight: number;
  /** Материал цоколя. */
  plinthMaterial: PlinthMaterialId;
  /** Толщина цоколя, мм. */
  plinthThickness: number;
  /** Исполнение цоколя (зависит от материала). */
  plinthFinish: string;
  /** Крепление цоколя к опорам. */
  plinthMount: PlinthMountId;
  underCabinetLighting: boolean;
  /** Настройки подсветки верхнего ряда (используются при `underCabinetLighting`). */
  lighting: KitchenLightingConfig;
  /** Настройки системы опор нижнего ряда. */
  supports: KitchenSupportSettings;
  sidePanels: number;
  promoCode?: string;
}

export interface WardrobeSection {
  id: string;
  width: number;
  shelves: number[];
  rods: number[];
  drawers: number;
}

export interface WardrobeConfig {
  version: 1;
  kind: "wardrobe";
  height: number;
  depth: number;
  sections: WardrobeSection[];
  bodyMaterial: BodyMaterialId;
  bodyFinish: string;
  facadeMaterial: FacadeMaterialId;
  facadeFinish: string;
  facadeStyle: FacadeStyle;
  handle: HandleType;
  hinge: HingeType;
  pushToOpen: boolean;
  plinth: boolean;
  ledLighting: boolean;
  promoCode?: string;
}

export type FurnitureConfig = KitchenConfig | WardrobeConfig;

export type ConfigPreset = "kitchen" | "wardrobe" | "dressing";

export interface ValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface PromoResult {
  code: string;
  title: string;
  discount: number;
  valid: boolean;
  reason?: string;
  demo: boolean;
}

export interface PriceLine {
  label: string;
  amount: number;
  detail?: string;
}

export interface PriceBreakdown {
  currency: "RUB";
  baseCost: number;
  bodyCost: number;
  frontsCost: number;
  fittingsCost: number;
  optionsCost: number;
  complexityFactor: number;
  subtotal: number;
  discount: number;
  total: number;
  minOrderApplied: boolean;
  lines: PriceLine[];
  promo: PromoResult | null;
  disclaimer: string;
}

export interface LeadCustomer {
  name: string;
  contact: string;
  email?: string;
  preferredContact: "phone" | "telegram" | "whatsapp" | "email";
  comment?: string;
  consent: true;
}

export type FurnitureInterest =
  | "kitchen"
  | "wardrobe"
  | "dressing"
  | "dressers"
  | "other";

export interface LeadPayload {
  config?: FurnitureConfig;
  customer: LeadCustomer;
  source?: string;
  interest?: FurnitureInterest;
}

export interface StoredLead extends LeadPayload {
  id: string;
  createdAt: string;
  status: "new";
  price: PriceBreakdown | null;
}

export interface StoredProject {
  id: string;
  config: FurnitureConfig;
  /**
   * Версия структуры записи (дизайн §5.1, CA-T-104).
   * Отсутствует у старых проектов — при чтении трактуется как 1 (§5.4).
   */
  schemaVersion?: number;
  /** Версия сборки движка, выполнившей расчёт (§5.1, CA-T-107). */
  calcVersion?: string;
  price: PriceBreakdown;
  createdAt: string;
  updatedAt: string;
}
