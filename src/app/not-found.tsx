import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Страница не найдена",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="flex min-h-[85svh] items-center pb-16 pt-[calc(var(--header-h)+3rem)]">
      <div className="container-page">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <span className="eyebrow">Ошибка 404</span>
            <div className="mt-4 font-display text-[clamp(5rem,15vw,11rem)] leading-[0.82] text-ink/12">
              404
            </div>
            <h1 className="display mt-4 text-[clamp(2.4rem,4.8vw,4.4rem)]">
              Такой страницы
              <br />
              <span className="text-ink/42">здесь нет.</span>
            </h1>
          </div>
          <div className="lg:col-span-4 lg:col-start-9">
            <p className="body-copy">
              Возможно, ссылка устарела или в адресе есть опечатка. Вернитесь на
              главную, посмотрите концепции или начните собирать конфигурацию.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row lg:flex-col">
              <Link href="/" className="btn btn-primary">
                <ArrowLeft size={15} />
                На главную
              </Link>
              <Link href="/#projects" className="btn btn-glass">
                Посмотреть концепции
                <ArrowUpRight size={15} />
              </Link>
            </div>
            <div className="mt-5 flex gap-4 border-t border-ink/10 pt-4 text-[0.68rem]">
              <Link href="/configurator/kitchen" className="link-line">
                Кухня
              </Link>
              <Link href="/configurator/wardrobe" className="link-line">
                Шкаф
              </Link>
              <Link href="/#lead" className="link-line">
                Заявка
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
