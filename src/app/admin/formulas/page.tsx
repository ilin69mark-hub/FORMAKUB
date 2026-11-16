import type { Metadata } from "next";

import { listFormulas } from "@/lib/admin/formulas";

import { sectionMetadata } from "../_components/section-route";

export const metadata: Metadata = sectionMetadata("formulas");
export const dynamic = "force-dynamic";

export default function AdminFormulasPage() {
  const formulas = listFormulas();

  return (
    <>
      <div className="mb-8 max-w-3xl">
        <p className="eyebrow">08 / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          Формулы
        </h1>
        <p className="body-copy mt-3">
          Read-only реестр CalculationReference. Формулы и расчётная логика
          доступны только для просмотра; операции изменения отсутствуют.
        </p>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card-surface px-5 py-4">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ink/42">
            Всего
          </p>
          <p className="mt-2 text-xl font-semibold text-ink">{formulas.length}</p>
        </div>
        <div className="card-surface px-5 py-4">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ink/42">
            Основных
          </p>
          <p className="mt-2 text-xl font-semibold text-ink">
            {formulas.filter((formula) => formula.primary).length}
          </p>
        </div>
        <div className="card-surface px-5 py-4">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ink/42">
            Режим
          </p>
          <p className="mt-2 text-xl font-semibold text-ink">read-only</p>
        </div>
      </div>

      <div className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[0.8rem]">
            <thead className="border-b border-ink/10 text-[0.62rem] uppercase tracking-[0.12em] text-ink/42">
              <tr>
                <th className="px-4 py-3 font-semibold">Формула</th>
                <th className="px-4 py-3 font-semibold">Файл</th>
                <th className="px-4 py-3 font-semibold">Семейство</th>
                <th className="px-4 py-3 font-semibold">Статус</th>
              </tr>
            </thead>
            <tbody>
              {formulas.map((formula) => (
                <tr key={`${formula.file}:${formula.id}`} className="border-b border-ink/6 last:border-0">
                  <td className="px-4 py-3 font-mono text-[0.74rem] text-ink">
                    {formula.id}
                  </td>
                  <td className="px-4 py-3 font-mono text-[0.7rem] text-ink/55">
                    {formula.file}
                    {!formula.fileExists ? (
                      <span className="ml-2 text-red-700">файл не найден</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-ink/65">{formula.family}</td>
                  <td className="px-4 py-3">
                    {formula.excluded ? (
                      <span className="chip chip-copper" title={formula.excludedReason}>
                        исключена
                      </span>
                    ) : formula.primary ? (
                      <span className="chip">основная</span>
                    ) : (
                      <span className="text-ink/45">вспомогательная</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {formulas.some((formula) => formula.excluded) ? (
        <div className="mt-4 space-y-2 text-[0.72rem] text-ink/50">
          {formulas
            .filter((formula) => formula.excluded)
            .map((formula) => (
              <p key={formula.id}>
                <span className="font-mono text-ink/65">{formula.id}</span>:{" "}
                {formula.excludedReason}
              </p>
            ))}
        </div>
      ) : null}
    </>
  );
}
