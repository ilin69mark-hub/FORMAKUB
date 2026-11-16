"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus } from "lucide-react";

import { PRICE_UNIT_LABELS } from "@/lib/admin/prices-ui";
import type { PriceItem, PricingVersion } from "@/lib/admin/schema";

/**
 * CA-T-504 — создание draft и правка amount в draft-снимке через
 * защищённый admin-API. Published/superseded не редактируются.
 */
export function PriceDraftEditor({
  published,
  draft,
  items,
  canWrite = false,
}: {
  published: PricingVersion | null;
  draft: PricingVersion | null;
  items: PriceItem[];
  /** UI-RBAC: без `price.write` действия скрыты (сервер всё равно вернёт 403). */
  canWrite?: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const createDraft = async () => {
    if (!published || creating) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/pricing-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromVersionId: published.id }),
      });
      const payload = (await response.json()) as
        | { ok: true }
        | { ok: false; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.ok ? "Не удалось создать draft." : payload.error ?? "Не удалось создать draft.");
        return;
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка сети.");
    } finally {
      setCreating(false);
    }
  };

  const saveAmount = async (entry: { priceItemId: string; amount: number }) => {
    if (!draft || savingId) return;
    const raw = drafts[entry.priceItemId];
    if (raw === undefined) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Сумма должна быть числом ≥ 0.");
      return;
    }
    setSavingId(entry.priceItemId);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/price-items/${encodeURIComponent(entry.priceItemId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, expectedAmount: entry.amount }),
        },
      );
      const payload = (await response.json()) as
        | { ok: true }
        | { ok: false; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.ok ? "Не удалось сохранить сумму." : payload.error ?? "Не удалось сохранить сумму.");
        return;
      }
      setDrafts((current) => {
        const next = { ...current };
        delete next[entry.priceItemId];
        return next;
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка сети.");
    } finally {
      setSavingId(null);
    }
  };

  if (!draft) {
    return (
      <section className="card-surface mt-4 px-5 py-5 sm:px-6">
        <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
          Черновик прайса
        </h2>
        <p className="mt-2 max-w-3xl text-[0.78rem] leading-relaxed text-ink/62">
          {published
            ? "Черновик создаётся копией опубликованной версии. Правки amount применяются только к draft."
            : "Опубликованная версия не найдена — создать черновик невозможно без источника."}
        </p>
        {error ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-700/20 bg-red-600/10 px-4 py-3 text-[0.74rem] text-red-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}
        {canWrite ? <button
          type="button"
          className="btn btn-primary btn-sm mt-4"
          onClick={createDraft}
          disabled={!published || creating}
        >
          <Plus size={14} className="mr-1" />
          {creating ? "Создание…" : "Создать черновик"}
        </button> : null}
      </section>
    );
  }

  const itemById = new Map(items.map((item) => [item.id, item]));

  return (
    <section className="card-surface mt-4 overflow-hidden">
      <div className="border-b border-ink/8 px-5 py-4">
        <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
          Редактирование draft · {draft.id}
        </h2>
        <p className="mt-1 text-[0.7rem] text-ink/45">
          Суммы применяются к draft-снимку (published/superseded неизменяемы).
          Сохранение — через PATCH price-items с expectedAmount.
        </p>
      </div>

      {error ? (
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-red-700/20 bg-red-600/10 px-4 py-3 text-[0.74rem] text-red-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full min-w-[46rem] text-left text-[0.74rem]">
          <thead className="sticky top-0 bg-cream text-[0.58rem] uppercase tracking-[0.1em] text-ink/42">
            <tr>
              <th className="px-5 py-3 font-semibold">Ставка</th>
              <th className="px-4 py-3 font-semibold">Текущая сумма</th>
              <th className="px-4 py-3 font-semibold">Новая сумма</th>
              <th className="px-5 py-3 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {draft.snapshot.map((entry) => {
              const item = itemById.get(entry.priceItemId);
              const value =
                drafts[entry.priceItemId] ?? String(entry.amount);
              const changed = Number(value) !== entry.amount;
              return (
                <tr key={entry.priceItemId} className="border-t border-ink/7 align-top">
                  <td className="px-5 py-2.5">
                    <code className="break-all">{entry.priceItemId}</code>
                    <p className="text-[0.62rem] text-ink/42">
                      {item?.label ?? "—"} · {item ? PRICE_UNIT_LABELS[item.unit] : "—"}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink/62">
                    {entry.amount}
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={value}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [entry.priceItemId]: event.target.value,
                        }))
                      }
                      className="input max-w-[10rem]"
                      disabled={!canWrite}
                      aria-label={`Новая сумма ${entry.priceItemId}`}
                    />
                  </td>
                  <td className="px-5 py-2.5">
                    <button
                      type="button"
                      className="btn btn-glass btn-sm"
                      disabled={
                        !canWrite || !changed || savingId === entry.priceItemId
                      }
                      onClick={() => saveAmount(entry)}
                    >
                      {savingId === entry.priceItemId ? "Сохранение…" : "Сохранить"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
