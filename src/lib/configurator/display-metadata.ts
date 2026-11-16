import type { CatalogKind } from "./contract";

/** CA-T-306D: client-safe DisplayMetadata types (no server imports). */

export const DISPLAY_LINE_IDS = [
  "kitchen.base", "kitchen.body", "kitchen.fronts", "kitchen.fittings",
  "kitchen.options", "kitchen.pushToOpen", "kitchen.plinth",
  "kitchen.supports", "kitchen.supportClips", "kitchen.supportScrews",
  "kitchen.supportAnchors", "kitchen.lighting", "kitchen.lighting.strip",
  "kitchen.lighting.profile", "kitchen.lighting.diffuser",
  "kitchen.lighting.endCaps", "kitchen.lighting.connectors",
  "kitchen.lighting.psu", "kitchen.lighting.control",
  "kitchen.lighting.install", "kitchen.supportPreliminary",
  "kitchen.sidePanels", "kitchen.complexity", "kitchen.minOrder",
  "wardrobe.base", "wardrobe.body", "wardrobe.fronts", "wardrobe.fittings",
  "wardrobe.options", "wardrobe.led", "wardrobe.plinth",
  "wardrobe.pushToOpen", "wardrobe.minOrder",
] as const;

export type DisplayLineId = (typeof DISPLAY_LINE_IDS)[number];
export type DisplayGroup = "base" | "cost" | "options" | "lighting" | "adjustments";
export type NumberFormat = "integer" | "fixed1" | "fixed2" | "raw";
export type DetailUnit =
  | "м" | "мм" | "м²" | "шт." | "Вт" | "Вт/м" | "В" | "K"
  | "модул." | "фасад." | "ящ." | "двер." | "секц." | "полок" | "штанг";

export interface DetailCondition {
  field: string;
  op: "eq" | "gt" | "gte";
  value: number | boolean;
}

export type DetailSegment =
  | { kind: "literal"; text: string }
  | { kind: "number"; field: string; format: NumberFormat }
  | {
      kind: "numberWithUnit";
      field: string;
      format: NumberFormat;
      unit: DetailUnit;
      conversion?: "cm-to-m";
    }
  | { kind: "catalogLabel"; catalog: CatalogKind; idField: string }
  | { kind: "booleanLabel"; field: string; whenTrue: string; whenFalse: string }
  | {
      kind: "conditional";
      when: DetailCondition;
      then: DetailSegment[];
      otherwise?: DetailSegment[];
    };

export interface LineDisplayDefinition {
  id: DisplayLineId;
  label: string;
  group: DisplayGroup;
  order: number;
  detailSegments: DetailSegment[];
}

export type LineDefinitions = Record<DisplayLineId, LineDisplayDefinition>;

export type ReferenceSource = "preliminary" | "datasheet";

export interface DisplayMetadata {
  fingerprint: string;
  lineDefinitions: LineDefinitions;
  catalogLabels: Record<CatalogKind, Record<string, string>>;
  supportSystemSource: Record<string, ReferenceSource>;
  ledStripSource: Record<string, ReferenceSource>;
  supportsPreliminaryNote: string;
  disclaimer: string;
}
