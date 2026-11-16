# COMPOSITION → ENGINE INTEGRATION — DESIGN (READ → VERIFY → UPDATE → VERIFY)

- **Дата:** 2026-11-16 · **Версия:** rev.4 (замечания R-01–R-06, уточнение О-1–О-6 и критериев E1–E5)
- **Статус:** DESIGN — требует проверки и согласования владельцем. **Исходный код, API, Zod-схемы, TypeScript-типы, тесты, конфигурация и ADR-06/07/08 не изменялись** (на этом проходе изменён только настоящий документ).
- **Связанные:** `ADR-06-ENGINE-CONTRACT.md`, `ADR-07-MANAGED-ASSEMBLY-RULES.md`, `ADR-08-COMPOSITION-VERSIONING.md`, `COMPOSITION_MANAGEMENT_COMPREHENSIVE_AUDIT.md`, `COMPOSITION_MANAGEMENT_REMEDIATION_REPORT.md`, `COMPONENT_DOMAIN_MODEL_PROPOSAL.md` (§9, §11–§14)

**Маркеры статуса:**
`[РЕАЛИЗОВАНО]` — подтверждено исходным кодом · `[УТВЕРЖДЕНО]` — решение владельца (В-1…В-7, Q1–Q8) · `[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ]` — доказано точечным чтением кода на этом проходе · `[ПРЕДЛОЖЕНО]` — проект/техническая рекомендация, требует согласования · `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]` — не является технической рекомендацией · `[НЕ РЕАЛИЗОВАНО]` — функциональности нет · `[ОТКРЫТО]` — открытый вопрос (О-1…О-6).

**Архитектурные инварианты rev.4 (не изменяются, §23):** Engine — единственный источник totals; Composition — независимая трассировка; pin необязателен (В-1); legacy-поведение сохранено; целостность/совместимость — block; расхождения trace ↔ Engine — warning; trace хранится в истории и не пересчитывается; неисполняемое условие не превращается в unconditional; никаких нулевых подстановок; контракт Engine и purity-граница не меняются (вариант B).

---

## 1. Executive Summary

**[РЕАЛИЗОВАНО] CompositionVersion — отдельная сущность, реализованная полностью; данных в текущем окружении нет.** Агрегат: zod-схема (`composition-schema.ts:209–278`), сервис lifecycle (`composition.ts`), коллекция `composition-versions.json` (`composition.ts:52`) через Storage Adapter, hash/journals/recovery, API, UI, project pin. Записей нет: файла `data/composition-versions.json` не существует, строки `composition-versions.json` нет в `collection_state` SQLite (проверено read-only). Слой инертен до первой публикации.

**[ФАКТ] ADR-08 не откладывает внедрение и не создаёт новую модель — он описывает реализованное.** ADR-08 §7: «настоящий ADR **не вводит новую модель** версионирования. Он фиксирует **уже реализованный** агрегат `CompositionVersion`» (согласуется с Q7 remediation-отчёта: «новая модель версионирования не вводилась»).

**[ФАКТ] Composition подключена к расчёту только как preflight-гейт; трассировки нет.** `resolveCalculationInputs` (`data-resolver.ts:1360–1415`): загрузка записи по id → `status === "published"` → `contentHash` → пара `rulesSnapshotId` → покрытие модулей → тарифы required-строк в `PriceSnapshot` → Production Gate в production. **`quantityRef`/`condition` валидируются при публикации (`composition.ts:838–880`), но не исполняются — исполнителя не существует.** Engine composition не читает (purity-тест `engine-purity.test.ts:10–24` запрещает `@/lib/admin`/`@/lib/server`); `CalculationInputs` замкнут whitelist'ом (`contract.ts:890–901`).

**[УТВЕРЖДЕНО] Вариант B:** Engine — единственный источник итоговых количеств и стоимости; Composition формирует независимую компонентную трассу; на этом этапе Composition количества Engine не изменяет; вариант C — только отдельным ADR.

**[ИСПРАВЛЕНО В rev.3]** Ранее ошибочно полагалось, что `managed_rule` — источник количества, что drift-проверки идут в расчётном пути, что `compositionVersionId` принимается публичными API, и что для trace-этапа достаточно вызова внутри `resolveCalculationInputs`. Фактическое состояние — §6 (В-1…В-7) и §7 (A-01–A-10).

**[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ rev.4 — R-01…R-06, §22]:**
- **R-01:** числовые поля строк лежат **на верхнем уровне** элементов `CalculationBreakdown.lines[]` (вложенного `payload` в контракте **нет** — формулировка rev.3 исправлена); реестр числовых полей по строкам — `display-metadata.ts:68–121` (`FIELDS`); единицы измерения заданы **явно** в display-сегментах (`numberUnit`, «шт.», «м» и т.п., `admin/display-metadata.ts:373+`); **данных-связки «CompositionLine → CalculationLineId+поле» в модели нет** — таблица сопоставления проектируется и утверждается (О-1).
- **R-02:** Q7-03 — только структурный валидатор (`managed-rules.ts:273`, `contract.ts:736`); **executor'а нет**; boolean-семантика `managed_rule`/`code` не доказана → в E1 исполняется только `fixed`; условия fail-closed.
- **R-03:** `snapshot[]` хранит `{priceItemId, amount}` **без единицы**; единица тарификации — `PriceItem.unit` (enum `RUB|RUB_PER_SQM|RUB_PER_M|RUB_PER_LINM|RUB_PER_PCS|FACTOR`, `admin/schema.ts:142`), изменяема патчем; `quantity × amount` допустим **только** при подтверждённой совместимости единиц — иначе `price_unresolved`/ошибка несовместимости (§22.3).
- **R-04:** runtime-оценки альтернатив нет; применимость определяется условиями, которых исполнение отсутствует → любой вариант выбора, кроме контролируемого статуса, произволен.
- **R-05:** состав trace дополнен идентификаторами контекста (`priceVersion`, `baseSchema`, единица тарифа, pins) и разделён на «уже сохраняется / добавить в trace / необходимость не доказана» (§A-9).
- **R-06:** узкое правило В-7 сохранено; расширение на **все** публикации — отдельный вопрос О-3 `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]`.

---

## 2. Фактическая модель CompositionVersion (классификация и хранение)

### 2.1 Классификация понятий (не смешивать)

| Понятие | Фактическое положение |
|---|---|
| **Composition как управляемая сущность** | Агрегат `CompositionVersion` (zod `compositionVersionSchema`, `composition-schema.ts:209`) со встроенными строками `CompositionLine[]`. Строка — встроенная запись, не отдельная коллекция. |
| **Published Composition как состояние** | Тот же объект записи со `status: "published"` + `publishedAt/publishedBy/publishedSeq`, `pins`, `production`, пересчитанный `contentHash` (`composition.ts:1141–1186`). |
| **Composition version как идентифицируемая версия** | Три разных идентификатора: (а) `id` — стабильный id **записи** (новая редакция = новый id); (б) `version` — integer optimistic lock, +1 на правку draft (`composition.ts:567`); (в) `publishedSeq` — порядок среди published/superseded (`:1153`, `:1160`). Плюс `contentHash` = SHA-256 канонических `lines + rulesSnapshotId + pins` (`composition-hash.ts:12–28`). |
| **CompositionVersion как отдельная сущность/запись** | **Да.** Отдельная запись в отдельной коллекции `composition-versions.json`; новая редакция создается как draft из published с **новым id** (`createCompositionDraft`, `composition.ts:406–447`; `sourceVersionId` хранит ссылку). |
| **Project pin** | `StoredProject.compositionVersionId?: string` (`configurator/types.ts:425`) — строковая ссылка на `id` записи; **top-level, вне `ProjectPins`**, `schemaVersion` не повышается (ADR-08 §2.4). Дубль события — `ProjectPriceHistory.compositionVersionId` (`types.ts:402`). |

### 2.2 Где и как хранится

- Логическая коллекция: `COMPOSITION_COLLECTION = "composition-versions.json"` (`composition.ts:52`).
- Физика — Storage Adapter (ADR-01): `store.ts` → `storage/index.ts`; `json-file` вне production, `sqlite` в production (`collection_state(collection, payload)`).
- **Факт по окружению:** `data/composition-versions.json` — отсутствует; строки `composition-versions.json` в `data/formakub.db.collection_state` нет. **Записей — 0.**
- Чтение: `readCompositionStore` (`composition.ts:99–137`) — per-record schema-парсинг + сверка `contentHash`; повреждённая запись попадает в issues и не блокирует валидные.

### 2.3 Идентификатор и жизненный цикл `[РЕАЛИЗОВАНО]`

```
createCompositionDraft (composition.ts:406)   id = input.id | newDraftId() = "composition-YYYY.MM.DD-<uuid8>" (:186–188)
                                               seed: INITIAL_COMPOSITION_ID = "composition-2026.11.1" (composition-seed.ts:27)
                                               только один draft; draft — только из published (:415, :422)
updateCompositionDraft (:529)                 только draft; version+1 (:567); contentHash пересчитывается
publishCompositionVersion (:1076)             expectedVersion; правила из активного RulesSnapshot при rule-refs;
                                               buildPins(publishedPrice.id) (:1116); contentHash с pins;
                                               draft→published in-place (:1160); прежний published→superseded (:1178);
                                               publishedSeq+1 (:1153); production={status:"not_ready"}; journal + audit
approveCompositionProduction (:1233)          Production Gate (Q5)
confirmCompositionLine (:1326)                owner_confirmed только отдельной операцией (Q3)
transitionProjectComposition                  явный пин проекта: journal + CAS + audit, без пересчёта
```

**Историческое чтение — есть:** `listCompositionVersions()` (`:142`) возвращает все записи, включая superseded (удаление published/superseded запрещено); используется `/admin/versions`, `/admin/calculations/[projectId]`, `composition-board`, `GET /api/admin/compositions`.

### 2.4 Что фактически загружает DataResolver `[РЕАЛИЗОВАНО]`

`data-resolver.ts:1360–1415`: `requestedCompositionId = input.compositionVersionId ?? (recalculate ? project.compositionVersionId : undefined)` → `getCompositionVersion(id)` → требования: запись существует, `status === "published"` → `validateCompositionForConfig(version, config, priceSnapshot, rulesSnapshotId, {requireProductionApproval: NODE_ENV==="production"})` (`composition.ts:989–1068`): hash, published, отсутствие preliminary, kitchen-only, пара rules-snapshot, Production Gate, покрытие типов модулей, `priceItemId` required-строк ∈ snapshot. При успехе `compositionVersionId` возвращается как **метаданные** `ResolvedCalculation` (`:1438`); в `CalculationRequest`/`CalculationInputs` composition **не попадает**.

### 2.5 Соответствие ADR-08

| Пункт ADR-08 | Факт в коде | Оценка |
|---|---|---|
| §2.1 id/schemaVersion/version/contentHash | `composition-schema.ts:212–218`; hash = lines+rulesSnapshotId+pins | **соответствует** |
| §2.2 новая редакция = новый draft с новым id | `createCompositionDraft` + `sourceVersionId` | **соответствует** |
| §2.3 «публикация создаёт новый immutable published» | публикация **не создаёт новую запись**: draft тем же `id` становится published (`:1160`); новый id — на этапе draft | **формулировка неточна** (О-5); поведенчески эквивалентно: published далее не редактируется (`:538`) |
| §2.4 пин top-level optional | `configurator/types.ts:420–431` | **соответствует** |
| §2.5 commercial pins Q4 | `buildPins` (`:330–367`), входят в hash; `priceVersionId` **optional** (`composition-schema.ts:113`) | **соответствует**; обязательность — В-7/О-3 |
| §2.6 RulesSnapshot Q1 | publish берёт активный снимок при rule-refs; preflight/transition сверяют пару | **соответствует** |
| §2.7 supersede | in-place перевод прежнего published → superseded (`:1178`) | **соответствует** |
| §2.9 Production Gate Q5 | `production:{status:"not_ready"}` при publish; approve-операция; gate в `NODE_ENV=production` | **соответствует** |
| §2.10 обратная совместимость | optional-поля, `schemaVersion` не повышен | **соответствует** |

**Вывод:** отдельной «отложенной» модели нет — реализация есть и соответствует ADR-08, за исключением неточности формулировки §2.3 (О-5). Данных в коллекции нет. **Код ради документации не меняется.**

---

## 3. Фактическая архитектура текущего Engine `[РЕАЛИЗОВАНО]`

| Слой | Файл | Роль |
|---|---|---|
| Контракт | `configurator/contract.ts` | `CalculationRequest`/`CalculationInputs`/`CalculationBreakdown`; fail-closed; whitelist ключей `inputs` (`:890–901`) |
| Engine | `configurator/engine.ts` | `calculateBreakdown` (`:1021`) → kitchen (`:689`) / wardrobe (`:931`) |
| Legacy Pricing | `configurator/pricing.ts` | `calculatePrice` — только тесты |
| Display Adapter | `display-adapter.ts:131` | `CalculationBreakdown + DisplayMetadata → PriceBreakdown`; не считает |
| DataResolver | `server/data-resolver.ts:1068` | сборка входов + composition preflight |
| Сервис проектов | `server/projects.ts` | `calculatePriceFromInputs` (`:89`), `saveProject` (`:283`), `recalculateProject` (`:432`) |

**Нормы и правила:** формулы — код + facade/sink/supports/lighting/wardrobe-модули; нормы шкафа 1.1/1.2 — `inputs.rulesSnapshot` (`engine.ts:953–957`, fail-closed; **для кухни Engine правил не читает**); параметры опор/подсветки/мойки — `inputs.parameters`; коммерческие правила — `priceSnapshot.rules` (ADR-06 §5.7); `MODULE_COMPOSITION` — read-model для seed, в расчёте не участвует; `CompositionVersion` — preflight only.

**Версии/пины `[РЕАЛИЗОВАНО]`:** `StoredProject` (`configurator/types.ts:408`): `schemaVersion?`, `calcVersion?`, `priceVersion?`, `rulesSnapshotId?`, `compositionVersionId?` (`:425`), `pins?` (`ProjectPins` = catalogVersions + presetVersions), `priceHistory?`. `CompositionVersion.pins` (Q4): `catalogVersions`, `priceItemVersions` (= `PriceItem.updatedAt`), `priceVersionId` — все optional (`composition-schema.ts:111–115`).

---

## 4. Текущий поток расчётов `[РЕАЛИЗОВАНО]`

```
[1] UI → localStorage draft
[2] validateConfig
[3] POST /api/calculation-inputs {operation, config|projectId}
      схема: z.discriminatedUnion — create/preview принимают ТОЛЬКО config
             (route.ts:21–36); compositionVersionId НЕ принимается (A-02)
[4] DataResolver (data-resolver.ts:1068):
      legacy-facade guard → checkCalcVersions → parameters
      → resolvePriceVersion (create/preview = published; recalculate = target ≥ current)
      → buildSnapshot → PriceSnapshot{priceVersion: PricingVersion.id, snapshot, rules, ...}
      → RulesSnapshot (recalculate = project.rulesSnapshotId; иначе активный; fail-closed)
      → catalogs/presets по pins
      → composition preflight :1360–1415 → метаданные compositionVersionId (:1438)
[5] calculatePriceFromInputs (projects.ts:89) → calculateBreakdown (engine.ts:1021)
[6] toPriceBreakdown (display-adapter.ts:131)
[7] Сохранение:
      create  saveProject (projects.ts:283) → createHistoryEvent (:247) → StoredProject{price, priceVersion,
               calcVersion, pins, rulesSnapshotId, compositionVersionId?, priceHistory[0]}
      recalc  recalculateProject (:432) → CAS: STALE_SOURCE_PRICE_VERSION (:558),
               COMPOSITION_PIN_CHANGED (:569), PROJECT_CALC_VERSION_MISMATCH (:581)
```

**Вызывающие `[ФАКТ, A-02]`:**

| Вызывающий | Передаёт compositionVersionId? |
|---|---|
| `POST /api/calculation-inputs` create/preview | **нет** — schema `strictObject{config}` (`route.ts:21–29`) |
| `POST /api/calculation-inputs` recalculate | **пин проекта** (`data-resolver.ts:1362`) |
| `POST /api/projects` (public save) | **нет** — `projectPayloadSchema = strictObject{config}` (`schema.ts:297`); route вызывает `saveProject({config, operationId})` (`route.ts:101`) |
| `saveProject` (внутренне) | поле `input.compositionVersionId?` **существует** (`projects.ts:287`), пробрасывается в resolver (`:333–338`), в fingerprint (`:314`) и в StoredProject — но **ни один route его не передаёт** |
| `recalculateProject` (public/admin) | **пин проекта**; CAS `COMPOSITION_PIN_CHANGED` |
| `POST /api/admin/projects/[id]/composition-transition` | **да** (`route.ts:56`) — но без пересчёта |
| `leads.ts:54` | **нет** (operation "create" без composition) |

**Данные:** `data/projects.json` — 200 проектов: `rulesSnapshotId`=0, `compositionVersionId`=0, `priceVersion`=200, `priceHistory`=169 → **все legacy**: новый расчёт заблокирован `RULES_SNAPSHOT_MISSING` (ADR-07 Q7-11); pin состава отсутствует у всех.

---

## 5. Точки интеграции Composition (обновлено по A-02)

| # | Точка | Статус |
|---|---|---|
| T1 | Выбор версии в resolver | `[РЕАЛИЗОВАНО]` `input.compositionVersionId ?? project.compositionVersionId` (`data-resolver.ts:1361`) |
| T2 | Published + hash + coverage | `[РЕАЛИЗОВАНО]` `:1366–1384`, `composition.ts:989–1068` |
| T3 | Пара RulesSnapshot | `[РЕАЛИЗОВАНО]` `composition.ts:1029`; `composition-transition.ts:98,142` |
| T4 | Production Gate | `[РЕАЛИЗОВАНО]` `data-resolver.ts:1391` |
| T5 | Тарифы required-строк | `[РЕАЛИЗОВАНО]` `composition.ts:1053–1066` |
| T6 | **Исполнение `quantityRef`** | `[НЕ РЕАЛИЗОВАНО]` — потребителя нет |
| T7 | **Исполнение `condition`** | `[НЕ РЕАЛИЗОВАНО]` — нет ни executor'а, ни обработки `kind:"text"` (grep: `kind === "text"` в `src/` отсутствует вне схемы) |
| T8 | CompositionLine → CatalogItem/PriceItem в расчёте | `[НЕ РЕАЛИЗОВАНО]` |
| T9 | Компонентная трасса | `[НЕ РЕАЛИЗОВАНО]` — `CalculationBreakdown` не расширен; `usedPriceItems` не заполняется (`contract.ts:319`) |
| T10 | Pin перехода | `[РЕАЛИЗОВАНО]` `composition-transition.ts:40` — без пересчёта |
| T11 | **Передача id в публичных API** | `[НЕ РЕАЛИЗОВАНО]` — см. §7 (A-02); требуется минимальное designed-изменение схем маршрутов |
| T12 | Drift-предупреждения в расчёте | `[НЕ РЕАЛИЗОВАНО]` — drift-warnings есть только в admin-валидации (A-06) |

---

## 6. Решения владельца В-1…В-7 `[УТВЕРЖДЕНО]`

### В-1. Composition pin — переходный режим
- Composition pin **пока необязателен** для новых расчётов; старые проекты работают по legacy-поведению.
- **Если pin присутствует — целостность и совместимость проверяются обязательно** (реализовано в preflight; расширения не требуется).

### В-2. Архитектура — вариант B подтверждён
- Engine — **единственный** источник итоговых количеств и стоимости.
- Composition формирует **независимую** компонентную трассу.
- На этом этапе Composition **не изменяет** количества Engine; вариант C — только отдельным ADR.

### В-3. quantityRef — только явный whitelist
- Допустимо только **явное whitelist-сопоставление с результатами Engine** (`CalculationLineId` + числовое поле строки из §13.1) и значение `fixed`.
- Никакого динамического выполнения выражений, никаких произвольных формул.
- Неизвестный/неподдерживаемый reference → **`quantity_unresolved`**; **ноль не подставляется**.

### В-4. Evaluator условий — изолированный
- Сначала проверена фактическая реализация ADR-07 Q7-03 (§6.1).
- Переиспользовать существующий механизм, если он реализован и подходит; параллельный evaluator без доказанной необходимости не создаётся.
- Неизвестные и некорректные условия **не исполняются** (fail-closed).

### В-5. Расхождения и история
- Расхождения trace ↔ Engine → **warning**; нарушения целостности, несовместимые pins, повреждённые данные → **блокировка**.
- Trace **сохраняется в истории расчёта** для воспроизведения и аудита.

### В-6. Текстовые conditions
- Свободный текст (`condition.kind === "text"`) **не исполняется**; допускаются только зарегистрированные структурированные коды условий.

### В-7. priceVersionId обязателен
- Для **новых опубликованных** Composition, используемых в компонентной трассировке, `pins.priceVersionId` обязателен.
- Совместимость с существующими PriceItem version pins проверена (§6.2); **дублирующая система версионирования не создаётся**.

### 6.1 Проверка по В-4: фактическая реализация ADR-07 Q7-03 `[ФАКТ]`
- Whitelist операторов и лимиты **реализованы как валидация структуры**: `RULE_CONDITION_OPERATORS` (`equals/notEquals/in/greaterThan/lessThan/all/any`), `RULE_CONDITION_MAX_DEPTH = 2`, `RULE_CONDITION_MAX_PREDICATES = 8` (`managed-rules.ts:65–86`); `validateRuleCondition` (`:273`), вызывается из admin-валидации и `rules-diagnostics.ts:175`.
- **Исполнителя не существует**: нет функции `RuleConditionNode → boolean` в `src/` (Engine условий правил не исполняет — читает только нормы 1.1/1.2 шкафа).
- **Вывод:** существующий механизм переиспользуется как **структурный гейт**; необходимость изолированного исполнителя доказана его отсутствием — он создаётся на этапе реализации, fail-closed, без обхода Q7-03.

### 6.2 Проверка по В-7: совместимость с PriceItem version pins `[ФАКТ]`
- `buildPins` (`composition.ts:330–367`) фиксирует `catalogVersions` (версия CatalogItem), `priceItemVersions` (`PriceItem.updatedAt` — у PriceItem отдельной версии нет, ADR-08 §2.5), `priceVersionId` — из `getPublishedVersion()?.id`, **включается только если опубликованная PricingVersion существует** (`:365`, поле optional в схеме).
- В-7 **не создаёт новой версии**: это обязательность уже существующего поля, ссылки на существующий `PricingVersion`.
- **Gap:** сейчас публикация возможна без `priceVersionId` (нет published PricingVersion → поле не записывается). Закрытие — на этапе реализации (E5), ошибка публикации без авто-подстановки; точка исполнения — **О-3**.

---

## 7. Исправления по замечаниям A-01–A-10

### A-01. Разделение preflight и trace resolver `[ПРЕДЛОЖЕНО]`

**Факт:** сейчас preflight — инлайновый блок внутри `resolveCalculationInputs` (`data-resolver.ts:1360–1415`); trace не существует; Engine вызывается уже **после** resolver (`calculatePriceFromInputs`, `projects.ts:89`; маршрут `calculation-inputs` — после `resolution.ok`). Вызывать внутри `resolveCalculationInputs` resolver, которому нужен `engineBreakdown`, **нельзя** — breakdown там ещё не существует.

**Целевая последовательность `[ПРЕДЛОЖЕНО]`:**
1. **`resolveCompositionPreflight(...)`** — концептуальная операция внутри DataResolver: загрузка/проверка Composition, pins, совместимости. Ничего не вычисляет по результатам Engine.
2. **Engine** — расчёт без изменений.
3. **`resolveCompositionTrace(config, preflightHandoff, rulesSnapshot, priceSnapshot, engineBreakdown)`** — отдельный модуль; вызывается **после Engine**, там, где пишется событие истории (`saveProject`/`recalculateProject`).
4. **Project Service** — сохраняет расчёт и trace **в одном событии** `ProjectPriceHistory` (`createHistoryEvent`, `projects.ts:247` — уже содержит `compositionVersionId` и `breakdown`).

**Что preflight передаёт следующему этапу и как:** additive-поле серверного типа `ResolvedCalculation.compositionPreflight?: { versionId, contentHash, rulesSnapshotId, pins, productionStatus }` (`data-resolver.ts:1438` — рядом с уже передаваемым `compositionVersionId`). Передача — типизированным полем в том же процессе (не через API, не через `CalculationInputs`). Проектируемый интерфейс, в коде не создаётся.

**Не вызывать trace-resolver из `/api/calculation-inputs` без записи истории:** маршрут только считает и возвращает PriceBreakdown; trace обязателен там, где есть событие истории (create/save/recalculate). Preview без сохранения — trace не строится `[ПРЕДЛОЖЕНО]`.

### A-02. Путь передачи compositionVersionId `[ФАКТ → ПРЕДЛОЖЕНО]`

См. таблицу в §4. Выводы:

| Сценарий | Факт | Что требуется (designed) |
|---|---|---|
| **create/preview** через `/api/calculation-inputs` | schema не принимает id; route передаёт только `operation+config` | `[ПРЕДЛОЖЕНО]` optional `compositionVersionId` в ветки create/preview `calculationInputsRequestSchema` + pass-through в `resolveCalculationInputs` |
| **save** через `/api/projects` | `projectPayloadSchema = {config}`; `saveProject` поле уже имеет, но route его не передаёт | `[ПРЕДЛОЖЕНО]` optional `compositionVersionId` в `projectPayloadSchema` + pass-through в `saveProject` |
| **recalculate** | пин берётся из проекта; CAS `COMPOSITION_PIN_CHANGED` | не требуется |
| **admin transition** | передаётся явно, без пересчёта | не требуется |
| **leads** | расчёт без composition | не требуется (лид — не проект) |

**Не предполагать, что id доступен в каждом сценарии:** фактически ни один публичный маршрут id не передаёт — композиция сейчас достижима только через admin-transition (пин уже сохранённого проекта). Оба designed-изменения — **additive, optional, без изменения существующего поведения**; требуют отдельного согласования (этап E2, §17).

### A-03. Семантика priceVersionId `[ФАКТ]`

| Поле | Определение | ID-пространство |
|---|---|---|
| `CompositionVersion.pins.priceVersionId` | PricingVersion, **против которой состав проверялся при публикации** (`buildPins`, `composition.ts:1116`) | `PricingVersion.id` |
| `PriceSnapshot.priceVersion` | версия, **фактически использованная Engine** в этом расчёте (`buildSnapshot`, `data-resolver.ts:1015`) | `PricingVersion.id` |
| `StoredProject.priceVersion` | версия последнего сохранённого расчёта проекта | `PricingVersion.id` |
| `ProjectPriceHistory.toPriceVersionId` / `fromPriceVersionId` | границы события пересчёта (`createHistoryEvent`) | `PricingVersion.id` |

**Вывод:** все четыре поля — **одно ID-пространство `PricingVersion.id`** (это подтверждено кодом), но **семантически самостоятельные**: равны только если composition публиковалась против той же версии прайса, что использовалась в расчёте. **Не взаимозаменяемы.** Расхождение «закреплённая в Composition ↔ фактически использованная Engine» — drift-диагностика (warning, В-5); расхождение «использованная ↔ сохранённая в проекте» — норма для истории (каждое событие хранит свою пару). Дополнительного открытого вопроса не требуется — различие зафиксировано в §12 и §8.7.

### A-04. managed_rule как источник количества `[ФАКТ] → исключён из утверждённых источников`

**Факты:**
- `ManagedRule` хранит `value` (`ruleValueSchema`: string | number | boolean | string[]), `valueType` (`int|decimal|boolean|enum|stringList`), `unit?` (`RULE_UNITS = RUB, RUB_PER_SQM, RUB_PER_M, RUB_PER_LINM, RUB_PER_PCS, FACTOR`) — `managed-rules.ts:53–60, 143–160`.
- Адресация: `quantityRef.kind === "managed_rule"` → `ruleId` → поиск в **закреплённом** RulesSnapshot (`checkRuleReference`, `composition.ts:275–300`: снимок обязателен, правило должно входить в снимок).
- **Но:** `assigns` правила — только `catalog:… | priceItem:… | line:<CalculationLineId>` (regex `managed-rules.ts:133–137`); единицы — денежные/факторные (штучные/метровых норм среди них нет); типовая проверка `valueType` на числовую норму при публикации **не выполняется**; Engine читает из снимка **только wardrobe-нормы 1.1/1.2** (`engine.ts:953–957`), для кухни (область composition) — никаких quantity-норм в снимке фактически не используется.

**Вывод:** наличие `valueType`/`RuleConditionNode` **недостаточно** для утверждения `managed_rule` как источника количества. Согласно условию A-04: **исключить из утверждённых источников количества** (§8.3: только `fixed` и подтверждённые whitelist-пары §13.1); оставить как **потенциальное расширение** с отдельным обоснованием и решением владельца (не создавая новых форматов данных). Ограничение В-3 при этом сохраняется.

### A-05. Поведение text и неизвестных conditions `[УТВЕРЖДЕНО, fail-closed]`

Фактическая модель строки: `relation ∈ required|conditional|optional|alternative` (`composition-schema.ts:26–31`); `condition?` обязателен только для `relation === "conditional"` (`:175`); `condition.kind ∈ text|code|managed_rule` (`:86–105`); `text` документирован как «расчётом не исполняется» (`:89`); **обработки `kind:"text"` в коде нет** (grep — 0).

| Ситуация | Поведение | Основание |
|---|---|---|
| `optional` + text condition | **warning**, строка не применяется (`excluded`) | В-5, В-6 |
| `required` + text condition | **block** | строка обязательна, условие неисполнимо; молчаливое включение запрещено |
| `conditional` + text condition | **block** — условие load-bearing, неизвестно ⇒ не включать и не исключать молча | fail-closed |
| зарегистрированный `code` condition | исполняется, **если** для id определена семантика предиката; сегодня таковой **нет** (О-2) → до её появления treat as неисполнимое: `required/conditional` → block, `optional` → warning+excluded | В-6, факт реестра |
| неизвестный `code` | **block** для required/conditional, warning+excluded для optional; публикация уже блокирует неизвестный code (Q8, `composition.ts:844–880`) | В-6 |
| `managed_rule` condition | предикат из закреплённого снимка, структура пройти `validateRuleCondition` (Q7-03); **не прошёл/правила нет → не исполняется → block** для required/conditional, warning+excluded для optional | В-4, fail-closed |
| условие true | дальнейшее разрешение количества и цены | — |
| условие false | `excluded` (нормально) | — |
| ошибка исполнения (исключение) | **block** для required/conditional, warning+excluded для optional; в trace — `condition_error` | В-5 |
| повреждённая структура условия | **block** (нарушение целостности) | В-5 |

**Совместимость с моделью и Q8:** таблица не противоречит `compositionLineSchema` (text допустим схемой, только `conditional` требует condition) и Q8 (неизвестный code — публикационная ошибка). `[НЕ РЕАЛИЗОВАНО]` — executor создаётся на этапе E1.

**[УТВЕРЖДЕНО, инвариант rev.4]** Ни одна неисполняемая ситуация **не превращается в unconditional**: `optional`-строка с неисполняемым условием → статус `excluded` + warning (не «применяется всегда»); `required`/`conditional`-строка с неисполняемым условием → block трассировки этой строки (для обязательной строки — block расчёта с pin). Условие, которое нельзя оценить, никогда не считается `true`.

### A-06. Три вида проверки pins `[ФАКТ + ПРЕДЛОЖЕНО]`

| Вид | Что проверяется | Фактическая реализация | Действие |
|---|---|---|---|
| **1. Историческая целостность** | сохранённые pins ↔ `contentHash`; неизменность опубликованной записи | `compositionContentHash(...) !== version.contentHash` → `COMPOSITION_HASH_MISMATCH` (`composition.ts:999`); per-record schema в `readCompositionStore`; `status==="published"`; отсутствие preliminary | **block** `[РЕАЛИЗОВАНО]` |
| **2. Совместимость** | применимость к данному расчёту: пара composition↔RulesSnapshot, kitchen-only, покрытие модулей, наличие `priceItemId` в PriceSnapshot, Production Gate в production | `validateCompositionForConfig` (`:1013–1066`) — только **errors**; в DataResolver любой issue блокирует (`data-resolver.ts:1411`) | **block** `[РЕАЛИЗОВАНО]` |
| **3. Текущий drift** | отличие текущих каталогов/тарифов/прайса от исторических pins | `COMPOSITION_PRICE_VERSION_DRIFT`, `COMPOSITION_PRICE_SNAPSHOT_DRIFT`, `COMPOSITION_CATALOG_VERSION_DRIFT` — **warnings** внутри `validateCompositionVersion` (`:935–973`), используемого только admin-слоем (validate/board/publish) | **warning** `[РЕАЛИЗОВАНО в admin]`; **в расчётном пути НЕ реализовано** `[ПРЕДЛОЖЕНО]` для E2 |

**Вывод:** модель уже разделяет блокировки и предупреждения. Изменение текущего прайса **не является** повреждением исторической Composition — это drift-warning. Два фактических ограничения: (а) preflight-функция возвращает только errors, а `data-resolver.ts:1411` трактует **любой** элемент как блокирующий — при добавлении warnings в расчётный путь цепочку придётся разделить `[ПРЕДЛОЖЕНО]`; (б) drift-сравнение в расчётном пути отсутствует. **Не противоречит** реализованному preflight: порядок/семантика блокирующих проверок не меняются.

### A-07. Реальный whitelist Engine outputs `[ФАКТ]` — таблица в §13

Источник: `CalculationBreakdown.lines: CalculationLine[]` (`contract.ts:258–298`) — дискриминированный union, каждая строка имеет `id` + `amount` + числовые поля **верхнего уровня самой строки** (вложенного объекта `payload` в контракте **нет** — исправление rev.4, R-01); реестр числовых полей по строкам — `FIELDS` (`admin/display-metadata.ts:68–121`, валидируется `validateSegments`); места формирования значений — `engine.ts:856–912` (кухня) и `:1000–1003` (шкаф); единицы — только из явных display-определений (`admin/display-metadata.ts:373+`). Значения в whitelist — **только подтверждённые пары §13**; wardrobe-строки не входят (composition kitchen-only, `composition.ts:1016`).

### A-08. Семантика alternativeGroup `[ФАКТ → ПРЕДЛОЖЕНО]`

**Факт:** `alternativeGroup` обязателен для `relation === "alternative"` (`composition-schema.ts:168`); группы ключуются `moduleType|group` и на валидации требуют **≥2 строк** (`composition.ts:712, 912–921`); дубликаты строк ловятся по content-key (`:899–910`). **Исполнения групп нет** (runtime-выбор альтернативы не реализован).

**[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ R-04]** точечным grep: `alternativeGroup` встречается только в схеме и валидации (`composition-schema.ts:144,168`; `composition.ts:85,712,895–921`) — кода выбора/оценки применимости **нет**. Применимость альтернативы может устанавливаться **только** условием (§A-05), а executor условий отсутствует (R-02) → сегодня ни одно основание выбора не доказано. «Первый вариант не выбирается», «альтернативы не суммируются»; до подтверждённой семантики условий группа получает **контролируемый статус** (`unresolved`), а не произвольный выбор.

| Ситуация | Предлагаемое поведение `[ПРЕДЛОЖЕНО]` | Владелец |
|---|---|---|
| все альтернативы имеют false-condition | группа → `excluded`, **warning** (строки состава не участвуют, модуль покрыт через другие строки — иначе block по покрытию) | нет |
| ни одна альтернатива не поддерживается Engine (нет подтверждённой whitelist-пары §13) | группа → `unresolved` (`quantity_unresolved`); для required-связанных строк — block, иначе warning | нет |
| условие не удалось вычислить (executor отсутствует / fail-closed) | **block** для обязательного применения группы; иначе warning + группа `excluded` | **[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]** |
| группа содержит повреждённые данные (hash/schema) | **block** — целостность | нет (инвариант 5) |
| одновременно применимо несколько альтернатив | **block** (неоднозначность) — **правило «блокировать неоднозначную группу» не утверждено** | **[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]** |

Существующая модель данных не меняется.

### A-09. Воспроизводимость CompositionTrace `[ФАКТ → ПРЕДЛОЖЕНО]`

**Факт — что уже есть в `ProjectPriceHistory` (`configurator/types.ts:387–406`):**
`id, projectId, operationId, reason, fromPriceVersionId, toPriceVersionId, schemaVersion, calcVersion, oldPrice, newPrice, delta, breakdown (полный PriceBreakdown), breakdownVersion, compositionVersionId?, requestFingerprint(+Version), computedAt`.

То есть **воспроизведение итогов и версий уже обеспечено** (`projectFromHistoryEvent`, `projects.ts:171` восстанавливает `price`, `priceVersion`, `compositionVersionId` из события). Retention: «хранить всё» до решения Q13 (`CALCULATION_ADMIN_DATA_AND_VERSIONING_DESIGN.md:494`); обрезка — только решением владельца.

**Минимально достаточная модель trace `[ПРЕДЛОЖЕНО]`** — additive optional `compositionTrace?` **внутри события** `ProjectPriceHistory` (не в `StoredProject.price`, не в `CalculationBreakdown`):

```ts
compositionTrace?: {
  compositionVersionId: string;
  compositionContentHash: string;        // идентичность состояния состава
  rulesSnapshotId: string | null;        // закреплённый снимок правил
  enginePriceVersionId: string;          // (2) PricingVersion, использованная Engine (PriceSnapshot.priceVersion)
  enginePriceBaseSchema: number;         // версия структуры снимка (PriceSnapshot.baseSchema)
  pinnedPriceVersionId: string | null;   // (1) PricingVersion, закреплённая в Composition (В-7)
  catalogVersions?: …; priceItemVersions?: …;  // pins состава (Q4) — для drift-диагностики
  lines: [{ lineId, moduleType,
            condition: "true"|"false"|"not_evaluated"|"error",   // результат разрешения conditions
            quantity: number | null, unit, quantitySource,       // null ⇔ quantity_unresolved (В-3)
            priceItemId?: string, amount: number | null,         // snapshot amount (сырой)
            priceItemUnit?: string | null,                       // PriceItem.unit на момент расчёта (R-03)
            priceAmount?: number | null,                         // quantity × amount ТОЛЬКО при совместимых единицах
            status }],
  warnings: [{code, message}],           // drift/расхождения (В-5)
  traceVersion: 1;
}
```

**[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ R-05] разделение данных по происхождению:**

| Группа | Данные | Статус |
|---|---|---|
| **Уже сохраняются существующей моделью** (событие `ProjectPriceHistory`, `types.ts:387–406`) | `compositionVersionId`, `toPriceVersionId`/`fromPriceVersionId`, `calcVersion`, `schemaVersion`, полный `breakdown` (PriceBreakdown), `requestFingerprint(+Version)`, `computedAt`, `projectId`/`operationId`/`reason`; из `StoredProject` — `pins`, `rulesSnapshotId` | `[РЕАЛИЗОВАНО]` |
| **Должно сохраняться непосредственно в `compositionTrace`** | `compositionContentHash`; `rulesSnapshotId` события; `enginePriceVersionId` + `enginePriceBaseSchema`; `pinnedPriceVersionId`; pins состава; построчно: условие и результат его оценки, `quantity`+`unit`+`quantitySource`, `priceItemId`, сырой `amount`, `priceItemUnit` (иначе единица тарифа невосстановима — `PriceItem` изменяем, R-03), итоговая цена компонента, `status`; `warnings`/ошибки | `[ПРЕДЛОЖЕНО]`, E4 |
| **Необходимость не доказана — не включать** | дубль всего `CalculationBreakdown`; снимки catalogs/presets целиком; глобальный `StoredProject` внутри события; физическая схема БД (вне этого документационного этапа) | `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]` при попытке включения |

**Главное требование выполняется по построению:** при открытии исторического проекта trace **читается из события** и **никогда не пересчитывается по текущим данным** (как и `breakdown` — уже лежит в событии); **актуальные снимки и `StoredProject` не служат заменой историческому trace**. События без trace → `trace_unavailable` (ретро-восстановление запрещено).

**Отдельно:** единица измерения количества (`unit` из `COMPOSITION_UNITS`) и единица тарифа (`PriceItem.unit`) — **разные энумы**; их сопоставление — таблица §22.3. Физическая схема хранения trace на этом этапе **не проектируется**.

**Измерение объёма — О-4** (реальных Composition нет; синтетических измерений не выдаём).

### A-10. Граница E4 и E5 `[ФАКТ]`

- **E4** = сохранение trace в истории + чтение + воспроизводимость (§17, §A-09).
- **E5** = обязательность `pins.priceVersionId` при публикации Composition, **предназначенной для трассировки** (В-7).
- **Факт:** признака «назначение Composition» в модели **нет** — есть только `status`, `production.status`, `pins`, `notes`; «предназначена для трассировки» ничем не выражается. **Признак не вводим самостоятельно** — варианты на решение владельца (О-3): (а) общее правило для всех новых публикаций (без признака), (б) ввести признак назначения (изменение модели — отдельное решение), (г) отложить. В-7 **не распространяется** шире утверждённого смысла.

---

## 7.1 Сравнение вариантов и подтверждённый выбор

| Критерий | A (оставить) | **B (В-2)** | C |
|---|---|---|---|
| Количества/цены/трасса по composition | нет | трасса + сверка; **totals от Engine** | да |
| Изменение Engine/`CalculationBreakdown`/контракта | нет | **нет** | да — запрещено |
| Риск для существующих расчётов | 0 | **0** | высокий |
| Обратная совместимость | полная | **полная** | миграция/`calcVersion` |

**[УТВЕРЖДЕНО] Вариант B.** Вариант C — только отдельным архитектурным решением.

---

## 8. Целевая архитектура (вариант B, rev.4) `[ПРЕДЛОЖЕНО]`

### 8.1 Две операции (A-01)

```
resolveCompositionPreflight(...)   — внутри data-resolver (рефакторинг инлайн-блока :1360–1415);
                                     входы: config, compositionVersionId, rulesSnapshotId, priceSnapshot;
                                     выход: { issues (block), handoff: compositionPreflight? }
resolveCompositionTrace(...)       — новый модуль src/lib/server/composition-resolver.ts;
                                     вызов из projects.ts ПОСЛЕ calculatePriceFromInputs;
                                     входы: config, handoff, rulesSnapshot, priceSnapshot, engineBreakdown;
                                     выход: CompositionTrace (read-only)
```

**Не вызывать trace-resolver внутри `resolveCalculationInputs`** — `engineBreakdown` там ещё не существует. Контракт `CalculationRequest`/`CalculationInputs`/`CalculationBreakdown` **не изменяется**.

### 8.2 Модель `CompositionTrace` (не входит в контракт расчёта)

Структура — §A-9. Ключевые инварианты:
- `quantity: number | null` / `amount: number | null` — **null, никогда 0** по умолчанию (В-3);
- `condition: "true" | "false" | "not_evaluated" | "error"` — «неизвестно» ≠ true (A-05);
- `quantitySource ∈ "fixed" | "engine_line_field" | "unresolved"` (`managed_rule` исключён — A-04);
- итоги — только `CalculationBreakdown.total` (В-2); trace не суммирует вместо Engine.

### 8.3 Правила quantityRef (В-3, A-04, R-01, R-02)

| Источник | Допустимо | Если нет/неизвестно |
|---|---|---|
| `fixed` | значение строки (схема: finite ≥ 0; публикация требует `> 0`, `owner_confirmed`, единицу ≠ `none`, `composition.ts:861–877`) — **[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ] единственный исполняемый вариант quantityRef без дополнительных таблиц** | `quantity_unresolved` |
| **whitelist-пара Engine** | только **подтверждённые** пары §13: `CalculationLineId` + числовое поле **верхнего уровня** элемента `lines[]` (вложенного `payload` нет — `contract.ts:258–298`) | пара не подтверждена/поля нет → `quantity_unresolved` |
| `managed_rule` | **не исполняется** (A-04, R-02) — не источник количества; potential extension `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]` | `quantity_unresolved` |
| `code` | **не исполняется как выражение**; допустимо только через **утверждённую** таблицу сопоставления «строка состава → поле Engine» (О-1) | сопоставления нет → `quantity_unresolved` |

**[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ R-01]** в модели Composition **нет данных-связки** с `CalculationLineId` (grep по `composition*.ts`: `CalculationLineId` отсутствует). Таблица сопоставления «CompositionLine (moduleType/component/quantityRef.code) → CalculationLineId + поле» — **проектируемая**, утверждается владельцем (О-1); в E1 включаются только пары, подтверждённые §13.

Единица: пары несут единицу из **явных** display-определений (§13, столбец «Единица (источник)»); несовпадение единицы `fixed`-строки с единицей пары → `quantity_unresolved` (не 0). **Запрещено:** динамические выражения, произвольные формулы, подстановка нуля.

### 8.4 Правила condition (В-4, В-6, A-05)

Таблица — §A-05. Сводно: text → не исполняется (required/conditional → block, optional → warning+excluded); unknown code / неисполнимая семантика → fail-closed; managed_rule → структурный гейт Q7-03 → fail-closed при любой ошибке; true → дальше по количеству/цене; false → excluded; повреждённая структура → block.

### 8.5 Warning / block (В-5, A-06)

| Класс | Примеры | Действие |
|---|---|---|
| **warning** | расхождение trace ↔ Engine; drift pins (Q4); text-condition у optional-строки; trace недоступен для старых событий | расчёт проходит; видно в Inspector |
| **block** | hash mismatch; не-published/unknown/повреждённая запись; несовместимая пара composition/rules; отсутствие обязательного тарифа/правила; ambiguous alternative; Production Gate в production; повреждённая коллекция | расчёт/публикация запрещены (существующие коды ошибок) |

**Фактическое следствие:** `data-resolver.ts:1411` сейчас блокирует любой issue — разделение warnings/errors при расширении preflight — designed-изменение `[ПРЕДЛОЖЕНО]`.

### 8.6 Сохранение trace (В-5, A-09) `[ПРЕДЛОЖЕНО, НЕ РЕАЛИЗОВАНО]`

Optional `compositionTrace` в `ProjectPriceHistory`; `StoredProject.price` и `CalculationBreakdown` не меняются; `schemaVersion` не повышается; только при наличии composition-pin; без pin → trace не создаётся (В-1); старые события → `trace_unavailable`, ретро-восстановление запрещено. Требует согласования изменения типов на E4.

### 8.7 priceVersionId (В-7, A-10, О-3) `[ПРЕДЛОЖЕНО, НЕ РЕАЛИЗОВАНО]`

Новая published-запись обязана содержать `pins.priceVersionId` (ссылка на существующий `PricingVersion`); механизм — ошибка публикации, без авто-подстановки; существующие записи читаются как legacy (ADR-08 §2.10) и не мигрируются. Точка/охват — О-3.

---

## 9. Схема потока данных (целевая) `[ПРЕДЛОЖЕНО]`

```
UI (config | projectId) → /api/calculation-inputs | saveProject | recalculateProject
        ▼
DataResolver ── pins/catalogs/presets, PriceSnapshot, RulesSnapshot,
│               resolveCompositionPreflight (§8.1) ── block-issues → остановка (В-5)
│               handoff: compositionPreflight {versionId, hash, rulesSnapshotId, pins}
│
├── CalculationRequest ──► Engine ──► CalculationBreakdown   ◄── ЕДИНСТВЕННЫЙ источник totals (В-2)
│                          └──► display-adapter (без изменений) → PriceBreakdown
│
└── (после Engine, только при записи истории)
      resolveCompositionTrace(handoff, rulesSnapshot, priceSnapshot, engineBreakdown)
            │  quantityRef по whitelist §13 (В-3); conditions fail-closed (В-5/В-6);
            │  тарифы из того же PriceSnapshot
            ▼
      CompositionTrace ──► СВЕРКА с CalculationBreakdown: расхождение → WARNING (В-5);
            │               целостность/pins/corrupt → BLOCK (В-5)
            ▼
      ProjectPriceHistory.compositionTrace? (одно событие с расчётом, A-01) + Inspector (read-only)
```

Инварианты: totals — только Engine; trace не пишет в `CalculationBreakdown`/`PriceBreakdown`; отсутствие обязательных данных → issue/null, а не ноль; trace **не пересчитывается при чтении истории**.

---

## 10. Правила получения количеств и цен

1. Количество — только по В-3/A-04/R-01: `fixed` / **подтверждённая** whitelist-пара из `CalculationBreakdown.lines[]`; иначе `quantity_unresolved` (**не 0**).
2. Цена компонента **[ПРЕДЛОЖЕНО, R-03]** — **не безусловное** `quantity × amount`:
   - снимок хранит `{priceItemId, amount}` **без единицы** (`admin/schema.ts:177–180`); единица тарификации — `PriceItem.unit` (enum `RUB|RUB_PER_SQM|RUB_PER_M|RUB_PER_LINM|RUB_PER_PCS|FACTOR`), изменяема патчем → для исторической воспроизводимости единица должна фиксироваться **в trace** (§A-9);
   - умножение выполняется **только** при подтверждённой совместимости «единица количества строки ↔ `PriceItem.unit`» по таблице §22.3 (проектируется, утверждается владельцем; например `FACTOR` и `RUB` — **не умножаются** на количество);
   - несовместимость/неизвестная единица → `price_unresolved` либо отдельный статус несовместимости единиц; **ноль не подставляется, умножение не выполняется**;
   - тарифа в snapshot нет → `amount = null` + issue (**не 0**).
3. Итог = `CalculationBreakdown.total` (В-2). Trace не переопределяет и не суммирует вместо Engine.
4. Правила — из закреплённого `rulesSnapshotId` (recalculate) или активного published (create/preview) — уже обеспечено DataResolver (`:1188–1229`); **текущие правила вместо снимка не используются**.
5. preliminary в расчёт не попадает (Q2); в production composition без `approved` блокируется (Q5).
6. Для новых published-записей, участвующих в трассировке, обязателен `pins.priceVersionId` (В-7; исполнение и возможное расширение — О-3).

---

## 11. RulesSnapshot и project pins (переходный режим В-1)

```
create/preview:  rules = активный published;  composition = только явный input.compositionVersionId
                 (иначе — без composition; В-1: pin необязателен; фактически API id пока не принимает — §A-02)
recalculate:     rules = project.rulesSnapshotId (нет → RULES_SNAPSHOT_MISSING, Q7-11)
                 composition = project.compositionVersionId (нет → расчёт без composition, В-1)
                 CAS = COMPOSITION_PIN_CHANGED (projects.ts:569)
transition:      published-only, kitchen-only, пара rules, expectedUpdatedAt, journal+audit, без пересчёта
```

**Если pin присутствует — проверки обязательны (В-1)** — всё уже в `validateCompositionForConfig`.
**Drift (В-5):** сравнение `composition.pins.*` с фактически использованными каталогами/тарифами/прайсом — warning; реализация в расчётном пути предложена (E2), в admin уже есть (§A-06).

---

## 12. Компонентная трассировка (модель)

`CalculationBreakdown` **не изменяется**. Модель read-only:

| Вопрос | Источник | Статус |
|---|---|---|
| Какая composition использована | `compositionVersionId` + `contentHash` события | метаданные реализованы; trace — предложено |
| Версии и pins | `composition.rulesSnapshotId`, `.pins`, `project.rulesSnapshotId`, `.pins`, `priceSnapshot.priceVersion`, `pins.priceVersionId` | данные реализованы; разделение семантик — §A-03 |
| Какие строки участвовали | `lines[]` со status | предложено |
| Какие условия сработали | `condition` результат — паттерн `LineExplanation` ADR-07 §10.2 п.5, **не** в `CalculationBreakdown` | предложено |
| Какие количества | `quantity`+`unit`+`quantitySource` (В-3, §13) | предложено |
| Какие PriceItem/тарифы | `priceItemId`, сырой `amount`, `priceItemUnit` (единица на момент расчёта, R-03), обе версии прайса (§A-03) | предложено (единица — R-05) |
| Вклад в стоимость | сопоставление со строками Engine; **суммы — от Engine** | предложено |
| Статичное соответствие «строка → формула» | `FORMULA_REGISTRY`/`MAP_ROWS`, `assigns.line:` | **реализовано** (read-only) |
| Сохранение в истории | `ProjectPriceHistory.compositionTrace?` | **не реализовано** (E4, В-5) |

---

## 13. Whitelist Engine outputs (В-3, О-1) `[ФАКТ: контракт; ПРЕДЛОЖЕНО: сам список]`

**Правила R-01:** путь — поля **верхнего уровня** элемента `lines[]` (вложенного `payload` нет); тип — из union `contract.ts:258–298`; единица — **только явная** (display-сегменты `admin/display-metadata.ts`, `numberUnit`/literal-подписи; из названия поля единица **не выводится**); формирование — `engine.ts:856–912`; реестр числовых полей — `FIELDS` (`admin/display-metadata.ts:68–121`).

#### 13.1 Подтверждённые пары (включаются в исполнимый whitelist E1) `[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ]`

| CalculationLineId | Поле (путь) | Тип | Единица (источник) | Формирование | Семантика |
|---|---|---|---|---|---|
| kitchen.body | `line.moduleCount` | number | « модул. » (`:379`) | `engine.ts:857` | число модулей конфигурации |
| kitchen.fronts | `line.doors` | number | « фасад. » (`:383`) | `engine.ts:858` | число створок фасадов |
| kitchen.fronts | `line.drawers` | number | « ящ. » (`:383`) | `engine.ts:858` | число ящиков |
| kitchen.options | `line.countertopMeters` | number | м, `numberUnit` (`:394`) | `engine.ts:860` | длина столешницы |
| kitchen.options | `line.shelves` | number | « полок » (`:394`) | `engine.ts:860` | число полок |
| kitchen.plinth | `line.lengthM` | number | м, `numberUnit` (`:403`) | `engine.ts:866` | длина цоколя |
| kitchen.supports | `line.legs` | number | « шт. » (`:417`) | `engine.ts:877` | число ножек |
| kitchen.supportClips | `line.clips` | number | « шт. » (`:423`) | `engine.ts:885` | клипсы цоколя |
| kitchen.supportScrews | `line.screws` | number | « шт. » (`:427`) | `engine.ts:886` | винты |
| kitchen.supportAnchors | `line.anchors` | number | « шт. » (`:431`) | `engine.ts:887` | анкеры |
| kitchen.lighting | `line.lengthM` | number | « м » (`:436`) | `engine.ts:890` | длина подсветки |
| kitchen.lighting.strip | `line.lengthM` | number | « м » (`:443`) | `engine.ts:898` | длина ленты |
| kitchen.lighting.profile | `line.quantityM` | number | « м » (`:447`) | `engine.ts:899` | длина профиля |
| kitchen.lighting.diffuser | `line.quantityM` | number | « м » (`:451`) | `engine.ts:900` | длина рассеивателя |
| kitchen.lighting.endCaps | `line.endCaps` | number | « шт. » (`:455`) | `engine.ts:901` | заглушки профиля |
| kitchen.lighting.connectors | `line.connectors` | number | « шт. » (`:459`) | `engine.ts:902` | соединители |
| kitchen.lighting.psu | `line.psuCount` | number | « шт. » (`:464`) | `engine.ts:903` | блоки питания |
| kitchen.lighting.install | `line.quantityM` | number | « м » (`:478`) | `engine.ts:905` | объём монтажа |
| kitchen.sidePanels | `line.count` | number | « шт. » (`:486`) | `engine.ts:910` | боковины (**`amount` строки = 0** — цена учитена в опциях; для стоимости компонента берётся snapshot-тариф) |

**Условие присутствия `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА — подвопрос R-01a]`:** строки `supportClips/supportScrews/supportAnchors/lighting.*` добавляются в `lines` **только при >0** (`engine.ts:885–905`). Отсутствие условной строки в `breakdown` Engine **не равнозначно явно возвращённому нулю**. Предлагаемое правило: отсутствие → `quantity_unresolved` (fail-closed, без подстановки нуля); трактовка «отсутствие = 0 шт.» может быть введена только отдельным решением владельца.

#### 13.2 Неподтверждённые пары (не включать в E1) `[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ]`

| Поле | Причина |
|---|---|
| `kitchen.plinth.supportFrontLegs`, `kitchen.supports.frontLegs`, `kitchen.supports.backLegs` | единица **не названа явно** (подписи «опорам», «спереди», «сзади» — позиционные, `:403–417`); тип number подтверждён, единица — нет |

#### 13.3 Пары, исключаемые из первой реализации `[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ]`

- **поля-параметры/коэффициенты** (не количество компонента): `thicknessMm`, `tallAnchorSpacingCm`, `powerPerMeter`, `voltage`, `colorTemp`, `psuW`, `factor`;
- **деньги:** `amount` (используется только для сверки стоимости trace со строкой Engine);
- **строки без числовых полей:** `kitchen.base`, `kitchen.fittings`, `kitchen.pushToOpen`, `kitchen.supportPreliminary`, `kitchen.complexity`, `kitchen.minOrder`, `kitchen.lighting.control` (`FIELDS`, `admin/display-metadata.ts:68–108`);
- **все** `*Id` (string) и boolean-поля;
- **все `wardrobe.*`** — вне области (composition kitchen-only, `composition.ts:1016`).

#### 13.4 Ограничение сопоставления

**[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ R-01]** связь «строка Composition ↔ `CalculationLineId` + поле» **в данных отсутствует** (в `composition*.ts` ссылок на `CalculationLineId` нет). Whitelist §13.1 подтверждает **поля Engine**; сама таблица сопоставления со строками состава (по `moduleType`/`componentId`/`quantityRef.code`) — проектируется и **утверждается владельцем в О-1**. Непокрытые строки → `quantity_unresolved` + диагностика; расширение — только явным решением.

---

## 14. Стратегия обратной совместимости (В-1)

| Категория | Поведение | Статус |
|---|---|---|
| Проекты без `compositionVersionId` (локально — все 200) | расчёт без composition; trace отсутствует → `trace_unavailable` | реализовано (тест `composition-data-resolver.test.ts:139`) |
| Проекты без `rulesSnapshotId` (локально — все 200) | новый расчёт блокирован `RULES_SNAPSHOT_MISSING`; чтение разрешено | реализовано (Q7-11) |
| Наличие pin | целостность и совместимость — **обязательно** (В-1) | реализовано (preflight) |
| Старые конфигурации/`schemaVersion` | не меняются; миграций нет | реализовано |
| Сохранённые результаты/PriceSnapshot | читаются как есть; пересчёт — явная операция; trace старых событий не восстанавливается | реализовано |
| Composition стала superseded | новый расчёт блокируется, чтение разрешено; возврат — явный transition | реализовано |
| Автоматическая привязка/миграция проектов | **не выполняется и не предлагается** | решение В-1 |
| Trace в истории | только для расчётов с pin; без pin — не создаётся | предложено (E4) |

---

## 15. Изменения по файлам (следующий этап, только после согласования)

**Новые:** `src/lib/server/composition-resolver.ts` (trace) · изолированный executor условий (место — О-2) · их тесты.

**Изменяемые (additive, designed):**
- `data-resolver.ts` — выделение `resolveCompositionPreflight`, поле `compositionPreflight` в `ResolvedCalculation`, разделение warning/error при необходимости;
- `projects.ts` — вызов `resolveCompositionTrace` после `calculatePriceFromInputs` + передача trace в `createHistoryEvent`;
- `calculation-inspector.ts` — read-only блок trace / `trace_unavailable`;
- `composition.ts` — требование В-7 при публикации (E5);
- `configurator/types.ts` — optional `ProjectPriceHistory.compositionTrace?` (E4, только после согласования);
- **`app/api/calculation-inputs/route.ts` + `app/api/projects/route.ts` + `configurator/schema.ts` (`projectPayloadSchema`)** — optional `compositionVersionId` pass-through (§A-02) — **требует отдельного согласования**;
- тесты перечисленного.

**Запрещено:** `engine.ts`, `pricing.ts`, `contract.ts` (whitelist `CalculationInputs`), `display-adapter.ts`, `golden.expected.ts`, геометрия, ADR-06/07, новые kinds, состав шкафа, другие калькуляторы; ADR-08 — только по отдельному согласованию (О-5).

---

## 16. Риски и ограничения

| ID | Риск | Уровень | Митигация |
|---|---|---|---|
| IR-01 | Двойной источник норм (composition vs формулы Engine) | высокий | В-2: Engine — единственный authority; расхождение → warning (В-5) |
| IR-02 | Whitelist не покрывает все строки состава | высокий | `quantity_unresolved` + диагностика; расширение только явно (О-1) |
| IR-03 | Попытка положить composition в `CalculationInputs` → правка ADR-06 + purity-тест | высокий | не делаем; trace вне контракта |
| IR-04 | Данных composition нет (0 записей); 200 проектов legacy | средний | интеграция инертна до публикации |
| IR-05 | Размер trace в `priceHistory` | средний | только при pin; замер после появления данных (О-4) |
| IR-06 | Executor условий = новый интерпретатор | средний | структурный гейт Q7-03, fail-closed, без DSL (В-4) |
| IR-07 | Scope creep (wardrobe, kinds, другие калькуляторы) | средний | явно вне scope |
| IR-08 | gap В-7: публикация возможна без `priceVersionId` | средний | E5, ошибка публикации без авто-подстановки (О-3) |
| IR-09 | Изменение API-схем для передачи pin (A-02) | низкий | additive-optional; без изменения существующего поведения; отдельное согласование |
| IR-10 | code-conditions неисполнимы: реестр ссылается на функции Engine, возвращающие доменные значения, а не boolean | средний | fail-closed (§A-05); семантика предиката — О-2 |
| IR-11 | Несовместимость единиц количества и тарифа (`COMPOSITION_UNITS` ≠ `PriceItem.unit`, snapshot без единицы, `unit` изменяем) | средний | матрица §22.3 — только подтверждённые комбинации; иначе `price_unresolved`; единица фиксируется в trace (R-03/R-05) |
| IR-12 | Отсутствие условной строки Engine трактуется как 0 (скрытая подстановка) | средний | fail-closed `quantity_unresolved` до решения R-01a |

---

## 17. План реализации (после согласования)

| Этап | Содержание | Зависимости | Статус |
|---|---|---|---|
| E0 | Согласование rev.4 + О-1…О-6 | владелец | текущий |
| E1 | `resolveCompositionPreflight` (выделение) + `composition-resolver`/`resolveCompositionTrace`: whitelist quantityRef **только §13.1** (В-3, R-01), executor conditions fail-closed (§A-05, R-02), матрица единиц §22.3, warning/block (§8.5) | О-1, О-2, решение по матрице §22.3 и R-01a | не начат |
| E2 | Inspector: trace/`trace_unavailable`; drift-warnings Q4 в расчётном пути; **передача `compositionVersionId` в API create/preview/save** (§A-02) | E1, согласование API-изменений | не начат |
| E3 | Тесты: legacy, без pin, с pin, superseded, production gate, отсутствие 0-подстановок, text/unknown conditions, alternative-кейсы; typecheck/lint/build | E1–E2 | не начат |
| E4 | **Сохранение trace в `ProjectPriceHistory`** + чтение + правило «не пересчитывать при чтении» (В-5, A-09); согласование изменения типов | E1–E3 | не начат |
| E5 | **Обязательность `pins.priceVersionId` при публикации** (В-7, охват — О-3; A-10) | независим от E4 | не начат |
| E6 | Вариант C (влияние на количества) | **отдельный ADR** | вне scope |

---

## 18. Критерии приёмки

1. Расчёт без composition-пина даёт идентичный `PriceBreakdown` (`golden.expected.ts` не меняется).
2. Расчёт с пином даёт тот же `total` (В-2); trace содержит строки покрытых модулей.
3. Отсутствие обязательного количества/тарифа → issue; **quantity/amount = null, никогда 0** (В-3).
4. Блоки В-5 (целостность/pins/corrupt) и warnings В-5 (расхождение/drift) разделены и протестированы (§8.5).
5. `text`-conditions не исполняются; неизвестные/некорректные условия fail-closed; required+text → block; optional+text → warning+excluded (§A-05).
6. Trace сохраняется в событии истории при наличии pin; без pin trace нет; старые события → `trace_unavailable`; **при чтении истории trace не пересчитывается** (A-09).
7. Новые published-записи, **используемые в компонентной трассировке**, содержат `pins.priceVersionId` (узкое правило В-7; возможное расширение — только по О-3); существующие не мигрируются.
8. Проекты без pin — legacy-поведение сохранено (В-1); `RULES_SNAPSHOT_MISSING` для legacy не меняется.
9. `engine.ts`, `pricing.ts`, `contract.ts`, `display-adapter.ts` — без изменений; purity-тест зелёный; вариант B не превращён в C; trace отсутствует в `CalculationBreakdown`.
10. `managed_rule` не используется как источник количества без отдельного решения (A-04).
11. typecheck / lint / build / `npx vitest run` — PASS.

### 18.1 Критерии по этапам (rev.4) `[ПРЕДЛОЖЕНО]`

| Этап | Критерии приёмки |
|---|---|
| **E1** | (а) whitelist-quantityRef работает **только** с парами §13.1 — все остальные (`managed_rule`, `code`, неподтверждённые §13.2) дают `quantity_unresolved`, ноль никогда не подставляется; (б) условие исполняется только executor'ом E1; `text`/`code`/`managed_rule` без подтверждённой семантики → fail-closed по таблице §A-05; неисполняемое optional-условие → `excluded`, **не** unconditional; (в) `fixed`-quantityRef исполняется с проверкой единицы; (г) умножение цены — только по подтверждённой строке матрицы §22.3, иначе `price_unresolved`/несовместимость единиц; (д) `resolveCompositionPreflight` отделён от `resolveCompositionTrace`; trace-вызов — после Engine; (е) block/warning разделены по §8.5; (ж) `engine.ts`, `contract.ts`, `pricing.ts`, `display-adapter.ts` — без изменений, purity-тест зелёный |
| **E2** | (а) Inspector показывает trace/`trace_unavailable` read-only; (б) drift-warnings Q4 видны в расчётном пути как **не блокирующие**; (в) передача `compositionVersionId` в API create/preview/save — additive-optional, старое поведение байт-в-байт сохранено (golden не меняется); (г) подвопрос R-01a закрыт решением владельца либо действует fail-closed `quantity_unresolved` |
| **E3** | (а) тесты: legacy без pin; с pin; superseded; production gate; текстовые/неизвестные/повреждённые условия; все кейсы §A-05 и §A-08; матрица единиц; отсутствие 0-подстановок; (б) typecheck/lint/build/`npx vitest run` — PASS |
| **E4** | (а) `compositionTrace` пишется **в то же событие** `ProjectPriceHistory`, что и расчёт; (б) без pin trace нет; старые события → `trace_unavailable`; (в) чтение истории **не вызывает** пересчёт trace (тест на отсутствие обращений к текущим данным); (г) trace содержит все идентификаторы контекста §A-9 (R-05), включая `priceItemUnit`/`baseSchema`; (д) объём — без произвольного лимита до замера (О-4); (е) `CalculationBreakdown`/`StoredProject.price` не изменены |
| **E5** | (а) действие соответствует **узкому** правилу В-7 либо расширенному — в зависимости от решения по О-3 (нельзя применить расширенное без решения); (б) отсутствие `priceVersionId` → ошибка публикации, без авто-подстановки; (в) существующие записи не мигрируются (ADR-08 §2.10) |
| **E6 (вне scope)** | только отдельный ADR (вариант C) |

---

## 19. Открытые вопросы и решения владельца (О-1…О-6, rev.4)

Формат каждого вопроса: **(1)** подтверждённое состояние · **(2)** техническая рекомендация (не решение) · **(3)** последствия альтернатив · **(4)** что решает владелец.

### О-1. Whitelist сопоставления `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]`
1. **Состояние:** поля Engine подтверждены (§13.1, R-01); неподтверждённые — §13.2; исключённые — §13.3; **связи «строка Composition → CalculationLineId» в данных нет** (§13.4); подвопрос R-01a (отсутствие условных строк) не закрыт.
2. **Рекомендация:** утвердить §13.1 как whitelist rev.1 **и** утвердить проектируемую таблицу сопоставления «строка состава → пару Engine»; R-01a — fail-closed `quantity_unresolved`.
3. **Альтернативы:** расширить whitelist сейчас (выше риск немотивированных пар) / отложить (больше `quantity_unresolved`).
4. **Решение владельца:** утвердить/изменить §13.1 + таблицу сопоставления + правило R-01a.

### О-2. Executor условий `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]`
1. **Состояние:** Q7-03 — структурный валидатор; executor'а нет; boolean-семантика `managed_rule`/`code` не доказана (R-02, §22.2).
2. **Рекомендация:** размещение — `src/lib/server/` (не импортирует Engine, purity-тест не затрагивается, вне admin-CRUD, переиспользует гейт Q7-03); на E1 исполнять только `fixed`-quantityRef и fail-closed условия; `condition.code` — не исполняется, пока не определена зарегистрированная boolean-семантика.
3. **Альтернативы:** (а) немедленно спроектировать boolean-семантику реестра → отдельная задача/сроки; (б) считать `code`/`managed_rule` исполнимыми без доказательства → запрещено fail-closed-инвариантом; (в) не создавать executor вовсе → трассировка условий недоступна.
4. **Решение владельца:** одобрить размещение и объём E1; решить, нужна ли отдельная задача «boolean-семантика реестра».

### О-3. Обязательность `priceVersionId` `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]`
1. **Состояние:** В-7 (узкое правило) — утверждён и сохраняется; расширенное правило («все публикации») — **не** утверждено; признака «назначение Composition для трассировки» в модели нет (R-06, §22.6, §7 A-10); поле optional, публикация без него возможна (`composition.ts:1116`).
2. **Рекомендация (техническая):** механизм — ошибка публикации без авто-подстановки; точка — `publishCompositionVersion`.
3. **Альтернативы:** (а) оставить узкое В-7 — но тогда E5 должен уметь отличать «используемую в трассировке» составу, а признака нет; (б) общее правило для всех публикаций — требует published PricingVersion всегда, затрагивает составы вне трассировки; (в) ввести признак назначения — изменение модели; (г) отложить E5.
4. **Решение владельца:** (а)/(б)/(в)/(г) — **без этого решения E5 не стартует в расширенном объёме**.

### О-4. Размер trace `[ОТКРЫТО — нет данных]`
1. **Состояние:** записей Composition — 0; измерить невозможно; retention — «хранить всё» до Q13; порядок величины для `breakdown` — ≈30 КБ/событие (существующая оценка `CALCULATION_ADMIN_DATA_AND_VERSIONING_DESIGN.md:1163`, оценка — не обещание).
2. **Рекомендация:** **не назначать лимит**; определить его после измерений на реальных составах и истории.
3. **Альтернативы:** произвольный лимит сейчас → риск обрезки данных без основания; без лимита → рост файла (регулируется Q13).
4. **Решение владельца:** момент и способ измерения; связь с решением Q13.

### О-5. ADR-08 §2.3 `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]`
1. **Состояние:** расхождение точечно: ADR §2.3 — «публикация создаёт новый immutable published»; код — in-place перевод draft→published тем же `id` (`composition.ts:1160`), новый id — при создании draft (`:406`), published не редактируется (`:538`). **ADR-08 не изменён.**
2. **Рекомендация:** согласовать точечную редакцию (текст ниже); поведение кода не менять.
3. **Альтернативы:** оставить формулировку (читатель может ожидать новую запись) / правка ADR (документально фиксирует факт).
4. **Решение владельца:** согласовать (или отклонить) правку ADR-08.

> Проектируемый текст для О-5: публикация переводит существующую draft-запись в `published` с тем же `id` (пересчёт `contentHash`, фиксация `pins`/`publishedSeq`, перевод прежней published в `superseded`); новая редакция создаётся отдельным draft с новым `id` (`sourceVersionId`); опубликованные записи далее не редактируются.

### О-6. Обязательный Composition pin `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]`
1. **Состояние:** переходный режим В-1 утверждён и сохраняется; **дата и автоматическое условие перехода не установлены**; авто-миграции старых проектов нет.
2. **Рекомендация (не решение):** при будущем переходе рассматривать совокупность критериев: покрытие поддерживаемых модулей; покрытие поддерживаемых расчётных сценариев; отсутствие критических `quantity_unresolved`; подтверждённая публикация Composition; проверенная история и воспроизводимость trace; готовность Production Gate.
3. **Альтернативы:** переход по дате / по критериям / оставить необязательным — последствия для legacy-проектов (200 из 200 без pin) различаются принципиально.
4. **Решение владельца:** ввести ли переход, критерии и момент; **автоматическая миграция не предлагается**.

---

## 20. Таблица покрытия замечаний A-01–A-10 и R-01–R-06

| # | Замечание | Результат |
|---|---|---|
| A-01 | Разделить preflight и trace | **исправлено в документе** (§7 A-01, §8.1, §9): последовательность 1→4, интерфейсы `resolveCompositionPreflight`/`resolveCompositionTrace` (проектируемые), handoff через `ResolvedCalculation.compositionPreflight`; **подтверждено кодом** (trace-вызов после Engine, в `projects.ts`) |
| A-02 | Путь передачи compositionVersionId | **подтверждено кодом** (§4, §A-02): API create/preview/save id не передают; `saveProject` поле имеет; recalc — пин проекта; **designed-изменение API отмечено** (§15, E2) |
| A-03 | Семантика priceVersionId | **подтверждено кодом** (§A-03): единое ID-пространство `PricingVersion.id`, четыре самостоятельные семантики; **не взаимозаменяемы** |
| A-04 | managed_rule как источник количества | **исправлено** (§A-04, §8.3): исключён из утверждённых источников; **подтверждено кодом** (valueType/unit/assigns/Engine читает только wardrobe-нормы); потенциальное расширение — **решение владельца** |
| A-05 | Text/неизвестные conditions | **исправлено** (§A-05): полная таблица fail-closed + запрет перехода в unconditional; **подтверждено кодом** (обработки `text` нет; схема/Q8 совместимы) |
| A-06 | Три вида проверки pins | **исправлено** (§A-06, §8.5): целостность/совместимость/drift разделены; **подтверждено кодом** (drift-warnings только в admin-валидации; preflight — errors; `data-resolver:1411` блокирует любые issues) |
| A-07 | Реальный whitelist | **исправлено и переработано по R-01** (§13): подтверждённые/неподтверждённые/исключённые пары, явные единицы, места формирования; **утверждение списка — О-1** |
| A-08 | alternativeGroup | **исправлено** (§A-08) + **R-04**: 5 ситуаций разделены; **подтверждено кодом** (≥2 строк, дубликаты, runtime-исполнения нет); правила блокировки/невычислимости — **решение владельца** |
| A-09 | Воспроизводимость trace | **исправлено** (§A-09) + **R-05**: модель события с идентификаторами контекста, 3-групповое разделение данных; **подтверждено кодом** (история хранит `breakdown`+`compositionVersionId`; retention — Q13) |
| A-10 | Граница E4/E5 | **исправлено** (§7 A-10, §17); признака назначения Composition **нет**; расширение В-7 — **О-3** (R-06) |
| **R-01** | Whitelist Engine outputs | **подтверждено исследованием** (§13, §22.1): путь — верхний уровень `lines[]` (payload отсутствует — исправлено), типы из контракта, единицы из display-определений, формирование `engine.ts:856–912`; **открыт подвопрос R-01a** `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]` |
| **R-02** | Condition evaluator | **подтверждено исследованием** (§22.2): Q7-03 = структурный валидатор; executor отсутствует; boolean-семантика не доказана; минимальные требования к будущему evaluator зафиксированы `[ПРЕДЛОЖЕНО]` |
| **R-03** | Модель цены компонента | **подтверждено исследованием** (§22.3): snapshot без единицы, `PriceItem.unit` изменяем, энумы разные; матрица совместимости — `[ПРЕДЛОЖЕНО]`, **требует решения владельца** |
| **R-04** | AlternativeGroup | **подтверждено исследованием** (§A-08, §22.4): runtime-оценки нет; контролируемый статус вместо произвольного выбора; правила — решение владельца |
| **R-05** | Historical reproducibility | **подтверждено исследованием** (§A-09, §22.5): полный список идентификаторов, 3 группы данных; запрет восстановления trace из текущего состояния |
| **R-06** | Scope priceVersionId | **зафиксировано** (§22.6): узкое В-7 сохранено; расширение — отдельный О-3 `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]` |

---

## 21. Проверка утверждений (§5, rev.4)

| Проверка | Результат |
|---|---|
| Решения В-1…В-7 не изменены | §6 (без правок) + §8–§14, §17, §18, §22.6 (В-7 — только констатация узкого объёма) |
| Ограничения Q1–Q8 сохранены | Q1 — пара rules-snapshot (`:1029`); Q2 — preliminary error (`:1007`); Q3 — confirm-only (`:1326`); Q4 — pins в hash, drift warning (`:935–973`); Q5 — Production Gate (`:1036`); Q6 — без priceRole; Q7 — ADR-08 без новой модели; Q8 — unknown code error (`:844–880`) |
| Выводы о CompositionVersion подтверждены кодом | `composition-schema.ts:209`; `composition.ts:52,99–137,186–188,406–447,529,1076–1186,330–367`; хранение `store.ts`/`storage/`; отсутствие данных — `ls data/composition-versions.json` (нет) + `sqlite3 collection_state` (нет строки) |
| Замечания R-01…R-06 имеют явный результат | §20 (последние 6 строк), §22.1–22.6 |
| О-1…О-6 имеют актуальный статус | §19 — по структуре «состояние / рекомендация / альтернативы / решение владельца» |
| Противоречия с ADR-08 | одна неточность формулировки §2.3 (О-5); поведение соответствует; **ADR не изменялись** |
| Legacy-поведение сохранено | §14; pin optional (В-1) |
| Вариант B не превращён в C | В-2; §7.1; trace вне `CalculationRequest`; Engine не изменяется; §23 инвариант 10 |
| Engine — единственный источник totals | §9, §10 п.3, §18 п.1–2, §23 инвариант 1 |
| Trace отсутствует в `CalculationBreakdown` | §12, §18 п.9 |
| Trace не пересчитывается при чтении истории | §A-09, §18 п.6, §18.1 E4 (в), §23 инвариант 7 |
| Неисполняемые условия не становятся unconditional | §A-05, §22.2, §23 инвариант 8 |
| Нулевых подстановок нет | §10, §13, §22.1/22.3, §23 инвариант 9 |
| Неподтверждённые утверждения помечены | маркеры `[РЕАЛИЗОВАНО]`/`[УТВЕРЖДЕНО]`/`[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ]`/`[ПРЕДЛОЖЕНО]`/`[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]`/`[НЕ РЕАЛИЗОВАНО]`/`[ОТКРЫТО]`; О-1…О-6 в §19 |
| Исходный код/API/схемы/типы/тесты/конфигурация не изменились | изменён **только** `docs/CALCULATION_ADMIN/COMPOSITION_ENGINE_INTEGRATION_DESIGN.md`; `git diff --check` — OK; тесты/сборка не запускались (код не менялся) |

---

## 22. Замечания R-01–R-06 (rev.4)

### R-01. Whitelist Engine outputs `[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ — §13]`

- **Точный путь:** `CalculationBreakdown.lines[]` → элемент `{id, amount, ...числовые поля}`; **вложенного `payload` нет** (`contract.ts:258–298`) — исправлена формулировка rev.3.
- **Тип:** number (union), подтверждён контрактом; реестр полей по строкам — `FIELDS` (`admin/display-metadata.ts:68–121`, валидация `validateSegments:262+`).
- **Единицы:** только явные (`numberUnit`/literal-подписи, `admin/display-metadata.ts:373+`); из названия поля **не выводились**.
- **Формирование:** `engine.ts:856–912` (кухня), `:1000–1003` (шкаф, вне области).
- **Семантика и сопоставимость:** §13.1 (подтверждённые), §13.2 (неподтверждённые — единица не названа явно), §13.3 (исключены из первой реализации).
- **Связи «строка состава → CalculationLineId» в данных нет** → таблица сопоставления проектируется (О-1, §13.4).
- **Открытый подвопрос R-01a** `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]`: трактовка отсутствия условных строк (`engine.ts:885–905`) — предлагается `quantity_unresolved`, «отсутствие = 0» запрещено без отдельного решения.
- **Неподтверждённые пары в исполнимый whitelist E1 не включаются.**

### R-02. Condition evaluator `[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ]`

- **Q7-03 — структурный валидатор:** `RULE_CONDITION_OPERATORS`, `MAX_DEPTH=2`, `MAX_PREDICATES=8` (`managed-rules.ts:65–86`), `validateRuleCondition (:273)`; параллельно структурная проверка контракта `checkRuleConditionNode` (`contract.ts:736`).
- **Executor отсутствует:** точечные поиски `RuleConditionNode` — только `managed-rules.ts` (тип/схема/валидация) и `contract.ts` (структура); функции `RuleConditionNode → boolean` в `src/` нет.
- **Доступные данные/операнды:** узел условия правил (`all/any/predicates`), предметы/операторы из whitelist Q7-03; у `CompositionLine.condition` — только `kind ∈ text|code|managed_rule` (+ `ruleId`/`implementationId`/`text`).
- **Boolean-семантика не доказана:** `managed_rule` — значение/тип/единица правила есть, но правило условия и результат его применения для кухонных строк нигде не исполняются; `code` — реестр ссылается на функции Engine, возвращающие **доменные значения** (`calculateKitchenBreakdown`, `sinkLayout`, …), не boolean (`composition-code-registry.ts:18–99`).
- **Правило E1 `[ПРЕДЛОЖЕНО]`:** исполняется только `fixed` (quantityRef); `managed_rule` и `code` — **не исполняются**; неисполняемое обязательное/`conditional`-условие → block трассировки строки; неисполняемое необязательное → `excluded` + warning (**не unconditional** — инвариант 8).
- **Минимальные требования к будущему evaluator `[ПРЕДЛОЖЕНО]`:** (1) типы операндов — number/string/boolean по `valueType`/предмету; (2) операторы — только `RULE_CONDITION_OPERATORS`; (3) сравниваемые значения — только из закреплённого RulesSnapshot и `CalculationBreakdown`-контекста, никакого произвольного ввода; (4) единицы измерения — операнды с разными единицами не сравниваются без явного преобразования; (5) привязка — evaluator получает `CompositionLine.id` + `condition` + контекст и возвращает `true|false|not_evaluated|error` для этой строки; (6) результат фиксируется в trace (§A-9). ADR-07 не меняется.

### R-03. Модель цены компонента `[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ]`

**Факты:**
- `PriceItem` (`admin/schema.ts:136–170`): `unit ∈ RUB|RUB_PER_SQM|RUB_PER_M|RUB_PER_LINM|RUB_PER_PCS|FACTOR`, `usage`, `status`; **`unit` изменяем патчем** (`price-items.ts:269, 317–320`).
- `PricingVersion.snapshot[]` = `{priceItemId, amount}` — **единицы нет** (`admin/schema.ts:177–180`); `PriceSnapshotInput` (`contract.ts:157–166`): `priceVersion`, `snapshot`, `rules`, `signedAdjustments`, `promos`, `baseSchema`.
- `CompositionLine.quantityRef.fixed.unit ∈ COMPOSITION_UNITS = pcs|m|m2|cm|mm|kg|none` (`composition-schema.ts:46–55`) — **другое энум-пространство**, чем `PriceItem.unit`.
- Engine умножает тарифы **кодом** по ролям `priceRef` (`engine.ts:648–713`: `lengthM × pricePerMeter`, `sqm × ratePerSqm`, …) — «quantity × amount» для composition-строки считается trace **независимо**, без права влиять на итоги.

**Матрица совместимости единиц `[ПРЕДЛОЖЕНО — ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]:**

| Кол-во (`COMPOSITION_UNITS`) ↔ `PriceItem.unit` | Поведение E1 |
|---|---|
| `pcs` ↔ `RUB_PER_PCS` | допустимо умножать |
| `m` ↔ `RUB_PER_LINM` | допустимо умножать |
| `m` ↔ `RUB_PER_M` | **неоднозначно без правила классификации** `RUB_PER_M` vs `RUB_PER_LINM` → не умножать до решения |
| `m2` ↔ `RUB_PER_SQM` | допустимо умножать |
| `cm`/`mm` ↔ любой тариф | преобразование не поддержано (единственное разрешённое `cm-to-m` — `wardrobe.plinth.widthCm`, `admin/display-metadata.ts:279–289`; кухня вне охвата) → `price_unresolved` |
| `kg` ↔ любой тариф | тарифной единицы «кг» нет → `price_unresolved` |
| `none` ↔ любой тариф | запрещено схемой (fixed требует unit ≠ `none`) |
| любой ↔ `RUB` | абсолютная ставка — умножение на количество не доказано → не умножать |
| любой ↔ `FACTOR` | множитель, не ставка за единицу → не умножать |

**Правило `[ПРЕДЛОЖЕНО]`:** умножение выполняется только по подтверждённой строке матрицы; иначе статус `price_unresolved` либо отдельная ошибка несовместимости единиц; **ноль не подставляется**. Классификация — по §8.5: для **required**-строки отсутствующий/несовместимый тариф — **block**; для необязательной — warning + `price_unresolved` (та же логика, что у неисполняемых условий §A-05). Единица тарифа фиксируется в trace (R-05), поскольку `PriceItem.unit` исторически невосстановим (`price-items.ts:317–320`). Совместимость **не считается подтверждённой**, пока владелец не утвердит матрицу.

### R-04. AlternativeGroup `[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ]`
См. §A-08: runtime-оценки нет; применимость определяется только условием, executor отсутствует (R-02); до подтверждённой семантики группа → контролируемый статус, без «первой строки» и без суммирования. Правила блокировки неоднозначной группы и поведения при невычислимом условии — `[ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]`.

### R-05. Historical reproducibility `[ПОДТВЕРЖДЕНО ИССЛЕДОВАНИЕМ]`
См. §A-09: полный перечень идентификаторов контекста (`compositionVersionId`+`contentHash`, `rulesSnapshotId`, `enginePriceVersionId`+`baseSchema`, `pinnedPriceVersionId`, `priceItemId`+`amount`+`priceItemUnit`, `quantity`+`unit`, условия/статусы/warnings) — с разделением «уже сохраняется / добавить в trace / необходимость не доказана». **Актуальные снимки и `StoredProject` не заменяют исторический trace; старый trace не восстанавливается из текущего состояния.** Физическая схема БД не проектируется.

### R-06. Scope обязательности priceVersionId `[УТВЕРЖДЕНО / ТРЕБУЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА]`
- **Узкое правило (В-7, утверждено):** `pins.priceVersionId` обязателен для **новых опубликованных Composition, используемых в компонентной трассировке**. Сохраняется без изменений.
- **Расширенное правило (не утверждено):** обязателен для **всех** новых публикаций Composition. Это **другое правило**: (а) затрагивает и составы вне трассировки; (б) требует, чтобы опубликованная PricingVersion существовала всегда (сейчас публикация возможна без неё, `composition.ts:1116`, поле optional); (в) не вводит признака «назначения» — но и не определяет, какие составы «используются в трассировке» (признака в модели нет, §7 A-10).
- **Расширение не применяется** до отдельного решения владельца — вопрос **О-3** (варианты: общее правило / признак назначения / отложить).

---

## 23. Архитектурные инварианты rev.4 (не изменяются) `[УТВЕРЖДЕНО]`

| # | Инвариант | Где закреплён |
|---|---|---|
| 1 | Engine — единственный источник итоговых количеств и стоимости | В-2, §9, §10 |
| 2 | Composition формирует независимую трассировку (вне `CalculationRequest`) | В-2, §8.2 |
| 3 | Composition pin пока необязателен | В-1, §11 |
| 4 | Legacy-проекты сохраняют прежнее поведение | §14 |
| 5 | Нарушения целостности и совместимости — block | В-5, §8.5 |
| 6 | Расхождения trace ↔ Engine — warning | В-5, §8.5 |
| 7 | Trace хранится в истории и не пересчитывается при открытии | В-5, §A-09 |
| 8 | Неисполняемое условие не превращается в unconditional | §A-05, §22.2 |
| 9 | Никаких нулевых подстановок при отсутствии цены/количества | В-3, §10, §22.1 |
| 10 | Engine contract и purity-граница не меняются (вариант B) | §7.1, §15 |
