# Аудит материалов и расчёта фасадов

Дата: 2026-11-10. Статус: **AUDIT SNAPSHOT до CA-T-514**.
**Обновление CA-T-518 (2026-11-11):** утверждённые зазоры кухни и мойки зафиксированы: верх/низ 2 мм, соседний модуль 1 мм, открытый край 2 мм, между створками/фасадами 2 мм суммарно. Центральный зазор исправлен с 1 мм до 2 мм (0,2 см); фасады ящиков уже соответствовали правилам. Конструкция шкафа и `facadeGap = 0,25` не менялись.
**Обновление CA-T-517 (2026-11-11):** фактическая геометрия створок вынесена в `src/lib/configurator/facade-geometry.ts`; цена фасадов кухни и шкафа считается по площади створок, а не модуля/секции. Пункты A-02, A-03 и A-04 ниже закрыты для цены и 2D; зазоры кухни и мойки утверждены в CA-T-518, OI-003 по шкафу остаётся. Решения и контрольные примеры: `docs/CALCULATION_ADMIN/CA-517_FACADE_GEOMETRY_DECISIONS.md`.
**Обновление CA-T-516 (2026-11-11):** палитры МДФ эмаль/ПВХ сведены к единому источнику; legacy-записи с историческими зависимостями не архивируются, а пересчёт legacy-фасадов запрещён до ручной замены. Актуальные решения: `docs/CALCULATION_ADMIN/CA-516_LEGACY_CATALOG_AND_RECALC_DECISIONS.md`; исторические пометки «удалить» ниже не являются текущим планом. Утверждённые решения по legacy и материалам: `docs/CALCULATION_ADMIN/CA-515_MATERIALS_LEGACY_DECISIONS.md`. Код, формулы, цены, справочники, golden fixtures, пользовательские проекты и production DB в рамках аудита не изменялись. Часть фактического состояния (состав materials) после CA-T-514 изменена; см. `CALCULATION_ADMIN_IMPLEMENTATION_PLAN.md` и обновлённые BOM-документы.

Обозначения:
- **OWNER** — правило задано владельцем в постановке.
- **CONFIRMED (code)** — фактическое поведение кода.
- **UNKNOWN** — производственное значение/правило отсутствует или не подтверждено.
- **DEAD** — значение объявлено, но в расчёте не используется.

---

## 1. Карта материалов и зависимостей

### 1.1. Корпус

Целевая модель (**OWNER**): только ЛДСП, толщина 16 мм, материал фиксирован, пользователь его не выбирает.

Фактическая модель (**CONFIRMED (code)**):
- `BODY_MATERIALS` содержит `ldsp`, `mdf`, `plywood` (`src/content/catalog.ts`).
- Материал выбирается в UI `MaterialsPanel` (`src/components/configurator/SharedPanels.tsx`).
- Ставки: ЛДСП 5 200 ₽/м², МДФ 7 600 ₽/м², фанера 9 200 ₽/м².
- Default: кухня — `mdf`, шкаф — `plywood` (`src/lib/configurator/defaults.ts`).
- Толщина корпуса в конфиге отсутствует. Для мойки жёстко заданы `sidePanel = 1.6 см` и `partition = 1.6 см` (`src/lib/configurator/sink.ts`).

Цепочка зависимостей `bodyMaterial`:

| Слой | Файлы / символы | Что делает |
|---|---|---|
| Типы | `src/lib/configurator/types.ts` — `BodyMaterialId`, `KitchenConfig.bodyMaterial`, `WardrobeConfig.bodyMaterial` | id в конфиге |
| Схемы | `src/lib/configurator/schema.ts` — enum `["ldsp","mdf","plywood"]` в kitchen/wardrobe | strict-валидация и default-поля |
| Defaults | `src/lib/configurator/defaults.ts` — `bodyMaterial: "mdf"` (kitchen), `"plywood"` (wardrobe) | значения по умолчанию |
| UI | `src/components/configurator/SharedPanels.tsx` — `BODY_MATERIALS.map`, `SwatchField` | выбор материала и цвета |
| 2D | `KitchenScene.tsx`, `WardrobeScene.tsx` — `finishFor(BODY_MATERIALS, …)` | цвет корпуса |
| Legacy-цена | `src/lib/configurator/pricing.ts` — `bodyRate`, `calculateKitchenPrice`, `calculateWardrobePrice` | `moduleArea × bodyRate × depthFactor` |
| Engine | `src/lib/configurator/engine.ts` — `catalog(inputs,"bodyMaterial",…)`, `priceRef(...,"ratePerSqm")` | runtime-цена |
| DataResolver | `src/lib/server/data-resolver.ts` — `baseCatalogRefs` | разрешение `bodyMaterial` |
| Pins | `src/lib/admin/pins.ts` — `configCatalogReferences` | фиксация версии материала |
| Admin schemas | `src/lib/admin/schema.ts` — `bodyMaterial` в `CatalogKind` | справочник |
| Admin bootstrap | `src/lib/admin/bootstrap.ts` — создаёт 3 `CatalogItem` + priceRefs | сид справочника |
| Admin import | `src/lib/admin/import.ts` — `catalog.body.*.ratePerSqm` | импорт ставок |
| Admin map/UI | `src/lib/admin/dependency-map.ts`, `reference-ui.ts`, `src/app/admin/catalogs/page.tsx` | карта зависимостей и экран |
| Display | `src/lib/admin/display-metadata.ts` — `kitchen.body`, `wardrobe.body` labels | подпись материала |
| Tests | `golden.fixtures.ts` (plywood), `pricing.test.ts` (ldsp), fixtures/defaults | эталоны |
| Документы | `MATERIAL_COST_MODEL_MASTER_PLAN.md` §6.1, `BOM_BASE_MODULE.md` | BOM/ставки |

Вывод: для фиксированного ЛДСП можно убрать выбор материала, две ставки, два Admin `CatalogItem`/PriceItem и связанные ветки. Старые `mdf`/`plywood` в сохранённых проектах требуют миграционного правила, а не удаления истории.

### 1.2. Фасады

Целевая модель (**OWNER**): ЛДСП, МДФ эмаль, МДФ плёнка ПВХ. Шпон, стекло, массив удалить.

Фактическая модель (**CONFIRMED (code)**): `ldsp`, `mdf` («МДФ в эмали»), `veneer`, `glass`, `solid`.

| ID | Ставка, ₽/м² | Толщины | Default thickness | Статус относительно цели |
|---|---:|---|---:|---|
| `ldsp` | 5 600 | 16, 18 | 16 | оставить |
| `mdf` | 8 400 | 16, 19, 22 | 19 | только эмаль; плёнка ПВХ отсутствует |
| `veneer` | 11 800 | нет | — | удалить |
| `glass` | 14 400 | нет | — | удалить |
| `solid` | 18 600 | нет | — | удалить |

Важно:
- Отдельного `mdf_pvc`/`mdf_film` нет. Нельзя подтвердить, что толщины 16/19/22 применяются к обоим вариантам МДФ: сейчас список привязан к единственному `mdf`.
- Для `veneer/glass/solid` нет утверждённого списка толщин; CA-T-513 использует для них фактическое значение/19 мм. Это **UNKNOWN** относительно производственной модели.
- Визуальные ветки `glass` есть в `WardrobeScene.tsx` (`isGlass`), `SharedPanels.tsx` (запрет shaker) и `validation.ts` (glass+shaker).
- `FACADE_MATERIALS` используется в `MiniConfigurator` только для получения палитры `mdf`.

Цепочка зависимостей `facadeMaterial` и `facadeStyle`:

| Слой | Файлы / символы |
|---|---|
| Типы | `types.ts` — `FacadeMaterialId`, `FacadeStyle` |
| Схемы | `schema.ts` — оба enum в kitchen/wardrobe |
| Каталог | `catalog.ts` — `FACADE_MATERIALS`, `FACADE_STYLES`, `facadeThicknesses`, `snapFacadeThickness` |
| Defaults | `defaults.ts` — кухня `mdf`, шкаф `veneer`; `defaultWardrobe` использует `veneer` |
| UI | `SharedPanels.tsx` — карточки материалов, толщина, стиль, glass-ограничения; `MiniConfigurator.tsx` — палитра `mdf` |
| 2D | `KitchenScene.tsx` — цвет фасада (без визуализации shaker/handleless); `WardrobeScene.tsx` — цвет, `isGlass`, рамка shaker |
| Валидация | `validation.ts` — только `glass + shaker` |
| Legacy-цена | `pricing.ts` — `facadeRate`, `styleMultiplier`, `frontsCost` |
| Engine | `engine.ts` — `catalog(... "facadeMaterial"/"facadeStyle")`, `priceRef(...,"ratePerSqm"/"multiplier")` |
| DataResolver / pins | `data-resolver.ts`, `pins.ts` |
| Admin | `bootstrap.ts`, `import.ts`, `dependency-map.ts`, `schema.ts`, `reference-ui.ts`, `admin/catalogs/page.tsx` |
| Display | `display-metadata.ts` — `wardrobe.fronts` подпись материала; `kitchen.fronts` подписи материала нет |
| Tests | `golden.fixtures.ts` (solid/glass), `pricing.test.ts` (solid), `validation.test.ts` (glass+shaker) |
| Документы | `MATERIAL_COST_MODEL_MASTER_PLAN.md` §6.2, `MODULE_BOM_CATALOG.md`, `CALCULATION_CORRECTNESS_AUDIT.md` |

### 1.3. Что можно убрать после решения владельца

1. Выбор `bodyMaterial` в UI и две лишние ставки/справочника; заменить константой `ldsp`.
2. `veneer`, `glass`, `solid` из `FacadeMaterialId`, схем, UI, Admin, тестов и документации.
3. Спецветку `glass + shaker` в `validation.ts` и `isGlass` в `WardrobeScene.tsx`.
4. Мёртвые коэффициенты: `countertopDepthAllowance`, `plinthPerMeter` (кухня), `underCabinetLightPerMeter`, `sinkPartition` — после подтверждения, что они не нужны как история.
5. Дублирующие источники material/style rates (`content/catalog.ts` и Admin PriceItem) — только после миграции чтения.

---

## 2. Реестр коэффициентов

### 2.1. Ставки материалов (не коэффициенты, но умножители цены)

| Название / код | Смысл | Формула | Влияние | Источник | Дублирование |
|---|---|---|---|---|---|
| `BODY_MATERIALS.ldsp.ratePerSqm = 5200` | цена корпуса ЛДСП, ₽/м² | `moduleArea × rate × max(0.5, depth/60)` | 60×85, d55.8: 2 466,36 ₽ material; +8 200 base = 10 666,36 | справочник; производственное подтверждение UNKNOWN | Admin `catalog.body.ldsp.ratePerSqm` |
| `BODY_MATERIALS.mdf.ratePerSqm = 7600` | МДФ корпус | то же | 3 604,68 ₽; +1 138,32 к ЛДСП | UNKNOWN | Admin PriceItem |
| `BODY_MATERIALS.plywood.ratePerSqm = 9200` | фанера | то же | 4 363,56 ₽; +1 897,20 к ЛДСП | UNKNOWN | Admin PriceItem |
| `FACADE_MATERIALS.ldsp.ratePerSqm = 5600` | ЛДСП фасад | `area × rate × style` | 60×85: 2 856 ₽ flat | UNKNOWN / справочник | Admin `catalog.facade.ldsp.ratePerSqm` |
| `FACADE_MATERIALS.mdf.ratePerSqm = 8400` | МДФ эмаль | то же | 4 284 ₽ flat | UNKNOWN / справочник | Admin PriceItem |
| `FACADE_MATERIALS.veneer.ratePerSqm = 11800` | шпон | то же | 6 018 ₽ flat | UNKNOWN; к удалению | Admin PriceItem |
| `FACADE_MATERIALS.glass.ratePerSqm = 14400` | стекло | то же | 7 344 ₽ flat | UNKNOWN; к удалению | Admin PriceItem |
| `FACADE_MATERIALS.solid.ratePerSqm = 18600` | массив | то же | 9 486 ₽ flat | UNKNOWN; к удалению | Admin PriceItem |

### 2.2. Коммерческие коэффициенты

| # | Название / код | Смысл | Формула | Влияет на | Числовой пример (60×85 = 0,51 м²) | Источник | Дублирование |
|---|---|---|---|---|---|---|---|
| 1 | `FACADE_STYLES.flat.multiplier = 1` | базовый ровный фасад | `frontsCost = area × facadeRate × multiplier` | фасады | МДФ: 4 284 ₽ | historical; смысл подтверждён как «без фрезеровки» | Admin `catalog.facadeStyle.flat.multiplier` |
| 2 | `FACADE_STYLES.shaker.multiplier = 1.16` | рамочный/профильный фасад | то же | фасады | МДФ: 4 969,44 ₽; **+685,44 ₽** к flat | **UNKNOWN**; не привязан к толщине/материалу | Admin PriceItem; потенциально дублирует будущую фрезеровку |
| 3 | `FACADE_STYLES.handleless.multiplier = 1.08` | безручечный/профиль | то же | фасады | МДФ: 4 626,72 ₽; **+342,72 ₽** к flat | **UNKNOWN**; может быть Gola/фрезеровка | Admin PriceItem; потенциально дублирует `HANDLES.profile` |
| 4 | `HANDLES.bar.rate = 780` | ручка-скоба | `doors × rate` в fittings | фурнитура | 1 дверь: 780 ₽ | справочник; UNKNOWN | Admin `catalog.handle.bar.rate` |
| 5 | `HANDLES.knob.rate = 560` | ручка-кнопка | то же | фурнитура | 560 ₽ | UNKNOWN | Admin PriceItem |
| 6 | `HANDLES.profile.rate = 1450` | врезной профиль | `doors × rate` | фурнитура | 1 дверь: 1 450 ₽ | UNKNOWN; возможно Gola | Admin PriceItem; потенциально дублирует `handleless 1.08` |
| 7 | `HANDLES.none.rate = 0` | без ручки | 0 | фурнитура | 0 | CONFIRMED | — |
| 8 | `PRICING.kitchen.bodyDepthReference = 60` | база пересчёта глубины корпуса | `depthFactor = depth/60`, floor 0,5 | корпус | 60×85 ЛДСП: d60 2 652 ₽; d55,8 2 466,36 ₽; d40 1 768 ₽ (фактор 0,667) | historical UNKNOWN | `PricingVersion.rules` |
| 9 | `PRICING.wardrobe.bodyDepthReference = 60` | то же для шкафа | `depthFactor = depth/60` | корпус шкафа | зависит от площади/глубины | historical UNKNOWN | rules |
| 10 | `PRICING.wardrobe.bodyFactor = 1.15` | надбавка корпуса шкафа | `totalArea × bodyRate × depthFactor × 1.15` | корпус шкафа | +15 % к material | **UNKNOWN** | rules; не дублирует напрямую |
| 11 | `PRICING.kitchen.complexityPerExtraModule = 0.02` | +2 % за модуль свыше 3 | `min(1.12, 1 + 0.02×max(0,N−3))` | весь subtotal, включая фасады | 4 модуля: ×1,02; фасады 4 284 → 4 369,68 | historical UNKNOWN | rules |
| 12 | `PRICING.kitchen.complexityMax = 1.12` | предел сложности | то же | весь subtotal | 9 модулей → ×1,12 | historical UNKNOWN | rules |
| 13 | `PRICING.kitchen.countertopDepthAllowance = 0.04` | не используется | — | ничего | 0 | **DEAD**; единица не документирована | — |
| 14 | `PRICING.kitchen.plinthPerMeter = 1600` | устаревшая ставка цоколя кухни | не используется (кухня берёт `content/plinth.ts`) | ничего | 0 | DEAD | дублирует `content/plinth.ts` |
| 15 | `PRICING.kitchen.underCabinetLightPerMeter = 1900` | устаревшая подсветка | не используется (компонентная спецификация) | ничего | 0 | DEAD | дублирует lighting spec |
| 16 | `PRICING.kitchen.sinkPartition = 2400` | перегородка мойки | не используется; в коде перегородки не тарифицируются | ничего | 0 | DEAD | — |

### 2.3. Геометрические константы фасадов (влияют на отображение, не на цену)

| Название | Значение | Где | Смысл | Дублирование |
|---|---:|---|---|---|
| `EDGE_GAP` | 0,2 см | `KitchenScene.tsx` | зазор у края ряда | совпадает с `SINK_RULES.facadeEdgeGap` |
| `NEIGHBOR_GAP` | 0,1 см | `KitchenScene.tsx` | зазор к соседнему модулю | совпадает с `SINK_RULES.facadeNeighborGap` |
| `FACADE_DOOR_GAP_CM` | 0,2 см | `facade-geometry.ts` | зазор между створками: 2 мм суммарно (CA-T-518) | единый источник; `SINK_RULES.facadeInnerGap` ссылается на него |
| `doorGap` | 0,55 см | `WardrobeScene.tsx` | зазор между дверями шкафа | отдельное значение |
| `SINK_RULES.sidePanel` | 1,6 см | `sink.ts` | толщина боковины (ЛДСП 16) | совпадает с body 16, но не связано с моделью корпуса |
| `SINK_RULES.partition` | 1,6 см | `sink.ts` | толщина перегородки | то же |
| `SINK_RULES.facadeGap` | 0,25 см | `sink.ts` | зазор створки | — |
| `SINK_RULES.mountEdge` | 50 мм | `sink.ts` | монтажный отступ мойки | — |

---

## 3. Текущая формула фрезеровки

**Факт:** отдельной фрезеровки в коде нет.

Текущая цена фасада:
```
frontsCost(module) = moduleArea × facadeRate × styleMultiplier
moduleArea = widthCm × heightCm / 10000
```
Для рамочного фасада единственное отличие — `styleMultiplier = 1.16`:
```
frontsCost(shaker) = area × facadeRate × 1.16
```
Ни длины фрезерования, ни числа сторон, ни толщины, ни ограничения «только МДФ 19/22» в формуле нет.

Числовой пример (базовый модуль 60×85 см, 0,51 м², МДФ 8 400 ₽/м²):
```
flat:       0,51 × 8 400 × 1,00 = 4 284,00 ₽
shaker:     0,51 × 8 400 × 1,16 = 4 969,44 ₽
разница:                         685,44 ₽
```
Если интерпретировать разницу как фрезеровку по периметру одной створки:
```
периметр 2×(0,60+0,85) = 2,9 м
производная ставка = 685,44 / 2,9 ≈ 236,36 ₽/м
```
Это **не тариф**, а только обратная оценка. Официальная ставка, база расчёта (одна/две стороны, периметр/длина рамки) и применимость — **UNKNOWN**.

Проблемы:
- `shaker` разрешён для ЛДСП, шпона, массива и МДФ 16 мм; целевая модель — только МДФ 19/22.
- Стоимость не зависит от толщины 19 vs 22 и от числа сторон.
- При добавлении погонного тарифа коэффициент 1.16 станет двойным начислением, если его не удалить/не переопределить.

---

## 4. Текущая формула Gola

**Факт:** Gola в коде отсутствует. Нет ни `gola`, ни длины профиля, ни цены профиля за метр, ни фрезеровки Gola.

Ближайшее текущее поведение:
```
handleless: frontsCost = area × facadeRate × 1.08
profile:    fittingsCost += doors × 1 450 ₽
```
Если одновременно выбрать `facadeStyle = handleless` и `handle = profile`:
```
МДФ 60×85, 0,51 м²:
frontsCost = 0,51 × 8 400 × 1,08 = 4 626,72 ₽
profile    = 1 × 1 450 = 1 450 ₽
итого фасады + профиль (до петель/доводчиков) = 6 076,72 ₽
```
Против `flat + profile`:
```
4 284,00 + 1 450 = 5 734,00 ₽
разница = 342,72 ₽ (это только коэффициент 1,08)
```
Проблемы:
- 1 450 ₽ — за дверь/ящик, не за метр; материала профиля и фрезеровки нет.
- Неизвестно, является ли `profile` именно Gola; **UNKNOWN**.
- Если 1,08 — это стоимость Gola, то 1 450 ₽/дверь может быть двойным начислением. Если 1,08 — фрезеровка/обработка, дубля нет. Нужно решение владельца.
- Нет каталога Gola-профиля и price item за метр.

---

## 5. Двойные начисления, дубли и ошибки

### 5.1. Подтверждённые дубли/риски

| ID | Проблема | Где | Влияние | Статус |
|---|---|---|---|---|
| A-01 | Один и тот же материал/стиль существует в `content/catalog.ts` и в Admin `CatalogItem`/`PriceItem` | `catalog.ts`, `bootstrap.ts`, `import.ts`, `engine.ts`, `pricing.ts` | Два источника истины; runtime Engine читает Admin, legacy-цена — content | CONFIRMED (code); не двойное начисление в одном расчёте |
| A-02 | Порог двери `width > 60` продублирован | `pricing.ts`, `KitchenScene.tsx`, `WardrobeScene.tsx` | Разные места могут дать разное число створок при изменении правила | FIXED CA-T-517 (facadeDoorCount) |
| A-03 | Зазоры фасадов заданы отдельно в сцене, мойке и шкафе (0,2/0,1/0,1/0,55) | `KitchenScene.tsx`, `sink.ts`, `WardrobeScene.tsx` | Геометрия отображения расходится; цена зазоры не учитывает | FIXED CA-T-517 (единый facade-geometry.ts) |
| A-04 | Цена фасадов считается по площади модуля/секции, а не по фактическим размерам створок | `pricing.ts`, `engine.ts` | Для шкафа и кухни возможна переоценка площади на боковые зазоры/зазоры между дверями | FIXED CA-T-517 (фактическая площадь створок) |
| A-05 | `handleless 1.08` и `profile 1450 ₽/дверь` могут описывать один и тот же Gola-профиль | `catalog.ts` | Потенциальное двойное начисление до 1 450 ₽/дверь + 8 % фасада | POSSIBLE / UNKNOWN |
| A-06 | `shaker 1.16` и будущая фрезеровка по погонным метрам | `catalog.ts` | При вводе тарифа коэффициент станет двойным | POSSIBLE / зависит от решения |
| A-07 | `facadeRate`/`bodyRate` возвращают 0 для неизвестного id (legacy) | `pricing.ts` | При удалении материалов старый конфиг может получить бесплатный фасад/корпус | CONFIRMED (code) |
| A-08 | `validateConfig` не проверяет материал, если strict-схема не применялась | `validation.ts`, `projects.ts` | Старый неизвестный материал может пройти мягкую ветку | CONFIRMED (code) |
| A-09 | `kitchen.fronts` не содержит `facadeMaterialId`/`facadeStyle` для Display Adapter | `engine.ts`, `display-metadata.ts` | В строке «Фасады» кухни нет материала; шкаф содержит | CONFIRMED |
| A-10 | `KitchenScene` не визуализирует `shaker`/`handleless`, хотя цена меняется | `KitchenScene.tsx` | 16 %/8 % наценки без визуального различия; WardrobeScene рисует рамку shaker | CONFIRMED |
| A-11 | `bodyMaterial` выбирается пользователем, default — МДФ/фанера | `SharedPanels.tsx`, `defaults.ts` | Противоречит фиксированному ЛДСП | CONFIRMED |
| A-12 | Толщина корпуса 16 мм не в модели; мойка использует жёсткие 1,6 см | `sink.ts` | Нельзя проверить связь с материалом корпуса | CONFIRMED |
| A-13 | МДФ плёнка ПВХ отсутствует; единственный `mdf` называется «в эмали» | `catalog.ts`, UI | Нельзя выбрать плёнку; толщины 16/19/22 не проверены для двух отделок | CONFIRMED |
| A-14 | `countertopDepthAllowance`, `plinthPerMeter`, `underCabinetLightPerMeter`, `sinkPartition` — мёртвые | `content/pricing.ts`, `price-items.ts`, `dependency-map.ts` | 0 влияния; риск ложного импорта/путаницы | CONFIRMED (DEAD) |

### 5.2. Отдельно: геометрия фасадов

- Текущая геометрия фасадов **не менялась** в этом аудите.
- **CA-T-517:** цена и 2D используют единый `facade-geometry.ts`; площадь
  считается по фактическим створкам, зазоры сведены к общим константам.
  Осталось подтверждение производственных зазоров и OI-003.
- Зависимости: `facadeDoorCount`, `FACADE_EDGE_GAP_CM`,
  `FACADE_NEIGHBOR_GAP_CM`, `FACADE_DOOR_GAP_CM`,
  `WARDROBE_DOOR_GAP_CM`, `SINK_RULES.facade*`, ширина модуля/секции,
  вставки корпуса шкафа.
- Проблемы: дубли порога 60 см и зазоров устранены; `glass` имеет отдельную
  геометрию в шкафе; `shaker` визуализируется только в шкафе.

---

## 6. Данные, которые должен подтвердить владелец

1. **Корпус:** фиксированный ЛДСП 16 мм; точная ставка ₽/м²; сохраняется ли выбор цвета/декора; что делать с сохранёнными `mdf`/`plywood` (миграция в ЛДСП, сохранение старой цены или архив).
2. **Фасады:** ставки ЛДСП / МДФ эмаль / МДФ плёнка ПВХ; являются ли толщины 16/19/22 общими для эмали и плёнки или различаются.
3. **Удаляемые материалы:** правило миграции `veneer/glass/solid` для старых проектов; можно ли архивировать, не удаляя историю; как пересчитывать старые проекты.
4. **Фрезеровка:** тариф ₽/пог. м; что считать длиной (периметр створки, длина рамки, одна/две стороны, внутренний/внешний контур); минимальная партия; применяется ли к ящикам и каким толщинам 19/22.
5. **Shaker 1.16:** заменить на погонный тариф или оставить как коммерческую надбавку; если заменить — удалить коэффициент.
6. **Gola:** что такое Gola в номенклатуре; цена профиля за метр; материал профиля; фрезеровка; длина (на дверь/ряд/периметр); является ли `profile` в `HANDLES` этим профилем; удалять ли 1.08 и/или 1450.
7. **Handleless 1.08:** коммерческий смысл и источник.
8. **Body depth reference 60 и floor 0.5:** подтверждены ли как правило.
9. **Complexity 2 %/12 %:** подтверждены ли, применяются ли ко всему заказу.
10. **Wardrobe bodyFactor 1.15:** смысл и источник.
11. **Геометрия:** единые зазоры (0,2/0,1/0,1 vs 0,55), порог 60 см, должны ли цена и 2D использовать один helper.
12. **BOM:** толщины панелей корпуса, кромка, задняя стенка, фрезеровка, Gola — сейчас MISSING/UNKNOWN (см. `MODULE_BOM_CATALOG.md`, `MATERIAL_COST_MODEL_MASTER_PLAN.md`).

---

## 7. Предлагаемый порядок исправлений

Порядок — после ответов владельца; до этого код не менять.

1. **Зафиксировать решения** в `docs/CALCULATION_ADMIN/MATERIAL_COST_MODEL_MASTER_PLAN.md` и отдельном decision register.
2. **Корпус = ЛДСП 16 мм:**
   - `src/content/catalog.ts` — оставить `ldsp`, убрать/архивировать `mdf`/`plywood` из выбора;
   - `src/lib/configurator/types.ts`, `schema.ts`, `defaults.ts` — фиксированный id/толщина, legacy-маппинг;
   - `SharedPanels.tsx` — убрать выбор материала;
   - `pricing.ts`, `engine.ts` — константа вместо `bodyRate(config)`;
   - `data-resolver.ts`, `pins.ts`, `admin/bootstrap.ts`, `import.ts`, `dependency-map.ts`, `reference-ui.ts`, `app/admin/catalogs/page.tsx` — архив/маппинг;
   - тесты и docs.
3. **Фасады:**
   - `catalog.ts`, `types.ts`, `schema.ts` — удалить `veneer/glass/solid`, добавить `mdf_pvc` (или эквивалент);
   - `SharedPanels.tsx` — убрать glass-ветки, добавить два МДФ-варианта;
   - `WardrobeScene.tsx` — убрать `isGlass`;
   - `validation.ts` — убрать glass+shaker, добавить правила материалов/толщин;
   - `admin/bootstrap.ts`, `import.ts`, `dependency-map.ts`, `pins`, `data-resolver` — архив старых, новые id;
   - тесты/golden — после решения о миграции.
4. **Единая геометрия фасада:**
   - новый `src/lib/configurator/facade-geometry.ts` (число створок, площадь, периметр, зазоры);
   - использовать в `pricing.ts`, `engine.ts`, `KitchenScene.tsx`, `WardrobeScene.tsx`, `sink.ts`;
   - убрать дубли `>60`, `EDGE_GAP/NEIGHBOR_GAP/DOOR_GAP`, `doorGap`.

   **Сделано в CA-T-517 (2026-11-11):** helper реализован и подключён к
   Engine, legacy-расчёту и обеим 2D-сценам; дубли порога и зазоров убраны.
   Периметр не добавлялся — фрезеровка относится к Этапу 3.
5. **Фрезеровка:**
   - новый helper/тариф (например `src/lib/configurator/facade-milling.ts`);
   - price item `facade.milling.perMeter` в `admin/import.ts`/`bootstrap.ts`;
   - `pricing.ts`/`engine.ts` — начисление по длине, только МДФ 19/22 + shaker;
   - удалить/переопределить `shaker 1.16` после подтверждения;
   - display line + tests.
6. **Gola:**
   - каталог профиля и цена за метр; helper длины;
   - `pricing.ts`/`engine.ts` — профиль + материал + фрезеровка;
   - решить судьбу `handleless 1.08` и `HANDLES.profile 1450`;
   - price items, display metadata, tests.
7. **Миграция сохранённых конфигураций:**
   - `schema.ts` — legacy-enum/optional + transform;
   - `defaults.ts` — normalize старых материалов;
   - `projects.ts` — чтение без потери истории, fail-closed для неизвестных;
   - `data-resolver.ts`, `pins.ts` — архивные версии для recalculate;
   - не удалять `StoredProject.priceHistory`.
8. **Golden/baseline** — только после утверждения новых правил и с явным объяснением в плане.

---

## 8. Итог

- Целевая модель владельца и текущая реализация расходятся по корпусу, составу фасадов, МДФ-плёнке, фрезеровке и Gola.
- В коде нет отдельной фрезеровки и Gola; есть только коммерческие множители `shaker 1.16` и `handleless 1.08` плюс профиль-ручка 1 450 ₽/дверь.
- Главные технические риски: двойное начисление handleless/profile, замена shaker-множителя погонным тарифом без удаления 1.16, нулевая цена при неизвестном материале в legacy, отсутствие миграции старых проектов.
- До получения производственных данных любые изменения формул и коэффициентов не выполнялись.

---

## 9. Сделать потом

### Проверка архивирования старых материалов в production

Отложенная задача. **Не часть CA-T-517; сейчас не выполнять.** Production DB
не менять, записи не архивировать, отдельную реализацию/миграцию не создавать.

Что проверить в production-режиме:

- как система определяет исторические зависимости старых материалов;
- блокировку архивирования записей, связанных с проектами, pins,
  `priceHistory`, `usage` и опубликованными snapshots;
- корректное архивирование записей, у которых исторические зависимости
  отсутствуют;
- фактические ответы системы и отсутствие повреждения исторических данных.

Предусловие: отдельное разрешение владельца, backup и аудит; политика
архивирования — `CA-516_LEGACY_CATALOG_AND_RECALC_DECISIONS.md`.
