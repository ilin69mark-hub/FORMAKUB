import Link from "next/link";

import { diagnoseManagedRules, diagnoseProjectRulesList } from "@/lib/admin/rules-diagnostics";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  ok: "OK",
  legacy_no_snapshot: "Legacy без снимка",
  snapshot_unknown: "Снимок не найден",
  snapshot_corrupt: "Снимок повреждён",
  snapshot_invalid: "Снимок невалиден",
  rules_invalid: "Ошибки правил",
  required_rules_missing: "Нет обязательных норм",
  project_invalid: "Проект невалиден",
};

export default async function RulesDiagnosticsPage() {
  const { projects, storageIssues } = await diagnoseProjectRulesList();
  const rulesDiagnostics = await diagnoseManagedRules();
  const preliminary = rulesDiagnostics.rules.filter(
    (rule) => rule.source === "preliminary",
  ).length;
  const missingSeed = rulesDiagnostics.seed.filter((item) => item.status === "missing").length;
  const conflicts = rulesDiagnostics.seed.filter((item) => item.status === "conflict").length;

  return (
    <main className="space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Диагностика правил и проектов</h1>
        <p className="text-sm text-neutral-600">
          Read-only: закреплённые снимки, применённые правила и причины проблем.
          Переходы, перерасчёт и публикация здесь не выполняются.
        </p>
        <Link href="/admin/rules" className="text-sm underline">
          ← Правила
        </Link>
      </header>

      {storageIssues.length > 0 && (
        <ul className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          {storageIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      <section className="space-y-1 rounded border p-3 text-sm">
        <h2 className="font-semibold">Seed Managed Rules (D-7/D-8)</h2>
        <p>
          Ожидается правил: {rulesDiagnostics.expected}; отсутствует: {missingSeed}; конфликтов: {conflicts}; preliminary: {preliminary}.
        </p>
        <p className="text-neutral-600">
          Preliminary-правила доступны для администрирования, но не публикуются (Q7-06/D-8).
        </p>
        {rulesDiagnostics.rules.length > 0 && (
          <details>
            <summary className="cursor-pointer">Показать правила ({rulesDiagnostics.rules.length})</summary>
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {rulesDiagnostics.rules.map((rule) => (
                <li key={rule.id}>
                  {rule.id} · {rule.source} · {rule.status} · {rule.publishable ? "publishable" : rule.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="p-2">Проект</th>
            <th className="p-2">Тип</th>
            <th className="p-2">Статус</th>
            <th className="p-2">Закреплённый снимок</th>
            <th className="p-2">Причина</th>
            <th className="p-2">Проблем</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.projectId} className="border-b">
              <td className="p-2 font-mono text-xs">
                <Link
                  href={`/admin/rules/diagnostics/${project.projectId}`}
                  className="underline"
                >
                  {project.projectId}
                </Link>
              </td>
              <td className="p-2">{project.kind ?? "—"}</td>
              <td className="p-2">{STATUS_LABELS[project.status] ?? project.status}</td>
              <td className="p-2 font-mono text-xs">
                {project.pinnedSnapshotId ?? "—"}
              </td>
              <td className="p-2">{project.reason}</td>
              <td className="p-2">{project.issues.length}</td>
            </tr>
          ))}
          {projects.length === 0 && (
            <tr>
              <td colSpan={6} className="p-3 text-neutral-500">
                Проектов нет или хранилище проектов недоступно.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
