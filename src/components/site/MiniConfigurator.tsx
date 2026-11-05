"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Eye,
  EyeOff,
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  FACADE_MATERIALS,
  KITCHEN_MODULES,
} from "@/content/catalog";
import { defaultKitchen, makeKitchenModule } from "@/lib/configurator/defaults";
import { calculatePrice, kitchenTotalWidth } from "@/lib/configurator/pricing";
import { saveLocalDraft } from "@/lib/configurator/storage";
import type { KitchenConfig } from "@/lib/configurator/types";
import { KitchenScene } from "@/components/configurator/KitchenScene";
import { RangeMarks } from "@/components/configurator/ui";
import { PriceSummary } from "@/components/configurator/PriceSummary";

const finishes = FACADE_MATERIALS.find((material) => material.id === "mdf")?.finishes ?? [];

export function MiniConfigurator() {
  const router = useRouter();
  const [config, setConfig] = useState<KitchenConfig>(() => defaultKitchen());
  const [selectedId, setSelectedId] = useState<string>("m-drawers");
  const [showInterior, setShowInterior] = useState(false);

  const selected =
    config.modules.find((module) => module.id === selectedId) ??
    config.modules[0] ??
    null;
  const selectedModuleId = selected?.id ?? null;
  const preset = selected ? KITCHEN_MODULES[selected.type] : null;
  const price = useMemo(() => calculatePrice(config), [config]);
  const totalWidth = Math.round(kitchenTotalWidth(config));
  const wallCount = config.modules.filter((module) => module.type === "wall").length;

  const updateWidth = (value: number) => {
    if (!selected || !preset) return;
    const width = Math.min(preset.maxWidth, Math.max(preset.minWidth, Math.round(value)));
    setConfig((current) => ({
      ...current,
      modules: current.modules.map((module) =>
        module.id === selected.id ? { ...module, width } : module,
      ),
    }));
  };

  const toggleWall = () => {
    const walls = config.modules.filter((module) => module.type === "wall");
    if (walls.length > 0) {
      const last = walls[walls.length - 1];
      const modules = config.modules.filter((module) => module.id !== last.id);
      setConfig({ ...config, modules });
      if (selectedId === last.id) {
        setSelectedId(modules[0]?.id ?? "");
      }
      return;
    }
    const added = makeKitchenModule("wall", { width: 60 });
    setConfig({ ...config, modules: [...config.modules, added] });
    setSelectedId(added.id);
  };

  const openFull = () => {
    saveLocalDraft(config);
    router.push("/configurator/kitchen");
  };

  return (
    <section id="configurator" className="section-pad relative overflow-hidden">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-[2rem] bg-ink p-5 text-cream sm:rounded-[2.6rem] sm:p-8 lg:p-10">
          <div
            className="pointer-events-none absolute -left-30 -top-30 h-96 w-96 rounded-full opacity-40 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, rgba(225,165,112,0.4), transparent 65%)",
            }}
            aria-hidden
          />

          <div className="relative grid min-w-0 gap-8 lg:grid-cols-12 lg:gap-10">
            <div className="min-w-0 lg:col-span-4 lg:py-4">
              <span className="eyebrow eyebrow-light reveal">Конфигуратор · демо</span>
              <h2 className="display reveal mt-5 text-[clamp(2.6rem,4.3vw,4.2rem)]">
                Не листайте каталог.
                <br />
                <span className="text-cream/42">Соберите свой вариант.</span>
              </h2>
              <p className="body-copy body-copy-light reveal mt-5 max-w-md">
                Начните с модулей: мойка, варочная зона, ящики, пенал и верхний
                ряд. Меняйте ширину, открывайте наполнение и смотрите, как
                меняется ориентир по стоимости.
              </p>

              <ul className="mt-7 space-y-3">
                {[
                  "Только разрешённые элементы и размеры",
                  "Цена пересчитывается сразу",
                  "Черновик сохраняется в браузере",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-[0.78rem] text-cream/58">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-white/6">
                      <Sparkles size={10} className="text-copper-bright" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={openFull}
                className="btn btn-accent mt-8 hidden w-full sm:w-auto lg:inline-flex"
              >
                Открыть полный конфигуратор
                <ArrowUpRight size={16} />
              </button>
            </div>

            <div className="min-w-0 lg:col-span-8">
              <div className="glass-dark overflow-hidden rounded-[1.5rem] p-2.5 sm:p-3">
                <div className="flex items-center justify-between px-2 pb-2.5 pt-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-copper/80" />
                    <span className="h-2 w-2 rounded-full bg-cream/20" />
                    <span className="h-2 w-2 rounded-full bg-cream/20" />
                    <span className="ml-2 text-[0.58rem] font-bold uppercase tracking-[0.18em] text-cream/38">
                      Formakub / 2D project
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowInterior((value) => !value)}
                      className="flex items-center gap-1.5 rounded-full border border-white/12 bg-white/6 px-2.5 py-1.5 text-[0.6rem] font-semibold text-cream/65 transition-colors hover:bg-white/10"
                      aria-pressed={showInterior}
                    >
                      {showInterior ? <EyeOff size={11} /> : <Eye size={11} />}
                      {showInterior ? "Фасады" : "Наполнение"}
                    </button>
                    <span className="hidden rounded-full border border-white/12 bg-white/6 px-2.5 py-1.5 text-[0.6rem] text-cream/50 sm:block">
                      {totalWidth} см
                    </span>
                  </div>
                </div>

                <div className="overflow-hidden rounded-[1.1rem] bg-[#f3ede4]">
                  <KitchenScene
                    config={config}
                    selectedId={selectedModuleId}
                    onSelect={setSelectedId}
                    showInterior={showInterior}
                    showDimensions
                    compact
                    className="h-auto w-full"
                  />
                </div>

                <div className="mt-2.5 rounded-[1.1rem] bg-white/94 p-3 text-ink sm:p-4">
                  <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
                    {config.modules.map((module) => (
                      <button
                        key={module.id}
                        type="button"
                        onClick={() => setSelectedId(module.id)}
                        className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[0.62rem] font-semibold transition-colors ${
                          module.id === selectedModuleId
                            ? "border-ink bg-ink text-cream"
                            : "border-ink/10 bg-ink/[0.03] text-ink/60 hover:bg-ink/[0.06]"
                        }`}
                      >
                        {KITCHEN_MODULES[module.type].shortLabel} · {module.width}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 grid gap-3 border-t border-ink/8 pt-3 sm:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[0.62rem] font-semibold text-ink/50">
                          Ширина {preset ? `«${preset.shortLabel}»` : "модуля"}
                        </span>
                        <span className="text-[0.65rem] font-bold text-ink">
                          {selected?.width ?? 60} см
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateWidth((selected?.width ?? 60) - 1)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/12 text-ink/60 transition-colors hover:bg-ink/5"
                          aria-label="Уменьшить ширину на 1 сантиметр"
                        >
                          <Minus size={12} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <input
                            type="range"
                            min={preset?.minWidth ?? 40}
                            max={preset?.maxWidth ?? 120}
                            step={1}
                            value={selected?.width ?? 60}
                            onChange={(event) => updateWidth(Number(event.target.value))}
                            className="range"
                            aria-label="Ширина выбранного модуля"
                          />
                          <RangeMarks
                            min={preset?.minWidth ?? 40}
                            max={preset?.maxWidth ?? 120}
                            step={5}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => updateWidth((selected?.width ?? 60) + 1)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/12 text-ink/60 transition-colors hover:bg-ink/5"
                          aria-label="Увеличить ширину на 1 сантиметр"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[0.62rem] font-semibold text-ink/50">
                          Фасад · МДФ
                        </span>
                        <button
                          type="button"
                          onClick={toggleWall}
                          className="text-[0.6rem] font-semibold text-copper underline decoration-copper/30 underline-offset-2"
                        >
                          {wallCount > 0 ? "Убрать верх" : "Добавить верх"}
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        {finishes.map((finish) => (
                          <button
                            key={finish.id}
                            type="button"
                            onClick={() =>
                              setConfig((current) => ({
                                ...current,
                                facadeMaterial: "mdf",
                                facadeFinish: finish.id,
                              }))
                            }
                            className="swatch"
                            data-active={config.facadeFinish === finish.id}
                            style={{ background: finish.hex, width: "1.7rem", height: "1.7rem" }}
                            aria-label={`Фасад: ${finish.name}`}
                            aria-pressed={config.facadeFinish === finish.id}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <PriceSummary price={price} compact />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={openFull}
                    className="btn btn-primary mt-3 w-full sm:hidden"
                  >
                    Открыть конфигуратор
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </div>
              <p className="mt-3 text-center text-[0.6rem] leading-relaxed text-cream/32 sm:text-left">
                Демонстрационные расценки и ограничения. Итоговая стоимость —
                после проверки размеров и комплектации.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
