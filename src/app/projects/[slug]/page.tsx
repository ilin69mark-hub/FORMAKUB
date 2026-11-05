import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Info } from "lucide-react";
import { PROJECTS } from "@/content/projects";
import { SITE } from "@/content/site";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return PROJECTS.map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = PROJECTS.find((item) => item.slug === slug);
  if (!project) return { title: "Проект не найден" };

  return {
    title: `${project.title} — демо-концепция`,
    description: project.summary,
    robots: { index: false, follow: true },
    alternates: { canonical: `/projects/${project.slug}` },
    openGraph: {
      title: `${project.title} — FORMAKUB`,
      description: project.summary,
      url: `/projects/${project.slug}`,
      images: [{ url: project.image, alt: project.imageAlt }],
    },
  };
}

export default async function ProjectPage({ params }: PageProps) {
  const { slug } = await params;
  const project = PROJECTS.find((item) => item.slug === slug);
  if (!project) notFound();

  const related = PROJECTS.filter(
    (item) => item.slug !== project.slug && item.category === project.category,
  )
    .concat(PROJECTS.filter((item) => item.slug !== project.slug))
    .filter((item, index, array) => array.findIndex((entry) => entry.slug === item.slug) === index)
    .slice(0, 2);

  const configHref =
    project.categoryId === "kitchens"
      ? "/configurator/kitchen"
      : project.categoryId === "wardrobes"
        ? "/configurator/wardrobe"
        : "/#lead";

  const gallery = project.gallery.filter(
    (image) => image.src !== project.image,
  );

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Главная", item: SITE.url },
      {
        "@type": "ListItem",
        position: 2,
        name: "Проекты",
        item: `${SITE.url}/#projects`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: project.title,
        item: `${SITE.url}/projects/${project.slug}`,
      },
    ],
  };

  return (
    <div className="pb-20 pt-[calc(var(--header-h)+2rem)]">
      <div className="container-page">
        <Link
          href="/#projects"
          className="inline-flex items-center gap-1.5 text-[0.68rem] font-semibold text-ink/45 transition-colors hover:text-ink"
        >
          <ArrowLeft size={13} />
          Все концепции
        </Link>

        <div className="mt-6 grid gap-7 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip">{project.category}</span>
              <span className="badge-demo">демо-концепция</span>
            </div>
            <h1 className="display mt-5 text-[clamp(2.6rem,5.2vw,4.8rem)]">
              {project.title}
            </h1>
          </div>
          <div className="lg:col-span-4 lg:col-start-9">
            <p className="body-copy">{project.summary}</p>
          </div>
        </div>

        <div className="relative mt-8 aspect-[4/3] overflow-hidden rounded-[1.6rem] bg-ink sm:aspect-[16/9]">
          <Image
            src={project.image}
            alt={project.imageAlt}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/45 via-transparent to-transparent" />
          <div className="absolute bottom-4 left-4 flex items-center gap-2">
            <span className="badge-demo badge-demo-light">demo</span>
            <span className="chip chip-dark backdrop-blur">визуализация концепции</span>
          </div>
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-ink/10 py-5 sm:grid-cols-4">
              {project.details.map((detail) => (
                <div key={detail.label}>
                  <div className="text-[0.54rem] font-bold uppercase tracking-[0.14em] text-ink/32">
                    {detail.label}
                  </div>
                  <div className="mt-1 text-[0.72rem] font-semibold leading-snug text-ink/68">
                    {detail.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8">
              <h2 className="font-display text-2xl">О концепции</h2>
              <p className="mt-3 text-[0.85rem] leading-relaxed text-ink/58">
                {project.description}
              </p>
            </div>

            <div className="mt-8">
              <h2 className="font-display text-2xl">Решения</h2>
              <ul className="mt-4 space-y-3">
                {project.solutions.map((solution, index) => (
                  <li key={solution} className="flex gap-3 text-[0.82rem] leading-relaxed text-ink/58">
                    <span className="font-display text-[0.7rem] text-copper">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {solution}
                  </li>
                ))}
              </ul>
            </div>

            {gallery.length > 0 && (
              <div className="mt-10">
                <h2 className="font-display text-2xl">Детали</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {gallery.map((image) => (
                    <div
                      key={image.src + image.alt}
                      className="relative aspect-[4/3] overflow-hidden rounded-[1.2rem] bg-ink"
                    >
                      <Image
                        src={image.src}
                        alt={image.alt}
                        fill
                        sizes="(min-width: 640px) 40vw, 100vw"
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="lg:col-span-4 lg:col-start-9">
            <div className="rounded-[1.5rem] border border-ink/10 bg-white/45 p-5 lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
              <span className="eyebrow">Хотите похожий сценарий?</span>
              <h2 className="mt-3 font-display text-[1.8rem] leading-tight">
                Соберите свою версию
              </h2>
              <p className="mt-2 text-[0.76rem] leading-relaxed text-ink/48">
                Начните с конфигуратора или опишите задачу в заявке. Размеры и
                материалы проверим отдельно — после замера.
              </p>
              <Link href={configHref} className="btn btn-primary mt-5 w-full">
                {project.categoryId === "kitchens"
                  ? "Собрать кухню"
                  : project.categoryId === "wardrobes"
                    ? "Собрать шкаф"
                    : "Обсудить проект"}
                <ArrowUpRight size={15} />
              </Link>
              <Link href="/#lead" className="btn btn-glass btn-sm mt-2 w-full">
                Оставить заявку
              </Link>

              <div className="mt-5 flex items-start gap-2 rounded-xl border border-copper/20 bg-copper/[0.05] px-3 py-2.5 text-[0.62rem] leading-relaxed text-ink/48">
                <Info size={12} className="mt-0.5 shrink-0 text-copper" />
                Это демонстрационная концепция, а не подтверждённый реализованный
                проект. Фотографии используются как визуальный референс.
              </div>
            </div>
          </aside>
        </div>

        {related.length > 0 && (
          <div className="mt-16 border-t border-ink/10 pt-8">
            <div className="flex items-end justify-between">
              <h2 className="font-display text-2xl">Смотрите также</h2>
              <Link href="/#projects" className="link-line text-[0.68rem]">
                Все концепции
                <ArrowUpRight size={12} />
              </Link>
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              {related.map((item) => (
                <Link key={item.slug} href={`/projects/${item.slug}`} className="group">
                  <div className="image-zoom relative aspect-[16/10] overflow-hidden rounded-[1.2rem] bg-ink">
                    <Image
                      src={item.image}
                      alt={item.imageAlt}
                      fill
                      sizes="(min-width: 640px) 45vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <h3 className="font-display text-xl transition-colors group-hover:text-copper">
                      {item.title}
                    </h3>
                    <ArrowUpRight size={16} className="text-ink/30" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
        />
      </div>
    </div>
  );
}
