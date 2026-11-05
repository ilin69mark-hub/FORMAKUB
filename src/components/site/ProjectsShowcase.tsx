"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Info } from "lucide-react";
import { PROJECTS, PROJECT_CATEGORIES } from "@/content/projects";

export function ProjectsShowcase() {
  const [filter, setFilter] = useState<(typeof PROJECT_CATEGORIES)[number]>("Все");

  const filtered = useMemo(
    () =>
      filter === "Все"
        ? PROJECTS
        : PROJECTS.filter((project) => project.category === filter),
    [filter],
  );

  return (
    <section id="projects" className="section-pad">
      <div className="container-page">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow reveal">Проекты</span>
              <span className="badge-demo">демо-концепции</span>
            </div>
            <h2 className="display reveal mt-5 text-[clamp(2.5rem,4.6vw,4.3rem)]">
              Идеи, которые можно
              <br />
              <span className="text-ink/45">примерить к себе.</span>
            </h2>
          </div>
          <div className="lg:col-span-4 lg:col-start-9">
            <p className="body-copy reveal">
              Пока это демонстрационные концепции, а не подтверждённое
              портфолио. Реальные проекты, размеры и материалы будут
              опубликованы только после согласования с клиентами.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-2">
          {PROJECT_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setFilter(category)}
              className={`rounded-full border px-3.5 py-2 text-[0.68rem] font-semibold transition-all ${
                filter === category
                  ? "border-ink bg-ink text-cream"
                  : "border-ink/12 bg-white/35 text-ink/55 hover:border-ink/25 hover:bg-white/60"
              }`}
              aria-pressed={filter === category}
            >
              {category}
            </button>
          ))}
          <span className="ml-auto hidden text-[0.66rem] text-ink/38 sm:block">
            {filtered.length} {filtered.length === 1 ? "концепция" : "концепции"}
          </span>
        </div>

        <div className="mt-6 grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project, index) => {
            const wide = filter === "Все" && index === 0;
            return (
              <Link
                key={project.slug}
                href={`/projects/${project.slug}`}
                className={`group reveal block ${wide ? "sm:col-span-2 lg:col-span-2" : ""}`}
                style={{ transitionDelay: `${index * 45}ms` }}
              >
                <div
                  className={`image-zoom relative overflow-hidden rounded-[1.4rem] bg-ink ${
                    wide ? "aspect-[16/10] sm:aspect-[2/1]" : "aspect-[4/5]"
                  }`}
                >
                  <Image
                    src={project.image}
                    alt={project.imageAlt}
                    fill
                    sizes={
                      wide
                        ? "(min-width: 1024px) 66vw, 100vw"
                        : "(min-width: 640px) 50vw, 100vw"
                    }
                    className="object-cover"
                    style={{ objectPosition: wide ? "center 48%" : "center 45%" }}
                  />
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(10,9,8,0.02) 45%, rgba(10,9,8,0.5) 100%)",
                    }}
                    aria-hidden
                  />
                  <div className="absolute left-3 top-3 flex gap-1.5">
                    <span className="chip chip-dark backdrop-blur">{project.category}</span>
                    <span className="badge-demo badge-demo-light">demo</span>
                  </div>
                  <span className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-white/10 text-cream backdrop-blur transition-all duration-500 group-hover:bg-copper group-hover:text-ink">
                    <ArrowUpRight size={17} />
                  </span>
                </div>

                <div className="mt-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-display text-[1.35rem] leading-snug transition-colors group-hover:text-copper">
                      {project.title}
                    </h3>
                    <p className="mt-1.5 max-w-md text-[0.77rem] leading-relaxed text-ink/50">
                      {project.summary}
                    </p>
                  </div>
                  <span className="mt-1 font-display text-[0.7rem] text-ink/28">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink/8 pt-2.5 text-[0.64rem] text-ink/38">
                  {project.details.slice(0, 2).map((detail) => (
                    <span key={detail.label}>
                      {detail.label}: <span className="text-ink/58">{detail.value}</span>
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}

          {filter === "Все" && (
            <Link
              href="/#lead"
              className="group reveal relative flex min-h-[20rem] flex-col justify-center overflow-hidden rounded-[1.4rem] bg-ink p-6 text-cream sm:col-span-2 sm:min-h-[22rem] sm:p-8 lg:col-span-2"
              style={{ transitionDelay: `${filtered.length * 45}ms` }}
            >
              <div
                className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full opacity-50 blur-3xl"
                style={{
                  background:
                    "radial-gradient(circle, rgba(225,165,112,0.45), transparent 65%)",
                }}
                aria-hidden
              />
              <span className="absolute right-6 top-6 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10 text-cream backdrop-blur transition-all duration-500 group-hover:border-copper-bright/60 group-hover:bg-copper group-hover:text-ink sm:right-8 sm:top-8">
                <ArrowUpRight size={17} />
              </span>
              <div className="relative max-w-xl pr-14">
                <span className="badge-demo badge-demo-light">07 · ваш проект</span>
                <h3 className="mt-5 font-display text-[clamp(2rem,3.2vw,3.1rem)] leading-[1.04]">
                  Следующий проект — ваш.
                </h3>
                <p className="mt-3 text-[0.8rem] leading-relaxed text-cream/58">
                  Соберите кухню или шкаф в конфигураторе либо оставьте заявку:
                  менеджер уточнит размеры, материалы и технические условия.
                </p>
                <span className="mt-6 inline-flex items-center gap-1.5 text-[0.7rem] font-semibold text-copper-bright">
                  Обсудить задачу
                  <span className="h-px w-6 bg-copper-bright/60 transition-all duration-500 group-hover:w-10" />
                </span>
              </div>
            </Link>
          )}
        </div>

        <div className="reveal mt-10 flex items-start gap-2.5 rounded-2xl border border-copper/20 bg-copper/[0.06] px-4 py-3 text-[0.69rem] leading-relaxed text-ink/55">
          <Info size={14} className="mt-0.5 shrink-0 text-copper" />
          <p>
            Концепции созданы для демонстрации подхода. Они не являются
            фотографиями реализованных объектов FORMAKUB. После согласования
            владелец сможет заменить их подтверждённым портфолио.
          </p>
        </div>
      </div>
    </section>
  );
}
