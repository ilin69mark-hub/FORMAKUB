"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { KITCHEN_LIMITS, KITCHEN_MODULES as MODULES } from "@/content/catalog";
import { makeKitchenModule, normalizeKitchen } from "@/lib/configurator/defaults";
import {
  formatRub,
  kitchenFloorModules,
  kitchenUpperModules,
} from "@/lib/configurator/pricing";
import type {
  KitchenConfig,
  KitchenModule,
  KitchenModuleType,
} from "@/lib/configurator/types";
import {
  SINK_RULES,
  SINK_STANDARD_SIZES,
  isBottleEdgeSection,
  isSinkStandardSize,
  maxSinkDepthFor,
  maxSinkWidthFor,
  normalizeSinkModule,
  resolveDrawerCount,
  sinkFacadeCount,
  sinkGeometry,
  sinkLayout,
  sinkPartitionConflicts,
  sinkRowContext,
  sinkThreeDoorAvailable,
  sectionFitsDrawers,
  sectionOuterWidth,
} from "@/lib/configurator/sink";
import {
  ChoiceCard,
  HelpHint,
  MiniButton,
  PanelSection,
  RangeField,
  SwitchRow,
} from "./ui";

const ADD_ORDER: KitchenModuleType[] = [
  "base",
  "sink",
  "hob",
  "drawers",
  "wall",
  "tall",
  "oven",
  "bottle",
];

function isTall(type: KitchenModuleType): boolean {
  return type === "tall" || type === "oven";
}

export function KitchenPanel({
  config,
  onChange,
  selectedId,
  onSelect,
}: {
  config: KitchenConfig;
  onChange: (next: KitchenConfig) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  const selected =
    config.modules.find((module) => module.id === selectedId) ?? config.modules[0];
  const preset = selected ? MODULES[selected.type] : MODULES.base;
  const floor = kitchenFloorModules(config);
  const upper = kitchenUpperModules(config);

  const floorHeight =
    floor.find((module) => !isTall(module.type))?.height ?? 90;
  const tallHeight = floor.find((module) => isTall(module.type))?.height ?? 220;
  const wallHeight = upper[0]?.height ?? 72;
  const maxUpperHeight = (base: number) =>
    Math.max(
      MODULES.wall.minHeight,
      Math.min(
        MODULES.wall.maxHeight,
        MODULES.tall.maxHeight -
          base -
          config.countertopThickness / 10 -
          KITCHEN_LIMITS.wallGapAboveCountertop,
      ),
    );

  const depthRange = (modules: KitchenModule[]) => {
    if (modules.length === 0) return { min: 50, max: 60, value: 60 };
    return {
      min: Math.max(...modules.map((module) => MODULES[module.type].minDepth)),
      max: Math.min(...modules.map((module) => MODULES[module.type].maxDepth)),
      value: modules[0].depth,
    };
  };

  const floorDepth = depthRange(floor);
  const upperDepth = depthRange(upper);

  const setZoneDepth = (zone: "floor" | "upper", depth: number) => {
    const next = {
      ...config,
      modules: config.modules.map((module) =>
        MODULES[module.type].zone === zone ? { ...module, depth } : module,
      ),
    };
    onChange(normalizeKitchen(next));
  };

  const patchModule = (id: string, patch: Partial<KitchenModule>) => {
    const modules = config.modules.map((module) =>
      module.id === id
        ? normalizeSinkModule(
            { ...module, ...patch },
            sinkRowContext(config.modules, id),
          )
        : module,
    );
    onChange({ ...config, modules });
  };

  const setBaseHeight = (height: number) => {
    const upperMax = maxUpperHeight(height);
    onChange({
      ...config,
      modules: config.modules.map((module) => {
        if (["base", "sink", "hob", "drawers", "bottle"].includes(module.type)) {
          return { ...module, height };
        }
        if (module.type === "wall") {
          return { ...module, height: Math.min(module.height, upperMax) };
        }
        return module;
      }),
    });
  };

  const setAllHeights = (
    types: KitchenModuleType[],
    height: number,
  ) => {
    onChange({
      ...config,
      modules: config.modules.map((module) =>
        types.includes(module.type) ? { ...module, height } : module,
      ),
    });
  };

  const canAdd = (type: KitchenModuleType): string | null => {
    if (config.modules.length >= KITCHEN_LIMITS.maxModules) {
      return "Достигнут лимит модулей";
    }
    if (type === "sink" && floor.some((module) => module.type === "sink")) {
      return "Мойка уже добавлена";
    }
    if (type === "hob" && floor.some((module) => module.type === "hob")) {
      return "Варочная зона уже добавлена";
    }
    if (type === "oven" && floor.some((module) => module.type === "oven")) {
      return "Пенал под технику уже добавлен";
    }
    return null;
  };

  const addModule = (type: KitchenModuleType) => {
    if (canAdd(type)) return;
    const presetForType = MODULES[type];
    const height = isTall(type)
      ? tallHeight
      : presetForType.zone === "upper"
        ? wallHeight
        : floorHeight;
    const zone = presetForType.zone;
    const zoneModules = zone === "upper" ? upper : floor;
    const previousDepth = zoneModules[0]?.depth ?? presetForType.defaultDepth;
    const depth = Math.min(
      presetForType.maxDepth,
      Math.max(presetForType.minDepth, previousDepth),
    );
    const item = makeKitchenModule(type, {
      height,
      width: presetForType.defaultWidth,
      depth,
    });
    const modules = [
      ...config.modules.map((module) =>
        MODULES[module.type].zone === zone ? { ...module, depth } : module,
      ),
      item,
    ];
    onChange(normalizeKitchen({ ...config, modules }));
    onSelect(item.id);
    setAdding(false);
  };

  const removeSelected = () => {
    if (!selected || config.modules.length <= KITCHEN_LIMITS.minModules) return;
    const zoneModules = (preset.zone === "upper" ? upper : floor).filter(
      (module) => module.id !== selected.id,
    );
    onChange(
      normalizeKitchen({
        ...config,
        modules: config.modules.filter((module) => module.id !== selected.id),
      }),
    );
    onSelect(zoneModules[0]?.id ?? config.modules.find((m) => m.id !== selected.id)?.id ?? "");
  };

  const maxWidthByTotal = Number.POSITIVE_INFINITY;

  return (
    <div className="space-y-5">
      <PanelSection
        title="Модули кухни"
        hint="Выберите модуль на схеме или в списке. Нижние модули и пеналы должны иметь одинаковую высоту."
      >
        <div className="space-y-1">
          {(["floor", "upper"] as const).map((zone) => {
            const items = zone === "floor" ? floor : upper;
            if (items.length === 0) return null;
            return (
              <div key={zone}>
                <div className="mb-1 mt-2 text-[0.55rem] font-bold uppercase tracking-[0.16em] text-ink/32 first:mt-0">
                  {zone === "floor" ? "Нижний ряд и пеналы" : "Верхний ряд"}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map((module) => {
                    const itemPreset = MODULES[module.type];
                    return (
                      <button
                        key={module.id}
                        type="button"
                        onClick={() => onSelect(module.id)}
                        className={`module-pill ${module.id === selected?.id ? "ring-1 ring-copper/30" : ""}`}
                        data-selected={module.id === selected?.id}
                      >
                        <span className="min-w-0 flex-1 truncate text-[0.66rem] font-semibold">
                          {itemPreset.shortLabel}
                        </span>
                        <span className="text-[0.58rem] text-ink/38">{module.width}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setAdding((value) => !value)}
            disabled={config.modules.length >= KITCHEN_LIMITS.maxModules}
            className="flex items-center gap-1.5 text-[0.64rem] font-semibold text-copper disabled:opacity-40"
          >
            <Plus size={12} />
            Добавить модуль
          </button>
          <span className="text-[0.58rem] text-ink/35">
            {config.modules.length} / {KITCHEN_LIMITS.maxModules}
          </span>
        </div>

        {adding && (
          <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-xl border border-ink/10 bg-white/30 p-2">
            {ADD_ORDER.map((type) => {
              const reason = canAdd(type);
              const itemPreset = MODULES[type];
              return (
                <ChoiceCard
                  key={type}
                  title={itemPreset.shortLabel}
                  description={reason ?? `${itemPreset.zone === "upper" ? "верх" : "низ"} · ${formatRub(itemPreset.basePrice)}`}
                  selected={false}
                  disabled={Boolean(reason)}
                  onClick={() => addModule(type)}
                />
              );
            })}
          </div>
        )}
      </PanelSection>

      {selected && (
        <PanelSection
          title={preset.label}
          hint={preset.description}
        >
          <div className="mb-3 flex items-center justify-end gap-2">
            <MiniButton
              title="Удалить модуль"
              onClick={removeSelected}
              disabled={config.modules.length <= KITCHEN_LIMITS.minModules}
            >
              <Trash2 size={13} />
            </MiniButton>
          </div>

          <div className="space-y-4">
            {selected.type === "bottle" ? (
              <div>
                <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
                  Ширина корпуса
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {[15, 20, 30].map((body) => {
                      const fits = body <= maxWidthByTotal;
                      const active = selected.width === body;
                      return (
                        <ChoiceCard
                          key={body}
                          title={`${body} см`}
                          description={`проём ${body * 10 - 32} мм`}
                          selected={active}
                          disabled={!fits}
                          onClick={() => patchModule(selected.id, { width: body })}
                        />
                      );
                    })}
                </div>
              </div>
            ) : (
              <RangeField
                label="Ширина модуля"
                value={selected.width}
                min={
                  selected.type === "sink"
                    ? SINK_RULES.minWidth
                    : preset.minWidth
                }
                max={Math.max(
                  selected.type === "sink" ? SINK_RULES.minWidth : preset.minWidth,
                  Math.min(
                    selected.type === "sink" ? SINK_RULES.maxWidth : preset.maxWidth,
                    maxWidthByTotal,
                  ),
                )}
                step={selected.type === "sink" ? SINK_RULES.widthStep : 1}
                markStep={selected.type === "sink" ? 10 : 5}
                onChange={(value) => patchModule(selected.id, { width: value })}
              />
            )}
            {selected.type === "sink" && (
              <div className="flex flex-wrap gap-1">
                {SINK_RULES.standardWidths.map((std) => {
                  const disabled = std > maxWidthByTotal;
                  const active = selected.width === std;
                  return (
                    <button
                      key={std}
                      type="button"
                      disabled={disabled}
                      onClick={() => patchModule(selected.id, { width: std })}
                      className={`rounded-full border px-2 py-0.5 text-[0.58rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                        active
                          ? "border-copper bg-copper/10 text-copper"
                          : "border-ink/10 bg-white/40 text-ink/45 hover:bg-white/70"
                      }`}
                      title={`${std} см — стандартный размер`}
                    >
                      {std}
                    </button>
                  );
                })}
              </div>
            )}
            {preset.zone === "floor" ? (
              <RangeField
                label="Глубина всех модулей"
                hint="Глубина измеряется от стены до края столешницы, стандарт столешницы 60 см, фактическая глубина модулей меньше."
                value={floorDepth.value}
                min={floorDepth.min}
                max={floorDepth.max}
                step={1}
                markStep={5}
                onChange={(value) => setZoneDepth("floor", value)}
              />
            ) : (
              <RangeField
                label="Глубина всех верхних модулей"
                hint="Глубина навесных модулей одинакова для всего верхнего ряда."
                value={upperDepth.value}
                min={upperDepth.min}
                max={upperDepth.max}
                step={1}
                markStep={5}
                onChange={(value) => setZoneDepth("upper", value)}
              />
            )}
            {preset.zone === "floor" && (
              <div className="rounded-lg border border-ink/8 bg-white/35 px-3 py-2">
                <SwitchRow
                  title="Техника на собственных опорах"
                  description="Встроенная техника (ПММ, стиральная машина в нише и т. п.) опирается на свои регулируемые ножки — мебельные опоры модулю не считаются."
                  checked={selected.ownSupports === true}
                  onChange={(checked) =>
                    patchModule(selected.id, { ownSupports: checked })
                  }
                />
                {selected.ownSupports === true && (
                  <p className="mt-1 text-[0.6rem] leading-relaxed text-ink/42">
                    Флаг задаётся монтажной схемой конкретной техники. Если техника
                    не имеет собственных опор или её монтаж требует мебельных ножек,
                    отключите его.
                  </p>
                )}
                {selected.ownSupports !== true &&
                  ["sink", "oven", "tall"].includes(selected.type) && (
                    <p className="mt-1 text-[0.6rem] leading-relaxed text-ink/38">
                      Мойка, духовой шкаф и пенал по умолчанию сохраняют мебельные
                      опоры и крепление к стене.
                    </p>
                  )}
              </div>
            )}
            {selected.type === "sink" ? (
              <SinkModuleControls
                module={selected}
                row={sinkRowContext(config.modules, selected.id)}
                maxWidthByTotal={maxWidthByTotal}
                onPatch={(patch) => patchModule(selected.id, patch)}
              />
            ) : selected.type === "drawers" ? (
              <RangeField
                label="Ящиков"
                value={selected.drawers}
                min={KITCHEN_LIMITS.minDrawers}
                max={KITCHEN_LIMITS.maxDrawers}
                step={1}
                unit="шт."
                onChange={(value) => patchModule(selected.id, { drawers: value })}
              />
            ) : (
              <RangeField
                label="Полок"
                value={selected.shelves}
                min={0}
                max={KITCHEN_LIMITS.maxShelvesPerModule}
                step={1}
                unit="шт."
                onChange={(value) => patchModule(selected.id, { shelves: value })}
              />
            )}
            <div className="flex items-center justify-between rounded-lg bg-ink/[0.035] px-3 py-2 text-[0.62rem] text-ink/45">
              <span>Высота модуля</span>
              <span className="font-semibold text-ink/65">{selected.height} см</span>
            </div>
          </div>
        </PanelSection>
      )}

      <PanelSection
        title="Высота рядов"
        hint="Меняет все модули соответствующего типа, чтобы сохранить единую линию."
      >
        <div className="space-y-4">
          <RangeField
            label="Нижний ряд"
            value={floorHeight}
            min={80}
            max={95}
            step={1}
            markStep={5}
            onChange={setBaseHeight}
          />
          <RangeField
            label="Высота цоколя"
            value={config.plinthHeight}
            min={KITCHEN_LIMITS.minPlinthHeight}
            max={KITCHEN_LIMITS.maxPlinthHeight}
            step={1}
            markStep={1}
            pins={[10, 12, 13, 14, 15]}
            hint="Стандарты: 100, 120, 130, 140, 150 мм. Входит в высоту ряда."
            disabled={!config.plinth}
            onChange={(value) => onChange({ ...config, plinthHeight: value })}
          />
          {floor.some((module) => isTall(module.type)) && (
            <RangeField
              label="Пеналы"
              value={tallHeight}
              min={200}
              max={MODULES.tall.maxHeight}
              step={1}
              markStep={5}
              onChange={(value) => setAllHeights(["tall", "oven"], value)}
            />
          )}
          {upper.length > 0 && (
            <RangeField
              label="Верхний ряд"
              value={wallHeight}
              min={MODULES.wall.minHeight}
              max={maxUpperHeight(floorHeight)}
              step={1}
              markStep={5}
              onChange={(value) => setAllHeights(["wall"], value)}
            />
          )}
        </div>
      </PanelSection>
    </div>
  );
}

/** Конструктивные контролы модуля под мойку: фасады, перегородка, секции хранения. */
function SinkModuleControls({
  module,
  row,
  onPatch,
}: {
  module: KitchenModule;
  /** Контекст края столешницы для модулей нижнего ряда. */
  row?: import("@/lib/configurator/sink").SinkRowContext;
  /** Смежный лимит ширины от суммы модулей (см. родительский контрол). */
  maxWidthByTotal?: number;
  onPatch: (patch: Partial<KitchenModule>) => void;
}) {
  const width = module.width;
  const facades = sinkFacadeCount(module);
  const layout = sinkLayout(module, undefined, row);
  const geom = sinkGeometry(module, row);
  const threeDoorOk = sinkThreeDoorAvailable(width);
  // Авто-перегородка (2 фасада): ставится при выбранном наполнении (полки/
  // ящики), если место позволяет; конфликт с мойкой — наполнение крепить
  // некуда. Бутылочница от неё не зависит (её граница — собственный cut).
  const partitionConflict = sinkPartitionConflicts(module, row);
  const structuralConflict = layout.partitions.some(
    (partition) => partition.structural && partition.conflict,
  );
  const storageBlocked = partitionConflict || structuralConflict;
  const bottleConflict = layout.bottleConflict;
  const freeSections = layout.sections.filter((section) => !section.comms);

  // Габариты мойки: мм в конфигурации, см в интерфейсе.
  const sinkWidthMm = geom.width;
  const sinkDepthMm = geom.depth;
  const maxW = maxSinkWidthFor(width, row) / 10;
  const maxD = maxSinkDepthFor(module.depth) / 10;
  const minW = SINK_RULES.minSinkWidth / 10;
  const minD = SINK_RULES.minSinkDepth / 10;
  const [customModeFor, setCustomModeFor] = useState<string | null>(null);
  // Поле "Свой размер" — явный выбор пользователя либо когда текущий размер
  // нестандартен (например, зажат под узкий корпус). Режим привязан к id
  // модуля, поэтому при смене модуля он сбрасывается без эффекта.
  const customMode = customModeFor === module.id;
  const showCustom =
    customMode || !isSinkStandardSize(geom.width, geom.depth);
  const standardPinsW = SINK_STANDARD_SIZES.map((s) => s.width / 10).filter(
    (v) => v >= minW && v <= maxW,
  );
  const standardPinsD = SINK_STANDARD_SIZES.map((s) => s.depth / 10).filter(
    (v) => v >= minD && v <= maxD,
  );

  const patchStorage = (
    index: number,
    fill: { shelves?: number; drawers?: number; bottle?: 15 | 20 | 30 | 0 },
  ) => {
    // Основа — фактическое наполнение секций из layout (панель и схема
    // должны совпадать даже после разреза секции бутылочницей).
    const next = freeSections.map((section) =>
      section.bottle
        ? {
            shelves: 0,
            drawers: 0,
            bottle: section.bottle as 15 | 20 | 30,
          }
        : { shelves: section.shelves, drawers: section.drawers },
    );
    const current = next[index] ?? { shelves: 0, drawers: 0 };
    const bottle = fill.bottle;
    if (bottle !== undefined) {
      // Бутылочница занимает секцию целиком — полки и ящики обнуляются.
      // «нет» при уже пустой бутылочке — no-op: не трогаем полки/ящики.
      if (bottle === 15 || bottle === 20 || bottle === 30) {
        next[index] = { shelves: 0, drawers: 0, bottle };
      } else if (current.bottle) {
        next[index] = { shelves: 0, drawers: 0 };
      }
    } else if (fill.shelves !== undefined) {
      // Один доп на секцию: полки исключают ящики.
      next[index] = { shelves: fill.shelves, drawers: 0 };
    } else if (fill.drawers !== undefined) {
      // Один доп на секцию: ящики исключают полки.
      next[index] = { shelves: 0, drawers: fill.drawers };
    } else {
      next[index] = { shelves: current.shelves, drawers: current.drawers };
    }
    onPatch({ sinkStorage: next });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
          Габариты мойки
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
<ChoiceCard
  title="Стандартные"
  description="Типовые размеры"
  selected={!customMode}
  onClick={() => {
    setCustomModeFor(null);
    const fit = SINK_STANDARD_SIZES.find(
      (size) =>
        size.width <= maxSinkWidthFor(width, row) &&
        size.depth <= maxSinkDepthFor(module.depth),
    );
    if (fit) onPatch({ sinkWidth: fit.width, sinkDepth: fit.depth });
  }}
/>
<ChoiceCard
  title="Свой размер"
  description="Ползунки, шаг 1 см"
  selected={customMode}
  onClick={() => setCustomModeFor(module.id)}
/>
        </div>

        {!showCustom ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {SINK_STANDARD_SIZES.map((size) => {
              const fits =
                size.width <= maxSinkWidthFor(width, row) &&
                size.depth <= maxSinkDepthFor(module.depth);
              const active = sinkWidthMm === size.width && sinkDepthMm === size.depth;
              return (
                <button
                  key={`${size.width}x${size.depth}`}
                  type="button"
                  disabled={!fits}
                  onClick={() =>
                    onPatch({ sinkWidth: size.width, sinkDepth: size.depth })
                  }
                  className={`rounded-full border px-2 py-0.5 text-[0.58rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                    active
                      ? "border-copper bg-copper/10 text-copper"
                      : "border-ink/10 bg-white/40 text-ink/45 hover:bg-white/70"
                  }`}
                  title={
                    fits
                      ? `${size.width / 10} × ${size.depth / 10} см — стандартный размер`
                      : "Не помещается в выбранный модуль"
                  }
                >
                  {size.width / 10}×{size.depth / 10}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            <RangeField
              label="Ширина мойки"
              hint="Слева направо, внешний габарит. В интерфейсе сантиметры, в расчётах — миллиметры."
              value={sinkWidthMm / 10}
              min={minW}
              max={maxW}
              step={1}
              pins={standardPinsW}
              onChange={(value) => onPatch({ sinkWidth: value * 10 })}
            />
            <RangeField
              label="Глубина мойки"
              hint="От переднего до заднего края. Максимум ограничен монтажными отступами 5 см спереди и сзади."
              value={sinkDepthMm / 10}
              min={minD}
              max={maxD}
              step={1}
              pins={standardPinsD}
              onChange={(value) => onPatch({ sinkDepth: value * 10 })}
            />
          </div>
        )}
        <div className="mt-2 rounded-lg border border-dashed border-ink/12 bg-white/25 px-2.5 py-1.5 text-[0.58rem] leading-relaxed text-ink/40">
          {geom.cutoutKnown
            ? "Размеры монтажного выреза заданы по данным производителя."
            : "Показаны внешние габариты. Размер монтажного выреза уточните по документации производителя мойки и столешницы."}
        </div>
      </div>

      <div>
        <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
          Расположение мойки
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {(
            [
              { key: "left", title: "Слева" },
              { key: "center", title: "По центру" },
              { key: "right", title: "Справа" },
            ] as const
          ).map((option) => (
            <ChoiceCard
              key={option.key}
              title={option.title}
              selected={(module.sinkPosition ?? "center") === option.key}
              disabled={option.key === "center" && !geom.centerAllowed}
              onClick={() => onPatch({ sinkPosition: option.key })}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between rounded-lg bg-ink/[0.035] px-3 py-2 text-[0.62rem] text-ink/45">
          <span>Слева / справа</span>
          <span className="font-semibold text-ink/65">
            {Math.round(geom.left / 10)} / {Math.round(geom.right / 10)} см
          </span>
        </div>
        <div className="mt-1.5 text-[0.56rem] leading-relaxed text-ink/38">
          У края ряда (первый/последний модуль или соседний пенал) — монтажный
          отступ 50 мм; к соседнему модулю со столешницей — 0 мм.
        </div>
        {(module.sinkPosition ?? "center") === "center" ? (
          <div className="mt-1.5 text-[0.58rem] leading-relaxed text-ink/40">
            Мойка отцентрирована: левый и правый отступы равны
            ({Math.round(geom.left / 10)} см) и рассчитываются автоматически.
          </div>
        ) : (
          <div className="mt-2">
            <RangeField
              label="Отступ от края модуля"
              hint="От боковой границы корпуса до внешнего края мойки (не до центра чаши)."
              value={Math.round(geom.offset)}
              min={geom.minOffset}
              max={geom.maxOffset}
              step={SINK_RULES.sinkStep}
              unit="мм"
              onChange={(value) => onPatch({ sinkOffset: value })}
            />
          </div>
        )}
      </div>

      <div>
        <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
          Фасады
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <ChoiceCard
            title="2 распашных"
            description="Стандарт"
            selected={facades === 2}
            onClick={() => onPatch({ sinkFacades: 2 })}
          />
          <ChoiceCard
            title="3 распашных"
            description={threeDoorOk ? "Широкая тумба" : `От ${SINK_RULES.threeDoorMinWidth} см`}
            selected={facades === 3}
            disabled={!threeDoorOk}
            onClick={() => onPatch({ sinkFacades: 3 })}
          />
        </div>
      </div>

      {facades === 2 && (
        <div>
          <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
            Перегородка
          </div>
          <div className="mt-1.5 rounded-lg border border-ink/10 bg-white/35 px-2.5 py-2 text-[0.6rem] leading-relaxed text-ink/55">
            Перегородка — часть корпуса: появляется у каждой секции, где
            выбраны полки или ящики (если позволяет место,{" "}
            {SINK_RULES.partitionMinWidth} см и более). Наполнение с двух
            сторон даёт две перегородки, без наполнения их нет; у бутылочки
            своя граница — она и заменяет перегородку, её секция ровно
            15/20/30 см снаружи.
            {partitionConflict && (
              <>
                {" "}
                <span className="font-semibold text-amber-900">
                  В этом месте авто-перегородку установить невозможно: она
                  пересекается с мойкой или её монтажной зоной — полки и ящики
                  не крепятся.
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {facades === 3 && (
        <div>
          <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
            Перегородка
          </div>
          <div
            className={`mt-1.5 rounded-lg border px-2.5 py-2 text-[0.6rem] leading-relaxed ${
              structuralConflict
                ? "border-amber-700/20 bg-amber-500/[0.07] text-amber-900"
                : "border-ink/10 bg-white/35 text-ink/55"
            }`}
          >
            {module.sinkPosition === "center"
              ? "Мойка по центру: вся зона — коммуникации, перегородка не устанавливается."
              : "1 конструктивная перегородка (16 мм) — точка крепления створок на границе зоны коммуникаций и хранения."}
            {structuralConflict && (
              <>
                {" "}
                <span className="font-semibold">
                  Пересекает зону мойки — согласуйте установку чаши с
                  производителем.
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-1 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
          <span>Наполнение секций</span>
          <HelpHint label="Наполнение секций">
            В каждой секции можно выбрать только один вариант: полки, ящики или
            бутылочницу. Чтобы выбрать другой — сначала обнулите текущий (0 /
            «нет»).
          </HelpHint>
        </div>
        <div className="mt-1.5 space-y-2">
          {/* Зона коммуникаций — всегда свободна */}
          <div className="rounded-lg border border-dashed border-ink/12 bg-white/25 px-2.5 py-2 text-[0.6rem] leading-relaxed text-ink/40">
            Секция под мойкой — зона коммуникаций: место для чаши, сифона и труб.
            Полки и ящики сюда не устанавливаются.
          </div>
          {freeSections.length === 0 && (
            <div className="text-[0.6rem] text-ink/35">
              Свободных секций хранения нет: мойка занимает всё внутреннее
              пространство модуля.
            </div>
          )}
          {storageBlocked && freeSections.length > 0 && (
            <div className="rounded-lg border border-amber-700/20 bg-amber-500/[0.07] px-2.5 py-2 text-[0.6rem] leading-relaxed text-amber-900">
              Перегородка не устанавливается — полки и ящики в секциях не
              крепятся.
            </div>
          )}
          {freeSections.map((section, index) => {
            // Наполнение берём из фактической секции layout: панель всегда
            // совпадает со схемой даже после разреза секции бутылочницей.
            const fill = {
              shelves: section.shelves,
              drawers: section.drawers,
              bottle: (section.bottle ?? 0) as 0 | 15 | 20 | 30,
            };
            const drawersOk = sectionFitsDrawers(section.width);
            // Бутылочница — только если секция примыкает к боковине корпуса
            // (единое правило с applyBottleCut/isBottleEdgeSection).
            const bottleAllowed = isBottleEdgeSection(section, width);
            // И только одна на модуль (normalizeSinkModule очищает остальные
            // выборы): занятую другим разделом секцию показываем disabled,
            // чтобы клик не «молча» откатывался.
            const bottleBusyElsewhere = freeSections.some(
              (other, i) => i !== index && Boolean(other.bottle),
            );
            const hasShelves = fill.shelves > 0;
            const hasDrawers = fill.drawers > 0;
            // Один доп на секцию: пока выбраны полки/ящики — бутылочница
            // заблокирована (видима, но не активна).
            // Сброс выбранного значения ВСЕГДА разрешён — иначе секция
            // «залипает» (например, после конфликта перегородки).
            const shelvesBlocked =
              !hasShelves && (hasDrawers || Boolean(fill.bottle) || storageBlocked);
            const drawersBlocked =
              !hasDrawers &&
              (hasShelves || Boolean(fill.bottle) || storageBlocked || !drawersOk);
            return (
              <div
                key={section.index}
                className="rounded-lg border border-ink/10 bg-white/35 px-2.5 py-2"
              >
                <div className="flex items-center justify-between text-[0.6rem] font-semibold text-ink/55">
                  <span>Секция {index + 1}</span>
                  <span className="text-ink/35">
                    {Math.round(sectionOuterWidth(section.width))} см
                  </span>
                </div>
                <div className="mt-1.5 space-y-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[0.58rem] font-semibold text-ink/45">
                        Бутылочница
                      </span>
                      {([0, 15, 20, 30] as const).map((body) => {
                        const active = (fill.bottle ?? 0) === body;
                        // Свою бутылочницу можно переключать/снимать всегда;
                        // чужую и занятую другим допом — нельзя.
                        const disabled =
                          body > 0 &&
                          (!bottleAllowed ||
                            (bottleBusyElsewhere && !fill.bottle) ||
                            hasShelves ||
                            hasDrawers);
                        return (
                          <button
                            key={body}
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                              patchStorage(index, { bottle: body })
                            }
                            className={`rounded-full border px-2 py-0.5 text-[0.58rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                              active
                                ? "border-copper bg-copper/10 text-copper"
                                : "border-ink/10 bg-white/40 text-ink/45 hover:bg-white/70"
                            }`}
                            title={
                              disabled
                                ? hasShelves
                                  ? "В секции уже выбраны полки — сначала обнулите их"
                                  : hasDrawers
                                    ? "В секции уже выбраны ящики — сначала обнулите их"
                                    : !bottleAllowed
                                      ? "Бутылочница доступна только в крайней секции модуля"
                                      : "Бутылочница может быть только одна на модуль — сначала снимите её в другой секции"
                                : body > 0
                                  ? `Корпус ${body} см — проём ${body * 10 - 32} мм; перегородка отодвинется, секция станет ${body} см`
                                  : "Без бутылочницы"
                            }
                          >
                            {body > 0 ? `${body} см` : "нет"}
                          </button>
                        );
                      })}
                    </div>
                    {!bottleAllowed && fill.bottle ? (
                      <div className="text-[0.58rem] font-semibold text-red-700">
                        Бутылочница доступна только в крайней секции модуля —
                        выберите «нет».
                      </div>
                    ) : null}
                    {fill.bottle ? (
                      <div className="text-[0.58rem] leading-relaxed text-ink/40">
                        Корпус {fill.bottle} см — чистый проём{" "}
                        {fill.bottle * 10 - 32} мм. Перегородка смещается, секция
                        занимает {fill.bottle} см. Полки и ящики не
                        устанавливаются.
                        {bottleConflict && (
                          <span className="font-semibold text-red-700">
                            {" "}
                            Перегородка пересекает зону мойки — выберите другой
                            корпус.
                          </span>
                        )}
                      </div>
                    ) : storageBlocked ? (
                      <div className="text-[0.58rem] leading-relaxed text-ink/35">
                        Полки и ящики не устанавливаются: авто-перегородка, к
                        которой крепится наполнение, пересекается с мойкой или
                        её монтажной зоной. Бутылочница не зависит от
                        перегородки и остаётся доступной.
                      </div>
                    ) : null}
                    {/* Контролы видны всегда; активен только один доп. */}
                    <RangeField
                      label="Полок"
                      value={fill.shelves}
                      min={0}
                      max={SINK_RULES.maxShelvesPerSection}
                      step={1}
                      unit="шт."
                      disabled={shelvesBlocked}
                      hint={
                        shelvesBlocked
                          ? hasDrawers
                            ? "Один доп на секцию: сначала обнулите ящики"
                            : fill.bottle
                              ? "Сначала снимите бутылочницу («нет»)"
                              : undefined
                          : undefined
                      }
                      onChange={(value) =>
                        patchStorage(index, { shelves: value })
                      }
                    />
                    <RangeField
                      label="Ящиков"
                      value={fill.drawers}
                      min={0}
                      max={SINK_RULES.maxDrawersPerSection}
                      step={1}
                      unit="шт."
                      disabled={drawersBlocked}
                      hint={
                        drawersBlocked
                          ? hasShelves
                            ? "Один доп на секцию: сначала обнулите полки"
                            : fill.bottle
                              ? "Сначала снимите бутылочницу («нет»)"
                              : undefined
                          : "0 — без ящиков; установка ящиков возможна от 2 шт."
                      }
                      onChange={(value) =>
                        patchStorage(index, {
                          drawers: resolveDrawerCount(fill.drawers, value),
                        })
                      }
                    />
                    {!drawersOk && !fill.bottle ? (
                      <div className="text-[0.58rem] text-ink/35">
                        Для ящиков нужна секция наружной шириной от{" "}
                        {SINK_RULES.minSectionOuterWidthForDrawers} см.
                      </div>
                    ) : null}
                  </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
