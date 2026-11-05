import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const STEPS = [
  {
    n: "01",
    title: "Выбираете тип мебели",
    text: "Кухня или шкаф. Для остальных задач оставляете заявку — менеджер обсудит проект отдельно.",
  },
  {
    n: "02",
    title: "Задаёте размеры",
    text: "Ширина, высота и глубина — в допустимых пределах. Конфигуратор не пропустит заведомо нерабочую геометрию.",
  },
  {
    n: "03",
    title: "Настраиваете наполнение",
    text: "Модули, полки, штанги, ящики, фасады, столешница и фурнитура. Всё, что видно на схеме, участвует в расчёте.",
  },
  {
    n: "04",
    title: "Видите ориентир цены",
    text: "Предварительная стоимость пересчитывается при каждом изменении. Это ориентир, а не окончательное предложение.",
  },
  {
    n: "05",
    title: "Отправляете заявку",
    text: "Конфигурация и расчёт прикладываются автоматически. Онлайн-оплата не нужна.",
  },
  {
    n: "06",
    title: "Уточняем детали",
    text: "Менеджер проверяет размеры, материалы и технические условия, затем готовит окончательное предложение.",
  },
];

export function Process() {
  return (
    <section id="process" className="section-pad border-y border-ink/8 bg-cream-deep/35">
      <div className="container-page">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-6">
            <span className="eyebrow reveal">Как это работает</span>
            <h2 className="display reveal mt-5 text-[clamp(2.5rem,4.6vw,4.3rem)]">
              От идеи до
              <br />
              <span className="text-ink/45">проверенной сметы.</span>
            </h2>
          </div>
          <div className="lg:col-span-4 lg:col-start-9">
            <p className="body-copy reveal">
              Конфигуратор помогает собрать основу и понять порядок стоимости.
              Финальное решение всегда проходит через проверку размеров и
              обсуждение деталей с менеджером.
            </p>
            <Link href="/configurator/kitchen" className="link-line reveal mt-5">
              Начать с кухни
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>

        <ol className="mt-12 grid gap-x-6 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.n}
              className="reveal group relative border-t border-ink/12 py-7 transition-colors hover:border-copper/50"
              style={{ transitionDelay: `${index * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="font-display text-[2.6rem] leading-none text-ink/18 transition-colors duration-500 group-hover:text-copper/65">
                  {step.n}
                </span>
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-ink/15 transition-all duration-500 group-hover:bg-copper" />
              </div>
              <h3 className="mt-5 text-[1.02rem] font-semibold tracking-tight">
                {step.title}
              </h3>
              <p className="mt-2 max-w-xs text-[0.8rem] leading-relaxed text-ink/52">
                {step.text}
              </p>
            </li>
          ))}
        </ol>

        <div className="reveal mt-10 flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white/35 px-4 py-3 text-[0.72rem] leading-relaxed text-ink/48 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Важно: 2D-схема и предварительный расчёт не являются производственным
            чертежом и окончательной спецификацией.
          </span>
          <Link href="/payment-delivery" className="link-line shrink-0 text-ink/65">
            Оплата и доставка
            <ArrowUpRight size={12} />
          </Link>
        </div>
      </div>
    </section>
  );
}
