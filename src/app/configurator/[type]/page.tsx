import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConfiguratorStudio } from "@/components/configurator/ConfiguratorStudio";
import type { FurnitureType } from "@/lib/configurator/types";

type PageProps = {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function isFurnitureType(value: string): value is FurnitureType {
  return value === "kitchen" || value === "wardrobe";
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function generateStaticParams() {
  return [{ type: "kitchen" }, { type: "wardrobe" }];
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { type } = await params;
  if (!isFurnitureType(type)) {
    return { title: "Конфигуратор", robots: { index: false, follow: false } };
  }

  const isKitchen = type === "kitchen";
  return {
    title: isKitchen
      ? "Конфигуратор кухни — соберите проект и расчёт"
      : "Конфигуратор шкафа — подберите размеры и наполнение",
    description: isKitchen
      ? "Соберите кухню из модулей: размеры, фасады, столешница, фурнитура и предварительная стоимость. Сохраните проект и отправьте заявку без онлайн-оплаты."
      : "Соберите корпусный шкаф: секции, полки, штанги, ящики, фасады и предварительный расчёт. Сохраните проект и отправьте заявку.",
    robots: { index: false, follow: false },
    alternates: { canonical: `/configurator/${type}` },
  };
}

export default async function ConfiguratorPage({
  params,
  searchParams,
}: PageProps) {
  const { type } = await params;
  if (!isFurnitureType(type)) notFound();

  const query = await searchParams;
  const project = firstValue(query.project);
  const promo = firstValue(query.promo);

  return (
    <ConfiguratorStudio
      type={type}
      initialProjectId={project && /^[a-z0-9]{8}$/.test(project) ? project : undefined}
      promo={promo?.slice(0, 32)}
    />
  );
}
