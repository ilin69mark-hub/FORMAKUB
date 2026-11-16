import Link from "next/link";

import {
  RULE_CATEGORIES,
  RULE_SCOPES,
  listManagedRules,
  listRulesSnapshots,
  resolveActiveRulesSnapshot,
} from "@/lib/admin/managed-rules";

import { RulesBoard } from "./RulesBoard";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  quantity: "Количество",
  purpose: "Назначение",
  norm: "Норма",
  condition: "Условие",
};

export default async function RulesPage() {
  const [rules, snapshots, active] = await Promise.all([
    listManagedRules(),
    listRulesSnapshots(),
    resolveActiveRulesSnapshot(),
  ]);

  const preliminary = rules.filter((rule) => rule.source === "preliminary").length;
  const draft = rules.filter((rule) => rule.status === "draft").length;

  return (
    <main className="space-y-4">
      <header className="space-y-2">
        <h1 className="font-display text-3xl leading-tight">Правила комплектации</h1>
        <p className="max-w-3xl text-[0.8rem] leading-relaxed text-ink/60">
          Управляемые нормы (ADR-07): draft → публикация неизменяемого снимка;
          изменение опубликованных редакций — только новой draft-редакцией.
          Компоненты и условия — данные; формулы остаются в коде.
        </p>
        <div className="flex flex-wrap gap-2">
          <span className="chip chip-copper">Managed Rules</span>
          <span className="chip">всего: {rules.length}</span>
          <span className="chip">draft: {draft}</span>
          <span className="chip">preliminary: {preliminary}</span>
          <span className="chip">снимков: {snapshots.length}</span>
          <span className="chip">
            активный: {active.status === "ok" ? active.snapshot.id : "нет"}
          </span>
          <Link href="/admin/data-sources?kind=rule" className="chip">
            Источники норм →
          </Link>
          <Link href="/admin/rules/diagnostics" className="chip">
            Диагностика правил и проектов →
          </Link>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {RULE_CATEGORIES.map((category) => (
            <span key={category} className="rounded-full border border-ink/10 bg-white/40 px-2.5 py-1 text-[0.6rem] text-ink/55">
              {CATEGORY_LABELS[category] ?? category}:{" "}
              {rules.filter((rule) => rule.category === category).length}
            </span>
          ))}
          {RULE_SCOPES.map((scope) => (
            <span key={scope} className="rounded-full border border-ink/10 bg-white/40 px-2.5 py-1 text-[0.6rem] text-ink/55">
              {scope}: {rules.filter((rule) => rule.scope === scope).length}
            </span>
          ))}
        </div>
      </header>

      {rules.length === 0 ? (
        <section className="card-surface px-6 py-8 text-[0.78rem] leading-relaxed text-ink/60">
          Правила отсутствуют. Seed не применяется автоматически; публикация без
          предварительно загруженных draft-правил невозможна.
        </section>
      ) : null}

      <RulesBoard
        initialRules={rules}
        initialSnapshots={snapshots}
        initialActive={active.status === "ok" ? active.snapshot : null}
      />
    </main>
  );
}
