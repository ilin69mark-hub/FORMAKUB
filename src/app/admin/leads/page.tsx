import Link from "next/link";

import { listLeads } from "@/lib/server/leads";

export const dynamic = "force-dynamic";

function money(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

const INTEREST_LABELS: Record<string, string> = {
  kitchen: "Кухня",
  wardrobe: "Шкаф",
  dressing: "Гардеробная",
  dressers: "Комоды",
  other: "Другое",
};

export default async function AdminLeadsPage() {
  const leads = await listLeads();

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-ink">Заявки</h1>
      <p className="text-[0.78rem] text-ink/55">
        {leads.length === 0
          ? "Заявок пока нет."
          : `Всего заявок: ${leads.length}. Новые сверху.`}
      </p>

      <section className="card-surface overflow-x-auto px-4 py-4">
        <table className="w-full min-w-[64rem] text-left text-[0.76rem]">
          <thead className="text-[0.56rem] uppercase tracking-[0.12em] text-ink/42">
            <tr>
              <th className="px-3 py-2 font-semibold">Дата</th>
              <th className="px-3 py-2 font-semibold">Клиент</th>
              <th className="px-3 py-2 font-semibold">Контакты</th>
              <th className="px-3 py-2 font-semibold">Тип</th>
              <th className="px-3 py-2 font-semibold">Стоимость</th>
              <th className="px-3 py-2 font-semibold">Проект</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-t border-ink/7">
                <td className="px-3 py-2 font-mono text-[0.66rem] text-ink/60">
                  {lead.createdAt.slice(0, 16).replace("T", " ")}
                </td>
                <td className="px-3 py-2">{lead.customer.name}</td>
                <td className="px-3 py-2 text-ink/65">
                  {lead.customer.contact}
                  {lead.customer.email ? ` · ${lead.customer.email}` : ""}
                </td>
                <td className="px-3 py-2 text-ink/65">
                  {INTEREST_LABELS[lead.interest ?? ""] ??
                    (lead.config?.kind === "wardrobe" ? "Шкаф" : lead.config ? "Кухня" : "—")}
                </td>
                <td className="px-3 py-2 font-semibold">
                  {money(lead.price?.total ?? null)}
                </td>
                <td className="px-3 py-2">
                  {lead.projectId ? (
                    <Link
                      className="link-line text-copper"
                      href={`/admin/calculations/${lead.projectId}`}
                    >
                      Открыть {lead.projectId}
                    </Link>
                  ) : (
                    <span className="text-ink/40">не привязан</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
