"use client";

import { useActionState } from "react";

import type { ParameterEditability } from "@/lib/admin/parameters";
import type { AdminParameter } from "@/lib/admin/schema";
import { formatParameterValue } from "@/lib/admin/parameters-ui";

import {
  updateParameterValueAction,
  type ParameterActionState,
} from "@/app/admin/parameters/actions";

const INITIAL: ParameterActionState = { ok: false, message: "" };

function ValueField({ parameter }: { parameter: AdminParameter }) {
  const label = "Новое значение";

  if (parameter.valueType === "boolean") {
    return (
      <label className="checkbox-row">
        <input
          type="checkbox"
          name="value"
          defaultChecked={parameter.value}
        />
        <span>
          {label}: {formatParameterValue(parameter)}
        </span>
      </label>
    );
  }

  if (parameter.valueType === "enum") {
    return (
      <label className="field">
        <span className="field-label">{label}</span>
        <select
          name="value"
          className="select"
          defaultValue={parameter.value}
        >
          {parameter.enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (parameter.valueType === "string[]") {
    return (
      <label className="field">
        <span className="field-label">{label} (по одному в строке)</span>
        <textarea
          name="value"
          className="textarea"
          defaultValue={parameter.value.join("\n")}
        />
      </label>
    );
  }

  if (parameter.valueType === "string") {
    return (
      <label className="field">
        <span className="field-label">{label}</span>
        <input
          type="text"
          name="value"
          className="input"
          maxLength={500}
          defaultValue={parameter.value}
        />
      </label>
    );
  }

  return (
    <label className="field">
      <span className="field-label">
        {label}
        {parameter.unit === "none" ? "" : `, ${parameter.unit}`}
      </span>
      <input
        type="number"
        name="value"
        className="input"
        step={parameter.valueType === "int" ? 1 : parameter.step}
        min={parameter.min}
        max={parameter.max}
        defaultValue={parameter.value}
      />
      <span className="text-[0.68rem] text-ink/45">
        Допустимо: {parameter.min} … {parameter.max}; проверка сервера
        обязательна.
      </span>
    </label>
  );
}

export function ParameterEditor({
  parameter,
  editability,
}: {
  parameter: AdminParameter;
  editability: ParameterEditability;
}) {
  const [state, formAction, isPending] = useActionState(
    updateParameterValueAction,
    INITIAL,
  );

  return (
    <div>
      {editability.editable ? (
        <form key={parameter.version} action={formAction} className="mt-4 grid gap-3">
          <input type="hidden" name="id" value={parameter.id} />
          <input
            type="hidden"
            name="expectedVersion"
            value={parameter.version}
          />
          <ValueField parameter={parameter} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={isPending}
            >
              {isPending ? "Сохранение…" : "Сохранить"}
            </button>
            <span className="text-[0.68rem] text-ink/45">
              expectedVersion: {parameter.version} · optimistic locking
            </span>
          </div>
          {editability.willRequireRelease ? (
            <p className="text-[0.72rem] leading-relaxed text-ink/55">
              Параметр читается движком: правка будет принята как
              pending_release и не повлияет на расчёты до выпуска новой
              calcVersion (R-08/§5.7).
            </p>
          ) : null}
          <p className="text-[0.68rem] leading-relaxed text-ink/42">
            Изменение выполняется от локального оператора local-ui без
            аутентификации и RBAC (CA-T-602/603 не подключены).
          </p>
        </form>
      ) : (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-ink/10 bg-white/35 px-4 py-3 text-[0.76rem] leading-relaxed text-ink/62">
          <span className="mt-0.5 text-copper">■</span>
          <p>{editability.message}</p>
        </div>
      )}

      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mt-3 rounded-xl border px-4 py-3 text-[0.76rem] leading-relaxed ${
            state.ok
              ? "border-emerald-700/20 bg-emerald-600/10 text-emerald-900"
              : "border-red-700/20 bg-red-600/10 text-red-900"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
