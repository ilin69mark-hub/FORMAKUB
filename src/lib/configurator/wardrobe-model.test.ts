import { describe, expect, it } from "vitest";

import { defaultWardrobe, defaultDressingRoom } from "./defaults";
import { safeParseConfig } from "./schema";
import { validateWardrobe } from "./validation";
import { wardrobeGeometry } from "./wardrobe-geometry";
import type { WardrobeConfig } from "./types";

function validConfig(): WardrobeConfig {
  const base = defaultWardrobe();
  return {
    ...base,
    partition: { positionMm: 1200 },
    antresol: { heightMm: 300 },
    sections: base.sections.map((section, index) =>
      index === 1
        ? {
            ...section,
            drawers: 3,
            drawerBlock: {
              topMm: 900,
              frontHeightsMm: [150, 250, 300],
              frontType: "overlay",
              box: {
                sideThicknessMm: 16,
                frontThicknessMm: 16,
                backThicknessMm: 16,
                bottomThicknessMm: 3,
                bottomMount: "overlay-bottom",
              },
              runner: {
                type: "ball-bearing-side",
                lengthMm: 500,
                softClose: true,
                loadClass: "standard",
              },
            },
          }
        : section,
    ),
  };
}

describe("CA-T-519 этап 1: модель данных шкафа", () => {
  it("defaultWardrobe содержит новые поля и не содержит depth", () => {
    const config = defaultWardrobe();
    expect(config.fullDepth).toBe(600);
    expect(config.facadeThickness).toBe(16);
    expect(config.facadeMount).toBe("overlay");
    expect(config.bodyThicknessMm).toBe(16);
    expect(config.backPanelThicknessMm).toBe(3);
    expect(config.plinthHeightMm).toBe(80);
    expect(config.plinthInsetMm).toBe(50);
    expect(config.partition).toEqual({ positionMm: 1200 });
    expect(config.antresol).toBeNull();
    expect("depth" in config).toBe(false);
    expect(safeParseConfig(config).success).toBe(true);
  });

  it("defaultDressingRoom использует допустимый материал и толщину", () => {
    const config = defaultDressingRoom();
    expect(config.facadeMaterial).toBe("mdf_pvc");
    expect(config.facadeThickness).toBe(19);
    expect(safeParseConfig(config).success).toBe(true);
  });

  it("валидная конфигурация с перегородкой, антресолью и блоком ящиков проходит", () => {
    const config = validConfig();
    expect(safeParseConfig(config).success).toBe(true);
    expect(validateWardrobe(config).filter((issue) => issue.severity === "error")).toEqual([]);
    const json = JSON.stringify(config);
    expect(safeParseConfig(JSON.parse(json)).success).toBe(true);
  });

  it("не допускает МДФ эмаль, legacy-материалы и неверную толщину", () => {
    const base = defaultWardrobe();
    expect(
      safeParseConfig({ ...base, facadeMaterial: "mdf" }).success,
    ).toBe(false);
    expect(
      safeParseConfig({ ...base, facadeMaterial: "glass" }).success,
    ).toBe(false);
    expect(
      validateWardrobe({ ...base, facadeThickness: 19 }).some(
        (issue) => issue.path === "facadeThickness",
      ),
    ).toBe(true);
    const invalid = { ...base, facadeMaterial: "mdf_pvc" as const, facadeThickness: 16 };
    expect(safeParseConfig(invalid).success).toBe(true);
    expect(
      validateWardrobe(invalid).some(
        (issue) => issue.path === "facadeThickness" && issue.severity === "error",
      ),
    ).toBe(true);
  });

  it("не допускает перегородку, оставляющую секцию меньше 300 мм", () => {
    const invalid = { ...defaultWardrobe(), partition: { positionMm: 200 } };
    expect(validateWardrobe(invalid).some((issue) => issue.path === "partition.positionMm")).toBe(true);
  });

  it("не допускает антресоль выше шкафа и дубли фасадных полей", () => {
    const base = defaultWardrobe();
    expect(
      validateWardrobe({
        ...base,
        antresol: { heightMm: 2400 },
      }).some((issue) => issue.path === "antresol.heightMm"),
    ).toBe(true);
    expect(
      safeParseConfig({
        ...base,
        antresol: { heightMm: 300, facadeThicknessMm: 22 },
      }).success,
    ).toBe(false);
    expect(
      safeParseConfig({
        ...base,
        antresol: { heightMm: 300, facadeMount: "overlay" },
      }).success,
    ).toBe(false);
  });

  it("не допускает несогласованный блок ящиков и неверную длину направляющей", () => {
    const config = validConfig();
    const section = config.sections[1]!;
    const invalidCount = {
      ...config,
      sections: config.sections.map((item) =>
        item.id === section.id
          ? {
              ...item,
              drawerBlock: {
                ...item.drawerBlock!,
                frontHeightsMm: [150, 250],
              },
            }
          : item,
      ),
    };
    expect(
      validateWardrobe(invalidCount).some((issue) =>
        issue.path.endsWith("drawerBlock.frontHeightsMm"),
      ),
    ).toBe(true);

    const invalidRunner = {
      ...config,
      sections: config.sections.map((item) =>
        item.id === section.id
          ? {
              ...item,
              drawerBlock: {
                ...item.drawerBlock!,
                runner: { ...item.drawerBlock!.runner, lengthMm: 600 as never },
              },
            }
          : item,
      ),
    };
    expect(safeParseConfig(invalidRunner).success).toBe(false);
  });

  it("выдвижная штанга требует допустимую глубину", () => {
    const base = defaultWardrobe();
    const invalid = {
      ...base,
      sections: base.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              rodType: "pullout" as const,
              pulloutRod: {
                lengthMm: 300 as const,
                execution: "wire" as const,
                loadClass: "budget" as const,
              },
            }
          : section,
      ),
    };
    expect(
      validateWardrobe(invalid).some((issue) => issue.path.endsWith("pulloutRod")),
    ).toBe(true);
    expect(
      validateWardrobe({
        ...invalid,
        fullDepth: 400,
      }).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  it("глубина корпуса выводится из полной глубины", () => {
    const base = defaultWardrobe();
    const shallow = wardrobeGeometry({ ...base, fullDepth: 400 });
    const deep = wardrobeGeometry({ ...base, fullDepth: 700 });
    expect(shallow.bodyDepthMm).toBe(400 - 16 - 3);
    expect(deep.bodyDepthMm).toBe(700 - 16 - 3);
    expect(shallow.bodyDepthMm).not.toBe(400);
  });

  it("drawerBlock не хранит независимый count", () => {
    const config = validConfig();
    const section = config.sections[1]!;
    expect(
      safeParseConfig({
        ...config,
        sections: config.sections.map((item) =>
          item.id === section.id
            ? { ...item, drawerBlock: { ...item.drawerBlock!, count: 3 } }
            : item,
        ),
      }).success,
    ).toBe(false);
  });
});
