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
/**
 * Действующие материалы фасадов + исторические id для чтения старых
 * проектов. Исторические значения не предлагаются в UI и не создают
 * новых CatalogItem/PriceItem.
 */
export type FacadeMaterialId =
  | "ldsp"
  | "mdf"
  | "mdf_pvc"
  | "veneer"
  | "glass"
  | "solid";

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
  /** Фактическая толщина выбранного фасада, мм (CA-T-513). */
  facadeThickness: number;
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
  shelves: number[];
  rods: number[];
  drawers: number;
  /** Блок ящиков (этап 1: исходные параметры, без геометрии). */
  drawerBlock?: WardrobeDrawerBlock;
  /** Тип штанги секции; по умолчанию standard. */
  rodType?: WardrobeRodType;
  /** Параметры выдвижной штанги (только при rodType = pullout). */
  pulloutRod?: WardrobePulloutRod;
  /** Ссылка на модель опоры обычной штанги. */
  rodSupportModelId?: string;
}

export type WardrobeFacadeMaterial = "ldsp" | "mdf_pvc";
export type WardrobeFacadeMount = "overlay";
export type WardrobeRodType = "standard" | "pullout";
export type WardrobePulloutExecution = "wire" | "ball";
export type WardrobeRunnerLoadClass = "standard" | "heavy";
export type WardrobeDrawerFrontType = "overlay" | "inset";

/** Параметры корпуса ящика — только исходные данные, без расчёта. */
export interface WardrobeDrawerBoxParams {
  sideThicknessMm: 16;
  frontThicknessMm: 16;
  backThicknessMm: 16;
  bottomThicknessMm: 3;
  bottomMount: "overlay-bottom";
}

/** Направляющие блока ящиков. */
export interface WardrobeDrawerRunner {
  type: "ball-bearing-side";
  lengthMm: 250 | 300 | 350 | 400 | 450 | 500 | 550;
  softClose: boolean;
  loadClass: WardrobeRunnerLoadClass;
  modelId?: string;
}

/** Исходные параметры блока ящиков. */
export interface WardrobeDrawerBlock {
  topMm: number;
  frontHeightsMm: number[];
  frontType: WardrobeDrawerFrontType;
  box: WardrobeDrawerBoxParams;
  runner: WardrobeDrawerRunner;
}

/** Параметры выдвижной штанги. */
export interface WardrobePulloutRod {
  lengthMm: 250 | 300 | 350 | 400 | 450 | 500;
  execution: WardrobePulloutExecution;
  loadClass: "budget" | "reinforced";
  modelId?: string;
}

/** Антресоль: отдельная высота и отдельное фасадное поле. */
export interface WardrobeAntresol {
  /** Высота антресоли; фасад использует общие параметры материала/толщины. */
  heightMm: number;
}

/** Ссылки на модели фурнитуры; отсутствие ссылки допустимо. */
export interface WardrobeHardwareRefs {
  hingeModelId?: string;
  shelfSupportModelId?: string;
  standardRodSupportModelId?: string;
  fastenerModelIds?: string[];
}

export interface WardrobeConfig {
  version: 1;
  kind: "wardrobe";
  height: number;
  /** Общая внешняя ширина шкафа, мм. */
  widthMm: number;
  /** Полная внешняя глубина: фасад + корпус + ХДФ, мм. */
  fullDepth: number;
  sections: WardrobeSection[];
  bodyMaterial: "ldsp";
  bodyFinish: string;
  /** Толщина корпуса, мм. */
  bodyThicknessMm: 16;
  /** Толщина задней стенки ХДФ, мм. */
  backPanelThicknessMm: 3;
  plinthHeightMm: 80;
  plinthInsetMm: 50;
  /** Центральная перегородка; null — перегородки нет. */
  partition: { positionMm: number } | null;
  /** Антресоль; null — антресоли нет. */
  antresol: WardrobeAntresol | null;
  facadeMaterial: WardrobeFacadeMaterial;
  facadeThickness: number;
  facadeMount: WardrobeFacadeMount;
  facadeFinish: string;
  facadeStyle: FacadeStyle;
  handle: HandleType;
  hinge: HingeType;
  pushToOpen: boolean;
  plinth: boolean;
  ledLighting: boolean;
  hardware?: WardrobeHardwareRefs;
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
  /** CA-GL-25: сохранённый проект, к которому относится заявка. */
  projectId?: string;
}

export interface StoredLead extends LeadPayload {
  id: string;
  createdAt: string;
  status: "new";
  price: PriceBreakdown | null;
}

/**
 * Зафиксированные версии Reference Data, использованные проектом
 * (дизайн §6.2/§6.3/§7.7, CA-T-108).
 *
 * Разрешение ссылок при пересчёте идёт строго по этим версиям, а не по
 * «живым» значениям справочников: правка `attrs`/границ пресета не должна
 * менять старые проекты (A5). Отсутствие поля у легаси-проекта трактуется
 * как `inferred` — версия выводится один раз и закрепляется при следующей
 * записи.
 */
export interface ProjectPins {
  /** `{ <catalog>: { <id>: <version> } }` — CatalogItem (§6.2). */
  catalogVersions?: Record<string, Record<string, string>>;
  /** `{ <family>: { <id>: <version> } }` — ModulePreset (§6.3). */
  presetVersions?: Record<string, Record<string, string>>;
}

/** Результат оценки условия строки Composition (E1–E4). */
export type CompositionTraceCondition =
  | "true"
  | "false"
  | "not_evaluated"
  | "error"
  | "not_required";

/** Статус строки компонентной трассировки. */
export type CompositionTraceLineStatus =
  | "resolved"
  | "excluded"
  | "quantity_unresolved"
  | "price_unresolved"
  | "blocked";

/** Код диагностики трассировки (расширяемый набор строк). */
export type CompositionTraceIssueCode =
  | "TRACE_CONDITION_NOT_EXECUTABLE"
  | "TRACE_QUANTITY_UNRESOLVED"
  | "TRACE_QUANTITY_INVALID"
  | "TRACE_PRICE_UNRESOLVED"
  | "TRACE_PRICE_UNIT_UNKNOWN"
  | "TRACE_UNIT_INCOMPATIBLE"
  | "TRACE_ALTERNATIVE_AMBIGUOUS"
  | "TRACE_ALTERNATIVE_INVALID"
  | "TRACE_ENGINE_BREAKDOWN_INVALID"
  /* Диагностика версий тарифа (только warning, расчёт не блокирует). */
  | "PRICE_VERSION_PIN_MISSING"
  | "PRICE_VERSION_DRIFT"
  /* Drift-предупреждения preflight, переносимые в trace без потери кода. */
  | "COMPOSITION_PRICE_VERSION_DRIFT"
  | "COMPOSITION_PRICE_SNAPSHOT_DRIFT"
  | "COMPOSITION_CATALOG_VERSION_DRIFT";

/**
 * Строка исторического CompositionTrace (E4).
 *
 * Поля — widened-типы (`relation`/`unit`/`status` — строки), чтобы снимок
 * оставался самостоятельным контрактом хранения и не зависел от
 * административной модели Composition.
 */
export interface CompositionTraceSnapshotLine {
  lineId: string;
  moduleType: string;
  relation: string;
  condition: CompositionTraceCondition;
  quantity: number | null;
  unit: string | null;
  quantitySource: "fixed" | "unresolved";
  priceItemId?: string;
  amount: number | null;
  priceItemUnit: string | null;
  priceAmount: number | null;
  status: CompositionTraceLineStatus;
}

export interface CompositionTraceSnapshotIssue {
  severity: "error" | "warning";
  code: CompositionTraceIssueCode;
  message: string;
  lineId?: string;
  entityId?: string;
}

/**
 * Самодостаточный исторический снимок компонентной трассировки (E4).
 *
 * Хранится внутри конкретного события `ProjectPriceHistory` вместе с
 * `breakdown`: воспроизведение не требует текущих Composition/PricingVersion/
 * PriceItem/RulesSnapshot. Поле — только для чтения, после записи не меняется.
 */
export interface CompositionTraceSnapshot {
  traceVersion: 1;
  /** Общий статус trace. `blocked` не блокирует расчёт Engine (E3/§6). */
  status: "computed" | "blocked";
  compositionVersionId: string;
  compositionContentHash: string;
  /** Снимок правил, закреплённый в Composition (null — не закреплён). */
  compositionRulesSnapshotId: string | null;
  /** Снимок правил, использованный в этом расчёте (null — legacy). */
  rulesSnapshotId: string | null;
  /** PricingVersion, использованная Engine. */
  enginePriceVersionId: string;
  /** Версия структуры ценового снимка. */
  enginePriceBaseSchema: number;
  /** PricingVersion, закреплённая в Composition (В-7; null — legacy). */
  pinnedPriceVersionId: string | null;
  catalogVersions?: Record<string, Record<string, string>>;
  priceItemVersions?: Record<string, string>;
  lines: CompositionTraceSnapshotLine[];
  warnings: CompositionTraceSnapshotIssue[];
  /** Время вычисления trace (ISO-8601), фиксируется вместе с расчётом. */
  computedAt: string;
}

/**
 * Неизменяемое событие успешно применённого расчёта (CA-T-306E).
 * Хранится внутри StoredProject.priceHistory[]; append-only на уровне домена.
 */
export interface ProjectPriceHistory {
  id: string;
  projectId: string;
  operationId: string;
  reason: "create" | "manual_recalc";
  fromPriceVersionId: string | null;
  toPriceVersionId: string;
  schemaVersion: number;
  calcVersion: string;
  oldPrice: number | null;
  newPrice: number;
  delta: number | null;
  breakdown: PriceBreakdown;
  breakdownVersion: number;
  /** Снимок состава, использованный при пересчёте (optional для старых записей). */
  compositionVersionId?: string;
  /**
   * E4: исторический снимок компонентной трассировки этого расчёта.
   * Optional/additive: записи до E4 валидны без него и **не** мигрируются.
   * При наличии — читается как есть, без пересчёта (см. Inspector).
   */
  compositionTrace?: CompositionTraceSnapshot;
  requestFingerprint: string;
  requestFingerprintVersion: string;
  computedAt: string;
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
  /** Версия прайса, использованная при сохранении (ADR-06, CA-T-304A). */
  priceVersion?: string;
  /**
   * Закреплённая опубликованная версия состава модулей (Composition Management).
   * Optional: старые проекты читаются без неё; новый расчёт без версии
   * состава не блокируется на этом этапе.
   */
  compositionVersionId?: string;
  /**
   * Закреплённый снимок управляемых правил комплектации (ADR-07 Q7-07/Q7-11).
   * Optional-метаданные-ссылка; `schemaVersion` не повышается. У легаси-проектов
   * отсутствует — новый расчёт блокируется, чтение сохранённых данных разрешено.
   */
  rulesSnapshotId?: string;
  /** Версии ссылок Reference Data (§6.2/§6.3/§7.7, CA-T-108). */
  pins?: ProjectPins;
  /** История расчётов (CA-T-306E); у старых записей отсутствует → []. */
  priceHistory?: ProjectPriceHistory[];
  price: PriceBreakdown;
  createdAt: string;
  updatedAt: string;
}
