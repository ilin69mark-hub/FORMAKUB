"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus } from "lucide-react";

/** CA-T-505 — создание RecalculationBatch через защищённый admin-API. */
export function CreateBatchButton({
  priceVersionId,
}: {
  priceVersionId: string | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!priceVersionId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/recalculation-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceVersionId, trigger: "manual" }),
      });
      const payload = (await response.json()) as
        | { ok: true }
        | { ok: false; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.ok ? "Не удалось создать батч." : payload.error ?? "Не удалось создать батч.");
        return;
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка сети.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={create}
        disabled={!priceVersionId || creating}
      >
        <Plus size={14} className="mr-1" />
        {creating ? "Создание…" : "Создать батч пересчёта"}
      </button>
      {!priceVersionId ? (
        <p className="text-[0.68rem] text-ink/45">
          Нет опубликованной версии прайса — батч создать невозможно.
        </p>
      ) : null}
      {error ? (
        <p className="flex items-start gap-1.5 text-[0.7rem] text-red-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
