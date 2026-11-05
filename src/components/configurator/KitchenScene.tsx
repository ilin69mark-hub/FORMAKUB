"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  BODY_MATERIALS,
  COUNTERTOPS,
  FACADE_MATERIALS,
  KITCHEN_LIMITS,
  KITCHEN_MODULES,
} from "@/content/catalog";
import { ledColorHex } from "@/content/lighting";
import { shade, withAlpha } from "@/lib/color";
import { sinkGeometry, sinkLayout, sinkRowContext } from "@/lib/configurator/sink";
import { computeSupports } from "@/lib/configurator/supports";
import { SelectionOutline } from "@/components/configurator/SelectionOutline";
import type { KitchenConfig, KitchenModule } from "@/lib/configurator/types";

interface SceneProps {
  config: KitchenConfig;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Перемещение модуля на позицию влево/вправо (управление на схеме). */
  onMove?: (id: string, direction: -1 | 1) => void;
  showInterior?: boolean;
  showDimensions?: boolean;
  compact?: boolean;
  /** id модулей с ошибками конфигурации — красная подсветка на схеме. */
  invalidIds?: string[];
  className?: string;
}

const MIN_FLOOR_Y = 272;
const MARGIN = 44;

function safe(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function finishFor(
  materials: { id: string; finishes: { id: string; hex: string }[] }[],
  material: string,
  finish: string,
  fallback: string,
): string {
  const option = materials.find((item) => item.id === material);
  return option?.finishes.find((item) => item.id === finish)?.hex ?? option?.finishes[0]?.hex ?? fallback;
}

function doorCount(width: number): number {
  return width > 60 ? 2 : 1;
}

function HandleMark({
  x,
  y,
  width,
  height,
  kind,
  horizontal = false,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: KitchenConfig["handle"];
  horizontal?: boolean;
}) {
  if (kind === "none") return null;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  if (kind === "knob") {
    return (
      <g>
        <circle cx={centerX} cy={centerY} r={1.2} fill="#b89b6c" />
        <circle cx={centerX - 0.35} cy={centerY - 0.35} r={0.35} fill="#f0dfbe" opacity={0.8} />
      </g>
    );
  }
  if (kind === "profile") {
    return (
      <line
        x1={x + 2}
        x2={x + width - 2}
        y1={horizontal ? y + height - 1.1 : y + 1.2}
        y2={horizontal ? y + height - 1.1 : y + 1.2}
        stroke="#776b5c"
        strokeWidth={0.55}
        opacity={0.55}
      />
    );
  }
  const barLength = Math.min(horizontal ? width * 0.45 : height * 0.22, 14);
  return (
    <g>
      <line
        x1={horizontal ? centerX - barLength / 2 : centerX}
        x2={horizontal ? centerX + barLength / 2 : centerX}
        y1={horizontal ? y + height * 0.36 : centerY - barLength / 2}
        y2={horizontal ? y + height * 0.36 : centerY + barLength / 2}
        stroke="#9a7a4f"
        strokeWidth={1.25}
        strokeLinecap="round"
      />
      <line
        x1={horizontal ? centerX - barLength / 2 : centerX - 0.28}
        x2={horizontal ? centerX + barLength / 2 : centerX - 0.28}
        y1={horizontal ? y + height * 0.36 - 0.3 : centerY - barLength / 2}
        y2={horizontal ? y + height * 0.36 - 0.3 : centerY + barLength / 2}
        stroke="#e7cfa9"
        strokeWidth={0.3}
        strokeLinecap="round"
        opacity={0.8}
      />
    </g>
  );
}

export function KitchenScene({
  config,
  selectedId,
  onSelect,
  onMove,
  showInterior = false,
  showDimensions = true,
  compact = false,
  invalidIds,
  className,
}: SceneProps) {
  const uid = useId().replace(/[:]/g, "");

  // Круглые кнопки перемещения скрываются через 2 с бездействия
  // (любое движение/клик/клавиша на схеме или смена выбора — заново 2 с).
  const [moveVisible, setMoveVisible] = useState(true);
  const moveVisibleRef = useRef(true);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pokeMoveButtons = useCallback(() => {
    if (!moveVisibleRef.current) {
      moveVisibleRef.current = true;
      setMoveVisible(true);
    }
    if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    moveTimerRef.current = setTimeout(() => {
      moveVisibleRef.current = false;
      setMoveVisible(false);
    }, 2000);
  }, []);
  useEffect(() => {
    pokeMoveButtons();
    return () => {
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    };
  }, [pokeMoveButtons, selectedId, onMove]);

  const floorModules = config.modules.filter(
    (module) => KITCHEN_MODULES[module.type]?.zone === "floor",
  );
  const upperModules = config.modules.filter(
    (module) => KITCHEN_MODULES[module.type]?.zone === "upper",
  );
  const floorWidth = floorModules.reduce((sum, module) => sum + safe(module.width), 0);
  const upperWidth = upperModules.reduce((sum, module) => sum + safe(module.width), 0);
  const totalWidth = Math.max(80, floorWidth, upperWidth);
  const baseHeight = safe(
    floorModules.find(
      (module) => !["tall", "oven"].includes(module.type),
    )?.height ?? floorModules[0]?.height,
    90,
  );
  const tallestFloor = floorModules.reduce(
    (max, module) => Math.max(max, safe(module.height, baseHeight)),
    0,
  );
  const tallestUpper = upperModules.reduce(
    (max, module) => Math.max(max, safe(module.height, 72)),
    0,
  );
  // Толщина столешницы (мм → см) и высота цоколя (см) — параметры конфигурации.
  const countertopCm = Math.max(0.4, safe(config.countertopThickness, 30) / 10);
  const plinthCm = config.plinth ? safe(config.plinthHeight, 10) : 0;
  const contentTop = Math.max(
    tallestFloor,
    baseHeight + countertopCm + KITCHEN_LIMITS.wallGapAboveCountertop + tallestUpper,
  );
  const floorY = Math.max(MIN_FLOOR_Y, contentTop + 10);
  const counterTopY = floorY - baseHeight - countertopCm;
  const wallBottomY = counterTopY - KITCHEN_LIMITS.wallGapAboveCountertop;
  // Общая высота кухни от пола до верхней точки (пенал или верхний ряд).
  const totalHeight = contentTop;
  const hasTall = floorModules.some(
    (module) => module.type === "tall" || module.type === "oven",
  );
  // Высота пенала (включает цоколь). Рисуется только при выбранном пенале.
  const tallHeight = hasTall ? tallestFloor : 0;

  const facadeColor = finishFor(
    FACADE_MATERIALS,
    config.facadeMaterial,
    config.facadeFinish,
    "#3b3b39",
  );
  const bodyColor = finishFor(
    BODY_MATERIALS,
    config.bodyMaterial,
    config.bodyFinish,
    "#d8c3a5",
  );
  const counterMaterial = COUNTERTOPS.find((item) => item.id === config.countertop);
  const counterColor = counterMaterial?.finishes[0]?.hex ?? "#e5e1d9";
  const counterAccent = counterMaterial?.finishes[0]?.accent ?? "#aaa398";
  // Монтажные зазоры фасадов (см): 2 мм у края ряда, 1 мм к соседу,
  // 1 мм между створками модуля; между ящиками 2 мм (урезка 1 мм на створку).
  const EDGE_GAP = 0.2;
  const NEIGHBOR_GAP = 0.1;
  const DOOR_GAP = 0.1;
  const invalidSet = new Set(invalidIds ?? []);

  const floorLayout = floorModules.reduce<{ module: KitchenModule; x: number }[]>(
    (acc, module) => {
      const previous = acc[acc.length - 1];
      const x = previous ? previous.x + safe(previous.module.width) : MARGIN;
      return [...acc, { module, x }];
    },
    [],
  );

  const upperLayout = upperModules.reduce<{ module: KitchenModule; x: number }[]>(
    (acc, module) => {
      const previous = acc[acc.length - 1];
      const x = previous ? previous.x + safe(previous.module.width) : MARGIN;
      return [...acc, { module, x }];
    },
    [],
  );

  const selected = (id: string) => selectedId === id;

  // Опоры — единый источник для схемы, спецификации и стоимости (см. supports.ts).
  const supportPlan = computeSupports(config);
  const legRows = supportPlan.modules.flatMap((entry) => {
    const item = floorLayout.find(({ module }) => module.id === entry.moduleId);
    if (!item || entry.excluded || entry.positions.length === 0) return [];
    return [
      {
        id: entry.moduleId,
        x: item.x,
        xs: entry.positions.map((position) => item.x + position.x),
      },
    ];
  });

  // Подсветка верхнего ряда: цвет свечения соответствует выбранной температуре.
  const lightingOn = config.underCabinetLighting;
  const glowColor = ledColorHex(config.lighting?.colorTemp ?? 3000);

  const interactiveProps = (module: KitchenModule) => ({
    role: onSelect ? ("button" as const) : undefined,
    tabIndex: onSelect ? 0 : undefined,
    "aria-label": `${KITCHEN_MODULES[module.type]?.label}, ширина ${module.width} см${
      selected(module.id) ? ", выбрано" : ""
    }`,
    onClick: onSelect ? () => onSelect(module.id) : undefined,
    onKeyDown: onSelect
      ? (event: React.KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(module.id);
          }
        }
      : undefined,
    style: onSelect ? { cursor: "pointer" } : undefined,
  });

  const renderFloorModule = (
    module: KitchenModule,
    x: number,
    rowStart = true,
    rowEnd = true,
  ) => {
    const width = safe(module.width, 60);
    const height = safe(module.height, baseHeight);
    const top = floorY - height;
    const isTall = module.type === "tall" || module.type === "oven";
    const bodyBottom = floorY - (config.plinth && isTall ? plinthCm : 0);
    const gapLeft = rowStart ? EDGE_GAP : NEIGHBOR_GAP;
    const gapRight = rowEnd ? EDGE_GAP : NEIGHBOR_GAP;
    const doorTop = top + EDGE_GAP;
    const doorBottom = bodyBottom - EDGE_GAP;
    const doors = doorCount(width);
    const innerWidth = width - gapLeft - gapRight;
    const doorWidth = (innerWidth - DOOR_GAP * (doors - 1)) / doors;
    // Конструкция модуля под мойку: фасады, перегородки и секции считаются
    // по единому правилу (см. lib/configurator/sink.ts), а не простым делением.
    const sink =
      module.type === "sink"
        ? sinkLayout(
            { ...module, width },
            { left: gapLeft, right: gapRight },
            sinkRowContext(floorModules, module.id),
          )
        : null;

    const renderSinkSections = () => {
      if (!sink) return null;
      const interiorH = doorBottom - doorTop;
      // Главная зона коммуникаций — самая широкая comms-секция: одна надпись
      // по её центру (вместо подписи в каждой секции — дублирование).
      const commsSections = sink.sections.filter((item) => item.comms);
      const mainComms = commsSections.length
        ? commsSections.reduce((best, item) =>
            item.width > best.width ? item : best,
          )
        : null;
      return (
        <>
          {/* Перегородки секций (дверные + граница бутылочницы) */}
          {sink.sectionCuts.map((partition, index) => (
            <rect
              key={`part-${index}`}
              x={x + partition.x}
              y={doorTop}
              width={partition.width}
              height={interiorH}
              fill={shade(bodyColor, -42)}
              stroke={shade(bodyColor, -55)}
              strokeWidth={0.25}
            />
          ))}
          {sink.sections.map((section) => {
            const sectionX = x + section.x;
            const sectionH = interiorH;
            if (section.comms) {
              // Зона коммуникаций — без рамки: пустое пространство под мойку,
              // сифон и трубы. Видна только одна подпись «Коммуникации»;
              // активные элементы (перегородки, полки, ящики, бутылочки)
              // рисуются отдельно.
              return null;
            }
            return (
              <g key={`sec-${section.index}`}>
                {/* Полки секции */}
                {Array.from({ length: section.shelves }).map((_, index) => {
                  const shelfY =
                    doorTop + (sectionH / (section.shelves + 1)) * (index + 1);
                  return (
                    <line
                      key={`shelf-${index}`}
                      x1={sectionX + 0.8}
                      x2={sectionX + section.width - 0.8}
                      y1={shelfY}
                      y2={shelfY}
                      stroke={shade(bodyColor, -18)}
                      strokeWidth={1}
                    />
                  );
                })}
                {/* Ящики секции */}
                {section.drawers > 0 &&
                  Array.from({ length: section.drawers }).map((_, index) => {
                    const drawerHeight = sectionH / section.drawers;
                    const drawerY = doorTop + index * drawerHeight;
                    return (
                      <g key={`drawer-${index}`}>
                        <rect
                          x={sectionX + 0.5}
                          y={drawerY + 0.4}
                          width={Math.max(0, section.width - 1)}
                          height={Math.max(0, drawerHeight - 0.8)}
                          rx={0.25}
                          fill={`url(#${uid}-facade)`}
                          stroke={shade(facadeColor, -28)}
                          strokeWidth={0.28}
                        />
                        <HandleMark
                          x={sectionX + 0.5}
                          y={drawerY + 0.4}
                          width={Math.max(0, section.width - 1)}
                          height={Math.max(0, drawerHeight - 0.8)}
                          kind={config.handle}
                          horizontal
                        />
                      </g>
                    );
                  })}
                {/* Бутылочница (карго): рама + две проволочные корзины 12 см;
                    divider bars и бутылки — только для секции 30 см */}
                {!sink.bottleConflict &&
                  section.bottle != null &&
                  section.bottle > 0 && (
                    <g key="bottle" fill="none">
                      {(() => {
                        const bx = sectionX + 0.4;
                        const bw = Math.max(1.2, section.width - 0.8);
                        const railColor = shade(bodyColor, -35);
                        const wireColor = shade(bodyColor, -24);
                        const hb = Math.max(6, Math.min(12, (sectionH - 4) / 2));
                        const bwb = Math.max(0.5, bw - 0.5);
                        const bbx = bx + (bw - bwb) / 2;
                        const guard = (y: number) =>
                          Math.max(doorTop + 2, Math.min(y, doorTop + sectionH - hb - 2));
                        const yLow = guard(doorTop + sectionH * 0.7 - hb / 2);
                        const yUp = Math.max(
                          guard(doorTop + sectionH * 0.3 - hb / 2),
                          Math.min(doorTop + 2, yLow - hb - 1),
                        );
                        const rackTop = yUp - 1.2;
                        const rackBottom = yLow + hb + 1.2;
                        const rods = Math.max(2, Math.floor((bwb - 1) / 2.6));
                        const rich = section.bottle === 30;
                        return (
                          <>
                            {/* рама карго: стойки + кронштейны */}
                            <g stroke={railColor} strokeWidth={0.35}>
                              <line x1={bx + 0.15} x2={bx + 0.15} y1={rackTop} y2={rackBottom} />
                              <line
                                x1={bx + bw - 0.15}
                                x2={bx + bw - 0.15}
                                y1={rackTop}
                                y2={rackBottom}
                              />
                              <line x1={bx} x2={bx + 0.7} y1={rackTop} y2={rackTop} />
                              <line x1={bx + bw - 0.7} x2={bx + bw} y1={rackTop} y2={rackTop} />
                              <line x1={bx} x2={bx + 0.7} y1={rackBottom} y2={rackBottom} />
                              <line
                                x1={bx + bw - 0.7}
                                x2={bx + bw}
                                y1={rackBottom}
                                y2={rackBottom}
                              />
                            </g>
                            {[yUp, yLow].map((by, bi) => (
                              <g key={bi}>
                                {/* бутылки (только 30 см) — до разделителей */}
                                {rich &&
                                  [0, 1, 2].map((k) => {
                                    const bWid = 3;
                                    const bHgt = Math.min(9.5, hb - 1.6);
                                    const cx = bbx + (bwb * (k + 0.5)) / 3;
                                    const x0 = cx - bWid / 2;
                                    const yBase = by + hb - 1;
                                    const yTop = yBase - bHgt;
                                    const nW = 1.2;
                                    const nX0 = x0 + (bWid - nW) / 2;
                                    const neckH = 1.8;
                                    const sh = yTop + neckH + 1.2;
                                    return (
                                      <g key={k}>
                                        <path
                                          d={`M ${x0} ${yBase} L ${x0} ${sh} Q ${x0} ${yTop + neckH} ${nX0} ${yTop + neckH + 0.4} L ${nX0} ${yTop + 0.4} L ${nX0 + nW} ${yTop + 0.4} L ${nX0 + nW} ${yTop + neckH + 0.4} Q ${x0 + bWid} ${yTop + neckH} ${x0 + bWid} ${sh} L ${x0 + bWid} ${yBase} Z`}
                                          fill={shade(bodyColor, -6)}
                                          stroke={shade(bodyColor, -30)}
                                          strokeWidth={0.3}
                                        />
                                        <line
                                          x1={nX0 - 0.15}
                                          x2={nX0 + nW + 0.15}
                                          y1={yTop + 0.5}
                                          y2={yTop + 0.5}
                                          stroke={shade(bodyColor, -30)}
                                          strokeWidth={0.35}
                                        />
                                      </g>
                                    );
                                  })}
                                {/* корпус проволочной корзины */}
                                <rect
                                  x={bbx}
                                  y={by}
                                  width={bwb}
                                  height={hb}
                                  rx={0.2}
                                  stroke={wireColor}
                                  strokeWidth={0.4}
                                />
                                {/* прутья */}
                                <g stroke={wireColor} strokeWidth={0.25}>
                                  {Array.from({ length: rods }, (_, i) => {
                                    const rx = bbx + 0.4 + ((bwb - 0.8) * (i + 1)) / (rods + 1);
                                    return (
                                      <line
                                        key={i}
                                        x1={rx}
                                        x2={rx}
                                        y1={by + 0.35}
                                        y2={by + hb - 0.6}
                                      />
                                    );
                                  })}
                                </g>
                                {/* двойной нижний обод */}
                                <g stroke={wireColor} strokeWidth={0.3}>
                                  <line
                                    x1={bbx + 0.3}
                                    x2={bbx + bwb - 0.3}
                                    y1={by + hb - 0.8}
                                    y2={by + hb - 0.8}
                                  />
                                  <line
                                    x1={bbx + 0.3}
                                    x2={bbx + bwb - 0.3}
                                    y1={by + hb - 0.4}
                                    y2={by + hb - 0.4}
                                  />
                                </g>
                                {/* divider bars — только 30 см */}
                                {rich && (
                                  <g stroke={shade(bodyColor, -45)} strokeWidth={0.55}>
                                    {[1, 2].map((k) => {
                                      const dx = bbx + (bwb * k) / 3;
                                      return (
                                        <line
                                          key={k}
                                          x1={dx}
                                          x2={dx}
                                          y1={by - 0.35}
                                          y2={by + hb - 0.3}
                                        />
                                      );
                                    })}
                                  </g>
                                )}
                              </g>
                            ))}
                          </>
                        );
                      })()}
                    </g>
                  )}
              </g>
            );
          })}
          {/* Одна подпись зоны коммуникаций: крупно, контрастно, по центру
              главной comms-секции; шрифт подгоняется под ширину секции. */}
          {mainComms && (
            <text
              x={x + mainComms.x + mainComms.width / 2}
              y={doorTop + interiorH / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="Manrope, sans-serif"
              fontSize={Math.min(6, mainComms.width / 7.6)}
              fontWeight={700}
              letterSpacing="0.06"
              fill={shade(bodyColor, 60)}
            >
              Коммуникации
            </text>
          )}
        </>
      );
    };

    // Створки фасадов модуля под мойку: по facadeBoxes — неравные створки
    // со швом на осевой перегородки и монтажными зазорами к соседям.
    // Отдельная узкая панель бутылочницы (kind: "bottle") — без петель и
    // ручки: фасад крепится на механизм бутылочки саморезами.
    const renderSinkDoors = () => {
      if (!sink) return null;
      return (
        <>
          {sink.facadeBoxes.map((box, index) => {
            // Фронты ящиков — стопкой, каждый со своей ручкой (2 мм между).
            if (box.kind === "drawers") {
              const count = Math.max(1, box.fronts ?? 1);
              const available = doorBottom - doorTop;
              const drawerHeight = available / count;
              return (
                <g key={index}>
                  {Array.from({ length: count }).map((__, front) => {
                    const y = doorTop + front * drawerHeight;
                    const trimTop = front > 0 ? 0.1 : 0;
                    const trimBottom = front < count - 1 ? 0.1 : 0;
                    const frontY = y + trimTop;
                    const frontH = Math.max(0.2, drawerHeight - trimTop - trimBottom);
                    return (
                      <g key={front}>
                        <rect
                          x={x + box.x}
                          y={frontY}
                          width={box.width}
                          height={frontH}
                          rx={0.25}
                          fill={`url(#${uid}-facade)`}
                          stroke={shade(facadeColor, -28)}
                          strokeWidth={0.28}
                        />
                        <HandleMark
                          x={x + box.x}
                          y={frontY}
                          width={box.width}
                          height={frontH}
                          kind={config.handle}
                          horizontal
                        />
                      </g>
                    );
                  })}
                </g>
              );
            }
            return (
              <g key={index}>
                <rect
                  x={x + box.x}
                  y={doorTop}
                  width={box.width}
                  height={doorBottom - doorTop}
                  rx={0.3}
                  fill={`url(#${uid}-facade)`}
                  stroke={shade(facadeColor, -30)}
                  strokeWidth={0.28}
                />
                <rect
                  x={x + box.x + 0.35}
                  y={doorTop + 0.35}
                  width={box.width - 0.7}
                  height={0.9}
                  fill="rgba(255,255,255,0.22)"
                />
                {/* Распашная створка — с ручкой; панель бутылочки — без
                    петель и без ручки (крепится на механизм саморезами). */}
                {box.kind === "door" && (
                  <HandleMark
                    x={x + box.x}
                    y={doorTop + 2}
                    width={box.width}
                    height={doorBottom - doorTop - 4}
                    kind={config.handle}
                  />
                )}
              </g>
            );
          })}
        </>
      );
    };

    return (
      <g key={module.id} {...interactiveProps(module)}>
        <rect
          x={x}
          y={top}
          width={width}
          height={height - (config.plinth && isTall ? plinthCm : 0)}
          rx={0.6}
          fill={`url(#${uid}-facade)`}
          stroke={shade(facadeColor, -28)}
          strokeWidth={0.45}
        />
        {showInterior && !isTall ? (
          <>
            <rect
              x={x + 1}
              y={doorTop}
              width={width - 2}
              height={doorBottom - doorTop}
              fill={shade(bodyColor, -34)}
            />
            <rect
              x={x + 1}
              y={doorTop}
              width={width - 2}
              height={doorBottom - doorTop}
              fill={`url(#${uid}-interior)`}
              opacity={0.35}
            />
            {sink ? (
              renderSinkSections()
            ) : module.type === "bottle" ? (
              // Бутылочница: выдвижная рама — 4 уровня хранения (визуально),
              // наполнение задаётся бутылочницей, а не полками.
              Array.from({ length: 4 }).map((_, index) => {
                const shelfY =
                  doorTop + ((doorBottom - doorTop) / 5) * (index + 1);
                return (
                  <line
                    key={`bottle-${index}`}
                    x1={x + 1.5}
                    x2={x + width - 1.5}
                    y1={shelfY}
                    y2={shelfY}
                    stroke={shade(bodyColor, -18)}
                    strokeWidth={1.1}
                  />
                );
              })
            ) : (
              Array.from({ length: Math.max(0, module.shelves) }).map((_, index) => {
                const shelfY =
                  doorTop + ((doorBottom - doorTop) / (module.shelves + 1)) * (index + 1);
                return (
                  <line
                    key={index}
                    x1={x + 1.5}
                    x2={x + width - 1.5}
                    y1={shelfY}
                    y2={shelfY}
                    stroke={shade(bodyColor, -18)}
                    strokeWidth={1.1}
                  />
                );
              })
            )}
            <rect
              x={x + 1}
              y={doorTop}
              width={width - 2}
              height={doorBottom - doorTop}
              fill="none"
              stroke={shade(facadeColor, -35)}
              strokeWidth={0.35}
              opacity={0.7}
            />
          </>
        ) : module.type === "drawers" ? (
          <>
            {Array.from({ length: Math.max(1, module.drawers) }).map((_, index) => {
              const count = Math.max(1, module.drawers);
              const available = doorBottom - doorTop;
              const drawerHeight = available / count;
              const y = doorTop + index * drawerHeight;
              // Между ящиками 2 мм: каждый фасад урезан на 1 мм сверху/снизу,
              // внешние края остаются с зазором 2 мм (doorTop/doorBottom).
              const trimTop = index > 0 ? 0.1 : 0;
              const trimBottom = index < count - 1 ? 0.1 : 0;
              const frontY = y + trimTop;
              const frontH = Math.max(0.2, drawerHeight - trimTop - trimBottom);
              return (
                <g key={index}>
                  <rect
                    x={x + gapLeft}
                    y={frontY}
                    width={width - gapLeft - gapRight}
                    height={frontH}
                    rx={0.25}
                    fill={`url(#${uid}-facade)`}
                    stroke={shade(facadeColor, -28)}
                    strokeWidth={0.28}
                  />
                  <HandleMark
                    x={x + gapLeft}
                    y={frontY}
                    width={width - gapLeft - gapRight}
                    height={frontH}
                    kind={config.handle}
                    horizontal
                  />
                </g>
              );
            })}
          </>
        ) : sink ? (
          renderSinkDoors()
        ) : (
          <>
            {Array.from({ length: doors }).map((_, index) => {
              const doorX = x + gapLeft + index * (doorWidth + DOOR_GAP);
              return (
                <g key={index}>
                  <rect
                    x={doorX}
                    y={doorTop}
                    width={doorWidth}
                    height={doorBottom - doorTop}
                    rx={0.3}
                    fill={`url(#${uid}-facade)`}
                    stroke={shade(facadeColor, -30)}
                    strokeWidth={0.28}
                  />
                  <rect
                    x={doorX + 0.35}
                    y={doorTop + 0.35}
                    width={doorWidth - 0.7}
                    height={0.9}
                    fill="rgba(255,255,255,0.22)"
                  />
                  <HandleMark
                    x={doorX}
                    y={doorTop + (module.type === "tall" ? 14 : 2)}
                    width={doorWidth}
                    height={doorBottom - doorTop - (module.type === "tall" ? 16 : 4)}
                    kind={config.handle}
                  />
                </g>
              );
            })}
            {module.type === "oven" && (
              <g>
                <rect
                  x={x + 5}
                  y={top + 48}
                  width={width - 10}
                  height={48}
                  rx={0.7}
                  fill="#191715"
                  stroke="#4b4640"
                  strokeWidth={0.4}
                />
                <rect
                  x={x + 6.5}
                  y={top + 49.5}
                  width={width - 13}
                  height={37}
                  rx={0.4}
                  fill={`url(#${uid}-ovenGlass)`}
                  opacity={0.9}
                />
                <line
                  x1={x + 9}
                  x2={x + width - 9}
                  y1={top + 91}
                  y2={top + 91}
                  stroke="#bcae9d"
                  strokeWidth={0.8}
                  strokeLinecap="round"
                />
                <circle cx={x + 9} cy={top + 44} r={0.7} fill="#bcae9d" />
                <circle cx={x + 13} cy={top + 44} r={0.7} fill="#bcae9d" />
              </g>
            )}
          </>
        )}
        {config.plinth && (
          <rect
            x={x + 0.6}
            y={floorY - plinthCm}
            width={width - 1.2}
            height={plinthCm}
            fill={shade(bodyColor, -55)}
          />
        )}
        {invalidSet.has(module.id) && (
          <rect
            x={x}
            y={top}
            width={width}
            height={height}
            rx={0.5}
            fill="rgba(220,38,38,0.14)"
            stroke="#dc2626"
            strokeWidth={0.7}
            pointerEvents="none"
          />
        )}
      </g>
    );
  };

  const renderUpperModule = (
    module: KitchenModule,
    x: number,
    rowStart = true,
    rowEnd = true,
  ) => {
    const width = safe(module.width, 60);
    const height = safe(module.height, 72);
    const top = wallBottomY - height;
    const doors = doorCount(width);
    const gapLeft = rowStart ? EDGE_GAP : NEIGHBOR_GAP;
    const gapRight = rowEnd ? EDGE_GAP : NEIGHBOR_GAP;
    const innerWidth = width - gapLeft - gapRight;
    const doorWidth = (innerWidth - DOOR_GAP * (doors - 1)) / doors;

    return (
      <g key={module.id} {...interactiveProps(module)}>
        <rect
          x={x}
          y={top}
          width={width}
          height={height}
          rx={0.5}
          fill={`url(#${uid}-facade)`}
          stroke={shade(facadeColor, -28)}
          strokeWidth={0.45}
        />
        {showInterior ? (
          <>
            <rect
              x={x + 1}
              y={top + 1}
              width={width - 2}
              height={height - 2}
              fill={shade(bodyColor, -34)}
            />
            <rect
              x={x + 1}
              y={top + 1}
              width={width - 2}
              height={height - 2}
              fill={`url(#${uid}-interior)`}
              opacity={0.35}
            />
            {Array.from({ length: Math.max(0, module.shelves) }).map((_, index) => {
              const shelfY = top + 1 + ((height - 2) / (module.shelves + 1)) * (index + 1);
              return (
                <line
                  key={index}
                  x1={x + 1.5}
                  x2={x + width - 1.5}
                  y1={shelfY}
                  y2={shelfY}
                  stroke={shade(bodyColor, -18)}
                  strokeWidth={1.1}
                />
              );
            })}
          </>
        ) : (
          Array.from({ length: doors }).map((_, index) => {
            const doorX = x + gapLeft + index * (doorWidth + DOOR_GAP);
            return (
              <g key={index}>
                <rect
                  x={doorX}
                  y={top + EDGE_GAP}
                  width={doorWidth}
                  height={height - EDGE_GAP * 2}
                  rx={0.3}
                  fill={`url(#${uid}-facade)`}
                  stroke={shade(facadeColor, -30)}
                  strokeWidth={0.28}
                />
                <rect
                  x={doorX + 0.35}
                  y={top + EDGE_GAP + 0.35}
                  width={doorWidth - 0.7}
                  height={0.8}
                  fill="rgba(255,255,255,0.22)"
                />
                <HandleMark
                  x={doorX}
                  y={top + 2}
                  width={doorWidth}
                  height={height - 4}
                  kind={config.handle}
                />
              </g>
            );
          })
        )}
        {config.underCabinetLighting && (
          <line
            x1={x + 2}
            x2={x + width - 2}
            y1={wallBottomY - 0.3}
            y2={wallBottomY - 0.3}
            stroke="#e9bc83"
            strokeWidth={0.9}
            opacity={0.75}
            filter={`url(#${uid}-glow)`}
          />
        )}
        {invalidSet.has(module.id) && (
          <rect
            x={x}
            y={top}
            width={width}
            height={height}
            rx={0.5}
            fill="rgba(220,38,38,0.14)"
            stroke="#dc2626"
            strokeWidth={0.7}
            pointerEvents="none"
          />
        )}
      </g>
    );
  };

  const counterSegments = floorLayout.filter(({ module }) =>
    ["base", "sink", "hob", "drawers", "bottle"].includes(module.type),
  );


  // Geometry of the selected module, resolved from the layouts so the
  // highlight can be drawn above the shadow-filtered groups (filters clip
  // content that extends past the module body, e.g. corner brackets).
  const selectedBox = (() => {
    if (!selectedId) return null;
    const floorEntry = floorLayout.find(({ module }) => module.id === selectedId);
    if (floorEntry) {
      const width = safe(floorEntry.module.width, 60);
      const height = safe(floorEntry.module.height, baseHeight);
      return { x: floorEntry.x, y: floorY - height, width, height };
    }
    const upperEntry = upperLayout.find(({ module }) => module.id === selectedId);
    if (upperEntry) {
      const width = safe(upperEntry.module.width, 60);
      const height = safe(upperEntry.module.height, 72);
      return { x: upperEntry.x, y: wallBottomY - height, width, height };
    }
    return null;
  })();

  return (
    <svg
      viewBox={`0 0 ${totalWidth + MARGIN * 2} ${floorY + (compact ? 46 : 52)}`}
      className={className}
      role="img"
      aria-label={`2D-схема кухни, ширина ${Math.round(totalWidth)} сантиметров, модулей: ${config.modules.length}`}
      onPointerMove={pokeMoveButtons}
      onPointerDown={pokeMoveButtons}
      onKeyDown={pokeMoveButtons}
    >
      <defs>
        <linearGradient id={`${uid}-facade`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={shade(facadeColor, 8)} />
          <stop offset="55%" stopColor={facadeColor} />
          <stop offset="100%" stopColor={shade(facadeColor, -12)} />
        </linearGradient>
        <linearGradient id={`${uid}-interior`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e1b18" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#3a342d" stopOpacity="0.8" />
        </linearGradient>
        <linearGradient id={`${uid}-counter`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={shade(counterColor, 10)} />
          <stop offset="50%" stopColor={counterColor} />
          <stop offset="100%" stopColor={shade(counterColor, -8)} />
        </linearGradient>
        <linearGradient id={`${uid}-ovenGlass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2c2b28" />
          <stop offset="45%" stopColor="#121110" />
          <stop offset="100%" stopColor="#3a3833" />
        </linearGradient>
        {/* Свечение подсветки: цвет зависит от выбранной температуры. */}
        <linearGradient id={`${uid}-ledFade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={glowColor} stopOpacity="0.62" />
          <stop offset="55%" stopColor={glowColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={glowColor} stopOpacity="0" />
        </linearGradient>
        <filter id={`${uid}-glow`} x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`${uid}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2.6" floodColor="#241b13" floodOpacity="0.18" />
        </filter>
        <marker
          id={`${uid}-arrow`}
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#85776a" />
        </marker>
      </defs>

      <rect
        x={MARGIN}
        y={counterTopY - 30}
        width={Math.max(1, totalWidth)}
        height={30}
        fill="#efe8dc"
        opacity={0.34}
        rx={0.4}
      />
      {Array.from({ length: Math.ceil(totalWidth / 30) }).map((_, index) => (
        <line
          key={index}
          x1={MARGIN + index * 30}
          x2={MARGIN + index * 30}
          y1={counterTopY - 30}
          y2={counterTopY}
          stroke="#bdb0a0"
          strokeWidth={0.25}
          opacity={0.45}
        />
      ))}

      <g filter={`url(#${uid}-shadow)`}>
        {floorLayout.map(({ module, x }, index) =>
          renderFloorModule(
            module,
            x,
            index === 0,
            index === floorLayout.length - 1,
          ),
        )}
      </g>

      <g>
        {counterSegments.map(({ module, x }) => (
          <g key={`${module.id}-counter`}>
            <rect
              x={x - 0.8}
              y={counterTopY}
              width={safe(module.width) + 1.6}
              height={countertopCm}
              rx={0.35}
              fill={`url(#${uid}-counter)`}
              stroke={withAlpha(counterAccent, 0.4)}
              strokeWidth={0.25}
            />
            <path
              d={`M ${x + safe(module.width) * 0.16} ${counterTopY + 1.4} q ${safe(module.width) * 0.2} -1.2 ${safe(module.width) * 0.4} 0.2`}
              fill="none"
              stroke={counterAccent}
              strokeWidth={0.2}
              opacity={0.5}
            />
            {module.type === "sink" && (() => {
              // Рендер по реальной геометрии мойки (мм → см), а не по долям
              // ширины модуля: при смене ширины модуля картинка не растягивается.
              const geom = sinkGeometry(
                { ...module, width: safe(module.width, 60) },
                sinkRowContext(floorModules, module.id),
              );
              const sinkX = x + geom.left / 10;
              const sinkW = geom.width / 10;
              const sinkD = geom.depth / 10;
              const inset = sinkW * 0.059;
              // Высота чаши на схеме пропорциональна глубине (500 мм → 2.8).
              const bowlH = Math.max(1.8, Math.min(3.4, 2.8 * (sinkD / 50)));
              const faucetX = sinkX + sinkW / 2;
              return (
                <g>
                  <rect
                    x={sinkX}
                    y={counterTopY - 1.1}
                    width={sinkW}
                    height={3.8}
                    rx={0.7}
                    fill="#c9c3b8"
                    stroke="#8d877d"
                    strokeWidth={0.35}
                  />
                  <rect
                    x={sinkX + inset}
                    y={counterTopY - 0.6}
                    width={sinkW - inset * 2}
                    height={bowlH}
                    rx={0.5}
                    fill="#6f756f"
                  />
                  <path
                    d={`M ${faucetX} ${counterTopY - 1.2} l 0 -5 q 0 -2.3 2.1 -2.3`}
                    fill="none"
                    stroke="#a69c8e"
                    strokeWidth={0.75}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={faucetX}
                    cy={counterTopY - 1.4}
                    r={0.6}
                    fill="#a69c8e"
                  />
                </g>
              );
            })()}
            {module.type === "hob" && (
              <g>
                <rect
                  x={x + safe(module.width) * 0.13}
                  y={counterTopY - 0.75}
                  width={safe(module.width) * 0.74}
                  height={2.9}
                  rx={0.35}
                  fill="#1c1b19"
                  opacity={0.92}
                />
                {[0.34, 0.62].map((fx) =>
                  [0.35, 0.65].map((fy) => (
                    <circle
                      key={`${fx}-${fy}`}
                      cx={x + safe(module.width) * fx}
                      cy={counterTopY + 0.7 + (fy - 0.5) * 1.2}
                      r={0.75}
                      fill="none"
                      stroke="#77736a"
                      strokeWidth={0.3}
                    />
                  )),
                )}
              </g>
            )}
          </g>
        ))}
      </g>

      <g filter={`url(#${uid}-shadow)`}>
        {upperLayout.map(({ module, x }, index) =>
          renderUpperModule(
            module,
            x,
            index === 0,
            index === upperLayout.length - 1,
          ),
        )}
      </g>

      {/* Подсветка под верхним рядом: плавное включение/выключение и цвет
          свечения по выбранной температуре. */}
      {upperLayout.length > 0 && (
        <g
          className={`scene-led${lightingOn ? " is-on" : ""}`}
          pointerEvents="none"
          aria-hidden="true"
        >
          <g className="scene-led__glow">
            {upperLayout.map(({ module, x }) => {
              const width = safe(module.width, 60);
              return (
                <g key={`led-${module.id}`}>
                  <rect
                    x={x + 0.5}
                    y={wallBottomY}
                    width={width - 1}
                    height={0.45}
                    rx={0.2}
                    fill={glowColor}
                  />
                  <rect
                    x={x + 0.5}
                    y={wallBottomY + 0.35}
                    width={width - 1}
                    height={16}
                    fill={`url(#${uid}-ledFade)`}
                  />
                </g>
              );
            })}
          </g>
        </g>
      )}

      {selectedBox && <SelectionOutline {...selectedBox} />}

      {selectedBox &&
        selectedId &&
        onMove &&
        (() => {
          const floorIndex = floorLayout.findIndex(
            ({ module }) => module.id === selectedId,
          );
          const zone =
            floorIndex >= 0
              ? { list: floorLayout, index: floorIndex }
              : {
                  list: upperLayout,
                  index: upperLayout.findIndex(
                    ({ module }) => module.id === selectedId,
                  ),
                };
          if (zone.index < 0) return null;
          const radius = Math.min(7, selectedBox.width / 4, selectedBox.height / 4);
          const step = radius + 2.4;
          const cy = selectedBox.y + selectedBox.height / 2;
          return (
            <g
              className={`scene-move-btns${moveVisible ? "" : " scene-move-btns--hidden"}`}
            >
              {([-1, 1] as const).map((direction) => {
                const can =
                  direction === -1 ? zone.index > 0 : zone.index < zone.list.length - 1;
                const cx =
                  selectedBox.x + selectedBox.width / 2 + direction * step;
                return (
                  <g
                    key={direction}
                    className={`scene-move-btn${can ? "" : " scene-move-btn--disabled"}`}
                    role="button"
                    tabIndex={can ? 0 : -1}
                    aria-label={
                      direction === -1
                        ? "Переместить модуль влево"
                        : "Переместить модуль вправо"
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (can) onMove(selectedId, direction);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (can) onMove(selectedId, direction);
                      }
                    }}
                  >
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill="#ffffff"
                      stroke="#b87333"
                      strokeWidth={0.55}
                      opacity={can ? 1 : 0.35}
                    />
                    <path
                      d="M -2.6 0 L 2.1 0 M 2.1 0 L -0.5 -2.4 M 2.1 0 L -0.5 2.4"
                      transform={`translate(${cx} ${cy}) scale(${direction}, 1)`}
                      fill="none"
                      stroke="#b87333"
                      strokeWidth={0.85}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={can ? 1 : 0.35}
                    />
                  </g>
                );
              })}
            </g>
          );
        })()}

      <line
        x1={MARGIN - 8}
        x2={MARGIN + totalWidth + 8}
        y1={floorY}
        y2={floorY}
        stroke="#a99b8b"
        strokeWidth={0.6}
        opacity={0.55}
      />

      {/* Опоры: фактические места установки из единого расчёта (supports.ts).
          Задний ряд — контуром, передний — заливкой; под линией пола, чтобы
          не перегружать корпуса и не спорить с цоколем. */}
      <g pointerEvents="none" aria-hidden="true">
        {legRows.map((row) => (
          <g key={`legs-${row.id}`}>
            {row.xs.map((cx) => (
              <circle
                key={`back-${row.id}-${cx}`}
                cx={cx}
                cy={floorY + 1}
                r={0.45}
                fill="none"
                stroke="#8d7f71"
                strokeWidth={0.3}
              />
            ))}
            {row.xs.map((cx) => (
              <g key={`front-${row.id}-${cx}`}>
                <circle cx={cx} cy={floorY + 2.3} r={0.45} fill="#5d5348" />
                <circle cx={cx} cy={floorY + 2.3} r={0.75} fill="none" stroke="#5d5348" strokeWidth={0.16} opacity={0.35} />
              </g>
            ))}
          </g>
        ))}
      </g>

      {showDimensions && (
        <g fill="#6f6356" fontFamily="Manrope, sans-serif">
          {/* Стрелка ширины под каждым модулем нижнего ряда */}
          {floorLayout.map(({ module, x }) => {
            const width = safe(module.width, 60);
            const lineY = floorY + (compact ? 13 : 16);
            return (
              <g key={`dim-${module.id}`}>
                <text
                  x={x + width / 2}
                  y={lineY - 3.4}
                  textAnchor="middle"
                  fontSize={compact ? 5.4 : 6.4}
                  fontWeight={600}
                  fill="#5d5348"
                >
                  {Math.round(width)}
                </text>
                <line
                  x1={x + 0.8}
                  x2={x + width - 0.8}
                  y1={lineY}
                  y2={lineY}
                  stroke="#8d7f71"
                  strokeWidth={0.3}
                  markerStart={`url(#${uid}-arrow)`}
                  markerEnd={`url(#${uid}-arrow)`}
                />
              </g>
            );
          })}

          {/* Общая ширина кухни */}
          <text
            x={MARGIN + totalWidth / 2}
            y={floorY + (compact ? 28 : 34)}
            textAnchor="middle"
            fill="#6f6356"
            fontSize={compact ? 6.4 : 7.4}
            fontWeight={700}
          >
            {Math.round(totalWidth)} см
          </text>
          <line
            x1={MARGIN}
            x2={MARGIN + totalWidth}
            y1={floorY + (compact ? 34 : 41)}
            y2={floorY + (compact ? 34 : 41)}
            stroke="#8d7f71"
            strokeWidth={0.4}
            markerStart={`url(#${uid}-arrow)`}
            markerEnd={`url(#${uid}-arrow)`}
          />

          {/* Высота нижнего ряда (с цоколем, без столешницы) */}
          <line
            x1={MARGIN - 16}
            x2={MARGIN - 16}
            y1={floorY}
            y2={floorY - baseHeight}
            stroke="#8d7f71"
            strokeWidth={0.4}
            markerStart={`url(#${uid}-arrow)`}
            markerEnd={`url(#${uid}-arrow)`}
          />
          <text
            x={MARGIN - 19}
            y={(floorY + (floorY - baseHeight)) / 2}
            textAnchor="middle"
            transform={`rotate(-90 ${MARGIN - 19} ${(floorY + (floorY - baseHeight)) / 2})`}
            fontSize={compact ? 5.6 : 6.4}
            fontWeight={700}
            fill="#6f6356"
          >
            {Math.round(baseHeight)} см
          </text>

          {/* Высота пенала — только если выбран пенал */}
          {hasTall && (
            <>
              <line
                x1={MARGIN - 26}
                x2={MARGIN - 26}
                y1={floorY}
                y2={floorY - tallHeight}
                stroke="#8d7f71"
                strokeWidth={0.4}
                markerStart={`url(#${uid}-arrow)`}
                markerEnd={`url(#${uid}-arrow)`}
              />
              <text
                x={MARGIN - 29}
                y={(floorY + (floorY - tallHeight)) / 2}
                textAnchor="middle"
                transform={`rotate(-90 ${MARGIN - 29} ${(floorY + (floorY - tallHeight)) / 2})`}
                fontSize={compact ? 5.6 : 6.4}
                fontWeight={700}
                fill="#6f6356"
              >
                {Math.round(tallHeight)} см
              </text>
            </>
          )}

          {/* Общая высота кухни — левее всех */}
          <line
            x1={MARGIN - 36}
            x2={MARGIN - 36}
            y1={floorY}
            y2={floorY - totalHeight}
            stroke="#8d7f71"
            strokeWidth={0.4}
            markerStart={`url(#${uid}-arrow)`}
            markerEnd={`url(#${uid}-arrow)`}
          />
          <text
            x={MARGIN - 39}
            y={(floorY + (floorY - totalHeight)) / 2}
            textAnchor="middle"
            transform={`rotate(-90 ${MARGIN - 39} ${(floorY + (floorY - totalHeight)) / 2})`}
            fontSize={compact ? 5.6 : 6.4}
            fontWeight={700}
            fill="#6f6356"
          >
            {Math.round(totalHeight)} см
          </text>
        </g>
      )}
    </svg>
  );
}
