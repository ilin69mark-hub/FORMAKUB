import { describe, expect, it } from "vitest";
import { defaultKitchen, makeKitchenModule } from "./defaults";
import { calculatePrice } from "./pricing";
import { validateConfig } from "./validation";
import { canMoveKitchenModule, moveKitchenModule } from "./kitchenMove";
import {
  SINK_RULES,
  SINK_STANDARD_SIZES,
  SINK_ROW_EDGE_BOTH,
  clampSinkWidth,
  isSinkStandardSize,
  isSinkStandardWidth,
  maxSinkDepthFor,
  maxSinkWidthFor,
  normalizeSinkModule,
  normalizeSinkStorage,
  resolveDrawerCount,
  sinkFacadeCount,
  sinkGeometry,
  sinkLayout,
  sinkPartitionConflicts,
  sinkPartitionCount,
  sinkRowContext,
  sectionFitsDrawers,
  sectionOuterWidth,
  snapMm,
  snapSinkWidth,
} from "./sink";
import type { SinkRowContext } from "./sink";
import type { KitchenConfig, KitchenModule } from "./types";

function sinkModule(overrides: Partial<KitchenModule> = {}): KitchenModule {
  return makeKitchenModule("sink", { width: 60, shelves: 0, ...overrides });
}

function configWithSink(module: KitchenModule): KitchenConfig {
  const base = defaultKitchen();
  return {
    ...base,
    modules: base.modules.map((item) => (item.type === "sink" ? module : item)),
  };
}

/**
 * Контекст «край ряда с обеих сторон»: соседи sink — tall (прерывают
 * столешницу), поэтому боковые отступы 50/50 мм. Используется в тестах
 * механики перегородок, не зависящей от краёв ряда.
 */
function configWithEdgeSink(module: KitchenModule): KitchenConfig {
  const base = defaultKitchen();
  return {
    ...base,
    modules: [
      module,
      makeKitchenModule("tall", { id: "m-tall", width: 60, height: 220, shelves: 4 }),
      ...base.modules.filter((item) => item.type === "wall"),
    ],
  };
}

function errorMessages(issues: { severity: string; message: string }[]): string[] {
  return issues.filter((issue) => issue.severity === "error").map((issue) => issue.message);
}

describe("snapSinkWidth", () => {
  it("snaps to 5 cm step and clamps to 40–120", () => {
    expect(snapSinkWidth(40)).toBe(40);
    expect(snapSinkWidth(57)).toBe(55);
    expect(snapSinkWidth(63)).toBe(65);
    expect(snapSinkWidth(30)).toBe(40);
    expect(snapSinkWidth(130)).toBe(120);
  });
});

describe("standard widths", () => {
  it("flags the standard sizes", () => {
    for (const width of SINK_RULES.standardWidths) {
      expect(isSinkStandardWidth(width)).toBe(true);
    }
    expect(isSinkStandardWidth(55)).toBe(false);
    expect(isSinkStandardWidth(70)).toBe(false);
  });
});

describe("sink dimensions (мм, шаг 10)", () => {
  it("snapMm rounds to the 10 mm step", () => {
    expect(snapMm(507)).toBe(510);
    expect(snapMm(493)).toBe(490);
    expect(snapMm(500)).toBe(500);
  });

  it("clampSinkWidth respects the module-specific maximum", () => {
    // 60 см: 600 − 2×50 = 500 мм.
    expect(maxSinkWidthFor(60)).toBe(500);
    expect(clampSinkWidth(620, 60)).toBe(500);
    expect(clampSinkWidth(493, 60)).toBe(490);
    expect(clampSinkWidth(200, 60)).toBe(SINK_RULES.minSinkWidth);
  });

  it("clampSinkDepth respects mounting edges", () => {
    expect(maxSinkDepthFor(60)).toBe(500);
    expect(maxSinkDepthFor(56)).toBe(460);
  });

  it("recognises standard sizes", () => {
    expect(isSinkStandardSize(500, 400)).toBe(true);
    expect(isSinkStandardSize(505, 400)).toBe(false);
    expect(SINK_STANDARD_SIZES.some((size) => size.width === 780)).toBe(true);
  });

  it("rejects off-step dimensions in validation", () => {
    const issues = validateConfig(configWithSink(sinkModule({ sinkWidth: 405 })));
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.path.includes("sinkWidth") &&
          issue.message.includes("10"),
      ),
    ).toBe(true);
  });

  it("rejects dimensions outside the module-specific range", () => {
    const tooWide = validateConfig(configWithSink(sinkModule({ sinkWidth: 600 })));
    expect(
      tooWide.some((issue) => issue.severity === "error" && issue.path.includes("sinkWidth")),
    ).toBe(true);
    const tooDeep = validateConfig(configWithSink(sinkModule({ sinkDepth: 550 })));
    expect(
      tooDeep.some((issue) => issue.severity === "error" && issue.path.includes("sinkDepth")),
    ).toBe(true);
  });
});

describe("sink geometry (положение и отступы)", () => {
  it("centres the sink with equal offsets by default", () => {
    const geom = sinkGeometry(sinkModule({ width: 60 }));
    expect(geom.position).toBe("center");
    expect(geom.left).toBe(geom.right);
    expect(geom.left).toBe(50);
    expect(geom.width).toBe(500);
    expect(geom.depth).toBe(400);
  });

  it("places the sink from the left edge with the requested offset", () => {
    const geom = sinkGeometry(
      sinkModule({ width: 80, sinkPosition: "left", sinkOffset: 80 }),
    );
    expect(geom.x).toBe(80);
    expect(geom.left).toBe(80);
    expect(geom.right).toBe(800 - 500 - 80);
    expect(geom.offset).toBe(80);
  });

  it("places the sink from the right edge with the requested offset", () => {
    const geom = sinkGeometry(
      sinkModule({ width: 80, sinkPosition: "right", sinkOffset: 120, sinkWidth: 500 }),
    );
    expect(geom.x).toBe(800 - 500 - 120);
    expect(geom.right).toBe(120);
    expect(geom.left).toBe(180);
  });

  it("clamps the offset to the mount edge and the remaining width", () => {
    const geom = sinkGeometry(
      sinkModule({ width: 60, sinkPosition: "left", sinkOffset: 5 }),
    );
    expect(geom.offset).toBe(SINK_RULES.mountEdge);
    const huge = sinkGeometry(
      sinkModule({ width: 60, sinkPosition: "left", sinkOffset: 900 }),
    );
    expect(huge.offset).toBe(600 - 500 - 50);
  });

  it("rejects out-of-range offsets in validation", () => {
    const issues = validateConfig(
      configWithSink(sinkModule({ sinkPosition: "left", sinkOffset: 5 })),
    );
    expect(
      issues.some((issue) => issue.severity === "error" && issue.path.includes("sinkOffset")),
    ).toBe(true);
  });

  it("rejects an unknown position", () => {
    const issues = validateConfig(
      configWithSink(sinkModule({ sinkPosition: "middle" as "left" })),
    );
    expect(
      issues.some((issue) => issue.severity === "error" && issue.path.includes("sinkPosition")),
    ).toBe(true);
  });
});

describe("sinkFacadeCount", () => {
  it("defaults to 2 doors", () => {
    expect(sinkFacadeCount({ width: 60 })).toBe(2);
    expect(sinkFacadeCount({ width: 120 })).toBe(2);
  });

  it("honours explicit 3 doors only from 100 cm", () => {
    expect(sinkFacadeCount({ width: 100, sinkFacades: 3 })).toBe(3);
    expect(sinkFacadeCount({ width: 120, sinkFacades: 3 })).toBe(3);
    // Данные из старого черновика: 3 фасада при ширине меньше 100 → 2.
    expect(sinkFacadeCount({ width: 90, sinkFacades: 3 })).toBe(2);
  });
});

describe("sinkPartitionCount", () => {
  // Авто-семантика: перегородка — часть корпуса, появляется только при
  // выбранном наполнении (полки/ящики); бутылочнице не нужна (её cut).
  it("no partitions without fills", () => {
    expect(sinkPartitionCount({ width: 60 })).toBe(0);
    expect(sinkPartitionCount({ width: 100 })).toBe(0);
    expect(
      sinkPartitionCount({ width: 100, sinkStorage: [{ shelves: 0, drawers: 0, bottle: 15 }] }),
    ).toBe(0);
  });

  it("auto partition follows the section with shelves/drawers", () => {
    // Мойка 300 слева, отступ 50: секция хранения справа → перегородка
    // у правого края зоны (≥ 10 см под наполнение сохраняется).
    const withShelves = {
      sinkStorage: [{ shelves: 2, drawers: 0 }],
      sinkPosition: "left" as const,
      sinkOffset: 50,
      sinkWidth: 300,
    };
    expect(sinkPartitionCount({ width: 65, ...withShelves })).toBe(1);
    expect(sinkPartitionCount({ width: 80, ...withShelves })).toBe(1);
    // Ниже 65 см перегородка недоступна.
    expect(sinkPartitionCount({ width: 60, ...withShelves })).toBe(0);
    // Центр 500-й мойки в узком корпусе: секции хранения нет — полки не
    // крепятся и перегородка не нужна.
    expect(
      sinkPartitionCount({
        width: 65,
        sinkStorage: [{ shelves: 2, drawers: 0 }],
      }),
    ).toBe(0);
  });

  it("user case 1200: partitions by fill side, bottle cut replaces its side", () => {
    const base = {
      width: 120,
      sinkPosition: "left" as const,
      sinkOffset: 310,
      sinkWidth: 500,
      sinkDepth: 400,
    };
    // 2 фасада, мойка слева 500 мм, отступ 310: без наполнения перегородок нет.
    expect(sinkPartitionCount(base)).toBe(0);
    // Полки слева → одна перегородка слева (у края зоны, не посередине).
    expect(
      sinkPartitionCount({
        ...base,
        sinkStorage: [{ shelves: 2, drawers: 0 }],
      }),
    ).toBe(1);
    // Полки слева + бутылочка 300 справа: её cut несёт функцию перегородки
    // для секции коммуникаций справа — авто-перегородка там не ставится.
    expect(
      sinkPartitionCount({
        ...base,
        sinkStorage: [
          { shelves: 2, drawers: 0 },
          { shelves: 0, drawers: 0, bottle: 30 },
        ],
      }),
    ).toBe(1);
    // Наполнение с двух сторон → две перегородки.
    expect(
      sinkPartitionCount({
        ...base,
        sinkStorage: [
          { shelves: 2, drawers: 0 },
          { shelves: 2, drawers: 0 },
        ],
      }),
    ).toBe(2);
  });

  it("one structural partition with 3 doors, none for a center sink", () => {
    // Мойка слева → перегородка в правом зазоре (дверцы 2|3).
    expect(
      sinkPartitionCount({ width: 100, sinkFacades: 3, sinkPosition: "left" }),
    ).toBe(1);
    expect(
      sinkPartitionCount({ width: 120, sinkFacades: 3, sinkPosition: "right" }),
    ).toBe(1);
    // По центру перегородки нет — вся зона под коммуникации.
    expect(
      sinkPartitionCount({ width: 100, sinkFacades: 3, sinkPosition: "center" }),
    ).toBe(0);
  });
});

describe("sinkLayout geometry", () => {
  it("600 мм: 2 фасада, без перегородок, вся секция — коммуникации", () => {
    const layout = sinkLayout(sinkModule({ width: 60 }));
    expect(layout.facades).toBe(2);
    expect(layout.partitionCount).toBe(0);
    expect(layout.doorXs).toHaveLength(2);
    // Ширина створки с учётом боковин и зазора: (60 − 3.2 − 0.25) / 2.
    expect(layout.doorWidth).toBeCloseTo((60 - 2 * 1.6 - 0.25) / 2, 5);
    expect(layout.sections).toHaveLength(1);
    expect(layout.sections[0].comms).toBe(true);
  });

  it("800 мм: авто-перегородка невозможна при конфликте с зоной мойки (ТЗ п.8)", () => {
    // Мойка 500×400 по центру: зона 100–700 мм; перегородка 384–400 мм внутри зоны.
    const layout = sinkLayout(
      sinkModule({ width: 80, sinkStorage: [{ shelves: 2, drawers: 0 }] }),
    );
    expect(layout.facades).toBe(2);
    expect(layout.partitionCount).toBe(0);
    expect(layout.partitions).toHaveLength(0);
    // Вся внутренняя ширина занята зоной коммуникаций.
    expect(layout.sections.every((section) => section.comms)).toBe(true);
    // Конфликт авто-перегородки: полки/ящики крепить некуда.
    expect(sinkPartitionConflicts({ width: 80, depth: 60 })).toBe(true);
  });

  it("1000 мм: перегородка устанавливается, если зона мойки её не пересекает", () => {
    const layout = sinkLayout(
      sinkModule({
        width: 100,
        sinkStorage: [{ shelves: 2, drawers: 0 }],
        sinkPosition: "right",
        sinkOffset: 50,
        sinkWidth: 300,
      }),
    );
    expect(layout.partitionCount).toBe(1);
    const free = layout.sections.filter((section) => !section.comms);
    // Свободная секция слева (46,8 см) и узкий остаток 10 см между
    // перегородкой и зоной; правая часть — коммуникации.
    expect(free.length).toBeGreaterThanOrEqual(1);
    expect(free[0].width).toBeGreaterThan(SINK_RULES.minStorageSectionWidth / 10);
    // Свободная секция слева, зона коммуникаций справа.
    expect(layout.sections[0].comms).toBe(false);
    expect(layout.sections[layout.sections.length - 1].comms).toBe(true);
  });

  it("1000 мм: 3 фасада, мойка по центру — перегородок нет, зона коммуникации", () => {
    const layout = sinkLayout(sinkModule({ width: 100, sinkFacades: 3 }));
    expect(layout.facades).toBe(3);
    expect(layout.doorXs).toHaveLength(3);
    expect(layout.partitionCount).toBe(0);
    expect(layout.partitions).toHaveLength(0);
    // Без перегородок секции режет только зона мойки: free | comms | free.
    expect(layout.sections).toHaveLength(3);
    expect(layout.sections[0].comms).toBe(false);
    expect(layout.sections[1].comms).toBe(true);
    expect(layout.sections[2].comms).toBe(false);
    // Створки не пересекаются и не выходят за боковины.
    for (let i = 0; i < layout.doorXs.length; i += 1) {
      expect(layout.doorXs[i]).toBeGreaterThanOrEqual(SINK_RULES.sidePanel - 0.001);
      expect(layout.doorXs[i] + layout.doorWidth).toBeLessThanOrEqual(
        100 - SINK_RULES.sidePanel + 0.001,
      );
    }
  });

  it("1000 мм: 3 фасада, мойка слева — одна перегородка в правом зазоре (дверцы 2|3)", () => {
    const layout = sinkLayout(
      sinkModule({
        width: 100,
        sinkFacades: 3,
        sinkPosition: "left",
        sinkOffset: 50,
        sinkWidth: 550,
      }),
    );
    expect(layout.partitionCount).toBe(1);
    expect(layout.partitions).toHaveLength(1);
    const partition = layout.partitions[0];
    expect(partition.structural).toBe(true);
    // Перегородка в правом зазоре: после второй створки.
    expect(partition.x).toBeGreaterThan(layout.doorXs[1] + layout.doorWidth);
    expect(partition.x + partition.width).toBeLessThan(layout.doorXs[2] + 0.001);
    // Зона коммуникаций слева, свободное пространство справа.
    const comms = layout.sections.filter((section) => section.comms);
    const free = layout.sections.filter((section) => !section.comms);
    expect(comms.length).toBeGreaterThan(0);
    expect(free.length).toBeGreaterThan(0);
    expect(comms[0].x).toBeLessThan(partition.x);
  });

  it("1000 мм: 3 фасада, мойка справа — одна перегородка в левом зазоре (дверцы 1|2)", () => {
    const layout = sinkLayout(
      sinkModule({
        width: 100,
        sinkFacades: 3,
        sinkPosition: "right",
        sinkOffset: 50,
        sinkWidth: 550,
      }),
    );
    expect(layout.partitionCount).toBe(1);
    const partition = layout.partitions[0];
    // Перегородка в левом зазоре: между первой и второй створкой.
    expect(partition.x).toBeGreaterThan(layout.doorXs[0] + layout.doorWidth);
    expect(partition.x + partition.width).toBeLessThan(layout.doorXs[1] + 0.001);
    // Свободное пространство слева, зона коммуникаций справа.
    expect(layout.sections[0].comms).toBe(false);
    const comms = layout.sections.filter((section) => section.comms);
    expect(comms.length).toBeGreaterThan(0);
    expect(comms[comms.length - 1].x).toBeGreaterThan(partition.x);
  });

  it("1200 мм: 3 фасада, sinkStorage применяется к свободным секциям", () => {
    const layout = sinkLayout(
      sinkModule({
        width: 120,
        sinkFacades: 3,
        sinkStorage: [
          { shelves: 2, drawers: 0 },
          { shelves: 3, drawers: 0 },
        ],
      }),
    );
    expect(layout.facades).toBe(3);
    // Мойка по центру: перегородок нет, секции режет зона мойки — 3 секции.
    expect(layout.partitionCount).toBe(0);
    expect(layout.sections).toHaveLength(3);
    const free = layout.sections.filter((section) => !section.comms);
    expect(free).toHaveLength(2);
    // sinkStorage индексируется по порядку свободных секций слева направо.
    expect(free[0].shelves).toBe(2);
    expect(free[0].drawers).toBe(0);
    expect(free[1].shelves).toBe(3);
    expect(free[1].drawers).toBe(0);
    // Коммуникационные секции всегда пусты.
    for (const section of layout.sections.filter((item) => item.comms)) {
      expect(section.shelves).toBe(0);
      expect(section.drawers).toBe(0);
    }
  });

  it("1200: fills on both sides give two partitions at the zone edges", () => {
    const layout = sinkLayout(
      sinkModule({
        width: 120,
        sinkPosition: "left",
        sinkOffset: 310,
        sinkWidth: 500,
        sinkDepth: 400,
        sinkStorage: [
          { shelves: 2, drawers: 0 },
          { shelves: 2, drawers: 0 },
        ],
      }),
    );
    expect(layout.partitionCount).toBe(2);
    expect(layout.partitions).toHaveLength(2);
    // Левая — вплотную к левому краю зоны (26 см), правая — к правому (86 см).
    expect(layout.partitions[0].x).toBeLessThan(26);
    expect(layout.partitions[0].x + layout.partitions[0].width).toBeLessThanOrEqual(26);
    expect(layout.partitions[1].x).toBeGreaterThanOrEqual(86);
    expect(layout.partitions.every((item) => item.conflict === false)).toBe(true);
    // Секции: полки | коммуникации | полки.
    const free = layout.sections.filter((section) => !section.comms);
    expect(free).toHaveLength(2);
    expect(free.every((section) => section.shelves > 0)).toBe(true);
  });

  it("1200: shelves left + bottle 30 right — one auto partition, one bottle cut", () => {
    const layout = sinkLayout(
      sinkModule({
        width: 120,
        sinkPosition: "left",
        sinkOffset: 310,
        sinkWidth: 500,
        sinkDepth: 400,
        sinkStorage: [
          { shelves: 2, drawers: 0 },
          { shelves: 0, drawers: 0, bottle: 30 },
        ],
      }),
    );
    // Одна авто-перегородка (слева) + cut бутылочки (справа), без дублей.
    expect(layout.partitionCount).toBe(1);
    expect(layout.sectionCuts).toHaveLength(2);
    const xs = layout.sectionCuts.map((cut) => cut.x);
    expect(Math.abs(xs[0] - xs[1])).toBeGreaterThan(2);
    expect(layout.partitions[0].x).toBeLessThan(26);
    // Секция бутылочки у правого края: наружный габарит ровно 30 см.
    const bottle = layout.sections.find((section) => section.bottle > 0);
    expect(bottle).toBeTruthy();
    expect(sectionOuterWidth(bottle!.width)).toBeCloseTo(30, 3);
    // Полки остались в левой секции.
    const shelves = layout.sections.find((section) => section.shelves > 0);
    expect(shelves).toBeTruthy();
    expect(shelves!.x).toBeLessThan(26);
  });

  it("intermediate widths recalculate without overlaps", () => {
    for (const width of [40, 45, 55, 65, 70, 75, 85, 95, 105, 110, 115]) {
      const layout = sinkLayout(sinkModule({ width }));
      let cursor = 0;
      for (const doorX of layout.doorXs) {
        expect(doorX).toBeGreaterThan(cursor - 0.001);
        cursor = doorX + layout.doorWidth;
      }
      expect(cursor).toBeLessThanOrEqual(width - SINK_RULES.sidePanel + 0.001);
      // Секции не пересекаются и покрывают внутреннюю ширину.
      let sectionCursor = 0;
      for (const section of layout.sections) {
        expect(section.x).toBeGreaterThanOrEqual(sectionCursor - 0.001);
        sectionCursor = section.x + section.width;
      }
      expect(sectionCursor).toBeLessThanOrEqual(width - SINK_RULES.sidePanel + 0.001);
    }
  });
});

describe("partition conflicts (ТЗ п.8)", () => {
  it("reports the exact error message when the auto partition crosses the sink zone", () => {
    // Полки/ящики требуют авто-перегородку, а место под ней занято мойкой.
    const config = configWithEdgeSink(
      sinkModule({ width: 80, sinkStorage: [{ shelves: 2, drawers: 0 }] }),
    );
    const issues = validateConfig(config);
    const conflict = issues.find(
      (issue) =>
        issue.severity === "error" &&
        issue.path.includes("sinkStorage") &&
        issue.message.includes("В этом месте невозможно установить перегородку"),
    );
    expect(conflict?.message).toBe(
      "В этом месте невозможно установить перегородку — она пересекается с мойкой или её монтажной зоной. Полки и ящики не устанавливаются.",
    );
  });

  it("shifts the structural partition (3 doors) out of the sink zone when storage fits", () => {
    // Мойка слева 600 мм, отступ 50: зона 0–700 мм задевает идеальную позицию
    // правого зазора (≈651–667 мм) — перегородка сдвигается к границе зоны,
    // секция хранения справа (≈27 см) больше минимума — без warning.
    const sinkModuleFixture = sinkModule({
      width: 100,
      sinkFacades: 3,
      sinkPosition: "left",
      sinkOffset: 50,
      sinkWidth: 600,
    });
    const config = configWithEdgeSink(sinkModuleFixture);
    const issues = validateConfig(config);
    expect(errorMessages(issues)).toHaveLength(0);
    expect(
      issues.some((issue) => issue.message.includes("Конструктивная перегородка")),
    ).toBe(false);

    const layout = sinkLayout(sinkModuleFixture);
    const partition = layout.partitions.find((item) => item.structural);
    expect(partition).toBeTruthy();
    expect(partition!.conflict).toBe(false);
    const geom = sinkGeometry(sinkModuleFixture);
    // Сдвинута за правую границу монтажной зоны (не пересекает её).
    expect(partition!.x).toBeGreaterThanOrEqual(geom.zoneRight / 10 - 0.001);
  });

  it("keeps the structural partition (3 doors) as a warning when the shift is impossible", () => {
    // Широкая чаша 800 мм слева с отступом 50: зона 0–900 мм — перегородку
    // некуда сдвинуть, обе секции < 10 см — warning, но не ошибка.
    const config = configWithEdgeSink(
      sinkModule({
        width: 100,
        sinkFacades: 3,
        sinkPosition: "left",
        sinkOffset: 50,
        sinkWidth: 800,
      }),
    );
    const issues = validateConfig(config);
    expect(errorMessages(issues)).toHaveLength(0);
    const warning = issues.find(
      (issue) =>
        issue.severity === "warning" &&
        issue.message.includes("Конструктивная перегородка трёх фасадов"),
    );
    expect(warning).toBeTruthy();
  });

  it("center sink with 3 doors produces no structural warning", () => {
    const config = configWithSink(sinkModule({ width: 100, sinkFacades: 3 }));
    const issues = validateConfig(config);
    expect(errorMessages(issues)).toHaveLength(0);
    expect(
      issues.some((issue) => issue.message.includes("Конструктивная перегородка")),
    ).toBe(false);
  });

  it("normalizeSinkModule drops the legacy sinkPartition option and blocked fills", () => {
    // Конфликт авто-перегородки (80 см, мойка по центру): полки/ящики
    // обнуляются, legacy-поле опции чистится.
    const cleared = normalizeSinkModule(
      sinkModule({
        width: 80,
        sinkPartition: true,
        sinkStorage: [{ shelves: 2, drawers: 0 }],
      }),
    );
    expect(cleared.sinkPartition).toBeUndefined();
    expect(
      cleared.sinkStorage?.every((fill) => fill.shelves === 0 && fill.drawers === 0),
    ).toBe(true);
    // Без конфликта (1000 мм, зона 600–1000 мм, перегородка 484–500,25 мм
    // не пересекается): legacy-поле тоже чистится, наполнение сохраняется.
    const kept = normalizeSinkModule(
      sinkModule({
        width: 100,
        sinkPartition: true,
        sinkPosition: "right",
        sinkOffset: 50,
        sinkWidth: 300,
        sinkStorage: [{ shelves: 2, drawers: 0 }],
      }),
    );
    expect(kept.sinkPartition).toBeUndefined();
    expect(kept.sinkStorage?.[0]?.shelves).toBe(2);
  });
});

describe("normalizeSinkModule", () => {
  it("clamps dimensions and trims storage to the number of free sections", () => {
    const unit = sinkModule({
      width: 60,
      sinkWidth: 900,
      sinkDepth: 5,
      sinkStorage: [
        { shelves: 9, drawers: 5 },
        { shelves: 1, drawers: 1 },
        { shelves: 0, drawers: 0 },
      ],
    });
    const result = normalizeSinkModule(unit);
    expect(result.sinkWidth).toBe(500);
    expect(result.sinkDepth).toBe(SINK_RULES.minSinkDepth);
    // 60 см, вся секция — коммуникации: свободных секций нет → пустой массив.
    expect(result.sinkStorage).toHaveLength(0);
  });

  it("clamps and trims storage to the number of free sections", () => {
    const unit = sinkModule({
      width: 120,
      sinkFacades: 3,
      sinkStorage: [
        { shelves: 9, drawers: 5 },
        { shelves: 1, drawers: 1 },
        { shelves: 0, drawers: 0 },
      ],
    });
    const layout = sinkLayout(unit);
    const free = layout.sections.filter((section) => !section.comms).length;
    const storage = normalizeSinkStorage(unit, free);
    expect(storage).toHaveLength(2);
    // Легаси-данные с обоими допами: остаются полки, ящики обнуляются
    // (один доп на секцию).
    expect(storage[0].shelves).toBe(SINK_RULES.maxShelvesPerSection);
    expect(storage[0].drawers).toBe(0);
    expect(storage[1].shelves).toBe(1);
    expect(storage[1].drawers).toBe(0);
  });

  it("keeps a single fill per section (shelves XOR drawers)", () => {
    expect(
      normalizeSinkStorage(
        { sinkStorage: [{ shelves: 2, drawers: 3 }] },
        1,
      )[0],
    ).toEqual({ shelves: 2, drawers: 0 });
    expect(
      normalizeSinkStorage(
        { sinkStorage: [{ shelves: 0, drawers: 3 }] },
        1,
      )[0],
    ).toEqual({ shelves: 0, drawers: 3 });
    // Бутылочка занимает секцию целиком.
    expect(
      normalizeSinkStorage(
        { sinkStorage: [{ shelves: 4, drawers: 2, bottle: 20 }] },
        1,
      )[0],
    ).toEqual({ shelves: 0, drawers: 0, bottle: 20 });
  });
});

describe("resolveDrawerCount", () => {
  it("steps down 3 → 2 → 0 (1 drawer is never valid)", () => {
    expect(resolveDrawerCount(3, 1)).toBe(0);
    expect(resolveDrawerCount(2, 1)).toBe(0);
    expect(resolveDrawerCount(2, 0)).toBe(0);
    expect(resolveDrawerCount(3, 2)).toBe(2);
    expect(resolveDrawerCount(2, 3)).toBe(3);
  });

  it("snaps up from 0 to the minimum of 2", () => {
    expect(resolveDrawerCount(0, 1)).toBe(2);
    expect(resolveDrawerCount(0, 2)).toBe(2);
    expect(resolveDrawerCount(0, 0)).toBe(0);
  });
});

describe("module movement on the scheme", () => {
  it("swaps modules inside the same zone", () => {
    const config = defaultKitchen();
    const moved = moveKitchenModule(config, "m-sink", 1);
    expect(moved.modules[0].id).toBe("m-hob");
    expect(moved.modules[1].id).toBe("m-sink");
    // Исходный конфигурационный объект не мутируется.
    expect(config.modules[0].id).toBe("m-sink");
  });

  it("refuses to move past the zone boundaries", () => {
    const config = defaultKitchen();
    // m-sink — первый в нижнем ряду.
    expect(canMoveKitchenModule(config, "m-sink", -1)).toBe(false);
    expect(canMoveKitchenModule(config, "m-sink", 1)).toBe(true);
    const moved = moveKitchenModule(config, "m-sink", -1);
    expect(moved.modules.map((module) => module.id)).toEqual(
      config.modules.map((module) => module.id),
    );
  });

  it("keeps upper modules inside the upper zone", () => {
    const config = defaultKitchen();
    const upperIds = config.modules
      .filter((module) => module.type === "wall")
      .map((module) => module.id);
    expect(canMoveKitchenModule(config, upperIds[0], -1)).toBe(false);
    const moved = moveKitchenModule(config, upperIds[0], 1);
    const movedUpper = moved.modules
      .filter((module) => module.type === "wall")
      .map((module) => module.id);
    expect(movedUpper[0]).toBe(upperIds[1]);
    expect(movedUpper[1]).toBe(upperIds[0]);
  });
});

describe("acceptance configurations", () => {
  it("600 мм: 2 фасада, без перегородки, полок и ящиков, зона коммуникаций свободна", () => {
    const config = configWithSink(sinkModule({ width: 60 }));
    const issues = validateConfig(config);
    expect(errorMessages(issues)).toHaveLength(0);
    const layout = sinkLayout(config.modules.find((m) => m.type === "sink")!);
    expect(layout.facades).toBe(2);
    expect(layout.partitionCount).toBe(0);
    expect(layout.sections.every((s) => s.shelves === 0 && s.drawers === 0)).toBe(true);
    expect(() => calculatePrice(config)).not.toThrow();
  });

  it("1000 мм: 2 фасада, разделение, хранение в свободной секции", () => {
    const config = configWithSink(
      sinkModule({
        width: 100,
        sinkPartition: true,
        sinkPosition: "right",
        sinkOffset: 50,
        sinkWidth: 300,
        sinkStorage: [{ shelves: 2, drawers: 0 }],
      }),
    );
    const issues = validateConfig(config);
    expect(errorMessages(issues)).toHaveLength(0);
    const layout = sinkLayout(config.modules.find((m) => m.type === "sink")!);
    expect(layout.facades).toBe(2);
    expect(layout.partitionCount).toBe(1);
    expect(layout.sections[0].shelves).toBe(2);
    expect(layout.sections[0].comms).toBe(false);
    const price = calculatePrice(config);
    expect(price.total).toBeGreaterThan(0);
  });

  it("1000 мм: 3 фасада, мойка по центру — полки в свободных секциях", () => {
    const config = configWithSink(
      sinkModule({
        width: 100,
        sinkFacades: 3,
        sinkStorage: [
          { shelves: 1, drawers: 0 },
          { shelves: 2, drawers: 0 },
        ],
      }),
    );
    const issues = validateConfig(config);
    expect(errorMessages(issues)).toHaveLength(0);
    const layout = sinkLayout(config.modules.find((m) => m.type === "sink")!);
    expect(layout.facades).toBe(3);
    expect(layout.partitionCount).toBe(0);
    const free = layout.sections.filter((section) => !section.comms);
    expect(free).toHaveLength(2);
    expect(free[0].shelves).toBe(1);
    expect(free[1].shelves).toBe(2);
    // Секции боковых зон узкие (~28 см наружных) — ящики недоступны.
    expect(sectionOuterWidth(free[0].width)).toBeLessThan(
      SINK_RULES.minSectionOuterWidthForDrawers,
    );
    expect(
      config.modules.find((m) => m.type === "sink")!.sinkStorage!.every(
        (fill) => fill.drawers === 0,
      ),
    ).toBe(true);
  });

  it("1200 мм: широкая конфигурация с 3 фасадами и полками", () => {
    const config = configWithSink(
      sinkModule({
        width: 120,
        sinkFacades: 3,
        sinkStorage: [
          { shelves: 2, drawers: 0 },
          { shelves: 3, drawers: 0 },
        ],
      }),
    );
    const issues = validateConfig(config);
    expect(errorMessages(issues)).toHaveLength(0);
    expect(() => calculatePrice(config)).not.toThrow();
  });

  it("1200 мм с 2 фасадами и перегородкой: ящики в широкой секции", () => {
    const config = configWithSink(
      sinkModule({
        width: 120,
        sinkPartition: true,
        sinkPosition: "left",
        sinkOffset: 50,
        sinkWidth: 450,
        sinkStorage: [{ shelves: 0, drawers: 2 }],
      }),
    );
    const issues = validateConfig(config);
    expect(errorMessages(issues)).toHaveLength(0);
    const layout = sinkLayout(config.modules.find((m) => m.type === "sink")!);
    expect(layout.facades).toBe(2);
    expect(layout.partitionCount).toBe(1);
    const free = layout.sections.filter((section) => !section.comms);
    expect(free).toHaveLength(1);
    expect(free[0].drawers).toBe(2);
    expect(sectionOuterWidth(free[0].width)).toBeGreaterThanOrEqual(
      SINK_RULES.minSectionOuterWidthForDrawers,
    );
  });

  it("1200 мм, мойка 50 по центру, 2 фасада: ящики справа проходят порог 30 см", () => {
    // Авто-перегородка стоит с косметическим зазором facadeGap/2 у края зоны
    // и уменьшает секцию до наружных 29.875 см — допуск зазора делает её
    // валидной (раньше — ложная ошибка «не меньше 30 см» + залипание секции).
    const config = configWithSink(
      sinkModule({
        width: 120,
        sinkPosition: "center",
        sinkWidth: 500,
        sinkDepth: 400,
        sinkFacades: 2,
        sinkStorage: [
          { shelves: 0, drawers: 0 },
          { shelves: 0, drawers: 2 },
        ],
      }),
    );
    const issues = validateConfig(config);
    expect(
      errorMessages(issues).some((message) => message.includes("Для ящиков")),
    ).toBe(false);
    const layout = sinkLayout(config.modules.find((m) => m.type === "sink")!);
    const free = layout.sections.filter((section) => !section.comms);
    expect(free).toHaveLength(2);
    expect(free[1].drawers).toBe(2);
    expect(sectionFitsDrawers(free[1].width)).toBe(true);
    expect(sectionFitsDrawers(free[1].width - 0.5)).toBe(false);
  });

  it("rejects invalid sink configurations", () => {
    // Шаг ширины не 5 см.
    const stepIssue = validateConfig(configWithSink(sinkModule({ width: 63 })));
    expect(stepIssue.some((issue) => issue.severity === "error" && issue.path.includes("width"))).toBe(true);
    // 3 фасада при ширине меньше 100.
    const doorsIssue = validateConfig(configWithSink(sinkModule({ width: 80, sinkFacades: 3 })));
    expect(doorsIssue.some((issue) => issue.path.includes("sinkFacades"))).toBe(true);
    // Опция перегородки устарела (перегородка — часть корпуса): legacy-поле
    // валидацию не трогает и чистится нормализацией.
    const legacyIssue = validateConfig(
      configWithSink(sinkModule({ width: 60, sinkPartition: true })),
    );
    expect(legacyIssue.some((issue) => issue.path.includes("sinkPartition"))).toBe(false);
    // Наполнение при отсутствии свободных секций (65 см — вся секция коммуникации).
    const storageIssue = validateConfig(
      configWithSink(sinkModule({ width: 65, sinkStorage: [{ shelves: 0, drawers: 2 }] })),
    );
    expect(storageIssue.some((issue) => issue.path.includes("sinkStorage"))).toBe(true);
  });

  it("prices wide sink higher than the base 600 module", () => {
    const base = calculatePrice(configWithSink(sinkModule({ width: 60 })));
    const wide = calculatePrice(
      configWithSink(
        sinkModule({ width: 120, sinkFacades: 3, sinkStorage: [{ shelves: 2, drawers: 0 }, { shelves: 0, drawers: 2 }] }),
      ),
    );
    expect(wide.total).toBeGreaterThan(base.total);
  });
});

describe("bottle rack section geometry", () => {
  it("shifts the bottle cut so the section outer width equals 15/20/30", () => {
    for (const body of [15, 20, 30] as const) {
      const fixture = sinkModule({
        width: 120,
        sinkPosition: "center",
        sinkWidth: 500,
        sinkStorage: [{ shelves: 0, drawers: 0, bottle: body }],
      });
      const layout = sinkLayout(fixture);
      expect(layout.bottleConflict).toBe(false);
      // Единственная граница — cut бутылочки: центральная авто-перегородка
      // при бутылочнице не ставится (без полок/ящиков и без «Секции 2»).
      expect(layout.sectionCuts).toHaveLength(1);
      expect(layout.partitionCount).toBe(0);
      const bottleSection = layout.sections.find((s) => !s.comms && s.bottle > 0);
      expect(bottleSection).toBeTruthy();
      // Секция у левого края: внутренняя = body − 3.2, наружная = body.
      expect(bottleSection!.x).toBeCloseTo(1.6, 3);
      expect(bottleSection!.width).toBeCloseTo(body - 3.2, 3);
      expect(sectionOuterWidth(bottleSection!.width)).toBeCloseTo(body, 3);
    }
  });

  it("places the bottle section at the right module edge for a left sink", () => {
    const fixture = sinkModule({
      width: 100,
      sinkFacades: 3,
      sinkPosition: "left",
      sinkWidth: 400,
      sinkStorage: [{ shelves: 0, drawers: 0 }, { shelves: 0, drawers: 0, bottle: 15 }],
    });
    const layout = sinkLayout(fixture);
    expect(layout.bottleConflict).toBe(false);
    const bottleSection = layout.sections.find((s) => !s.comms && s.bottle > 0);
    expect(bottleSection).toBeTruthy();
    expect(bottleSection!.x + bottleSection!.width).toBeCloseTo(100 - 1.6, 3);
    expect(sectionOuterWidth(bottleSection!.width)).toBeCloseTo(15, 3);
  });

  it("places the bottle section at the left module edge for a right sink (facade panel first)", () => {
    const fixture = sinkModule({
      width: 100,
      sinkFacades: 3,
      sinkPosition: "right",
      sinkWidth: 400,
      sinkStorage: [
        { shelves: 0, drawers: 0, bottle: 15 },
        { shelves: 0, drawers: 0 },
      ],
    });
    const layout = sinkLayout(fixture);
    expect(layout.bottleConflict).toBe(false);
    const bottleSection = layout.sections.find((s) => !s.comms && s.bottle > 0);
    expect(bottleSection).toBeTruthy();
    expect(bottleSection!.x).toBeCloseTo(1.6, 3);
    expect(sectionOuterWidth(bottleSection!.width)).toBeCloseTo(15, 3);

    // Узкий фасад бутылочки — панель у левого края дверного поля.
    const boxes = layout.facadeBoxes;
    expect(boxes.filter((box) => box.kind === "bottle")).toHaveLength(1);
    expect(boxes[0].kind).toBe("bottle");
    expect(boxes[0].x).toBeCloseTo(
      Math.min(...boxes.map((box) => box.x)),
      5,
    );
    // Створки начинаются после панели, без перекрытия.
    expect(boxes[1].x).toBeGreaterThanOrEqual(boxes[0].x + boxes[0].width);
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i].x).toBeGreaterThanOrEqual(
        boxes[i - 1].x + boxes[i - 1].width,
      );
    }
  });

  it("reports a conflict when the bottle partition crosses the sink zone", () => {
    const config = configWithSink(
      sinkModule({
        width: 100,
        sinkPosition: "center",
        sinkWidth: 500,
        sinkStorage: [{ shelves: 0, drawers: 0, bottle: 30 }],
      }),
    );
    const layout = sinkLayout(
      config.modules.find((m) => m.type === "sink")!,
    );
    expect(layout.bottleConflict).toBe(true);
    expect(layout.sectionCuts).toHaveLength(layout.partitions.length);
    const issues = validateConfig(config);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message.includes("Бутылочница 30 см не помещается"),
      ),
    ).toBe(true);
  });

  it("drawers threshold uses the outer section width (30 cm)", () => {
    expect(sectionOuterWidth(26.8)).toBeCloseTo(30, 3);
    expect(sectionOuterWidth(26.8)).toBeGreaterThanOrEqual(
      SINK_RULES.minSectionOuterWidthForDrawers,
    );
    expect(sectionOuterWidth(26.7)).toBeLessThan(
      SINK_RULES.minSectionOuterWidthForDrawers,
    );
  });

  it("makes the remainder of the bottle cut part of the comms zone (no extra storage section)", () => {
    const fixture = sinkModule({
      width: 120,
      sinkPartition: true,
      sinkPosition: "center",
      sinkWidth: 500,
      sinkStorage: [
        { shelves: 1, drawers: 0 },
        { shelves: 0, drawers: 0, bottle: 15 },
      ],
    });
    const layout = sinkLayout(fixture);
    expect(layout.bottleConflict).toBe(false);
    const free = layout.sections.filter((section) => !section.comms);
    // Свободных секций ровно столько, сколько в sinkStorage: остаток — comms.
    expect(free).toHaveLength(2);
    expect(layout.sections.filter((s) => !s.comms).map((s) => s.shelves)).toEqual([
      1, 0,
    ]);
    const bottleSection = free.find((section) => section.bottle > 0);
    expect(bottleSection).toBeTruthy();
    expect(sectionOuterWidth(bottleSection!.width)).toBeCloseTo(15, 3);
    // Остаток за границей бутылочки (между правой границей зоны мойки и
    // границей реза) помечен как коммуникации, а не как секция хранения.
    expect(
      layout.sections.some((section) => section.comms && section.x >= 90 - 0.001 && section.x < 105 && section.width > 10),
    ).toBe(true);
  });

  it("adds a narrow bottle facade panel at the module edge (no handle side effects)", () => {
    const storage = [
      { shelves: 1, drawers: 0 },
      { shelves: 0, drawers: 0 },
    ];
    const plain = sinkLayout(
      sinkModule({
        width: 120,
        sinkPosition: "center",
        sinkWidth: 500,
        sinkStorage: storage,
      }),
    );
    const bottle = sinkLayout(
      sinkModule({
        width: 120,
        sinkPosition: "center",
        sinkWidth: 500,
        sinkStorage: [
          { shelves: 1, drawers: 0 },
          { shelves: 0, drawers: 0, bottle: 15 },
        ],
      }),
    );

    const boxes = bottle.facadeBoxes;
    // Створок как раньше + одна узкая панель бутылочки.
    expect(boxes).toHaveLength(plain.facadeBoxes.length + 1);
    const bottleBox = boxes[boxes.length - 1];
    expect(bottleBox.kind).toBe("bottle");
    // Панель у правого края дверного поля.
    const fieldEnd = Math.max(
      ...boxes.map((box) => box.x + box.width),
    );
    expect(bottleBox.x + bottleBox.width).toBeCloseTo(fieldEnd, 5);
    expect(
      Math.max(...plain.facadeBoxes.map((box) => box.x + box.width)),
    ).toBeCloseTo(fieldEnd, 5);
    // Панели не перекрываются; шов — зазор между створками (на границе реза).
    const prev = boxes[boxes.length - 2];
    expect(bottleBox.x).toBeGreaterThanOrEqual(prev.x + prev.width);
    expect(bottleBox.x - (prev.x + prev.width)).toBeCloseTo(
      SINK_RULES.facadeInnerGap,
      3,
    );
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width);
    }
    // Без бутылочки отдельной панели нет.
    expect(plain.facadeBoxes.some((box) => box.kind === "bottle")).toBe(false);
  });

  it("keeps the bottle rack stable across repeated layouts and normalization", () => {
    const fixture = sinkModule({
      width: 120,
      sinkPartition: true,
      sinkPosition: "center",
      sinkWidth: 500,
      sinkStorage: [
        { shelves: 2, drawers: 0 },
        { shelves: 0, drawers: 0, bottle: 15 },
      ],
    });
    const snapshot = (layout: ReturnType<typeof sinkLayout>) =>
      layout.sections.map((section) => ({
        x: section.x,
        width: section.width,
        comms: section.comms,
        bottle: section.bottle,
        shelves: section.shelves,
        drawers: section.drawers,
      }));
    const first = sinkLayout(fixture);
    expect(snapshot(sinkLayout(fixture))).toEqual(snapshot(first));
    const normalized = normalizeSinkModule(fixture);
    expect(normalized.sinkStorage).toEqual(fixture.sinkStorage);
    expect(snapshot(sinkLayout(normalized))).toEqual(snapshot(first));
    // Бутылочница не потерялась при повторных расчётах.
    expect(first.sections.find((section) => section.bottle > 0)).toBeTruthy();
  });

  it("rejects a bottle rack in a section that does not touch the module side", () => {
    // 3 фасада, мойка слева 300 мм: первая свободная секция (≈85–96,8 см)
    // зажата зоной слева и конструктивной перегородкой справа — НЕ у боковины,
    // бутылочница в ней невозможна.
    const config = configWithSink(
      sinkModule({
        width: 100,
        sinkFacades: 3,
        sinkPosition: "left",
        sinkOffset: 50,
        sinkWidth: 300,
        sinkStorage: [{ shelves: 0, drawers: 0, bottle: 15 }],
      }),
    );
    const layout = sinkLayout(config.modules.find((m) => m.type === "sink")!);
    expect(layout.bottleConflict).toBe(true);
    const issues = validateConfig(config);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message.includes("крайней секции модуля"),
      ),
    ).toBe(true);
    // Не выдаём одновременно ошибку про зону мойки — причина другая.
    expect(
      issues.some((issue) => issue.message.includes("не помещается")),
    ).toBe(false);
    // Нормализация очищает такой выбор.
    const cleared = normalizeSinkModule(config.modules.find((m) => m.type === "sink")!);
    expect(cleared.sinkStorage?.some((fill) => fill.bottle)).toBe(false);
  });

  it("allows only one bottle rack per module", () => {
    const config = configWithSink(
      sinkModule({
        width: 120,
        sinkPartition: true,
        sinkPosition: "center",
        sinkWidth: 500,
        sinkStorage: [
          { shelves: 0, drawers: 0, bottle: 15 },
          { shelves: 0, drawers: 0, bottle: 20 },
        ],
      }),
    );
    const issues = validateConfig(config);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message.includes("только одна на модуль"),
      ),
    ).toBe(true);
    // Нормализация оставляет одну (у края) и убирает лишнюю.
    const normalized = normalizeSinkModule(
      config.modules.find((m) => m.type === "sink")!,
    );
    const bottles = (normalized.sinkStorage ?? []).filter((fill) => fill.bottle);
    expect(bottles).toHaveLength(1);
    expect(bottles[0].bottle).toBe(15);
  });
});

describe("row margins (боковые отступы по краю ряда)", () => {
  const internal: SinkRowContext = { leftEdge: false, rightEdge: false };
  const edge: SinkRowContext = { leftEdge: true, rightEdge: false };
  const isolated: SinkRowContext = { leftEdge: true, rightEdge: true };

  it("maxSinkWidthFor — матрица внутренний / край / изолированный (глубина 60)", () => {
    // Внутренний: 0 + 0 к соседям со столешницей.
    expect(maxSinkWidthFor(40, internal)).toBe(400);
    expect(maxSinkWidthFor(45, internal)).toBe(450);
    expect(maxSinkWidthFor(50, internal)).toBe(500);
    // Край ряда: 50 мм с одной стороны.
    expect(maxSinkWidthFor(40, edge)).toBe(350);
    expect(maxSinkWidthFor(45, edge)).toBe(400);
    expect(maxSinkWidthFor(50, edge)).toBe(450);
    // Изолированный: 50 мм с обеих сторон.
    expect(maxSinkWidthFor(40, isolated)).toBe(300);
    expect(maxSinkWidthFor(45, isolated)).toBe(350);
    expect(maxSinkWidthFor(50, isolated)).toBe(400);
    // Без контекста — прежнее поведение (край с обеих сторон).
    expect(maxSinkWidthFor(60)).toBe(500);
    expect(clampSinkWidth(700, 60)).toBe(500);
    expect(clampSinkWidth(700, 60, internal)).toBe(600);
  });

  it("sinkRowContext — край определяется по соседним модулям", () => {
    const modules: Pick<KitchenModule, "id" | "type">[] = [
      { id: "base-1", type: "base" },
      { id: "sink-1", type: "sink" },
      { id: "tall-1", type: "tall" },
      { id: "sink-2", type: "sink" },
      { id: "oven-1", type: "oven" },
      { id: "sink-3", type: "sink" },
      { id: "base-2", type: "base" },
    ];
    // Первый модуль ряда: слева край, справа сосед со столешницей.
    expect(sinkRowContext(modules, "base-1")).toEqual({
      leftEdge: true,
      rightEdge: false,
    });
    // Между base и tall: слева столешница, справа разрыв — только правый край.
    expect(sinkRowContext(modules, "sink-1")).toEqual({
      leftEdge: false,
      rightEdge: true,
    });
    // Между tall и oven: разрывы с обеих сторон.
    expect(sinkRowContext(modules, "sink-2")).toEqual({
      leftEdge: true,
      rightEdge: true,
    });
    // Между oven и base: только левый край.
    expect(sinkRowContext(modules, "sink-3")).toEqual({
      leftEdge: true,
      rightEdge: false,
    });
    // Не найден в ряду — край с обеих сторон.
    expect(sinkRowContext(modules, "missing")).toEqual(SINK_ROW_EDGE_BOTH);
  });

  it("sinkGeometry — x зажат в боковые отступы, centerAllowed по сторонам", () => {
    // Внутренний 45 см: мойка 450 по центру без отступов.
    const inner = sinkGeometry(
      sinkModule({ width: 45, sinkWidth: 450, sinkDepth: 500, sinkPosition: "center" }),
      internal,
    );
    expect(inner.centerAllowed).toBe(true);
    expect(inner.x).toBe(0);
    expect(inner.marginLeft).toBe(0);
    expect(inner.marginRight).toBe(0);
    expect(inner.zoneLeft).toBeGreaterThanOrEqual(0);

    // Край ряда: слева 50 мм, справа 0 — центр для 450 в 50 см недостижим.
    const atEdge = sinkGeometry(
      sinkModule({ width: 50, sinkWidth: 450, sinkDepth: 500, sinkPosition: "center" }),
      edge,
    );
    expect(atEdge.centerAllowed).toBe(false);
    expect(atEdge.x).toBeGreaterThanOrEqual(50 - 0.001);
    expect(atEdge.marginLeft).toBe(50);
    expect(atEdge.marginRight).toBe(0);

    // Позиция «слева» у края: минимальный отступ ровно 50 мм.
    const leftAtEdge = sinkGeometry(
      sinkModule({ width: 50, sinkWidth: 400, sinkDepth: 500, sinkPosition: "left" }),
      edge,
    );
    expect(leftAtEdge.x).toBeGreaterThanOrEqual(50 - 0.001);

    // Позиция «справа» у края: правый отступ ровно 50 мм.
    const rightAtEdge = sinkGeometry(
      sinkModule({ width: 50, sinkWidth: 400, sinkDepth: 500, sinkPosition: "right" }),
      { leftEdge: false, rightEdge: true },
    );
    expect(rightAtEdge.right).toBeGreaterThanOrEqual(50 - 0.001);
    expect(rightAtEdge.marginRight).toBe(50);
  });

  it("validateConfig — мойка 450×500 во внутреннем модуле 45 см допустима", () => {
    const base = defaultKitchen();
    const innerModules: KitchenModule[] = [
      makeKitchenModule("base", { id: "b-1", width: 45 }),
      sinkModule({ id: "s-1", width: 45, sinkWidth: 450, sinkDepth: 500 }),
      makeKitchenModule("base", { id: "b-2", width: 45 }),
      ...base.modules.filter((item) => item.type === "wall"),
    ];
    const issues = validateConfig({ ...base, modules: innerModules });
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" && issue.message.includes("Ширина мойки"),
      ),
    ).toBe(false);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" && issue.message.includes("Глубина мойки"),
      ),
    ).toBe(false);
  });

  it("normalizeSinkModule — snap стандартного размера после зажима по ряду", () => {
    // Стандартная 500×400 зажимается в 450 (край ряда, модуль 50 см):
    // ближайший стандартный, который помещается, — 450×500.
    const clamped = normalizeSinkModule(
      sinkModule({ width: 50, sinkWidth: 500, sinkDepth: 400 }),
      edge,
    );
    expect(clamped.sinkWidth).toBe(450);
    expect(clamped.sinkDepth).toBe(500);

    // Нестандартный запрос не снапится — просто зажимается.
    const custom = normalizeSinkModule(
      sinkModule({ width: 50, sinkWidth: 470, sinkDepth: 400 }),
      edge,
    );
    expect(custom.sinkWidth).toBe(450);
    expect(custom.sinkDepth).toBe(400);
  });
});
