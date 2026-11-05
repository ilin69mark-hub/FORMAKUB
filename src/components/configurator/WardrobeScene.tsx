"use client";

import { useId } from "react";
import { BODY_MATERIALS, FACADE_MATERIALS, WARDROBE_LIMITS } from "@/content/catalog";
import { shade } from "@/lib/color";
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

function doorCount(width: number): number {
  return width > 60 ? 2 : 1;
}

function HandleMark({
  x,
  y,
  height,
  kind,
  side,
}: {
  x: number;
  y: number;
  height: number;
  kind: WardrobeConfig["handle"];
  side: "left" | "right";
}) {
  if (kind === "none") return null;
  if (kind === "knob") {
    return (
      <g>
        <circle cx={x} cy={y + height / 2} r={1.15} fill="#b89b6c" />
        <circle cx={x - 0.3} cy={y + height / 2 - 0.3} r={0.3} fill="#f0dfbe" />
      </g>
    );
  }
  if (kind === "profile") {
    return (
      <line
        x1={x}
        x2={x}
        y1={y + height * 0.28}
        y2={y + height * 0.72}
        stroke="#8b7c68"
        strokeWidth={0.9}
        strokeLinecap="round"
        opacity={0.6}
      />
    );
  }
  const direction = side === "left" ? 1 : -1;
  return (
    <g>
      <line
        x1={x + direction * 1.8}
        x2={x + direction * 1.8}
        y1={y + height / 2 - 9}
        y2={y + height / 2 + 9}
        stroke="#9a7a4f"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <line
        x1={x + direction * 1.5}
        x2={x + direction * 1.5}
        y1={y + height / 2 - 9}
        y2={y + height / 2 + 9}
        stroke="#e7cfa9"
        strokeWidth={0.3}
        strokeLinecap="round"
        opacity={0.8}
      />
    </g>
  );
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
  const width = Math.max(
    60,
    config.sections.reduce((sum, section) => sum + safe(section.width), 0),
  );
  const height = safe(config.height, 240);
  const floorY = TOP + height;
  const plinth = config.plinth ? WARDROBE_LIMITS.plinthHeight : 0;
  const facadeColor = finishFor(
    FACADE_MATERIALS,
    config.facadeMaterial,
    config.facadeFinish,
    "#d6c5ac",
  );
  const bodyColor = finishFor(
    BODY_MATERIALS,
    config.bodyMaterial,
    config.bodyFinish,
    "#d8c3a5",
  );
  const isGlass = config.facadeMaterial === "glass";

  const layout = config.sections.reduce<{ section: WardrobeSection; x: number }[]>(
    (acc, section) => {
      const previous = acc[acc.length - 1];
      const x = previous
        ? previous.x + safe(previous.section.width, 60)
        : MARGIN;
      return [...acc, { section, x }];
    },
    [],
  );

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
      width: safe(entry.section.width, 60),
      height,
    };
  })();

  const interactiveProps = (section: WardrobeSection) => ({
    role: onSelect ? ("button" as const) : undefined,
    tabIndex: onSelect ? 0 : undefined,
    "aria-label": `Секция шириной ${section.width} см, полок: ${section.shelves.length}, ящиков: ${section.drawers}`,
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

  const renderSection = (section: WardrobeSection, x: number) => {
    const sectionWidth = safe(section.width, 60);
    const interiorX = x + 1.4;
    const interiorWidth = sectionWidth - 2.8;
    const interiorTop = TOP + 1.4;
    const interiorBottom = floorY - plinth - 1.2;
    const doors = doorCount(sectionWidth);
    const doorGap = 0.55;
    const doorWidth =
      (interiorWidth - doorGap * (doors - 1)) / doors;

    return (
      <g key={section.id} {...interactiveProps(section)}>
        <rect
          x={x}
          y={TOP}
          width={sectionWidth}
          height={height}
          fill={`url(#${uid}-body)`}
          stroke={shade(bodyColor, -34)}
          strokeWidth={0.4}
        />

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
        ) : (
          Array.from({ length: doors }).map((_, index) => {
            const doorX = interiorX + index * (doorWidth + doorGap);
            return (
              <g key={index}>
                <rect
                  x={doorX}
                  y={interiorTop}
                  width={doorWidth}
                  height={interiorBottom - interiorTop}
                  rx={0.3}
                  fill={isGlass ? `url(#${uid}-glass)` : `url(#${uid}-facade)`}
                  stroke={shade(facadeColor, -30)}
                  strokeWidth={0.3}
                  opacity={isGlass ? 0.84 : 1}
                />
                <rect
                  x={doorX + 0.4}
                  y={interiorTop + 0.4}
                  width={doorWidth - 0.8}
                  height={1.1}
                  fill="rgba(255,255,255,0.24)"
                />
                {config.facadeStyle === "shaker" && (
                  <rect
                    x={doorX + 4}
                    y={interiorTop + 4}
                    width={doorWidth - 8}
                    height={interiorBottom - interiorTop - 8}
                    fill="none"
                    stroke={shade(facadeColor, -18)}
                    strokeWidth={0.45}
                    opacity={0.8}
                  />
                )}
                {isGlass && (
                  <path
                    d={`M ${doorX + 2} ${interiorBottom - 18} L ${doorX + doorWidth - 5} ${interiorTop + 10}`}
                    stroke="rgba(255,255,255,0.28)"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                )}
                <HandleMark
                  x={
                    doors === 2
                      ? index === 0
                        ? doorX + doorWidth - 1.5
                        : doorX + 1.5
                      : doorX + doorWidth - 2
                  }
                  y={interiorTop + (interiorBottom - interiorTop) * 0.18}
                  height={(interiorBottom - interiorTop) * 0.64}
                  kind={config.handle}
                  side={doors === 2 ? (index === 0 ? "right" : "left") : "right"}
                />
              </g>
            );
          })
        )}

        {config.plinth && (
          <rect
            x={x + 0.7}
            y={floorY - plinth}
            width={sectionWidth - 1.4}
            height={plinth}
            fill={shade(bodyColor, -58)}
          />
        )}
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

      <g filter={`url(#${uid}-shadow)`}>
        {layout.map(({ section, x }) => renderSection(section, x))}
      </g>

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
              глубина {Math.round(config.depth)} см
            </text>
          )}
        </g>
      )}
    </svg>
  );
}
