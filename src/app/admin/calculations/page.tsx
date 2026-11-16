import type { Metadata } from "next";
import Link from "next/link";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import { listInspectorProjects } from "@/lib/admin/calculation-inspector";

import { sectionMetadata } from "../_components/section-route";

export const metadata: Metadata = sectionMetadata("calculations");
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  ok: "ok",
  legacy_no_snapshot: "legacy без снимка",
  snapshot_unknown: "снимок не найден",
  snapshot_corrupt: "снимок повреждён",
  snapshot_invalid: "снимок невалиден",
  rules_invalid: "ошибки правил",
  required_rules_missing: "нет обязательных норм",
  project_invalid: "проект невалиден",
  "требуется проверка": "требуется проверка",
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function formatDate(value: string): string {
  if (value === "—") return value;
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function CalculationsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const kind = single(raw.kind);
  const status = single(raw.status);
  const query = (single(raw.q) ?? "").trim().toLowerCase();

  const { projects, issues } = await listInspectorProjects();
  const rows = projects.filter(
    (project) =>
      (kind === undefined || project.kind === kind) &&
      (status === undefined || project.diagnosticsStatus === status) &&
      (query.length === 0 ||
        project.id.toLowerCase().includes(query) ||
        project.priceVersion.toLowerCase().includes(query)),
  );

  const statuses = [...new Set(projects.map((project) => project.diagnosticsStatus))];

  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">{ADMIN_SECTIONS.find((s) => s.id === "calculations")?.index} / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          {ADMIN_SECTIONS.find((s) => s.id === "calculations")?.title}
        </h1>
        <p className="body-copy mt-3">
          Сохранённые расчёты проектов. Открывается проект → модули → строки
          стоимости → правила и версии. Отсутствующая трассировка показывается
          явно и не восстанавливается задним числом.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <span className="chip chip-copper">read-only</span>
        <span className="chip">проектов: {projects.length}</span>
        <span className="chip">
          без rulesSnapshot: {projects.filter((project) => !project.rulesSnapshotId).length}
        </span>
        <span className="chip">
          без priceHistory: {projects.filter((project) => project.historyCount === 0).length}
        </span>
      </div>

      {issues.length > 0 ? (
        <ul className="mb-4 rounded-2xl border border-red-700/20 bg-red-600/8 px-5 py-4 text-[0.78rem] text-red-900">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}

      <form
        method="get"
        action="/admin/calculations"
        className="card-surface grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
      >
        <label className="field">
          <span className="field-label">Поиск по проекту / версии прайса</span>
          <input
            type="search"
            name="q"
            defaultValue={single(raw.q) ?? ""}
            placeholder="project-id"
            className="input"
          />
        </label>
        <label className="field">
          <span className="field-label">Тип</span>
          <select name="kind" defaultValue={kind ?? ""} className="select">
            <option value="">Все</option>
            <option value="kitchen">Кухня</option>
            <option value="wardrobe">Шкаф</option>
            <option value="unknown">Неизвестно</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Диагностика</span>
          <select name="status" defaultValue={status ?? ""} className="select">
            <option value="">Все</option>
            {statuses.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary btn-sm">
          Применить
        </button>
      </form>

      <p className="mt-3 text-[0.7rem] text-ink/45">
        Показано {rows.length} из {projects.length}.
      </p>

      <section className="card-surface mt-3 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[62rem] text-left text-[0.76rem]">
            <thead className="bg-white/25 text-[0.6rem] uppercase tracking-[0.12em] text-ink/42">
              <tr>
                <th className="px-5 py-3 font-semibold">Проект</th>
                <th className="px-4 py-3 font-semibold">Тип</th>
                <th className="px-4 py-3 font-semibold">Итого</th>
                <th className="px-4 py-3 font-semibold">Версии</th>
                <th className="px-4 py-3 font-semibold">rulesSnapshot</th>
                <th className="px-4 py-3 font-semibold">Диагностика</th>
                <th className="px-4 py-3 font-semibold">История</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((project) => (
                <tr key={project.id} className="border-t border-ink/7 align-top">
                  <td className="px-5 py-3">
                    <Link
                      href={`/admin/calculations/${encodeURIComponent(project.id)}`}
                      className="font-semibold text-ink/85 underline decoration-ink/20 underline-offset-2 hover:decoration-copper"
                    >
                      {project.title}
                    </Link>
                    <p className="mt-0.5 break-all font-mono text-[0.64rem] text-ink/45">
                      {project.id}
                    </p>
                    <p className="mt-1 text-[0.66rem] text-ink/40">
                      обновлён {formatDate(project.updatedAt)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-ink/62">{project.kind}</td>
                  <td className="px-4 py-3 font-semibold">
                    {formatMoney(project.total)} {project.currency}
                  </td>
                  <td className="px-4 py-3 text-ink/62">
                    <p>schema {project.schemaVersion}</p>
                    <p>calc {project.calcVersion}</p>
                    <p>price {project.priceVersion}</p>
                  </td>
                  <td className="px-4 py-3 text-ink/62">
                    {project.rulesSnapshotId ?? (
                      <span className="text-amber-900">legacy — отсутствует</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink/62">
                    {STATUS_LABELS[project.diagnosticsStatus] ?? project.diagnosticsStatus}
                  </td>
                  <td className="px-4 py-3 text-ink/62">{project.historyCount}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-ink/50">
                    Расчёты не найдены. Демонстрационные проекты не подставляются.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card-surface mt-4 px-5 py-5 text-[0.75rem] leading-relaxed text-ink/60">
        <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
          Границы трассировки
        </h2>
        <p className="mt-2">
          В сохранённом Breakdown нет `priceItemId` и нормы количества для
          конкретного компонента. Inspector показывает строки стоимости,
          метаданные строк, статическую связь `ManagedRule.assigns =
          line:&lt;id&gt;`, закреплённые версии и состав проекта. Количество и
          цена компонента не реконструируются.
        </p>
      </section>
    </>
  );
}
