"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, X } from "lucide-react";

import type { DiffSummary } from "@/lib/admin/prices-ui";
import { formatDiffValue } from "@/lib/admin/prices-ui";
import type { PricingDiffEntry } from "@/lib/admin/pricing";

export interface AffectedProject {
  id: string;
  type: string;
  priceVersion: string;
}

interface ValidationIssue {
  code: string;
  message: string;
  path: string;
  severity: "error" | "warning" | "info";
}

interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
}

/**
 * CA-T-504 — подтверждение публикации через защищённый admin-API.
 *
 * Diff и список проектов приходят из реального источника. Публикация
 * требует `price.publish` (проверяется сервером), подтверждения и
 * expectedVersion; успех не имитируется, ошибки показываются как есть.
 */
export function ConfirmPublish({
  publishedId,
  draftId,
  draftExpectedVersion,
  changes,
  summary,
  projects,
  canPublish = false,
}: {
  publishedId: string | null;
  draftId: string;
  draftExpectedVersion: string;
  changes: PricingDiffEntry[];
  summary: DiffSummary;
  projects: AffectedProject[];
  /** UI-RBAC: без `price.publish` публикация недоступна в интерфейсе. */
  canPublish?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, submitting]);

  const validate = async () => {
    setValidating(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/pricing-versions/${encodeURIComponent(draftId)}/validate`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      const payload = (await response.json()) as
        | { ok: true; data: ValidationResult }
        | { ok: false; error?: string };
      if (!response.ok || !payload.ok) {
        setError(
          payload.ok
            ? "Не удалось выполнить валидацию."
            : payload.error ?? "Не удалось выполнить валидацию.",
        );
        return;
      }
      setValidation(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка сети.");
    } finally {
      setValidating(false);
    }
  };

  const publish = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/pricing-versions/${encodeURIComponent(draftId)}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmed: true,
            expectedVersion: draftExpectedVersion,
          }),
        },
      );
      const payload = (await response.json()) as
        | { ok: true; data: unknown }
        | { ok: false; error?: string };
      if (!response.ok || !payload.ok) {
        setError(
          payload.ok
            ? "Публикация не выполнена."
            : payload.error ?? "Публикация не выполнена.",
        );
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка сети.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {canPublish ? <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => setOpen(true)}
      >
        Проверить публикацию
      </button> : null}

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Закрыть подтверждение"
            className="absolute inset-0 bg-ink/55 backdrop-blur-sm"
            onClick={() => (submitting ? undefined : setOpen(false))}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-confirm-title"
            className="absolute inset-x-0 bottom-0 top-auto max-h-[92vh] overflow-y-auto rounded-t-3xl bg-cream p-5 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[52rem] sm:max-w-[92vw] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
                  Подтверждение публикации
                </p>
                <h2
                  id="publish-confirm-title"
                  className="font-display mt-2 text-2xl"
                >
                  {publishedId ?? "—"} → {draftId}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/12 bg-white/55"
                aria-label="Закрыть"
                disabled={submitting}
              >
                <X size={17} />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="chip chip-copper">Изменений: {summary.total}</span>
              <span className="chip">ставки: {summary.priceItems}</span>
              <span className="chip">правила: {summary.rules}</span>
              <span className="chip">промо: {summary.promos}</span>
              <span className="chip">metadata: {summary.metadata}</span>
              <span className="chip">проектов: {projects.length}</span>
            </div>

            <div className="mt-5">
              <h3 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
                Diff опубликованная ↔ draft
              </h3>
              <div className="mt-2 max-h-56 overflow-auto rounded-2xl border border-ink/10 bg-white/35">
                <table className="w-full min-w-[34rem] text-left text-[0.72rem]">
                  <thead className="bg-white/35 text-[0.58rem] uppercase tracking-[0.1em] text-ink/42">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Тип</th>
                      <th className="px-3 py-2 font-semibold">Ключ / поле</th>
                      <th className="px-3 py-2 font-semibold">Было</th>
                      <th className="px-3 py-2 font-semibold">Стало</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((change) => (
                      <tr
                        key={`${change.targetType}:${change.targetKey}:${change.field}`}
                        className="border-t border-ink/7 align-top"
                      >
                        <td className="px-3 py-2 text-ink/55">{change.targetType}</td>
                        <td className="px-3 py-2">
                          <code className="break-all">{change.targetKey}</code>
                          <p className="text-[0.62rem] text-ink/42">{change.field}</p>
                        </td>
                        <td className="max-w-[9rem] break-words px-3 py-2 text-ink/62">
                          {formatDiffValue(change.oldValue)}
                        </td>
                        <td className="max-w-[9rem] break-words px-3 py-2 font-medium">
                          {formatDiffValue(change.newValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-5">
              <h3 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
                Затронутые проекты: {projects.length}
              </h3>
              {projects.length === 0 ? (
                <p className="mt-1 text-[0.7rem] text-ink/45">
                  Проектов, требующих пересчёта, нет.
                </p>
              ) : (
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {projects.map((project) => (
                    <li
                      key={project.id}
                      className="rounded-lg border border-ink/8 bg-white/30 px-3 py-2 text-[0.7rem]"
                    >
                      <code>{project.id}</code>
                      <span className="ml-2 text-ink/45">
                        {project.type} · {project.priceVersion}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {validation ? (
              <div
                className={`mt-4 rounded-xl border px-4 py-3 text-[0.74rem] ${
                  validation.passed
                    ? "border-emerald-700/20 bg-emerald-600/10 text-emerald-900"
                    : "border-red-700/20 bg-red-600/10 text-red-900"
                }`}
              >
                <p className="font-semibold">
                  Валидация: {validation.passed ? "passed" : "failed"}
                </p>
                {validation.issues.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {validation.issues.map((issue) => (
                      <li key={`${issue.code}:${issue.path}`}>
                        <code>{issue.code}</code> {issue.path}: {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1">Замечаний нет.</p>
                )}
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-700/20 bg-red-600/10 px-4 py-3 text-[0.74rem] leading-relaxed text-red-900">
                <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                <p>{error}</p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn btn-glass btn-sm"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Закрыть
              </button>
              <button
                type="button"
                className="btn btn-glass btn-sm"
                onClick={validate}
                disabled={validating || submitting}
              >
                {validating ? "Проверка…" : "Валидировать"}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={publish}
                disabled={submitting}
              >
                {submitting ? "Публикация…" : "Опубликовать"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
