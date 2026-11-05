import type {
  BodyMaterialId,
  CountertopId,
  FacadeMaterialId,
  FacadeStyle,
  FurnitureType,
  HandleType,
  KitchenModuleType,
} from "@/lib/configurator/types";

export interface Finish {
  id: string;
  name: string;
  hex: string;
  accent?: string;
}

export interface MaterialOption<T extends string> {
  id: T;
  name: string;
  shortName: string;
  description: string;
  ratePerSqm?: number;
  ratePerLinearMeter?: number;
  finishes: Finish[];
}

/** Столешница: материал + доступные толщины (мм) и стандартная толщина. */
export interface CountertopOption extends MaterialOption<CountertopId> {
  /** Доступные толщины плиты в миллиметрах. */
  thicknesses: number[];
  /** Толщина, которую выбирают по умолчанию при выборе материала. */
  defaultThickness: number;
}

export const BODY_MATERIALS: MaterialOption<BodyMaterialId>[] = [
  {
    id: "ldsp",
    name: "ЛДСП",
    shortName: "ЛДСП",
    description: "Практичный корпус с большим выбором декоров. Оптимальный баланс цены и долговечности.",
    ratePerSqm: 5200,
    finishes: [
      { id: "milk", name: "Молочный", hex: "#EAE4D9" },
      { id: "oak", name: "Светлый дуб", hex: "#D7C1A0" },
      { id: "walnut", name: "Орех", hex: "#82634A" },
      { id: "graphite", name: "Графит", hex: "#3B3B39" },
    ],
  },
  {
    id: "mdf",
    name: "МДФ",
    shortName: "МДФ",
    description: "Плотная основа для фрезеровки и эмали. Хорошо держит сложные формы и матовые покрытия.",
    ratePerSqm: 7600,
    finishes: [
      { id: "sand", name: "Песочный", hex: "#D8C7B0" },
      { id: "olive", name: "Олива", hex: "#6E745C" },
      { id: "clay", name: "Терракота", hex: "#A87358" },
      { id: "graphite", name: "Графит", hex: "#3B3B39" },
    ],
  },
  {
    id: "plywood",
    name: "Фанера",
    shortName: "Фанера",
    description: "Натуральный срез и выразительная текстура. Подходит для тёплых, тактильных интерьеров.",
    ratePerSqm: 9200,
    finishes: [
      { id: "birch", name: "Берёза", hex: "#DCC9A8" },
      { id: "oak", name: "Дуб", hex: "#B99163" },
      { id: "ash", name: "Ясень", hex: "#C8AE89" },
    ],
  },
];

export const FACADE_MATERIALS: MaterialOption<FacadeMaterialId>[] = [
  {
    id: "ldsp",
    name: "ЛДСП",
    shortName: "ЛДСП",
    description: "Ровные матовые фасады в спокойной палитре. Разумное решение для больших гарнитуров.",
    ratePerSqm: 5600,
    finishes: [
      { id: "milk", name: "Молочный", hex: "#EFEAE1" },
      { id: "sand", name: "Песочный", hex: "#D6C5AC" },
      { id: "walnut", name: "Орех", hex: "#7D5C41" },
      { id: "graphite", name: "Графит", hex: "#343431" },
    ],
  },
  {
    id: "mdf",
    name: "МДФ в эмали",
    shortName: "МДФ",
    description: "Матовые или сатиновые фасады с точным цветом. База для интегрированных ручек и фрезеровки.",
    ratePerSqm: 8400,
    finishes: [
      { id: "milk", name: "Тёплый белый", hex: "#F0EBE2" },
      { id: "sand", name: "Песок", hex: "#D4C2A8" },
      { id: "olive", name: "Олива", hex: "#72775F" },
      { id: "clay", name: "Терракота", hex: "#A67559" },
      { id: "graphite", name: "Графит", hex: "#343431" },
    ],
  },
  {
    id: "veneer",
    name: "Шпон",
    shortName: "Шпон",
    description: "Живой рисунок дерева и натуральная глубина цвета. Каждый фасад имеет собственный рисунок.",
    ratePerSqm: 11800,
    finishes: [
      { id: "oak", name: "Дуб натуральный", hex: "#C5A274" },
      { id: "walnut", name: "Орех", hex: "#70513A" },
      { id: "ash", name: "Ясень", hex: "#D0B48B" },
    ],
  },
  {
    id: "glass",
    name: "Стекло",
    shortName: "Стекло",
    description: "Визуально лёгкие секции с алюминиевым профилем. Уместно для верхнего ряда и витрин.",
    ratePerSqm: 14400,
    finishes: [
      { id: "clear", name: "Прозрачное", hex: "#B9C6C4" },
      { id: "smoke", name: "Дымчатое", hex: "#686E6D" },
      { id: "reeded", name: "Рифлёное", hex: "#C8CFCC" },
    ],
  },
  {
    id: "solid",
    name: "Массив",
    shortName: "Массив",
    description: "Тёплый натуральный материал для акцентных элементов. Требует стабильного микроклимата.",
    ratePerSqm: 18600,
    finishes: [
      { id: "oak", name: "Дуб", hex: "#BB925F" },
      { id: "walnut", name: "Орех", hex: "#6B4A33" },
    ],
  },
];

export const COUNTERTOPS: CountertopOption[] = [
  {
    id: "ldsp_hpl",
    name: "ЛДСП + HPL",
    shortName: "ЛДСП + HPL",
    description: "Бюджетная и надёжная столешница. Практична для повседневной кухни.",
    ratePerLinearMeter: 9500,
    thicknesses: [26, 28, 38],
    defaultThickness: 38,
    finishes: [
      { id: "light", name: "Светлый камень", hex: "#DDD8CF" },
      { id: "dark", name: "Тёмный камень", hex: "#4A4B49" },
    ],
  },
  {
    id: "compact_hpl",
    name: "Compact HPL",
    shortName: "Compact HPL",
    description: "Тонкая и прочная плита. Подходит для минималистичных кухонь.",
    ratePerLinearMeter: 9500,
    thicknesses: [6, 8, 10, 12, 13],
    defaultThickness: 12,
    finishes: [
      { id: "light", name: "Светлый камень", hex: "#DDD8CF" },
      { id: "dark", name: "Тёмный камень", hex: "#4A4B49" },
    ],
  },
  {
    id: "acrylic",
    name: "Акриловый камень",
    shortName: "Акрил",
    description: "Бесшовные стыки и ремонтопригодность. Возможны интегрированные мойки.",
    ratePerLinearMeter: 16800,
    thicknesses: [12, 20, 30, 40],
    defaultThickness: 20,
    finishes: [
      { id: "snow", name: "Снежный", hex: "#E4E2DB" },
      { id: "ash", name: "Пепельный", hex: "#B9B5AC" },
    ],
  },
  {
    id: "quartz",
    name: "Кварцевый агломерат",
    shortName: "Кварц",
    description: "Прочная поверхность с выразительным рисунком. Популярный выбор для современных кухонь.",
    ratePerLinearMeter: 22400,
    thicknesses: [12, 20, 30],
    defaultThickness: 20,
    finishes: [
      { id: "calacatta", name: "Calacatta", hex: "#E8E6E0", accent: "#B8AFA4" },
      { id: "graphite", name: "Графит", hex: "#484947" },
    ],
  },
  {
    id: "porcelain",
    name: "Керамогранит",
    shortName: "Керамогранит",
    description: "Износостойкая поверхность. Доступна в диапазоне толщин 8–11 мм.",
    ratePerLinearMeter: 29400,
    thicknesses: [8, 9, 10, 11],
    defaultThickness: 10,
    finishes: [
      { id: "marble", name: "Мрамор", hex: "#E2DED6", accent: "#AEA79C" },
      { id: "basalt", name: "Базальт", hex: "#454644" },
    ],
  },
  {
    id: "solid_wood",
    name: "Массив дерева",
    shortName: "Массив",
    description: "Натуральный массив дерева. Тёплый вид, индивидуальная обработка.",
    ratePerLinearMeter: 29400,
    thicknesses: [27, 40],
    defaultThickness: 40,
    finishes: [
      { id: "oak", name: "Дуб", hex: "#BB925F" },
      { id: "walnut", name: "Орех", hex: "#6B4A33" },
    ],
  },
];

/** Старые идентификаторы столешниц → новые (миграция сохранённых конфигураций). */
export const COUNTERTOP_LEGACY_MAP: Record<string, CountertopId> = {
  laminate: "compact_hpl",
  stone: "porcelain",
};

/** Найти столешницу по идентификатору (включая устаревшие). */
export function findCountertop(id: string): CountertopOption | undefined {
  return (
    COUNTERTOPS.find((item) => item.id === id) ??
    COUNTERTOPS.find((item) => item.id === COUNTERTOP_LEGACY_MAP[id])
  );
}

/** Подобрать ближайшую допустимую толщину для материала. */
export function snapCountertopThickness(
  material: string,
  thickness: number,
): number {
  const option = findCountertop(material);
  if (!option) return thickness;
  return option.thicknesses.reduce((best, value) =>
    Math.abs(value - thickness) < Math.abs(best - thickness) ? value : best,
  );
}

export const HANDLES: {
  id: HandleType;
  name: string;
  description: string;
  rate: number;
}[] = [
  {
    id: "bar",
    name: "Ручка-скоба",
    description: "Выразительная металлическая скоба. Классика в современной подаче.",
    rate: 780,
  },
  {
    id: "knob",
    name: "Ручка-кнопка",
    description: "Компактное решение для небольших фасадов и ящиков.",
    rate: 560,
  },
  {
    id: "profile",
    name: "Врезной профиль",
    description: "Ручка заподлицо с фасадом. Спокойная геометрия без выступающих частей.",
    rate: 1450,
  },
  {
    id: "none",
    name: "Без ручек",
    description: "Открывание push-to-open или выборка в фасаде, если это допускает конструкция.",
    rate: 0,
  },
];

export const KITCHEN_MODULES: Record<
  KitchenModuleType,
  {
    label: string;
    shortLabel: string;
    description: string;
    zone: "floor" | "upper";
    minWidth: number;
    maxWidth: number;
    defaultWidth: number;
    minHeight: number;
    maxHeight: number;
    defaultHeight: number;
    minDepth: number;
    maxDepth: number;
    defaultDepth: number;
    defaultShelves: number;
    defaultDrawers: number;
    basePrice: number;
  }
> = {
  base: {
    label: "Нижний шкаф",
    shortLabel: "База",
    description: "Закрытый модуль с полками. Отправная точка кухонного ряда.",
    zone: "floor",
    minWidth: 40,
    maxWidth: 120,
    defaultWidth: 60,
    minHeight: 80,
    maxHeight: 95,
    defaultHeight: 90,
    minDepth: 50,
    maxDepth: 60,
    defaultDepth: 60,
    defaultShelves: 1,
    defaultDrawers: 0,
    basePrice: 8200,
  },
  sink: {
    label: "Модуль под мойку",
    shortLabel: "Мойка",
    description:
      "Корпус с подготовкой под чашу мойки. Ширина 40–120 см с шагом 5 см: от 2 распашных фасадов до 3 фасадов с перегородками и секциями хранения.",
    zone: "floor",
    minWidth: 40,
    maxWidth: 120,
    defaultWidth: 60,
    minHeight: 80,
    maxHeight: 95,
    defaultHeight: 90,
    minDepth: 55,
    maxDepth: 60,
    defaultDepth: 60,
    defaultShelves: 0,
    defaultDrawers: 0,
    basePrice: 11400,
  },
  hob: {
    label: "Модуль под варочную панель",
    shortLabel: "Варочная",
    description: "Тумба с вырезом в столешнице под варочную поверхность.",
    zone: "floor",
    minWidth: 50,
    maxWidth: 100,
    defaultWidth: 60,
    minHeight: 80,
    maxHeight: 95,
    defaultHeight: 90,
    minDepth: 55,
    maxDepth: 60,
    defaultDepth: 60,
    defaultShelves: 1,
    defaultDrawers: 0,
    basePrice: 10400,
  },
  drawers: {
    label: "Блок ящиков",
    shortLabel: "Ящики",
    description: "Выдвижные ящики с направляющими. Количество и высоты настраиваются.",
    zone: "floor",
    minWidth: 40,
    maxWidth: 100,
    defaultWidth: 60,
    minHeight: 80,
    maxHeight: 95,
    defaultHeight: 90,
    minDepth: 50,
    maxDepth: 60,
    defaultDepth: 60,
    defaultShelves: 0,
    defaultDrawers: 3,
    basePrice: 12100,
  },
  wall: {
    label: "Верхний шкаф",
    shortLabel: "Верх",
    description: "Навесной модуль для посуды и продуктов. Глубина меньше нижнего ряда.",
    zone: "upper",
    minWidth: 40,
    maxWidth: 100,
    defaultWidth: 60,
    minHeight: 60,
    maxHeight: 140,
    defaultHeight: 72,
    minDepth: 30,
    maxDepth: 40,
    defaultDepth: 35,
    defaultShelves: 1,
    defaultDrawers: 0,
    basePrice: 6800,
  },
  tall: {
    label: "Пенал",
    shortLabel: "Пенал",
    description: "Высокий корпус от пола до верхнего уровня. Полки и внутреннее наполнение настраиваются.",
    zone: "floor",
    minWidth: 40,
    maxWidth: 120,
    defaultWidth: 60,
    minHeight: 200,
    maxHeight: 277,
    defaultHeight: 220,
    minDepth: 55,
    maxDepth: 60,
    defaultDepth: 60,
    defaultShelves: 4,
    defaultDrawers: 0,
    basePrice: 15800,
  },
  oven: {
    label: "Пенал под технику",
    shortLabel: "Техника",
    description: "Высокий модуль с нишей под встроенную технику. Техника не входит в расчёт.",
    zone: "floor",
    minWidth: 50,
    maxWidth: 90,
    defaultWidth: 60,
    minHeight: 200,
    maxHeight: 277,
    defaultHeight: 220,
    minDepth: 55,
    maxDepth: 60,
    defaultDepth: 60,
    defaultShelves: 2,
    defaultDrawers: 0,
    basePrice: 14600,
  },
  bottle: {
    label: "Бутылочница",
    shortLabel: "Бутылочница",
    description:
      "Отдельный узкий модуль-бутылочница: корпус 15/20/30 см, чистый проём 118/168/268 мм.",
    zone: "floor",
    minWidth: 15,
    maxWidth: 30,
    defaultWidth: 20,
    minHeight: 80,
    maxHeight: 95,
    defaultHeight: 90,
    minDepth: 50,
    maxDepth: 60,
    defaultDepth: 60,
    defaultShelves: 0,
    defaultDrawers: 0,
    basePrice: 5000,
  },
};

export const FACADE_STYLES: {
  id: FacadeStyle;
  name: string;
  description: string;
  multiplier: number;
}[] = [
  {
    id: "flat",
    name: "Ровный",
    description: "Минималистичный фасад без фрезеровки. Подчёркивает геометрию и материал.",
    multiplier: 1,
  },
  {
    id: "shaker",
    name: "Рамочный",
    description: "Тонкая рамка вокруг полотна. Добавляет интерьеру мягкости и традиции.",
    multiplier: 1.16,
  },
  {
    id: "handleless",
    name: "Без ручек",
    description: "Профиль-ручка или push-to-open. Чистая плоскость фасада без выступающих деталей.",
    multiplier: 1.08,
  },
];

export const KITCHEN_LIMITS = {
  minModules: 2,
  maxModules: 25,
  minTotalWidth: 80,
  maxSinkModules: 1,
  maxHobModules: 1,
  maxOvenModules: 1,
  maxShelvesPerModule: 5,
  minDrawers: 2,
  maxDrawers: 4,
  minCountertopMeters: 0.8,
  maxWallOverhang: 20,
  minPlinthHeight: 10,
  maxPlinthHeight: 15,
  defaultPlinthHeight: 10,
  wallGapAboveCountertop: 56,
} as const;

export const WARDROBE_LIMITS = {
  minSections: 1,
  maxSections: 6,
  minSectionWidth: 40,
  maxSectionWidth: 120,
  minTotalWidth: 60,
  maxTotalWidth: 400,
  minHeight: 180,
  maxHeight: 270,
  minDepth: 45,
  maxDepth: 70,
  maxShelvesPerSection: 10,
  maxRodsPerSection: 2,
  maxDrawersPerSection: 4,
  minShelfGap: 12,
  plinthHeight: 8,
  carcassThickness: 2,
  drawerHeight: 20,
} as const;

export const FURNITURE_TYPES: Record<
  FurnitureType,
  { label: string; shortLabel: string; description: string }
> = {
  kitchen: {
    label: "Кухня",
    shortLabel: "Кухня",
    description: "Модульная кухня с настройкой размеров, фасадов и наполнения.",
  },
  wardrobe: {
    label: "Шкаф",
    shortLabel: "Шкаф",
    description: "Корпусный шкаф с секциями, полками, штангами и ящиками.",
  },
};
