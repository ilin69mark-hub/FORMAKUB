"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  CompositionCondition,
  CompositionIssue,
  CompositionLine,
  CompositionModuleType,
  CompositionQuantityRef,
  CompositionSource,
  CompositionUnit,
  CompositionVersion,
} from "@/lib/admin/composition-schema";
import { COMPOSITION_SOURCES, COMPOSITION_UNITS } from "@/lib/admin/composition-schema";
import { COMPOSITION_CODE_REFS } from "@/lib/admin/composition-code-registry";

export interface CompositionCatalogOption {
  id: string;
  catalog: string;
  label: string;
  status: string;
}

export interface CompositionPriceOption {
  id: string;
  label: string;
  unit: string;
  status: string;
  usage: string;
}

export interface CompositionRuleOption {
  id: string;
  name: string;
  status: string;
  source: string;
  scope: string;
  version: string;
}

interface Props {
  moduleType: CompositionModuleType;
  moduleLabel: string;
  draft: CompositionVersion;
  initialIssues?: CompositionIssue[];
  catalogs: CompositionCatalogOption[];
  prices: CompositionPriceOption[];
  rules: CompositionRuleOption[];
}

const RELATIONS = ["required", "conditional", "optional", "alternative"] as const;
const QUANTITY_KINDS = ["code", "managed_rule", "fixed"] as const;
const CONDITION_KINDS = ["none", "text", "code", "managed_rule"] as const;

async function parseError(
  response: Response,
): Promise<{ message: string; issues: CompositionIssue[] }> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string; issues?: CompositionIssue[] }
    | null;
  return {
    message: body?.error ?? `Ошибка HTTP ${response.status}`,
    issues: body?.issues ?? [],
  };
}

export function CompositionEditor({
  moduleType,
  moduleLabel,
  draft,
  initialIssues = [],
  catalogs,
  prices,
  rules,
}: Props) {
  const router = useRouter();
  const [lines, setLines] = useState<CompositionLine[]>(draft.lines);
  const [expectedVersion, setExpectedVersion] = useState(draft.version);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<CompositionIssue[]>(initialIssues);
  const [form, setForm] = useState({
    componentCatalog: "",
    componentId: "",
    priceItemId: "",
    relation: "required",
    alternativeGroup: "",
    quantityKind: "code",
    codeId: "calculateKitchenBreakdown",
    ruleId: "",
    fixedValue: "1",
    fixedUnit: "pcs",
    conditionText: "",
    source: "preliminary",
    sourceRef: "",
  });

  const moduleLines = useMemo(
    () =>
      lines
        .filter((line) => line.moduleType === moduleType)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
    [lines, moduleType],
  );

  const componentOptions = useMemo(
    () =>
      catalogs.filter(
        (item) =>
          !form.componentCatalog || item.catalog === form.componentCatalog,
      ),
    [catalogs, form.componentCatalog],
  );

  function updateLine(id: string, updater: (line: CompositionLine) => CompositionLine) {
    setDirty(true);
    setLines((current) =>
      current.map((line) => (line.id === id ? updater(line) : line)),
    );
  }

  function quantityRefFromForm(value: typeof form): CompositionQuantityRef {
    if (value.quantityKind === "managed_rule") {
      return { kind: "managed_rule", ruleId: value.ruleId };
    }
    if (value.quantityKind === "fixed") {
      return {
        kind: "fixed",
        value: Number(value.fixedValue),
        unit: value.fixedUnit as CompositionUnit,
      };
    }
    return { kind: "code", implementationId: value.codeId };
  }

  function conditionFromForm(value: typeof form): CompositionCondition | undefined {
    if (!value.conditionText.trim()) return undefined;
    return { kind: "text", text: value.conditionText.trim() };
  }

  function addLine() {
    setError(null);
    if (!form.componentCatalog && !form.componentId && !form.priceItemId) {
      setError("Выберите компонент каталога или существующий тариф.");
      return;
    }
    if (!form.sourceRef.trim()) {
      setError("Укажите реальный sourceRef; синтетический источник не подставляется.");
      return;
    }
    if (form.quantityKind === "managed_rule" && !form.ruleId) {
      setError("Выберите ManagedRule для источника количества.");
      return;
    }
    const maxSort = Math.max(0, ...moduleLines.map((line) => line.sortOrder));
    const line: CompositionLine = {
      id: `line-${moduleType}-${Date.now().toString(36)}`,
      moduleType,
      relation: form.relation as CompositionLine["relation"],
      ...(form.alternativeGroup.trim()
        ? { alternativeGroup: form.alternativeGroup.trim() }
        : {}),
      ...(form.componentCatalog
        ? { componentCatalog: form.componentCatalog as CompositionLine["componentCatalog"] }
        : {}),
      ...(form.componentId ? { componentId: form.componentId } : {}),
      ...(form.priceItemId ? { priceItemId: form.priceItemId } : {}),
      quantityRef: quantityRefFromForm(form),
      ...(conditionFromForm(form) ? { condition: conditionFromForm(form)! } : {}),
      source: form.source as CompositionSource,
      sourceRef: form.sourceRef.trim(),
      sortOrder: maxSort + 10,
    };
    setDirty(true);
    setLines((current) => [...current, line]);
    setForm((current) => ({
      ...current,
      componentId: "",
      priceItemId: "",
      conditionText: "",
    }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setIssues([]);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/compositions/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion, lines }),
      });
      if (!response.ok) {
        const parsed = await parseError(response);
        setError(parsed.message);
        setIssues(parsed.issues);
        return;
      }
      const body = (await response.json()) as { data: CompositionVersion };
      setLines(body.data.lines);
      setExpectedVersion(body.data.version);
      setDirty(false);
      setMessage(`Draft сохранён: версия ${body.data.version}.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    if (dirty) {
      setError("Сначала сохраните draft: проверка выполняется по сохранённой версии.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/compositions/${draft.id}/validate`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const parsed = await parseError(response);
        setError(parsed.message);
        return;
      }
      const body = (await response.json()) as {
        data: { ok: boolean; errors: CompositionIssue[]; warnings: CompositionIssue[] };
      };
      setIssues([...body.data.errors, ...body.data.warnings]);
      setMessage(
        body.data.ok
          ? "Ошибок не найдено; предупреждения можно просмотреть ниже."
          : "Обнаружены ошибки; публикация заблокирована.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (dirty) {
      setError("Сначала сохраните draft: публикуется только сохранённая версия.");
      return;
    }
    if (!window.confirm("Опубликовать сохранённый draft? Опубликованная версия неизменяема.")) {
      return;
    }
    setBusy(true);
    setError(null);
    setIssues([]);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/compositions/${draft.id}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion,
            expectedStateVersion: `${draft.id}@${expectedVersion}`,
            confirmed: true,
          }),
        },
      );
      if (!response.ok) {
        const parsed = await parseError(response);
        setError(parsed.message);
        setIssues(parsed.issues);
        return;
      }
      const body = (await response.json()) as { data: CompositionVersion };
      setMessage(
        `Опубликована версия ${body.data.id} (seq ${body.data.publishedSeq}).`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmLine(lineId: string) {
    if (dirty) {
      setError("Сначала сохраните draft: подтверждение выполняется по сохранённой строке.");
      return;
    }
    const reference = window.prompt(
      "Основание подтверждения (документ/дата/ответственный):",
    );
    if (!reference?.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/compositions/${draft.id}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion,
            lineId,
            reference: reference.trim(),
            confirmed: true,
          }),
        },
      );
      if (!response.ok) {
        const parsed = await parseError(response);
        setError(parsed.message);
        setIssues(parsed.issues);
        return;
      }
      const body = (await response.json()) as { data: CompositionVersion };
      setLines(body.data.lines);
      setExpectedVersion(body.data.version);
      setDirty(false);
      setMessage(`Строка подтверждена; основание: ${reference.trim()}.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    if (!window.confirm("Удалить draft-версию состава? Опубликованные версии не удаляются.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/compositions/${draft.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion }),
      });
      if (!response.ok) {
        const parsed = await parseError(response);
        setError(parsed.message);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-surface mt-4 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/8 px-5 py-4">
        <div>
          <h2 className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-ink/52">
            Draft состава: {moduleLabel}
          </h2>
          <p className="mt-1 text-[0.7rem] text-ink/45">
            {draft.id} · version {expectedVersion} · строк в версии: {lines.length}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={busy} className="btn btn-primary btn-sm">
            Сохранить draft
          </button>
          <button type="button" onClick={validate} disabled={busy} className="btn btn-glass btn-sm">
            Проверить
          </button>
          <button type="button" onClick={publish} disabled={busy} className="btn btn-primary btn-sm">
            Опубликовать
          </button>
          <button type="button" onClick={deleteDraft} disabled={busy} className="btn btn-glass btn-sm">
            Удалить draft
          </button>
        </div>
      </div>

      {message ? (
        <p className="border-b border-emerald-700/15 bg-emerald-600/8 px-5 py-3 text-[0.74rem] text-emerald-900">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="border-b border-red-700/15 bg-red-600/8 px-5 py-3 text-[0.74rem] text-red-900">
          {error}
        </p>
      ) : null}
      {issues.length > 0 ? (
        <ul className="border-b border-ink/8 bg-white/30 px-5 py-3 text-[0.7rem]">
          {issues.map((issue, index) => (
            <li
              key={`${issue.code}-${issue.lineId ?? index}`}
              className={issue.severity === "error" ? "text-red-900" : "text-amber-900"}
            >
              <span className="font-semibold">{issue.severity}</span> · {issue.code}:{" "}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[78rem] text-left text-[0.7rem]">
          <thead className="bg-white/25 text-[0.54rem] uppercase tracking-[0.1em] text-ink/42">
            <tr>
              <th className="px-3 py-2 font-semibold">Строка</th>
              <th className="px-3 py-2 font-semibold">Связь</th>
              <th className="px-3 py-2 font-semibold">Компонент</th>
              <th className="px-3 py-2 font-semibold">Тариф</th>
              <th className="px-3 py-2 font-semibold">Количество</th>
              <th className="px-3 py-2 font-semibold">Условие</th>
              <th className="px-3 py-2 font-semibold">Источник</th>
              <th className="px-3 py-2 font-semibold">Порядок</th>
              <th className="px-3 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {moduleLines.map((line) => {
              const componentChoices = catalogs.filter(
                (item) => item.catalog === line.componentCatalog,
              );
              return (
                <tr key={line.id} className="border-t border-ink/7 align-top">
                  <td className="px-3 py-2">
                    <p className="font-mono text-[0.6rem] text-ink/45">{line.id}</p>
                    <p className="mt-0.5 text-[0.62rem] text-ink/50">
                      {line.relation === "alternative"
                        ? `alternative:${line.alternativeGroup ?? "?"}`
                        : line.relation}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={line.relation}
                      onChange={(event) =>
                        updateLine(line.id, (current) => ({
                          ...current,
                          relation: event.target.value as CompositionLine["relation"],
                        }))
                      }
                      className="select min-w-[7rem]"
                    >
                      {RELATIONS.map((relation) => (
                        <option key={relation} value={relation}>
                          {relation}
                        </option>
                      ))}
                    </select>
                    {line.relation === "alternative" ? (
                      <input
                        value={line.alternativeGroup ?? ""}
                        onChange={(event) =>
                          updateLine(line.id, (current) => ({
                            ...current,
                            alternativeGroup: event.target.value || undefined,
                          }))
                        }
                        placeholder="alternativeGroup"
                        className="input mt-1 min-w-[7rem]"
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={line.componentCatalog ?? ""}
                      onChange={(event) =>
                        updateLine(line.id, (current) => ({
                          ...current,
                          componentCatalog: event.target.value
                            ? (event.target.value as CompositionLine["componentCatalog"])
                            : undefined,
                          componentId: undefined,
                        }))
                      }
                      className="select min-w-[9rem]"
                    >
                      <option value="">— нет —</option>
                      {[...new Set(catalogs.map((item) => item.catalog))].map((catalog) => (
                        <option key={catalog} value={catalog}>
                          {catalog}
                        </option>
                      ))}
                    </select>
                    <select
                      value={line.componentId ?? ""}
                      onChange={(event) =>
                        updateLine(line.id, (current) => ({
                          ...current,
                          componentId: event.target.value || undefined,
                        }))
                      }
                      className="select mt-1 min-w-[10rem]"
                    >
                      <option value="">— слот выбора —</option>
                      {componentChoices.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label} ({item.status})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={line.priceItemId ?? ""}
                      disabled={Boolean(line.componentCatalog && !line.componentId)}
                      onChange={(event) =>
                        updateLine(line.id, (current) => ({
                          ...current,
                          priceItemId: event.target.value || undefined,
                        }))
                      }
                      className="select min-w-[12rem]"
                    >
                      <option value="">— из каталога/конфига —</option>
                      {prices.map((price) => (
                        <option key={price.id} value={price.id}>
                          {price.id} · {price.label} · {price.status}
                          {price.usage === "unused" ? " · unused" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={line.quantityRef.kind}
                      onChange={(event) => {
                        const kind = event.target.value as CompositionQuantityRef["kind"];
                        updateLine(line.id, (current) => ({
                          ...current,
                          quantityRef:
                            kind === "managed_rule"
                              ? { kind, ruleId: rules[0]?.id ?? "" }
                              : kind === "fixed"
                                ? { kind, value: 1, unit: "pcs" }
                                : { kind, implementationId: "calculateKitchenBreakdown" },
                        }));
                      }}
                      className="select min-w-[8rem]"
                    >
                      {QUANTITY_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                    {line.quantityRef.kind === "managed_rule" ? (
                      <select
                        value={line.quantityRef.ruleId}
                        onChange={(event) =>
                          updateLine(line.id, (current) => ({
                            ...current,
                            quantityRef: {
                              kind: "managed_rule",
                              ruleId: event.target.value,
                            },
                          }))
                        }
                        className="select mt-1 min-w-[12rem]"
                      >
                        <option value="">— правило —</option>
                        {rules.map((rule) => (
                          <option key={rule.id} value={rule.id}>
                            {rule.id} ({rule.status}/{rule.source})
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {line.quantityRef.kind === "code" ? (
                      <select
                        value={line.quantityRef.implementationId}
                        onChange={(event) =>
                          updateLine(line.id, (current) => ({
                            ...current,
                            quantityRef: {
                              kind: "code",
                              implementationId: event.target.value,
                            },
                          }))
                        }
                        className="select mt-1 min-w-[12rem]"
                      >
                        {COMPOSITION_CODE_REFS.map((ref) => (
                          <option key={ref.id} value={ref.id}>
                            {ref.id}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {line.quantityRef.kind === "fixed" ? (
                      <div className="mt-1 flex gap-1">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.quantityRef.value}
                          onChange={(event) =>
                            updateLine(line.id, (current) => ({
                              ...current,
                              quantityRef: {
                                kind: "fixed",
                                value: Number(event.target.value),
                                unit:
                                  current.quantityRef.kind === "fixed"
                                    ? current.quantityRef.unit
                                    : "pcs",
                              },
                            }))
                          }
                          className="input w-20"
                        />
                        <select
                          value={line.quantityRef.unit}
                          onChange={(event) =>
                            updateLine(line.id, (current) => ({
                              ...current,
                              quantityRef: {
                                kind: "fixed",
                                value:
                                  current.quantityRef.kind === "fixed"
                                    ? current.quantityRef.value
                                    : 1,
                                unit: event.target.value as CompositionUnit,
                              },
                            }))
                          }
                          className="select w-20"
                        >
                          {COMPOSITION_UNITS.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={line.condition?.kind ?? "none"}
                      onChange={(event) => {
                        const kind = event.target.value;
                        updateLine(line.id, (current) => ({
                          ...current,
                          ...(kind === "none"
                            ? { condition: undefined }
                            : kind === "text"
                              ? { condition: { kind: "text", text: "условие" } }
                              : kind === "code"
                                ? {
                                    condition: {
                                      kind: "code",
                                      implementationId: "calculateKitchenBreakdown",
                                    },
                                  }
                                : {
                                    condition: {
                                      kind: "managed_rule",
                                      ruleId: rules[0]?.id ?? "",
                                    },
                                  }),
                        }));
                      }}
                      className="select min-w-[7rem]"
                    >
                      {CONDITION_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                    {line.condition?.kind === "text" ? (
                      <input
                        value={line.condition.text}
                        onChange={(event) =>
                          updateLine(line.id, (current) => ({
                            ...current,
                            condition: { kind: "text", text: event.target.value },
                          }))
                        }
                        className="input mt-1 min-w-[10rem]"
                      />
                    ) : null}
                    {line.condition?.kind === "code" ? (
                      <select
                        value={line.condition.implementationId}
                        onChange={(event) =>
                          updateLine(line.id, (current) => ({
                            ...current,
                            condition: {
                              kind: "code",
                              implementationId: event.target.value,
                            },
                          }))
                        }
                        className="select mt-1 min-w-[10rem]"
                      >
                        {COMPOSITION_CODE_REFS.map((ref) => (
                          <option key={ref.id} value={ref.id}>
                            {ref.id}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {line.condition?.kind === "managed_rule" ? (
                      <select
                        value={line.condition.ruleId}
                        onChange={(event) =>
                          updateLine(line.id, (current) => ({
                            ...current,
                            condition: {
                              kind: "managed_rule",
                              ruleId: event.target.value,
                            },
                          }))
                        }
                        className="select mt-1 min-w-[12rem]"
                      >
                        {rules.map((rule) => (
                          <option key={rule.id} value={rule.id}>
                            {rule.id} ({rule.status})
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={line.source}
                      onChange={(event) =>
                        updateLine(line.id, (current) => ({
                          ...current,
                          source: event.target.value as CompositionSource,
                        }))
                      }
                      className="select min-w-[8rem]"
                    >
                      {COMPOSITION_SOURCES.filter(
                        (source) =>
                          source !== "owner_confirmed" ||
                          line.source === "owner_confirmed",
                      ).map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                    <input
                      value={line.sourceRef}
                      onChange={(event) =>
                        updateLine(line.id, (current) => ({
                          ...current,
                          sourceRef: event.target.value,
                        }))
                      }
                      className="input mt-1 min-w-[10rem]"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={line.sortOrder}
                      onChange={(event) =>
                        updateLine(line.id, (current) => ({
                          ...current,
                          sortOrder: Number(event.target.value),
                        }))
                      }
                      className="input w-20"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {line.source !== "owner_confirmed" ? (
                      <button
                        type="button"
                        onClick={() => confirmLine(line.id)}
                        disabled={busy}
                        className="mr-2 text-[0.66rem] text-copper underline underline-offset-2"
                      >
                        Подтвердить
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setDirty(true);
                        setLines((current) =>
                          current.filter((item) => item.id !== line.id),
                        );
                      }}
                      className="text-[0.66rem] text-red-800 underline underline-offset-2"
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              );
            })}
            {moduleLines.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-ink/50">
                  В draft нет строк для этого модуля.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="border-t border-ink/8 bg-white/25 px-5 py-4">
        <h3 className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-ink/52">
          Добавить строку
        </h3>
        <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <label className="field">
            <span className="field-label">Вид каталога</span>
            <select
              value={form.componentCatalog}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  componentCatalog: event.target.value,
                  componentId: "",
                }))
              }
              className="select"
            >
              <option value="">— нет —</option>
              {[...new Set(catalogs.map((item) => item.catalog))].map((catalog) => (
                <option key={catalog} value={catalog}>
                  {catalog}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Компонент</span>
            <select
              value={form.componentId}
              disabled={!form.componentCatalog}
              onChange={(event) =>
                setForm((current) => ({ ...current, componentId: event.target.value }))
              }
              className="select"
            >
              <option value="">— слот/нет —</option>
              {componentOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Тариф</span>
            <select
              value={form.priceItemId}
              disabled={Boolean(form.componentCatalog && !form.componentId)}
              onChange={(event) =>
                setForm((current) => ({ ...current, priceItemId: event.target.value }))
              }
              className="select"
            >
              <option value="">— нет —</option>
              {prices.map((price) => (
                <option key={price.id} value={price.id}>
                  {price.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Связь</span>
            <select
              value={form.relation}
              onChange={(event) =>
                setForm((current) => ({ ...current, relation: event.target.value }))
              }
              className="select"
            >
              {RELATIONS.map((relation) => (
                <option key={relation} value={relation}>
                  {relation}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">alternativeGroup</span>
            <input
              value={form.alternativeGroup}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  alternativeGroup: event.target.value,
                }))
              }
              className="input"
            />
          </label>
          <label className="field">
            <span className="field-label">Источник количества</span>
            <select
              value={form.quantityKind}
              onChange={(event) =>
                setForm((current) => ({ ...current, quantityKind: event.target.value }))
              }
              className="select"
            >
              {QUANTITY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          {form.quantityKind === "code" ? (
            <label className="field">
              <span className="field-label">implementationId</span>
              <select
                value={form.codeId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, codeId: event.target.value }))
                }
                className="select"
              >
                {COMPOSITION_CODE_REFS.map((ref) => (
                  <option key={ref.id} value={ref.id}>
                    {ref.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {form.quantityKind === "managed_rule" ? (
            <label className="field">
              <span className="field-label">ManagedRule</span>
              <select
                value={form.ruleId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, ruleId: event.target.value }))
                }
                className="select"
              >
                <option value="">—</option>
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {form.quantityKind === "fixed" ? (
            <>
              <label className="field">
                <span className="field-label">Количество</span>
                <input
                  type="number"
                  value={form.fixedValue}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, fixedValue: event.target.value }))
                  }
                  className="input"
                />
              </label>
              <label className="field">
                <span className="field-label">Единица</span>
                <select
                  value={form.fixedUnit}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, fixedUnit: event.target.value }))
                  }
                  className="select"
                >
                  {COMPOSITION_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <label className="field">
            <span className="field-label">Условие (текст)</span>
            <input
              value={form.conditionText}
              onChange={(event) =>
                setForm((current) => ({ ...current, conditionText: event.target.value }))
              }
              className="input"
            />
          </label>
          <label className="field">
            <span className="field-label">Source</span>
            <select
              value={form.source}
              onChange={(event) =>
                setForm((current) => ({ ...current, source: event.target.value }))
              }
              className="select"
            >
              {COMPOSITION_SOURCES.filter((source) => source !== "owner_confirmed").map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">sourceRef</span>
            <input
              value={form.sourceRef}
              onChange={(event) =>
                setForm((current) => ({ ...current, sourceRef: event.target.value }))
              }
              className="input"
            />
          </label>
          <div className="flex items-end">
            <button type="button" onClick={addLine} className="btn btn-primary btn-sm">
              Добавить
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
