import { z } from "zod";
import { COUNTERTOP_LEGACY_MAP, KITCHEN_LIMITS } from "@/content/catalog";
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
  facadeMaterial: z.enum(["ldsp", "mdf", "veneer", "glass", "solid"]),
  facadeFinish: z.string().trim().min(1).max(40),
  facadeStyle: z.enum(["flat", "shaker", "handleless"]),
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

export const wardrobeSectionSchema = z.strictObject({
  id: idSchema,
  width: z.number().finite().min(20).max(200),
  shelves: z.array(z.number().finite().min(0).max(300)).max(12),
  rods: z.array(z.number().finite().min(0).max(300)).max(3),
  drawers: z.number().int().min(0).max(6),
});

export const wardrobeConfigSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("wardrobe"),
  height: z.number().finite().min(100).max(320),
  depth: z.number().finite().min(20).max(100),
  sections: z.array(wardrobeSectionSchema).min(1).max(8),
  bodyMaterial: z.enum(["ldsp", "mdf", "plywood"]),
  bodyFinish: z.string().trim().min(1).max(40),
  facadeMaterial: z.enum(["ldsp", "mdf", "veneer", "glass", "solid"]),
  facadeFinish: z.string().trim().min(1).max(40),
  facadeStyle: z.enum(["flat", "shaker", "handleless"]),
  handle: z.enum(["bar", "knob", "profile", "none"]),
  hinge: z.enum(["standard", "soft"]),
  pushToOpen: z.boolean(),
  plinth: z.boolean(),
  ledLighting: z.boolean(),
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
});

export const projectPayloadSchema = z.strictObject({
  config: furnitureConfigSchema,
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
export const storedProjectSchema = z.looseObject({
  id: z.string().trim().min(1).max(40),
  config: z.looseObject({}),
  price: z.looseObject({}),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  schemaVersion: z.number().int().min(1).optional(),
  calcVersion: z.string().min(1).optional(),
});

export function safeParseConfig(value: unknown) {
  return furnitureConfigSchema.safeParse(value);
}
