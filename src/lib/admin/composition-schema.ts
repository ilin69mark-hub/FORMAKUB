import { z } from "zod";

import { catalogKindSchema } from "./schema";

/**
 * Схемы управляемого состава модулей (Composition Management).
 *
 * Слой является **данными администрирования**: он описывает, из каких
 * компонентов состоит модуль, но не содержит формул, количеств, вычисляемых
 * кодом, и сумм. Нормы — ManagedRule; тарифы — PriceItem/PricingVersion;
 * суммы — только в PricingVersion.snapshot.
 *
 * `CompositionVersion` — самостоятельный версионируемый агрегат;
 * `CompositionLine` — встроенная строка, не отдельная коллекция.
 */

export const KITCHEN_MODULE_TYPES = [
  "base",
  "sink",
  "hob",
  "drawers",
  "wall",
  "tall",
  "oven",
  "bottle",
] as const;

export type CompositionModuleType = (typeof KITCHEN_MODULE_TYPES)[number];

export const COMPOSITION_RELATIONS = [
  "required",
  "conditional",
  "optional",
  "alternative",
] as const;

export type CompositionRelation = (typeof COMPOSITION_RELATIONS)[number];

export const COMPOSITION_SOURCES = [
  "preliminary",
  "datasheet",
  "owner_confirmed",
] as const;

export type CompositionSource = (typeof COMPOSITION_SOURCES)[number];

/** Единицы количества: только действующий enum проекта (Q7). */
export const COMPOSITION_UNITS = [
  "pcs",
  "m",
  "m2",
  "cm",
  "mm",
  "kg",
  "none",
] as const;

export type CompositionUnit = (typeof COMPOSITION_UNITS)[number];

const nonEmptySchema = z.string().min(1);
const idSchema = z.string().min(1).max(200);
const sourceRefSchema = z.string().min(1).max(1000);
const noteSchema = z.string().min(1).max(4000);
const timestampSchema = z.string().datetime({ offset: true });

export const compositionQuantityRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("code"),
    /** Идентификатор реализации/файла — не формула и не выражение. */
    implementationId: nonEmptySchema,
  }),
  z.strictObject({
    kind: z.literal("managed_rule"),
    ruleId: nonEmptySchema,
  }),
  z.strictObject({
    kind: z.literal("fixed"),
    value: z.number().finite(),
    unit: z.enum(COMPOSITION_UNITS),
  }),
]);

export type CompositionQuantityRef = z.infer<typeof compositionQuantityRefSchema>;

export const compositionConditionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    /** Описание для администратора; расчётом не исполняется. */
    text: nonEmptySchema,
  }),
  z.strictObject({
    kind: z.literal("code"),
    implementationId: nonEmptySchema,
  }),
  z.strictObject({
    kind: z.literal("managed_rule"),
    ruleId: nonEmptySchema,
  }),
]);

export type CompositionCondition = z.infer<typeof compositionConditionSchema>;

export const compositionConfirmationSchema = z.strictObject({
  by: z.string().min(1).max(200),
  at: timestampSchema,
  reference: z.string().min(1).max(2000),
});

export type CompositionConfirmation = z.infer<typeof compositionConfirmationSchema>;

export const compositionPinsSchema = z.strictObject({
  catalogVersions: z.record(z.string(), z.record(z.string(), nonEmptySchema)).optional(),
  priceItemVersions: z.record(z.string(), nonEmptySchema).optional(),
  priceVersionId: nonEmptySchema.optional(),
});

export type CompositionPins = z.infer<typeof compositionPinsSchema>;

export const compositionProductionSchema = z.strictObject({
  status: z.enum(["not_ready", "approved"]),
  approvedAt: timestampSchema.optional(),
  approvedBy: nonEmptySchema.optional(),
  criteria: z.array(nonEmptySchema).optional(),
});

export type CompositionProduction = z.infer<typeof compositionProductionSchema>;

export const compositionMigrationSchema = z.strictObject({
  skipped: z.array(nonEmptySchema),
  createdAt: timestampSchema.optional(),
});

export const compositionLineSchema = z
  .strictObject({
    id: idSchema,
    moduleType: z.enum(KITCHEN_MODULE_TYPES),
    /** Вид каталога; обязателен при componentId или для слота выбора. */
    componentCatalog: catalogKindSchema.optional(),
    /** Конкретный CatalogItem; отсутствует для configurable-слота. */
    componentId: idSchema.optional(),
    /** Тариф строки; отсутствует, если тариф определяется каталогом/конфигом. */
    priceItemId: idSchema.optional(),
    relation: z.enum(COMPOSITION_RELATIONS),
    alternativeGroup: idSchema.optional(),
    quantityRef: compositionQuantityRefSchema,
    condition: compositionConditionSchema.optional(),
    sourceRef: sourceRefSchema,
    source: z.enum(COMPOSITION_SOURCES),
    confirmation: compositionConfirmationSchema.optional(),
    sortOrder: z.number().int().min(0),
    notes: noteSchema.optional(),
  })
  .superRefine((line, ctx) => {
    if (line.componentId && !line.componentCatalog) {
      ctx.addIssue({
        code: "custom",
        path: ["componentCatalog"],
        message: "componentId требует componentCatalog",
      });
    }
    if (!line.componentId && !line.componentCatalog && !line.priceItemId) {
      ctx.addIssue({
        code: "custom",
        message:
          "строка должна ссылаться на CatalogItem/вид каталога или на PriceItem",
      });
    }
    if (line.relation === "alternative" && !line.alternativeGroup) {
      ctx.addIssue({
        code: "custom",
        path: ["alternativeGroup"],
        message: "alternative-строка требует alternativeGroup",
      });
    }
    if (line.relation === "conditional" && !line.condition) {
      ctx.addIssue({
        code: "custom",
        path: ["condition"],
        message: "conditional-строка требует condition",
      });
    }
    if (line.source === "owner_confirmed" && !line.confirmation) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: "owner_confirmed требует подтверждения (by/at/reference)",
      });
    }
    if (line.quantityRef.kind === "fixed") {
      if (!line.sourceRef) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceRef"],
          message: "fixed-количество требует подтверждённого sourceRef",
        });
      }
      if (!Number.isFinite(line.quantityRef.value) || line.quantityRef.value < 0) {
        ctx.addIssue({
          code: "custom",
          path: ["quantityRef", "value"],
          message: "fixed-количество должно быть конечным и ≥ 0",
        });
      }
    }
  });

export type CompositionLine = z.infer<typeof compositionLineSchema>;

export const compositionVersionSchema = z
  .strictObject({
    id: idSchema,
    schemaVersion: z.literal(1),
    status: z.enum(["draft", "published", "superseded"]),
    /** Optimistic locking для draft. */
    version: z.number().int().min(1),
    lines: z.array(compositionLineSchema),
    /** Хеш канонического содержимого (lines + rulesSnapshotId). */
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    /** Снимок правил, против которого проверялись ссылки ruleId. */
    rulesSnapshotId: nonEmptySchema.optional(),
    /** Версии коммерческих источников, использованных при публикации (Q4). */
    pins: compositionPinsSchema.optional(),
    /** Production Gate: published != production-ready (Q5). */
    production: compositionProductionSchema.optional(),
    /** Отчёт первоначальной миграции: непредставимые строки (CM-A14). */
    migration: compositionMigrationSchema.optional(),
    createdAt: timestampSchema,
    createdBy: nonEmptySchema,
    updatedAt: timestampSchema,
    updatedBy: nonEmptySchema,
    publishedAt: timestampSchema.optional(),
    publishedBy: nonEmptySchema.optional(),
    publishedSeq: z.number().int().positive().optional(),
    supersededAt: timestampSchema.optional(),
    /** Версия, с которой скопирован draft. */
    sourceVersionId: nonEmptySchema.optional(),
    notes: noteSchema.optional(),
  })
  .superRefine((version, ctx) => {
    const ids = new Set<string>();
    const orders = new Set<number>();
    for (const line of version.lines) {
      if (orders.has(line.sortOrder)) {
        ctx.addIssue({
          code: "custom",
          path: ["lines"],
          message: `дубликат sortOrder ${line.sortOrder}`,
        });
      }
      orders.add(line.sortOrder);
      if (ids.has(line.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["lines"],
          message: `дубликат id строки "${line.id}"`,
        });
      }
      ids.add(line.id);
    }
    if (version.status === "draft") {
      if (version.publishedAt || version.publishedBy || version.publishedSeq) {
        ctx.addIssue({
          code: "custom",
          message: "draft не должен содержать published-метаданные",
        });
      }
    } else {
      if (!version.publishedAt || !version.publishedBy || !version.publishedSeq) {
        ctx.addIssue({
          code: "custom",
          message:
            "published/superseded требуют publishedAt, publishedBy, publishedSeq",
        });
      }
    }
  });

export type CompositionVersion = z.infer<typeof compositionVersionSchema>;

export interface CompositionIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  lineId?: string;
  entityId?: string;
}

export interface CompositionValidationResult {
  ok: boolean;
  errors: CompositionIssue[];
  warnings: CompositionIssue[];
}
