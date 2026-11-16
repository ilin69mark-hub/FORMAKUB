# SINGLE SOURCE OF TRUTH AUDIT — Stage 9 / Block 2

**Дата:** 2026-11-12
**Статус:** диагностический аудит завершён; production-код не изменялся.
**Scope:** A — кухонный калькулятор, B — шкафной калькулятор, C — общая коммерческая инфраструктура.
**Навигация по prior art:** `FORMULA_AND_ALGORITHM_CATALOG.md` (103 записи), `TEST_COVERAGE_AUDIT.md` (Block 1), `CALCULATION_CORRECTNESS_AUDIT.md` (U-1…U-7). Полный повторный аудит Block 1 не проводился.

---

## 0. Методика (включая сопоставление реализаций)

- Потребители установлены по целевым поискам импортов (`pricing`, `engine`, `content/*`, `calculateBreakdown`, `calculatePrice*`), без полного сканирования репозитория.
- Сопоставление параллельных реализаций выполнено временным vitest-харнессом **вне постоянного кода**: 53 конфигурации (кухня: материалы/стили/ручки/столешницы/промокоды/кол-во модулей/опоры/подсветка/цоколь; шкаф: материалы/промокоды/размеры/ферн/LED/врезной фасад). Для каждого конфига: legacy `calculatePrice(config)` ↔ engine `calculateBreakdown(config, resolveCalculationInputs(...))` → `toPriceBreakdown`. Харнесс и отчёт удалены из репозитория (перенесены в `$TMPDIR/stage9/`); в репозитории нет следов.
- Ожидаемые значения на основе одной из сравниваемых реализаций **не создавались**: сравнение — попарная разность; все расхождения помечены `REQUIRES_DOMAIN_CONFIRMATION`.
- Результат: **53 случая, 48 полных совпадений, 5 расхождений, 0 ошибок Engine**. Плюс 8 golden-сценариев, где обе ветви независимо утверждены против одного `GOLDEN_EXPECTED` (provenance U-1: заголовок файла заявляет snapshot, а `regen-golden-tmp`/baseline генерируют через `calculatePrice` — эталон не независим от одной из сравниваемых ветвей). Совпадение на нескольких примерах **не объявляется** равенством реализаций.

---

## 1. Архитектурная карта источников данных

| Тип данных | Канонический источник (фактически) | Копии / кэши / исторические значения | Правило обновления |
|---|---|---|---|
| Актуальные тарифы (ставки) для runtime | `data/price-items.json` (PriceItem) + `data/pricing-versions.json` (опубликованная версия) → собираются в `PriceSnapshot` в `data-resolver.ts` | `src/content/pricing.ts:PRICING` (seed-источник: bootstrap/import копируют content → storage один раз; **legacy `pricing.ts` читает content напрямую**) | Редактирование только через Admin draft → publish; content не синхронизируется назад |
| Промокоды | `priceSnapshot.promos` (опубликованная версия, `data-resolver.ts:990`) | `content/pricing.ts:PROMOS` — читается сайтом (`PromotionsSection`) и legacy `pricing.ts` | Как тарифы; **два независимых списка после первого изменения в Admin** |
| Материалы/ручки/столешницы/опоры/LED (каталог) | `data/catalog-items.json` → `inputs.catalogs` (data-resolver) | `content/catalog.ts` (BODY_MATERIALS, FACADE_MATERIALS, COUNTERTOPS, HANDLES, KITCHEN_MODULES.basePrice…) — UI-подсказки и legacy | Bootstrap-seed; правки Admin живут только в storage |
| Технические параметры Engine (sink/supports/…) | `src/lib/server/parameter-registry.ts` — immutable manifest на `calcVersion` (CA-T-306B) | `sink.ts:SINK_RULES` (validation + legacy + тесты); константы в `supports.ts` | Меняется только вместе с `calcVersion`; паритет SINK_RULES ↔ manifest закреплён тестом (`sink.test.ts:1331–1339`), чистота Engine — `engine-purity.test.ts` |
| Лимиты конфигурации | `content/catalog.ts:KITCHEN_LIMITS/WARDROBE_LIMITS` (validation, UI) | Дублирующие inline-лимиты в `configurator/schema.ts` (zod `.max(25)`, `.min(100).max(320)` и т. п.) | Изменение content требует правки schema вручную (см. L-1) |
| Округление / minOrder / complexity | Engine: `priceSnapshot.rules` (rounding, minOrder, complexity*) | Legacy: `PRICING.rounding/minOrder/kitchen.*` | Bootstrap копирует правила из content в версию один раз; дальше живут раздельно (см. M-3) |
| calcVersion / schemaVersion | `src/lib/configurator/versions.ts` (`BUILD_CALC_VERSION = calc-2026.11.1`, `SUPPORTED_SCHEMA_VERSION = 2`) | У каждого сохранённого проекта своё значение | Только релиз; молчаливая перезапись запрещена (§5.4) |
| priceVersion | id опубликованной `PricingVersion` (storage) | У проекта: `StoredProject.priceVersion`; в `priceHistory` — from/to | Пересчёт блокируется при несовпадении (STALE_SOURCE_PRICE_VERSION) |
| Исторические снимки цен | **обоснованные копии (не дублирование):** `PriceSnapshot` в `CalculationInputs` (на каждый запрос), `StoredProject.price` (сохранённый breakdown), `project.priceHistory[]`, история `pricing-versions.json` | — | Назначение — воспроизводимость исторического состояния проекта |
| AdminParameter | `admin-parameters.json` (service `admin/parameters.ts`, seed `parameter-seed.ts`) | **Не участвует в runtime-разрешении**: data-resolver явно читает только parameter-registry (`data-resolver.ts:1101–1129`, тест «не читает live AdminParameter») | Редактируется в Admin; на Engine не влияет (так задумано по ADR-06) |

**Проверено источников/справочников:** 5 content-модулей + 4 storage-коллекции + parameter-registry + versions.ts + AdminParameter-сервис = **11 семейств**.

---

## 2. Карта расчётных реализаций

### Две полные параллельные ветви

| | Legacy: `configurator/pricing.ts` | Runtime: `configurator/engine.ts` |
|---|---|---|
| Вход | `FurnitureConfig` (+ опциональный неиспользуемый `inputs`) | `FurnitureConfig` + `CalculationInputs` (snapshot/catalogs/parameters) |
| Источник ставок | `content/pricing.ts:PRICING`, `PROMOS`, `content/catalog` (комментарий `pricing.ts:561`: «текущий источник — content») | `priceSnapshot`, `inputs.catalogs`, `inputs.parameters` |
| Выход | `PriceBreakdown` | `CalculationBreakdown` → `display-adapter.toPriceBreakdown` → `PriceBreakdown` |
| Kitchen | `calculateKitchenPrice` (pricing.ts:242) | `calculateKitchenBreakdown` (engine.ts:660) |
| Wardrobe | `calculateWardrobePrice` (pricing.ts:557) | `calculateWardrobeBreakdown` (engine.ts:900) |
| Production-потребители | **Нет** (см. §3) — только 3 геометрических helper в `validation.ts` | Все серверные пути (`projects.ts`, API, leads, admin worker) |
| Статус | Обозначен как legacy до CA-T-306E (`engine.ts:42–43`) | CA-T-306D Phase 3A |

### Общий слой (действительно общий, обе ветви)

`facade-geometry.ts`, `sink.ts`, `wardrobe-geometry.ts`, `wardrobe-facade-geometry.ts`, `wardrobe-hinges.ts`, `wardrobe-edge.ts`, `wardrobe-components.ts`, `materials.ts`, `geometry.ts`, `display.ts` — обе ветви импортируют одни и те же модули; расхождений в геометрическом ядре в матрице не найдено (48/53 и 8/8 golden совпали по геометрическим полям).

### Дублируемые фрагменты внутри ветвей (см. реестр §4)

`applyPromo`/`calculatePromo`, `roundMoney` (+ разные источники шага), `safe`, `area`, `kitchenRowPositions`, `kitchenModuleFacadeArea`, сборка `bodyCost`+`depthFactor`, `complexityFactor`, `minOrder`, supports (полная копия), lighting (полная копия).

---

## 3. Карта потребителей

### Production (18 точек входа — проверены)

| Потребитель | Откуда берёт параметры/тарифы | Как получает результат | Тип |
|---|---|---|---|
| `ConfiguratorStudio` (Store) | `useCalculationInputs` → POST `/api/calculation-inputs` | `calculatePriceFromInputs` → **engine** (`server/projects.ts:117`) | канонический сервис |
| `MiniConfigurator`, `Hero`, `LeadForm` (превью) | тот же API | **engine** | канонический сервис |
| `POST /api/projects` (save) | data-resolver → engine | **engine** | канонический сервис |
| `POST /api/projects/[id]/recalculate`, admin-версия | data-resolver (operation=recalculate, пины версий) | **engine** | канонический сервис |
| `POST /api/leads` | data-resolver | **engine** (`leads.ts:49`) | канонический сервис |
| `admin/worker` (RecalculationBatch) | `recalculateProject` → data-resolver | **engine** (`worker.ts:438`) | канонический сервис |
| `admin/publish-recalc`, `reconcile` | published version | **engine** (через worker) | канонический сервис |
| `validation.ts` (общий для save/recalc) | `KITCHEN_LIMITS/WARDROBE_LIMITS/SINK_RULES` + **3 helper из legacy pricing** (`kitchenTotalWidth`, `kitchenFloorModules`, `kitchenUpperModules` — геометрия, не ставки) | — | локальная реализация (геометрическая) |
| `PromotionsSection` (сайт) | **content `PROMOS`** | собственная отрисовка | **локальная копия данных** |
| `KitchenPanel` (подсказка цены пресета) | **content `KITCHEN_MODULES.basePrice`** (`KitchenPanel.tsx:311`) | собственная отрисовка | **локальная копия данных** |
| `SharedPanels` (подсказки ставок ₽/м², ₽/шт, ₽/м) | **content материалы/ручки/столешницы/цоколь** | собственная отрисовка | **локальная копия данных** |
| `admin/*_data/source.ts` (prices, projects, admin) | `getPublishedVersion()` (admin/pricing.ts) | storage | канонический сервис |
| `data-resolver` | storage (price/catalogs) + parameter-registry | собирает `CalculationInputs` | канонический сервис |
| `migrations.ts` | нормализация config | результат хранит, цену не пересчитывает | исторический снимок |

### Тесты (оракулы)

- **22 тестовых файла** используют legacy `calculatePrice/calculateKitchenPrice` как источник ожидаемых значений (configurator: pricing, baseline, golden, sink, supports, lighting, facade-geometry, wardrobe-*; server: migrations, projects; admin: presets, history, apply-persistence, release-gate, mass, bootstrap.apply и др.).
- Engine покрыт `golden-engine.test.ts` (8 golden + guard-ы) и API-тестами.
- **Вывод:** legacy-ветвь живёт в основном как тестовый оракул; единственный production-выход legacy — три геометрических helper в `validation.ts` (не коммерческие).

---

## 4. Реестр дублирования и параллельных реализаций

| ID | Что дублируется | Реализации | Потребители | Одинаковый вход/семантика? | Могут ли результаты различаться? | Каноническая | Причина сохранять несколько | Приоритет |
|---|---|---|---|---|---|---|---|---|
| D-1 | Полная расчётная ветвь кухни | `pricing.ts:calculateKitchenPrice` ↔ `engine.ts:calculateKitchenBreakdown` | legacy → тесты+3 helper; engine → весь runtime | **Нет** (content vs snapshot; см. §5 D1) | **Да — доказано** | `engine.ts` (CA-T-306D, все production-потребители) | Миграция не завершена (CA-T-306E); golden и 22 теста привязаны к legacy | **HIGH** |
| D-2 | Расчётная ветвь шкафа | `pricing.ts:calculateWardrobePrice` ↔ `engine.ts:calculateWardrobeBreakdown` | то же | Ставки разные источники; в матрице совпали | Теоретически да, практически не доказано | `engine.ts` | то же | **HIGH** (часть D-1) |
| D-3 | supports | `supports.ts:computeSupports` ↔ `engine.ts:supportPlanned` (приватная копия, engine.ts:305) | legacy+тесты ↔ engine-runtime | Разные источники параметров (content/catalog ↔ `inputs.parameters`) | Да, возможны (Block 1: мутант M17 в `supports.ts` SURVIVED — поведение слабо закреплено тестами) | `engine.ts:supportPlanned` для runtime; `supports.ts` — устаревающий | до консолидации CA-T-306E | **HIGH** |
| D-4 | lighting | `lighting.ts:computeLighting` ↔ `engine.ts:lightingPlanned` (приватная копия, engine.ts:476) | legacy+тесты ↔ engine-runtime | **Нет** — см. §5 D1 | **Да — доказано** | `engine.ts:lightingPlanned` для runtime | — | **HIGH** |
| D-5 | Промокоды | `content:PROMOS` (legacy + сайт) ↔ `snapshot.promos` (engine) | сайт/legacy ↔ engine | Пока совпадают (bootstrap-seed) | Да, после первого Admin-изменения | `snapshot.promos` для применения; content — seed | content остаётся seed-источником импорта | **HIGH** |
| D-6 | Ставки материалов и пресетов | content (UI-подсказки: `KitchenPanel.basePrice`, `SharedPanels.ratePerSqm/rate`, plinth/counter rates) ↔ storage PriceItem (engine) | UI ↔ engine | Пока равны (seed) | Да, после правки в Admin | storage PriceItem | content — seed; UI показывает не то, что оплачивается | **MEDIUM** |
| D-7 | Параметры мойки | `sink.ts:SINK_RULES` (validation/legacy/тесты) ↔ parameter-registry `engine.sink.*` (engine) | validation ↔ engine | **Да — закреплено тестом** (`expect(rules).toEqual(SINK_RULES)`), purity-тест запрещает engine читать `SINK_RULES` | Только при правке одной стороны без другой (тест упадёт) | parameter-registry для Engine; SINK_RULES для validation | разделение «технический параметр сборки ↔ устаревающий default» | **MEDIUM** |
| D-8 | Округление/minOrder/complexity | `PRICING.rounding/minOrder/kitchen.*` ↔ `priceSnapshot.rules` | legacy ↔ engine | Изначально равны (bootstrap копирует) | Да, после публикации версии с изменёнными правилами | `priceSnapshot.rules` | bootstrap-seed | **MEDIUM** |
| D-9 | Мелкие помощники: `applyPromo`+`calculatePromo`, `roundMoney`, `safe`, `area`, `kitchenRowPositions`, `kitchenModuleFacadeArea`, `bodyCost`+`depthFactor`, `complexityFactor`, `minOrder` | по 2 копии (pricing.ts ↔ engine.ts) | по той же схеме | Формально похожи; `applyPromo` — текст reason различается (§5 D2) | В мелочах — да; крупных расхождений в матрице, кроме D1, нет | engine | дубль возник при форке ветви | **MEDIUM** |
| D-10 | Лимиты конфигурации | content `KITCHEN_LIMITS/WARDROBE_LIMITS` ↔ inline-числа в `configurator/schema.ts` | validation/UI ↔ zod-вход | Разные границы (напр. schema шкаф height 100–320 vs limits 180–270) | Результат не расходится: schema пропускает шире, validation отсекает позже | content limits для предметных правил; schema — форма ввода | слоистая валидация | **LOW** |
| D-11 | Дом формул | `FORMULA_REGISTRY`/`dependency-map`/`formulas.test` указывают `calculatePrice`/`calculateKitchenPrice` → `pricing.ts` | admin-UI/аудит формул | — | Нет (документация) | фактический runtime — `engine.ts` | реестр не обновлён после CA-T-306D | **LOW** |

**Обоснованные исторические копии (дублированием НЕ считаются):** `StoredProject.price`, `project.priceHistory[]`, per-request `PriceSnapshot` в `CalculationInputs`, история опубликованных `PricingVersion`.

---

## 5. Обнаруженные расхождения

### D1 — Подсветка при отсутствии верхнего ряда: **доказано и исправлено** (`DOMAIN_CONFIRMED` в Block 3, **исправлено в Block 4**)

- **Вход:** валидная кухня (3–4 модуля, все нижние; `KITCHEN_LIMITS.minModules = 2`, `minTotalWidth = 80` — конфиг проходит validation), `underCabinetLighting: true`.
- **Legacy:** `lighting.ts:245` — все компоненты (включая БП и управление) внутри `if (lengthM > 0)` → при нулевой длине ленты `cost = 0`, строка «Подсветка верхнего ряда» = 0.
- **Engine:** `engine.ts:628–637` — `psuAmount` и `controlAmount` прибавляются безусловно → при той же нулевой длине `cost = 1730 ₽` (БП 950 + управление 780), при этом длина ленты/профиля/монтажа = 0.
- **Наблюдение:** `subtotal` и `total` различаются на 1730 ₽ (118000 ↔ 119700), при percent-промокоде расхождение усиливается разным округлением скидки (148900 ↔ 150500).
- **Матрица:** 5 из 53 случаев (все — кухни без верхнего ряда), 0 ошибок; wardrobe-расхождений не найдено (11+ случаев + 8 golden — совпали).
- **Кто в runtime:** только engine → **в production начисляется 1730 ₽ за БП и управление при нулевом метраже ленты**.
- **Решение владельца (Block 3, `DOMAIN_CONFIRMED`):** без верхних модулей стоимость подсветки обязана быть 0 ₽ — БП, контроллер и прочие компоненты при нулевой длине ленты не начисляются. **Исправлено в Block 4:** `engine.ts lightingPlanned` при `lengthM = 0` возвращает нулевой комплект. Тест переведён из `it.fails` в обычный (`src/lib/configurator/led-domain.test.ts`); вместе с исправлениями R1 и R6 расхождение паритета legacy ↔ Engine по D1 устранено.

### D2 — Текст причины промокода при нехватке minSubtotal

- Legacy: `formatRub(promo.minSubtotal)` (`pricing.ts:221`); Engine: `${definition.minSubtotal} ₽` (`engine.ts:202`).
- Пользовательски видимая строка различается по форматированию; расчёт скидки совпадает. Legacy не используется в production → **LOW**.

### D3 — Следствие D1 для discount/total при percent-промо

- Техническое следствие D1 (округление процента от разного subtotal). Отдельной причиной не является.

### Не найдено (зафиксировано отрицательным результатом)

- Расхождений в геометрии фасадов/шкафа/мойки между ветвями в матрице не обнаружено (общий слой).
- Параллельных production-путей расчёта, дающих разные цены клиенту, **нет**: все 13 серверных/клиентских точек получения цены идут через один `data-resolver → calculateBreakdown`.
- Живых копий актуальных коммерческих правил в отдельных сервисах не найдено: worker/recalc/publish используют общий `data-resolver` и `getPublishedVersion()`.

---

## 6. Подтверждённые канонические источники

| Область | Канонический источник | Основание подтверждения |
|---|---|---|
| Коммерческие ставки runtime | Опубликованная `PricingVersion` (storage) → `PriceSnapshot` через `data-resolver` | Единственный путь всех production-потребителей; `getPublishedVersion()` — единая точка чтения (`admin/pricing.ts:131`), «дублирующие API не создаются» (`read.ts:15`) |
| Геометрия фасадов/мойки/шкафа | Общий слой: `facade-geometry.ts`, `sink.ts`, `wardrobe-*.ts` | Обе ветви импортируют одни модули; расхождений в матрице нет |
| Технические параметры Engine | `parameter-registry.ts` (immutable manifest на calcVersion) | data-resolver читает только его (`:1101–1129`); purity-тест; fail-closed парсер `sinkRulesFromParameters` |
| Входная валидация config | `schema.ts` (zod) + `validation.ts` (предметные правила), оба на общих LIMITS | Все API/save/recalc проходят через `safeParseConfig`/`validateConfig` |
| calcVersion / schemaVersion | `versions.ts` | Единственное объявление; хранение проектов не переписывает |
| priceVersion / пересчёт | `admin/pricing.ts` (draft≤1, published — единственная активная) + блокировки в `projects.ts`/`worker.ts` | STALE_SOURCE_PRICE_VERSION / COMPLETED_WRONG_PRICE_VERSION в tests |
| Округление, minOrder, complexity (runtime) | `priceSnapshot.rules` | engine читает только snapshot (`engine.ts:131–140`) |

**Не подтверждено:** каноничность legacy `pricing.ts` как оракула тестов (фактически — исторический, не канонический: см. D1); источник промокодов для сайта (D-5); отображаемые UI-ставки (D-6).

---

## 7. Неопределённости и вопросы доменного подтверждения

1. **`DOMAIN_CONFIRMED` (D1, решение получено в Block 3, исправлено в Block 4):** без верхних модулей LED-позиции и стоимость подсветки обязаны быть 0 ₽. Правило реализовано в `engine.ts` (нулевой комплект при `lengthM = 0`), в `defaults.ts normalizeKitchen` (R6: автогашение опции) и в UI (R1: блокировка + подсказка); закрыто тестами `led-domain.test.ts`.
2. **`REQUIRES_DOMAIN_CONFIRMATION` (D-5):** должен ли сайт рекламировать промокоды из content или из опубликованной версии?
3. **`REQUIRES_DOMAIN_CONFIRMATION` (D-6):** должны ли UI-подсказки ставок (₽/м² и т. п.) отражать актуальные PriceItem или seed-content?
4. Судьба legacy-ветви до CA-T-306E: продолжать использовать как тестовый оракул (риск — тесты не увидят D1-класс расхождений) или переводить golden на engine — решение владельца (влияет на план консолидации §9).
5. Требование «golden = снимок» (U-1) формально фиксирует один из расчётных путей как эталон (генерация — через `calculatePrice`); с D1 это противоречит факту, что runtime — engine.

---

## 8. Риски сохранения текущей архитектуры

- **R-1 (HIGH):** тестовый оракул (legacy) и runtime (engine) — независимые реализации; расхождения класса D1 невидимы для тестов вне 8 golden-сценариев. Обновление любой ветви может пройти CI, изменив цену для клиентов или сломав ожидания.
- **R-2 (HIGH):** приватные копии supports/lighting в `engine.ts` развиваются без собственных тестов (Block 1: M17/M18 выжили); правка `supports.ts`/`lighting.ts` не задевает runtime, и наоборот — легко создать «тихое» расхождение.
- **R-3 (HIGH):** два независимых списка промокодов (сайт vs engine) — пользователь видит объявление, которое Engine может не применить (active/minSubtotal/appliesTo расходятся после публикации).
- **R-4 (MEDIUM):** UI-подсказки ставок из content расходятся с фактическим начислением из PriceItem после правок в Admin.
- **R-5 (MEDIUM):** `admin`-реестр формул указывает на `pricing.ts` — аудит/документация формул описывает не тот код, который считает в production.
- **R-6 (LOW):** двойная запись лимитов (schema inline vs content LIMITS) — правка требует двух изменений; итог не расходится из-за слоистой валидации.
- **Не является риском:** исторические снимки (`StoredProject.price`, `priceHistory`, per-request snapshot, история версий) — обоснованы требованиями воспроизводимости.

---

## 9. Предложения по консолидации (оценка влияния, БЕЗ реализации в этом блоке)

| # | Предложение | Влияние | Риск | Предпосылки |
|---|---|---|---|---|
| C-1 | Закрыть D1 одним подтверждённым решением владельца и закрепить тестом на кухне без верхнего ряда (в обеих ветвях или только engine) | устраняет доказанное расхождение; +1–2 теста | низкий (тест + одно поведение) | решение домена (§7.1) |
| C-2 | Перевести golden-эталоны и legacy-тесты-оракулы на engine-выход (CA-T-306E), оставив legacy на reads-only или удалив после паритета | устраняет R-1; большой объём переписывания ожиданий | средний: запрет «подгонки» expected требует независимого подтверждения | решение домена (§7.4), C-1 |
| C-3 | Вынести supports/lighting из приватных копий engine в один общий модуль с входом `CalculationInputs` | устраняет D-3/D-4 и R-2 | средний (runtime-код, требует полного parity-прогона) | C-2 (общий оракул) |
| C-4 | Один источник промокодов для сайта: рендерить PromotionsSection из опубликованной версии (server component → `getPublishedVersion`) | устраняет R-3 | низкий | нет |
| C-5 | UI-подсказки ставок брать из разрешённых PriceItem (или помечать как «seed-ориентир») | устраняет R-4 | низкий–средний (UI) | нет |
| C-6 | Обновить FORMULA_REGISTRY/dependency-map на `engine.ts` как runtime-канон (с пометкой legacy) | устраняет R-5, честный аудит формул | низкий (документация/реестр) | нет |
| C-7 | Слить `applyPromo`/`roundMoney`/`kitchenRowPositions`/`kitchenModuleFacadeArea` в общий модуль | устраняет D-9 | низкий, пока ветви не слиты — преждевременно | C-2/C-3 |
| C-8 | Привести inline-лимиты schema к content-константам (одна запись) | устраняет D-10/ R-6 | низкий | аккуратность: schema может быть шире намеренно |

## 10. Порядок возможной консолидации (без потери истории и совместимости)

1. **Решения домена** (§7.1–7.5) — без них любая консолидация закрепит одно из двух поведений вслепую.
2. **C-1** — зафиксировать текущее подтверждённое поведение тестами (не меняя формулы до решения).
3. **C-6, C-4, C-5, C-8** — низкорисковые «бесшовные» шаги: меняют только источники отображения/документацию; схемы хранения, версии и расчётные результаты не затрагивают.
4. **C-3** — вынос общих supports/lighting с обязательным двойным прогоном (legacy + engine) на большой матрице конфигов; расхождения класса D1 допустимы только после явного подтверждения.
5. **C-2 (CA-T-306E)** — перевод golden/тестовых оракулов на engine; только после C-1 и C-3, чтобы эталон был один. `calcVersion` при изменении runtime-правил — только релизной процедурой (§5.2); старые проекты продолжают читаться по своему `calcVersion`/`priceVersion`, history-снимки не трогаются.
6. **Удаление legacy `pricing.ts`** — финальный шаг, после того как оракулы переведены, а `validation.ts` перестанет импортировать геометрические helper (перенести их в общий геометрический слой).
7. На каждом шаге — полная верификация (`npx vitest run`, `npm run typecheck`, `npm run lint`) и проверка, что `StoredProject.price`/`priceHistory` старых проектов не пересчитываются молча.

---

## Приоритетный реестр проблем (итог)

- **CRITICAL — 0.** Два production-пути с разными коммерческими результатами не обнаружены: все production-потребители считают через один engine.
- **HIGH — 5:** D-1, D-2 (полные параллельные ветви, доказанное расхождение D1 — фактически одна задача консолидации), D-3 (supports), D-4 (lighting), D-5 (два списка промокодов).
- **MEDIUM — 4:** D-6 (UI-ставки из content), D-7 (SINK_RULES ↔ manifest), D-8 (rounding/minOrder два источника), D-9 (мелкие помощники).
- **LOW — 3:** D-10 (лимиты schema ↔ content), D-11 (FORMULA_REGISTRY → pricing.ts), текст `promo.reason` в legacy (§5 D2).

## Верификация блока

- `npx vitest run` → **94 файла / 948 тестов PASS** (временный parity-харнесс удалён из репозитория).
- `npm run typecheck` → PASS (без ошибок).
- `npm run lint` → PASS (без замечаний).
- Production-код **не изменён**: в этой сессии создавался только временный тестовый файл, перенесённый вне репозитория; `git status` содержит только предсуществующие изменения (зафиксированы в Block 1); остаточных мутаций/патчей нет.
