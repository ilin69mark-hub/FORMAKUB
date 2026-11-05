import { describe, expect, it } from "vitest";
import {
  defaultDressingRoom,
  defaultKitchen,
  defaultWardrobe,
} from "./defaults";
import { safeParseConfig } from "./schema";
import {
  getFurnitureErrors,
  isConfigValid,
  validateConfig,
  validateKitchen,
  validateWardrobe,
} from "./validation";

describe("kitchen validation", () => {
  it("accepts the default kitchen", () => {
    const issues = validateKitchen(defaultKitchen());
    expect(isConfigValid(issues)).toBe(true);
    expect(getFurnitureErrors(issues)).toHaveLength(0);
  });

  it("allows tall modules to differ from the base row height", () => {
    const config = defaultKitchen();
    const tall = config.modules.find((module) => module.type === "tall");
    expect(tall?.height).toBe(220);
    expect(validateKitchen(config).some((issue) => issue.path === "modules")).toBe(false);
  });

  it("rejects mismatched heights in the base row", () => {
    const config = defaultKitchen();
    const modules = config.modules.map((module) =>
      module.type === "sink" ? { ...module, height: 85 } : module,
    );
    const issues = validateKitchen({ ...config, modules });

    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message.includes("Высота нижних модулей"),
      ),
    ).toBe(true);
  });

  it("rejects duplicate sinks", () => {
    const config = defaultKitchen();
    const sink = config.modules.find((module) => module.type === "sink");
    if (!sink) throw new Error("default kitchen must include a sink");
    const issues = validateKitchen({
      ...config,
      modules: [...config.modules, { ...sink, id: "m-sink-2" }],
    });

    expect(issues.some((issue) => issue.message.includes("один модуль под мойку"))).toBe(true);
  });

  it("rejects push-to-open with a protruding handle", () => {
    const issues = validateKitchen({
      ...defaultKitchen(),
      pushToOpen: true,
      handle: "bar",
    });

    expect(issues.some((issue) => issue.path === "handle")).toBe(true);
  });

  it("rejects a shaker glass facade", () => {
    const issues = validateKitchen({
      ...defaultKitchen(),
      facadeMaterial: "glass",
      facadeStyle: "shaker",
    });

    expect(issues.some((issue) => issue.path === "facadeStyle")).toBe(true);
  });

  it("allows a kitchen wider than the old 480 cm demo limit", () => {
    const config = defaultKitchen();
    const modules = config.modules.map((module) =>
      ["base", "sink", "hob", "drawers"].includes(module.type)
        ? { ...module, width: 150 }
        : module,
    );
    const issues = validateKitchen({
      ...config,
      modules: [
        ...modules,
        {
          id: "m-extra",
          type: "base",
          width: 150,
          height: 90,
          depth: 60,
          shelves: 0,
          drawers: 0,
        },
      ],
    });

    expect(issues.some((issue) => issue.message.includes("ширина кухни"))).toBe(false);
  });

  it("ships a kitchen with an LDSP + HPL 38 mm worktop and a 10 cm plinth", () => {
    const config = defaultKitchen();
    expect(config.countertop).toBe("ldsp_hpl");
    expect(config.countertopThickness).toBe(38);
    expect(config.plinthHeight).toBe(10);
  });
});

describe("wardrobe validation", () => {
  it("accepts the default wardrobe and dressing preset", () => {
    expect(isConfigValid(validateWardrobe(defaultWardrobe()))).toBe(true);
    expect(isConfigValid(validateWardrobe(defaultDressingRoom()))).toBe(true);
  });

  it("rejects shelves outside the carcass", () => {
    const config = defaultWardrobe();
    const sections = config.sections.map((section, index) =>
      index === 0 ? { ...section, shelves: [...section.shelves, 999] } : section,
    );
    const issues = validateWardrobe({ ...config, sections });

    expect(issues.some((issue) => issue.message.includes("пределах"))).toBe(true);
  });

  it("rejects drawers in a section narrower than 50 cm", () => {
    const config = defaultWardrobe();
    const sections = config.sections.map((section, index) =>
      index === 0 ? { ...section, width: 40, drawers: 2 } : section,
    );
    const issues = validateWardrobe({ ...config, sections });

    expect(issues.some((issue) => issue.message.includes("не меньше 50 см"))).toBe(true);
  });

  it("rejects a rod below the allowed height", () => {
    const config = defaultWardrobe();
    const sections = config.sections.map((section, index) =>
      index === 0 ? { ...section, rods: [10] } : section,
    );
    const issues = validateWardrobe({ ...config, sections });

    expect(issues.some((issue) => issue.message.includes("Штанга"))).toBe(true);
  });

  it("rejects a total width above the demo limit", () => {
    const config = defaultWardrobe();
    const sections = Array.from({ length: 5 }, (_, index) => ({
      id: `s-${index}`,
      width: 100,
      shelves: [],
      rods: [],
      drawers: 0,
    }));
    const issues = validateWardrobe({ ...config, sections });

    expect(issues.some((issue) => issue.message.includes("ширина шкафа"))).toBe(true);
  });
});

describe("config schema", () => {
  it("parses the defaults", () => {
    expect(safeParseConfig(defaultKitchen()).success).toBe(true);
    expect(safeParseConfig(defaultWardrobe()).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    const result = safeParseConfig({
      ...defaultKitchen(),
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid kind", () => {
    const result = safeParseConfig({
      ...defaultKitchen(),
      kind: "table",
    });
    expect(result.success).toBe(false);
  });

  it("runs the correct validator for each kind", () => {
    const issues = validateConfig(defaultWardrobe());
    expect(issues.every((issue) => typeof issue.message === "string")).toBe(true);
  });

  it("migrates legacy worktops and fills the new defaults", () => {
    const legacy = { ...defaultKitchen(), countertop: "laminate" } as Record<string, unknown>;
    delete legacy.countertopThickness;
    delete legacy.plinthHeight;

    const result = safeParseConfig(legacy);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data;
    if (data.kind !== "kitchen") throw new Error("kitchen expected");
    expect(data.countertop).toBe("compact_hpl");
    expect(data.countertopThickness).toBe(30);
    expect(data.plinthHeight).toBe(10);
  });
});
