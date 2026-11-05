import {
  Calculator,
  MessageCircle,
  Ruler,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

const ITEMS = [
  {
    icon: Ruler,
    title: "Размеры под помещение",
    text: "Ширина, высота и глубина настраиваются. Финальную посадку проверяем после замера — конфигуратор не заменяет технический проект.",
  },
  {
    icon: SlidersHorizontal,
    title: "Наполнение под сценарий",
    text: "Полки, штанги, ящики и секции — не абстрактный набор, а рабочие зоны под одежду, посуду и технику.",
  },
  {
    icon: Sparkles,
    title: "Фасады и материалы",
    text: "ЛДСП, МДФ в эмали, шпон, стекло и массив. Визуализация показывает выбранную палитру, а расчёт — влияние материала.",
  },
  {
    icon: ShieldCheck,
    title: "Проверка совместимости",
    text: "Push-to-open и накладные ручки, стекло и рамочный фасад, полки и ящики — конфигуратор подсвечивает противоречия.",
  },
  {
    icon: Calculator,
    title: "Предварительный расчёт",
    text: "Ориентир складывается из фактической конфигурации: модулей, фасадов, фурнитуры и опций. Окончательная цена — после проверки.",
  },
  {
    icon: MessageCircle,
    title: "Обсуждение с менеджером",
    text: "Заявка приходит вместе с конфигурацией. Не нужно заново перечислять размеры — остаётся уточнить детали и условия.",
  },
];

export function Advantages() {
  return (
    <section id="advantages" className="section-pad">
      <div className="container-page">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-28">
              <span className="eyebrow reveal">Почему индивидуально</span>
              <h2 className="display reveal mt-5 text-[clamp(2.5rem,4.3vw,4rem)]">
                Не про роскошь.
                <br />
                <span className="text-ink/45">Про ваши сценарии.</span>
              </h2>
              <p className="body-copy reveal mt-5 max-w-md">
                Индивидуальный проект нужен там, где стандартные модули
                заставляют подстраивать комнату под мебель. Здесь наоборот:
                сначала пространство, привычки и хранение — потом конструкция.
              </p>

              <div className="reveal mt-8 rounded-2xl border border-copper/20 bg-copper/[0.06] p-5">
                <div className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-copper">
                  Важное ограничение
                </div>
                <p className="mt-2 text-[0.8rem] leading-relaxed text-ink/58">
                  Ни один конфигуратор не подтверждает посадку без замера.
                  Стены, углы, коммуникации и технические условия проверяются
                  отдельно — особенно для кухни и встроенных шкафов.
                </p>
              </div>

              <div className="mt-7 flex items-center gap-4">
                <span className="font-display text-5xl leading-none text-ink/12">“</span>
                <p className="max-w-xs font-display text-[1.2rem] leading-snug text-ink/65">
                  Хорошая мебель не спорит с пространством — она его
                  организует.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="grid gap-3 sm:grid-cols-2">
              {ITEMS.map((item, index) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="card-hover reveal card-surface p-5 sm:p-6"
                    style={{ transitionDelay: `${index * 45}ms` }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-ink/8 bg-white/65 text-copper">
                        <Icon size={17} strokeWidth={1.6} />
                      </span>
                      <span className="font-display text-xs text-ink/24">
                        0{index + 1}
                      </span>
                    </div>
                    <h3 className="mt-5 text-[0.98rem] font-semibold tracking-tight">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-[0.78rem] leading-relaxed text-ink/52">
                      {item.text}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
