"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, Minus, Plus } from "lucide-react";
import type { Finish } from "@/content/catalog";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function HelpHint({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const open = hovered || pinned;

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 280;
    const margin = 12;
    const gap = 10;
    const container = buttonRef.current?.closest("aside");
    const anchorRight = container
      ? container.getBoundingClientRect().right
      : rect.right;
    const fitsRight = anchorRight + gap + width <= window.innerWidth - margin;
    const left = fitsRight
      ? anchorRight + gap
      : Math.min(
          Math.max(margin, rect.left + rect.width / 2 - width / 2),
          Math.max(margin, window.innerWidth - width - margin),
        );
    const top = Math.min(
      Math.max(margin, fitsRight ? rect.top - 4 : rect.bottom + gap),
      Math.max(margin, window.innerHeight - 160),
    );
    setPosition({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setHovered(false);
      setPinned(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const show = () => {
    place();
    setHovered(true);
  };
  const close = () => {
    setHovered(false);
    setPinned(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={() => setHovered(false)}
        onFocus={show}
        onBlur={() => setHovered(false)}
        onClick={() => {
          setPinned((value) => {
            if (!value) place();
            return !value;
          });
        }}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-ink/35 transition-colors hover:text-copper focus:outline-none focus-visible:ring-1 focus-visible:ring-copper/40"
        aria-label={`Подсказка: ${label}`}
        aria-expanded={open}
      >
        <HelpCircle size={13} />
      </button>
      {open && position
        ? createPortal(
            <>
              {pinned ? (
                <div
                  className="fixed inset-0 z-[119]"
                  onClick={close}
                  aria-hidden="true"
                />
              ) : null}
              <div
                role="dialog"
                aria-label={label}
                className="fixed z-[120] w-[280px] rounded-xl border border-ink/10 bg-[#f7f2ea] p-3 text-[0.66rem] leading-relaxed text-ink/60 shadow-[0_18px_50px_-20px_rgba(22,19,16,0.45)]"
                style={{ top: position.top, left: position.left }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-1 text-[0.55rem] font-bold uppercase tracking-[0.14em] text-copper">
                  Подсказка
                </div>
                {children}
                {pinned ? (
                  <button
                    type="button"
                    onClick={close}
                    className="mt-2 block text-left text-[0.6rem] font-semibold text-copper underline decoration-copper/25 underline-offset-2"
                  >
                    Понятно
                  </button>
                ) : null}
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

export function PanelSection({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-t border-ink/10 pt-4 first:border-t-0 first:pt-0 ${className}`}>
      <div className="mb-3">
        <h3 className="text-[0.8rem] font-semibold tracking-tight">{title}</h3>
        {hint && <p className="mt-1 text-[0.64rem] leading-relaxed text-ink/42">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function RangeMarks({
  min,
  max,
  step,
  tone = "ink",
  className = "",
}: {
  min: number;
  max: number;
  step: number;
  tone?: "ink" | "cream";
  className?: string;
}) {
  const span = Math.max(1, max - min);
  const marks = Array.from(
    { length: Math.floor((max - min) / step) + 1 },
    (_, index) => min + index * step,
  );
  if (marks[marks.length - 1] !== max) marks.push(max);

  const labelStep =
    span <= 25 ? 5 : span <= 50 ? 10 : span <= 120 ? 20 : span <= 250 ? 50 : 100;
  const edge = span * 0.12;
  const labeled = new Set<number>([min, max]);
  for (const mark of marks) {
    if (mark === min || mark === max) continue;
    if ((mark - min) % labelStep !== 0) continue;
    if (mark - min < edge || max - mark < edge) continue;
    labeled.add(mark);
  }

  return (
    <div
      className={`relative mt-1 h-3.5 px-2 ${tone === "cream" ? "text-cream/40" : "text-ink/32"} ${className}`}
      aria-hidden="true"
    >
      {marks.map((mark) => {
        const isFirst = mark === min;
        const isLast = mark === max;
        return (
          <span
            key={mark}
            className="absolute top-0 flex flex-col items-center gap-0.5 text-[0.48rem] leading-none"
            style={{
              left: `${((mark - min) / span) * 100}%`,
              transform: isFirst
                ? "none"
                : isLast
                  ? "translateX(-100%)"
                  : "translateX(-50%)",
            }}
          >
            <span
              className={`h-1 w-px ${tone === "cream" ? "bg-cream/25" : "bg-ink/20"}`}
            />
            {labeled.has(mark) ? mark : null}
          </span>
        );
      })}
    </div>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "см",
  markStep,
  pins,
  hint,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  markStep?: number;
  /** Отметки стандартных значений на шкале (в единицах поля). */
  pins?: number[];
  hint?: ReactNode;
  /** Поле видимо, но не редактируется (например, занято другим допом). */
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const change = (next: number) => onChange(clamp(Math.round(next), min, max));
  const span = Math.max(1, max - min);

  return (
    <div className={disabled ? "opacity-45" : undefined}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1 text-[0.68rem] font-medium text-ink/55">
          <span className="truncate">{label}</span>
          {hint ? <HelpHint label={label}>{hint}</HelpHint> : null}
        </span>
        <span className="shrink-0 text-[0.7rem] font-bold text-ink">
          {value} {unit}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => change(value - step)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/12 bg-white/50 text-ink/55 transition-colors hover:bg-white disabled:opacity-30"
          aria-label={`${label}: уменьшить`}
          disabled={disabled || value <= min}
        >
          <Minus size={12} />
        </button>
        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(event) => change(Number(event.target.value))}
            className="range"
            aria-label={label}
          />
          {pins && pins.length > 0 ? (
            <div className="relative mt-0.5 h-1.5" aria-hidden="true">
              {pins
                .filter((pin) => pin >= min && pin <= max)
                .map((pin) => (
                  <span
                    key={pin}
                    title={`${pin} — стандартный размер`}
                    className="absolute top-0 h-1.5 w-0.5 rounded-full bg-copper/70"
                    style={{
                      left: `${((pin - min) / span) * 100}%`,
                      transform: "translateX(-50%)",
                    }}
                  />
                ))}
            </div>
          ) : null}
          {markStep ? (
            <RangeMarks min={min} max={max} step={markStep} />
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => change(value + step)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/12 bg-white/50 text-ink/55 transition-colors hover:bg-white disabled:opacity-30"
          aria-label={`${label}: увеличить`}
          disabled={disabled || value >= max}
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

export function ChoiceCard({
  title,
  description,
  meta,
  selected,
  disabled,
  onClick,
}: {
  title: string;
  description?: string;
  meta?: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border p-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-35 ${
        selected
          ? "border-ink bg-white shadow-[0_2px_12px_-6px_rgba(22,19,16,0.4)]"
          : "border-ink/10 bg-white/30 hover:border-ink/25 hover:bg-white/60"
      }`}
      aria-pressed={selected}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[0.72rem] font-semibold leading-snug">{title}</span>
        {meta && (
          <span className="shrink-0 text-[0.56rem] font-semibold text-ink/35">{meta}</span>
        )}
      </div>
      {description && (
        <span className="mt-1 block text-[0.6rem] leading-relaxed text-ink/42">
          {description}
        </span>
      )}
    </button>
  );
}

export function SwatchField({
  label,
  finishes,
  value,
  onChange,
}: {
  label: string;
  finishes: Finish[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = finishes.find((finish) => finish.id === value) ?? finishes[0];

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.66rem] font-medium text-ink/50">{label}</span>
        {selected && <span className="text-[0.62rem] font-semibold text-ink/60">{selected.name}</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {finishes.map((finish) => (
          <button
            key={finish.id}
            type="button"
            onClick={() => onChange(finish.id)}
            className="swatch h-8 w-8"
            data-active={finish.id === value}
            style={{ background: finish.hex, width: "2rem", height: "2rem" }}
            aria-label={`${label}: ${finish.name}`}
            aria-pressed={finish.id === value}
            title={finish.name}
          />
        ))}
      </div>
    </div>
  );
}

export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div>
        <div className="text-[0.72rem] font-semibold">{title}</div>
        {description && (
          <div className="mt-0.5 text-[0.6rem] leading-relaxed text-ink/42">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
          checked ? "bg-ink" : "bg-ink/15"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-cream shadow-sm transition-transform ${
            checked ? "translate-x-[1.1rem]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function MiniButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="flex h-7 w-7 items-center justify-center rounded-full border border-ink/12 bg-white/50 text-ink/50 transition-colors hover:bg-white hover:text-ink disabled:opacity-25"
    >
      {children}
    </button>
  );
}
