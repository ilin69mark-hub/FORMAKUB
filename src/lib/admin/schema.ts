import { z } from "zod";

/**
 * Zod-схемы административных сущностей (CA-T-201).
 *
 * Источники: ТЗ §3.2 (Revision: проект) и дизайн §6.2, §6.4, §6.5, §6.8
 * (Revision 1), §8.7 (состав снимка). Схемы строгие (`strictObject`):
 * неизвестные поля отклоняются, данные не нормализуются и не изменяются
 * автоматически (контракт — только проверка).
 *
 * Не определены здесь (расхождения спецификаций, решение владельца требуется):
 * `AdminParameter` (ТЗ: `valueType=number`, `group` enum ↔ дизайн §7.1:
 * `decimal`, `group` string), `ModulePreset` (ТЗ+код: `basePrice: number` ↔
 * дизайн §6.3: `priceRef` FK), `PricingChange` (ТЗ: обязательный
 * `priceItemId`, `field` enum ↔ дизайн §6.6: `targetType`/`targetKey`,
 * `field` string). Сущности не создаются «по одному из двух» источников.
 *
 * Правила целостности/уникальности, требующие всей коллекции (U-ключи §6,
 * полнота снимка S-01), реализуются слоем сервисов/валидации версий
 * (CA-T-207, CA-T-210); здесь — `findDuplicates` для U-ключей.
 */

/** Метаданные: timestamp (ISO) / string (ТЗ §3.2). */
const timestampSchema = z.string().datetime({ offset: true });

const nonEmptySchema = z.string().min(1, "обязательная строка");

/** ─── CatalogItem (ТЗ §3.2, дизайн §6.2) ─────────────────────────────── */

export const catalogKindSchema = z.enum([
  "bodyMaterial",
  "facadeMaterial",
  "facadeStyle",
  "handle",
  "countertop",
  "plinthMaterial",
  "plinthFinish",
  "plinthMount",
  "supportSystem",
  "ledStrip",
  "ledProfile",
  "ledDiffuser",
  "ledControl",
  "ledPsu",
  "sinkSize",
  "promo",
]);

/** Ценовые роли ADR-06 Rev10 §5.8.1. */
export const catalogPriceRoleSchema = z.enum([
  "ratePerSqm",
  "ratePerLinearMeter",
  "multiplier",
  "rate",
  "ratePerMeter",
  "legPrice",
  "clipPrice",
  "screwPrice",
  "anchorPrice",
  "pricePerMeter",
  "price",
]);

export type CatalogPriceRefs = Partial<
  Record<z.infer<typeof catalogPriceRoleSchema>, string>
>;

/**
 * Новый формат: роль → PriceItem.id. Legacy `string[]` допускается только
 * на чтение/для миграции; DataResolver принимает только role-aware объект.
 */
export const catalogPriceRefsSchema = z.partialRecord(
  catalogPriceRoleSchema,
  nonEmptySchema,
);

/** CA-T-306D: typed source для supportSystem/ledStrip (display/reference metadata). */
export const referenceSourceSchema = z.enum(["preliminary", "datasheet"]);
export type ReferenceSource = z.infer<typeof referenceSourceSchema>;

export const supportSystemAttrsSchema = z.strictObject({
  edgeInsetCm: z.number().finite(),
  maxSpanCm: z.number().finite(),
  maxLoadKgPerLeg: z.number().finite(),
  clipsPerLeg: z.number().finite(),
  screwsPerLeg: z.number().finite(),
  tallAnchorSpacingCm: z.number().finite(),
  tallCenterLegWidthCm: z.number().finite(),
  source: referenceSourceSchema,
});

export const ledStripAttrsSchema = z.strictObject({
  power: z.number().finite(),
  voltage: z.union([z.literal(12), z.literal(24)]),
  maxContinuousRunM: z.number().finite(),
  voltageDropPct: z.number().finite(),
  maxPsuW: z.number().finite(),
  source: referenceSourceSchema,
});

export const catalogItemSchema = z.strictObject({
  /** Совпадает с id в `src/content/*` — не переименовывать (§6.2). */
  id: nonEmptySchema,
  catalog: catalogKindSchema,
  label: nonEmptySchema,
  /** Справочные атрибуты; схема конкретного справочника — CA-T-204. */
  attrs: z.record(z.string(), z.unknown()),
  /** FK→PriceItem.id (дизайн §6.2, опционально). */
  priceRefs: z.union([z.array(nonEmptySchema), catalogPriceRefsSchema]).optional(),
  status: z.enum(["active", "archived", "preliminary"]),
  sortOrder: z.number().int().optional(),
  version: nonEmptySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  updatedBy: nonEmptySchema,
}).superRefine((item, ctx) => {
  if (item.catalog !== "supportSystem" && item.catalog !== "ledStrip") return;
  const schema =
    item.catalog === "supportSystem"
      ? supportSystemAttrsSchema
      : ledStripAttrsSchema;
  const parsed = schema.safeParse(item.attrs);
  if (!parsed.success) {
    ctx.addIssue({
      code: "custom",
      path: ["attrs"],
      message: `${item.catalog}: attrs должны соответствовать typed-схеме, включая source preliminary|datasheet (${parsed.error.message})`,
    });
  }
});

export type CatalogItem = z.infer<typeof catalogItemSchema>;

/** ─── PriceItem (ТЗ §3.2, дизайн §6.4) ───────────────────────────────── */

export const priceItemSchema = z
  .strictObject({
    /** Стабильный ключ ставки (`kitchen.hingePerDoor`). */
    id: nonEmptySchema,
    scope: z.enum(["kitchen", "wardrobe", "shared"]),
    label: nonEmptySchema,
    unit: z.enum([
      "RUB",
      "RUB_PER_SQM",
      "RUB_PER_M",
      "RUB_PER_LINM",
      "RUB_PER_PCS",
      "FACTOR",
    ]),
    /** Ортогонально `status` (§6.4): `unused` — ставка не читается движком. */
    usage: z.enum(["used", "unused"]),
    status: z.enum(["active", "archived"]),
    /** `false` для permanently-unused (§6.4). */
    editable: z.boolean(),
    sourceRef: nonEmptySchema,
    groupId: nonEmptySchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    updatedBy: nonEmptySchema,
  })
  .superRefine((item, ctx) => {
    // §6.4: комбинация archived+used недопустима — валидация падает.
    if (item.status === "archived" && item.usage === "used") {
      ctx.addIssue({
        code: "custom",
        message:
          "archived+used недопустимо: движок читает ставку, исключённую из новых версий (дизайн §6.4)",
      });
    }
  });

export type PriceItem = z.infer<typeof priceItemSchema>;

/** ─── PricingVersion (ТЗ §3.2, дизайн §6.5, §8.7) ────────────────────── */

/** Снимок ставки: `{priceItemId, amount}` — снимок, не ссылки (X-2). */
export const pricingSnapshotItemSchema = z.strictObject({
  priceItemId: nonEmptySchema,
  amount: z.number().finite(),
});

export type PricingSnapshotItem = z.infer<typeof pricingSnapshotItemSchema>;

/** Промокод снимком — состав по `PromoDefinition` (`src/content/pricing.ts`). */
export const promoDefinitionSchema = z.strictObject({
  code: z.string().min(1).max(32),
  title: z.string().min(1),
  description: z.string(),
  type: z.enum(["percent", "fixed"]),
  value: z.number().finite(),
  minSubtotal: z.number().finite(),
  maxDiscount: z.number().finite().optional(),
  appliesTo: z.union([z.array(z.enum(["kitchen", "wardrobe"])), z.literal("all")]),
  active: z.boolean(),
  demo: z.literal(true),
});

/** Знаковая корректировка (ADR-06 Rev10 §5.8.3). */
export const signedAdjustmentSchema = z.strictObject({
  key: z.string().regex(/^plinth:[^:]+:[^:]+$/),
  amount: z.number().finite(),
});

export type SignedAdjustment = z.infer<typeof signedAdjustmentSchema>;

export const pricingVersionSchema = z
  .strictObject({
    /** `price-YYYY.MM.N` — формат [ПРЕДПОЛОЖЕНИЕ], не нормируется. */
    id: nonEmptySchema,
    label: nonEmptySchema,
    status: z.enum(["draft", "published", "superseded"]),
    /** Полный снимок всех ставок версии. */
    snapshot: z.array(pricingSnapshotItemSchema),
    /**
     * Коммерческие правила снимком (§8.7: rounding, minOrder,
     * complexityPerExtraModule, complexityMax, bodyFactor,
     * bodyDepthReference, …). Полная проверка состава — CA-T-210 (§8.3).
     */
    rules: z.record(z.string(), z.unknown()),
    promos: z.array(promoDefinitionSchema),
    /** Signed-корректировки PriceSnapshot (ADR-06 Rev10 §5.8.3). */
    signedAdjustments: z.array(signedAdjustmentSchema).optional(),
    /** Минимальная поддерживаемая `schemaVersion` (§6.5). */
    baseSchema: z.number().int(),
    /**
     * Монотонный порядок публикации — решение владельца R-07 (CA-Q-003,
     * 2026-11-06) + C8 («возможное поле PricingVersion, вводится после
     * CA-Q-003»): 1, 2, 3, …; актуальность §10.5 — по числу, не по строке
     * ID. `optional` — записи без поля (до CA-T-211) остаются валидными.
     */
    publishedSeq: z.number().int().positive().optional(),
    disclaimer: z.string().optional(),
    notes: z.string().optional(),
    createdAt: timestampSchema,
    createdBy: nonEmptySchema,
    publishedAt: timestampSchema.optional(),
    publishedBy: nonEmptySchema.optional(),
  })
  .superRefine((version, ctx) => {
    // ТЗ §3.2: publishedAt/publishedBy обязательны при status=published.
    if (
      version.status === "published" &&
      (version.publishedAt === undefined || version.publishedBy === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "для status=published обязательны publishedAt и publishedBy (ТЗ §3.2)",
        path: ["publishedAt"],
      });
    }
  });

export type PricingVersion = z.infer<typeof pricingVersionSchema>;

/** ─── ParameterDependency (ТЗ §3.2, дизайн §6.8) ──────────────────────── */

export const parameterDependencySchema = z.strictObject({
  id: nonEmptySchema,
  sourceType: z.enum(["parameter", "priceItem", "preset", "catalogItem"]),
  sourceId: nonEmptySchema,
  targetType: z.enum(["calculation", "visualization", "validation"]),
  targetId: nonEmptySchema,
  /** `none` ⇒ источник dead (§6.8). */
  effect: z.enum(["price", "geometry", "validation", "visualization", "none"]),
  /** Продублированное значение (аудит 6.1–6.4, 6.9). */
  syncRisk: z.boolean(),
  duplicatedIn: z.array(nonEmptySchema).optional(),
});

export type ParameterDependency = z.infer<typeof parameterDependencySchema>;

/** ─── AdminParameter (ТЗ §3.2, дизайн §6.1, §7.1; решения владельца 2026-11-07) ─── */

/** Решение владельца: `group` — enum разделов панели. */
export const parameterGroupSchema = z.enum(["01", "02", "03", "04", "05", "06"]);

export const parameterScopeSchema = z.enum(["kitchen", "wardrobe", "shared"]);

export const parameterCategorySchema = z.enum([
  "geometric",
  "technological",
  "constructive",
  "commercial_ref",
  "visualization",
  "system",
]);

export const parameterUnitSchema = z.enum([
  "cm",
  "mm",
  "m",
  "m2",
  "pcs",
  "kg",
  "rub",
  "rubPerM",
  "rubPerM2",
  "none",
]);

/** Решение владельца: `valueType` — модель дизайна §7.1 (включает `decimal`). */
export const parameterValueTypeSchema = z.enum([
  "int",
  "decimal",
  "boolean",
  "string",
  "enum",
  "string[]",
]);

export const parameterAppliesToSchema = z.enum([
  "new_projects",
  "all_read_paths",
]);

export const parameterStatusSchema = z.enum([
  "active",
  "readonly",
  "preliminary",
  "pending_release",
  "dead",
]);

const affectsSchema = z.strictObject({
  price: z.boolean(),
  geometry: z.boolean(),
  visualization: z.boolean(),
  validation: z.boolean(),
});

/** Обязательные для всех поле-основы (дизайн §7.1). */
const parameterBaseFields = {
  id: nonEmptySchema,
  scope: parameterScopeSchema,
  category: parameterCategorySchema,
  group: parameterGroupSchema,
  enumValues: z.array(z.string()).nullish(),
  sourceRef: nonEmptySchema,
  appliesTo: parameterAppliesToSchema,
  affects: affectsSchema,
  status: parameterStatusSchema,
  editableInAdmin: z.boolean(),
  version: nonEmptySchema,
  updatedAt: timestampSchema,
  updatedBy: nonEmptySchema,
};

/** Типизированные варианты значения (§7.1: обязательные атрибуты по типу). */
const intVariant = z.strictObject({
  ...parameterBaseFields,
  valueType: z.literal("int"),
  value: z.number().int(),
  defaultValue: z.number().int().optional(),
  unit: parameterUnitSchema,
  min: z.number(),
  max: z.number(),
});

const decimalVariant = z.strictObject({
  ...parameterBaseFields,
  valueType: z.literal("decimal"),
  value: z.number(),
  defaultValue: z.number().optional(),
  unit: parameterUnitSchema,
  min: z.number(),
  max: z.number(),
  step: z.number(),
});

const booleanVariant = z.strictObject({
  ...parameterBaseFields,
  valueType: z.literal("boolean"),
  value: z.boolean(),
  defaultValue: z.boolean().optional(),
});

const stringVariant = z.strictObject({
  ...parameterBaseFields,
  valueType: z.literal("string"),
  // §7.1: макс. длина 500
  value: z.string().max(500),
  defaultValue: z.string().max(500).optional(),
});

const enumVariant = z.strictObject({
  ...parameterBaseFields,
  valueType: z.literal("enum"),
  value: z.string(),
  defaultValue: z.string().optional(),
  // §6.1/§7.1: `enumValues ≠ []` при valueType=enum
  enumValues: z.array(z.string()).min(1),
});

const stringArrayVariant = z.strictObject({
  ...parameterBaseFields,
  valueType: z.literal("string[]"),
  value: z.array(z.string()),
  defaultValue: z.array(z.string()).optional(),
});

/**
 * `valueType`-дискриминатор: формат `value` и обязательные атрибуты
 * соответствуют типу (§7.1); неизвестные поля отклоняются.
 */
export const adminParameterSchema = z
  .discriminatedUnion("valueType", [
    intVariant,
    decimalVariant,
    booleanVariant,
    stringVariant,
    enumVariant,
    stringArrayVariant,
  ])
  .superRefine((param, ctx) => {
    const numeric =
      param.valueType === "int" || param.valueType === "decimal"
        ? (param as { min: number; max: number; value: number; defaultValue?: number })
        : null;

    if (numeric) {
      // §6.1: min ≤ defaultValue ≤ max; value ∈ [min,max]
      if (numeric.min > numeric.max) {
        ctx.addIssue({
          code: "custom",
          message: "min должен быть ≤ max (§6.1)",
          path: ["min"],
        });
      }
      if (numeric.value < numeric.min || numeric.value > numeric.max) {
        ctx.addIssue({
          code: "custom",
          message: "value вне диапазона [min,max] (§6.1)",
          path: ["value"],
        });
      }
      if (
        numeric.defaultValue !== undefined &&
        (numeric.defaultValue < numeric.min || numeric.defaultValue > numeric.max)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "defaultValue вне диапазона [min,max] (§6.1)",
          path: ["defaultValue"],
        });
      }
    }

    // §7.1: decimal — до 3 знаков
    if (param.valueType === "decimal") {
      const value = param.value;
      if (Math.abs(Math.round(value * 1000) / 1000 - value) > 1e-9) {
        ctx.addIssue({
          code: "custom",
          message: "decimal-значение: максимум 3 знака после запятой (§7.1)",
          path: ["value"],
        });
      }
    }

    // §7.1: значение должно входить в enumValues
    if (param.valueType === "enum" && !param.enumValues.includes(param.value)) {
      ctx.addIssue({
        code: "custom",
        message: "value не входит в enumValues (§7.1)",
        path: ["value"],
      });
    }

    // §6.1 + R-04: geometric ∧ affects.price ⇒ editableInAdmin=false (OI-063)
    if (
      param.category === "geometric" &&
      param.affects.price &&
      param.editableInAdmin
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "редактирование геометрии, влияющей на цену, запрещено (§6.1, R-04/OI-063)",
        path: ["editableInAdmin"],
      });
    }
  });

export type AdminParameter = z.infer<typeof adminParameterSchema>;

/** ─── ModulePreset (ТЗ §3.2, дизайн §6.3; решение владельца: priceRef) ─── */

const dimensionSchema = z.strictObject({
  min: z.number(),
  max: z.number(),
  default: z.number(),
});

/** Диапазон в пределах границ `kitchenModuleSchema` (§6.3, иначе 422). */
function checkDimension(
  ctx: z.RefinementCtx,
  name: "width" | "height" | "depth",
  dim: { min: number; max: number; default: number },
  low: number,
  high: number,
): void {
  for (const key of ["min", "max", "default"] as const) {
    const value = dim[key];
    if (value < low || value > high) {
      ctx.addIssue({
        code: "custom",
        message: `${name}.${key}=${value} вне границ ${low}–${high} (§6.3 ≤ kitchenModuleSchema)`,
        path: [name, key],
      });
    }
  }
  if (dim.min > dim.max || dim.default < dim.min || dim.default > dim.max) {
    ctx.addIssue({
      code: "custom",
      message: `${name}: требуется min ≤ default ≤ max (§6.3)`,
      path: [name],
    });
  }
}

export const modulePresetSchema = z
  .strictObject({
    id: nonEmptySchema,
    family: z.enum(["kitchen", "wardrobe"]),
    /** Зона размещения (§6.3 — string; `KITCHEN_MODULES.zone`: floor/upper). */
    zone: nonEmptySchema,
    width: dimensionSchema,
    height: dimensionSchema,
    depth: dimensionSchema,
    defaultShelves: z.number().int(),
    defaultDrawers: z.number().int(),
    /** Решение владельца (2026-11-07): вместо самостоятельного `basePrice`. */
    priceRef: nonEmptySchema,
    status: z.enum(["active", "archived"]),
    version: nonEmptySchema,
    updatedAt: timestampSchema,
    updatedBy: nonEmptySchema,
  })
  .superRefine((preset, ctx) => {
    checkDimension(ctx, "width", preset.width, 15, 200);
    checkDimension(ctx, "height", preset.height, 40, 280);
    checkDimension(ctx, "depth", preset.depth, 20, 80);
  });

export type ModulePreset = z.infer<typeof modulePresetSchema>;

/** ─── PricingChange (ТЗ §3.2, дизайн §6.6; решение владельца: универсальная модель) ─── */

/** Допустимые типы объекта изменения (дизайн §6.6). */
export const pricingChangeTargetTypeSchema = z.enum([
  "priceItem",
  "rule",
  "promo",
  "metadata",
]);

/**
 * `field` — по дизайну §6.6 строка («изменённое поле объекта»: amount, value,
 * active, minSubtotal, …); enum ТЗ §3.2 относится к прежней модели с
 * обязательным `priceItemId` и в утверждённой универсальной модели не применяется.
 */
export const pricingChangeSchema = z.strictObject({
  id: nonEmptySchema,
  /** FK→PricingVersion (§6.6). */
  versionId: nonEmptySchema,
  targetType: pricingChangeTargetTypeSchema,
  /** Обязательно (§6.6): ключ объекта — PriceItem.id / имя правила / code промока / метаданные. */
  targetKey: nonEmptySchema,
  field: nonEmptySchema,
  /** До/после; для удаления — null (§6.6). */
  oldValue: z.json(),
  newValue: z.json(),
  createdBy: nonEmptySchema,
  createdAt: timestampSchema,
});

export type PricingChange = z.infer<typeof pricingChangeSchema>;

/** ─── CA-T-403: модель заданий пересчёта ─────────────────────────────── */

export const recalculationStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "skipped",
  "dead_letter",
]);

export const recalculationBatchStatusSchema = z.enum([
  "running",
  "completed",
  "completed_with_errors",
  "cancelled",
]);

export const recalculationErrorSchema = z.strictObject({
  code: nonEmptySchema,
  message: nonEmptySchema,
  retryable: z.boolean(),
});

export const recalculationAttemptSchema = z.strictObject({
  attempt: z.number().int().nonnegative(),
  fromPriceVersionId: nonEmptySchema.nullable(),
  oldPrice: z.number().int().nullable(),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
});

export const recalculationBatchSchema = z.strictObject({
  id: nonEmptySchema,
  priceVersionId: nonEmptySchema,
  trigger: z.enum(["publish", "manual"]),
  status: recalculationBatchStatusSchema,
  totalCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  createdBy: nonEmptySchema,
});

export const projectRecalculationSchema = z.strictObject({
  id: nonEmptySchema,
  /** business operation ID; U(projectId,toPriceVersionId,batchId). */
  batchId: nonEmptySchema,
  projectId: nonEmptySchema,
  /** Source текущей/последней попытки; при создании — null. */
  fromPriceVersionId: nonEmptySchema.nullable(),
  toPriceVersionId: nonEmptySchema,
  calcVersion: nonEmptySchema,
  status: recalculationStatusSchema,
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  oldPrice: z.number().int().nullable(),
  newPrice: z.number().int().nullable(),
  deltaReason: z.enum(["price_publish", "manual"]),
  error: recalculationErrorSchema.nullable(),
  lastHeartbeatAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  startedAt: timestampSchema.nullable(),
  finishedAt: timestampSchema.nullable(),
  createdBy: nonEmptySchema,
  /** История попыток: from фиксируется на каждой попытке, не при создании. */
  attempts: z.array(recalculationAttemptSchema).default([]),
});

export type RecalculationStatus = z.infer<typeof recalculationStatusSchema>;
export type RecalculationBatchStatus = z.infer<
  typeof recalculationBatchStatusSchema
>;
export type RecalculationError = z.infer<typeof recalculationErrorSchema>;
export type RecalculationAttempt = z.infer<typeof recalculationAttemptSchema>;
export type RecalculationBatch = z.infer<typeof recalculationBatchSchema>;
export type ProjectRecalculation = z.infer<
  typeof projectRecalculationSchema
>;

/**
 * Проверка уникальности ключей коллекции (U-правила §6: U(id),
 * U(catalog,id), U(sourceType,sourceId,targetType,targetId) и т.д.) —
 * применяется сервисами при записи через Storage Adapter.
 */
export function findDuplicates<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) duplicates.add(key);
    else seen.add(key);
  }
  return [...duplicates];
}
