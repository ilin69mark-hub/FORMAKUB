import { z } from "zod";
import {
  COUNTERTOP_LEGACY_MAP,
  DEFAULT_FACADE_THICKNESS_MM,
  KITCHEN_LIMITS,
} from "@/content/catalog";
import {
  PLINTH_DEFAULT_MATERIAL,
  findPlinthMaterial,
} from "@/content/plinth";
import { PLINTH_MOUNT_DEFAULT } from "@/content/supports";
import {
  defaultKitchenLighting,
  defaultKitchenSupports,
} from "./defaults";

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-zA-Z0-9_-]+$/, "Недопустимый идентификатор");

const promoCodeSchema = z.string().trim().max(32).optional();

export const kitchenModuleSchema = z.strictObject({
  id: idSchema,
  type: z.enum([
    "base",
    "sink",
    "hob",
    "drawers",
    "wall",
    "tall",
    "oven",
    "bottle",
  ]),
  width: z.number().finite().min(15).max(200),
  height: z.number().finite().min(40).max(280),
  depth: z.number().finite().min(20).max(80),
  shelves: z.number().int().min(0).max(10),
  drawers: z.number().int().min(0).max(6),
  // Модуль под мойку: конструкция и габариты чаши (мм).
  sinkFacades: z.union([z.literal(2), z.literal(3)]).optional(),
  sinkPartition: z.boolean().optional(),
  sinkStorage: z
    .array(
      z.strictObject({
        shelves: z.number().int().min(0).max(3),
        drawers: z.number().int().min(0).max(3),
        bottle: z.union([z.literal(15), z.literal(20), z.literal(30)]).optional(),
      }),
    )
    .max(4)
    .optional(),
  sinkWidth: z.number().finite().min(200).max(1300).optional(),
  sinkDepth: z.number().finite().min(200).max(700).optional(),
  sinkPosition: z.enum(["left", "center", "right"]).optional(),
  sinkOffset: z.number().finite().min(0).max(1300).optional(),
  sinkCutout: z
    .strictObject({
      width: z.number().finite().min(150).max(1300),
      depth: z.number().finite().min(150).max(700),
    })
    .optional(),
  // Способ опирания модуля: техника на собственных ножках, мебельные опоры
  // модулю не нужны. Отсутствие поля (старые проекты) — обычные мебельные опоры.
  ownSupports: z.boolean().optional(),
});

const lightingSchema = z.strictObject({
  voltage: z.union([z.literal(12), z.literal(24)]),
  powerPerMeter: z.union([
    z.literal(4.8),
    z.literal(9.6),
    z.literal(14.4),
    z.literal(19.2),
  ]),
  colorTemp: z.union([
    z.literal(2700),
    z.literal(3000),
    z.literal(4000),
    z.literal(5000),
    z.literal(6000),
  ]),
  profile: z.enum(["surface", "recessed", "corner"]),
  diffuser: z.enum(["clear", "frosted"]),
  control: z.enum(["switch", "sensor", "dimmer"]),
});

const supportSettingsSchema = z.strictObject({
  systemId: z.enum(["standard", "heavy"]),
  maxSpanCm: z.number().finite().min(20).max(200),
  maxLoadKgPerLeg: z.number().finite().min(10).max(300),
});

export const kitchenConfigSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("kitchen"),
  modules: z.array(kitchenModuleSchema).min(1).max(25),
  bodyMaterial: z.enum(["ldsp", "mdf", "plywood"]),
  bodyFinish: z.string().trim().min(1).max(40),
  facadeMaterial: z.enum(["ldsp", "mdf", "mdf_pvc", "veneer", "glass", "solid"]),
  facadeFinish: z.string().trim().min(1).max(40),
  facadeStyle: z.enum(["flat", "shaker", "handleless"]),
  // Фактическая толщина фасада, мм (CA-T-513). Для старых проектов —
  // техническое значение; normalizeKitchen подбирает допустимое для материала.
  facadeThickness: z
    .number()
    .finite()
    .min(4)
    .max(30)
    .default(DEFAULT_FACADE_THICKNESS_MM),
  countertop: z.preprocess(
    (value) =>
      typeof value === "string" && COUNTERTOP_LEGACY_MAP[value]
        ? COUNTERTOP_LEGACY_MAP[value]
        : value,
    z.enum([
      "ldsp_hpl",
      "compact_hpl",
      "acrylic",
      "quartz",
      "porcelain",
      "solid_wood",
    ]),
  ),
  countertopThickness: z
    .number()
    .finite()
    .min(4)
    .max(50)
    .default(30),
  handle: z.enum(["bar", "knob", "profile", "none"]),
  hinge: z.enum(["standard", "soft"]),
  pushToOpen: z.boolean(),
  plinth: z.boolean(),
  plinthHeight: z
    .number()
    .finite()
    .min(KITCHEN_LIMITS.minPlinthHeight)
    .max(KITCHEN_LIMITS.maxPlinthHeight)
    .default(KITCHEN_LIMITS.defaultPlinthHeight),
  // Новые поля цоколя/подсветки/опор — опциональны для старых проектов:
  // при отсутствии подставляются значения по умолчанию (см. normalizeKitchen).
  plinthMaterial: z
    .enum(["ldsp", "mdf", "plastic", "aluminum", "stainless"])
    .default(PLINTH_DEFAULT_MATERIAL),
  plinthThickness: z
    .number()
    .finite()
    .min(0.5)
    .max(20)
    .default(findPlinthMaterial(PLINTH_DEFAULT_MATERIAL)?.defaultThickness ?? 16),
  plinthFinish: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .default(
      findPlinthMaterial(PLINTH_DEFAULT_MATERIAL)?.finishes[0]?.id ?? "pvc2",
    ),
  plinthMount: z.enum(["clips", "hidden"]).default(PLINTH_MOUNT_DEFAULT),
  underCabinetLighting: z.boolean(),
  lighting: lightingSchema.default(defaultKitchenLighting()),
  supports: supportSettingsSchema.default(defaultKitchenSupports()),
  sidePanels: z.number().int().min(0).max(2),
  promoCode: promoCodeSchema,
});

const wardrobeDrawerBoxSchema = z.strictObject({
  sideThicknessMm: z.literal(16),
  frontThicknessMm: z.literal(16),
  backThicknessMm: z.literal(16),
  bottomThicknessMm: z.literal(3),
  bottomMount: z.literal("overlay-bottom"),
});

const wardrobeDrawerRunnerSchema = z.strictObject({
  type: z.literal("ball-bearing-side"),
  lengthMm: z.union([
    z.literal(250),
    z.literal(300),
    z.literal(350),
    z.literal(400),
    z.literal(450),
    z.literal(500),
    z.literal(550),
  ]),
  softClose: z.boolean(),
  loadClass: z.enum(["standard", "heavy"]),
  modelId: z.string().trim().min(1).max(80).optional(),
});

const wardrobeDrawerBlockSchema = z.strictObject({
  topMm: z.number().finite().min(800).max(1100),
  frontHeightsMm: z.array(z.number().finite().positive()).min(3).max(5),
  frontType: z.enum(["overlay", "inset"]),
  box: wardrobeDrawerBoxSchema,
  runner: wardrobeDrawerRunnerSchema,
});

const wardrobePulloutRodSchema = z.strictObject({
  lengthMm: z.union([
    z.literal(250),
    z.literal(300),
    z.literal(350),
    z.literal(400),
    z.literal(450),
    z.literal(500),
  ]),
  execution: z.enum(["wire", "ball"]),
  loadClass: z.enum(["budget", "reinforced"]),
  modelId: z.string().trim().min(1).max(80).optional(),
});

export const wardrobeSectionSchema = z.strictObject({
  id: idSchema,
  shelves: z.array(z.number().finite().min(0).max(300)).max(12),
  rods: z.array(z.number().finite().min(0).max(300)).max(3),
  drawers: z.number().int().min(0).max(6),
  drawerBlock: wardrobeDrawerBlockSchema.optional(),
  rodType: z.enum(["standard", "pullout"]).optional(),
  pulloutRod: wardrobePulloutRodSchema.optional(),
  rodSupportModelId: z.string().trim().min(1).max(80).optional(),
});

export const wardrobeConfigSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("wardrobe"),
  height: z.number().finite().min(100).max(320),
  widthMm: z.number().finite().min(200).max(4000),
  fullDepth: z.number().finite().min(100).max(1000),
  sections: z.array(wardrobeSectionSchema).min(1).max(2),
  bodyMaterial: z.literal("ldsp"),
  bodyFinish: z.string().trim().min(1).max(40),
  bodyThicknessMm: z.literal(16),
  backPanelThicknessMm: z.literal(3),
  plinthHeightMm: z.literal(80),
  plinthInsetMm: z.literal(50),
  partition: z
    .strictObject({ positionMm: z.number().finite().positive() })
    .nullable(),
  antresol: z
    .strictObject({
      heightMm: z.number().finite().positive(),
    })
    .nullable(),
  facadeMaterial: z.enum(["ldsp", "mdf_pvc"]),
  facadeThickness: z.union([z.literal(16), z.literal(19), z.literal(22)]),
  facadeMount: z.literal("overlay"),
  facadeFinish: z.string().trim().min(1).max(40),
  facadeStyle: z.enum(["flat", "shaker", "handleless"]),
  handle: z.enum(["bar", "knob", "profile", "none"]),
  hinge: z.enum(["standard", "soft"]),
  pushToOpen: z.boolean(),
  plinth: z.boolean(),
  ledLighting: z.boolean(),
  hardware: z
    .strictObject({
      hingeModelId: z.string().trim().min(1).max(80).optional(),
      shelfSupportModelId: z.string().trim().min(1).max(80).optional(),
      standardRodSupportModelId: z.string().trim().min(1).max(80).optional(),
      fastenerModelIds: z
        .array(z.string().trim().min(1).max(80))
        .max(50)
        .optional(),
    })
    .optional(),
  promoCode: promoCodeSchema,
});

export const furnitureConfigSchema = z.discriminatedUnion("kind", [
  kitchenConfigSchema,
  wardrobeConfigSchema,
]);

export const customerSchema = z.strictObject({
  name: z.string().trim().min(2, "Укажите имя").max(80),
  contact: z.string().trim().min(5, "Укажите телефон или мессенджер").max(120),
  email: z.email("Проверьте email").max(120).optional(),
  preferredContact: z.enum(["phone", "telegram", "whatsapp", "email"]),
  comment: z.string().trim().max(1000).optional(),
  consent: z.literal(true, "Нужно согласие на обработку данных"),
});

export const leadPayloadSchema = z.strictObject({
  config: furnitureConfigSchema.optional(),
  customer: customerSchema,
  source: z.string().trim().max(80).optional(),
  interest: z
    .enum(["kitchen", "wardrobe", "dressing", "dressers", "other"])
    .optional(),
  website: z.string().max(0).optional(),
  /** CA-GL-25: id сохранённого проекта (проверяется на сервере). */
  projectId: z.string().trim().regex(/^[a-z0-9]{8}$/).optional(),
});

/**
 * Тело сохранения проекта. `compositionVersionId` — additive-optional
 * (E2): поле уже поддерживается `saveProject`/`StoredProject`, старые запросы
 * без него продолжают работать. Обязательность не меняется; отдельного
 * механизма хранения версий не создаётся — источник один, существующий
 * `StoredProject.compositionVersionId`.
 */
export const projectPayloadSchema = z.strictObject({
  config: furnitureConfigSchema,
  compositionVersionId: z.string().trim().min(1).optional(),
});

export const projectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]{8}$/);

/**
 * Структурная проверка записи проекта из хранилища (CA-T-104, CA-T-106).
 *
 * Содержимое `config` и `price` здесь не разбирается: несовместимая или
 * устаревшая структура должна читаться в режиме raw с пометкой
 * `compatibility` (дизайн §12 S6), а не отбрасываться. Поля `schemaVersion`
 * и `calcVersion` отсутствуют у старых записей — это валидно (§5.4).
 */
export const projectPinsSchema = z.looseObject({
  catalogVersions: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional(),
  presetVersions: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional(),
});

/** Строгая схема сохраняемого PriceBreakdown (CA-T-306E). */
export const priceLineSchema = z.strictObject({
  label: z.string(),
  amount: z.number().finite(),
  detail: z.string().optional(),
});

export const promoResultSchema = z.strictObject({
  code: z.string(),
  title: z.string(),
  discount: z.number().finite(),
  valid: z.boolean(),
  reason: z.string().optional(),
  demo: z.boolean(),
});

export const priceBreakdownSchema = z.strictObject({
  currency: z.literal("RUB"),
  baseCost: z.number().finite(),
  bodyCost: z.number().finite(),
  frontsCost: z.number().finite(),
  fittingsCost: z.number().finite(),
  optionsCost: z.number().finite(),
  complexityFactor: z.number().finite(),
  subtotal: z.number().finite(),
  discount: z.number().finite(),
  total: z.number().finite(),
  minOrderApplied: z.boolean(),
  lines: z.array(priceLineSchema),
  promo: promoResultSchema.nullable(),
  disclaimer: z.string(),
});

/**
 * E4: строгая схема исторического CompositionTrace.
 *
 * Снимок самодостаточен: значения (quantity/amount/единицы/статусы) хранятся
 * вместе с событием и не восстанавливаются из текущих административных данных.
 */
const compositionTraceSnapshotIssueSchema = z.strictObject({
  severity: z.enum(["error", "warning"]),
  code: z.string().trim().min(1),
  message: z.string(),
  lineId: z.string().trim().min(1).optional(),
  entityId: z.string().trim().min(1).optional(),
});

const compositionTraceSnapshotLineSchema = z.strictObject({
  lineId: z.string().trim().min(1),
  moduleType: z.string().trim().min(1),
  relation: z.string().trim().min(1),
  condition: z.enum([
    "true",
    "false",
    "not_evaluated",
    "error",
    "not_required",
  ]),
  quantity: z.number().finite().nullable(),
  unit: z.string().nullable(),
  quantitySource: z.enum(["fixed", "unresolved"]),
  priceItemId: z.string().trim().min(1).optional(),
  amount: z.number().finite().nullable(),
  priceItemUnit: z.string().nullable(),
  priceAmount: z.number().finite().nullable(),
  status: z.enum([
    "resolved",
    "excluded",
    "quantity_unresolved",
    "price_unresolved",
    "blocked",
  ]),
});

export const compositionTraceSnapshotSchema = z.strictObject({
  traceVersion: z.literal(1),
  status: z.enum(["computed", "blocked"]),
  compositionVersionId: z.string().trim().min(1),
  compositionContentHash: z.string().trim().min(1),
  compositionRulesSnapshotId: z.string().trim().min(1).nullable(),
  rulesSnapshotId: z.string().trim().min(1).nullable(),
  enginePriceVersionId: z.string().trim().min(1),
  enginePriceBaseSchema: z.number().int().nonnegative(),
  pinnedPriceVersionId: z.string().trim().min(1).nullable(),
  catalogVersions: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional(),
  priceItemVersions: z.record(z.string(), z.string()).optional(),
  lines: z.array(compositionTraceSnapshotLineSchema),
  warnings: z.array(compositionTraceSnapshotIssueSchema),
  computedAt: z.string().min(1),
});

/**
 * Строгая проверка события истории (CA-T-306E).
 * Повреждённая или неизвестная структура события не должна молча
 * превращаться в пустую/корректную историю — чтение проекта fail-closed.
 */
export const projectPriceHistorySchema = z.strictObject({
  id: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  operationId: z.string().trim().min(1),
  reason: z.enum(["create", "manual_recalc"]),
  fromPriceVersionId: z.string().trim().min(1).nullable(),
  toPriceVersionId: z.string().trim().min(1),
  schemaVersion: z.number().int().min(1),
  calcVersion: z.string().trim().min(1),
  oldPrice: z.number().finite().nullable(),
  newPrice: z.number().finite(),
  delta: z.number().finite().nullable(),
  breakdown: priceBreakdownSchema,
  breakdownVersion: z.number().int().min(1),
  compositionVersionId: z.string().trim().min(1).optional(),
  /** E4: исторический снимок трассировки; absent у записей до E4. */
  compositionTrace: compositionTraceSnapshotSchema.optional(),
  requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  requestFingerprintVersion: z.string().trim().min(1),
  computedAt: z.string().min(1),
});

export const storedProjectSchema = z.looseObject({
  id: z.string().trim().min(1).max(40),
  config: z.looseObject({}),
  price: z.looseObject({}),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  schemaVersion: z.number().int().min(1).optional(),
  calcVersion: z.string().min(1).optional(),
  priceVersion: z.string().min(1).optional(),
  compositionVersionId: z.string().trim().min(1).optional(),
  pins: projectPinsSchema.optional(),
  priceHistory: z.array(projectPriceHistorySchema).optional(),
});

export function safeParseConfig(value: unknown) {
  return furnitureConfigSchema.safeParse(value);
}
