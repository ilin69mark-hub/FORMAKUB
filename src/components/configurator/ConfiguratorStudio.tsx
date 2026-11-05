"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Check,
  Copy,
  Eye,
  EyeOff,
  Info,
  Layers3,
  LayoutGrid,
  Loader2,
  RotateCcw,
  Save,
  Send,
  Settings2,
  SlidersHorizontal,
  Share2,
} from "lucide-react";
import { FURNITURE_TYPES, WARDROBE_LIMITS } from "@/content/catalog";
import { defaultConfig } from "@/lib/configurator/defaults";
import {
  calculatePrice,
  formatRub,
  kitchenTotalWidth,
  wardrobeWidth,
} from "@/lib/configurator/pricing";
import { isConfigValid, validateConfig } from "@/lib/configurator/validation";
import { moveKitchenModule } from "@/lib/configurator/kitchenMove";
import { normalizeKitchen } from "@/lib/configurator/defaults";
import {
  clearLocalDraft,
  loadLocalDraft,
  saveLocalDraft,
} from "@/lib/configurator/storage";
import type { FurnitureConfig, FurnitureType } from "@/lib/configurator/types";
import { KitchenScene } from "@/components/configurator/KitchenScene";
import { WardrobeScene } from "@/components/configurator/WardrobeScene";
import { PriceSummary } from "@/components/configurator/PriceSummary";
import { KitchenPanel } from "@/components/configurator/KitchenPanel";
import { WardrobePanel } from "@/components/configurator/WardrobePanel";
import {
  FittingsPanel,
  KitchenOptionsPanel,
  MaterialsPanel,
  WardrobeOptionsPanel,
} from "@/components/configurator/SharedPanels";
import { LeadModal } from "@/components/configurator/LeadModal";

type KitchenTab = "modules" | "materials" | "surfaces" | "fittings";
type WardrobeTab = "sections" | "interior" | "materials" | "options" | "fittings";
type Tab = KitchenTab | WardrobeTab;

interface TabDefinition {
  id: Tab;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const KITCHEN_TABS: TabDefinition[] = [
  { id: "modules", label: "Состав", hint: "Модули и размеры", icon: Boxes },
  { id: "materials", label: "Материалы", hint: "Корпус и фасады", icon: Layers3 },
  { id: "surfaces", label: "Столешница", hint: "Поверхность и опции", icon: LayoutGrid },
  { id: "fittings", label: "Фурнитура", hint: "Ручки, петли, открывание", icon: Settings2 },
];

const WARDROBE_TABS: TabDefinition[] = [
  { id: "sections", label: "Секции", hint: "Габариты и состав", icon: Boxes },
  { id: "interior", label: "Наполнение", hint: "Полки, штанги, ящики", icon: SlidersHorizontal },
  { id: "materials", label: "Материалы", hint: "Корпус и фасады", icon: Layers3 },
  { id: "options", label: "Опции", hint: "Цоколь и подсветка", icon: LayoutGrid },
  { id: "fittings", label: "Фурнитура", hint: "Ручки, петли, открывание", icon: Settings2 },
];

function firstSelection(config: FurnitureConfig): string | null {
  return config.kind === "kitchen"
    ? (config.modules[0]?.id ?? null)
    : (config.sections[0]?.id ?? null);
}

function normalizePromo(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed.slice(0, 32) : undefined;
}

export function ConfiguratorStudio({
  type,
  initialProjectId,
  promo,
}: {
  type: FurnitureType;
  initialProjectId?: string;
  promo?: string;
}) {
  const [config, setConfig] = useState<FurnitureConfig>(() => defaultConfig(type));
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    firstSelection(defaultConfig(type)),
  );
  const [tab, setTab] = useState<Tab>(type === "kitchen" ? "modules" : "sections");
  const [showInterior, setShowInterior] = useState(false);
  const [booted, setBooted] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [saveProjectError, setSaveProjectError] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(
    initialProjectId ?? null,
  );
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [promoInput, setPromoInput] = useState(config.promoCode ?? "");
  const [leadOpen, setLeadOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const normalizedPromo = normalizePromo(promo);

    const withPromo = (next: FurnitureConfig): FurnitureConfig =>
      normalizedPromo ? { ...next, promoCode: normalizedPromo } : next;

    const boot = async () => {
      if (initialProjectId) {
        try {
          const response = await fetch(`/api/projects/${initialProjectId}`, {
            cache: "no-store",
          });
          const data = (await response.json().catch(() => null)) as
            | { ok: boolean; project?: { config: FurnitureConfig }; error?: string }
            | null;
          if (!response.ok || !data?.ok || !data.project) {
            if (alive) {
              setLoadError(
                data?.error ??
                  "Проект не найден. Можно продолжить с чистого листа или восстановить черновик.",
              );
            }
          } else if (data.project.config.kind !== type) {
            if (alive) {
              setLoadError("Тип сохранённого проекта не совпадает с этой страницей.");
            }
          } else {
            const next = withPromo(data.project.config);
            if (alive) {
              setConfig(next);
              setSelectedId(firstSelection(next));
              setSavedProjectId(initialProjectId);
              setPromoInput(next.promoCode ?? "");
            }
            return;
          }
        } catch {
          if (alive) {
            setLoadError("Не удалось загрузить проект. Проверьте соединение.");
          }
        }
      }

      const draft = loadLocalDraft(type);
      if (draft && draft.kind === type) {
        const next = withPromo(draft);
        if (alive) {
          setConfig(next);
          setSelectedId(firstSelection(next));
          setRestoredDraft(true);
          setPromoInput(next.promoCode ?? "");
        }
      } else if (normalizedPromo) {
        if (alive) {
          setConfig((current) => withPromo(current));
          setPromoInput(normalizedPromo);
        }
      }

      if (alive) setBooted(true);
    };

    void boot().finally(() => {
      if (alive) setBooted(true);
    });

    return () => {
      alive = false;
    };
  }, [type, initialProjectId, promo]);

  useEffect(() => {
    if (!booted) return;
    const timer = window.setTimeout(() => {
      saveLocalDraft(config);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [config, booted]);

  const issues = useMemo(() => validateConfig(config), [config]);
  const errors = useMemo(
    () => issues.filter((issue) => issue.severity === "error"),
    [issues],
  );
  const warnings = useMemo(
    () => issues.filter((issue) => issue.severity === "warning"),
    [issues],
  );
  // id модулей с ошибками — красная подсветка на схеме.
  const invalidIds = useMemo(() => {
    const ids = errors
      .map((issue) => /^modules\.([^.]+)/.exec(issue.path)?.[1])
      .filter((id): id is string => Boolean(id));
    return [...new Set(ids)];
  }, [errors]);
  const valid = isConfigValid(issues);
  const price = useMemo(() => calculatePrice(config), [config]);
  const selectedExists =
    config.kind === "kitchen"
      ? config.modules.some((item) => item.id === selectedId)
      : config.sections.some((section) => section.id === selectedId);
  const activeSelectedId = selectedExists ? selectedId : firstSelection(config);

  const updateConfig = useCallback((next: FurnitureConfig) => {
    setConfig(next);
    setSavedProjectId(null);
    setCopyState("idle");
    setSaveProjectError("");
  }, []);

  const reset = () => {
    if (
      !window.confirm(
        "Сбросить текущую конфигурацию? Черновик в этом браузере будет удалён.",
      )
    ) {
      return;
    }
    const next = defaultConfig(type);
    setConfig(next);
    setSelectedId(firstSelection(next));
    clearLocalDraft(type);
    setSavedProjectId(null);
    setRestoredDraft(false);
    setLoadError("");
    setSaveProjectError("");
    setPromoInput("");
  };

  const closeLead = useCallback(() => setLeadOpen(false), []);

  const saveProject = async () => {
    if (!valid || savingProject) return;
    setSavingProject(true);
    setSaveProjectError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: boolean; id?: string; error?: string }
        | null;
      if (!response.ok || !data?.ok || !data.id) {
        setSaveProjectError(data?.error ?? "Не удалось сохранить проект.");
        return;
      }
      setSavedProjectId(data.id);
      const url = new URL(window.location.href);
      url.searchParams.set("project", data.id);
      url.searchParams.delete("promo");
      window.history.replaceState(null, "", url.toString());
    } catch {
      setSaveProjectError("Не удалось связаться с сервером.");
    } finally {
      setSavingProject(false);
    }
  };

  const copyProjectLink = async () => {
    if (!savedProjectId) return;
    const url = `${window.location.origin}/configurator/${config.kind}?project=${savedProjectId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // The visible link can still be copied manually.
    }
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1800);
  };

  const applyPromo = () => {
    updateConfig({ ...config, promoCode: normalizePromo(promoInput) ?? "" });
  };

  const tabs = config.kind === "kitchen" ? KITCHEN_TABS : WARDROBE_TABS;
  const totalWidth =
    config.kind === "kitchen"
      ? Math.round(kitchenTotalWidth(config))
      : Math.round(wardrobeWidth(config));
  // Для кухни лимит ширины снят, для шкафа предел остаётся.
  const maxWidth = config.kind === "wardrobe" ? WARDROBE_LIMITS.maxTotalWidth : null;
  const height =
    config.kind === "kitchen"
      ? (config.modules.find(
          (module) => !["tall", "oven"].includes(module.type),
        )?.height ?? 90)
      : config.height;
  const depth =
    config.kind === "kitchen"
      ? (config.modules[0]?.depth ?? 60)
      : config.depth;
  const itemCount =
    config.kind === "kitchen" ? config.modules.length : config.sections.length;
  const configLabel = FURNITURE_TYPES[config.kind].label;
  const projectUrl = savedProjectId
    ? `/configurator/${config.kind}?project=${savedProjectId}`
    : "";

  return (
    <div className="min-h-screen bg-cream pb-28 pt-[var(--header-h)] lg:pb-10">
      <div className="sticky top-[var(--header-h)] z-40 border-b border-ink/10 bg-cream/92 backdrop-blur-xl">
        <div className="container-page flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 sm:py-3">
          <Link
            href="/"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-white/40 text-ink/55 transition-colors hover:bg-white hover:text-ink"
            aria-label="Вернуться на главную"
          >
            <ArrowLeft size={16} />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="text-[0.54rem] font-bold uppercase tracking-[0.18em] text-copper">
              Конфигуратор · демо
            </div>
            <h1 className="truncate font-display text-[1.15rem] leading-tight sm:text-[1.35rem]">
              {configLabel} по вашим размерам
            </h1>
          </div>

          <div className="hidden items-center gap-2 text-[0.62rem] text-ink/40 xl:flex">
            <Check size={12} className="text-emerald-700" />
            Черновик сохраняется в браузере
          </div>

          <div className="flex w-full items-center gap-1.5 sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={reset}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/10 bg-white/40 text-ink/50 transition-colors hover:bg-white hover:text-ink"
              title="Сбросить конфигурацию"
              aria-label="Сбросить конфигурацию"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              onClick={saveProject}
              disabled={!valid || savingProject}
              className="btn btn-glass btn-sm flex-1 justify-center gap-1.5 sm:flex-none"
              title={valid ? "Сохранить проект и получить ссылку" : "Исправьте ошибки в конфигурации"}
            >
              {savingProject ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span className="hidden md:inline">Сохранить проект</span>
              <span className="md:hidden">Сохранить</span>
            </button>
            <button
              type="button"
              onClick={() => setLeadOpen(true)}
              disabled={!valid}
              className="btn btn-primary btn-sm flex-1 justify-center gap-1.5 sm:flex-none"
              title={valid ? "Оставить заявку" : "Исправьте ошибки в конфигурации"}
            >
              <Send size={14} />
              <span className="hidden md:inline">Оставить заявку</span>
              <span className="md:hidden">Заявка</span>
            </button>
          </div>
        </div>
      </div>

      <div className="container-page py-4 lg:py-6">
        {loadError && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-700/20 bg-amber-500/8 px-3.5 py-2.5 text-[0.7rem] leading-relaxed text-amber-900">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}
        {restoredDraft && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/10 bg-white/45 px-3.5 py-2.5 text-[0.68rem] text-ink/55">
            <span className="flex items-center gap-2">
              <Check size={13} className="text-emerald-700" />
              Восстановлен черновик из этого браузера.
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={reset}
                className="font-semibold text-copper underline decoration-copper/25 underline-offset-2"
              >
                Начать заново
              </button>
              <button
                type="button"
                onClick={() => setRestoredDraft(false)}
                className="text-ink/38 hover:text-ink/70"
              >
                Скрыть
              </button>
            </div>
          </div>
        )}

        <div className="grid min-w-0 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)_16rem] lg:gap-3.5">
          <aside className="order-2 min-w-0 lg:order-1">
            <div className="studio-panel p-2.5 lg:sticky lg:top-[calc(var(--header-h)+4.3rem)]">
              <div className="grid grid-cols-2 gap-1">
                {tabs.map((item, index) => {
                  const Icon = item.icon;
                  const active = tab === item.id;
                  const oddLast = tabs.length % 2 === 1 && index === tabs.length - 1;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      title={item.hint}
                      className={`flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-2 text-left transition-colors ${oddLast ? "col-span-2" : ""} ${
                        active
                          ? "bg-ink text-cream"
                          : "text-ink/55 hover:bg-white/55 hover:text-ink"
                      }`}
                      aria-pressed={active}
                    >
                      <Icon
                        size={13}
                        className={`shrink-0 ${active ? "text-copper-bright" : "text-ink/35"}`}
                      />
                      <span className="truncate text-[0.62rem] font-semibold">{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-2.5 border-t border-ink/8 pt-3 lg:max-h-[calc(100svh-16rem)] lg:overflow-y-auto lg:pr-1">
                {config.kind === "kitchen" ? (
                  tab === "modules" ? (
                    <KitchenPanel
                      config={config}
                      onChange={updateConfig}
                      selectedId={activeSelectedId}
                      onSelect={setSelectedId}
                    />
                  ) : tab === "materials" ? (
                    <MaterialsPanel config={config} onChange={updateConfig} />
                  ) : tab === "surfaces" ? (
                    <KitchenOptionsPanel
                      config={config}
                      onChange={updateConfig}
                    />
                  ) : (
                    <FittingsPanel config={config} onChange={updateConfig} />
                  )
                ) : tab === "sections" || tab === "interior" ? (
                  <WardrobePanel
                    config={config}
                    onChange={updateConfig}
                    selectedId={activeSelectedId}
                    onSelect={setSelectedId}
                    view={tab}
                  />
                ) : tab === "materials" ? (
                  <MaterialsPanel config={config} onChange={updateConfig} />
                ) : tab === "options" ? (
                  <WardrobeOptionsPanel
                    config={config}
                    onChange={updateConfig}
                  />
                ) : (
                  <FittingsPanel config={config} onChange={updateConfig} />
                )}
              </div>
            </div>
          </aside>

          <section className="order-1 min-w-0 lg:order-2">
            <div className="studio-panel overflow-hidden lg:sticky lg:top-[calc(var(--header-h)+4.3rem)]">
              <div className="flex items-center justify-between gap-3 border-b border-ink/8 px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="badge-demo">demo</span>
                  <span className="text-[0.58rem] font-bold uppercase tracking-[0.14em] text-ink/38">
                    2D-схема · вид спереди
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInterior((value) => !value)}
                  className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-white/50 px-2.5 py-1.5 text-[0.6rem] font-semibold text-ink/55 transition-colors hover:bg-white"
                  aria-pressed={showInterior}
                >
                  {showInterior ? <EyeOff size={12} /> : <Eye size={12} />}
                  <span className="sm:hidden">{showInterior ? "Фасады" : "Наполнение"}</span>
                  <span className="hidden sm:inline">
                    {showInterior ? "Показать фасады" : "Показать наполнение"}
                  </span>
                </button>
              </div>

              <div className="studio-stage m-2 sm:m-2.5">
                <div className="relative aspect-[4/3] w-full sm:aspect-[16/10]">
                  {config.kind === "kitchen" ? (
                    <KitchenScene
                      config={config}
                      selectedId={activeSelectedId}
                      onSelect={setSelectedId}
                      invalidIds={invalidIds}
                      onMove={(id, direction) => {
                        if (config.kind === "kitchen") {
                          updateConfig(
                            normalizeKitchen(
                              moveKitchenModule(config, id, direction),
                            ),
                          );
                        }
                      }}
                      showInterior={showInterior}
                      showDimensions
                      className="absolute inset-0 h-full w-full"
                    />
                  ) : (
                    <WardrobeScene
                      config={config}
                      selectedId={activeSelectedId}
                      onSelect={setSelectedId}
                      showInterior={showInterior}
                      showDimensions
                      className="absolute inset-0 h-full w-full"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 divide-x divide-ink/8 border-t border-ink/8">
                {[
                  { label: "Ширина", value: `${totalWidth} см` },
                  { label: "Высота", value: `${height} см` },
                  { label: "Глубина", value: `${depth} см` },
                  {
                    label: config.kind === "kitchen" ? "Модули" : "Секции",
                    value: String(itemCount),
                  },
                ].map((item) => (
                  <div key={item.label} className="px-2 py-2.5 text-center">
                    <div className="text-[0.52rem] font-bold uppercase tracking-[0.12em] text-ink/32">
                      {item.label}
                    </div>
                    <div className="mt-0.5 text-[0.7rem] font-semibold text-ink/65">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-1 text-[0.6rem] text-ink/35">
              <span className="flex items-center gap-1.5">
                <Info size={11} />
                Нажмите на модуль на схеме, чтобы выбрать его. Перемещение —
                круглые кнопки ←/→ у выбранного модуля.
              </span>
              <span>
                {maxWidth !== null ? `${totalWidth} / ${maxWidth} см` : `${totalWidth} см`} · {formatRub(price.total)}
              </span>
            </div>

            {(errors.length > 0 || warnings.length > 0) && (
              <div
                className={`mt-2.5 rounded-xl border px-3.5 py-2.5 ${
                  errors.length > 0
                    ? "border-red-900/15 bg-red-500/[0.06]"
                    : "border-amber-700/20 bg-amber-500/[0.06]"
                }`}
              >
                <div className="flex items-center gap-2 text-[0.66rem] font-bold">
                  <AlertTriangle
                    size={13}
                    className={errors.length > 0 ? "text-red-800" : "text-amber-800"}
                  />
                  {errors.length > 0 ? "Нужно исправить" : "Обратите внимание"}
                </div>
                <ul className="mt-1.5 space-y-1 text-[0.64rem] leading-relaxed text-ink/55">
                  {[...errors, ...warnings].slice(0, 3).map((issue, index) => (
                    <li key={`${issue.path}-${index}`} className="flex gap-1.5">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <aside className="order-3 min-w-0">
            <div className="studio-panel p-3.5 lg:sticky lg:top-[calc(var(--header-h)+4.3rem)]">
              <PriceSummary price={price} />

              <div className="mt-4 border-t border-ink/10 pt-3">
                <label
                  htmlFor="promo-code"
                  className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40"
                >
                  Промокод
                </label>
                <div className="mt-1.5 flex gap-1.5">
                  <input
                    id="promo-code"
                    value={promoInput}
                    onChange={(event) => setPromoInput(event.target.value.toUpperCase())}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        applyPromo();
                      }
                    }}
                    placeholder="DEMO10"
                    maxLength={32}
                    className="input min-w-0 flex-1 py-2 text-[0.7rem] tracking-[0.08em]"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={applyPromo}
                    className="rounded-[0.7rem] border border-ink/12 bg-white/50 px-3 text-[0.64rem] font-semibold transition-colors hover:bg-white"
                  >
                    ОК
                  </button>
                </div>
                <p className="mt-1.5 text-[0.56rem] leading-relaxed text-ink/32">
                  Демо-коды: DEMO10, WARDROBE7, DEMO5000.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setLeadOpen(true)}
                disabled={!valid}
                className="btn btn-accent mt-4 w-full"
              >
                Оставить заявку
                <Send size={15} />
              </button>
              <button
                type="button"
                onClick={saveProject}
                disabled={!valid || savingProject}
                className="btn btn-glass btn-sm mt-2 w-full"
              >
                {savingProject ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Сохранить и получить ссылку
              </button>

              {!valid && (
                <p className="mt-2 text-center text-[0.6rem] leading-relaxed text-red-800/75">
                  Исправьте ошибки в конфигурации, чтобы сохранить проект или
                  отправить заявку.
                </p>
              )}
              {saveProjectError && (
                <p className="mt-2 text-center text-[0.6rem] leading-relaxed text-red-800/75">
                  {saveProjectError}
                </p>
              )}

              {savedProjectId && (
                <div className="mt-3 rounded-xl border border-emerald-900/12 bg-emerald-700/[0.05] p-2.5">
                  <div className="flex items-center gap-1.5 text-[0.6rem] font-bold uppercase tracking-[0.1em] text-emerald-900/70">
                    <Share2 size={11} />
                    Ссылка на проект
                  </div>
                  <Link
                    href={projectUrl}
                    className="mt-1 block truncate text-[0.6rem] text-ink/45 underline decoration-ink/15 underline-offset-2"
                  >
                    {projectUrl}
                  </Link>
                  <button
                    type="button"
                    onClick={copyProjectLink}
                    className="mt-1.5 flex items-center gap-1.5 text-[0.62rem] font-semibold text-emerald-900"
                  >
                    {copyState === "copied" ? <Check size={12} /> : <Copy size={12} />}
                    {copyState === "copied" ? "Скопировано" : "Скопировать ссылку"}
                  </button>
                  <p className="mt-1 text-[0.55rem] leading-relaxed text-ink/35">
                    Ссылка открывает конфигурацию без персональных данных.
                  </p>
                </div>
              )}

              <div className="mt-3 space-y-1.5 border-t border-ink/8 pt-3 text-[0.58rem] leading-relaxed text-ink/35">
                <p className="flex items-start gap-1.5">
                  <Info size={11} className="mt-0.5 shrink-0" />
                  Демонстрационные расценки и ограничения. Не является офертой.
                </p>
                <p>Онлайн-оплата не проводится. Заявка ничего не списывает.</p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-ink/10 bg-cream/94 px-3 py-2.5 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[0.52rem] font-bold uppercase tracking-[0.14em] text-ink/38">
              Ориентировочно
            </div>
            <div className="font-display text-[1.2rem] leading-tight">
              {formatRub(price.total)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLeadOpen(true)}
            disabled={!valid}
            className="btn btn-primary btn-sm shrink-0"
          >
            Оставить заявку
          </button>
        </div>
      </div>

      <LeadModal open={leadOpen} config={config} onClose={closeLead} />
    </div>
  );
}
