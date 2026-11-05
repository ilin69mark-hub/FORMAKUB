"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { NAV_LINKS, SITE } from "@/content/site";
import { Logo } from "@/components/ui/Logo";

export function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 18);
      const height =
        document.documentElement.scrollHeight - window.innerHeight;
      setProgress(height > 0 ? Math.min(1, window.scrollY / height) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onConfigurator = pathname.startsWith("/configurator");

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
          scrolled || open || onConfigurator
            ? "border-b border-white/50 bg-cream/75 shadow-[0_18px_50px_-40px_rgba(22,19,16,0.7)] backdrop-blur-2xl"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <div
          className="container-page flex items-center justify-between"
          style={{ height: "var(--header-h)" }}
        >
          <Logo />

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Основная навигация">
            {NAV_LINKS.slice(0, 5).map((link) => (
              <Link
                key={`${link.href}-${link.label}`}
                href={link.href}
                className={`rounded-full px-3.5 py-2 text-[0.76rem] font-semibold transition-colors hover:bg-white/50 ${
                  pathname === link.href ? "bg-white/60" : "text-ink/68"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2.5">
            {SITE.contacts.phone ? (
              <a
                href={`tel:${SITE.contacts.phone.replace(/[^\d+]/g, "")}`}
                className="hidden text-[0.76rem] font-semibold text-ink/72 transition-colors hover:text-ink xl:block"
              >
                {SITE.contacts.phone}
              </a>
            ) : null}
            <Link
              href="/configurator/kitchen"
              className="btn btn-primary btn-sm hidden sm:inline-flex"
            >
              Собрать кухню
              <ArrowUpRight size={14} strokeWidth={1.8} />
            </Link>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-ink/10 bg-white/40 backdrop-blur lg:hidden"
              aria-expanded={open}
              aria-controls="mobile-navigation"
              aria-label={open ? "Закрыть меню" : "Открыть меню"}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        <div
          className="h-px origin-left bg-copper/70 transition-transform duration-150"
          style={{ transform: `scaleX(${progress})` }}
          aria-hidden
        />
      </header>

      {open && (
        <div
          id="mobile-navigation"
          className="fixed inset-0 z-40 bg-cream/97 pt-[var(--header-h)] backdrop-blur-2xl lg:hidden"
        >
          <nav
            className="container-page flex h-full flex-col justify-between pb-10 pt-8"
            aria-label="Мобильная навигация"
          >
            <div className="flex flex-col">
              {NAV_LINKS.map((link, index) => (
                <Link
                  key={`${link.href}-${link.label}`}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="group flex items-center justify-between border-b border-ink/10 py-4"
                >
                  <span className="flex items-baseline gap-4">
                    <span className="font-display text-xs text-copper">
                      0{index + 1}
                    </span>
                    <span className="font-display text-3xl tracking-tight">
                      {link.label}
                    </span>
                  </span>
                  <ArrowUpRight
                    size={18}
                    className="text-ink/35 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  />
                </Link>
              ))}
            </div>
            <div className="space-y-4">
              <Link
                href="/configurator/kitchen"
                onClick={() => setOpen(false)}
                className="btn btn-primary w-full"
              >
                Собрать кухню
                <ArrowUpRight size={16} />
              </Link>
              <p className="text-center text-[0.7rem] text-ink/45">
                Демо-версия · предварительный расчёт
              </p>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
