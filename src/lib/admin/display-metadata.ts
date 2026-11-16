import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { adminAuditLogSchema } from "@/lib/server/audit";
import { getStorage } from "@/lib/server/storage";
import { SqliteStorage } from "@/lib/server/storage/sqlite-storage";
import { readCollection, readCollectionStatus } from "@/lib/server/store";

import type { ActorContext } from "./parameters";
import {
  catalogItemSchema,
  catalogKindSchema,
  referenceSourceSchema,
  type CatalogItem,
} from "./schema";

/**
 * CA-T-306D Phase 2 — DisplayMetadata storage.
 *
 * Логическая коллекция `display-metadata` в collection_state. Хранит
 * lineDefinitions + supports.preliminaryNote + pricing.disclaimer.
 * catalogLabels/source markers читаются из CatalogItem; fingerprint
 * вычисляется по полному DisplayMetadata и проверяется при чтении.
 */

export const DISPLAY_METADATA_COLLECTION = "display-metadata";
export const AUDIT_COLLECTION = "admin-audit-log.json";

export {
  DISPLAY_LINE_IDS,
  type DetailCondition,
  type DetailSegment,
  type DetailUnit,
  type DisplayGroup,
  type DisplayLineId,
  type DisplayMetadata,
  type LineDefinitions,
  type LineDisplayDefinition,
  type NumberFormat,
  type ReferenceSource,
} from "@/lib/configurator/display-metadata";

import {
  DISPLAY_LINE_IDS,
  type DetailCondition,
  type DetailSegment,
  type DetailUnit,
  type DisplayLineId,
  type DisplayMetadata,
  type LineDefinitions,
  type NumberFormat,
  type ReferenceSource,
} from "@/lib/configurator/display-metadata";

export const SUPPORTS_PRELIMINARY_NOTE =
  "Количества опор — предварительный расчёт. Итоговые характеристики опор и допустимые нагрузки подтверждаются паспортными данными выбранной системы фурнитуры.";

export const PRICING_DISCLAIMER =
  "Предварительный расчёт. Итоговая стоимость будет подтверждена после проверки размеров, материалов, комплектации и технических условий менеджером.";

/* ─── Закрытые правила полей по line ID ─── */

const FIELDS: Record<
  DisplayLineId,
  { numeric: string[]; string: string[]; boolean: string[] }
> = {
  "kitchen.base": { numeric: [], string: [], boolean: [] },
  "kitchen.body": { numeric: ["moduleCount"], string: ["bodyMaterialId"], boolean: [] },
  "kitchen.fronts": { numeric: ["doors", "drawers"], string: [], boolean: [] },
  "kitchen.fittings": { numeric: [], string: [], boolean: ["pushToOpen"] },
  "kitchen.options": { numeric: ["countertopMeters", "shelves"], string: [], boolean: [] },
  "kitchen.pushToOpen": { numeric: [], string: [], boolean: [] },
  "kitchen.plinth": {
    numeric: ["lengthM", "thicknessMm", "supportClips", "supportFrontLegs"],
    string: ["plinthMaterialId", "plinthMountId"], boolean: [],
  },
  "kitchen.supports": {
    numeric: ["legs", "frontLegs", "backLegs"],
    string: ["supportSystemId"], boolean: [],
  },
  "kitchen.supportClips": { numeric: ["clips"], string: [], boolean: [] },
  "kitchen.supportScrews": { numeric: ["screws"], string: [], boolean: [] },
  "kitchen.supportAnchors": {
    numeric: ["anchors", "tallAnchorSpacingCm"], string: [], boolean: [],
  },
  "kitchen.lighting": {
    numeric: ["lengthM", "powerPerMeter", "voltage", "colorTemp", "psuW"],
    string: [], boolean: [],
  },
  "kitchen.lighting.strip": {
    numeric: ["lengthM", "powerPerMeter", "voltage"], string: [], boolean: [],
  },
  "kitchen.lighting.profile": {
    numeric: ["quantityM"], string: ["profileId"], boolean: [],
  },
  "kitchen.lighting.diffuser": {
    numeric: ["quantityM"], string: ["diffuserId"], boolean: [],
  },
  "kitchen.lighting.endCaps": { numeric: ["endCaps"], string: [], boolean: [] },
  "kitchen.lighting.connectors": { numeric: ["connectors"], string: [], boolean: [] },
  "kitchen.lighting.psu": { numeric: ["psuW", "psuCount"], string: [], boolean: [] },
  "kitchen.lighting.control": { numeric: [], string: ["controlId"], boolean: [] },
  "kitchen.lighting.install": { numeric: ["quantityM"], string: [], boolean: [] },
  "kitchen.supportPreliminary": { numeric: [], string: [], boolean: [] },
  "kitchen.sidePanels": { numeric: ["count"], string: [], boolean: [] },
  "kitchen.complexity": { numeric: ["factor"], string: [], boolean: [] },
  "kitchen.minOrder": { numeric: [], string: [], boolean: [] },
  "wardrobe.base": { numeric: [], string: [], boolean: [] },
  "wardrobe.body": { numeric: ["totalArea"], string: ["bodyMaterialId"], boolean: [] },
  "wardrobe.fronts": { numeric: ["doors"], string: ["facadeMaterialId"], boolean: [] },
  "wardrobe.fittings": {
    numeric: ["doors", "drawers"], string: [], boolean: ["softClose"],
  },
  "wardrobe.options": {
    numeric: ["shelves", "rods"], string: [], boolean: ["ledLighting"],
  },
  "wardrobe.led": { numeric: ["sections"], string: [], boolean: [] },
  "wardrobe.plinth": { numeric: ["widthCm"], string: [], boolean: [] },
  "wardrobe.pushToOpen": { numeric: [], string: [], boolean: [] },
  "wardrobe.minOrder": { numeric: [], string: [], boolean: [] },
};

const CATALOG_FIELDS: Partial<
  Record<CatalogItem["catalog"], { field: string; idField: string }>
> = {
  bodyMaterial: { field: "bodyMaterialId", idField: "bodyMaterialId" },
  facadeMaterial: { field: "facadeMaterialId", idField: "facadeMaterialId" },
  plinthMaterial: { field: "plinthMaterialId", idField: "plinthMaterialId" },
  plinthMount: { field: "plinthMountId", idField: "plinthMountId" },
  supportSystem: { field: "supportSystemId", idField: "supportSystemId" },
  ledProfile: { field: "profileId", idField: "profileId" },
  ledDiffuser: { field: "diffuserId", idField: "diffuserId" },
  ledControl: { field: "controlId", idField: "controlId" },
};

/* ─── Zod schemas ─── */

const numberFormatSchema = z.enum(["integer", "fixed1", "fixed2", "raw"]);
const unitSchema = z.enum([
  "м", "мм", "м²", "шт.", "Вт", "Вт/м", "В", "K",
  "модул.", "фасад.", "ящ.", "двер.", "секц.", "полок", "штанг",
]);
const conditionSchema = z.strictObject({
  field: z.string().min(1),
  op: z.enum(["eq", "gt", "gte"]),
  value: z.union([z.number().finite(), z.boolean()]),
});

const detailSegmentSchema: z.ZodType<DetailSegment> = z.lazy(() =>
  z.union([
    z.strictObject({ kind: z.literal("literal"), text: z.string() }),
    z.strictObject({
      kind: z.literal("number"),
      field: z.string().min(1),
      format: numberFormatSchema,
    }),
    z.strictObject({
      kind: z.literal("numberWithUnit"),
      field: z.string().min(1),
      format: numberFormatSchema,
      unit: unitSchema,
      conversion: z.literal("cm-to-m").optional(),
    }),
    z.strictObject({
      kind: z.literal("catalogLabel"),
      catalog: catalogKindSchema,
      idField: z.string().min(1),
    }),
    z.strictObject({
      kind: z.literal("booleanLabel"),
      field: z.string().min(1),
      whenTrue: z.string(),
      whenFalse: z.string(),
    }),
    z.strictObject({
      kind: z.literal("conditional"),
      when: conditionSchema,
      then: z.array(z.lazy(() => detailSegmentSchema)),
      otherwise: z.array(z.lazy(() => detailSegmentSchema)).optional(),
    }),
  ]),
);

const lineDefinitionSchema = z.strictObject({
  id: z.enum(DISPLAY_LINE_IDS),
  label: z.string().min(1),
  group: z.enum(["base", "cost", "options", "lighting", "adjustments"]),
  order: z.number().int(),
  detailSegments: z.array(detailSegmentSchema),
});

export const lineDefinitionsSchema = z
  .record(z.string(), lineDefinitionSchema)
  .superRefine((definitions, ctx) => {
    const expected = new Set<string>(DISPLAY_LINE_IDS);
    for (const key of Object.keys(definitions)) {
      if (!expected.has(key)) {
        ctx.addIssue({ code: "custom", path: [key], message: "неизвестный line ID" });
      }
    }
    for (const id of DISPLAY_LINE_IDS) {
      const definition = definitions[id];
      if (!definition) {
        ctx.addIssue({ code: "custom", path: [id], message: "lineDefinition отсутствует" });
      } else if (definition.id !== id) {
        ctx.addIssue({ code: "custom", path: [id, "id"], message: "id не совпадает с ключом" });
      }
    }
  });

const baseRecord = {
  version: z.string().min(1),
  updatedAt: z.string().datetime({ offset: true }),
  updatedBy: z.string().min(1),
};

const lineDefinitionsRecordSchema = z.strictObject({
  id: z.literal("lineDefinitions"),
  kind: z.literal("line-definitions"),
  value: lineDefinitionsSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  ...baseRecord,
});

const textRecordSchema = z.strictObject({
  id: z.enum(["supports.preliminaryNote", "pricing.disclaimer"]),
  kind: z.literal("text"),
  value: z.string().min(1),
  ...baseRecord,
});

export const displayMetadataRecordSchema = z.union([
  lineDefinitionsRecordSchema,
  textRecordSchema,
]);
export type DisplayMetadataRecord = z.infer<typeof displayMetadataRecordSchema>;

/* ─── Валидация сегментов и fingerprints ─── */

function validateCondition(
  lineId: DisplayLineId,
  condition: DetailCondition,
  path: string,
  issues: string[],
): void {
  const fields = FIELDS[lineId];
  if (fields.numeric.includes(condition.field)) {
    if (typeof condition.value !== "number") {
      issues.push(`${path}: numeric condition требует number`);
    }
  } else if (fields.boolean.includes(condition.field)) {
    if (condition.op !== "eq" || typeof condition.value !== "boolean") {
      issues.push(`${path}: boolean condition допускает только eq + boolean`);
    }
  } else {
    issues.push(`${path}: поле "${condition.field}" не принадлежит ${lineId}`);
  }
}

function validateSegments(
  lineId: DisplayLineId,
  segments: readonly DetailSegment[],
  path: string,
  issues: string[],
): void {
  const fields = FIELDS[lineId];
  segments.forEach((segment, index) => {
    const at = `${path}[${index}]`;
    switch (segment.kind) {
      case "literal":
        return;
      case "number":
        if (!fields.numeric.includes(segment.field)) {
          issues.push(`${at}.field: "${segment.field}" не принадлежит ${lineId}`);
        }
        return;
      case "numberWithUnit":
        if (!fields.numeric.includes(segment.field)) {
          issues.push(`${at}.field: "${segment.field}" не принадлежит ${lineId}`);
        }
        if (segment.conversion !== undefined) {
          if (
            lineId !== "wardrobe.plinth" ||
            segment.field !== "widthCm" ||
            segment.format !== "fixed1" ||
            segment.unit !== "м"
          ) {
            issues.push(
              `${at}: cm-to-m разрешён только для wardrobe.plinth.widthCm/fixed1/м`,
            );
          }
        }
        return;
      case "catalogLabel": {
        const mapping = CATALOG_FIELDS[segment.catalog];
        if (!mapping || mapping.idField !== segment.idField) {
          issues.push(`${at}: catalog/idField не соответствуют друг другу`);
        } else if (!fields.string.includes(segment.idField)) {
          issues.push(`${at}.idField: "${segment.idField}" не принадлежит ${lineId}`);
        }
        return;
      }
      case "booleanLabel":
        if (!fields.boolean.includes(segment.field)) {
          issues.push(`${at}.field: "${segment.field}" не принадлежит ${lineId}`);
        }
        return;
      case "conditional":
        validateCondition(lineId, segment.when, `${at}.when`, issues);
        validateSegments(lineId, segment.then, `${at}.then`, issues);
        if (segment.otherwise) {
          validateSegments(lineId, segment.otherwise, `${at}.otherwise`, issues);
        }
        return;
    }
  });
}

export function validateLineDefinitions(definitions: LineDefinitions): string[] {
  const issues: string[] = [];
  for (const id of DISPLAY_LINE_IDS) {
    const definition = definitions[id];
    validateSegments(id, definition.detailSegments, `lineDefinitions.${id}.detailSegments`, issues);
  }
  return issues;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeDisplayMetadataFingerprint(
  metadata: Omit<DisplayMetadata, "fingerprint">,
): string {
  return createHash("sha256").update(canonical(metadata)).digest("hex");
}

/**
 * CA-GL-24: отпечаток **персистентного** содержимого Display Metadata.
 *
 * В него входят только редактируемые и сохраняемые поля
 * (`lineDefinitions`, `supportsPreliminaryNote`, `disclaimer`).
 * `catalogLabels`/`*Source` вычисляются из каталога при чтении и в отпечаток
 * не входят: изменение названия материала или добавление CatalogItem не должно
 * делать метаданные недоступными.
 *
 * Legacy-отпечаток (`computeDisplayMetadataFingerprint`, включая каталог)
 * по-прежнему принимается при чтении существующих записей.
 */
export function computePersistedMetadataFingerprint(input: {
  lineDefinitions: LineDefinitions;
  supportsPreliminaryNote: string;
  disclaimer: string;
}): string {
  return createHash("sha256")
    .update(
      canonical({
        lineDefinitions: input.lineDefinitions,
        supportsPreliminaryNote: input.supportsPreliminaryNote,
        disclaimer: input.disclaimer,
      }),
    )
    .digest("hex");
}

/* ─── Seed definitions ─── */

const literal = (text: string): DetailSegment => ({ kind: "literal", text });
const number = (field: string, format: NumberFormat = "integer"): DetailSegment => ({
  kind: "number",
  field,
  format,
});
const numberUnit = (
  field: string,
  format: NumberFormat,
  unit: DetailUnit,
  conversion?: "cm-to-m",
): DetailSegment => ({
  kind: "numberWithUnit",
  field,
  format,
  unit,
  ...(conversion ? { conversion } : {}),
});
const label = (
  catalog: CatalogItem["catalog"],
  idField: string,
): DetailSegment => ({ kind: "catalogLabel", catalog, idField });

export const DISPLAY_METADATA_SEED: LineDefinitions = {
  "kitchen.base": {
    id: "kitchen.base", label: "Основа проекта", group: "base", order: 10,
    detailSegments: [literal("Проектирование, раскрой и организация заказа")],
  },
  "kitchen.body": {
    id: "kitchen.body", label: "Корпус", group: "cost", order: 20,
    detailSegments: [number("moduleCount"), literal(" модул. · "), label("bodyMaterial", "bodyMaterialId")],
  },
  "kitchen.fronts": {
    id: "kitchen.fronts", label: "Фасады", group: "cost", order: 30,
    detailSegments: [number("doors"), literal(" фасад. · "), number("drawers"), literal(" ящ.")],
  },
  "kitchen.fittings": {
    id: "kitchen.fittings", label: "Фурнитура", group: "cost", order: 40,
    detailSegments: [
      literal("Петли, направляющие, ручки"),
      { kind: "conditional", when: { field: "pushToOpen", op: "eq", value: true }, then: [literal(", push-to-open")] },
    ],
  },
  "kitchen.options": {
    id: "kitchen.options", label: "Столешница, цоколь и опции", group: "cost", order: 50,
    detailSegments: [numberUnit("countertopMeters", "fixed1", "м"), literal(" столешницы · "), number("shelves"), literal(" полок")],
  },
  "kitchen.pushToOpen": {
    id: "kitchen.pushToOpen", label: "Push-to-open", group: "options", order: 60,
    detailSegments: [literal("Учтено в фурнитуре")],
  },
  "kitchen.plinth": {
    id: "kitchen.plinth", label: "Цоколь", group: "options", order: 70,
    detailSegments: [
      numberUnit("lengthM", "fixed1", "м"), literal(" · "),
      label("plinthMaterial", "plinthMaterialId"), literal(" "),
      number("thicknessMm", "raw"), literal(" мм · "),
      label("plinthMount", "plinthMountId"),
      {
        kind: "conditional",
        when: { field: "supportClips", op: "gt", value: 0 },
        then: [literal(" · "), number("supportClips"), literal(" клипс к "), number("supportFrontLegs"), literal(" опорам")],
      },
    ],
  },
  "kitchen.supports": {
    id: "kitchen.supports", label: "Опоры (ножки)", group: "options", order: 80,
    detailSegments: [
      number("legs"), literal(" шт. · "), number("frontLegs"), literal(" спереди, "),
      number("backLegs"), literal(" сзади · "), label("supportSystem", "supportSystemId"),
    ],
  },
  "kitchen.supportClips": {
    id: "kitchen.supportClips", label: "Клипсы цоколя", group: "options", order: 90,
    detailSegments: [number("clips"), literal(" шт. к фактическим опорам нижнего ряда")],
  },
  "kitchen.supportScrews": {
    id: "kitchen.supportScrews", label: "Винты скрытого крепления цоколя", group: "options", order: 100,
    detailSegments: [number("screws"), literal(" шт. к опорам нижнего ряда")],
  },
  "kitchen.supportAnchors": {
    id: "kitchen.supportAnchors", label: "Крепление пеналов к стене", group: "options", order: 110,
    detailSegments: [number("anchors"), literal(" шт. от "), number("tallAnchorSpacingCm"), literal(" см шага")],
  },
  "kitchen.lighting": {
    id: "kitchen.lighting", label: "Подсветка верхнего ряда", group: "lighting", order: 120,
    detailSegments: [
      number("lengthM", "raw"), literal(" м · "), number("powerPerMeter", "raw"),
      literal(" Вт/м · "), number("voltage"), literal(" В · "),
      number("colorTemp"), literal(" K · "), number("psuW"), literal(" Вт БП"),
    ],
  },
  "kitchen.lighting.strip": {
    id: "kitchen.lighting.strip", label: "— Светодиодная лента", group: "lighting", order: 130,
    detailSegments: [number("lengthM", "raw"), literal(" м · "), number("powerPerMeter", "raw"), literal(" Вт/м · "), number("voltage"), literal(" В")],
  },
  "kitchen.lighting.profile": {
    id: "kitchen.lighting.profile", label: "— Профиль", group: "lighting", order: 140,
    detailSegments: [number("quantityM", "raw"), literal(" м · "), label("ledProfile", "profileId")],
  },
  "kitchen.lighting.diffuser": {
    id: "kitchen.lighting.diffuser", label: "— Рассеиватель", group: "lighting", order: 150,
    detailSegments: [number("quantityM", "raw"), literal(" м · "), label("ledDiffuser", "diffuserId")],
  },
  "kitchen.lighting.endCaps": {
    id: "kitchen.lighting.endCaps", label: "— Заглушки профиля", group: "lighting", order: 160,
    detailSegments: [number("endCaps"), literal(" шт. · по 2 шт. на каждый шкаф")],
  },
  "kitchen.lighting.connectors": {
    id: "kitchen.lighting.connectors", label: "— Соединители", group: "lighting", order: 170,
    detailSegments: [number("connectors"), literal(" шт. · стыки профилей и подключения к блоку питания")],
  },
  "kitchen.lighting.psu": {
    id: "kitchen.lighting.psu", label: "— Блок питания", group: "lighting", order: 180,
    detailSegments: [
      number("psuCount"), literal(" шт. · "), number("psuW"), literal(" Вт"),
      {
        kind: "conditional",
        when: { field: "psuCount", op: "gt", value: 1 },
        then: [literal(" · "), number("psuCount"), literal(" шт.")],
      },
    ],
  },
  "kitchen.lighting.control": {
    id: "kitchen.lighting.control", label: "— Управление", group: "lighting", order: 190,
    detailSegments: [literal("1 шт. · "), label("ledControl", "controlId")],
  },
  "kitchen.lighting.install": {
    id: "kitchen.lighting.install", label: "— Монтаж подсветки", group: "lighting", order: 200,
    detailSegments: [number("quantityM", "raw"), literal(" м · профиль, лента и электрика под верхним рядом")],
  },
  "kitchen.supportPreliminary": {
    id: "kitchen.supportPreliminary", label: "Опоры: предварительный расчёт", group: "adjustments", order: 210,
    detailSegments: [literal(SUPPORTS_PRELIMINARY_NOTE)],
  },
  "kitchen.sidePanels": {
    id: "kitchen.sidePanels", label: "Декоративные боковины", group: "adjustments", order: 220,
    detailSegments: [number("count"), literal(" шт. учтены в опциях")],
  },
  "kitchen.complexity": {
    id: "kitchen.complexity", label: "Сложность конфигурации", group: "adjustments", order: 230,
    detailSegments: [literal("Коэффициент ×"), number("factor", "fixed2")],
  },
  "kitchen.minOrder": {
    id: "kitchen.minOrder", label: "Минимальная стоимость заказа", group: "adjustments", order: 240,
    detailSegments: [literal("Расчёт доведён до минимальной суммы")],
  },
  "wardrobe.base": {
    id: "wardrobe.base", label: "Основа проекта", group: "base", order: 10,
    detailSegments: [literal("Проектирование, раскрой и организация заказа")],
  },
  "wardrobe.body": {
    id: "wardrobe.body", label: "Корпус", group: "cost", order: 20,
    detailSegments: [numberUnit("totalArea", "fixed2", "м²"), literal(" · "), label("bodyMaterial", "bodyMaterialId")],
  },
  "wardrobe.fronts": {
    id: "wardrobe.fronts", label: "Фасады", group: "cost", order: 30,
    detailSegments: [number("doors"), literal(" фасад. · "), label("facadeMaterial", "facadeMaterialId")],
  },
  "wardrobe.fittings": {
    id: "wardrobe.fittings", label: "Фурнитура", group: "cost", order: 40,
    detailSegments: [
      number("doors"), literal(" двер. · "), number("drawers"), literal(" ящ. · "),
      { kind: "booleanLabel", field: "softClose", whenTrue: "доводчики", whenFalse: "без доводчиков" },
    ],
  },
  "wardrobe.options": {
    id: "wardrobe.options", label: "Наполнение и опции", group: "cost", order: 50,
    detailSegments: [
      number("shelves"), literal(" полок · "), number("rods"), literal(" штанг · "),
      { kind: "booleanLabel", field: "ledLighting", whenTrue: "LED-подсветка", whenFalse: "без подсветки" },
    ],
  },
  "wardrobe.led": {
    id: "wardrobe.led", label: "LED-подсветка", group: "options", order: 60,
    detailSegments: [number("sections"), literal(" секц. учтены в опциях")],
  },
  "wardrobe.plinth": {
    id: "wardrobe.plinth", label: "Цоколь", group: "options", order: 70,
    detailSegments: [numberUnit("widthCm", "fixed1", "м", "cm-to-m"), literal(" учтено в опциях")],
  },
  "wardrobe.pushToOpen": {
    id: "wardrobe.pushToOpen", label: "Push-to-open", group: "adjustments", order: 80,
    detailSegments: [literal("Учтено в фурнитуре")],
  },
  "wardrobe.minOrder": {
    id: "wardrobe.minOrder", label: "Минимальная стоимость заказа", group: "adjustments", order: 90,
    detailSegments: [literal("Расчёт доведён до минимальной суммы")],
  },
};

/* ─── Storage / resolver ─── */

function emptyCatalogLabels(): Record<CatalogItem["catalog"], Record<string, string>> {
  const out = {} as Record<CatalogItem["catalog"], Record<string, string>>;
  for (const kind of catalogKindSchema.options) out[kind] = {};
  return out;
}

async function readCatalogItems(): Promise<CatalogItem[]> {
  const read = await readCollectionStatus<unknown>("catalog-items.json");
  if (read.status !== "ok") {
    throw new Error(`DisplayMetadata: catalog-items ${read.status === "corrupt" ? "повреждены" : "отсутствуют"}.`);
  }
  return read.items.map((raw) => {
    const parsed = catalogItemSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`DisplayMetadata: CatalogItem невалиден: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}

function buildCatalogMetadata(catalogs: readonly CatalogItem[]): {
  catalogLabels: Record<CatalogItem["catalog"], Record<string, string>>;
  supportSystemSource: Record<string, ReferenceSource>;
  ledStripSource: Record<string, ReferenceSource>;
} {
  const catalogLabels = emptyCatalogLabels();
  const supportSystemSource: Record<string, ReferenceSource> = {};
  const ledStripSource: Record<string, ReferenceSource> = {};
  for (const item of catalogs) {
    catalogLabels[item.catalog][item.id] = item.label;
    if (item.catalog === "supportSystem" || item.catalog === "ledStrip") {
      const source = referenceSourceSchema.safeParse(item.attrs.source);
      if (!source.success) {
        throw new Error(
          `DisplayMetadata: ${item.catalog}:${item.id} не имеет валидного attrs.source.`,
        );
      }
      (item.catalog === "supportSystem" ? supportSystemSource : ledStripSource)[item.id] = source.data;
    }
  }
  return { catalogLabels, supportSystemSource, ledStripSource };
}

function readRecords(raw: unknown[]): {
  lineDefinitions: LineDefinitions;
  fingerprint: string;
  supportsPreliminaryNote: string;
  disclaimer: string;
  versions: Record<string, string>;
} {
  let lineDefinitions: LineDefinitions | undefined;
  let fingerprint: string | undefined;
  let supportsPreliminaryNote: string | undefined;
  let disclaimer: string | undefined;
  const versions: Record<string, string> = {};

  for (const value of raw) {
    const parsed = displayMetadataRecordSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`DisplayMetadata: запись невалидна: ${parsed.error.message}`);
    }
    const record = parsed.data;
    if (record.kind === "line-definitions") {
      if (lineDefinitions) throw new Error("DisplayMetadata: дубликат lineDefinitions.");
      lineDefinitions = record.value as LineDefinitions;
      fingerprint = record.fingerprint;
    } else if (record.id === "supports.preliminaryNote") {
      if (supportsPreliminaryNote !== undefined) throw new Error("DisplayMetadata: дубликат preliminaryNote.");
      supportsPreliminaryNote = record.value;
    } else {
      if (disclaimer !== undefined) throw new Error("DisplayMetadata: дубликат disclaimer.");
      disclaimer = record.value;
    }
    versions[record.id] = record.version;
  }
  if (!lineDefinitions || !fingerprint || !supportsPreliminaryNote || !disclaimer) {
    throw new Error("DisplayMetadata: неполный набор записей.");
  }
  return { lineDefinitions, fingerprint, supportsPreliminaryNote, disclaimer, versions };
}

function fullMetadata(
  records: ReturnType<typeof readRecords>,
  catalogs: readonly CatalogItem[],
): DisplayMetadata {
  const catalog = buildCatalogMetadata(catalogs);
  const withoutFingerprint = {
    lineDefinitions: records.lineDefinitions,
    catalogLabels: catalog.catalogLabels,
    supportSystemSource: catalog.supportSystemSource,
    ledStripSource: catalog.ledStripSource,
    supportsPreliminaryNote: records.supportsPreliminaryNote,
    disclaimer: records.disclaimer,
  };
  return {
    ...withoutFingerprint,
    fingerprint: records.fingerprint,
  };
}

/**
 * Проверка целостности: принимается новый (персистентный) или legacy
 * (включающий каталог) отпечаток. Любое иное значение — повреждение.
 */
function fingerprintValid(
  records: ReturnType<typeof readRecords>,
  catalogs: readonly CatalogItem[],
): boolean {
  const persisted = computePersistedMetadataFingerprint({
    lineDefinitions: records.lineDefinitions,
    supportsPreliminaryNote: records.supportsPreliminaryNote,
    disclaimer: records.disclaimer,
  });
  if (persisted === records.fingerprint) return true;
  const legacy = computeDisplayMetadataFingerprint({
    lineDefinitions: records.lineDefinitions,
    ...buildCatalogMetadata(catalogs),
    supportsPreliminaryNote: records.supportsPreliminaryNote,
    disclaimer: records.disclaimer,
  });
  return legacy === records.fingerprint;
}

export async function readDisplayMetadata(): Promise<DisplayMetadata> {
  const read = await readCollectionStatus<unknown>(DISPLAY_METADATA_COLLECTION);
  if (read.status !== "ok") {
    throw new Error(`DisplayMetadata: коллекция ${read.status === "corrupt" ? "повреждена" : "отсутствует"}.`);
  }
  const records = readRecords(read.items);
  const catalogs = await readCatalogItems();
  if (!fingerprintValid(records, catalogs)) {
    throw new Error("DisplayMetadata: fingerprint не совпадает с содержимым.");
  }
  return fullMetadata(records, catalogs);
}

export interface SaveDisplayMetadataInput {
  lineDefinitions: LineDefinitions;
  supportsPreliminaryNote: string;
  disclaimer: string;
}

export async function saveDisplayMetadata(
  input: SaveDisplayMetadataInput,
  actor: ActorContext,
  now = new Date().toISOString(),
): Promise<DisplayMetadata> {
  const parsedDefinitions = lineDefinitionsSchema.parse(input.lineDefinitions) as LineDefinitions;
  const definitionIssues = validateLineDefinitions(parsedDefinitions);
  if (definitionIssues.length > 0) {
    throw new Error(`DisplayMetadata: невалидные lineDefinitions: ${definitionIssues.join("; ")}`);
  }
  const catalogs = await readCatalogItems();
  const fingerprint = computePersistedMetadataFingerprint({
    lineDefinitions: parsedDefinitions,
    supportsPreliminaryNote: input.supportsPreliminaryNote,
    disclaimer: input.disclaimer,
  });

  const existingRead = await readCollectionStatus<unknown>(DISPLAY_METADATA_COLLECTION);
  if (existingRead.status === "corrupt") {
    throw new Error("DisplayMetadata: коллекция повреждена — запись отменена.");
  }
  const existing = existingRead.status === "ok" ? readRecords(existingRead.items) : undefined;
  if (existing && existing.fingerprint === fingerprint) {
    return fullMetadata(existing, catalogs);
  }

  const nextVersion = (current: string | undefined): string =>
    String(Number(current ?? "0") + 1);
  const records: DisplayMetadataRecord[] = [
    {
      id: "lineDefinitions",
      kind: "line-definitions",
      value: parsedDefinitions,
      fingerprint,
      version: nextVersion(existing?.versions.lineDefinitions),
      updatedAt: now,
      updatedBy: actor.actorId,
    },
    {
      id: "supports.preliminaryNote",
      kind: "text",
      value: input.supportsPreliminaryNote,
      version: nextVersion(existing?.versions["supports.preliminaryNote"]),
      updatedAt: now,
      updatedBy: actor.actorId,
    },
    {
      id: "pricing.disclaimer",
      kind: "text",
      value: input.disclaimer,
      version: nextVersion(existing?.versions["pricing.disclaimer"]),
      updatedAt: now,
      updatedBy: actor.actorId,
    },
  ];

  const storage = getStorage();
  if (!(storage instanceof SqliteStorage)) {
    throw new Error("DisplayMetadata: атомарная запись возможна только через SQLite Storage Adapter.");
  }
  const audit = await readCollection<unknown>(AUDIT_COLLECTION);
  for (const [index, event] of audit.entries()) {
    if (!adminAuditLogSchema.safeParse(event).success) {
      throw new Error(`DisplayMetadata: audit запись №${index} невалидна — запись отменена.`);
    }
  }
  const event = adminAuditLogSchema.parse({
    id: randomBytes(8).toString("hex"),
    action: "display.update",
    entityType: "displayMetadata",
    entityId: "displayMetadata",
    oldValue: existing
      ? { fingerprint: existing.fingerprint, records: existing.versions }
      : null,
    newValue: { fingerprint, records: Object.fromEntries(records.map((r) => [r.id, r.version])) },
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    result: "ok",
    createdAt: now,
  });
  storage.applyBatch([
    { file: DISPLAY_METADATA_COLLECTION, items: records },
    { file: AUDIT_COLLECTION, items: [...audit, event] },
  ]);

  return fullMetadata(
    {
      lineDefinitions: parsedDefinitions,
      fingerprint,
      supportsPreliminaryNote: input.supportsPreliminaryNote,
      disclaimer: input.disclaimer,
      versions: Object.fromEntries(records.map((r) => [r.id, r.version])),
    },
    catalogs,
  );
}

export async function seedDisplayMetadata(actor: ActorContext): Promise<DisplayMetadata> {
  return saveDisplayMetadata(
    {
      lineDefinitions: DISPLAY_METADATA_SEED,
      supportsPreliminaryNote: SUPPORTS_PRELIMINARY_NOTE,
      disclaimer: PRICING_DISCLAIMER,
    },
    actor,
  );
}
