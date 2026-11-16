"use client";

import { usePathname } from "next/navigation";

/**
 * Скрывает публичный Header/Footer на маршрутах Calculation Admin, чтобы
 * панель имела собственную оболочку. Другие маршруты не меняются.
 */
export function SiteChrome({
  header,
  footer,
  children,
}: {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin" || pathname?.startsWith("/admin/");

  return (
    <>
      {isAdmin ? null : header}
      {children}
      {isAdmin ? null : footer}
    </>
  );
}
