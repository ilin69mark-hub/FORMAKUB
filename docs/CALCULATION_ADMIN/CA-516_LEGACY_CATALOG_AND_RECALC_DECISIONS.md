# CA-516 — Legacy-каталог, архивирование и пересчёт исторических проектов

Дата: 2026-11-11. Статус: **утверждено владельцем**. Задача: CA-T-516.
Продолжение `CA-515_MATERIALS_LEGACY_DECISIONS.md`; при расхождении приоритет у этого документа для CA-516-01…03.

## CA-516-01. Единая палитра МДФ эмаль и МДФ ПВХ

**Решение:** палитра МДФ ПВХ полностью совпадает с палитрой МДФ эмаль.
Одинаковы перечень декоров, их названия, hex и порядок. В UI оба материала
используют один и тот же набор вариантов.

**Причина:** исключить расхождение палитр при последующих обновлениях и
ручном сопровождении двух копий.

**Реализация:**
- `src/content/catalog.ts` — единый источник `MDF_FACADE_FINISHES`;
 `FACADE_MATERIALS.mdf.finishes` и `FACADE_MATERIALS.mdf_pvc.finishes`
 ссылаются на один массив.
- Материалы и `PriceItem` остаются раздельными: `facadeMaterial:mdf`,
 `facadeMaterial:mdf_pvc`, `catalog.facade.mdf.ratePerSqm`,
 `catalog.facade.mdf_pvc.ratePerSqm`.
- Ставки не объединялись: МДФ эмаль — 8 400 ₽/м², МДФ ПВХ — 8 400 ₽/м².
 Формула стоимости и тарифы не менялись.

**Область действия:** только палитра и её источник. Толщины 16/19/22,
геометрия, фрезеровка, Gola/shaker/handleless и коэффициенты не менялись.

**Ограничение:** совпадение палитры не подтверждает одинаковый
производственный ассортимент эмали и плёнки ПВХ; это отдельный UNKNOWN
производства.

**Тесты:** `src/lib/configurator/materials.test.ts` — «CA-516-01: палитры
МДФ эмаль и МДФ ПВХ совпадают и используют единый источник»: проверяет
ссылочное равенство массива, совпадение id/порядка, отдельные объекты
материалов, независимость ставок и одинаковые толщины.

## CA-516-02. Политика архивирования CatalogItem и PriceItem

**Решение:** архивировать только записи без исторических зависимостей и
использования. Записи, связанные с историческими проектами, snapshots,
pins или priceHistory, сохраняются доступными для Legacy.

### Категории

**A — нет исторических зависимостей и использования:**
- разрешено архивировать штатным `archiveCatalogItem` / `archivePriceItem`;
- после архивирования запись исключается из активного каталога и новых
  выборок (create/preview, bootstrap, import, новые PriceItem selections);
- идентификатор и исторические связи не удаляются.

**B — есть исторические зависимости или использование:**
- не архивировать и не удалять;
- чтение старых проектов, сохранённой цены, `priceHistory`, snapshots и pins
  продолжает работать;
- запись исключается из выбора материалов для новых проектов и из новых
  импортов/активного каталога;
- пересчётная совместимость сохраняется в пределах утверждённых правил
  (для legacy-фасадов действует запрет CA-516-03).

### Проверяемые зависимости

`archiveCatalogItem` отклоняет архивирование, если:
- на `id` ссылается `StoredProject.config` (включая легаси-идентификаторы
  столешниц), `pins` или `priceHistory`;
- связанные `PriceItem` (через `priceRefs`) имеют `usage=used` или входят в
  опубликованный snapshot.

`archivePriceItem` отклоняет архивирование, если:
- `usage=used`;
- на ставку ссылаются `ModulePreset.priceRef` или `CatalogItem.priceRefs`;
- ставка входит в опубликованный snapshot `PricingVersion`.

Draft-версии не считаются исторической зависимостью: архивирование
по-прежнему выполняется вне draft-потока.

### Инвентаризация (локальное хранилище, read-only)

Источник: `data/formakub.db`, коллекции `catalog-items.json`,
`price-items.json`, `pricing-versions.json`, `projects.json`.
`projects.json` пуст, pins в проектах отсутствуют. Опубликованная версия —
`price-2026.11.1`.

| Запись | Есть исторические ссылки | Используется | Решение |
|---|---|---|---|
| `CatalogItem` `bodyMaterial:mdf` | Да: связанная ставка в published snapshot | Да (`usage=used`) | **Legacy** |
| `CatalogItem` `bodyMaterial:plywood` | Да: связанная ставка в published snapshot | Да (`usage=used`) | **Legacy** |
| `CatalogItem` `facadeMaterial:veneer` | Да: связанная ставка в published snapshot | Да (`usage=used`) | **Legacy** |
| `CatalogItem` `facadeMaterial:glass` | Да: связанная ставка в published snapshot | Да (`usage=used`) | **Legacy** |
| `CatalogItem` `facadeMaterial:solid` | Да: связанная ставка в published snapshot | Да (`usage=used`) | **Legacy** |
| `PriceItem` `catalog.body.mdf.ratePerSqm` | Да: `price-2026.11.1` | Да (`usage=used`) | **Legacy** |
| `PriceItem` `catalog.body.plywood.ratePerSqm` | Да: `price-2026.11.1` | Да (`usage=used`) | **Legacy** |
| `PriceItem` `catalog.facade.veneer.ratePerSqm` | Да: `price-2026.11.1` | Да (`usage=used`) | **Legacy** |
| `PriceItem` `catalog.facade.glass.ratePerSqm` | Да: `price-2026.11.1` | Да (`usage=used`) | **Legacy** |
| `PriceItem` `catalog.facade.solid.ratePerSqm` | Да: `price-2026.11.1` | Да (`usage=used`) | **Legacy** |

**Категория A среди legacy-записей отсутствует.** Все перечисленные записи
активны, используются движком и входят в опубликованный snapshot, поэтому
архивированию не подлежат. Записи `facadeMaterial:mdf` и
`catalog.facade.mdf.ratePerSqm` — действующие, не legacy.

Если в будущем появится legacy-запись без ссылок и с `usage=unused`, её
можно архивировать только через существующие сервисы; обходить их проверки
запрещено.

### Новые выборки

- `DataResolver` для `create`/`preview` принимает только `status=active`;
  архивные записи не попадают в новые расчёты.
- `bootstrap` и `import` создают только активные `FACADE_MATERIALS`;
  legacy-материалы в них отсутствуют.
- `pins` новых проектов строятся по активным справочникам.
- Архивная запись остаётся доступной через `getCatalogItem`/`getPriceItem`
  для чтения истории.

**Тесты:**
- `src/lib/admin/catalogs.test.ts` — архивирование legacy-записи без ссылок,
  сохранение читаемости, отказ при проекте/pins/priceHistory, отказ при
  связанной used-ставке и published snapshot;
- `src/lib/admin/price-items.test.ts` — отказ при `usage=used`, ссылках и
  published snapshot; draft не блокирует;
- `src/lib/admin/bootstrap.test.ts`, `src/lib/admin/import.test.ts` — legacy
  материалы не попадают в bootstrap/import;
- `src/lib/server/data-resolver.test.ts` — archived-запись не проходит в
  create.

## CA-516-03. Запрет пересчёта проектов с legacy-фасадами

**Решение:** проект с legacy-фасадом `veneer`, `glass` или `solid` нельзя
пересчитывать до ручной замены материала на актуальный.

**Разрешено:** открыть проект, прочитать историческую конфигурацию,
увидеть сохранённую историческую цену, `priceHistory`, snapshots и pins.

**Запрещено:** запускать расчёт с нулевой/случайной стоимостью или
автоматически подменять legacy-фасад на МДФ эмаль/другой материал.

При попытке пересчёта сервер возвращает контролируемую ошибку
`LEGACY_FACADE_MATERIAL` (HTTP 422) с сообщением о необходимости ручной
замены. Блокировка не создаёт событие истории и не пишет проект.

### Все пути пересчёта

- `recalculateProject` — центральная проверка до replay, DataResolver и
  Engine;
- публичный и admin API пересчёта — используют `recalculateProject`;
- `DataResolver` — отдельная fail-closed проверка для любых прямых
  вызывающих;
- Engine не запускается, Apply Gate не применяет результат;
- Worker и повторные попытки используют тот же `recalculateProject`, поэтому
  запрет не обходится; job завершается ошибкой без изменения проекта;
- `applyProjectPriceHistory` (альтернативное сохранение результата) также
  отклоняет legacy-фасад.

### Сохранность истории

При блокировке не изменяются: `StoredProject.config`, сохранённая цена,
`priceHistory`, snapshots, pins; фиктивная запись пересчёта не создаётся.

После ручной замены:
1. старый проект открывается и показывает предупреждение;
2. пользователь выбирает ЛДСП / МДФ эмаль / МДФ ПВХ;
3. новая конфигурация сохраняется существующим `saveProject`;
4. пересчёт выполняется по актуальной опубликованной версии;
5. старая история сохраняется, новый результат добавляется существующим
   атомарным механизмом.

**Тесты:**
- `src/lib/server/projects.test.ts` — чтение `veneer`/`glass`/`solid`,
  сохранённая цена, блокировка пересчёта без изменения файла/конфига/цены/
  истории/pins, успешное сохранение и пересчёт после замены на МДФ;
- `src/lib/server/data-resolver.test.ts` — запрет recalculate в резолвере;
- `src/lib/admin/worker.integration.test.ts` — worker не пересчитывает
  legacy-фасад, job failed без изменений истории.

## Результаты проверки

Дата: 2026-11-11.

| Проверка | Результат |
| --- | --- |
| `npx vitest run` | 81 файл / 857 тестов — PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `src/lib/admin/apply-persistence.test.ts` | 5 тестов — PASS |
| Инвентаризация `data/formakub.db` | read-only, 5 legacy CatalogItem + 5 legacy PriceItem, Category A нет |

Архивирование проверялось только на временных тестовых хранилищах;
production-записи не изменялись.

## Ограничения CA-516

Не менялись: геометрия фасадов, формула площади, зазоры, фрезеровка, Gola,
shaker, handleless, коэффициенты себестоимости, архитектура Calculation
Admin, механизм истории проектов.

Не выполнялись: production DB-операции, архивирование production-записей,
массовая миграция проектов, удаление исторических данных, публикация цен,
переписывание snapshots и `priceHistory`. Инвентаризация выполнена
read-only; все проверки архивирования — на временных тестовых хранилищах.

## UNKNOWN

- Производственный ассортимент МДФ ПВХ: совпадение палитры с эмалью не
  подтверждает одинаковый набор декоров у поставщика.
- Наличие и состав legacy-записей в production SQLite вне локального
  `data/formakub.db` не проверялись; production-инвентаризация и архивация
  требуют отдельного разрешения владельца.
- Для legacy-фасадов ручная замена выполняется через создание новой
  сохранённой конфигурации существующим `saveProject`; отдельный механизм
  редактирования существующего проекта не вводился.

## Связанные документы

- `docs/CALCULATION_ADMIN/CA-515_MATERIALS_LEGACY_DECISIONS.md` — CA-515-03/
  04/06 продолжают действовать; CA-515-02 и CA-515-05 уточнены CA-516.
- `CALCULATION_ADMIN_IMPLEMENTATION_PLAN.md` — карточка CA-T-516.
- `docs/CALCULATION_ADMIN/CALCULATION_ADMIN_TECHNICAL_SPECIFICATION.md` —
  раздел 02.
- `docs/CALCULATION_ADMIN/MATERIALS_AND_FACADES_AUDIT.md` — исторический
  снимок; решения CA-516 имеют приоритет.
