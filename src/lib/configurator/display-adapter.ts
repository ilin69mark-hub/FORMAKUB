import type {
  CalculationBreakdown,
  CalculationLine,
  CatalogKind,
} from "./contract";
import type { PriceBreakdown, PriceLine } from "./types";
import type {
  DetailSegment,
  DisplayMetadata,
  LineDisplayDefinition,
} from "./display-metadata";

/**
 * CA-T-306D Phase 3A — Display Adapter.
 *
 * Чистое отображение: CalculationBreakdown + DisplayMetadata → PriceBreakdown.
 * Не импортирует content/Admin/Storage/DataResolver/Engine и не считает цены.
 */

export type DisplayAdapterErrorCode =
  | "DISPLAY_METADATA_MISSING"
  | "DISPLAY_LINE_UNKNOWN"
  | "DISPLAY_METADATA_INVALID";

export interface DisplayAdapterIssue {
  code: DisplayAdapterErrorCode;
  lineId?: string;
  message: string;
}

export type DisplayAdapterResult =
  | { ok: true; price: PriceBreakdown }
  | { ok: false; issues: DisplayAdapterIssue[] };

function formatNumber(value: number, format: string): string {
  if (!Number.isFinite(value)) {
    throw new Error("нечисловое значение");
  }
  switch (format) {
    case "integer":
      if (!Number.isInteger(value)) throw new Error("integer-поле не целое");
      return String(value);
    case "fixed1":
      return value.toFixed(1);
    case "fixed2":
      return value.toFixed(2);
    case "raw":
      return String(value);
    default:
      throw new Error(`неизвестный NumberFormat "${format}"`);
  }
}

function renderSegment(
  line: CalculationLine,
  segment: DetailSegment,
  metadata: DisplayMetadata,
): string {
  const data = line as unknown as Record<string, unknown>;
  switch (segment.kind) {
    case "literal":
      return segment.text;
    case "number": {
      const value = data[segment.field];
      if (typeof value !== "number") throw new Error(`нет числового поля ${segment.field}`);
      return formatNumber(value, segment.format);
    }
    case "numberWithUnit": {
      const value = data[segment.field];
      if (typeof value !== "number") throw new Error(`нет числового поля ${segment.field}`);
      if (segment.conversion !== undefined) {
        if (
          segment.conversion !== "cm-to-m" ||
          line.id !== "wardrobe.plinth" ||
          segment.field !== "widthCm" ||
          segment.format !== "fixed1" ||
          segment.unit !== "м"
        ) {
          throw new Error("недопустимое cm-to-m преобразование");
        }
        return `${(value / 100).toFixed(1)} м`;
      }
      return `${formatNumber(value, segment.format)} ${segment.unit}`;
    }
    case "catalogLabel": {
      const id = data[segment.idField];
      if (typeof id !== "string") throw new Error(`нет строкового поля ${segment.idField}`);
      const label = metadata.catalogLabels[segment.catalog]?.[id];
      if (!label) throw new Error(`нет label ${segment.catalog}:${id}`);
      return label;
    }
    case "booleanLabel": {
      const value = data[segment.field];
      if (typeof value !== "boolean") throw new Error(`нет boolean-поля ${segment.field}`);
      return value ? segment.whenTrue : segment.whenFalse;
    }
    case "conditional": {
      const value = data[segment.when.field];
      const expected = segment.when.value;
      let matches = false;
      if (typeof value === "boolean") {
        matches = segment.when.op === "eq" && value === expected;
      } else if (typeof value === "number") {
        if (typeof expected !== "number") throw new Error("numeric condition требует number");
        matches =
          segment.when.op === "eq"
            ? value === expected
            : segment.when.op === "gt"
              ? value > expected
              : value >= expected;
      }
      return (matches ? segment.then : segment.otherwise ?? [])
        .map((child) => renderSegment(line, child, metadata))
        .join("");
    }
    default:
      throw new Error("неизвестный DetailSegment");
  }
}

function renderDetail(
  line: CalculationLine,
  definition: LineDisplayDefinition,
  metadata: DisplayMetadata,
): string {
  return definition.detailSegments
    .map((segment) => renderSegment(line, segment, metadata))
    .join("");
}

export function toPriceBreakdown(
  breakdown: CalculationBreakdown,
  metadata: DisplayMetadata,
): DisplayAdapterResult {
  const issues: DisplayAdapterIssue[] = [];
  const lines: PriceLine[] = [];

  for (const line of breakdown.lines) {
    const definition = metadata.lineDefinitions[line.id];
    if (!definition) {
      issues.push({
        code: "DISPLAY_LINE_UNKNOWN",
        lineId: line.id,
        message: `нет определения строки "${line.id}"`,
      });
      continue;
    }
    try {
      lines.push({
        label: definition.label,
        amount: line.amount,
        detail: renderDetail(line, definition, metadata),
      });
    } catch (error) {
      issues.push({
        code: "DISPLAY_METADATA_MISSING",
        lineId: line.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    price: {
      currency: breakdown.currency,
      baseCost: breakdown.baseCost,
      bodyCost: breakdown.bodyCost,
      frontsCost: breakdown.frontsCost,
      fittingsCost: breakdown.fittingsCost,
      optionsCost: breakdown.optionsCost,
      complexityFactor: breakdown.complexityFactor,
      subtotal: breakdown.subtotal,
      discount: breakdown.discount,
      total: breakdown.total,
      minOrderApplied: breakdown.minOrderApplied,
      lines,
      promo: breakdown.promo,
      disclaimer: metadata.disclaimer,
    },
  };
}

export type { CatalogKind };
