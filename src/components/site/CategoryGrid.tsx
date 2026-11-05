import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CATEGORIES } from "@/content/categories";

export function CategoryGrid() {
  return (
    <section id="categories" className="section-pad">
      <div className="container-page">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <span className="eyebrow reveal">Каталог</span>
            <h2 className="display reveal mt-5 text-[clamp(2.5rem,4.6vw,4.4rem)]">
              Сначала — кухня.
              <br />
              <span className="text-ink/48">Потом — остальное пространство.</span>
            </h2>
          </div>
          <div className="lg:col-span-4 lg:col-start-9">
            <p className="body-copy reveal">
              Начните с главного сценария — кухни. Здесь конфигуратор учитывает
              модули, технику, столешницу и фурнитуру. Для шкафов доступен
              отдельный сценарий, остальное обсуждаем индивидуально.
            </p>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:mt-14 lg:grid-cols-12 lg:grid-rows-[repeat(2,minmax(0,1fr))]">
          {CATEGORIES.map((category, index) => {
            const isKitchen = category.id === "kitchens";
            const layout = isKitchen
              ? "lg:col-span-7 lg:row-span-2 min-h-[34rem] lg:min-h-[44rem]"
              : category.id === "wardrobes" || category.id === "dressing-rooms"
                ? "lg:col-span-5 min-h-[20rem]"
                : "lg:col-span-6 min-h-[20rem]";

            return (
              <Link
                key={category.id}
                href={category.href}
                className={`group reveal relative overflow-hidden rounded-[1.6rem] bg-ink ${layout}`}
                style={{ transitionDelay: `${index * 55}ms` }}
              >
                <Image
                  src={category.image}
                  alt={category.imageAlt}
                  fill
                  sizes={
                    isKitchen
                      ? "(min-width: 1024px) 58vw, 100vw"
                      : "(min-width: 1024px) 40vw, 100vw"
                  }
                  className="object-cover transition-transform duration-[1.2s] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.045]"
                  style={{
                    objectPosition: isKitchen ? "center 52%" : "center 45%",
                  }}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background: isKitchen
                      ? "linear-gradient(180deg, rgba(10,9,8,0.04) 20%, rgba(10,9,8,0.82) 100%)"
                      : "linear-gradient(180deg, rgba(10,9,8,0.06) 15%, rgba(10,9,8,0.78) 100%)",
                  }}
                  aria-hidden
                />

                <div className="absolute inset-0 flex flex-col justify-between p-5 sm:p-7">
                  <div className="flex items-start justify-between gap-4">
                    <span className="font-display text-sm text-cream/55">
                      {category.index}
                    </span>
                    {isKitchen && (
                      <span className="badge-demo badge-demo-light">
                        основной сценарий
                      </span>
                    )}
                    {!isKitchen && category.configurable && (
                      <span className="chip chip-dark backdrop-blur">конфигуратор</span>
                    )}
                  </div>

                  <div>
                    {isKitchen && (
                      <div className="mb-4 flex flex-wrap gap-2">
                        {category.features.map((feature) => (
                          <span key={feature} className="chip chip-dark backdrop-blur">
                            {feature}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-end justify-between gap-5">
                      <div className="max-w-[34rem]">
                        <h3
                          className={`font-display leading-[1.03] text-cream ${
                            isKitchen
                              ? "text-[clamp(2.1rem,4vw,3.7rem)]"
                              : "text-[clamp(1.7rem,2.4vw,2.25rem)]"
                          }`}
                        >
                          {category.title}
                        </h3>
                        <p
                          className={`mt-2.5 leading-relaxed text-cream/62 ${
                            isKitchen
                              ? "max-w-lg text-[0.9rem]"
                              : "max-w-sm text-[0.78rem]"
                          }`}
                        >
                          {category.description}
                        </p>
                      </div>
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10 text-cream backdrop-blur transition-all duration-500 group-hover:border-copper-bright/60 group-hover:bg-copper group-hover:text-ink">
                        <ArrowUpRight size={18} strokeWidth={1.8} />
                      </span>
                    </div>
                    <div className="mt-4 flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-cream/48">
                      {category.cta}
                      <span className="h-px w-6 bg-cream/30 transition-all duration-500 group-hover:w-10 group-hover:bg-copper-bright/70" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <p className="mt-5 text-[0.68rem] leading-relaxed text-ink/38">
          Конфигуратор кухни и шкафа работает в демо-режиме. Гардеробные,
          комоды и другие решения начинаются с обсуждения задачи и проверки
          размеров помещения.
        </p>
      </div>
    </section>
  );
}
