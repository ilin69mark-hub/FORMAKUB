"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface CompositionPinOption {
  id: string;
  publishedSeq: number | null;
  publishedAt: string | null;
  lines: number;
  rulesSnapshotId?: string | null;
}

interface Props {
  projectId: string;
  currentVersionId: string | null;
  expectedUpdatedAt: string;
  versions: CompositionPinOption[];
  supported: boolean;
  projectRulesSnapshotId?: string | null;
}

export function CompositionPinForm({
  projectId,
  currentVersionId,
  expectedUpdatedAt,
  versions,
  supported,
  projectRulesSnapshotId,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentVersionId ?? versions[0]?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!supported) {
    return (
      <p className="text-[0.72rem] text-ink/50">
        Состав модулей применим только к кухонной конфигурации; для шкафа
        модульная структура не создаётся.
      </p>
    );
  }

  async function submit() {
    if (!selected) {
      setError("Выберите опубликованную версию состава.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/projects/${encodeURIComponent(projectId)}/composition-transition`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `composition-pin-${projectId}-${Date.now()}`,
          },
          body: JSON.stringify({
            compositionVersionId: selected,
            expectedUpdatedAt,
            confirmed: true,
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
      setMessage("Состав закреплён за проектом; пересчёт не запускался.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (versions.length === 0) {
    return (
      <p className="text-[0.72rem] text-ink/50">
        Опубликованных версий состава нет. Создайте и опубликуйте версию в
        разделе «Мебельные модули».
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[0.72rem] text-ink/55">
        Текущая версия: <span className="font-mono">{currentVersionId ?? "не закреплена"}</span>.
        RulesSnapshot проекта: <span className="font-mono">{projectRulesSnapshotId ?? "нет"}</span>.
        Закрепление не меняет сохранённую цену и не пересчитывает проект.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="field min-w-[18rem]">
          <span className="field-label">Опубликованная версия состава</span>
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="select"
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.id} · seq {version.publishedSeq ?? "—"} · строк {version.lines}
                {version.rulesSnapshotId ? ` · rules ${version.rulesSnapshotId}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-[0.7rem] text-ink/60">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Подтверждаю явное закрепление
        </label>
        <button
          type="button"
          disabled={busy || !confirmed}
          onClick={submit}
          className="btn btn-primary btn-sm"
        >
          Закрепить состав
        </button>
      </div>
      {selected &&
      versions.find((version) => version.id === selected)?.rulesSnapshotId &&
      versions.find((version) => version.id === selected)?.rulesSnapshotId !==
        (projectRulesSnapshotId ?? null) ? (
        <p className="text-[0.72rem] text-amber-900">
          Выбранная composition закреплена за другим RulesSnapshot; сервер отклонит
          несовместимую пару.
        </p>
      ) : null}
      {error ? <p className="text-[0.72rem] text-red-900">{error}</p> : null}
      {message ? <p className="text-[0.72rem] text-emerald-900">{message}</p> : null}
    </div>
  );
}
