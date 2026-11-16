import type { Metadata } from "next";

import { ADMIN_SECTIONS, type AdminSectionId } from "@/components/admin/navigation";

function sectionOf(id: AdminSectionId) {
  return ADMIN_SECTIONS.find((section) => section.id === id) ?? ADMIN_SECTIONS[0];
}

export function sectionMetadata(id: AdminSectionId): Metadata {
  const section = sectionOf(id);
  return {
    title: `${section.index}. ${section.title}`,
    description: section.description,
  };
}
