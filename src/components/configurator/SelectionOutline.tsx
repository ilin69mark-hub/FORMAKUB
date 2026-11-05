"use client";

import { useId } from "react";

/**
 * CAD-like selection highlight for 2D configurator scenes.
 * A soft accent tint over the real geometry of the selected element plus
 * glowing corner brackets. No full rectangular frame — the brackets alone
 * mark the selection. Stroke widths are screen-space (vectorEffect) so the
 * highlight stays delicate at any zoom level.
 */
export function SelectionOutline({
  x,
  y,
  width,
  height,
  rx = 0.9,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
}) {
  const rawId = useId();
  const uid = rawId.replace(/:/g, "");

  if (width <= 0 || height <= 0) return null;

  const bracket = Math.min(4.5, width * 0.22, height * 0.22);
  const gap = 1.15;
  const corners: [number, number, number, number][] = [
    // [startX, startY, dirX, dirY]
    [x - gap, y - gap, 1, 1],
    [x + width + gap, y - gap, -1, 1],
    [x - gap, y + height + gap, 1, -1],
    [x + width + gap, y + height + gap, -1, -1],
  ];

  return (
    <g className="module-selection" pointerEvents="none" aria-hidden="true">
      <defs>
        <filter
          id={`${uid}-glow`}
          x="-80%"
          y="-80%"
          width="260%"
          height="260%"
        >
          <feGaussianBlur stdDeviation="1.1" result="blur" />
          <feFlood floodColor="#c98a55" floodOpacity="0.9" result="tint" />
          <feComposite in="tint" in2="blur" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Soft accent tint over the module body */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={rx}
        fill="#b87849"
        fillOpacity={0.07}
      />
      {/* CAD-style corner brackets with a delicate warm glow */}
      <g filter={`url(#${uid}-glow)`}>
        {corners.map(([cx, cy, dx, dy], index) => (
          <path
            key={index}
            d={`M ${cx} ${cy + dy * bracket} L ${cx} ${cy} L ${cx + dx * bracket} ${cy}`}
            fill="none"
            stroke="#b87849"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </g>
  );
}
