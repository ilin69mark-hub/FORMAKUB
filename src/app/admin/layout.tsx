import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { isAdminUiEnabled } from "@/lib/admin/ui-access";
import { getCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Calculation Admin",
    template: "%s — Calculation Admin",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // CA-T-602: deny-by-default; feature flag остаётся только дополнительным gate.
  const session = await getCurrentSession();
  if (!session) {
    redirect("/api/auth/login?returnTo=/admin");
  }

  if (!isAdminUiEnabled()) notFound();

  return <AdminShell>{children}</AdminShell>;
}
