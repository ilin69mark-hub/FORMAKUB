import { KITCHEN_MODULES } from "@/content/catalog";
import {
  MODULE_LOAD_KG,
  MODULE_LOAD_REFERENCE_WIDTH,
  SUPPORTS_PRELIMINARY_NOTE,
  findPlinthMount,
  findSupportSystem,
} from "@/content/supports";
import type { SupportSystem } from "@/content/supports";
import type {
  KitchenConfig,
  KitchenModule,
  KitchenModuleType,
  SupportSystemId,
} from "./types";
import { sinkLayout, sinkRowContext } from "./sink";

/**
 * Расчёт опор (мебельных ножек) нижнего ряда.
 *
 * Принцип: опоры ставятся под несущими вертикальными элементами корпуса —
 * боковинами и внутренними перегородками. Количество определяется
 * допустимым расстоянием между опорами и предполагаемой нагрузкой, поэтому
 * вместо правила «4 ножки на модуль» широкие корпуса получают дополнительные
 * промежуточные опоры, а узкие — ровно столько, сколько допускает
 * конструкция.
 *
 * Всё, что влияет на результат (система опор, пролёт, нагрузка на опору),
 * лежит в конфигурации проекта и в каталоге систем опор — паспортные
 * характеристики конкретной производственной системы подставляются без
 * изменения кода расчёта.
 *
 * Результат является предварительным до привязки к конкретной фурнитуре.
 */

export type SupportPositionKind = "edge" | "partition" | "span" | "tall-center";

export interface SupportPosition {
  /** Центр опоры от левого торца модуля, см. */
  x: number;
  kind: SupportPositionKind;
}

export interface ModuleSupports {
  moduleId: string;
  moduleType: KitchenModuleType;
  /** У модуля нет мебельных опор (собственная опора техники или навесной модуль). */
  excluded: boolean;
  /** Причина исключения, если опоры не считаются. */
  reason?: string;
  /** Фактические места установки: от левого торца модуля, см. */
  positions: SupportPosition[];
  /** Передний ряд опор. */
  front: number;
  /** Задний ряд опор. */
  back: number;
  /** Всего опор в модуле. */
  legs: number;
  /** Клипсы цоколя на передние опоры (0, если цоколь не выбран). */
  clips: number;
  /** Винты скрытого крепления цоколя. */
  screws: number;
  /** Крепления к стене (для пеналов). */
  anchors: number;
}

export interface SupportPlan {
  systemId: SupportSystemId;
  modules: ModuleSupports[];
  /** Количество мебельных опор. */
  legs: number;
  frontLegs: number;
  backLegs: number;
  /** Клипсы цоколя. */
  clips: number;
  /** Винты скрытого крепления цоколя. */
  screws: number;
  /** Крепления к стене. */
  anchors: number;
  /** Стоимость опор и крепежа, ₽. */
  cost: number;
  /** Разбивка стоимости по видам крепежа, ₽. */
  costParts: { legs: number; clips: number; screws: number; anchors: number };
  /** Расчёт предварительный (нужны паспортные данные фурнитуры). */
  preliminary: boolean;
  note: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Минимально допустимый шаг между опорами внутри корпуса, см. */
const MIN_LEG_SPACING_CM = 8;
/** Допуск совмещения позиции с перегородкой, см. */
const PARTITION_SNAP_CM = 4;
/** Допуск объединения совпадающих позиций, см. */
const MERGE_TOLERANCE_CM = 1.5;

function zoneOf(module: KitchenModule): "floor" | "upper" {
  return KITCHEN_MODULES[module.type]?.zone ?? "upper";
}

function isTallModule(module: KitchenModule): boolean {
  return module.type === "tall" || module.type === "oven";
}

/** Позиции внутренних перегородок модуля, см от левого торца. */
function partitionPositions(
  module: KitchenModule,
  config: KitchenConfig,
): number[] {
  if (module.type !== "sink") return [];
  try {
    const layout = sinkLayout(
      module,
      undefined,
      sinkRowContext(config.modules, module.id),
    );
    // Только несущие перегородки: граница секции бутылочки — узкая панель
    // без петель, нагрузку она не передаёт и опору под неё не ставят.
    return layout.partitions.map((cut) => cut.x + cut.width / 2);
  } catch {
    return [];
  }
}

function mergePositions(positions: SupportPosition[]): SupportPosition[] {
  const sorted = [...positions].sort((a, b) => a.x - b.x);
  const result: SupportPosition[] = [];
  for (const position of sorted) {
    const previous = result[result.length - 1];
    if (previous && Math.abs(previous.x - position.x) <= MERGE_TOLERANCE_CM) {
      // Перегородка важнее условного распределения: опора встаёт точно под ней.
      if (position.kind === "partition") {
        previous.x = position.x;
        previous.kind = "partition";
      }
      continue;
    }
    result.push({ ...position });
  }
  return result;
}

function positionsForModule(
  module: KitchenModule,
  config: KitchenConfig,
  system: SupportSystem,
  maxSpanCm: number,
  maxLoadKgPerLeg: number,
): SupportPosition[] {
  const width = module.width;
  const edgeInset = clamp(Math.round(system.edgeInsetCm), 1, Math.floor(width / 4));
  const loadPerModule =
    (MODULE_LOAD_KG[module.type] ?? 0) *
    (width / (MODULE_LOAD_REFERENCE_WIDTH[module.type] || 60));

  // 1) Требование по пролёту: стойки от торца до торца с шагом не больше допустимого.
  const innerWidth = Math.max(0, width - edgeInset * 2);
  const spanCount = Math.max(2, Math.ceil(innerWidth / maxSpanCm) + 1);

  // 2) Требование по нагрузке: одна позиция — пара опор (спереди и сзади).
  const loadCount = Math.max(
    2,
    Math.ceil(loadPerModule / Math.max(1, maxLoadKgPerLeg * 2)),
  );

  // 3) Пеналы: отдельная методика — повышенная масса и высота требуют
  //    промежуточной опоры уже по ширине и обязательного крепления к стене.
  const tallRule = isTallModule(module)
    ? width >= system.tallCenterLegWidthCm
      ? 3
      : 2
    : 2;

  const target = Math.max(spanCount, loadCount, tallRule);
  const maxBySpacing =
    Math.floor(innerWidth / MIN_LEG_SPACING_CM) + (innerWidth > 0 ? 1 : 0);
  const count = clamp(target, 2, Math.max(2, maxBySpacing));

  const positions: SupportPosition[] = [];
  const add = (x: number, kind: SupportPositionKind) => {
    if (x < 0.5 || x > width - 0.5) return;
    positions.push({ x: Math.round(x * 10) / 10, kind });
  };

  // Крайние опоры — под боковинами.
  if (innerWidth >= 2) {
    add(edgeInset, "edge");
    add(width - edgeInset, "edge");
  } else {
    add(width / 2, "edge");
  }

  // Промежуточные позиции равномерно внутри несущих габаритов.
  for (let index = 1; index < count - 1; index += 1) {
    if (innerWidth <= 0) break;
    add(edgeInset + (innerWidth * index) / (count - 1), "span");
  }

  // Пеналы шире порога получают центральную опору под повышенной массой.
  if (
    isTallModule(module) &&
    width >= system.tallCenterLegWidthCm &&
    innerWidth > 0
  ) {
    add(width / 2, "tall-center");
  }

  // Внутренние перегородки — несущие элементы: опоры устанавливаются под ними.
  for (const partition of partitionPositions(module, config)) {
    if (partition <= edgeInset + PARTITION_SNAP_CM) continue;
    if (partition >= width - edgeInset - PARTITION_SNAP_CM) continue;
    add(partition, "partition");
  }

  return mergePositions(positions);
}

function supportsForModule(
  module: KitchenModule,
  config: KitchenConfig,
  system: SupportSystem,
  maxSpanCm: number,
  maxLoadKgPerLeg: number,
  plinthClips: boolean,
  plinthScrews: boolean,
): ModuleSupports {
  const base: ModuleSupports = {
    moduleId: module.id,
    moduleType: module.type,
    excluded: false,
    positions: [],
    front: 0,
    back: 0,
    legs: 0,
    clips: 0,
    screws: 0,
    anchors: 0,
  };

  if (zoneOf(module) !== "floor") {
    return { ...base, excluded: true, reason: "Навесной модуль верхнего ряда" };
  }

  if (module.ownSupports === true) {
    return {
      ...base,
      excluded: true,
      reason: "Техника опирается на собственные регулируемые ножки",
    };
  }

  const positions = positionsForModule(
    module,
    config,
    system,
    maxSpanCm,
    maxLoadKgPerLeg,
  );

  // Каждая позиция — передняя и задняя опора под несущими элементами.
  const front = positions.length;
  const back = positions.length;
  const legs = front + back;

  // Цоколь крепится только к опорам нижнего ряда по его лицевой стороне.
  const clips = plinthClips ? front * system.clipsPerLeg : 0;
  const screws = plinthScrews ? front * system.screwsPerLeg : 0;

  // Пеналы: крепление к стене от высоты корпуса (плюс промежуточные опоры
  // добавляются на уровне позиций при ширине от порога системы).
  const anchors = isTallModule(module)
    ? Math.max(1, Math.ceil(module.height / system.tallAnchorSpacingCm))
    : 0;

  return {
    ...base,
    positions,
    front,
    back,
    legs,
    clips,
    screws,
    anchors,
  };
}

export function computeSupports(config: KitchenConfig): SupportPlan {
  const system = findSupportSystem(config.supports?.systemId);
  const maxSpanCm = config.supports?.maxSpanCm ?? system.maxSpanCm;
  const maxLoadKgPerLeg = config.supports?.maxLoadKgPerLeg ?? system.maxLoadKgPerLeg;

  const mount = findPlinthMount(config.plinthMount);
  const plinthClips = config.plinth === true && mount.id === "clips";
  const plinthScrews = config.plinth === true && mount.id === "hidden";

  const modules = config.modules.map((module) =>
    supportsForModule(
      module,
      config,
      system,
      maxSpanCm,
      maxLoadKgPerLeg,
      plinthClips,
      plinthScrews,
    ),
  );

  const legs = modules.reduce((sum, item) => sum + item.legs, 0);
  const frontLegs = modules.reduce((sum, item) => sum + item.front, 0);
  const backLegs = modules.reduce((sum, item) => sum + item.back, 0);
  const clips = modules.reduce((sum, item) => sum + item.clips, 0);
  const screws = modules.reduce((sum, item) => sum + item.screws, 0);
  const anchors = modules.reduce((sum, item) => sum + item.anchors, 0);

  const cost =
    legs * system.legPrice +
    clips * system.clipPrice +
    screws * system.screwPrice +
    anchors * system.anchorPrice;

  return {
    systemId: system.id,
    modules,
    legs,
    frontLegs,
    backLegs,
    clips,
    screws,
    anchors,
    cost,
    costParts: {
      legs: legs * system.legPrice,
      clips: clips * system.clipPrice,
      screws: screws * system.screwPrice,
      anchors: anchors * system.anchorPrice,
    },
    preliminary: system.source === "preliminary",
    note: SUPPORTS_PRELIMINARY_NOTE,
  };
}
