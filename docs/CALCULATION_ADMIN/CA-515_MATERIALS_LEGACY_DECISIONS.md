# CA-515 — решения по материалам и legacy-совместимости

Дата: 2026-11-10. Статус: **утверждено владельцем 10.11.2026**.
Это основной источник решений CA-515-01…06; остальные документы ссылаются сюда.

**Обновление CA-T-516 (2026-11-11):** CA-515-02 и CA-515-05 уточнены/заменены
решениями CA-516-01…03 — см.
`docs/CALCULATION_ADMIN/CA-516_LEGACY_CATALOG_AND_RECALC_DECISIONS.md`.
CA-515-03, CA-515-04 и CA-515-06 продолжают действовать; CA-516-03 добавляет
запрет пересчёта проектов с legacy-фасадами.

## CA-515-01. Default фасада шкафа

**Решение:** новый проект шкафа использует фасад **ЛДСП** и действующую default-толщину ЛДСП (16 мм).

**Реализация:** `src/lib/configurator/defaults.ts` — `defaultWardrobe()`: `facadeMaterial: "ldsp"`, `facadeFinish: "milk"`. Default кухни не менялся.

**Проверка:** `src/lib/configurator/materials.test.ts`, default-конфигурация шкафа.

## CA-515-02. Палитра МДФ ПВХ

**Решение (уточнено CA-516-01):** палитра `mdf_pvc` полностью совпадает с палитрой МДФ эмали и использует **единый источник** `MDF_FACADE_FINISHES` в `src/content/catalog.ts`; две независимые копии не поддерживаются. Новые декоры не добавляются. Производственный ассортимент МДФ ПВХ по-прежнему не подтверждён: совпадение цветов не означает одинаковый набор декоров у поставщика.

**Реализация:** общий массив палитры для `mdf` и `mdf_pvc`; материалы, тарифы и `PriceItem` остаются раздельными.

## CA-515-03. Legacy bodyMaterial

**Решение:** старые `bodyMaterial: mdf|plywood` читаются без изменения; при **новом сохранении** конфигурация нормализуется в `bodyMaterial: ldsp` (корпус 16 мм). `priceHistory`, старые snapshots и исходный проект при GET не меняются; массовая миграция не выполняется.

**Реализация:**
- `src/lib/server/projects.ts` — `saveProject()` нормализует body только для новой сохраняемой версии;
- `src/lib/server/projects.ts` — `getProject()` не меняет body;
- `src/lib/configurator/defaults.ts` — `normalizeKitchen()` переводит локальные черновики на LDSP.

**Проверка:**
- `src/lib/server/projects.test.ts` — «новое сохранение legacy body MDF нормализует корпус в LDSP»;
- существующий тест чтения legacy body MDF;
- `src/lib/configurator/materials.test.ts`.

## CA-515-04. Legacy фасады

**Решение:** `veneer`, `glass`, `solid` читаются с сохранением исторического значения. Пользователь видит предупреждение; новое сохранение блокируется HTTP 422 до ручного выбора ЛДСП/МДФ. Автоматической подмены нет.

**Реализация:**
- schema принимает legacy-id;
- `src/lib/configurator/validation.ts` — warning `facadeMaterial`;
- `src/lib/server/projects.ts` — `saveProject()` возвращает 422;
- `src/app/api/projects/route.ts` — передаёт 422 клиенту;
- `src/components/configurator/SharedPanels.tsx` — видимое предупреждение в панели материалов.

**Проверка:**
- `src/lib/server/projects.test.ts` — чтение старого `glass`, запрет нового сохранения;
- `src/app/api/projects/route.test.ts` — HTTP 422;
- `src/lib/configurator/validation.test.ts` — warning;
- `src/lib/configurator/materials.test.ts`.

## CA-515-05. Архивирование старых CatalogItem / PriceItem

**Заменено CA-516-02:** архивировать можно только записи без исторических
зависимостей и использования. Старые body MDF/plywood и facade
veneer/glass/solid в локальном хранилище связаны с `usage=used` и
опубликованным snapshot, поэтому остаются **Legacy** и не архивируются.
Ниже сохранён исторический план CA-515 как контекст; актуальная политика —
в `CA-516_LEGACY_CATALOG_AND_RECALC_DECISIONS.md`.

**Историческое решение CA-515:** старые body MDF/plywood и facade veneer/glass/solid архивировать, не удалять. Идентификаторы, исторические связи и опубликованные снимки сохраняются; архивные элементы исключаются из новых активных выборок.

**Текущее состояние:** архивирование в production **не выполнялось**. Модель поддерживает статус `archived`, но безопасная архивация текущих legacy-записей ограничена существующими проверками:
- `archiveCatalogItem()` отклоняет архивирование, если на элемент ссылаются проекты (`projectsReferencing`);
- `archivePriceItem()` отклоняет `usage=used` и наличие ссылок из CatalogItem/ModulePreset.

Поскольку старые проекты и pins ссылаются на legacy-материалы, прямая архивация может быть отклонена. Это требует отдельного решения о политике legacy-ссылок; архитектура Calculation Admin в CA-515 не менялась.

**Безопасный план (после отдельного разрешения):**
1. На копии/временном хранилище инвентаризировать legacy CatalogItem/PriceItem и число ссылок из проектов/pins.
2. Проверить, какие published snapshots и `priceHistory` ссылаются на старые PriceItem; не переписывать их.
3. Определить политику: оставить legacy-записи активными, но исключёнными из новых выборок (текущее поведение), либо согласовать контролируемый legacy-архив с явным правилом для старых ссылок.
4. Если политика разрешает архив — сначала прогнать на временных данных: архивирование, чтение старых проектов, recalculate, проверка неизменности snapshots/history.
5. Только после этого — отдельная production-операция с backup и аудитом.

**Запрещено в CA-515:** удаление записей, production-архивация, изменение опубликованных снимков.

## CA-515-06. Legacy pins при пересчёте

**Решение:** при пересчёте старый проект без pin для фиксированного корпуса LDSP использует актуальную **опубликованную active** запись LDSP. Draft не используется. Новый pin в старую конфигурацию не записывается; старые pins, snapshots и `priceHistory` не меняются.

**Реализация:** `src/lib/server/data-resolver.ts` — `selectCatalog()`: fallback только для `bodyMaterial:ldsp`, только `operation=recalculate`, только при отсутствии pin и `status=active`.

**Проверка:** `src/lib/server/data-resolver.test.ts` — «legacy без body pin: пересчёт берёт active LDSP, не меняя pins».

## Границы

CA-515 не меняет геометрию/площадь фасадов, фрезеровку, Gola, коэффициенты shaker/handleless, формулы себестоимости, архитектуру Calculation Admin и историю проектов. Production DB, пользовательские проекты и исторические данные не изменялись.
