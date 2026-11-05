import { describe, expect, it } from "vitest";

import { calculateKitchenPrice } from "./pricing";
import { computeSupports } from "./supports";
import { defaultKitchen, makeKitchenModule } from "./defaults";
import type { KitchenConfig, KitchenModule } from "./types";

function withModules(modules: KitchenModule[]): KitchenConfig {
  return { ...defaultKitchen(), modules };
}

describe("support plan", () => {
  it("places supports under load-bearing elements and scales with width", () => {
    const config = withModules([
      makeKitchenModule("base", { id: "a", width: 60 }),
      makeKitchenModule("base", { id: "b", width: 120 }),
    ]);
    const plan = computeSupports(config);
    const narrow = plan.modules.find((item) => item.moduleId === "a");
    const wide = plan.modules.find((item) => item.moduleId === "b");

    expect(narrow).toBeDefined();
    expect(wide).toBeDefined();
    if (!narrow || !wide) return;

    // Крайние опоры — под боковинами, с отступом системы (4 см).
    expect(narrow.positions).toHaveLength(2);
    expect(narrow.positions[0].kind).toBe("edge");
    expect(narrow.positions[0].x).toBe(4);
    expect(narrow.positions[1].x).toBe(56);

    // Широкий корпус получает промежуточные опоры (пролёт 60 см).
    expect(wide.positions.length).toBeGreaterThan(2);

    // Передний и задний ряд под каждым несущим элементом.
    expect(wide.front).toBe(wide.positions.length);
    expect(wide.back).toBe(wide.positions.length);
    expect(plan.legs).toBe(plan.frontLegs + plan.backLegs);
    expect(plan.legs).toBe(
      plan.modules.reduce((sum, item) => sum + item.positions.length * 2, 0),
    );
  });

  it("keeps supports for the sink and tall units but skips appliance modules", () => {
    const config = withModules([
      makeKitchenModule("sink", { id: "sink", width: 60 }),
      makeKitchenModule("base", { id: "own", ownSupports: true }),
      makeKitchenModule("wall", { id: "wall" }),
    ]);
    const plan = computeSupports(config);
    const sink = plan.modules.find((item) => item.moduleId === "sink");
    const own = plan.modules.find((item) => item.moduleId === "own");
    const wall = plan.modules.find((item) => item.moduleId === "wall");

    expect(sink?.legs).toBeGreaterThan(0);
    expect(own?.excluded).toBe(true);
    expect(own?.legs).toBe(0);
    expect(own?.reason).toContain("собственные");
    expect(wall?.excluded).toBe(true);
    expect(plan.legs).toBe(sink?.legs);
  });

  it("uses a separate method for tall units: extra supports and wall anchors", () => {
    const config = withModules([
      makeKitchenModule("tall", { id: "t", width: 120, height: 220 }),
    ]);
    const plan = computeSupports(config);
    const tall = plan.modules[0];

    expect(tall.positions.length).toBeGreaterThanOrEqual(3);
    expect(tall.positions.some((item) => item.kind === "tall-center")).toBe(true);
    // 220 см / шаг 120 см → 2 крепления к стене.
    expect(tall.anchors).toBe(2);
    expect(plan.anchors).toBe(2);
    expect(plan.costParts.anchors).toBeGreaterThan(0);
  });

  it("counts plinth clips from the actual supports and chosen fastening", () => {
    const base = withModules([makeKitchenModule("base", { id: "a" })]);

    const clips = computeSupports({ ...base, plinth: true, plinthMount: "clips" });
    expect(clips.clips).toBe(clips.frontLegs);
    expect(clips.screws).toBe(0);

    const hidden = computeSupports({ ...base, plinth: true, plinthMount: "hidden" });
    expect(hidden.clips).toBe(0);
    expect(hidden.screws).toBe(hidden.frontLegs * 2);

    const noPlinth = computeSupports({ ...base, plinth: false });
    expect(noPlinth.clips).toBe(0);
    expect(noPlinth.screws).toBe(0);
  });

  it("honours configured span and load instead of a fixed four-leg rule", () => {
    const wide = withModules([makeKitchenModule("base", { id: "a", width: 120 })]);
    const loose = computeSupports(wide);
    const tight = computeSupports({
      ...wide,
      supports: { systemId: "standard", maxSpanCm: 20, maxLoadKgPerLeg: 15 },
    });

    expect(tight.modules[0].positions.length).toBeGreaterThan(
      loose.modules[0].positions.length,
    );
    expect(tight.legs).toBeGreaterThan(loose.legs);
    expect(tight.cost).toBeGreaterThan(loose.cost);
  });

  it("feeds the same numbers into the price specification", () => {
    const config = withModules([
      makeKitchenModule("base", { id: "a", width: 100 }),
      makeKitchenModule("tall", { id: "t", width: 60, height: 220 }),
    ]);
    const plan = computeSupports(config);
    const price = calculateKitchenPrice(config);

    const legs = price.lines.find((line) => line.label === "Опоры (ножки)");
    expect(legs).toBeDefined();
    expect(legs?.amount).toBe(Math.round(plan.costParts.legs));
    expect(legs?.detail).toContain(`${plan.legs} шт.`);

    const anchors = price.lines.find(
      (line) => line.label === "Крепление пеналов к стене",
    );
    expect(anchors?.amount).toBe(Math.round(plan.costParts.anchors));

    const clips = price.lines.find((line) => line.label === "Клипсы цоколя");
    expect(clips?.amount).toBe(Math.round(plan.costParts.clips));
    expect(clips?.detail).toContain(`${plan.clips} шт.`);

    const plinth = price.lines.find((line) => line.label === "Цоколь");
    expect(plinth?.detail).toContain(`${plan.frontLegs} опорам`);
  });

  it("recalculates when module widths change", () => {
    const narrow = computeSupports(
      withModules([makeKitchenModule("base", { id: "a", width: 60 })]),
    );
    const wide = computeSupports(
      withModules([makeKitchenModule("base", { id: "a", width: 120 })]),
    );

    expect(wide.modules[0].positions.length).toBeGreaterThanOrEqual(
      narrow.modules[0].positions.length,
    );
    expect(wide.legs).not.toBe(narrow.legs);
  });
});
