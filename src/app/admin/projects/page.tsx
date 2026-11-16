import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import { CreateBatchButton } from "@/components/admin/projects/CreateBatchButton";
import { RetryJobDialog } from "@/components/admin/projects/RetryJobDialog";
import {
  BATCH_STATUS_LABELS,
  batchProgress,
  filterHistory,
  formatDelta,
  formatRub,
  HISTORY_REASON_LABELS,
  parseHistoryFilter,
  RECALC_STATUS_LABELS,
  retryAvailability,
  sortHistory,
  type HistoryReason,
  type ProjectMeta,
  type ProjectPriceHistory,
  type ProjectRecalculation,
  type RecalculationStatus,
} from "@/lib/admin/projects-ui";

import { sectionMetadata } from "../_components/section-route";
import { listInspectorProjects } from "@/lib/admin/calculation-inspector";
import { getRecalculationBoard } from "./_data/source";

export const metadata: Metadata = sectionMetadata("projects");
export const dynamic = "force-dynamic";

const JOB_STATUS_STYLE: Record<RecalculationStatus, string> = {
  pending: "border-ink/15 bg-ink/5 text-ink/65",
  running: "border-copper/35 bg-copper/12 text-[#7c4f2c]",
  completed: "border-emerald-700/20 bg-emerald-600/10 text-emerald-900",
  failed: "border-red-700/20 bg-red-600/10 text-red-900",
  cancelled: "border-ink/15 bg-ink/5 text-ink/55",
  skipped: "border-amber-700/25 bg-amber-500/12 text-amber-950",
  dead_letter: "border-red-800/25 bg-red-700/15 text-red-950",
};

function JobStatusBadge({ status }: { status: RecalculationStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.08em] ${JOB_STATUS_STYLE[status]}`}
    >
      {RECALC_STATUS_LABELS[status]}
    </span>
  );
}

function ProgressBar({
  percent,
  batch,
}: {
  percent: number;
  batch: {
    totalCount: number;
    completedCount: number;
    failedCount: number;
    skippedCount: number;
    runningCount: number;
    pendingCount: number;
  };
}) {
  const width = (count: number) =>
    batch.totalCount === 0 ? 0 : (count / batch.totalCount) * 100;
  return (
    <div>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-ink/8"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Прогресс батча"
      >
        <span className="bg-emerald-600" style={{ width: `${width(batch.completedCount)}%` }} />
        <span className="bg-red-600" style={{ width: `${width(batch.failedCount)}%` }} />
        <span className="bg-amber-500" style={{ width: `${width(batch.skippedCount)}%` }} />
        <span className="bg-copper" style={{ width: `${width(batch.runningCount)}%` }} />
        <span className="bg-ink/20" style={{ width: `${width(batch.pendingCount)}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.66rem] text-ink/55">
        <span>выполнено: {batch.completedCount}</span>
        <span>ошибки: {batch.failedCount}</span>
        <span>пропущено: {batch.skippedCount}</span>
        <span>выполняется: {batch.runningCount}</span>
        <span>в очереди: {batch.pendingCount}</span>
        <span className="font-semibold text-ink/70">{percent}%</span>
      </div>
    </div>
  );
}

function projectOf(
  projects: ProjectMeta[],
  projectId: string,
): ProjectMeta | undefined {
  return projects.find((project) => project.id === projectId);
}

function JobRow({
  job,
  project,
}: {
  job: ProjectRecalculation;
  project: ProjectMeta | undefined;
}) {
  const availability = retryAvailability(job);
  return (
    <tr className="border-t border-ink/7 align-top">
      <td className="px-5 py-3">
        <p className="font-medium">{project?.title ?? job.projectId}</p>
        <code className="text-[0.66rem] text-ink/45">{job.projectId}</code>
        <p className="text-[0.62rem] text-ink/35">{project?.type ?? "—"}</p>
      </td>
      <td className="px-4 py-3">
        <JobStatusBadge status={job.status} />
        <p className="mt-1 text-[0.62rem] text-ink/40">
          attempt {job.attempt}/{job.maxAttempts}
        </p>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-ink/72">
        {formatRub(job.oldPrice)}
        <span className="mx-1 text-ink/35">→</span>
        {formatRub(job.newPrice)}
        <p className="text-[0.64rem] text-ink/45">
          Δ {formatDelta(job.oldPrice, job.newPrice)}
        </p>
      </td>
      <td className="max-w-[18rem] px-4 py-3">
        {job.error ? (
          <div>
            <code className="text-[0.66rem] text-red-900">{job.error.code}</code>
            <p className="mt-1 text-[0.68rem] leading-relaxed text-ink/55">
              {job.error.message}
            </p>
            <p className="mt-1 text-[0.62rem] text-ink/40">
              retryable: {job.error.retryable ? "true" : "false"}
            </p>
          </div>
        ) : (
          <span className="text-[0.7rem] text-ink/35">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-[0.68rem] text-ink/45">
        {job.lastHeartbeatAt ?? "—"}
      </td>
      <td className="px-5 py-3">
        {availability.allowed ? (
          <RetryJobDialog
            jobId={job.id}
            projectId={job.projectId}
            projectTitle={project?.title ?? job.projectId}
            status={job.status}
            attempt={job.attempt}
            maxAttempts={job.maxAttempts}
            errorMessage={job.error?.message ?? null}
          />
        ) : (
          <span className="text-[0.66rem] text-ink/40">{availability.reason}</span>
        )}
      </td>
    </tr>
  );
}

function HistoryTable({
  entries,
  projects,
}: {
  entries: ProjectPriceHistory[];
  projects: ProjectMeta[];
}) {
  if (entries.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
          Нет совпадений
        </p>
        <h3 className="font-display mt-3 text-xl">
          История не найдена по фильтрам
        </h3>
        <Link href="/admin/projects" className="btn btn-glass btn-sm mt-4">
          Сбросить фильтры
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[68rem] text-left text-[0.74rem]">
        <thead className="bg-white/25 text-[0.58rem] uppercase tracking-[0.1em] text-ink/42">
          <tr>
            <th className="px-5 py-3 font-semibold">Событие</th>
            <th className="px-4 py-3 font-semibold">Проект</th>
            <th className="px-4 py-3 font-semibold">Причина</th>
            <th className="px-4 py-3 font-semibold">Версии прайса</th>
            <th className="px-4 py-3 font-semibold">Стоимость</th>
            <th className="px-4 py-3 font-semibold">calcVersion</th>
            <th className="px-5 py-3 font-semibold">Детали</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const project = projectOf(projects, entry.projectId);
            return (
              <tr key={entry.id} className="border-t border-ink/7 align-top">
                <td className="px-5 py-3 text-ink/62">
                  <span className="font-mono text-[0.68rem]">
                    {entry.computedAt}
                  </span>
                  <p className="mt-1 text-[0.62rem] text-ink/35">{entry.id}</p>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/calculations/${encodeURIComponent(entry.projectId)}`}
                    className="font-medium underline decoration-ink/20 underline-offset-2 hover:decoration-copper"
                  >
                    {project?.title ?? entry.projectId}
                  </Link>
                  <code className="block text-[0.62rem] text-ink/45">
                    {entry.projectId}
                  </code>
                </td>
                <td className="px-4 py-3 text-ink/62">
                  {HISTORY_REASON_LABELS[entry.reason]}
                </td>
                <td className="px-4 py-3 text-[0.68rem] text-ink/62">
                  {entry.fromPriceVersionId ?? "—"} → {entry.toPriceVersionId}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {formatRub(entry.oldPrice)}
                  <span className="mx-1 text-ink/35">→</span>
                  {formatRub(entry.newPrice)}
                  <p className="text-[0.64rem] text-ink/45">
                    Δ {formatRub(entry.delta)}
                  </p>
                </td>
                <td className="px-4 py-3 text-[0.68rem] text-ink/62">
                  {entry.calcVersion}
                  {entry.prevCalcVersion ? (
                    <p className="text-[0.62rem] text-ink/40">
                      prev: {entry.prevCalcVersion}
                    </p>
                  ) : null}
                </td>
                <td className="px-5 py-3 text-[0.66rem] text-ink/45">
                  <p>breakdown v{entry.breakdownVersion}</p>
                  <p>schema v{entry.schemaVersion}</p>
                  <p className="break-all">job: {entry.jobId ?? "—"}</p>
                  <p className="break-all">attempt: {entry.attemptId ?? "—"}</p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const single = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : undefined;
  const filter = parseHistoryFilter({
    projectId: single(raw.projectId),
    reason: single(raw.reason),
  });

  let board = null;
  let loadError: string | null = null;
  try {
    board = await getRecalculationBoard();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Неизвестная ошибка.";
  }

  const projectList = await listInspectorProjects();

  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">08 / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          {ADMIN_SECTIONS[8].title}
        </h1>
        <p className="body-copy mt-3">
          Прогресс батча пересчёта, статусы заданий, retry и append-only история
          стоимости. Пересчёт выполняет in-process RecalculationWorker; UI
          только создаёт батч/задания и показывает состояние.
        </p>
      </div>

      <section className="card-surface mb-4 overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/8 px-5 py-4">
          <div>
            <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
              Проекты, конфигурация и закрепления
            </h2>
            <p className="mt-1 text-[0.7rem] text-ink/45">
              StoredProject.config не изменяется админкой; версии и снимки только
              читаются. Детали — в инспекторе расчётов.
            </p>
          </div>
          <Link href="/admin/calculations" className="link-line text-copper">
            Инспектор расчётов
          </Link>
        </div>
        {projectList.issues.length > 0 ? (
          <p className="border-b border-red-700/15 bg-red-600/8 px-5 py-3 text-[0.72rem] text-red-900">
            {projectList.issues.join("; ")}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[66rem] text-left text-[0.74rem]">
            <thead className="bg-white/25 text-[0.56rem] uppercase tracking-[0.12em] text-ink/42">
              <tr>
                <th className="px-5 py-3 font-semibold">Проект</th>
                <th className="px-4 py-3 font-semibold">Тип</th>
                <th className="px-4 py-3 font-semibold">Стоимость</th>
                <th className="px-4 py-3 font-semibold">Версии</th>
                <th className="px-4 py-3 font-semibold">rulesSnapshot</th>
                <th className="px-4 py-3 font-semibold">composition</th>
                <th className="px-4 py-3 font-semibold">Диагностика</th>
                <th className="px-5 py-3 font-semibold">Inspector</th>
              </tr>
            </thead>
            <tbody>
              {projectList.projects.slice(0, 50).map((project) => (
                <tr key={project.id} className="border-t border-ink/7 align-top">
                  <td className="px-5 py-3">
                    <p className="font-medium">{project.title}</p>
                    <code className="block break-all text-[0.62rem] text-ink/45">
                      {project.id}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-ink/62">{project.kind}</td>
                  <td className="px-4 py-3 font-semibold">
                    {formatRub(project.total)}
                  </td>
                  <td className="px-4 py-3 text-[0.66rem] text-ink/55">
                    <p>schema {project.schemaVersion}</p>
                    <p>calc {project.calcVersion}</p>
                    <p>price {project.priceVersion}</p>
                  </td>
                  <td className="px-4 py-3 text-[0.66rem] text-ink/55">
                    {project.rulesSnapshotId ?? (
                      <span className="text-amber-900">legacy — нет</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[0.66rem] text-ink/55">
                    {project.compositionVersionId ?? (
                      <span className="text-ink/40">не закреплён</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[0.66rem] text-ink/55">
                    {project.diagnosticsStatus}
                  </td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/admin/calculations/${encodeURIComponent(project.id)}`}
                      className="link-line text-copper"
                    >
                      Открыть
                    </Link>
                  </td>
                </tr>
              ))}
              {projectList.projects.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-ink/50">
                    Проекты отсутствуют; демонстрационные записи не подставляются.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {projectList.projects.length > 50 ? (
          <p className="border-t border-ink/7 px-5 py-3 text-[0.68rem] text-ink/45">
            Показано 50 из {projectList.projects.length}; полный список доступен в
            инспекторе с фильтрами.
          </p>
        ) : null}
      </section>

      {loadError ? (
        <section className="card-surface px-6 py-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-copper" size={20} />
            <div>
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
                Ошибка чтения
              </p>
              <h2 className="mt-2 text-lg font-semibold">
                Не удалось загрузить пересчёт
              </h2>
              <p className="mt-2 break-words text-[0.78rem] text-ink/62">
                {loadError}
              </p>
              <Link href="/admin/projects" className="btn btn-primary btn-sm mt-4">
                Повторить
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {board ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="chip chip-copper">Recalculation</span>
            <span className="chip">real data</span>
            <span className="chip">
              {board.publishedVersionId
                ? `published: ${board.publishedVersionId}`
                : "нет published"}
            </span>
          </div>

          <div className="mb-4">
            <CreateBatchButton priceVersionId={board.publishedVersionId} />
          </div>

          {board.batch ? (
          <section className="card-surface px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-copper">
                  Батч пересчёта
                </p>
                <h2 className="mt-1 break-all text-lg font-semibold">
                  {board.batch.id}
                </h2>
                <p className="mt-1 text-[0.72rem] text-ink/55">
                  версия {board.batch.priceVersionId} · trigger{" "}
                  {board.batch.trigger} · {board.batch.createdBy}
                </p>
              </div>
              <div className="text-right">
                <span className="chip chip-copper">
                  {BATCH_STATUS_LABELS[board.batch.status]}
                </span>
                <p className="mt-2 text-[0.66rem] text-ink/45">
                  начат {board.batch.startedAt}
                </p>
                <p className="text-[0.66rem] text-ink/45">
                  завершён {board.batch.finishedAt ?? "—"}
                </p>
              </div>
            </div>
            <div className="mt-5">
              <ProgressBar
                percent={batchProgress(board.batch).percent}
                batch={board.batch}
              />
            </div>
            <p className="mt-3 text-[0.68rem] text-ink/45">
              обработано {batchProgress(board.batch).processed} из{" "}
              {board.batch.totalCount} заданий (completed + failed + skipped)
            </p>
          </section>
          ) : (
            <section className="card-surface px-5 py-5 sm:px-6">
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-copper">
                Батч пересчёта
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                Батчей пересчёта пока нет
              </h2>
              <p className="mt-2 max-w-2xl text-[0.78rem] leading-relaxed text-ink/62">
                Создайте батч для опубликованной версии прайса. Задания по
                проектам создаст идемпотентная сверка, а выполнит in-process
                RecalculationWorker.
              </p>
            </section>
          )}

          <section className="card-surface mt-4 overflow-hidden">
            <div className="border-b border-ink/8 px-5 py-4">
              <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
                Задания батча
              </h2>
              <p className="mt-1 text-[0.7rem] text-ink/45">
                retry доступен только для failed/skipped/dead_letter при
                attempt &lt; maxAttempts; исполнение — RecalculationWorker.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[72rem] text-left text-[0.74rem]">
                <thead className="bg-white/25 text-[0.58rem] uppercase tracking-[0.1em] text-ink/42">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Проект</th>
                    <th className="px-4 py-3 font-semibold">Статус</th>
                    <th className="px-4 py-3 font-semibold">Стоимость</th>
                    <th className="px-4 py-3 font-semibold">Ошибка</th>
                    <th className="px-4 py-3 font-semibold">Heartbeat</th>
                    <th className="px-5 py-3 font-semibold">Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {board.jobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      project={projectOf(board.projects, job.projectId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card-surface mt-4 overflow-hidden">
            <div className="border-b border-ink/8 px-5 py-4">
              <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
                История стоимости (append-only)
              </h2>
              <p className="mt-1 text-[0.7rem] text-ink/45">
                Записи только читаются; update/delete отсутствуют (дизайн
                §6.10).
              </p>
            </div>

            <form
              method="get"
              action="/admin/projects"
              className="grid gap-3 border-b border-ink/8 px-5 py-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] lg:items-end"
            >
              <label className="field">
                <span className="field-label">Проект (id)</span>
                <input
                  type="search"
                  name="projectId"
                  defaultValue={filter.projectId ?? ""}
                  placeholder="project-001"
                  className="input"
                />
              </label>
              <label className="field">
                <span className="field-label">Причина</span>
                <select
                  name="reason"
                  defaultValue={filter.reason ?? ""}
                  className="select"
                >
                  <option value="">Все</option>
                  {(Object.keys(HISTORY_REASON_LABELS) as HistoryReason[]).map(
                    (reason) => (
                      <option key={reason} value={reason}>
                        {HISTORY_REASON_LABELS[reason]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <div className="flex gap-2">
                <button type="submit" className="btn btn-primary btn-sm">
                  Найти
                </button>
                <Link href="/admin/projects" className="btn btn-glass btn-sm">
                  Сброс
                </Link>
              </div>
            </form>

            <HistoryTable
              entries={sortHistory(filterHistory(board.history, filter))}
              projects={board.projects}
            />
          </section>
        </>
      ) : null}
    </>
  );
}
