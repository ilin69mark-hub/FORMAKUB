import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Database,
  Info,
  Lock,
  Mail,
  UserCheck,
} from "lucide-react";
import { LEGAL_NOTICE, SITE } from "@/content/site";

export const metadata: Metadata = {
  title: "Политика обработки данных",
  description:
    "Черновик политики обработки персональных данных FORMAKUB: какие данные собираются в заявке, зачем они нужны и какие пункты ещё требуют юридического согласования.",
  alternates: { canonical: "/privacy" },
  robots: { index: false, follow: true },
};

const SECTIONS = [
  {
    n: "01",
    title: "Какие данные собираются",
    body: [
      "В форме заявки указываются имя, контакт для связи (телефон, Telegram, WhatsApp или email), при необходимости email и комментарий. Отдельно фиксируется согласие на обработку данных.",
      "К заявке может прилагаться конфигурация мебели: размеры, материалы, состав модулей и предварительный расчёт. Эти сведения описывают проект, а не человека.",
      "Сайт не запрашивает паспортные данные, платёжные реквизиты, данные банковских карт или документы.",
    ],
  },
  {
    n: "02",
    title: "Зачем они нужны",
    body: [
      "Данные используются, чтобы ответить на обращение, уточнить задачу, подготовить предложение и согласовать условия заказа.",
      "Мы не добавляем человека в рекламные рассылки без отдельного согласия. В демо-версии маркетинговые рассылки не настроены.",
    ],
  },
  {
    n: "03",
    title: "Где и как хранятся",
    body: [
      "В демонстрационной версии заявки и проекты сохраняются в файловом хранилище на сервере приложения. Это MVP-решение, а не промышленная инфраструктура с гарантированным уровнем доступности.",
      "Конфигурация также может сохраняться в localStorage браузера, чтобы восстановить черновик. Эти данные не отправляются на сервер до сохранения проекта или заявки.",
      "Сроки хранения, порядок удаления и ответственный оператор персональных данных должны быть утверждены владельцем бизнеса.",
    ],
  },
  {
    n: "04",
    title: "Передача третьим лицам",
    body: [
      "Мы не продаём персональные данные. Передача возможна только если она необходима для исполнения заказа, требуется по закону или явно согласована.",
      "Конкретные подрядчики, хостинг, CRM и сервисы аналитики на текущем этапе не подтверждены. В демо-версии сторонняя аналитика не подключена.",
    ],
  },
  {
    n: "05",
    title: "Права пользователя",
    body: [
      "Можно запросить доступ к своим данным, их исправление или удаление, а также отозвать согласие на обработку. Для этого используйте контакт, указанный в подвале сайта.",
      "Если контакт для обращений ещё не опубликован, он должен быть добавлен владельцем бизнеса до запуска сайта в публичный доступ.",
    ],
  },
  {
    n: "06",
    title: "Cookies и локальное хранилище",
    body: [
      "Сайт использует localStorage для сохранения черновика конфигурации. Это техническая функция, а не рекламный трекинг.",
      "При появлении аналитики или рекламных пикселей политику нужно дополнить, а также добавить корректный механизм согласия там, где это требуется.",
    ],
  },
  {
    n: "07",
    title: "Изменения документа",
    body: [
      "Политика может обновляться при изменении процессов, инфраструктуры или требований законодательства. Актуальная версия публикуется на этой странице.",
      "Документ не считается окончательным до проверки юристом и подтверждения оператора персональных данных.",
    ],
  },
];

export default function PrivacyPage() {
  const hasContact = Boolean(SITE.contacts.email || SITE.contacts.phone);

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
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">Документы</span>
            <span className="badge-demo">черновик</span>
          </div>
          <h1 className="display mt-5 text-[clamp(2.8rem,6vw,5.2rem)]">
            Политика обработки
            <br />
            <span className="text-ink/42">персональных данных.</span>
          </h1>
          <p className="body-copy mt-6 max-w-2xl">
            Это рабочий черновик для демонстрационной версии сайта. Он
            описывает текущую логику формы и хранения, но не заменяет
            юридически проверенный документ и не подтверждает оператора данных.
          </p>
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-amber-700/20 bg-amber-500/[0.08] px-4 py-3 text-[0.7rem] leading-relaxed text-amber-900">
            <Info size={14} className="mt-0.5 shrink-0" />
            {LEGAL_NOTICE}
          </div>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            {SECTIONS.map((section) => (
              <section
                key={section.n}
                className="border-t border-ink/10 py-7 first:border-t-0 first:pt-0"
              >
                <div className="grid grid-cols-[2.4rem_1fr] gap-4">
                  <span className="font-display text-[1.5rem] leading-none text-copper/50">
                    {section.n}
                  </span>
                  <div>
                    <h2 className="font-display text-[1.5rem] leading-tight">
                      {section.title}
                    </h2>
                    <div className="mt-3 space-y-3 text-[0.8rem] leading-relaxed text-ink/55">
                      {section.body.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            ))}

            <div className="mt-8 rounded-[1.4rem] bg-ink p-6 text-cream sm:p-7">
              <h2 className="font-display text-[1.7rem]">Нужно согласование</h2>
              <p className="mt-2 text-[0.76rem] leading-relaxed text-cream/50">
                Перед публичным запуском владельцу бизнеса нужно подтвердить
                оператора данных, юридические реквизиты, сроки хранения, порядок
                удаления и контакт для обращений. После этого текст проверяет
                юрист.
              </p>
              <Link href="/payment-delivery" className="btn btn-glass-dark btn-sm mt-4">
                Оплата и доставка
                <ArrowUpRight size={13} />
              </Link>
            </div>
          </div>

          <aside className="lg:col-span-4 lg:col-start-9">
            <div className="rounded-[1.4rem] border border-ink/10 bg-white/45 p-5 lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
              <h2 className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-ink/38">
                Коротко
              </h2>
              <ul className="mt-4 space-y-3">
                {[
                  {
                    icon: UserCheck,
                    title: "Только контакт и проект",
                    text: "Без паспорта и платёжных данных.",
                  },
                  {
                    icon: Database,
                    title: "JSON-хранилище MVP",
                    text: "Для демо и локальной проверки.",
                  },
                  {
                    icon: Lock,
                    title: "Без рекламного трекинга",
                    text: "Аналитика в демо не подключена.",
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.title} className="flex gap-2.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/8 bg-white/55 text-copper">
                        <Icon size={12} />
                      </span>
                      <div>
                        <div className="text-[0.7rem] font-semibold">{item.title}</div>
                        <div className="mt-0.5 text-[0.62rem] leading-relaxed text-ink/42">
                          {item.text}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-5 border-t border-ink/8 pt-4">
                <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/35">
                  Контакт по данным
                </div>
                {hasContact ? (
                  <div className="mt-2 space-y-1 text-[0.68rem] text-ink/55">
                    {SITE.contacts.email && (
                      <a
                        href={`mailto:${SITE.contacts.email}`}
                        className="flex items-center gap-1.5 underline decoration-ink/15 underline-offset-2"
                      >
                        <Mail size={11} />
                        {SITE.contacts.email}
                      </a>
                    )}
                    {SITE.contacts.phone && <span>{SITE.contacts.phone}</span>}
                  </div>
                ) : (
                  <p className="mt-2 text-[0.64rem] leading-relaxed text-ink/40">
                    Контакт для обращений пока не подтверждён. Он должен быть
                    опубликован до запуска сайта.
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
