/**
 * Структура навигации Calculation Admin (ТЗ §7.1, CA-T-501).
 *
 * Только метаданные разделов: не данные и не бизнес-логика. `group`
 * задаёт логическую группу боковой навигации; `href` — существующий
 * маршрут. Новый раздел не создаёт второй источник данных.
 */

export interface AdminSection {
  /** Стабильный идентификатор раздела. */
  id: string;
  /** Номер раздела ТЗ: 00–10 (+ подразделы). */
  index: string;
  title: string;
  /** Логическая группа навигации. */
  group: string;
  /** Сегмент маршрута; пустая строка — `/admin`. */
  slug: string;
  href: string;
  description: string;
  /** Задача плана, в которой раздел получил функциональность. */
  nextTask: string;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: "overview",
    index: "00",
    title: "Обзор системы",
    group: "A. Обзор",
    slug: "",
    href: "/admin",
    description: "Сводное состояние расчётной системы и переходы в разделы.",
    nextTask: "CA-T-501",
  },
  {
    id: "parameters",
    index: "01",
    title: "Геометрия и параметры",
    group: "D. Материалы и характеристики",
    slug: "parameters",
    href: "/admin/parameters",
    description: "Геометрические константы, лимиты и параметры расчёта.",
    nextTask: "CA-T-502",
  },
  {
    id: "catalogs",
    index: "02",
    title: "Каталоги составляющих",
    group: "C. Каталоги",
    slug: "catalogs",
    href: "/admin/catalogs",
    description: "Материалы, фасады, столешницы, цоколь и другие справочники.",
    nextTask: "CA-T-503",
  },
  {
    id: "materials",
    index: "02B",
    title: "Материалы и характеристики",
    group: "D. Материалы и характеристики",
    slug: "materials",
    href: "/admin/materials",
    description: "Фактические материалы, толщины, плотности и применимость.",
    nextTask: "CALC-ADMIN-MATERIALS",
  },
  {
    id: "modules",
    index: "03",
    title: "Мебельные модули",
    group: "B. Мебельные модули",
    slug: "modules",
    href: "/admin/modules",
    description: "Пресеты, управляемый состав кухни и конфигурация шкафа.",
    nextTask: "CA-T-503",
  },
  {
    id: "hardware",
    index: "04",
    title: "Фурнитура и опоры",
    group: "C. Каталоги",
    slug: "hardware",
    href: "/admin/hardware",
    description: "Ручки, петли, направляющие и системы опор.",
    nextTask: "CA-T-503",
  },
  {
    id: "lighting",
    index: "05",
    title: "Освещение",
    group: "C. Каталоги",
    slug: "lighting",
    href: "/admin/lighting",
    description: "Ленты, профили, рассеиватели, блоки питания и допуски.",
    nextTask: "CA-T-503",
  },
  {
    id: "rules",
    index: "06A",
    title: "Правила комплектации",
    group: "E. Правила комплектации",
    slug: "rules",
    href: "/admin/rules",
    description: "Управляемые нормы, draft-редакции и снимки правил.",
    nextTask: "CA-T-613",
  },
  {
    id: "prices",
    index: "06",
    title: "Цены и тарифы",
    group: "F. Цены и тарифы",
    slug: "prices",
    href: "/admin/prices",
    description: "Ставки, коммерческие правила, версии прайса и публикация.",
    nextTask: "CA-T-504",
  },
  {
    id: "dataSources",
    index: "06B",
    title: "Источники данных",
    group: "G. Источники данных",
    slug: "data-sources",
    href: "/admin/data-sources",
    description: "Происхождение параметров, норм и цен; подтверждённые и предварительные значения.",
    nextTask: "CALC-ADMIN-DATA-SOURCES",
  },
  {
    id: "calculations",
    index: "07A",
    title: "Инспектор расчётов",
    group: "H. Calculation Inspector",
    slug: "calculations",
    href: "/admin/calculations",
    description: "Сохранённые расчёты: модули, строки стоимости, правила и версии.",
    nextTask: "CALC-ADMIN-INSPECTOR",
  },
  {
    id: "formulas",
    index: "07",
    title: "Формулы и алгоритмы",
    group: "H. Calculation Inspector",
    slug: "formulas",
    href: "/admin/formulas",
    description: "Read-only реестр формул и карта зависимостей.",
    nextTask: "CA-T-507",
  },
  {
    id: "projects",
    index: "08",
    title: "Проекты и пересчёт",
    group: "I. Проекты и версии",
    slug: "projects",
    href: "/admin/projects",
    description: "Сохранённые проекты, пересчёт и история стоимости.",
    nextTask: "CA-T-505",
  },
  {
    id: "versions",
    index: "09",
    title: "Версии и публикации",
    group: "J. Версии и публикации",
    slug: "versions",
    href: "/admin/versions",
    description: "Версии прайса, правил, изменения и журнал административных действий.",
    nextTask: "CA-T-508",
  },
  {
    id: "diagnostics",
    index: "10",
    title: "Контроль и диагностика",
    group: "K. Диагностика",
    slug: "diagnostics",
    href: "/admin/diagnostics",
    description: "Валидация, проверка зависимостей и отчёты диагностики.",
    nextTask: "CA-T-506",
  },
  {
    id: "leads",
    index: "11",
    title: "Заявки",
    group: "L. Заявки",
    slug: "leads",
    href: "/admin/leads",
    description:
      "Заявки клиентов: контакты, тип мебели, стоимость и переход к связанному проекту.",
    nextTask: "CA-GL-25",
  },
] as const;

const BY_SLUG = new Map(
  ADMIN_SECTIONS.map((section) => [section.slug, section] as const),
);

export type AdminSectionId = (typeof ADMIN_SECTIONS)[number]["id"];

/** Раздел по сегменту маршрута; `undefined` — `/admin` (00). */
export function findSectionBySlug(
  slug: string | undefined,
): AdminSection | undefined {
  return BY_SLUG.get(slug ?? "");
}

export interface AdminSectionGroup {
  label: string;
  sections: readonly AdminSection[];
}

/** Группы в порядке появления разделов. */
export function groupSections(
  sections: readonly AdminSection[],
): AdminSectionGroup[] {
  const groups: AdminSectionGroup[] = [];
  for (const section of sections) {
    const current = groups[groups.length - 1];
    if (current && current.label === section.group) {
      groups[groups.length - 1] = {
        label: current.label,
        sections: [...current.sections, section],
      };
    } else {
      groups.push({ label: section.group, sections: [section] });
    }
  }
  return groups;
}
