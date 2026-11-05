import { AlertCircle, Check, Info } from "lucide-react";
import type { PriceBreakdown } from "@/lib/configurator/types";
import { formatRange, formatRub } from "@/lib/configurator/pricing";

export function PriceSummary({
  price,
  compact = false,
  dark = false,
}: {
  price: PriceBreakdown;
  compact?: boolean;
  dark?: boolean;
}) {
  const textMuted = dark ? "text-cream/55" : "text-ink/52";
  const textStrong = dark ? "text-cream" : "text-ink";
  const divider = dark ? "border-white/12" : "border-ink/10";

  if (compact) {
    return (
      <div>
        <div className={`text-[0.64rem] font-bold uppercase tracking-[0.18em] ${textMuted}`}>
          Ориентировочно
        </div>
        <div className={`mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 ${textStrong}`}>
          <span className="font-display text-[1.9rem] leading-none">
            {formatRub(price.total)}
          </span>
          {price.discount > 0 && (
            <span className="text-[0.68rem] text-copper-bright">
              −{formatRub(price.discount)}
            </span>
          )}
        </div>
        <div className={`mt-2 text-[0.64rem] leading-relaxed ${textMuted}`}>
          Диапазон {formatRange(price.total)} · не оферта
        </div>
      </div>
    );
  }

  return (
    <div>
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className={`text-[0.58rem] font-bold uppercase tracking-[0.16em] ${textMuted}`}>
            Предварительная стоимость
          </div>
          <div className="badge-demo badge-demo-light shrink-0">demo</div>
        </div>
        <div className={`mt-1 whitespace-nowrap font-display text-[1.45rem] leading-none tabular-nums ${textStrong}`}>
          {formatRub(price.total)}
        </div>
        <div className={`mt-1 text-[0.62rem] leading-relaxed ${textMuted}`}>
          Ориентир ±10%: {formatRange(price.total)}
        </div>
      </div>

      {price.discount > 0 && (
        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-2.5 py-1.5 text-[0.66rem]">
          <span className="flex items-center gap-1.5 text-emerald-700">
            <Check size={12} />
            Промокод {price.promo?.code}
          </span>
          <span className="font-semibold text-emerald-800">
            −{formatRub(price.discount)}
          </span>
        </div>
      )}

      {price.promo && !price.promo.valid && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-600/20 bg-amber-500/8 px-2.5 py-1.5 text-[0.66rem] leading-relaxed text-amber-800">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{price.promo.reason}</span>
        </div>
      )}

      <details className={`group mt-2.5 border-t ${divider} pt-2.5`}>
        <summary className={`flex cursor-pointer list-none items-center justify-between text-[0.66rem] font-semibold ${textMuted}`}>
          Из чего складывается расчёт
          <span className="transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="mt-2.5 space-y-2">
          {price.lines.map((line) => (
            <div key={line.label} className="flex items-start justify-between gap-3">
              <div>
                <div className={`text-[0.68rem] font-semibold ${textStrong}`}>
                  {line.label}
                </div>
                {line.detail && (
                  <div className={`text-[0.6rem] ${textMuted}`}>{line.detail}</div>
                )}
              </div>
              <span className={`whitespace-nowrap text-[0.66rem] tabular-nums ${textMuted}`}>
                {line.amount > 0 ? formatRub(line.amount) : "—"}
              </span>
            </div>
          ))}
          <div className={`flex items-center justify-between border-t ${divider} pt-2 text-[0.68rem]`}>
            <span className={textMuted}>Итого до скидки</span>
            <span className={`tabular-nums ${textStrong}`}>{formatRub(price.subtotal)}</span>
          </div>
        </div>
      </details>

      <p className={`mt-2.5 flex items-start gap-1.5 text-[0.6rem] leading-relaxed ${textMuted}`}>
        <Info size={11} className="mt-0.5 shrink-0" />
        {price.disclaimer}
      </p>
    </div>
  );
}
