import type {
  KitchenModule,
  KitchenSinkPosition,
  KitchenSinkStorage,
} from "./types";

/**
 * Конструктивные правила модуля под мойку с распашными фасадами.
 *
 * Ширина корпуса — в сантиметрах (40 = 400 мм).
 * Габариты и отступы мойки — в миллиметрах (см. sinkGeometry).
 * Конструктивные константы (боковина, перегородка, зазоры, монтажный отступ)
 * приняты как демо-параметры на основе типовой корпусной мебели и требуют
 * подтверждения конструктором — см. открытые вопросы в отчёте.
 */
export const SINK_RULES = {
  minWidth: 40,
  maxWidth: 120,
  widthStep: 5,
  /** Стандартные (номинальные) ширины корпуса — подсвечиваются в интерфейсе. */
  standardWidths: [40, 45, 50, 60, 80, 90, 100, 120] as const,
  /** Толщина боковины корпуса (ЛДСП 16 мм). */
  sidePanel: 1.6,
  /** Толщина внутренней вертикальной перегородки (ЛДСП 16 мм). */
  partition: 1.6,
  /** Монтажный зазор между фасадной створкой и соседней створкой/перегородкой. */
  facadeGap: 0.25,
  /** Ширина, начиная с которой доступна дополнительная перегородка (2 фасада). */
  partitionMinWidth: 65,
  /** Ширина, начиная с которой доступна конструкция с тремя фасадами. */
  threeDoorMinWidth: 100,
  /** Лимиты наполнения одной свободной секции. */
  maxShelvesPerSection: 3,
  maxDrawersPerSection: 3,
  /** Минимальная НАРУЖНАЯ ширина секции для ящиков, см (ТЗ: 300 мм). */
  minSectionOuterWidthForDrawers: 30,
  /**
   * Базовый монтажный отступ от края монтажного выреза до края столешницы,
   * мм (предварительное ограничение по ТЗ; приоритет — документация
   * производителя мойки и столешницы). Действует со стороны края ряда
   * (см. SinkRowContext) и всегда — спереди/сзади по глубине.
   */
  mountEdge: 50,
  /**
   * Боковой отступ к соседнему модулю со столешницей: 0 мм — край столешницы
   * продолжается, обязательный отступ 5 см нужен только у самого края ряда.
   */
  innerMount: 0,
  /** Шаг выбора габаритов и отступов мойки, мм (1 см). */
  sinkStep: 10,
  /** Допустимый диапазон габаритов мойки, мм (с учётом монтажных отступов). */
  minSinkWidth: 300,
  maxSinkWidth: 1100,
  minSinkDepth: 300,
  maxSinkDepth: 500,
  /**
   * Минимальная ширина секции хранения, мм. Меньше — мёртвый зазор,
   * секция не образуется (демо-параметр).
   */
  minStorageSectionWidth: 100,
  /** Монтажный зазор фасада: 2 мм у края ряда, 1 мм к соседнему модулю, см. */
  facadeEdgeGap: 0.2,
  facadeNeighborGap: 0.1,
  /** Зазор между створками одного модуля, см (2 мм → по 1 мм на створку). */
  facadeInnerGap: 0.1,
  /** Бутылочница: корпуса, см (чистый проём = корпус − 32 мм: 118/168/268). */
  bottleBodies: [15, 20, 30] as const,
  bottleClearOffset: 3.2,
} as const;

/**
 * Наружная ширина секции: внутренняя ширина + две стенки по 16 мм.
 * Ящики и бутылочница задаются наружным габаритом.
 */
export function sectionOuterWidth(inner: number): number {
  return inner + 2 * SINK_RULES.partition;
}

/**
 * Наружная ширина секции достаточна для ящиков.
 * Допуск = косметический зазор авто-перегородки (facadeGap/2): перегородка
 * стоит вплотную к краю зоны мойки с зазором gap/2 и «съедает» его из секции,
 * поэтому строгое сравнение с 30 см браковало легальную секцию 29.875 см
 * (1200 мм, мойка 50 по центру, 2 фасада).
 */
export function sectionFitsDrawers(inner: number): boolean {
  return (
    sectionOuterWidth(inner) + SINK_RULES.facadeGap / 2 + 1e-6 >=
    SINK_RULES.minSectionOuterWidthForDrawers
  );
}

/**
 * Секция примыкает к боковине корпуса — только такие секции подходят под
 * бутылочницу (граница ровно у края модуля). Совпадает с условием
 * atLeft/atRight в applyBottleCut; используется в UI и validation, чтобы
 * правило «только у края» было единым.
 */
export function isBottleEdgeSection(
  section: Pick<SinkSectionLayout, "x" | "width">,
  widthCm: number,
): boolean {
  const side = SINK_RULES.sidePanel;
  const width = snapSinkWidth(widthCm);
  return (
    section.x <= side + 0.001 ||
    section.x + section.width >= width - side - 0.001
  );
}

/**
 * Типовые размеры моек (внешний габарит, мм). Каталога моек в проекте нет —
 * приняты распространённые типоразмеры одночашечных моек; при появлении
 * каталога заменяются его данными.
 */
export const SINK_STANDARD_SIZES: readonly { width: number; depth: number }[] = [
  { width: 400, depth: 430 },
  { width: 450, depth: 500 },
  { width: 500, depth: 400 },
  { width: 500, depth: 500 },
  { width: 550, depth: 450 },
  { width: 600, depth: 400 },
  { width: 600, depth: 500 },
  { width: 780, depth: 400 },
  { width: 780, depth: 500 },
  { width: 800, depth: 500 },
  { width: 1000, depth: 500 },
];

export const SINK_STANDARD_WIDTHS_MM: readonly number[] = [
  500, 550, 600, 780, 800, 1000,
];
export const SINK_STANDARD_DEPTHS_MM: readonly number[] = [400, 450, 500];

/** Значения по умолчанию для нового модуля под мойку (мм). */
export const SINK_DEFAULTS = { width: 500, depth: 400 } as const;

/**
 * Контекст модуля под мойку в нижнем ряду: соприкасается ли он с краем
 * столешницы. Столешница прерывается у края ряда и у высоких модулей
 * (пенал/духовка) — со стороны разрыва действует обязательный отступ 50 мм,
 * к соседнему модулю со столешницей отступ не нужен (0 мм).
 */
export interface SinkRowContext {
  /** Слева нет соседнего модуля со столешницей — край ряда. */
  leftEdge: boolean;
  /** Справа нет соседнего модуля со столешницей — край ряда. */
  rightEdge: boolean;
}

/** Край ряда с обеих сторон — поведение по умолчанию (без контекста ряда). */
export const SINK_ROW_EDGE_BOTH: SinkRowContext = { leftEdge: true, rightEdge: true };

/** Модули нижнего ряда, над которыми стоит столешница. */
const COUNTERTOP_MODULE_TYPES: readonly string[] = [
  "base",
  "sink",
  "hob",
  "drawers",
  "bottle",
];

/** Боковые монтажные отступы мойки, мм: 50 у края столешницы, 0 к соседу. */
export function sinkRowMargins(
  row?: SinkRowContext,
): { left: number; right: number } {
  const context = row ?? SINK_ROW_EDGE_BOTH;
  return {
    left: context.leftEdge ? SINK_RULES.mountEdge : SINK_RULES.innerMount,
    right: context.rightEdge ? SINK_RULES.mountEdge : SINK_RULES.innerMount,
  };
}

/**
 * Контекст края для модуля нижнего ряда по порядку модулей: 50-мм отступ
 * нужен со стороны, где рядом нет модуля со столешницей (край ряда либо
 * сосед — пенал/духовка). Модуль не найден — край с обеих сторон.
 */
export function sinkRowContext(
  modules: Pick<KitchenModule, "id" | "type">[],
  id: string,
): SinkRowContext {
  const floor = modules.filter(
    (module) => COUNTERTOP_MODULE_TYPES.includes(module.type) || module.type === "tall" || module.type === "oven",
  );
  const index = floor.findIndex((module) => module.id === id);
  if (index < 0) return SINK_ROW_EDGE_BOTH;
  const isCounter = (module?: { type: string }) =>
    module !== undefined && COUNTERTOP_MODULE_TYPES.includes(module.type);
  return {
    leftEdge: !isCounter(floor[index - 1]),
    rightEdge: !isCounter(floor[index + 1]),
  };
}

/**
 * Ближайший стандартный типоразмер мойки, который помещается в корпус:
 * сначала разница ширин (×2), затем глубин — ширина важнее.
 */
export function nearestStandardSink(
  widthMm: number,
  depthMm: number,
  maxWidthMm: number,
  maxDepthMm: number,
): { width: number; depth: number } | null {
  const fits = SINK_STANDARD_SIZES.filter(
    (size) => size.width <= maxWidthMm && size.depth <= maxDepthMm,
  );
  if (fits.length === 0) return null;
  const score = (size: { width: number; depth: number }) =>
    Math.abs(size.width - widthMm) * 2 + Math.abs(size.depth - depthMm);
  return fits.reduce((best, size) => (score(size) < score(best) ? size : best));
}

export type SinkFacadeCount = 2 | 3;

export interface SinkSectionLayout {
  /** Индекс секции от левого края модуля. */
  index: number;
  /** Отступ секции от левого края модуля. */
  x: number;
  /** Ширина секции (внутри корпуса, между боковинами и перегородками). */
  width: number;
  /** Зона коммуникаций (мойка, сифон, трубы) — наполнение запрещено. */
  comms: boolean;
  shelves: number;
  drawers: number;
  /** Бутылочница: корпус, см (15/20/30), 0 — не установлена. */
  bottle: number;
}

/**
 * Панель фасада модуля под мойку с монтажными зазорами, см.
 * Каждая секция с выбранным наполнением получает свою панель: полки —
 * распашная створка, ящики — стопка фронтов (fronts), бутылочка — узкая
 * панель без петель. Остаток поля делят базовые створки (kind: "door").
 */
export interface SinkFacadeBox {
  x: number;
  width: number;
  kind: "door" | "drawers" | "bottle";
  /** Для kind === "drawers": число фронтов (стопкой, каждый — отдельный фасад). */
  fronts?: number;
}

export interface SinkPartitionBox {
  /** Левый край перегородки от левого края модуля, см. */
  x: number;
  width: number;
  /** Пересекает зону мойки (для конструктивных — справочно, для опциональной — запрет). */
  conflict: boolean;
  /** Конструктивная (обязательна для 3 фасадов) — не удаляется при конфликте. */
  structural: boolean;
}

export interface SinkLayout {
  facades: SinkFacadeCount;
  /** Количество устанавливаемых перегородок (0…2). */
  partitionCount: number;
  /** Ширина каждой створки фасада (одинакова). */
  doorWidth: number;
  /** Позиции створок от левого края модуля. */
  doorXs: number[];
  /** Устанавливаемые перегородки. */
  partitions: SinkPartitionBox[];
  sections: SinkSectionLayout[];
  /**
   * Створки фасада с учётом монтажных зазоров (2 мм у края ряда, 1 мм к
   * соседу, 1 мм между створками). Шов крайней створки — на осевой
   * перегородки. Для рендера; структурные doorXs/doorWidth — для секций.
   */
  facadeBoxes: SinkFacadeBox[];
  /**
   * Все физические перегородки корпуса: дверные (`partitions`) и граница
   * секции бутылочницы. Для построения секций и рендера.
   */
  sectionCuts: SinkPartitionBox[];
  /** Бутылочница запрошена, но её перегородку нельзя поставить (зона мойки). */
  bottleConflict: boolean;
}

/** Геометрия мойки внутри корпуса. Все значения — в миллиметрах. */
export interface SinkGeometry {
  position: KitchenSinkPosition;
  /** Внешний габарит мойки. */
  width: number;
  depth: number;
  /** Монтажный вырез (если данных производителя нет — внешний габарит). */
  cutoutWidth: number;
  cutoutDepth: number;
  cutoutKnown: boolean;
  /** Положение внешнего контура от левого края корпуса. */
  x: number;
  /** Отступы от боковых краёв корпуса до внешнего края мойки. */
  left: number;
  right: number;
  /** Фактический отступ в сторону выбранного положения (для центра = left = right). */
  offset: number;
  minOffset: number;
  maxOffset: number;
  /** Обязательные боковые монтажные отступы, мм (50 у края столешницы, 0 к соседу). */
  marginLeft: number;
  marginRight: number;
  /** Положение «по центру» достижимо с учётом обязательных отступов. */
  centerAllowed: boolean;
  /** Монтажная зона (вырез ± монтажный отступ), внутри корпуса. */
  zoneLeft: number;
  zoneRight: number;
  moduleWidth: number;
}

type SinkModuleFields = Pick<
  KitchenModule,
  | "width"
  | "depth"
  | "sinkWidth"
  | "sinkDepth"
  | "sinkPosition"
  | "sinkOffset"
  | "sinkCutout"
>;

/** Поля модуля, по которым считаются авто-перегородки (2 фасада). */
type SinkPartitionSource = Pick<
  KitchenModule,
  | "width"
  | "sinkFacades"
  | "sinkStorage"
  | "sinkPosition"
  | "sinkWidth"
  | "sinkOffset"
  | "sinkDepth"
  | "sinkCutout"
> &
  Partial<Pick<KitchenModule, "depth">>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Округляет значение к шагу 10 мм (1 см). */
export function snapMm(value: number): number {
  const safe = Number.isFinite(value) ? value : 0;
  return Math.round(safe / SINK_RULES.sinkStep) * SINK_RULES.sinkStep;
}

/** Округляет ширину корпуса к шагу 5 см и зажимает в диапазон 40–120 см. */
export function snapSinkWidth(width: number): number {
  const safe = Number.isFinite(width) ? width : SINK_RULES.minWidth;
  const snapped = Math.round(safe / SINK_RULES.widthStep) * SINK_RULES.widthStep;
  return clamp(snapped, SINK_RULES.minWidth, SINK_RULES.maxWidth);
}

export function isSinkStandardWidth(width: number): boolean {
  return (SINK_RULES.standardWidths as readonly number[]).includes(width);
}

export function isSinkStandardSize(widthMm: number, depthMm: number): boolean {
  return SINK_STANDARD_SIZES.some(
    (size) => size.width === widthMm && size.depth === depthMm,
  );
}

/** Максимально допустимая ширина мойки для корпуса, мм (с учётом края ряда). */
export function maxSinkWidthFor(
  moduleWidthCm: number,
  row?: SinkRowContext,
): number {
  const moduleWidth = snapSinkWidth(moduleWidthCm) * 10;
  const margins = sinkRowMargins(row);
  return Math.max(
    SINK_RULES.minSinkWidth,
    Math.min(
      SINK_RULES.maxSinkWidth,
      moduleWidth - margins.left - margins.right,
    ),
  );
}

/** Максимально допустимая глубина мойки для корпуса, мм. */
export function maxSinkDepthFor(moduleDepthCm: number): number {
  const moduleDepth = (Number.isFinite(moduleDepthCm) ? moduleDepthCm : 60) * 10;
  return Math.max(
    SINK_RULES.minSinkDepth,
    Math.min(
      SINK_RULES.maxSinkDepth,
      moduleDepth - 2 * SINK_RULES.mountEdge,
    ),
  );
}

export function clampSinkWidth(
  value: number,
  moduleWidthCm: number,
  row?: SinkRowContext,
): number {
  return clamp(
    snapMm(value),
    SINK_RULES.minSinkWidth,
    maxSinkWidthFor(moduleWidthCm, row),
  );
}

export function clampSinkDepth(value: number, moduleDepthCm: number): number {
  return clamp(
    snapMm(value),
    SINK_RULES.minSinkDepth,
    maxSinkDepthFor(moduleDepthCm),
  );
}

/** Количество фасадов: явное значение из конфигурации либо 2 по умолчанию. */
export function sinkFacadeCount(
  module: Pick<KitchenModule, "width" | "sinkFacades">,
): SinkFacadeCount {
  if (module.sinkFacades === 3) {
    return snapSinkWidth(module.width) >= SINK_RULES.threeDoorMinWidth ? 3 : 2;
  }
  return 2;
}

/** Доступна ли конструкция с тремя фасадами для данной ширины. */
export function sinkThreeDoorAvailable(width: number): boolean {
  return snapSinkWidth(width) >= SINK_RULES.threeDoorMinWidth;
}

/** Доступна ли дополнительная перегородка для данной ширины (2 фасада). */
export function sinkPartitionAvailable(width: number): boolean {
  return snapSinkWidth(width) >= SINK_RULES.partitionMinWidth;
}

/**
 * Индекс дверного зазора, в котором устанавливается конструктивная перегородка
 * трёх фасадов: мойка слева → правый зазор (дверцы 2|3), справа → левый
 * (1|2), по центру перегородки нет (вся зона — коммуникации).
 */
function threeFacadePartitionGapIndex(
  position: KitchenSinkPosition | undefined,
): number {
  if (position === "left") return 1;
  if (position === "right") return 0;
  return -1;
}

/**
 * Фактическое наличие перегородок корпуса (без границы реза бутылочки):
 * - 3 фасада → одна конструктивная перегородка на границе зоны мойки
 *   (по центру — перегородки нет);
 * - 2 фасада → по одной на каждую секцию с полками/ящиками (≥ 65 см):
 *   перегородка стоит у примыкающей к секции стороны зоны. Без наполнения
 *   перегородок нет; сторона бутылочки не участвует — её граница (cut)
 *   и есть перегородка.
 */
export function sinkPartitionCount(
  module: SinkPartitionSource,
  row?: SinkRowContext,
): number {
  if (sinkFacadeCount(module) === 3)
    return threeFacadePartitionGapIndex(module.sinkPosition) >= 0 ? 1 : 0;
  return autoPartitionSides(module, row).length;
}

/**
 * Геометрия мойки внутри корпуса (мм).
 *
 * Положение:
 * - «по центру» — мойка центрируется, отступы равны (если центр достижим
 *   с учётом обязательных боковых отступов);
 * - «слева»/«справа» — задаётся отступ от соответствующего края корпуса
 *   до внешнего края мойки (min = монтажный отступ ЭТОЙ стороны,
 *   max = по остатку ширины с учётом отступа противоположной стороны).
 *
 * Боковые отступы зависят от позиции модуля в ряду (row): 50 мм у края
 * столешницы, 0 мм к соседнему модулю со столешницей. Без контекста ряда —
 * край с обеих сторон (поведение по умолчанию).
 *
 * Если габариты не заданы (старые черновики) — берутся значения по умолчанию
 * с зажимом в допустимый для корпуса диапазон.
 */
export function sinkGeometry(
  module: SinkModuleFields,
  row?: SinkRowContext,
): SinkGeometry {
  const moduleWidth = snapSinkWidth(module.width) * 10;
  const margins = sinkRowMargins(row);
  const width = clampSinkWidth(
    module.sinkWidth ?? SINK_DEFAULTS.width,
    module.width,
    row,
  );
  const depth = clampSinkDepth(
    module.sinkDepth ?? SINK_DEFAULTS.depth,
    module.depth,
  );

  const position: KitchenSinkPosition = module.sinkPosition ?? "center";
  // Отступ считается от выбранной стороны: слева — от левого края, справа —
  // от правого; обязательный минимум — отступ именно этой стороны.
  const sideMin = position === "right" ? margins.right : margins.left;
  const sideMaxMargin = position === "right" ? margins.left : margins.right;
  const minOffset = sideMin;
  const maxOffset = Math.max(minOffset, moduleWidth - width - sideMaxMargin);
  const requested = snapMm(module.sinkOffset ?? minOffset);
  const offset = clamp(requested, minOffset, maxOffset);

  // Достижимость центра: (W − sinkW)/2 должен покрывать оба отступа.
  const centerAllowed =
    (moduleWidth - width) / 2 >= Math.max(margins.left, margins.right) - 0.001;

  let x: number;
  if (position === "left") {
    x = offset;
  } else if (position === "right") {
    x = moduleWidth - width - offset;
  } else {
    x = Math.round((moduleWidth - width) / 2);
  }
  x = clamp(
    x,
    margins.left,
    Math.max(margins.left, moduleWidth - width - margins.right),
  );

  const cutout = module.sinkCutout;
  const cutoutKnown = Boolean(
    cutout &&
      Number.isFinite(cutout.width) &&
      Number.isFinite(cutout.depth) &&
      cutout.width > 0 &&
      cutout.depth > 0,
  );
  const cutoutWidth = cutoutKnown
    ? clamp(cutout!.width, 0, moduleWidth)
    : width;
  const cutoutDepth = cutoutKnown ? cutout!.depth : depth;
  const cutoutX = x + (width - cutoutWidth) / 2;

  // Монтажная зона: вырез ± отступ СВОЕЙ стороны (50 мм у края столешницы,
  // 0 мм к соседнему модулю со столешницей).
  const zoneLeft = clamp(cutoutX - margins.left, 0, moduleWidth);
  const zoneRight = clamp(
    cutoutX + cutoutWidth + margins.right,
    0,
    moduleWidth,
  );

  return {
    position,
    width,
    depth,
    cutoutWidth,
    cutoutDepth,
    cutoutKnown,
    x,
    left: x,
    right: moduleWidth - width - x,
    offset: position === "left" ? x : position === "right" ? moduleWidth - width - x : Math.round((moduleWidth - width) / 2),
    minOffset,
    maxOffset,
    marginLeft: margins.left,
    marginRight: margins.right,
    centerAllowed,
    zoneLeft,
    zoneRight,
    moduleWidth,
  };
}

function intersectsZone(
  boxX: number,
  boxWidth: number,
  zoneLeftMm: number,
  zoneRightMm: number,
): boolean {
  const start = boxX * 10;
  const end = (boxX + boxWidth) * 10;
  return start < zoneRightMm && end > zoneLeftMm;
}

/**
 * Поиск валидной позиции перегородки, если идеальная пересекает монтажную
 * зону мойки: границу сдвигают к краю зоны, пока свободная секция хранения
 * не станет меньше минимума (minStorageSectionWidth). null — сдвиг невозможен.
 */
function resolvePartitionBox(
  widthCm: number,
  geom: SinkGeometry,
  ideal: { x: number; width: number },
  prefer: "right" | "left",
): { x: number; width: number } | null {
  if (!intersectsZone(ideal.x, ideal.width, geom.zoneLeft, geom.zoneRight)) {
    return ideal;
  }
  const gap = SINK_RULES.facadeGap;
  const part = SINK_RULES.partition;
  const side = SINK_RULES.sidePanel;
  const minFree = SINK_RULES.minStorageSectionWidth / 10;
  const zoneL = geom.zoneLeft / 10;
  const zoneR = geom.zoneRight / 10;
  const right = { x: zoneR + gap / 2, free: widthCm - side - (zoneR + gap / 2 + part) };
  const left = { x: zoneL - gap / 2 - part, free: zoneL - gap / 2 - part - side };
  const candidates = prefer === "right" ? [right, left] : [left, right];
  for (const candidate of candidates) {
    if (
      candidate.x >= side - 0.001 &&
      candidate.x + part <= widthCm - side + 0.001 &&
      candidate.free >= minFree
    ) {
      return { x: candidate.x, width: part };
    }
  }
  return null;
}

/**
 * Граница секции бутылочницы: перегородка ровно в N см от края модуля
 * (наружная ширина секции = body, внутренняя = body − bottleClearOffset).
 *
 * Секция берётся из свободных (та, где выбрана бутылочница) и обязана
 * примыкать к БОКОВОМУ краю модуля (только у края): иначе — conflict →
 * ошибка в validation. Если граница не помещается в секцию или пересекает
 * зону мойки — cut не применяется (conflict).
 *
 * Остаток секции за границей уходит в зону коммуникаций (deadRanges):
 * не редактируется, в sinkStorage не попадает, лишняя секция не создаётся.
 */
function applyBottleCut(
  widthCm: number,
  geom: SinkGeometry,
  partitions: SinkPartitionBox[],
  zoneLeftCm: number,
  zoneRightCm: number,
  storage: KitchenSinkStorage[],
): { cuts: SinkPartitionBox[]; sections: SinkSectionLayout[]; conflict: boolean } {
  const baseSections = buildSections(
    widthCm,
    partitions,
    zoneLeftCm,
    zoneRightCm,
    storage,
  );
  const bottleIdx = baseSections.findIndex(
    (item) => !item.comms && item.bottle > 0,
  );
  if (bottleIdx < 0) {
    return { cuts: partitions, sections: baseSections, conflict: false };
  }
  const section = baseSections[bottleIdx];
  const side = SINK_RULES.sidePanel;
  const part = SINK_RULES.partition;
  const inner = section.bottle - SINK_RULES.bottleClearOffset;
  const atLeft = section.x <= side + 0.001;
  const atRight = section.x + section.width >= widthCm - side - 0.001;
  // Бутылочница ставится только у бокового края модуля: секция обязана
  // примыкать к боковине, иначе границу точно поставить нельзя.
  if (!atLeft && !atRight) {
    return { cuts: partitions, sections: baseSections, conflict: true };
  }
  const leftSide = atLeft;
  const x = leftSide ? side + inner : widthCm - side - inner - part;
  const fits =
    x >= section.x - 0.001 && x + part <= section.x + section.width + 0.001;
  // Эпсилон: граница 30.0 см рядом с zoneLeft = 300 мм даёт ложное
  // пересечение из-за двоичной арифметики (28.4 + 1.6 = 30.000000000000004).
  const clear = !intersectsZone(
    x + 0.001,
    part - 0.002,
    geom.zoneLeft,
    geom.zoneRight,
  );
  if (!fits || !clear) {
    return { cuts: partitions, sections: baseSections, conflict: true };
  }
  const cut: SinkPartitionBox = {
    x,
    width: part,
    conflict: false,
    structural: false,
  };
  // Остаток секции за границей бутылочницы уходит в зону коммуникаций:
  // не редактируется, в sinkStorage не попадает, лишняя секция не создаётся.
  const deadRanges: { start: number; end: number }[] = [];
  const remStart = leftSide ? x + part : section.x;
  const remEnd = leftSide ? section.x + section.width : x;
  if (remEnd - remStart > 0.001) {
    deadRanges.push({ start: remStart, end: remEnd });
  }
  // Границы секций строятся по порядку — cut'ы обязаны идти по возрастанию x.
  const cuts = [...partitions, cut].sort((a, b) => a.x - b.x);
  return {
    cuts,
    sections: buildSections(
      widthCm,
      cuts,
      zoneLeftCm,
      zoneRightCm,
      storage,
      deadRanges,
    ),
    conflict: false,
  };
}

/**
 * Сторона предпочтительного сдвига: туда, где больше свободного места под
 * секцию хранения.
 */
function preferredShiftSide(
  widthCm: number,
  geom: SinkGeometry,
): "left" | "right" {
  const side = SINK_RULES.sidePanel;
  const zoneL = geom.zoneLeft / 10;
  const zoneR = geom.zoneRight / 10;
  return widthCm - side - zoneR >= zoneL - side ? "right" : "left";
}

/** Минимальная ширина створки для шва по осевой перегородки, см. */
const MIN_DOOR_WIDTH = SINK_RULES.minStorageSectionWidth / 10;

/**
 * Стороны зоны мойки, где нужна авто-перегородка при двух створках: по
 * одной на каждую секцию с полками/ящиками. Секция бутылочки не участвует —
 * её граница (cut) и есть перегородка для соседней секции коммуникаций.
 * Без наполнения (или уже занятой бутылочницей секции) — сторон нет.
 */
export function autoPartitionSides(
  module: SinkPartitionSource,
  row?: SinkRowContext,
): ("left" | "right")[] {
  if (sinkFacadeCount(module) !== 2) return [];
  const width = snapSinkWidth(module.width);
  if (!sinkPartitionAvailable(width)) return [];
  const storage = Array.isArray(module.sinkStorage) ? module.sinkStorage : [];
  const hasFills = storage.some(
    (fill) => (fill.shelves ?? 0) > 0 || (fill.drawers ?? 0) > 0,
  );
  if (!hasFills) return [];
  const geom = sinkGeometry({ ...module, depth: module.depth ?? 60 }, row);
  const zoneLeftCm = geom.zoneLeft / 10;
  const zoneRightCm = geom.zoneRight / 10;
  // Предварительные секции без перегородок: зона мойки режет корпус на
  // коммуникации и секции хранения — fills распределяются слева направо,
  // как и в итоговом layout.
  const provisional = buildSections(width, [], zoneLeftCm, zoneRightCm, storage);
  const sides: ("left" | "right")[] = [];
  for (const section of provisional) {
    if (section.comms) continue;
    if (section.shelves <= 0 && section.drawers <= 0) continue;
    const onLeft = Math.abs(section.x + section.width - zoneLeftCm) < 0.001;
    const onRight = Math.abs(section.x - zoneRightCm) < 0.001;
    if (onLeft && !sides.includes("left")) sides.push("left");
    else if (onRight && !sides.includes("right")) sides.push("right");
  }
  return sides;
}

/**
 * Позиция авто-перегородки у указанной стороны зоны мойки: вплотную к краю
 * зоны (с косметическим зазором gap/2, где возможно), но так, чтобы
 * примыкающая секция хранения осталась ≥ minStorageSectionWidth.
 * null — перегородку поставить некуда.
 */
function partitionBoxForSide(
  widthCm: number,
  geom: SinkGeometry,
  side: "left" | "right",
): { x: number; width: number } | null {
  const gap = SINK_RULES.facadeGap;
  const part = SINK_RULES.partition;
  const edge = SINK_RULES.sidePanel;
  const minFree = SINK_RULES.minStorageSectionWidth / 10;
  const zoneL = geom.zoneLeft / 10;
  const zoneR = geom.zoneRight / 10;
  if (side === "left") {
    // Внутри секции [edge, zoneL]: не пересекает зону и оставляет слева ≥ minFree.
    const loose = zoneL - gap / 2 - part;
    const tight = zoneL - part;
    const min = edge + minFree;
    if (tight < min - 0.001) return null;
    return { x: Math.min(Math.max(loose, min), tight), width: part };
  }
  // Внутри секции [zoneR, widthCm − edge]: оставляет справа ≥ minFree.
  const loose = zoneR + gap / 2;
  const tight = zoneR;
  const max = widthCm - edge - minFree - part;
  if (tight > max + 0.001) return null;
  return { x: Math.max(Math.min(loose, max), tight), width: part };
}

/**
 * Панели фасада, выведенные из фактических секций и перегородок:
 * - каждая секция с выбранным наполнением получает свою панель — полки →
 *   распашная створка, ящики → стопка фронтов (fronts), бутылочка → узкая
 *   панель без петель;
 * - шов панели — осевая линия соседней перегородки (в т.ч. границы реза
 *   бутылочки), либо граница секции/зоны коммуникаций; у бокового края
 *   панель доходит до края дверного поля (как створки);
 * - остаток поля (зоны коммуникаций и секции без наполнения) делят базовые
 *   створки (2/3) пропорционально по участкам, шов — на осевой перегородки.
 * Монтажные зазоры прежние: 2 мм у края ряда, 1 мм между панелями,
 * створки перекрывают половину перегородки.
 */
function computeFacadeBoxes(
  widthCm: number,
  facades: SinkFacadeCount,
  sections: SinkSectionLayout[],
  cuts: SinkPartitionBox[],
  leftGap: number,
  rightGap: number,
): SinkFacadeBox[] {
  const inner = SINK_RULES.facadeInnerGap;
  const side = SINK_RULES.sidePanel;
  const fieldL = leftGap;
  const fieldR = widthCm - rightGap;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
  const seamOf = (cut: SinkPartitionBox) => cut.x + cut.width / 2;

  // Секции с наполнением → свои панели; поля между ними → створки.
  const panels: { box: SinkFacadeBox; leftSeam: number | null; rightSeam: number | null }[] = [];
  for (const section of sections) {
    if (section.comms) continue;
    if (section.shelves <= 0 && section.drawers <= 0 && section.bottle <= 0) continue;
    const leftCut = cuts.find((cut) => near(cut.x + cut.width, section.x));
    const rightCut = cuts.find((cut) => near(cut.x, section.x + section.width));
    const atLeft = section.x <= side + 0.001;
    const atRight = section.x + section.width >= widthCm - side - 0.001;
    const leftSeam = leftCut
      ? seamOf(leftCut)
      : atLeft
        ? null // у боковины — панель от края дверного поля, шва нет
        : section.x;
    const rightSeam = rightCut
      ? seamOf(rightCut)
      : atRight
        ? null
        : section.x + section.width;
    const start = leftSeam === null ? fieldL : leftSeam + inner / 2;
    const end = rightSeam === null ? fieldR : rightSeam - inner / 2;
    if (end - start <= 0.001) continue;
    const kind: SinkFacadeBox["kind"] =
      section.bottle > 0 ? "bottle" : section.drawers > 0 ? "drawers" : "door";
    panels.push({
      box: {
        x: start,
        width: end - start,
        kind,
        ...(kind === "drawers" ? { fronts: section.drawers } : {}),
      },
      leftSeam,
      rightSeam,
    });
  }

  // Участки дверного поля между панелями (по швам — ± половина зазора).
  const runs: { start: number; end: number }[] = [];
  let cursor = fieldL;
  for (const panel of panels) {
    if (panel.leftSeam !== null) {
      const runEnd = panel.leftSeam - inner / 2;
      if (runEnd - cursor > 0.001) runs.push({ start: cursor, end: runEnd });
      cursor = panel.leftSeam + inner / 2;
    }
    if (panel.rightSeam !== null) {
      cursor = Math.max(cursor, panel.rightSeam + inner / 2);
    } else {
      // Панель у правого края поля — участка справа от неё нет.
      cursor = fieldR;
    }
  }
  if (fieldR - cursor > 0.001) runs.push({ start: cursor, end: fieldR });

  // Базовые створки (2/3) распределяются по участкам пропорционально;
  // если участков больше базовых — каждый получает створку.
  const total = runs.reduce((sum, run) => sum + (run.end - run.start), 0);
  const counts: number[] =
    runs.length > 0 && total > 0
      ? facades >= runs.length
        ? distributeDoors(facades, runs, total)
        : runs.map(() => 1)
      : [];

  const uniform = (start: number, end: number, count: number): SinkFacadeBox[] => {
    if (count <= 1 || end - start <= 0.001) return [{ x: start, width: Math.max(0, end - start), kind: "door" }];
    const cell = (end - start - inner * (count - 1)) / count;
    if (cell <= 0) return [{ x: start, width: Math.max(0, end - start), kind: "door" }];
    return Array.from({ length: count }, (_, index) => ({
      x: start + index * (cell + inner),
      width: cell,
      kind: "door" as const,
    }));
  };

  // Участок дверного поля: шов — на осевой перегородки (если она внутри),
  // иначе равномерно. Створки перекрывают половину перегородки.
  const splitRun = (start: number, end: number, count: number): SinkFacadeBox[] => {
    if (count <= 1) return uniform(start, end, 1);
    const seam = cuts
      .map(seamOf)
      .find((center) => center > start && center < end && center - start >= MIN_DOOR_WIDTH && end - center >= MIN_DOOR_WIDTH);
    if (seam === undefined) return uniform(start, end, count);
    const leftWidth = seam - start;
    const rightWidth = end - seam;
    const leftCount = clamp(
      Math.round((count * leftWidth) / (leftWidth + rightWidth)),
      1,
      count - 1,
    );
    return [
      ...uniform(start, seam - inner / 2, leftCount),
      ...uniform(seam + inner / 2, end, count - leftCount),
    ];
  };

  const doors: SinkFacadeBox[] = [];
  runs.forEach((run, index) => doors.push(...splitRun(run.start, run.end, counts[index] ?? 1)));

  return [...panels.map((panel) => panel.box), ...doors].sort((a, b) => a.x - b.x);
}

/** Распределяет базовые створки по участкам пропорционально их ширине. */
function distributeDoors(
  base: number,
  runs: { start: number; end: number }[],
  total: number,
): number[] {
  const exact = runs.map((run) => (base * (run.end - run.start)) / total);
  const counts = exact.map((value) => Math.max(1, Math.floor(value)));
  let rest = base - counts.reduce((sum, count) => sum + count, 0);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  let cursor = 0;
  while (rest > 0 && byFraction.length > 0) {
    counts[byFraction[cursor % byFraction.length].index] += 1;
    rest -= 1;
    cursor += 1;
  }
  return counts;
}

/**
 * true — авто-перегородка корпуса (2 фасада) установить невозможно там, где
 * нужна: место под ней занято мойкой и сместить её некуда (секция была бы
 * < 10 см). Секции с полками/ящиками в таком модуле крепить некуда;
 * бутылочница от неё не зависит (её граница — собственный cut). Сообщение
 * по ТЗ п.8.
 */
export function sinkPartitionConflicts(
  module: Pick<
    KitchenModule,
    | "width"
    | "depth"
    | "sinkWidth"
    | "sinkDepth"
    | "sinkPosition"
    | "sinkOffset"
    | "sinkCutout"
    | "sinkFacades"
    | "sinkStorage"
  >,
  row?: SinkRowContext,
): boolean {
  const width = snapSinkWidth(module.width);
  if (sinkFacadeCount(module) !== 2) return false;
  if (!sinkPartitionAvailable(width)) return false;
  const geom = sinkGeometry(module, row);
  // С наполнением — по сторонам с полками/ящиками: если хотя бы одну
  // перегородку некуда поставить, наполнение не крепится.
  const sides = autoPartitionSides(module, row);
  if (sides.length > 0) {
    return sides.some((side) => partitionBoxForSide(width, geom, side) === null);
  }
  // Без наполнения — предупреждаем, если перегородку невозможно поставить
  // ни с одной стороны (в корпус вообще не помещается секция ≥ 10 см).
  return (
    partitionBoxForSide(width, geom, "left") === null &&
    partitionBoxForSide(width, geom, "right") === null
  );
}

/** Сводка панелей фасада модуля мойки (для расчёта и отображения). */
export interface SinkFacadeTotals {
  /** Распашные створки — петли/ручки/доводчики. */
  doors: number;
  /** Фронты ящиков — каждый отдельный фасад (площадь/ручка). */
  fronts: number;
  /** Панели бутылочницы — без петель и ручки. */
  bottle: number;
  /** Всего панелей с учётом фронтов. */
  panels: number;
}

/** Считает панели фасада по фактическому layout (без двойного счёта). */
export function sinkFacadeTotals(
  module: Parameters<typeof sinkLayout>[0],
  row?: SinkRowContext,
): SinkFacadeTotals {
  const layout = sinkLayout(module, undefined, row);
  let doors = 0;
  let fronts = 0;
  let bottle = 0;
  for (const box of layout.facadeBoxes) {
    if (box.kind === "door") doors += 1;
    else if (box.kind === "drawers") fronts += box.fronts ?? 1;
    else bottle += 1;
  }
  return { doors, fronts, bottle, panels: doors + fronts + bottle };
}

/** Нормализует наполнение секций: обрезает массив по числу свободных секций, зажимает значения. */
export function normalizeSinkStorage(
  module: { sinkStorage?: KitchenSinkStorage[] },
  freeSections: number,
): KitchenSinkStorage[] {
  const source = Array.isArray(module.sinkStorage) ? module.sinkStorage : [];
  const result: KitchenSinkStorage[] = [];
  for (let i = 0; i < freeSections; i += 1) {
    const fill = source[i] ?? { shelves: 0, drawers: 0 };
    // Бутылочница занимает секцию целиком — полки и ящики не сочетаются.
    const bottle: 0 | 15 | 20 | 30 = (
      SINK_RULES.bottleBodies as readonly number[]
    ).includes(fill.bottle ?? 0)
      ? (fill.bottle as 15 | 20 | 30)
      : 0;
    if (bottle) {
      result.push({ shelves: 0, drawers: 0, bottle });
      continue;
    }
    const shelves = clamp(Math.round(fill.shelves) || 0, 0, SINK_RULES.maxShelvesPerSection);
    let drawers = Math.round(fill.drawers) || 0;
    if (drawers > 0) {
      drawers = clamp(drawers === 1 ? 2 : drawers, 2, SINK_RULES.maxDrawersPerSection);
    } else {
      drawers = 0;
    }
    // Один доп на секцию: при легаси-данных с полками и ящиками
    // оставляем полки, ящики обнуляем (согласованное решение).
    const safeDrawers = shelves > 0 ? 0 : drawers;
    result.push({ shelves, drawers: safeDrawers });
  }
  return result;
}

/**
 * Кнопочный шаг по ящикам: 1 шт. недопустимо (минимум 2). Уменьшение со
 * 2 до 1 трактуется как сброс к 0 (3 → 2 → 0), увеличение с 0 до 1 — как
 * минимум 2. Иначе кнопка «−» застревает на 2 и обнулить ящики нельзя.
 */
export function resolveDrawerCount(current: number, requested: number): number {
  if (requested !== 1) return requested;
  return current > 1 ? 0 : 2;
}

/**
 * Секции корпуса: перегородки делят корпус на ячейки, ячейки дополнительно
 * режутся монтажной зоной мойки. Участки зоны — коммуникации (наполнение
 * запрещено); участки уже minStorageSectionWidth — секции хранения.
 * Узкие остатки (< minStorageSectionWidth) становятся мёртвыми зазорами.
 */
function buildSections(
  width: number,
  cuts: { x: number; width: number }[],
  zoneLeftCm: number,
  zoneRightCm: number,
  storage: KitchenSinkStorage[],
  deadRanges: { start: number; end: number }[] = [],
): SinkSectionLayout[] {
  const side = SINK_RULES.sidePanel;
  const innerL = side;
  const innerR = width - side;

  type Segment = { start: number; end: number; comms: boolean };
  const segments: Segment[] = [];
  const bounds: { start: number; end: number }[] = [];
  let cursor = innerL;
  for (const cut of cuts) {
    bounds.push({ start: cursor, end: cut.x });
    cursor = cut.x + cut.width;
  }
  bounds.push({ start: cursor, end: innerR });

  for (const bound of bounds) {
    const start = bound.start;
    const end = bound.end;
    if (end - start <= 0.001) continue;
    const zL = Math.max(start, zoneLeftCm);
    const zR = Math.min(end, zoneRightCm);
    if (zR - zL > 0.001) {
      if (zL - start > 0.001) segments.push({ start, end: zL, comms: false });
      segments.push({ start: zL, end: zR, comms: true });
      if (end - zR > 0.001) segments.push({ start: zR, end, comms: false });
    } else {
      segments.push({ start, end, comms: false });
    }
  }

  const merged = segments;
  // Остаток после реза бутылочницы (deadRanges) принадлежит зоне
  // коммуникаций: не редактируется и не участвует в sinkStorage.
  if (deadRanges.length) {
    for (const segment of merged) {
      if (segment.comms) continue;
      if (
        deadRanges.some(
          (range) =>
            segment.start >= range.start - 0.001 &&
            segment.end <= range.end + 0.001,
        )
      ) {
        segment.comms = true;
      }
    }
  }
  // Слияние мелких свободных остатков: слишком узкий участок хранения
  // превращается в мёртвый зазор (коммуникации), геометрия границ не растягивается.
  const minStorage = SINK_RULES.minStorageSectionWidth / 10;
  for (const segment of merged) {
    if (!segment.comms && segment.end - segment.start < minStorage - 0.001) {
      segment.comms = true;
    }
  }

  const freeCount = merged.filter((item) => !item.comms).length;
  const fills = normalizeSinkStorage({ sinkStorage: storage }, freeCount);
  let freeIndex = 0;
  return merged.map((segment, index) => {
    const comms = segment.comms;
    const fill = comms
      ? { shelves: 0, drawers: 0, bottle: 0 }
      : fills[freeIndex++];
    return {
      index,
      x: segment.start,
      width: Math.max(0, segment.end - segment.start),
      comms,
      shelves: fill.shelves,
      drawers: fill.drawers,
      bottle: fill.bottle ?? 0,
    };
  });
}

/**
 * Полная геометрия модуля под мойку.
 *
 * Ширина створки считается с учётом боковин, перегородок и монтажных зазоров.
 * Если перегородка пересекает монтажную зону мойки — её границу сдвигают к
 * краю зоны (секция хранения уменьшается, но не ниже 10 см); при невозможности
 * сдвига — conflict (красная подсветка/ошибка в validation).
 * Второй аргумент — монтажные зазоры фасада для рендера (2 мм у края ряда,
 * 1 мм к соседу); по умолчанию — край ряда с обеих сторон. Третий аргумент —
 * контекст края столешницы (см. SinkRowContext): без него край с обеих сторон.
 */
export function sinkLayout(
  module: Pick<
    KitchenModule,
    | "width"
    | "height"
    | "sinkFacades"
    | "sinkStorage"
    | "depth"
    | "sinkWidth"
    | "sinkDepth"
    | "sinkPosition"
    | "sinkOffset"
    | "sinkCutout"
  >,
  gaps?: { left?: number; right?: number },
  row?: SinkRowContext,
): SinkLayout {
  const width = snapSinkWidth(module.width);
  const facades = sinkFacadeCount(module);
  const gap = SINK_RULES.facadeGap;
  const side = SINK_RULES.sidePanel;
  const part = SINK_RULES.partition;
  const geom = sinkGeometry(module, row);
  const zoneLeftCm = geom.zoneLeft / 10;
  const zoneRightCm = geom.zoneRight / 10;
  const gapLeft = gaps?.left ?? SINK_RULES.facadeEdgeGap;
  const gapRight = gaps?.right ?? SINK_RULES.facadeEdgeGap;

  const partitions: SinkPartitionBox[] = [];
  if (facades === 3) {
    // Одна конструктивная перегородка — точка крепления створок на границе
    // зоны коммуникаций и свободного пространства. Слева → правый зазор
    // между дверцей 2 и 3, справа → левый (1|2), по центру — нет (вся зона
    // под коммуникации, ставить перегородку некуда).
    const partGapIndex = threeFacadePartitionGapIndex(module.sinkPosition);
    const partCount = partGapIndex >= 0 ? 1 : 0;
    const usable =
      width - 2 * side - (facades - 1) * gap - partCount * part;
    const doorWidth = usable / facades;
    const doorXs: number[] = [];
    let cursor = side;
    for (let i = 0; i < facades; i += 1) {
      doorXs.push(cursor);
      cursor += doorWidth;
      if (i < facades - 1) {
        cursor += gap;
        if (i === partGapIndex) cursor += part;
      }
    }
    if (partGapIndex >= 0) {
      // Идеальная позиция — в своём зазоре (дверца + gap/2). Если она
      // пересекает зону мойки — границу сдвигаем к краю зоны (секция ≥ 10 см).
      const ideal = {
        x: doorXs[partGapIndex] + doorWidth + gap / 2,
        width: part,
      };
      const resolved = resolvePartitionBox(
        width,
        geom,
        ideal,
        preferredShiftSide(width, geom),
      );
      if (resolved) {
        partitions.push({
          ...resolved,
          conflict: intersectsZone(
            resolved.x,
            resolved.width,
            geom.zoneLeft,
            geom.zoneRight,
          ),
          structural: true,
        });
      } else {
        // Сдвиг невозможен (секция была бы < 10 см) — оставляем как есть,
        // conflict → предупреждение и красная подсветка.
        partitions.push({ ...ideal, conflict: true, structural: true });
      }
    }
    const applied = applyBottleCut(
      width,
      geom,
      partitions,
      zoneLeftCm,
      zoneRightCm,
      Array.isArray(module.sinkStorage) ? module.sinkStorage : [],
    );
    return {
      facades,
      partitionCount: partitions.length,
      doorWidth,
      doorXs,
      partitions,
      sections: applied.sections,
      facadeBoxes: computeFacadeBoxes(
        width,
        facades,
        applied.sections,
        applied.cuts,
        gapLeft,
        gapRight,
      ),
      sectionCuts: applied.cuts,
      bottleConflict: applied.conflict,
    };
  }

  // 2 фасада: перегородка — часть корпуса, по одной у каждой секции с
  // полками/ящиками (шов створок — на её осевой). Без наполнения
  // перегородок нет; сторона бутылочки не участвует — её граница (cut)
  // и есть перегородка для соседней секции коммуникаций.
  for (const sideOfZone of autoPartitionSides(module, row)) {
    const box = partitionBoxForSide(width, geom, sideOfZone);
    if (box) {
      partitions.push({
        ...box,
        conflict: intersectsZone(
          box.x,
          box.width,
          geom.zoneLeft,
          geom.zoneRight,
        ),
        structural: false,
      });
    }
  }
  partitions.sort((a, b) => a.x - b.x);

  const partitionsBetween = partitions.length;
  const usable =
    width - 2 * side - (facades - 1) * gap - partitionsBetween * part;
  const doorWidth = usable / facades;

  // Все перегородки по порядку распределяются по дверным зазорам: лишние
  // (при двух секциях наполнения — обе) идут в тот же зазор подряд.
  const partsInGap = Array.from(
    { length: Math.max(0, facades - 1) },
    () => 0,
  );
  partitions.forEach((partition, index) => {
    const gapIndex = Math.min(index, partsInGap.length - 1);
    if (gapIndex >= 0) partsInGap[gapIndex] += partition.width;
  });
  const doorXs: number[] = [];
  let cursor = side;
  for (let i = 0; i < facades; i += 1) {
    doorXs.push(cursor);
    cursor += doorWidth;
    if (i < facades - 1) {
      cursor += gap + (partsInGap[i] ?? 0);
    }
  }

  const applied = applyBottleCut(
    width,
    geom,
    partitions,
    zoneLeftCm,
    zoneRightCm,
    Array.isArray(module.sinkStorage) ? module.sinkStorage : [],
  );

  return {
    facades,
    partitionCount: partitions.length,
    doorWidth,
    doorXs,
    partitions,
    sections: applied.sections,
    facadeBoxes: computeFacadeBoxes(
      width,
      facades,
      applied.sections,
      applied.cuts,
      gapLeft,
      gapRight,
    ),
    sectionCuts: applied.cuts,
    bottleConflict: applied.conflict,
  };
}

/**
 * Приводит модуль под мойку к корректному состоянию: зажимает габариты и
 * отступ в допустимые пределы (с учётом края ряда), снимает конфликтующую
 * перегородку, обрезает наполнение по числу доступных секций. Стандартный
 * типоразмер после зажима остаётся стандартным (nearestStandardSink).
 */
export function normalizeSinkModule(
  module: KitchenModule,
  row?: SinkRowContext,
): KitchenModule {
  if (module.type !== "sink") return module;
  const geom = sinkGeometry(module, row);
  const patch: Partial<KitchenModule> = {};
  if (module.sinkWidth !== undefined && module.sinkWidth !== geom.width) {
    patch.sinkWidth = geom.width;
  }
  if (module.sinkDepth !== undefined && module.sinkDepth !== geom.depth) {
    patch.sinkDepth = geom.depth;
  }
  // Зажим сломал стандартный размер — подбираем ближайший стандартный,
  // который помещается в этот корпус (ширина важнее глубины).
  const requestedW = module.sinkWidth ?? SINK_DEFAULTS.width;
  const requestedD = module.sinkDepth ?? SINK_DEFAULTS.depth;
  if (
    isSinkStandardSize(requestedW, requestedD) &&
    !isSinkStandardSize(geom.width, geom.depth)
  ) {
    const nearest = nearestStandardSink(
      requestedW,
      requestedD,
      maxSinkWidthFor(module.width, row),
      maxSinkDepthFor(module.depth),
    );
    if (nearest) {
      patch.sinkWidth = nearest.width;
      patch.sinkDepth = nearest.depth;
    }
  }
  if (module.sinkOffset !== undefined && geom.position !== "center") {
    const snapped = clamp(
      snapMm(module.sinkOffset),
      geom.minOffset,
      geom.maxOffset,
    );
    if (snapped !== module.sinkOffset) patch.sinkOffset = snapped;
  }
  const next = { ...module, ...patch };
  // Устаревшая опция перегородки: она — часть корпуса и вычисляется
  // автоматически, старое значение из черновиков чистим.
  if (next.sinkPartition !== undefined) patch.sinkPartition = undefined;
  const merged = { ...module, ...patch };
  // Авто-перегородка невозможна (мойка заняла место) или конструктивная
  // перегородка (3 фасада) конфликтует с зоной — полки и ящики крепить
  // некуда, обнуляем. Бутылочница от перегородки не зависит (её граница —
  // собственный cut) и сохраняется; её конфликт показывает validation.
  const fillBlocked =
    sinkPartitionConflicts(merged, row) ||
    sinkLayout(merged, undefined, row).partitions.some(
      (partition) => partition.structural && partition.conflict,
    );
  const layout = sinkLayout(merged, undefined, row);
  const freeSections = layout.sections.filter((section) => !section.comms);
  const free = freeSections.length;
  // Бутылочница допустима только у бокового края корпуса (секция примыкает
  // к боковине — isBottleEdgeSection) и только одна: остальные выборы
  // очищаются. Конфликт с зоной мойки при этом НЕ очищается — выбор
  // сохраняется, ошибка видна в UI.
  const rawStorage = Array.isArray(merged.sinkStorage) ? merged.sinkStorage : [];
  const edgeBottleIndex = rawStorage.findIndex((fill, index) => {
    const section = freeSections[index];
    return (
      Boolean(fill.bottle) &&
      section !== undefined &&
      isBottleEdgeSection(section, merged.width)
    );
  });
  const aligned = rawStorage.map((fill, index) =>
    fill.bottle && index !== edgeBottleIndex
      ? { shelves: 0, drawers: 0 }
      : fill,
  );
  const storage: KitchenSinkStorage[] = fillBlocked
    ? normalizeSinkStorage(
        {
          sinkStorage: aligned.map((fill) => ({
            shelves: 0,
            drawers: 0,
            ...(fill.bottle ? { bottle: fill.bottle } : {}),
          })),
        },
        free,
      )
    : normalizeSinkStorage({ sinkStorage: aligned }, free);
  const changed =
    !Array.isArray(merged.sinkStorage) ||
    merged.sinkStorage.length !== storage.length ||
    storage.some(
      (item, index) =>
        item.shelves !== merged.sinkStorage![index]?.shelves ||
        item.drawers !== merged.sinkStorage![index]?.drawers ||
        (item.bottle ?? 0) !== (merged.sinkStorage![index]?.bottle ?? 0),
    );
  if (changed) patch.sinkStorage = storage;
  return { ...module, ...patch };
}
