"use client";

import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] UI error", error);
  }, [error]);

  return (
    <div className="card-surface px-6 py-10 text-center">
      <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
        Ошибка интерфейса
      </p>
      <h1 className="font-display mt-3 text-2xl">
        Не удалось отобразить раздел
      </h1>
      <p className="body-copy mx-auto mt-3 max-w-xl text-sm">
        Mock-источник не изменил данные. Повторите попытку; если ошибка
        сохраняется, раздел остаётся недоступным до исправления.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-[0.68rem] text-ink/40">
          digest: {error.digest}
        </p>
      ) : null}
      <button type="button" onClick={reset} className="btn btn-primary btn-sm mt-6">
        Повторить
      </button>
    </div>
  );
}
