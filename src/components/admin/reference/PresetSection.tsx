import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { ArchiveButton } from "./ArchiveButton";
import { archiveModulePresetAction } from "@/app/admin/_actions/reference";
import { listModulePresets } from "@/lib/admin/presets";
import type { ModulePreset } from "@/lib/admin/schema";
import { getModuleComposition } from "@/lib/admin/catalog-model";
import {
  filterModulePresets,
  formatDimension,
  parsePresetFilter,
  PRESET_FAMILIES,
  PRESET_FAMILY_LABELS,
  PRESET_STATUSES,
  PRESET_STATUS_HINTS,
  PRESET_STATUS_LABELS,
  presetArchiveAvailability,
} from "@/lib/admin/reference-ui";

/**
 * CA-T-503 — раздел «Модули и комплектация» (ТЗ §2.2, раздел 03) на
 * реальном `ModulePreset`-сервисе (CA-T-205).
 */

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function hrefWith(
  base: Record<string, string | undefined>,
  extra: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...base, ...extra })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/admin/modules?${query}` : "/admin/modules";
}

const STATUS_STYLE: Record<ModulePreset["status"], string> = {
  active: "border-emerald-700/20 bg-emerald-600/10 text-emerald-900",
  archived: "border-ink/15 bg-ink/5 text-ink/65",
};

function StatusBadge({ status }: { status: ModulePreset["status"] }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.08em] ${STATUS_STYLE[status]}`}
    >
      {PRESET_STATUS_LABELS[status]}
    </span>
  );
}

function DetailCard({ preset }: { preset: ModulePreset }) {
  const availability = presetArchiveAvailability(preset);
  const composition = preset.family === "kitchen" ? getModuleComposition(preset.id) : undefined;

  return (
    <section className="card-surface mt-4 px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-copper">
            Карточка пресета
          </p>
          <h2 className="mt-1 break-all text-lg font-semibold">{preset.id}</h2>
          <p className="mt-1 text-[0.7rem] text-ink/45">
            {PRESET_FAMILY_LABELS[preset.family]} · зона {preset.zone}
          </p>
        </div>
        <StatusBadge status={preset.status} />
      </div>

      <p className="mt-3 text-[0.75rem] leading-relaxed text-ink/60">
        {PRESET_STATUS_HINTS[preset.status]}
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {[
          ["width", formatDimension(preset.width)],
          ["height", formatDimension(preset.height)],
          ["depth", formatDimension(preset.depth)],
          ["defaultShelves", String(preset.defaultShelves)],
          ["defaultDrawers", String(preset.defaultDrawers)],
          ["priceRef", preset.priceRef],
          ["version", preset.version],
          ["updatedAt", preset.updatedAt],
          ["updatedBy", preset.updatedBy],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-ink/8 bg-white/30 px-4 py-3"
          >
            <dt className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/42">
              {label}
            </dt>
            <dd className="mt-1 break-words text-[0.78rem] text-ink/78">{value}</dd>
          </div>
        ))}
      </dl>

      <ArchiveButton
        action={archiveModulePresetAction}
        fields={{ family: preset.family, id: preset.id }}
        available={availability.canArchive}
        reason={availability.canArchive ? undefined : availability.reason}
        entityLabel={`«${preset.family}:${preset.id}»`}
      />

      <p className="mt-3 text-[0.68rem] leading-relaxed text-ink/42">
        Источник: /admin/modules · сервис CA-T-205; изменение диапазонов и
        создание пресетов не входят в CA-T-503.
      </p>

      {composition ? (
        <Link
          href={`/admin/modules/${encodeURIComponent(preset.id)}`}
          className="link-line mt-3 inline-flex text-copper"
        >
          Фактический состав модуля ({composition.components.length} компонентов) →
        </Link>
      ) : null}
    </section>
  );
}

export async function PresetSection({ searchParams }: Props) {
  const raw = await searchParams;
  const filter = parsePresetFilter({
    family: single(raw.family),
    status: single(raw.status),
    q: single(raw.q),
  });
  const selectedId = single(raw.id);

  let items: ModulePreset[] = [];
  let loadError: string | null = null;
  try {
    items = await listModulePresets(
      filter.family === undefined ? {} : { family: filter.family },
    );
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Неизвестная ошибка.";
  }

  const filtered = loadError ? [] : filterModulePresets(items, filter);
  const selected = selectedId
    ? items.find((item) => item.id === selectedId)
    : undefined;

  const baseQuery: Record<string, string | undefined> = {
    family: filter.family,
    status: filter.status,
    q: filter.q,
  };

  return (
    <>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Семейства пресетов">
        <Link
          href={hrefWith({})}
          className={`chip ${filter.family === undefined ? "chip-copper" : ""}`}
          aria-current={filter.family === undefined ? "page" : undefined}
        >
          Все семейства
        </Link>
        {PRESET_FAMILIES.map((family) => (
          <Link
            key={family}
            href={hrefWith({ family })}
            className={`chip ${filter.family === family ? "chip-copper" : ""}`}
            aria-current={filter.family === family ? "page" : undefined}
          >
            {PRESET_FAMILY_LABELS[family]}
          </Link>
        ))}
      </nav>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="chip chip-copper">Real data</span>
        <span className="chip">ModulePreset · CA-T-205</span>
        {!loadError ? (
          <span className="chip">
            Показано {filtered.length} из {items.length}
          </span>
        ) : null}
      </div>

      <form
        method="get"
        action="/admin/modules"
        className="card-surface grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] md:items-end"
      >
        <label className="field">
          <span className="field-label">Статус</span>
          <select name="status" defaultValue={filter.status ?? ""} className="select">
            <option value="">Все</option>
            {PRESET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PRESET_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Поиск по id</span>
          <input
            type="search"
            name="q"
            defaultValue={filter.q ?? ""}
            placeholder="base"
            className="input"
          />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary btn-sm">
            Найти
          </button>
          <Link href={hrefWith({})} className="btn btn-glass btn-sm">
            Сброс
          </Link>
        </div>
        {filter.family ? (
          <input type="hidden" name="family" value={filter.family} />
        ) : null}
      </form>

      {loadError ? (
        <section className="card-surface mt-6 px-6 py-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-copper" size={20} />
            <div>
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
                Ошибка чтения
              </p>
              <h2 className="mt-2 text-lg font-semibold">
                Не удалось прочитать пресеты
              </h2>
              <p className="mt-2 break-words text-[0.78rem] text-ink/62">
                {loadError}
              </p>
              <Link href={hrefWith({})} className="btn btn-primary btn-sm mt-4">
                Повторить
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {!loadError && selectedId && !selected ? (
        <p className="mt-4 rounded-xl border border-amber-700/20 bg-amber-500/10 px-4 py-3 text-[0.78rem] text-amber-950">
          Пресет «{selectedId}» не найден; данные не подменяются.
        </p>
      ) : null}

      {selected ? <DetailCard preset={selected} /> : null}

      {!loadError && items.length === 0 ? (
        <section className="card-surface mt-6 px-6 py-10 text-center">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
            Нет данных
          </p>
          <h2 className="font-display mt-3 text-2xl">Пресеты отсутствуют</h2>
          <p className="body-copy mx-auto mt-3 max-w-2xl text-sm">
            Коллекция module-presets.json пуста. Создание пресетов не входит в
            CA-T-205/CA-T-503; панель не подставляет фиктивные значения.
          </p>
          <Link href="/admin" className="btn btn-glass btn-sm mt-6">
            Вернуться в обзор
          </Link>
        </section>
      ) : null}

      {!loadError && items.length > 0 && filtered.length === 0 ? (
        <section className="card-surface mt-6 px-6 py-10 text-center">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-copper">
            Нет совпадений
          </p>
          <h2 className="font-display mt-3 text-2xl">Фильтры не дали результатов</h2>
          <p className="body-copy mx-auto mt-3 max-w-2xl text-sm">
            Измените условия поиска или сбросьте фильтры.
          </p>
          <Link href={hrefWith({})} className="btn btn-glass btn-sm mt-6">
            Сбросить фильтры
          </Link>
        </section>
      ) : null}

      {!loadError && filtered.length > 0 ? (
        <section className="card-surface mt-6 overflow-hidden">
          <div className="border-b border-ink/8 px-5 py-4">
            <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-ink/62">
              Пресеты модулей
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] text-left text-[0.78rem]">
              <thead className="bg-white/25 text-[0.6rem] uppercase tracking-[0.12em] text-ink/42">
                <tr>
                  <th className="px-5 py-3 font-semibold">Пресет</th>
                  <th className="px-4 py-3 font-semibold">Семейство</th>
                  <th className="px-4 py-3 font-semibold">Зона</th>
                  <th className="px-4 py-3 font-semibold">Статус</th>
                  <th className="px-4 py-3 font-semibold">Полки / ящики</th>
                  <th className="px-4 py-3 font-semibold">Версия</th>
                  <th className="px-4 py-3 font-semibold">Состав</th>
                  <th className="px-5 py-3 font-semibold">Карточка</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((preset) => (
                  <tr key={`${preset.family}:${preset.id}`} className="border-t border-ink/7">
                    <td className="px-5 py-3">
                      <code className="break-all font-semibold">{preset.id}</code>
                    </td>
                    <td className="px-4 py-3 text-ink/62">
                      {PRESET_FAMILY_LABELS[preset.family]}
                    </td>
                    <td className="px-4 py-3 text-ink/62">{preset.zone}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={preset.status} />
                    </td>
                    <td className="px-4 py-3 text-ink/62">
                      {preset.defaultShelves} / {preset.defaultDrawers}
                    </td>
                    <td className="px-4 py-3 text-ink/62">{preset.version}</td>
                    <td className="px-4 py-3">
                      {preset.family === "kitchen" && getModuleComposition(preset.id) ? (
                        <Link
                          href={`/admin/modules/${encodeURIComponent(preset.id)}`}
                          className="link-line text-copper"
                        >
                          Состав
                        </Link>
                      ) : (
                        <span className="text-ink/40">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={hrefWith(baseQuery, { id: preset.id })}
                        className="link-line text-copper"
                      >
                        Открыть
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
