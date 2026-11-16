"use client";

import { useActionState, useState } from "react";

import type { ReferenceActionState } from "@/app/admin/_actions/reference";

type Action = (
  previous: ReferenceActionState | null,
  formData: FormData,
) => Promise<ReferenceActionState>;

const INITIAL: ReferenceActionState = { ok: false, message: "" };

/**
 * CA-T-503 — архивирование с явным подтверждением (ТЗ §7.3: подтверждение
 * обязательно для архивирования). Кнопка исчезает после успеха, сообщение
 * сервера остаётся видимым.
 */
export function ArchiveButton({
  action,
  fields,
  available,
  reason,
  entityLabel,
}: {
  action: Action;
  fields: Record<string, string>;
  available: boolean;
  reason?: string;
  entityLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mt-4">
      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mb-3 rounded-xl border px-4 py-3 text-[0.76rem] leading-relaxed ${
            state.ok
              ? "border-emerald-700/20 bg-emerald-600/10 text-emerald-900"
              : "border-red-700/20 bg-red-600/10 text-red-900"
          }`}
        >
          {state.message}
        </p>
      ) : null}

      {available ? (
        confirming ? (
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            {Object.entries(fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <span className="text-[0.76rem] text-ink/62">
              Архивировать {entityLabel}? Действие необратимо: удаление запрещено
              всегда (§6.2/§6.3).
            </span>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={pending}
            >
              {pending ? "Архивирование…" : "Подтвердить"}
            </button>
            <button
              type="button"
              className="btn btn-glass btn-sm"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Отмена
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="btn btn-glass btn-sm"
            onClick={() => setConfirming(true)}
          >
            Архивировать
          </button>
        )
      ) : reason ? (
        <p className="text-[0.74rem] leading-relaxed text-ink/55">{reason}</p>
      ) : null}
    </div>
  );
}
