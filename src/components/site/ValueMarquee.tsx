const VALUES = [
  "Индивидуальные размеры",
  "Наполнение под сценарий",
  "Фасады из дерева и эмали",
  "Фурнитура с доводчиком",
  "Push-to-open",
  "2D-схема до заказа",
  "Предварительный расчёт",
  "Проверка размеров менеджером",
];

export function ValueMarquee() {
  return (
    <div className="marquee relative overflow-hidden border-y border-ink/10 bg-cream-deep/45 py-4">
      <div className="marquee-track items-center gap-8">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex items-center gap-8" aria-hidden={copy === 1}>
            {VALUES.map((value) => (
              <span
                key={`${copy}-${value}`}
                className="flex items-center gap-8 whitespace-nowrap text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-ink/48"
              >
                {value}
                <span className="h-1 w-1 rounded-full bg-copper/70" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
