export interface Category {
  id: string;
  index: string;
  title: string;
  shortTitle: string;
  description: string;
  image: string;
  imageAlt: string;
  href: string;
  cta: string;
  features: string[];
  configurable: boolean;
  featured?: boolean;
}

export const CATEGORIES: Category[] = [
  {
    id: "kitchens",
    index: "01",
    title: "Кухни на заказ",
    shortTitle: "Кухни",
    description:
      "Модульная кухня под размеры помещения: мойка, варочная зона, хранение и техника собираются в один сценарий. Настройте состав, фасады и фурнитуру в конфигураторе.",
    image: "/images/k-curve.jpg",
    imageAlt: "Кухня из натурального дерева с плавными скруглениями",
    href: "/configurator/kitchen",
    cta: "Собрать кухню",
    features: ["Модули и размеры", "2D-схема", "Расчёт"],
    configurable: true,
    featured: true,
  },
  {
    id: "wardrobes",
    index: "02",
    title: "Шкафы",
    shortTitle: "Шкафы",
    description:
      "Корпусные шкафы с секциями, полками, штангами и ящиками. Высота, ширина и глубина подбираются под нишу или стену.",
    image: "/images/wardrobe-2.jpg",
    imageAlt: "Минималистичный шкаф из дуба в светлом интерьере",
    href: "/configurator/wardrobe",
    cta: "Собрать шкаф",
    features: ["Секции", "Полки и штанги", "Ящики"],
    configurable: true,
  },
  {
    id: "dressing-rooms",
    index: "03",
    title: "Гардеробные",
    shortTitle: "Гардеробные",
    description:
      "Сценарии хранения для одежды, обуви и аксессуаров. Обсудим наполнение, освещение и то, как гардеробная встроится в помещение.",
    image: "/images/walkin-1.jpg",
    imageAlt: "Гардеробная с подсветкой, витринами и местом для аксессуаров",
    href: "/#lead",
    cta: "Обсудить проект",
    features: ["Наполнение", "Подсветка", "Индивидуальный проект"],
    configurable: false,
  },
  {
    id: "dressers",
    index: "04",
    title: "Комоды и тумбы",
    shortTitle: "Комоды",
    description:
      "Отдельностоящие и встроенные решения: комоды, тумбы, консоли, стеллажи. Подбираем пропорции под конкретное место.",
    image: "/images/sideboard-1.jpg",
    imageAlt: "Светлый комод из фанеры с открытыми секциями",
    href: "/#lead",
    cta: "Обсудить проект",
    features: ["Размеры", "Материалы", "Сценарий хранения"],
    configurable: false,
  },
  {
    id: "other",
    index: "05",
    title: "Другая корпусная мебель",
    shortTitle: "Другое",
    description:
      "Мебель для прихожей, кабинета, детской и других пространств. Если задача выходит за рамки конфигуратора, опишите её в заявке.",
    image: "/images/sideboard-2.jpg",
    imageAlt: "Деревянная консоль в минималистичном интерьере",
    href: "/#lead",
    cta: "Обсудить проект",
    features: ["Нестандартные задачи", "Подбор материалов", "Консультация"],
    configurable: false,
  },
];
