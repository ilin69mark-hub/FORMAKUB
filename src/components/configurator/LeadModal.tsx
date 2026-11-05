"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { FurnitureConfig } from "@/lib/configurator/types";
import { LeadForm } from "@/components/site/LeadForm";

export function LeadModal({
  open,
  config,
  onClose,
}: {
  open: boolean;
  config: FurnitureConfig;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => closeRef.current?.focus(), 40);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-ink/62 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-modal-title"
        className="max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-t-[1.6rem] bg-[#f7f2ea] p-5 shadow-2xl sm:rounded-[1.6rem] sm:p-7"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="eyebrow">Заявка</span>
              <span className="badge-demo">конфигурация приложена</span>
            </div>
            <h2 id="lead-modal-title" className="mt-2 font-display text-2xl leading-tight">
              Обсудим ваш проект
            </h2>
            <p className="mt-1.5 text-[0.7rem] leading-relaxed text-ink/45">
              Проверим размеры, материалы и технические условия. Онлайн-оплата
              не потребуется.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/12 bg-white/50 text-ink/55 transition-colors hover:bg-white hover:text-ink"
            aria-label="Закрыть форму заявки"
          >
            <X size={16} />
          </button>
        </div>
        <LeadForm
          initialConfig={config}
          source={`configurator-${config.kind}`}
          submitLabel="Отправить заявку"
          hideIntro
        />
      </div>
    </div>
  );
}
