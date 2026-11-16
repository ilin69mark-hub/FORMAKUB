"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Menu, Search, ShieldAlert, X } from "lucide-react";

import { Logo } from "@/components/ui/Logo";

import { ADMIN_SECTIONS, groupSections, type AdminSection } from "./navigation";

function isActive(pathname: string, section: AdminSection): boolean {
  if (section.href === "/admin") return pathname === "/admin";
  return pathname === section.href || pathname.startsWith(`${section.href}/`);
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

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

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ADMIN_SECTIONS;
    return ADMIN_SECTIONS.filter(
      (section) =>
        section.index.includes(needle) ||
        section.title.toLowerCase().includes(needle) ||
        section.description.toLowerCase().includes(needle),
    );
  }, [query]);

  const nav = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pb-6 pt-6">
        <Logo light />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-cream/70 lg:hidden"
          aria-label="Закрыть навигацию"
        >
          <X size={17} />
        </button>
      </div>

      <div className="px-5 pb-5">
        <span className="badge-demo badge-demo-light">Real data</span>
        <p className="mt-3 text-[0.68rem] leading-relaxed text-cream/45">
          Данные Calculation Admin из существующих сервисов и Storage Adapter.
        </p>
      </div>

      <label className="mx-5 mb-4 flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-3.5 py-2.5 text-cream/60">
        <Search size={14} className="shrink-0" />
        <span className="sr-only">Поиск раздела</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск раздела"
          className="w-full bg-transparent text-[0.78rem] text-cream placeholder:text-cream/35 focus:outline-none"
        />
      </label>

      <nav
        className="flex-1 space-y-4 overflow-y-auto px-3 pb-6"
        aria-label="Разделы Calculation Admin"
      >
        {groupSections(sections).map((group) => (
          <div key={group.label} className="space-y-0.5">
            <p className="px-3 pb-1 text-[0.56rem] font-bold uppercase tracking-[0.16em] text-cream/30">
              {group.label}
            </p>
            {group.sections.map((section) => {
              const active = isActive(pathname, section);
              return (
                <Link
                  key={section.id}
                  href={section.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.8rem] transition-colors ${
                    active
                      ? "bg-cream text-ink"
                      : "text-cream/62 hover:bg-white/7 hover:text-cream"
                  }`}
                >
                  <span
                    className={`font-mono text-[0.62rem] tracking-widest ${
                      active ? "text-copper" : "text-cream/30"
                    }`}
                  >
                    {section.index}
                  </span>
                  <span className="font-medium leading-snug">{section.title}</span>
                </Link>
              );
            })}
          </div>
        ))}
        {sections.length === 0 ? (
          <p className="px-3 py-6 text-[0.75rem] text-cream/40">
            Разделы не найдены.
          </p>
        ) : null}
      </nav>

      <div className="border-t border-white/10 px-5 py-5">
        <Link
          href="/"
          className="flex items-center justify-between text-[0.72rem] font-semibold text-cream/55 transition-colors hover:text-cream"
        >
          Вернуться на сайт
          <ArrowUpRight size={14} />
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-cream text-ink">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[19rem] bg-ink lg:block">
        {nav}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Закрыть навигацию"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/55 backdrop-blur-sm"
          />
          <aside className="absolute inset-y-0 left-0 w-[19rem] max-w-[86vw] bg-ink shadow-2xl">
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[19rem]">
        <header className="sticky top-0 z-30 border-b border-ink/10 bg-cream/88 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-[96rem] items-center justify-between gap-4 px-5 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink/12 bg-white/55 lg:hidden"
                aria-label="Открыть навигацию"
                aria-expanded={open}
              >
                <Menu size={18} />
              </button>
              <div className="min-w-0">
                <p className="truncate text-[0.62rem] font-bold uppercase tracking-[0.18em] text-ink/42">
                  Calculation Admin
                </p>
                <p className="truncate text-[0.82rem] font-semibold text-ink/78">
                  {ADMIN_SECTIONS.find((section) => isActive(pathname, section))
                    ?.title ?? "Раздел не найден"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-emerald-700/20 bg-emerald-600/10 px-3 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-emerald-900 sm:inline-flex">
                <ShieldAlert size={13} />
                RBAC
              </span>
              <span className="badge-demo">OIDC</span>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[96rem] px-5 pb-16 pt-6 sm:px-8">
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-copper/25 bg-copper/8 px-4 py-3 text-[0.78rem] leading-relaxed text-ink/72">
            <ShieldAlert size={17} className="mt-0.5 shrink-0 text-copper" />
            <p>
              Разделы подключены к существующим сервисам. Изменяющие операции
              проходят серверные OIDC/RBAC, same-origin и rate-limit guards;
              UI не заменяет серверные проверки.
            </p>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
