"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  versionId: string;
  expectedVersion: number;
  status: "not_ready" | "approved" | "missing";
  approvedBy?: string | null;
}

export function CompositionProductionActions({
  versionId,
  expectedVersion,
  status,
  approvedBy,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (status === "approved") {
    return (
      <p className="text-[0.72rem] text-emerald-900">
        Production Gate: approved{approvedBy ? ` · ${approvedBy}` : ""}. Published
        и production-ready — разные состояния.
      </p>
    );
  }

  async function approve() {
    if (
      !window.confirm(
        "Подтвердить прохождение Production Gate? Публикация сама по себе не означает production-ready.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/compositions/${encodeURIComponent(versionId)}/production-approval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion,
            confirmed: true,
            criteria: [
              "published",
              "contentHash verified",
              "no preliminary lines",
              "commercial pins present",
              "no validation errors",
            ],
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setError(body?.error ?? `Ошибка HTTP ${response.status}`);
        return;
      }
      setMessage("Production Gate пройден.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[0.72rem] text-amber-900">
        Production Gate: {status === "missing" ? "не пройден" : status}. Published
        не означает production-ready.
      </p>
      <button
        type="button"
        onClick={approve}
        disabled={busy}
        className="btn btn-primary btn-sm"
      >
        Пройти Production Gate
      </button>
      {error ? <p className="text-[0.7rem] text-red-900">{error}</p> : null}
      {message ? <p className="text-[0.7rem] text-emerald-900">{message}</p> : null}
    </div>
  );
}
