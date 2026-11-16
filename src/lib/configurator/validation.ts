import {
  KITCHEN_LIMITS,
  KITCHEN_MODULES,
  WARDROBE_LIMITS,
  facadeThicknesses,
} from "@/content/catalog";
import {
  KITCHEN_MAX_FULL_DEPTH_MM,
  kitchenMaxBodyDepthCm,
} from "./geometry";
import { isLegacyFacadeMaterial } from "./materials";
import { wardrobeGeometry, wardrobeMinWidthMm } from "./wardrobe-geometry";
import { wardrobeHingePlan } from "./wardrobe-hinges";
import { kitchenTotalWidth, kitchenFloorModules, kitchenUpperModules } from "./pricing";
import {
  SINK_RULES,
  isBottleEdgeSection,
  maxSinkDepthFor,
  maxSinkWidthFor,
  sinkGeometry,
  sinkPartitionConflicts,
  sinkRowContext,
  sinkThreeDoorAvailable,
  sinkLayout,
  sectionFitsDrawers,
  type SinkRowContext,
} from "./sink";
import type {
  FurnitureConfig,
  KitchenConfig,
  KitchenModule,
  ValidationIssue,
  WardrobeConfig,
} from "./types";

function error(path: string, message: string): ValidationIssue {
  return { path, message, severity: "error" };
}

function warning(path: string, message: string): ValidationIssue {
  return { path, message, severity: "warning" };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function getFurnitureErrors(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}

export function isConfigValid(issues: ValidationIssue[]): boolean {
  return !issues.some((issue) => issue.severity === "error");
}

export function validateKitchen(config: KitchenConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const modules = config.modules;

  if (!Array.isArray(modules) || modules.length < KITCHEN_LIMITS.minModules) {
    issues.push(
      error(
        "modules",
        `В кухне должно быть не меньше ${KITCHEN_LIMITS.minModules} модулей.`,
      ),
    );
  }
  if (modules.length > KITCHEN_LIMITS.maxModules) {
    issues.push(
      error("modules", `В демо-конфигураторе доступно до ${KITCHEN_LIMITS.maxModules} модулей.`),
    );
  }

  if (!Number.isFinite(config.facadeThickness)) {
    issues.push(error("facadeThickness", "Толщина фасада должна быть числом, мм."));
  }
  const allowedFacadeThicknesses = facadeThicknesses(config.facadeMaterial);
  if (
    allowedFacadeThicknesses.length > 0 &&
    !allowedFacadeThicknesses.includes(config.facadeThickness)
  ) {
    issues.push(
      error(
        "facadeThickness",
        `Толщина фасада «${config.facadeMaterial}»: ${allowedFacadeThicknesses.join(", ")} мм.`,
      ),
    );
  }

  const ids = new Set<string>();
  for (const unit of modules) {
    if (ids.has(unit.id)) {
      issues.push(error(`modules.${unit.id}`, "Идентификатор модуля повторяется."));
    }
    ids.add(unit.id);

    const preset = KITCHEN_MODULES[unit.type];
    if (!preset) {
      issues.push(error("modules", "Выбран неизвестный тип модуля."));
      continue;
    }
    if (
      !isFiniteNumber(unit.width) ||
      unit.width < preset.minWidth ||
      unit.width > preset.maxWidth
    ) {
      issues.push(
        error(
          `modules.${unit.id}.width`,
          `Ширина модуля «${preset.label}»: от ${preset.minWidth} до ${preset.maxWidth} см.`,
        ),
      );
    }
    if (
      !isFiniteNumber(unit.height) ||
      unit.height < preset.minHeight ||
      unit.height > preset.maxHeight
    ) {
      issues.push(
        error(
          `modules.${unit.id}.height`,
          `Высота модуля «${preset.label}»: от ${preset.minHeight} до ${preset.maxHeight} см.`,
        ),
      );
    }
    if (
      !isFiniteNumber(unit.depth) ||
      unit.depth < preset.minDepth ||
      unit.depth > preset.maxDepth
    ) {
      issues.push(
        error(
          `modules.${unit.id}.depth`,
          `Глубина модуля «${preset.label}»: от ${preset.minDepth} до ${preset.maxDepth} см.`,
        ),
      );
    } else if (unit.type !== "tall" && unit.type !== "oven") {
      const maxBodyDepth = kitchenMaxBodyDepthCm(config.facadeThickness);
      if (unit.depth > maxBodyDepth) {
        issues.push(
          error(
            `modules.${unit.id}.depth`,
            `Глубина корпуса «${preset.label}» не более ${maxBodyDepth.toFixed(1)} см при фасаде ${config.facadeThickness} мм: корпус + ХДФ 3 мм + фасад ≤ ${KITCHEN_MAX_FULL_DEPTH_MM / 10} см.`,
          ),
        );
      }
    }
    if (
      !Number.isInteger(unit.shelves) ||
      unit.shelves < 0 ||
      unit.shelves > KITCHEN_LIMITS.maxShelvesPerModule
    ) {
      issues.push(
        error(
          `modules.${unit.id}.shelves`,
          `Полок в модуле: от 0 до ${KITCHEN_LIMITS.maxShelvesPerModule}.`,
        ),
      );
    }
    if (unit.type === "drawers") {
      if (
        !Number.isInteger(unit.drawers) ||
        unit.drawers < KITCHEN_LIMITS.minDrawers ||
        unit.drawers > KITCHEN_LIMITS.maxDrawers
      ) {
        issues.push(
          error(
            `modules.${unit.id}.drawers`,
            `В блоке ящиков доступно от ${KITCHEN_LIMITS.minDrawers} до ${KITCHEN_LIMITS.maxDrawers} ящиков.`,
          ),
        );
      }
    } else if (unit.drawers !== 0) {
      issues.push(
        error(
          `modules.${unit.id}.drawers`,
          "Выдвижные ящики доступны в отдельном модуле «Блок ящиков».",
        ),
      );
    }
    if (unit.type === "sink") {
      issues.push(...validateSinkModule(unit, sinkRowContext(modules, unit.id)));
    }
  }

  const floor = kitchenFloorModules(config);
  if (floor.length === 0) {
    issues.push(error("modules", "Нужен хотя бы один модуль нижнего ряда."));
  }
  const floorHeights = new Set(
    floor
      .filter((item) => item.type !== "tall" && item.type !== "oven")
      .map((item) => item.height),
  );
  if (floorHeights.size > 1) {
    issues.push(
      error(
        "modules",
        "Высота нижних модулей должна совпадать, чтобы столешница была единой.",
      ),
    );
  }

  const totalWidth = kitchenTotalWidth(config);
  const floorWidth = floor.reduce((sum, module) => sum + module.width, 0);
  const upperWidth = kitchenUpperModules(config).reduce(
    (sum, module) => sum + module.width,
    0,
  );
  if (totalWidth < KITCHEN_LIMITS.minTotalWidth) {
    issues.push(
      error(
        "width",
        `Общая ширина кухни должна быть не меньше ${KITCHEN_LIMITS.minTotalWidth} см.`,
      ),
    );
  }
  if (upperWidth > floorWidth + KITCHEN_LIMITS.maxWallOverhang) {
    issues.push(
      warning(
        "upper",
        "Верхний ряд шире нижнего. Проверьте, как кухня встанет в помещение и не останется ли верхних шкафов без опоры.",
      ),
    );
  }

  const sinks = modules.filter((module) => module.type === "sink").length;
  if (sinks > KITCHEN_LIMITS.maxSinkModules) {
    issues.push(
      error("modules", "В демо-конфигураторе допускается один модуль под мойку."),
    );
  }
  const hobs = modules.filter((module) => module.type === "hob").length;
  if (hobs > KITCHEN_LIMITS.maxHobModules) {
    issues.push(
      error("modules", "В демо-конфигураторе допускается один модуль под варочную панель."),
    );
  }
  const ovens = modules.filter((module) => module.type === "oven").length;
  if (ovens > KITCHEN_LIMITS.maxOvenModules) {
    issues.push(
      error("modules", "В демо-конфигураторе допускается один пенал под технику."),
    );
  }

  issues.push(...validateCompatibility(config));
  return issues;
}

/** Правила конструкции модуля под мойку: ширина, фасады, перегородки, секции. */
function validateSinkModule(
  unit: KitchenModule,
  row?: SinkRowContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const path = `modules.${unit.id}`;

  if (
    isFiniteNumber(unit.width) &&
    Math.abs(unit.width / SINK_RULES.widthStep - Math.round(unit.width / SINK_RULES.widthStep)) > 0.001
  ) {
    issues.push(
      error(
        `${path}.width`,
        `Ширина модуля под мойку задаётся с шагом ${SINK_RULES.widthStep} см (от ${SINK_RULES.minWidth} до ${SINK_RULES.maxWidth} см).`,
      ),
    );
  }

  if (unit.sinkFacades !== undefined && unit.sinkFacades !== 2 && unit.sinkFacades !== 3) {
    issues.push(
      error(`${path}.sinkFacades`, "Модуль под мойку: доступно 2 или 3 распашных фасада."),
    );
  }
  if (
    unit.sinkFacades === 3 &&
    isFiniteNumber(unit.width) &&
    !sinkThreeDoorAvailable(unit.width)
  ) {
    issues.push(
      error(
        `${path}.sinkFacades`,
        `Конструкция с тремя фасадами доступна от ${SINK_RULES.threeDoorMinWidth} см.`,
      ),
    );
  }

  if (unit.sinkStorage !== undefined) {
    if (!Array.isArray(unit.sinkStorage)) {
      issues.push(error(`${path}.sinkStorage`, "Наполнение секций задано некорректно."));
      return issues;
    }
    const layout = sinkLayout(unit, undefined, row);
    const freeSections = layout.sections.filter((section) => !section.comms);
    if (unit.sinkStorage.length > freeSections.length) {
      issues.push(
        error(
          `${path}.sinkStorage`,
          `В этой конструкции доступно не больше ${freeSections.length} секций хранения.`,
        ),
      );
    }
    unit.sinkStorage.forEach((fill, index) => {
      const section = freeSections[index];
      if (
        !Number.isInteger(fill.shelves) ||
        fill.shelves < 0 ||
        fill.shelves > SINK_RULES.maxShelvesPerSection
      ) {
        issues.push(
          error(
            `${path}.sinkStorage.${index}.shelves`,
            `Полок в секции: от 0 до ${SINK_RULES.maxShelvesPerSection}.`,
          ),
        );
      }
      if (
        !Number.isInteger(fill.drawers) ||
        fill.drawers < 0 ||
        fill.drawers > SINK_RULES.maxDrawersPerSection ||
        (fill.drawers === 1)
      ) {
        issues.push(
          error(
            `${path}.sinkStorage.${index}.drawers`,
            `Ящиков в секции: 0 или от ${Math.min(2, SINK_RULES.maxDrawersPerSection)} до ${SINK_RULES.maxDrawersPerSection}.`,
          ),
        );
      }
      if (fill.drawers > 0 && section && !sectionFitsDrawers(section.width)) {
        issues.push(
          error(
            `${path}.sinkStorage.${index}.drawers`,
            `Для ящиков нужна секция наружной шириной не меньше ${SINK_RULES.minSectionOuterWidthForDrawers} см.`,
          ),
        );
      }
    });
    // Бутылочница: только одна на модуль и только в крайней секции
    // (у бокового края корпуса) — см. applyBottleCut в sink.ts.
    const bottleIndexes = unit.sinkStorage.reduce<number[]>((acc, fill, index) => {
      if (fill.bottle) acc.push(index);
      return acc;
    }, []);
    if (bottleIndexes.length > 1) {
      issues.push(
        error(
          `${path}.sinkStorage`,
          "Бутылочница может быть установлена только одна на модуль.",
        ),
      );
    }
    // Бутылочница задаёт границу секции; если перегородку нельзя поставить —
    // геометрия конфликтует с зоной мойки (секция без бутылочницы остаётся).
    const bottleBody = unit.sinkStorage.find((fill) => fill.bottle)?.bottle;
    if (bottleBody && bottleIndexes.length === 1) {
      const bottleSection = freeSections[bottleIndexes[0]];
      const atEdge =
        bottleSection !== undefined &&
        isBottleEdgeSection(bottleSection, unit.width);
      if (!atEdge) {
        issues.push(
          error(
            `${path}.sinkStorage`,
            "Бутылочница доступна только в крайней секции модуля — первой или последней.",
          ),
        );
      } else if (layout.bottleConflict) {
        issues.push(
          error(
            `${path}.sinkStorage`,
            `Бутылочница ${bottleBody} см не помещается — перегородка пересекает зону мойки. Выберите другой корпус.`,
          ),
        );
      }
    }
  }

  issues.push(...validateSinkGeometry(unit, row));

  return issues;
}

/** Габариты мойки, положение и отступы (мм), конфликт перегородки с зоной мойки. */
function validateSinkGeometry(
  unit: KitchenModule,
  row?: SinkRowContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const path = `modules.${unit.id}`;
  const step = SINK_RULES.sinkStep;

  const checkStep = (value: number) =>
    Math.abs(value / step - Math.round(value / step)) > 0.001;

  if (unit.sinkWidth !== undefined) {
    const maxW = maxSinkWidthFor(unit.width, row);
    if (!isFiniteNumber(unit.sinkWidth) || unit.sinkWidth < SINK_RULES.minSinkWidth || unit.sinkWidth > maxW) {
      issues.push(
        error(
          `${path}.sinkWidth`,
          `Ширина мойки: от ${SINK_RULES.minSinkWidth / 10} до ${maxW / 10} см для этого модуля (с учётом боковых отступов от края ряда).`,
        ),
      );
    } else if (checkStep(unit.sinkWidth)) {
      issues.push(
        error(`${path}.sinkWidth`, `Ширина мойки задаётся с шагом ${step} мм (1 см).`),
      );
    }
  }
  if (unit.sinkDepth !== undefined) {
    const maxD = maxSinkDepthFor(unit.depth);
    if (!isFiniteNumber(unit.sinkDepth) || unit.sinkDepth < SINK_RULES.minSinkDepth || unit.sinkDepth > maxD) {
      issues.push(
        error(
          `${path}.sinkDepth`,
          `Глубина мойки: от ${SINK_RULES.minSinkDepth / 10} до ${maxD / 10} см для этого модуля (с учётом переднего и заднего отступа).`,
        ),
      );
    } else if (checkStep(unit.sinkDepth)) {
      issues.push(
        error(`${path}.sinkDepth`, `Глубина мойки задаётся с шагом ${step} мм (1 см).`),
      );
    }
  }
  if (
    unit.sinkPosition !== undefined &&
    unit.sinkPosition !== "left" &&
    unit.sinkPosition !== "center" &&
    unit.sinkPosition !== "right"
  ) {
    issues.push(
      error(`${path}.sinkPosition`, "Расположение мойки: слева, по центру или справа."),
    );
  }
  if (unit.sinkOffset !== undefined && unit.sinkPosition !== "center") {
    const geom = sinkGeometry(unit, row);
    if (
      !isFiniteNumber(unit.sinkOffset) ||
      unit.sinkOffset < geom.minOffset ||
      unit.sinkOffset > geom.maxOffset
    ) {
      issues.push(
        error(
          `${path}.sinkOffset`,
          `Отступ от края модуля: от ${geom.minOffset} до ${geom.maxOffset} мм.`,
        ),
      );
    } else if (checkStep(unit.sinkOffset)) {
      issues.push(
        error(`${path}.sinkOffset`, `Отступ задаётся с шагом ${step} мм.`),
      );
    }
  }
  if (unit.sinkCutout) {
    const moduleWidth = unit.width * 10;
    const moduleDepth = unit.depth * 10;
    if (
      !isFiniteNumber(unit.sinkCutout.width) ||
      !isFiniteNumber(unit.sinkCutout.depth) ||
      unit.sinkCutout.width <= 0 ||
      unit.sinkCutout.width > moduleWidth ||
      unit.sinkCutout.depth <= 0 ||
      unit.sinkCutout.depth > moduleDepth
    ) {
      issues.push(
        error(
          `${path}.sinkCutout`,
          "Размеры монтажного выреза заданы некорректно (см. документацию производителя).",
        ),
      );
    }
  }

  // Конструктивная перегородка трёх фасадов: проверка обязательна, но
  // установка чаши у перегородки требует подтверждения производителем.
  const layout = sinkLayout(unit, undefined, row);
  const structuralConflict = layout.partitions.some(
    (partition) => partition.structural && partition.conflict,
  );
  if (structuralConflict) {
    issues.push(
      warning(
        `${path}.sinkFacades`,
        "Конструктивная перегородка трёх фасадов пересекает зону мойки — согласуйте установку чаши с производителем мойки и столешницы.",
      ),
    );
  }

  // При конфликте авто-перегородки наполнение некуда крепить — полки/ящики
  // запрещены (2 фасада) либо конструктивная перегородка (3 фасада).
  // Бутылочница от перегородки не зависит и остаётся разрешённой.
  const storageBlocked =
    sinkPartitionConflicts(unit, row) || structuralConflict;
  if (
    storageBlocked &&
    Array.isArray(unit.sinkStorage) &&
    unit.sinkStorage.some((fill) => fill.shelves > 0 || fill.drawers > 0)
  ) {
    issues.push(
      error(
        `${path}.sinkStorage`,
        "В этом месте невозможно установить перегородку — она пересекается с мойкой или её монтажной зоной. Полки и ящики не устанавливаются.",
      ),
    );
  }

  return issues;
}

export function validateWardrobe(config: WardrobeConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sections = config.sections;

  if (!Array.isArray(sections) || sections.length < WARDROBE_LIMITS.minSections) {
    issues.push(error("sections", "Добавьте хотя бы одну секцию шкафа."));
  }
  if (sections.length > WARDROBE_LIMITS.maxSections) {
    issues.push(
      error("sections", `В демо-конфигураторе доступно до ${WARDROBE_LIMITS.maxSections} секций.`),
    );
  }

  if (
    !isFiniteNumber(config.height) ||
    config.height < WARDROBE_LIMITS.minHeight ||
    config.height > WARDROBE_LIMITS.maxHeight
  ) {
    issues.push(
      error(
        "height",
        `Высота шкафа: от ${WARDROBE_LIMITS.minHeight} до ${WARDROBE_LIMITS.maxHeight} см.`,
      ),
    );
  }
  if (!isFiniteNumber(config.fullDepth) || config.fullDepth <= 0) {
    issues.push(
      error("fullDepth", "Полная глубина шкафа должна быть положительным числом, мм."),
    );
  } else if (config.fullDepth <= config.facadeThickness + config.backPanelThicknessMm) {
    issues.push(
      error(
        "fullDepth",
        "Полная глубина должна быть больше толщины фасада и задней стенки.",
      ),
    );
  }

  const geometry = wardrobeGeometry(config);
  const width = geometry.widthMm / 10;
  const minWidthMm = wardrobeMinWidthMm(sections.length);
  if (config.widthMm < minWidthMm) {
    issues.push(
      error(
        "widthMm",
        `Минимальная ширина для ${sections.length} секц. — ${minWidthMm} мм.`,
      ),
    );
  } else if (width < WARDROBE_LIMITS.minTotalWidth) {
    issues.push(
      error(
        "width",
        `Общая ширина шкафа должна быть не меньше ${WARDROBE_LIMITS.minTotalWidth} см.`,
      ),
    );
  }
  if (width > WARDROBE_LIMITS.maxTotalWidth) {
    issues.push(
      error(
        "width",
        `В демо-конфигураторе ширина шкафа ограничена ${WARDROBE_LIMITS.maxTotalWidth} см.`,
      ),
    );
  }

  const ids = new Set<string>();
  for (const section of sections) {
    if (ids.has(section.id)) {
      issues.push(error(`sections.${section.id}`, "Идентификатор секции повторяется."));
    }
    ids.add(section.id);

    const geometrySection = geometry.sections.find((item) => item.id === section.id);
    if (!geometrySection) {
      issues.push(error(`sections.${section.id}`, "Секция не соответствует геометрии корпуса."));
    } else if (
      geometrySection.innerWidthMm < 300 ||
      geometrySection.widthMm > WARDROBE_LIMITS.maxSectionWidth * 10
    ) {
      issues.push(
        error(
          `sections.${section.id}.width`,
          "Ширина секции должна быть не менее 300 мм и не больше допустимой.",
        ),
      );
    }
    if (section.drawers > 0 && geometrySection && geometrySection.widthMm < 500) {
      issues.push(
        error(
          `sections.${section.id}.drawers`,
          "Для ящиков нужна секция шириной не меньше 50 см.",
        ),
      );
    }
    if (
      !Number.isInteger(section.drawers) ||
      section.drawers < 0 ||
      section.drawers > WARDROBE_LIMITS.maxDrawersPerSection
    ) {
      issues.push(
        error(
          `sections.${section.id}.drawers`,
          `Ящиков в секции: от 0 до ${WARDROBE_LIMITS.maxDrawersPerSection}.`,
        ),
      );
    }
    if (
      !Array.isArray(section.rods) ||
      section.rods.length > WARDROBE_LIMITS.maxRodsPerSection
    ) {
      issues.push(
        error(
          `sections.${section.id}.rods`,
          `Штанг в секции: не больше ${WARDROBE_LIMITS.maxRodsPerSection}.`,
        ),
      );
    }

    const drawerZone =
      WARDROBE_LIMITS.plinthHeight +
      WARDROBE_LIMITS.carcassThickness +
      Math.max(0, section.drawers) * WARDROBE_LIMITS.drawerHeight;
    const minShelf = drawerZone + (section.drawers > 0 ? 10 : 8);
    const maxShelf = config.height - 10;

    if (!Array.isArray(section.shelves) || section.shelves.length > WARDROBE_LIMITS.maxShelvesPerSection) {
      issues.push(
        error(
          `sections.${section.id}.shelves`,
          `Полок в секции: не больше ${WARDROBE_LIMITS.maxShelvesPerSection}.`,
        ),
      );
    } else {
      const sorted = [...section.shelves].sort((a, b) => a - b);
      let previous = minShelf - WARDROBE_LIMITS.minShelfGap;
      for (const position of sorted) {
        if (!isFiniteNumber(position)) {
          issues.push(
            error(`sections.${section.id}.shelves`, "Положение полки должно быть числом."),
          );
          break;
        }
        if (position < minShelf || position > maxShelf) {
          issues.push(
            error(
              `sections.${section.id}.shelves`,
              `Полки должны находиться в пределах от ${Math.round(minShelf)} до ${Math.round(maxShelf)} см от пола.`,
            ),
          );
          break;
        }
        if (position - previous < WARDROBE_LIMITS.minShelfGap) {
          issues.push(
            error(
              `sections.${section.id}.shelves`,
              `Между полками нужно оставить минимум ${WARDROBE_LIMITS.minShelfGap} см, иначе секция будет нерабочей.`,
            ),
          );
          break;
        }
        previous = position;
      }
    }

    const rodMin = Math.max(80, drawerZone + 20);
    for (const height of section.rods ?? []) {
      if (
        !isFiniteNumber(height) ||
        height < rodMin ||
        height > config.height - WARDROBE_LIMITS.carcassThickness
      ) {
        issues.push(
          error(
            `sections.${section.id}.rods`,
            `Штанга должна быть на высоте от ${Math.round(rodMin)} до ${Math.round(config.height - 2)} см.`,
          ),
        );
        break;
      }
    }
    const uniqueRods = new Set(section.rods ?? []);
    if (uniqueRods.size !== (section.rods ?? []).length) {
      issues.push(
        error(`sections.${section.id}.rods`, "Штанги не должны располагаться на одной высоте."),
      );
    }
  }

  // Этап 1: ограничения новой модели данных шкафа.
  if (config.bodyMaterial !== "ldsp") {
    issues.push(error("bodyMaterial", "Корпус шкафа допускается только из ЛДСП."));
  }
  if (config.bodyThicknessMm !== 16) {
    issues.push(error("bodyThicknessMm", "Толщина корпуса должна быть 16 мм."));
  }
  if (config.backPanelThicknessMm !== 3) {
    issues.push(error("backPanelThicknessMm", "Задняя стенка должна быть ХДФ 3 мм."));
  }
  if (config.plinthHeightMm !== 80 || config.plinthInsetMm !== 50) {
    issues.push(error("plinth", "Цоколь: высота 80 мм, утопление 50 мм."));
  }
  if (config.facadeMount !== "overlay") {
    issues.push(error("facadeMount", "Основное исполнение фасадов — накладное."));
  }
  const facadeThicknessValid =
    config.facadeMaterial === "ldsp"
      ? config.facadeThickness === 16
      : config.facadeThickness === 19 || config.facadeThickness === 22;
  if (!facadeThicknessValid) {
    issues.push(
      error(
        "facadeThickness",
        "Толщина фасада не соответствует материалу: ЛДСП — 16 мм, МДФ ПВХ — 19 или 22 мм.",
      ),
    );
  }

  if (config.antresol) {
    if (
      !isFiniteNumber(config.antresol.heightMm) ||
      config.antresol.heightMm <= 0 ||
      config.antresol.heightMm +
        2 * config.bodyThicknessMm +
        config.plinthHeightMm >=
        config.height * 10
    ) {
      issues.push(
        error(
          "antresol.heightMm",
          "Высота антресоли должна быть больше 0 и меньше общей высоты шкафа.",
        ),
      );
    }
  }

  const expectedSections = config.partition ? 2 : 1;
  if (sections.length !== expectedSections) {
    issues.push(
      error(
        "sections",
        config.partition
          ? "При центральной перегородке должно быть две секции."
          : "Без центральной перегородки должна быть одна секция.",
      ),
    );
  }
  if (config.partition) {
    const position = config.partition.positionMm;
    if (
      !isFiniteNumber(position) ||
      geometry.sections.some((section) => section.innerWidthMm < 300)
    ) {
      issues.push(
        error(
          "partition.positionMm",
          "Перегородка должна оставлять секции шириной не менее 300 мм.",
        ),
      );
    }
  }

  for (const section of sections) {
    if (section.drawerBlock) {
      if (section.drawers < 3 || section.drawers > 5) {
        issues.push(
          error(
            `sections.${section.id}.drawers`,
            "Блок ящиков должен содержать от 3 до 5 ящиков.",
          ),
        );
      }
      if (section.drawerBlock.frontHeightsMm.length !== section.drawers) {
        issues.push(
          error(
            `sections.${section.id}.drawerBlock.frontHeightsMm`,
            "Количество высот фасадов должно совпадать с количеством ящиков секции.",
          ),
        );
      }
      const startMm =
        config.plinthHeightMm + config.bodyThicknessMm + 20;
      const topLimitMm = geometry.antresol
        ? config.plinthHeightMm +
          config.bodyThicknessMm +
          geometry.antresol.mainHeightMm
        : config.height * 10 - config.bodyThicknessMm;
      const frontsMm =
        section.drawerBlock.frontHeightsMm.reduce((sum, value) => sum + value, 0) +
        2 * Math.max(0, section.drawers - 1);
      if (
        section.drawerBlock.topMm <= startMm ||
        section.drawerBlock.topMm > topLimitMm ||
        frontsMm > section.drawerBlock.topMm - startMm
      ) {
        issues.push(
          error(
            `sections.${section.id}.drawerBlock`,
            "Блок ящиков не помещается в доступную высоту секции.",
          ),
        );
      }
    }
    if (section.rodType === "pullout") {
      if (!section.pulloutRod) {
        issues.push(
          error(
            `sections.${section.id}.pulloutRod`,
            "Для выдвижной штанги укажите длину и исполнение.",
          ),
        );
      } else if (config.fullDepth < 250 || config.fullDepth > 450) {
        issues.push(
          error(
            `sections.${section.id}.pulloutRod`,
            "Выдвижная штанга допустима при глубине секции 250–450 мм.",
          ),
        );
      }
    }
  }

  const hingePlan = wardrobeHingePlan(config);
  if (hingePlan.overloaded) {
    issues.push(
      warning(
        "facadeHinges",
        `Масса двери превышает подтверждённый диапазон петель (${hingePlan.reason}). Требуется проверка модели петель.`,
      ),
    );
  }
  issues.push(...validateCompatibility(config));
  return issues;
}

function validateCompatibility(config: KitchenConfig | WardrobeConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (config.pushToOpen && config.handle !== "none") {
    issues.push(
      error(
        "handle",
        "Push-to-open не совмещается с выступающими ручками. Выберите «Без ручек».",
      ),
    );
  }
  if (
    config.facadeStyle === "handleless" &&
    (config.handle === "bar" || config.handle === "knob")
  ) {
    issues.push(
      error(
        "handle",
        "Для фасадов без ручек подходит врезной профиль или push-to-open, а не накладная ручка.",
      ),
    );
  }
  if (isLegacyFacadeMaterial(config.facadeMaterial)) {
    issues.push(
      warning(
        "facadeMaterial",
        "Исторический материал фасада: для новых конфигураций недоступен. Выберите ЛДСП или МДФ.",
      ),
    );
  }

  const widths = getFittingsWidths(config);
  if (!widths.ok) {
    issues.push(error("width", "Проверьте размеры: обнаружено недопустимое значение."));
  }

  return issues;
}

function getFittingsWidths(config: KitchenConfig | WardrobeConfig): { ok: boolean } {
  if (config.kind === "kitchen") {
    return {
      ok: config.modules.every(
        (module) =>
          Number.isFinite(module.width) &&
          Number.isFinite(module.height) &&
          Number.isFinite(module.depth) &&
          !Number.isNaN(module.shelves) &&
          !Number.isNaN(module.drawers),
      ),
    };
  }
  const geometry = wardrobeGeometry(config);
  return {
    ok:
      Number.isFinite(geometry.widthMm) &&
      config.sections.every(
        (section) =>
          section.shelves.every((value) => Number.isFinite(value)) &&
          section.rods.every((value) => Number.isFinite(value)),
      ),
  };
}

export function validateConfig(config: FurnitureConfig): ValidationIssue[] {
  return config.kind === "kitchen"
    ? validateKitchen(config)
    : validateWardrobe(config);
}
