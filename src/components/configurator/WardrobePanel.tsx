"use client";

import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { WARDROBE_LIMITS } from "@/content/catalog";
import { createId } from "@/lib/configurator/defaults";
import { wardrobeWidth } from "@/lib/configurator/pricing";
import type { WardrobeConfig, WardrobeSection } from "@/lib/configurator/types";
import {
  MiniButton,
  PanelSection,
  RangeField,
} from "./ui";

function normalizeSection(
  section: WardrobeSection,
  height: number,
): WardrobeSection {
  const drawerZone =
    WARDROBE_LIMITS.plinthHeight +
    WARDROBE_LIMITS.carcassThickness +
    Math.max(0, section.drawers) * WARDROBE_LIMITS.drawerHeight;
  const minShelf = drawerZone + (section.drawers > 0 ? 10 : 8);
  const maxShelf = height - 10;
  const rodMin = Math.max(80, drawerZone + 20);
  const rodMax = height - WARDROBE_LIMITS.carcassThickness;

  const shelves: number[] = [];
  for (const raw of [...section.shelves].map((value) => Math.round(value)).sort((a, b) => a - b)) {
    if (raw < minShelf || raw > maxShelf) continue;
    const last = shelves[shelves.length - 1];
    if (last !== undefined && raw - last < WARDROBE_LIMITS.minShelfGap) continue;
    shelves.push(raw);
  }

  const rods = Array.from(
    new Set(
      section.rods
        .map((value) => Math.round(value))
        .filter((value) => value >= rodMin && value <= rodMax),
    ),
  ).sort((a, b) => a - b);

  return { ...section, shelves, rods };
}

function nextShelfPosition(section: WardrobeSection, height: number): number | null {
  if (section.shelves.length >= WARDROBE_LIMITS.maxShelvesPerSection) return null;
  const drawerZone =
    WARDROBE_LIMITS.plinthHeight +
    WARDROBE_LIMITS.carcassThickness +
    section.drawers * WARDROBE_LIMITS.drawerHeight;
  const minShelf = drawerZone + (section.drawers > 0 ? 10 : 8);
  const maxShelf = height - 10;
  const points = [minShelf, ...section.shelves, maxShelf].sort((a, b) => a - b);
  let best: number | null = null;
  let bestGap = WARDROBE_LIMITS.minShelfGap * 2;
  for (let index = 0; index < points.length - 1; index += 1) {
    const gap = points[index + 1] - points[index];
    if (gap > bestGap) {
      bestGap = gap;
      best = Math.round(points[index] + gap / 2);
    }
  }
  return best;
}

function nextRodPosition(section: WardrobeSection, height: number): number | null {
  if (section.rods.length >= WARDROBE_LIMITS.maxRodsPerSection) return null;
  const drawerZone =
    WARDROBE_LIMITS.plinthHeight +
    WARDROBE_LIMITS.carcassThickness +
    section.drawers * WARDROBE_LIMITS.drawerHeight;
  const rodMin = Math.max(80, drawerZone + 20);
  const rodMax = height - WARDROBE_LIMITS.carcassThickness;
  const candidates = [
    height - 20,
    Math.round(height / 2),
    rodMin + 10,
    rodMin + 30,
  ];
  const candidate = candidates.find(
    (value) =>
      value >= rodMin &&
      value <= rodMax &&
      !section.rods.some((rod) => Math.abs(rod - value) < 2),
  );
  return candidate ?? null;
}

export function WardrobePanel({
  config,
  onChange,
  selectedId,
  onSelect,
  view,
}: {
  config: WardrobeConfig;
  onChange: (next: WardrobeConfig) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  view: "sections" | "interior";
}) {
  const selected =
    config.sections.find((section) => section.id === selectedId) ?? config.sections[0];
  const totalWidth = Math.round(wardrobeWidth(config));
  const sectionIndex = selected
    ? config.sections.findIndex((section) => section.id === selected.id)
    : -1;

  const updateSection = (id: string, patch: Partial<WardrobeSection>) => {
    onChange({
      ...config,
      sections: config.sections.map((section) =>
        section.id === id
          ? normalizeSection({ ...section, ...patch }, config.height)
          : section,
      ),
    });
  };

  const setHeight = (height: number) => {
    onChange({
      ...config,
      height,
      sections: config.sections.map((section) =>
        normalizeSection(section, height),
      ),
    });
  };

  const addSection = () => {
    if (config.sections.length >= WARDROBE_LIMITS.maxSections) return;
    if (totalWidth + 60 > WARDROBE_LIMITS.maxTotalWidth) return;
    const section: WardrobeSection = {
      id: createId("s"),
      width: 60,
      shelves: [],
      rods: [],
      drawers: 0,
    };
    onChange({ ...config, sections: [...config.sections, section] });
    onSelect(section.id);
  };

  const removeSelected = () => {
    if (!selected || config.sections.length <= WARDROBE_LIMITS.minSections) return;
    const remaining = config.sections.filter((section) => section.id !== selected.id);
    const next =
      remaining[Math.max(0, sectionIndex - 1)] ?? remaining[0];
    onChange({ ...config, sections: remaining });
    if (next) onSelect(next.id);
  };

  const moveSelected = (direction: -1 | 1) => {
    if (!selected) return;
    const target = sectionIndex + direction;
    if (target < 0 || target >= config.sections.length) return;
    const sections = [...config.sections];
    [sections[sectionIndex], sections[target]] = [sections[target], sections[sectionIndex]];
    onChange({ ...config, sections });
  };

  if (view === "sections") {
    const widthMax =
      WARDROBE_LIMITS.maxTotalWidth -
      (totalWidth - (selected?.width ?? 0));

    return (
      <div className="space-y-5">
        <PanelSection title="Габариты шкафа" hint="Высота и глубина общие для всех секций.">
          <div className="space-y-4">
            <RangeField
              label="Высота"
              value={config.height}
              min={WARDROBE_LIMITS.minHeight}
              max={WARDROBE_LIMITS.maxHeight}
              step={1}
              markStep={5}
              onChange={setHeight}
            />
            <RangeField
              label="Глубина"
              value={config.depth}
              min={WARDROBE_LIMITS.minDepth}
              max={WARDROBE_LIMITS.maxDepth}
              step={1}
              markStep={5}
              onChange={(value) => onChange({ ...config, depth: value })}
            />
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-ink/[0.035] px-3 py-2 text-[0.62rem]">
            <span className="text-ink/45">Общая ширина</span>
            <span className="font-semibold">
              {totalWidth} см
              <span className="ml-1 text-ink/32">/ {WARDROBE_LIMITS.maxTotalWidth}</span>
            </span>
          </div>
        </PanelSection>

        <PanelSection
          title="Секции"
          hint="Каждая секция настраивается отдельно. Секция шире 60 см получает две двери."
        >
          <div className="grid grid-cols-2 gap-1.5">
            {config.sections.map((section, index) => (
              <button
                key={section.id}
                type="button"
                onClick={() => onSelect(section.id)}
                className="module-pill"
                data-selected={section.id === selected?.id}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink/6 text-[0.55rem] font-bold text-ink/45">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.66rem] font-semibold">
                  {section.width} см
                </span>
                <span className="text-[0.55rem] text-ink/35">
                  {section.shelves.length}п
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={addSection}
              disabled={
                config.sections.length >= WARDROBE_LIMITS.maxSections ||
                totalWidth + 60 > WARDROBE_LIMITS.maxTotalWidth
              }
              className="flex items-center gap-1.5 text-[0.64rem] font-semibold text-copper disabled:opacity-40"
            >
              <Plus size={12} />
              Добавить секцию
            </button>
            <span className="text-[0.58rem] text-ink/35">
              {config.sections.length} / {WARDROBE_LIMITS.maxSections}
            </span>
          </div>
        </PanelSection>

        {selected && (
          <PanelSection title={`Секция ${sectionIndex + 1}`} hint="Ширина меняется в пределах лимита общей длины.">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <MiniButton
                  title="Переместить секцию влево"
                  onClick={() => moveSelected(-1)}
                  disabled={sectionIndex <= 0}
                >
                  <ChevronLeft size={14} />
                </MiniButton>
                <MiniButton
                  title="Переместить секцию вправо"
                  onClick={() => moveSelected(1)}
                  disabled={sectionIndex >= config.sections.length - 1}
                >
                  <ChevronRight size={14} />
                </MiniButton>
              </div>
              <MiniButton
                title="Удалить секцию"
                onClick={removeSelected}
                disabled={config.sections.length <= WARDROBE_LIMITS.minSections}
              >
                <Trash2 size={13} />
              </MiniButton>
            </div>
            <RangeField
              label="Ширина секции"
              value={selected.width}
              min={WARDROBE_LIMITS.minSectionWidth}
              max={Math.max(
                WARDROBE_LIMITS.minSectionWidth,
                Math.min(WARDROBE_LIMITS.maxSectionWidth, widthMax),
              )}
              step={1}
              markStep={5}
              onChange={(value) => updateSection(selected.id, { width: value })}
            />
            <p className="mt-2 text-[0.6rem] leading-relaxed text-ink/38">
              Для ящиков нужна ширина не меньше 50 см. При уменьшении секции
              ящики и полки автоматически проверяются.
            </p>
          </PanelSection>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PanelSection
        title="Наполнение секции"
        hint="Полки и штанги не могут пересекаться и выходить за корпус."
      >
        <div className="grid grid-cols-3 gap-1.5">
          {config.sections.map((section, index) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section.id)}
              className="rounded-lg border border-ink/10 bg-white/35 px-2 py-2 text-[0.6rem] font-semibold text-ink/50 transition-colors hover:bg-white/70"
              data-selected={section.id === selected?.id}
              style={
                section.id === selected?.id
                  ? { borderColor: "rgba(184,120,73,0.6)", background: "#fff", color: "#161310" }
                  : undefined
              }
            >
              Секция {index + 1}
            </button>
          ))}
        </div>
      </PanelSection>

      {selected && (
        <>
          <PanelSection title="Ящики" hint="Ящики занимают нижнюю зону. Полки автоматически поднимаются выше.">
            <RangeField
              label="Ящиков в секции"
              value={selected.drawers}
              min={0}
              max={WARDROBE_LIMITS.maxDrawersPerSection}
              step={1}
              unit="шт."
              onChange={(value) =>
                updateSection(selected.id, {
                  drawers: value,
                  ...(value > 0 && selected.width < 50 ? { width: 50 } : {}),
                })
              }
            />
            <p className="mt-1.5 text-[0.6rem] leading-relaxed text-ink/38">
              При добавлении ящиков нижние полки могут быть удалены как
              несовместимые.
            </p>
          </PanelSection>

          <PanelSection
            title="Полки"
            hint={`До ${WARDROBE_LIMITS.maxShelvesPerSection} полок с шагом не меньше ${WARDROBE_LIMITS.minShelfGap} см.`}
          >
            <div className="flex flex-wrap gap-1.5">
              {[...selected.shelves].sort((a, b) => a - b).map((position) => (
                <span
                  key={position}
                  className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-white/55 py-1 pl-2.5 pr-1.5 text-[0.62rem] font-medium text-ink/60"
                >
                  {position} см
                  <button
                    type="button"
                    onClick={() =>
                      updateSection(selected.id, {
                        shelves: selected.shelves.filter((value) => value !== position),
                      })
                    }
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-ink/6 text-ink/40 transition-colors hover:bg-ink/12 hover:text-ink"
                    aria-label={`Удалить полку на высоте ${position} см`}
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
              {selected.shelves.length === 0 && (
                <span className="text-[0.62rem] text-ink/35">Полок пока нет.</span>
              )}
            </div>
            <button
              type="button"
              disabled={nextShelfPosition(selected, config.height) === null}
              onClick={() => {
                const position = nextShelfPosition(selected, config.height);
                if (position === null) return;
                updateSection(selected.id, {
                  shelves: [...selected.shelves, position],
                });
              }}
              className="mt-3 flex items-center gap-1.5 text-[0.64rem] font-semibold text-copper disabled:opacity-35"
            >
              <Plus size={12} />
              Добавить полку
            </button>
          </PanelSection>

          <PanelSection
            title="Штанги"
            hint={`До ${WARDROBE_LIMITS.maxRodsPerSection} штанг. Высота подбирается автоматически.`}
          >
            <div className="flex flex-wrap gap-1.5">
              {[...selected.rods].sort((a, b) => a - b).map((height) => (
                <span
                  key={height}
                  className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-white/55 py-1 pl-2.5 pr-1.5 text-[0.62rem] font-medium text-ink/60"
                >
                  {height} см
                  <button
                    type="button"
                    onClick={() =>
                      updateSection(selected.id, {
                        rods: selected.rods.filter((value) => value !== height),
                      })
                    }
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-ink/6 text-ink/40 transition-colors hover:bg-ink/12 hover:text-ink"
                    aria-label={`Удалить штангу на высоте ${height} см`}
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
              {selected.rods.length === 0 && (
                <span className="text-[0.62rem] text-ink/35">Штанг пока нет.</span>
              )}
            </div>
            <button
              type="button"
              disabled={nextRodPosition(selected, config.height) === null}
              onClick={() => {
                const position = nextRodPosition(selected, config.height);
                if (position === null) return;
                updateSection(selected.id, {
                  rods: [...selected.rods, position],
                });
              }}
              className="mt-3 flex items-center gap-1.5 text-[0.64rem] font-semibold text-copper disabled:opacity-35"
            >
              <Plus size={12} />
              Добавить штангу
            </button>
          </PanelSection>
        </>
      )}
    </div>
  );
}
