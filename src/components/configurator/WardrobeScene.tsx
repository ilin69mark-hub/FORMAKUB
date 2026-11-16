"use client";

import { useId } from "react";
import { BODY_MATERIALS, FACADE_MATERIALS, WARDROBE_LIMITS } from "@/content/catalog";
import { shade } from "@/lib/color";
import {
  WARDROBE_PLINTH_HEIGHT_CM,
} from "@/lib/configurator/facade-geometry";
import { FIXED_BODY_MATERIAL_ID } from "@/lib/configurator/materials";
import { wardrobeGeometry } from "@/lib/configurator/wardrobe-geometry";
import { wardrobeFacadeGeometry } from "@/lib/configurator/wardrobe-facade-geometry";
import { SelectionOutline } from "@/components/configurator/SelectionOutline";
import type { WardrobeConfig, WardrobeSection } from "@/lib/configurator/types";

interface SceneProps {
  config: WardrobeConfig;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  showInterior?: boolean;
  showDimensions?: boolean;
  compact?: boolean;
  className?: string;
}

const MARGIN = 46;
const TOP = 44;

function safe(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

export function WardrobeScene({
  config,
  selectedId,
  onSelect,
  showInterior = false,
  showDimensions = true,
  compact = false,
  className,
}: SceneProps) {
  const uid = useId().replace(/[:]/g, "");
  const geometry = wardrobeGeometry(config);
  const facadeGeometry = wardrobeFacadeGeometry(config, geometry);
  const width = Math.max(60, geometry.widthMm / 10);
  const height = safe(config.height, 240);
  const floorY = TOP + height;
  const plinth = config.plinth ? WARDROBE_PLINTH_HEIGHT_CM : 0;
  const facadeColor = finishFor(
    FACADE_MATERIALS,
    config.facadeMaterial,
    config.facadeFinish,
    "#d6c5ac",
  );
  const bodyColor = finishFor(
    BODY_MATERIALS,
    FIXED_BODY_MATERIAL_ID,
    config.bodyFinish,
    "#d8c3a5",
  );

  const layout = config.sections.slice(0, geometry.sections.length).map((section, index) => ({
    section,
    widthCm: (geometry.sections[index]?.innerWidthMm ?? 0) / 10,
    x:
      index === 0
        ? MARGIN + geometry.bodyThicknessMm / 10
        : MARGIN +
          ((geometry.partition?.positionMm ?? 0) +
            (geometry.partition?.thicknessMm ?? 0)) /
            10,
  }));

  // Geometry of the selected section, resolved from the layout so the
  // highlight can be drawn above the shadow-filtered group (filters clip
  // content that extends past the section body, e.g. corner brackets).
  const selectedBox = (() => {
    if (!selectedId) return null;
    const entry = layout.find(({ section }) => section.id === selectedId);
    if (!entry) return null;
    return {
      x: entry.x,
      y: TOP,
      width: entry.widthCm,
      height,
    };
  })();

  const interactiveProps = (section: WardrobeSection) => ({
    role: onSelect ? ("button" as const) : undefined,
    tabIndex: onSelect ? 0 : undefined,
    "aria-label": `Секция шириной ${layout.find((entry) => entry.section.id === section.id)?.widthCm ?? 0} см, полок: ${section.shelves.length}, ящиков: ${section.drawers}`,
    onClick: onSelect ? () => onSelect(section.id) : undefined,
    onKeyDown: onSelect
      ? (event: React.KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(section.id);
          }
        }
      : undefined,
    style: onSelect ? { cursor: "pointer" } : undefined,
  });

  const renderSection = (section: WardrobeSection, x: number, sectionWidth: number) => {
    const interiorX = x;
    const interiorWidth = sectionWidth;
    const interiorTop = TOP + geometry.bodyThicknessMm / 10;
    const interiorBottom = floorY - plinth - geometry.bodyThicknessMm / 10;

    return (
      <g key={section.id} {...interactiveProps(section)}>
        {showInterior ? (
          <g>
            <rect
              x={interiorX}
              y={interiorTop}
              width={interiorWidth}
              height={interiorBottom - interiorTop}
              fill={shade(bodyColor, -58)}
            />
            <rect
              x={interiorX}
              y={interiorTop}
              width={interiorWidth}
              height={interiorBottom - interiorTop}
              fill={`url(#${uid}-interior)`}
              opacity={0.42}
            />

            {config.ledLighting && (
              <line
                x1={interiorX + 1.5}
                x2={interiorX + interiorWidth - 1.5}
                y1={interiorTop + 3}
                y2={interiorTop + 3}
                stroke="#f4c98f"
                strokeWidth={0.95}
                filter={`url(#${uid}-glow)`}
              />
            )}

            {section.shelves.map((position, index) => {
              const y = clamp(
                floorY - safe(position, 100),
                interiorTop + 6,
                interiorBottom - 4,
              );
              return (
                <g key={`${position}-${index}`}>
                  <rect
                    x={interiorX}
                    y={y - 1}
                    width={interiorWidth}
                    height={1.9}
                    fill={shade(bodyColor, 6)}
                    stroke={shade(bodyColor, -30)}
                    strokeWidth={0.2}
                  />
                  <line
                    x1={interiorX}
                    x2={interiorX + interiorWidth}
                    y1={y + 0.9}
                    y2={y + 0.9}
                    stroke="#1e1a16"
                    strokeWidth={0.35}
                    opacity={0.5}
                  />
                </g>
              );
            })}

            {section.rods.map((position, index) => {
              const y = clamp(
                floorY - safe(position, 200),
                interiorTop + 7,
                interiorBottom - 8,
              );
              return (
                <g key={`${position}-rod-${index}`}>
                  <line
                    x1={interiorX + 1}
                    x2={interiorX + interiorWidth - 1}
                    y1={y}
                    y2={y}
                    stroke="#a9a49b"
                    strokeWidth={0.75}
                    strokeLinecap="round"
                  />
                  {[0.24, 0.48, 0.72].map((ratio) => {
                    const hangerX = interiorX + interiorWidth * ratio;
                    return (
                      <g key={ratio} opacity={0.72}>
                        <path
                          d={`M ${hangerX} ${y} l 0 2.6 l -3 2.2 l 0 3.2 M ${hangerX} ${y + 4.8} l 3 -2.2`}
                          fill="none"
                          stroke="#c8c2b7"
                          strokeWidth={0.35}
                          strokeLinecap="round"
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {Array.from({ length: Math.max(0, section.drawers) }).map((_, index) => {
              const drawerHeight = WARDROBE_LIMITS.drawerHeight;
              const drawerTop =
                interiorBottom - (Math.max(0, section.drawers) - index) * drawerHeight;
              return (
                <g key={index}>
                  <rect
                    x={interiorX}
                    y={drawerTop + 0.7}
                    width={interiorWidth}
                    height={drawerHeight - 1.2}
                    rx={0.35}
                    fill={`url(#${uid}-facade)`}
                    stroke={shade(facadeColor, -28)}
                    strokeWidth={0.3}
                  />
                  <line
                    x1={interiorX + interiorWidth * 0.3}
                    x2={interiorX + interiorWidth * 0.7}
                    y1={drawerTop + drawerHeight / 2}
                    y2={drawerTop + drawerHeight / 2}
                    stroke="#9a7a4f"
                    strokeWidth={0.85}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
          </g>
        ) : null}
      </g>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${width + MARGIN * 2} ${height + (compact ? 82 : 118)}`}
      className={className}
      role="img"
      aria-label={`2D-схема шкафа, ширина ${Math.round(width)} сантиметров, высота ${Math.round(height)} сантиметров, секций: ${config.sections.length}`}
    >
      <defs>
        <linearGradient id={`${uid}-facade`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={shade(facadeColor, 7)} />
          <stop offset="54%" stopColor={facadeColor} />
          <stop offset="100%" stopColor={shade(facadeColor, -11)} />
        </linearGradient>
        <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={shade(bodyColor, -8)} />
          <stop offset="50%" stopColor={shade(bodyColor, 2)} />
          <stop offset="100%" stopColor={shade(bodyColor, -12)} />
        </linearGradient>
        <linearGradient id={`${uid}-interior`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#241f1a" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#463d33" stopOpacity="0.8" />
        </linearGradient>
        <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d7e0dd" stopOpacity="0.7" />
          <stop offset="55%" stopColor="#8e9997" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#5d6664" stopOpacity="0.65" />
        </linearGradient>
        <filter id={`${uid}-glow`} x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="1.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`${uid}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#241b13" floodOpacity="0.2" />
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
        x={MARGIN + width / 2 - Math.min(width / 2, 200)}
        y={floorY + 2}
        width={Math.min(width, 400)}
        height={5}
        rx={2.5}
        fill="#c8b9a6"
        opacity={0.28}
      />

      <rect
        x={MARGIN}
        y={TOP}
        width={width}
        height={height}
        fill={`url(#${uid}-body)`}
        stroke={shade(bodyColor, -34)}
        strokeWidth={0.4}
      />
      <rect
        x={MARGIN}
        y={TOP}
        width={geometry.bodyThicknessMm / 10}
        height={height}
        fill={shade(bodyColor, -20)}
      />
      <rect
        x={MARGIN + width - geometry.bodyThicknessMm / 10}
        y={TOP}
        width={geometry.bodyThicknessMm / 10}
        height={height}
        fill={shade(bodyColor, -20)}
      />
      <rect
        x={MARGIN}
        y={TOP}
        width={width}
        height={geometry.bodyThicknessMm / 10}
        fill={shade(bodyColor, -16)}
      />
      <rect
        x={MARGIN + geometry.bodyThicknessMm / 10}
        y={floorY - geometry.plinthHeightMm / 10 - geometry.bodyThicknessMm / 10}
        width={geometry.internalWidthMm / 10}
        height={geometry.bodyThicknessMm / 10}
        fill={shade(bodyColor, -16)}
      />
      {geometry.partition && (
        <rect
          x={
            MARGIN +
            (geometry.partition.positionMm - geometry.partition.thicknessMm / 2) /
              10
          }
          y={TOP}
          width={geometry.partition.thicknessMm / 10}
          height={height}
          fill={shade(bodyColor, -42)}
          stroke={shade(bodyColor, -55)}
          strokeWidth={0.2}
        />
      )}
      {geometry.plinthHeightMm > 0 && (
        <rect
          x={MARGIN + geometry.plinthInsetMm / 10}
          y={floorY - geometry.plinthHeightMm / 10}
          width={width - (2 * geometry.plinthInsetMm) / 10}
          height={geometry.plinthHeightMm / 10}
          fill={shade(bodyColor, -58)}
        />
      )}
      {geometry.antresol && (
        <rect
          x={MARGIN + geometry.bodyThicknessMm / 10}
          y={
            TOP +
            height -
            geometry.antresol.dividerBottomMm / 10 -
            geometry.antresol.dividerThicknessMm / 10
          }
          width={geometry.internalWidthMm / 10}
          height={geometry.antresol.dividerThicknessMm / 10}
          fill={shade(bodyColor, -38)}
          stroke={shade(bodyColor, -52)}
          strokeWidth={0.2}
        />
      )}
      <g filter={`url(#${uid}-shadow)`}>
        {layout.map(({ section, x, widthCm }) => renderSection(section, x, widthCm))}
      </g>

      {!showInterior &&
        facadeGeometry.panels.map((panel) => (
          <g key={panel.id}>
            <rect
              x={MARGIN + panel.xMm / 10}
              y={TOP + panel.yMm / 10}
              width={panel.widthMm / 10}
              height={panel.heightMm / 10}
              rx={0.3}
              fill={`url(#${uid}-facade)`}
              stroke={shade(facadeColor, -30)}
              strokeWidth={0.3}
            />
            <rect
              x={MARGIN + panel.xMm / 10 + 0.4}
              y={TOP + panel.yMm / 10 + 0.4}
              width={Math.max(0, panel.widthMm / 10 - 0.8)}
              height={1.1}
              fill="rgba(255,255,255,0.24)"
            />
            {config.facadeStyle === "shaker" && (
              <rect
                x={MARGIN + panel.xMm / 10 + 4}
                y={TOP + panel.yMm / 10 + 4}
                width={Math.max(0, panel.widthMm / 10 - 8)}
                height={Math.max(0, panel.heightMm / 10 - 8)}
                fill="none"
                stroke={shade(facadeColor, -18)}
                strokeWidth={0.45}
                opacity={0.8}
              />
            )}
          </g>
        ))}

      {selectedBox && <SelectionOutline {...selectedBox} />}

      <line
        x1={MARGIN - 8}
        x2={MARGIN + width + 8}
        y1={floorY}
        y2={floorY}
        stroke="#a99b8b"
        strokeWidth={0.55}
        opacity={0.6}
      />

      {showDimensions && (
        <g fontFamily="Manrope, sans-serif">
          <line
            x1={MARGIN}
            x2={MARGIN + width}
            y1={floorY + (compact ? 26 : 34)}
            y2={floorY + (compact ? 26 : 34)}
            stroke="#8d7f71"
            strokeWidth={0.35}
            markerStart={`url(#${uid}-arrow)`}
            markerEnd={`url(#${uid}-arrow)`}
          />
          <text
            x={MARGIN + width / 2}
            y={floorY + (compact ? 22 : 30)}
            textAnchor="middle"
            fill="#6f6356"
            fontSize={compact ? 4.2 : 4.6}
            fontWeight={600}
          >
            {Math.round(width)} см
          </text>
          <line
            x1={MARGIN - 17}
            x2={MARGIN - 17}
            y1={TOP}
            y2={floorY}
            stroke="#8d7f71"
            strokeWidth={0.35}
            markerStart={`url(#${uid}-arrow)`}
            markerEnd={`url(#${uid}-arrow)`}
          />
          <text
            x={MARGIN - 20}
            y={TOP + height / 2}
            textAnchor="middle"
            transform={`rotate(-90 ${MARGIN - 20} ${TOP + height / 2})`}
            fill="#6f6356"
            fontSize={compact ? 3.8 : 4.1}
            fontWeight={600}
          >
            {Math.round(height)} см
          </text>
          {!compact && (
            <text
              x={MARGIN + width}
              y={TOP - 12}
              textAnchor="end"
              fill="#8a7c6c"
              fontSize={3.8}
            >
              полная глубина {Math.round(config.fullDepth / 10)} см
            </text>
          )}
        </g>
      )}
    </svg>
  );
}
