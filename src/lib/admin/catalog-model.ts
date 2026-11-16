import type { CatalogItem } from "./schema";

/**
 * Read-model Calculation Admin: группы каталогов, группы мебельных модулей и
 * фактический состав модулей.
 *
 * Источник истины не дублируется:
 * - элементы каталогов читаются из существующего `CatalogItem`;
 * - диапазоны и дефолты модулей — из `ModulePreset`/`KITCHEN_MODULES`;
 * - состав и количества — из фактического кода расчёта (`engine.ts`,
 *   `sink.ts`, `facade-geometry.ts`, `supports.ts`). Здесь нет формул и
 *   вычислительной логики: только описания и ссылки на реализацию.
 *
 * `MODULE_COMPOSITION` — статическая карта «тип модуля → компоненты». Она
 * обязана соответствовать коду; `catalog-model.test.ts` проверяет покрытие
 * всех типов и разрешимость ссылок на PriceItem.
 */

export type CoverageStatus = "CONFIRMED" | "PARTIAL" | "NOT_FOUND";

export interface CatalogGroup {
  id: string;
  label: string;
  description: string;
  kinds: readonly CatalogItem["catalog"][];
  coverage: CoverageStatus;
  /** Что фактически представляет группу, если отдельного справочника нет. */
  coverageNote: string;
}

/**
 * Целевая группировка интерфейса (§C задания). Не создаёт коллекций:
 * группа либо объединяет существующие `catalog` kinds, либо явно показывает
 * `PARTIAL`/`NOT_FOUND`.
 */
export const CATALOG_GROUPS: readonly CatalogGroup[] = [
  {
    id: "body-materials",
    label: "Материалы корпуса",
    description: "Материалы корпуса и их действующие тарифы за м².",
    kinds: ["bodyMaterial"],
    coverage: "CONFIRMED",
    coverageNote: "CatalogItem.bodyMaterial + PriceItem catalog.body.*",
  },
  {
    id: "facades",
    label: "Фасады",
    description: "Материалы и стили фасадов; множитель стиля — PriceItem.",
    kinds: ["facadeMaterial", "facadeStyle"],
    coverage: "CONFIRMED",
    coverageNote: "CatalogItem.facadeMaterial / facadeStyle",
  },
  {
    id: "countertops",
    label: "Столешницы",
    description: "Материалы столешниц, толщины и тариф за погонный метр.",
    kinds: ["countertop"],
    coverage: "CONFIRMED",
    coverageNote: "CatalogItem.countertop (attrs.thicknesses)",
  },
  {
    id: "edges",
    label: "Кромочные материалы",
    description: "Кромка ПВХ 0,4/1/2 мм.",
    kinds: [],
    coverage: "PARTIAL",
    coverageNote:
      "Отдельного CatalogItem нет: представлено PriceItem wardrobe.edgePvc04/edgePvc1/edgePvc2 и геометрией wardrobe-edge.ts.",
  },
  {
    id: "plinth",
    label: "Цоколь",
    description: "Материалы, исполнения и крепление цоколя.",
    kinds: ["plinthMaterial", "plinthFinish", "plinthMount"],
    coverage: "CONFIRMED",
    coverageNote:
      "CatalogItem.plinth*; надбавка исполнения — SignedAdjustment, не PriceItem.",
  },
  {
    id: "handles",
    label: "Ручки",
    description: "Типы ручек и тариф за штуку.",
    kinds: ["handle"],
    coverage: "CONFIRMED",
    coverageNote: "CatalogItem.handle + PriceItem catalog.handle.*",
  },
  {
    id: "hinges",
    label: "Петли",
    description: "Петли и доводчики.",
    kinds: [],
    coverage: "PARTIAL",
    coverageNote:
      "Отдельного CatalogItem нет: тарифы kitchen.hingePerDoor, kitchen.softClosePerDoor, wardrobe.hingePerDoor; нормы шкафа — Managed Rules.",
  },
  {
    id: "slides",
    label: "Направляющие",
    description: "Направляющие и доводчики ящиков.",
    kinds: [],
    coverage: "PARTIAL",
    coverageNote:
      "Отдельного CatalogItem нет: тарифы kitchen.drawerSlide, kitchen.drawerSoftClose, wardrobe.drawer, wardrobe.drawerSoftClose.",
  },
  {
    id: "lift-mechanisms",
    label: "Подъёмные механизмы",
    description: "Подъёмные механизмы фасадов.",
    kinds: [],
    coverage: "NOT_FOUND",
    coverageNote:
      "В текущей расчётной модели не обнаружены: ни CatalogItem, ни PriceItem, ни код.",
  },
  {
    id: "supports",
    label: "Опоры и ножки",
    description: "Системы опор, клипсы, винты и анкеры.",
    kinds: ["supportSystem"],
    coverage: "CONFIRMED",
    coverageNote:
      "CatalogItem.supportSystem; тарифы catalog.support.<system>.*",
  },
  {
    id: "hangers",
    label: "Подвесы и крепления",
    description: "Навесные крепления верхних модулей.",
    kinds: [],
    coverage: "NOT_FOUND",
    coverageNote:
      "Отдельной сущности нет: верхние модули в расчёте не тарифицируют подвесы.",
  },
  {
    id: "fasteners",
    label: "Крепёж",
    description: "Крепёж цоколя и пеналов.",
    kinds: [],
    coverage: "PARTIAL",
    coverageNote:
      "Представлено атрибутами supportSystem (clipsPerLeg, screwsPerLeg, tallAnchorSpacingCm) и тарифами clip/screw/anchor.",
  },
  {
    id: "assembly",
    label: "Сборочные элементы",
    description: "Полки, штанги, перегородки, кромка.",
    kinds: [],
    coverage: "PARTIAL",
    coverageNote:
      "Отдельных CatalogItem нет: полки/штанги/ящики/кромка — PriceItem и геометрия шкафа; перегородки мойки отдельно не тарифицируются.",
  },
  {
    id: "additional",
    label: "Дополнительные комплектующие",
    description: "Мойки, промокоды и осветительные комплектующие.",
    kinds: [
      "sinkSize",
      "promo",
      "ledStrip",
      "ledProfile",
      "ledDiffuser",
      "ledControl",
      "ledPsu",
    ],
    coverage: "CONFIRMED",
    coverageNote: "CatalogItem.sinkSize/promo/led*",
  },
  {
    id: "materials-thickness",
    label: "Материалы и толщины",
    description: "Толщины, заявленные в атрибутах материалов.",
    kinds: ["bodyMaterial", "facadeMaterial", "countertop", "plinthMaterial"],
    coverage: "PARTIAL",
    coverageNote:
      "Сводный вид по attrs существующих CatalogItem; отдельной сущности «материал» нет.",
  },
] as const;

export function catalogGroupForKind(
  kind: CatalogItem["catalog"],
): CatalogGroup | undefined {
  return CATALOG_GROUPS.find((group) => group.kinds.includes(kind));
}

/** ─── Мебельные модули ─────────────────────────────────────────────────── */

export interface ModuleGroup {
  id: string;
  label: string;
  description: string;
  /** Типы кухонных модулей; пусто — шкаф не является модульным. */
  kitchenTypes: readonly string[];
}

export const KITCHEN_MODULE_GROUPS: readonly ModuleGroup[] = [
  {
    id: "base",
    label: "Нижние модули",
    description: "Закрытые напольные модули с полками.",
    kitchenTypes: ["base"],
  },
  {
    id: "sink",
    label: "Модули под мойку",
    description: "Корпус с раскладкой секций, коммуникациями и вырезами.",
    kitchenTypes: ["sink"],
  },
  {
    id: "hob",
    label: "Модули под варочную поверхность",
    description: "Тумба с вырезом в столешнице.",
    kitchenTypes: ["hob"],
  },
  {
    id: "drawers",
    label: "Модули с ящиками",
    description: "Блок выдвижных ящиков с направляющими.",
    kitchenTypes: ["drawers"],
  },
  {
    id: "wall",
    label: "Навесные модули",
    description: "Верхний ряд, опциональная подсветка.",
    kitchenTypes: ["wall"],
  },
  {
    id: "tall",
    label: "Пеналы и высокие модули",
    description: "Высокий корпус от пола.",
    kitchenTypes: ["tall"],
  },
  {
    id: "oven",
    label: "Модули под духовку",
    description: "Пенал с нишей под встроенную технику.",
    kitchenTypes: ["oven"],
  },
  {
    id: "bottle",
    label: "Бутылочницы",
    description: "Отдельный узкий модуль и встроенная секция мойки.",
    kitchenTypes: ["bottle"],
  },
] as const;

export interface WardrobeConfigElement {
  id: string;
  label: string;
  relation: "required" | "conditional" | "optional";
  detail: string;
  priceItemIds: readonly string[];
  priceReference?: string;
  source: string;
}

/**
 * Шкаф не является модульной системой: 1–2 секции и элементы наполнения.
 * Не создаём фиктивные ModulePreset/типы модулей.
 */
export const WARDROBE_MODEL = {
  status: "CONFIRMED" as CoverageStatus,
  note:
    "Шкаф — конфигурация (габариты + 1–2 секции + опции), а не набор модулей. ModulePreset для шкафа не существует.",
  elements: [
    {
      id: "sections",
      label: "Секции",
      relation: "required",
      detail: "1 секция; вторая — при перегородке. Максимум 2 секции (zod/validation).",
      priceItemIds: [],
      source: "src/lib/configurator/schema.ts:wardrobeConfigSchema",
    },
    {
      id: "shelves",
      label: "Полки",
      relation: "optional",
      detail: "Количество задаётся высотами полок в секции.",
      priceItemIds: ["wardrobe.shelf"],
      source: "src/lib/configurator/engine.ts:calculateWardrobeBreakdown",
    },
    {
      id: "rods",
      label: "Штанги",
      relation: "optional",
      detail: "Обычные и выдвижные; отдельного тарифа для выдвижной нет.",
      priceItemIds: ["wardrobe.rod"],
      source: "src/lib/configurator/wardrobe-components.ts:wardrobeRodCount",
    },
    {
      id: "drawers",
      label: "Ящики",
      relation: "optional",
      detail: "Тариф за штуку; параметры drawerBlock на цену не влияют.",
      priceItemIds: ["wardrobe.drawer", "wardrobe.drawerSoftClose"],
      source: "src/lib/configurator/wardrobe-components.ts:wardrobeDrawerCount",
    },
    {
      id: "facades",
      label: "Фасады",
      relation: "required",
      detail: "Двери и антресоль; площадь по геометрии, материал и стиль — каталог.",
      priceItemIds: [],
      priceReference:
        "catalog.facade.<material>.ratePerSqm · catalog.facadeStyle.<style>.multiplier",
      source: "src/lib/configurator/wardrobe-facade-geometry.ts",
    },
    {
      id: "hinges",
      label: "Петли",
      relation: "required",
      detail:
        "Количество — по нормам Managed Rules rule-wardrobe-hinge-band-* и плотности фасада.",
      priceItemIds: ["wardrobe.hingePerDoor", "wardrobe.softClosePerDoor"],
      source: "src/lib/configurator/wardrobe-hinges.ts:wardrobeHingePlan",
    },
    {
      id: "edge",
      label: "Кромка",
      relation: "required",
      detail: "ПВХ 0,4/1/2 мм по периметрам деталей.",
      priceItemIds: [
        "wardrobe.edgePvc04",
        "wardrobe.edgePvc1",
        "wardrobe.edgePvc2",
      ],
      source: "src/lib/configurator/wardrobe-edge.ts:wardrobeEdgePlan",
    },
    {
      id: "plinth",
      label: "Цоколь",
      relation: "optional",
      detail: "Тариф за погонный метр ширины шкафа.",
      priceItemIds: ["wardrobe.plinthPerMeter"],
      source: "src/lib/configurator/engine.ts:calculateWardrobeBreakdown",
    },
    {
      id: "led",
      label: "Подсветка",
      relation: "optional",
      detail: "Тариф за секцию.",
      priceItemIds: ["wardrobe.ledPerSection"],
      source: "src/lib/configurator/engine.ts:calculateWardrobeBreakdown",
    },
  ] satisfies readonly WardrobeConfigElement[],
} as const;

/** ─── Состав кухонного модуля ──────────────────────────────────────────── */

export type ComponentRelation =
  | "required"
  | "conditional"
  | "optional"
  | "alternative";

export interface ModuleComponent {
  id: string;
  label: string;
  relation: ComponentRelation;
  /** Условие добавления; null — безусловно. */
  condition: string | null;
  /** Описание источника количества. Ссылка на код, без формул. */
  quantitySource: string;
  unit: string;
  /** PriceItem.id, участвующие в стоимости компонента (фиксированные). */
  priceItemIds: readonly string[];
  /** Шаблон ссылки, если тариф зависит от выбранного CatalogItem. */
  priceReference?: string;
  /** Связанный элемент каталога, если он есть. */
  catalog?: { kind: CatalogItem["catalog"]; id?: string };
  /** Файл/функция — фактическое место реализации. */
  evidence: string;
}

export interface ModuleComposition {
  type: string;
  label: string;
  zone: "floor" | "upper";
  status: CoverageStatus;
  components: readonly ModuleComponent[];
}

const ENGINE_KITCHEN = "src/lib/configurator/engine.ts:calculateKitchenBreakdown";
const FACADE = "src/lib/configurator/facade-geometry.ts";
const SINK = "src/lib/configurator/sink.ts";

const PRESET_COMPONENT: ModuleComponent = {
  id: "preset",
  label: "Базовый пресет модуля (basePrice)",
  relation: "required",
  condition: null,
  quantitySource: "1 на модуль; key = kitchen.module.<type>.basePrice",
  unit: "шт.",
  priceItemIds: [],
  evidence: ENGINE_KITCHEN,
};

const BODY_COMPONENT: ModuleComponent = {
  id: "body",
  label: "Корпус (ЛДСП 16 мм)",
  relation: "required",
  condition: null,
  quantitySource:
    "Площадь модуля × глубинный коэффициент; реализация: area/bodyDepthReference",
  unit: "м²",
  priceItemIds: ["catalog.body.ldsp.ratePerSqm"],
  catalog: { kind: "bodyMaterial", id: "ldsp" },
  evidence: ENGINE_KITCHEN,
};

const FACADE_COMPONENT: ModuleComponent = {
  id: "facade",
  label: "Фасады",
  relation: "conditional",
  condition: "Только при наличии створок/фронтов; для drawers — всегда.",
  quantitySource:
    "Площадь фасадов; число створок — facadeDoorCount, раскладка мойки — sinkLayout",
  unit: "м²",
  priceItemIds: [],
  priceReference:
    "catalog.facade.<material>.ratePerSqm · catalog.facadeStyle.<style>.multiplier",
  catalog: { kind: "facadeMaterial" },
  evidence: FACADE,
};

const HANDLE_COMPONENT: ModuleComponent = {
  id: "handle",
  label: "Ручки",
  relation: "conditional",
  condition: "handle ≠ none и есть створки/ящики",
  quantitySource: "По числу створок/фронтов",
  unit: "шт.",
  priceItemIds: [],
  priceReference: "catalog.handle.<handle>.rate",
  catalog: { kind: "handle" },
  evidence: ENGINE_KITCHEN,
};

const HINGE_COMPONENT: ModuleComponent = {
  id: "hinge",
  label: "Петли",
  relation: "conditional",
  condition: "Есть распашные створки",
  quantitySource: "По числу створок",
  unit: "шт.",
  priceItemIds: ["kitchen.hingePerDoor"],
  evidence: ENGINE_KITCHEN,
};

const SOFT_CLOSE_COMPONENT: ModuleComponent = {
  id: "soft-close",
  label: "Доводчики петель",
  relation: "conditional",
  condition: "hinge = soft",
  quantitySource: "По числу створок",
  unit: "шт.",
  priceItemIds: ["kitchen.softClosePerDoor"],
  evidence: ENGINE_KITCHEN,
};

const PUSH_TO_OPEN_COMPONENT: ModuleComponent = {
  id: "push-to-open",
  label: "Push-to-open",
  relation: "conditional",
  condition: "pushToOpen = true",
  quantitySource: "По числу створок",
  unit: "шт.",
  priceItemIds: ["kitchen.pushToOpenPerDoor"],
  evidence: ENGINE_KITCHEN,
};

const SHELF_COMPONENT: ModuleComponent = {
  id: "shelf",
  label: "Полки",
  relation: "optional",
  condition: "shelves > 0",
  quantitySource: "По количеству полок модуля/секции",
  unit: "шт.",
  priceItemIds: ["kitchen.shelf"],
  evidence: ENGINE_KITCHEN,
};

const SUPPORT_COMPONENT: ModuleComponent = {
  id: "supports",
  label: "Опоры (ножки)",
  relation: "conditional",
  condition: "Напольный модуль, ownSupports ≠ true",
  quantitySource: "Позиции опор: supports.ts:positionsForModule",
  unit: "шт.",
  priceItemIds: [],
  priceReference:
    "catalog.support.<system>.legPrice/clipPrice/screwPrice/anchorPrice",
  catalog: { kind: "supportSystem" },
  evidence: "src/lib/configurator/supports.ts:computeSupports",
};

const DRAWER_COMPONENTS: readonly ModuleComponent[] = [
  {
    id: "drawer-slide",
    label: "Направляющие ящиков",
    relation: "required",
    condition: "drawers > 0",
    quantitySource: "По количеству ящиков",
    unit: "шт.",
    priceItemIds: ["kitchen.drawerSlide"],
    evidence: ENGINE_KITCHEN,
  },
  {
    id: "drawer-soft-close",
    label: "Доводчики ящиков",
    relation: "conditional",
    condition: "hinge = soft и drawers > 0",
    quantitySource: "По количеству ящиков",
    unit: "шт.",
    priceItemIds: ["kitchen.drawerSoftClose"],
    evidence: ENGINE_KITCHEN,
  },
];

function kitchenComponents(
  type: string,
  extra: readonly ModuleComponent[] = [],
): ModuleComponent[] {
  const base = [
    { ...PRESET_COMPONENT, priceItemIds: [`kitchen.module.${type}.basePrice`] },
    BODY_COMPONENT,
  ];
  if (type === "drawers") {
    return [
      ...base,
      FACADE_COMPONENT,
      HANDLE_COMPONENT,
      ...DRAWER_COMPONENTS,
      SUPPORT_COMPONENT,
      ...extra,
    ];
  }
  return [
    ...base,
    FACADE_COMPONENT,
    HINGE_COMPONENT,
    SOFT_CLOSE_COMPONENT,
    PUSH_TO_OPEN_COMPONENT,
    HANDLE_COMPONENT,
    SHELF_COMPONENT,
    SUPPORT_COMPONENT,
    ...extra,
  ];
}

const MODULE_EXTRAS: Record<string, readonly ModuleComponent[]> = {
  base: [],
  sink: [
    {
      id: "sink-cutout",
      label: "Вырез под мойку",
      relation: "required",
      condition: "Тип модуля sink",
      quantitySource: "1 на модуль",
      unit: "шт.",
      priceItemIds: ["kitchen.sinkCutout"],
      evidence: SINK,
    },
    {
      id: "sink-partition",
      label: "Перегородки секций",
      relation: "conditional",
      condition: "Раскладка мойки образует перегородки",
      quantitySource: "Раскладка sinkLayout; отдельно не тарифицируются",
      unit: "шт.",
      priceItemIds: [],
      evidence: SINK,
    },
    {
      id: "sink-storage",
      label: "Наполнение секций (полки/ящики/бутылочница)",
      relation: "optional",
      condition: "sinkStorage задан",
      quantitySource: "Секции sinkLayout: shelves/drawers/bottle",
      unit: "шт.",
      priceItemIds: [
        "kitchen.shelf",
        "kitchen.drawerSlide",
        "kitchen.drawerSoftClose",
        "kitchen.bottleRack",
      ],
      evidence: SINK,
    },
  ],
  hob: [
    {
      id: "hob-cutout",
      label: "Вырез под варочную поверхность",
      relation: "required",
      condition: "Тип модуля hob",
      quantitySource: "1 на модуль",
      unit: "шт.",
      priceItemIds: ["kitchen.hobCutout"],
      evidence: ENGINE_KITCHEN,
    },
  ],
  drawers: [],
  wall: [],
  tall: [],
  oven: [
    {
      id: "oven-niche",
      label: "Ниша под технику",
      relation: "required",
      condition: "Тип модуля oven",
      quantitySource: "1 на модуль; техника не входит",
      unit: "шт.",
      priceItemIds: ["kitchen.ovenNiches"],
      evidence: ENGINE_KITCHEN,
    },
  ],
  bottle: [],
};

const KITCHEN_TYPE_META: Record<
  string,
  { label: string; zone: "floor" | "upper" }
> = {
  base: { label: "Нижний шкаф", zone: "floor" },
  sink: { label: "Модуль под мойку", zone: "floor" },
  hob: { label: "Модуль под варочную панель", zone: "floor" },
  drawers: { label: "Блок ящиков", zone: "floor" },
  wall: { label: "Верхний шкаф", zone: "upper" },
  tall: { label: "Пенал", zone: "floor" },
  oven: { label: "Пенал под технику", zone: "floor" },
  bottle: { label: "Бутылочница", zone: "floor" },
};

export const MODULE_COMPOSITION: readonly ModuleComposition[] = Object.entries(
  KITCHEN_TYPE_META,
).map(([type, meta]) => ({
  type,
  label: meta.label,
  zone: meta.zone,
  status: "CONFIRMED" as CoverageStatus,
  components: kitchenComponents(type, MODULE_EXTRAS[type] ?? []),
}));

export function getModuleComposition(
  type: string,
): ModuleComposition | undefined {
  return MODULE_COMPOSITION.find((item) => item.type === type);
}

/** ─── Позиции уровня проекта ───────────────────────────────────────────── */

export interface ProjectLevelComponent {
  id: string;
  label: string;
  appliesTo: "kitchen" | "wardrobe" | "shared";
  relation: "required" | "conditional" | "optional";
  condition: string | null;
  quantitySource: string;
  unit: string;
  priceItemIds: readonly string[];
  priceReference?: string;
  catalog?: { kind: CatalogItem["catalog"]; id?: string };
  evidence: string;
}

export const PROJECT_LEVEL_COMPONENTS: readonly ProjectLevelComponent[] = [
  {
    id: "base",
    label: "Основа проекта",
    appliesTo: "shared",
    relation: "required",
    condition: null,
    quantitySource: "1 на проект",
    unit: "шт.",
    priceItemIds: ["kitchen.baseCost", "wardrobe.baseCost"],
    evidence: ENGINE_KITCHEN,
  },
  {
    id: "shelves",
    label: "Полки (итог по модулям)",
    appliesTo: "kitchen",
    relation: "optional",
    condition: "shelfTotal > 0",
    quantitySource: "Сумма полок модулей и секций",
    unit: "шт.",
    priceItemIds: ["kitchen.shelf"],
    evidence: ENGINE_KITCHEN,
  },
  {
    id: "countertop",
    label: "Столешница",
    appliesTo: "kitchen",
    relation: "required",
    condition: null,
    quantitySource:
      "Длина нижнего ряда (base/sink/hob/drawers/bottle); kitchenCountertopWidth",
    unit: "м",
    priceItemIds: [],
    priceReference: "catalog.countertop.<selected>.ratePerLinearMeter",
    catalog: { kind: "countertop" },
    evidence: ENGINE_KITCHEN,
  },
  {
    id: "side-panels",
    label: "Декоративные боковины",
    appliesTo: "kitchen",
    relation: "optional",
    condition: "sidePanels > 0",
    quantitySource: "По количеству sidePanels",
    unit: "шт.",
    priceItemIds: ["kitchen.sidePanel"],
    evidence: ENGINE_KITCHEN,
  },
  {
    id: "supports",
    label: "Опоры",
    appliesTo: "kitchen",
    relation: "conditional",
    condition: "Есть напольные модули",
    quantitySource: "computeSupports/positionsForModule",
    unit: "шт.",
    priceItemIds: [],
    priceReference:
      "catalog.support.<system>.legPrice/clipPrice/screwPrice/anchorPrice",
    catalog: { kind: "supportSystem" },
    evidence: "src/lib/configurator/supports.ts",
  },
  {
    id: "plinth",
    label: "Цоколь",
    appliesTo: "shared",
    relation: "optional",
    condition: "plinth = true",
    quantitySource: "Длина напольного ряда / ширина шкафа",
    unit: "м",
    priceItemIds: ["kitchen.plinthPerMeter", "wardrobe.plinthPerMeter"],
    evidence: ENGINE_KITCHEN,
  },
  {
    id: "lighting",
    label: "Подсветка",
    appliesTo: "shared",
    relation: "optional",
    condition: "underCabinetLighting / ledLighting",
    quantitySource: "computeLighting / секции шкафа",
    unit: "м",
    priceItemIds: [],
    priceReference:
      "lighting.strip.<strip> · lighting.profile.<profile> · lighting.diffuser.<diffuser> · lighting.psu.<watt> · lighting.control.<control>",
    evidence: "src/lib/configurator/lighting.ts",
  },
  {
    id: "complexity",
    label: "Коэффициент сложности",
    appliesTo: "kitchen",
    relation: "conditional",
    condition: "Модулей больше 3",
    quantitySource: "complexityPerExtraModule / complexityMax",
    unit: "FACTOR",
    priceItemIds: [],
    evidence: ENGINE_KITCHEN,
  },
  {
    id: "min-order",
    label: "Минимальная стоимость заказа",
    appliesTo: "shared",
    relation: "conditional",
    condition: "subtotalRaw < minOrder",
    quantitySource: "PricingVersion.rules.minOrder",
    unit: "₽",
    priceItemIds: [],
    evidence: ENGINE_KITCHEN,
  },
  {
    id: "promo",
    label: "Промокод",
    appliesTo: "shared",
    relation: "optional",
    condition: "Промокод применён и валиден",
    quantitySource: "PricingVersion.promos; applyPromo",
    unit: "%/₽",
    priceItemIds: [],
    evidence: "src/lib/configurator/pricing.ts:applyPromo",
  },
];

/** ─── Проверки целостности read-model ──────────────────────────────────── */

export interface CatalogModelIssue {
  severity: "error" | "warning";
  code: string;
  entity: string;
  message: string;
}

/** Ссылки каталогов на отсутствующие PriceItem — проблема данных, не 0 ₽. */
export function catalogPriceLinkIssues(
  items: readonly CatalogItem[],
  priceItemIds: ReadonlySet<string>,
): CatalogModelIssue[] {
  const issues: CatalogModelIssue[] = [];
  for (const item of items) {
    const refs = item.priceRefs;
    if (!refs || Array.isArray(refs)) {
      if (Array.isArray(refs)) {
        for (const ref of refs) {
          if (!priceItemIds.has(ref)) {
            issues.push({
              severity: "warning",
              code: "CATALOG_LEGACY_PRICE_REF",
              entity: `${item.catalog}:${item.id}`,
              message: `Legacy priceRef "${ref}" не разрешается в PriceItem.`,
            });
          }
        }
      }
      continue;
    }
    for (const [role, ref] of Object.entries(refs)) {
      if (ref && !priceItemIds.has(ref)) {
        issues.push({
          severity: "error",
          code: "CATALOG_PRICE_REF_MISSING",
          entity: `${item.catalog}:${item.id}`,
          message: `priceRefs.${role}="${ref}" отсутствует в PriceItem.`,
        });
      }
    }
  }
  return issues;
}

/** Все PriceItem.id, на которые ссылается read-model состава. */
export function modulePriceReferences(): string[] {
  const ids = new Set<string>();
  for (const entry of MODULE_COMPOSITION) {
    for (const component of entry.components) {
      for (const id of component.priceItemIds) ids.add(id);
    }
  }
  for (const item of PROJECT_LEVEL_COMPONENTS) {
    for (const id of item.priceItemIds) ids.add(id);
  }
  return [...ids].sort();
}

export function moduleCoverageIssues(): CatalogModelIssue[] {
  const issues: CatalogModelIssue[] = [];
  for (const group of KITCHEN_MODULE_GROUPS) {
    for (const type of group.kitchenTypes) {
      if (!getModuleComposition(type)) {
        issues.push({
          severity: "error",
          code: "MODULE_COMPOSITION_MISSING",
          entity: `kitchen:${type}`,
          message: `Группа «${group.label}» ссылается на тип без описания состава.`,
        });
      }
    }
  }
  return issues;
}
