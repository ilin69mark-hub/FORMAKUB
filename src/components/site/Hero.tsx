import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, Layers3, Ruler, ShieldCheck } from "lucide-react";
import { calculatePrice, formatRub, kitchenTotalWidth } from "@/lib/configurator/pricing";
import { defaultKitchen } from "@/lib/configurator/defaults";

export function Hero() {
  const demo = defaultKitchen();
  const price = calculatePrice(demo);
  const width = Math.round(kitchenTotalWidth(demo));

  return (
    <section className="relative overflow-hidden pb-10 pt-[calc(var(--header-h)+2.4rem)] sm:pb-14 lg:min-h-[100svh] lg:pb-16 lg:pt-[calc(var(--header-h)+3.2rem)]">
      <div
        className="pointer-events-none absolute left-1/2 top-24 -z-10 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full opacity-50 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(225,165,112,0.25), transparent 62%)",
        }}
        aria-hidden
      />
      <div className="container-page">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="relative z-10 lg:col-span-6 xl:col-span-6">
            <div className="hero-enter">
              <span className="eyebrow">Мебель по индивидуальным размерам · FORMAKUB</span>
            </div>

            <h1 className="display hero-enter hero-enter-delay-1 mt-6 text-[clamp(2.1rem,10vw,4rem)] lg:text-[clamp(3rem,5.8vw,6.2rem)]">
              <span className="block">Кухня,</span>
              <span className="block">которая считается</span>
              <span className="block">
                с вашим{" "}
                <span className="text-copper">пространством.</span>
              </span>
            </h1>

            <p className="body-copy hero-enter hero-enter-delay-2 mt-9 max-w-[34rem]">
              Соберите гарнитур из модулей, настройте размеры, фасады и
              наполнение. Смотрите 2D-схему и предварительную стоимость — до
              звонка и без оплаты онлайн.
            </p>

            <div className="hero-enter hero-enter-delay-3 mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/configurator/kitchen" className="btn btn-primary">
                Создать свою кухню
                <ArrowUpRight size={16} strokeWidth={1.8} />
              </Link>
              <Link href="#projects" className="btn btn-glass">
                Посмотреть проекты
                <ArrowDown size={15} strokeWidth={1.8} />
              </Link>
            </div>

            <div className="hero-enter hero-enter-delay-4 mt-9 flex flex-wrap gap-x-6 gap-y-3">
              {[
                { icon: Ruler, label: "Размеры под помещение" },
                { icon: Layers3, label: "2D-схема сразу" },
                { icon: ShieldCheck, label: "Проверка менеджером" },
              ].map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="flex items-center gap-2 text-[0.72rem] font-medium text-ink/52"
                >
                  <Icon size={14} strokeWidth={1.6} className="text-copper" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative lg:col-span-6">
            <div className="relative ml-auto aspect-[4/5] w-full max-w-[38rem] overflow-hidden rounded-[2rem] bg-ink shadow-[0_50px_100px_-50px_rgba(22,19,16,0.6)] sm:rounded-[2.5rem] lg:max-h-[78vh]">
              <Image
                src="/images/k-marble.jpg"
                alt="Современная кухня в графитовых фасадах с каменной столешницей"
                fill
                priority
                sizes="(min-width: 1024px) 48vw, 100vw"
                className="object-cover"
                style={{ objectPosition: "center 42%" }}
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(12,10,8,0.08) 0%, rgba(12,10,8,0.05) 40%, rgba(12,10,8,0.72) 100%)",
                }}
                aria-hidden
              />

              <div className="absolute left-5 top-5 flex items-center gap-2 sm:left-6 sm:top-6">
                <span className="badge-demo badge-demo-light">demo</span>
                <span className="chip chip-dark backdrop-blur">3D-настроение</span>
              </div>

              <div className="absolute right-5 top-5 sm:right-6 sm:top-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-white/10 text-[0.62rem] font-bold tracking-[0.08em] text-cream/85 backdrop-blur">
                  2D
                </span>
              </div>

              <div className="absolute inset-x-4 bottom-4 sm:inset-x-5 sm:bottom-5">
                <div className="glass-dark rounded-[1.4rem] p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[0.58rem] font-bold uppercase tracking-[0.18em] text-cream/45">
                        Пример конфигурации
                      </div>
                      <div className="mt-1.5 font-display text-xl leading-tight text-cream sm:text-2xl">
                        Кухня «Графит»
                      </div>
                      <div className="mt-1 text-[0.68rem] text-cream/50">
                        {width} см · {demo.modules.length} модулей · кварц
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[0.58rem] uppercase tracking-[0.14em] text-cream/40">
                        Ориентир
                      </div>
                      <div className="mt-1 font-display text-xl text-cream sm:text-2xl">
                        {formatRub(price.total)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-white/12 pt-2.5">
                    <span className="text-[0.6rem] text-cream/35">
                      Демо-расчёт · не оферта
                    </span>
                    <Link
                      href="/configurator/kitchen"
                      className="inline-flex items-center gap-1 text-[0.66rem] font-semibold text-copper-bright"
                    >
                      Настроить
                      <ArrowUpRight size={11} />
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute left-4 bottom-48 hidden w-[15rem] rotate-[-4deg] overflow-hidden rounded-2xl border border-white/60 bg-cream p-2 shadow-[0_30px_60px_-30px_rgba(22,19,16,0.5)] xl:block">
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl">
                <Image
                  src="/images/k-lux.jpg"
                  alt="Деталь кухонной столешницы из камня"
                  fill
                  sizes="240px"
                  className="object-cover"
                />
              </div>
              <div className="flex items-center justify-between px-1.5 pb-1 pt-2">
                <span className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-ink/55">
                  Камень · детали
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-copper" />
              </div>
            </div>

            <div className="absolute -right-3 top-1/2 hidden -translate-y-1/2 rotate-90 text-[0.55rem] font-bold uppercase tracking-[0.32em] text-ink/35 xl:block">
              individual kitchens · 2026
            </div>
          </div>
        </div>

        <div className="mt-10 flex items-center justify-between border-t border-ink/10 pt-5 sm:mt-14">
          <div className="flex items-center gap-2 text-[0.65rem] font-medium uppercase tracking-[0.16em] text-ink/38">
            <span className="scroll-line h-8" aria-hidden />
            Листайте, чтобы увидеть процесс
          </div>
          <div className="hidden items-center gap-4 text-[0.65rem] text-ink/38 sm:flex">
            <span>Кухни · Шкафы · Гардеробные</span>
            <span className="h-1 w-1 rounded-full bg-copper/60" />
            <span>Демо-версия сайта</span>
          </div>
        </div>
      </div>
    </section>
  );
}
