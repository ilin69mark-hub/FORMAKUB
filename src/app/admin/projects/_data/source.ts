import { listRecalculationBatches, listProjectRecalculations } from "@/lib/admin/jobs";
import { getPublishedVersion } from "@/lib/admin/pricing";
import type {
  HistoryReason,
  ProjectMeta,
  ProjectPriceHistory,
  RecalculationBoard,
} from "@/lib/admin/projects-ui";
import type {
  ProjectRecalculation as SchemaJob,
  RecalculationBatch as SchemaBatch,
} from "@/lib/admin/schema";
import type { StoredProject } from "@/lib/configurator/types";
import { readCollection } from "@/lib/server/store";

/**
 * CA-T-505 — реальный источник проектов/пересчёта.
 *
 * Чтение: существующие сервисы jobs/pricing + Storage Adapter. Мутации
 * (create batch/retry/cancel) выполняются защищёнными admin-API из
 * клиентских компонентов; сам UI пересчёт не запускает.
 */

function toProjectMeta(project: StoredProject): ProjectMeta {
  return {
    id: project.id,
    title: `${project.config.kind === "kitchen" ? "Кухня" : "Шкаф"} ${project.id}`,
    type: project.config.kind,
  };
}

function toHistory(
  project: StoredProject,
  event: NonNullable<StoredProject["priceHistory"]>[number],
): ProjectPriceHistory {
  return {
    id: event.id,
    projectId: project.id,
    operationId: event.operationId,
    jobId: null,
    attemptId: null,
    reason: event.reason as HistoryReason,
    fromPriceVersionId: event.fromPriceVersionId,
    toPriceVersionId: event.toPriceVersionId,
    calcVersion: event.calcVersion,
    prevCalcVersion: null,
    schemaVersion: event.schemaVersion,
    oldPrice: event.oldPrice,
    newPrice: event.newPrice,
    delta: event.delta,
    breakdown: event.breakdown as unknown as Record<string, unknown>,
    breakdownVersion: event.breakdownVersion,
    computedAt: event.computedAt,
  };
}

export async function getRecalculationBoard(): Promise<RecalculationBoard> {
  const [published, batches, projects, jobs] = await Promise.all([
    getPublishedVersion(),
    listRecalculationBatches(),
    readCollection<StoredProject>("projects.json"),
    listProjectRecalculations(),
  ]);

  const orderedBatches = [...batches].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  const batch: SchemaBatch | null = orderedBatches[0] ?? null;

  const history = projects
    .flatMap((project) =>
      (project.priceHistory ?? []).map((event) => toHistory(project, event)),
    )
    .sort((a, b) => b.computedAt.localeCompare(a.computedAt));

  const activeJobs: SchemaJob[] = batch
    ? jobs.filter((job) => job.batchId === batch.id)
    : [];

  return {
    publishedVersionId: published?.id ?? null,
    batch,
    jobs: activeJobs,
    history,
    projects: projects.map(toProjectMeta),
  };
}
