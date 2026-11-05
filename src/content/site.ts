export const SITE = {
  name: "FORMAKUB",
  legalName: "FORMAKUB",
  tagline: "Корпусная мебель по индивидуальным размерам",
  description:
    "Кухни, шкафы и корпусная мебель по индивидуальным размерам: настройте конфигурацию, посмотрите 2D-схему и получите предварительную стоимость.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  contacts: {
    phone: process.env.NEXT_PUBLIC_CONTACT_PHONE?.trim() || "",
    email: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "",
    address: process.env.NEXT_PUBLIC_CONTACT_ADDRESS?.trim() || "",
  },
  workingHours: "Пн–Сб, по согласованию",
  socials: [] as { label: string; href: string }[],
} as const;

export const NAV_LINKS = [
  { label: "Кухни", href: "/#categories" },
  { label: "Шкафы", href: "/#categories" },
  { label: "Конфигуратор", href: "/configurator/kitchen" },
  { label: "Проекты", href: "/#projects" },
  { label: "Как это работает", href: "/#process" },
  { label: "Вопросы", href: "/#faq" },
] as const;

export const CONTACT_VALUE_CONFIRMED = Boolean(
  SITE.contacts.phone || SITE.contacts.email || SITE.contacts.address,
);

export const TRUST_POINTS = [
  "Без онлайн-оплаты",
  "Предварительный расчёт",
  "Проверка размеров менеджером",
] as const;

export const LEGAL_NOTICE =
  "Шаблон страницы подготовлен для последующего согласования с юристом. Реквизиты, оператор персональных данных и окончательные условия обработки должны быть подтверждены владельцем бизнеса.";
