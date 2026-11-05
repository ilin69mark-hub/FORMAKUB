import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { SITE } from "@/content/site";

const CATEGORY_LINKS = [
  { label: "Кухни на заказ", href: "/configurator/kitchen" },
  { label: "Шкафы", href: "/configurator/wardrobe" },
  { label: "Гардеробные", href: "/#categories" },
  { label: "Комоды и тумбы", href: "/#categories" },
  { label: "Другая мебель", href: "/#lead" },
];

const SITE_LINKS = [
  { label: "Проекты", href: "/#projects" },
  { label: "Как это работает", href: "/#process" },
  { label: "Вопросы и ответы", href: "/#faq" },
  { label: "Оплата и доставка", href: "/payment-delivery" },
  { label: "Политика данных", href: "/privacy" },
];

export function Footer() {
  const hasContacts = Boolean(
    SITE.contacts.phone || SITE.contacts.email || SITE.contacts.address,
  );

  return (
    <footer id="footer" className="relative overflow-hidden bg-ink text-cream">
      <div
        className="pointer-events-none absolute -right-40 top-0 h-[34rem] w-[34rem] rounded-full opacity-30 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(225,165,112,0.35), transparent 65%)",
        }}
        aria-hidden
      />
      <div className="container-page relative z-10 pb-10 pt-16 sm:pt-20">
        <div className="grid gap-12 border-b border-white/12 pb-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Logo light />
            <p className="mt-6 max-w-sm text-[0.92rem] leading-relaxed text-cream/55">
              Кухни, шкафы и корпусная мебель по индивидуальным размерам.
              Соберите конфигурацию, посмотрите схему и получите ориентир по
              стоимости до разговора с менеджером.
            </p>
            <Link
              href="/configurator/kitchen"
              className="btn btn-glass-dark btn-sm mt-7"
            >
              Собрать кухню
              <ArrowUpRight size={14} />
            </Link>
          </div>

          <div className="lg:col-span-2">
            <h2 className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-cream/35">
              Категории
            </h2>
            <ul className="mt-5 space-y-3">
              {CATEGORY_LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-[0.82rem] text-cream/62 transition-colors hover:text-cream"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-2">
            <h2 className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-cream/35">
              Сайт
            </h2>
            <ul className="mt-5 space-y-3">
              {SITE_LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-[0.82rem] text-cream/62 transition-colors hover:text-cream"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-3">
            <h2 className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-cream/35">
              Связаться
            </h2>
            {hasContacts ? (
              <ul className="mt-5 space-y-3 text-[0.82rem] text-cream/62">
                {SITE.contacts.phone && (
                  <li>
                    <a href={`tel:${SITE.contacts.phone.replace(/[^\d+]/g, "")}`}>
                      {SITE.contacts.phone}
                    </a>
                  </li>
                )}
                {SITE.contacts.email && (
                  <li>
                    <a href={`mailto:${SITE.contacts.email}`}>{SITE.contacts.email}</a>
                  </li>
                )}
                {SITE.contacts.address && <li>{SITE.contacts.address}</li>}
              </ul>
            ) : (
              <p className="mt-5 text-[0.8rem] leading-relaxed text-cream/45">
                Контактные данные появятся после согласования с владельцем
                бизнеса. Оставьте заявку — ответим удобным способом.
              </p>
            )}
            <Link
              href="/#lead"
              className="mt-5 inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-copper-bright underline decoration-copper/40 underline-offset-4 transition-colors hover:text-cream"
            >
              Оставить заявку
              <ArrowUpRight size={13} />
            </Link>
            <p className="mt-5 text-[0.68rem] leading-relaxed text-cream/35">
              {SITE.workingHours}. Условия работы, оплаты и доставки требуют
              подтверждения.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 pt-6 text-[0.65rem] leading-relaxed text-cream/34 md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.name}. Демонстрационная версия
            сайта.
          </p>
          <p className="max-w-2xl md:text-right">
            Цены, проекты и отзывы в демо-режиме не являются публичной офертой.
            Юридические реквизиты и контакты должны быть добавлены после
            согласования.
          </p>
        </div>
      </div>
    </footer>
  );
}
