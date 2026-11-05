import Link from "next/link";
import {
  ArrowUpRight,
  Calculator,
  ClipboardCheck,
  Truck,
  Wallet,
} from "lucide-react";

const ITEMS = [
  {
    icon: ClipboardCheck,
    title: "Проверка заказа",
    text: "Менеджер уточняет размеры, материалы, технику и условия помещения. До этого расчёт остаётся ориентиром.",
    status: "до подтверждения",
  },
  {
    icon: Calculator,
    title: "Окончательная стоимость",
    text: "Цена фиксируется в коммерческом предложении после проверки состава и конструктивных решений.",
    status: "по КП",
  },
  {
    icon: Wallet,
    title: "Оплата",
    text: "Порядок и этапы оплаты на текущем этапе не подтверждены. На сайте нет эквайринга и имитации оплаты.",
    status: "уточняется",
  },
  {
    icon: Truck,
    title: "Доставка и монтаж",
    text: "География, тарифы и сроки зависят от региона и помещения. Доступность подтверждается индивидуально.",
    status: "уточняется",
  },
];

export function PaymentDelivery() {
  return (
    <section id="payment" className="section-pad border-y border-ink/8 bg-cream-deep/35">
      <div className="container-page">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <span className="eyebrow reveal">Оплата и доставка</span>
            <h2 className="display reveal mt-5 text-[clamp(2.3rem,4vw,3.4rem)]">
              Честно о том,
              <br />
              <span className="text-ink/45">что ещё уточняется.</span>
            </h2>
            <p className="body-copy reveal mt-5">
              Мы не публикуем неподтверждённые тарифы и сроки. После
              согласования условий владелец бизнеса сможет указать точный
              порядок оплаты, географию доставки и стоимость монтажа.
            </p>
            <Link href="/payment-delivery" className="btn btn-glass btn-sm reveal mt-6">
              Подробнее об условиях
              <ArrowUpRight size={14} />
            </Link>
            <p className="mt-4 text-[0.66rem] leading-relaxed text-ink/38">
              Никаких платежей на сайте не проводится. Заявка ничего не
              списывает и не резервирует.
            </p>
          </div>

          <div className="lg:col-span-7 lg:col-start-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {ITEMS.map((item, index) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="card-hover reveal card-surface p-5"
                    style={{ transitionDelay: `${index * 45}ms` }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/8 bg-white/65 text-copper">
                        <Icon size={16} strokeWidth={1.7} />
                      </span>
                      <span className="rounded-full border border-ink/10 px-2 py-1 text-[0.55rem] font-semibold uppercase tracking-[0.1em] text-ink/38">
                        {item.status}
                      </span>
                    </div>
                    <h3 className="mt-4 text-[0.94rem] font-semibold tracking-tight">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-[0.74rem] leading-relaxed text-ink/50">
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
