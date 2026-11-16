# CALCULATION ADMIN — CATALOG MODEL, DATA SOURCES & INSPECTOR

**Дата:** 2026-11-13
**Статус:** реализовано (read-only admin UI + read-model), production-операции не добавлялись
**Связанные документы:** `CALCULATION_ADMIN_TECHNICAL_SPECIFICATION.md`, `ADR-07-MANAGED-ASSEMBLY-RULES.md`, `MODULE_AND_COMPONENT_INVENTORY.md`, `MODULE_BOM_CATALOG.md`

---

## 1. Назначение

Раздел объясняет существующую расчётную систему, не создавая параллельную:

- какие каталоги и элементы существуют;
- из чего состоит каждый кухонный модуль;
- какие Managed Rules и PriceItem участвуют;
- как связаны проект, сохранённый расчёт, версии и снимки;
- где трассировка обрывается.

Формулы и вычислительная логика в админку не переносятся.

---

## 2. Архитектурная схема

```
Catalog Group (UI grouping)
   └── CatalogItem (Storage: catalog-items.json)
          ├── priceRefs → PriceItem (Storage: price-items.json)
          │                  └── PricingVersion.snapshot (Commercial Snapshot)
          └── attrs (толщины, характеристики)

Module Group (UI grouping)
   └── ModulePreset (kitchen; Storage: module-presets.json)
          └── priceRef (PriceItem)
   └── MODULE_COMPOSITION (read-model в коде, ссылки на реализацию)
          ├── PriceItem *
          ├── CatalogItem *
          └── ManagedRule * (assigns catalog:|priceItem:|line:)

ManagedRule (Storage: managed-rules.json)
   └── RulesSnapshot (immutable; Storage: rules-snapshots.json)
          └── StoredProject.rulesSnapshotId (pin)

Project (Storage: projects.json)
   ├── config
   ├── schemaVersion / calcVersion / priceVersion
   ├── rulesSnapshotId
   ├── price (PriceBreakdown: label/detail/amount)
   └── priceHistory[] (append-only; PriceBreakdown)
```

`DATA_RESOLVER → CalculationInputs → Engine (calculatePrice) → CalculationBreakdown →
Display Adapter → PriceBreakdown` — существующий путь расчёта; админка в нём не
участвует и его не дублирует.

---

## 3. Где физически хранятся данные

| Сущность | Источник истины | Редактируется в админке |
|---|---|---|
| CatalogItem | `catalog-items.json` (Storage Adapter) | Только архивирование/attrs/label через существующие API |
| PriceItem | `price-items.json` | Только контролируемый импорт; прямого создания нет |
| PricingVersion / PriceSnapshot | `pricing-versions.json` | draft/amount/validate/publish через существующие API |
| ModulePreset | `module-presets.json` | PATCH диапазонов/дефолтов, архив |
| ManagedRule | `managed-rules.json` | draft create/update/revision |
| RulesSnapshot | `rules-snapshots.json` | Только публикация (immutable) |
| Project | `projects.json` | Нет (read-only inspector); пересчёт — отдельная защищённая операция |
| AdminParameter | `admin-parameters.json` | PATCH значения по правилам CA-T-203 |
| Audit | `admin-audit-log.json` | append-only |

---

## 4. Что показывает каждый раздел

| Раздел | Источник | Ограничение |
|---|---|---|
| `/admin/modules` | ModulePreset + `MODULE_COMPOSITION` | Состав — read-model по коду; формулы не отображаются |
| `/admin/modules/[type]` | ModulePreset + composition + Managed Rules | Нет расчёта суммы; условия — текстом |
| `/admin/catalogs` | CatalogItem + PriceItem + Managed Rules | Группа без коллекции помечена PARTIAL/NOT_FOUND |
| `/admin/materials` | CatalogItem attrs | Плотность и произвольные характеристики отсутствуют в модели |
| `/admin/data-sources` | sourceRef/source/updatedBy/проектные pins | `CatalogItem.sourceRef` не существует → «источник не установлен» |
| `/admin/calculations` | `StoredProject` + rules diagnostics | Нет id строки/priceItem/нормы количества в сохранённом Breakdown |
| `/admin/versions` | PricingVersion, RulesSnapshot, publication journal, audit | Журнал и снимки только читаются |
| `/admin/diagnostics` | diagnoseGraph + data-source checks | Ложные проверки для отсутствующих сущностей не создаются |

---

## 5. Типы связей компонентов

- `required` — присутствует всегда (корпус, пресет, вырез мойки/варочной/ниши).
- `conditional` — при выполнении условия (створки, soft-close, push-to-open, ящики).
- `optional` — при ненулевом количестве (полки, наполнение секций).
- `alternative` — взаимоисключающие варианты (зарезервировано; в текущей модели
  альтернативы выражены выбором CatalogItem, отдельной сущности нет).

---

## 6. Происхождение цены и количества

**Цена:**

1. `StoredProject.priceVersion` → `PricingVersion.snapshot`.
2. Строка `PriceItem` → `sourceRef` (файл:константа content).
3. Сохранённый `PriceBreakdown.lines[].amount` — итог движка, не пересчитывается админкой.

**Количество:**

1. Норма — `ManagedRule` (`value`/`valueType`/`unit`, `assigns`, `condition`).
2. Количество конкретного компонента в сохранённом проекте **не хранится**;
   `CalculationBreakdown`/`PriceBreakdown` не содержат component quantity.
3. Поэтому Inspector показывает только доступные агрегированные строки и
   статические связи правил, а не восстановленное количество.

**Чего нет (и не имитируется):**

- `priceItemId` в строке сохранённого Breakdown;
- id строки в `PriceBreakdown`;
- runtime-трассировка «правило → количество → строка»;
- отдельная таблица BOM/состава модуля в Storage.

Для полной трассировки потребуется изменение расчётного контракта
(`CalculationBreakdown` с component trace) и отдельное архитектурное решение.

---

## 7. Публикация и версии

- Коммерческие цены: `draft → validate → publish` (`PricingVersion`), старые
  версии не переписываются.
- Правила: явный выбор draft-правил + `expectedVersion` + подтверждение →
  immutable `RulesSnapshot`; production gate `FORMAKUB_RULES_PUBLICATION_ENABLED`.
- Проект закрепляется за снимком только отдельной операцией перехода
  (`project.rules_transition`); автоматический переход запрещён.
- Старые проекты без `rulesSnapshotId` читаются, но новый расчёт блокируется.

---

## 8. Диагностика

| Проверка | Источник |
|---|---|
| `legacy_no_snapshot` | проект без `rulesSnapshotId` |
| `snapshot_unknown` / `corrupt` / `invalid` | `rules-diagnostics.ts` |
| `required_rules_missing` / `rules_invalid` | обязательные нормы шкафа |
| Отсутствующий тариф | `catalogPriceLinkIssues`, snapshot published |
| Preliminary | `CatalogItem.status`, `AdminParameter.status`, `ManagedRule.source` |
| Ошибки состава | `moduleCoverageIssues` (карта ↔ группы) |

Диагностика не создаёт ошибок для сущностей, которых нет в модели
(например, подъёмные механизмы, подвесы).

---

## 9. Незавершённые возможности

- Component-level runtime trace (quantity + price + rule per line) — требует
  изменения контракта и ADR.
- Отдельные справочники кромки/петель/направляющих/крепежа — сейчас PriceItem
  + атрибуты; создание коллекций не выполнялось.
- Плотность материалов и физические характеристики — нет в модели.
- BOM/раскрой как manufacturing data — отсутствует.

---

## 10. Тесты

- `src/lib/admin/catalog-model.test.ts` (9 тестов) — покрытие CatalogKind, 8 типов кухни,
  ссылки на PriceItem bootstrap-плана, отсутствие подстановки 0 ₽.
- `src/lib/admin/data-sources.test.ts` — источники не выдумываются, конфликты
  ссылок, preliminary/legacy.
- `src/lib/admin/calculation-inspector.test.ts` — legacy/no-history, отсутствие
  id строк, отсутствие выдуманной трассировки, unknown project.
- `src/components/admin/navigation.test.ts` — группы и маршруты.

---

## 11. Управляемый состав (2026-11-13)

Статический `MODULE_COMPOSITION` остаётся **read-model/справочным fallback**. Управляемые данные вынесены в `CompositionVersion` (`composition-versions.json`) и встроенные `CompositionLine`:

- `CompositionVersion`: draft → published → superseded; published immutable; `version`/`expectedVersion`; `contentHash`; audit; publication journal/recovery.
- `CompositionLine`: `moduleType`, `componentCatalog?`/`componentId?`, `priceItemId?`, `relation`, `alternativeGroup?`, `quantityRef` (`code|managed_rule|fixed`), `condition?`, `sourceRef`, `source`, `sortOrder`.
- Строка **не содержит сумму**; тариф — `PriceItem`/`PricingVersion.snapshot`; норма — `ManagedRule`/код; компонент — `CatalogItem`.
- Published не редактируется; новый draft создаётся из published. Удаление draft запрещено, published — запрещено; используемая проектом версия защищена.
- Проект может иметь optional `compositionVersionId`; пересчёт с закреплённой версией проходит DataResolver preflight (существование, published, покрытие типов, наличие тарифов в snapshot). Engine/формулы не изменены.

Подробности — `COMPONENT_DOMAIN_MODEL_PROPOSAL.md` §17 и `CALCULATION_ADMIN_TECHNICAL_SPECIFICATION.md` §12.7.

### 11.1. Remediation Q1–Q8 (2026-11-16)

- Composition и RulesSnapshot независимы; при rule refs composition фиксирует `rulesSnapshotId`, проверка идёт по снимку; project pin должен совпадать с composition snapshot.
- `source=preliminary` строка блокирует публикацию; `owner_confirmed` — только отдельная операция подтверждения с actor/date/reference.
- Публикация фиксирует commercial pins (`CatalogItem` versions, `PriceItem.updatedAt`, `PricingVersion`); они входят в `contentHash`.
- `production.status` отделён от published; Production Gate — отдельная операция; production DataResolver требует approved.
- `contentHash` проверяется при чтении/валидации/переходе/recovery.
- `conditional` требует condition; code refs ограничены реестром.
