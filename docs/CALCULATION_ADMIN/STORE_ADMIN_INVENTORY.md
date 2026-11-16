# STORE ↔ CALCULATION ADMIN — ИНВЕНТАРИЗАЦИЯ

- **Дата:** 2026-11-16
- **Режим:** READ-ONLY (исходный код, схемы, API, БД, конфигурация и ADR **не изменялись**)
- **Назначение:** объективная карта соответствия Store ↔ Calculation Admin ↔ Engine
- **Связанные документы:** `MODULE_AND_COMPONENT_INVENTORY.md`, `CALCULATION_ADMIN_CATALOG_MODEL.md`, `ADMIN_TARGET_STRUCTURE_RECONCILIATION.md`, `COMPONENT_DOMAIN_MODEL_PROPOSAL.md`, `COMPOSITION_ENGINE_INTEGRATION_DESIGN.md`, `PROJECT_BACKLOG.md`
- **Спутники:** `STORE_ADMIN_GAP_ANALYSIS.md`, `GLOBAL_IMPLEMENTATION_BACKLOG.md`

> Документ не дублирует `MODULE_AND_COMPONENT_INVENTORY.md` (перечень модулей/комплектующих) и
> `ADMIN_TARGET_STRUCTURE_RECONCILIATION.md` (целевая структура меню). Здесь — **связь данных**
> Store → Admin → Engine с проверкой фактического пути.

---

## 1. Метод

1. Прочитаны существующие документы-аналоги (см. «Связанные»), дубли не создавались.
2. Состав Store установлен по фактическим коллекциям (`src/lib/server/store.ts` → `collection_state` в SQLite и JSON-файлы в `data/`), схемам (`src/lib/admin/schema.ts`, `src/lib/admin/composition-schema.ts`) и коду-источнику (`src/content/*`, `src/lib/configurator/*`).
3. Состав Admin установлен по API-маршрутам `src/app/api/admin/**` (57 route-файлов) и сервисам `src/lib/admin/*.ts`.
4. Связь с Engine проверена по `CalculationInputs`/`CalculationRequest` (`src/lib/configurator/contract.ts:174–185`) и `engine.ts`.
5. Статус каждого элемента присвоен **только** после проверки реального пути данных, а не факта существования сущности.

### Ограничение метода
Количественные значения коллекций сняты с двух бэкендов (ADR-01): JSON (`data/*.json`) и SQLite (`data/formakub.db`). **Данные в них расходятся** (см. § 5.1). Для инвентаризации использованы структуры и схемы; счётчики приводятся как фактическое наблюдение, а не как эталон.

---

## 2. Фактический состав Store

### 2.1 Коллекции

| Коллекция | Объявлена | JSON | SQLite | Схема |
|---|---|---|---|---|
| `catalog-items.json` | `admin/catalogs.ts:23` | — | 64 записи | `CatalogItem` (`admin/schema.ts:104+`) |
| `module-presets.json` | `admin/presets.ts:28` | — | 8 записей (kitchen) | `modulePresetSchema` (`:522–546`) |
| `price-items.json` | `admin/price-items.ts:48` | 93 | 98 | `priceItemSchema` (`:136–170`) |
| `pricing-versions.json` | `server/../admin/pricing.ts` | 1 (published) | 2 (1 published + 1 superseded) | `pricingVersionSchema` |
| `pricing-changes.json` | — | — | 5 | журнал изменений цен |
| `projects.json` | `server/projects.ts` | 200 | 0 | `storedProjectSchema` (`configurator/schema.ts:389`) |
| `display-metadata` | `admin/display-metadata.ts:27` | — | 3 | display-определения |
| `admin-audit-log.json` | `server/audit.ts:19` | 16 | 16 | журнал аудита |
| `rules-snapshots.json` | `admin/managed-rules.ts` | **нет** | **нет** | `RulesSnapshot` |
| `admin-parameters.json` | `admin/parameters.ts:20` | **нет** | **нет** | `adminParameterSchema` |
| `parameter-dependencies.json` | `admin/dependencies.ts:58` | **нет** | **нет** | — |
| `composition-versions.json` | `admin/composition.ts:52` | **нет** | **нет** | `compositionVersionSchema` (`composition-schema.ts:209`) |

### 2.2 Каталоги (`CatalogItem`)

`catalogKindSchema` объявляет **16** видов (`admin/schema.ts:30–47`).
Фактически в Store присутствуют **14** видов (`catalog-items.json`):

| Вид | Записей | Ценовые ссылки (contract) |
|---|---|---|
| `bodyMaterial` | 3 | `ratePerSqm` |
| `facadeMaterial` | 5 | `ratePerSqm` |
| `facadeStyle` | 3 | `multiplier` |
| `handle` | 4 | `rate` |
| `countertop` | 6 | `ratePerLinearMeter` |
| `plinthMaterial` | 5 | `ratePerMeter` |
| `plinthFinish` | 10 | нет |
| `plinthMount` | 2 | нет |
| `supportSystem` | 2 | `legPrice`/`clipPrice`/`screwPrice`/`anchorPrice` |
| `ledStrip` | 8 | `pricePerMeter` |
| `ledProfile` | 3 | `ratePerMeter` |
| `ledDiffuser` | 2 | `ratePerMeter` |
| `ledControl` | 3 | `price` |
| `ledPsu` | 8 | `price` |
| `sinkSize` | **0** | — (в `CatalogItemInput` отсутствует) |
| `promo` | **0** | — (промо живёт в `PricingVersion.promos`) |

Расхождение зафиксировано комментарием в контракте: «`sinkSize`/`promo` намеренно не входят: для `sinkSize` content-структура отсутствует, `promo` живёт в `PricingVersion.promos`» (`contract.ts:90–95`).

### 2.3 Пресеты, цены, версии, промо

- **Пресеты модулей:** 8 записей `family=kitchen` (`base, sink, hob, drawers, wall, tall, oven, bottle`); `family=wardrobe` — 0 записей. Схема: `id, family, zone, width, height, depth, defaultShelves, defaultDrawers, priceRef, status, version` (`admin/schema.ts:522–546`). `basePrice` в пресете отсутствует — используется `priceRef` (решение владельца 2026-11-07, `:533`).
- **Тарифы:** `priceItemSchema` — `id, scope, label, unit (RUB|RUB_PER_SQM|RUB_PER_M|RUB_PER_LINM|RUB_PER_PCS|FACTOR), usage (used|unused), status (active|archived), editable, sourceRef, groupId?, createdAt/By, updatedAt/By` (`:136–170`). Патч разрешён только для `label/unit/groupId` (`price-items.ts:269`).
- **Версии цен:** `PricingVersion` со `snapshot: {priceItemId, amount}[]`, `promos`, `rules`, `signedAdjustments`, `baseSchema` (`contract.ts:157–166`).
- **Промо:** 3 записи в снимке published-версии; в коде — `src/content/pricing.ts:64 PROMOS` (используется сайтом/legacy-слоем).

### 2.4 Данные, существующие только в коде

| Домен | Файл | Что задаёт |
|---|---|---|
| Типы изделий | `src/content/catalog.ts:570` `FURNITURE_TYPES` | kitchen / wardrobe |
| Модули кухни | `src/content/catalog.ts:336` `KITCHEN_MODULES` | типы, зоны, min/max размеры, глубины |
| Состав модулей | `src/lib/admin/catalog-model.ts:631` `MODULE_COMPOSITION` | read-model для seed Composition, в расчёт не входит |
| Секции шкафа | `src/content/catalog.ts:550` `WARDROBE_LIMITS` | допуски секций/полок/штанг |
| Отделки фасада | `src/content/catalog.ts:74` `MDF_FACADE_FINISHES` | список отделок (в `config` — свободная строка) |
| Легаси-материалы фасада | `src/content/catalog.ts:124` `LEGACY_FACADE_MATERIALS` | `veneer`/`glass`/`solid` — только чтение старых проектов |
| Нормы опор | `src/lib/configurator/supports.ts` + `content/supports.ts` | шаг/нагрузка/подбор |
| Нормы подсветки | `src/lib/configurator/lighting.ts` + `content/lighting.ts` | напряжения, мощности, профили |
| Стандарты моек | `src/lib/configurator/sink.ts:334–354` `SINK_STANDARD_SIZES` | размеры/допуски моек |
| Геометрия | `src/lib/configurator/geometry.ts`, `wardrobe-geometry.ts`, `facade-geometry.ts` | расчёт деталей |
| Допуски кухни/шкафа | `src/content/catalog.ts:531,550` `KITCHEN_LIMITS`, `WARDROBE_LIMITS` | min/max |
| Манифест параметров | `src/lib/server/parameter-registry.ts` | immutable whitelist параметров |

---

## 3. Инвентаризация Calculation Admin

| Сущность | Назначение | Реализация | Источник данных | Редактирование | Связь со Store | Связь с Engine | Ограничения |
|---|---|---|---|---|---|---|---|
| **CatalogItem** | справочники материалов/фурнитуры/света | сервис + API `/api/admin/catalogs/**` | `catalog-items.json` | create/update/archive + history | 1:1 | через `CalculationInputs.catalogs` | 14 видов из 16; `sinkSize`/`promo` без записей |
| **PriceItem** | тарифы | `/api/admin/price-items/**` | `price-items.json` | `label/unit/groupId`; `usage`/`status` отдельными операциями; archive/restore/history | 1:1 | через `snapshot.amount` | ставка живёт в `PricingVersion`, не в `PriceItem` |
| **PricingVersion** | версии цен + промо + rules | `/api/admin/pricing-versions/**` (publish/rollback/validate/diff/changes) | `pricing-versions.json` | публикация/откат | ссылается на PriceItem | `PriceSnapshotInput` | `unit` в снимке не хранится (R-03) |
| **ManagedRule** | управляемые нормы комплектации | `/api/admin/rules/**` (revision, publish, import) | `rules-snapshots.json` | да | — | `rulesSnapshot` | **коллекция в Store отсутствует** |
| **RulesSnapshot** | неизменяемый снимок правил | `/api/admin/rules/snapshots/**`, `active` | `rules-snapshots.json` | публикация | — | `RulesSnapshotInput` | **коллекция отсутствует**; новый расчёт без снимка блокируется (`RULES_SNAPSHOT_MISSING`) |
| **CompositionVersion** | состав модулей для трассировки | `/api/admin/compositions/**` (draft/validate/publish/confirm/production-approval/import) | `composition-versions.json` | да | ссылается на CatalogItem/PriceItem | **не входит** в Engine; влияет только на trace | **коллекция отсутствует** |
| **CompositionLine** | строка состава | `composition-schema.ts:133–208` | внутри версии | да | `componentCatalog/componentId/priceItemId` | — | `quantityRef`/`condition` не исполняются кроме `fixed`/fail-closed |
| **Импорт** | legacy → Admin | `admin/import.ts`, `/api/admin/.../*/import` | внешние спецификации | операция | пишет коллекции | — | отчёт импорта + исключения |
| **Pins** | закрепление версий | `pins` проекта/Composition | `StoredProject.pins`, `composition.pins` | автоматически | — | через snapshot | `priceVersionId` в Composition — optional |
| **История изменений** | версии справочников | `/api/admin/*/[id]/history`, `admin/history.ts` | audit + version-поля | чтение | — | — | — |
| **Валидация / Production Gate** | допуск к публикации | `composition.ts`, `apply.ts` (`evaluateApplyGate`), `/validate` | — | — | — | — | Production Gate Composition: `requireProductionApproval` только при `NODE_ENV=production` |
| **Связь с проектами** | pin состава/правил | `/api/admin/projects/**` (composition-transition, rules-transition, price-history, recalculate) | `projects.json` | переход + подтверждение | — | recalc | проекты с 0 pin — legacy |
| **Права доступа / аудит** | RBAC + OIDC + журнал | `src/lib/auth/*` (`oidc.ts`, `permissions.ts`, `session.ts`), `admin/api-auth.ts`, `/api/admin/audit-log` | `admin-audit-log.json` | — | — | — | операционная конфигурация в репозитории не подтверждена |
| **Recovery / целостность** | журналы публикаций/переходов, restore | `composition-journal.ts`, `composition-transition-journal.ts`, `apply.ts`, `scripts/restore-drill.mjs` | журналы в Store | — | — | — | сквозной прогон восстановления в этом исследовании не выполнялся |
| **Диагностика** | проверка правил/проектов | `/api/admin/diagnostics`, `/api/admin/rules/diagnostics/**` | — | чтение | — | — | — |
| **Display metadata** | правила отображения строк | `admin/display-metadata.ts` | `display-metadata` | **API отсутствует** | — | `toPriceBreakdown` | управляется только seed-скриптом |
| **Параметры** | расчётные параметры | `/api/admin/parameters/**` | `admin-parameters.json` + манифест | да (в UI) | — | манифест | **коллекция отсутствует** |

---

## 4. Карта соответствия Store → Admin → Engine

Статусы: `COMPLETE` / `PARTIAL` / `MISSING` / `CODE_ONLY` / `NOT_REQUIRED` / `UNKNOWN`.

| # | Элемент Store | Источник Store | Сущность Admin | Связь с Engine | Статус |
|---|---|---|---|---|---|
| 1 | Типы изделий (kitchen/wardrobe) | `content/catalog.ts:570` | — | `config.kind` | **CODE_ONLY** |
| 2 | Кухонные модули (типы, зоны, геометрия) | `content/catalog.ts:336`; `catalog-model.ts:631` | `module-presets` (8, только размеры/тариф) | `config.modules` + `engine.ts` | **PARTIAL** |
| 3 | Секции шкафа | `content/catalog.ts:550` | `module-presets` family=wardrobe (**0 записей**) | `config.sections` | **CODE_ONLY** |
| 4 | Пресеты модулей | `module-presets.json` | `/api/admin/module-presets` | `presets[].basePrice` | **COMPLETE** |
| 5 | Материалы корпуса | `catalog-items` `bodyMaterial` | `/api/admin/catalogs` | `ratePerSqm` | **COMPLETE** |
| 6 | Материалы фасада | `catalog-items` `facadeMaterial` (+3 legacy в коде) | `/api/admin/catalogs` | `ratePerSqm` | **COMPLETE** |
| 7 | Отделки фасада | `content/catalog.ts:74` | — (`facadeFinish` — свободная строка) | `config.facadeFinish` | **CODE_ONLY** |
| 8 | Стили фасада | `catalog-items` `facadeStyle` | `/api/admin/catalogs` | `multiplier` | **COMPLETE** |
| 9 | Ручки | `catalog-items` `handle` | `/api/admin/catalogs` | `rate` | **COMPLETE** |
| 10 | Столешницы | `catalog-items` `countertop` | `/api/admin/catalogs` | `ratePerLinearMeter` | **COMPLETE** |
| 11 | Материал цоколя | `catalog-items` `plinthMaterial` | `/api/admin/catalogs` | `ratePerMeter` | **COMPLETE** |
| 12 | Отделка/монтаж цоколя | `catalog-items` `plinthFinish`/`plinthMount` | `/api/admin/catalogs` | не тарифицируются (`NO_PRICE_KINDS`) | **COMPLETE** |
| 13 | Системы опор | `catalog-items` `supportSystem` | `/api/admin/catalogs` | 4 тарифа | **COMPLETE** |
| 14 | Подсветка (5 видов) | `catalog-items` `led*` | `/api/admin/catalogs` | тарифы за единицу | **COMPLETE** |
| 15 | Нормы подсветки | `lighting.ts`, `content/lighting.ts` | — | `engine.ts` | **CODE_ONLY** |
| 16 | Стандартные размеры моек | `sink.ts:334–354` | `catalogKind sinkSize` (**0 записей**) | правила моек | **CODE_ONLY** |
| 17 | Промокоды | `PricingVersion.promos` + `content/pricing.ts:64` | `/api/admin/pricing-versions` | `snapshot.promos` | **PARTIAL** |
| 18 | Тарифы | `price-items.json` | `/api/admin/price-items` | `snapshot.amount` | **COMPLETE** |
| 19 | Версии цен | `pricing-versions.json` | `/api/admin/pricing-versions` | `priceVersion` | **COMPLETE** |
| 20 | Управляемые правила | **коллекция отсутствует** (данные не созданы) | `/api/admin/rules` | `rulesSnapshot` | **PARTIAL** |
| 21 | Снимки правил | **коллекция отсутствует** (данные не созданы) | `/api/admin/rules/snapshots` | `RulesSnapshotInput` | **PARTIAL** |
| 22 | Расчётные параметры | **коллекция отсутствует** + манифест | `/api/admin/parameters` | `parameters` (манифест) | **PARTIAL** |
| 23 | Зависимости параметров | **коллекция отсутствует** | `dependencies.ts` | — | **PARTIAL** |
| 24 | Составы модулей | **коллекция отсутствует** | `/api/admin/compositions` | не Engine; trace | **PARTIAL** |
| 25 | Display metadata | `display-metadata` (3) | **API отсутствует** | `toPriceBreakdown` | **PARTIAL** |
| 26 | Геометрия и допуски | `geometry.ts`, `KITCHEN_LIMITS` | ADR-04 ACCEPTED, редактирования нет | `engine.ts` | **CODE_ONLY** |
| 27 | Аудит | `admin-audit-log.json` (16) | `/api/admin/audit-log` | — | **COMPLETE** |
| 28 | Проекты и история расчётов | `projects.json` (200) | `/api/admin/projects` (чтение/переходы) | — | **NOT_REQUIRED** |
| 29 | RBAC / OIDC / сессии | `src/lib/auth/*` | `/api/admin/*` (guard) | — | **PARTIAL** |
| 30 | Backup / restore / recovery | журналы + `scripts/restore-drill.mjs` | — | — | **PARTIAL** |

### Итого
| Статус | Кол-во | Доля |
|---|---|---|
| COMPLETE | 13 | 43 % |
| PARTIAL | 10 | 33 % |
| CODE_ONLY | 6 | 20 % |
| MISSING | 0 | 0 % |
| NOT_REQUIRED | 1 | 3 % |
| UNKNOWN | 0 | 0 % |
| **Всего** | **30** | |

---

## 5. Подтверждённые расхождения

### 5.1 Два бэкенда Store содержат разные наборы данных (не дефект)
`store.ts` выбирает адаптер (ADR-01). Фактически: JSON `pricing-versions.json` → 1 published `price-2026.11.1`; SQLite → 2 версии, published `price-demo-2026-01`. Аналогично `price-items` 93 vs 98, `projects` 200 (JSON) vs 0 (SQLite).
**Следствие:** `getStorage()` выбирает **ровно один** адаптер (`storage/index.ts:9–45`), параллельных
источников истины нет; production допускает только SQLite, JSON — только вне production. Различия —
свойство двух независимых наборов данных, а не рассинхронизация. Операционный риск: сравнение
«Admin vs Store» требует явного указания активного бэкенда.

### 5.1a Статусная модель (уточнение ревизии 2)
Отсутствие записей не означает `MISSING`: `ManagedRule`/`RulesSnapshot` — `IMPLEMENTED`, но
`DATA_READY=false`; поэтому в карте они `PARTIAL`, а не `MISSING`. Подробно —
`STORE_ADMIN_GAP_ANALYSIS.md` § 2.

### 5.2 Элементы Store без Admin-управления
`CODE_ONLY` (6): типы изделий, секции шкафа, отделки фасада, нормы подсветки, стандарты моек, геометрия/допуски.
Для геометрии решение зафиксировано: ADR-04 (ACCEPTED) ограничивает редактирование; управление через AdminParameter без изменения `calcVersion`/`config` запрещено.

### 5.3 Элементы Admin без данных в Store
`catalogKindSchema` объявляет `sinkSize` и `promo` (16 видов), но:
- записей `sinkSize` — 0, в `CatalogItemInput` вид отсутствует (`contract.ts:90–95`);
- `promo` не является CatalogItem — промо в `PricingVersion.promos`.
**Следствие:** объявленная Admin-сущность без Store-представления и без контракта Engine.

### 5.4 Административные коллекции, отсутствующие в Store (состояние данных)
`rules-snapshots.json`, `admin-parameters.json`, `parameter-dependencies.json`, `composition-versions.json` — **нет ни в JSON, ни в SQLite**.
**Следствие:** сервисы Admin для правил/параметров/зависимостей/составов работают с пустыми коллекциями; новый расчёт без `rulesSnapshotId` блокируется (`RULES_SNAPSHOT_MISSING`) — 200/200 проектов legacy.

### 5.5 Дублирующий источник цен и промо
- Цены: Store (`price-items.json` + `pricing-versions.json`) ↔ код (`src/content/pricing.ts:16 PRICING`), используемый legacy-калькулятором (`src/lib/configurator/pricing.ts`).
- Промо: `PricingVersion.promos` (Engine) ↔ `content/pricing.ts:64 PROMOS` (сайт).
**Следствие:** правка в Admin не обновляет контентный источник и наоборот (D-5, D-6 — остаются открытыми).

### 5.6 Display metadata без Admin-API
Коллекция `display-metadata` (3 записи) читается `toPriceBreakdown`, но маршрута `/api/admin/display-metadata` нет; изменение возможно только через seed/скрипт.

### 5.7 Composition и Rules не имеют данных, но интеграция реализована
Composition полностью реализована на уровне сервиса/API/валидации/публикации и трассировки (E1–E4 + drift diagnostics), однако коллекция в Store пуста. Отсутствие данных **не является** доказательством ненужности функциональности.

---

## 6. Что осталось неизвестным

| Вопрос | Причина |
|---|---|
| Фактическая операционная конфигурация OIDC/RBAC | код есть (`src/lib/auth/oidc.ts`), значения issuer/client/роли — вне репозитория |
| Работоспособность restore-drill на реальном бэке | скрипт есть, прогон в этом исследовании не выполнялся (READ-ONLY) |
| Какие значения `display-metadata` ожидает прод | 3 записи в SQLite; источник истины не документирован |
| Нужны ли `sinkSize`/`promo` как CatalogItem | требует решения владельца; контракт Engine их не поддерживает |

---

## 7. WP-1 — Legacy Materials Inventory (CA-GL-08)

**Дата:** 2026-11-16 · **Режим:** READ-ONLY · **Источник:** `data/projects.json` (200), `data/pricing-versions.json`,
`data/price-items.json`, SQLite `collection_state` (64 CatalogItem, 98 PriceItem, 2 PricingVersion).

### 7.1 Сохранённые проекты

| Параметр | Факт |
|---|---|
| Всего проектов | 200 (все `kind=kitchen`, `schemaVersion=1`) |
| `facadeMaterial` | `mdf` — **200/200** |
| `bodyMaterial` | `ldsp` — 200/200 |
| `countertop` | `ldsp_hpl` — 200/200 |
| `handle` / `facadeStyle` | `profile` / `flat` — 200/200 |
| Ссылки на legacy-материалы (`veneer`/`glass`/`solid`) | **0** |
| `priceVersion` | `price-2` — 169, `price-1` — 31 |
| Проекты с историей | 169 (169 событий), **31 без истории** |
| Событий с `compositionVersionId` / `compositionTrace` | 0 / 0 |
| `rulesSnapshotId` / `compositionVersionId` на проекте | 0 / 0 |

**Вывод:** ни один проект не использует исторические материалы фасада. Проблема «старый материал без тарифа» в текущем наборе данных **не воспроизводится**.

### 7.2 Материалы: сопоставление с каталогом и тарифами

| Материал | Каталог (SQLite) | `priceRefs` | В published snapshot | Статус |
|---|---|---|---|---|
| `ldsp` (фасад) | active | `catalog.facade.ldsp.ratePerSqm` | ✅ | **MATCHED** |
| `mdf` (фасад) | active | `catalog.facade.mdf.ratePerSqm` | ✅ | **MATCHED** |
| `veneer` | active | `catalog.facade.veneer.ratePerSqm` | ✅ | **MATCHED** (исторический, блокируется `isLegacyFacadeMaterial`) |
| `glass` | active | `catalog.facade.glass.ratePerSqm` | ✅ | **MATCHED** (исторический, блокируется) |
| `solid` | active | `catalog.facade.solid.ratePerSqm` | ✅ | **MATCHED** (исторический, блокируется) |
| `mdf_pvc` | **отсутствует** | `catalog.facade.mdf_pvc.ratePerSqm` (PriceItem есть) | n/a | **CURRENT_ONLY** — активен в коде (`ACTIVE_FACADE_MATERIAL_IDS`, `defaultWardrobe`), но CatalogItem нет |
| `ldsp`/`mdf`/`plywood` (корпус) | active | `catalog.body.*.ratePerSqm` | ✅ | **MATCHED** |
| 6 столешниц | active | `catalog.countertop.*.ratePerLinearMeter` | ✅ | **MATCHED** |
| 4 ручки / 3 стиля | active | `rate` / `multiplier` | ✅ | **MATCHED** |
| 2 системы опор | active | 4 тарифа каждая | ✅ | **MATCHED** |
| 10 отделок / 2 монтажа цоколя | active | нет (нет и тарифа) | n/a | **MATCHED** (не тарифицируются) |

**Итог распределения статусов:** `MATCHED` — 14 позиций, `CURRENT_ONLY` — 1 (`mdf_pvc`), `HISTORICAL_ONLY` — 0, `MISSING_PRICE` — 0, `AMBIGUOUS` — 0, `UNKNOWN` — 0.

### 7.3 Исторические тарифы фасадов
`11 800 / 14 400 / 18 600 ₽/м²` (`veneer`/`glass`/`solid`) существуют **как PriceItem в текущем Store**
(`catalog.facade.veneer.ratePerSqm` и т.д.) и присутствуют в published-снимке. Значения не
пересматривались. Требование «отсутствие тарифа не даёт 0 ₽» реализовано отдельно
(`pricing.ts:135–137`, `missingActiveTariff`), но в текущем наборе данных не срабатывает.

### 7.4 Проблемы, подтверждённые данными

| # | Проблема | Доказательство | Влияние |
|---|---|---|---|
| L-1 | Проекты ссылаются на `price-1`/`price-2`, которых **нет** в Store (там `price-demo-2026-01`) | `data/projects.json` (169+31) vs `data/pricing-versions.json` (1 версия) | историческая воспроизводимость опирается на `StoredProject.price` и `priceHistory[].breakdown`; 31 проект **без истории** |
| L-2 | `mdf_pvc` активен в коде/UI и используется `defaultWardrobe`, но CatalogItem отсутствует | `materials.ts:31–35`, `defaults.ts:285`, `bootstrap.ts:349` vs Store | новый расчёт шкафа/кухни с `mdf_pvc` упадёт на `unknownCatalogId` |
| L-3 | 3 PriceItem вне published snapshot и `usage=unused` | `kitchen.plinthPerMeter`, `kitchen.underCabinetLightPerMeter`, `kitchen.sinkPartition` | не влияют (unused, не ссылаются из каталога) |
| L-4 | Снимок цен не хранит `unit` | 90/90 записей снапшота | R-03 (CA-GL-16) |

---

## 8. WP-1 — Restore Drill (CA-GL-11)

### 8.1 Что проверялось
`src/lib/server/storage/{sqlite-storage,json-file-storage}.ts` (ADR-01), схема `collection_state`,
`admin-audit-log`, журналы публикаций/переходов, `scripts/restore-drill.mjs`, ADR-03.

### 8.2 Штатный drill (изолированная среда)
```
$ node scripts/restore-drill.mjs
RESTORE DRILL PASS
source=…/formakub-restore-drill-script-*/source
backup=…/backups/formakub-hourly-drill.db
restored=…/restored/formakub.db
integrity=ok projects=1
```
Скрипт создаёт источник, делает backup, восстанавливает, проверяет `PRAGMA integrity_check` и
данные, **не открывая `data/formakub.db`**.

### 8.3 Drill на реальном наборе (копия, источник не изменялся)
| Проверка | Результат |
|---|---|
| `VACUUM INTO` копии `data/formakub.db` | ok |
| `PRAGMA integrity_check` копии | `ok` |
| Коллекций: источник / копия | 9 / 9 |
| Payload-хеши: `catalog-items`, `price-items`, `pricing-versions`, `module-presets`, `projects` | **MATCH** (все 5) |
| SHA-1 (`shasum`) источника до/после | `5198c696…` = `5198c696…` (**не изменён**) |
| Обнаружение повреждения (4 КБ затирания в копии) | `integrity_check` вернул ошибки (`Rowid out of order`, `Fragmentation…`) ✅ |
| JSON-бэкенд: `price-items` / `pricing-versions` / `projects` | parse ok (93 / 1 / 200) |
| JSON-бэкенд: повреждённый файл | `JSONDecodeError` — обнаружен ✅ |

### 8.4 Пробелы
| # | Пробел | Факт |
|---|---|---|
| R-1 | Drill не покрывает JSON-бэкенд | `scripts/restore-drill.mjs` использует `node:sqlite`; отдельной JSON-процедуры нет |
| R-2 | Нет штатного планировщика backup в репозитории | `scripts/` содержит только `restore-drill.mjs`/`deploy-preflight.mjs`; ADR-03 описывает процедуру, не расписание |
| R-3 | Идемпотентность повторного восстановления не проверялась штатным скриптом | скрипт одноразовый, перезапись не тестируется |

> Новая процедура не изобреталась: отсутствие JSON-drill зафиксировано как пробел.

---

## 9. WP-1 — ManagedRules: 27 seed

**Источник:** `src/lib/admin/managed-rules-seed.ts` (27 = 3 плотности + 8×3 полосы),
`src/lib/configurator/wardrobe-hinges.ts`, `engine.ts:953–957`.

### 9.1 Общая характеристика всех 27

| Поле | Значение (одинаково для всех) |
|---|---|
| `category` | `norm` |
| `scope` | `wardrobe` |
| `condition` | `{ subject: "kind", operator: "equals", value: "wardrobe" }` |
| `valueType` | `int` (24 полосы: max-height/count) / `decimal` (3 плотности + max-mass) |
| `unit` | отсутствует |
| `source` | `preliminary` (D-8 — нормы не подтверждены владельцем) |
| `sourceRef` | `src/lib/configurator/wardrobe-hinges.ts:17-39` |
| `affects` | `["quantity"]` |
| `status` | `draft` при импорте |
| Обязательность | **обязательны** для шкафа: Engine fail-closed при отсутствии любой (`engine.ts:953–959`) |

### 9.2 Плотности фасада (3)

| ID | Значение | Единица (семантика) |
|---|---|---|
| `rule-wardrobe-facade-density-16` | 11.5 | кг/м² |
| `rule-wardrobe-facade-density-19` | 14.8 | кг/м² |
| `rule-wardrobe-facade-density-22` | 16.8 | кг/м² |

`assigns = line:wardrobe.fronts`.

### 9.3 Полосы петель (8 × 3 = 24)

| № | `max-height`, мм | `max-mass`, кг | `count` |
|---|---|---|---|
| 1 | 600 | 5 | 2 |
| 2 | 900 | 8 | 2 |
| 3 | 1300 | 12 | 3 |
| 4 | 1600 | 15 | 4 |
| 5 | 2000 | 19 | 4 |
| 6 | 2200 | 22 | 5 |
| 7 | 2400 | 27 | 5 |
| 8 | 2700 | 35 | 6 |

`assigns = line:wardrobe.fittings`.

### 9.4 Проверки

| Проверка | Результат |
|---|---|
| Соответствие Zod (`managedRuleSchema`) | ✅ (`managed-rules.test.ts`, seed schema) |
| Уникальность ID | ✅ детерминированные id; `specs.length !== 27` → ошибка (`managed-rules-seed.ts:164–166`) |
| Типы и значения | ✅ `int`/`decimal` валидируются `valueTypeIssue` |
| Обязательные зависимости | ✅ нет зависимостей между правилами |
| Циклические зависимости | ✅ отсутствуют (нет поля зависимостей) |
| Revision / publish lifecycle | ✅ `/api/admin/rules/[id]/revision`, `/api/admin/rules/publish` |
| Совместимость с RulesSnapshot | ✅ `resolveActiveRulesSnapshot` + `toRulesSnapshotInput` |
| Соответствие решениям владельца | ⚠️ `source=preliminary` (D-8) — нормы не подтверждены |
| Дублирование с другими механизмами | ✅ нет: константы — только seed-источник; Engine читает **только** снимок |

### 9.5 Готовность и влияние

| Класс | Кол-во | Готовность |
|---|---|---|
| Используются расчётом **шкафа** | 27 (все) | готовы к публикации |
| Используются расчётом **кухни** | 0 | — |
| Подготовлены, но не подключены | 0 | — |
| Требуют подтверждения владельца | 27 (`preliminary`) | решение OD-12/OD-13 |
| Влияют на исторические проекты | **0** (все 200 — кухня) | — |

**Ключевой факт:** для кухни `rulesSnapshot` **не читается** (`engine.ts` — единственное обращение
на `:954` внутри `calculateWardrobeBreakdown`), но DataResolver требует активный снимок для любого
create/preview (`data-resolver.ts:1367–1375`). То есть публикация снимка разблокирует кухонные
расчёты, не влияя на их результат.

---

## 10. WP-1 — Итог

| Направление | Статус | Блокирует WP-2 |
|---|---|---|
| Legacy materials (CA-GL-08) | `DONE`: 200/200 проектов на текущих материалах, legacy-материалы MATCHED, 0 AMBIGUOUS | нет |
| Restore drill (CA-GL-11) | `DONE`: штатный и реальный drill PASS, повреждение детектируется, источник не изменён | нет |
| ManagedRules 27 | проверены, готовы к публикации; требуется подтверждение `preliminary` | **да** (решение владельца) |
| Store drift | `mdf_pvc` и `admin-parameters` отсутствуют, хотя bootstrap их создаёт | нет (не влияет на Rules) |
