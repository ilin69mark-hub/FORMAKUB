# ADR-06: Единый контракт расчётного движка (Engine Contract)

- **ID:** ADR-06
- **Ревизия:** **11** (2026-11-09)
- **Статус:** **APPROVED**
- **Дата утверждения:** 2026-11-09 (решение владельца проекта)
- **История:** Rev 1 — первичный проект; Rev 2 — уточнения C-01…C-03/S-01…S-09; Rev 3 — замечания тех. аудита (expectedCalcVersion, Request/Operation Context, неизвестные входы, disclaimer, A5/pins, finishes, sortOrder, error codes); Rev 4 — пять точечных корректировок (jobId/attemptId, Preview priceVersion, PriceBreakdown/disclaimer, область finishes, типизация rules); Rev 5 — фиксация восьми решений владельца и устранение замечаний финального аудита; Rev 6 — независимый CalculationBreakdown, обязательный operationId, единое правило schemaVersion, уточнение кодов ошибок, структура pins и граница engine_migration; Rev 7 — единый формат версии в pins, исключение engine_migration из текущих критериев, однозначный schemaVersion fallback; Rev 8 — однозначное блокирование при несовпадении calcVersion и разделение R11 на тест поведения и статическую проверку контракта; Rev 9 — устранение дублирования R10/R11 и уточнение методов проверки; Rev 10 — контракт CA-T-302: CatalogItemInput, ModulePresetInput, SignedAdjustmentInput, LED-классификация, PriceSnapshotInput и fail-closed проверки; Rev 11 — пять решений владельца о полной миграции: SQLite/Admin как единственный runtime-источник, immutable manifests параметров по calcVersion, read-only доставка CalculationInputs, server-authoritative сохранение и декомпозиция CA-T-306A–F; Rev 11 addendum §15.7 — CalculationBreakdown/CalculationLine, DisplayMetadata и Display Adapter; §15.7.8 — cm-to-m display conversion
- **Задача:** CA-T-301 (`CALCULATION_ADMIN_IMPLEMENTATION_PLAN.md`, Фаза 3) — **DONE (2026-11-09)**; ADR-06 Rev9 утверждён; Rev10 фиксирует контракт входов CA-T-302; Rev11 фиксирует решения владельца о полной миграции и декомпозицию CA-T-306A–F; §15.7 фиксирует согласованный контракт CalculationBreakdown/Display Adapter. Реализация CA-T-302–306F в объём ADR не входит.
- **Затрагивает:** дизайн §5.3–5.7, §6.2–6.8, §7.7, §9.3–9.5, §10.4, §16.1/§17; ТЗ §5, §7, §12; решения A3/A5/A6/A7/A8; CA-RISK-002, CA-RISK-010; OI-063/OI-067
- **Не затрагивает:** ADR-02 (auth) и ADR-05 (очередь/topology)
- **Связанные ADR:** ADR-01 (SQLite), ADR-03 (backup)

> Обозначения: **[ФАКТ]** — подтверждено документом/кодом; **[ВЫВОД]** — следует из фактов; **[ПРЕДЛОЖЕНИЕ]** — проект решения; **[ВОПРОС ВЛАДЕЛЬЦА]** — требует решения. Рекомендации не являются утверждёнными правилами.

## Статус сверки (2026-11-10)

- **Архитектурный статус:** **ACCEPTED**, действующая редакция — **Rev 11 + §15.7** (APPROVED 2026-11-09). Rev11 не переоткрывается.
- **Статус реализации:** **PARTIAL**.
- **Подтверждено:** контракт `CalculationRequest/Inputs`; DataResolver как единственный сборщик; Engine на inputs; DisplayMetadata/Adapter; server-authoritative CREATE/RECALCULATE; `priceHistory[]`/идемпотентность/атомарная запись; GET snapshot; read-only формулы; 8/8 golden.
- **Остаётся:** полный job/history-слой CA-T-406/407 (BACKLOG); исторические версии catalog/preset (A5 технически не обеспечен); CA-RISK-002 (`calcVersion`/исторические сборки) и CA-RISK-010 (полнота whitelist attrs/parameters) — OPEN; `engine_migration` в scope не входит.
- **Связанные задачи:** CA-T-301–307, 306A–F, 413 — DONE; CA-T-406/407, 412 — BACKLOG/BLOCKED; ADR-06 не объявляет эти задачи реализованными.

---

## 1. Контекст и проблема

**[ФАКТ]** Расчётный движок сегодня — функции `calculatePrice(config)` (`pricing.ts:580`), `calculateKitchenPrice`/`calculateWardrobePrice`, `computeSupports`, `computeLighting`, `validateConfig`. Они принимают только `config` и читают `PRICING`, `PROMOS`, каталоги и константы напрямую из `src/content/*`.

**[ФАКТ]** `PriceBreakdown` (`types.ts:227–242`) содержит `disclaimer` и не содержит версий. `StoredProject` (`types.ts:291–306`) имеет `schemaVersion?`, `calcVersion?`, `pins?`, но **не имеет `priceVersion`**; это целевое поле дизайна §5.1, не реализованное в коде. `ProjectPins` содержит только `catalogVersions`/`presetVersions`.

**[ФАКТ]** Дизайн §9.4 определяет целевой контракт `CalculationRequest` / `CalculationInputs` / `CalculationResult`; §9.5 фиксирует разрыв. В ТЗ §9.4 отсутствует — контракт находится в дизайн-документе.

**Проблема:** без контракта движок недетерминирован относительно версий данных, A5/воспроизводимость не проверяемы, неизвестные атрибуты (CA-RISK-010) могут влиять скрыто.

---

## 2. Связанные решения и ограничения

| Решение | Содержание | Влияние |
|---|---|---|
| **A3** | Формулы только для просмотра | Admin не вызывает формулы; Engine не принимает код |
| **A5** | Изменения справочников/геометрии не меняют старые проекты | целевое: `config` read-only; Reference Data — по pins + доступная историческая версия; параметры — реестр `calcVersion` |
| **A6** | Изменение алгоритмов требует новой `calcVersion` | `calcVersion` — константа сборки; переход — `engine_migration` |
| **A7** | Автоматический пересчёт применяет только Commercial Snapshot | остальные входы фиксированы whitelist |
| **A8** | История стоимости неизменяема | результат с версиями — в историю |
| **ADR-01** | SQLite — единственное хранилище | Engine не читает хранилище; сбор — DataResolver |
| **R-01/Q5** | **Целевое:** `getProject` отдаёт сохранённый снимок без скрытого пересчёта. **Текущий код** пересчитывает цену при чтении (`projects.ts:172–177`) | целевое поведение; не реализовано до CA-T-413 |
| **R-04/OI-063** | Геометрия с `affects.price=true` не редактируется до ADR-04 | ADR-06 не снимает ограничение |
| **R-05/CA-Q-001** | Исторические `calcVersion` сохраняются; нет сборки — блокировка | см. §6; историческое исполнение не реализовано |
| **R-11/Q17** | `calcVersion` = `calc-YYYY.MM.N` | `BUILD_CALC_VERSION` (`versions.ts`) |
| **CA-RISK-002** | политика `calcVersion` | **OPEN**; ADR-06 не закрывает |
| **CA-RISK-010** | перечень attrs→формулы не установлен | fail-closed; **OPEN** |

**[РЕШЕНИЯ ВЛАДЕЛЬЦА, Rev 5]** Зафиксированы для включения в ADR; это не означает, что соответствующая функциональность реализована:
1. **CalculationBreakdown:** отдельный расчётный тип без `disclaimer`; адаптер к `PriceBreakdown` — во внешнем слое.
2. **Версионирование:** `expectedProjectCalcVersion` и `requiredExecutedCalcVersion` — два разных поля; фактическая версия — в результате; обычный пересчёт не меняет версию проекта незаметно.
3. **Исторические справочники:** `CatalogItem`/`ModulePreset` должны иметь неизменяемые исторические версии; проект ссылается на конкретную версию; удаление запрещено при ссылках; физическое хранение — этап реализации.
4. **OperationContext:** `operationId` обязателен; `jobId`/`attemptId` необязательны; это явное отклонение от дизайна §9.4.1, причина — независимость от неутверждённого ADR-05.
5. **Preview:** активная опубликованная версия на момент разрешения DataResolver; выбранный `priceVersion` фиксируется в результате.
6. **PriceRulesInput:** шесть известных полей — полный контракт; неизвестные поля новых снимков отклоняются; legacy — явная нормализация без молчаливого игнорирования.
7. **finishes.rateDelta:** отдельная знаковая корректировка, не смешивается с базовой ценой; применяется только при `config.plinth=true` и ненулевой дельте.
8. **Старые проекты:** при отсутствии версий/исторических данных автоматический пересчёт блокируется; присвоение текущих версий запрещено; миграция/retro-certification — отдельная явная аудируемая процедура.

**[ФАКТ]** `BUILD_CALC_VERSION = "calc-2026.11.0"` (`src/lib/configurator/versions.ts`).

---

## 3. Рассмотренные варианты

| Вариант | Суть | Оценка |
|---|---|---|
| **A. Явный `CalculationInputs`** | DataResolver собирает пакет; Engine — чистая функция | **[ПРЕДЛОЖЕНИЕ] выбран** |
| B. Минимальный вход (только snapshot) | каталоги/параметры глобальны | нарушает A5/детерминизм |
| C. Engine читает хранилище | без DataResolver | БД/Admin в движке |
| D. Два контракта (кухня/шкаф) | раздельные API | дублирование, нарушение «один контракт» |

Для исторического исполнения рассмотрены: отдельная историческая сборка; запрет обычного пересчёта при несовпадении; несколько версий движка в одной сборке. **[ФАКТ]** механизма исполнения исторических сборок нет; выбор — [ВОПРОС ВЛАДЕЛЬЦА] (§13).

---

## 4. Границы слоёв

**[ПРЕДЛОЖЕНИЕ]**

| Слой | Отвечает | Не делает |
|---|---|---|
| **Calculation Engine** | чистый детерминированный расчёт по `CalculationRequest`; возвращает `CalculationResult`; штампует фактическую `BUILD_CALC_VERSION` | не читает БД/ФС/API/Admin/глобальные справочники; не выбирает версии; не знает о pins/StoredProject/очереди; не меняет `config` |
| **DataResolver** | единственная сборка `CalculationInputs`: разрешение прайса, каталогов/пресетов по pins, параметров по `calcVersion`; проверки существования/целостности/классификации | не считает; не принимает коммерческих решений; не подменяет версии |
| **Operation Layer / Caller** | `OperationContext`, идентификаторы, preflight-проверки версий, вызов DataResolver/Engine, сохранение результата/истории | не собирает inputs в обход DataResolver; не меняет формулы |
| **Calculation Admin** | параметры/справочники/прайс, `pending_release` | не вызывает Engine, не редактирует код |

**Поток:** Caller/Operation Layer → OperationContext → DataResolver (StoredProject/pins/version resolution) → `CalculationRequest` → Engine → `CalculationResult` → Operation Layer (persist/audit/history).

**[ФАКТ]** Storage Adapter (`src/lib/server/storage/*`) находится за DataResolver и совместим с ADR-01.

---

## 5. Контракт

### 5.1. Operation Context (не Engine)

**[ПРЕДЛОЖЕНИЕ]** `OperationContext` — orchestration-данные; Engine их не получает.

```ts
type OperationContext = CreateOperation | RecalculateOperation | PreviewOperation;

interface CreateOperation {
  mode: "create";
  operationId: string;             // обязательный идентификатор операции
  jobId?: never; attemptId?: never;
  expectedProjectCalcVersion?: never;
  requiredExecutedCalcVersion?: never;
  expectedSourcePriceVersion?: never;
  targetPriceVersionId?: never;    // target = активная published, выбирает DataResolver
}

interface RecalculateOperation {
  mode: "recalculate";
  operationId: string;              // обязательный идентификатор операции
  jobId?: string;                   // опционально: принадлежит Operation Layer/ADR-05
  attemptId?: string;               // опционально: принадлежит Operation Layer/ADR-05
  targetPriceVersionId: string;    // версия-цель операции; не «последняя по дате»
  expectedProjectCalcVersion: string;   // ожидаемая сохранённая версия проекта
  requiredExecutedCalcVersion: string;  // требуемая версия исполняющего движка
  expectedSourcePriceVersion: string | null; // источник, не target; см. 5.5
}

interface PreviewOperation {
  mode: "preview";
  operationId: string;             // обязательный идентификатор операции
  jobId?: never; attemptId?: never;
  expectedProjectCalcVersion?: never;
  requiredExecutedCalcVersion?: never;
  expectedSourcePriceVersion?: never;
  targetPriceVersionId?: never;
}
```

`create`/`recalculate` соответствуют дизайну §9.4.5; `preview` упомянут в §9.3/§9.4 как вызывающий без сохранения. `operationId: string` обязателен во всех трёх операциях. `jobId`/`attemptId` — **необязательные** metadata Operation Layer; это **явное отклонение от дизайна §9.4.1**, где они указаны обязательными при пересчёте. Причина отклонения: контракт Engine не должен зависеть от ещё не утверждённого ADR-05 (queue/topology); точная семантика/обязательность этих полей — ADR-05. Очередь/worker/retry/reconciliation в ADR-06 не проектируются.

**Preview и priceVersion (решение 5):** DataResolver выбирает **активную опубликованную версию на момент разрешения данных** (единственная `published`; не «последняя по дате» и не будущий draft). `PreviewOperation` не содержит селектора версии; выбранный `priceVersion` фиксируется в `CalculationResult.versions.priceVersion` через `priceSnapshot.priceVersion`. Engine не выбирает версию.

### 5.2. Calculation Request (только Engine)

```ts
interface CalculationRequest {
  config: FurnitureConfig;   // stored config (read-only) либо ввод create/preview
  schemaVersion: number;     // уже нормализованный (см. 10.2)
  inputs: CalculationInputs;
}
```

В Request **нет** `mode`, `operationId`, `jobId`, `attemptId`, `expected*`, `targetPriceVersionId`. Engine не различает сценарии; различия реализации — по `config.kind`.

### 5.3. Calculation Inputs

```ts
interface CalculationInputs {
  priceSnapshot: PriceSnapshotInput;
  catalogs: CatalogItemInput[];
  parameters: Record<string, unknown>; // временный контейнер (см. 7.4)
  presets: ModulePresetInput[];
}
```

Состав Engine-входов — только эти четыре группы (с учётом addendum ниже — пятая группа `rulesSnapshot` исключительно в рамках ADR-07). `pins`, `ParameterDependency`, `CalculationReference`, `sortOrder`, `disclaimer`, `usesPriceItems` и очередь в inputs не входят.

**Addendum (2026-11-13, в связи с утверждением ADR-07 — «Управляемые правила комплектации»).** Допускается **пятая группа** `rulesSnapshot`:

```ts
interface CalculationInputs {
  priceSnapshot: PriceSnapshotInput;
  catalogs: CatalogItemInput[];
  parameters: Record<string, unknown>; // временный контейнер (см. 7.4)
  presets: ModulePresetInput[];
  rulesSnapshot?: RulesSnapshotInput; // ADR-07 §10.4; отсутствие — legacy/fail-closed по ADR-07 §10.4–§11.3
}

interface RulesSnapshotInput {
  rulesSnapshotId: string;   // идентификатор неизменяемого снимка (ADR-07 §11.1)
  rules: ManagedRule[];      // полные копии опубликованных правил (ADR-07 §9, §11.1 п.8)
}
```

Границы addendum: (1) группа **optional** — совместимость legacy-входов без неё определяется ADR-07 (§14 п.6: явная нормализация; pinned/fail-closed); (2) `rulesSnapshotId` **не дублируется** вне `inputs`; (3) правила **не являются ценами**: `priceSnapshot`/`priceVersion` не меняются, `rulesSnapshot` не входит в `PricingVersion`; (4) остальные решения, группы, fail-closed-проверки и состав `CalculationResult` настоящего ADR **не пересматриваются**; детальная типизация `ManagedRule` и коды ошибок — ADR-07 и этап реализации.

### 5.4. Семантика `expected*` (устранение неоднозначности, 3.1)

| Понятие | Определение | Проверка |
|---|---|---|
| `projectCalcVersion` | `StoredProject.calcVersion` — версия, сохранённая в проекте | читается из проекта |
| `executedCalcVersion` | реализация движка, фактически исполняющая расчёт | `BUILD_CALC_VERSION` процесса |
| `expectedProjectCalcVersion` | версия проекта, которую Caller ожидает на старте операции | `projectCalcVersion === expectedProjectCalcVersion` |
| `requiredExecutedCalcVersion` | версия исполняющего движка, которую требует Caller | `executedCalcVersion === requiredExecutedCalcVersion` |

Правила:
1. Для ordinary recalculate **обе** проверки обязательны и независимы: сохранённая версия проекта сверяется с ожидаемой; исполняющая версия — с требуемой. Одно поле не используется для двух проверок.
2. Ordinary recalculate допускается только при `expectedProjectCalcVersion === requiredExecutedCalcVersion === executedCalcVersion`. При любом несовпадении обычный `recalculate` **блокируется**; `engine_migration` не является fallback или альтернативным действием текущего контракта. Возможность `engine_migration` может рассматриваться только в будущем, после отдельного решения и утверждения владельцем; в текущий `OperationContext`/API/реализацию она не добавляется.
3. `expectedProjectCalcVersion` не передаётся в Engine; `requiredExecutedCalcVersion` — тоже. Engine всегда возвращает фактическую `executedCalcVersion`.
4. Для create/preview оба поля запрещены; Engine всё равно штампует фактическую версию.
5. Модель двух полей утверждена решением владельца (Rev 5, решение 2); изменение семантики — новое архитектурное решение, не часть ADR-06.

### 5.5. `expectedSourcePriceVersion` (C-02, 4.1)

| Понятие | Смысл | Статус |
|---|---|---|
| `storedProject.priceVersion` | версия, которой посчитана сохранённая цена | **отсутствует в `StoredProject`** (целевое поле; разрыв реализации) |
| `targetPriceVersionId` | версия-цель операции | OperationContext |
| `resolvedPriceVersionId` | фактически разрешённая DataResolver версия | `priceSnapshot.priceVersion` |
| `expectedSourcePriceVersion` | ожидаемая source-версия проекта до операции | OperationContext |

Правила: source — не target; сверка source выполняется под защитой от гонок (детали — Phase 4); несовпадение — `ENGINE_CONTRACT_STALE_SOURCE_PRICE_VERSION`, без молчаливой подмены. Null допустим только для legacy без `priceVersion`; пересчёт такого проекта блокируется до решения владельца. Целевая версия обязана совпасть с `resolvedPriceVersionId`, иначе `ENGINE_CONTRACT_PRICE_VERSION_TARGET_MISMATCH`. Create/preview не имеют source expectation. **Preview** использует активную published на момент разрешения DataResolver (решение 5); выбранная версия фиксируется в `priceSnapshot.priceVersion` и результате. Engine никогда не выбирает published/последнюю сам. Полный preflight **не реализован**, пока нет `StoredProject.priceVersion`.

### 5.6. Calculation Result

```ts
interface CalculationBreakdown {
  currency: "RUB";
  baseCost: number;
  bodyCost: number;
  frontsCost: number;
  fittingsCost: number;
  optionsCost: number;
  complexityFactor: number;
  subtotal: number;
  discount: number;
  total: number;
  minOrderApplied: boolean;
  lines: CalculationLine[]; // §15.7: стабильные ID + числовой payload
  promo: PromoResult | null;
}

interface CalculationResult {
  breakdown: CalculationBreakdown; // расчётная часть; disclaimer отсутствует
  versions: {
    schemaVersion: number;       // из Request
    calcVersion: string;         // фактически исполненная BUILD_CALC_VERSION
    priceVersion: string;        // priceSnapshot.priceVersion
  };
  usedPriceItems?: { id: string; amount: number }[]; // OI-067; опционально
}
```

`CalculationBreakdown` — самостоятельная расчётная структура (не `Omit`); `PriceBreakdown` (`types.ts:227–242`) остаётся публичным display/persisted типом и не меняется. Внешний adapter преобразует `CalculationBreakdown` в `PriceBreakdown` и добавляет `disclaimer`. **Решение владельца (Rev 5, решение 1):** это целевой контракт; миграция типов ещё не выполнена. Engine **не** получает, не вычисляет и не возвращает disclaimer; историческую `calcVersion` по переданному ожиданию тоже не возвращает.

**Уточнение Rev 11 addendum §15.7:** поле `lines` типизировано как `CalculationLine[]` (стабильные ID + числовые данные), а не `PriceLine[]`. Остальные поля `CalculationBreakdown` и внешний `PriceBreakdown` не меняются.

### 5.7. Граница расчётных и display-only данных (3.4)

`PriceSnapshotInput` не содержит `disclaimer`:

```ts
interface PriceRulesInput {
  rounding: number;
  minOrder: number;
  complexityPerExtraModule: number;
  complexityMax: number;
  bodyDepthReference: number;
  bodyFactor: number;
}

type PlinthAdjustmentKey = `plinth:${string}:${string}`;

interface SignedAdjustmentInput {
  key: PlinthAdjustmentKey;   // «plinth:<materialId>:<finishId>»
  amount: number;             // signed: может быть отрицательным
}

interface PriceSnapshotInput {
  priceVersion: string;       // id PricingVersion
  snapshot: readonly { priceItemId: string; amount: number }[];
  rules: PriceRulesInput;     // полный контракт: шесть подтверждённых полей
  signedAdjustments: readonly SignedAdjustmentInput[];
  promos: readonly PromoDefinition[];
  baseSchema: number;         // совместимость структуры снимка
}
```

**Типизация `rules` (2.5, решение 6).** Шесть ключей — полный подтверждённый контракт: `rounding`, `minOrder`, `complexityPerExtraModule`, `complexityMax`, `bodyDepthReference`, `bodyFactor`. **[ФАКТ]** Импорт формирует ровно эти шесть (`import.ts:732–741`); остальные `PRICING.*` — ставки/мёртвые поля, а не rules. Неизвестные ключи новых снимков отклоняются (`ENGINE_CONTRACT_UNKNOWN_ATTRIBUTE`); legacy нормализуется явно: известные шесть маппятся, дополнительные ключи не отбрасываются молча — операция блокируется до миграции/подтверждения. `Record<string, unknown>` для rules не допускается.

**`finishes.rateDelta` (решение 7).** Представляется как `SignedAdjustmentInput` с отрицательным/положительным `amount`, отдельно от `snapshot`; применяется только на ценовом пути `config.plinth=true` и при ненулевой дельте. Базовая цена и корректировка не смешиваются. Текущий импорт исключает `rateDelta`; до реализации поля/адаптера соответствующие ценовые операции не считать полностью поддержанными (см. §9.4). Для legacy-снимков без `signedAdjustments` DataResolver выполняет явную нормализацию; если ненулевая дельта необходима, её отсутствие — fail-closed, а не ноль по умолчанию.

**[ФАКТ]** Сейчас `calculatePrice` записывает `PRICE_DISCLAIMER` в `PriceBreakdown.disclaimer`; это presentation-константа. **[РЕШЕНИЕ ВЛАДЕЛЬЦА, Rev 5, п.1]** в контракте Engine возвращает `CalculationBreakdown` (без `disclaimer`), а display/save layer добавляет disclaimer в `PriceBreakdown` при формировании отображаемого/сохраняемого результата; содержание и бизнес-логика отображения не меняются. Адаптер к `PriceBreakdown` реализуется во внешнем слое (решение 1); миграция типов — этап реализации, не часть утверждения ADR.


### 5.8. Контракт входов CA-T-302 (Rev 10)

Источник полей — фактический код `src/content/*`, `src/lib/admin/import.ts`, `src/lib/admin/schema.ts`; цены — `PriceItem` из `PricingVersion.snapshot`. Все поля ниже — **Engine-facing**; статусы, версии, timestamps и display-метаданные остаются DataResolver.

#### 5.8.1. CatalogItemInput

```ts
type CatalogKind =
  | "bodyMaterial" | "facadeMaterial" | "facadeStyle" | "handle"
  | "countertop" | "plinthMaterial" | "plinthFinish" | "plinthMount"
  | "supportSystem" | "ledStrip" | "ledProfile" | "ledDiffuser"
  | "ledControl" | "ledPsu" | "sinkSize" | "promo";

type PriceItemId = string;
type EmptyAttrs = Record<never, never>;
type EmptyPriceRefs = Record<never, never>;

interface Item<K extends CatalogKind, A, R> {
  id: string;
  catalog: K;
  attrs: A;
  priceRefs: R;
}

interface CountertopAttrs {
  thicknesses: readonly number[];
  defaultThickness: number;
}
interface PlinthAttrs extends CountertopAttrs {
  finishIds: readonly string[];
}
interface SupportAttrs {
  edgeInsetCm: number;
  maxSpanCm: number;
  maxLoadKgPerLeg: number;
  clipsPerLeg: number;
  screwsPerLeg: number;
  tallAnchorSpacingCm: number;
  tallCenterLegWidthCm: number;
}
interface LedStripAttrs {
  power: number;
  voltage: 12 | 24;
  maxContinuousRunM: number;
  voltageDropPct: number;
  maxPsuW: number;
}
interface IdAttrs { id: string }
interface PsuAttrs { watt: number }

type CatalogItemInput =
  | Item<"bodyMaterial", EmptyAttrs, { ratePerSqm: PriceItemId }>
  | Item<"facadeMaterial", EmptyAttrs, { ratePerSqm: PriceItemId }>
  | Item<"facadeStyle", EmptyAttrs, { multiplier: PriceItemId }>
  | Item<"handle", EmptyAttrs, { rate: PriceItemId }>
  | Item<"countertop", CountertopAttrs, { ratePerLinearMeter: PriceItemId }>
  | Item<"plinthMaterial", PlinthAttrs, { ratePerMeter: PriceItemId }>
  | Item<"plinthFinish", IdAttrs, EmptyPriceRefs>
  | Item<"plinthMount", IdAttrs, EmptyPriceRefs>
  | Item<"supportSystem", SupportAttrs, {
      legPrice: PriceItemId;
      clipPrice: PriceItemId;
      screwPrice: PriceItemId;
      anchorPrice: PriceItemId;
    }>
  | Item<"ledStrip", LedStripAttrs, { pricePerMeter: PriceItemId }>
  | Item<"ledProfile", IdAttrs, { ratePerMeter: PriceItemId }>
  | Item<"ledDiffuser", IdAttrs, { ratePerMeter: PriceItemId }>
  | Item<"ledControl", IdAttrs, { price: PriceItemId }>
  | Item<"ledPsu", PsuAttrs, { price: PriceItemId }>;
```

**Обязательные роли и ID-шаблоны:**

| CatalogKind | Обязательные priceRefs | ID-шаблон |
|---|---|---|
| `bodyMaterial` | `ratePerSqm` | `catalog.body.<id>.ratePerSqm` |
| `facadeMaterial` | `ratePerSqm` | `catalog.facade.<id>.ratePerSqm` |
| `facadeStyle` | `multiplier` | `catalog.facadeStyle.<id>.multiplier` |
| `handle` | `rate` | `catalog.handle.<id>.rate` |
| `countertop` | `ratePerLinearMeter` | `catalog.countertop.<id>.ratePerLinearMeter` |
| `plinthMaterial` | `ratePerMeter` | `catalog.plinth.<id>.ratePerMeter` |
| `supportSystem` | `legPrice`, `clipPrice`, `screwPrice`, `anchorPrice` | `catalog.support.<system>.<role>` |
| `ledStrip` | `pricePerMeter` | `lighting.strip.<id>` |
| `ledProfile` | `ratePerMeter` | `lighting.profile.<id>` |
| `ledDiffuser` | `ratePerMeter` | `lighting.diffuser.<id>` |
| `ledControl` | `price` | `lighting.control.<id>` |
| `ledPsu` | `price` | `lighting.psu.<watt>` |
| `plinthFinish` | — (signedAdjustment) | — |
| `plinthMount` | — | — |
| `sinkSize` | **OPEN:** content-структура не найдена; в Engine не передаётся до определения | — |
| `promo` | — (живёт в `PricingVersion.promos`, не CatalogItem) | — |

Attrs по видам: `bodyMaterial`/`facadeMaterial`/`facadeStyle`/`handle` — `EmptyAttrs`; `countertop` — толщины/дефолт; `plinthMaterial` — толщины/дефолт/finishIds; `supportSystem` — геометрия/нагрузки; `ledStrip` — технические поля; `plinthFinish`/`plinthMount`/`ledProfile`/`ledDiffuser`/`ledControl` — только `id`; `ledPsu` — `watt`. `sinkSize`/`promo` не входят в Engine input.

#### 5.8.2. ModulePresetInput

```ts
interface DimensionRange {
  min: number;
  max: number;
  default: number;
}

interface ModulePresetInput {
  id: string;
  family: "kitchen" | "wardrobe";
  zone: "floor" | "upper";
  width: DimensionRange;
  height: DimensionRange;
  depth: DimensionRange;
  defaultShelves: number;
  defaultDrawers: number;
  priceRef: PriceItemId;
}
```

**Единая цепочка:** `ModulePreset.priceRef → PriceItem.id → PriceSnapshot.snapshot.amount`; других источников цены нет. `KITCHEN_MODULES.basePrice` — **только источник миграции** в PriceItem `kitchen.module.<id>.basePrice`; в Engine не передаётся.

| Content preset | PriceItem ID | priceRef |
|---|---|---|
| `base` | `kitchen.module.base.basePrice` | тот же id |
| `sink` | `kitchen.module.sink.basePrice` | тот же id |
| `hob` | `kitchen.module.hob.basePrice` | тот же id |
| `drawers` | `kitchen.module.drawers.basePrice` | тот же id |
| `wall` | `kitchen.module.wall.basePrice` | тот же id |
| `tall` | `kitchen.module.tall.basePrice` | тот же id |
| `oven` | `kitchen.module.oven.basePrice` | тот же id |
| `bottle` | `kitchen.module.bottle.basePrice` | тот же id |

**[ФАКТ]** Content `KITCHEN_MODULES` не содержит `priceRef`; `import.ts:860–866` отмечает эти пресеты как `unresolved`. Миграция должна создать/связать `ModulePreset.priceRef` с указанными PriceItem; сопоставление по имени/сумме запрещено. Wardrobe-пресеты content отсутствуют — OPEN.

#### 5.8.3. SignedAdjustmentInput

Ключ: **`plinth:<materialId>:<finishId>`**. Значение — `PlinthFinish.rateDelta` (`plinth.ts:14–19,131–137`), знаковое; отрицательные допустимы.

Нормализация:
1. Для каждой пары material/finish создаётся ровно одна корректировка, включая `amount: 0`; это позволяет отличить «нет данных» от нуля.
2. Legacy-снимки без `signedAdjustments`: DataResolver выполняет явную миграцию из `PLINTH_MATERIALS`; отсутствие обязательной ненулевой дельты — fail-closed.
3. Дубликаты ключа, отсутствие ключа при `config.plinth=true` и ненулевой дельте, или неоднозначная пара material/finish — отказ.
4. Не смешивать с `PriceItem.amount`; `amount ≥ 0` для PriceItem не применяется к signed.

#### 5.8.4. LED-классификация

| Элемент | Категория | Источник | Потребитель/единица |
|---|---|---|---|
| `LED_STRIPS.pricePerMeter` | PriceSnapshot | `lighting.ts:124–145` | `computeLighting:250`, ₽/м |
| `LED_PROFILES.ratePerMeter` | PriceSnapshot | `lighting.ts:22–48` | `:258`, ₽/м |
| `LED_DIFFUSERS.ratePerMeter` | PriceSnapshot | `lighting.ts:50–71` | `:266`, ₽/м |
| `LED_CONTROLS.price` | PriceSnapshot | `lighting.ts:73–100` | `:304`, ₽/шт |
| `LED_PSU_PRICE[rating]` | PriceSnapshot | `lighting.ts:104–114` | `:295`, ₽/шт |
| `LED_END_CAP_PRICE` | PriceSnapshot | `lighting.ts:116` | `:275`, ₽/шт |
| `LED_CONNECTOR_PRICE` | PriceSnapshot | `lighting.ts:117` | `:285`, ₽/шт |
| `LED_INSTALL_PRICE_PER_METER` | PriceSnapshot | `lighting.ts:118` | `:312`, ₽/м |
| `LED_PSU_MARGIN`, `LED_PSU_MARGIN_LOW` | Engine parameter | `lighting.ts:121–122` | `:224–225`, коэффициент |
| `LED_END_MARGIN_CM` | Engine parameter | `lighting.ts:20` | `:152`, см |
| `LED_PSU_RATINGS` | Engine parameter | `lighting.ts:102` | `:227–228`, Вт |
| `LED_POWERS`, `LED_VOLTAGES`, `LED_COLOR_TEMPS` | Config domain | `lighting.ts:15–17` | schema/UI |
| `LED_STRIPS.maxContinuousRunM/voltageDropPct/maxPsuW` | Reference Data | `lighting.ts:124–145` | `computeLighting` |
| `LED_STRIPS.source` | Metadata | `lighting.ts:124–145` | diagnostic/UI |

#### 5.8.5. Версии в контракте

`priceVersion` находится в `PriceSnapshotInput`; `schemaVersion` — в `CalculationRequest`; `calcVersion` — фактическая в `CalculationResult.versions`. Полная версионная тройка контракта:

```ts
interface CalculationVersions {
  schemaVersion: number;
  calcVersion: string;
  priceVersion: string;
}
```

Помещать `calcVersion` в `PriceSnapshotInput`/`CalculationInputs` нельзя: это нарушит §5.2/§5.6. `baseSchema` остаётся полем совместимости снимка, а не заменой трёх версий.

#### 5.8.6. Fail-closed проверки DataResolver

1. `priceVersion` существует; `snapshot` без дублей; все amounts конечны и соответствуют правилам PriceItem.
2. Все обязательные роли `CatalogItemInput.priceRefs` и `ModulePresetInput.priceRef` разрешаются в snapshot; отсутствие/лишняя роль — отказ.
3. Для `supportSystem` — все четыре роли; для `countertop`/`plinthMaterial` — обязательные attrs.
4. `rules` — ровно шесть; неизвестные ключи/legacy extra keys требуют явной нормализации.
5. `signedAdjustments` — ключ `plinth:<material>:<finish>`, уникальность, обязательность для `config.plinth=true`.
6. Pins/версии Reference Data доступны; отсутствие — fail-closed; current fallback запрещён.
7. `schemaVersion`, `baseSchema`, `promos` проверяются до Engine; несовместимость — отказ до расчёта.
8. Engine не читает `content/*`, Admin, БД/ФС/API.

---

## 6. Версионирование, совместимость и миграция

### 6.1. Три независимые версии

| Версия | Что означает | Кто меняет | Влияние |
|---|---|---|---|
| `schemaVersion` | структура проекта | разработка (миграции) | миграция до расчёта |
| `calcVersion` | алгоритмы/формулы/геометрические правила | только релиз | расчёт |
| `priceVersion` | коммерческие ставки/правила/промо | Admin (публикация) | только стоимость |

### 6.2. Историческое исполнение (C-01)

**[ФАКТ]** Механизма хранения/исполнения исторических build нет; ADR-03 включает сборки только в резервирование и оставляет способ/глубину открытыми. **[ПРЕДЛОЖЕНИЕ]:** ordinary recalculate допускается только когда `saved project calcVersion === executed build version`; иначе — блокировка. Engine не может «исполнить» другую версию и не возвращает её. Историческое исполнение — Open Decision (см. §13, п.2); не описывается как доступная возможность.

### 6.3. Обычный пересчёт vs обновление цены vs engine_migration (4.2)

| Операция | `calcVersion` | `priceVersion` | Что меняется | Условие |
|---|---|---|---|---|
| **Обычный пересчёт** | не меняется; должна совпадать с executed | новая/указанная версия прайса | только стоимость (Commercial Snapshot) | обе проверки §5.4; pins/ref data доступны |
| **Обновление цены** | не меняется | публикация/указание версии | только стоимость | не является миграцией алгоритма |
| **`engine_migration`** | меняется на новую сборку | по правилам операции | алгоритм/правила; история `prevCalcVersion` | отдельное явное согласие владельца; не побочный эффект публикации |

**`engine_migration` не входит в v1 `OperationContext` и в текущий scope CA-T-301.** В Rev 8 новый вариант контекста не добавляется; контракт, правила и реализация миграции требуют отдельного решения и согласования. **CA-RISK-002 остаётся OPEN**; ADR-06 не утверждает механизм миграции. Публикация прайса не меняет `calcVersion`.

### 6.4. Legacy и отсутствующие версии (4.3)

- `schemaVersion` отсутствует → применяется единое правило §10.2 (явный `project.schemaVersion` → `config.version`, если integer ≥ 1 → `SUPPORTED_SCHEMA_VERSION`); литерал `1` автоматически не подставляется. Присутствующий, но невалидный `project.schemaVersion` — fail-closed без fallback.
- `calcVersion` отсутствует → обычный пересчёт блокируется до подтверждения/сертификации; автоматически не восстанавливается.
- `priceVersion` отсутствует → показывается сохранённая цена с пометкой; пересчёт блокируется до решения владельца.
- pins отсутствуют/неполны → §9; актуальные справочники не подставляются.
- Никакого автоматического восстановления отсутствующих версий/pins.

---

## 7. Классификация данных и whitelist

### 7.1. Категории

**[ПРЕДЛОЖЕНИЕ]** Пять категорий с подклассом:

1. **Project Configuration** — `StoredProject.config`.
2. **Commercial Snapshot** — `priceSnapshot` (priceVersion/snapshot/rules/signedAdjustments/promos/baseSchema; disclaimer — display layer, §5.7).
3. **Reference Data** — `CatalogItem` (неценовые attrs), `ModulePreset` (геометрия/дефолты), `finishes` (если не ценовая дельта).
4. **Calculation Rules / parameters (3a)** — реестр параметров сборки; `SINK_RULES`, допуски, LED-константы, лимиты; `calcVersion`.
5. **Display-only / Metadata** — `sortOrder`, лейблы, группы, UI-порядок, disclaimer.

**[ФАКТ по sortOrder, 3.8]** В коде `sortOrder` встречается только в `src/lib/admin/schema.ts`, `src/lib/admin/catalogs.ts` и admin-UI; `src/lib/configurator/*` его не читает. **[ВЫВОД]** на расчёт он не влияет, изменение не затрагивает старые проекты; классификация — **display-only**. В §7.7 дизайна он упомянут в Reference Data — источник противоречив; фактическое использование (`src/lib/admin/schema.ts`, `catalogs.ts`, `CatalogSection.tsx`) подтверждает display-only, на расчёт и старые проекты не влияет. Классификация зафиксирована по факту кода.

### 7.2. Входы: подтверждено / временно / запрещено (3.3)

| Категория | Поля | Статус |
|---|---|---|
| **Подтверждённые входы** | `priceSnapshot.priceVersion/snapshot/rules (PriceRulesInput)/signedAdjustments/promos/baseSchema`; `presets` геометрия `width/height/depth/defaultShelves/defaultDrawers/zone`; `catalogs` id/catalog/version/status; `parameters` только id из подтверждённого реестра | разрешено после реализации и тестов |
| **Временные контейнеры, требующие аудита** | `catalogs[].attrs`; `parameters` значения (типы/ключи) | форма контракта есть; **потребление Engine блокируется до аудита/whitelist** |
| **Запрещено до подтверждения** | неизвестные attrs/parameters; неизвестные `rules`; `disclaimer`; `sortOrder`; `ParameterDependency`; `CalculationReference`; любые wildcard-поля | не передаётся Engine |

**Правила:** wildcard запрещён; неизвестный атрибут не становится входом автоматически; отсутствие обязательного входа — fail-closed; CA-RISK-010 остаётся OPEN; whitelist не считается завершённым до аудита.

### 7.3. Состав Inputs по элементам (S-02)

| Элемент | Engine | DataResolver | Display-only | Версия/pins |
|---|---|---|---|---|
| `priceSnapshot` | да | собирает | нет | `priceVersion` |
| `catalogs` (attrs) | только классифицированные | разрешает по pins | нет | pins + version |
| `presets` (геометрия) | да (подтверждённые поля) | разрешает по pins | нет | pins + version |
| `parameters` | только классифицированные | реестр `calcVersion` | нет | `calcVersion` |
| `finishes.rateDelta` | знаковая корректировка через `signedAdjustments` (цель); **сейчас не представлено** | snapshot/import | нет | `priceVersion` (цель); отдельный pin не подтверждён |
| `sortOrder` | нет | UI only | да | нет |
| `ParameterDependency` | нет | диагностика/классификация | нет | нет |
| `CalculationReference` | нет | диагностика/UI | нет | нет |
| `ProjectPins` | нет | да | нет | сами версии |
| `disclaimer` | нет | display/save layer | да | presentation |

### 7.4. Типизация (S-01)

- `PriceSnapshotInput` типизирован; `rules: PriceRulesInput` — полный контракт из шести ключей (`rounding`, `minOrder`, `complexityPerExtraModule`, `complexityMax`, `bodyDepthReference`, `bodyFactor`); неизвестный ключ → fail-closed; legacy — явная нормализация (решение 6). `signedAdjustments` — отдельный знаковый список (решение 7).
- `catalogs[].attrs` и `parameters` остаются `Record<string, unknown>` **временно**: полный состав не подтверждён (CA-RISK-010). Это не разрешение использовать их целиком; Engine-потребление — только через подтверждённую проекцию/реестр, реализация этой части заблокирована.
- `promos` — явный `PromoDefinition`; Engine использует состояние снимка, а не live-статус.

### 7.5. Whitelist

`priceSnapshot` — поля выше; `catalogs`/`presets` — только подтверждённые attrs/поля; `parameters` — только id реестра `calcVersion`. Запрещено: wildcard, автоматическое включение, `config` в inputs, выбор `calcVersion`, чтение «живых» каталогов/параметров при пересчёте. Полнота проверяется диагностикой; отсутствие классификации — дефект.

---

## 8. Неизвестные атрибуты (CA-RISK-010) и словарь кодов

**[ФАКТ]** Полный перечень attrs→формулы не установлен (§7.7). CA-RISK-010 **OPEN**.

**Fail-closed:** новый атрибут не становится входом без классификации; поле, читаемое движком, но отсутствующее в реестре, — ошибка полноты; поле во входе без класса — отказ DataResolver; display-only только при явной классификации; публикация/пересчёт блокируются при неполноте; Engine не импортирует `src/content/*` после миграции.

**Единый словарь кодов (3.9; целевой контракт, не реализация):**

| Код | Когда |
|---|---|
| `ENGINE_CONTRACT_MISSING_INPUT` | обязательный вход отсутствует |
| `ENGINE_CONTRACT_UNKNOWN_ATTRIBUTE` | неизвестное поле в расчётном классе |
| `ENGINE_CONTRACT_UNCLASSIFIED_ATTRIBUTE` | поле без классификации |
| `ENGINE_CONTRACT_DEPENDENCY_INCOMPLETE` | неполный whitelist/граф |
| `ENGINE_CONTRACT_DEPENDENCY_INTEGRITY` | дубли/осиротевшие/циклы |
| `ENGINE_CONTRACT_INCOMPATIBLE_SCHEMA` | `schemaVersion` несовместима |
| `ENGINE_CONTRACT_PROJECT_CALC_VERSION_MISMATCH` | сохранённая версия ≠ ожидаемой |
| `ENGINE_CONTRACT_EXECUTED_CALC_VERSION_MISMATCH` | исполняемая версия ≠ требуемой |
| `ENGINE_CONTRACT_CALC_VERSION_INCOMPATIBLE` | проект и исполняемая сборка не совпадают для ordinary recalc |
| `ENGINE_CONTRACT_CALC_VERSION_UNKNOWN` | legacy без `calcVersion` (до политики) |
| `ENGINE_CONTRACT_CALC_VERSION_UNAVAILABLE` | сборка недоступна |
| `ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE` | целевая/source версия прайса недоступна |
| `ENGINE_CONTRACT_PRICE_VERSION_TARGET_MISMATCH` | resolved ≠ target |
| `ENGINE_CONTRACT_STALE_SOURCE_PRICE_VERSION` | source ≠ ожидаемой |
| `ENGINE_CONTRACT_PINS_UNRESOLVED` | pin не разрешается |
| `ENGINE_CONTRACT_REFERENCE_VERSION_UNAVAILABLE` | версия Reference Data недоступна |
| `ENGINE_CONTRACT_REFERENCE_INTEGRITY` | нарушена целостность версии |
| `ENGINE_CONTRACT_INTERNAL` | только неожиданное неклассифицированное внутреннее исключение Engine |

Детерминированные нарушения контракта обязаны возвращать конкретный код из таблицы; `ENGINE_CONTRACT_INTERNAL` не используется для ожидаемых ошибок. Все упоминания в тексте используют только эти имена. **Закрытие CA-RISK-010** требует полного whitelist, негативных тестов и согласия владельца; текст ADR не закрывает риск.

---

## 9. Инвариант A5 и Reference Data

### 9.1. A5

1. `config` — единственный источник конструкции; Engine/пересчёт не пишут в него.
2. Reference Data пересчёта разрешается строго по `StoredProject.pins`; актуальные значения не подставляются.
3. Параметры — из реестра `calcVersion`, не из `AdminParameter.value`.
4. Обычный пересчёт меняет только Commercial Snapshot и стоимость.
5. `engine_migration` — **потенциальная отдельная операция будущего scope**, требующая отдельного решения/утверждения; в v1 OperationContext и текущий scope CA-T-301 не входит.
6. Legacy без pins — `pinsInferred`; автоподстановка запрещена; политика владельца.
7. OI-063/R-04: геометрия с `affects.price=true` остаётся `readonly`.

### 9.2. Pins не заменяют исторические версии (3.6)

**[ФАКТ]** Сейчас `CatalogItem`/`ModulePreset` хранятся как текущие записи коллекций; отдельной истории версий не найдено. **[ВЫВОД]** `ProjectPins` фиксируют номера версий, но **не обеспечивают восстановление** исторического объекта. **[РЕШЕНИЕ ВЛАДЕЛЬЦА, Rev 5, п.3]** целевое требование: `CatalogItem`/`ModulePreset` имеют неизменяемые исторические версии; проект ссылается на конкретную версию; удаление запрещено, пока есть ссылки; физическое хранение — этап реализации. До реализации A5 не считается технически обеспеченным; при недоступности версии — fail-closed. Механизм физического хранения не проектируется в ADR-06.

### 9.2.1. Логическая форма pin и выбор Reference Data (решение 3)

**[ПРЕДЛОЖЕНИЕ]** Без проектирования физических таблиц фиксируется логическая связь «сущность + версия»:

```ts
interface ProjectPins {
  catalogVersions?: {
    [catalog: string]: { [catalogItemId: string]: string /* immutable version */ };
  };
  presetVersions?: {
    [family: string]: { [presetId: string]: string /* immutable version */ };
  };
}
```

- Pin для `CatalogItem` адресует пару `(catalog, id)` и конкретную неизменяемую `version`; pin для `ModulePreset` — пару `(family, id)` и `version`. Версия в pin должна разрешаться в конкретную сохранённую версию, а не в текущую запись с тем же id.
- **Новый проект (pins ещё нет):** DataResolver выбирает активную/current версию Reference Data на момент разрешения данных и фиксирует выбранные версии в `StoredProject.pins` при создании/сохранении. Это единственный случай выбора current.
- **Существующий проект:** обязательный pin должен разрешиться в точную версию. Отсутствие pin **не** даёт права подставить текущую версию; это fail-closed/legacy-политика (решение 8).
- Архивная, но сохранённая и целостная версия допустима; статус `archived` сам по себе не делает версию недоступной.
- Физическое хранение версий/снимков — этап реализации в рамках ADR-01; ADR-06 не проектирует таблицы/схему.

### 9.3. Таблица разрешения Reference Data (C-03/S-04)

| Тип | Pin обязателен | Источник версии | Нет pin | Версия недоступна |
|---|---|---|---|---|
| `CatalogItem.attrs` | для пересчёта — да; create — нет pin до выбора current | `pins.catalogVersions[catalog][id]` (значение — immutable version) | legacy: политика владельца; для create — current фиксируется в pins | `ENGINE_CONTRACT_REFERENCE_VERSION_UNAVAILABLE` |
| `ModulePreset` геометрия | для пересчёта — да; create — нет pin до выбора current | `pins.presetVersions[family][id]` (значение — immutable version) | legacy: политика владельца; для create — current фиксируется в pins | `ENGINE_CONTRACT_REFERENCE_VERSION_UNAVAILABLE` |
| `finishes.rateDelta` | отдельный pin не подтверждён | цель — `signedAdjustments` в `priceSnapshot`; **сейчас импорт исключает delta** | — | fail-closed только для `config.plinth=true` и ненулевой дельты (см. 9.4) |
| `sortOrder` | нет | — | display-only | не влияет |
| `ParameterDependency` | нет | — | диагностика | не влияет на Engine |
| `CalculationReference` | нет | — | диагностика/UI | не влияет на Engine |
| `parameters` | нет (не pins) | реестр `calcVersion` | отсутствует ⇒ `ENGINE_CONTRACT_MISSING_INPUT` | сборка недоступна ⇒ блокировка |

**Состояния:**
- нет pin → legacy: пересчёт блокируется, актуальные не используются;
- pin не разрешается → `ENGINE_CONTRACT_PINS_UNRESOLVED`;
- архивная, сохранённая и целостная версия → **допустима**, если запись существует, `version` совпадает, integrity пройдена; статус `archived` сам по себе не основание для отказа;
- нарушена целостность → `ENGINE_CONTRACT_REFERENCE_INTEGRITY`.

### 9.4. `finishes[].rateDelta` (3.7)

**[ФАКТ]** `plinthRatePerMeter(material, finish)` = `ratePerMeter + finish.rateDelta`; `pricing.ts:296` использует это в цене. В `import.ts` `rateDelta` **исключён** из snapshot-импорта: отрицательная дельта несовместима с текущим ограничением snapshot `amount ≥ 0` (валидация `pricing.ts:545`). **[ВЫВОД]** цена зависит от `rateDelta`, но Commercial Snapshot сейчас не может её представить; фактическое противоречие сохраняется до реализации решения 7.

Правила ADR:
1. **[РЕШЕНИЕ ВЛАДЕЛЬЦА, Rev 5, п.7]** `rateDelta` представляется как отдельная знаковая корректировка (`SignedAdjustmentInput`), не смешивается с базовой ценой и не меняет её знак/смысл.
2. Зависимость от `rateDelta` доказана только для ценового пути, где `config.plinth === true` и выбран `plinthMaterial`/`plinthFinish` (kitchen `calculateKitchenPrice`); при `config.plinth === false` или нулевой дельте этот вход не влияет на результат.
3. Fail-closed ограничивается операциями, чей результат/снимок действительно включает этот путь: расчёт/пересчёт проекта с `config.plinth === true` и ненулевой дельтой, а также публикация/валидация версии прайса, предназначенной для таких проектов, если её snapshot не содержит корректной `signedAdjustment`. Не блокировать все операции с plinth/finishes и конфигурации без цоколя.
4. До реализации представления не считать полностью поддержанными соответствующие ценовые операции и A7-гарантию для затронутых конфигураций; отображение сохранённой цены не блокируется.
5. Текущий импорт/схема `PricingVersion` пока не содержат `signedAdjustments`; это разрыв реализации, а не выбор формата.

### 9.5. Коммерческие vs алгоритмические параметры (3.5)

| Тип | Где | Версия | Как попадает в расчёт | `pending_release` |
|---|---|---|---|---|
| Коммерческие ставки/правила/промо | `PricingVersion` | `priceVersion` | `priceSnapshot` | публикация прайса |
| Алгоритмические параметры/константы | реестр параметров сборки | `calcVersion` | `inputs.parameters` по реестру | правка Admin → `pending_release`, активна только с новой сборкой; старым проектам — только migration |
| Reference Data | `CatalogItem`/`ModulePreset` | `version` + pins | `inputs.catalogs/presets` | изменения — для новых; старым — pins |
| Project Configuration | `StoredProject.config` | `schemaVersion` | Request.config | не редактируется |

DataResolver не передаёт старому проекту новые алгоритмические параметры, опубликованные в Admin: он использует реестр `calcVersion` операции; `pending_release` не активен до релиза. Реализация реестра по `calcVersion` пока отсутствует — разрыв, не разрешение использовать live-значения.

**[РЕШЕНИЕ ВЛАДЕЛЬЦА, Rev 11, п.2]** Целевое хранилище технических параметров — **immutable manifests**, версионируемые по `calcVersion`; `AdminParameter.value` не является runtime-источником Engine. Схема manifest, идентификаторы, хэш/целостность и read-path реализуются в CA-T-306B. Полнота whitelist `attrs`/`parameters` остаётся **CA-RISK-010 OPEN**; Rev 11 не закрывает аудит. До реализации CA-T-306B действует текущий разрыв.

---

## 10. Ошибки, импорты, нормализация

### 10.1. Границы импортов (S-06)

- **Engine:** без `node:*`, `@/lib/server/*`, `@/lib/admin/*`, `@/app/*`, БД/ФС/API/Admin; после миграции — без `@/content/*`.
- **DataResolver:** серверный слой (`src/lib/server/data-resolver.ts` по дизайну), доступ к Storage Adapter (ADR-01).
- **Read-only delivery (Rev 11):** клиент получает уже собранные `CalculationInputs` через read-only API/Server Loader; клиентский код не собирает inputs и не импортирует content как runtime-источник.
- Статический контроль — только Engine-модули (`pricing/sink/supports/lighting` + контракт), не весь `src/lib/configurator/*`.
- **[ФАКТ]** Сейчас `pricing.ts` импортирует content; перенос — CA-T-302…306.

### 10.2. Нормализация schemaVersion (S-07)

**[ФАКТ]** `schemaVersion?`; `getProject` использует `schemaVersionOf`/`applyMigrations`. Фактический порядок `schemaVersionOf` (`migrations/index.ts:26–35`): явный `project.schemaVersion` → `config.version` (если integer ≥ 1) → `SUPPORTED_SCHEMA_VERSION`.

**[ПРЕДЛОЖЕНИЕ] единый алгоритм:**
1. Если `project.schemaVersion` **присутствует**: он обязан быть integer ≥ 1; иначе — **fail-closed** (`ENGINE_CONTRACT_INCOMPATIBLE_SCHEMA`) без fallback. Валидное значение используется как есть; если оно больше `SUPPORTED_SCHEMA_VERSION` — fail-closed до Engine.
2. Если `project.schemaVersion` отсутствует: использовать `config.version`, только если это integer ≥ 1; иначе использовать `SUPPORTED_SCHEMA_VERSION` (сейчас 1, но правило не фиксирует литерал 1).
3. Итоговое нормализованное значение обязано быть integer ≥ 1 и ≤ `SUPPORTED_SCHEMA_VERSION`; иначе операция останавливается до Engine.

Нормализация выполняется **один раз** в слое чтения проекта; в Request передаётся явное число. Engine/DataResolver не повторяют fallback. «Отсутствие» само по себе не ошибка (есть fallback), ошибка — невалидное/несовместимое итоговое значение.

### 10.3. Категории ошибок и retry (S-08)

| Категория | Где | Engine | Повтор | Результат |
|---|---|---|---|---|
| Детерминированная ошибка контракта | preflight/Engine | нет при preflight; Engine — только при нарушенном инварианте | без изменения входов/кода — нет | конкретный `ENGINE_CONTRACT_*` (MISSING_INPUT/UNKNOWN_ATTRIBUTE/INCOMPATIBLE_SCHEMA и т.п.); `INTERNAL` — только неожиданное исключение |
| Некорректная конфигурация | до Engine (`validateConfig`) | нет | после исправления | `ok:false + ValidationIssue[]` (save-контракт) |
| DataResolver/Storage (версии/pins/целостность) | preflight | нет | после изменения данных/версии | коды `ENGINE_CONTRACT_*`, retryable=false до изменения |
| Инфраструктура исторической сборки | loader/preflight | нет | после изменения окружения | `ENGINE_CONTRACT_CALC_VERSION_UNAVAILABLE` |
| Транзиентная инфраструктурная ошибка | Operation Layer | возможно | политика Caller; очередь — ADR-05 | retryable-hint, не часть Engine |

`ProjectRecalculation.status` — состояние операции (Phase 4), не тип ошибки Engine. Queue/retry не проектируются.

---

## 11. Последствия и компромиссы

- Меняются сигнатуры/вызовы (`projects.ts`, `leads.ts`, тесты) — Фаза 3.
- Обязательный DataResolver/preflight; `calculatePrice(config)` недостаточен.
- Fail-closed может блокировать операции при неполной классификации.
- Pins без истории Reference Data не обеспечивают A5; целевое требование — неизменяемые исторические версии (решение 3), реализация — отдельный этап.
- Историческое исполнение не появляется; при отсутствии сборки ordinary recalc блокируется.
- `CalculationResult` меняет возвращаемый тип; адаптер к `PriceBreakdown` — этап реализации (решение 1).
- `finishes.rateDelta`: представление решено (отдельная знаковая корректировка), но schema/import ещё не реализуют `signedAdjustments` — разрыв реализации.

---

## 12. Критерии приёмки

### 12.1. Критерии утверждения ADR

| № | Критерий | Проверка |
|---|---|---|
| A1 | Однозначные границы Engine/DataResolver/Operation Layer/Admin | §4 |
| A2 | Разведены schema/calc/price версии | §6 |
| A3 | Семантика OperationContext/Request/Inputs/Result | §5 |
| A4 | `expectedProjectCalcVersion` и `requiredExecutedCalcVersion` не смешаны | §5.4 |
| A5 | Правила pins и ограничение A5 | §9 |
| A6 | Политика неизвестных атрибутов | §8 |
| A7 | Границы и словарь ошибок | §8, §10.3 |
| A8 | Display-only данные исключены из Engine, disclaimer отделён от расчётного breakdown | §5.6–5.7, §7 |
| A9 | Preview использует активную published на момент разрешения; выбранный priceVersion фиксируется в результате | §5.1, §5.5 |

### 12.2. Критерии реализации

| № | Критерий | Метод |
|---|---|---|
| R1 | Один контракт для кухни и шкафа | типы + тест обоих `kind` |
| R2 | Engine не читает хранилище/Admin/content | статический контроль Engine-импортов |
| R3 | Входы собирает только DataResolver | тест единственного сборщика |
| R4 | `executedCalcVersion` фактическая | тест `versions.calcVersion === BUILD_CALC_VERSION` |
| R5 | Result фиксирует версии | тест `versions.*` |
| R6 | Неизвестные атрибуты fail-closed | негативный тест |
| R7 | Whitelist явный/полный | тест реестра |
| R8 | A5 для старых проектов | тест pins + изменение ref data |
| R9 | Legacy без pins/версий — fail-closed | тест `pinsInferred`/блокировка |
| R10 | Обычный `recalculate` не изменяет сохранённый `calcVersion` проекта | Сравнить `StoredProject.calcVersion` до и после операции; проверить, что `result.versions.calcVersion` равен исходной версии проекта |
| R11 | Текущий `OperationContext` не содержит `engine_migration` | Статическая проверка типов и вариантов `OperationContext` из §5.1; поведение будущей миграции не реализуется и не тестируется в CA-T-301 |
| R12 | Несовместимости до Engine | тест preflight + счётчик вызовов = 0 |
| R13 | Disclaimer не входит в Engine inputs/breakdown | тест формы inputs/результата или статический контракт |
| R14 | Pins-состояния (missing/unresolved/archived/integrity) | тесты §9.3 |
| R15 | `finishes.rateDelta`: fail-closed только для `config.plinth=true` и ненулевой дельты | тест затронутого/незатронутого расчёта |

Утверждение ADR не означает прохождение R-критериев; они — DoD CA-T-302…306.

---

## 13. Open Decisions (вопросы владельцу)

После Rev 5 открытыми остаются только вопросы, **не входящие** в восемь утверждённых решений. Восемь решений (CalculationBreakdown, expected-версии, исторические справочники, OperationContext, Preview, PriceRulesInput, finishes.rateDelta, legacy fail-closed) не переоткрываются.

1. **Полнота whitelist `attrs`/`parameters` (CA-RISK-010).**  
   Суть: полный перечень атрибутов `CatalogItem`, реально влияющих на формулы/геометрию/валидацию, и `AdminParameter`, входящих в расчёт, не подтверждён аудитом.  
   Варианты: (A) завершить аудит чтений и зафиксировать реестр; (B) временно ограничить контракт только подтверждённой проекцией; (C) блокировать реализацию потребления до аудита.  
   Последствия: A — полный контракт, дороже; B/C — fail-closed, часть функциональности откладывается.  
   Рекомендация: A с фиксацией реестра; до завершения — B/C.  
   Подтвердить: перечень и правило блокировки. CA-RISK-010 остаётся **OPEN**.

2. **Исторические engine builds.**  
   Суть: способ/глубина хранения сборок и возможность исполнения исторической `calcVersion` не определены; ADR-03 оставляет это открытым.  
   Варианты: (A) отдельное исполнение исторической сборки; (B) запрет ordinary recalc при несовпадении (текущее предложение); (C) multi-version внутри одной сборки.  
   Последствия: A/C требуют инфраструктуры; B сохраняет строгость, но ограничивает пересчёт.  
   Рекомендация: B до появления механизма; A — долгосрочно.  
   Подтвердить: механизм/глубину хранения.

3. **Retro-certification legacy-проектов.**  
   Суть: решение 8 требует отдельной явной аудируемой процедуры, но её состав/условия/ответственный не определены.  
   Варианты: (A) только `engine_migration`; (B) отдельная `retro_certification` с подтверждением; (C) запрет.  
   Последствия: A — минимум операций; B — покрывает legacy, но требует регламента; C — старые проекты остаются только для чтения.  
   Рекомендация: B с историей и подтверждением владельца.  
   Подтвердить: процедуру и её отличие от `engine_migration`.

### 13.1. Зависимости реализации (не Open Decisions)

Следующие вопросы уже решены архитектурно, но ещё не реализованы; они не переоткрываются:

- `StoredProject.priceVersion` отсутствует: поле и source-preflight добавить в Phase 4; до этого проверка не работает.
- `PricingVersion`/schema и импорт не содержат `signedAdjustments`; добавить представление решения 7 без изменения знака/смысла.
- `CatalogItem`/`ModulePreset` не имеют истории версий; реализовать неизменяемые версии и запрет удаления при ссылках (решение 3), физическое хранение — реализация в рамках ADR-01.
- `calculatePrice` возвращает `PriceBreakdown`; адаптер к `CalculationBreakdown` — внешний слой (решение 1).
- `getProject` сейчас пересчитывает цену при чтении; сохранённый снимок — целевое поведение CA-T-413.

---

## 14. Связанные задачи и риски

| Объект | Связь |
|---|---|
| CA-T-301 | проект ADR-06; статус **BLOCKED**, не меняется |
| CA-T-302–305; CA-T-306A–F | реализация контракта/DataResolver/golden/полной миграции; CA-T-306 — parent epic |
| CA-T-307/507 | read-only CalculationReference/UI; вне ADR-06 |
| CA-T-405/412/413 | порядок версий/политика/`getProject` |
| CA-RISK-002 | **OPEN**; политика `calcVersion`/исторические сборки |
| CA-RISK-010 | **OPEN**; ADR задаёт политику, не закрывает |
| OI-063/R-04 | ограничение геометрии сохраняется |
| OI-067 | `usedPriceItems` — опционально, отдельное решение |
| ADR-02/ADR-05 | не затрагиваются |

**Статус решения:** APPROVED (2026-11-09). ADR-06 является действующим контрактом Engine; Phase 3 может выполняться в его рамках. CA-T-301 закрывается по критерию «Подписан»; CA-RISK-002/010 остаются OPEN.

---

## 15. Addendum Rev 11 — Полная миграция (решения владельца)

**Статус:** APPROVED (2026-11-09, решение владельца). Раздел не переоткрывает контракты Rev 5–10; он фиксирует целевое размещение данных и порядок реализации. До выполнения CA-T-306A–F текущее поведение (content/* в Engine, клиентский расчёт, отсутствие реестра параметров) сохраняется и не объявляется соответствующим целевой архитектуре.

### 15.1. Решение 1 — SQLite/Admin как единственный runtime-источник

- SQLite/Admin — единственный **runtime-источник** коммерческих и справочных данных: `PricingVersion`/`PriceItem`, `CatalogItem`, `ModulePreset`, `StoredProject`.
- `content/*` допускается только как источник **первоначального импорта/бутстрапа** (CA-T-306A). После бутстрапа runtime не читает `content/*`; fallback на content запрещён.
- Engine не читает Storage/Admin/FS/API. Сборка данных остаётся за `DataResolver`.
- Исторические версии Reference Data и цены разрешаются по `pins`/`priceVersion`; отсутствие версии — fail-closed.

**Следствия:** CA-T-306A создаёт/наполняет записи Admin; CA-T-306C–E используют только Storage Adapter; CA-T-305 golden fixtures остаются тестовыми эталонами и не являются runtime-источником.

### 15.2. Решение 2 — Immutable parameter manifests по calcVersion

- Технические параметры Engine хранятся в **immutable manifests**, версионируемых по `calcVersion`.
- Manifest содержит только утверждённый набор параметров (whitelist); значения не подменяются live `AdminParameter.value`.
- Изменение manifest — новая `calcVersion`; manifest не мутирует. `pending_release` не становится runtime-значением до выпуска новой сборки.
- Read-path: `DataResolver` получает manifest по `calcVersion` операции и передаёт `parameters` в `CalculationInputs`. Отсутствующий/неполный/несовпадающий manifest — fail-closed.
- Полнота whitelist `parameters`/`attrs` остаётся **CA-RISK-010 OPEN**; CA-T-306B реализует механизм хранения/чтения, но не объявляет аудит завершённым.

**Следствия:** CA-T-306B зависит от CA-T-306A; CA-T-306D использует только `parameters` из контракта; CA-T-306E фиксирует `calcVersion` операции.

### 15.3. Решение 3 — Read-only доставка CalculationInputs

- Клиент получает **готовые** `CalculationInputs` через read-only API/Server Loader.
- `DataResolver` остаётся **единственным** сборщиком `CalculationInputs`; клиент не собирает inputs и не читает content/Admin/Storage напрямую.
- Доставка не пишет данные и не выбирает версии вне `DataResolver`; выбранные `priceVersion`/`calcVersion`/`pins` фиксируются в ответе.
- Контракт `CalculationRequest`/`CalculationInputs` не меняется; способ транспорта (route handler/server loader) — CA-T-306C.

**Следствия:** клиентские вызовы Engine переводятся на полученные inputs; скрытый клиентский content-fallback запрещён; CA-T-306D может сделать `inputs` обязательным для Engine.

### 15.4. Решение 4 — Server-authoritative сохранение

- При сохранении проекта сервер **повторно разрешает** данные через `DataResolver` и выполняет **авторитетный** расчёт Engine; цена/inputs клиента не являются доверенными.
- Сохраняются три независимые версии: `schemaVersion`, `calcVersion`, `priceVersion`; `config`, геометрия и `ProjectPins` не переписываются разрешением данных.
- `expectedProjectCalcVersion` и `requiredExecutedCalcVersion` остаются раздельными; ordinary recalc и `engine_migration` не смешиваются.
- Legacy-проект без `priceVersion` не получает текущую версию автоматически; сохранение/пересчёт блокируется до решения владельца.
- Запись результата и истории — в рамках CA-T-306E; атомарность и порядок версий не переопределяются этим ADR.

**Следствия:** CA-T-306E зависит от CA-T-306D; клиентская цена только для отображения, авторитетная — серверная.

### 15.5. Решение 5 — Декомпозиция CA-T-306

CA-T-306 преобразуется в **parent epic/tracking item** без собственной реализации. Реализация делится на шесть задач в строгой последовательности:

| ID | Задача | Зависимости | Результат |
|---|---|---|---|
| CA-T-306A | Data Bootstrap | 304A, 213, ADR-06 Rev11 | Admin/SQLite наполнены версионированными catalogs/presets/pricing; импорт идемпотентен, отчёт неоднозначностей; runtime content не используется |
| CA-T-306B | Versioned Parameter Registry | 306A, ADR-06 Rev11 | immutable manifests по calcVersion; read-path, целостность, fail-closed; live Admin не используется |
| CA-T-306C | CalculationInputs Delivery | 306B, 304 | read-only API/Server Loader отдаёт готовые inputs; DataResolver — единственный сборщик |
| CA-T-306D | Engine Migration | 306C, 305 | Engine потребляет только inputs; `content/*` удалён из Engine; 8 golden совпадают |
| CA-T-306E | Server-authoritative Persistence | 306D, 107 | сохранение через DataResolver, три версии, авторитетная цена, legacy fail-closed |
| CA-T-306F | Integration & Acceptance | 306E, 305 | end-to-end create/preview/recalculate/save, статические проверки чистоты Engine, полный прогон |

**Порядок:** A → B → C → D → E → F. Нарушение последовательности запрещено. CA-T-307 и остальные задачи не меняют scope.

### 15.6. Инварианты Rev 11

1. Формулы и бизнес-правила не меняются; golden CA-T-305 остаётся контрольным эталоном.
2. `content/*` — только bootstrap; после CA-T-306A runtime fallback запрещён.
3. `DataResolver` — единственный сборщик `CalculationInputs`.
4. `AdminParameter.value` не становится runtime-источником Engine; параметры — только immutable manifest.
5. `expectedProjectCalcVersion` и `requiredExecutedCalcVersion` не смешиваются.
6. `schemaVersion`/`calcVersion`/`priceVersion` независимы.
7. Legacy без `priceVersion` не получает текущую версию автоматически.
8. CA-RISK-002/010 остаются OPEN; Rev 11 не объявляет их закрытыми.

### 15.7. CalculationBreakdown, DisplayMetadata и Display Adapter (APPROVED addendum)

**Статус:** APPROVED (2026-11-09, решение владельца). Раздел уточняет §5.6 только в части `CalculationBreakdown.lines`; остальные положения Rev5–11 не переоткрываются. Реализация CA-T-306D ещё не выполнена.

#### 15.7.1. Engine result

Engine принимает только `CalculationRequest` с `CalculationInputs` и возвращает `CalculationBreakdown`:

```ts
type CalculationLineId =
  | "kitchen.base" | "kitchen.body" | "kitchen.fronts" | "kitchen.fittings"
  | "kitchen.options" | "kitchen.pushToOpen" | "kitchen.plinth"
  | "kitchen.supports" | "kitchen.supportClips" | "kitchen.supportScrews"
  | "kitchen.supportAnchors" | "kitchen.lighting" | "kitchen.lighting.strip"
  | "kitchen.lighting.profile" | "kitchen.lighting.diffuser"
  | "kitchen.lighting.endCaps" | "kitchen.lighting.connectors"
  | "kitchen.lighting.psu" | "kitchen.lighting.control"
  | "kitchen.lighting.install" | "kitchen.supportPreliminary"
  | "kitchen.sidePanels" | "kitchen.complexity" | "kitchen.minOrder"
  | "wardrobe.base" | "wardrobe.body" | "wardrobe.fronts"
  | "wardrobe.fittings" | "wardrobe.options" | "wardrobe.led"
  | "wardrobe.plinth" | "wardrobe.pushToOpen" | "wardrobe.minOrder";

interface LineBase<ID extends CalculationLineId> { id: ID; amount: number }

type CalculationLine =
  | LineBase<"kitchen.base"> | LineBase<"kitchen.pushToOpen">
  | (LineBase<"kitchen.body"> & { moduleCount: number; bodyMaterialId: string })
  | (LineBase<"kitchen.fronts"> & { doors: number; drawers: number })
  | (LineBase<"kitchen.fittings"> & { pushToOpen: boolean })
  | (LineBase<"kitchen.options"> & { countertopMeters: number; shelves: number })
  | (LineBase<"kitchen.plinth"> & {
      lengthM: number; thicknessMm: number; plinthMaterialId: string;
      plinthMountId: string; supportClips: number; supportFrontLegs: number;
    })
  | (LineBase<"kitchen.supports"> & {
      legs: number; frontLegs: number; backLegs: number; supportSystemId: string;
    })
  | (LineBase<"kitchen.supportClips"> & { clips: number })
  | (LineBase<"kitchen.supportScrews"> & { screws: number })
  | (LineBase<"kitchen.supportAnchors"> & { anchors: number; tallAnchorSpacingCm: number })
  | (LineBase<"kitchen.lighting"> & {
      lengthM: number; powerPerMeter: number; voltage: number;
      colorTemp: number; psuW: number;
    })
  | (LineBase<"kitchen.lighting.strip"> & { lengthM: number; powerPerMeter: number; voltage: number })
  | (LineBase<"kitchen.lighting.profile"> & { quantityM: number; profileId: string })
  | (LineBase<"kitchen.lighting.diffuser"> & { quantityM: number; diffuserId: string })
  | (LineBase<"kitchen.lighting.endCaps"> & { endCaps: number })
  | (LineBase<"kitchen.lighting.connectors"> & { connectors: number })
  | (LineBase<"kitchen.lighting.psu"> & { psuW: number; psuCount: number })
  | (LineBase<"kitchen.lighting.control"> & { controlId: string })
  | (LineBase<"kitchen.lighting.install"> & { quantityM: number })
  | LineBase<"kitchen.supportPreliminary">
  | (LineBase<"kitchen.sidePanels"> & { count: number })
  | (LineBase<"kitchen.complexity"> & { factor: number })
  | LineBase<"kitchen.minOrder">
  | LineBase<"wardrobe.base">
  | (LineBase<"wardrobe.body"> & { totalArea: number; bodyMaterialId: string })
  | (LineBase<"wardrobe.fronts"> & { doors: number; facadeMaterialId: string })
  | (LineBase<"wardrobe.fittings"> & { doors: number; drawers: number; softClose: boolean })
  | (LineBase<"wardrobe.options"> & { shelves: number; rods: number; ledLighting: boolean })
  | (LineBase<"wardrobe.led"> & { sections: number })
  | (LineBase<"wardrobe.plinth"> & { widthCm: number })
  | LineBase<"wardrobe.pushToOpen"> | LineBase<"wardrobe.minOrder">;
```

`amount` — уже итоговое округлённое значение текущего `PriceLine.amount`; Adapter не округляет и не пересчитывает. `id` уникален внутри результата; unknown/duplicate ID, unknown payload field, non-finite value или нецелое значение для integer-поля — ошибка результата. `label`, `detail`, `disclaimer`, display group/order в `CalculationBreakdown` запрещены.

#### 15.7.2. DetailSegment

Сегменты типизируются по конкретному `CalculationLineId` через `Extract`:

```ts
type LineOf<ID extends CalculationLineId> = Extract<CalculationLine, { id: ID }>;
type NumericFieldOf<ID extends CalculationLineId> = {
  [K in keyof LineOf<ID>]: LineOf<ID>[K] extends number ? K : never
}[keyof LineOf<ID>];
type StringFieldOf<ID extends CalculationLineId> = {
  [K in keyof LineOf<ID>]: LineOf<ID>[K] extends string ? K : never
}[keyof LineOf<ID>];
type BooleanFieldOf<ID extends CalculationLineId> = {
  [K in keyof LineOf<ID>]: LineOf<ID>[K] extends boolean ? K : never
}[keyof LineOf<ID>];

type CatalogFieldMap = {
  bodyMaterial: "bodyMaterialId";
  facadeMaterial: "facadeMaterialId";
  plinthMaterial: "plinthMaterialId";
  plinthMount: "plinthMountId";
  supportSystem: "supportSystemId";
  ledProfile: "profileId";
  ledDiffuser: "diffuserId";
  ledControl: "controlId";
};
type CatalogLabelSegment<ID extends CalculationLineId> = {
  [C in keyof CatalogFieldMap]:
    CatalogFieldMap[C] extends StringFieldOf<ID>
      ? { kind: "catalogLabel"; catalog: C; idField: CatalogFieldMap[C] }
      : never
}[keyof CatalogFieldMap];

type NumberFormat = "integer" | "fixed1" | "fixed2" | "raw";
type Unit = "м" | "мм" | "м²" | "шт." | "Вт" | "Вт/м" | "В" | "K"
  | "модул." | "фасад." | "ящ." | "двер." | "секц." | "полок" | "штанг";

/** §15.7.8: только wardrobe.plinth.widthCm; display-only cm→m. */
type CmToMConversionSegment<ID extends CalculationLineId> =
  "widthCm" extends NumericFieldOf<ID>
    ? {
        kind: "numberWithUnit";
        field: "widthCm";
        format: "fixed1";
        unit: "м";
        conversion: "cm-to-m";
      }
    : never;
type Condition<ID extends CalculationLineId> =
  | { field: BooleanFieldOf<ID>; op: "eq"; value: boolean }
  | { field: NumericFieldOf<ID>; op: "eq" | "gt" | "gte"; value: number };

type DetailSegment<ID extends CalculationLineId> =
  | { kind: "literal"; text: string }
  | { kind: "number"; field: NumericFieldOf<ID>; format: NumberFormat }
  | { kind: "numberWithUnit"; field: NumericFieldOf<ID>; format: NumberFormat; unit: Unit }
  | CmToMConversionSegment<ID>
  | CatalogLabelSegment<ID>
  | { kind: "booleanLabel"; field: BooleanFieldOf<ID>; whenTrue: string; whenFalse: string }
  | { kind: "conditional"; when: Condition<ID>; then: DetailSegment<ID>[]; otherwise?: DetailSegment<ID>[] };
```

Wildcard, eval, произвольные выражения, regex-извлечение чисел, поля другой строки и неизвестные unit/format/condition запрещены.

Форматирование:
- `integer` — только целое, `String(value)`;
- `fixed1` — `value.toFixed(1)`, `fixed2` — `value.toFixed(2)`;
- `raw` — `String(value)`, только для уже округлённых Engine значений (`kitchen.lighting.lengthM` = `round(...,3)`, `kitchen.lighting.strip.lengthM`, `profile/diffuser/install.quantityM` = `round(lengthM,2)` и direct-interpolated power/voltage/colorTemp/psuW);
- `cm-to-m` — display-only: `widthCm / 100`, затем `toFixed(1)`; допустим только для `field:"widthCm"`, `unit:"м"`, `format:"fixed1"`; исходный `widthCm`, `amount`, агрегаты и `PriceBreakdown` не меняются;
- локаль `en-US`, десятичный разделитель `.`, без grouping; Adapter не меняет числовые значения.

#### 15.7.3. DisplayMetadata

```ts
type ReferenceSource = "preliminary" | "datasheet";
type CatalogLabels = Record<CatalogKind, Record<string, string>>;

interface LineDisplayDefinition<ID extends CalculationLineId> {
  id: ID;
  label: string;
  group: "base" | "cost" | "options" | "lighting" | "adjustments";
  order: number;
  detailSegments: DetailSegment<ID>[];
}

interface DisplayMetadata {
  fingerprint: string; // SHA-256, не version axis
  lineDefinitions: { [ID in CalculationLineId]: LineDisplayDefinition<ID> };
  catalogLabels: CatalogLabels;
  supportSystemSource: Record<string, ReferenceSource>;
  ledStripSource: Record<string, ReferenceSource>;
  supportsPreliminaryNote: string;
  disclaimer: string;
}
```

`catalogLabels` разрешается только парой `catalog + id`; отсутствующий label — controlled error. DisplayMetadata не входит в `CalculationInputs` и не передаётся Engine.

`fingerprint` — SHA-256 канонического JSON без поля `fingerprint`: объектные ключи сортируются, массивы `detailSegments` сохраняют порядок, `lineDefinitions` сортируются по ID. Входят lineDefinitions, catalogLabels, source maps, preliminary note, disclaimer. Fingerprint не сохраняется в проекте и не является отдельной осью версий.

#### 15.7.4. SQLite storage

DisplayMetadata хранится в логической коллекции **`display-metadata`** существующего Storage Adapter (`collection_state`), без JSON-файла, новой таблицы или второго адаптера. Записи:
- `lineDefinitions` (`kind=line-definitions`);
- `supports.preliminaryNote` (`kind=text`);
- `pricing.disclaimer` (`kind=text`).

Каждая запись: `id`, `kind`, `value`, `version`, `updatedAt`, `updatedBy`; read-only во время расчёта; missing/corrupt → fail-closed. Catalog labels/source остаются в CatalogItem; `source` — типизированный `attrs.source: preliminary | datasheet`, обязательный для supportSystem/ledStrip. Изменения: `catalog.update` для label/source, `display.update` для display-metadata; audit `oldValue/newValue`, actor, timestamp.

#### 15.7.5. Display Adapter и единый путь

`CalculationBreakdown + DisplayMetadata → PriceBreakdown`; Adapter сопоставляет строки по ID, восстанавливает label/detail/order/group/note/disclaimer, не рассчитывает стоимость, не меняет quantity/коэффициенты/скидки/округление. Unknown/missing metadata — controlled error.

- preview/create: API → `{inputs, displayMetadata}` → client Engine → Adapter;
- save/recalculate: server DataResolver → Engine → DisplayMetadata resolver → Adapter → persist `PriceBreakdown`;
- GET stored project: сохранённый `PriceBreakdown` без Engine/Adapter;
- при save сервер повторно разрешает metadata и inputs; клиентская metadata не authoritative;
- DataResolver остаётся единственным сборщиком `CalculationInputs`; second resolver запрещён;
- API может возвращать `displayMetadata` sibling-полем рядом с `inputs`.

#### 15.7.6. Golden compatibility

Восемь fixtures CA-T-305 не изменяются. Полный путь проверяется runtime: Engine → CalculationBreakdown → Display Adapter → PriceBreakdown, с точным сравнением labels/details/order/amount/агрегатов/итогов. Статическая проверка fixtures не заменяет runtime golden-тестирование. Текущий код Engine ещё возвращает `PriceBreakdown`; реализация Adapter обязательна.

Решение владельца: дублирование `kitchen.lighting.psu` при `psuCount > 1` (`"{psuCount} шт. · {psuW} Вт · {psuCount} шт."`) сохраняется ради совместимости; возможное исправление — отдельная будущая задача.

#### 15.7.7. Границы

Раздел не меняет CalculationRequest/Inputs, версии/pins, A5, expected*, error codes и Rev5–11. Он заменяет только тип `CalculationBreakdown.lines` (§5.6) и фиксирует DisplayMetadata/Adapter. Изменение внешнего `PriceBreakdown` запрещено. `display-metadata` storage, `display.update` и source migration реализуются в CA-T-306D после отдельного запуска реализации.

#### 15.7.8. Addendum — cm-to-m conversion

`wardrobe.plinth` сохраняет `widthCm: number` в CalculationLine. DetailSegment получает закрытое display-only преобразование:

```ts
type CmToMConversionSegment<ID extends CalculationLineId> =
  "widthCm" extends NumericFieldOf<ID>
    ? { kind: "numberWithUnit"; field: "widthCm"; format: "fixed1"; unit: "м"; conversion: "cm-to-m" }
    : never;
```

Правила:
1. `conversion:"cm-to-m"` допустим только при `field:"widthCm"`, `unit:"м"`, `format:"fixed1"`.
2. Adapter выполняет только `widthCm / 100` для отображения; `CalculationLine.widthCm`, `amount`, все агрегаты, `subtotal/discount/total` и сохранённый `PriceBreakdown` не меняются.
3. Ожидаемые результаты: `240 → 2.4 м`, `250 → 2.5 м`.
4. Любая другая пара field/unit/format/conversion — ошибка metadata.
5. Это уточнение §15.7, не Rev12; остальные положения Rev5–11 не меняются.

