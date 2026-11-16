import Link from "next/link";
import { notFound } from "next/navigation";

import { diagnoseProjectRules } from "@/lib/admin/rules-diagnostics";

export const dynamic = "force-dynamic";

export default async function ProjectRulesDiagnosticsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const result = await diagnoseProjectRules(projectId);
  if (!result.ok) notFound();
  const diagnosis = result.data;

  return (
    <main className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Проект {diagnosis.projectId}</h1>
        <p className="text-sm text-neutral-600">
          Статус: {diagnosis.status}. {diagnosis.reason}
        </p>
        <Link href="/admin/rules/diagnostics" className="text-sm underline">
          ← Диагностика
        </Link>
      </header>

      <section className="grid gap-2 text-sm md:grid-cols-2">
        <p>Тип: {diagnosis.kind ?? "—"}</p>
        <p>Закреплённый снимок: {diagnosis.pinnedSnapshotId ?? "нет (legacy)"}</p>
        <p>Активный снимок: {diagnosis.activeSnapshotId ?? "нет"}</p>
        <p>Обязательных норм не найдено: {diagnosis.missingRequiredRuleIds.length}</p>
      </section>

      {diagnosis.issues.length > 0 && (
        <section className="space-y-1">
          <h2 className="font-semibold">Проблемы</h2>
          <ul className="list-disc rounded border border-red-300 bg-red-50 p-3 pl-6 text-sm">
            {diagnosis.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </section>
      )}

      {diagnosis.missingRequiredRuleIds.length > 0 && (
        <section className="space-y-1">
          <h2 className="font-semibold">Отсутствующие обязательные правила</h2>
          <p className="font-mono text-xs">
            {diagnosis.missingRequiredRuleIds.join(", ")}
          </p>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Применённые правила ({diagnosis.appliedRules.length})</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-2">id</th>
              <th className="p-2">Версия</th>
              <th className="p-2">Статус</th>
              <th className="p-2">Источник</th>
              <th className="p-2">assigns</th>
              <th className="p-2">CalculationLineId</th>
            </tr>
          </thead>
          <tbody>
            {diagnosis.appliedRules.map((rule) => (
              <tr key={rule.id} className="border-b">
                <td className="p-2 font-mono text-xs">{rule.id}</td>
                <td className="p-2">{rule.version}</td>
                <td className="p-2">{rule.status}</td>
                <td className="p-2">{rule.source}</td>
                <td className="p-2 font-mono text-xs">{rule.assigns}</td>
                <td className="p-2 font-mono text-xs">
                  {rule.lineIds.length > 0 ? rule.lineIds.join(", ") : "—"}
                </td>
              </tr>
            ))}
            {diagnosis.appliedRules.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3 text-neutral-500">
                  Правила не применяются (снимок не разрешён).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
