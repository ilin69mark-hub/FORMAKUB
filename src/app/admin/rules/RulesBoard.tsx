"use client";

import { useState } from "react";

import type { ManagedRule, RulesSnapshot } from "@/lib/admin/managed-rules";
import {
  buildSelection,
  filterRules,
  formatRuleValue,
  snapshotLabel,
  validateSelection,
} from "@/lib/admin/rules-ui";

interface Props {
  initialRules: ManagedRule[];
  initialSnapshots: RulesSnapshot[];
  initialActive: RulesSnapshot | null;
}

interface FormState {
  name: string;
  description: string;
  category: string;
  scope: string;
  source: string;
  sourceRef: string;
  assigns: string;
  valueType: string;
  value: string;
  unit: string;
  affects: string[];
  condition: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  category: "quantity",
  scope: "wardrobe",
  source: "owner_confirmed",
  sourceRef: "",
  assigns: "line:wardrobe.fittings",
  valueType: "int",
  value: "2",
  unit: "",
  affects: ["quantity"],
  condition: '{\n  "subject": "kind",\n  "operator": "equals",\n  "value": "wardrobe"\n}',
};

function formFromRule(rule: ManagedRule): FormState {
  return {
    name: rule.name,
    description: rule.description,
    category: rule.category,
    scope: rule.scope,
    source: rule.source,
    sourceRef: rule.sourceRef,
    assigns: rule.assigns,
    valueType: rule.valueType,
    value: Array.isArray(rule.value) ? rule.value.join(", ") : String(rule.value),
    unit: rule.unit ?? "",
    affects: [...rule.affects],
    condition: JSON.stringify(rule.condition, null, 2),
  };
}

function parseForm(form: FormState): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let condition: unknown;
  try {
    condition = JSON.parse(form.condition);
  } catch {
    return { ok: false, error: "Условие должно быть корректным JSON." };
  }

  let value: unknown = form.value;
  if (form.valueType === "int" || form.valueType === "decimal") {
    const parsed = Number(form.value);
    if (!Number.isFinite(parsed)) return { ok: false, error: "Значение должно быть числом." };
    value = parsed;
  } else if (form.valueType === "boolean") {
    value = form.value === "true";
  } else if (form.valueType === "stringList") {
    value = form.value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return {
    ok: true,
    value: {
      name: form.name,
      description: form.description,
      category: form.category,
      scope: form.scope,
      source: form.source,
      sourceRef: form.sourceRef,
      assigns: form.assigns,
      valueType: form.valueType,
      value,
      ...(form.unit ? { unit: form.unit } : {}),
      affects: form.affects,
      condition,
    },
  };
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Ошибка HTTP ${response.status}`;
}

export function RulesBoard({ initialRules, initialSnapshots, initialActive }: Props) {
  const [rules, setRules] = useState<ManagedRule[]>(initialRules);
  const [snapshots, setSnapshots] = useState<RulesSnapshot[]>(initialSnapshots);
  const [active, setActive] = useState<RulesSnapshot | null>(initialActive);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<ManagedRule[]>([]);
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<ManagedRule | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapshotView, setSnapshotView] = useState<RulesSnapshot | null>(null);
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [transition, setTransition] = useState({
    projectId: "",
    targetRulesSnapshotId: "",
    expectedVersion: "",
    operationId: "",
  });

  const selected = rules.find((rule) => rule.id === selectedId) ?? null;
  const visible = filterRules(rules, { q: filter });
  const drafts = rules.filter((rule) => rule.status === "draft");

  async function refresh() {
    const [rulesResponse, snapshotsResponse, activeResponse] = await Promise.all([
      fetch("/api/admin/rules", { cache: "no-store" }),
      fetch("/api/admin/rules/snapshots", { cache: "no-store" }),
      fetch("/api/admin/rules/snapshots/active", { cache: "no-store" }),
    ]);
    if (rulesResponse.ok) setRules((await rulesResponse.json()).data as ManagedRule[]);
    if (snapshotsResponse.ok) setSnapshots((await snapshotsResponse.json()).data as RulesSnapshot[]);
    if (activeResponse.ok) setActive(((await activeResponse.json()).data as RulesSnapshot | null) ?? null);
  }

  async function selectRule(id: string) {
    setSelectedId(id);
    setMessage(null);
    setError(null);
    const response = await fetch(`/api/admin/rules/${id}`, { cache: "no-store" });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    const body = (await response.json()) as { data: { rule: ManagedRule; revisions: ManagedRule[] } };
    setRevisions(body.data.revisions);
    setForm(formFromRule(body.data.rule));
    setEditing(null);
  }

  async function submitForm() {
    setMessage(null);
    setError(null);
    const parsed = parseForm(form);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    const revision = editing?.status === "published" && selected;
    const url = revision
      ? `/api/admin/rules/${selected!.id}/revision`
      : editing
        ? `/api/admin/rules/${editing.id}`
        : "/api/admin/rules";
    const method = editing ? (revision ? "POST" : "PATCH") : "POST";
    const payload = editing ? { ...parsed.value, expectedVersion: editing.version } : parsed.value;

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    const body = (await response.json()) as { data: ManagedRule };
    setMessage(revision ? "Создана новая draft-редакция." : editing ? "Сохранено." : "Правило создано (draft).");
    setEditing(null);
    await refresh();
    await selectRule(body.data.id);
  }

  async function publishSelected() {
    setMessage(null);
    setError(null);
    const issues = validateSelection(rules, selectedDrafts);
    if (issues.length > 0) {
      setError(issues.join(" "));
      return;
    }
    if (!confirmPublish) {
      setError("Публикация требует подтверждения.");
      return;
    }
    const response = await fetch("/api/admin/rules/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selection: buildSelection(rules, selectedDrafts),
        confirmed: true,
        expectedStateVersion: active?.id ?? "none",
        operationId: crypto.randomUUID(),
      }),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    const body = (await response.json()) as { data: { snapshot: RulesSnapshot; replay: boolean } };
    setMessage(
      `${body.data.replay ? "Снимок уже существует" : "Опубликован снимок"} ${body.data.snapshot.id}.`,
    );
    setSelectedDrafts([]);
    setConfirmPublish(false);
    await refresh();
  }

  async function viewSnapshot(id: string) {
    setError(null);
    const response = await fetch(`/api/admin/rules/snapshots/${id}`, { cache: "no-store" });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setSnapshotView(((await response.json()).data as RulesSnapshot) ?? null);
  }

  async function submitTransition() {
    setMessage(null);
    setError(null);
    if (!transition.projectId || !transition.targetRulesSnapshotId || !transition.expectedVersion || !transition.operationId) {
      setError("Заполните projectId, snapshot, expectedVersion и operationId.");
      return;
    }
    const response = await fetch(`/api/admin/projects/${transition.projectId}/rules-transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...transition, confirmed: true }),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    const body = (await response.json()) as {
      data: { replay: boolean; rulesSnapshotId: string; updatedAt: string };
    };
    setMessage(
      `${body.data.replay ? "Replay" : "Переход выполнен"}: ${body.data.rulesSnapshotId} @ ${body.data.updatedAt}.`,
    );
  }

  return (
    <div className="space-y-8">
      {message && <p className="rounded border border-green-300 bg-green-50 p-3 text-sm">{message}</p>}
      {error && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm">{error}</p>}

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Правила</h2>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Поиск по id/названию"
            className="rounded border px-3 py-1 text-sm"
          />
          <span className="text-xs text-neutral-500">active snapshot: {active?.id ?? "нет"}</span>
        </div>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-2">id</th>
              <th className="p-2">Название</th>
              <th className="p-2">Статус</th>
              <th className="p-2">Версия</th>
              <th className="p-2">Значение</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((rule) => (
              <tr key={rule.id} className="border-b">
                <td className="p-2 font-mono text-xs">
                  <button type="button" className="underline" onClick={() => selectRule(rule.id)}>
                    {rule.id}
                  </button>
                </td>
                <td className="p-2">{rule.name}</td>
                <td className="p-2">{rule.status}</td>
                <td className="p-2">{rule.version}</td>
                <td className="p-2">{formatRuleValue(rule)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selected && (
        <section className="space-y-2 rounded border p-4">
          <h3 className="font-semibold">Карточка: {selected.id}</h3>
          <p className="text-sm">
            Статус: {selected.status}; версия: {selected.version}; редакций в линии: {revisions.length}
          </p>
          <p className="text-sm">assigns: {selected.assigns}; affects: {selected.affects.join(", ")}</p>
          <p className="text-sm">Источник: {selected.source} · {selected.sourceRef}</p>
          <div className="max-h-40 overflow-auto rounded bg-neutral-50 p-2 text-xs">
            <pre>{JSON.stringify(selected.condition, null, 2)}</pre>
          </div>
          {selected.status !== "archived" && (
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm"
              onClick={() => {
                setEditing(selected);
                setForm(formFromRule(selected));
              }}
            >
              {selected.status === "draft" ? "Редактировать draft" : "Новая draft-редакция"}
            </button>
          )}
        </section>
      )}

      <section className="space-y-2 rounded border p-4">
        <h3 className="font-semibold">{editing ? (editing.status === "published" ? "Новая редакция" : "Редактирование draft") : "Создать draft-правило"}</h3>
        <div className="grid gap-2 md:grid-cols-2">
          <input className="rounded border px-2 py-1" placeholder="Название" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input className="rounded border px-2 py-1" placeholder="Описание" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <input className="rounded border px-2 py-1" placeholder="sourceRef" value={form.sourceRef} onChange={(event) => setForm({ ...form, sourceRef: event.target.value })} />
          <input className="rounded border px-2 py-1" placeholder="assigns" value={form.assigns} onChange={(event) => setForm({ ...form, assigns: event.target.value })} />
          <select className="rounded border px-2 py-1" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
            <option value="quantity">quantity</option>
            <option value="purpose">purpose</option>
            <option value="norm">norm</option>
            <option value="condition">condition</option>
          </select>
          <select className="rounded border px-2 py-1" value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })}>
            <option value="kitchen">kitchen</option>
            <option value="wardrobe">wardrobe</option>
            <option value="shared">shared</option>
          </select>
          <select className="rounded border px-2 py-1" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>
            <option value="owner_confirmed">owner_confirmed</option>
            <option value="datasheet">datasheet</option>
            <option value="preliminary">preliminary</option>
          </select>
          <select className="rounded border px-2 py-1" value={form.valueType} onChange={(event) => setForm({ ...form, valueType: event.target.value })}>
            <option value="int">int</option>
            <option value="decimal">decimal</option>
            <option value="boolean">boolean</option>
            <option value="enum">enum</option>
            <option value="stringList">stringList</option>
          </select>
          <input className="rounded border px-2 py-1" placeholder="value" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
          <input className="rounded border px-2 py-1" placeholder="unit (опц.)" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
        </div>
        <div className="flex gap-4 text-sm">
          <label><input type="checkbox" checked={form.affects.includes("quantity")} onChange={(event) => setForm({ ...form, affects: event.target.checked ? [...new Set([...form.affects, "quantity"])] : form.affects.filter((item) => item !== "quantity") })} /> quantity</label>
          <label><input type="checkbox" checked={form.affects.includes("price")} onChange={(event) => setForm({ ...form, affects: event.target.checked ? [...new Set([...form.affects, "price"])] : form.affects.filter((item) => item !== "price") })} /> price</label>
        </div>
        <textarea className="h-40 w-full rounded border p-2 font-mono text-xs" value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} />
        <div className="flex gap-2">
          <button type="button" className="rounded bg-neutral-900 px-3 py-1 text-sm text-white" onClick={submitForm}>
            {editing ? "Сохранить" : "Создать draft"}
          </button>
          {editing && (
            <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => { setEditing(null); setForm(EMPTY_FORM); }}>
              Отмена
            </button>
          )}
        </div>
      </section>

      <section className="space-y-2 rounded border p-4">
        <h3 className="font-semibold">Публикация снимка</h3>
        <p className="text-xs text-neutral-500">
          Draft-правила: выберите явно. Активный снимок: {active?.id ?? "нет"}.
        </p>
        <ul className="space-y-1 text-sm">
          {drafts.map((rule) => (
            <li key={rule.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selectedDrafts.includes(rule.id)}
                  onChange={(event) =>
                    setSelectedDrafts(
                      event.target.checked
                        ? [...selectedDrafts, rule.id]
                        : selectedDrafts.filter((id) => id !== rule.id),
                    )
                  }
                />{" "}
                {rule.id} · {rule.name} · v{rule.version}
              </label>
            </li>
          ))}
          {drafts.length === 0 && <li className="text-neutral-500">Нет draft-правил.</li>}
        </ul>
        <label className="text-sm">
          <input type="checkbox" checked={confirmPublish} onChange={(event) => setConfirmPublish(event.target.checked)} /> Подтверждаю публикацию выбранных правил
        </label>
        <div>
          <button type="button" className="rounded bg-neutral-900 px-3 py-1 text-sm text-white" onClick={publishSelected}>
            Опубликовать
          </button>
        </div>
      </section>

      <section className="space-y-2 rounded border p-4">
        <h3 className="font-semibold">Снимки</h3>
        <ul className="space-y-1 text-sm">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id}>
              <button type="button" className="underline" onClick={() => viewSnapshot(snapshot.id)}>
                {snapshotLabel(snapshot)}
              </button>
              {active?.id === snapshot.id && <span className="ml-2 text-xs">(active)</span>}
            </li>
          ))}
          {snapshots.length === 0 && <li className="text-neutral-500">Снимков нет.</li>}
        </ul>
        {snapshotView && (
          <div className="max-h-60 overflow-auto rounded bg-neutral-50 p-2 text-xs">
            <p className="font-semibold">{snapshotView.id} · hash {snapshotView.contentHash}</p>
            <pre>{JSON.stringify(snapshotView.rules, null, 2)}</pre>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded border p-4">
        <h3 className="font-semibold">Переход проекта на снимок</h3>
        <div className="grid gap-2 md:grid-cols-2">
          <input className="rounded border px-2 py-1" placeholder="projectId" value={transition.projectId} onChange={(event) => setTransition({ ...transition, projectId: event.target.value })} />
          <input className="rounded border px-2 py-1" placeholder="targetRulesSnapshotId" value={transition.targetRulesSnapshotId} onChange={(event) => setTransition({ ...transition, targetRulesSnapshotId: event.target.value })} />
          <input className="rounded border px-2 py-1" placeholder="expectedVersion (updatedAt)" value={transition.expectedVersion} onChange={(event) => setTransition({ ...transition, expectedVersion: event.target.value })} />
          <input className="rounded border px-2 py-1" placeholder="operationId" value={transition.operationId} onChange={(event) => setTransition({ ...transition, operationId: event.target.value })} />
        </div>
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={submitTransition}>
          Выполнить переход
        </button>
      </section>
    </div>
  );
}
