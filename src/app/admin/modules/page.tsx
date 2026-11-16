import type { Metadata } from "next";
import Link from "next/link";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";
import { PresetSection } from "@/components/admin/reference/PresetSection";
import {
  KITCHEN_MODULE_GROUPS,
  MODULE_COMPOSITION,
  WARDROBE_MODEL,
  getModuleComposition,
} from "@/lib/admin/catalog-model";
import { listModulePresets } from "@/lib/admin/presets";
import { getCompositionBoard } from "@/lib/admin/composition-board";
import { CompositionActions } from "@/components/admin/modules/CompositionActions";

import { sectionMetadata } from "../_components/section-route";

export const metadata: Metadata = sectionMetadata("modules");
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminModulesPage({ searchParams }: PageProps) {
  const [presets, composition] = await Promise.all([
    listModulePresets(),
    getCompositionBoard(),
  ]);
  const kitchenPresets = presets.filter((preset) => preset.family === "kitchen");
  const wardrobePresets = presets.filter((preset) => preset.family === "wardrobe");

  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="eyebrow">{ADMIN_SECTIONS.find((s) => s.id === "modules")?.index} / Calculation Admin</p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-ink sm:text-4xl">
          {ADMIN_SECTIONS.find((s) => s.id === "modules")?.title}
        </h1>
        <p className="body-copy mt-3">
          Кухня — 8 типов модулей с фактическим составом из расчётного кода.
          Шкаф — конфигурация из 1–2 секций; фиктивные ModulePreset для него не
          создаются.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <span className="chip chip-copper">ModulePreset · CA-T-205</span>
        <span className="chip">пресетов: {presets.length}</span>
        <span className="chip">кухня: {kitchenPresets.length}</span>
        <span className="chip">шкаф: {wardrobePresets.length}</span>
        <span className="chip">типов состава: {MODULE_COMPOSITION.length}</span>
      </div>

      <section className="card-surface mb-4 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
              Управляемый состав (CompositionVersion)
            </h2>
            <p className="mt-1 max-w-3xl text-[0.7rem] leading-relaxed text-ink/50">
              Draft редактируется, published неизменяем. Состав не содержит
              формул и сумм: нормы — ManagedRule/код, тарифы — PriceItem,
              суммы — PricingVersion.snapshot.
            </p>
          </div>
          <CompositionActions
            hasDraft={Boolean(composition.draft)}
            hasAnyVersion={composition.versions.length > 0}
            publishedId={composition.published?.id ?? null}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="chip">опубликовано: {composition.published?.id ?? "нет"}</span>
          <span className="chip">draft: {composition.draft?.id ?? "нет"}</span>
          <span className="chip">версий: {composition.versions.length}</span>
          <span className="chip">
            ошибок draft: {composition.validation.draft.filter((issue) => issue.severity === "error").length}
          </span>
        </div>
        {composition.issues.length > 0 ? (
          <p className="mt-3 rounded-xl border border-red-700/20 bg-red-600/8 px-4 py-2 text-[0.72rem] text-red-900">
            {composition.issues.join("; ")}
          </p>
        ) : null}
        {!composition.published && !composition.draft ? (
          <p className="mt-3 rounded-xl border border-amber-700/20 bg-amber-500/10 px-4 py-2 text-[0.72rem] text-amber-950">
            Управляемый состав ещё не создан. Кнопка импорта переносит
            подтверждённые строки `MODULE_COMPOSITION` в draft (source=preliminary,
            без публикации). Пока версии нет, карточки модулей показывают
            статический read-model как справку.
          </p>
        ) : null}
        {composition.published ? (
          <p className="mt-3 text-[0.68rem] text-ink/45">
            published seq {composition.published.publishedSeq ?? "—"} · строк{" "}
            {composition.published.lines.length} · hash{" "}
            {composition.published.contentHash.slice(0, 12)}…
          </p>
        ) : null}
      </section>

      <section className="card-surface px-5 py-5">
        <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
          Группы мебельных модулей
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {KITCHEN_MODULE_GROUPS.map((group) => (
            <div
              key={group.id}
              className="rounded-2xl border border-ink/10 bg-white/30 px-4 py-4"
            >
              <p className="text-[0.72rem] font-semibold text-ink/80">{group.label}</p>
              <p className="mt-1 text-[0.66rem] leading-relaxed text-ink/50">
                {group.description}
              </p>
              <div className="mt-3 space-y-1.5">
                {group.kitchenTypes.map((type) => {
                  const moduleComposition = getModuleComposition(type);
                  const preset = kitchenPresets.find((item) => item.id === type);
                  const summary = composition.modules.find((item) => item.type === type);
                  return (
                    <Link
                      key={type}
                      href={`/admin/modules/${encodeURIComponent(type)}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-ink/8 bg-white/45 px-2.5 py-1.5 text-[0.68rem] transition-colors hover:border-copper/40"
                    >
                      <span className="font-medium">{moduleComposition?.label ?? type}</span>
                      <span className="font-mono text-[0.58rem] text-ink/40">
                        {summary?.lineCount ?? 0} стр.
                        {summary && (summary.errorCount > 0 || summary.warningCount > 0)
                          ? ` · E${summary.errorCount}/W${summary.warningCount}`
                          : ""}
                        {" · "}
                        {preset ? `v${preset.version}` : "нет пресета"}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card-surface mt-4 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/52">
              Шкаф — конфигурация, не модульная система
            </h2>
            <p className="mt-2 max-w-3xl text-[0.75rem] leading-relaxed text-ink/60">
              {WARDROBE_MODEL.note}
            </p>
          </div>
          <span className="chip">ModulePreset: {wardrobePresets.length}</span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {WARDROBE_MODEL.elements.map((element) => (
            <div key={element.id} className="rounded-xl border border-ink/8 bg-white/30 px-3 py-2.5">
              <p className="text-[0.7rem] font-semibold text-ink/80">{element.label}</p>
              <p className="mt-0.5 text-[0.64rem] text-ink/50">{element.detail}</p>
            </div>
          ))}
        </div>
        <Link
          href="/admin/modules/wardrobe"
          className="link-line mt-4 inline-flex text-copper"
        >
          Открыть карточку шкафа →
        </Link>
      </section>

      <div className="mt-8">
        <PresetSection searchParams={searchParams} />
      </div>
    </>
  );
}
