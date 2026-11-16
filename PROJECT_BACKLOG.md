# PROJECT_BACKLOG

## Stage 9 / Block 1 — CALCULATION AUDIT & TEST COVERAGE BASELINE (diagnostic)

| ID | Task | Status |
|---|---|---|
| S9-B1-01 | Инвентаризация расчётного ядра (реестр функций/формул/алгоритмов) | **DONE** |
| S9-B1-02 | Аудит коммерческих расчётов (ценообразование, коэффициенты, округление) | **DONE** |
| S9-B1-03 | Аудит геометрических алгоритмов | **DONE** |
| S9-B1-04 | Реальное покрытие тестами (Vitest config + метрики) | **DONE** — метрики Statements/Branches/Lines **н/д** (провайдер покрытия не установлен, установка запрещена); выданы явно помеченные статические прокси |
| S9-B1-05 | Качество существующих тестов (классификация) | **DONE** |
| S9-B1-06 | Независимая проверка (oracle) + mutation testing | **DONE** — 22 мутанта, 17 killed / 5 survived (77.3 %), 22/22 восстановлено |
| S9-B1-07 | `docs/CALCULATION_VERIFICATION/FORMULA_AND_ALGORITHM_CATALOG.md` | **DONE** — 103 записи |
| S9-B1-08 | `docs/CALCULATION_VERIFICATION/TEST_COVERAGE_AUDIT.md` (+ Test Gap list) | **DONE** — 3 CRITICAL / 4 HIGH / 8 MEDIUM / 4 LOW |
| S9-B1-09 | Финальная верификация: vitest / typecheck / lint + отчёт | **DONE** — 94/948 PASS, typecheck PASS, lint PASS |

### Ограничения (обязательные) — соблюдены
- Формулы, алгоритмы, геометрия, коммерческая логика, calcVersion/schemaVersion, хранение, UI — **не изменялись**.
- Git-операции — **не выполнялись**. Зависимости — **не устанавливались**.
- Существующие тесты — **не удалялись и не переписывались**; expected-значения **не подгонялись**.
- Temporary mutation harness вынесен в `$TMPDIR`; `scripts/` не изменён; остаточных мутаций нет (сверка по 15 паттернам — 0 совпадений).

### Результаты аудита
См. `PROJECT_AUDIT.md` (A1–A11), `PROJECT_PROGRESS.md`, `docs/CALCULATION_VERIFICATION/*`.

---

## Stage 9 / Block 2 — SINGLE SOURCE OF TRUTH AUDIT (diagnostic)

| ID | Task | Status |
|---|---|---|
| S9-B2-01 | Область A: источники/формулы/геометрия/supports/lighting/валидация кухни | **DONE** — все 6 подобластей проверены |
| S9-B2-02 | Область B: шкафная ветвь (источники, формулы, геометрия, валидация, пути стоимости) | **DONE** — расхождений в матрице не найдено (11+ конфигов + 8 golden) |
| S9-B2-03 | Область C: PriceItem/PricingVersion, PriceSnapshot, AdminParameter, округление, промокоды, RecalculationBatch, calcVersion/priceVersion, API | **DONE** — 11 семейств источников проверены раздельно |
| S9-B2-04 | Карта потребителей (Store/Admin/API/server/worker/сохранение) | **DONE** — 18 production-потребителей + 22 тестовых оракула |
| S9-B2-05 | Параллельные реализации: pricing.ts ↔ engine.ts, приватные copies supports/lighting, общий геослой | **DONE** — временный parity-харнесс: 53 конфига, 48 equal / 5 mismatch / 0 errors; харнесс удалён из репозитория |
| S9-B2-06 | Реестр дублирования + расхождения (D1 доказано: lighting PSU/control при нулевой длине ленты, +1730 ₽) | **DONE** — D-1…D-11 |
| S9-B2-07 | Канонические источники + неопределённости (`REQUIRES_DOMAIN_CONFIRMATION`) | **DONE** — 7 подтверждено, 5 вопросов домену |
| S9-B2-08 | `docs/CALCULATION_VERIFICATION/SINGLE_SOURCE_OF_TRUTH_AUDIT.md` | **DONE** — 10 разделов + приоритетный реестр |
| S9-B2-09 | Финальная верификация: vitest / typecheck / lint + отчёт | **DONE** — 94/948 PASS, typecheck PASS, lint PASS |

### Ограничения (обязательные) — соблюдены
- Production-код, формулы, Store/Admin/API, схемы, версии, UI — **не изменялись**; зависимости не устанавливались; Git-операций не было; тесты не удалялись/не переписывались.
- Сравнение реализаций — без подгонки expected под одну из них; все расхождения помечены `REQUIRES_DOMAIN_CONFIRMATION`.

### Результаты
Приоритеты: **CRITICAL 0 / HIGH 5 / MEDIUM 4 / LOW 3**. Подробности: `SINGLE_SOURCE_OF_TRUTH_AUDIT.md`, `PROJECT_AUDIT.md` (A12–A14).

---

## Stage 9 / Block 3 — CRITICAL CALCULATION TEST CLOSURE (тесты + документация)

| ID | Task | Status |
|---|---|---|
| S9-B3-01 | LED / DOMAIN_CONFIRMED: 7 сценариев, UI и ядро раздельно | **DONE** — 8 тестов (3 `it.fails` фиксируют несоответствие R1/R2/R6) |
| S9-B3-02 | TG-C1 — потолок сложности на пути Engine (6/9/10/25 модулей) + итоговая стоимость | **DONE** — 5 тестов, ограничение меняет деньги (мутант M3 закрыт) |
| S9-B3-03 | TG-C2 — порог `minSubtotal` (ниже / ровно / выше) на пути Engine | **DONE** — 4 теста, строгое неравенство подтверждено |
| S9-B3-04 | TG-C3 — правило столешницы для `bottle` | **BLOCKED** — `it.todo` + точный вопрос владельцу (audit U-2) |
| S9-B3-05 | TG-H1 — независимые копии `supportPlanned`/`lightingPlanned` | **DONE** — 4 теста (опоры, clamp `maxBySpacing`, короткая/длинная лента, M18) |
| S9-B3-06 | TG-H2 — негативные тесты guard-ов `fail()` | **DONE** — 5 тестов (PriceItem ×2, роль, signedAdjustment, rounding) |
| S9-B3-07 | TG-H3 — существенные ветки `validation.ts` (issue ровно один раз) | **DONE** — 14 правил (модули, ширина, ящики, полки, габариты, ручки, перекрытие ряда) |
| S9-B3-08 | TG-H4 — fallback `?? 0` / `?? 1` в legacy-поиске тарифов | **DONE** — 3 теста (материал/стиль/ручка); зафиксирован риск молчаливой недоплаты |
| S9-B3-09 | Финальная верификация: vitest / typecheck / lint + отчёт | **DONE** — 97/990 PASS (986 passed + 3 expected fail + 1 todo), typecheck PASS, lint PASS |

### Ограничения (обязательные) — соблюдены
- Production-код (формулы, алгоритмы, геометрия, коммерческая логика, UI, Store/Admin/API, версии) — **не изменялись**; зависимости не устанавливались; Git-операций не было; существующие тесты не удалялись и не переписывались.
- Ожидаемые значения выводились из подтверждённых правил (price-2026.11.1, F-PR-17/19/20, F-SL-01/02/04/05/06, правила LED владельца), а не из реализации; legacy использован только как дополнительный источник (TG-H4).

### Результаты
Новых тестовых записей: **42** (38 PASS, 3 `it.fails`, 1 `it.todo`) в 3 файлах: `engine-rule-gaps.test.ts`, `validation-rule-gaps.test.ts`, `led-domain.test.ts`. Несоответствия производственного кода: **R1/R2/R6 (LED) и D1** — требуют отдельного production-исправления.

---

## Stage 9 / Block 4 — CRITICAL CALCULATION DEFECT FIXES (production + тесты)

| ID | Task | Status |
|---|---|---|
| S9-B4-01 | R1 — блокировка LED-переключателя и подсказка без верхних модулей | **DONE** — `SharedPanels.tsx`: `disabled`, подсказка, LED-органы управления скрыты |
| S9-B4-02 | R2 — нулевая стоимость LED при нулевом метраже (дефект D1, 1730 ₽) | **DONE** — `engine.ts lightingPlanned` возвращает нулевой комплект при `lengthM = 0` |
| S9-B4-03 | R6 — автогашение подсветки при удалении последнего верхнего модуля | **DONE** — `defaults.ts normalizeKitchen`; + тест R7 (повторное добавление не включает) |
| S9-B4-04 | TG-C3 — правило столешницы для бутылочниц (сценарии А/Б) | **DONE** — `pricing.ts kitchenCountertopWidth` + inline-сумма `engine.ts`; включён самостоятельный модуль `bottle` |
| S9-B4-05 | Независимые тесты TG-C3 (оба сценария, 3 стандартных размера, двойной учёт, оба пути) | **DONE** — `countertop-bottle.test.ts` (14 тестов) |
| S9-B4-06 | A16-4 — контракт fallback неизвестных идентификаторов | **DONE (частично, с обоснованием)** — неизвестный id → контролируемая ошибка; `handle:"none"` и исторические материалы оставлены; риск зафиксирован |
| S9-B4-07 | Обновление golden-expected под подтверждённое правило | **DONE** — дельты проверены арифметически (+1 900 / +2 850 ₽), см. каталог §8 |
| S9-B4-08 | Финальная верификация: vitest / typecheck / lint + документация | **DONE** — 98/1009 PASS, typecheck PASS, lint PASS |

### Ограничения (обязательные) — соблюдены
- Изменены только 4 production-файла в объёме перечисленных дефектов: `engine.ts`, `defaults.ts`, `SharedPanels.tsx`, `pricing.ts`. Формулы вне scope, шкаф, округление, minOrder, промокоды, архитектура источников, интерфейс вне R1 — **не менялись**; зависимости не устанавливались, Git-операций не было, production DB/миграции не затрагивались.
- A16-4 остановлен на исторических материалах фасада: поведение сохранено, риск для старых проектов представлен конкретно (PROJECT_AUDIT A16-4).

### Результаты
Тестовых записей: 990 → **1009 (1009 passed)**, файлов 97 → **98**. Удалённых тестов нет; три `it.fails` (R1/R2/R6) и `it.todo` по TG-C3 переведены в обычные тесты после исправления и получения ответа владельца.

---

## Stage 9 / Block 5 — OWNER DECISION PREPARATION (диагностика)

Production-код, тесты и `golden.expected.ts` **не изменялись**. Создан `docs/CALCULATION_VERIFICATION/OWNER_DECISIONS_STAGE9_BLOCK5.md`.

| Вопрос | Статус | Итог |
|---|---|---|
| A17-2 — исторические материалы фасадов | **OWNER CONFIRMED (Block 6)** | Тарифы найдены в 3 источниках (аудиты + ручная арифметика) и в опубликованных `PriceItem`; пересчёт уже заблокирован (CA-516-03), выдача по снимку (Q5). Рекомендация: C+D как политика, B — только после подтверждения чисел; «нет тарифа ≠ бесплатно» отклонено |
| A17-4 — проверка golden | **VERIFIED — расхождений нет** | Ручной расчёт по опубликованным правилам: +1 900 ₽ → ×1.12 → 315 400 → cap 30 000 → 285 400 (Δ +2 100 ₽); +2 850 ₽ → пол 45 000 → итог без изменений. Все 12 показателей совпали, ошибка 0 |
| A17-3 — `minCountertopMeters` | **RESOLVED / OWNER CONFIRMED (Block 6)** | Объявлен, нигде не читается (0 ссылок в коде/тестах/registry/параметрах), готовая/изготавливаемая в модели не разделены. Рекомендация: оставить `status=dead`, не подключать, не удалять |

---

## Stage 9 / Block 7A + 7A.2 — исправления по подтверждённым решениям

| ID | Task | Status |
|---|---|---|
| A18-1 | Барьер исторических фасадов во всех серверных входных точках (create/preview/лиды/сохранение/пересчёт + прямой вызов `calculatePriceFromInputs`) | **DONE** — единый контракт `LEGACY_FACADE_BLOCK_MESSAGE`, 8 защищённых точек, 18 тестов |
| Q-A17-2.3 | Legacy pricing fail-closed: материал без действующего тарифа → контролируемая ошибка вместо 0 ₽ | **DONE** — `pricing.ts facadeRate`, production-вызовов legacy-расчёта нет, +4 теста; `golden.expected.ts` не менялся |
| Q-A17-2.4 | Read-only инвентаризация проектов со ссылками на `veneer/glass/solid` | **OPEN** (не блокирует, требуется доступ к production DB) |

---

## Stage 9 / Block 7 — COMMERCIAL RULES VERIFICATION (тесты + документация)

| ID | Task | Status |
|---|---|---|
| S9-B7-01 | TG-M1 — матрица правил промокодов на Engine (5 ворот, percent, fixed, cap, отрицательный итог, округление, последовательность) | **DONE** — `promo-rules-matrix.test.ts`, 11 тестов, расхождений нет |
| S9-B7-02 | TG-M7 — инертность 5 мёртвых правил §4 для Engine | **DONE** — `dead-commercial-rules.test.ts`, 17 тестов + контроль чувствительности |
| S9-B7-03 | Независимая проверка `wardrobe-default` и `wardrobe-custom-promo` | **DONE** — `wardrobe-golden-verification.test.ts`, 6 тестов, расхождений с golden нет |
| S9-B7-04 | Регрессия и документация | **DONE** — 99 → 102 файла, 1031 → **1065 PASS**, typecheck PASS, lint PASS |

### Ограничения (обязательные) — соблюдены
Production-код, `golden.expected.ts`, тарифы, опубликованные правила, UI, архитектура/API, миграции — **не изменялись**; зависимости не устанавливались, Git-операций не было; A18-1 и Q-A17-2.3 не открывались; U-3/U-4/U-5 и D-5/D-6 не затрагивались.

---

## Stage 9 / Block 8 — OWNER DECISION PREPARATION (подготовка решений, документация)

Production-код, тесты и `golden.expected.ts` **не изменялись**. Создан `docs/CALCULATION_VERIFICATION/OWNER_DECISIONS_STAGE9_BLOCK8.md`.

| Вопрос | Статус | Готовность к решению | Рекомендация агента |
|---|---|---|---|
| U-3 — формула расхода корпуса шкафа | **OPEN — READY FOR DECISION** | да: состояние проверено probe-тестами; выявлено, что аудиты 2026-11-10 описывают устаревшую формулу (текущая: площадь деталей × тариф, перегородка оплачивается +7 251 ₽ на 120 см) | A — утвердить текущую детальную модель |
| U-4 — формула расхода корпуса кухни | **OPEN — READY FOR DECISION** | да: формула подтверждена (фронтальная площадь × глубинный коэффициент + basePrice); физ. данные раскроя отсутствуют | A — утвердить как ориентировочное правило |
| U-5 — область коэффициента сложности | **OPEN — READY FOR DECISION** | да: scope подтверждён (умножает всю сумму, включая опоры/цоколь/LED); денежный вклад измерен: ±7 500–8 700 ₽ на сложную кухню | A — оставить на всю сумму |
| D-5 — канон промокодов сайта | **OPEN — READY FOR DECISION** | да: два источника подтверждены (сайт = `content:PROMOS`, Engine = `snapshot.promos`), риск R-3 | B — сайт читает опубликованную версию |
| D-6 — источник подсказок ставок UI | **OPEN — READY FOR DECISION** | да: 6 точек подсказок из content подтверждены, риск R-4 | B (цель) + A (немедленно) |

### Ограничения (обязательные) — соблюдены
- Production-код, тесты, `golden.expected.ts`, тарифы, формулы, UI, Admin, Store, API, архитектура и контракты — **не изменялись**.
- Зависимости не устанавливались; Git-операции не выполнялись (кроме read-only `git status`); миграции и production DB не затрагивались.
- Block 7, A18-1, Q-A17-2.3 не открывались; Q-A17-2.4 остаётся отдельной задачей; закрытые вопросы Stage 9 не пересматривались.
- Временный probe-тест (`block8-probe.test.ts`) создан для подтверждения U-3/U-5 и **удалён** по завершении; остаточных файлов нет.

---

## Stage 9 / Block 9 — ФИКСАЦИЯ РЕШЕНИЙ ВЛАДЕЛЬЦА CALCULATION ADMIN (Q1–Q7, документация)

Production-код, тесты, конфигурация и структура приложения **не изменялись**. Новые документы не создавались — решения внесены в существующие документы.

| № | Решение владельца (2026-11-13) | Суть |
|---|---|---|
| Q1 | Правила комплектации | управляемые нормы → **отдельный слой данных**; формулы/алгоритмы — в коде; **без второго расчётного движка**; изменения правил учитываются в версионировании и воспроизводимости; реализация не придумывается |
| Q2 | Создание сущностей | **R-14 сохранён**; новые `PriceItem` — только контролируемым импортом; новые типы модулей — отдельное архитектурное решение; через обычные операции админки не создаются |
| Q3 | Черновики и публикация | импорт создаёт записи в **`draft`**; без автоматической публикации; публикация — отдельная операция; совместимость с **CA-T-208** |
| Q4 | Даты действия тарифов | **не вводить**; используется существующая модель `PricingVersion` |
| Q5 | Предварительные позиции | предварительные категории/записи без тарифа **разрешены**; **вне расчёта**; отсутствующий обязательный тариф ≠ нулевая стоимость; отражать в диагностике |
| Q6 | RBAC | Этап 1 целевой модели **не расширяется** авторизацией; **CA-T-602/603 остаются блокирующими** для безопасной публикации; production-публикация не описывается как безопасная до их выполнения; статусы задач не изменяются |
| Q7 | Единицы измерения | набор `unit` **не расширять** («комплект»/«пара»/«кг» не вводить) без подтверждённой потребности |

**Куда внесены:** `docs/CALCULATION_ADMIN/ADMIN_TARGET_STRUCTURE_RECONCILIATION.md` (§16 + аннотации в §3.1/§3.3/§4.1/§6/§7/§9.1/§12/§15), `docs/CALCULATION_ADMIN/CALCULATION_ADMIN_TECHNICAL_SPECIFICATION.md` (новый §12.5, обновления §3.2/§6/§6.2/§8.1/§11/§12.3/§12.4), `docs/CALCULATION_ADMIN/CALCULATION_ADMIN_DATA_AND_VERSIONING_DESIGN.md` (строка ADR-02 и вопрос об IdP — устранено противоречие «NOT_IMPLEMENTED/CA-T-602-603 не реализованы» с планом v0.77–v0.78: код DONE, deployment OPEN), `docs/CALCULATION_ADMIN/ADR-02-auth-rbac.md` (статусная пометка Q6, решение ADR не менялось).

**Отдельный ADR:** слой управляемых правил комплектации (Q1) — необходимость и зависимости зафиксированы в ТЗ (задача **T-0.6** Фазы 0 + матрица 11.3; зависимости ADR-06, раздел 04); содержание ADR не утверждается, не начинается.

### Ограничения (обязательные) — соблюдены
- Production-код, тесты, конфигурация, архитектура — **не изменялись**; Git-операций не выполнялось; новых документов не создавалось.
- **CA-T-602/603 не закрывались и не переносились** (Q6); статусы `CALCULATION_ADMIN_IMPLEMENTATION_PLAN.md` не менялись; закрытые решения и задачи не пересматривались.
- Рекомендации аналитика (`ADMIN_TARGET_STRUCTURE_RECONCILIATION.md` §16-варианты) решениями не признаны; неподтверждённые вопросы сохранены: объём ручного создания `CatalogItem`/`ModulePreset` (Q2), кухонная кромка (reconciliation §9 п.19), вопросы Q-01…Q-14 ТЗ (§12.4).
- Архитектура сверх подтверждённых решений не менялась; scope Этапа 1 целевой модели не расширялся.

---

## Stage 9 / Block 10 — MANAGED ASSEMBLY RULES: SLICE 1–3 (реализация)

Реализация ADR-07 (утверждённые Q7-03/04/07/08а/10/11/13). Формулы/движок и `PricingVersion` не менялись; HTTP/UI и операция перехода не добавлены.

| ID | Задача | Статус | Факт |
|---|---|---|---|
| CA-T-610 | Slice 1: контракт `ManagedRule`/`RulesSnapshot`, draft-хранение, whitelist-валидация, публикация неизменяемого снимка, разрешение снимка | **DONE** | `src/lib/admin/managed-rules.ts`; коллекции `managed-rules.json`, `rules-snapshots.json`, `managed-rule-lineage.json`; аудит `rule.create/update/publish`; **lifecycle (D-2):** явный выбор draft-правил (`id`+`expectedVersion`), запрет авто-публикации, immutable published-редакции, новая draft-редакция, `contentHash` и проверка целостности; 29 тестов |
| CA-T-611 | Slice 2: `StoredProject.rulesSnapshotId`, интеграция в DataResolver (active/pinned), пятая группа `CalculationInputs.rulesSnapshot`, fail-closed `RULES_SNAPSHOT_*` | **DONE** | `types.ts`, `data-resolver.ts`, `contract.ts`, `projects.ts`; 7 интеграционных тестов; полный прогон 1103 passed |
| CA-T-612 | Slice 3: операция перехода проекта на другой снимок (Q7-11: `expectedVersion`, атомарный аудит, идемпотентность) | **DONE** | `src/lib/admin/project-rules-transition.ts`: preflight, optimistic locking по `updatedAt`, журнал намерения `rules-transition-journal.json`, аудит после записи с откатом при ошибке аудита, восстановление незавершённых операций, replay результата исходной операции (не текущего проекта); 17 тестов |
| CA-T-613 | Slice 4: HTTP-маршруты и UI правил | **DONE** | Read API (`GET /api/admin/rules`, `/[id]` с редакциями, `/snapshots`, `/snapshots/active`, `/snapshots/[id]`); draft API (`POST`, `PATCH`, `POST /[id]/revision`); publication API (явный выбор + `expectedVersion` + подтверждение; production gate); transition API с replay; UI `/admin/rules`; RBAC `catalog.write`/`price.publish`/`recalc.run`, CSRF/rate-limit; 13 API + 5 UI-helper тестов. Архивация draft не реализована (нет доменной операции) |
| **NEW-N3** | Инфраструктура: межколлекционная транзакция Storage Adapter (проект + аудит) | **BACKLOG** | Отдельная задача по D-4; в CA-T-612 не реализовывалась, атомарность не заявляется |
| **NEW-N1** | Перенос норм 1.1/1.2 (полосы петель, плотности фасадов) в Managed Rules + подключение Engine | **DONE** | Engine читает нормы только из `rulesSnapshot` (`rule-wardrobe-hinge-band-*`, `rule-wardrobe-facade-density-*`), fail-closed; `calcVersion` → `calc-2026.11.2` + manifest; дубли `AdminParameter` удалены; кодовые константы — только legacy/validation-defaults (не Engine). **Открыто:** подтверждение `source=owner_confirmed` до production-наполнения |
| **NEW-N2** | Ограниченная диагностика Managed Rules и проектов (read-only) | **DONE** | `/api/admin/rules/diagnostics/*` + UI `/admin/rules/diagnostics`: статусы/причины (legacy, unknown, corrupt, missing norms, invalid rules), применённые правила, закреплённый/активный snapshot, статическая связь `line:<CalculationLineId>`; мутаций нет. Полная трассировка не реализована (нужен контракт) |
| **NEW-N4** | Production readiness: D-7–D-11 (seed, source, gate, journal/audit recovery, recovery at startup) | **DONE (техническая часть)** | `managed-rules-seed.ts` + `/api/admin/rules/import` (27 fixed id, draft, preliminary, идемпотентно); `rules-publication-config.ts` (FORMAKUB_ENV/flag/startup); `rules-publication-journal.ts` + recovery при старте/перед публикацией; **публикация без journal невозможна** (operationId генерируется сервером); runbook. CA-T-511 не закрыт: нужно подтверждение норм и production provisioning |

**Ограничения соблюдены:** нормы сверх Q7-08а не переносились; дублей manifest-параметров нет; нулевые тарифы/правила не подставляются; автоматический/пакетный перерасчёт не вводился; legacy-проекты не мигрировали; Git-операций не было.

**Решения D-1–D-6 (2026-11-13):** ADR-07 утверждён (D-1); lifecycle публикации реализован (D-2); перенос норм N1 не начат (D-3); ограничение атомарности принято с журналом восстановления, NEW-N3 зарегистрирована (D-4); инспектор N2 не начат (D-5); publish-маршруты не включены (D-6).

**Эксплуатационное предусловие:** до первой публикации снимка правил create/preview fail-closed; проекты без `rulesSnapshotId` не пересчитываются (чтение сохранено) — следствие утверждённых Q7-02/Q7-11.

---

## Следующий блок (кандидаты — НЕ начинать без определения)

Блок 1 диагностический; исправления по его результатам автоматически **не** запускаются.
Кандидаты отсортированы по влиянию на результат:

| Кандидат | Источник | Тип |
|---|---|---|
| ~~Закрыть **TG-C1/TG-C2/TG-H1/TG-H2/TG-H3**~~ — закрыты в Block 3 | TEST_COVERAGE_AUDIT §6.1–6.6 | DONE |
| ~~Production-исправление по **D1/R2**~~ — исправлено в Block 4 | SINGLE_SOURCE_OF_TRUTH_AUDIT §5 D1 | DONE |
| ~~Production-исправление по **R1/R6**~~ — исправлено в Block 4 | Block 3 `led-domain.test.ts` | DONE |
| Решение владельца по **U-3/U-4** (расход корпуса), **U-5** (область коэффициента сложности) — U-2/TG-C3 закрыт в Block 4 | CALCULATION_CORRECTNESS_AUDIT §11 | решение — **подготовлено в Block 8** (`OWNER_DECISIONS_STAGE9_BLOCK8.md` §1–3), ждёт решения |
| ~~Решение владельца по **A17-2 / A16-4**~~ — получено в Block 6: тарифы 11 800/14 400/18 600 ₽/м² подтверждены как исторические, старые проекты read-only, пересчёт запрещён | `OWNER_DECISIONS_STAGE9_BLOCK5.md` §1.6 | DONE |
| ~~Решение владельца по **A17-3**~~ — получено в Block 6: не применяется, не вводить минимальную оплачиваемую длину, не удалять без отдельного согласования | `OWNER_DECISIONS_STAGE9_BLOCK5.md` §3.8 | DONE |
| Виза на **A17-4** — независимая проверка golden: расхождений **нет**, правки не требуются (ручной расчёт §2 документа) | `OWNER_DECISIONS_STAGE9_BLOCK5.md` §2 | подтверждение (проверено Block 5, не оспаривалось) |
| ~~**A18-1** — барьер legacy-фасадов вне путей пересчёта~~ — **исправлено в Block 7A**: guard в `resolveCalculationInputs` для всех операций + отказ в `createLead`, единый контракт `LEGACY_FACADE_BLOCK_MESSAGE`, 18 тестов | PROJECT_AUDIT A18-1 | DONE |
| Решение владельца по **D-5/D-6** — список промокодов сайта и отображаемые UI-ставки (content vs опубликованная версия) | SINGLE_SOURCE_OF_TRUTH_AUDIT §7.2–7.3 | решение — **подготовлено в Block 8** (`OWNER_DECISIONS_STAGE9_BLOCK8.md` §4–5), ждёт решения |
| **C-6** — обновить FORMULA_REGISTRY/dependency-map: runtime-канон = `engine.ts`, legacy пометить устаревающим | SINGLE_SOURCE_OF_TRUTH_AUDIT §9 C-6 | задача (документация/реестр) |
| **Следующий блок (предложение Block 6):** Block 7 — коммерческие правила: TG-M1 (фикс. промокод DEMO5000 + матрица ворот), TG-M7 (мёртвые правила как инертные), независимая ручная проверка wardrobe-golden; без production-изменений и решений владельца | PROJECT_BACKLOG Block 6 / отчёт | тесты + документация |

---

## Готово ранее (Stage 8 и раньше)
- Stage 8: 93 файла / 945 тестов PASS, typecheck и lint PASS.
- Фактический baseline этой сессии: **94 файла / 948 тестов PASS**.

---

## Stage 10 / Block 1 — CALCULATION ADMIN: CATALOGS, DATA SOURCES, INSPECTOR (реализация)

Единая read-only административная система поверх существующих источников. Новые коллекции, второй калькулятор и новые API не создавались. Мутации остаются в существующих защищённых сервисах.

| ID | Задача | Статус | Факт |
|---|---|---|---|
| CA-A-01 | Read-model каталогов и модулей (`catalog-model.ts`) | **DONE** | 16 логических групп; 8 типов кухни; шкаф — конфигурация (не модули); состав с relation/condition/quantitySource/PriceItem/evidence |
| CA-A-02 | Группировка навигации A–K | **DONE** | `navigation.ts` + `AdminShell`; новые маршруты materials/data-sources/calculations |
| CA-A-03 | Расширенный обзор | **DONE** | статусы каталогов, модули, preliminary-нормы, published/draft версии, битые priceRefs, активный снимок |
| CA-A-04 | `/admin/catalogs` — логические группы и покрытие | **DONE** | CONFIRMED/PARTIAL/NOT_FOUND; карточка показывает резолв priceRefs, суммы из published snapshot и связанные правила |
| CA-A-05 | `/admin/materials` | **DONE** | body/facade/countertop/plinth, attrs, статусы, priceRefs, отсутствие sourceRef показано явно |
| CA-A-06 | `/admin/modules` + `/admin/modules/[type]` | **DONE** | группы, пресеты, карточка состава, правила, тарифы, реализация; шкаф отдельно |
| CA-A-07 | `/admin/data-sources` | **DONE** | confirmed/preliminary/legacy/missing/conflict; конфликты ссылок каталог→тариф; проектные pins |
| CA-A-08 | `/admin/calculations` + `/[projectId]` | **DONE** | проект → модули → строки → правила → версии; ограничения трассировки показаны явно; read-only |
| CA-A-09 | `/admin/versions` — раздельные версии | **DONE** | PricingVersion, RulesSnapshot, publication journal, project transitions, audit |
| CA-A-10 | `/admin/diagnostics` — расчётные данные | **DONE** | отсутствующие тарифы, preliminary, битые ссылки, состав модулей; без ложных ошибок |
| CA-A-11 | Тесты и документация | **DONE** | catalog-model 9, data-sources 4, inspector 4, navigation 5, admin-pages integration 3; новый документ `CALCULATION_ADMIN_CATALOG_MODEL.md`, ТЗ §12.6 |

**Ограничения (соблюдены):** формулы/движок/цены/схемы версий не изменялись; production-флаг публикации не включался; production DB/seed не запускались; RBAC/CSRF/rate-limit/same-origin не ослаблялись; новые API не создавались.

**Явные ограничения результата:** сохранённый `PriceBreakdown` не содержит id строки/priceItemId/нормы количества — полная component-level трассировка не реализована и требует отдельного решения; BOM/раскрой отсутствует; отдельные справочники кромки/петель/направляющих/крепежа не создавались (PriceItem + attrs).

### Audit checkpoint (Stage 10 / Block 1)

Проверены критерии завершения §11: навигация, группы каталогов, модули и состав, переходы к каталогу/правилам, источники параметров и цен, правила, цены/версии, Inspector, проекты/снимки, диагностика, отсутствие фиктивных сущностей, сохранение ADR, зелёные проверки, синхронная документация. Ложных заявлений о полной трассировке нет.

| ID | Улучшение | Статус | Причина / условие |
|---|---|---|---|
| CA-A-IMP-01 | Component-level trace: quantity + priceItemId + rule на строку сохранённого расчёта | **BLOCKED** | Требует изменения контракта `CalculationBreakdown`/`PriceBreakdown` и отдельного архитектурного решения; текущие данные этого не содержат |
| CA-A-IMP-02 | Использование существующего `/api/admin/price-items/[id]/references` в UI цен | **OPEN** | API есть, отдельная карточка использования в UI не реализована; не блокирует текущие критерии |
| CA-A-IMP-03 | Браузерный smoke admin-разделов под реальной сессией | **OPEN** | Нет браузерной автоматизации/тестовой OIDC-сессии в окружении; сборка и data-layer тесты выполнены |
| CA-A-IMP-04 | Отдельные справочники кромки/петель/направляющих/крепежа | **OPEN** | В модели это PriceItem + attrs; создание коллекций = новое решение, не выполнялось |
| CA-A-IMP-05 | Плотность/физические характеристики материалов | **OPEN** | Отсутствуют в фактической модели; добавлять без подтверждения нельзя |
| CA-A-IMP-06 | Детекция конфликтующих дублей определений в Data Sources | **OPEN** | Сейчас конфликтами считаются только неразрешимые ссылки каталог→тариф; расширение требует согласованных правил |

---

## Research record — Component domain model (2026-11-13)

**Результат исследования зафиксирован. На момент исследования реализация не начиналась; управляемый состав реализован в Stage 10 / Block 2 ниже.**

Создан `docs/CALCULATION_ADMIN/COMPONENT_DOMAIN_MODEL_PROPOSAL.md`:
- инвентаризация `CatalogItem`, `ModulePreset`, `PriceItem`, `PricingVersion`, `ManagedRule`, `RulesSnapshot`, `StoredProject`, `MODULE_COMPOSITION`;
- доказано, что `MODULE_COMPOSITION` — производное read-model, а не источник истины;
- разделены физический компонент, норма и тариф;
- зафиксированы потери информации в Engine / `CalculationBreakdown` / `PriceBreakdown` / `priceHistory`;
- предложен ERD и вариант **A + один новый агрегат `CompositionVersion`** только при утверждении управляемого состава;
- перечислены вопросы владельцу (component master, версия состава, необходимость полной трассы, подтверждённые данные фурнитуры).

Новые подзадачи не создавались; код, данные, БД, API, формулы, Engine и версии не изменялись.

---

## Stage 10 / Block 2 — COMPOSITION MANAGEMENT (реализация)

| ID | Задача | Статус | Факт |
|---|---|---|---|
| CA-COMP-01 | `CompositionVersion`/`CompositionLine` схемы | **DONE** | `composition-schema.ts`; draft/published/superseded; immutable published; `version`, `contentHash`, `rulesSnapshotId?` |
| CA-COMP-02 | Сервис draft/publication | **DONE** | `composition.ts`: create/update/delete draft, validate, publish, expectedVersion, contentHash, audit; published не редактируется |
| CA-COMP-03 | Journal + recovery | **DONE** | `composition-journal.ts`; recovery при старте (`instrumentation.ts`) и перед публикацией; межколлекционная атомарность не заявляется |
| CA-COMP-04 | Детерминированный seed | **DONE** | `composition-seed.ts`: импорт `MODULE_COMPOSITION` в draft, fixed id, идемпотентно, source=preliminary, без фиктивных line |
| CA-COMP-05 | API | **DONE** | `/api/admin/compositions` + `[id]`, validate, publish, import, project composition-transition; RBAC catalog.write/price.publish/recalc.run |
| CA-COMP-06 | UI состава | **DONE** | `/admin/modules`, `/admin/modules/[type]`; draft-редактор, добавление/удаление/изменение строк, validate, publish, история |
| CA-COMP-07 | Project pin | **DONE** | `StoredProject.compositionVersionId?`; optional, schemaVersion не повышен; transition с expectedUpdatedAt/audit; старые проекты читаются |
| CA-COMP-08 | DataResolver preflight | **DONE** | published/покрытие типов/наличие тарифов в PriceSnapshot для закреплённой версии; без pin расчёт не блокируется |
| CA-COMP-09 | Engine/component trace | **BLOCKED** | формулы/суммы не изменены; `CalculationBreakdown` не расширен; trace требует отдельного ADR |
| CA-COMP-10 | Новые catalog kinds фурнитуры | **NOT STARTED** | нет подтверждённых данных; фиктивные компоненты не создавались |
| CA-COMP-11 | Браузерный smoke под реальной сессией | **OPEN** | сборка/сервисные тесты выполнены; browser automation отсутствует |

**Ограничения:** NEW-N3 не использован; production gates/seed/DB не менялись; RulesSnapshot/ADR-07 не менялись; формулы/Engine/Legacy/геометрия не менялись.

---

## Stage 10 / Block 3 — COMPOSITION REMEDIATION Q1–Q8 (2026-11-16)

Закрыты CM-A01–CM-A35 по аудиту `COMPOSITION_MANAGEMENT_COMPREHENSIVE_AUDIT.md`; реализованы Q1–Q8.

| Результат | Кол-во |
|---|---:|
| FIXED | 35 |
| PARTIAL | 0 |
| NOT REPRODUCED / BLOCKED / NOT FIXED | 0 |

Добавлены `composition-hash`, `composition-code-registry`, `composition-transition-journal`, API confirm/production-approval, `ADR-08`, remediation report. Обновлены schema/service/UI/DataResolver/projects. Тесты: 3 файла / 28 targeted PASS; полный 119 / 1235 PASS; typecheck/lint/build PASS.

Остаточные ограничения: Engine/component trace вне scope; OIDC E2E выполнен (2 pre-existing public configurator checks fail; 1 editor marker false-negative).

---

## Stage 10 / Block 4 — COMPOSITION → ENGINE INTEGRATION: DESIGN (READ/ANALYZE/DESIGN/VERIFY, 2026-11-16)

Исследование архитектуры и технический проект интеграции Composition Management с Calculation Engine. **Код не менялся** (только документ).

| ID | Task | Status |
|---|---|---|
| S10-B4-01 | Изучить ADR-06/07/08, audit/remediation Composition | **DONE** |
| S10-B4-02 | Восстановить фактический поток расчёта (файлы/функции/типы) | **DONE** — §2–§3 дизайна |
| S10-B4-03 | Определить точки интеграции и где живут нормы (код vs данные) | **DONE** — §2.3, §4 |
| S10-B4-04 | Сравнить варианты A/B/C и рекомендовать один | **DONE** — рекомендован **вариант B** (trace/сверка вне Engine) |
| S10-B4-05 | Спроектировать целевую архитектуру, правила quantityRef/condition/цен/pins | **DONE** — §6–§9 |
| S10-B4-06 | Модель компонентной трассировки без изменения `CalculationBreakdown` | **DONE** — §10 (этап 1: read-only Inspector) |
| S10-B4-07 | Стратегия обратной совместимости/миграции | **DONE** — §11 (автопереходов нет) |
| S10-B4-08 | Изменения по файлам, риски, план, критерии приёмки | **DONE** — §12–§15 |
| S10-B4-09 | Согласование решений владельца В-1…В-7 | **OPEN** — блокирует E1/E2 |
| S10-B4-10 | E1: выделить `resolveCompositionPreflight`, handoff `compositionPreflight` | **DONE** — `data-resolver.ts`, семантика block сохранена, drift-warnings отделены |
| S10-B4-11 | E1: изолированный `composition-resolver.ts` / `resolveCompositionTrace` | **DONE** — только `fixed`-quantity, условия fail-closed, матрица единиц §22.3 |
| S10-B4-12 | E1: целевые тесты + typecheck + lint | **DONE** — 1250 тестов PASS, tsc/eslint PASS |
| S10-B4-13 | E2: API pass-through `compositionVersionId` (create/preview/save) | **DONE** — additive-optional, replay-fingerprint согласован |
| S10-B4-15 | E2: trace после Engine + `compositionTrace` в ответе `/api/calculation-inputs` | **DONE** — не влияет на итог Engine |
| S10-B4-16 | E2: Inspector — карточка Composition Trace (computed/blocked/absent/unavailable) | **DONE** — live-вычисление; сохранение в историю = E4 |
| S10-B4-17 | E3: сквозные интеграционные и регрессионные проверки | **DONE** — +4 теста, 1263 PASS, дефектов E1/E2 не найдено |
| S10-B4-18 | E4: сохранение `compositionTrace` в `ProjectPriceHistory` | **DONE** — additive-optional, чтение из снимка, live-путь только для старых записей |
| S10-B4-19 | E5: обязательность `pins.priceVersionId` при публикации (охват — решение О-3) | **OPEN** — требует решения владельца |
| S10-B4-14 | О-1…О-6 + R-01a + матрица единиц §22.3 (решения владельца) | **OPEN** — блокирует расширение E1→E2 |

**Документ:** `docs/CALCULATION_ADMIN/COMPOSITION_ENGINE_INTEGRATION_DESIGN.md`.
**Ограничения:** Engine/Legacy/`CalculationBreakdown`/геометрия/ADR-07 не изменялись; NEW-N3 не использован; новых kinds/состава шкафа нет.
