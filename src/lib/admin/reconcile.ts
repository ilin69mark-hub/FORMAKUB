import { findDuplicates, type ProjectRecalculation, type RecalculationBatch } from "./schema";
import {
  BATCHES_COLLECTION,
  JOBS_COLLECTION,
  createProjectRecalculation,
  listProjectRecalculations,
  refreshRecalculationBatchCounters,
} from "./jobs";
import { readCollection } from "@/lib/server/store";
import type { StoredProject } from "@/lib/configurator/types";

/**
 * CA-T-408 — идемпотентная сверка заданий и batch-счётчиков.
 *
 * Не запускает расчёт и не создаёт worker/HTTP. Дозаполняет отсутствующие
 * задания для существующих batch, пересчитывает счётчики и сообщает
 * обнаруженные нарушения целостности. Повторный запуск без разрывов
 * не создаёт новых заданий и не меняет данные.
 */

export type ReconcileIssueCode =
  | "ORPHAN_BATCH"
  | "DUPLICATE_JOB_KEY"
  | "COMPLETED_WITHOUT_PROJECT"
  | "COMPLETED_WRONG_PRICE_VERSION"
  | "PROJECT_CALC_VERSION_MISSING";

export interface ReconcileIssue {
  code: ReconcileIssueCode;
  message: string;
  jobId?: string;
  projectId?: string;
  batchId?: string;
}

export interface ReconcileReport {
  batches: number;
  jobsBefore: number;
  createdJobs: number;
  issues: ReconcileIssue[];
}

function jobKey(job: Pick<ProjectRecalculation, "batchId" | "projectId" | "toPriceVersionId">): string {
  return `${job.batchId}:${job.projectId}:${job.toPriceVersionId}`;
}

export async function reconcileRecalculationState(): Promise<ReconcileReport> {
  const [batches, beforeJobs, projects] = await Promise.all([
    readCollection<RecalculationBatch>(BATCHES_COLLECTION),
    readCollection<ProjectRecalculation>(JOBS_COLLECTION),
    readCollection<StoredProject>("projects.json"),
  ]);

  const issues: ReconcileIssue[] = [];
  const batchIds = new Set(batches.map((batch) => batch.id));
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  for (const job of beforeJobs) {
    if (!batchIds.has(job.batchId)) {
      issues.push({
        code: "ORPHAN_BATCH",
        message: `задание ${job.id} ссылается на отсутствующий batch ${job.batchId}`,
        jobId: job.id,
        batchId: job.batchId,
      });
    }
    if (job.status === "completed") {
      const project = projectsById.get(job.projectId);
      if (!project) {
        issues.push({
          code: "COMPLETED_WITHOUT_PROJECT",
          message: `completed job ${job.id}: проект ${job.projectId} не найден`,
          jobId: job.id,
          projectId: job.projectId,
        });
      } else if (project.priceVersion !== job.toPriceVersionId) {
        issues.push({
          code: "COMPLETED_WRONG_PRICE_VERSION",
          message: `completed job ${job.id}: project priceVersion "${project.priceVersion ?? "нет"}" ≠ target "${job.toPriceVersionId}"`,
          jobId: job.id,
          projectId: job.projectId,
        });
      }
    }
  }

  const duplicates = findDuplicates(beforeJobs, jobKey);
  for (const key of duplicates) {
    issues.push({
      code: "DUPLICATE_JOB_KEY",
      message: `дублирующийся U-ключ задания: ${key}`,
    });
  }

  let createdJobs = 0;
  for (const batch of batches) {
    const existingJobs = await listProjectRecalculations({ batchId: batch.id });
    const existingKeys = new Set(existingJobs.map(jobKey));
    for (const project of projects) {
      const key = `${batch.id}:${project.id}:${batch.priceVersionId}`;
      if (existingKeys.has(key)) continue;
      if (project.calcVersion === undefined) {
        issues.push({
          code: "PROJECT_CALC_VERSION_MISSING",
          message: `проект ${project.id} без calcVersion; задание не создано`,
          projectId: project.id,
          batchId: batch.id,
        });
        continue;
      }
      const created = await createProjectRecalculation({
        batchId: batch.id,
        projectId: project.id,
        toPriceVersionId: batch.priceVersionId,
        calcVersion: project.calcVersion,
        deltaReason: batch.trigger === "publish" ? "price_publish" : "manual",
        createdBy: "system:reconcile",
      });
      if (!created.ok) {
        issues.push({
          code: "ORPHAN_BATCH",
          message: `не удалось создать задание для ${project.id}: ${created.issues.map((item) => item.message).join("; ")}`,
          projectId: project.id,
          batchId: batch.id,
        });
        continue;
      }
      if (created.created) {
        createdJobs += 1;
        existingKeys.add(key);
      }
    }
    await refreshRecalculationBatchCounters(batch.id);
  }

  return {
    batches: batches.length,
    jobsBefore: beforeJobs.length,
    createdJobs,
    issues,
  };
}
