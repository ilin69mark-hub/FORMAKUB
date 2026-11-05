function clamp(value: number, min = 0, max = 255): number {
  return Math.min(max, Math.max(min, value));
}

export function shade(hex: string, percent: number): string {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return hex;
  const numeric = Number.parseInt(normalized, 16);
  if (Number.isNaN(numeric)) return hex;
  const r = clamp(((numeric >> 16) & 255) + percent);
  const g = clamp(((numeric >> 8) & 255) + percent);
  const b = clamp((numeric & 255) + percent);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return hex;
  const numeric = Number.parseInt(normalized, 16);
  if (Number.isNaN(numeric)) return hex;
  return `rgba(${(numeric >> 16) & 255}, ${(numeric >> 8) & 255}, ${numeric & 255}, ${alpha})`;
}
