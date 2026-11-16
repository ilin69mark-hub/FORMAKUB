"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  hasDraft: boolean;
  publishedId: string | null;
  hasAnyVersion: boolean;
}

export function CompositionActions({ hasDraft, publishedId, hasAnyVersion }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function call(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; data?: { versionId?: string; id?: string; created?: boolean } }
        | null;
      if (!response.ok) {
        setError(payload?.error ?? `Ошибка HTTP ${response.status}`);
        return;
      }
      setMessage(
        payload?.data?.created === false
          ? `Импорт идемпотентен: ${payload.data.versionId ?? "версия уже существует"}.`
          : "Draft создан.",
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hasAnyVersion ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => call("/api/admin/compositions/import")}
          className="btn btn-primary btn-sm"
        >
          Импортировать начальный состав
        </button>
      ) : null}
      {!hasDraft ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            call(
              "/api/admin/compositions",
              publishedId ? { sourceVersionId: publishedId } : {},
            )
          }
          className="btn btn-glass btn-sm"
        >
          Создать draft из опубликованной версии
        </button>
      ) : null}
      {message ? (
        <span className="text-[0.7rem] text-emerald-900">{message}</span>
      ) : null}
      {error ? <span className="text-[0.7rem] text-red-900">{error}</span> : null}
    </div>
  );
}
