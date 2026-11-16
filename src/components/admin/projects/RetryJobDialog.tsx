"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";

/**
 * CA-T-505 — retry/cancel задания через защищённый admin-API.
 * Исполнение выполняет RecalculationWorker, не UI.
 */
export function RetryJobDialog({
  jobId,
  projectId,
  projectTitle,
  status,
  attempt,
  maxAttempts,
  errorMessage,
}: {
  jobId: string;
  projectId: string;
  projectTitle: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  errorMessage: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<"retry" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, pending]);

  const run = async (action: "retry" | "cancel") => {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/recalculations/${encodeURIComponent(jobId)}/${action}`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      const payload = (await response.json()) as
        | { ok: true }
        | { ok: false; error?: string };
      if (!response.ok || !payload.ok) {
        setError(
          payload.ok
            ? "Операция не выполнена."
            : payload.error ?? "Операция не выполнена.",
        );
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка сети.");
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-glass btn-sm"
        onClick={() => setOpen(true)}
      >
        Повторить
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Закрыть retry"
            className="absolute inset-0 bg-ink/55 backdrop-blur-sm"
            onClick={() => (pending ? undefined : setOpen(false))}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="retry-dialog-title"
            className="absolute inset-x-0 bottom-0 top-auto max-h-[90vh] overflow-y-auto rounded-t-3xl bg-cream p-5 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[40rem] sm:max-w-[92vw] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
                  Retry задания
                </p>
                <h2 id="retry-dialog-title" className="font-display mt-2 text-2xl">
                  {projectTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/12 bg-white/55"
                aria-label="Закрыть"
                disabled={Boolean(pending)}
              >
                <X size={17} />
              </button>
            </div>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ["jobId", jobId],
                ["projectId", projectId],
                ["status", status],
                ["attempt", `${attempt} / ${maxAttempts}`],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-ink/8 bg-white/30 px-4 py-3"
                >
                  <dt className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/42">
                    {label}
                  </dt>
                  <dd className="mt-1 break-all font-mono text-[0.75rem] text-ink/78">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {errorMessage ? (
              <div className="mt-4 rounded-xl border border-red-700/20 bg-red-600/10 px-4 py-3 text-[0.74rem] leading-relaxed text-red-900">
                <p className="font-semibold">Ошибка задания</p>
                <p className="mt-1 break-words">{errorMessage}</p>
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-700/20 bg-red-600/10 px-4 py-3 text-[0.74rem] leading-relaxed text-red-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <p>{error}</p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn btn-glass btn-sm"
                onClick={() => setOpen(false)}
                disabled={Boolean(pending)}
              >
                Закрыть
              </button>
              <button
                type="button"
                className="btn btn-glass btn-sm"
                onClick={() => run("cancel")}
                disabled={Boolean(pending)}
              >
                {pending === "cancel" ? "Отмена…" : "Отменить задание"}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => run("retry")}
                disabled={Boolean(pending)}
              >
                {pending === "retry" ? "Повтор…" : "Повторить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
