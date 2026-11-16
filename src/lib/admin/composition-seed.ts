import {
  MODULE_COMPOSITION,
  type ModuleComponent,
} from "./catalog-model";
import {
  createCompositionDraft,
  getDraftComposition,
  getPublishedComposition,
} from "./composition";
import { codeRefForEvidence } from "./composition-code-registry";
import type { ActorContext } from "./parameters";
import type { CompositionLine, CompositionModuleType } from "./composition-schema";

/**
 * Детерминированный начальный импорт управляемого состава из статического
 * read-model `MODULE_COMPOSITION`.
 *
 * - создаёт только draft;
 * - не публикует;
 * - не перезаписывает существующие версии;
 * - переносит только строки, которые можно выразить без выдуманных данных;
 * - строки помечаются source=preliminary (код-производные, не owner_confirmed);
 * - структурные элементы без CatalogItem/PriceItem (например, перегородка
 *   мойки) не создаются фиктивно и возвращаются в `skipped`.
 */

export const INITIAL_COMPOSITION_ID = "composition-2026.11.1";

function lineId(moduleType: string, componentId: string, suffix = ""): string {
  return `line-${moduleType}-${componentId}${suffix}`;
}

function componentLines(
  moduleType: CompositionModuleType,
  component: ModuleComponent,
  startSort: number,
): { lines: CompositionLine[]; skipped: string[] } {
  const implementationId = codeRefForEvidence(component.evidence);
  if (!implementationId) {
    return {
      lines: [],
      skipped: [`${moduleType}:${component.id} — нет зарегистрированного codeRef`],
    };
  }
  const base = {
    moduleType,
    relation: component.relation,
    ...(component.condition
      ? { condition: { kind: "text" as const, text: component.condition } }
      : {}),
    quantityRef: {
      kind: "code" as const,
      implementationId,
    },
    sourceRef: component.evidence,
    source: "preliminary" as const,
    notes: component.label,
  };
  const componentRef = component.catalog
    ? {
        componentCatalog: component.catalog.kind,
        ...(component.catalog.id ? { componentId: component.catalog.id } : {}),
      }
    : {};
  const prices = [...component.priceItemIds];

  if (prices.length === 0) {
    if (!component.catalog) {
      return {
        lines: [],
        skipped: [`${moduleType}:${component.id} — нет CatalogItem/PriceItem`],
      };
    }
    return {
      lines: [
        {
          id: lineId(moduleType, component.id),
          ...base,
          ...componentRef,
          sortOrder: startSort,
        },
      ],
      skipped: [],
    };
  }

  return {
    lines: prices.map((priceItemId, index) => ({
      id: lineId(
        moduleType,
        component.id,
        prices.length > 1 ? `-${index + 1}` : "",
      ),
      ...base,
      ...componentRef,
      priceItemId,
      sortOrder: startSort + index,
    })),
    skipped: [],
  };
}

export function buildInitialCompositionLines(): {
  lines: CompositionLine[];
  skipped: string[];
} {
  const lines: CompositionLine[] = [];
  const skipped: string[] = [];
  let sortOrder = 10;
  for (const moduleType of MODULE_COMPOSITION) {
    for (const component of moduleType.components) {
      const built = componentLines(
        moduleType.type as CompositionModuleType,
        component,
        sortOrder,
      );
      lines.push(...built.lines);
      skipped.push(...built.skipped);
      sortOrder += Math.max(1, built.lines.length) * 10;
    }
  }
  return { lines, skipped };
}

export interface CompositionSeedResult {
  created: boolean;
  versionId: string;
  status: "draft" | "published" | "superseded";
  lines: number;
  skipped: string[];
}

export async function seedInitialCompositionDraft(
  actor: ActorContext,
): Promise<CompositionSeedResult> {
  const published = await getPublishedComposition();
  if (published) {
    return {
      created: false,
      versionId: published.id,
      status: published.status,
      lines: published.lines.length,
      skipped: [],
    };
  }
  const draft = await getDraftComposition();
  if (draft) {
    return {
      created: false,
      versionId: draft.id,
      status: draft.status,
      lines: draft.lines.length,
      skipped: [],
    };
  }

  const { lines, skipped } = buildInitialCompositionLines();
  const created = await createCompositionDraft(
    {
      id: INITIAL_COMPOSITION_ID,
      lines,
      migration: {
        skipped,
        createdAt: new Date().toISOString(),
      },
      notes:
        "Начальный импорт MODULE_COMPOSITION. source=preliminary; требуется подтверждение норм и тарифов перед публикацией.",
    },
    actor,
  );

  return {
    created: true,
    versionId: created.id,
    status: created.status,
    lines: created.lines.length,
    skipped,
  };
}
