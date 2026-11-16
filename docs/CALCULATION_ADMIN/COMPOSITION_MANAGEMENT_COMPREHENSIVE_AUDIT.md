# COMPOSITION MANAGEMENT — COMPREHENSIVE AUDIT

**Дата:** 2026-11-16
**Режим:** AUDIT ONLY. Код, тесты, данные, миграции, конфигурация и существующая документация не изменялись.
**Создан только этот документ.**
**Связанные документы:** `COMPONENT_DOMAIN_MODEL_PROPOSAL.md` (§17), `CALCULATION_ADMIN_TECHNICAL_SPECIFICATION.md` (§12.7), `ADR-07-MANAGED-ASSEMBLY-RULES.md`, `PROJECT_PROGRESS.md`, `PROJECT_BACKLOG.md`.

---

## 1. Executive Summary

Composition Management реализован как отдельный версионируемый слой данных:

- `CompositionVersion` в `composition-versions.json`;
- встроенные `CompositionLine`;
- draft → validate → publish → superseded;
- immutable published;
- `expectedVersion`, `contentHash`, audit;
- publication journal + recovery;
- optional `StoredProject.compositionVersionId`;
- DataResolver preflight;
- UI `/admin/modules`, `/admin/modules/[type]`, Inspector.

Сильные стороны:

- нет второго калькулятора;
- формулы, Engine, Legacy Pricing, геометрия, `CalculationBreakdown` не изменены;
- нет второй Component-коллекции;
- published не редактируется;
- старые проекты читаются;
- `schemaVersion`/`calcVersion` не изменены;
- `NEW-N3` не использован;
- большую часть lifecycle покрывают 16 целевых тестов, полный прогон — **118 файлов / 1223 теста PASS**.

Главные выводы аудита:

1. **P0:** через PATCH можно сохранить две строки с одинаковым `id`; запись перестаёт читаться, ломая весь Composition Admin и preflight закреплённых проектов.
2. **P1:** `contentHash` нигде не проверяется обратным пересчётом; повреждённая/подменённая версия принимается.
3. **P1:** отсутствует согласование `CompositionVersion.rulesSnapshotId` с `StoredProject.rulesSnapshotId`; проверка правил идёт по **текущему активному** снимку, а не по снимку композиции; правило, архивированное после снимка, делает валидную композицию невалидной.
4. **P1:** `quantityRef.code` и `condition.code` принимают произвольную строку; реестра/whitelist/обработчиков нет.
5. **P1:** нет проверки, что явный `priceItemId` относится к выбранному `CatalogItem`; можно опубликовать фиктивную связь.
6. **P1:** UI позволяет нажать «Опубликовать» без сохранения изменённых строк — публикуется сохранённая старая версия.
7. **P1:** привязка состава и пересчёт проекта не защищены CAS по `compositionVersionId`; возможна потеря только что сделанного pin; transition не имеет crash-safe журнала аудита.
8. **P1/OWNER:** preliminary-строки состава публикуются с предупреждением; это политика допуска, требующая решения владельца.
9. **P2:** отсутствует модель версии тарифов/каталога внутри композиции; `rulesSnapshotId` есть, `priceVersionId`/catalog versions — нет.
10. **P2:** seed теряет непредставимые строки (`sink-partition`) после импорта; они остаются только в ответе API.

Полноценной component-level трассировки и влияния состава на количества/цену **нет** и быть не может без отдельного ADR/изменения контракта. Текущая реализация — слой A: управляемый состав + preflight; не слой B.

---

## 2. Фактическая архитектура

```text
CatalogItem ──┐
PriceItem ────┼──> CompositionLine ──> CompositionVersion
ManagedRule ──┘          │                    │
                         │                    ├─> composition-versions.json
                         │                    └─> publication journal
                         │
StoredProject ── compositionVersionId? ──> DataResolver preflight
                         │
                         └─> CalculationInputs (composition НЕ передаётся)

RulesSnapshot ──> StoredProject.rulesSnapshotId
             └─> CalculationInputs.rulesSnapshot
```

**Источники истины:**

| Данные | Источник |
|---|---|
| компонент | `CatalogItem` |
| тариф (идентичность) | `PriceItem` |
| сумма тарифа | `PricingVersion.snapshot` |
| норма/условие | `ManagedRule` / `RulesSnapshot` |
| состав | `CompositionVersion` (новый источник для состава) |
| проект | `StoredProject` |
| формулы/количества Engine | код `src/lib/configurator/engine.ts` |
| статический fallback | `MODULE_COMPOSITION` (read-model) |

**Ключевая граница:** `CompositionVersion` не входит в `CalculationInputs`; Engine не читает состав. Влияние на расчёт ограничено **preflight-гейтом** при закреплённой версии.

---

## 3. Проверенные цепочки данных

| Цепочка | Результат аудита |
|---|---|
| `CompositionVersion → DataResolver → CalculationRequest` | composition ID проверяется, версия и покрытие типов/тарифов проверяются; в `CalculationInputs` не передаётся |
| `CompositionVersion → RulesSnapshot` | `rulesSnapshotId` записывается при публикации, но при проверке композиции используется **активный** снимок, не сохранённый |
| `CompositionVersion → ManagedRule` | checkRule ищет правило в текущей коллекции и проверяет статус/источник; затем наличие в active snapshot |
| `CompositionVersion → PriceItem` | проверяется существование/active и наличие в текущем published snapshot; связь с компонентом не проверяется |
| `CompositionVersion → CatalogItem` | проверяется существование/статус; версия каталога не пинится |
| `StoredProject → compositionVersionId → DataResolver` | версия разрешается; при pinned правила проекта и снимок композиции не сверяются |
| `StoredProject → priceHistory` | compositionVersionId пишется в новые события; старые события без поля |
| publication journal → audit | recovery умеет дописать audit по опубликованной версии; hash не пересчитывается |
| seed → draft | 8 типов покрыты, `sink-partition` пропущен, source=preliminary, без публикации |

---

## 4. Реестр несогласованностей и дефектов

> **Статусы:** `CONFIRMED` — доказано кодом/тестом; `POTENTIAL` — риск, требующий отдельной проверки/условия; `OWNER DECISION` — политика, которую нельзя решать самостоятельно.

### CM-A01 — [CONFIRMED] — P0 — Дубликат `CompositionLine.id` сохраняется и ломает чтение

- **Категория:** модель данных, валидация, целостность.
- **Файлы/участки:**
  - `src/lib/admin/composition-schema.ts:185–196` — уникальность проверяется только при полном `compositionVersionSchema.safeParse`;
  - `src/lib/admin/composition.ts:259–302` — `updateCompositionDraft` принимает `lines` и пишет их без полного parse версии;
  - `src/app/api/admin/compositions/[id]/route.ts` — PATCH валидирует только массив отдельных `compositionLineSchema`.
- **Фактическое поведение:** PATCH с двумя строками одинакового `id` возвращает успех и сохраняет версию. Следующий `readVersions()` (`composition.ts:86–102`) падает на `compositionVersionSchema`, потому что дубликат обнаруживается только там. Все чтения композиций, страницы `/admin/modules`, API и preflight закреплённых проектов становятся недоступны.
- **Ожидаемое:** 422 до записи; коллекция не меняется.
- **Воспроизведение:** создать draft → PATCH `lines: [line, {...line}]` → GET `/api/admin/compositions` или открыть `/admin/modules`.
- **Последствия:** порча админ-коллекции, отказ всех composition-операций, блокировка расчёта проектов с pin.
- **Связанные:** CM-A10 (all-or-nothing read).
- **Исправление:** парсить полный `CompositionVersion` перед записью; проверять уникальность `id` в сервисе и API; тест на PATCH duplicate.
- **Тесты:** duplicate id on create/update/PATCH; read after rejected write.
- **Владелец:** не требуется.

### CM-A02 — [CONFIRMED] — P1 — `contentHash` не проверяется ни на одном пути

- **Категория:** целостность/воспроизводимость.
- **Файлы:** `composition.ts:71–84, 86–102, 378–396, 704–735`; `composition-journal.ts:149–161`.
- **Фактическое:** hash вычисляется при create/update/publish, но ни `getCompositionVersion`, ни `validateCompositionVersion`, ни `validateCompositionForConfig`, ни transition/recovery не пересчитывают его. Ручное изменение `lines` при сохранённом hash проходит.
- **Ожидаемое:** при чтении/publish/transition/preflight сравнивать `compositionContentHash(lines, rulesSnapshotId)` с `contentHash`; ошибка `COMPOSITION_HASH_MISMATCH`.
- **Воспроизведение:** изменить одну строку в `composition-versions.json`, оставить hash; открыть board/pin.
- **Последствия:** опубликованная «immutable» версия фактически не защищена от подмены; невозможно доказать целостность.
- **Связанные:** CM-A11, CM-A16.
- **Исправление:** verify function + fail-closed; тест tamper.
- **Владелец:** не требуется.

### CM-A03 — [CONFIRMED] — P1 — RulesSnapshot композиции не согласован с проектом и с проверкой

- **Категория:** версии/воспроизводимость/ADR-07.
- **Файлы:** `composition.ts:341–375, 391, 730–735`; `composition-transition.ts:45–59`; `data-resolver.ts:1360–1401`; `projects.ts:599–610, 760–771`.
- **Фактическое:**
  - при публикации `rulesSnapshotId` берётся из **активного** снимка и записывается в композицию;
  - `validateCompositionVersion` всегда использует `resolveActiveRulesSnapshot()` (строка 391), игнорируя `version.rulesSnapshotId`;
  - `checkRuleReference` ищет правило в текущей `managed-rules.json` и проверяет его текущий `status/source` (341–375), затем наличие в active snapshot;
  - transition не проверяет `composition.rulesSnapshotId` против `project.rulesSnapshotId`;
  - DataResolver не сверяет два снимка.
- **Ожидаемое:** одно из двух, по решению владельца:
  1. composition и project должны ссылаться на один снимок; иначе pin/recalc блокируется;
  2. composition и rules независимы, но тогда Engine/Inspector не должны заявлять о совместной воспроизводимости, а rule refs должны разрешаться строго по `composition.rulesSnapshotId`.
- **Воспроизведение:** опубликовать composition при snapshot S1; опубликовать S2; закрепить composition у проекта с S2; пересчитать. Сейчас preflight пройдёт (composition не проверяет rules), хотя версии разные.
- **Последствия:** скрытая несовместимая комбинация; в будущем — неверная трассировка; уже сейчас — ложное впечатление воспроизводимости.
- **Связанные:** CM-A04, CM-A07, CM-A11.
- **Исправление:** snapshot-aware resolver; cross-check при pin и recalc; тесты S1/S2, missing/corrupt/archived.
- **Владелец:** **OWNER DECISION** — являются ли composition и rules независимыми осями или должны быть согласованы.

### CM-A04 — [CONFIRMED] — P1 — Rule refs проверяются по текущей коллекции, а не по снимку

- **Категория:** правила/воспроизводимость.
- **Файлы:** `composition.ts:341–375`.
- **Фактическое:** если правило было published в S1, затем архивировано/заменено в текущей коллекции, `checkRuleReference` видит текущий `archived` и выдаёт ошибку, хотя S1 неизменяем и содержит валидную копию. Обратный случай: правило в текущей коллекции published, но в active snapshot иное/отсутствует — ошибка по snapshot.
- **Ожидаемое:** источником для reference-проверки должен быть конкретный snapshot (`version.rulesSnapshotId`/active snapshot), а не «живая» коллекция; current collection — только для диагностики расхождений.
- **Воспроизведение:** опубликовать S1 с правилом, архивировать правило, открыть publish validation композиции.
- **Последствия:** ложные блокировки, невозможность воспроизвести опубликованную композицию.
- **Исправление:** `checkRuleReference(snapshot.rules, ruleId)`; проверять `source` из snapshot; тест archived-after-snapshot.
- **Владелец:** не требуется (следствие ADR-07).

### CM-A05 — [CONFIRMED] — P1 — `quantityRef.code`/`condition.code` без реестра и whitelist

- **Категория:** валидация, происхождение количества.
- **Файлы:** `composition-schema.ts:80–96`; `composition.ts:521–574`; `composition-seed.ts:45`; UI `CompositionEditor.tsx`.
- **Фактическое:** `implementationId` — произвольная непустая строка. Валидация проверяет только schema; при публикации code не проверяется; нет реестра допустимых идентификаторов, нет проверки существования обработчика. Seed использует пути/функции, но это не контракт.
- **Ожидаемое:** закрытый реестр `implementationId` (например, `calculateKitchenBreakdown`, `sinkLayout`, `computeSupports`, …), проверка при publish; неизвестный код — ошибка. Если код descriptive-only, он не должен называться источником количества.
- **Воспроизведение:** строка `quantityRef:{kind:"code", implementationId:"unknown"}` проходит validate/publish.
- **Последствия:** недостоверная provenance, будущая невозможность исполнить/проверить; нарушение требования «не считать TypeScript union доказательством».
- **Связанные:** CM-A12 (condition semantics).
- **Исправление:** registry + validation + UI select (не свободный input); тесты unknown code.
- **Владелец:** возможно, если реестр кодов должен быть согласован с владельцем.

### CM-A06 — [CONFIRMED] — P1 — Нет проверки связи `CatalogItem` ↔ `priceItemId`

- **Категория:** данные/тарифы.
- **Файлы:** `composition.ts:414–519`; `composition-schema.ts:100–117`.
- **Фактическое:** если указаны и `componentId`, и `priceItemId`, проверяются только существование/статус/наличие в snapshot каждого. Не проверяется, что `priceItemId` входит в `CatalogItem.priceRefs` или соответствует роли компонента. Можно связать корпус `ldsp` с тарифом петли.
- **Ожидаемое:** explicit tariff должен принадлежать компоненту/роли; иначе error. Для multi-role (опоры: leg/clip/screw/anchor) нужна роль или несколько строк.
- **Воспроизведение:** composition line `componentCatalog:"bodyMaterial", componentId:"ldsp", priceItemId:"kitchen.hingePerDoor"` → publish проходит.
- **Последствия:** фиктивные связи, недостоверная административная модель, будущая неверная трассировка.
- **Связанные:** CM-A05, CM-A11.
- **Исправление:** role-aware `priceRef` + validation; тест mismatch.
- **Владелец:** возможно, для расширения модели ролью тарифа.

### CM-A07 — [CONFIRMED] — P1 — UI публикует без сохранения изменённых строк

- **Категория:** UI/API mismatch, потеря данных.
- **Файлы:** `src/components/admin/modules/CompositionEditor.tsx:180–205` (save), `235–251` (publish).
- **Фактическое:** `publish()` отправляет только `expectedVersion`/подтверждение; `lines` не отправляются. Сервер публикует **сохранённый** draft. Если администратор изменил строки и нажал «Опубликовать» без «Сохранить draft», изменения молча игнорируются.
- **Ожидаемое:** publish должен требовать `dirty=false`, автоматически сохранять draft перед публикацией или возвращать 409 `UNSAVED_CHANGES`.
- **Воспроизведение:** изменить `sortOrder`/компонент → «Опубликовать» → published не содержит изменения.
- **Последствия:** потеря админских правок, неверная опубликованная версия.
- **Связанные:** CM-A18 (validate также работает по сохранённому).
- **Исправление:** dirty tracking, auto-save, блокировка кнопки; UI-тест.
- **Владелец:** не требуется.

### CM-A08 — [CONFIRMED] — P1 — Pin/recalc/worker не защищены CAS; transition не crash-safe

- **Категория:** конкурентность/аудит.
- **Файлы:** `src/lib/server/projects.ts:599–610, 760–771`; `composition-transition.ts:81–140`.
- **Фактическое:**
  - `recalculateProject` в updater берёт `stored` из коллекции, но ставит `compositionVersionId` из `resolution` (пин на старте расчёта). Если transition выполнился во время расчёта, результат перезапишет новый pin старым.
  - `applyProjectPriceHistory` ставит `compositionVersionId` из `event`, не сверяя текущий pin/updatedAt; worker может откатить только что сделанный transition.
  - `transitionProjectComposition` меняет проект, затем пишет audit; при падении процесса между шагами pin остаётся без audit; rollback в catch может перезаписать конкурентные изменения проекта.
- **Ожидаемое:** CAS по `updatedAt`/`compositionVersionId` в recalc/worker; transition journal/recovery (или запись audit + проекта через существующий journal-паттерн); при конфликте — 409 без перезаписи.
- **Воспроизведение:** запустить долгий recalc, сделать transition на другой composition, дождаться recalc → pin откатывается.
- **Последствия:** потеря явного выбора владельца, неаудированная привязка, невоспроизводимость.
- **Связанные:** CM-A03, CM-A16.
- **Исправление:** CAS + transition journal/recovery; тесты concurrency/crash.
- **Владелец:** нет, кроме выбора journal-подхода (не NEW-N3).

### CM-A09 — [OWNER DECISION] — P1 — Preliminary CompositionLine допускается в published

- **Категория:** политика достоверности.
- **Файлы:** `composition.ts:403–412, 724–728`; seed.
- **Фактическое:** `source=preliminary` даёт warning, publish не блокируется. Импортированный seed целиком preliminary; опубликованная версия может считаться действующей, хотя данные не подтверждены.
- **Ожидаемое:** политика должна быть единой с ADR-07/Q5:
  - либо preliminary-строки блокируют публикацию;
  - либо публикуется версия со статусом «preliminary» и явной маркировкой, но не считается подтверждённой.
- **Воспроизведение:** seed → publish → published composition с preliminary строками.
- **Последствия:** ложная уверенность, нарушение принципа «preliminary не подтверждён».
- **Связанные:** CM-A13 (`owner_confirmed` evidence).
- **Исправление:** политика + явный статус/блокировка; тест.
- **Владелец:** **OWNER DECISION**.

### CM-A10 — [CONFIRMED] — P2 — Любая повреждённая запись ломает все чтения композиции

- **Категория:** отказоустойчивость.
- **Файлы:** `composition.ts:86–102`.
- **Фактическое:** `readVersions` выбрасывает исключение при первой невалидной записи; нет карантина/частичного чтения. `/admin/modules`, `/admin/versions`, API list и preflight всех pinned-проектов падают.
- **Ожидаемое:** изолировать повреждённую запись в диагностический отчёт; валидные версии остаются читаемыми; операции с повреждённой — fail-closed.
- **Воспроизведение:** добавить в JSON запись без `contentHash` → открыть `/admin/modules`.
- **Последствия:** единичная порча блокирует весь Composition Management.
- **Связанные:** CM-A01.
- **Исправление:** parse-per-record + issues; не смешивать с валидными; тест corrupt record.
- **Владелец:** нет.

### CM-A11 — [OWNER DECISION] — P2 — Композиция не пинит версии CatalogItem/PriceItem/PricingVersion

- **Категория:** воспроизводимость.
- **Файлы:** `composition-schema.ts:161–213`; `composition.ts:71–84, 378–396`.
- **Фактическое:** `CompositionVersion` хранит `rulesSnapshotId`, но не `priceVersionId`, не `catalogVersions`, не `priceItemVersions`. Валидация использует **текущий** published `PricingVersion` и текущие коллекции; `contentHash` не включает версии компонентов/тарифов.
- **Ожидаемое:** либо composition — только административная схема (тогда явно не заявлять reproducibility), либо добавить пин/версии и включать их в hash/validation.
- **Воспроизведение:** опубликовать composition; изменить `CatalogItem.attrs`/`PriceItem.label`; открыть/проверить composition — нет доказательства исходных версий.
- **Последствия:** невозможно доказать, на каких версиях компонентов/тарифов основана композиция; риск ложной воспроизводимости.
- **Связанные:** CM-A02, CM-A03.
- **Исправление:** модель pins или явный scope «schema only»; тест version drift.
- **Владелец:** **OWNER DECISION** (расширение модели).

### CM-A12 — [CONFIRMED] — P2 — `relation=conditional` без условия; alternativeGroup без семантики

- **Категория:** модель состава.
- **Файлы:** `composition-schema.ts:119–157`; `composition.ts:576–598`.
- **Фактическое:** schema требует `alternativeGroup` только для relation=alternative; `conditional` без `condition` допустим; не проверяется, что alternative-группа содержит >1 строку, один moduleType, согласованные условия; `required` с condition не запрещён.
- **Ожидаемое:** `conditional` требует непустого condition/ref; alternative-группа консистентна; relation semantics валидируется.
- **Воспроизведение:** строка `relation:"conditional"` без condition проходит publish.
- **Последствия:** логически противоречивые композиции, скрытые ошибки.
- **Связанные:** CM-A05.
- **Исправление:** superRefine + publication validation; тесты.
- **Владелец:** нет.

### CM-A13 — [OWNER DECISION] — P2 — `source=owner_confirmed` не требует доказательства

- **Категория:** provenance/политика.
- **Файлы:** `composition-schema.ts:114–115`; `composition.ts:531–561`; UI source select.
- **Фактическое:** `sourceRef` — произвольная строка; UI default `admin:composition-editor`; `owner_confirmed` можно выбрать вручную; документальное подтверждение не проверяется.
- **Ожидаемое:** `sourceRef` — ссылка на документ/запись с проверяемым форматом/источником; `owner_confirmed` требует evidence/confirmedAt/actor, либо UI не должен позволять выбирать его без подтверждения.
- **Воспроизведение:** добавить fixed-строку, source=owner_confirmed, sourceRef="x" → publish.
- **Последствия:** фиктивная достоверность, обход Q7/Q5.
- **Связанные:** CM-A09.
- **Исправление:** provenance model/validation; UI не давать owner_confirmed без подтверждения.
- **Владелец:** **OWNER DECISION**.

### CM-A14 — [CONFIRMED] — P2 — Seed теряет непредставимые строки без следа

- **Категория:** миграция/данные.
- **Файлы:** `composition-seed.ts:107–124, 157–184`; `composition.ts:217–230`.
- **Фактическое:** `sink-partition` и любые строки без CatalogItem/PriceItem пропускаются и возвращаются в `skipped` только HTTP-ответом import. В `CompositionVersion`/audit нет постоянной отметки, что часть состава не мигрирована; после перезагрузки страницы это невидимо.
- **Ожидаемое:** сохранить `skipped` в audit/notes/версии или отдельном read-only diagnostic; иначе администратор считает состав полным.
- **Воспроизведение:** import → API response содержит skipped; открыть composition — нет информации.
- **Последствия:** неполная композиция выглядит полной; будущая трассировка потеряет структурные элементы.
- **Связанные:** CM-A11.
- **Исправление:** migration report persisted/read-only; тест.
- **Владелец:** нет.

### CM-A15 — [CONFIRMED] — P2 — Configurable-слоты не имеют тарифной роли; seed оставляет их без цены

- **Категория:** модель данных/тарифы.
- **Файлы:** `composition-schema.ts:104–109`; `composition.ts:458–519`; `composition-seed.ts` (facade/handle/supports).
- **Фактическое:** `componentCatalog` без `componentId` — слот; у строки нет `priceRole`/`priceRef`-паттерна. Seed создаёт слоты facade/handle/supports без `priceItemId`; в published composition эти компоненты не связаны с тарифом. Для countertop/other project-level positions состава вообще нет.
- **Ожидаемое:** либо слот хранит `priceRole`/pattern, либо явно документировано, что тариф определяется конфигурацией и не входит в composition.
- **Последствия:** composition выглядит полной, но не объясняет происхождение цены для части модуля.
- **Связанные:** CM-A06, CM-A11.
- **Исправление:** role-aware slot model; тест.
- **Владелец:** требует решения владельца (расширение модели).

### CM-A16 — [CONFIRMED] — P2 — Replay публикации после supersede возвращает ошибку

- **Категория:** lifecycle/idempotency.
- **Файлы:** `composition.ts:748–753`; `composition-journal.ts:81–96`.
- **Фактическое:** при повторном `publish` с тем же `operationId` journal entry completed возвращается, но `getCompositionVersion(id)` может вернуть `superseded` (если позже опубликована новая версия); условие `status === "published"` не выполняется → ошибка «уже выполняется», хотя операция завершена.
- **Ожидаемое:** replay completed operation должен возвращать исходный результат (published в историческом смысле) или 200 `replay:true`, не ошибку.
- **Воспроизведение:** publish V1 → publish V2 (V1 superseded) → повторить publish V1 с тем же operationId.
- **Последствия:** нарушение идемпотентности, ложные конфликты.
- **Связанные:** CM-A17.
- **Исправление:** journal replay result; хранить outcome; тест.
- **Владелец:** нет.

### CM-A17 — [POTENTIAL] — P2 — Recovery может отменить аудит, если версия успела стать superseded

- **Категория:** journal/recovery.
- **Файлы:** `composition-journal.ts:149–161, 195+`.
- **Фактическое:** `findPublishedVersion` ищет `status === published` и matching hash. Если процесс упал после публикации V1 до audit, затем V2 опубликована и V1 стала superseded, recovery не найдёт V1 и помечает aborted; audit для V1 так и не появится.
- **Ожидаемое:** recovery должен принимать `superseded` с совпадающим hash/publishedSeq или хранить снимок результата в journal.
- **Воспроизведение:** simulated crash + V2 publish before recovery.
- **Последствия:** опубликованная версия без audit; нарушение инварианта.
- **Связанные:** CM-A16, CM-A08.
- **Исправление:** journal outcome/status; тест.
- **Владелец:** нет.

### CM-A18 — [CONFIRMED] — P2 — UI/validate/publish работают с сохранённым draft, а не с несохранёнными изменениями

- **Категория:** UI/API.
- **Файлы:** `CompositionEditor.tsx:207–233` (validate), `235–251` (publish).
- **Фактическое:** validate/publish не отправляют `lines`; validate показывает состояние сохранённого draft; publish публикует сохранённый draft. Пользователь может увидеть успешную валидацию старых данных.
- **Ожидаемое:** dirty state; автосохранение или явная блокировка с сообщением.
- **Последствия:** ложная валидация, потеря правок (связано CM-A07).
- **Исправление:** dirty flag + auto-save/block; UI test.
- **Владелец:** нет.

### CM-A19 — [CONFIRMED] — P2 — PATCH принимает произвольный `rulesSnapshotId`

- **Категория:** API/валидация.
- **Файлы:** `composition.ts:234–239, 260–263`; `app/api/admin/compositions/[id]/route.ts` patchSchema.
- **Фактическое:** клиент может установить любое значение `rulesSnapshotId` в draft; существование/статус не проверяются; publish перезаписывает active snapshot или сохраняет arbitrary при отсутствии active.
- **Ожидаемое:** не принимать это поле из UI; либо валидировать snapshot и использовать только серверно.
- **Последствия:** ложные/неразрешимые ссылки на правила, нестабильный hash.
- **Связанные:** CM-A03.
- **Исправление:** удалить из PATCH или серверная валидация.
- **Владелец:** нет.

### CM-A20 — [POTENTIAL] — P2 — Preflight блокирует по optional/conditional строкам без оценки условия

- **Категория:** DataResolver/fail-closed.
- **Файлы:** `composition.ts:666–694`.
- **Фактическое:** preflight фильтрует только по `moduleType`, не по `condition/relation`; если у optional/conditional строки нет тарифа в конкретном PriceSnapshot, расчёт блокируется, даже если эта опция не выбрана.
- **Ожидаемое:** проверять только применимые строки (condition) или явно считать все тарифы обязательными.
- **Последствия:** избыточные блокировки новых пересчётов.
- **Связанные:** CM-A05, CM-A12.
- **Исправление:** condition evaluator (не формулы) или scope only required; тест.
- **Владелец:** **OWNER DECISION** (политика обязательности).

### CM-A21 — [CONFIRMED] — P2 — Transition/Delete/audit записи не crash-safe

- **Категория:** lifecycle/audit.
- **Файлы:** `composition-transition.ts:112–140`; `composition.ts:217–230, 304–321, 900+` (delete).
- **Фактическое:** create/update/delete и transition пишут данные, затем audit; при падении между шагами audit теряется. У transition rollback только в catch; у create/update/delete rollback нет. Publication journal есть только у publish.
- **Ожидаемое:** journal/recovery для мутаций, на которые опирается idempotency/audit; либо явно ограничить гарантию.
- **Последствия:** неаудированные изменения, невозможность replay.
- **Связанные:** CM-A08, CM-A17.
- **Исправление:** единый operation journal/recovery pattern.
- **Владелец:** нет (не NEW-N3; journal).

### CM-A22 — [CONFIRMED] — P2 — Deletion route expectedVersion проверяется вне сервиса

- **Категория:** конкурентность.
- **Файлы:** `app/api/admin/compositions/[id]/route.ts` DELETE; `composition.ts` delete.
- **Фактическое:** route читает current и проверяет `expectedVersion`, затем вызывает `deleteCompositionDraft(id)`, которая не принимает expectedVersion. Между проверкой и удалением возможен update; будет удалён более новый draft.
- **Ожидаемое:** expectedVersion внутри `updateCollection`.
- **Последствия:** потеря конкурентных изменений.
- **Связанные:** CM-A01.
- **Исправление:** pass expectedVersion into service, check inside lock; тест.
- **Владелец:** нет.

### CM-A23 — [CONFIRMED] — P2 — UI показывает недопустимые опции и не предупреждает о preliminary/draft правилах

- **Категория:** UI/API mismatch.
- **Файлы:** `CompositionEditor.tsx` price/rule selects; props `prices.status/usage` not rendered; rules status rendered but not filtered; `source` select.
- **Фактическое:** price select показывает archived/unused без статуса; rule select включает draft/preliminary; source select позволяет owner_confirmed. Server отклонит часть, но UI не объясняет до validate/publish.
- **Ожидаемое:** фильтры/бейджи, предупреждения; disable invalid options.
- **Последствия:** ошибки обнаруживаются поздно, ложное впечатление.
- **Связанные:** CM-A09, CM-A13, CM-A18.
- **Исправление:** option statuses, warnings.
- **Владелец:** нет.

### CM-A24 — [CONFIRMED] — P2 — Publish в UI без явного подтверждения

- **Категория:** UX/безопасность.
- **Файлы:** `CompositionEditor.tsx:235–251`.
- **Фактическое:** кнопка сразу отправляет `confirmed:true`; отдельного подтверждения/diff нет.
- **Ожидаемое:** confirm dialog с версией/diff, как в Rules publish.
- **Последствия:** случайная публикация.
- **Связанные:** CM-A07.
- **Исправление:** confirmation component.
- **Владелец:** нет.

### CM-A25 — [CONFIRMED] — P2 — Документация противоречит реализации

- **Категория:** документация.
- **Файлы:** `COMPONENT_DOMAIN_MODEL_PROPOSAL.md:3, 665–666` («Реализация не начата») vs §17 «фактическая реализация»; `CALCULATION_ADMIN_TECHNICAL_SPECIFICATION.md` §6.2 не содержит composition endpoints; нет runbook.
- **Фактическое:** документ одновременно утверждает, что реализация не начата, и описывает её; API-таблица не обновлена; runbook composition publication/recovery отсутствует.
- **Ожидаемое:** единый статус, API-таблица, runbook.
- **Последствия:** аудит/эксплуатация вводятся в заблуждение.
- **Связанные:** CM-A02, CM-A03.
- **Исправление:** docs package.
- **Владелец:** нет.

### CM-A26 — [OWNER DECISION] — P2 — Нет production gate/политики публикации composition

- **Категория:** безопасность/операции.
- **Файлы:** `composition.ts` publish; `rules-publication-config.ts` (composition не участвует); API publish.
- **Фактическое:** composition publish доступен с `price.publish` без отдельного production-флага; Rules publication имеет gate.
- **Ожидаемое:** решение, нужен ли gate; composition не влияет на цену, но является версионируемым admin-слоем.
- **Последствия:** production-публикация без отдельного операционного контроля.
- **Связанные:** CM-A21.
- **Исправление:** owner decision + gate if needed.
- **Владелец:** **OWNER DECISION**.

### CM-A27 — [CONFIRMED] — P2 — `getPublishedComposition` молча выбирает highest при нескольких published

- **Категория:** целостность.
- **Файлы:** `composition.ts:121–128`.
- **Фактическое:** при двух published возвращает highest `publishedSeq`; `getPublishedVersion` для цен в аналогичной ситуации выбрасывает ошибку.
- **Ожидаемое:** fail-closed при >1 published.
- **Последствия:** скрытая неоднозначность active composition.
- **Исправление:** throw + diagnostic; тест.
- **Владелец:** нет.

### CM-A28 — [CONFIRMED] — P2 — Composition UI/Inspector не показывает статус/валидность pin

- **Категория:** UI/диагностика.
- **Файлы:** `calculations/[projectId]/page.tsx`; `composition-board.ts`; `CompositionPinForm`.
- **Фактическое:** Inspector показывает только `compositionVersionId`; не показывает published/superseded/unknown/hash/error; `CompositionPinForm` не предупреждает о rules mismatch.
- **Ожидаемое:** статус версии, rulesSnapshotId, validation issues, причины блокировки.
- **Последствия:** администратор не понимает, почему recalc блокируется/какая версия используется.
- **Связанные:** CM-A03, CM-A25.
- **Исправление:** read-only project composition card.
- **Владелец:** нет.

### CM-A29 — [CONFIRMED] — P3 — `sortOrder` не валидируется

- **Файлы:** `composition-schema.ts:116`; UI.
- **Фактическое:** допускаются отрицательные/дублирующиеся значения; порядок стабилизируется по id, но семантика неясна.
- **Ожидаемое:** ≥0/уникальность или явное правило.
- **Последствия:** неоднозначный порядок/hash.
- **Владелец:** нет.

### CM-A30 — [CONFIRMED] — P3 — `sourceVersionId` допускает superseded источник

- **Файлы:** `composition.ts:165–170`.
- **Фактическое:** новый draft можно создать из published или superseded; требование говорит «из опубликованной».
- **Ожидаемое:** только published или явное разрешение.
- **Последствия:** неожиданная база для изменений.
- **Владелец:** нет.

### CM-A31 — [CONFIRMED] — P3 — Transition при том же target пишет audit old==new

- **Файлы:** `composition-transition.ts:98–127`.
- **Фактическое:** если pin уже target, всё равно audit event с одинаковыми значениями (при новом operationId).
- **Ожидаемое:** no-op без audit или idempotent response.
- **Последствия:** шум аудита.
- **Владелец:** нет.

### CM-A32 — [CONFIRMED] — P3 — Ограниченная история/composition list

- **Файлы:** `modules/[type]/page.tsx` (slice 8), versions page (slice 8), API list без пагинации.
- **Фактическое:** история/список обрезаны; нет diff draft↔published.
- **Ожидаемое:** pagination/diff или явное ограничение.
- **Последствия:** эксплуатационное неудобство.
- **Владелец:** нет.

### CM-A33 — [POTENTIAL] — P3 — Performance: многократное полное чтение коллекции

- **Файлы:** `composition.ts:86–144`; `composition-board.ts:48–115`; `data-resolver` preflight.
- **Фактическое:** каждый get/validate читает все версии; board читает несколько раз + validate дважды; страницы могут делать много чтений.
- **Ожидаемое:** кэш/один read на запрос или приемлемый лимит.
- **Последствия:** деградация при росте истории.
- **Владелец:** нет.

### CM-A34 — [CONFIRMED] — P3 — Нет валидации максимальных длин ID/notes/sourceRef

- **Файлы:** `composition-schema.ts`.
- **Фактическое:** nonEmpty без max; admin-only, но возможен большой payload.
- **Ожидаемое:** разумные max.
- **Последствия:** storage/DoS.
- **Владелец:** нет.

### CM-A35 — [CONFIRMED] — P3 — Audit denied mapping не различает composition actions

- **Файлы:** `src/lib/admin/api-auth.ts` (`deniedAction`).
- **Фактическое:** `catalog.write` → `catalog.update`, `price.publish` → `pricing.publish`; отказы composition выглядят как каталог/цена.
- **Ожидаемое:** отдельные audit actions/entity.
- **Последствия:** неоднозначный аудит.
- **Владелец:** нет.

---

## 5. Дефекты реализации (сводка)

Наиболее серьёзные:

1. **CM-A01** — порча коллекции через duplicate id (P0).
2. **CM-A02** — hash не проверяется (P1).
3. **CM-A03/A04** — rules snapshot/ссылки проверяются не по тому снимку (P1).
4. **CM-A05** — code refs без реестра (P1).
5. **CM-A06** — фиктивная связь component↔price (P1).
6. **CM-A07/A18** — UI публикует/валидирует несохранённые данные (P1/P2).
7. **CM-A08/A21** — конкурентные/аудиторские окна (P1/P2).

---

## 6. Архитектурные риски

| Риск | Оценка | Комментарий |
|---|---|---|
| Composition — новый источник истины для состава без отдельного ADR | HIGH | Версионируемый pin `compositionVersionId` не описан ADR-07; требуется решение владельца |
| Composition и RulesSnapshot — независимые версии без cross-check | HIGH | CM-A03; возможна несовместимая пара |
| Composition не входит в Engine | MEDIUM | by design, но UI должен явно говорить, что цена не меняется |
| Composition не пинит CatalogItem/PriceItem/PricingVersion | MEDIUM | CM-A11; воспроизводимость ограничена |
| Preliminary data в published composition | HIGH/OWNER | CM-A09 |
| `code` refs как строки без реестра | HIGH | CM-A05; provenance недостоверна |
| Publication/transition audit не crash-safe | MEDIUM | CM-A21/A08 |
| Нет production gate для composition | MEDIUM/OWNER | CM-A26 |
| Документация противоречит коду | MEDIUM | CM-A25 |

---

## 7. Недостающие проверки и тесты

Существующие тесты (`composition.test.ts` 13, `composition-data-resolver.test.ts` 3) покрывают: seed/idempotency, draft, expectedVersion, hash change, invalid refs, fixed/preliminary, duplicate semantic lines, preliminary rule, publish/immutable/seq/audit, new draft, delete, pin, old project, recovery, preflight.

**Не покрыто:**

- duplicate line **id** on PATCH/create;
- hash tamper/mismatch on read/publish/transition/preflight/recovery;
- composition snapshot A vs project rules B;
- rule archived after snapshot;
- unknown `quantityRef.code`/`condition.code`;
- componentId + unrelated priceItemId;
- `conditional` without condition;
- alternative group consistency;
- archived CatalogItem/PriceItem after publication;
- publish replay after supersede;
- recovery after supersede before audit;
- concurrent publish/transition/recalc;
- transition crash between project write and audit;
- DELETE expectedVersion race;
- UI publish without save (no component test);
- `componentCatalog` `promo`/`sinkSize`/slot semantics;
- seed skipped persisted;
- content hash canonicalization across order/undefined;
- multiple published composition;
- project with composition pin but rules missing/superseded/corrupt (Inspector display);
- production gate policy (if introduced).

**Тесты, которые нужно добавить в будущем:** перечислены в пакетах §11.

---

## 8. Проблемы обратной совместимости

| Сценарий | Фактическое поведение | Оценка |
|---|---|---|
| старый проект без composition/rules | открывается; расчёт может быть заблокирован отсутствием rules (существующее поведение) | OK |
| rules есть, composition нет | открывается; recalc использует rules; composition не участвует | OK |
| composition есть, rules нет | открывается; recalc блокируется `RULES_SNAPSHOT_MISSING` до composition | OK/EXPECTED |
| оба есть | открывается; recalc проходит rules + composition preflight; cross-check отсутствует | **RISK** CM-A03 |
| неизвестная composition | открывается; recalc блокируется `COMPOSITION_VERSION_UNKNOWN` | OK |
| повреждённая composition collection | чтение composition/board падает; project read не затронут; recalc pinned падает | **RISK** CM-A10 |
| superseded composition | pin отображается; recalc блокируется `COMPOSITION_NOT_PUBLISHED` | OK |
| исторический PriceSnapshot | `price`/`priceHistory` не мигрируют; open works | OK |
| несколько price versions | история читается; composition pin не связан с каждой версией | **RISK** CM-A11 |

**SchemaVersion/calcVersion:** не изменялись; `compositionVersionId` optional. Это соответствует требованию, но добавляет новый pin вне `ProjectPins`.

---

## 9. Расхождения UI/API/документации

| Область | Расхождение |
|---|---|
| UI publish | Publish без save (CM-A07); validate без save (CM-A18) |
| UI options | PriceItem archived/unused и draft/preliminary rules показываются как выбираемые без предупреждения (CM-A23) |
| UI source | synthetic `admin:composition-editor` (CM-A13) |
| UI confirmation | publish отправляет `confirmed:true` без диалога (CM-A24) |
| UI project | Inspector показывает только ID, не статус/hash/rules (CM-A28) |
| API PATCH | принимает arbitrary `rulesSnapshotId` (CM-A19) |
| API DELETE | expectedVersion вне lock (CM-A22) |
| Docs | «Реализация не начата» vs §17; API table/runbook отсутствуют (CM-A25) |
| Docs | contentHash заявлен как integrity, но не проверяется (CM-A02) |

---

## 10. Вопросы, требующие решения владельца

1. **Composition vs RulesSnapshot:** независимые оси или обязательная согласованность? (CM-A03)
2. **Preliminary CompositionLine:** можно ли публиковать с предупреждением или блокировать? (CM-A09)
3. **owner_confirmed:** какой документ/evidence обязателен; можно ли выбирать в UI? (CM-A13)
4. **Версии компонентов/тарифов:** нужен ли composition pin для CatalogItem/PriceItem/PricingVersion? (CM-A11)
5. **Production gate:** нужен ли отдельный флаг для composition publish? (CM-A26)
6. **Обязательность compositionVersionId** для новых расчётов: сейчас не блокируется. (CM-A20/политика)
7. **Role-aware price slots:** нужна ли модель `priceRole` для configurable-слотов? (CM-A15)
8. **Новый ADR:** требуется ли формальный ADR на CompositionVersion/`compositionVersionId` как новый версионируемый слой? (архитектурный риск)
9. **Обязательность условий:** должна ли conditional-строка без condition блокироваться? (CM-A12)
10. **История/диff:** нужен ли UI diff draft↔published и полная история? (CM-A32)

---

## 11. Групповой план исправлений

### A. Модель данных и связи

- **IDs:** CM-A01, CM-A06, CM-A11, CM-A12, CM-A15, CM-A29.
- **Файлы:** `composition-schema.ts`, `composition.ts`, `composition-seed.ts`, UI editor.
- **Объём:** валидация полной версии, unique IDs, relation/condition semantics, component↔price role, sortOrder, slot tariff roles; решить cat/price version pins.
- **Зависимости:** owner decisions по CM-A11/A15.
- **Риски:** schema changes require migration/versioning; avoid changing published data.
- **Acceptance:** all invalid compositions rejected before write; model tests.
- **Tests:** duplicate id, conditional, alternative, mismatch, slot, hash.

### B. RulesSnapshot и согласованность версий

- **IDs:** CM-A03, CM-A04, CM-A19, CM-A27.
- **Файлы:** `composition.ts`, `composition-transition.ts`, `data-resolver.ts`, `projects.ts`, `composition-journal.ts`.
- **Объём:** snapshot-aware rule resolution; composition↔project cross-check; multiple published fail-closed; no arbitrary `rulesSnapshotId`.
- **Зависимости:** owner decision CM-A03.
- **Acceptance:** cannot pin/recalc incompatible combo; archived rule still valid if in pinned snapshot; diagnostics clear.
- **Tests:** S1/S2 mismatch, archived, missing, corrupt, multiple published.

### C. Валидация состава, quantityRef и condition

- **IDs:** CM-A05, CM-A06, CM-A12, CM-A20, CM-A29, CM-A34.
- **Файлы:** schema/service/UI.
- **Объём:** code registry/whitelist; condition requirement; alternative consistency; preflight condition-aware; max lengths/sort order.
- **Acceptance:** unknown code rejected; conditional without condition rejected; optional missing tariff doesn't overblock (if approved).
- **Tests:** unknown code, condition, alternative, optional tariff.

### D. Источники данных и коммерческие тарифы

- **IDs:** CM-A06, CM-A11, CM-A13, CM-A15, CM-A23.
- **Файлы:** composition service/UI, catalog/price services.
- **Объём:** component-price role integrity; provenance evidence; price status display; catalog/price version pinning.
- **Acceptance:** no fictitious link; archived/unused shown; provenance not synthetic.
- **Tests:** mismatch, archived, sourceRef, version drift.

### E. Lifecycle, публикация, журнал и recovery

- **IDs:** CM-A02, CM-A16, CM-A17, CM-A21, CM-A22, CM-A24.
- **Файлы:** composition/journal/API/UI.
- **Объём:** hash verification; replay outcome; supersede-aware recovery; journal for mutations/transition; delete expectedVersion; publish confirmation.
- **Acceptance:** crash points recover; replay idempotent; no false completed; no unaudited mutation.
- **Tests:** crash at each phase, replay after supersede, hash tamper, concurrent delete.

### F. Привязка проектов и обратная совместимость

- **IDs:** CM-A08, CM-A21, CM-A28.
- **Файлы:** `projects.ts`, `composition-transition.ts`, Inspector.
- **Объём:** CAS on project updatedAt/compositionVersionId; transition journal; status display; no auto-repin.
- **Acceptance:** concurrent recalc/transition cannot overwrite; old projects unaffected; Audit + recovery.
- **Tests:** concurrent pin/recalc, worker event, crash, legacy.

### G. DataResolver и граница Engine

- **IDs:** CM-A03, CM-A20, CM-A28.
- **Файлы:** `data-resolver.ts`, `composition.ts`, types.
- **Объём:** snapshot-aware validation, condition-aware preflight, explicit trace status. Do not implement Engine B in this package.
- **Acceptance:** preflight checks only applicable lines; no false trace; no formula change.
- **Tests:** optional/conditional, rules mismatch, missing component.

### H. API, RBAC и UI

- **IDs:** CM-A07, CM-A18, CM-A19, CM-A22, CM-A23, CM-A24, CM-A28.
- **Файлы:** API routes, `CompositionEditor`, `CompositionPinForm`, pages.
- **Объём:** dirty state/save-before-publish, option statuses, remove arbitrary snapshotId, delete CAS, confirm dialog, project status card.
- **Acceptance:** UI cannot publish unsaved/forbidden; API errors field-level; server rules visible.
- **Tests:** UI component/integration, API status codes.

### I. Seed, тесты и документация

- **IDs:** CM-A14, CM-A25, CM-A32, CM-A35, plus test gaps.
- **Файлы:** seed, docs, backlog/progress, tests.
- **Объём:** persist migration report; fix contradictory status; API table/runbook; add missing tests; correct action mapping.
- **Acceptance:** seed report visible; docs match code; all listed tests added.
- **Tests:** seed skipped, docs check, API/RBAC.

**Совместная реализация:**

- A+B+C+D can be one domain/validation package if owner approves model decisions.
- E+F can be one lifecycle/project package, but F depends on CAS design.
- G is read-model/preflight only; can follow A+B.
- H can be parallel after API contracts fixed.
- I can be parallel.

**Требуют предварительного решения владельца:** CM-A03 (version axis), CM-A09/A13 (preliminary/owner proof), CM-A11/A15 (pinning/roles), CM-A26 (production gate), new ADR for composition layer.

---

## 12. Что уже соответствует требованиям и не требует изменений

- `calculatePrice`/Engine/формулы/Legacy Pricing/геометрия не изменены.
- `CalculationBreakdown`, `PriceSnapshot`, `PricingVersion` не изменены.
- ADR-07/RulesSnapshot lifecycle не изменены.
- Нет второй Component-коллекции и второго калькулятора.
- Published composition immutable на уровне сервиса/API; edit только через new draft.
- `expectedVersion`, `contentHash`, `publishedSeq`, audit и journal присутствуют.
- `StoredProject.compositionVersionId` optional; `schemaVersion` не повышен; старые проекты читаются.
- Pin — явная операция; нет автоматического перерасчёта/перепривязки.
- DataResolver fail-closed для unknown/draft composition.
- Seed детерминирован и идемпотентен; не публикует; не перезаписывает.
- Seed не создаёт новые CatalogItem kinds/фиктивные компоненты.
- UI не даёт редактировать published (нет такого действия).
- RBAC/CSRF/rate-limit на мутациях присутствуют.
- `NEW-N3` не использован; production gates/DB/seed не менялись.

---

## 13. Что намеренно не входит в текущий scope

- Полная component-level трассировка (`CalculationBreakdown`/`PriceBreakdown`/history).
- Composition → Engine quantities/prices.
- `usedPriceItems` population.
- Новые CatalogItem kinds для фурнитуры.
- Состав шкафа.
- NEW-N3.
- Production publication gate/cutover.
- Изменение ADR-07/Engine/Legacy/geometry.
- Новые производственные нормы/цены.

---

## Приложение A. Фактически выполненные проверки

| Проверка | Результат |
|---|---|
| targeted composition tests | 2 файла / 16 тестов **PASS** |
| полный `npx vitest run` | **118 файлов / 1223 теста PASS** |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** |

Тесты подтверждают happy-path, но не покрывают перечисленные в §7 отрицательные/конкурентные сценарии.

## Приложение B. Изученные файлы (35)

`composition.ts`, `composition-schema.ts`, `composition-journal.ts`, `composition-seed.ts`, `composition-transition.ts`, `composition-board.ts`, `composition.test.ts`, `composition-data-resolver.test.ts`, API routes `compositions/**` (5), `projects/[id]/composition-transition/route.ts`, `CompositionEditor.tsx`, `CompositionActions.tsx`, `CompositionPinForm.tsx`, `admin/modules/page.tsx`, `admin/modules/[type]/page.tsx`, `admin/calculations/[projectId]/page.tsx`, `admin/projects/page.tsx`, `admin/versions/page.tsx`, `admin/diagnostics/page.tsx`, `data-resolver.ts`, `projects.ts`, `contract.ts`, `types.ts`, `schema.ts`, `audit.ts`, `navigation.ts`, `COMPONENT_DOMAIN_MODEL_PROPOSAL.md`, `CALCULATION_ADMIN_TECHNICAL_SPECIFICATION.md`, `CALCULATION_ADMIN_CATALOG_MODEL.md`, `ADR-07`, `PROJECT_PROGRESS.md`, `PROJECT_BACKLOG.md`, `PROJECT_AUDIT.md`, `IMPLEMENTATION_PLAN.md`.
