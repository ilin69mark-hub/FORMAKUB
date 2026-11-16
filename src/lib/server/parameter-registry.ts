import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * CA-T-306B — Versioned Parameter Registry.
 *
 * Immutable manifest на `calcVersion`: технические параметры Engine, не
 * коммерческие ставки и не Reference Data. Manifest — код/registry-owned
 * данные; live `AdminParameter.value`, SQLite и `content/*` не участвуют в
 * runtime-разрешении параметров.
 */

const numberPositive = z.number().finite().positive();
const numberNonNegative = z.number().finite().nonnegative();
const numberArray = z.array(z.number().finite().positive()).min(1);

/** Полный подтверждённый whitelist технических параметров Engine (CA-T-306B). */
export const parameterValuesSchema = z.strictObject({
  "engine.sink.minWidth": numberPositive,
  "engine.sink.maxWidth": numberPositive,
  "engine.sink.widthStep": numberPositive,
  "engine.sink.standardWidths": numberArray,
  "engine.sink.sidePanel": numberNonNegative,
  "engine.sink.partition": numberNonNegative,
  "engine.sink.facadeGap": numberNonNegative,
  "engine.sink.partitionMinWidth": numberPositive,
  "engine.sink.threeDoorMinWidth": numberPositive,
  "engine.sink.maxShelvesPerSection": z.number().int().nonnegative(),
  "engine.sink.maxDrawersPerSection": z.number().int().nonnegative(),
  "engine.sink.minSectionOuterWidthForDrawers": numberPositive,
  "engine.sink.mountEdge": numberNonNegative,
  "engine.sink.innerMount": numberNonNegative,
  "engine.sink.sinkStep": numberPositive,
  "engine.sink.minSinkWidth": numberPositive,
  "engine.sink.maxSinkWidth": numberPositive,
  "engine.sink.minSinkDepth": numberPositive,
  "engine.sink.maxSinkDepth": numberPositive,
  "engine.sink.minStorageSectionWidth": numberPositive,
  "engine.sink.facadeEdgeGap": numberNonNegative,
  "engine.sink.facadeNeighborGap": numberNonNegative,
  "engine.sink.facadeInnerGap": numberNonNegative,
  "engine.sink.bottleBodies": numberArray,
  "engine.sink.bottleClearOffset": numberPositive,

  "engine.supports.minLegSpacingCm": numberPositive,
  "engine.supports.partitionSnapCm": numberNonNegative,
  "engine.supports.mergeToleranceCm": numberNonNegative,
  "engine.supports.moduleLoadKg.base": numberNonNegative,
  "engine.supports.moduleLoadKg.sink": numberNonNegative,
  "engine.supports.moduleLoadKg.hob": numberNonNegative,
  "engine.supports.moduleLoadKg.drawers": numberNonNegative,
  "engine.supports.moduleLoadKg.wall": numberNonNegative,
  "engine.supports.moduleLoadKg.tall": numberNonNegative,
  "engine.supports.moduleLoadKg.oven": numberNonNegative,
  "engine.supports.moduleLoadKg.bottle": numberNonNegative,
  "engine.supports.moduleLoadReferenceWidth.base": numberPositive,
  "engine.supports.moduleLoadReferenceWidth.sink": numberPositive,
  "engine.supports.moduleLoadReferenceWidth.hob": numberPositive,
  "engine.supports.moduleLoadReferenceWidth.drawers": numberPositive,
  "engine.supports.moduleLoadReferenceWidth.wall": numberPositive,
  "engine.supports.moduleLoadReferenceWidth.tall": numberPositive,
  "engine.supports.moduleLoadReferenceWidth.oven": numberPositive,
  "engine.supports.moduleLoadReferenceWidth.bottle": numberPositive,

  "engine.lighting.endMarginCm": numberNonNegative,
  "engine.lighting.psuMargin": numberPositive,
  "engine.lighting.psuMarginLow": numberPositive,
  "engine.lighting.psuRatings": numberArray,
  "engine.kitchen.wallGapAboveCountertop": numberNonNegative,
});

export type ParameterValues = z.infer<typeof parameterValuesSchema>;

export interface ParameterManifest {
  formatVersion: 1;
  calcVersion: string;
  parameters: ParameterValues;
  /** SHA-256 канонического {formatVersion, calcVersion, parameters}. */
  integrity: string;
}

export type ParameterRegistryErrorCode =
  | "PARAMETER_MANIFEST_UNAVAILABLE"
  | "PARAMETER_MANIFEST_INVALID"
  | "PARAMETER_MANIFEST_INTEGRITY";

export interface ParameterRegistryIssue {
  code: ParameterRegistryErrorCode;
  calcVersion: string;
  message: string;
}

export type ParameterRegistryResult =
  | { ok: true; manifest: ParameterManifest }
  | { ok: false; issue: ParameterRegistryIssue };

const manifestSourceSchema = z.strictObject({
  formatVersion: z.literal(1),
  calcVersion: z.string().trim().min(1),
  parameters: parameterValuesSchema,
});

type ManifestSource = z.infer<typeof manifestSourceSchema>;

/**
 * Версии manifest. Одна запись = один immutable calcVersion.
 * Значения скопированы из подтверждённых технических констант Engine;
 * runtime-импорт content/* отсутствует.
 */
const MANIFEST_SOURCE: Record<string, ManifestSource> = {
  "calc-2026.11.0": {
    formatVersion: 1,
    calcVersion: "calc-2026.11.0",
    parameters: {
      "engine.sink.minWidth": 40,
      "engine.sink.maxWidth": 120,
      "engine.sink.widthStep": 5,
      "engine.sink.standardWidths": [40, 45, 50, 60, 80, 90, 100, 120],
      "engine.sink.sidePanel": 1.6,
      "engine.sink.partition": 1.6,
      "engine.sink.facadeGap": 0.25,
      "engine.sink.partitionMinWidth": 65,
      "engine.sink.threeDoorMinWidth": 100,
      "engine.sink.maxShelvesPerSection": 3,
      "engine.sink.maxDrawersPerSection": 3,
      "engine.sink.minSectionOuterWidthForDrawers": 30,
      "engine.sink.mountEdge": 50,
      "engine.sink.innerMount": 0,
      "engine.sink.sinkStep": 10,
      "engine.sink.minSinkWidth": 300,
      "engine.sink.maxSinkWidth": 1100,
      "engine.sink.minSinkDepth": 300,
      "engine.sink.maxSinkDepth": 500,
      "engine.sink.minStorageSectionWidth": 100,
      "engine.sink.facadeEdgeGap": 0.2,
      "engine.sink.facadeNeighborGap": 0.1,
      "engine.sink.facadeInnerGap": 0.2,
      "engine.sink.bottleBodies": [15, 20, 30],
      "engine.sink.bottleClearOffset": 3.2,

      "engine.supports.minLegSpacingCm": 8,
      "engine.supports.partitionSnapCm": 4,
      "engine.supports.mergeToleranceCm": 1.5,
      "engine.supports.moduleLoadKg.base": 55,
      "engine.supports.moduleLoadKg.sink": 75,
      "engine.supports.moduleLoadKg.hob": 65,
      "engine.supports.moduleLoadKg.drawers": 80,
      "engine.supports.moduleLoadKg.wall": 0,
      "engine.supports.moduleLoadKg.tall": 130,
      "engine.supports.moduleLoadKg.oven": 110,
      "engine.supports.moduleLoadKg.bottle": 35,
      "engine.supports.moduleLoadReferenceWidth.base": 60,
      "engine.supports.moduleLoadReferenceWidth.sink": 60,
      "engine.supports.moduleLoadReferenceWidth.hob": 60,
      "engine.supports.moduleLoadReferenceWidth.drawers": 60,
      "engine.supports.moduleLoadReferenceWidth.wall": 60,
      "engine.supports.moduleLoadReferenceWidth.tall": 60,
      "engine.supports.moduleLoadReferenceWidth.oven": 60,
      "engine.supports.moduleLoadReferenceWidth.bottle": 20,

      "engine.lighting.endMarginCm": 2,
      "engine.lighting.psuMargin": 1.25,
      "engine.lighting.psuMarginLow": 1.2,
      "engine.lighting.psuRatings": [20, 30, 60, 100, 150, 200, 300, 400],
      "engine.kitchen.wallGapAboveCountertop": 56,
    },
  },
};

MANIFEST_SOURCE["calc-2026.11.1"] = {
  ...MANIFEST_SOURCE["calc-2026.11.0"],
  calcVersion: "calc-2026.11.1",
};

MANIFEST_SOURCE["calc-2026.11.2"] = {
  ...MANIFEST_SOURCE["calc-2026.11.0"],
  calcVersion: "calc-2026.11.2",
};

/** Ожидаемые integrity-хэши. Изменение manifest требует новой версии/релиза. */
const MANIFEST_INTEGRITY: Record<string, string> = {
  "calc-2026.11.0": "6608c775d1b5f7ea543c06df00d69462f6502e3ed4fb3a25d1c6d84c81e849cf",
  "calc-2026.11.1": "bdddda39226cf7daf508b38f16aae955cfccf0ebdf576e9f27415d16825a1f8c",
  "calc-2026.11.2": "1a5378edf693334d153d531d0674d6ac9aded591db812c6ed44212452af95a84",
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 канонического manifest (без поля integrity). */
export function computeManifestIntegrity(
  source: Pick<ParameterManifest, "formatVersion" | "calcVersion" | "parameters">,
): string {
  return createHash("sha256")
    .update(
      canonical({
        formatVersion: source.formatVersion,
        calcVersion: source.calcVersion,
        parameters: source.parameters,
      }),
    )
    .digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Проверка формата/типов/диапазонов manifest без проверки integrity. */
export function validateManifestSource(
  raw: unknown,
): { ok: true; source: ManifestSource } | { ok: false; message: string } {
  const parsed = manifestSourceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.message };
  }
  return { ok: true, source: parsed.data };
}

/**
 * Проверка произвольного manifest с ожидаемым integrity. Используется
 * read-path и targeted negative tests; публикация/запись manifest API нет.
 */
export function validateParameterManifest(
  raw: unknown,
  expectedIntegrity: string | undefined,
): ParameterRegistryResult {
  const calcVersion =
    raw !== null && typeof raw === "object" && "calcVersion" in raw
      ? String((raw as { calcVersion?: unknown }).calcVersion ?? "")
      : "";
  const validated = validateManifestSource(raw);
  if (!validated.ok) {
    return {
      ok: false,
      issue: {
        code: "PARAMETER_MANIFEST_INVALID",
        calcVersion,
        message: `manifest не проходит схему: ${validated.message}`,
      },
    };
  }
  const actual = computeManifestIntegrity(validated.source);
  if (!expectedIntegrity || expectedIntegrity !== actual) {
    return {
      ok: false,
      issue: {
        code: "PARAMETER_MANIFEST_INTEGRITY",
        calcVersion,
        message: `integrity manifest не совпадает (ожидалось ${expectedIntegrity ?? "нет"}, получено ${actual})`,
      },
    };
  }
  return {
    ok: true,
    manifest: deepFreeze({ ...validated.source, integrity: actual }),
  };
}

/**
 * Точное разрешение manifest по calcVersion. Никакого наследования,
 * wildcard или fallback на другую версию/Admin нет.
 */
export function getParameterManifest(calcVersion: string): ParameterRegistryResult {
  const raw = MANIFEST_SOURCE[calcVersion];
  if (!raw) {
    return {
      ok: false,
      issue: {
        code: "PARAMETER_MANIFEST_UNAVAILABLE",
        calcVersion,
        message: `manifest для calcVersion "${calcVersion}" отсутствует`,
      },
    };
  }
  return validateParameterManifest(raw, MANIFEST_INTEGRITY[calcVersion]);
}

/** Диагностика: integrity известного manifest (не является read-path Engine). */
export function computeKnownManifestIntegrity(calcVersion: string): string | undefined {
  const raw = MANIFEST_SOURCE[calcVersion];
  return raw ? computeManifestIntegrity(raw) : undefined;
}

/** Read-only список известных calcVersion (для diagnostics/tests). */
export function listParameterManifestVersions(): string[] {
  return Object.keys(MANIFEST_SOURCE).sort();
}
