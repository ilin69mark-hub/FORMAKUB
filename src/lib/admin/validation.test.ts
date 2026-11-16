import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importPriceItems } from "./import";
import type { ActorContext } from "./parameters";
import { validateDraftVersion, type ValidationIssue } from "./pricing";

const ACTOR: ActorContext = { actorId: "admin-1", actorRole: "calc-admin" };

let dir = "";

const versionsPath = (): string => path.join(dir, "pricing-versions.json");
const priceItemsPath = (): string => path.join(dir, "price-items.json");
const presetsPath = (): string => path.join(dir, "module-presets.json");
const auditPath = (): string => path.join(dir, "admin-audit-log.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-validation-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data), "utf8");
}

function bytes(file: string): string {
  return readFileSync(file, "utf8");
}

function codes(issues: ValidationIssue[], severity?: ValidationIssue["severity"]): string[] {
  return issues
    .filter((item) => severity === undefined || item.severity === severity)
    .map((item) => item.code);
}

function priceItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "kitchen.shelf",
    scope: "kitchen",
    label: "Полка (кухня)",
    unit: "RUB_PER_PCS",
    usage: "used",
    status: "active",
    editable: true,
    sourceRef: "src/content/pricing.ts:PRICING.kitchen.shelf",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "seed",
    ...overrides,
  };
}

function draftVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "price-demo-2026-01",
    label: "Draft",
    status: "draft",
    snapshot: [{ priceItemId: "kitchen.shelf", amount: 1100 }],
    rules: { rounding: 100, minOrder: 45000, complexityPerExtraModule: 0.02, complexityMax: 1.12 },
    promos: [],
    baseSchema: 1,
    createdAt: "2026-11-08T00:00:00.000Z",
    createdBy: "admin-1",
    ...overrides,
  };
}

describe("валидация draft (§8.3)", () => {
  it("валидный draft после импорта CA-T-208: passed, без ошибок; контрольный пример", async () => {
    await importPriceItems(ACTOR);

    const result = await validateDraftVersion();

    expect(result.scope).toBe("price");
    expect(result.targetId).toBe("price-demo-2026-01");
    expect(result.id).toMatch(/^[0-9a-f]{16}$/);
    expect(result.createdAt).toBeTruthy();
    // Контрольный пример: 0 ошибок; предупреждения §8.3 (35 preliminary —
    // опоры 8 + LED 27; 3 равенства ставок материалов: 9500×2, 29400×2,
    // МДФ эмаль/МДФ ПВХ 8400×2); info — 2 PARTIAL-ребра priceRef (R-15).
    expect(codes(result.issues, "error")).toEqual([]);
    expect(codes(result.issues, "warning").filter((code) => code === "preliminary_data").length).toBe(35);
    expect(codes(result.issues, "warning").filter((code) => code === "rate_equality").length).toBe(3);
    expect(codes(result.issues, "info").filter((code) => code === "price_ref_partial").length).toBe(2);
    expect(result.passed).toBe(true);
  });

  it("отсутствующий draft: passed=false, draft_not_found, ничего не создаётся", async () => {
    const result = await validateDraftVersion();

    expect(result.passed).toBe(false);
    expect(result.targetId).toBeNull();
    expect(codes(result.issues, "error")).toContain("draft_not_found");
    expect(() => bytes(versionsPath())).toThrow();
  });

  it("несколько draft: без id → отказ (не выбирается случайный); по id → валидация конкретной", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      draftVersion(),
      draftVersion({ id: "price-other", label: "Второй" }),
    ]);

    await expect(validateDraftVersion()).rejects.toThrow(/draft-версий/);

    const byId = await validateDraftVersion("price-other");
    expect(byId.targetId).toBe("price-other");
    expect(byId.passed).toBe(true);
    expect(codes(byId.issues, "error")).toEqual([]);
  });

  it("не-draft версия по id → not_draft (статус не меняется)", async () => {
    writeJson(versionsPath(), [
      {
        ...draftVersion(),
        id: "price-2026.10.9",
        status: "published",
        publishedAt: "2026-10-02T00:00:00.000Z",
        publishedBy: "seed",
      },
    ]);

    const result = await validateDraftVersion("price-2026.10.9");
    expect(result.passed).toBe(false);
    expect(codes(result.issues, "error")).toContain("not_draft");
  });

  it("отсутствующий snapshot: schema_invalid + snapshot_missing, passed=false", async () => {
    const version = draftVersion();
    delete (version as Record<string, unknown>).snapshot;
    writeJson(versionsPath(), [version]);

    const result = await validateDraftVersion();
    expect(result.passed).toBe(false);
    expect(codes(result.issues, "error")).toContain("snapshot_missing");
    expect(codes(result.issues, "error")).toContain("schema_invalid");
  });

  it("пустой snapshot: с пустой коллекцией ставок — валиден; с active∧used — ошибка полноты", async () => {
    writeJson(versionsPath(), [draftVersion({ snapshot: [] })]);
    writeJson(priceItemsPath(), []);

    const empty = await validateDraftVersion();
    expect(empty.passed).toBe(true);
    expect(empty.issues.filter((item) => item.severity === "error")).toEqual([]);

    writeJson(priceItemsPath(), [priceItem()]);
    const incomplete = await validateDraftVersion();
    expect(incomplete.passed).toBe(false);
    expect(codes(incomplete.issues, "error")).toContain("snapshot_incomplete");
  });

  it("некорректный PriceItem: неизвестный id в снимке → price_item_unknown; битая запись → price_item_invalid", async () => {
    writeJson(priceItemsPath(), [priceItem({ label: "" })]);
    writeJson(versionsPath(), [
      draftVersion({
        snapshot: [
          { priceItemId: "kitchen.shelf", amount: 1100 },
          { priceItemId: "ghost.item", amount: 10 },
        ],
      }),
    ]);

    const result = await validateDraftVersion();
    expect(result.passed).toBe(false);
    expect(codes(result.issues, "error")).toContain("price_item_unknown");
    expect(codes(result.issues, "error")).toContain("price_item_invalid");
  });

  it("недопустимый amount: отрицательная сумма и FACTOR вне [0.1, 10] → ошибки", async () => {
    writeJson(priceItemsPath(), [
      priceItem(),
      priceItem({
        id: "catalog.facadeStyle.flat.multiplier",
        unit: "FACTOR",
        sourceRef: "src/content/catalog.ts:FACADE_STYLES.flat.multiplier",
      }),
    ]);
    writeJson(versionsPath(), [
      draftVersion({
        snapshot: [
          { priceItemId: "kitchen.shelf", amount: -5 },
          { priceItemId: "catalog.facadeStyle.flat.multiplier", amount: 0.05 },
        ],
      }),
    ]);

    const result = await validateDraftVersion();
    expect(result.passed).toBe(false);
    expect(codes(result.issues, "error")).toContain("amount_negative");
    expect(codes(result.issues, "error")).toContain("amount_factor_range");
  });

  it("некорректная единица измерения: запись не проходит priceItemSchema → price_item_invalid с полем unit", async () => {
    writeJson(priceItemsPath(), [priceItem({ unit: "BOGUS_UNIT" })]);
    writeJson(versionsPath(), [draftVersion({ snapshot: [] })]);

    const result = await validateDraftVersion();
    expect(result.passed).toBe(false);
    const invalid = result.issues.find((item) => item.code === "price_item_invalid");
    expect(invalid?.path).toContain("unit");
    expect(invalid?.severity).toBe("error");
  });

  it("дублирующиеся PriceItem ID в снимке → snapshot_duplicate", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      draftVersion({
        snapshot: [
          { priceItemId: "kitchen.shelf", amount: 1100 },
          { priceItemId: "kitchen.shelf", amount: 1200 },
        ],
      }),
    ]);

    const result = await validateDraftVersion();
    expect(result.passed).toBe(false);
    expect(codes(result.issues, "error")).toContain("snapshot_duplicate");
  });

  it("некорректные rules: rounding/minOrder/complexityMax вне диапазонов §8.3 → rule_invalid", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      draftVersion({
        rules: { rounding: 0, minOrder: -1, complexityPerExtraModule: 0.02, complexityMax: 0.5 },
      }),
    ]);

    const result = await validateDraftVersion();
    expect(result.passed).toBe(false);
    const invalid = codes(result.issues, "error").filter((code) => code === "rule_invalid");
    expect(invalid.length).toBe(3);
    expect(result.issues.some((item) => item.path === "rules.rounding")).toBe(true);
    expect(result.issues.some((item) => item.path === "rules.minOrder")).toBe(true);
    expect(result.issues.some((item) => item.path === "rules.complexityMax")).toBe(true);
  });

  it("дублирующиеся rules: дубли ключей не сохраняются моделью JSON хранения (ограничение среды)", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    // Сырой файл с двумя ключами `rounding`: JSON.parse сохраняет последнее
    // значение — Storage Adapter не даёт обнаружить дубль без обхода чтения.
    writeFileSync(
      versionsPath(),
      JSON.stringify([draftVersion()]).replace('"rounding":100', '"rounding":500,"rounding":100'),
      "utf8",
    );

    const raw = JSON.parse(bytes(versionsPath())) as Array<{ rules: Record<string, number> }>;
    expect(Object.keys(raw[0]!.rules)).toContain("rounding");
    expect(raw[0]!.rules.rounding).toBe(100); // последнее значение выигрывает

    const result = await validateDraftVersion();
    // Валидация работает по фактически прочитанному значению (100 > 0 — ок);
    // обнаружение дубля ключей на уровне коллекции невозможно — зафиксировано
    // как ограничение среды хранения, не ошибка валидации.
    expect(result.passed).toBe(true);
    expect(codes(result.issues, "error")).not.toContain("rule_invalid");
  });

  it("некорректные promos: отрицательные value/minSubtotal и нарушение схемы → promo_invalid", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      draftVersion({
        promos: [
          { code: "NEG1", title: "t", description: "d", type: "percent", value: -5, minSubtotal: 0, appliesTo: "all", active: true, demo: true },
          { code: "BADDEMO", title: "t", description: "d", type: "fixed", value: 100, minSubtotal: 0, appliesTo: "all", active: true, demo: false },
        ],
      }),
    ]);

    const result = await validateDraftVersion();
    expect(result.passed).toBe(false);
    const invalid = codes(result.issues, "error").filter((code) => code === "promo_invalid");
    expect(invalid.length).toBeGreaterThanOrEqual(2);
    expect(result.issues.some((item) => item.path.includes("promos.NEG1.value"))).toBe(true);
  });

  it("дублирующиеся promos: повтор кода → promo_duplicate (§8.3)", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    const promo = {
      code: "DEMO10", title: "t", description: "d", type: "percent",
      value: 10, minSubtotal: 1000, appliesTo: "all", active: true, demo: true,
    };
    writeJson(versionsPath(), [draftVersion({ promos: [promo, { ...promo }] })]);

    const result = await validateDraftVersion();
    expect(result.passed).toBe(false);
    expect(codes(result.issues, "error")).toContain("promo_duplicate");
  });

  it("отсутствующие обязательные значения: пустой объект правил → 4 × rule_missing", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [draftVersion({ rules: {} })]);

    const result = await validateDraftVersion();
    expect(result.passed).toBe(false);
    expect(codes(result.issues, "error").filter((code) => code === "rule_missing").length).toBe(4);
  });

  it("PARTIAL priceRef: не скрывается, info, публикацию не блокирует (R-15)", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [draftVersion()]);

    const result = await validateDraftVersion();
    const partial = result.issues.filter((item) => item.code === "price_ref_partial");
    expect(partial.length).toBe(2); // два PARTIAL-ребра priceRef в карте CA-T-206
    expect(partial.every((item) => item.severity === "info")).toBe(true);
    expect(partial.every((item) => item.message.includes("PARTIAL"))).toBe(true);
    // НЕ объявляется разрешённым: passed не зависит от info.
    expect(result.passed).toBe(true);
  });

  it("unresolved priceRef: битая ссылка пресета → info price_ref_unresolved (R-15)", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [draftVersion()]);
    writeJson(presetsPath(), [
      { id: "base", family: "kitchen", priceRef: "no.such.price.item" },
    ]);

    const result = await validateDraftVersion();
    const unresolved = result.issues.filter((item) => item.code === "price_ref_unresolved");
    expect(unresolved.length).toBe(1);
    expect(unresolved[0]?.severity).toBe("info");
    expect(unresolved[0]?.message).toContain("no.such.price.item");
    expect(result.passed).toBe(true);
  });

  it("только предупреждения: passed=true при warnings и отсутствии errors", async () => {
    writeJson(priceItemsPath(), [
      priceItem({
        id: "lighting.strip.demo",
        sourceRef: "src/content/lighting.ts:LED_STRIPS.demo",
      }),
    ]);
    writeJson(versionsPath(), [
      draftVersion({ snapshot: [{ priceItemId: "lighting.strip.demo", amount: 780 }] }),
    ]);

    const result = await validateDraftVersion();
    expect(codes(result.issues, "error")).toEqual([]);
    expect(codes(result.issues, "warning")).toContain("preliminary_data");
    expect(result.passed).toBe(true);
  });

  it("блокирующие ошибки: passed=false при наличии errors", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      draftVersion({ snapshot: [{ priceItemId: "kitchen.shelf", amount: -1 }] }),
    ]);

    const result = await validateDraftVersion();
    expect(result.passed).toBe(false);
    expect(codes(result.issues, "error").length).toBeGreaterThan(0);
  });

  it("повторный запуск: passed и issues идентичны (id/createdAt — служебные)", async () => {
    await importPriceItems(ACTOR);

    const first = await validateDraftVersion();
    const second = await validateDraftVersion();

    expect(first.id).not.toBe(second.id);
    expect(first.passed).toBe(second.passed);
    expect(JSON.stringify(first.issues)).toBe(JSON.stringify(second.issues));
  });

  it("неизменность draft snapshot после валидации (байт-в-байт)", async () => {
    await importPriceItems(ACTOR);
    const before = bytes(versionsPath());

    await validateDraftVersion();
    await validateDraftVersion("price-demo-2026-01");

    expect(bytes(versionsPath())).toBe(before);
  });

  it("неизменность опубликованного snapshot после валидации", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [
      {
        ...draftVersion(),
        id: "price-2026.10.9",
        status: "published",
        publishedAt: "2026-10-02T00:00:00.000Z",
        publishedBy: "seed",
        snapshot: [{ priceItemId: "kitchen.shelf", amount: 999 }],
      },
      draftVersion(),
    ]);
    const before = bytes(versionsPath());

    await validateDraftVersion();

    expect(bytes(versionsPath())).toBe(before);
    const stored = JSON.parse(bytes(versionsPath())) as Array<{ status: string; snapshot: Array<{ amount: number }> }>;
    expect(stored.find((version) => version.status === "published")!.snapshot).toEqual([
      { priceItemId: "kitchen.shelf", amount: 999 },
    ]);
  });

  it("read-only: audit-события и другие побочные записи отсутствуют", async () => {
    writeJson(priceItemsPath(), [priceItem()]);
    writeJson(versionsPath(), [draftVersion({ label: "Другой" })]);

    const result = await validateDraftVersion();
    expect(result).toBeTruthy();

    expect(existsSync(auditPath())).toBe(false);
    // Перечень файлов каталога не изменился: только посевы.
    expect(readdirSync(dir).sort()).toEqual(["price-items.json", "pricing-versions.json"]);
  });
});
