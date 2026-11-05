import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  ClipboardCheck,
  Info,
  Ruler,
  Truck,
  Wallet,
} from "lucide-react";
import { PRICE_DISCLAIMER } from "@/lib/configurator/pricing";
import { LEGAL_NOTICE, SITE } from "@/content/site";

export const metadata: Metadata = {
  title: "Оплата и доставка",
  description:
    "Как формируется стоимость проекта FORMAKUB, что происходит после заявки и какие условия оплаты, доставки и монтажа ещё требуют подтверждения.",
  alternates: { canonical: "/payment-delivery" },
};

const STEPS = [
  {
    n: "01",
    title: "Предварительный расчёт",
    text: "Конфигуратор складывает ориентир из модулей, размеров, материалов, наполнения и фурнитуры. Это не оферта и не финальная смета.",
  },
  {
    n: "02",
    title: "Проверка задачи",
    text: "Менеджер уточняет размеры помещения, технику, коммуникации и особенности монтажа. При необходимости обсуждается замер.",
  },
  {
    n: "03",
    title: "Коммерческое предложение",
    text: "Финальные состав, стоимость и условия фиксируются в отдельном предложении. До его подтверждения заказ не считается оформленным.",
  },
];

const STATUS = [
  { label: "Стоимость", value: "после проверки", icon: ClipboardCheck },
  { label: "Оплата", value: "уточняется", icon: Wallet },
  { label: "Доставка", value: "уточняется", icon: Truck },
  { label: "Монтаж", value: "уточняется", icon: Ruler },
];

export default function PaymentDeliveryPage() {
  return (
    <div className="pb-20 pt-[calc(var(--header-h)+2rem)]">
      <div className="container-page">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[0.68rem] font-semibold text-ink/45 transition-colors hover:text-ink"
        >
          <ArrowLeft size={13} />
          На главную
        </Link>

        <div className="mt-6 max-w-4xl">
          <span className="eyebrow">Условия</span>
          <h1 className="display mt-5 text-[clamp(2.8rem,6vw,5.2rem)]">
            Оплата и доставка
            <br />
            <span className="text-ink/42">без неподтверждённых обещаний.</span>
          </h1>
          <p className="body-copy mt-6 max-w-2xl">
            На этом этапе сайт показывает предварительный расчёт и собирает
            заявки. Порядок оплаты, география доставки и стоимость монтажа ещё
            должны быть подтверждены владельцем бизнеса — поэтому здесь нет
            выдуманных тарифов и сроков.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-amber-700/20 bg-amber-500/[0.08] px-4 py-2 text-[0.68rem] font-semibold text-amber-900">
            <Info size={13} />
            Статус: условия готовятся к согласованию
          </div>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <section>
              <h2 className="font-display text-[1.8rem]">Как формируется стоимость</h2>
              <div className="mt-5 space-y-0">
                {STEPS.map((step, index) => (
                  <div
                    key={step.n}
                    className={`grid grid-cols-[2.6rem_1fr] gap-4 border-t border-ink/10 py-5 ${
                      index === STEPS.length - 1 ? "border-b" : ""
                    }`}
                  >
                    <span className="font-display text-[1.6rem] leading-none text-copper/55">
                      {step.n}
                    </span>
                    <div>
                      <h3 className="text-[0.92rem] font-semibold">{step.title}</h3>
                      <p className="mt-1.5 text-[0.78rem] leading-relaxed text-ink/52">
                        {step.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[0.68rem] leading-relaxed text-ink/38">
                {PRICE_DISCLAIMER}
              </p>
            </section>

            <section className="mt-12">
              <h2 className="font-display text-[1.8rem]">Оплата</h2>
              <div className="mt-4 space-y-4 text-[0.82rem] leading-relaxed text-ink/58">
                <p>
                  На сайте нет эквайринга, формы ввода карты и имитации оплаты.
                  Отправка заявки ничего не списывает и не резервирует.
                </p>
                <p>
                  Порядок оплаты, размер аванса и этапы платежей на текущем
                  этапе не подтверждены. Они не должны считаться согласованными
                  до появления в коммерческом предложении или отдельном
                  документе.
                </p>
                <div className="rounded-xl border border-ink/10 bg-white/40 px-4 py-3 text-[0.72rem] text-ink/48">
                  Не переводите предоплату по реквизитам, которые не подтверждены
                  владельцем бизнеса. Безопасный порядок оплаты будет опубликован
                  после согласования.
                </div>
              </div>
            </section>

            <section className="mt-12">
              <h2 className="font-display text-[1.8rem]">Доставка</h2>
              <div className="mt-4 space-y-4 text-[0.82rem] leading-relaxed text-ink/58">
                <p>
                  География доставки и тарифы пока не подтверждены. В заявке
                  можно указать город, район и особенности подъезда — менеджер
                  уточнит доступность доставки для конкретного адреса.
                </p>
                <p>
                  Стоимость и сроки доставки не входят в предварительный расчёт
                  конфигуратора, если это не указано отдельно в коммерческом
                  предложении.
                </p>
              </div>
            </section>

            <section className="mt-12">
              <h2 className="font-display text-[1.8rem]">Монтаж</h2>
              <div className="mt-4 space-y-4 text-[0.82rem] leading-relaxed text-ink/58">
                <p>
                  Возможность и стоимость сборки и монтажа зависят от
                  конструкции, помещения и региона. Эти условия подтверждаются
                  индивидуально.
                </p>
                <p>
                  Для встроенной мебели и кухни особенно важны замер, состояние
                  стен, расположение коммуникаций и техники. Без этой проверки
                  конфигуратор не гарантирует посадку изделия.
                </p>
              </div>
            </section>

            <section className="mt-12 rounded-[1.4rem] bg-ink p-6 text-cream sm:p-8">
              <h2 className="font-display text-[1.8rem] leading-tight">
                Что уже можно сделать
              </h2>
              <p className="mt-2 max-w-lg text-[0.78rem] leading-relaxed text-cream/50">
                Собрать конфигурацию, увидеть ориентир по стоимости и отправить
                заявку. Дальше менеджер уточнит размеры и подтверждённые условия.
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Link href="/configurator/kitchen" className="btn btn-accent">
                  Собрать кухню
                  <ArrowUpRight size={15} />
                </Link>
                <Link href="/#lead" className="btn btn-glass-dark">
                  Оставить заявку
                </Link>
              </div>
            </section>

            <p className="mt-6 text-[0.64rem] leading-relaxed text-ink/35">
              {LEGAL_NOTICE}
            </p>
          </div>

          <aside className="lg:col-span-4 lg:col-start-9">
            <div className="rounded-[1.4rem] border border-ink/10 bg-white/45 p-5 lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
              <h2 className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-ink/38">
                Статус условий
              </h2>
              <ul className="mt-4 space-y-3">
                {STATUS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li
                      key={item.label}
                      className="flex items-center justify-between gap-3 border-b border-ink/8 pb-3 last:border-b-0 last:pb-0"
                    >
                      <span className="flex items-center gap-2 text-[0.74rem] text-ink/60">
                        <Icon size={13} className="text-copper" />
                        {item.label}
                      </span>
                      <span className="text-[0.62rem] font-semibold text-ink/38">
                        {item.value}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-5 rounded-xl bg-ink/[0.035] px-3.5 py-3 text-[0.65rem] leading-relaxed text-ink/45">
                Контакты для связи также требуют подтверждения. Если телефон или
                email уже указаны в подвале сайта, используйте их.
              </div>
              <Link href="/privacy" className="link-line mt-4 text-[0.66rem]">
                Политика обработки данных
                <ArrowUpRight size={12} />
              </Link>
              {SITE.contacts.email && (
                <a
                  href={`mailto:${SITE.contacts.email}`}
                  className="mt-3 block truncate text-[0.68rem] text-ink/45 underline decoration-ink/15 underline-offset-2"
                >
                  {SITE.contacts.email}
                </a>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
