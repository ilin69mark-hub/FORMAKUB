import type {
  CalculationBreakdown,
  CalculationInputs,
  CalculationLine,
  CatalogItemInput,
  ModulePresetInput,
  PriceRulesInput,
  SignedAdjustmentInput,
} from "./contract";
import type {
  FurnitureConfig,
  KitchenConfig,
  KitchenModule,
  PromoResult,
  WardrobeConfig,
} from "./types";
import {
  sinkFacadeTotals,
  sinkLayout,
  sinkRowContext,
  sinkRulesFromParameters,
} from "./sink";
import type { SinkRowContext, SinkRules } from "./sink";
import {
  FACADE_DRAWER_GAP_CM,
  facadeDoorCount,
  facadeStack,
  kitchenFacadeField,
  sinkFacadeArea,
} from "./facade-geometry";
import { FIXED_BODY_MATERIAL_ID } from "./materials";
import { wardrobeBodyAreaSqm, wardrobeGeometry } from "./wardrobe-geometry";
import { wardrobeFacadeGeometry } from "./wardrobe-facade-geometry";
import { wardrobeHingePlan, wardrobeHingeNormsFromRules } from "./wardrobe-hinges";
import { wardrobeDrawerCount, wardrobeRodCount } from "./wardrobe-components";
import { wardrobeEdgePlan } from "./wardrobe-edge";

/**
 * CA-T-306D Phase 3A — новый Engine.
 *
 * Принимает только CalculationInputs и возвращает CalculationBreakdown.
 * Никаких content/Admin/Storage/FS/API. Старый pricing.ts остаётся
 * legacy-путём до CA-T-306E.
 */

const ZERO = 0;

function fail(message: string): never {
  throw new Error(`Engine input: ${message}`);
}

function safe(value: number): number {
  return Number.isFinite(value) ? value : ZERO;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function area(widthCm: number, heightCm: number): number {
  return (safe(widthCm) * safe(heightCm)) / 10000;
}

function snapshotMap(inputs: CalculationInputs): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of inputs.priceSnapshot.snapshot) {
    if (map.has(entry.priceItemId)) {
      fail(`дубликат PriceItem "${entry.priceItemId}"`);
    }
    map.set(entry.priceItemId, entry.amount);
  }
  return map;
}

function price(
  map: Map<string, number>,
  id: string,
  context: string,
): number {
  const value = map.get(id);
  if (value === undefined) fail(`нет PriceItem "${id}" (${context})`);
  return value;
}

function catalog(
  inputs: CalculationInputs,
  kind: CatalogItemInput["catalog"],
  id: string,
): CatalogItemInput {
  const item = inputs.catalogs.find(
    (candidate) => candidate.catalog === kind && candidate.id === id,
  );
  if (!item) fail(`нет CatalogItem "${kind}:${id}"`);
  return item;
}

function priceRef(
  map: Map<string, number>,
  item: CatalogItemInput,
  role: string,
): number {
  const ref = (item.priceRefs as Record<string, string>)[role];
  if (!ref) fail(`нет role "${role}" у ${item.catalog}:${item.id}`);
  return price(map, ref, `${item.catalog}:${item.id}.${role}`);
}

function preset(
  inputs: CalculationInputs,
  family: "kitchen" | "wardrobe",
  id: string,
): ModulePresetInput {
  const value = inputs.presets.find(
    (candidate) => candidate.family === family && candidate.id === id,
  );
  if (!value) fail(`нет ModulePreset "${family}:${id}"`);
  return value;
}

function signed(
  inputs: CalculationInputs,
  key: string,
): number | undefined {
  const matches = inputs.priceSnapshot.signedAdjustments.filter(
    (item: SignedAdjustmentInput) => item.key === key,
  );
  if (matches.length > 1) fail(`дубликат signedAdjustment "${key}"`);
  return matches[0]?.amount;
}

function rules(inputs: CalculationInputs, map: Map<string, number>): PriceRulesInput {
  const value = inputs.priceSnapshot.rules;
  // rules уже проверены контрактом; дополнительно убеждаемся, что суммы не
  // берутся из PriceItem.
  if (!Number.isFinite(value.rounding) || value.rounding <= 0) {
    fail("rules.rounding невалиден");
  }
  void map;
  return value;
}

function roundMoney(value: number, step: number): number {
  return Math.max(0, Math.round(value / step) * step);
}

function applyPromo(
  inputs: CalculationInputs,
  config: FurnitureConfig,
  subtotal: number,
  step: number,
): { discount: number; promo: PromoResult | null } {
  const code = config.promoCode?.trim().toUpperCase();
  if (!code) return { discount: 0, promo: null };
  const definition = inputs.priceSnapshot.promos.find((item) => item.code === code);
  if (!definition) {
    return {
      discount: 0,
      promo: {
        code,
        title: "Промокод не найден",
        discount: 0,
        valid: false,
        reason: "Проверьте код. Демо-промокоды указаны в разделе «Предложения».",
        demo: false,
      },
    };
  }
  if (!definition.active) {
    return {
      discount: 0,
      promo: {
        code: definition.code,
        title: definition.title,
        discount: 0,
        valid: false,
        reason: "Промокод неактивен.",
        demo: definition.demo,
      },
    };
  }
  if (definition.appliesTo !== "all" && !definition.appliesTo.includes(config.kind)) {
    return {
      discount: 0,
      promo: {
        code: definition.code,
        title: definition.title,
        discount: 0,
        valid: false,
        reason: "Промокод действует для другой категории мебели.",
        demo: definition.demo,
      },
    };
  }
  if (subtotal < definition.minSubtotal) {
    return {
      discount: 0,
      promo: {
        code: definition.code,
        title: definition.title,
        discount: 0,
        valid: false,
        reason: `Промокод действует при предварительной стоимости от ${definition.minSubtotal} ₽.`,
        demo: definition.demo,
      },
    };
  }
  let discount =
    definition.type === "percent"
      ? (subtotal * definition.value) / 100
      : definition.value;
  if (definition.maxDiscount) discount = Math.min(discount, definition.maxDiscount);
  discount = roundMoney(Math.min(discount, subtotal), step);
  return {
    discount,
    promo: {
      code: definition.code,
      title: definition.title,
      discount,
      valid: discount > 0,
      reason:
        definition.type === "percent"
          ? `Скидка ${definition.value}% применена к предварительному расчёту.`
          : "Фиксированная скидка применена к предварительному расчёту.",
      demo: definition.demo,
    },
  };
}

function zoneOf(
  inputs: CalculationInputs,
  module: KitchenModule,
): "floor" | "upper" {
  return preset(inputs, "kitchen", module.type).zone;
}

interface KitchenRowPosition {
  start: boolean;
  end: boolean;
}

/** Позиция модуля в своём ряду: край ряда получает увеличенный зазор. */
function kitchenRowPositions(
  inputs: CalculationInputs,
  modules: KitchenModule[],
): Map<string, KitchenRowPosition> {
  const positions = new Map<string, KitchenRowPosition>();
  for (const zone of ["floor", "upper"] as const) {
    const row = modules.filter((module) => zoneOf(inputs, module) === zone);
    row.forEach((module, index) => {
      positions.set(module.id, {
        start: index === 0,
        end: index === row.length - 1,
      });
    });
  }
  return positions;
}

/**
 * Фактическая площадь фасадов модуля кухни (CA-T-517).
 *
 * Створки считаются по реальным размерам с зазорами; у мойки — по
 * существующему `sinkLayout().facadeBoxes`, у ящиков — по стопке фронтов.
 */
function kitchenModuleFacadeArea(
  unit: KitchenModule,
  position: KitchenRowPosition,
  config: KitchenConfig,
  sinkRules: SinkRules,
  sinkRow?: SinkRowContext,
): number {
  const field = kitchenFacadeField({
    widthCm: unit.width,
    heightCm: unit.height,
    type: unit.type,
    rowStart: position.start,
    rowEnd: position.end,
    plinthHeightCm: config.plinth ? config.plinthHeight : 0,
  });
  if (unit.type === "sink") {
    const layout = sinkLayout(
      unit,
      {
        left: position.start ? sinkRules.facadeEdgeGap : sinkRules.facadeNeighborGap,
        right: position.end ? sinkRules.facadeEdgeGap : sinkRules.facadeNeighborGap,
      },
      sinkRow,
      sinkRules,
    );
    return sinkFacadeArea(layout.facadeBoxes, field.fieldHeightCm);
  }
  if (unit.type === "drawers") {
    return facadeStack({
      widthCm: field.fieldWidthCm,
      heightCm: field.fieldHeightCm,
      topGapCm: 0,
      bottomGapCm: 0,
      gapCm: FACADE_DRAWER_GAP_CM,
      count: unit.drawers,
    }).areaSqm;
  }
  return field.areaSqm;
}

function supportPlanned(
  inputs: CalculationInputs,
  config: KitchenConfig,
  sinkRules: SinkRules,
): {
  cost: number;
  costParts: { legs: number; clips: number; screws: number; anchors: number };
  legs: number;
  frontLegs: number;
  backLegs: number;
  clips: number;
  screws: number;
  anchors: number;
  systemId: string;
  tallAnchorSpacingCm: number;
  preliminary: boolean;
} {
  const map = snapshotMap(inputs);
  const systemItem = catalog(inputs, "supportSystem", config.supports.systemId);
  const system = systemItem.attrs as {
    edgeInsetCm: number;
    maxSpanCm: number;
    maxLoadKgPerLeg: number;
    clipsPerLeg: number;
    screwsPerLeg: number;
    tallAnchorSpacingCm: number;
    tallCenterLegWidthCm: number;
  };
  const maxSpanCm = config.supports.maxSpanCm ?? system.maxSpanCm;
  const maxLoadKgPerLeg = config.supports.maxLoadKgPerLeg ?? system.maxLoadKgPerLeg;
  const plinthClips = config.plinth && config.plinthMount === "clips";
  const plinthScrews = config.plinth && config.plinthMount === "hidden";
  const minLegSpacing = Number(inputs.parameters["engine.supports.minLegSpacingCm"]);
  const partitionSnap = Number(inputs.parameters["engine.supports.partitionSnapCm"]);
  const mergeTolerance = Number(inputs.parameters["engine.supports.mergeToleranceCm"]);
  const loadKg = (type: KitchenModule["type"]): number =>
    Number(inputs.parameters[`engine.supports.moduleLoadKg.${type}`] ?? 0);
  const loadWidth = (type: KitchenModule["type"]): number =>
    Number(inputs.parameters[`engine.supports.moduleLoadReferenceWidth.${type}`] ?? 60);
  if (![minLegSpacing, partitionSnap, mergeTolerance].every(Number.isFinite)) {
    fail("support parameters неполны");
  }

  const isTall = (unit: KitchenModule): boolean =>
    unit.type === "tall" || unit.type === "oven";

  const partitionPositions = (unit: KitchenModule): number[] => {
    if (unit.type !== "sink") return [];
    try {
      const layout = sinkLayout(
        unit,
        undefined,
        sinkRowContext(config.modules, unit.id),
        sinkRules,
      );
      return layout.partitions.map((cut) => cut.x + cut.width / 2);
    } catch {
      return [];
    }
  };

  const mergePositions = (
    positions: Array<{ x: number; kind: string }>,
  ): Array<{ x: number; kind: string }> => {
    const sorted = [...positions].sort((a, b) => a.x - b.x);
    const result: Array<{ x: number; kind: string }> = [];
    for (const position of sorted) {
      const previous = result[result.length - 1];
      if (previous && Math.abs(previous.x - position.x) <= mergeTolerance) {
        if (position.kind === "partition") {
          previous.x = position.x;
          previous.kind = "partition";
        }
        continue;
      }
      result.push({ ...position });
    }
    return result;
  };

  let legs = 0;
  let frontLegs = 0;
  let backLegs = 0;
  let clips = 0;
  let screws = 0;
  let anchors = 0;

  for (const unit of config.modules) {
    if (zoneOf(inputs, unit) !== "floor" || unit.ownSupports === true) continue;
    const width = unit.width;
    const edgeInset = Math.min(
      Math.max(1, Math.round(system.edgeInsetCm)),
      Math.floor(width / 4),
    );
    const loadPerModule = loadKg(unit.type) * (width / (loadWidth(unit.type) || 60));
    const innerWidth = Math.max(0, width - edgeInset * 2);
    const spanCount = Math.max(2, Math.ceil(innerWidth / maxSpanCm) + 1);
    const loadCount = Math.max(
      2,
      Math.ceil(loadPerModule / Math.max(1, maxLoadKgPerLeg * 2)),
    );
    const tallRule = isTall(unit)
      ? width >= system.tallCenterLegWidthCm
        ? 3
        : 2
      : 2;
    const maxBySpacing =
      Math.floor(innerWidth / minLegSpacing) + (innerWidth > 0 ? 1 : 0);
    const target = Math.max(spanCount, loadCount, tallRule);
    const count = Math.min(Math.max(target, 2), Math.max(2, maxBySpacing));

    const positions: Array<{ x: number; kind: string }> = [];
    const add = (x: number, kind: string): void => {
      if (x < 0.5 || x > width - 0.5) return;
      positions.push({ x: Math.round(x * 10) / 10, kind });
    };
    if (innerWidth >= 2) {
      add(edgeInset, "edge");
      add(width - edgeInset, "edge");
    } else {
      add(width / 2, "edge");
    }
    for (let index = 1; index < count - 1; index += 1) {
      if (innerWidth <= 0) break;
      add(edgeInset + (innerWidth * index) / (count - 1), "span");
    }
    if (isTall(unit) && width >= system.tallCenterLegWidthCm && innerWidth > 0) {
      add(width / 2, "tall-center");
    }
    for (const partition of partitionPositions(unit)) {
      if (partition <= edgeInset + partitionSnap) continue;
      if (partition >= width - edgeInset - partitionSnap) continue;
      add(partition, "partition");
    }
    const merged = mergePositions(positions);
    const front = merged.length;
    legs += front * 2;
    frontLegs += front;
    backLegs += front;
    clips += plinthClips ? front * system.clipsPerLeg : 0;
    screws += plinthScrews ? front * system.screwsPerLeg : 0;
    anchors += isTall(unit)
      ? Math.max(1, Math.ceil(unit.height / system.tallAnchorSpacingCm))
      : 0;
  }

  const legPrice = priceRef(map, systemItem, "legPrice");
  const clipPrice = priceRef(map, systemItem, "clipPrice");
  const screwPrice = priceRef(map, systemItem, "screwPrice");
  const anchorPrice = priceRef(map, systemItem, "anchorPrice");
  const costParts = {
    legs: legs * legPrice,
    clips: clips * clipPrice,
    screws: screws * screwPrice,
    anchors: anchors * anchorPrice,
  };
  return {
    cost: costParts.legs + costParts.clips + costParts.screws + costParts.anchors,
    costParts,
    legs,
    frontLegs,
    backLegs,
    clips,
    screws,
    anchors,
    systemId: systemItem.id,
    tallAnchorSpacingCm: system.tallAnchorSpacingCm,
    preliminary: true,
  };
}

function lightingPlanned(
  inputs: CalculationInputs,
  config: KitchenConfig,
): {
  cost: number;
  lengthM: number;
  powerPerMeter: number;
  voltage: number;
  colorTemp: number;
  psuW: number;
  psuCount: number;
  endCaps: number;
  connectors: number;
  profileAmount: number;
  diffuserAmount: number;
  stripAmount: number;
  endCapsAmount: number;
  connectorsAmount: number;
  psuAmount: number;
  controlAmount: number;
  installAmount: number;
  profileId: string;
  diffuserId: string;
  controlId: string;
} {
  const map = snapshotMap(inputs);
  const strip = inputs.catalogs.find((item) => {
    if (item.catalog !== "ledStrip") return false;
    const attrs = item.attrs as {
      power: number;
      voltage: number;
    };
    return (
      attrs.power === config.lighting.powerPerMeter &&
      attrs.voltage === config.lighting.voltage
    );
  });
  if (!strip) fail("нет ledStrip для lighting power/voltage");
  const stripAttrs = strip.attrs as {
    power: number;
    voltage: number;
    maxContinuousRunM: number;
    voltageDropPct: number;
    maxPsuW: number;
  };
  const profile = catalog(inputs, "ledProfile", config.lighting.profile);
  const diffuser = catalog(inputs, "ledDiffuser", config.lighting.diffuser);
  const control = catalog(inputs, "ledControl", config.lighting.control);

  const wallGap = Number(inputs.parameters["engine.kitchen.wallGapAboveCountertop"]);
  const endMargin = Number(inputs.parameters["engine.lighting.endMarginCm"]);
  const psuMargin = Number(inputs.parameters["engine.lighting.psuMargin"]);
  const psuMarginLow = Number(inputs.parameters["engine.lighting.psuMarginLow"]);
  const ratings = inputs.parameters["engine.lighting.psuRatings"];
  if (
    !Number.isFinite(wallGap) ||
    !Number.isFinite(endMargin) ||
    !Number.isFinite(psuMargin) ||
    !Number.isFinite(psuMarginLow) ||
    !Array.isArray(ratings)
  ) {
    fail("lighting parameters неполны");
  }

  const floor = config.modules.filter(
    (unit) => zoneOf(inputs, unit) === "floor",
  );
  const counterCm = Math.max(0.4, config.countertopThickness / 10);
  const baseHeight =
    floor
      .filter((unit) => !["tall", "oven"].includes(unit.type))
      .reduce((max, unit) => Math.max(max, unit.height), 0) || 90;
  const upperBottomCm = baseHeight + counterCm + wallGap;
  const blockers = floor
    .filter(
      (unit) =>
        ["tall", "oven"].includes(unit.type) && unit.height >= upperBottomCm,
    )
    .map((unit) => {
      const index = config.modules.indexOf(unit);
      const before = config.modules.slice(0, index).filter(
        (candidate) => zoneOf(inputs, candidate) === "floor",
      );
      const x0 = before.reduce((sum, candidate) => sum + candidate.width, 0);
      return { x0, x1: x0 + unit.width };
    });

  const lengths: number[] = [];
  let cursor = 0;
  for (const unit of config.modules) {
    if (zoneOf(inputs, unit) !== "upper") continue;
    const x0 = cursor;
    const x1 = cursor + unit.width;
    cursor = x1;
    const start = x0 + endMargin;
    const end = x1 - endMargin;
    if (end - start <= 0.5) continue;
    let blocked = 0;
    for (const blocker of blockers) {
      const overlap = Math.min(end, blocker.x1) - Math.max(start, blocker.x0);
      if (overlap > 0) blocked += overlap;
    }
    blocked = Math.min(blocked, end - start);
    lengths.push(Math.max(0, (end - start - blocked) / 100));
  }
  const lengthM = round(lengths.reduce((sum, value) => sum + value, 0), 3);
  const active = lengths.filter((value) => value > 0).length;

  // R2 / D1 (DOMAIN_CONFIRMED): без пригодных сегментов верхнего ряда
  // (нет верхних модулей либо каждый сегмент ≤ 0.5 см) ленты нет → блок
  // питания, контроллер и остальные комплектующие не начисляются.
  if (lengthM === 0) {
    return {
      cost: 0,
      lengthM: 0,
      powerPerMeter: config.lighting.powerPerMeter,
      voltage: config.lighting.voltage,
      colorTemp: config.lighting.colorTemp,
      psuW: 0,
      psuCount: 0,
      endCaps: 0,
      connectors: 0,
      profileAmount: 0,
      diffuserAmount: 0,
      stripAmount: 0,
      endCapsAmount: 0,
      connectorsAmount: 0,
      psuAmount: 0,
      controlAmount: 0,
      installAmount: 0,
      profileId: profile.id,
      diffuserId: diffuser.id,
      controlId: control.id,
    };
  }

  const maxRunM = stripAttrs.maxContinuousRunM;
  let runs = 1;
  let current = 0;
  for (const value of lengths.filter((value) => value > 0)) {
    let remaining = value;
    while (remaining > 1e-9) {
      const capacity = maxRunM - current;
      if (capacity <= 1e-9) {
        runs += 1;
        current = 0;
        continue;
      }
      const used = Math.min(capacity, remaining);
      current += used;
      remaining -= used;
    }
  }
  if (lengthM === 0) runs = 0;
  const endCaps = active * 2;
  const connectors = active > 0 ? Math.max(0, active - 1) + runs : 0;
  const powerW = round(lengthM * config.lighting.powerPerMeter, 1);
  const required = round(powerW * psuMargin, 1);
  const low = round(powerW * psuMarginLow, 1);
  void low;
  let psuW = Number(ratings[ratings.length - 1]);
  for (const rating of ratings) {
    if (Number(rating) >= required) {
      psuW = Number(rating);
      break;
    }
  }
  const psuCount =
    stripAttrs.maxPsuW > 0 && required > stripAttrs.maxPsuW
      ? Math.ceil(required / stripAttrs.maxPsuW)
      : 1;

  const stripAmount = Math.round(lengthM * priceRef(map, strip, "pricePerMeter"));
  const profileAmount = Math.round(lengthM * priceRef(map, profile, "ratePerMeter"));
  const diffuserAmount = Math.round(lengthM * priceRef(map, diffuser, "ratePerMeter"));
  const endCapsAmount = endCaps * price(map, "lighting.endCap", "endCaps");
  const connectorsAmount = connectors * price(map, "lighting.connector", "connectors");
  const psuAmount = price(map, `lighting.psu.${psuW}`, "psu") * psuCount;
  const controlAmount = priceRef(map, control, "price");
  const installAmount = Math.round(lengthM * price(map, "lighting.install", "install"));

  return {
    cost:
      stripAmount +
      profileAmount +
      diffuserAmount +
      endCapsAmount +
      connectorsAmount +
      psuAmount +
      controlAmount +
      installAmount,
    lengthM,
    powerPerMeter: config.lighting.powerPerMeter,
    voltage: config.lighting.voltage,
    colorTemp: config.lighting.colorTemp,
    psuW,
    psuCount,
    endCaps,
    connectors,
    profileAmount,
    diffuserAmount,
    stripAmount,
    endCapsAmount,
    connectorsAmount,
    psuAmount,
    controlAmount,
    installAmount,
    profileId: profile.id,
    diffuserId: diffuser.id,
    controlId: control.id,
  };
}

export function calculateKitchenBreakdown(
  config: KitchenConfig,
  inputs: CalculationInputs,
): CalculationBreakdown {
  const map = snapshotMap(inputs);
  const rule = rules(inputs, map);
  const sinkRules = sinkRulesFromParameters(inputs.parameters);
  const body = priceRef(
    map,
    catalog(inputs, "bodyMaterial", FIXED_BODY_MATERIAL_ID),
    "ratePerSqm",
  );
  const facade = priceRef(map, catalog(inputs, "facadeMaterial", config.facadeMaterial), "ratePerSqm");
  const style = priceRef(map, catalog(inputs, "facadeStyle", config.facadeStyle), "multiplier");
  const handle = priceRef(map, catalog(inputs, "handle", config.handle), "rate");
  const countertopRate = priceRef(
    map,
    catalog(inputs, "countertop", config.countertop),
    "ratePerLinearMeter",
  );
  const plinthMaterial = config.plinth
    ? catalog(inputs, "plinthMaterial", config.plinthMaterial)
    : undefined;
  const plinthRate = plinthMaterial
    ? priceRef(map, plinthMaterial, "ratePerMeter")
    : 0;
  const plinthDelta =
    config.plinth
      ? signed(inputs, `plinth:${config.plinthMaterial}:${config.plinthFinish}`)
      : undefined;
  if (config.plinth && plinthDelta === undefined) {
    fail(`нет signedAdjustment plinth:${config.plinthMaterial}:${config.plinthFinish}`);
  }

  const lines: CalculationLine[] = [];
  let bodyCost = 0;
  let frontsCost = 0;
  let fittingsCost = 0;
  let optionsCost = 0;
  let doorsTotal = 0;
  let drawerTotal = 0;
  let shelfTotal = 0;

  const sinkRows = new Map<string, SinkRowContext>();
  for (const unit of config.modules) {
    if (unit.type === "sink") sinkRows.set(unit.id, sinkRowContext(config.modules, unit.id));
  }
  const rowPositions = kitchenRowPositions(inputs, config.modules);

  for (const unit of config.modules) {
    const presetValue = preset(inputs, "kitchen", unit.type);
    const basePrice = price(map, presetValue.priceRef, `preset ${unit.type}`);
    const moduleArea = area(unit.width, unit.height);
    const depthFactor = unit.depth / rule.bodyDepthReference;
    bodyCost += basePrice + moduleArea * body * Math.max(0.5, depthFactor);

    const sinkRow = unit.type === "sink" ? sinkRows.get(unit.id) : undefined;
    const sinkTotals =
      unit.type === "sink" ? sinkFacadeTotals(unit, sinkRow, sinkRules) : null;
    const doors = sinkTotals ? sinkTotals.doors : unit.type === "drawers" ? 0 : facadeDoorCount(unit.width);
    const facadeArea = kitchenModuleFacadeArea(
      unit,
      rowPositions.get(unit.id) ?? { start: true, end: true },
      config,
      sinkRules,
      sinkRow,
    );
    const addDoorFittings = (count: number) => {
      fittingsCost += count * price(map, "kitchen.hingePerDoor", "hinge");
      if (config.hinge === "soft") fittingsCost += count * price(map, "kitchen.softClosePerDoor", "softClose");
      if (config.pushToOpen) fittingsCost += count * price(map, "kitchen.pushToOpenPerDoor", "pushToOpen");
      if (config.handle !== "none") fittingsCost += count * handle;
    };
    if (sinkTotals) {
      // Фасады мойки включают створки, фронты ящиков и панель бутылочницы.
      doorsTotal += sinkTotals.panels;
      frontsCost += facadeArea * facade * style;
      if (doors > 0) addDoorFittings(doors);
    } else {
      doorsTotal += doors;
      if (doors > 0) {
        frontsCost += facadeArea * facade * style;
        addDoorFittings(doors);
      } else if (unit.type === "drawers") {
        drawerTotal += unit.drawers;
        frontsCost += facadeArea * facade * style;
        fittingsCost += unit.drawers * price(map, "kitchen.drawerSlide", "drawerSlide");
        if (config.hinge === "soft") fittingsCost += unit.drawers * price(map, "kitchen.drawerSoftClose", "drawerSoftClose");
        if (config.handle !== "none") fittingsCost += unit.drawers * handle;
      }
    }

    // См. legacy pricing.ts: при наличии sinkStorage полки мойки берутся
    // только из layout секций, а legacy unit.shelves не дублируется.
    if (unit.type !== "sink" || !Array.isArray(unit.sinkStorage)) {
      shelfTotal += unit.shelves;
    }
    if (unit.type === "sink") {
      optionsCost += price(map, "kitchen.sinkCutout", "sinkCutout");
      const sink = sinkLayout(
        unit,
        {
          left: rowPositions.get(unit.id)?.start
            ? sinkRules.facadeEdgeGap
            : sinkRules.facadeNeighborGap,
          right: rowPositions.get(unit.id)?.end
            ? sinkRules.facadeEdgeGap
            : sinkRules.facadeNeighborGap,
        },
        sinkRow,
        sinkRules,
      );
      for (const section of sink.sections) {
        if (section.comms) continue;
        if (section.bottle > 0) {
          optionsCost += price(map, "kitchen.bottleRack", "bottleRack");
          continue;
        }
        shelfTotal += section.shelves;
        if (section.drawers > 0) {
          drawerTotal += section.drawers;
          fittingsCost += section.drawers * price(map, "kitchen.drawerSlide", "drawerSlide");
          if (config.hinge === "soft") fittingsCost += section.drawers * price(map, "kitchen.drawerSoftClose", "drawerSoftClose");
          if (config.handle !== "none") fittingsCost += section.drawers * handle;
        }
      }
    }
    if (unit.type === "hob") optionsCost += price(map, "kitchen.hobCutout", "hobCutout");
    if (unit.type === "oven") optionsCost += price(map, "kitchen.ovenNiches", "ovenNiches");
  }

  optionsCost += shelfTotal * price(map, "kitchen.shelf", "shelf");
  optionsCost += config.sidePanels * price(map, "kitchen.sidePanel", "sidePanel");
  const countertopWidth = config.modules
    // TG-C3: самостоятельная напольная бутылочница входит в длину столешницы;
    // встроенный механизм (`sinkStorage[].bottle`) ширину не добавляет.
    .filter((unit) => ["base", "sink", "hob", "drawers", "bottle"].includes(unit.type))
    .reduce((sum, unit) => sum + unit.width, 0) / 100;
  optionsCost += countertopWidth * countertopRate;

  const supportPlan = supportPlanned(inputs, config, sinkRules);
  optionsCost += supportPlan.cost;
  const floorWidth = config.modules
    .filter((unit) => zoneOf(inputs, unit) === "floor")
    .reduce((sum, unit) => sum + unit.width, 0);
  const plinthMeters = floorWidth / 100;
  const plinthCost = config.plinth ? plinthMeters * (plinthRate + (plinthDelta ?? 0)) : 0;
  optionsCost += plinthCost;
  const lighting = config.underCabinetLighting
    ? lightingPlanned(inputs, config)
    : undefined;
  if (lighting) optionsCost += lighting.cost;

  const extraModules = Math.max(0, config.modules.length - 3);
  const complexityFactor = Math.min(
    rule.complexityMax,
    1 + extraModules * rule.complexityPerExtraModule,
  );
  const baseCost = price(map, "kitchen.baseCost", "baseCost");
  const subtotalRaw =
    (baseCost + bodyCost + frontsCost + fittingsCost + optionsCost) *
    complexityFactor;
  const subtotal = Math.max(0, Math.max(rule.minOrder, roundMoney(subtotalRaw, rule.rounding)));
  const minOrderApplied = subtotalRaw < rule.minOrder;
  const { discount, promo } = applyPromo(inputs, config, subtotal, rule.rounding);
  const total = roundMoney(Math.max(0, subtotal - discount), rule.rounding);

  lines.push({ id: "kitchen.base", amount: baseCost });
  lines.push({ id: "kitchen.body", amount: Math.round(bodyCost), moduleCount: config.modules.length, bodyMaterialId: FIXED_BODY_MATERIAL_ID });
  lines.push({ id: "kitchen.fronts", amount: Math.round(frontsCost), doors: doorsTotal, drawers: drawerTotal });
  lines.push({ id: "kitchen.fittings", amount: Math.round(fittingsCost), pushToOpen: config.pushToOpen });
  lines.push({ id: "kitchen.options", amount: Math.round(optionsCost), countertopMeters: countertopWidth, shelves: shelfTotal });
  if (config.pushToOpen) lines.push({ id: "kitchen.pushToOpen", amount: 0 });
  if (config.plinth) {
    lines.push({
      id: "kitchen.plinth",
      amount: Math.round(plinthCost),
      lengthM: plinthMeters,
      thicknessMm:
        config.plinthThickness ??
        (plinthMaterial?.attrs as { defaultThickness?: number } | undefined)
          ?.defaultThickness ?? 16,
      plinthMaterialId: config.plinthMaterial,
      plinthMountId: config.plinthMount,
      supportClips: supportPlan.clips,
      supportFrontLegs: supportPlan.frontLegs,
    });
  }
  lines.push({
    id: "kitchen.supports",
    amount: Math.round(supportPlan.costParts.legs),
    legs: supportPlan.legs,
    frontLegs: supportPlan.frontLegs,
    backLegs: supportPlan.backLegs,
    supportSystemId: supportPlan.systemId,
  });
  if (supportPlan.clips > 0) lines.push({ id: "kitchen.supportClips", amount: Math.round(supportPlan.costParts.clips), clips: supportPlan.clips });
  if (supportPlan.screws > 0) lines.push({ id: "kitchen.supportScrews", amount: Math.round(supportPlan.costParts.screws), screws: supportPlan.screws });
  if (supportPlan.anchors > 0) lines.push({ id: "kitchen.supportAnchors", amount: Math.round(supportPlan.costParts.anchors), anchors: supportPlan.anchors, tallAnchorSpacingCm: supportPlan.tallAnchorSpacingCm });
  if (lighting) {
    lines.push({
      id: "kitchen.lighting",
      amount: Math.round(lighting.cost),
      lengthM: lighting.lengthM,
      powerPerMeter: lighting.powerPerMeter,
      voltage: lighting.voltage,
      colorTemp: lighting.colorTemp,
      psuW: lighting.psuW,
    });
    lines.push({ id: "kitchen.lighting.strip", amount: lighting.stripAmount, lengthM: lighting.lengthM, powerPerMeter: lighting.powerPerMeter, voltage: lighting.voltage });
    lines.push({ id: "kitchen.lighting.profile", amount: lighting.profileAmount, quantityM: round(lighting.lengthM, 2), profileId: lighting.profileId });
    lines.push({ id: "kitchen.lighting.diffuser", amount: lighting.diffuserAmount, quantityM: round(lighting.lengthM, 2), diffuserId: lighting.diffuserId });
    lines.push({ id: "kitchen.lighting.endCaps", amount: lighting.endCapsAmount, endCaps: lighting.endCaps });
    lines.push({ id: "kitchen.lighting.connectors", amount: lighting.connectorsAmount, connectors: lighting.connectors });
    lines.push({ id: "kitchen.lighting.psu", amount: lighting.psuAmount, psuW: lighting.psuW, psuCount: lighting.psuCount });
    lines.push({ id: "kitchen.lighting.control", amount: lighting.controlAmount, controlId: lighting.controlId });
    lines.push({ id: "kitchen.lighting.install", amount: lighting.installAmount, quantityM: round(lighting.lengthM, 2) });
  }
  if (supportPlan.preliminary && supportPlan.legs > 0) {
    lines.push({ id: "kitchen.supportPreliminary", amount: 0 });
  }
  if (config.sidePanels > 0) lines.push({ id: "kitchen.sidePanels", amount: 0, count: config.sidePanels });
  if (complexityFactor > 1) lines.push({ id: "kitchen.complexity", amount: 0, factor: complexityFactor });
  if (minOrderApplied) lines.push({ id: "kitchen.minOrder", amount: 0 });

  return {
    currency: "RUB",
    baseCost,
    bodyCost: Math.round(bodyCost),
    frontsCost: Math.round(frontsCost),
    fittingsCost: Math.round(fittingsCost),
    optionsCost: Math.round(optionsCost),
    complexityFactor,
    subtotal,
    discount,
    total,
    minOrderApplied,
    lines,
    promo,
  };
}

export function calculateWardrobeBreakdown(
  config: WardrobeConfig,
  inputs: CalculationInputs,
): CalculationBreakdown {
  const map = snapshotMap(inputs);
  const rule = rules(inputs, map);
  const body = priceRef(
    map,
    catalog(inputs, "bodyMaterial", FIXED_BODY_MATERIAL_ID),
    "ratePerSqm",
  );
  const facade = priceRef(map, catalog(inputs, "facadeMaterial", config.facadeMaterial), "ratePerSqm");
  const style = priceRef(map, catalog(inputs, "facadeStyle", config.facadeStyle), "multiplier");
  const handle = priceRef(map, catalog(inputs, "handle", config.handle), "rate");
  const geometry = wardrobeGeometry(config);
  const width = geometry.widthMm / 10;
  const totalArea = wardrobeBodyAreaSqm(geometry);
  const bodyCost = totalArea * body;
  const facadeGeometry = wardrobeFacadeGeometry(config, geometry);
  const facadeArea = facadeGeometry.totalAreaSqm;
  const frontsCost = facadeArea * facade * style;
  const doorsTotal = facadeGeometry.panels.length;
  // NEW-N1: нормы петель/плотностей — только из rulesSnapshot (fail-closed).
  const hingeNorms = wardrobeHingeNormsFromRules(inputs.rulesSnapshot?.rules);
  if (!hingeNorms) {
    fail(
      "rulesSnapshot: отсутствуют или некорректны нормы 1.1/1.2 (rule-wardrobe-hinge-band-*, rule-wardrobe-facade-density-*)",
    );
  }
  const hingePlan = wardrobeHingePlan(config, hingeNorms);
  let shelfTotal = 0;
  for (const section of config.sections) {
    shelfTotal += section.shelves.length;
  }
  const rodTotal = wardrobeRodCount(config);
  const drawerTotal = wardrobeDrawerCount(config);
  let fittingsCost =
    hingePlan.totalHinges * price(map, "wardrobe.hingePerDoor", "hinge") +
    drawerTotal * price(map, "wardrobe.drawer", "drawer");
  if (config.hinge === "soft") {
    fittingsCost += doorsTotal * price(map, "wardrobe.softClosePerDoor", "softClose");
    fittingsCost += drawerTotal * price(map, "wardrobe.drawerSoftClose", "drawerSoftClose");
  }
  if (config.pushToOpen) fittingsCost += doorsTotal * price(map, "wardrobe.pushToOpenPerDoor", "pushToOpen");
  if (config.handle !== "none") fittingsCost += doorsTotal * handle;
  let optionsCost =
    shelfTotal * price(map, "wardrobe.shelf", "shelf") +
    rodTotal * price(map, "wardrobe.rod", "rod");
  if (config.plinth) optionsCost += (width / 100) * price(map, "wardrobe.plinthPerMeter", "plinth");
  if (config.ledLighting) optionsCost += config.sections.length * price(map, "wardrobe.ledPerSection", "led");
  const edgePlan = wardrobeEdgePlan(config, {
    pvc04: price(map, "wardrobe.edgePvc04", "edge"),
    pvc1: price(map, "wardrobe.edgePvc1", "edge"),
    pvc2: price(map, "wardrobe.edgePvc2", "edge"),
  }, geometry, facadeGeometry);
  optionsCost += edgePlan.totalCost;
  const baseCost = price(map, "wardrobe.baseCost", "baseCost");
  const subtotalRaw = baseCost + bodyCost + frontsCost + fittingsCost + optionsCost;
  const subtotal = Math.max(rule.minOrder, roundMoney(subtotalRaw, rule.rounding));
  const minOrderApplied = subtotalRaw < rule.minOrder;
  const { discount, promo } = applyPromo(inputs, config, subtotal, rule.rounding);
  const total = roundMoney(Math.max(0, subtotal - discount), rule.rounding);
  const lines: CalculationLine[] = [
    { id: "wardrobe.base", amount: baseCost },
    { id: "wardrobe.body", amount: Math.round(bodyCost), totalArea, bodyMaterialId: FIXED_BODY_MATERIAL_ID },
    { id: "wardrobe.fronts", amount: Math.round(frontsCost), doors: doorsTotal, facadeMaterialId: config.facadeMaterial },
    { id: "wardrobe.fittings", amount: Math.round(fittingsCost), doors: doorsTotal, drawers: drawerTotal, softClose: config.hinge === "soft" },
    { id: "wardrobe.options", amount: Math.round(optionsCost), shelves: shelfTotal, rods: rodTotal, ledLighting: config.ledLighting },
  ];
  if (config.ledLighting) lines.push({ id: "wardrobe.led", amount: 0, sections: config.sections.length });
  if (config.plinth) lines.push({ id: "wardrobe.plinth", amount: 0, widthCm: width });
  if (config.pushToOpen) lines.push({ id: "wardrobe.pushToOpen", amount: 0 });
  if (minOrderApplied) lines.push({ id: "wardrobe.minOrder", amount: 0 });
  return {
    currency: "RUB",
    baseCost,
    bodyCost: Math.round(bodyCost),
    frontsCost: Math.round(frontsCost),
    fittingsCost: Math.round(fittingsCost),
    optionsCost: Math.round(optionsCost),
    complexityFactor: 1,
    subtotal,
    discount,
    total,
    minOrderApplied,
    lines,
    promo,
  };
}

export function calculateBreakdown(
  config: FurnitureConfig,
  inputs: CalculationInputs,
): CalculationBreakdown {
  return config.kind === "kitchen"
    ? calculateKitchenBreakdown(config, inputs)
    : calculateWardrobeBreakdown(config, inputs);
}
