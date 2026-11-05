# CALCULATOR_TECHNICAL_AUDIT — технический аудит кухонного калькулятора

**Дата аудита:** 2026-11-04
**Область:** параметры, формулы, цены, справочники, хранение проектов конфигуратора FORMAKUB.
**Режим работы:** только анализ. Исходный код, схемы, форматы проектов и страницы не изменялись. Этот документ — единственный созданный файл.

**Правила подачи данных:**
- «не обнаружено» — элемента нет в коде;
- «требует проверки» — значение есть, но не подтверждено документацией производителя или инженерно;
- «демо» — значение помечено в коде как демонстрационное (`demo`, `preliminary`, `source: "preliminary"`);
- внешнее управление: **да** (без изменения логики), **осторожно** (нужен контроль диапазонов/влияет на геометрию), **нет** (часть программной логики).

Единицы измерения: **см** — габариты корпусов, **мм** — габариты мойки/выреза/толщины, **₽** — цены, **м²**, **пог. м**, **шт.**

---

## 1. Общая карта архитектуры расчётов

```
src/content/* (справочники, цены, лимиты)          src/lib/configurator/types.ts (модель)
        │                                                   │
        ├──────────────► src/lib/configurator/defaults.ts ◄──┤  defaultKitchen / normalizeKitchen
        │                        │                           │  normalizePlinthOptions / normalizeLighting
        │                        ▼                           │  normalizeSupportSettings
        │               src/lib/configurator/sink.ts         │  sinkGeometry / sinkLayout / normalizeSinkModule
        │                        │                           │
        ├──► src/lib/configurator/supports.ts (computeSupports)
        ├──► src/lib/configurator/lighting.ts (computeLighting)
        │                        │
        ▼                        ▼
src/lib/configurator/pricing.ts ──► PriceBreakdown (цена, строки, промо)
        │                                   │
        ▼                                   ▼
src/lib/configurator/validation.ts   src/components/configurator/PriceSummary.tsx
        │
        ▼
src/components/configurator/ConfiguratorStudio.tsx  (состояние, валидация, цена, сохранение)
        │
        ├─► KitchenPanel.tsx      (редактирование модулей, габариты, секции мойки)
        ├─► SharedPanels.tsx      (материалы, фурнитура, столешница, цоколь, подсветка, опоры)
        ├─► KitchenScene.tsx      (2D-схема: своя копия зазоров, вызовы sinkLayout/computeSupports)
        ├─► storage.ts            (черновик localStorage, ключ formakub:draft:{type}:v1)
        └─► /api/projects → src/lib/server/projects.ts → data/projects.json (снимок цены)
```

Три независимых потребителя одного расчёта геометрии:
1. **2D-схема** — `src/components/configurator/KitchenScene.tsx` (собственные `EDGE_GAP`, `NEIGHBOR_GAP`, `DOOR_GAP`, толщины);
2. **спецификация/цена** — `src/lib/configurator/pricing.ts` (через `sinkLayout`, `computeSupports`, `computeLighting`);
3. **валидация** — `src/lib/configurator/validation.ts` (через `sinkLayout`, `sinkPartitionConflicts`, `SINK_RULES`).

Единый источник для опор — `src/lib/configurator/supports.ts` (`computeSupports` вызывается из панели, сцены и цены) — это самый устойчивый участок. Самый уязвимый — зазоры и толщины фасадов, которые продублированы между `sink.ts` и `KitchenScene.tsx`.

---

## 2. Полный реестр параметров (13 категорий + «Прочие»)

Единица строки реестра = один именованный параметр (константа, поле справочника или поле конфигурации).

### 2.1. Категория 1. Геометрия корпусов

| Параметр | Значение (ед.) | Хранение | Используется | Расчёты | Управление | Тип |
|---|---|---|---|---|---|---|
| `SINK_RULES.minWidth` | 40 (см) | `src/lib/configurator/sink.ts` | `snapSinkWidth`, `validation.ts`, `KitchenPanel.tsx` | шаг/зажим ширины мойки | осторожно | фиксированный |
| `SINK_RULES.maxWidth` | 120 (см) | там же | там же | зажим ширины | осторожно | фиксированный |
| `SINK_RULES.widthStep` | 5 (см) | там же | `snapSinkWidth`, `validateSinkModule` | квантование ширины | осторожно | фиксированный |
| `SINK_RULES.standardWidths` | 40/45/50/60/80/90/100/120 (см) | там же | `isSinkStandardWidth`, `KitchenPanel.tsx` | подсветка типовых размеров | да | фиксированный |
| `SINK_RULES.sidePanel` | 1.6 (см) = ЛДСП 16 мм | там же | `sinkLayout`, `buildSections`, `isBottleEdgeSection` | секции, панели фасадов, опоры | осторожно | фиксированный |
| `SINK_RULES.partition` | 1.6 (см) | там же | `sectionOuterWidth`, `resolvePartitionBox`, `partitionBoxForSide` | перегородки, наружная ширина секции | осторожно | фиксированный |
| `SINK_RULES.facadeGap` | 0.25 (см) | там же | `sinkLayout`, `sectionFitsDrawers`, `resolvePartitionBox` | расчёт панелей фасада, допуск ящиков | осторожно | фиксированный |
| `SINK_RULES.facadeEdgeGap` | 0.2 (см) = 2 мм | там же | `sinkLayout` (по умолчанию) | рендер панелей, спецификация | осторожно | фиксированный |
| `SINK_RULES.facadeNeighborGap` | 0.1 (см) = 1 мм | там же | `sinkRowContext` передаётся в `sinkLayout` | зазор к соседнему модулю | осторожно | фиксированный |
| `SINK_RULES.facadeInnerGap` | 0.1 (см) | там же | `computeFacadeBoxes` | шов створок внутри модуля | осторожно | фиксированный |
| `SINK_RULES.mountEdge` | 50 (мм) | там же | `sinkRowMargins`, `maxSinkDepthFor` | монтажный отступ мойки | осторожно | фиксированный |
| `SINK_RULES.innerMount` | 0 (мм) | там же | `sinkRowMargins` | отступ к соседу со столешницей | да | фиксированный |
| `SINK_RULES.bottleClearOffset` | 3.2 (см) | там же | `applyBottleCut`, `normalizeSinkModule` | чистый проём бутылочницы = корпус − 3.2 см | осторожно | фиксированный |
| `SINK_RULES.minStorageSectionWidth` | 100 (мм) | там же | `buildSections`, `partitionBoxForSide`, `MIN_DOOR_WIDTH` | минимум секции хранения | осторожно | фиксированный |
| `SINK_RULES.bottleBodies` | 15/20/30 (см) | там же | `normalizeSinkStorage`, `schema.ts` | допустимые корпуса бутылочницы | да | фиксированный |
| `SINK_RULES.partitionMinWidth` | 65 (см) | там же | `sinkPartitionAvailable` | доступность 2-й перегородки | осторожно | фиксированный |
| `SINK_RULES.threeDoorMinWidth` | 100 (см) | там же | `sinkThreeDoorAvailable`, `validateSinkModule` | допустимость 3 фасадов | осторожно | фиксированный |
| `SINK_RULES.maxShelvesPerSection` | 3 | там же | `normalizeSinkStorage`, `validateSinkModule` | лимит наполнения секции | да | фиксированный |
| `SINK_RULES.maxDrawersPerSection` | 3 | там же | `normalizeSinkStorage`, `validateSinkModule` | лимит ящиков секции | да | фиксированный |
| `SINK_RULES.minSectionOuterWidthForDrawers` | 30 (см) | там же | `sectionFitsDrawers` | порог ящиков по наружной ширине | осторожно | фиксированный |
| `SINK_RULES.sinkStep` | 10 (мм) | там же | `snapMm`, `validateSinkGeometry` | шаг габаритов мойки | да | фиксированный |
| `SINK_RULES.minSinkWidth` / `maxSinkWidth` | 300 / 1100 (мм) | там же | `maxSinkWidthFor`, `clampSinkWidth` | допустимый размер мойки | да | фиксированный |
| `SINK_RULES.minSinkDepth` / `maxSinkDepth` | 300 / 500 (мм) | там же | `maxSinkDepthFor`, `clampSinkDepth` | допустимый размер мойки | да | фиксированный |
| `MIN_DOOR_WIDTH` | 10 (см) = `minStorageSectionWidth/10` | `sink.ts` (внутр. константа) | `splitRun` | минимальная створка для шва | нет | вычисляемый |
| `MIN_FLOOR_Y` | 272 | `KitchenScene.tsx` | `KitchenScene` | вертикальное позиционирование 2D | нет | фиксированный (рендер) |
| `MARGIN` | 44 | `KitchenScene.tsx` | `KitchenScene` | отступ сцены | нет | фиксированный (рендер) |
| `EDGE_GAP` | 0.2 (см) | `KitchenScene.tsx` | отрисовка створок | рендер (дубль `facadeEdgeGap`) | нет | фиксированный |
| `NEIGHBOR_GAP` | 0.1 (см) | `KitchenScene.tsx` | отрисовка створок | рендер (дубль `facadeNeighborGap`) | нет | фиксированный |
| `DOOR_GAP` | 0.1 (см) | `KitchenScene.tsx` | отрисовка створок | рендер (дубль `facadeInnerGap`) | нет | фиксированный |
| `MIN_LEG_SPACING_CM` | 8 (см) | `src/lib/configurator/supports.ts` | `positionsForModule` | максимум опор по шагу | осторожно | фиксированный |
| `PARTITION_SNAP_CM` | 4 (см) | там же | `positionsForModule` | допуск совмещения с перегородкой | осторожно | фиксированный |
| `MERGE_TOLERANCE_CM` | 1.5 (см) | там же | `mergePositions` | объединение близких опор | осторожно | фиксированный |

### 2.2. Категория 2. Размеры модулей и ограничения

| Параметр | Значение | Хранение | Используется | Расчёты | Управление | Тип |
|---|---|---|---|---|---|---|
| `KITCHEN_LIMITS.minModules` | 2 | `src/content/catalog.ts` | `validation.ts` | минимум модулей | да | фиксированный |
| `KITCHEN_LIMITS.maxModules` | 25 | там же | `validation.ts`, `KitchenPanel.tsx` | лимит модулей | да | фиксированный |
| `KITCHEN_LIMITS.minTotalWidth` | 80 (см) | там же | `validation.ts` | минимум общей ширины | да | фиксированный |
| `KITCHEN_LIMITS.maxSinkModules` / `maxHobModules` / `maxOvenModules` | 1 / 1 / 1 | там же | `validation.ts` | единичные модули | да | фиксированный |
| `KITCHEN_LIMITS.maxShelvesPerModule` | 5 | там же | `validation.ts`, `KitchenPanel.tsx` | лимит полок | да | фиксированный |
| `KITCHEN_LIMITS.minDrawers` / `maxDrawers` | 2 / 4 | там же | `validation.ts`, `KitchenPanel.tsx` | лимиты ящиков блока | да | фиксированный |
| `KITCHEN_LIMITS.minCountertopMeters` | 0.8 (м) | там же | **не обнаружено (нигде не читается)** | — | осторожно | фиксированный (мертвый) |
| `KITCHEN_LIMITS.maxWallOverhang` | 20 (см) | там же | `validateKitchen` | предупреждение о ширине верхнего ряда | да | фиксированный |
| `KITCHEN_LIMITS.minPlinthHeight` / `maxPlinthHeight` | 10 / 15 (см) | там же | `normalizeKitchen`, `schema.ts`, `KitchenPanel.tsx` | зажим высоты цоколя | да | фиксированный |
| `KITCHEN_LIMITS.defaultPlinthHeight` | 10 (см) | там же | `defaultKitchen`, `schema.ts` | цоколь по умолчанию | да | фиксированный |
| `KITCHEN_LIMITS.wallGapAboveCountertop` | 56 (см) | там же | `lighting.ts`, `KitchenScene.tsx`, `KitchenPanel.tsx` | низ верхнего ряда, перекрытие подсветки | осторожно | фиксированный |
| `KITCHEN_MODULES.base` | 12 числовых полей + `zone` | там же | `defaults.ts`, `validation.ts`, `pricing.ts`, `KitchenPanel.tsx` | геометрия, `basePrice`, зона | да | смешанный |
| `KITCHEN_MODULES.sink` | 12 числовых полей + `zone` | там же | там же | то же | да | смешанный |
| `KITCHEN_MODULES.hob` | 12 числовых полей + `zone` | там же | там же | то же | да | смешанный |
| `KITCHEN_MODULES.drawers` | 12 числовых полей + `zone` | там же | там же | то же | да | смешанный |
| `KITCHEN_MODULES.wall` | 12 числовых полей + `zone` | там же | там же | то же | да | смешанный |
| `KITCHEN_MODULES.tall` | 12 числовых полей + `zone` | там же | там же | то же | да | смешанный |
| `KITCHEN_MODULES.oven` | 12 числовых полей + `zone` | там же | там же | то же | да | смешанный |
| `KITCHEN_MODULES.bottle` | 12 числовых полей + `zone` | там же | там же | то же | да | смешанный |
| `WARDROBE_LIMITS` (17 полей) | minSections…drawerHeight | там же | `validation.ts`, `WardrobePanel.tsx`, `defaults.ts` | валидация и геометрия шкафа | да | фиксированный |
| `kitchenModuleSchema` (zod) | width 15–200, height 40–280, depth 20–80, shelves 0–10, drawers 0–6, modules 1–25 | `src/lib/configurator/schema.ts` | `safeParseConfig`, API | жёсткий входной каркас | осторожно | фиксированный |
| `kitchenConfigSchema` (zod) | countertopThickness 4–50, plinthThickness 0.5–20, sidePanels 0–2, maxSpanCm 20–200, maxLoadKgPerLeg 10–300 | там же | загрузка черновика/проекта | защита от кривых данных | осторожно | фиксированный |

Сводка категории: 8 пресетов модулей × (min/max/default по ширине, высоте, глубине, `defaultShelves`, `defaultDrawers`, `basePrice`, `zone`).

### 2.3. Категория 3. ЛДСП, МДФ и другие материалы

| Параметр | Значение | Хранение | Используется | Расчёты | Управление | Тип |
|---|---|---|---|---|---|---|
| `BODY_MATERIALS` — ЛДСП `ratePerSqm` | 5200 ₽/м² | `src/content/catalog.ts` | `pricing.ts` (`bodyRate`) | стоимость корпуса | да | цена |
| `BODY_MATERIALS` — МДФ `ratePerSqm` | 7600 ₽/м² | там же | там же | стоимость корпуса | да | цена |
| `BODY_MATERIALS` — Фанера `ratePerSqm` | 9200 ₽/м² | там же | там же | стоимость корпуса | да | цена |
| `BODY_MATERIALS[].finishes` | 11 декоров (hex) | там же | `KitchenScene.tsx` (`finishFor`), `KitchenPanel.tsx` | цвет 2D, выбор в UI | да | справочник |
| `FACADE_MATERIALS` — ЛДСП/МДФ/Шпон/Стекло/Массив `ratePerSqm` | 5600 / 8400 / 11800 / 14400 / 18600 ₽/м² | там же | `pricing.ts` (`facadeRate`) | стоимость фасадов | да | цена |
| `FACADE_MATERIALS[].finishes` | 17 декоров (hex/accent) | там же | `KitchenScene.tsx`, `WardrobeScene.tsx`, панели | цвет, выбор | да | справочник |
| `PRICING.kitchen.bodyDepthReference` | 60 (см) | `src/content/pricing.ts` | `calculateKitchenPrice` | `depthFactor = depth/60` | осторожно | цена/логика |
| `PRICING.wardrobe.bodyDepthReference` | 60 (см) | там же | `calculateWardrobePrice` | то же | осторожно | цена/логика |
| `PRICING.wardrobe.bodyFactor` | 1.15 | там же | `calculateWardrobePrice` | наценка корпуса шкафа | да | цена |
| Зажим `Math.max(0.5, depthFactor)` | 0.5 | `src/lib/configurator/pricing.ts` (непосредственно в коде) | `calculateKitchenPrice` | минимум глубинного множителя | нет | жёстко в коде |
| Толщина корпуса в оценке | не обнаружено (площадь считается без толщины плиты) | — | — | — | — | не обнаружено |

### 2.4. Категория 4. Фасады и кромки

| Параметр | Значение | Хранение | Используется | Расчёты | Управление | Тип |
|---|---|---|---|---|---|---|
| `FACADE_STYLES` multiplier (flat/shaker/handleless) | 1 / 1.16 / 1.08 | `src/content/catalog.ts` | `pricing.ts` (`styleMultiplier`) | множитель фасадов | да | цена |
| `HANDLES.rate` (bar/knob/profile/none) | 780 / 560 / 1450 / 0 ₽/шт | там же | `pricing.ts` (`handleRate`) | фурнитура | да | цена |
| `doorCountForWidth` порог | > 60 (см) → 2 двери | `src/lib/configurator/pricing.ts` | `kitchenDoorCount`, `wardrobeDoorCount` | число петель/ручек | осторожно | логика |
| `PRICING.*.hingePerDoor` / `softClosePerDoor` / `pushToOpenPerDoor` | 390 / 460 / 1350 ₽ | `src/content/pricing.ts` | `calculateKitchenPrice`, `calculateWardrobePrice` | фурнитура | да | цена |
| Кромка фасадов (тип/цена) | **не обнаружено** (кромка моделируется только у цоколя: `PlinthFinish`) | — | — | — | — | не обнаружено |
| Петли/системы (производитель, тип) | **не обнаружено** (только `hinge: standard/soft`) | `types.ts` | `validation.ts` | совместимость | — | не обнаружено |

### 2.5. Категория 5. Столешницы

| Параметр | Значение | Хранение | Используется | Расчёты | Управление | Тип |
|---|---|---|---|---|---|---|
| `COUNTERTOPS` `ldsp_hpl` | 9500 ₽/м, толщины 26/28/38, дефолт 38 | `src/content/catalog.ts` | `pricing.ts`, `SharedPanels.tsx` | стоимость столешницы | да | цена |
| `COUNTERTOPS` `compact_hpl` | 9500 ₽/м, толщины 6/8/10/12/13, дефолт 12 | там же | там же | то же (ставка совпадает с предыдущей — см. п. 6) | да | цена |
| `COUNTERTOPS` `acrylic` | 16800 ₽/м, 12/20/30/40, дефолт 20 | там же | там же | то же | да | цена |
| `COUNTERTOPS` `quartz` | 22400 ₽/м, 12/20/30, дефолт 20 | там же | там же | то же | да | цена |
| `COUNTERTOPS` `porcelain` | 29400 ₽/м, 8/9/10/11, дефолт 10 | там же | там же | то же (ставка = `solid_wood` — см. п. 6) | да | цена |
| `COUNTERTOPS` `solid_wood` | 29400 ₽/м, 27/40, дефолт 40 | там же | там же | то же | да | цена |
| `COUNTERTOP_LEGACY_MAP` | laminate→compact_hpl, stone→porcelain | там же | `schema.ts` (`preprocess`), `findCountertop` | миграция старых проектов | да | логика |
| `config.countertopThickness` | дефолт 30, дефолт новой кухни 38 | `types.ts`, `defaults.ts`, `schema.ts` | `KitchenScene.tsx`, `lighting.ts`, `KitchenPanel.tsx` | высота 2D, низ верхнего ряда, подсветка; **на цену не влияет** | да | пользовательский |
| `snapCountertopThickness` | ближайший из `thicknesses` | `src/content/catalog.ts` | `normalizeKitchen` | приведение толщины | нет | вычисляемый |

### 2.6. Категория 6. Цоколь и ножки

| Параметр | Значение | Хранение | Используется | Расчёты | Управление | Тип |
|---|---|---|---|---|---|---|
| `config.plinthHeight` | 10–15 см, дефолт 10 | `types.ts`, `defaults.ts`, `schema.ts` | `KitchenScene.tsx` (высота цоколя 2D), `validation.ts` | геометрия 2D; **на цену не влияет** | да | пользовательский |
| `PLINTH_MATERIALS.ldsp.ratePerMeter` | 1600 ₽/м | `src/content/plinth.ts` | `plinthRatePerMeter` → `pricing.ts` | стоимость цоколя | да | цена |
| `PLINTH_MATERIALS.mdf.ratePerMeter` | 2200 ₽/м | там же | там же | то же | да | цена |
| `PLINTH_MATERIALS.plastic.ratePerMeter` | 2600 ₽/м | там же | там же | то же | да | цена |
| `PLINTH_MATERIALS.aluminum.ratePerMeter` | 4400 ₽/м | там же | там же | то же | да | цена |
| `PLINTH_MATERIALS.stainless.ratePerMeter` | 6200 ₽/м | там же | там же | то же | да | цена |
| `PlinthFinish.rateDelta` (10 исполнений) | −120 … +700 ₽/м | там же | `plinthRatePerMeter` | надбавка за исполнение | да | цена |
| `thicknesses` / `defaultThickness` цоколя | 0.8–18 мм | там же | `snapPlinthThickness`, `normalizePlinthOptions` | толщина цоколя (цена не зависит) | да | справочник |
| `PLINTH_MOUNTS` (clips/hidden) | 2 варианта | `src/content/supports.ts` | `computeSupports`, `SharedPanels.tsx` | выбор клипсы/винты | да | справочник |
| `SUPPORT_SYSTEMS.standard` | edgeInset 4, maxSpan 60, maxLoad 40, clipsPerLeg 1, screwsPerLeg 2, tallAnchorSpacing 120, tallCenterLegWidth 60 | там же | `computeSupports`, `defaults.ts` | количество опор, крепежа | осторожно | требует проверки (`preliminary`) |
| `SUPPORT_SYSTEMS.heavy` | edgeInset 5, maxSpan 45, maxLoad 70, clipsPerLeg 2, screwsPerLeg 2, tallAnchorSpacing 110, tallCenterLegWidth 50 | там же | там же | то же | осторожно | требует проверки (`preliminary`) |
| `config.supports.maxSpanCm` / `maxLoadKgPerLeg` | переопределение системы (20–200 / 10–300) | `types.ts`, `defaults.ts` | `computeSupports` | расчёт опор поверх каталога | осторожно | пользовательский (без UI) |
| `MODULE_LOAD_KG` | base 55, sink 75, hob 65, drawers 80, wall 0, tall 130, oven 110, bottle 35 (кг) | `src/content/supports.ts` | `positionsForModule` | расчёт по нагрузке | осторожно | требует проверки |
| `MODULE_LOAD_REFERENCE_WIDTH` | 60 см (bottle 20) | там же | `positionsForModule` | масштабирование нагрузки | осторожно | требует проверки |
| `edgeInsetCm` зажим `clamp(round, 1, width/4)` | код | `src/lib/configurator/supports.ts` | `positionsForModule` | крайние опоры | нет | жёстко в коде |

### 2.7. Категория 7. Фурнитура и комплектующие

| Параметр | Значение (₽) | Хранение | Назначение | Управление | Тип |
|---|---|---|---|---|---|
| `PRICING.kitchen.baseCost` | 12000 | `src/content/pricing.ts` | «Основа проекта» × complexity | да | цена |
| `PRICING.wardrobe.baseCost` | 9000 | там же | то же | да | цена |
| `PRICING.kitchen.shelf` / `wardrobe.shelf` | 1100 / 1150 за шт | там же | полки | да | цена |
| `PRICING.kitchen.sidePanel` | 4800 за шт | там же | декоративные боковины | да | цена |
| `PRICING.kitchen.sinkCutout` | 3800 за модуль | там же | вырез столешницы под мойку (фиксированно, от размера не зависит) | да | цена |
| `PRICING.kitchen.hobCutout` | 2800 | там же | вырез под варочную | да | цена |
| `PRICING.kitchen.ovenNiches` | 2200 | там же | ниша под технику | да | цена |
| `PRICING.kitchen.bottleRack` | 5000 | там же | механизм бутылочницы | да | цена |
| `PRICING.kitchen.hingePerDoor` / `softClosePerDoor` / `pushToOpenPerDoor` | 390 / 460 / 1350 | там же | петли и опции | да | цена |
| `PRICING.wardrobe.rod` | 2400 | там же | штанга | да | цена |
| `PRICING.wardrobe.drawer` | 6200 | там же | ящик шкафа целиком | да | цена |
| `PRICING.wardrobe.ledPerSection` | 3800 | там же | LED-подсветка шкафа за секцию | да | цена |
| `PRICING.kitchen.drawerSlide` / `drawerSoftClose` | 1900 / 650 | там же | направляющие/доводчики ящиков | да | цена |

### 2.8. Категория 8. Выдвижные системы и ящики

| Параметр | Значение | Хранение | Используется | Управление | Тип |
|---|---|---|---|---|---|
| `KITCHEN_LIMITS.minDrawers/maxDrawers` | 2 / 4 | `src/content/catalog.ts` | `validation.ts`, UI | да | фиксированный |
| `SINK_RULES.maxDrawersPerSection` | 3 | `src/lib/configurator/sink.ts` | `normalizeSinkStorage`, `validation.ts` | да | фиксированный |
| `SINK_RULES.minSectionOuterWidthForDrawers` | 30 см (допуск `facadeGap/2`) | там же | `sectionFitsDrawers` | осторожно | фиксированный |
| `resolveDrawerCount` | 1 → 0 при уменьшении, → 2 при увеличении | там же | `KitchenPanel.tsx` | нет | логика |
| `WARDROBE_LIMITS.drawerHeight` | 20 (см) | `src/content/catalog.ts` | `defaults.nextShelfPosition`, `validateWardrobe` | да | фиксированный |
| Типы выдвижных систем (box vs ролики, бренд, длина направляющей) | **не обнаружено** | — | — | — | не обнаружено |

### 2.9. Категория 9. Мойки и смесители

| Параметр | Значение | Хранение | Используется | Управление | Тип |
|---|---|---|---|---|---|
| `SINK_DEFAULTS` | 500 × 400 мм | `src/lib/configurator/sink.ts` | `makeKitchenModule`, `sinkGeometry` | да | пользовательский (дефолт) |
| `SINK_STANDARD_SIZES` | 11 типоразмеров (400×430 … 1000×500) | там же | `nearestStandardSink`, `KitchenPanel.tsx` | да | справочник |
| `SINK_STANDARD_WIDTHS_MM` | 500/550/600/780/800/1000 | там же | пин-маркеры UI | да | справочник |
| `SINK_STANDARD_DEPTHS_MM` | 400/450/500 | там же | пин-маркеры UI | да | справочник |
| `config.sinkCutout` | width/depth мм, иначе = габарит мойки | `types.ts` | `sinkGeometry` (`cutoutKnown`) | да | пользовательский |
| `maxSinkWidthFor` / `maxSinkDepthFor` | moduleWidth − margins, moduleDepth − 2×mountEdge | `sink.ts` | валидация, UI | нет | вычисляемый |
| Ценник мойки / сифона / сливного набора | **не обнаружено** (есть только `sinkCutout` 3800 ₽) | — | — | — | не обнаружено |
| Смесители: каталог, цены, габариты | **не обнаружено** | — | — | — | не обнаружено |

### 2.10. Категория 10. Встроенная техника

| Параметр | Значение | Хранение | Используется | Управление | Тип |
|---|---|---|---|---|---|
| `KitchenModule.ownSupports` | `boolean` (опционально) | `types.ts`, `schema.ts` | `computeSupports` → исключение модуля из опор | да | пользовательский (без UI) |
| `PRICING.kitchen.ovenNiches` | 2200 ₽ | `src/content/pricing.ts` | `calculateKitchenPrice` | да | цена |
| `PRICING.kitchen.hobCutout` | 2800 ₽ | там же | `calculateKitchenPrice` | да | цена |
| Паспортные габариты техники (ПММ, духовой шкаф, варочная) | **не обнаружено** (только типы модулей `oven`/`hob` и их min/max) | — | — | — | не обнаружено |

### 2.11. Категория 11. Освещение

| Параметр | Значение | Хранение | Используется | Управление | Тип |
|---|---|---|---|---|---|
| `LED_VOLTAGES` | 12 / 24 В | `src/content/lighting.ts` | `normalizeLighting`, `schema.ts`, `computeLighting` | да | справочник |
| `LED_POWERS` | 4.8 / 9.6 / 14.4 / 19.2 Вт/м | там же | `computeLighting` | да | справочник |
| `LED_COLOR_TEMPS` | 2700/3000/4000/5000/6000 K | там же | `computeLighting`, `KitchenScene` (цвет) | да | справочник |
| `LED_END_MARGIN_CM` | 2 (см) | там же | `availableLength` | осторожно | фиксированный |
| `LED_PROFILES[].ratePerMeter` | 620 / 760 / 690 ₽/м | там же | `computeLighting` | да | цена |
| `LED_DIFFUSERS[].ratePerMeter` | 420 / 540 ₽/м | там же | `computeLighting` | да | цена |
| `LED_CONTROLS[].price` | 780 / 1650 / 2300 ₽ | там же | `computeLighting` | да | цена |
| `LED_PSU_RATINGS` | 20/30/60/100/150/200/300/400 Вт | там же | `computeLighting` | да | справочник |
| `LED_PSU_PRICE` | 950 … 5600 ₽ | там же | `computeLighting` | да | цена |
| `LED_END_CAP_PRICE` / `LED_CONNECTOR_PRICE` / `LED_INSTALL_PRICE_PER_METER` | 110 ₽/шт / 260 ₽/шт / 450 ₽/м | там же | `computeLighting` | да | цена |
| `LED_PSU_MARGIN` / `LED_PSU_MARGIN_LOW` | 1.25 / 1.2 | там же | `computeLighting` (запас БП) | осторожно | требует проверки |
| `LED_STRIPS` (8 моделей) | pricePerMeter 740…1900 ₽/м; maxContinuousRunM 2…10 м; voltageDropPct 6…12 %; maxPsuW 100…300 Вт; `source: "preliminary"` | там же | `findLedStrip` → `computeLighting` | осторожно | цена + требует проверки |
| `LED_COLOR_HEX` | 5 значений | там же | `ledColorHex` (2D) | да | справочник |
| `defaultKitchenLighting()` | 24 В, 9.6 Вт/м, 3000 K, surface, frosted, switch | `src/lib/configurator/defaults.ts` | `defaultKitchen`, `normalizeLighting` | да | дефолт |

### 2.12. Категория 12. Декоративные элементы

| Параметр | Значение | Хранение | Используется | Управление | Тип |
|---|---|---|---|---|---|
| `config.sidePanels` | 0…2 шт (схема 0–2) | `types.ts`, `schema.ts` | `calculateKitchenPrice` (`sidePanel` 4800 ₽/шт) | да (UI отключён: `SharedPanels.tsx` `disabled`) | пользовательский |
| `FACADE_STYLES` описание/декор | 3 стиля | `src/content/catalog.ts` | валидация совместимости, цена | да | справочник |
| Декоративные торцы/накладки/профили | **не обнаружено** | — | — | — | не обнаружено |

### 2.13. Категория 13. Цены и наценки

См. полный реестр в разделе 4 (118 элементов). Дополнительные параметры категории:

| Параметр | Значение | Хранение | Назначение | Управление | Тип |
|---|---|---|---|---|---|
| `PRICING.version` | `demo-2026-01` | `src/content/pricing.ts` | идентификатор набора цен; **в проекте не сохраняется** | да | демо |
| `PRICING.currency` | `RUB` | там же | валюта `PriceBreakdown` | нет | фиксированный |
| `PRICING.rounding` | 100 ₽ | там же | `roundMoney` | да | правило |
| `PRICING.minOrder` | 45000 ₽ | там же | минимум заказа | да | правило |
| `PRICING.kitchen.complexityPerExtraModule` | 0.02 | там же | `complexityFactor` | да | правило |
| `PRICING.kitchen.complexityMax` | 1.12 | там же | потолок коэффициента | да | правило |
| `formatRange` | ±10 % от итога | `src/lib/configurator/pricing.ts` | «Ориентир ±10 %» в `PriceSummary.tsx` | осторожно | жёстко в коде |
| `PRICE_DISCLAIMER` | текст дисклеймера | `src/lib/configurator/pricing.ts` | `PriceBreakdown.disclaimer` | да | текст |

### 2.14. Категория 14. Прочие параметры

| Параметр | Значение | Хранение | Назначение | Управление | Тип |
|---|---|---|---|---|---|
| `KitchenConfig.version` / `WardrobeConfig.version` | `1` (литерал) | `types.ts`, `schema.ts` | версия модели конфигурации (не расчёта) | нет | фиксированный |
| `storage.VERSION` | `v1` | `src/lib/configurator/storage.ts` | ключ черновика в localStorage | осторожно | фиксированный |
| `PROMOS[].demo` | `true` у всех 3 кодов | `src/content/pricing.ts` | признак демо-промо | да | фиксированный |
| `SUPPORT_SYSTEMS[].source` | `preliminary` у обеих систем | `src/content/supports.ts` | `SupportPlan.preliminary`, строка «предварительный расчёт» | осторожно | требует проверки |
| Порядок шагов расчёта (сначала `optionsCost`, затем complexity, затем округление, затем скидка) | код | `pricing.ts` (`calculateKitchenPrice`) | итоговая сумма | нет | логика |

---

## 3. Реестр формул и алгоритмов (17 основных + вспомогательные)

| № | Название | Формула / алгоритм | Вход | Выход (ед.) | Файл : функция | Зависимости | Результат используется в | Тесты | Подтверждение |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Цена кухни | `subtotalRaw = (baseCost + bodyCost + frontsCost + fittingsCost + optionsCost) × complexityFactor`; `subtotal = max(minOrder, round(subtotalRaw))`; `total = round(subtotal − discount)` | `KitchenConfig` | ₽ | `src/lib/configurator/pricing.ts` : `calculateKitchenPrice` | справочники, `sinkLayout`, `computeSupports`, `computeLighting` | стоимость, `StoredProject.price` | `pricing.test.ts` | требует проверки (демо-ставки) |
| 2 | Цена шкафа | `bodyCost = area×body×depthFactor×bodyFactor`; `frontsCost = area×facade×style`; `options = shelves×shelf + rods×rod + plinth + led` | `WardrobeConfig` | ₽ | там же : `calculateWardrobePrice` | `WARDROBE_LIMITS`, справочники | стоимость | `pricing.test.ts` | требует проверки |
| 3 | Диспетчер цены | `kind === "kitchen" ? … : …` | `FurnitureConfig` | `PriceBreakdown` | там же : `calculatePrice` | 1, 2 | UI, API | `pricing.test.ts` | — |
| 4 | Промокод | `discount = percent ? subtotal×value/100 : value`; `min(maxDiscount, subtotal)`; `roundMoney` | `PromoDefinition`, `subtotal` | ₽ | там же : `applyPromo`, `calculatePromo` | `PROMOS`, `PRICING.rounding` | итог | `pricing.test.ts` | демо |
| 5 | Округление | `roundMoney(v) = max(0, round(v / 100) × 100)`; `formatRange(v) = [0.9v, 1.1v]` | число | ₽ | там же : `roundMoney`, `formatRange` | `PRICING.rounding` | все суммы, `PriceSummary` | `pricing.test.ts` | жёсткое правило |
| 6 | Площадь и ставки | `area(w,h) = w·h/10000` (м²); `bodyRate/facadeRate/styleMultiplier/handleRate` — поиск в справочниках | габариты (см), id материалов | м², ₽/м², множитель, ₽/шт | там же : `area`, `bodyRate`, `facadeRate`, `styleMultiplier`, `handleRate` | `catalog.ts` | 1, 2 | `pricing.test.ts` | демо |
| 7 | Счётчик дверей | `doorCountForWidth(w) = w > 60 ? 2 : 1`; `kitchenDoorCount` → для мойки `sinkFacadeTotals(...).doors`, для ящиков 0 | ширина, тип модуля | шт | там же : `doorCountForWidth`, `kitchenDoorCount` | `sinkFacadeTotals` | петли, ручки, рендер | `pricing.test.ts`, `sink.test.ts` | **дублируется в `KitchenScene.tsx` (`doorCount`)** |
| 8 | Ширины ряда | `kitchenTotalWidth = max(Σ floor, Σ upper)`; `kitchenCountertopWidth = Σ(base, sink, hob, drawers)`; `wardrobeWidth = Σ sections` | конфиг | см | там же : `kitchenTotalWidth`, `kitchenCountertopWidth`, `wardrobeWidth` | типы модулей | валидация, цена столешницы, UI | `pricing.test.ts` | подтверждено тестами |
| 9 | Опоры и крепёж | `loadPerModule = MODULE_LOAD_KG[t] × (width / REF_W)`; `spanCount = max(2, ceil(inner/maxSpan)+1)`; `loadCount = max(2, ceil(load/(maxLoad×2)))`; `tallRule = width ≥ tallCenterLegWidth ? 3 : 2`; `count = clamp(max(span,load,tall), 2, maxBySpacing)`; `legs = positions×2`; `clips = front×clipsPerLeg`; `anchors = ceil(height/tallAnchorSpacing)`; `cost = legs·legPrice + clips·clipPrice + screws·screwPrice + anchors·anchorPrice` | `KitchenConfig` | `SupportPlan` (шт, ₽) | `src/lib/configurator/supports.ts` : `computeSupports`, `positionsForModule`, `supportsForModule` | `SUPPORT_SYSTEMS`, `MODULE_LOAD_*`, `sinkLayout` (перегородки) | цена, 2D, спецификация | `supports.test.ts` | **требует проверки** (`source: "preliminary"`) |
| 10 | Подсветка | `lengthM = Σ(seg − 2×2см − блокировка пеналами)`; `powerW = lengthM × W/m`; `psuRequiredW = powerW × 1.25`; `psuW = ближайший рейтинг ≥ psuRequiredW`; `psuCount = ceil(psuRequiredW / strip.maxPsuW)` (если превышено); `currentA = powerW / U`; `runs = деление длин по maxContinuousRunM`; `cost = Σ components` | `KitchenConfig` | `LightingPlan` (м, Вт, А, ₽) | `src/lib/configurator/lighting.ts` : `computeLighting`, `availableLength`, `countRuns` | `content/lighting.ts`, `KITCHEN_LIMITS.wallGapAboveCountertop`, `countertopThickness` | цена, 2D, панель | `lighting.test.ts` | **требует проверки** (`preliminary`) |
| 11 | Геометрия мойки | `x` по позиции; `minOffset = margin(стороны)`; `maxOffset = W − sinkW − margin(противоположной)`; `zoneLeft = cutoutX − marginL`; `zoneRight = cutoutX + cutoutW + marginR`; `centerAllowed = (W−sinkW)/2 ≥ max(margins) − 0.001` | поля модуля (мм/см), `SinkRowContext` | `SinkGeometry` (мм) | `src/lib/configurator/sink.ts` : `sinkGeometry` | `SINK_RULES`, `sinkRowContext` | `sinkLayout`, валидация, UI, 2D | `sink.test.ts` | подтверждено тестами |
| 12 | Раскладка модуля мойки | секции: перегородки делят корпус → режут монтажной зоной → остатки <100 мм → коммуникации; панели фасада: секция с наполнением → своя панель, остальное → базовые створки (`distributeDoors`, шов на осевой перегородки); бутылочница: `x = side + (body − 3.2)` | модуль, gaps, row | `SinkLayout` (см) | там же : `sinkLayout` + `buildSections`, `computeFacadeBoxes`, `applyBottleCut`, `resolvePartitionBox`, `partitionBoxForSide`, `distributeDoors`, `autoPartitionSides` | `sinkGeometry`, `SINK_RULES`, `normalizeSinkStorage` | спецификация, цена, 2D, валидация, опоры | `sink.test.ts` (≈70 кейсов) | подтверждено тестами |
| 13 | Панели фасада мойки | `doors/fronts/bottle/panels` по `facadeBoxes` | модуль, row | счётчики | там же : `sinkFacadeTotals` | `sinkLayout` | счётчики фасадов и фурнитуры в цене | `sink.test.ts` | подтверждено тестами |
| 14 | Отступы ряда и максимумы | `margins = edge ? 50 : 0`; `maxSinkWidthFor = W − margins`; `maxSinkDepthFor = depth − 2×50` | модуль, row | мм | там же : `sinkRowMargins`, `sinkRowContext`, `maxSinkWidthFor`, `maxSinkDepthFor` | `SINK_RULES` | валидация, UI, `sinkGeometry` | `sink.test.ts` | подтверждено тестами |
| 15 | Нормализация модуля мойки | зажим `sinkWidth/Depth/Offset`, подбор стандартного размера, очистка легаси `sinkPartition`, обрезка `sinkStorage` по числу секций, обнуление блокированных наполнений | `KitchenModule`, row | `KitchenModule` | там же : `normalizeSinkModule`, `normalizeSinkStorage`, `resolveDrawerCount` | 11–14 | загрузка черновика/проекта, UI | `sink.test.ts` | подтверждено тестами |
| 16 | Нормализация кухни | глубина ряда → зажим цоколя → `normalizePlinthOptions` → `normalizeLighting` → `normalizeSupportSettings` → `snapCountertopThickness` → `normalizeSinkModule` по каждому модулю; идемпотентна | `KitchenConfig` | `KitchenConfig` | `src/lib/configurator/defaults.ts` : `normalizeKitchen` (+ `normalizeKitchenDepth`, `normalizePlinthOptions`, `normalizeLighting`, `normalizeSupportSettings`) | все справочники | загрузка, сохранение, миграция | `migration.test.ts`, `validation.test.ts` | подтверждено тестами |
| 17 | Валидация | диапазоны из `KITCHEN_MODULES`/`KITCHEN_LIMITS`/`WARDROBE_LIMITS`, правила мойки из `SINK_RULES`, совместимость ручек/фасадов/техники | `FurnitureConfig` | `ValidationIssue[]` | `src/lib/configurator/validation.ts` : `validateConfig`, `validateKitchen`, `validateWardrobe`, `validateSinkModule`, `validateSinkGeometry` | `pricing.ts` (ширины), `sink.ts` | API сохранения, подсветка в UI | `validation.test.ts` | подтверждено тестами |

Вспомогательные (входят в состав вышеперечисленных):
- `plinthRatePerMeter(material, finish)` — `src/content/plinth.ts` — ставка цоколя = база + `rateDelta`;
- `snapPlinthThickness` / `snapPlinthFinish` — `src/content/plinth.ts` — приведение к каталогу;
- `snapCountertopThickness` / `findCountertop` — `src/content/catalog.ts` — приведение и легаси-маппинг;
- `nextShelfPosition` — `src/lib/configurator/defaults.ts` — позиция новой полки шкафа;
- `sectionOuterWidth` / `sectionFitsDrawers` / `isBottleEdgeSection` — `src/lib/configurator/sink.ts` — правила секций;
- `doorCount` — `src/components/configurator/KitchenScene.tsx` — локальная копия № 7 (см. п. 6.1).

**Отдельно выявлено:**
- **дублирующиеся формулы:** см. раздел 6;
- **одинаковые параметры с разными значениями:** `SUPPORT_SYSTEMS` (edgeInset/maxSpan/maxLoad) дублируются на уровне `config.supports` — `computeSupports` берёт значение конфига, если оно задано, иначе каталога; `PRICING.wardrobe.plinthPerMeter` (1600 ₽) и ставка цоколя из `content/plinth.ts` (1600–6200 ₽) — разные механизмы для кухни и шкафа;
- **значения, жёстко зашитые в коде:** `Math.max(0.5, depthFactor)`, `w > 60`, `±10 %` в `formatRange`, `baseHeight || 90`, `Math.max(0.4, …)` для толщины столешницы, `25` модулей в zod, `slice(-2000)` в `server/projects.ts`;
- **расчёты в нескольких местах независимо:** счётчик дверей, зазоры фасадов, толщина 16 мм, «проём = корпус − 32 мм»;
- **неявные зависимости:** `computeLighting` зависит от `countertopThickness` и `wallGapAboveCountertop`; `computeSupports` зависит от `sinkLayout` (перегородки мойки); `pricing` зависит от `sinkRowContext` (порядок модулей в массиве).

---

## 4. Реестр цен и справочников (118 элементов)

Единицы: ₽, ₽/м², ₽/пог. м, ₽/шт. **«Источник»** — демо/код, т.к. баз закупочных цен в проекте нет.

| № | Позиция | Значение | Ед. | Файл : переменная | Где используется | Влияние на итог | Смена без кода |
|---|---|---|---|---|---|---|---|
| 1 | Шаг округления | 100 | ₽ | `content/pricing.ts` : `PRICING.rounding` | `roundMoney` | итог | да |
| 2 | Минимальная стоимость заказа | 45000 | ₽ | там же : `PRICING.minOrder` | обе цены | пол | да |
| 3 | Основа проекта (кухня) | 12000 | ₽ | там же : `kitchen.baseCost` | `calculateKitchenPrice` | суммарно ×complexity | да |
| 4 | Коэффициент сложности за модуль | 0.02 | — | там же : `kitchen.complexityPerExtraModule` | `complexityFactor` | ×до 1.12 | да |
| 5 | Потолок коэффициента | 1.12 | — | там же : `kitchen.complexityMax` | `complexityFactor` | ограничение | да |
| 6 | Опора глубины (кухня) | 60 | см | там же : `kitchen.bodyDepthReference` | `depthFactor` | корпус | да |
| 7 | Надбавка за глубину столешницы | 0.04 | — | там же : `kitchen.countertopDepthAllowance` | **не используется** | нет | да (пустой) |
| 8 | Цоколь ₽/м (кухня, устаревший) | 1600 | ₽/м | там же : `kitchen.plinthPerMeter` | **не используется** (кухня берёт `content/plinth.ts`) | нет | да (пустой) |
| 9 | Полка (кухня) | 1100 | ₽/шт | там же : `kitchen.shelf` | `optionsCost` | да | да |
| 10 | Подсветка за метр (устаревшая) | 1900 | ₽/м | там же : `kitchen.underCabinetLightPerMeter` | **не используется** (заменено компонентной спецификацией) | нет | да (пустой) |
| 11 | Декоративная боковина | 4800 | ₽/шт | там же : `kitchen.sidePanel` | `optionsCost` | да | да |
| 12 | Вырез под мойку | 3800 | ₽/модуль | там же : `kitchen.sinkCutout` | `optionsCost` | да | да |
| 13 | Перегородка мойки (демо) | 2400 | ₽ | там же : `kitchen.sinkPartition` | **не используется** (перегородки бесплатны) | нет | да (пустой) |
| 14 | Бутылочница | 5000 | ₽ | там же : `kitchen.bottleRack` | `optionsCost` | да | да |
| 15 | Вырез под варочную | 2800 | ₽ | там же : `kitchen.hobCutout` | `optionsCost` | да | да |
| 16 | Ниши под технику | 2200 | ₽ | там же : `kitchen.ovenNiches` | `optionsCost` | да | да |
| 17 | Петля (кухня) | 390 | ₽/шт | там же : `kitchen.hingePerDoor` | `fittingsCost` | да | да |
| 18 | Доводчик (кухня) | 460 | ₽/шт | там же : `kitchen.softClosePerDoor` | `fittingsCost` | да | да |
| 19 | Push-to-open (кухня) | 1350 | ₽/шт | там же : `kitchen.pushToOpenPerDoor` | `fittingsCost` | да | да |
| 20 | Направляющие ящика (кухня) | 1900 | ₽/шт | там же : `kitchen.drawerSlide` | `fittingsCost` | да | да |
| 21 | Доводчик ящика (кухня) | 650 | ₽/шт | там же : `kitchen.drawerSoftClose` | `fittingsCost` | да | да |
| 22 | Основа проекта (шкаф) | 9000 | ₽ | там же : `wardrobe.baseCost` | `calculateWardrobePrice` | суммарно | да |
| 23 | Опора глубины (шкаф) | 60 | см | там же : `wardrobe.bodyDepthReference` | `depthFactor` | корпус | да |
| 24 | Коэффициент корпуса шкафа | 1.15 | — | там же : `wardrobe.bodyFactor` | `bodyCost` | да | да |
| 25 | Цоколь шкафа | 1600 | ₽/м | там же : `wardrobe.plinthPerMeter` | `optionsCost` (используется!) | да | да |
| 26 | Полка (шкаф) | 1150 | ₽/шт | там же : `wardrobe.shelf` | `optionsCost` | да | да |
| 27 | Штанга | 2400 | ₽/шт | там же : `wardrobe.rod` | `optionsCost` | да | да |
| 28 | Ящик шкафа | 6200 | ₽/шт | там же : `wardrobe.drawer` | `fittingsCost` | да | да |
| 29 | Доводчик ящика (шкаф) | 650 | ₽/шт | там же : `wardrobe.drawerSoftClose` | `fittingsCost` | да | да |
| 30 | LED за секцию шкафа | 3800 | ₽/шт | там же : `wardrobe.ledPerSection` | `optionsCost` | да | да |
| 31 | Петля (шкаф) | 390 | ₽/шт | там же : `wardrobe.hingePerDoor` | `fittingsCost` | да | да |
| 32 | Доводчик (шкаф) | 460 | ₽/шт | там же : `wardrobe.softClosePerDoor` | `fittingsCost` | да | да |
| 33 | Push-to-open (шкаф) | 1350 | ₽/шт | там же : `wardrobe.pushToOpenPerDoor` | `fittingsCost` | да | да |
| 34 | Корпус: ЛДСП | 5200 | ₽/м² | `content/catalog.ts` : `BODY_MATERIALS[0].ratePerSqm` | `bodyRate` | да | да |
| 35 | Корпус: МДФ | 7600 | ₽/м² | там же | `bodyRate` | да | да |
| 36 | Корпус: Фанера | 9200 | ₽/м² | там же | `bodyRate` | да | да |
| 37 | Фасад: ЛДСП | 5600 | ₽/м² | `FACADE_MATERIALS[0].ratePerSqm` | `facadeRate` | да | да |
| 38 | Фасад: МДФ в эмали | 8400 | ₽/м² | там же | `facadeRate` | да | да |
| 39 | Фасад: Шпон | 11800 | ₽/м² | там же | `facadeRate` | да | да |
| 40 | Фасад: Стекло | 14400 | ₽/м² | там же | `facadeRate` | да | да |
| 41 | Фасад: Массив | 18600 | ₽/м² | там же | `facadeRate` | да | да |
| 42 | Стиль «Ровный» | 1.0 | × | `FACADE_STYLES[0].multiplier` | `frontsCost` | да | да |
| 43 | Стиль «Рамочный» | 1.16 | × | там же | `frontsCost` | да | да |
| 44 | Стиль «Без ручек» | 1.08 | × | там же | `frontsCost` | да | да |
| 45 | Ручка-скоба | 780 | ₽/шт | `HANDLES[0].rate` | `fittingsCost` | да | да |
| 46 | Ручка-кнопка | 560 | ₽/шт | там же | `fittingsCost` | да | да |
| 47 | Врезной профиль | 1450 | ₽/шт | там же | `fittingsCost` | да | да |
| 48 | Без ручек | 0 | ₽/шт | там же | `fittingsCost` | да | да |
| 49 | Столешница ЛДСП + HPL | 9500 | ₽/пог. м | `COUNTERTOPS[0].ratePerLinearMeter` | `optionsCost` | да | да |
| 50 | Столешница Compact HPL | 9500 | ₽/пог. м | там же | `optionsCost` | да (см. 6.10) | да |
| 51 | Акриловый камень | 16800 | ₽/пог. м | там же | `optionsCost` | да | да |
| 52 | Кварцевый агломерат | 22400 | ₽/пог. м | там же | `optionsCost` | да | да |
| 53 | Керамогранит | 29400 | ₽/пог. м | там же | `optionsCost` | да (см. 6.10) | да |
| 54 | Массив дерева (столешница) | 29400 | ₽/пог. м | там же | `optionsCost` | да | да |
| 55 | Цоколь ЛДСП | 1600 | ₽/м | `content/plinth.ts` : `PLINTH_MATERIALS[0].ratePerMeter` | `plinthRatePerMeter` | да | да |
| 56 | Цоколь МДФ | 2200 | ₽/м | там же | там же | да | да |
| 57 | Цоколь Пластик | 2600 | ₽/м | там же | там же | да | да |
| 58 | Цоколь Алюминий | 4400 | ₽/м | там же | там же | да | да |
| 59 | Цоколь Нерж. сталь | 6200 | ₽/м | там же | там же | да | да |
| 60–64 | Δ исполнений ЛДСП (ПВХ 2 / ПВХ 0.4) | 0 / −120 | ₽/м | `PLINTH_MATERIALS[0].finishes[].rateDelta` | `plinthRatePerMeter` | да | да |
| 65–66 | Δ исполнений МДФ (эмаль / плёнка) | +700 / +250 | ₽/м | там же | там же | да | да |
| 67–68 | Δ исполнений Пластик (мат / глянец) | 0 / +200 | ₽/м | там же | там же | да | да |
| 69–70 | Δ Алюминий (анод / порошок) | 0 / +350 | ₽/м | там же | там же | да | да |
| 71–72 | Δ Нержавейка (шлиф / зеркало) | 0 / +600 | ₽/м | там же | там же | да | да |
| 73 | Опора (standard) | 420 | ₽/шт | `content/supports.ts` : `SUPPORT_SYSTEMS[0].legPrice` | `SupportPlan.cost` | да | да |
| 74 | Клипса (standard) | 60 | ₽/шт | там же | `SupportPlan.cost` | да | да |
| 75 | Винт (standard) | 9 | ₽/шт | там же | `SupportPlan.cost` | да | да |
| 76 | Анкер (standard) | 350 | ₽/шт | там же | `SupportPlan.cost` | да | да |
| 77 | Опора (heavy) | 690 | ₽/шт | `SUPPORT_SYSTEMS[1].legPrice` | `SupportPlan.cost` | да | да |
| 78 | Клипса (heavy) | 65 | ₽/шт | там же | `SupportPlan.cost` | да | да |
| 79 | Винт (heavy) | 12 | ₽/шт | там же | `SupportPlan.cost` | да | да |
| 80 | Анкер (heavy) | 400 | ₽/шт | там же | `SupportPlan.cost` | да | да |
| 81 | Профиль накладной | 620 | ₽/м | `content/lighting.ts` : `LED_PROFILES[0].ratePerMeter` | `LightingPlan.cost` | да | да |
| 82 | Профиль врезной | 760 | ₽/м | там же | там же | да | да |
| 83 | Профиль угловой | 690 | ₽/м | там же | там же | да | да |
| 84 | Рассеиватель прозрачный | 420 | ₽/м | `LED_DIFFUSERS[0].ratePerMeter` | `LightingPlan.cost` | да | да |
| 85 | Рассеиватель матовый | 540 | ₽/м | там же | там же | да | да |
| 86 | Управление: выключатель | 780 | ₽/шт | `LED_CONTROLS[0].price` | `LightingPlan.cost` | да | да |
| 87 | Управление: сенсор | 1650 | ₽/шт | там же | там же | да | да |
| 88 | Управление: диммер | 2300 | ₽/шт | там же | там же | да | да |
| 89–96 | Блоки питания 20/30/60/100/150/200/300/400 Вт | 950/1250/1650/2100/2650/3400/4300/5600 | ₽ | `LED_PSU_PRICE` | `LightingPlan.cost` | да | да |
| 97 | Лента 24 В 4.8 Вт/м | 780 | ₽/м | `LED_STRIPS[0].pricePerMeter` | `LightingPlan.cost` | да | да |
| 98 | Лента 24 В 9.6 Вт/м | 1150 | ₽/м | там же | там же | да | да |
| 99 | Лента 24 В 14.4 Вт/м | 1500 | ₽/м | там же | там же | да | да |
| 100 | Лента 24 В 19.2 Вт/м | 1900 | ₽/м | там же | там же | да | да |
| 101 | Лента 12 В 4.8 Вт/м | 740 | ₽/м | там же | там же | да | да |
| 102 | Лента 12 В 9.6 Вт/м | 1100 | ₽/м | там же | там же | да | да |
| 103 | Лента 12 В 14.4 Вт/м | 1450 | ₽/м | там же | там же | да | да |
| 104 | Лента 12 В 19.2 Вт/м | 1850 | ₽/м | там же | там же | да | да |
| 105 | Заглушка профиля | 110 | ₽/шт | `LED_END_CAP_PRICE` | `LightingPlan.cost` | да | да |
| 106 | Соединитель | 260 | ₽/шт | `LED_CONNECTOR_PRICE` | `LightingPlan.cost` | да | да |
| 107 | Монтаж подсветки | 450 | ₽/м | `LED_INSTALL_PRICE_PER_METER` | `LightingPlan.cost` | да | да |
| 108 | Промокод DEMO10 | 10 %, минимум 120000, кап 30000 | ₽ | `content/pricing.ts` : `PROMOS[0]` | `applyPromo` | скидка | да |
| 109 | Промокод WARDROBE7 | 7 %, минимум 70000, кап 18000 | ₽ | `PROMOS[1]` | `applyPromo` | скидка | да |
| 110 | Промокод DEMO5000 | фикс. 5000, минимум 90000 | ₽ | `PROMOS[2]` | `applyPromo` | скидка | да |
| 111 | basePrice «Нижний шкаф» | 8200 | ₽ | `KITCHEN_MODULES.base.basePrice` | `bodyCost` | да | да |
| 112 | basePrice «Модуль под мойку» | 11400 | ₽ | `KITCHEN_MODULES.sink.basePrice` | `bodyCost` | да | да |
| 113 | basePrice «Варочная» | 10400 | ₽ | `KITCHEN_MODULES.hob.basePrice` | `bodyCost` | да | да |
| 114 | basePrice «Блок ящиков» | 12100 | ₽ | `KITCHEN_MODULES.drawers.basePrice` | `bodyCost` | да | да |
| 115 | basePrice «Верхний шкаф» | 6800 | ₽ | `KITCHEN_MODULES.wall.basePrice` | `bodyCost` | да | да |
| 116 | basePrice «Пенал» | 15800 | ₽ | `KITCHEN_MODULES.tall.basePrice` | `bodyCost` | да | да |
| 117 | basePrice «Пенал под технику» | 14600 | ₽ | `KITCHEN_MODULES.oven.basePrice` | `bodyCost` | да | да |
| 118 | basePrice «Бутылочница» | 5000 | ₽ | `KITCHEN_MODULES.bottle.basePrice` | `bodyCost` | да | да |

Все 8 пресетов модулей учтены (строки 111–118). Строки 60–72 и 89–96 в таблице сгруппированы (по 2–8 элементов в строке), поэтому количество строк таблицы (100) меньше количества элементов (118).

**Стоимость обработки/работ:** монтаж подсветки 450 ₽/м (`LED_INSTALL_PRICE_PER_METER`) и «Основа проекта» (проектирование/раскрой) — единственные явные статьи работ. Отдельные позиции «распил/кромление/сборка» — **не обнаружено**.
**Правила округления и итог:** `roundMoney` (шаг 100 ₽) → `max(minOrder, …)` → скидка → повторное округление (`calculateKitchenPrice`, `calculateWardrobePrice`). Отдельного НДС/логистики — **не обнаружено**.

---

## 5. Карта зависимостей «параметр → формула → результат → использование»

| Параметр | Формула/алгоритм | Результат | Геометрия | 2D | 3D | Спецификация | Стоимость |
|---|---|---|---|---|---|---|---|
| `modules[].width/height/depth` | `area`, `depthFactor`, `KITCHEN_MODULES` | `bodyCost`, ширина ряда | да | да | не обнаружено (3D-режима нет, только 2D SVG) | да | да |
| `modules[].width` | `doorCountForWidth` / `kitchenDoorCount` | число дверей | — | да | — | петли/ручки | да |
| `sinkWidth/Depth/Position/Offset/Cutout` | `sinkGeometry` → `sinkLayout` | секции, панели, перегородки | да | да | — | полки/ящики/бутылочницы | да (`frontsCost`, `fittingsCost`, `bottleRack`) |
| `sinkStorage[]` | `normalizeSinkStorage`, `autoPartitionSides` | наполнение секций | да | да | — | да | да (полки/ящики, перегородки бесплатно) |
| `bodyMaterial` / `facadeMaterial` / `facadeStyle` | `bodyRate/facadeRate/styleMultiplier` | ставки | — | цвет | — | — | да |
| `handle` / `hinge` / `pushToOpen` | `handleRate`, условные наценки | `fittingsCost` | — | отрисовка ручек | — | да | да |
| `countertop` | `kitchenCountertopWidth × ratePerLinearMeter` | стоимость столешницы | — | да | — | — | да |
| `countertopThickness` | `availableLength` (lighting), `KitchenScene` | высота 2D, низ верхнего ряда | да | да | — | — | **нет** (противоречие: см. п. 6.11) |
| `plinth` / `plinthMaterial` / `plinthFinish` | `plinthRatePerMeter` × ширина нижнего ряда | стоимость цоколя | высота 2D | да | — | клипсы/винты | да |
| `plinthHeight` | геометрия 2D | высота цоколя | да | да | — | — | **нет** (см. п. 6.11) |
| `supports.systemId/maxSpan/maxLoad` | `computeSupports` | опоры, клипсы, винты, анкеры | — | да | — | да | да |
| `lighting.*` | `computeLighting` | длина, мощность, БП, компоненты | — | цвет/наличие | — | да | да |
| `modules.length` | `complexityFactor = min(1.12, 1 + extra×0.02)` | множитель | — | — | — | — | да |
| `promoCode` | `calculatePromo` | скидка | — | — | — | — | да |
| `sidePanels` | `×4800` | стоимость | — | — | — | — | да (UI отключён) |

**Случаи «параметр изменился, зависимые результаты не обновляются»:**
1. `countertopThickness` и `plinthHeight` меняют 2D и подсветку, но не цену (5, 6, 10, 11 категорий).
2. `PRICING.kitchen.sinkPartition`, `plinthPerMeter`, `underCabinetLightPerMeter`, `countertopDepthAllowance` меняются в коде, но на результат не влияют вообще (см. 6.5–6.8).
3. `KITCHEN_LIMITS.minCountertopMeters` меняется без эффекта (не читается).
4. Смена зазоров в `SINK_RULES` меняет спецификацию и валидацию, но 2D-картинка останется с прежними зазорами `KitchenScene.tsx` (см. 6.2).
5. Смена `SINK_RULES.bottleClearOffset` не обновит подпись «проём N−32 мм» в `KitchenPanel.tsx` (см. 6.4).

---

## 6. Дублирования и противоречия (не исправлялись)

### 6.1. Дублирование счётчика дверей
- `src/lib/configurator/pricing.ts` : `doorCountForWidth(width) = width > 60 ? 2 : 1` — используется для цены и валидации шкафов.
- `src/components/configurator/KitchenScene.tsx` : `doorCount(width) = width > 60 ? 2 : 1` — локальная копия для рендера.
- Порог «60 см» продублирован дважды. Изменение одного не меняет второе → сцена может показать 1 створку, а расчёт посчитать 2.
- Также в `pricing.ts` есть ветвление `kitchenDoorCount`, которое в сцене отсутствует (мойка/ящики считаются в сцене иначе).

### 6.2. Различия зазоров фасадов: `sink.ts` и `KitchenScene.tsx`
- `SINK_RULES.facadeEdgeGap = 0.2`, `facadeNeighborGap = 0.1`, `facadeInnerGap = 0.1` (`src/lib/configurator/sink.ts`) — используются в `sinkLayout` → спецификация/цена/валидация.
- `EDGE_GAP = 0.2`, `NEIGHBOR_GAP = 0.1`, `DOOR_GAP = 0.1` (`src/components/configurator/KitchenScene.tsx`) — используются только в рендере.
- Совпадение сейчас числовое, но это **две разные константы**. Дополнительно `SINK_RULES.facadeGap = 0.25` используется в геометрии секций (`sectionFitsDrawers`, `resolvePartitionBox`) — третий, иной по величине зазор.

### 6.3. Толщина 1.6
- `SINK_RULES.sidePanel = 1.6` и `SINK_RULES.partition = 1.6` (см) — источник геометрии.
- `KitchenScene.tsx` : `width={safe(module.width) + 1.6}` (подсветка модуля) — literal 1.6 независимо.
- `WardrobeScene.tsx` : `interiorWidth = sectionWidth - 2.8` — иная толщина корпуса (28 мм), тогда же `WARDROBE_LIMITS.carcassThickness = 2` (2 см) — **третье расхождение** (дополнительное наблюдение).
- Зависимости: `sectionOuterWidth`, `buildSections`, рендер.

### 6.4. `bottleClearOffset: 3.2` против `-32`
- Источник истины: `SINK_RULES.bottleClearOffset = 3.2` (см) в `sink.ts` (`applyBottleCut`).
- `src/components/configurator/KitchenPanel.tsx` использует литерал `body * 10 - 32` и `fill.bottle * 10 - 32` (три места) — т.е. 32 мм вместо 3.2 см.
- Сейчас числа эквивалентны (10 мм × 3.2 = 32 мм), но связаны только вручную; изменение `bottleClearOffset` не обновит тексты подсказок.

### 6.5. `PRICING.kitchen.plinthPerMeter`
- Задано 1600 ₽/м в `src/content/pricing.ts`, **не читается нигде**: цоколь кухни считает `plinthRatePerMeter` (`src/content/plinth.ts`).
- При этом `PRICING.wardrobe.plinthPerMeter` (1600 ₽) **используется** в `calculateWardrobePrice`.
- Итог: два разных механизма цены цоколя; правка `kitchen.plinthPerMeter` не влияет ни на что.

### 6.6. `PRICING.kitchen.sinkPartition`
- Задано 2400 ₽ «демо-ставка за перегородку», но в `calculateKitchenPrice` перегородки явно не тарифицируются (комментарий: «Перегородки — часть корпуса, отдельно не начисляются»).
- Одновременно существует поле модели `KitchenModule.sinkPartition` (`types.ts`), которое `normalizeSinkModule` принудительно очищает, а `schema.ts` всё ещё принимает.
- Итог: цена, опция модели и её очистка — три несогласованных места.

### 6.7. `PRICING.kitchen.underCabinetLightPerMeter`
- 1900 ₽/м не используется: подсветка считается комплектной спецификацией `computeLighting` (лента, профиль, рассеиватель, заглушки, соединители, БП, управление, монтаж).
- Старая ставка осталась в конфиге — ложная точка настройки.

### 6.8. `PRICING.kitchen.countertopDepthAllowance`
- 0.04 не используется: глубинный множитель применяется только к корпусу (`bodyCost`), к столешнице — нет (цена только по длине).
- Прямое следствие: более толстая/дороже столешница не увеличивает стоимость.

### 6.9. Различия высот 80/95 в `KitchenPanel`
- `src/components/configurator/KitchenPanel.tsx` : ползунок высоты нижнего ряда `min={80} max={95}` и ползунок пенала `min={200}` — литералы.
- `src/content/catalog.ts` : `KITCHEN_MODULES.base/sink/hob/drawers.minHeight/maxHeight = 80/95`, `tall.minHeight = 200`.
- Дублирование диапазонов: правка пресета в каталоге не обновит слайдер панели (и наоборот).

### 6.10. Одинаковые ставки разных столешниц
- `ldsp_hpl` = 9500 ₽/м и `compact_hpl` = 9500 ₽/м (разные материалы, разные толщины 26/28/38 против 6–13 мм).
- `porcelain` = 29400 ₽/м и `solid_wood` = 29400 ₽/м (керамогранит и массив).
- Может быть намеренно (демо-сетка), но кода, подтверждающего намеренность, не обнаружено — **требует проверки**.

### 6.11. Дополнительные наблюдения (вне 10 основных)
- `KITCHEN_LIMITS.minCountertopMeters` не используется.
- Высота цоколя `plinthHeight` и толщина столешницы не влияют на цену.
- `KitchenPanel.tsx` : `maxWidthByTotal = Number.POSITIVE_INFINITY` (лимит общей ширины кухни снят, но `WardrobePanel` сохраняет предел).
- `complexityFactor` применяется к `baseCost`, а строка «Основа проекта» показывает значение без множителя.
- `LED_PSU` подбор: если `psuRequiredW > 400`, выбирается 400 Вт, а количество считается через `strip.maxPsuW` — возможен «недобор» или избыточная поставка, **требует проверки**.
- Ставка `sinkCutout` не зависит от площади выреза.
- 3D-визуализация: **не обнаружено** (только 2D SVG-схема и интерьерная отрисовка `KitchenScene`).

---

## 7. Хранение, версионирование и совместимость проектов

**Что есть:**
1. **Черновик (браузер):** `src/lib/configurator/storage.ts` — ключ `formakub:draft:{type}:v1`, `saveLocalDraft`/`loadLocalDraft`; загрузка через `safeParseConfig` (zod) + `normalizeKitchen`; при ошибке парсинга возвращает `null` (черновик теряется молча).
2. **Проект (сервер):** `src/app/api/projects/route.ts` → `src/lib/server/projects.ts` : `saveProject` — валидация → `calculatePrice` → запись `StoredProject { id, config, price, createdAt, updatedAt }` в `data/projects.json` (атомарная запись через `src/lib/server/store.ts`, лимит `slice(-2000)`).
3. **Загрузка проекта:** `getProject` — `normalizeKitchen` → `validateConfig` → **пересчёт `calculatePrice`**, т.е. сохранённый `price` перезаписывается текущими ценами при выдаче.
4. **Схема/версии:** `config.version = 1` (литерал в `schema.ts`), `storage.VERSION = "v1"`, `PRICING.version = "demo-2026-01"` — троя разнесены, ни одна не попадает в `StoredProject`.
5. **Миграции:** `COUNTERTOP_LEGACY_MAP` (zod `preprocess`), optional-поля с `.default(...)` в `schema.ts`, идемпотентная нормализация `normalizeKitchen`/`normalizePlinthOptions`/`normalizeLighting`/`normalizeSupportSettings`, очистка легаси `sinkPartition`. Тесты: `migration.test.ts`.

**Чего нет:**
- версии конфигурации расчётов и версии прайса в сохранённом проекте — **не обнаружено**;
- хранения «цена на момент сохранения» с возможностью показа старой цены — снимок есть, но выдача его пересчитывает;
- реестра миграций (chain of migrations) — только «заливка значений по умолчанию»;
- возможности читать проект, созданный более новой версией схемы (`strictObject` отклонит незнакомые поля).

**Как внедрить версии конфигурации расчётов и цен без нарушения существующих проектов (рекомендация, без реализации):**
1. Добавить в `KitchenConfig`/`WardrobeConfig` опциональные поля `schemaVersion` и `calcVersion` (типизированные литералы с `.optional().default(...)`), в `StoredProject` — `priceVersion` + сохранённый `price` без пересчёта в `getProject` (пересчёт только по явному запросу «пересчитать»).
2. Отсутствие полей трактовать как v1 (`config.version = 1`, `PRICING.version = demo-2026-01`) — это совпадает с текущим поведением и не ломает `data/projects.json`.
3. Хранить наборы цен как версионируемые справочники (`pricing@demo-2026-01`), а в проекте — ссылку `priceVersion`; при несовпадении показывать две суммы (сохранённая / актуальная).
4. Не добавлять новые обязательные поля в `strictObject` — только `.optional().default(...)` либо отдельную версионную схему.
5. Каждый шаг нормализации должен оставаться идемпотентным (текущее свойство закреплено тестами `migration.test.ts`).

---

## 8. Предлагаемая структура технической панели Calculation Admin

**А. Геометрические параметры** (разделы 2.1–2.2)
- *Редактируемые через интерфейс:* `SINK_RULES` (все, кроме вычисляемых), `KITCHEN_LIMITS`, `WARDROBE_LIMITS`, пресеты `KITCHEN_MODULES` (min/max/default по трём осям, `defaultShelves`, `defaultDrawers`), `MIN_LEG_SPACING_CM`, `PARTITION_SNAP_CM`, `MERGE_TOLERANCE_CM`, `LED_END_MARGIN_CM`, `wallGapAboveCountertop`.
- *Только код:* `MIN_DOOR_WIDTH` (выводится), `MIN_FLOOR_Y`, `MARGIN`, `EDGE_GAP/NEIGHBOR_GAP/DOOR_GAP` (до тех пор, пока не устранено дублирование), `zod`-границы без синхронизации с каталогом, порядок вычислений `sinkGeometry → sinkLayout`.

**Б. Справочники** (разделы 2.3–2.12)
- *Редактируемые:* `BODY_MATERIALS`, `FACADE_MATERIALS`, `FACADE_STYLES`, `HANDLES`, `COUNTERTOPS` (ставка, толщины, дефолт), `PLINTH_MATERIALS`, `PLINTH_MOUNTS`, `SUPPORT_SYSTEMS`, `MODULE_LOAD_KG`/`REFERENCE_WIDTH`, `SINK_STANDARD_SIZES`, `LED_*` (напрявления, мощности, температуры, профили, рассеиватели, управление, БП, ленты), `PROMOS`.
- *Только код:* типы идентификаторов (`zod enum`), `COUNTERTOP_LEGACY_MAP`, совместимость ручек/фасадов (`validateCompatibility`), `ownSupports` (признак из паспорта техники).

**В. Цены** (раздел 4)
- *Редактируемые:* все 118 элементов, включая `basePrice` пресетов, ставки ₽/м², ₽/м, ₽/шт, фиксированные сборы, надбавки за исполнение, `PRICING.rounding`, `PRICING.minOrder`, `complexityPerExtraModule`/`complexityMax`, `bodyFactor`, `bodyDepthReference`.
- *Только код:* формула `subtotalRaw × complexityFactor`, порядок округления/скидки, `formatRange` ±10 %, тексты `lines` (лейблы).

**Г. Формулы и алгоритмы** (раздел 3)
- *Редактируемые:* только числовые константы, от которых зависят формулы (перечислены в А/В), — сами формулы остаются кодом.
- *Только код:* `sinkLayout`, `computeFacadeBoxes`, `applyBottleCut`, `resolvePartitionBox`, `distributeDoors`, `autoPartitionSides`, `positionsForModule`, `availableLength`, `roundMoney`, `calculatePromo`, `normalizeSinkModule`.

**Д. Контроль**
- Сопутствующее: набор тестов (`vitest`), карта зависимостей (раздел 5), версии конфигураций и истории изменений (раздел 7), сравнение расчётов до/после изменения цены (golden-тесты на `PriceBreakdown`).
- *Не относится к панели:* валидация ввода пользователя, миграция данных, права доступа к API проектов.

---

## 9. Параметры, готовые к внешнему управлению (без изменения расчётной логики)

1. Все ставки `PRICING.kitchen`/`PRICING.wardrobe`, кроме **постоянных мёртвых**: `countertopDepthAllowance`, `plinthPerMeter` (кухня), `underCabinetLightPerMeter`, `sinkPartition`.
2. `PRICING.rounding`, `PRICING.minOrder`, `complexityPerExtraModule`, `complexityMax`, `bodyFactor`, `bodyDepthReference` (с синхронной валидацией диапазонов).
3. `BODY_MATERIALS.ratePerSqm`, `FACADE_MATERIALS.ratePerSqm`, `FACADE_STYLES.multiplier`, `HANDLES.rate`, `COUNTERTOPS.ratePerLinearMeter`/`thicknesses`/`defaultThickness`, `countertop` legacy-маппинг.
4. `PLINTH_MATERIALS.ratePerMeter`/`rateDelta`/`thicknesses`, `PLINTH_MOUNTS`.
5. `SUPPORT_SYSTEMS` (все числовые поля и цены), `MODULE_LOAD_KG`, `MODULE_LOAD_REFERENCE_WIDTH`.
6. Вся цена LED-блока (`LED_PROFILES/DIFFUSERS/CONTROLS/PSU_PRICE/STRIPS/END_CAP/CONNECTOR/INSTALL`), `LED_PSU_MARGIN`.
7. `KITCHEN_MODULES` (все числовые поля и `basePrice`), `KITCHEN_LIMITS`, `WARDROBE_LIMITS` — с ограничением, что `zod`-границы в `schema.ts` должны синхронизироваться (см. п. 11).
8. `PROMOS`, тексты `PRICE_DISCLAIMER`, `SUPPORTS_PRELIMINARY_NOTE`.
9. `SINK_RULES` — **осторожно**: значения попадают в геометрию, валидацию и 2D, часть продублирована в `KitchenScene.tsx`.

## 10. Параметры, требующие дополнительного исследования

- Каталоги: мойки и сифоны, смесители, встроенная техника, системы ящиков, кромка фасадов, петли по брендам, декоративные торцы, работы по сборке/доставке — **не обнаружено**.
- Инженерные данные, помеченные `preliminary`: `SUPPORT_SYSTEMS` (пролёт, нагрузка), `MODULE_LOAD_KG`, `LED_STRIPS` (`maxContinuousRunM`, `voltageDropPct`, `maxPsuW`), монтажный отступ `mountEdge = 50 мм`.
- Цена от толщины столешницы и высоты цоколя, цена перегородок, минимальный погонный метр столешницы (`minCountertopMeters`).
- Корректность подбора БП при `psuRequiredW > 400 Вт`.
- Влияние `depthFactor` с зажимом `0.5`.
- Соотношение `WARDROBE_LIMITS.carcassThickness = 2` и `interiorWidth = sectionWidth − 2.8` в `WardrobeScene.tsx`.
- Наличие 3D-режима: **не обнаружено** — при «3D-визуализации» из ТЗ следует читать интерьерный режим `KitchenScene`.

## 11. Риски и ограничения

1. Старые проекты молча пересчитываются по текущим ценам (`getProject`), снимок цены в `projects.json` фактически не используется для показа.
2. Дублирование зазоров/толщин/счётчика дверей → расхождение 2D и спецификации при любом правках `SINK_RULES`.
3. Четыре «мёртвых» ценовых поля создают ложные точки настройки панели.
4. Нет каталога работ и комплектующих по мойкам/технике → итог неполон (см. п. 10).
5. `strictObject` в `schema.ts`: любое новое поле без дефолта сломает загрузку старых проектов.
6. Данные в `data/projects.json` хранятся в репозитории проекта — при выносе прайса наружу нужна изоляция (риск доступа к демо-ценам).
7. Все ставки помечены демо (`PRICING.version = demo-2026-01`), инженерных подтверждений нет.

## 12. Рекомендуемая последовательность дальнейшей реализации

1. **Этап 0 (подготовка):** убрать/пометить мёртвые поля и зафиксировать единый источник зазоров и толщины 16 мм — только после согласования, т.к. это уже правка логики.
2. **Этап 1 (модель данных):** ввести `schemaVersion`/`calcVersion`/`priceVersion` (опциональные поля), сохранять цену-снимок без пересчёта; миграция старых проектов через дефолты.
3. **Этап 2 (справочники):** вынести 118 ценовых элементов и каталоги в версионируемые таблицы с редактированием, сохраняя текущие идентификаторы (`id`), чтобы `zod`-схемы не менялись.
4. **Этап 3 (поля панели А–В):** формы редактирования лимитов и пресетов с валидацией диапазонов, ограниченной текущими `zod`-границами.
5. **Этап 4 (контроль):** golden-тесты на `PriceBreakdown` (эталонные конфигурации), проверка зависимостей из раздела 5, журнал изменений и «история версий прайса».
6. **Этап 5 (недостающие справочники):** мойки/смесители/техника/работы — после получения фактических данных.
7. Реализацию вести отдельной задачей; настоящий документ ничего не изменяет.

## 13. Итоговый отчёт

**Счёт выполнен по строкам реестров этого документа.**

- **Категорий параметров:** 13 (п. 1–13) + отдельный раздел «Прочие параметры» (п. 14).
- **Параметров найдено:** 148 строк реестра в категориях 1–12 и 14 (п. 1: 32, п. 2: 22, п. 3: 11, п. 4: 6, п. 5: 9, п. 6: 15, п. 7: 13, п. 8: 6, п. 9: 8, п. 10: 4, п. 11: 14, п. 12: 3, п. 14: 5).
- **Параметров категории «Цены и наценки» (правила, вне ставок):** 8 (`PRICING.version`, `currency`, `rounding`, `minOrder`, `complexityPerExtraModule`, `complexityMax`, `formatRange`, `PRICE_DISCLAIMER`); 4 из них продублированы строками раздела 4.
- **Ценовых элементов:** 118 (раздел 4, строки 1–118; в таблице 100 строк, т.к. 60–72 и 89–96 сгруппированы).
- **Формул и алгоритмов:** 17 основных (раздел 3) + 6 групп вспомогательных функций.
- **Дублирований/противоречий:** 10 основных (6.1–6.10) + 8 дополнительных наблюдений (6.11).
- **Жёстко зашиты в коде:** `SINK_RULES` (25 значений), зазоры сцены (5), допуски опор (3), `Math.max(0.5, depthFactor)`, `w > 60`, `±10 %`, `baseHeight ‖ 90`, `Math.max(0.4, …)`, диапазоны 80/95 и 200 в `KitchenPanel.tsx`, литералы `32 мм` в `KitchenPanel.tsx`, `25` и `1–25` в zod, `slice(-2000)`, `MIN_FLOOR_Y = 272`, `MARGIN = 44`.
- **Можно вынести без изменения расчётной логики:** раздел 9 (все 118 цен, каталоги, лимиты, промо, правила округления/минзаказа).
- **Требует переработки логики:** раздел 10 + схемы `zod` (синхронизация с каталогами), версии прайса в `StoredProject`, единый источник зазоров/толщин, устранение дублей счётчика дверей и `3.2/32`.
- **Изменения для будущей панели:** версионирование конфигураций/цен (п. 7), вынос 118 ставок в редактируемые таблицы, формы для разделов А–В, тесты-эталоны и журнал изменений (п. 8, 12).

**Проверка чистоты аудита:** исходный код не изменялся; создан только `CALCULATOR_TECHNICAL_AUDIT.md`.
