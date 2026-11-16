# ADR-08: CompositionVersion — версионирование управляемого состава

- **ID:** ADR-08
- **Статус:** APPROVED (в рамках утверждённых владельцем решений Q1–Q8, 2026-11-16)
- **Дата:** 2026-11-16
- **Связанные:** ADR-06 (Engine contract), ADR-07 (Managed Rules), `CALCULATION_ADMIN_TECHNICAL_SPECIFICATION.md` §12.7, `COMPONENT_DOMAIN_MODEL_PROPOSAL.md` §17
- **Важно:** настоящий ADR **не вводит новую модель версионирования**. Он фиксирует уже реализованный агрегат `CompositionVersion` и ограничения, в которых он может развиваться. Новые механизмы версий/снимков не создаются.

---

## 1. Контекст

Управляемый состав модулей (`CompositionVersion`) — отдельный слой данных Calculation Admin. Он должен:

- описывать состав 8 кухонных типов;
- версионироваться независимо от `PricingVersion` и `RulesSnapshot`;
- публиковаться неизменяемо;
- закрепляться за проектом;
- сохранять историческую воспроизводимость;
- не превращаться во второй расчётный движок.

До реализации использовались:
- `PricingVersion` — draft/published/superseded + immutable snapshot;
- `RulesSnapshot` — immutable published copy правил;
- `ProjectPins` — catalog/preset versions;
- `ProjectPriceHistory` — append-only история цены.

`CompositionVersion` использует тот же паттерн: draft → published → superseded + immutable published + snapshot-подобная запись.

---

## 2. Решение

### 2.1. Идентичность

`CompositionVersion.id` — стабильный идентификатор версии. `schemaVersion` — версия структуры записи (сейчас `1`). `version` — optimistic lock для draft. `contentHash` — SHA-256 канонических `lines + rulesSnapshotId + pins`.

### 2.2. Создание версии

- draft создаётся из published или пустого набора;
- published не редактируется;
- изменение published — только новый draft (новая запись с новым id);
- `sourceVersionId` хранит ссылку на исходную версию.

### 2.3. Изменение опубликованного состава

Запрещено. Новая редакция создаётся как draft из published; публикация создаёт новый immutable published и переводит предыдущий published в `superseded`.

### 2.4. Привязка к проекту

`StoredProject.compositionVersionId?: string` — optional. Привязка выполняется только явной операцией с `expectedUpdatedAt` и audit. Автоматическая привязка/перепривязка отсутствует. `compositionVersionId` не входит в `ProjectPins` и не повышает `schemaVersion`.

### 2.5. Коммерческие пины (Q4)

Публикация фиксирует:

- `pins.catalogVersions` — версии использованных `CatalogItem`;
- `pins.priceItemVersions` — `updatedAt` использованных `PriceItem` (у PriceItem нет отдельного version);
- `pins.priceVersionId` — `PricingVersion`, в которой проверялись суммы.

Пины входят в `contentHash`. Текущее изменение тарифов не меняет опубликованную composition; исторический расчёт опирается на `PriceSnapshot` проекта, а composition хранит ссылки на коммерческие источники.

### 2.6. RulesSnapshot (Q1)

Composition и RulesSnapshot — независимые версии. Если composition содержит `quantityRef.managed_rule`/`condition.managed_rule`, публикация фиксирует `rulesSnapshotId`. Проверка правил выполняется **по этому снимку**, не по текущей коллекции. При pin проекта composition и project rules snapshot должны совпадать; иначе переход/расчёт блокируется.

### 2.7. Supersede

При публикации новой версии все ранее published переводятся в superseded с `supersededAt`. Superseded не удаляется и остаётся в истории; project pin на superseded блокирует новый расчёт, чтение сохранённого результата сохраняется.

### 2.8. Journal и recovery

- publication journal: намерение → version_published → audit_pending → completed; recovery при старте/перед публикацией;
- transition journal: prepared → project_updated → audit_pending → completed; recovery при старте;
- межколлекционная транзакция не заявляется (NEW-N3 не используется).

### 2.9. Production Gate (Q5)

`production.status` (`not_ready|approved`) отделён от `published`. Публикация создаёт `not_ready`; отдельная операция с `price.publish` и подтверждением переводит в `approved` после проверок:

- published;
- hash verified;
- нет preliminary-строк;
- commercial pins присутствуют;
- validation без ошибок.

В `NODE_ENV=production` DataResolver блокирует расчёт с composition без `approved`.

### 2.10. Обратная совместимость

- `compositionVersionId` optional;
- `schemaVersion` не повышен;
- старые проекты читаются;
- опубликованные composition без `pins/production` читаются как legacy (production gate не пройден);
- удаление published/superseded запрещено;
- старые PriceSnapshot и priceHistory не мигрируют.

---

## 3. Рассмотренные альтернативы

| Вариант | Решение |
|---|---|
| Включить composition в `PricingVersion` | отклонено: смешивает состав и цены |
| Включить composition в `RulesSnapshot` | отклонено: ADR-07 фиксирует правила, не BOM; потребовало бы менять ADR-07 |
| Отдельная `compositionVersion` как четвёртая глобальная версия | отклонено: достаточно отдельного идентификатора + optional project pin |
| Хранить composition только в коде (`MODULE_COMPOSITION`) | отклонено: нет управления/версий/пинов |
| Новая Component-коллекция | отклонено: дублирует CatalogItem |

---

## 4. Последствия

- Появляется новый immutable admin-слой; его нужно включать в backup/restore как обычную коллекцию Storage Adapter.
- Проект может иметь независимые composition/rules pins; несовместимая пара блокируется.
- Полная component-level трассировка Engine **не является** частью этого ADR; требуется отдельное изменение `CalculationBreakdown`.
- Production Gate не делает состав частью расчёта; он только разрешает production-использование проверенной версии.
- Все изменения должны сохранять `calculatePrice` единственной точкой расчёта.

---

## 5. Открытые вопросы

1. Нужно ли формально включать `CompositionVersion` в `ProjectPins` или оставить top-level optional? (сейчас top-level)
2. Нужно ли расширять production gate критерии (например, ручное подтверждение владельцем)?
3. Нужна ли отдельная версия для `CompositionVersion` schema при будущем изменении полей? (сейчас `schemaVersion=1`)
4. Должен ли `priceVersionId` быть обязательным для composition без явных тарифов? (сейчас optional)
