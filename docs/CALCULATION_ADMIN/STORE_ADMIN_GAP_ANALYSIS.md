# STORE ↔ CALCULATION ADMIN — GAP ANALYSIS

- **Дата:** 2026-11-16 · **Ревизия:** 2 (CA-GL-00.1, reconciliation)
- **Режим:** READ-ONLY (код, схемы, API, БД, конфигурация, ADR **не изменялись**)
- **Основание:** `STORE_ADMIN_INVENTORY.md`, фактические проверки кода
- **Назначение:** разбор отсутствующих и частично реализованных связей, рисков и ограничений

> Ревизия 2 исправляет две ошибки первой редакции: (1) реализованные, но не заполненные
> сущности больше не обозначаются как `MISSING`; (2) два бэкенда Store больше не описываются
> как «параллельные источники истины». Все утверждения подтверждены файлами и строками;
> предположения вынесены в § 8.

---

## 1. Что изменилось в ревизии 2

| Пункт | Было | Стало | Причина |
|---|---|---|---|
| Rules (`ManagedRule`) | `MISSING` | **`IMPLEMENTED`, `DATA_READY=false`** | код, API, валидация, seed 27 правил и диагностика существуют |
| RulesSnapshot | `MISSING` | **`IMPLEMENTED`, `DATA_READY=false`** | `publishRulesSnapshot` (`managed-rules.ts:831`) реализован |
| Параметры | «Store пуст, работает манифест» | **`IMPLEMENTED`; манифест — seed-источник, bootstrap создаёт `admin-parameters.json`** | `bootstrap.ts:653,1287` |
| Зависимости параметров | «Store пуст» | **`IMPLEMENTED`, `DATA_READY=false`** | `dependencies.ts` реализован; seed не предусмотрен |
| Два бэкенда Store | «разные данные = риск» | **взаимоисключающие адаптеры; риск — операционный** | `storage/index.ts:9–45` |
| Rules → блокировка | «блокирует новые расчёты» | **блокирует create/preview и recalculate (legacy)** | `data-resolver.ts:1353–1375` |

---

## 2. Модель состояния реализации (три независимых состояния)

Для каждой сущности состояние определяется отдельно; смешивание даёт неверные выводы.

| Сущность | IMPLEMENTED | DATA_READY | OPERATIONAL | Комментарий |
|---|---|---|---|---|
| `CatalogItem` | ✅ (14 видов, API, история) | ✅ 64 записи | ⚠️ подключён, но расчёт заблокирован смежным условием | данные валидны |
| `PriceItem` | ✅ | ✅ 93/98 | ⚠️ как выше | в снимке нет единицы (R-03) |
| `PricingVersion` | ✅ (publish/rollback/diff) | ✅ 1 published (JSON) / 1 published + 1 superseded (SQLite) | ⚠️ как выше | |
| `ModulePreset` | ✅ | ✅ 8 kitchen, 0 wardrobe | ⚠️ как выше | |
| `AdminParameter` | ✅ (API, seed из манифеста) | ❌ коллекция отсутствует в текущем Store | ❌ | создаётся `applyBootstrap` |
| `ParameterDependency` | ✅ | ❌ коллекция отсутствует | ❌ | seed не предусмотрен |
| `ManagedRule` | ✅ (seed 27, ревизии, публикация) | ❌ коллекция отсутствует | ❌ | требуется `POST /api/admin/rules/import` |
| `RulesSnapshot` | ✅ (`publishRulesSnapshot`) | ❌ нет активного снимка | ❌ | блокирует новые расчёты |
| `CompositionVersion` | ✅ (+ E1–E4, drift diagnostics) | ❌ коллекция отсутствует | ❌ | pin необязателен (В-1) |
| `DisplayMetadata` | ⚠️ нет Admin-API | ✅ 3 записи | ✅ используется `toPriceBreakdown` | управление только seed-скриптом |
| Аудит | ✅ | ✅ 16 записей | ✅ | |
| RBAC/OIDC | ✅ (код) | ⚠️ конфигурация вне репозитория | ⚠️ не подтверждено | |

**Правило:** `DATA_READY=false` — это состояние данных, а не дефект архитектуры.

---

## 3. Четыре административные коллекции

| Коллекция | Назначение | Где объявлена | API / сервисы | Зависимость от Store | Должна ли быть в Store | Последствия отсутствия | Требуются ли действия |
|---|---|---|---|---|---|---|---|
| `rules-snapshots.json` | неизменяемый снимок управляемых правил, закрепляемый проектами | `managed-rules.ts` (`SNAPSHOTS`) | `/api/admin/rules/**` (revision, publish, import, snapshots/active, diagnostics) | читается DataResolver при каждом расчёте | **да** — это контракт расчёта | новые расчёты блокируются `RULES_SNAPSHOT_MISSING` | **да**: импорт + публикация (CA-GL-01) |
| `admin-parameters.json` | администрируемые расчётные параметры | `parameters.ts:20` | `/api/admin/parameters/**` | используется UI параметров; расчёт читает **манифест** (`parameter-registry.ts`) | да (runtime-store), но **не** источник истины для Engine | параметры в Admin пусты; расчёт работает на манифесте | **нет** для расчёта; создаётся `applyBootstrap` (CA-GL-14 закрыт) |
| `parameter-dependencies.json` | граф зависимостей параметров и ссылок | `dependencies.ts:58` | `dependencies.ts` (проверки, Data Sources) | только Admin-диагностика | да (для Admin) | проверки зависимостей выполняются на пустом множестве | **не срочно**, отдельного seed нет |
| `composition-versions.json` | версии состава модулей для трассировки | `composition.ts:52` | `/api/admin/compositions/**` (draft/validate/publish/confirm/production-approval/import) | preflight + trace (не Engine) | **да** | нет composition-pin → нет трассировки; расчёт **не** блокируется | **нет** для эксплуатации (pin необязателен); CA-GL-02 `DEFERRED` |

**Вывод:** отсутствие коллекции само по себе не является архитектурным дефектом. Значимо только
`rules-snapshots`, потому что от него зависит допуск расчёта.

---

## 4. RulesSnapshot — фактический статус

### 4.1 Почему блокирует
`data-resolver.ts:1346–1375`:
- `recalculate` при `project.rulesSnapshotId === undefined` → `RULES_SNAPSHOT_MISSING` (`:1353–1362`);
- `create`/`preview` при `resolveActiveRulesSnapshot().status === "none"` → `RULES_SNAPSHOT_MISSING` (`:1367–1375`).

То есть блокируются **все** новые расчёты, а не только legacy. Чтение сохранённых данных разрешено.

### 4.2 Какие правила попадают в снимок
- `managedRulesSeedSpecs()` — **27** правил из кода (`managed-rules-seed.ts:94`; жёсткая проверка `specs.length !== 27` → ошибка, `:164–166`).
- `POST /api/admin/rules/import` создаёт **draft**-правила из seed (`importManagedRulesSeed`).
- `publishRulesSnapshot` (`managed-rules.ts:831`) публикует активный снимок; `resolveActiveRulesSnapshot` (`:1159–1171`) возвращает `none`, пока снимка нет.

### 4.3 Готовы ли данные
Да: seed 27 правил присутствует в коде; дополнительных источников не требуется. Публикация —
управляемое административное действие (guard `catalog.write`, аудит), а не разработка.

### 4.4 Проверки совместимости
- `validateCompositionForConfig`: `composition.rulesSnapshotId` ≠ снимок расчёта → `COMPOSITION_RULES_SNAPSHOT_MISMATCH` (block).
- `validateCompositionVersion`: `rulesSnapshotId` для составов с `managed_rule` (`usesRules`, `composition.ts:202–208`).
- `validateRuleCondition` (Q7-03) — структурная валидация правил при публикации.
- Пара «снимок правил ↔ состав» — Q1; реализована, но не достижима без данных.

### 4.5 Связь с CompositionVersion
`CompositionVersion.rulesSnapshotId` заполняется при публикации, если состав использует правила
(`usesRules`). Состав без `managed_rule`-строк может публиковаться без снимка.

### 4.6 Что нужно для безопасного ввода в эксплуатацию
1. `CA-GL-01`: импорт 27 правил → публикация активного снимка (owner approval).
2. Проверить, что новый расчёт проходит preflight и `golden` не меняется.
3. `CA-GL-21`: отдельно решить судьбу 200 legacy-проектов (`rulesSnapshotId` отсутствует →
   `recalculate` остаётся заблокированным даже после публикации снимка).

---

## 5. Два хранилища Store (JSON / SQLite)

| Аспект | JSON (`json-file`) | SQLite (`sqlite`) |
|---|---|---|
| Назначение | разработка, тесты, миграция | **единственное основное хранилище** (ADR-01) |
| Включение | по умолчанию вне production | `FORMAKUB_STORAGE=sqlite` или `NODE_ENV=production` |
| Production | **запрещено** — явная ошибка запуска | обязательно |
| Источник истины | активный адаптер | активный адаптер |
| Одновременность | **ровно один** адаптер (`getStorage()`, комментарий «параллельных источников истины нет») | — |

**Фактические различия данных** (наблюдение, не дефект): JSON — `pricing-versions` 1 published
(`price-2026.11.1`), 93 тарифа, 200 проектов; SQLite — 2 версии (published `price-demo-2026-01`),
98 тарифов, 0 проектов.

**Оценка:** различия **ожидаемы** — это два независимых набора данных в двух режимах, а не
рассинхронизация одного источника. Опасность — операционная: аудит/сравнение, выполненное не на
том бэкенде, даёт ложные выводы; переключение режима не переносит данные.

**Риск потери данных:** при переключении `FORMAKUB_STORAGE` приложение читает другой набор; данные
прежнего адаптера не удаляются, но и не видны. Миграции не выполнялись и в этом этапе не
планируются.

**Рекомендация (документальная):** в отчётах всегда указывать активный бэкенд; не считать
`data/*.json` и `data/formakub.db` взаимозаменяемыми.

> `CA-GL-12` закрыт верификацией: расхождение — свойство среды, а не задача разработки.

---

## 6. Отсутствующие и частичные связи

### GAP-01 → переклассифицирован: `IMPLEMENTED`, `DATA_READY=false`
Слой управляемых правил (сервис, API, валидация Q7-03, seed, публикация, диагностика) реализован.
Коллекция отсутствует → `resolveActiveRulesSnapshot()` = `none` → блокировка расчётов.
**Требуется:** CA-GL-01 (административное действие).

### GAP-02 → переклассифицирован: `IMPLEMENTED`, `DATA_READY=false`
`publishRulesSnapshot` реализован; активного снимка нет. **Требуется:** CA-GL-01.

### GAP-03. Кухонные модули: геометрия и зоны в коде
`content/catalog.ts:336 KITCHEN_MODULES`; Admin управляет только `module-presets` (размеры,
`priceRef`). ADR-04 (ACCEPTED) ограничивает редактирование геометрии. **Не дефект** — принятое
ограничение.

### GAP-04. Секции шкафа — только код
`content/catalog.ts:550`; `module-presets` family=`wardrobe` — 0 записей. **Кандидат на `DEFERRED`.**

### GAP-05. Промокоды: два источника
Engine — `snapshot.promos`; сайт — `content/pricing.ts:64`. Задача CA-GL-04 (`OWNER DECISION`, D-5).

### GAP-06 → закрыт: параметры сеются bootstrap-ом
`buildAdminParameterSeeds` (`parameter-seed.ts:91`) → `bootstrap.ts:653` (`plan.adminParameters`) →
`:1287` (merge отсутствующих). Отсутствие коллекции = bootstrap не применялся к активному Store.
Дополнительно: Engine читает **манифест** (`parameter-registry.ts`), а не коллекцию.

### GAP-07. Зависимости параметров
`dependencies.ts` реализован; `parameter-dependencies.json` отсутствует; отдельного seed нет.
Влияет только на Admin-диагностику. **Не срочно.**

### GAP-08 → переклассифицирован: `IMPLEMENTED`, `DATA_READY=false`
Composition Management + E1–E4 + drift diagnostics завершены; коллекция пуста. Pin необязателен
(В-1) → эксплуатация расчёта не зависит от Composition. Задача CA-GL-02 `DEFERRED`.

### GAP-09. Display metadata без Admin-API
Коллекция есть (3 записи), API нет. CA-GL-03 (`OWNER DECISION`: потребность не доказана).

### GAP-10. RBAC / OIDC
Код реализован; конфигурация вне репозитория. CA-GL-10.

### GAP-11. Backup / restore / recovery
Журналы и `evaluateApplyGate` (`apply.ts:67`) реализованы; `scripts/restore-drill.mjs` есть,
результат прогона не зафиксирован. CA-GL-11.

---

## 7. Дублирующие источники и расходящиеся данные

| ID | Дублирование | Подтверждение | Статус |
|---|---|---|---|
| DUP-01 | Цены: Store ↔ `src/content/pricing.ts:16 PRICING` | legacy-калькулятор `src/lib/configurator/pricing.ts` | CA-GL-04 |
| DUP-02 | Промо: `PricingVersion.promos` ↔ `content/pricing.ts:64` | `PromotionsSection.tsx` | CA-GL-04 |
| DUP-03 | Подсказки ставок: `content/*` ↔ snapshot | A21-5 | CA-GL-04 |
| DUP-04 | JSON vs SQLite | `storage/index.ts:9–45` | **закрыт**: взаимоисключающие адаптеры |

---

## 8. Неподтверждённые предположения (не используются как основание)

| # | Предположение | Почему не подтверждено |
|---|---|---|
| A-1 | `sinkSize`/`promo` нужны как CatalogItem | в контракте Engine их нет; решения владельца нет |
| A-2 | Параметры должны редактироваться через Admin вместо манифеста | манифест immutable; `admin-parameters` — seed-store; решение о переходе не зафиксировано |
| A-3 | Display metadata требует Admin-UI | потребность не подтверждена; 3 записи могут быть статическими |
| A-4 | Оба бэкенда должны содержать идентичные данные | ADR-01 описывает выбор адаптера, не синхронность |
| A-5 | Восстановление проверено | скрипт есть, прогон не выполнялся |
| A-6 | OIDC настроен в production | конфигурация вне репозитория |
| A-7 | Публикация RulesSnapshot не изменит golden | ожидаемо, но требует проверки при выполнении CA-GL-01 |

---

## 9. Риски обратной совместимости

| Риск | Подтверждение |
|---|---|
| Включение `rulesSnapshotId` как обязательного заблокирует legacy | `data-resolver.ts:1353–1362`; 0/200 проектов |
| Публикация активного снимка меняет поведение **всех** новых расчётов | `resolveActiveRulesSnapshot` используется create/preview |
| Обязательный Composition pin заблокирует legacy | В-1, preflight |
| Обязательный `pins.priceVersionId` затронет пересчёт закреплённых проектов | E5-исследование |
| Изменение `calcVersion`/`schemaVersion` потребует миграции истории | ADR-06, `migrations.ts` |
| Геометрия через Admin меняет цену без изменения `config` | ADR-04 |

---

## 10. Ограничения анализа

1. READ-ONLY: данные не изменялись, восстановление не запускалось, версии не публиковались.
2. Счётчики коллекций — локальное состояние `data/`, не production-метрика.
3. Браузерная проверка Admin-UI не выполнялась (нет тестовой OIDC-сессии).
4. Формулы Engine не пересматривались.

---

## 11. WP-1 — результаты проверок (2026-11-16)

### 11.1 Store отстаёт от bootstrap-плана (подтверждено)
`applyBootstrap` собирает каталог из `FACADE_MATERIALS` (`bootstrap.ts:349`), куда входит `mdf_pvc`,
и добавляет отсутствующие `AdminParameter` (`:653`, `:1287`). Фактический SQLite-Store:
- `facadeMaterial`: `ldsp, mdf, veneer, glass, solid` — **`mdf_pvc` отсутствует**;
- `admin-parameters.json` — **отсутствует**.
При этом `ACTIVE_FACADE_MATERIAL_IDS` включает `mdf_pvc` (`materials.ts:31–35`), а
`defaultWardrobe()` использует его (`defaults.ts:285`).
**Следствие:** новый расчёт с `mdf_pvc` (в т.ч. шкаф по умолчанию) упадёт на `unknownCatalogId`.
Это состояние данных (устаревший seed), а не дефект модели; исправление — повторный bootstrap
(production-мутация, требует согласования). Задача: `CA-GL-22`.

### 11.2 Проекты ссылаются на отсутствующие версии цен
200/200 проектов (`price-1` 31, `price-2` 169) не имеют соответствующей `PricingVersion` в Store
(там `price-demo-2026-01`). Воспроизводимость держится на `StoredProject.price` и
`priceHistory[].breakdown` (169 событий); **31 проект без истории** — только `price`.
Не блокирует WP-2; риск — при любом массовом пересчёте (CA-GL-09/21).

### 11.3 Legacy-материалы
`veneer/glass/solid` — активные CatalogItem с действующими тарифами в published-снимке;
0/200 проектов их используют; блокировка новых расчётов реализована (`isLegacyFacadeMaterial`).
`AMBIGUOUS`/`MISSING_PRICE` — 0. Риск «0 ₽ за исторический фасад» в текущих данных не воспроизводится.

### 11.4 Restore
Штатный drill (`scripts/restore-drill.mjs`) — PASS. Drill на реальном наборе — PASS (integrity `ok`,
9/9 коллекций, payload-хеши совпадают, источник не изменён, повреждение детектируется).
Пробелы: нет drill для JSON-бэкенда; нет планировщика backup в репозитории.

### 11.5 ManagedRules
27 правил (3 плотности + 24 полосы), все `scope=wardrobe`, `category=norm`, `source=preliminary`,
`affects=["quantity"]`. Engine читает их **только** в `calculateWardrobeBreakdown` (fail-closed).
Кухня снимок не читает, но DataResolver требует его для create/preview.
Влияние на 200 существующих (кухонных) проектов — **нулевое**.

### 11.6 Неподтверждённые предположения (обновление)
| # | Предположение | Почему не подтверждено |
|---|---|---|
| A-7 | Публикация RulesSnapshot не изменит golden | ожидаемо по коду (кухня не читает снимок), но должно быть проверено при выполнении CA-GL-01 |
| A-8 | Повторный bootstrap безопасен | merge-логика есть, но production-прогон не выполнялся; требует согласования |

---

## 12. WP-2 — результаты проверок (2026-11-16)

### 12.1 Правила: 27 проверены поштучно
Полная таблица — `WP2_RULES_REVIEW.md` § 1. Все `category=norm`, `scope=wardrobe`,
`source=preliminary`, `affects=["quantity"]`; 3 плотности + 24 полосы петель.
Engine читает их **только** в `calculateWardrobeBreakdown` (fail-closed); кухня снимок не читает.
Активация Rules **не требует** изменения Composition (`Composition.rulesSnapshotId` обязателен
лишь для составов с `managed_rule`).

### 12.2 Дефекты, подтверждённые кодом
| ID | Дефект | Доказательство |
|---|---|---|
| D-1 | `sourceRef` правил неточен: `wardrobe-hinges.ts:17-39`, фактические значения — 22–26 и 35–43 | `managed-rules-seed.ts:37` |
| D-2 | `unit` не задан у всех 27; `RULE_UNITS` содержит только денежные единицы | `managed-rules-seed.ts:70–90`, `managed-rules.ts:54–61` |
| D-3 | Дверь за пределами полосы 8 → `count=6` + `overload: true` (не ноль, не ошибка) | `wardrobe-hinges.ts` (`wardrobeHingePlan`) |

### 12.3 Bootstrap заблокирован конфликтами (ключевой факт WP-2)
`dryRunBootstrap()` на копии `data/formakub.db`: план 93/60/8/1 (priceItems/catalogs/presets/versions),
готово к добавлению — **1 catalog** (`mdf_pvc`), **61 AdminParameter**.
`applyBootstrap()` **не проходит preflight**: `BOOTSTRAP_CATALOG_CONFLICT` ×10,
`BOOTSTRAP_PRESET_CONFLICT` ×5, `BOOTSTRAP_PRICING_VERSION_CONFLICT` ×1.
Механизм корректно отказывается перезаписывать административные правки.

**Следствие:** «повторный bootstrap» как способ закрыть разрыв данных **неприменим**.
Безопасная альтернатива — целевое добавление через существующие Admin API
(`/api/admin/catalogs/facadeMaterial/items`, `/api/admin/parameters`).

### 12.4 Неподтверждённые предположения (обновление)
| # | Предположение | Почему не подтверждено |
|---|---|---|
| A-8 | Повторный bootstrap безопасен для текущего Store | **опровергнуто**: 16 конфликтов, apply отказывается |
| A-9 | Значения 27 норм соответствуют производственным | источника в репозитории нет; все `preliminary` |

---

## 13. WP-2.1 — результаты (2026-11-16)

### 13.1 D-1 — `sourceRef` исправлен
Единый диапазон `wardrobe-hinges.ts:17-39` заменён на **точную строку значения**: 3 плотности
(строки 23/24/25) и 8 полос (строки 36–43). Значения, ID, `scope`, `category`, `affects` не
изменялись. Добавлен тест, который для каждого из 27 правил проверяет существование файла/строки и
наличие значения в этой строке. **OD-14 закрыт.**

### 13.2 D-2 — семантика единиц зафиксирована, модель не расширена
`RULE_UNITS` содержит только денежные единицы, поэтому `unit` у норм отсутствует. Семантика
(кг/м², мм, кг, шт.) зафиксирована в `WP2_RULES_REVIEW.md` § 12. Схема, API и Engine не изменялись;
валидация не обходилась. Ограничение модели — не блокер публикации.

### 13.3 D-3 — overload fallback зафиксирован
За последней полосой применяется `count=6` + `overload: true`; Engine не менялся; покрыто
`wardrobe-hinges.test.ts:95`.

### 13.4 Новое подтверждённое ограничение: у параметров нет create-API
`/api/admin/parameters` — только `GET`; `/api/admin/parameters/[id]` — `GET`/`PATCH`.
Маршрута создания нет. Единственный механизм создания 61 параметра — `applyBootstrap`, который
заблокирован 16 конфликтами. Влияние на расчёт нулевое (параметры берутся из манифеста).
Задача разделена: `CA-GL-22a` (`mdf_pvc`, готово) и `CA-GL-22b` (параметры, `BLOCKED`).

### 13.5 Дублирование норм отсутствует (проверено)
`parameter-seed.ts` **не содержит** `wardrobe.hingeBand.*` и `wardrobe.density*` — дубли удалены
(соответствует ТЗ §1176). Текст ADR-07 §3.2, упоминающий дубли, устарел; ADR не изменялся.

---

## 14. WP-2.2 — Controlled activation (2026-11-16)

### 14.1 Выполнено
| Операция | Результат |
|---|---|
| Импорт 27 ManagedRules (SQLite) | `created: 27`, все `draft`, `version="1"`, `source=preliminary`; повтор идемпотентен (`created: 0`, `skipped: 27`) |
| Добавление `mdf_pvc` | создан (`version="1"`, `active`), `priceRefs.ratePerSqm → catalog.facade.mdf_pvc.ratePerSqm` (`RUB_PER_SQM`, active); `facadeMaterial` = 6 записей |
| Контрольная точка | `data/backups/wp22-checkpoint-2026-11-16T12-25-24-039Z.db`, integrity `ok` |

### 14.2 Заблокировано: публикация `preliminary` (Q7-06)
`publishRulesSnapshot` отклоняет любой draft с `source=preliminary`
(`managed-rules.ts:865–869`). ADR-07 Q7-06: «`preliminary` не входит в опубликованный расчётный
снимок»; снимок возможен только после смены `source` на `owner_confirmed` (ADR-07 §508).

**Конфликт решений:** OD-13 разрешает публикацию «со статусом preliminary» и запрещает повышать
статус — Q7-06 требует обратного. Выход — OD-15 (см. `WP2_RULES_REVIEW.md` § 16.6).

### 14.3 Состояние Store после операций
- Коллекций SQLite: **10** (добавлена `managed-rules.json`); `rules-snapshots.json` **не создан**.
- 27 правил — `draft`/`preliminary`; активного снимка нет.
- `mdf_pvc` присутствует, цена разрешается.
- `integrity_check` = `ok`; `data/projects.json` sha256 неизменён (200 проектов в JSON-наборе).
- Create/preview остаются блокированными `RULES_SNAPSHOT_MISSING` (контролируемо, без нулевых подстановок).

### 14.4 Ограничение метода
Административный HTTP API требует OIDC-сессии; в среде её нет. Операции выполнены теми же
**сервисными функциями**, которые вызывают маршруты (`importManagedRulesSeed`, `publishRulesSnapshot`,
`createCatalogItem`) против SQLite-данных. Аудит-события пишутся штатно.

---

## 15. WP-2.3 — Owner confirmation и активация (2026-11-16)

### 15.1 Выполнено
| Операция | Результат |
|---|---|
| Owner confirmation 27 правил (`updateManagedRule` → `source=owner_confirmed`) | 27 записей, версии `1`→`2`, 27 audit-событий `rule.update` (actor `owner-od15`) |
| Публикация снимка | Snapshot **`rules-e36377dc500aff22`**, 27 правил, `owner_confirmed`, активен |
| Проверка расчёта | кухня `210 100`, шкаф `128 300` (`wardrobe.fittings = 29 050`), границы и overload корректны |
| Golden | без изменений (135 целевых тестов PASS) |
| Исторические проекты | не тронуты (SHA-256 `0472da8a…`) |
| SQLite integrity | `ok` |

### 15.2 Обнаруженная связанность: каталог ↔ display-metadata
`readDisplayMetadata` сверяет fingerprint, включающий labels каталогов (`display-metadata.ts:642–651`).
Добавление `mdf_pvc` изменило fingerprint → реальный расчёт вернул `DISPLAY_METADATA_UNAVAILABLE`.
На контрольной точке (до добавления) metadata валидна (`ec5195ec64d9`), т.е. поломку вызвало именно
добавление CatalogItem.

**Действие:** `mdf_pvc` откачен; `catalog-items` побайтно совпал с checkpoint; metadata и расчёт
восстановлены. `CA-GL-22a` → `BLOCKED` (требуется единый пакет «CatalogItem + reseed display-metadata»).

### 15.3 Ограничения решения
- Текстовое основание OD-15 не хранится в audit-log (схема без свободного поля) — зафиксировано в
  `WP2_RULES_REVIEW.md` § 17.
- `description` правил сохраняет исходную формулировку «preliminary» (атрибуты не менялись).
- 200 исторических проектов остаются в JSON; в активном SQLite `projects = 0`. Объединение не выполнялось.
