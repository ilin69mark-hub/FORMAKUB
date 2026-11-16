import {
  BODY_MATERIALS,
  COUNTERTOPS,
  FACADE_MATERIALS,
  FACADE_STYLES,
  HANDLES,
  KITCHEN_MODULES,
  LEGACY_FACADE_MATERIALS,
} from "@/content/catalog";
import { PRICING, PROMOS, type PromoDefinition } from "@/content/pricing";
import { findPlinthMaterial, plinthRatePerMeter } from "@/content/plinth";
import { findPlinthMount, findSupportSystem } from "@/content/supports";
import type { CalculationInputs } from "./contract";
import { computeLighting } from "./lighting";
import { FIXED_BODY_MATERIAL_ID } from "./materials";
import { computeSupports } from "./supports";
import { sinkFacadeTotals, sinkLayout, sinkRowContext } from "./sink";
import { wardrobeBodyAreaSqm, wardrobeGeometry } from "./wardrobe-geometry";
import { wardrobeFacadeGeometry } from "./wardrobe-facade-geometry";
import { wardrobeHingePlan } from "./wardrobe-hinges";
import { wardrobeDrawerCount, wardrobeRodCount } from "./wardrobe-components";
import { wardrobeEdgePlan } from "./wardrobe-edge";
import type { SinkRowContext } from "./sink";
import {
  FACADE_DRAWER_GAP_CM,
  FACADE_EDGE_GAP_CM,
  FACADE_NEIGHBOR_GAP_CM,
  facadeDoorCount,
  facadeStack,
  kitchenFacadeField,
  sinkFacadeArea,
} from "./facade-geometry";
import type {
  FurnitureConfig,
  KitchenConfig,
  KitchenModule,
  PriceBreakdown,
  PriceLine,
  PromoResult,
  WardrobeConfig,
} from "./types";

import {
  PRICE_DISCLAIMER,
  formatRub,
  kitchenFloorModules,
} from "./display";

export {
  PRICE_DISCLAIMER,
  formatRange,
  formatRub,
  kitchenFloorModules,
  kitchenTotalWidth,
  kitchenUpperModules,
  wardrobeWidth,
} from "./display";

function roundMoney(value: number): number {
  const step = PRICING.rounding;
  return Math.max(0, Math.round(value / step) * step);
}

function safe(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function area(widthCm: number, heightCm: number): number {
  return (safe(widthCm) * safe(heightCm)) / 10000;
}

/**
 * A16-4 — контракт поиска тарифа в legacy-расчёте.
 *
 * Различаются четыре случая:
 *  1. Явно бесплатный вариант — `handle: "none"`: реальная запись каталога
 *     `HANDLES` с `rate: 0`, поиск возвращает 0 штатно.
 *  2. Отсутствующий необязательный параметр — к этим помощникам не относится:
 *     они читают обязательные поля конфигурации, значения по умолчанию
 *     расставляет `schema.ts`.
 *  3. Неизвестный идентификатор — недопустим: `schema.ts` объявляет поля
 *     `z.enum`, а сохранение/чтение проектов проходит через `safeParseConfig`.
 *     Такой id означает повреждённые данные → контролируемая ошибка.
 *  4. Устаревшие данные проекта — исторические материалы фасада
 *     (`veneer`/`glass`/`solid`) входят в схему и читаются в старых
 *     проектах, но `ratePerSqm` не имеют: результат остаётся прежним (0 ₽).
 *     Менять это поведение без решения владельца нельзя — см. PROJECT_AUDIT
 *     A16-4 (отложено, риск для старых проектов).
 */
function unknownCatalogId(kind: string, id: string): Error {
  return new Error(`Legacy pricing: неизвестный ${kind} "${id}"`);
}

function missingRate(kind: string, id: string): Error {
  return new Error(`Legacy pricing: нет тарифа ${kind} "${id}"`);
}

/**
 * Q-A17-2.3: известный материал без **действующего** тарифа — контролируемая
 * ошибка с идентификатором. Не возвращаем 0 ₽, не подставляем исторический
 * тариф (11 800 / 14 400 / 18 600 ₽/м²) и не пропускаем расчёт фасадов.
 */
function missingActiveTariff(kind: string, id: string): Error {
  return new Error(
    `Legacy pricing: нет действующего тарифа для ${kind} "${id}"; расчёт фасадов невозможен`,
  );
}

function bodyRate(): number {
  const material = BODY_MATERIALS.find(
    (item) => item.id === FIXED_BODY_MATERIAL_ID,
  );
  if (!material) {
    throw unknownCatalogId("bodyMaterial", FIXED_BODY_MATERIAL_ID);
  }
  if (material.ratePerSqm === undefined) {
    throw missingRate("bodyMaterial", FIXED_BODY_MATERIAL_ID);
  }
  return material.ratePerSqm;
}

function facadeRate(config: KitchenConfig | WardrobeConfig): number {
  const active = FACADE_MATERIALS.find(
    (item) => item.id === config.facadeMaterial,
  );
  if (active) {
    if (active.ratePerSqm === undefined) {
      throw missingRate("facadeMaterial", config.facadeMaterial);
    }
    return active.ratePerSqm;
  }
  // Q-A17-2.3: материала нет среди действующих ставок → ошибка, а не 0 ₽.
  // Исторический тариф автоматически не подставляется (см. материалы выше).
  if (
    LEGACY_FACADE_MATERIALS.some((item) => item.id === config.facadeMaterial)
  ) {
    throw missingActiveTariff("facadeMaterial", config.facadeMaterial);
  }
  throw unknownCatalogId("facadeMaterial", config.facadeMaterial);
}

function styleMultiplier(config: KitchenConfig | WardrobeConfig): number {
  const style = FACADE_STYLES.find((item) => item.id === config.facadeStyle);
  if (!style) {
    throw unknownCatalogId("facadeStyle", config.facadeStyle);
  }
  return style.multiplier;
}

function handleRate(handle: KitchenConfig["handle"]): number {
  const found = HANDLES.find((item) => item.id === handle);
  if (!found) {
    throw unknownCatalogId("handle", handle);
  }
  return found.rate;
}

export function doorCountForWidth(width: number): number {
  return facadeDoorCount(width);
}

export function kitchenDoorCount(
  module: KitchenModule,
  row?: SinkRowContext,
): number {
  if (module.type === "drawers") return 0;
  // У модуля мойки — только распашные створки (фронты ящиков и панель
  // бутылочки считаются отдельно, см. sinkFacadeTotals).
  if (module.type === "sink") return sinkFacadeTotals(module, row).doors;
  return doorCountForWidth(module.width);
}

export function kitchenCountertopWidth(config: KitchenConfig): number {
  // TG-C3 (подтверждено владельцем): наружная ширина самостоятельной
  // напольной бутылочницы (`type === "bottle"`, 150/200/300 мм) входит в
  // длину столешницы. Встроенный механизм бутылочки внутри модуля
  // (`sinkStorage[].bottle`) ширину не добавляет — модуль уже посчитан.
  return config.modules
    .filter((module) =>
      ["base", "sink", "hob", "drawers", "bottle"].includes(module.type),
    )
    .reduce((sum, module) => sum + module.width, 0);
}

interface KitchenRowPosition {
  start: boolean;
  end: boolean;
}

function kitchenRowPositions(
  modules: KitchenModule[],
): Map<string, KitchenRowPosition> {
  const positions = new Map<string, KitchenRowPosition>();
  for (const zone of ["floor", "upper"] as const) {
    const row = modules.filter(
      (module) => KITCHEN_MODULES[module.type]?.zone === zone,
    );
    row.forEach((module, index) => {
      positions.set(module.id, {
        start: index === 0,
        end: index === row.length - 1,
      });
    });
  }
  return positions;
}

/** Фактическая площадь фасадов модуля кухни (CA-T-517). */
function kitchenModuleFacadeArea(
  unit: KitchenModule,
  position: KitchenRowPosition,
  config: KitchenConfig,
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
        left: position.start ? FACADE_EDGE_GAP_CM : FACADE_NEIGHBOR_GAP_CM,
        right: position.end ? FACADE_EDGE_GAP_CM : FACADE_NEIGHBOR_GAP_CM,
      },
      sinkRow,
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

function applyPromo(
  config: FurnitureConfig,
  subtotal: number,
): { discount: number; promo: PromoResult | null } {
  const code = config.promoCode?.trim().toUpperCase();
  if (!code) return { discount: 0, promo: null };

  const promo = PROMOS.find((item) => item.code === code);
  if (!promo) {
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

  const result = calculatePromo(promo, config.kind, subtotal);
  return { discount: result.discount, promo: result };
}

function calculatePromo(
  promo: PromoDefinition,
  kind: FurnitureConfig["kind"],
  subtotal: number,
): PromoResult {
  const base: PromoResult = {
    code: promo.code,
    title: promo.title,
    discount: 0,
    valid: false,
    demo: promo.demo,
  };

  if (!promo.active) {
    return { ...base, reason: "Промокод неактивен." };
  }
  if (promo.appliesTo !== "all" && !promo.appliesTo.includes(kind)) {
    return { ...base, reason: "Промокод действует для другой категории мебели." };
  }
  if (subtotal < promo.minSubtotal) {
    return {
      ...base,
      reason: `Промокод действует при предварительной стоимости от ${formatRub(promo.minSubtotal)}.`,
    };
  }

  let discount =
    promo.type === "percent" ? (subtotal * promo.value) / 100 : promo.value;
  if (promo.maxDiscount) discount = Math.min(discount, promo.maxDiscount);
  discount = Math.min(discount, subtotal);
  discount = roundMoney(discount);

  return {
    ...base,
    discount,
    valid: discount > 0,
    reason:
      promo.type === "percent"
        ? `Скидка ${promo.value}% применена к предварительному расчёту.`
        : "Фиксированная скидка применена к предварительному расчёту.",
  };
}

export function calculateKitchenPrice(
  config: KitchenConfig,
  inputs?: CalculationInputs,
): PriceBreakdown {
  const body = bodyRate();
  const facade = facadeRate(config);
  const style = styleMultiplier(config);
  const handle = handleRate(config.handle);
  const lines: PriceLine[] = [];

  let bodyCost = 0;
  let frontsCost = 0;
  let fittingsCost = 0;
  let optionsCost = 0;
  let doorsTotal = 0;
  let drawerTotal = 0;
  let shelfTotal = 0;

  // Контекст края столешницы для модулей мойки нижнего ряда.
  const sinkRows = new Map<string, SinkRowContext>();
  for (const unit of config.modules) {
    if (unit.type === "sink") {
      sinkRows.set(unit.id, sinkRowContext(config.modules, unit.id));
    }
  }
  const rowPositions = kitchenRowPositions(config.modules);

  for (const unit of config.modules) {
    const preset = KITCHEN_MODULES[unit.type];
    const moduleArea = area(unit.width, unit.height);
    const depthFactor = unit.depth / PRICING.kitchen.bodyDepthReference;
    bodyCost += preset.basePrice + moduleArea * body * Math.max(0.5, depthFactor);

    const sinkRow = unit.type === "sink" ? sinkRows.get(unit.id) : undefined;
    const sinkTotals =
      unit.type === "sink" ? sinkFacadeTotals(unit, sinkRow) : null;
    const doors = sinkTotals
      ? sinkTotals.doors
      : kitchenDoorCount(unit, sinkRow);
    const facadeArea = kitchenModuleFacadeArea(
      unit,
      rowPositions.get(unit.id) ?? { start: true, end: true },
      config,
      sinkRow,
    );
    // У мойки каждый фронт ящиков и панель бутылочки — отдельный фасад.
    if (sinkTotals) {
      doorsTotal += sinkTotals.panels;
      frontsCost += facadeArea * facade * style;
      if (doors > 0) {
        fittingsCost += doors * PRICING.kitchen.hingePerDoor;
        if (config.hinge === "soft") {
          fittingsCost += doors * PRICING.kitchen.softClosePerDoor;
        }
        if (config.pushToOpen) {
          fittingsCost += doors * PRICING.kitchen.pushToOpenPerDoor;
        }
        if (config.handle !== "none") {
          fittingsCost += doors * handle;
        }
      }
    } else {
      doorsTotal += doors;
      if (doors > 0) {
        frontsCost += facadeArea * facade * style;
        fittingsCost += doors * PRICING.kitchen.hingePerDoor;
        if (config.hinge === "soft") {
          fittingsCost += doors * PRICING.kitchen.softClosePerDoor;
        }
        if (config.pushToOpen) {
          fittingsCost += doors * PRICING.kitchen.pushToOpenPerDoor;
        }
        if (config.handle !== "none") {
          fittingsCost += doors * handle;
        }
      } else if (unit.type === "drawers") {
        drawerTotal += unit.drawers;
        frontsCost += facadeArea * facade * style;
        fittingsCost += unit.drawers * PRICING.kitchen.drawerSlide;
        if (config.hinge === "soft") {
          fittingsCost += unit.drawers * PRICING.kitchen.drawerSoftClose;
        }
        if (config.handle !== "none") {
          fittingsCost += unit.drawers * handle;
        }
      }
    }

    // Для мойки источником полок является sinkStorage (layout секций).
    // unit.shelves на sink — legacy-поле; при наличии sinkStorage оно не
    // должно учитываться повторно. Без sinkStorage поведение сохраняется.
    if (unit.type !== "sink" || !Array.isArray(unit.sinkStorage)) {
      shelfTotal += unit.shelves;
    }
    if (unit.type === "sink") {
      optionsCost += PRICING.kitchen.sinkCutout;
      // Перегородки — часть корпуса, отдельно не тарифицируются. Площадь
      // фасадов уже учтена по фактическим панелям выше.
      const sink = sinkLayout(
        unit,
        {
          left: rowPositions.get(unit.id)?.start
            ? FACADE_EDGE_GAP_CM
            : FACADE_NEIGHBOR_GAP_CM,
          right: rowPositions.get(unit.id)?.end
            ? FACADE_EDGE_GAP_CM
            : FACADE_NEIGHBOR_GAP_CM,
        },
        sinkRow,
      );
      for (const section of sink.sections) {
        if (section.comms) continue;
        if (section.bottle > 0) {
          // Бутылочница занимает секцию целиком: полки/ящики не начисляются.
          // Фасад (узкая панель без петель) уже учтён по площади панелей.
          optionsCost += PRICING.kitchen.bottleRack;
          continue;
        }
        shelfTotal += section.shelves;
        if (section.drawers > 0) {
          drawerTotal += section.drawers;
          // Фронты уже вошли в сумму панелей; здесь — фурнитура ящиков.
          fittingsCost += section.drawers * PRICING.kitchen.drawerSlide;
          if (config.hinge === "soft") {
            fittingsCost += section.drawers * PRICING.kitchen.drawerSoftClose;
          }
          if (config.handle !== "none") {
            fittingsCost += section.drawers * handle;
          }
        }
      }
    }
    if (unit.type === "hob") optionsCost += PRICING.kitchen.hobCutout;
    if (unit.type === "oven") optionsCost += PRICING.kitchen.ovenNiches;
  }

  optionsCost += shelfTotal * PRICING.kitchen.shelf;
  optionsCost += config.sidePanels * PRICING.kitchen.sidePanel;

  const countertopWidth = kitchenCountertopWidth(config) / 100;
  const countertop = COUNTERTOPS.find((item) => item.id === config.countertop);
  const countertopCost = countertopWidth * (countertop?.ratePerLinearMeter ?? 0);
  optionsCost += countertopCost;

  const floorWidth = kitchenFloorModules(config).reduce(
    (sum, module) => sum + module.width,
    0,
  );

  // Опоры и крепёж цоколя: единый расчёт для 2D-схемы, спецификации и цены.
  const supportPlan = computeSupports(config, inputs);
  optionsCost += supportPlan.cost;
  const systemLabel = findSupportSystem(supportPlan.systemId).label;

  // Цоколь: длина сохранена прежней (ширина нижнего ряда), цена зависит от материала.
  const plinthMaterial = findPlinthMaterial(config.plinthMaterial);
  const plinthMeters = floorWidth / 100;
  const plinthCost = config.plinth
    ? plinthMeters *
      plinthRatePerMeter(config.plinthMaterial ?? "", config.plinthFinish ?? "")
    : 0;
  optionsCost += plinthCost;

  // Подсветка: комплектная спецификация вместо фиксированной цены за метр.
  const lightingPlan = computeLighting(config, inputs);
  if (config.underCabinetLighting) {
    optionsCost += lightingPlan.cost;
  }

  const extraModules = Math.max(0, config.modules.length - 3);
  const complexityFactor = Math.min(
    PRICING.kitchen.complexityMax,
    1 + extraModules * PRICING.kitchen.complexityPerExtraModule,
  );

  const subtotalRaw =
    (PRICING.kitchen.baseCost + bodyCost + frontsCost + fittingsCost + optionsCost) *
    complexityFactor;

  lines.push({
    label: "Основа проекта",
    amount: PRICING.kitchen.baseCost,
    detail: "Проектирование, раскрой и организация заказа",
  });
  lines.push({
    label: "Корпус",
    amount: Math.round(bodyCost),
    detail: `${config.modules.length} модул. · ${BODY_MATERIALS.find((m) => m.id === config.bodyMaterial)?.name ?? ""}`,
  });
  lines.push({
    label: "Фасады",
    amount: Math.round(frontsCost),
    detail: `${doorsTotal} фасад. · ${drawerTotal} ящ.`,
  });
  lines.push({
    label: "Фурнитура",
    amount: Math.round(fittingsCost),
    detail: `Петли, направляющие, ручки${config.pushToOpen ? ", push-to-open" : ""}`,
  });
  lines.push({
    label: "Столешница, цоколь и опции",
    amount: Math.round(optionsCost),
    detail: `${countertopWidth.toFixed(1)} м столешницы · ${shelfTotal} полок`,
  });
  if (config.pushToOpen) {
    lines.push({ label: "Push-to-open", amount: 0, detail: "Учтено в фурнитуре" });
  }
  if (config.plinth) {
    lines.push({
      label: "Цоколь",
      amount: Math.round(plinthCost),
      detail: `${plinthMeters.toFixed(1)} м · ${
        plinthMaterial?.name ?? "ЛДСП"
      } ${config.plinthThickness ?? plinthMaterial?.defaultThickness ?? 16} мм · ${
        findPlinthMount(config.plinthMount).label
      }${
        supportPlan.clips > 0
          ? ` · ${supportPlan.clips} клипс к ${supportPlan.frontLegs} опорам`
          : ""
      }`,
    });
  }
  lines.push({
    label: "Опоры (ножки)",
    amount: Math.round(supportPlan.costParts.legs),
    detail: `${supportPlan.legs} шт. · ${supportPlan.frontLegs} спереди, ${supportPlan.backLegs} сзади · ${systemLabel}`,
  });
  if (supportPlan.clips > 0) {
    lines.push({
      label: "Клипсы цоколя",
      amount: Math.round(supportPlan.costParts.clips),
      detail: `${supportPlan.clips} шт. к фактическим опорам нижнего ряда`,
    });
  }
  if (supportPlan.screws > 0) {
    lines.push({
      label: "Винты скрытого крепления цоколя",
      amount: Math.round(supportPlan.costParts.screws),
      detail: `${supportPlan.screws} шт. к опорам нижнего ряда`,
    });
  }
  if (supportPlan.anchors > 0) {
    lines.push({
      label: "Крепление пеналов к стене",
      amount: Math.round(supportPlan.costParts.anchors),
      detail: `${supportPlan.anchors} шт. от ${findSupportSystem(supportPlan.systemId).tallAnchorSpacingCm} см шага`,
    });
  }
  if (config.underCabinetLighting) {
    lines.push({
      label: "Подсветка верхнего ряда",
      amount: Math.round(lightingPlan.cost),
      detail: `${lightingPlan.lengthM} м · ${lightingPlan.powerPerMeter} Вт/м · ${lightingPlan.voltage} В · ${lightingPlan.colorTemp} K · ${lightingPlan.psuW} Вт БП`,
    });
    for (const component of lightingPlan.components) {
      lines.push({
        label: `— ${component.label}`,
        amount: Math.round(component.amount),
        detail: `${component.qty} ${component.unit} · ${component.detail}`,
      });
    }
  }
  if (supportPlan.preliminary && supportPlan.legs > 0) {
    lines.push({
      label: "Опоры: предварительный расчёт",
      amount: 0,
      detail: supportPlan.note,
    });
  }
  if (config.sidePanels > 0) {
    lines.push({
      label: "Декоративные боковины",
      amount: 0,
      detail: `${config.sidePanels} шт. учтены в опциях`,
    });
  }
  if (complexityFactor > 1) {
    lines.push({
      label: "Сложность конфигурации",
      amount: 0,
      detail: `Коэффициент ×${complexityFactor.toFixed(2)}`,
    });
  }

  const subtotal = Math.max(0, Math.max(PRICING.minOrder, roundMoney(subtotalRaw)));
  const minOrderApplied = subtotalRaw < PRICING.minOrder;
  if (minOrderApplied) {
    lines.push({
      label: "Минимальная стоимость заказа",
      amount: 0,
      detail: "Расчёт доведён до минимальной суммы",
    });
  }

  const { discount, promo } = applyPromo(config, subtotal);
  const total = roundMoney(Math.max(0, subtotal - discount));

  return {
    currency: "RUB",
    baseCost: PRICING.kitchen.baseCost,
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
    disclaimer: PRICE_DISCLAIMER,
  };
}

export function calculateWardrobePrice(
  config: WardrobeConfig,
  _inputs?: CalculationInputs,
): PriceBreakdown {
  void _inputs; // зарезервировано для CA-T-304/306; текущий источник — content.
  const body = bodyRate();
  const facade = facadeRate(config);
  const style = styleMultiplier(config);
  const handle = handleRate(config.handle);
  const geometry = wardrobeGeometry(config);
  const width = geometry.widthMm / 10;
  const totalArea = wardrobeBodyAreaSqm(geometry);
  const bodyCost = totalArea * body;
  const facadeGeometry = wardrobeFacadeGeometry(config, geometry);
  const facadeArea = facadeGeometry.totalAreaSqm;
  const frontsCost = facadeArea * facade * style;

  const doorsTotal = facadeGeometry.panels.length;
  const hingePlan = wardrobeHingePlan(config);
  let shelfTotal = 0;
  for (const section of config.sections) {
    shelfTotal += section.shelves.length;
  }
  const rodTotal = wardrobeRodCount(config);
  const drawerTotal = wardrobeDrawerCount(config);

  let fittingsCost =
    hingePlan.totalHinges * PRICING.wardrobe.hingePerDoor +
    drawerTotal * PRICING.wardrobe.drawer;
  if (config.hinge === "soft") {
    fittingsCost += doorsTotal * PRICING.wardrobe.softClosePerDoor;
    fittingsCost += drawerTotal * PRICING.wardrobe.drawerSoftClose;
  }
  if (config.pushToOpen) {
    fittingsCost += doorsTotal * PRICING.wardrobe.pushToOpenPerDoor;
  }
  if (config.handle !== "none") {
    fittingsCost += doorsTotal * handle;
  }

  let optionsCost =
    shelfTotal * PRICING.wardrobe.shelf + rodTotal * PRICING.wardrobe.rod;
  if (config.plinth) {
    optionsCost += (width / 100) * PRICING.wardrobe.plinthPerMeter;
  }
  if (config.ledLighting) {
    optionsCost += config.sections.length * PRICING.wardrobe.ledPerSection;
  }
  const edgePlan = wardrobeEdgePlan(
    config,
    {
      pvc04: PRICING.wardrobe.edgePvc04,
      pvc1: PRICING.wardrobe.edgePvc1,
      pvc2: PRICING.wardrobe.edgePvc2,
    },
    geometry,
    facadeGeometry,
  );
  optionsCost += edgePlan.totalCost;

  const lines: PriceLine[] = [
    {
      label: "Основа проекта",
      amount: PRICING.wardrobe.baseCost,
      detail: "Проектирование, раскрой и организация заказа",
    },
    {
      label: "Корпус",
      amount: Math.round(bodyCost),
      detail: `${totalArea.toFixed(2)} м² · ${BODY_MATERIALS.find((m) => m.id === config.bodyMaterial)?.name ?? ""}`,
    },
    {
      label: "Фасады",
      amount: Math.round(frontsCost),
      detail: `${doorsTotal} фасад. · ${FACADE_MATERIALS.find((m) => m.id === config.facadeMaterial)?.name ?? ""}`,
    },
    {
      label: "Фурнитура",
      amount: Math.round(fittingsCost),
      detail: `${doorsTotal} двер. · ${drawerTotal} ящ. · ${config.hinge === "soft" ? "доводчики" : "без доводчиков"}`,
    },
    {
      label: "Наполнение и опции",
      amount: Math.round(optionsCost),
      detail: `${shelfTotal} полок · ${rodTotal} штанг · ${config.ledLighting ? "LED-подсветка" : "без подсветки"}`,
    },
  ];
  if (config.ledLighting) {
    lines.push({
      label: "LED-подсветка",
      amount: 0,
      detail: `${config.sections.length} секц. учтены в опциях`,
    });
  }
  if (config.plinth) {
    lines.push({
      label: "Цоколь",
      amount: 0,
      detail: `${(width / 100).toFixed(1)} м учтено в опциях`,
    });
  }
  if (config.pushToOpen) {
    lines.push({ label: "Push-to-open", amount: 0, detail: "Учтено в фурнитуре" });
  }

  const subtotalRaw =
    PRICING.wardrobe.baseCost +
    bodyCost +
    frontsCost +
    fittingsCost +
    optionsCost;
  const subtotal = Math.max(PRICING.minOrder, roundMoney(subtotalRaw));
  const minOrderApplied = subtotalRaw < PRICING.minOrder;
  if (minOrderApplied) {
    lines.push({
      label: "Минимальная стоимость заказа",
      amount: 0,
      detail: "Расчёт доведён до минимальной суммы",
    });
  }

  const { discount, promo } = applyPromo(config, subtotal);
  const total = roundMoney(Math.max(0, subtotal - discount));

  return {
    currency: "RUB",
    baseCost: PRICING.wardrobe.baseCost,
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
    disclaimer: PRICE_DISCLAIMER,
  };
}

export function calculatePrice(
  config: FurnitureConfig,
  inputs?: CalculationInputs,
): PriceBreakdown {
  if (config.kind === "kitchen") return calculateKitchenPrice(config, inputs);
  return calculateWardrobePrice(config, inputs);
}
