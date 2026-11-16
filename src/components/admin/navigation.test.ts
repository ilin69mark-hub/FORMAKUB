import { describe, expect, it } from "vitest";

import {
  ADMIN_SECTIONS,
  findSectionBySlug,
  groupSections,
} from "./navigation";

describe("навигация Calculation Admin (CA-T-501)", () => {
  it("содержит базовые разделы ТЗ 00–10 и подразделы", () => {
    const indexes = new Set(ADMIN_SECTIONS.map((section) => section.index));
    for (let index = 0; index <= 10; index += 1) {
      expect(indexes.has(String(index).padStart(2, "0"))).toBe(true);
    }
    expect(findSectionBySlug("rules")?.index).toBe("06A");
    expect(findSectionBySlug("dashboard")).toBeUndefined();  });

  it("новые разделы админки присутствуют и не дублируют маршруты", () => {
    const ids = ADMIN_SECTIONS.map((section) => section.id);
    expect(ids).toEqual(
      expect.arrayContaining(["materials", "dataSources", "calculations"]),
    );
    const hrefs = ADMIN_SECTIONS.map((section) => section.href);
    const slugs = ADMIN_SECTIONS.map((section) => section.slug);
    expect(new Set(hrefs).size).toBe(ADMIN_SECTIONS.length);
    expect(new Set(slugs).size).toBe(ADMIN_SECTIONS.length);
    expect(hrefs.every((href) => href.startsWith("/admin"))).toBe(true);
    expect(ADMIN_SECTIONS[0].href).toBe("/admin");
  });

  it("маршрут разрешается по slug; неизвестный — undefined", () => {
    expect(findSectionBySlug(undefined)?.id).toBe("overview");
    expect(findSectionBySlug("prices")?.title).toBe("Цены и тарифы");
    expect(findSectionBySlug("calculations")?.href).toBe("/admin/calculations");
    expect(findSectionBySlug("unknown")).toBeUndefined();
  });

  it("группировка сохраняет порядок и не теряет разделы", () => {
    const groups = groupSections(ADMIN_SECTIONS);
    const flat = groups.flatMap((group) => group.sections);
    expect(flat).toEqual([...ADMIN_SECTIONS]);
    expect(groups.length).toBeGreaterThan(5);
    for (const group of groups) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.sections.length).toBeGreaterThan(0);
    }
  });

  it("для каждого раздела указана следующая задача", () => {
    expect(ADMIN_SECTIONS.every((section) => section.nextTask.length > 0)).toBe(
      true,
    );
  });
});
