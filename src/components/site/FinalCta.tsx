import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Phone } from "lucide-react";
import { SITE } from "@/content/site";
import { LeadForm } from "@/components/site/LeadForm";

const STEPS = [
  "Оставьте заявку — конфигурация приложится сама",
  "Менеджер уточнит размеры и задачу",
  "Подготовим предложение без онлайн-оплаты",
];

export function FinalCta() {
  return (
    <section id="lead" className="section-pad">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-[2rem] bg-ink text-cream sm:rounded-[2.6rem]">
          <Image
            src="/images/k-dark.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover opacity-20"
            style={{ objectPosition: "center 60%" }}
            aria-hidden
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(115deg, rgba(10,9,8,0.96) 0%, rgba(10,9,8,0.82) 48%, rgba(10,9,8,0.45) 100%)",
            }}
            aria-hidden
          />

          <div className="relative grid lg:grid-cols-12">
            <div className="px-5 pb-3 pt-8 sm:px-8 sm:pt-10 lg:col-span-5 lg:flex lg:flex-col lg:justify-center lg:py-14 lg:pl-10">
              <span className="eyebrow eyebrow-light reveal">Финальный шаг</span>
              <h2 className="display reveal mt-5 text-[clamp(2.4rem,4.2vw,3.9rem)]">
                Соберите основу.
                <br />
                <span className="text-cream/42">Остальное — вместе.</span>
              </h2>
              <p className="body-copy body-copy-light reveal mt-5 max-w-md">
                Не нужно заранее знать все термины и точные размеры. Достаточно
                задачи — а конфигурация, если вы её начали, приложится к
                заявке автоматически.
              </p>

              <ol className="mt-7 space-y-3">
                {STEPS.map((step, index) => (
                  <li key={step} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/6 font-display text-[0.62rem] text-copper-bright">
                      {index + 1}
                    </span>
                    <span className="text-[0.76rem] leading-relaxed text-cream/55">
                      {step}
                    </span>
                  </li>
                ))}
              </ol>

              <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
                {SITE.contacts.phone && (
                  <a
                    href={`tel:${SITE.contacts.phone.replace(/[^\d+]/g, "")}`}
                    className="inline-flex items-center gap-2 text-[0.78rem] text-cream/70 transition-colors hover:text-copper-bright"
                  >
                    <Phone size={14} />
                    {SITE.contacts.phone}
                  </a>
                )}
                {!SITE.contacts.phone && (
                  <span className="text-[0.68rem] text-cream/35">
                    Телефон будет опубликован после подтверждения контактов.
                  </span>
                )}
                <Link
                  href="/payment-delivery"
                  className="link-line text-[0.68rem] text-cream/50"
                >
                  Оплата и доставка
                  <ArrowUpRight size={12} />
                </Link>
              </div>

              <p className="mt-4 text-[0.62rem] leading-relaxed text-cream/28">
                Заявка не является заказом и не создаёт финансовых
                обязательств. Персональные данные обрабатываются по согласию,
                указанному в форме.
              </p>
            </div>

            <div className="p-2.5 sm:p-4 lg:col-span-7 lg:py-4 lg:pr-4">
              <div className="rounded-[1.4rem] bg-[#f7f2ea] p-5 text-ink sm:p-7">
                <LeadForm
                  autoAttachDraft
                  source="home-final"
                  submitLabel="Отправить заявку"
                  hideIntro
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
