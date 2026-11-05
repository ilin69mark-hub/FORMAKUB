"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Check, Copy, Tag } from "lucide-react";
import { PROMOS } from "@/content/pricing";
import { formatRub } from "@/lib/configurator/pricing";

export function PromotionsSection() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard can be unavailable; the code remains selectable on screen.
    }
    setCopied(code);
  };

  return (
    <section id="promotions" className="section-pad">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-[2rem] bg-ink p-5 text-cream sm:rounded-[2.6rem] sm:p-9 lg:p-12">
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full opacity-30 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, rgba(225,165,112,0.55), transparent 70%)",
            }}
            aria-hidden
          />

          <div className="relative grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow eyebrow-light reveal">Предложения</span>
                <span className="badge-demo badge-demo-light">демо-условия</span>
              </div>
              <h2 className="display reveal mt-5 text-[clamp(2.4rem,4.2vw,3.9rem)]">
                Понятные условия
                <br />
                <span className="text-cream/42">без обратного отсчёта.</span>
              </h2>
            </div>
            <div className="lg:col-span-4 lg:col-start-9">
              <p className="body-copy body-copy-light reveal">
                Промокоды ниже — демонстрационные. Они помогают проверить
                логику расчёта, но не являются публичной офертой и могут быть
                изменены владельцем бизнеса.
              </p>
            </div>
          </div>

          <div className="relative mt-9 grid gap-3 md:grid-cols-3">
            {PROMOS.map((promo, index) => {
              const destination = promo.appliesTo === "all" ? "kitchen" : promo.appliesTo[0];
              const max =
                promo.maxDiscount != null
                  ? ` · максимум ${formatRub(promo.maxDiscount)}`
                  : "";
              return (
                <article
                  key={promo.code}
                  className={`reveal flex flex-col justify-between rounded-[1.3rem] border p-5 ${
                    index === 0
                      ? "border-copper/40 bg-copper/[0.09]"
                      : "border-white/10 bg-white/[0.04]"
                  }`}
                  style={{ transitionDelay: `${index * 50}ms` }}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/6 text-copper-bright">
                        <Tag size={14} strokeWidth={1.7} />
                      </span>
                      <span className="font-display text-xs text-cream/22">
                        0{index + 1}
                      </span>
                    </div>
                    <h3 className="mt-5 font-display text-[1.45rem] leading-tight">
                      {promo.title}
                    </h3>
                    <p className="mt-2 text-[0.75rem] leading-relaxed text-cream/48">
                      {promo.description}
                    </p>
                  </div>

                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={() => copy(promo.code)}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-white/22 bg-black/15 px-3.5 py-3 text-left transition-colors hover:border-copper/55"
                      aria-label={`Скопировать промокод ${promo.code}`}
                    >
                      <span className="text-[0.78rem] font-bold tracking-[0.18em]">
                        {promo.code}
                      </span>
                      <span className="flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-cream/45">
                        {copied === promo.code ? (
                          <>
                            <Check size={12} className="text-emerald-300" />
                            Скопировано
                          </>
                        ) : (
                          <>
                            <Copy size={12} />
                            Копировать
                          </>
                        )}
                      </span>
                    </button>
                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      <span className="text-[0.6rem] leading-relaxed text-cream/36">
                        от {formatRub(promo.minSubtotal)}
                        {max}
                      </span>
                      <Link
                        href={`/configurator/${destination}?promo=${promo.code}`}
                        className="link-line shrink-0 text-[0.66rem] text-copper-bright"
                      >
                        Применить
                        <ArrowUpRight size={12} />
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <p className="relative mt-6 max-w-3xl text-[0.66rem] leading-relaxed text-cream/32">
            Демонстрационные промокоды действуют только в рамках расчёта на
            этом сайте. Итоговая скидка и право на её применение подтверждаются
            менеджером вместе с коммерческим предложением.
          </p>
        </div>
      </div>
    </section>
  );
}
