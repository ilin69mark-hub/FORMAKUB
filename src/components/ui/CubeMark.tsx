import type { CSSProperties } from "react";

const FACES = ["front", "back", "right", "left", "top", "bottom"] as const;

export function CubeMark({
  size = 46,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`brand-cube ${className}`}
      style={{ "--cube-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="brand-cube__inner">
        {FACES.map((face) => (
          <span
            key={face}
            className={`brand-cube__face brand-cube__face--${face}`}
          >
            {face !== "top" && face !== "bottom" && (
              <span className="brand-cube__text">FORMA</span>
            )}
          </span>
        ))}
      </span>
    </span>
  );
}
