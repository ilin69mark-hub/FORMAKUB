import { describe, expect, it } from "vitest";

import { HANDLES } from "@/content/catalog";

import { defaultKitchen, makeKitchenModule } from "./defaults";
import { isLegacyFacadeMaterial } from "./materials";
import { calculateKitchenPrice } from "./pricing";
import { safeParseConfig } from "./schema";
import type { KitchenConfig, PriceBreakdown, ValidationIssue } from "./types";
import { validateKitchen } from "./validation";

/**
 * Stage 9 / Block 3 — TG-H3 (ветки validation) и TG-H4.
 * Stage 9 / Block 4 — TG-H4 переработан в контракт A16-4: неизвестный
 * идентификатор даёт контролируемую ошибку, явно бесплатный `handle: "none"`.
 * Stage 9 / Block 7A.2 — Q-A17-2.3: материал без действующего тарифа
 * (исторические `veneer`/`glass`/`solid`) → тоже контролируемая ошибка,
 * а не 0 ₽; исторический тариф автоматически не подставляется.
 *
 * TG-H3: наиболее существенные ветки validation.ts, не покрытые dedicated-
 *        тестами (§6.3: 66 сайтов issue против 18 тестов). Каждая ветка
 *        проверяется на точное сообщение и на то, что issue выдан ровно один
 *        раз (защита и от потери, и от дублирования правила).
 * TG-H4 / A16-4: контракт legacy-помощников поиска тарифа
 *        (pricing.ts bodyRate/facadeRate/styleMultiplier/handleRate).
 *
 * Ожидаемые значения TG-H3 — тексты и диапазоны самих правил
 * (KITCHEN_LIMITS, пресеты KITCHEN_MODULES, F-VD-01), а не «то, что вернул
 * код»: сообщения воспроизводятся из опубликованных лимитов.
 *
 * Ожидаемые значения TG-H4 — контракт, а не наблюдение: неизвестный id
 * запрещён схемой (`schema.ts` `z.enum`) и даёт контролируемую ошибку;
 * материал без действующего тарифа даёт контролируемую ошибку с его id;
 * `handle: "none"` (реальная запись каталога со ставкой 0) продолжает
 * возвращать 0 ₽ штатным поиском. Источник правила — Q-A17-2.3 (Block 7A.2).
 */

function singleIssue(
  issues: ValidationIssue[],
  matcher: { path?: string; message: RegExp; severity?: ValidationIssue["severity"] },
): ValidationIssue {
  const matched = issues.filter(
    (issue) =>
      (matcher.path === undefined || issue.path === matcher.path) &&
      matcher.message.test(issue.message) &&
      (matcher.severity === undefined || issue.severity === matcher.severity),
  );
  expect(matched, `найдено ${matched.length}: ${JSON.stringify(issues)}`).toHaveLength(1);
  return matched[0]!;
}

function kitchen(modules: KitchenConfig["modules"]): KitchenConfig {
  return { ...defaultKitchen(), modules };
}

describe("TG-H3: существенные ветки validation.ts", () => {
  it("minModules: не меньше 2 модулей", () => {
    const issues = validateKitchen(
      kitchen([makeKitchenModule("base", { id: "m1", width: 80 })]),
    );
    const issue = singleIssue(issues, {
      path: "modules",
      message: /В кухне должно быть не меньше 2 модулей\./,
      severity: "error",
    });
    expect(issue.message).toBe("В кухне должно быть не меньше 2 модулей.");
  });

  it("maxModules: не больше 25 модулей", () => {
    const modules = Array.from({ length: 26 }, (_, index) =>
      makeKitchenModule(index % 2 === 0 ? "base" : "wall", { id: `m${index}`, width: 60 }),
    );
    const issues = validateKitchen(kitchen(modules));
    singleIssue(issues, {
      path: "modules",
      message: /В демо-конфигураторе доступно до 25 модулей\./,
      severity: "error",
    });
  });

  it("минимальная общая ширина: 80 см", () => {
    const issues = validateKitchen(
      kitchen([
        makeKitchenModule("base", { id: "m1", width: 60 }),
        makeKitchenModule("wall", { id: "m2", width: 60 }),
      ]),
    );
    singleIssue(issues, {
      path: "width",
      message: /Общая ширина кухни должна быть не меньше 80 см\./,
      severity: "error",
    });
  });

  it("в нижнем ряду должен остаться хотя бы один модуль", () => {
    const issues = validateKitchen(
      kitchen([
        makeKitchenModule("wall", { id: "u1", width: 60 }),
        makeKitchenModule("wall", { id: "u2", width: 60 }),
      ]),
    );
    singleIssue(issues, {
      path: "modules",
      message: /Нужен хотя бы один модуль нижнего ряда\./,
      severity: "error",
    });
  });

  it("максимум один модуль под варочную панель", () => {
    const issues = validateKitchen(
      kitchen([
        makeKitchenModule("base", { id: "m1", width: 60 }),
        makeKitchenModule("hob", { id: "m2", width: 60 }),
        makeKitchenModule("hob", { id: "m3", width: 60 }),
      ]),
    );
    singleIssue(issues, {
      path: "modules",
      message: /В демо-конфигураторе допускается один модуль под варочную панель\./,
      severity: "error",
    });
  });

  it("максимум один пенал под технику", () => {
    const issues = validateKitchen(
      kitchen([
        makeKitchenModule("base", { id: "m1", width: 60 }),
        makeKitchenModule("oven", { id: "m2", width: 60, height: 220 }),
        makeKitchenModule("oven", { id: "m3", width: 60, height: 220 }),
      ]),
    );
    singleIssue(issues, {
      path: "modules",
      message: /В демо-конфигураторе допускается один пенал под технику\./,
      severity: "error",
    });
  });

  it("не больше 5 полок в модуле", () => {
    const issues = validateKitchen(
      kitchen([
        makeKitchenModule("base", { id: "m1", width: 60, shelves: 6 }),
        makeKitchenModule("wall", { id: "m2", width: 60 }),
      ]),
    );
    singleIssue(issues, {
      path: "modules.m1.shelves",
      message: /Полок в модуле: от 0 до 5\./,
      severity: "error",
    });
  });

  it("в блоке ящиков от 2 до 4 ящиков (нижняя и верхняя границы)", () => {
    const tooFew = validateKitchen(
      kitchen([
        makeKitchenModule("drawers", { id: "d1", width: 60, drawers: 1 }),
        makeKitchenModule("wall", { id: "m2", width: 60 }),
      ]),
    );
    singleIssue(tooFew, {
      path: "modules.d1.drawers",
      message: /В блоке ящиков доступно от 2 до 4 ящиков\./,
      severity: "error",
    });

    const tooMany = validateKitchen(
      kitchen([
        makeKitchenModule("drawers", { id: "d1", width: 60, drawers: 5 }),
        makeKitchenModule("wall", { id: "m2", width: 60 }),
      ]),
    );
    singleIssue(tooMany, {
      path: "modules.d1.drawers",
      message: /В блоке ящиков доступно от 2 до 4 ящиков\./,
      severity: "error",
    });
  });

  it("ящики только в отдельном модуле «Блок ящиков»", () => {
    const issues = validateKitchen(
      kitchen([
        makeKitchenModule("base", { id: "m1", width: 60, drawers: 3 }),
        makeKitchenModule("wall", { id: "m2", width: 60 }),
      ]),
    );
    singleIssue(issues, {
      path: "modules.m1.drawers",
      message: /Выдвижные ящики доступны в отдельном модуле «Блок ящиков»\./,
      severity: "error",
    });
  });

  it("ширина, высота и глубина модуля ограничены диапазоном пресета", () => {
    const wide = validateKitchen(
      kitchen([
        makeKitchenModule("base", { id: "m1", width: 200 }),
        makeKitchenModule("wall", { id: "m2", width: 60 }),
      ]),
    );
    singleIssue(wide, {
      path: "modules.m1.width",
      message: /Ширина модуля «.+»: от \d+ до \d+ см\./,
      severity: "error",
    });

    const tall = validateKitchen(
      kitchen([
        makeKitchenModule("base", { id: "m1", width: 60, height: 100 }),
        makeKitchenModule("wall", { id: "m2", width: 60 }),
      ]),
    );
    singleIssue(tall, {
      path: "modules.m1.height",
      message: /Высота модуля «.+»: от \d+ до \d+ см\./,
      severity: "error",
    });

    const deep = validateKitchen(
      kitchen([
        makeKitchenModule("base", { id: "m1", width: 60, depth: 70 }),
        makeKitchenModule("wall", { id: "m2", width: 60 }),
      ]),
    );
    singleIssue(deep, {
      path: "modules.m1.depth",
      message: /Глубина модуля «.+»: от \d+ до \d+ см\./,
      severity: "error",
    });
  });

  it("накладная ручка несовместима с фасадами без ручек", () => {
    const issues = validateKitchen({
      ...defaultKitchen(),
      facadeStyle: "handleless",
      handle: "bar",
    });
    singleIssue(issues, {
      path: "handle",
      message:
        /Для фасадов без ручек подходит врезной профиль или push-to-open, а не накладная ручка\./,
      severity: "error",
    });
  });

  it("верхний ряд шире нижнего предупреждением, не ошибкой", () => {
    const issues = validateKitchen(
      kitchen([
        makeKitchenModule("base", { id: "m1", width: 60 }),
        makeKitchenModule("wall", { id: "u1", width: 100 }),
      ]),
    );
    const issue = singleIssue(issues, {
      path: "upper",
      message: /Верхний ряд шире нижнего\./,
      severity: "warning",
    });
    expect(issue.severity).toBe("warning");
    expect(
      issues.filter((item) => item.severity === "error").map((item) => item.message),
    ).toEqual([]);
  });
});

describe("TG-H4 / A16-4: контракт поиска тарифов в legacy-пути", () => {
  const legacyLine = (price: PriceBreakdown, label: string): number => {
    const line = price.lines.find((item) => item.label === label);
    if (!line) throw new Error(`нет строки ${label}`);
    return line.amount;
  };

  it("неизвестный идентификатор запрещён самой схемой конфигурации", () => {
    expect(
      safeParseConfig({
        ...defaultKitchen(),
        facadeMaterial: "ghost",
      }).success,
    ).toBe(false);
    expect(
      safeParseConfig({ ...defaultKitchen(), facadeStyle: "ghost" }).success,
    ).toBe(false);
    expect(
      safeParseConfig({ ...defaultKitchen(), handle: "ghost" }).success,
    ).toBe(false);
    // Действующие значения проходят.
    expect(safeParseConfig(defaultKitchen()).success).toBe(true);
  });

  it("неизвестный материал фасада → контролируемая ошибка, а не ставка 0", () => {
    const config = defaultKitchen();
    const known = calculateKitchenPrice(config);
    expect(legacyLine(known, "Фасады")).toBeGreaterThan(0);

    expect(() =>
      calculateKitchenPrice({
        ...config,
        facadeMaterial: "ghost" as unknown as KitchenConfig["facadeMaterial"],
      }),
    ).toThrow(/неизвестный facadeMaterial "ghost"/);
  });

  it("неизвестный стиль фасада → контролируемая ошибка, а не множитель 1", () => {
    const config = defaultKitchen();
    const flat = calculateKitchenPrice({ ...config, facadeStyle: "flat" });
    expect(legacyLine(flat, "Фасады")).toBeGreaterThan(0);

    expect(() =>
      calculateKitchenPrice({
        ...config,
        facadeStyle: "ghost" as unknown as KitchenConfig["facadeStyle"],
      }),
    ).toThrow(/неизвестный facadeStyle "ghost"/);
  });

  it("неизвестная ручка → контролируемая ошибка, а не ставка 0", () => {
    const config = defaultKitchen();
    expect(() =>
      calculateKitchenPrice({
        ...config,
        handle: "ghost" as unknown as KitchenConfig["handle"],
      }),
    ).toThrow(/неизвестный handle "ghost"/);
  });

  it("явно бесплатный вариант handle: \"none\" остаётся бесплатным", () => {
    const config = defaultKitchen();
    const none = calculateKitchenPrice({ ...config, handle: "none" });
    const bar = calculateKitchenPrice({ ...config, handle: "bar" });

    // «Без ручек» — реальная запись каталога с rate 0, поэтому расчёт
    // выполняется штатно, а разница с накладной ручкой кратна её тарифу.
    expect(HANDLES.find((item) => item.id === "none")?.rate).toBe(0);
    const barRate = HANDLES.find((item) => item.id === "bar")!.rate;
    const delta = legacyLine(bar, "Фурнитура") - legacyLine(none, "Фурнитура");
    expect(delta).toBeGreaterThan(0);
    expect(delta % barRate).toBe(0);
  });

  for (const material of ["veneer", "glass", "solid"] as const) {
    it(`${material} без действующего тарифа → контролируемая ошибка (Q-A17-2.3)`, () => {
      // Материал остаётся валидным для чтения старых проектов (схема +
      // предупреждение), но legacy-расчёт не возвращает 0 ₽ и не пропускает
      // фасады. Исторические тарифы 11 800 / 14 400 / 18 600 ₽/м² не
      // подставляются: ошибка возникает до любого умножения на ставку.
      expect(isLegacyFacadeMaterial(material)).toBe(true);
      expect(
        safeParseConfig({ ...defaultKitchen(), facadeMaterial: material }).success,
      ).toBe(true);
      expect(() =>
        calculateKitchenPrice({ ...defaultKitchen(), facadeMaterial: material }),
      ).toThrow(new RegExp(`нет действующего тарифа для facadeMaterial "${material}"`));
    });
  }

  it("действующие материалы продолжают считаться с прежними результатами", () => {
    for (const material of ["ldsp", "mdf", "mdf_pvc"] as const) {
      const price = calculateKitchenPrice({
        ...defaultKitchen(),
        facadeMaterial: material,
      });
      expect(legacyLine(price, "Фасады")).toBeGreaterThan(0);
      expect(price.total).toBeGreaterThan(0);
    }
  });
});
