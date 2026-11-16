import type { Metadata } from "next";

import { ADMIN_SECTIONS } from "@/components/admin/navigation";

import { OverviewScreen } from "./_components/screens";

const section = ADMIN_SECTIONS[0];

export const metadata: Metadata = {
  title: `${section.index}. ${section.title}`,
  description: section.description,
};

export default function AdminOverviewPage() {
  return <OverviewScreen />;
}
