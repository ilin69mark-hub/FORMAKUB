"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { FAQ_ITEMS } from "@/content/faq";

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="section-pad">
      <div className="container-page">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="lg:sticky lg:top-28">
              <span className="eyebrow reveal">Вопросы</span>
              <h2 className="display reveal mt-5 text-[clamp(2.4rem,4vw,3.5rem)]">
                До того,
                <br />
                <span className="text-ink/45">как начать.</span>
              </h2>
              <p className="body-copy reveal mt-5 max-w-sm">
                Собрали то, что чаще всего уточняют перед заявкой. Если
                ответа нет — опишите задачу в форме, мы разберёмся вместе.
              </p>
              <Link href="/#lead" className="link-line reveal mt-6">
                Задать свой вопрос
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>

          <div className="lg:col-span-7 lg:col-start-6">
            <div className="border-t border-ink/12">
              {FAQ_ITEMS.map((item, index) => {
                const isOpen = open === index;
                const panelId = `faq-panel-${index}`;
                const buttonId = `faq-button-${index}`;
                return (
                  <div key={item.q} className="border-b border-ink/12">
                    <h3>
                      <button
                        id={buttonId}
                        type="button"
                        onClick={() => setOpen(isOpen ? null : index)}
                        className="flex w-full items-center justify-between gap-5 py-5 text-left"
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                      >
                        <span
                          className={`text-[0.9rem] font-semibold leading-snug transition-colors sm:text-[0.96rem] ${
                            isOpen ? "text-ink" : "text-ink/68"
                          }`}
                        >
                          {item.q}
                        </span>
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all duration-400 ${
                            isOpen
                              ? "rotate-45 border-ink bg-ink text-cream"
                              : "border-ink/15 text-ink/45"
                          }`}
                        >
                          <Plus size={13} />
                        </span>
                      </button>
                    </h3>
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={buttonId}
                      className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                      }`}
                    >
                      <div className="overflow-hidden">
                        <p className="max-w-2xl pb-5 pr-8 text-[0.8rem] leading-relaxed text-ink/52">
                          {item.a}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-5 text-[0.66rem] leading-relaxed text-ink/35">
              Ответы носят информационный характер и не являются публичной
              офертой. Условия конкретного заказа фиксируются отдельно.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
