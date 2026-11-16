import type { PricingVersion } from "./schema";
import type { StoredProject } from "@/lib/configurator/types";
import { readCollection } from "@/lib/server/store";
import {
  createProjectRecalculation,
  createRecalculationBatch,
  refreshRecalculationBatchCounters,
  type JobModelIssue,
} from "./jobs";

/**
 * Stage 8 / Block 2: идемпотентная связка публикации цены и batch пересчёта.
 *
 * Batch id детерминирован от published PricingVersion. Повторный вызов
 * возвращает существующий batch и досоздаёт только отсутствующие jobs.
 */

export interface PublishRecalcResult {
  batchId: string;
  totalProjects: number;
  createdJobs: number;
  skippedProjects: number;
  issues: JobModelIssue[];
}

export function publishBatchId(versionId: string): string {
  return `batch-publish-${versionId}`;
}

export async function ensurePublishRecalculationBatch(
  version: PricingVersion,
  createdBy: string,
): Promise<PublishRecalcResult> {
  const batchId = publishBatchId(version.id);
  const batch = await createRecalculationBatch({
    id: batchId,
    priceVersionId: version.id,
    trigger: "publish",
    createdBy,
  });
  if (!batch.ok) {
    throw new Error(
      `Batch публикации не создан: ${batch.issues.map((item) => item.message).join("; ")}`,
    );
  }

  const projects = await readCollection<StoredProject>("projects.json");
  let createdJobs = 0;
  let skippedProjects = 0;
  const issues: JobModelIssue[] = [];

  for (const project of projects) {
    if (project.priceVersion === version.id) {
      skippedProjects += 1;
      continue;
    }
    const result = await createProjectRecalculation({
      batchId,
      projectId: project.id,
      toPriceVersionId: version.id,
      calcVersion: project.calcVersion ?? "unknown",
      deltaReason: "price_publish",
      createdBy,
    });
    if (result.ok) {
      if (result.created) createdJobs += 1;
    } else {
      // Ошибка одного проекта не должна останавливать остальные.
      issues.push(...result.issues);
    }
  }

  await refreshRecalculationBatchCounters(batchId);
  return {
    batchId,
    totalProjects: projects.length,
    createdJobs,
    skippedProjects,
    issues,
  };
}
