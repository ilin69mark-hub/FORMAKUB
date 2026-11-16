import { readCollection } from "@/lib/server/store";

import {
  getDraftComposition,
  getPublishedComposition,
  listCompositionIssues,
  listCompositionVersions,
  validateCompositionVersion,
} from "./composition";
import {
  KITCHEN_MODULE_TYPES,
  type CompositionIssue,
  type CompositionVersion,
} from "./composition-schema";
import { getModuleComposition } from "./catalog-model";
import { listManagedRules } from "./managed-rules";
import { listPriceItems } from "./price-items";
import type { CatalogItem } from "./schema";

export interface CompositionModuleSummary {
  type: (typeof KITCHEN_MODULE_TYPES)[number];
  label: string;
  lineCount: number;
  errorCount: number;
  warningCount: number;
  hasPublished: boolean;
  hasDraft: boolean;
}

export interface CompositionBoard {
  versions: CompositionVersion[];
  published: CompositionVersion | null;
  draft: CompositionVersion | null;
  modules: CompositionModuleSummary[];
  validation: {
    published: CompositionIssue[];
    draft: CompositionIssue[];
  };
  issues: string[];
}

export interface CompositionOptions {
  catalogs: CatalogItem[];
  prices: Awaited<ReturnType<typeof listPriceItems>>;
  rules: Awaited<ReturnType<typeof listManagedRules>>;
  versions: CompositionVersion[];
}

export async function getCompositionBoard(): Promise<CompositionBoard> {
  const issues: string[] = [];
  let versions: CompositionVersion[] = [];
  let published: CompositionVersion | null = null;
  let draft: CompositionVersion | null = null;
  try {
    const storeIssues = await listCompositionIssues();
    if (storeIssues.length > 0) issues.push(...storeIssues);
    [versions, published, draft] = await Promise.all([
      listCompositionVersions(),
      getPublishedComposition().then((value) => value ?? null),
      getDraftComposition().then((value) => value ?? null),
    ]);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  const publishedValidation = published
    ? await validateCompositionVersion(published)
    : null;
  const draftValidation = draft ? await validateCompositionVersion(draft) : null;
  const publishedIssues = [
    ...(publishedValidation?.errors ?? []),
    ...(publishedValidation?.warnings ?? []),
  ];
  const draftIssues = [
    ...(draftValidation?.errors ?? []),
    ...(draftValidation?.warnings ?? []),
  ];

  const lineType = new Map<string, string>();
  for (const line of [...(draft?.lines ?? []), ...(published?.lines ?? [])]) {
    lineType.set(line.id, line.moduleType);
  }

  const modules = KITCHEN_MODULE_TYPES.map((type) => {
    const composition = getModuleComposition(type);
    const lineCount = (draft ?? published)?.lines.filter(
      (line) => line.moduleType === type,
    ).length ?? 0;
    const relevant = (issues: CompositionIssue[]) =>
      issues.filter(
        (issue) =>
          (issue.lineId && lineType.get(issue.lineId) === type) ||
          issue.entityId === type,
      );
    return {
      type,
      label: composition?.label ?? type,
      lineCount,
      errorCount: relevant([
        ...(publishedValidation?.errors ?? []),
        ...(draftValidation?.errors ?? []),
      ]).length,
      warningCount: relevant([
        ...(publishedValidation?.warnings ?? []),
        ...(draftValidation?.warnings ?? []),
      ]).length,
      hasPublished: Boolean(published),
      hasDraft: Boolean(draft),
    };
  });

  return {
    versions,
    published,
    draft,
    modules,
    validation: { published: publishedIssues, draft: draftIssues },
    issues,
  };
}

export async function getCompositionOptions(): Promise<CompositionOptions> {
  const [catalogs, prices, rules, versions] = await Promise.all([
    readCollection<CatalogItem>("catalog-items.json"),
    listPriceItems(),
    listManagedRules(),
    listCompositionVersions(),
  ]);
  return { catalogs, prices, rules, versions };
}
