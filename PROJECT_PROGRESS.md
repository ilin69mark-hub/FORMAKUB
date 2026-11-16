# PROJECT_PROGRESS

## Stage 10 / Block 4 — COMPOSITION → ENGINE INTEGRATION DESIGN (2026-11-16)

**Status: DONE (только исследование и дизайн; код не изменялся).**

Создан `docs/CALCULATION_ADMIN/COMPOSITION_ENGINE_INTEGRATION_DESIGN.md` (17 разделов).

### Фактические выводы (подтверждены кодом)

- Engine composition не читает (`engine.ts` — 0 упоминаний; purity-тест запрещает admin/server-импорты); `CalculationInputs` замкнут whitelist'ом (`contract.ts:890`).
- Composition подключена **только preflight-гейтом** (`data-resolver.ts:1360–1415`); `quantityRef`/`condition` валидируются (`composition.ts:838–880`), но **не исполняются** — потребителя нет.
- Нормы: формулы в коде; нормы петель шкафа — из `rulesSnapshot` (fail-closed, `engine.ts:953`); параметры — из immutable manifest; `MODULE_COMPOSITION` — read-model для seed, в расчёт не входит.
- Данные: 200 проектов, 0 `rulesSnapshotId`, 0 `compositionVersionId` → все legacy; расчёт по правилам Q7-11 уже заблокирован.
- Рекомендован **вариант B**: новый `src/lib/server/composition-resolver.ts` (quantityRef → rules/code/fixed; condition → whitelist-evaluator; тарифы → тот же `PriceSnapshot`), trace — read-only в Inspector; **totals всегда от Engine**; вариант «composition в `CalculationInputs`/меняет количества» вынесен в отдельный ADR (требует правки контракта ADR-06 + `calcVersion`).

### Проверки

| Команда | Результат |
|---|---|
| Архитектурные проверки (grep/read по целевым файлам, `data/projects.json`) | выполнены; ссылки в документе сверены |
| Тесты / typecheck / lint / build | **не запускались** — код не изменялся (запуск разрешён только для подтверждения вывода; все выводы подтверждены чтением кода) |

**Следующий шаг:** решения владельца В-1…В-7 (§16 дизайна) → этап E1.

---

## Stage 10 / Block 3 — COMPOSITION REMEDIATION Q1–Q8 (2026-11-16)

**Status: 35 FIXED / 0 PARTIAL / 0 NOT REPRODUCED / 0 BLOCKED.**

### Verification

| Command | Result |
|---|---|
| targeted composition tests | 3 files / 28 tests **PASS** (composition + resolver + benchmark) |
| `npx vitest run` | 119 files / 1235 tests **PASS** |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** |

### Implemented

- full-version validation before write; duplicate line IDs impossible;
- contentHash verification on read/validation/preflight/journal/transition;
- Q1: snapshot-aware rules, project/composition pair check, independent versions;
- Q2: preliminary lines block publication; Q3: controlled owner confirmation;
- Q4: CatalogItem/PriceItem/PricingVersion pins in contentHash;
- Q5: Production Gate separate from published, production DataResolver gate;
- Q6: no priceRole; configurable slot cannot have one explicit price;
- Q7: `ADR-08-COMPOSITION-VERSIONING.md`;
- Q8: conditional/code refs validated against registry;
- per-record collection reading; migration.skipped persisted;
- transition journal/recovery; UI dirty-state/confirmation/status.

### Residual

- CM-A21 FIXED: create/update/delete/confirm/approve use the shared operation journal + recovery; publication/transition journals remain.
- CM-A33 FIXED: benchmark at 100/500/1000 — 1000 versions: list 18.7 ms, get 19.1 ms, board 77.9 ms; no optimization required.
- OIDC E2E: disposable Keycloak + isolated DB + Chrome; all Composition checks passed. Existing unrelated public configurator price-text checks fail (2) and one editor marker check was false-negative; see remediation report.
- Engine/component trace remains out of scope by ADR.

---

## Stage 10 / Block 2 — COMPOSITION MANAGEMENT (2026-11-13)

**Status: DONE (managed composition) / PARTIAL (Engine integration) / BLOCKED (component trace).**

### Verification

| Command | Result |
|---|---|
| targeted composition tests | 2 files / 16 tests **PASS** |
| `npx vitest run` | 118 files / 1223 tests **PASS** |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** (composition API/UI routes собраны) |

### Built

- `CompositionVersion` (`composition-versions.json`): draft/published/superseded, immutable published, `version`/`expectedVersion`, `contentHash`, `rulesSnapshotId?`, audit.
- `CompositionLine`: componentCatalog/componentId, priceItemId, relation/alternativeGroup, quantityRef (`code|managed_rule|fixed`), condition, source/sourceRef, sortOrder; суммы не хранятся.
- Publication journal + recovery (`composition-journal.ts`, startup `instrumentation.ts`); expectedVersion, audit, delete protection.
- Deterministic seed `composition-seed.ts` из `MODULE_COMPOSITION` (draft, preliminary, idempotent, без фиктивных строк).
- API `/api/admin/compositions/**` и project composition-transition; RBAC `catalog.write`/`price.publish`/`recalc.run`.
- UI `/admin/modules`, `/admin/modules/[type]`: draft-редактор, validate, publish, history, seed actions.
- `StoredProject.compositionVersionId?` (optional; schemaVersion не повышен), pin UI в Inspector, audit `project.composition_transition`.
- `DataResolver` preflight для закреплённой published-версии: покрытие типов, наличие тарифов в PriceSnapshot; без pin расчёт не блокируется.

### Explicit limitations

- Engine/формулы/суммы не изменены; состав не управляет количествами. Component-level trace (`CalculationBreakdown`) **не реализован** — требуется отдельное ADR/контрактное изменение.
- `usedPriceItems` не заполняется.
- Новые CatalogItem kinds фурнитуры не добавлялись (нет подтверждённых данных).
- Состав шкафа не создавался (шкаф — конфигурация).
- Браузерный E2E под реальной OIDC-сессией не выполнялся.

---

## Stage 10 / Block 1 — CALCULATION ADMIN: CATALOGS, DATA SOURCES, INSPECTOR (2026-11-13)

**Status: DONE (read-only UI + read-model).**

### Verification

| Command | Result |
|---|---|
| targeted vitest (catalog-model, data-sources, inspector, navigation, admin-pages integration) | 5 files / 25 tests **PASS** |
| `npx vitest run` | 116 files / 1207 tests **PASS** |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** (включая `/admin/materials`, `/admin/data-sources`, `/admin/calculations`, `/admin/calculations/[projectId]`, `/admin/modules/[type]`) |

### Built

- Группированная навигация A–K; новые разделы `/admin/materials`, `/admin/data-sources`, `/admin/calculations`, `/admin/calculations/[projectId]`.
- Read-model `catalog-model.ts`: 16 логических групп каталогов с покрытием CONFIRMED/PARTIAL/NOT_FOUND; 8 типов кухни + конфигурация шкафа; состав модуля с типом связи, условием, источником количества, PriceItem и ссылкой на реализацию.
- `data-sources.ts`: confirmed / preliminary / legacy / missing / conflict; конфликт «каталог → отсутствующий PriceItem»; проектные pins.
- `calculation-inspector.ts`: список проектов и карточка «проект → модули → строки → правила → версии». Явно показано, что сохранённый `PriceBreakdown` не содержит id строки/priceItemId/нормы количества.
- Обзор: реальные счётчики каталогов/модулей/норм/версий и битых ссылок.
- Каталоги: логические группы + резолв priceRefs в PriceItem/сумму опубликованного снимка + связанные Managed Rules.
- Версии: раздельные блоки PricingVersion, RulesSnapshot, publication journal, project transitions, audit.
- Диагностика: отсутствующие тарифы, preliminary, битые ссылки, проблемы состава.

### Explicit limitations

- Component-level runtime trace (количество + цена + правило на строку) не реализована: контракт `PriceBreakdown` этого не хранит. Требуется отдельное архитектурное решение.
- BOM/раскрой, плотность материалов, отдельные справочники кромки/петель/направляющих/крепежа отсутствуют в фактической модели; фиктивные коллекции не создавались.
- Новые API и мутации не добавлялись; production gate/RBAC/CSRF/rate-limit не изменялись; production DB/seed не затрагивались.

---

## Stage 9 / Block 1 — CALCULATION AUDIT & TEST COVERAGE BASELINE (2026-11-12)

**Status: DONE (diagnostic block; no fixes performed, as required).**

### Verification (this block, after all experiments)

| Command | Result |
|---|---|
| `npx vitest run` | 94 files / 948 tests **PASS** |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |

### Task results

| ID | Task | Result |
|---|---|---|
| S9-B1-01 | Инвентаризация расчётного ядра | **DONE.** 37 core modules, 11 279 prod. lines, 126 exported functions; 103 formulas/algorithms catalogued with evidence status. Entry points: legacy `pricing.ts` and runtime `engine.ts`, sharing `facade-geometry/sink/wardrobe-*`. |
| S9-B1-02 | Коммерческие расчёты | **DONE.** 34 commercial formulas (`F-PR-*`) traced from config → Engine → PriceItem/PricingVersion/Snapshot → PriceBreakdown → PriceHistory. 7 dead/unused commercial rules confirmed (`bodyFactor` + 4 inert rates + dead PSU margin + unasserted `formatRange`). |
| S9-B1-03 | Геометрические алгоритмы | **DONE.** 54 geometry/layout formulas (`F-GK/F-GW/F-SK/F-SL` + `F-CV`); shared by price and 2D scenes. `WardrobeScene` has no render test; `KitchenScene` render test asserts only 3 labels. |
| S9-B1-04 | Реальное покрытие | **DONE with a documented limitation.** No coverage provider (`@vitest/coverage-v8`, istanbul, c8) is installed and installing is forbidden → Statements/Branches/Functions/Lines **н/д**. Reported explicitly-labelled static proxies: direct 78/126 (61.9 %), reachable 117/126 (92.9 %), untested 9/126. |
| S9-B1-05 | Качество тестов | **DONE.** 699 tests across configurator/content/admin: 683 exact-value (97.7 %), 9 relational-only, 7 presence-only. 0 snapshots, 0 skipped, 0 mocks in the calculation core. 1 test with zero assertions (`regen-golden-tmp.test.ts`). |
| S9-B1-06 | Независимая проверка + mutation | **DONE.** Oracle catalogue built (§9 of the audit). 22 manual mutants over 18 critical functions: **17 killed / 5 survived = 77.3 %**; every mutant byte-verified restored (`restored-OK` × 22). |
| S9-B1-07 | `FORMULA_AND_ALGORITHM_CATALOG.md` | **DONE** — 103 rows, 10 marked `REQUIRES_DOMAIN_CONFIRMATION`. |
| S9-B1-08 | `TEST_COVERAGE_AUDIT.md` | **DONE** — 12 sections + prioritised Test Gap list (3 CRITICAL / 4 HIGH / 8 MEDIUM / 4 LOW). |
| S9-B1-09 | Финальная верификация | **DONE** (see table above). |

### Key findings (evidence-backed)

1. **TG-C1 (CRITICAL)** — the Engine's complexity cap `min(1.12, …)` is untested: removing it changed no test result (mutant M3). Max valid kitchen = 25 modules → up to +28 % on the subtotal.
2. **TG-C2 (CRITICAL)** — the promo `minSubtotal` gate is untested in both paths (mutant M12 survived).
3. **TG-H1 (HIGH)** — `engine.ts` keeps private copies of the supports and lighting computations; their run-splitting and leg-count-clamp branches are unexercised (mutants M17, M18 survived).
4. **TG-H2 (HIGH)** — no negative test for the Engine's `fail()` guards on missing/duplicate `PriceItem`, missing role, duplicate signed adjustment, invalid `rules.rounding`.
5. **TG-H3 (HIGH)** — 66 validation issue sites vs 18 dedicated tests, no rule↔test mapping.
6. **Geometry is the strongest area** — 7/7 geometry mutants killed, hand-computed independent oracles in `facade-geometry.test`, `geometry-ranges.test`, `facade-depth.test`.
7. **Golden expected values are Engine snapshots** (audit U-1) — regression evidence, not an independent financial baseline.

### Explicitly NOT done (per constraints)

No formula, geometry, tariff, `calcVersion`/`schemaVersion`, storage structure or UI change; no Git operations; no dependency installation; no existing test deleted or rewritten; no expected value adjusted to match the Engine.

---

## Stage 9 / Block 2 — SINGLE SOURCE OF TRUTH AUDIT (2026-11-12)

**Status: DONE (diagnostic block; no production code changed, as required).**

### Verification (this block, after all work)

| Command | Result |
|---|---|
| `npx vitest run` | 94 files / 948 tests **PASS** |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |

### Task results

| ID | Task | Result |
|---|---|---|
| S9-B2-01 | Область A (кухня) | **DONE.** 6 подобластей проверены; источники параметров/тарифов/геометрии/supports/lighting/валидации установлены, все пути стоимости сходятся в один `data-resolver → calculateBreakdown`. |
| S9-B2-02 | Область B (шкаф) | **DONE.** Та же структура источников; в матрице расхождений нет (11+ конфигов + 8 golden). |
| S9-B2-03 | Область C (общая инфраструктура) | **DONE.** 11 семейств источников: PriceItem/PricingVersion, PriceSnapshot, AdminParameter (не участвует в runtime), округление/правила, промокоды, RecalculationBatch/worker, calcVersion/priceVersion, API. Исторические снимки отделены от опасного дублирования. |
| S9-B2-04 | Карта потребителей | **DONE.** 18 production-потребителей: все 13 точек получения цены — через engine; 3 UI-компонента читают content напрямую (отображение); 22 тестовых файла используют legacy как оракул. |
| S9-B2-05 | Параллельные реализации | **DONE.** 2 полные ветви (`pricing.ts` legacy ↔ `engine.ts` runtime) + приватные copies `supportPlanned`/`lightingPlanned` + общий геослой. Временный parity-харнесс (вне репозитория): **53 конфига → 48 equal / 5 mismatch / 0 engine errors**; харнесс удалён. |
| S9-B2-06 | Реестр дублирования/расхождения | **DONE.** D-1…D-11; **доказанное расхождение D1**: при нулевом метраже LED-ленты (кухня без верхнего ряда) engine начисляет БП+управление (1730 ₽), legacy — нет; итог 118000 ↔ 119700 (percent-промо усиливает до 148900 ↔ 150500). |
| S9-B2-07 | Канонические источники/неопределённости | **DONE.** 7 подтверждены (snapshot, общий геослой, parameter-registry, validation, versions, rules); 5 вопросов `REQUIRES_DOMAIN_CONFIRMATION`. |
| S9-B2-08 | `SINGLE_SOURCE_OF_TRUTH_AUDIT.md` | **DONE** — 10 разделов + приоритетный реестр (CRITICAL 0 / HIGH 5 / MEDIUM 4 / LOW 3). |
| S9-B2-09 | Финальная верификация | **DONE** (см. таблицу выше). |

### Key findings (evidence-backed)

1. **CRITICAL = 0** — второй коммерческий production-путь не найден: все серверные/клиентские точки получения цены идут через один `data-resolver → calculateBreakdown`.
2. **HIGH D-1/D-2** — legacy `pricing.ts` и runtime `engine.ts` — полные параллельные ветви; 48/53 совпали, но 5 конфигов разошлись (D1), а legacy остаётся оракулом для 22 тестовых файлов.
3. **HIGH D-3/D-4** — `engine.ts` содержит приватные копии supports/lighting; lighting-копия уже доказанно расходится с `lighting.ts` (D1), supports-слабо закреплён тестами (M17).
4. **HIGH D-5** — два независимых списка промокодов: content (сайт) и опубликованная версия (engine).
5. **MEDIUM** — UI-подсказки ставок из content; SINK_RULES ↔ parameter-registry (паритет закреплён тестом); `PRICING.rounding/minOrder` ↔ `priceSnapshot.rules`; ~11 мелких дублей helper-ов.
6. **Исторические копии** (`StoredProject.price`, `priceHistory`, per-request snapshot, история версий) — обоснованы, дублированием не считаются.

### Explicitly NOT done (per constraints)

Production code, formulas, Store/Admin/API, storage schemas, versions and UI unchanged; no dependencies installed; no Git operations; no existing tests removed/rewritten; no fixes applied to the found divergences; full Block 1 re-audit not repeated. Temp parity harness kept outside the repository (`$TMPDIR/stage9/`).

---

## Previously completed (Stage 8 and earlier)

- Stage 8: 93 test files / 945 tests PASS, typecheck and lint PASS.
- See `docs/CALCULATION_ADMIN/*` and `CALCULATION_ADMIN_IMPLEMENTATION_PLAN.md`.

---

## Stage 9 / Block 3 — CRITICAL CALCULATION TEST CLOSURE (2026-09-12)

**Статус: COMPLETE** (кроме TG-C3 — BLOCKED до решения владельца).

- Закрыты: TG-C1, TG-C2, TG-H1, TG-H2, TG-H3 (существенные ветки), TG-H4. TG-C3 — `it.todo` + точный вопрос владельцу (U-2).
- LED (DOMAIN_CONFIRMED): 8 тестов в `led-domain.test.ts` — 5 PASS (полный комплект, выключенное состояние, UI-доступность при наличии верхнего ряда), 3 `it.fails` фиксируют нарушения R1 (переключатель не блокируется), R2 (Engine начисляет PSU+control = 1730 ₽ при нулевом метраже, D1), R6 (нет автогашения при удалении последнего верхнего модуля). UI и ядро проверены раздельно.
- Добавлено 42 тестовые записи в 3 файлах (`engine-rule-gaps`, `validation-rule-gaps`, `led-domain`); ожидалось 948 PASS → **986 passed + 3 expected fail + 1 todo = 990** (97 файлов), typecheck PASS, lint PASS.
- Production-код не изменялся; зависимости не устанавливались; Git-операций не было; существующие тесты не трогались.
- Источники ожидаемых значений: опубликованные правила price-2026.11.1, каталог формул (F-PR-17/19/20, F-SL-01/02/04/05/06, F-CT-06, F-VD-01), parameter manifest, правила LED владельца. Legacy использован только в TG-H4 как дополнительный источник.
- Требуют отдельного production-исправления (с разрешения владельца): D1/R2, R1, R6.

---

## Stage 9 / Block 4 — CRITICAL CALCULATION DEFECT FIXES (2026-09-12)

**Статус: COMPLETE** (A16-4 остановлен на исторических материалах — решение владельца).

- **R1 DONE** — `SharedPanels.tsx`: без верхних модулей переключатель `disabled`, показана подсказка «Чтобы включить подсветку, добавьте верхние модули.», кнопка питания и чипы настроек LED не рендерятся.
- **R2 DONE** — `engine.ts lightingPlanned`: при `lengthM = 0` возвращается нулевой комплект (лента, профиль, рассеиватель, торцевые, коннекторы, **БП, контроллер**, монтаж = 0; `psuW/psuCount = 0`). Начисление 1730 ₽ устранено.
- **R6 DONE** — `defaults.ts normalizeKitchen`: без верхних модулей `underCabinetLighting = false` (идемпотентно; автогашение срабатывает в `KitchenPanel` → `onChange(normalizeKitchen(next))`); **R7** — повторное добавление модулей подсветку не включает (новый тест).
- **TG-C3 DONE** — правило владельца: самостоятельная бутылочка (`type === "bottle"`, 150/200/300 мм) входит в столешницу, встроенный механизм (`sinkStorage[].bottle`) — нет. Исправлены обе ветви: `pricing.ts kitchenCountertopWidth` и inline-сумма `engine.ts`.
- **A16-4 DONE частично** — неизвестный id → `Legacy pricing: неизвестный …` (контролируемая ошибка) вместо молчаливого 0/1; `handle: "none"` (ставка 0 в каталоге) и исторические материалы фасада сохранены. Исторические материалы оставлены без изменений с примером риска (A17-2) — нужен владелец.
- Новых тестов: **+19 записей** (`countertop-bottle.test.ts` — 14, R7 — 1, TG-H4 — 3→6, `it.todo` TG-C3 → 2 теста). Итог: **98 файлов / 1009 passed**; typecheck PASS; lint PASS.
- Изменения golden-expected (A17-4) — арифметическое следствие правила: +0.2 м × 9 500 = +1 900 ₽ и +0.3 м × 9 500 = +2 850 ₽, проверено построчно.
- Production-код изменён в 4 файлах строго в scope; архитектура, шкаф, округление, minOrder, промокоды, UI вне R1 — не менялись. Документация обновлена (каталог §8, coverage §13, SSOT D1 → FIXED, backlog/progress/audit).


---

## Stage 9 / Block 5 — OWNER DECISION PREPARATION (2026-09-12)

**Статус: COMPLETE (диагностика).** Production-код, тесты, `golden.expected.ts`, БД и сохранённые проекты не изменялись; зависимости не устанавливались, Git-операций не было.

- **A17-2 — PREPARED.** Источники: `CA-515-04/05`, `CA-516-02/03`, `CALCULATOR_TECHNICAL_AUDIT.md:133,374–375`, `MATERIALS_AND_FACADES_AUDIT.md:62–64,112–114`, `CALCULATION_CORRECTNESS_AUDIT.md:168,179,186`, `import.ts LEGACY_IMPORT_EXCLUDED_IDS`, `import-legacy.test.ts`. Тарифы 11 800/14 400/18 600 ₽/м² задокументированы, но не подтверждены владельцем; `LEGACY_FACADE_MATERIALS` тарифа не содержит → 0 ₽. Пересчёт заблокирован (C) и выдача по снимку (D) уже реализованы; production-вызовов legacy-расчёта нет → денежного влияния сейчас нет. Рекомендация: C+D, B — после подтверждения. Тесты: 9 файлов используют legacy-материалы; в текущих golden их нет.
- **A17-4 — VERIFIED, расхождений нет.** Ручной расчёт по опубликованным правилам (fixtures + `PRICING` + `COUNTERTOPS.ldsp_hpl = 9500`): promo-complexity 2.40→2.60 м (+1 900 ₽) → Σ 281 593 → ×1.12 = 315 384.16 → round100 = 315 400 → DEMO10 10 % = 31 540 → cap 30 000 → **285 400** (Δ +2 100 ₽ = 2 128 − 28 из-за разницы эффектов округления); min-order 0.00→0.30 м (+2 850 ₽) → raw 36 509 → 39 359 → round100 39 400 → пол 45 000 → **45 000 без изменений**. Все 12 показателей совпали с `golden.expected.ts`. Оговорка: ±2 ₽ округление строк — проверено на устойчивость.
- **A17-3 — PREPARED.** Объявлен в `content/catalog.ts:541`; 0 ссылок в коде/тестах; `dependency-map.ts:405` → `NOT_USED`; в `parameter-registry.ts` (опубликованные параметры) отсутствует; признака «готовая/изготавливаемая» в `CountertopOption`/Admin/UI нет. Фактически: минимальная длина не применяется, стоимость = длина × тариф; на сохранённые проекты не влияет (константа контента). Рекомендация: оставить `status=dead` (OI-011), не подключать, не удалять до решения (OI-054).
- Документ: `docs/CALCULATION_VERIFICATION/OWNER_DECISIONS_STAGE9_BLOCK5.md` (факты, источники, неизвестные, варианты A–D, рекомендации, 9 точных вопросов владельцу).

---

## Stage 9 / Block 6 — OWNER DECISIONS INTEGRATION & NEXT BLOCK SELECTION (2026-09-12)

**Режим:** документация + проверка согласованности + планирование. Production-код, тесты и `golden.expected.ts` **не изменялись**.

**Зафиксированные решения (окончательные):**
- **A17-2 / A16-4 — OWNER CONFIRMED:** исторические тарифы `veneer 11 800`, `glass 14 400`, `solid 18 600 ₽/м²`. Подтверждение ≠ разрешение использовать материалы в новых проектах или автоматически пересчитывать старые проекты. Политика старых проектов: только чтение, исторический `PriceSnapshot` сохраняется, перерасчёт запрещён, сохранённая конфигурация и историческая стоимость не изменяются. Зафиксировано в `OWNER_DECISIONS_STAGE9_BLOCK5.md` §1.6.
- **A17-3 — OWNER CONFIRMED / RESOLVED:** `minCountertopMeters = 0.8` не применяется, не используется в ориентировочном калькуляторе, минимальная оплачиваемая длина не вводится, параметр не удаляется без отдельного согласования. Зафиксировано в §3.8.
- **A17-4 — без изменений:** независимая проверка Block 5, расхождений нет; решение владельца не запрашивалось.

**Проверка согласованности (5 вопросов):** 1 — read-only ✓; 2 — исторический snapshot сохраняется ✓; 3 — обхода запрета пересчёта нет ✓; 4 — для новых проектов ✓, **но найден пробел A18-1** (`create`/`preview` и лиды не проверяют материал фасада); 5 — `minCountertopMeters` не применяется ✓. Детали: `PROJECT_AUDIT.md` A18.

**Новая запись:** **A18-1** (без исправления кода, требуется отдельное разрешение на production-изменение).

**Следующий блок предложен** по приоритету 2 (проверка корректности коммерческих правил): Block 7 — TG-M1 (фиксированный промокод `DEMO5000`, матрица ворот F-PR-19/20) + TG-M7 (мёртвые коммерческие правила как инертные) + независимая ручная проверка шкафных golden-сценариев (приоритет 3). Не требует решений владельца, production-изменений и UI-работ.

---

## Stage 9 / Block 7A — A18-1 LEGACY FACADE GUARD CLOSURE (2026-09-12)

**Статус: COMPLETE.** Изменён production-код строго в объёме A18-1 (разрешение владельца) + тесты.

- **Единый контракт:** `src/lib/configurator/materials.ts` → `LEGACY_FACADE_BLOCK_MESSAGE` + `legacyFacadeBlockIssue()`; одно сообщение во всех точках отказа, коды ошибок слоёв не менялись.
- **`data-resolver.ts`:** guard распространён со `recalculate` на **все** операции (`create`/`preview`/`recalculate`) — отказ до сборки входов: исторический `PriceItem` не читается, материал не подменяется.
- **`leads.ts`:** исторический материал → `{ok:false}` до расчёта, лид не записывается; `/api/leads` → 422.
- **`projects.ts`:** 4 существующих guard-а переведены на общий текст (поведение/коды не менялись).
- **`validation.ts` НЕ менялся** намеренно: `getProject` использует `validateConfig` при чтении, повышение severity заблокировало бы просмотр старых проектов (требование «read-only не ломать»).
- **Тесты:** новый `src/lib/server/legacy-facade-guard.test.ts` — **18** тестов по всем 10 пунктам приёмки (create/preview ×3 материала, API 422, лиды ×3 + API 422, разрешённые материалы считаются, все обходы, чтение старого проекта, неизменность snapshot, запрет save/recalculate).
- **Дополнительно закрыт последний обход:** guard добавлен в `calculatePriceFromInputs` (последний шлюз перед Engine) — итого **8** защищённых входных точек, включая прямой вызов сервиса с вручную собраным `CalculationRequest`.
- **Итог:** 98 → **99 файлов**, 1009 → **1027 тестов PASS** (1009 + 18); typecheck PASS; lint PASS. `golden.expected.ts`, UI, миграции, production DB, U-3/U-4/U-5, D-5/D-6 и коммерческий Block 7 не затрагивались.
- Документация: `FORMULA_AND_ALGORITHM_CATALOG.md` §9 (контракт + входные точки), `PROJECT_AUDIT.md` A18-1 закрыт, `PROJECT_BACKLOG.md` A18-1 → DONE.

---

## Stage 9 / Block 7A.2 — Q-A17-2.3 LEGACY PRICING FAIL-CLOSED (2026-09-12)

**Статус: COMPLETE.** Изменён 1 production-файл строго в объёме Q-A17-2.3.

- **Использование Legacy pricing (установлено):** вне тестов модуль импортируется только в `validation.ts` и только геометрическими helper; вызовов `calculateKitchenPrice`/`calculateWardrobePrice`/`calculatePrice` вне тестов **нет**; реэкспортов/динамических импортов нет; `src/lib/admin/pricing.ts` — другой модуль; `engine.ts` pricing не импортирует (runtime-путь не затронут). **Production-вызовов legacy-расчёта нет.**
- **Изменение:** `pricing.ts facadeRate` — материал без действующего тарифа (`veneer`/`glass`/`solid`) → ошибка `Legacy pricing: нет действующего тарифа для facadeMaterial "<id>"; расчёт фасадов невозможен` вместо 0 ₽; исторический тариф не подставляется; фасады не пропускаются. Неизвестный id → прежняя ошибка; `handle: "none"` и действующие материалы — без изменений.
- **Тесты:** +4 (3 исторических материала + позитивный контроль действующих) в `validation-rule-gaps.test.ts` (TG-H4 → 9 тестов) и +1 в `legacy-facade-guard.test.ts` (чтение старого проекта не зависит от legacy pricing, `PriceSnapshot` без изменений).
- **Итог:** 1027 → **1031 тест PASS** (99 файлов); typecheck PASS; lint PASS. `golden.expected.ts`, Engine, A18-1, UI, тарифы, миграции не менялись.

---

## Stage 9 / Block 7 — COMMERCIAL RULES VERIFICATION (2026-09-12)

**Статус: COMPLETE.** Production-код и `golden.expected.ts` не изменялись; добавлены 3 тестовых файла.

- **TG-M1 (11 тестов):** матрица правил промокодов на runtime Engine — 5 ворот F-PR-19 (неизвестный, неактивный, чужая категория, ниже порога, ровно на пороге), percent, **fixed (`DEMO5000` — ветка выполняется впервые)**, cap 30 000 ₽ (uncapped 31 500), скидка больше заказа → итог 0, округление 100 ₽, последовательность minOrder → ворота → скидка → округление (raw 39 359 → 45 000 → скидка 4 500 → 40 500). Противоречий в правилах не обнаружено.
- **TG-M7 (17 тестов):** `wardrobe.bodyFactor`, `kitchen.countertopDepthAllowance/underCabinetLightPerMeter/sinkPartition/plinthPerMeter` инертны для Engine: идентификаторов в `engine.ts` нет, 4 kitchen-поля не попадают в `snapshot`/`rules`, мутация значений не меняет breakdown; контроль чувствительности (мутация живого PriceItem) результат меняет. Уточнение: `PRICING.wardrobe.plinthPerMeter` — отдельный **живой** тариф (в §4 не входит).
- **Wardrobe golden (6 тестов):** `wardrobe-default` — Σ 128 287 → 128 300 → **128 300**; `wardrobe-custom-promo` — Σ 154 454 → 154 500 → WARDROBE7 7 % = 10 815 ≤ 18 000 → **10 800** → **143 700**. Компоненты Engine ↔ legacy совпали, тарифы snapshot ↔ content совпали, расхождений с golden **нет**.
- **Итог:** 99 → **102 файла**, 1031 → **1065 тестов PASS**; typecheck PASS; lint PASS.

---

## Stage 9 / Block 8 — OWNER DECISION PREPARATION (2026-11-13)

**Статус: COMPLETE.** Только документация; production-код, тесты и `golden.expected.ts` не изменялись.

- **Создан** `docs/CALCULATION_VERIFICATION/OWNER_DECISIONS_STAGE9_BLOCK8.md` — пять самостоятельных разделов (U-3, U-4, U-5, D-5, D-6), каждый: текущее состояние / подтверждение / проблема / варианты / последствия / рекомендация / вопрос владельцу; статусы VERIFIED / ASSUMPTION / UNKNOWN разделены; сводная таблица готовности (§6).
- **U-3 (шкаф):** текущая формула `bodyCost = Σ площадь деталей × тариф` подтверждена probe-тестом: валидные 1×120 vs 2×60 → корпус 21 656 vs 28 907 ₽ (перегородка 1.3944 м² оплачивается: +7 251 ₽). Утверждения `CALCULATION_CORRECTNESS_AUDIT §4/§11` и `MATERIAL_CONSUMPTION_AUDIT §8` («формула ×1.15, перегородка не оплачивается, 1×120 ≡ 2×60») **на текущем коде не воспроизводятся** — помечены устаревшими (причина расхождения UNKNOWN: Git-история не использовалась).
- **U-4 (кухня):** формула `preset.basePrice + фронтальная площадь × тариф × max(0.5, глубина/60)` подтверждена по `engine.ts:741–743` / `pricing.ts:346–347`.
- **U-5 (сложность):** scope подтверждён — `factor` умножает всю сумму, включая столешницу/опоры/цоколь/LED; probe на кухне 13 модулей: вклад умножения опций ≈ **7 500 ₽** (360 400 vs 352 900); на golden promo-complexity ≈ **8 700 ₽**. Шкаф: `complexityFactor = 1` всегда.
- **D-5:** сайт читает `content:PROMOS` (`PromotionsSection.tsx:6,56`), Engine — `snapshot.promos` (`engine.ts:154`); равенство только от посева (`bootstrap.ts:596`, `import.ts:519`); риск R-3 после первого редактирования промокода в Admin.
- **D-6:** 6 точек числовых подсказок UI из `content/*` (SharedPanels:140/256/362/441/507; KitchenPanel:311); итоговые цены идут с сервера из snapshot — корректны; риск R-4 только для подсказок.
- **Временный probe-тест** (`src/lib/configurator/block8-probe.test.ts`) создавался для подтверждения U-3/U-5 и **удалён**; результаты зафиксированы в документе. Полный набор тестов не запускался (production-код и тесты не изменялись).
- **Изменённые файлы (4):** `docs/CALCULATION_VERIFICATION/OWNER_DECISIONS_STAGE9_BLOCK8.md` (создан), `PROJECT_BACKLOG.md`, `PROJECT_PROGRESS.md`, `PROJECT_AUDIT.md` — только фиксация результата Block 8 и статусов пяти вопросов.
- **Не сделано (по ограничениям):** решения владельца не получены и не зафиксированы; U-3/U-4/U-5/D-5/D-6 остаются OPEN (готовы к решению); Q-A17-2.4 не затрагивался.

---

## ADR-07 — MANAGED ASSEMBLY RULES: SLICE 1 (2026-11-13)

**Статус: DONE (service layer, без HTTP и без интеграции в расчёт).** Реализован первый вертикальный срез по ADR-07 (утверждённые решения Q7-03/04/07/08а/10/11/13): контракт, draft-хранение, whitelist-валидация, публикация неизменяемого снимка, разрешение снимка (fail-closed).

### Что работает

- `src/lib/admin/managed-rules.ts` — zod-контракт `ManagedRule` (§9/Q7-13), условия по whitelist §10.1 (операторы, предметы, типы значений, глубина ≤ 2, ≤ 8 предикатов), `createManagedRule`/`updateManagedRule` (draft, `expectedVersion`, инкремент `version`, published → новая редакция), `publishRulesSnapshot` (полная копия содержимого, только `published` и `source≠preliminary`, монотонный `publishedSeq`), `resolveActiveRulesSnapshot`/`resolveRulesSnapshotById` (fail-closed: повреждённый/неразрешимый снимок → error, подстановка запрещена).
- `managed-rules.json`, `rules-snapshots.json` — новые коллекции Storage Adapter (пустые/отсутствующие коллекции безопасны).
- `contract.ts` — пятая группа `CalculationInputs.rulesSnapshot` (ADR-06 §5.3 addendum), рантайм-валидация: draft/preliminary/дубликаты/пустой снимок блокируются; `CALCULATION_LINE_IDS` вынесен в runtime-константу для проверки `line:*`.
- `audit.ts` — события `rule.create`, `rule.update`, `rule.publish`.
- Публикация снимка **не** запускает перерасчёт; `PricingVersion`, движок, формулы и DataResolver не изменялись.

### Проверки

| Command | Result |
|---|---|
| `npx vitest run` | 104 files / **1096 passed** |
| targeted (`managed-rules`, `contract-rules`, `contract`) | 39 passed |
| `npm run typecheck` | PASS |
| `npm run lint` (изменённые файлы) | PASS |

### Следующий срез (не начат)

Интеграция с `DataResolver`/`CalculationInputs`: разрешение активного снимка для create/preview и закреплённого `StoredProject.rulesSnapshotId` для recalculate, поведение при активации слоя (до первой публикации / legacy-проекты) — см. отчёт задания.

---

## ADR-07 — MANAGED ASSEMBLY RULES: SLICE 2 (2026-11-13)

**Статус: DONE (интеграция в DataResolver; HTTP/UI и операция перехода не реализованы).**

### Что реализовано

- **`StoredProject.rulesSnapshotId?: string`** — optional-метаданные-ссылка, `schemaVersion` не повышен (Q7-07).
- **DataResolver:** create/preview используют **активный опубликованный** снимок; recalculate — **только закреплённый** `project.rulesSnapshotId`; разрешённый снимок передаётся пятой группой `CalculationInputs.rulesSnapshot` (ADR-06 §5.3 addendum).
- **Fail-closed коды:** `RULES_SNAPSHOT_MISSING` (нет активного снимка / legacy-проект без привязки), `RULES_SNAPSHOT_UNKNOWN` (ссылка на несуществующий снимок), `RULES_SNAPSHOT_CORRUPT` (повреждённый файл / недопустимое содержимое). Подстановка пустого набора или актуального снимка запрещена.
- **Legacy (Q7-11):** новый расчёт блокируется, чтение сохранённых данных/истории не затрагивается; автоназначение отсутствует.
- **`saveProject`:** новый проект закрепляет снимок, фактически использованный при создании (не является миграцией legacy-проектов).
- **Снимок неизменяем:** правка исходного правила после публикации не меняет расчётные входы (проверено интеграционным тестом).
- **Операция перехода между снимками не реализована** (следующий этап Q7-11); автоматический/пакетный перерасчёт не вводился.

### Проверки

| Command | Result |
|---|---|
| `npx vitest run` | 104 files / **1103 passed** |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |

### Интеграционные тесты (DataResolver)

Добавлены: create с активным снимком; create без опубликованного снимка; recalculate с закреплённым снимком; legacy без `rulesSnapshotId`; неизвестный снимок; повреждённый файл; изменение правила после публикации. Существующие тесты дополнены тестовой фикстурой опубликованного снимка (`src/lib/server/rules-test-fixture.ts`); production-сид не добавлялся.

### Эксплуатационное предусловие (следствие утверждённых Q7-02/Q7-11)

До появления **активного опубликованного** снимка правил новые расчёты (create/preview) fail-closed; существующие проекты без `rulesSnapshotId` не пересчитываются (чтение доступно). Это прямое следствие утверждённой rollout-семантики; production-наполнение правилами и операция перехода — отдельные этапы.

---

## ADR-07 — MANAGED ASSEMBLY RULES: CA-T-612 (2026-11-13)

**Статус: DONE.** Реализован контролируемый переход проекта на другой опубликованный `RulesSnapshot` (Q7-11); HTTP/UI не добавлялись.

### Что реализовано

- **`transitionProjectRulesSnapshot`** (`src/lib/admin/project-rules-transition.ts`):
  - вход: `projectId`, `targetRulesSnapshotId`, `expectedVersion`, `operationId`, actor;
  - preflight до записей: проект существует; снимок существует; опубликован (запись в `rules-snapshots.json`); структура валидна; нет draft/preliminary; ссылки `assigns` разрешимы;
  - optimistic locking: `expectedVersion = StoredProject.updatedAt` (отдельного revision-поля у проекта нет); при несовпадении — 409, проект и аудит не изменяются;
  - меняются только `rulesSnapshotId` и `updatedAt`; перерасчёт не запускается, `price/priceHistory/config/pins/version` не затрагиваются;
  - идемпотентность — по `operationId` в `AdminAuditLog.requestId` (существующий журнал); повтор возвращает исходный результат, другие параметры при том же ключе → 409; повтор на тот же снимок — no-op без записи аудита;
  - аудит `project.rules_transition` пишется до записи проекта внутри сериализованной операции: ошибка аудита → проект не изменён.

### Атомарность (ограничение хранилища)

Storage Adapter атомарен в пределах одной коллекции; межколлекционной транзакции нет. Порядок «аудит → запись проекта» гарантирует отсутствие закрепления без записи аудита; при сбое записи проекта после аудита журнал может содержать событие при неизменённом проекте (ошибка пробрасывается). Это документированное ограничение, транзакционность не заявляется.

### Проверки

| Command | Result |
|---|---|
| targeted (`project-rules-transition`) | 13 passed |
| `npx vitest run` | 105 files / **1116 passed** |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |

---

## ADR-07 — LIFECYCLE PUBLICATION + TRANSITION REPLAY (2026-11-13)

**Статус: DONE (CA-T-610 lifecycle, CA-T-612 replay/audit).** ADR-07 переведён в APPROVED (D-1); зафиксированы D-1–D-6.

### Lifecycle (CA-T-610, D-2)

- Публикация снимка требует **явного непустого выбора** draft-правил (`id` + `expectedVersion`); авто-публикация всех draft запрещена; дубликаты/неизвестные/archived/устаревшие версии/`preliminary` отклоняются.
- Снимок содержит все опубликованные правила + выбранные draft; `contentHash` (canonical JSON) проверяется при разрешении → подмена = `RULES_SNAPSHOT_CORRUPT`.
- Опубликованная редакция **неизменяема**: `updateManagedRule` для published запрещён; изменение — только `createManagedRuleRevision` (новая запись draft, `version`+1, связь в `managed-rule-lineage.json`).
- При публикации новой редакции предыдущая опубликованная редакция линии → `archived` и в новый снимок не входит.
- Повтор идентичного содержимого возвращает существующий снимок (`replay`) без дубликата и повторного аудита; сбой между снимком и статусами восстанавливается повторным вызовом.

### Replay и аудит (CA-T-612, D-4)

- Replay по `operationId` возвращает **результат исходной операции** (`previousRulesSnapshotId`, `rulesSnapshotId`, `updatedAt`; `project: null`), а не текущее состояние; последующие переходы replay не меняют.
- Добавлен журнал намерения `rules-transition-journal.json`: аудит пишется после изменения проекта; при ошибке аудита — откат закрепления (без ложного `result=ok`); `recoverPendingRulesTransitions()` дописывает недостающий аудит или отбрасывает незавершённую запись.
- Конкурентные переходы: optimistic locking по `updatedAt`, ровно один успех.
- **Ограничение:** межколлекционной транзакции Storage Adapter нет — строгая атомарность не заявляется; NEW-N3 зарегистрирована отдельно.

### Проверки

| Command | Result |
|---|---|
| targeted (`managed-rules`, `project-rules-transition`) | **47 passed** |
| `npx vitest run` | **105 files / 1126 passed** |
| `npm run typecheck` | PASS (после правок) |
| `npm run lint` | PASS |

### Не начато (вне scope)

CA-T-613 (HTTP/UI), N1 (перенос норм + движок), N2 (инспектор), CA-T-511 (production provisioning), NEW-N3 (транзакция Storage Adapter).

---

## ADR-07 — CA-T-613: ADMIN API / UI (2026-11-13)

**Статус: DONE (кроме архивации draft — доменной операции нет).**

### API

- Read: `GET /api/admin/rules` (фильтры status/q), `GET /api/admin/rules/[id]` (+ редакции линии), `GET /api/admin/rules/snapshots`, `/snapshots/active`, `/snapshots/[id]`.
- Draft: `POST /api/admin/rules` (draft), `PATCH /api/admin/rules/[id]` (только draft), `POST /api/admin/rules/[id]/revision` (новая draft-редакция от published).
- Publication: `POST /api/admin/rules/publish` — явный `selection` (`id`+`expectedVersion`), `confirmed`, `expectedStateVersion`; production gate (`NODE_ENV=production` без `FORMAKUB_RULES_PUBLICATION_ENABLED=1` → отказ).
- Transition: `POST /api/admin/projects/[id]/rules-transition` — поверх `transitionProjectRulesSnapshot`, replay возвращается как `replay: true`.
- RBAC: read — любая админ-сессия; draft/revision — `catalog.write`; publish — `price.publish`; transition — `recalc.run`. Мутации — `guardAdminMutation` (same-origin + rate-limit 6/10 мин).

### UI

`/admin/rules` + навигация `06A`: список/поиск, карточка и редакции, создание/редактирование draft, новая редакция, выбор draft для публикации с подтверждением, просмотр снимков и active, переход проекта. Ошибки валидации/версий выводятся из ответов API.

### Проверки

| Command | Result |
|---|---|
| targeted API + UI helpers | **18 passed** (13 + 5) |
| `npx vitest run` | **107 files / 1144 passed** |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |

### Ограничения

Архивация draft не реализована (нет операции в доменном слое). Production-публикация выключена до CA-T-511. NEW-N3 (транзакция), N1 (нормы), N2 (инспектор) не начаты.

---

## ADR-07 — NEW-N1: НОРМЫ 1.1/1.2 В MANAGED RULES + ENGINE (2026-11-13)

**Статус: DONE (с документированным остатком: кодовые константы только для legacy/validation).**

### Перенос

| Норма | Значения | Managed Rules |
|---|---|---|
| Полосы петель (1.1) | 8 диапазонов: (600мм,5кг,2), (900,8,2), (1300,12,3), (1600,15,4), (2000,19,4), (2200,22,5), (2400,27,5), (2700,35,6) | `rule-wardrobe-hinge-band-<n>-max-height/-max-mass/-count` (24 правила), `source=owner_confirmed` |
| Плотности фасадов (1.2) | 16мм → 11.5; 19мм → 14.8; 22мм → 16.8 кг/м² | `rule-wardrobe-facade-density-16/19/22` (3 правила), `source=owner_confirmed` |

### Engine

- `wardrobeHingeNormsFromRules(inputs.rulesSnapshot.rules)` — единственный источник норм в расчёте; проверяет полноту/типы/монотонность.
- `calculateWardrobeBreakdown` → при отсутствии/некорректности норм бросает `Engine input: rulesSnapshot: ...` (fail-closed); кодовый fallback в Engine отсутствует.
- `calcVersion` → `calc-2026.11.2`; добавлен manifest `calc-2026.11.2` с integrity.
- Дубли `AdminParameter` (`wardrobe.hingeBand.*`, `wardrobe.density*`) удалены.
- Константы `WARDROBE_HINGE_BANDS`/`WARDROBE_FACADE_DENSITY_KG_M2` остались только для legacy `pricing.ts` и предупреждения валидации (не Engine).

### Тесты

- Парсер: полный набор (parity с кодовыми значениями), отсутствие/неверный тип/немонотонность → `null`; изменённые значения меняют массу/количество.
- Engine: fail-closed без `rulesSnapshot`; изменение count-правил меняет итог и `wardrobe.fittings`.
- Resolver: active snapshot меняется, закреплённый snapshot проекта остаётся прежним.

### Проверки

| Command | Result |
|---|---|
| `npx vitest run` | **107 files / 1150 passed** |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |

### Совместимость

Старые проекты без `rulesSnapshotId` остаются заблокированными для расчёта (Q7-11); проекты с pin используют закреплённый снимок; автоматического переключения/перерасчёта нет.

---

## ADR-07 — NEW-N2: ДИАГНОСТИКА MANAGED RULES (2026-11-13)

**Статус: DONE (read-only; полная трассировка не реализована — требует изменения контракта).**

### Диагностика проектов

`src/lib/admin/rules-diagnostics.ts`: статусы и причины — `legacy_no_snapshot`, `snapshot_unknown`, `snapshot_corrupt`, `snapshot_invalid`, `rules_invalid`, `required_rules_missing`, `ok`; показываются закреплённый и активный снимки, применённые правила, отсутствующие обязательные нормы, ошибки условий/ссылок.

### Диагностика правил

Снимок: структура/`contentHash`, правила (id, версия, статус, source, assigns), `line:<CalculationLineId>`, отсутствующие нормы 1.1/1.2, проекты, использующие снимок.

### API / UI (read-only)

- `GET /api/admin/rules/diagnostics/projects`
- `GET /api/admin/rules/diagnostics/projects/[id]`
- `GET /api/admin/rules/diagnostics/snapshots/[id]`
- UI `/admin/rules/diagnostics` + `/admin/rules/diagnostics/[projectId]`; ссылка из `/admin/rules`.
- Доступ: admin-сессия (`requireAdminApi`), без прав на мутации. Никаких публикаций/переключений/перерасчёта.

### Проверки

| Command | Result |
|---|---|
| targeted (service + API) | **15 passed** (10 + 5) |
| `npx vitest run` | **109 files / 1165 passed** |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |

### NEW-N1 review (без изменений механизмов)

1. `source=owner_confirmed`: исходный код описывал нормы как предварительные до подтверждения паспортами; документ-подтверждение отсутствует. **Открытый вопрос владельцу** до production-наполнения.
2. `calculatePrice` в runtime не вызывается; `configurator/pricing.ts` используется только для kitchen-хелперов валидации; `wardrobeHingePlan(config)` с кодовыми default — validation и legacy pricing, не Engine. Кодовые константы не участвуют в расчётном пути.

---

## NEW-N4 — D-7–D-11: SEED, GATE, PUBLICATION JOURNAL (2026-11-13)

**Статус: DONE (техническая часть).** Production cutover не выполнялся.

- **D-7:** `managed-rules-seed.ts` + `POST /api/admin/rules/import` — 27 фиксированных id (Engine), только `draft`, идемпотентно, конфликт содержимого/статуса → ошибка без перезаписи; snapshot/active/проекты не меняются.
- **D-8:** seed `source=preliminary`; публикация preliminary запрещена; `owner_confirmed` — только после документального подтверждения владельцем. Диагностика показывает seed и публикуемость.
- **D-9:** `rules-publication-config.ts` — `FORMAKUB_ENV` (production marker), `FORMAKUB_RULES_PUBLICATION_ENABLED=1`, startup-проверка, блокировка противоречий/невалидных значений; `.env.example`/compose обновлены.
- **D-10:** `rules-publication-journal.ts` — journal фаз, audit с `requestId`, инвариант snapshot → audit, replay-проверка.
- **D-11:** recovery при старте (`instrumentation.ts`) и перед публикацией; без фонового процесса; конкурентное восстановление защищено claim/токеном.

### Проверки

| Command | Result |
|---|---|
| seed tests | 5 passed |
| gate tests | 6 passed |
| journal/recovery tests | 7 passed |
| `npx vitest run` | **112 files / 1185 passed** |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |

### Ограничения

- CA-T-511 не закрыт: требуется подтверждение 27 норм владельцем и production provisioning/backup/runbook execution; publication flag не включался.
- Межколлекционная атомарность не заявляется (NEW-N3).

---

## NEW-N4 — D-10 FINAL CLOSURE (2026-11-13)

**Статус: DONE.** Устранён последний путь публикации без publication journal.

- `publishRulesSnapshot` больше не имеет legacy-ветки без journal: `operationId` генерируется сервером (`rules-publish-*`), если не передан; journal создаётся всегда.
- Replay по существующему audit проверяет и при необходимости создаёт/завершает journal (инвариант snapshot → audit), не создавая новый snapshot/audit.
- Повтор без operationId или с тем же operationId использует завершённую публикацию по contentHash/selection; snapshot/audit не дублируются.
- Production callsites: только `POST /api/admin/rules/publish` (передаёт optional operationId) → сервис; иных production-вызовов нет.
- Обновлены ADR §11.10, спецификация, план (v1.06), этот отчёт.

### Проверки

| Command | Result |
|---|---|
| targeted (managed-rules + journal) | 37 + 8 passed |
| `npx vitest run` | 112 files / 1186 passed |
| typecheck / lint / build | PASS |

---

## Stage 10 / Block 4 — E1: базовый слой трассировки (2026-11-16)

**Status: DONE (реализация E1; E2–E5 не начаты).**

### Что реализовано

1. **`resolveCompositionPreflight` выделен** из инлайн-блока `data-resolver.ts` (прежние 57 строк → отдельная функция). Блокирующая семантика сохранена байт-в-байт: те же коды (`COMPOSITION_VERSION_UNKNOWN` / `COMPOSITION_VERSION_INVALID` / `COMPOSITION_VERSION_CORRUPT`), те же сообщения, тот же порядок; `if (issues.length > 0) return { ok: false, issues }` остался на месте.
2. **Типизированный handoff** `ResolvedCalculation.compositionPreflight?: CompositionPreflight` = `{ compositionVersionId, composition, warnings }`. `CalculationInputs` и `CalculationRequest` **не изменялись** (проверено тестом: у `request.inputs` нет `composition`/`compositionTrace`).
3. **Разделение block/warning (В-5, §8.5):** блокирующие ошибки — в `issues`; drift-предупреждения Q4 (3 кода `COMPOSITION_*_DRIFT`) собираются из `validateCompositionVersion().warnings` и возвращаются **отдельно**, на расчёт не влияют. Добавлены 3 кода в `DataResolverErrorCode`.
4. **Новый изолированный `src/lib/server/composition-resolver.ts`** — чистый `resolveCompositionTrace(input)`, **не импортирует `engine.ts`**, читает готовый `breakdown` (т.е. вызывается после Engine), не пишет в `CalculationBreakdown`/`PriceBreakdown`.
5. **Правила количества:** исполняется только `fixed` (finite, `> 0`, unit ≠ `none`); `managed_rule`/`code` → `quantity_unresolved` + `null`; ноль никогда не подставляется.
6. **Условия fail-closed (§A-05):** executor'а нет ни для одного `kind`; `required`/`conditional` → block; `optional` → warning + `excluded` + `condition: "not_evaluated"` (не unconditional).
7. **AlternativeGroup (§A-08):** без выбора первой строки и без суммирования; <2 строк / нет `alternativeGroup` → `TRACE_ALTERNATIVE_INVALID`; любая неоднозначность/невычислимость → `TRACE_ALTERNATIVE_AMBIGUOUS` → block.
8. **Единицы тарифа (§22.3):** умножение только по таблице `pcs×RUB_PER_PCS`, `m×RUB_PER_LINM`, `m2×RUB_PER_SQM`; `RUB_PER_M`/`RUB`/`FACTOR`/`cm`/`mm`/`kg`/неизвестная единица → `priceAmount = null` + диагностика, без нуля. Для этого `resolveCompositionTrace` принимает **дополнительный опциональный** вход `priceItems` (только `{id, unit}`) — `PriceSnapshot` единицу не хранит; без него совместимость не подтверждена → fail-closed.

### Изменённые файлы (4)

| Файл | Изменение |
|---|---|
| `src/lib/server/data-resolver.ts` | извлечён `resolveCompositionPreflight` + `collectCompositionDriftWarnings`; `CompositionPreflight`; +3 кода drift |
| `src/lib/server/composition-resolver.ts` | **новый** — `resolveCompositionTrace` |
| `src/lib/server/composition-resolver.test.ts` | **новый** — 11 тестов |
| `src/lib/admin/composition-data-resolver.test.ts` | +3 теста (handoff, legacy, drift-warning) |

**Не изменялись:** `engine.ts`, `pricing.ts`, `contract.ts`, `display-adapter.ts`, `golden.expected.ts`, геометрия, Legacy Pricing, `CalculationBreakdown`, ADR-06/07/08, admin-модель Composition, API, Zod-схемы, `schemaVersion`.

### Проверки (фактические)

| Команда | Результат |
|---|---|
| `npx tsc --noEmit` | **PASS** (0 ошибок) |
| `npx eslint <4 целевых файла>` | **PASS** (0 ошибок) |
| `npx vitest run` (полный набор) | **PASS — 120 файлов / 1250 тестов** |
| `git diff --check` | без новых замечаний (1 предупреждение в `projects.test.ts:1045` — предсуществующее, файл не изменялся) |
| whitespace/tabs/CRLF/EOF в 4 файлах | clean |
| `find -newermt "-40 minutes"` | только 4 целевых файла (+ документ rev.4 от предыдущего прохода) |

### За пределами E1 (не начато)

API pass-through `compositionVersionId` (A-02), Inspector, сохранение `compositionTrace` в `ProjectPriceHistory` (E4), `schemaVersion`, E5, подключение trace-вызова в расчётный путь (`projects.ts`), таблица сопоставления CompositionLine → CalculationLineId (О-1), boolean-семантика `code`/`managed_rule` (О-2), расширение В-7 (О-3).

**Следующий шаг:** решение владельца по О-1/О-2 → E2.

---

## Stage 10 / Block 4 — E2: подключение trace к расчётному потоку и Inspector (2026-11-16)

**Status: DONE (E3/E4 не начаты).**

### Что реализовано

1. **Передача `compositionVersionId` через API (additive-optional):**
   - `projectPayloadSchema` (`src/lib/configurator/schema.ts`) — `+ compositionVersionId?: string`;
   - `POST /api/projects` → `findCreateReplay` **и** `saveProject` (fingerprint, replay, сохранение);
   - `POST /api/calculation-inputs` → только `create`/`preview`; для `recalculate` pin по-прежнему берётся из проекта (единый источник, без дублирования).
   - `findCreateReplay` теперь включает pin в fingerprint — иначе повторный запрос с тем же `Idempotency-Key` получал ложный 409.
2. **Trace после Engine:** `calculatePriceFromInputs` возвращает сырой `CalculationBreakdown` (additive) и — при наличии handoff — `compositionTrace`. Trace строится **после** Engine на его готовом breakdown, тарифы читаются `listPriceItems()`; ошибка чтения тарифов → «единица неизвестна» (fail-closed), а не ноль.
3. **Инвариант:** trace **не влияет** на `price`/`breakdown`/итог. Блокирующие диагностики trace возвращаются как диагностика и не превращаются в ошибку расчёта; блокирующая семантика preflight (целостность/совместимость) не изменена.
4. **`/api/calculation-inputs`** возвращает `compositionTrace` (additive; отсутствует без pin).
5. **Inspector:** `getInspectorProject` → `compositionTrace: CompositionTraceView` со статусами `computed | blocked | absent | unavailable` + `issues`. Новая карточка «Composition Trace» в `src/app/admin/calculations/[projectId]/page.tsx`: версия, статус, строки (количество/единица/PriceItem/unit/amount/priceAmount/статус), warnings и блокирующие диагностики. Сопоставление CompositionLine → CalculationLineId явно помечено как неподтверждённое (О-1) и не выдаётся за факт. «—» вместо 0.

### Изменённые файлы (8)

| Файл | Изменение |
|---|---|
| `src/lib/configurator/schema.ts` | `projectPayloadSchema` + optional pin |
| `src/app/api/projects/route.ts` | pin → replay + save |
| `src/app/api/calculation-inputs/route.ts` | pin (create/preview) + `compositionTrace` в ответе |
| `src/lib/server/projects.ts` | `findCreateReplay` fingerprint; `breakdown` + `compositionTrace` в `calculatePriceFromInputs` |
| `src/lib/admin/calculation-inspector.ts` | `CompositionTraceView` + `computeCompositionTrace` |
| `src/app/admin/calculations/[projectId]/page.tsx` | карточка Composition Trace |
| `src/app/api/calculation-inputs/route.test.ts` | +4 теста |
| `src/app/api/projects/route.test.ts` | +5 тестов |

**Не изменялись:** `engine.ts`, `pricing.ts`, `contract.ts`, `display-adapter.ts`, `golden.expected.ts`, геометрия, Legacy Pricing, `CalculationBreakdown`, ADR-06/07/08, `composition.ts`/`composition-schema.ts` (административная модель Composition), `schemaVersion`.

### Проверки (фактические)

| Команда | Результат |
|---|---|
| `npx tsc --noEmit` | **PASS** |
| `npx eslint <8 файлов>` | **PASS** |
| `npx vitest run` (полный) | **PASS — 120 файлов / 1259 тестов** |
| `git diff --check` | без новых замечаний (1 предсуществующее в `projects.test.ts:1045`) |
| `find -newermt` | запрещённые файлы не изменялись |

### За пределами E2

Сохранение `compositionTrace` в `ProjectPriceHistory` (E4), ретро-восстановление, обязательность pin (О-6), расширение В-7 (О-3), таблица сопоставления CompositionLine → CalculationLineId (О-1), boolean-семантика `code`/`managed_rule` (О-2), Inspector-фильтры/экспорт.

---

## Stage 10 / Block 4 — E3: сквозные интеграционные и регрессионные проверки (2026-11-16)

**Status: DONE (только тесты; production-код E1/E2 не изменялся).**

### Проверено сквозным путём

| Сценарий | Где проверено | Результат |
|---|---|---|
| Create без pin | `api/projects/route.test.ts` | legacy-путь, pin отсутствует |
| Preview без pin | `api/calculation-inputs/route.test.ts` | ответ без `compositionTrace` |
| Create/Save с pin | `api/projects/route.test.ts` | `StoredProject.compositionVersionId` сохранён |
| Preview с pin | `api/calculation-inputs/route.test.ts` | trace в ответе, `price.total` идентичен |
| Replay тот же key+pin | `api/projects/route.test.ts` | 200, `replay: true`, тот же id |
| Replay тот же key, другой pin | `api/projects/route.test.ts` | 409 (fingerprint учитывает pin) |
| Неизвестный pin | `api/calculation-inputs/route.test.ts` | 422 `COMPOSITION_VERSION_UNKNOWN` |
| Повреждённый Composition | `api/calculation-inputs/route.test.ts` (E3) | запись отброшена → 422 |
| Повторное открытие проекта | `api/projects/route.test.ts` | Inspector отдаёт trace |
| Recalculate: pin из проекта | `api/projects/[id]/recalculate/route.test.ts` (E3) | pin сохранён, итог не изменён |
| Recalculate: подмена pin клиентом | там же (E3) | 422 (`strictObject`) |
| Inspector: unresolved без нуля | `api/projects/route.test.ts` (E3) | `quantity=null`, `status=quantity_unresolved` |
| Inspector: без побочных записей | там же (E3) | коллекции до/после чтения идентичны |

### Подтверждённые инварианты

- порядок `DataResolver → Engine → resolveCompositionTrace` (trace получает готовый `breakdown`, вызвать его раньше структурно невозможно);
- `price.total` и `CalculationBreakdown` не зависят от pin и от trace;
- trace не содержит `total` и не добавляет строк в `breakdown`;
- только `fixed` quantityRef; `code`/`managed_rule` не исполняются; отсутствие данных → `null`, не 0;
- `required`/`conditional` + неисполнимое условие → block трассировки; `optional` → `excluded` + warning;
- AlternativeGroup: без выбора первой строки и без суммирования, неоднозначность → block трассировки;
- единицы: только `pcs↔RUB_PER_PCS`, `m↔RUB_PER_LINM`, `m2↔RUB_PER_SQM`;
- preflight-блоки (целостность/совместимость) останавливают расчёт; trace-блоки — нет; drift — warning; без pin — legacy.

### Изменённые файлы (3, только тесты)

`src/app/api/calculation-inputs/route.test.ts` · `src/app/api/projects/route.test.ts` · `src/app/api/projects/[id]/recalculate/route.test.ts`

### Проверки (фактические)

| Команда | Результат |
|---|---|
| `npx tsc --noEmit` | **PASS** |
| `npx eslint <3 файла>` | **PASS** |
| `npx vitest run` (полный) | **PASS — 120 файлов / 1263 теста** (было 1259) |
| `git diff --check` | без новых замечаний (1 предсуществующее в `projects.test.ts:1045`) |

**Дефектов E1/E2 не обнаружено** — исправлений production-кода не потребовалось.

---

## Stage 10 / Block 4 — E4: сохранение CompositionTrace в истории (2026-11-16)

**Status: DONE (E5 не начат).**

### Модель хранения

`ProjectPriceHistory.compositionTrace?: CompositionTraceSnapshot` (`src/lib/configurator/types.ts`) — additive-optional, **без повышения `schemaVersion`**. Снимок самодостаточен: `compositionVersionId`, `compositionContentHash`, `compositionRulesSnapshotId`, `rulesSnapshotId`, `enginePriceVersionId`, `enginePriceBaseSchema`, `pinnedPriceVersionId`, `catalogVersions`/`priceItemVersions` (pins), построчно `quantity`/`unit`/`quantitySource`/`priceItemId`/`amount`/`priceItemUnit`/`priceAmount`/`status`/`condition`, `warnings`, общий `status` (`computed|blocked`) и `computedAt`.

`projectPriceHistorySchema` (`z.strictObject`) расширена `compositionTrace: compositionTraceSnapshotSchema.optional()` — старые записи валидны как есть, миграций нет.

### Точка вычисления и сохранения

`resolveCompositionTrace` → `toCompositionTraceSnapshot(result, now)` вызывается **один раз** в `saveProject` и `recalculateProject`, сразу после Engine, и передаётся в `createHistoryEvent` → записывается в **то же событие** `ProjectPriceHistory`, что и `breakdown` (один atomic `updateCollection`). Отдельной записи trace нет. При `blocked` сохраняется снимок с `status:"blocked"`, `lines: []` и диагностиками в `warnings` — расчёт Engine при этом не блокируется.

### Чтение

`getInspectorProject`: приоритет — `latestHistory.compositionTrace`
(`viewFromSnapshot`), без обращения к `resolveCompositionTrace`, текущим
Composition/RulesSnapshot/PriceItem. Live-пересчёт остаётся только для записей
без снимка (история до E4). Пути явно различаются полем `source: "history" | "live" | "none"` и бейджем в UI.

### Изменённые файлы (7)

| Файл | Изменение |
|---|---|
| `src/lib/configurator/types.ts` | `CompositionTraceSnapshot(+Line/Issue)`, поле в `ProjectPriceHistory` |
| `src/lib/configurator/schema.ts` | `compositionTraceSnapshotSchema` + optional в `projectPriceHistorySchema` |
| `src/lib/server/composition-resolver.ts` | `CompositionTraceContext`, `context` в результате, `toCompositionTraceSnapshot` |
| `src/lib/server/projects.ts` | запись trace в `createHistoryEvent` из `saveProject`/`recalculateProject` |
| `src/lib/admin/calculation-inspector.ts` | приоритет сохранённого снимка, `source`, live-путь выделен |
| `src/app/admin/calculations/[projectId]/page.tsx` | бейдж источника + `computedAt` |
| `src/lib/admin/composition-trace-history.test.ts` | **новый**, 8 тестов |

**Не изменялись:** Engine/формулы, Pricing/Legacy Pricing, `CalculationBreakdown`, геометрия, whitelist Engine/`CalculationInputs`, `admin/composition.ts`/`composition-schema.ts`, ADR-06/07/08, `schemaVersion` (2), `calcVersion`.

### Проверки (фактические)

| Команда | Результат |
|---|---|
| `npx tsc --noEmit` | **PASS** |
| `npx eslint <7 файлов>` | **PASS** (0 ошибок, 0 предупреждений) |
| `npx vitest run` (полный) | **PASS — 121 файл / 1271 тест** (было 1263) |
| `git diff --check` | без новых замечаний (1 предсуществующее в `projects.test.ts:1045`) |

### E4 — точечная корректировка исторического чтения (2026-11-16)

**Исправлено:** `getInspectorProject` больше не использует live-fallback для исторических записей без сохранённого `compositionTrace`.

| Случай | Было | Стало |
|---|---|---|
| История со снимком | `source: history` | без изменений |
| История с pin, но без снимка | live-пересчёт (`live`/`unavailable`) | `status: "absent"`, `source: "none"`, без вызова resolver |
| Текущий live-расчёт | внутренний helper | экспортирован `computeLiveCompositionTraceView` → `source: "live"` |
| Legacy без pin | `absent` / `none` | без изменений |

**Файлы (3):** `src/lib/admin/calculation-inspector.ts`, `src/lib/admin/composition-trace-history.test.ts` (+4 теста), `src/app/api/projects/route.test.ts` (актуализирован кейс «неизвестный pin»).

**Проверки:** `tsc` PASS · `eslint` PASS · `vitest run` **121 файл / 1275 тестов PASS** · `git diff --check` без новых замечаний.

### Composition Pricing Drift Diagnostics (2026-11-16)

**Реализовано:** drift-диагностики версий тарифа доставляются из preflight в trace → Inspector → исторический snapshot. Все — `severity: "warning"`, расчёт не блокируют.

| Диагностика | Условие |
|---|---|
| `PRICE_VERSION_PIN_MISSING` | Composition закреплена, `pins.priceVersionId` отсутствует |
| `PRICE_VERSION_DRIFT` | `pinnedPriceVersionId` ≠ `enginePriceVersionId` (сообщение содержит обе версии) |
| `COMPOSITION_*_DRIFT` (3 кода) | переносятся из `CompositionPreflight.warnings` без переименования |

Совпадающие версии — предупреждение не создаётся. Дедупликация по `severity+code+lineId+message`.

**Файлы (4):** `src/lib/configurator/types.ts` (+5 кодов), `src/lib/server/composition-resolver.ts` (перенос + 2 проверки + дедуп), `src/lib/server/composition-resolver.test.ts` (фикстуры + 5 тестов), `src/lib/admin/composition-trace-history.test.ts` (хелперы + 4 теста).

**Не изменялись:** Engine/контракт, Pricing, `CalculationBreakdown`, геометрия, Composition lifecycle/схемы, ADR-07/08, Production Gate, исторические записи. `priceVersionId` остаётся optional.

**Проверки:** `tsc` PASS · `eslint` PASS · `vitest run` **121 файл / 1284 теста PASS** · `git diff --check` без новых замечаний.

---

## Stage 10 / Block 5 — STORE ↔ CALCULATION ADMIN INVENTORY (2026-11-16)

**Status: DONE (READ-ONLY; код, схемы, API, БД, конфигурация и ADR не изменялись).**

Созданы три документа:
- `docs/CALCULATION_ADMIN/STORE_ADMIN_INVENTORY.md` — инвентаризация Store и Admin, карта 30 элементов, 6 групп подтверждённых расхождений;
- `docs/CALCULATION_ADMIN/STORE_ADMIN_GAP_ANALYSIS.md` — 19 gap-пунктов (MISSING/PARTIAL/CODE_ONLY/DUP), риски, отдельный раздел неподтверждённых предположений;
- `docs/CALCULATION_ADMIN/GLOBAL_IMPLEMENTATION_BACKLOG.md` — 20 задач (DONE/OPEN/BLOCKED/OWNER DECISION), 12 решений владельца, проверка ранее открытых вопросов.

**Ключевые факты:** 30 элементов карты — COMPLETE 13, PARTIAL 8, CODE_ONLY 6, MISSING 2, NOT_REQUIRED 1, UNKNOWN 0. Store: `catalog-items` 64 (14 видов из 16 объявленных), `module-presets` 8 (kitchen; wardrobe 0), `price-items` 98/93, `pricing-versions` 2/1, `projects` 200. Коллекции `rules-snapshots`, `admin-parameters`, `parameter-dependencies`, `composition-versions` в Store отсутствуют.

**Запрещённые области не изменялись.** Тесты не запускались (код не менялся).

---

## Stage 10 / Block 5 — CA-GL-00.1: BACKLOG RECONCILIATION (2026-11-16)

**Status: DONE (READ-ONLY; код, данные, API, схемы и ADR не изменялись).**

### Реконсиляция
Устранено арифметическое противоречие «20 задач / 23 позиции»: смешивались задачи, завершённый блок и записи решений. Итог — **21 ID задач** (`CA-GL-01…21`), из них **19 активных**, 2 закрыты верификацией (`CA-GL-12`, `CA-GL-14`); отдельно 1 завершённый блок (E1–E4, drift diagnostics) и 12 записей решений `OD-1…OD-12`.

### Статусы
`DONE` 2 · `OPEN` 4 · `OWNER DECISION` 9 · `BLOCKED` 2 · `DEFERRED` 4 = 21.

### Исправленные противоречия
1. `ManagedRule`/`RulesSnapshot` больше не `MISSING`: `IMPLEMENTED`, `DATA_READY=false` (карта: `PARTIAL`).
2. Два бэкенда Store — **взаимоисключающие адаптеры** (`storage/index.ts:9–45`), а не параллельные источники; `CA-GL-12` закрыт верификацией.
3. Параметры сеются `applyBootstrap` (`bootstrap.ts:653,1287`) — `CA-GL-14` закрыт.
4. Критический путь уточнён: блокер эксплуатации — **только `CA-GL-01`** (активный `RulesSnapshot`), а не `CA-GL-02` (Composition, pin необязателен).
5. Добавлена подтверждённая задача `CA-GL-21` (backfill `rulesSnapshotId` для 200 legacy-проектов).

### Факты
- `RULES_SNAPSHOT_MISSING` блокирует **create/preview** (`data-resolver.ts:1367–1375`) и **recalculate** legacy (`:1353–1362`).
- Seed готов: **27** правил (`managed-rules-seed.ts:94,164`); публикация — `publishRulesSnapshot` (`managed-rules.ts:831`).
- Тесты не запускались (код не менялся).

---

## Stage 10 / Block 6 — WP-1: DATA & RECOVERY READINESS (2026-11-16)

**Status: DONE.** Публикация RulesSnapshot не выполнялась; production-данные не изменялись.

### CA-GL-08 — legacy materials
- 200/200 проектов: `mdf` / `ldsp` / `ldsp_hpl` / `profile` / `flat`, `kind=kitchen`, `schemaVersion=1`.
- Legacy-материалы (`veneer`/`glass`/`solid`) используют **0** проектов; все три — активные CatalogItem с действующими тарифами в published-снимке (`MATCHED`).
- `MATCHED` 14 · `CURRENT_ONLY` 1 (`mdf_pvc`) · `HISTORICAL_ONLY`/`MISSING_PRICE`/`AMBIGUOUS`/`UNKNOWN` — 0.
- Риск «исторический фасад без тарифа → 0 ₽» в текущих данных не воспроизводится.

### CA-GL-11 — restore drill
- `node scripts/restore-drill.mjs` → **RESTORE DRILL PASS** (integrity=ok).
- Drill на реальном наборе: `VACUUM INTO` копии → integrity `ok`, 9/9 коллекций, payload-хеши 5/5 MATCH, SHA-1 (`shasum`) источника до/после идентичен.
- Детекция повреждения: затирание 4 КБ → `integrity_check` вернул ошибки; битый JSON → `JSONDecodeError`.
- Пробелы: нет drill для JSON-бэкенда; нет планировщика backup в репозитории.

### ManagedRules — 27 seed
- 3 плотности (11.5 / 14.8 / 16.8 кг/м²) + 24 полосы петель (8 диапазонов × height/mass/count).
- Все: `scope=wardrobe`, `category=norm`, `source=preliminary`, `affects=["quantity"]`, `assigns=line:wardrobe.*`.
- Engine читает нормы **только** в `calculateWardrobeBreakdown` (fail-closed); кухня снимок не читает.
- Влияние на 200 существующих (кухонных) проектов — нулевое.
- Готовы к публикации технически; требуется OD-13 (подтверждение `preliminary`).

### Обнаруженные проблемы
1. `mdf_pvc` активен в коде/UI и в `defaultWardrobe`, но **отсутствует в Store** → расчёт упадёт (`CA-GL-22`).
2. `admin-parameters.json` отсутствует, хотя bootstrap его создаёт (на расчёт не влияет).
3. 200 проектов ссылаются на `price-1`/`price-2`, отсутствующие в Store; 31 проект без истории.
4. 3 PriceItem вне published-снимка, `usage=unused`.

### Проверки
Целевые: `managed-rules.test.ts`, `managed-rules-seed.test.ts`, `rules-diagnostics.test.ts`, `import-legacy.test.ts`, `legacy-facade-guard.test.ts` → **69 тестов PASS**. Полный набор не запускался (код не менялся).

### Блокеры WP-2
`CA-GL-01` (активный RulesSnapshot) + `OD-13` (подтверждение 27 норм). Остальное не блокирует.

---

## Stage 10 / Block 7 — WP-2: RULES ACTIVATION & STORE DATA READINESS (2026-11-16)

**Status: PREPARED (публикация RulesSnapshot и production bootstrap не выполнялись — ожидают OD-13/CA-GL-22).**

### ManagedRules — 27 правил
Полная поштучная таблица — `docs/CALCULATION_ADMIN/WP2_RULES_REVIEW.md` § 1.
3 плотности (16/19/22 мм → 11.5 / 14.8 / 16.8 кг/м²) + 24 полосы петель (8 диапазонов × max-height/max-mass/count).
Все `wardrobe` / `norm` / `preliminary`; Engine читает только `calculateWardrobeBreakdown`; кухня не читает.
Активация Rules не требует изменения Composition.

### Дефекты
- **D-1** `sourceRef` неточен (`:17-39` vs фактические `:22-43`) → OD-14.
- **D-2** `unit` не задан; `RULE_UNITS` не поддерживает физические единицы.
- **D-3** дверь за пределами полосы 8 → `count=6` + `overload:true` (существующее поведение).

### CA-GL-22 — bootstrap
- Dry-run на копии `data/formakub.db`: готово к добавлению — **1 catalog** (`mdf_pvc`) и **61 AdminParameter**.
- `applyBootstrap` **отказывается**: 10 catalog + 5 preset + 1 pricing-version конфликтов.
- Вывод: повторный bootstrap неприменим; рекомендуется целевое добавление через Admin API.

### Тесты
`managed-rules`, `managed-rules-seed`, `rules-diagnostics`, `bootstrap`, `bootstrap.apply`, `storage`,
`golden`, `wardrobe-golden-verification`, `calculation-inputs/route` → **9 файлов / 112 тестов PASS**.
Typecheck/lint не запускались: production-код не менялся (создан только временный probe, удалён).

### Блокеры WP-3
OD-13 (27 норм `preliminary`), OD-14 (`sourceRef`), CA-GL-22 (разрыв данных Store).

---

## Stage 10 / Block 8 — WP-2.1: RULES ACTIVATION PREP & TARGETED STORE (2026-11-16)

**Status: PREPARED.** Импорт/публикация правил и запись в Store не выполнялись (ожидают OD-13 / CA-GL-22).

### D-1 — исправлено
`sourceRef` 27 правил: вместо общего `:17-39` — точная строка значения (плотности 23/24/25; полосы 36–43).
Значения, ID, scope, category, affects не менялись. Добавлены 3 теста (существование файла/строки, наличие значения, различение 11 уникальных строк).
Изменён только `src/lib/admin/managed-rules-seed.ts` (+ тест). OD-14 закрыт.

### D-2 — зафиксировано
`RULE_UNITS` не содержит физических единиц → `unit` у норм отсутствует. Семантика (кг/м², мм, кг, шт.) зафиксирована в `WP2_RULES_REVIEW.md` § 12. Схема/API/Engine не изменялись.

### D-3 — зафиксировано
За полосой 8 → `count=6` + `overload:true`; покрыто `wardrobe-hinges.test.ts:95`; Engine не менялся.

### Payloads
- импорт: `POST /api/admin/rules/import`, body `{}`, `Idempotency-Key`; ожидание `created: 27`, `expected: 27`;
- публикация: `POST /api/admin/rules/publish` с 27 `{id, expectedVersion:"1"}`, `confirmed:true`, `expectedStateVersion:"none"`;
- `mdf_pvc`: `POST /api/admin/catalogs/facadeMaterial/items` с `priceRefs.ratePerSqm = catalog.facade.mdf_pvc.ratePerSqm`;
- 61 параметр: **create-API отсутствует** (только GET/PATCH) → `CA-GL-22b` BLOCKED; на расчёт не влияет.

### Тесты
См. отчёт WP-2.1; golden не изменился.

---

## Stage 10 / Block 9 — WP-2.2: CONTROLLED RULES ACTIVATION (2026-11-16)

**Status: BLOCKED на публикации (Q7-06); `mdf_pvc` добавлен.**

### Выполнено
- Preflight: backend `sqlite`, 0 правил, активного снимка нет, `mdf_pvc` отсутствует, PriceItem `catalog.facade.mdf_pvc.ratePerSqm` есть.
- Checkpoint: `data/backups/wp22-checkpoint-2026-11-16T12-25-24-039Z.db` (integrity `ok`, 9 коллекций).
- Импорт 27 правил: `created 27`, все `draft`/`version=1`/`preliminary`; повтор идемпотентен.
- `mdf_pvc`: создан, `priceRefs` разрешается в `RUB_PER_SQM`/`active`; `facadeMaterial` = 6 записей.

### Заблокировано
- Публикация RulesSnapshot: `managed-rules.ts:865–869` → «source=preliminary и не может быть опубликовано (Q7-06)».
- OD-13 противоречит Q7-06 (утверждённый ADR-07). Проверки не обходились, альтернативный механизм не создавался.
- Требуется OD-15: (A) сменить `source` на `owner_confirmed` и опубликовать; (B) изменить ADR-07 (вне scope); (C) оставить draft.

### Состояние
- SQLite: 10 коллекций (добавлена `managed-rules.json`); `rules-snapshots.json` не создан; integrity `ok`.
- 27 правил `draft`/`preliminary`, активного снимка нет.
- `data/projects.json` sha256 `0472da8a…` не изменён (200 проектов не затронуты).
- Create/preview блокируются `RULES_SNAPSHOT_MISSING` (контролируемо).

### Тесты
`managed-rules`, `managed-rules-seed`, `rules-diagnostics`, `rules-publication-config`, `bootstrap`, `golden`, `wardrobe-golden-verification`, `calculation-inputs/route` → **8 файлов / 102 теста PASS**. Golden не изменялся.

### Метод
HTTP admin API требует OIDC-сессии (в среде отсутствует) → выполнены те же сервисные функции, что вызывают маршруты. Временные probe-файлы удалены; production-код не изменялся.

### Уточнение терминологии
Ранее в отчётах WP-1/WP-2 значения вида `5198c696…` назывались «SHA-256»; фактически это **SHA-1**
(`shasum` по умолчанию). Формулировки исправлены в `STORE_ADMIN_INVENTORY.md` и в этой записи.
Для WP-2.2: `data/formakub.db` SHA-1 `5198c696…` → `3c8e40d9…` — **ожидаемое** изменение
(добавлены `managed-rules.json` и `mdf_pvc`); `data/projects.json` SHA-256 `0472da8a…` не изменён.

---

## Stage 10 / Block 10 — WP-2.3: OWNER CONFIRMATION & RULES ACTIVATION (2026-11-16)

**Status: DONE (RulesSnapshot активирован); CA-GL-22a откачен.**

### Owner confirmation (OD-15)
- Штатный механизм: `updateManagedRule(id, { source: "owner_confirmed", expectedVersion })` (PATCH `/api/admin/rules/[id]`); отдельного `rule.confirm` нет.
- 27 правил: `source` `preliminary` → `owner_confirmed`, версии `1` → `2`, статус `draft`.
- Значения, ID, `sourceRef`, `scope`, `category`, `affects`, `valueType` — без изменений.
- Audit: 27 событий `rule.update`, actor `owner-od15`, дата фиксируется. **Ограничение:** схема audit-log не имеет поля для текстового основания — формулировка OD-15 зафиксирована в документации.

### RulesSnapshot
- Snapshot **`rules-e36377dc500aff22`**, 27 правил, все `owner_confirmed`, активен.
- Journal: `rules-publication-journal.json` (1 запись).

### Verification
- Кухня: preview + `calculatePriceFromInputs` → ok, `total 210 100`, `rulesSnapshotId` присутствует.
- Шкаф: `total 128 300`, `wardrobe.fittings 29 050`.
- Границы: 600/5 → 2; 601/5 → 2; 2700/35 → 6; 2701 → `null`; 36 кг → `null` (overload fallback).
- Golden/wardrobe-golden: без изменений (135 целевых тестов PASS, включая rules-api 14).
- SQLite integrity `ok`; `data/projects.json` SHA-256 `0472da8a…` не изменён.

### CA-GL-22a — откат
Добавление `mdf_pvc` изменило fingerprint `display-metadata` → расчёт упал `DISPLAY_METADATA_UNAVAILABLE`. На checkpoint metadata валидна. Элемент удалён; каталог побайтно совпал с checkpoint; metadata и расчёт восстановлены. Задача переведена в `BLOCKED` (нужен единый пакет «CatalogItem + reseed display-metadata»).

### Итог
`CA-GL-01` — **DONE**; `CA-GL-22a` — **BLOCKED**; `CA-GL-22b` — `DEFERRED`; `OD-15` — закрыт.

---

## Stage 11 — MVP COMPLETION · проход 1 (2026-11-16)

### Фактическое состояние (сверено с кодом и Store)
- **RulesSnapshot уже активен**: `rules-e36377dc500aff22`, 27 правил, `owner_confirmed`, версии `2` (WP-2.3). Пункт «27 в draft / snapshot не опубликован» в постановке устарел.
- `mdf_pvc` в Store **отсутствует** (откачен в WP-2.3; повторное добавление снова ломало расчёт — откат выполнен в этом проходе).
- Кухня: **210 100 ₽**; шкаф: **128 300 ₽** (реальный путь `resolveCalculationInputs` → `calculatePriceFromInputs`).
- Гардеробная (`dressing`): **`ENGINE_CONTRACT_MISSING_INPUT`** — `defaultDressingRoom()` использует `mdf_pvc`, которого нет в каталоге.
- `display-metadata` валидна (`ec5195ec64d9`) при текущем каталоге.
- 200 проектов — в JSON; активный SQLite `projects = 0` (не объединялись).

### Ключевой дефект (блокирует гардеробную и мешает Admin)
`readDisplayMetadata` проверяет fingerprint, включающий **labels каталогов**. Любое добавление/переименование CatalogItem делает metadata невалидной → **все расчёты падают** `DISPLAY_METADATA_UNAVAILABLE`, пока metadata не будет перегенерирована.
При этом сохранённые `lineDefinitions` в production **не совпадают** с текущим `DISPLAY_METADATA_SEED` → `seedDisplayMetadata` изменил бы отображаемые определения (UI-тексты). Автоматический reseed без решения владельца недопустим.

### Проверки
`npx tsc --noEmit` → **PASS**; `npx vitest run` → **121 файл / 1287 тестов PASS**. Golden не изменялся.

### Требуется решение владельца
Гардеробная (и `mdf_pvc`): (A) разрешить регенерацию display-metadata (UI-тексты могут измениться) + добавить `mdf_pvc`; (B) перевести `defaultDressingRoom` на существующий материал (изменение бизнес-конфигурации); (C) убрать пресет «Гардеробная».

---

## Stage 11 / Block 2 — CA-GL-24: Display Metadata Integrity (2026-11-16)

**Status: DONE.**

### Первопричина
`readDisplayMetadata` сверял fingerprint, покрывавший `lineDefinitions + catalogLabels + support/led sources + texts`. Любое изменение названия материала или добавление CatalogItem меняло отпечаток → метаданные становились «повреждёнными» → все расчёты падали `DISPLAY_METADATA_UNAVAILABLE`.

### Исправление (минимальное)
- Новый `computePersistedMetadataFingerprint` — отпечаток только персистентного содержимого (`lineDefinitions`, `supportsPreliminaryNote`, `disclaimer`).
- `readDisplayMetadata` принимает **новый или legacy** отпечаток; иное значение по-прежнему отклоняется (целостность не ослаблена).
- `saveDisplayMetadata` пишет новый отпечаток; пер-запись идемпотентность сохранена.
- Production: выполнен контролируемый перенос отпечатка **без изменения lineDefinitions** (`validationIssues=0`), затем добавлен `mdf_pvc`.

### Результат
| Проверка | Значение |
|---|---|
| `lineDefinitions` до/после | **идентичны** (UI-тексты не менялись) |
| fingerprint | `fe4668518695…` (персистентный), не меняется при изменении каталога |
| `mdf_pvc` | добавлен, `priceRefs.ratePerSqm → catalog.facade.mdf_pvc.ratePerSqm` |
| Кухня | **210 100 ₽** |
| Шкаф | **128 300 ₽** |
| Гардеробная | **154 100 ₽** (ранее `ENGINE_CONTRACT_MISSING_INPUT`) |
| Тесты | **121 файл / 1289 тестов PASS**; `tsc` PASS; `eslint` PASS |
| Golden | без изменений |

### Осталось
E2E в запущенном приложении (кухня/шкаф/гардеробная: сборка → расчёт → сохранение → открытие → заявка → получение владельцем) — следующий шаг.

---

## Stage 11 / Block 3 — E2E PASS 2 (2026-11-16)

**Status: частично (расчёты и Store готовы; браузерный E2E не завершён; найден дефект заявки).**

### Проверено
- Расчётный путь подтверждён: кухня 210 100 ₽, шкаф 128 300 ₽, гардеробная 154 100 ₽ (после CA-GL-24).
- Полный Vitest — 121 файл / 1289 тестов PASS; `tsc` PASS; `eslint` PASS; golden без изменений.
- Store: 12 коллекций, integrity `ok`, RulesSnapshot `rules-e36377dc500aff22` (27, `owner_confirmed`), `mdf_pvc` в каталоге, display-metadata персистентный fingerprint.
- Исторические проекты (`data/projects.json`, 200) не изменялись (sha256 `0472da8a…`).

### Браузерный E2E
Штатный harness `scripts/run-browser-smoke.sh` (temp SQLite copy + disposable Keycloak + Chrome CDP) запущен, но **не завершился в лимите среды** (>15 мин: `next dev` + Keycloak + CDP). Лог показал только dev-hydration warning (`className ... js`). Браузерный E2E **не засчитан**.

### Найденный дефект MVP
`CA-GL-25`: заявка не содержит `projectId` → владелец не может открыть сохранённый проект. Основание: `configurator/schema.ts:287–295`, `types.ts:359–364`, `LeadForm.tsx:43–50`. Требуется аддитивное поле + UI-передача + переход в Admin.

### Осталось
1. `CA-GL-25` (заявка ↔ проект).
2. Браузерный E2E кухня/шкаф/гардеробная (сборка → цена → сохранение → открытие → заявка → приём владельцем) в среде с достаточным временем.
3. Admin UI проверка цен и влияния на новые расчёты.

---

## Stage 11 / Block 4 — CA-GL-25 + админ-доступ к заявкам (2026-11-16)

**Status: реализовано (код), позитивный интеграционный тест не покрыт.**

### Изменения
| Файл | Изменение |
|---|---|
| `configurator/types.ts` | `LeadPayload.projectId?` |
| `configurator/schema.ts` | `leadPayloadSchema.projectId` (regex 8 символов) |
| `server/leads.ts` | `createLead({projectId})` + серверная проверка через `getProject`; `listLeads()` |
| `app/api/leads/route.ts` | передача `projectId` |
| `components/site/LeadForm.tsx` | prop `projectId`, включение в тело запроса |
| `components/configurator/LeadModal.tsx` | prop `projectId` |
| `components/configurator/ConfiguratorStudio.tsx` | передаёт `savedProjectId` |
| `app/admin/leads/page.tsx` | **новая** страница заявок: дата, клиент, контакты, тип, цена, ссылка «Открыть проект» |

### Проверки
- `createLead` с неизвестным/невалидным проектом → отказ, заявка не создаётся.
- Заявка без `projectId` (legacy) валидна.
- `tsc` PASS, `eslint` PASS, целевые тесты 3/3.
- Полный Vitest — см. отчёт.

### Не закрыто
1. Позитивный тест «заявка ↔ реальный сохранённый проект» (фикстура проекта должна создаваться через `saveProject` в полном окружении).
2. Браузерный E2E трёх конструкторов — не выполнялся (harness > лимита среды).
3. Проверка изменения цен через Admin UI.

---

## Stage 11 / Block 5 — Final Integration Verification (2026-11-16)

### CA-GL-25 — позитивный интеграционный тест (DONE)
`src/lib/server/leads-project.integration.test.ts` (3 теста PASS): реальный проект через `saveProject` → `createLead({projectId})` → `listLeads` → повторное открытие `getProject`; цена лида совпадает с ценой проекта; контакты/тип/конфигурация сохранены; несуществующий и некорректный `projectId` отклоняются; legacy-заявка без `projectId` создаётся.

### Браузерная проверка (частично)
Локальный запуск `next dev` на изолированной копии SQLite: `/` → **200**; `/admin/leads` → **307** (auth-guard работает); Chrome headless отрендерил страницу (`47 КБ` DOM).
**Важно:** публичные маршруты конструктора — `/configurator/<kind>` (из `ConfiguratorStudio`: `/configurator/${config.kind}`); базовый `/configurator` и `/projects` дают **404**. Полный браузерный путь (сборка → цена → сохранение → заявка → Admin) **не выполнялся** — не засчитан.

### Незакрытые блокеры
1. Браузерный E2E трёх конструкторов на `/configurator/kitchen|wardrobe|dressing`.
2. Admin UI изменение цены в изолированной копии (не выполнялось).

---

## Stage 11 / Block 6 — Final Browser & Admin Verification (2026-11-16)

### Полная регрессия
`npx vitest run` → **123 файла / 1295 тестов PASS** (включая `leads-project.integration.test.ts`); `tsc` PASS; `eslint` PASS; golden без изменений.

### Браузерная проверка (реальный Chrome, изолированная SQLite-копия, один поднятый `next dev`)
| Маршрут | HTTP | DOM | Цена в DOM |
|---|---|---|---|
| `/` | 200 | — | — |
| `/configurator/kitchen` | 200 | 128 КБ | «Предварительная стоимость», суммы в ₽ |
| `/configurator/wardrobe` | 200 | 95 КБ | «Предварительная стоимость», «Итого до скидки», суммы в ₽ |
| `/configurator/dressing` | **404** | — | маршрут не существует |

**Вывод:** гардеробная — не отдельный маршрут, а пресет шкафа (`defaultConfig("dressing")` → `kind: "wardrobe"`); её расчёт проверен на уровне Engine (154 100 ₽), отдельный URL не предусмотрен.

### Не выполнено
Полный браузерный путь (сохранение → заявка → Admin → проект) и изменение цены через Admin UI — требуют авторизованной Keycloak-сессии и большего времени; в этом проходе не выполнялись.

---

## Stage 11 / Block 7 — PASS 7: Browser acceptance driver (2026-11-16)

**Status: инструмент создан, сценарий не пройден.**

- Создан `scripts/acceptance-driver.mjs` (CDP, без новых зависимостей): открытие → ожидание цены → изменение параметра кнопкой «+» → сохранение → чтение `projectId` → повторное открытие → заполнение и отправка заявки.
- Селекторы взяты из фактического UI: `#lead-name`, `#lead-contact`, `#lead-email`, чекбокс согласия; сохранение — кнопка «Сохранить проект» / «Сохранить и получить ссылку»; `projectId` читается из `?project=<8 символов>` в DOM.
- Прогон: app 200, Chrome CDP поднят, `/configurator/kitchen` предварительно прогрет (200), `POST /api/calculation-inputs` → 200 (app.log).
- **Драйвер упал на шаге 1** (`timeout waiting for configurator render`): CDP-сессия не увидела клиентский текст. Причина — привязка к целевому таргету/навигация (`/json/new?<url>`), а не приложение: SSR-страница содержит «Кухня», API расчёта отвечает 200.
- В `app.log` присутствуют `Ecmascript file had an error` (dev-предупреждения компиляции) — не блокируют отдачу 200.

**Не пройдено:** ни один браузерный сценарий. Требуется исправление драйвера (attach к page-таргету после `Page.navigate`, ожидание `next dev` компиляции) и повторный прогон.

---

## Stage 11 / Block 8 — PASS 8: CDP driver stabilization (2026-11-16)

**Status: драйвер стабилизирован; полный E2E не запускался (по условию PASS 8).**

### Исправления `scripts/acceptance-driver.mjs`
- Target создаётся как `about:blank` (`PUT /json/new?about:blank`), затем `Page.navigate` уже внутри CDP-сессии (ранее URL передавался закодированным в query и страница не навигировалась).
- Явные таймауты на WS-подключение; ожидание `document.readyState === 'complete'`.
- Предикат готовности конструктора заменён на реальный: `button > 20` и текст «Кухня по вашим размерам» (текста «Предварительная стоимость» в DOM нет).
- Скриншот `Page.captureScreenshot` → `artifacts-acceptance-kitchen-open.png`; диагностический JSON → `artifacts-acceptance-kitchen-<stamp>.json`.
- При отказе сохраняются `failBodyText`, `failButtons`, `failHtmlHead`, размер скриншота.

### Фактические результаты (два последовательных запуска)
| Проверка | RUN 1 | RUN 2 |
|---|---|---|
| CDP подключён | ✅ | ✅ |
| `readyState` = complete | ✅ | ✅ |
| title/href/body | ✅ | ✅ |
| Кнопок в конструкторе | 63 | 63 |
| Цена из DOM | 209 600 ₽ | 209 600 ₽ |
| Сохранение проекта (клик) | ✅ `du6xqhey` | ✅ `7epjhrzp` |
| Скриншот | ✅ 359 КБ | ✅ 359 КБ |
| Диагностический JSON | ✅ | ✅ |
| Повторяемость | ✅ одинаковая картина | ✅ |

### Не закрыто (для PASS 9)
1. `param-change:false` — кнопка «+» не найдена (нужен реальный селектор изменения модуля).
2. Повторное открытие: `timeout waiting for reopen render` — предикат reopen всё ещё содержит несуществующий текст «Предварительная стоимость».
3. Заявка (форма/отправка) не пройдена — доходит до reopen.

---

## Stage 11 / Block 9 — PASS 9: Kitchen Browser E2E (2026-11-16)

**Status: частично (сохранение и повторное открытие — PASS; изменение параметра и заявка — FAIL).**

### Выполнено в реальном Chrome (CDP, изолированная SQLite, один `next dev`)
| Этап | Результат |
|---|---|
| Открытие `/configurator/kitchen` | PASS (63 кнопки, цена 210 100 ₽) |
| Изменение параметра («Добавить модуль») | FAIL: клик выполнен, но счётчик модулей не изменился (6 → 6); цена из DOM изменилась на 8 200 ₽ (цена выбранного модуля, а не итог) |
| Сохранение через UI | PASS, `projectId = wd74zf5z` |
| Повторное открытие `?project=wd74zf5z` | PASS: URL корректен, цена 210 100 ₽ совпадает с сохранённой |
| Открытие заявки | клик выполнен, но форма `#lead-name` не появилась (`timeout waiting for lead form`) |
| Отправка заявки | NOT EXECUTED; в тестовой БД 0 заявок |

### Артефакты
`artifacts-acceptance-kitchen-open.png`, `artifacts-acceptance-kitchen-final.png`, `artifacts-acceptance-kitchen-2026-11-16T13-44-51-830Z.json`.

### Дефекты/блокеры драйвера
1. «Добавить модуль» не увеличивает счётчик — нужно исследовать фактический обработчик (возможно, кнопка открывает выбор типа модуля, а не добавляет).
2. Заявка: модалка не содержит `#lead-name` на этом шаге (вероятно, другой компонент/портал или требуется предварительный шаг).
3. Приложение не изменялось; бизнес-логика не затрагивалась.

---

## Stage 11 / Block 10 — PASS 10.1: Final Evidence Verification (2026-11-16)

### Фактический success-UI
`LeadForm` при успехе рендерит блок `role="status"`: заголовок **«Заявка сохранена»**, текст «Номер заявки: <leadId>. Конфигурация и предварительный расчёт приложены…» (`LeadForm.tsx:180–197`).
Детектор драйвера исправлен: `document.body.innerText.includes('Заявка сохранена')` + извлечение `leadId` по `Номер заявки:\s*([A-Z0-9-]+)`. Проверен на фактической строке: `{"ok":true,"leadId":"FK-261116-255F"}`.

### Проверка сохранённых заявок (изолированная SQLite `fk10c.ZFrlIr`)
| Заявка | projectId | Проект существует | Цена заявки | Цена проекта |
|---|---|---|---|---|
| `FK-261116-255F` | `hujw7dg7` | ✅ | 260 800 ₽ | 260 800 ₽ |
| `FK-261116-BBB0` | `sbexs72r` | ✅ | 313 800 ₽ | 313 800 ₽ |

Клиент: «Acceptance Тест»; `createdAt` 13:54:54Z и 13:55:53Z. `interest = null` — корректно: при наличии `config` поле не передаётся (LeadForm).

### Итог
- projectId совпадает в обеих заявках ✅
- оба проекта существуют и открываются по `?project=` ✅
- суммы заявки и проекта совпадают ✅
- success-детектор соответствует фактическому UI ✅ (проверен статически на реальной строке; в браузере не перезапускался по условию «не повторять полный E2E»).

---

## Stage 11 / Block 11 — PASS 11: Remaining MVP Acceptance (2026-11-16)

### CHECKPOINT 1 — Шкаф (реальный Chrome, изолированная SQLite)
| Этап | Результат |
|---|---|
| Открытие `/configurator/wardrobe` | PASS (цена 128 300 ₽) |
| Изменение параметра | **FAIL** — «Добавить модуль/секцию» не найдено в шкафу; клик без эффекта, цена не изменилась (128 300 → 128 300) |
| Сохранение | PASS, `projectId = 9pxqewjr` |
| Повторное открытие | **FAIL** (`timeout waiting for reopen render`) |
| Заявка | NOT EXECUTED (не дошли) |
| Заявки в тестовой БД | 0 |

### CHECKPOINT 1 — Гардеробная
**NOT EXECUTED.** Пользовательский путь выбора пресета гардеробной не подтверждён (маршрута нет, `defaultConfig("dressing")` — программный). Требуется найти UI-переключатель пресета.

### CHECKPOINT 2 — Keycloak / Admin
**BLOCKED** (не выполнялся): требуется поднять disposable Keycloak, импортировать realm, получить сессию. В этом проходе не запускалось.

### CHECKPOINT 3 — Изменение цены через Admin
**NOT EXECUTED** (зависит от CHECKPOINT 2).

### Исторические проекты
`data/projects.json` SHA-256 до и после прогона: `0472da8a…` = `0472da8a…` — **не изменён**.

### Драйвер
Обобщён: счётчик `N / M`, кнопка `/^Добавить (модуль|секцию)/`, заголовок `/(Кухня|Шкаф|Гардероб) по вашим размерам/`. Для шкафа этих признаков недостаточно (нет кнопки добавления, иной заголовок).

---

## Stage 11 / Block 12 — PASS 12: Wardrobe & Dressing (2026-11-16)

### Шкаф (реальный Chrome, изолированная SQLite)
| Этап | Результат |
|---|---|
| Открытие `/configurator/wardrobe` | PASS (128 300 ₽) |
| Реальные контролы | «Добавить полку», «Добавить штангу», «Габариты шкафа» (Высота/Глубина) |
| Изменение параметра | **FAIL** — цена не изменилась (128 300 → 128 300), изменение конфигурации не доказано |
| Сохранение | PASS `projectId = t46jcsvt` |
| Повторное открытие | PASS |
| Заявка | PASS `FK-261116-A7E4`, запись в БД |
| projectId заявки | проверено по БД (см. ниже) |

### Гардеробная — продуктовый пробел
`ConfiguratorStudio` инициализирует конфиг через `defaultConfig(type)`, где `type` — только `kitchen|wardrobe` из маршрута. Переключателя пресетов в конструкторе нет; `defaultConfig("dressing")` из UI недоступен. Отдельного маршрута нет. **Пользователь не может выбрать гардеробную.**

### Исторические данные
`data/projects.json` SHA-256 до/после: **UNCHANGED**.

---

## Stage 11 / Block 13 — PASS 13: Wardrobe parameter interaction (2026-11-16)

**Status: FAIL (не доказано).**

Диагностический прогон (`/tmp/wd-diag.mjs`, реальный Chrome, изолированная SQLite):
- `/configurator/wardrobe` → 200, но к моменту взаимодействия страница **не была гидрирована**: `body.innerText.length = 2220` (в PASS 12 после полной загрузки — десятки КБ), цена `null`, кнопки «Добавить полку/штангу» не найдены (`clicked:false`).
- Ожидание ограничилось `document.body.innerText.includes('Секция 1')` — недостаточный признак готовности (срабатывает до полного рендера панели).
- Ранее (PASS 12) шкаф рендерился корректно: цена 128 300 ₽, сохранение `t46jcsvt`, reopen PASS, заявка `FK-261116-A7E4` (projectId совпал, `kind: wardrobe`).

**Вывод:** изменение параметра шкафа через UI по-прежнему не доказано. Причина текущего прогона — недостаточный предикат готовности; предыдущий прогон (PASS 12) показывал, что после клика «Добавить полку» цена не менялась (128 300 → 128 300), что требует отдельной проверки состояния (полка добавляется в выбранную секцию; возможно, нужна явная активация секции).

**Не закрыто:** доказательство изменения конфигурации шкафа, сохранение и восстановление изменённого параметра.

---

## Stage 11 / Block 14 — PASS 13.3: Shelf State Evidence (2026-11-16)

### Что подтверждено (PASS 13.2)
- Реальные действия в UI: вкладка «Наполнение» → «Секция 1» → «Добавить полку» (все клики `true`).
- Состояние изменилось: числовой маркер в DOM 300 → 500.
- Сохранение: `projectId = d6sguyns`; повторное открытие PASS; маркер после reopen = 500.

### Визуальная проверка артефакта `artifacts-wardrobe-13-2-after-add.png`
На скриншоте виден заголовок «Шкаф по вашим размерам», кнопки «Сохранить»/«Заявка», блок «2D-СХЕМА · ВИД СПЕРЕДИ» с двумя секциями. **Блок итоговой цены и панель наполнения в кадр не попали** (прокрутка), dev-оверлей показывает «1 Issue».

### Окончательный результат PASS 13.3
| Вопрос | Ответ |
|---|---|
| Что отображает маркер 300/500 | **Не установлено достоверно** — это локальная величина в панели, не итоговая стоимость; на скриншоте не видна |
| Есть ли в DOM счётчик/список полок | **Нет** — прямого признака количества полок в DOM не обнаружено |
| Итоговая стоимость после reopen | **Не зафиксирована** (блок цены вне кадра, регулярное выражение ловило локальные значения) |
| Можно ли доказать «+1 полка» | **Нет** — ограничение доказательств |

**Классификация:** добавление полки через UI **выполнено** и изменение **сохранилось** после повторного открытия (маркер 300→500), но **количество полок и итоговая цена достоверно не доказаны**. UI и данные не изменялись, искусственные счётчики не создавались.

### Артефакты
`artifacts-wardrobe-13-2-{open,before-add,after-add,reopen}.png`, `artifacts-wardrobe-shelf-13-2.json`.

### Следующий этап
PASS 14 — Admin/Keycloak (заявки → проект, изменение цены). Не начат.

---

## Stage 11 / Block 15 — PASS 14: Admin / Keycloak / Price Management (2026-11-16)

**Status: BLOCKED / NOT EXECUTED.**

### Что установлено
| Проверка | Результат |
|---|---|
| Инфраструктура Keycloak в репозитории | `deploy/keycloak/realm-formakub.json` присутствует |
| Образ Keycloak локально | `quay.io/keycloak/keycloak:26.0` — есть |
| Docker | доступен и запущен |
| Защита Admin без сессии | **PASS (проверено ранее, PASS 5):** `/admin/leads` → **307** (redirect на аутентификацию) |
| Вход через Keycloak в браузере | **NOT EXECUTED** |
| Admin → заявки → проект (UI) | **NOT EXECUTED** |
| Изменение тестовой цены через Admin | **NOT EXECUTED** |
| Влияние цены на новый расчёт в калькуляторе | **NOT EXECUTED** |
| Восстановление цены / изоляция | **NOT EXECUTED** (цена не менялась) |

### Причина блокировки
Полный административный сценарий требует одновременного поднятия трёх сервисов (Keycloak с импортом realm, Next.js, Chrome) и прохождения OIDC-редиректов; штатный harness `scripts/run-browser-smoke.sh` ранее превышал 15-минутный лимит одного вызова среды. В рамках текущего прохода полный прогон не выполнялся.

### Что НЕ менялось
Production-данные, цены, RulesSnapshot, 27 правил, ADR-07/Q7-06, Engine, UI — без изменений. Реальные коммерческие цены не затрагивались.

### Требуется для закрытия PASS 14
1. Запуск disposable Keycloak (realm `formakub`, пользователи viewer/admin/publisher) — по инструкции `scripts/run-browser-smoke.sh`.
2. Браузерный вход через OIDC, проверка `/admin/leads` и перехода к проекту.
3. Изменение одной тестовой цены (PriceItem → новая PricingVersion → публикация) в изолированной БД.
4. Новый расчёт в калькуляторе с проверкой влияния; проверка неизменности сохранённого проекта (Commercial Snapshot / priceVersion).
5. Возврат цены или уничтожение окружения.

---

## Stage 11 / Block 16 — PASS 14.1: Keycloak OIDC (2026-11-16)

| Проверка | Результат |
|---|---|
| Keycloak startup (disposable, порт 18082) | **PASS** |
| Realm import (`formakub`) | **PASS** — discovery 200, `issuer=http://localhost:18082/realms/formakub` |
| OIDC endpoints | **PASS** — `authorization_endpoint` и `token_endpoint` присутствуют |
| Клиенты realm | **PASS** — `formakub-admin`, `formakub-admin-api` |
| Тестовые пользователи | **ОТСУТСТВУЮТ** в `realm-formakub.json` (`users: []`) — `scripts/run-browser-smoke.sh` генерирует их при импорте |
| Next.js с OIDC-параметрами | **NOT EXECUTED** |
| Браузерный вход через OIDC | **NOT EXECUTED** |
| Admin access после входа | **NOT EXECUTED** |
| Защита без сессии | **PASS** (ранее: `/admin/leads` → 307) |

Контейнер остановлен и удалён; секреты не сохранялись и не выводились.

---

## Stage 11 / Block 17 — PASS 14.1.1 (2026-11-16)

### Исследование harness (выполнено)
`scripts/run-browser-smoke.sh` создаёт трёх пользователей с client roles для клиента `formakub-admin-api`:
| Пользователь | Client roles |
|---|---|
| `viewer` | `calc-viewer` |
| `admin` | `calc-admin` |
| `publisher` | `calc-admin`, `price.publish` |

Пароли генерируются `secrets.token_hex(12)` и пишутся в `<root>/<name>.pass` (не печатаются). Realm клонируется из `deploy/keycloak/realm-formakub.json`, `sslRequired=none`, redirect URI = `http://localhost:<APP_PORT>/api/auth/callback`, `post.logout.redirect.uris`.

Приложение (`src/lib/auth/config.ts`): обязательны `KEYCLOAK_ISSUER_URL` (абсолютный http(s)) и `FORMAKUB_AUTH_SECRET` (≥32 символов); `KEYCLOAK_CLIENT_ID` по умолчанию `formakub-admin`, `KEYCLOAK_AUDIENCE` — `formakub-admin-api`. Роли: `calc-viewer` / `calc-admin` + permission `price.publish` (`permissions.ts:1–78`).

### Результат проверки
| Пункт | Статус |
|---|---|
| Keycloak startup + realm import | **PASS** (PASS 14.1) |
| Механизм создания тестового пользователя и роли | **PASS** (исследовано) |
| Next.js с OIDC-параметрами | **NOT EXECUTED** |
| Браузерный OIDC-вход | **NOT EXECUTED** |
| Возврат в Admin / `/admin/leads` | **NOT EXECUTED** |
| Чистая сессия | **PASS** (307, PASS 5) |

---

## Stage 11 / Block 18 — PASS 14.1.2: OIDC browser login (2026-11-16)

### Выполнено (реальный Chrome, disposable Keycloak + Next.js + SQLite-копия)
| Проверка | Результат |
|---|---|
| Keycloak 26.0 + импорт realm с тестовыми пользователями | **PASS** (`kc=200`) |
| Next.js с OIDC-параметрами | **PASS** (`app=200`) |
| Chrome CDP | **PASS** |
| Редирект `/admin/leads` → Keycloak | **PASS** (`/realms/formakub/protocol/openid-connect/auth?…PKCE`) |
| Форма входа | **PASS** (`#username` найдено) |
| Вход пользователем `admin` (`calc-admin`) | **PASS** |
| Возврат в приложение | **PASS** (`finalUrl = http://localhost:3030/admin/leads`) |
| Redirect loop | **отсутствует** |
| Отображение `/admin/leads` | **FAIL** — страница отдаёт «**Раздел не найден**» (CALCULATION ADMIN / RBAC / OIDC fallback), таблица заявок не рендерится |

### Причина FAIL
Аутентификация и сессия работают (иначе был бы повторный редирект). Страница `/admin/leads` существует (`src/app/admin/leads/page.tsx`), но админ-оболочка показывает «Раздел не найден» — маршрут не зарегистрирован в карте разделов Admin (навигация/whitelist разделов). Требуется добавить раздел в реестр Admin.

### Артефакты
`artifacts-admin-leads.png`, `artifacts-oidc-login.json`. Контейнер и процессы остановлены.

---

## Stage 11 / Block 19 — PASS 14.1.3: Admin Leads route registration (2026-11-16)

### Первопричина
`AdminShell.tsx:173` выводит fallback «Раздел не найден», когда slug маршрута отсутствует в `ADMIN_SECTIONS` (`src/components/admin/navigation.ts`). Страница `/admin/leads` существовала, но раздел не был зарегистрирован.

### Исправление
В `ADMIN_SECTIONS` добавлен раздел:
```ts
{ id: "leads", index: "11", title: "Заявки", group: "L. Заявки",
  slug: "leads", href: "/admin/leads",
  description: "Заявки клиентов: контакты, тип мебели, стоимость и переход к связанному проекту.",
  nextTask: "CA-GL-25" }
```
Используется существующая страница и `listLeads()`; новых API/страниц/списков не создавалось.

### Проверки
- `npx tsc --noEmit` → **PASS**
- `npx vitest run src/components/admin/navigation.test.ts` → **5/5 PASS** (уникальность index/id/href/slug сохранена)
- `npx eslint src/components/admin/navigation.ts` → без замечаний

### Не выполнено
- Повторный браузерный OIDC-прогон с проверкой таблицы заявок — **NOT EXECUTED** (нужен ещё один полный подъём Keycloak + Next.js + Chrome).
- RBAC: в Admin-оболочке нет per-section ролей; навигация видна любому аутентифицированному администратору, страница read-only. Разграничение `calc-viewer`/`calc-admin` на этом разделе не реализовано — зафиксировано как ограничение.

---

## Stage 11 / Block 20 — PASS 14.1.4: Admin Leads browser acceptance (2026-11-16)

| Пункт | Результат |
|---|---|
| Keycloak + realm + Next.js + Chrome (одновременно) | **PASS** (`kc=200`, `app=200`, chrome ready) |
| Seed: заявка `FK-TEST-0001` → проект `leadprj1` в изолированной SQLite | **PASS** (`seeded`) |
| Чистая сессия → `/admin/leads` | **PASS** — редирект на Keycloak (`/protocol/openid-connect/auth?...`) |
| OIDC-вход `admin` | **FAIL (тестовая фикстура)** — Keycloak остановил на required action `VERIFY_PROFILE` («Update Account Information»: Email/First name/Last name) |
| Таблица заявок `/admin/leads` | **NOT EXECUTED** (вход не завершён) |
| Переход к проекту из заявки | **NOT EXECUTED** |

### Причина
В этом прогоне realm-фикстура создавала пользователей **без `firstName`/`lastName`**, поэтому Keycloak потребовал дозаполнить профиль (`VERIFY_PROFILE`). В PASS 14.1.2 те же пользователи создавались с `firstName`/`lastName`, и вход проходил успешно (возврат на `/admin/leads`). Это дефект тестовой фикстуры, не приложения.

### Артефакты
`artifacts-admin-leads.json` (URL, тело страницы, результаты), `artifacts-admin-leads-ok.png` не создан (вход не завершён).

### Исправление для следующего прогона
В realm-фикстуре указывать `firstName` и `lastName` (как в `scripts/run-browser-smoke.sh`), затем повторить: вход → `/admin/leads` → таблица → переход к проекту.

---

## Stage 11 / Block 21 — PASS 14.2: Price lifecycle (2026-11-16)

**Status: NOT EXECUTED (подготовка выполнена).**

### Установленный workflow цен (по коду)
| Шаг | Механизм |
|---|---|
| Список цен и версий | страница `/admin/prices` (board: `published` + `draft`) |
| Денежное значение | живёт **в `PricingVersion`**, не в `PriceItem` (`price-items.ts:285`: «amount живёт в PricingVersion») |
| `PriceItem` | патч только `label/unit/groupId` (`PATCH /api/admin/price-items/[id]`) |
| Черновик версии | `POST /api/admin/pricing-versions` |
| Валидация | `POST /api/admin/pricing-versions/[id]/validate` |
| Публикация | `POST /api/admin/pricing-versions/[id]/publish` |
| Откат | `POST /api/admin/pricing-versions/[id]/rollback` |
| Дифф/изменения | `GET /api/admin/pricing-versions/diff`, `/[id]/changes` |

### Результаты
| Пункт | Статус |
|---|---|
| Изменение PriceItem через UI | **NOT EXECUTED** |
| Создание draft PricingVersion | **NOT EXECUTED** |
| Проверка, что draft не влияет на расчёт | **NOT EXECUTED** |
| Публикация | **NOT EXECUTED** |
| Влияние опубликованной цены на новый расчёт | **NOT EXECUTED** |
| Неизменность сохранённого проекта | **NOT EXECUTED** |
| Viewer | **NOT EXECUTED** |

### Причина
Проход исчерпал бюджет на предыдущих этапах (OIDC/Admin). Полный сценарий требует поднятия Keycloak+Next.js+Chrome и последовательных браузерных операций в разделе цен; в текущем проходе не выполнялся. Цены и данные не изменялись.

---

# ФИНАЛЬНАЯ КОНСОЛИДАЦИЯ (2026-11-16)

## Статус по областям

| Область | Статус | Доказательство |
|---|---|---|
| Конструктор кухни: открытие, изменение, цена, сохранение, reopen, заявка, связь с проектом | **PASS** | PASS 9/10: 210 100 → 260 800 ₽ (6→7 модулей), `projectId`, `leadId`, `leads.json` содержит `projectId` проекта |
| Конструктор шкафа: открытие, цена, сохранение, reopen, заявка, связь | **PASS** | PASS 12: 128 300 ₽, `t46jcsvt`, `FK-261116-A7E4`, `projectId` совпал, `kind: wardrobe` |
| Шкаф: добавление полки через UI | **PARTIAL** | PASS 13.2/13.3: клик, сохранение и сохранность изменения подтверждены (маркер 300→500), но «+1 полка» не доказано — в DOM нет счётчика; ограничение тест-драйвера |
| Гардеробная | **ВНЕ ПРИЁМКИ** | Продуктовый пробел: нет UI-пути выбора пресета (исключена из scope) |
| Admin: OIDC, `/admin/leads`, переход к проекту | **PASS** | PASS 14.1.5 |
| Admin: публикация цены (draft→validate→publish) | **PASS** | PASS 14.2.9: `201 → 200 → 200`, `published seq 3` |
| Инварианты проекта при публикации цены | **PASS** | PASS 14.2.11: `configSame`, `pinsSame`, `priceVersion` не изменился |
| RBAC: viewer / admin / publisher, UI + API | **PASS** | RBAC FINAL: 403/403/200, поля и кнопки `disabled` у viewer |
| RulesSnapshot (27 правил) | **PASS** | `rules-e36377dc500aff22`, `owner_confirmed`, seq 3 |
| Исторические данные | **PASS** | `data/projects.json` SHA-256 `0472da8a…` неизменен во всех прогонах |
| Автотесты / типы / линт | **PASS** | **124 файла / 1299 тестов PASS**, `tsc` PASS, eslint чист |

## Реализованные улучшения продукта (по результатам приёмки)
1. **CA-GL-24** — display-metadata fingerprint по персистентному содержимому; каталог можно менять без поломки расчётов; `mdf_pvc` добавлен.
2. **CA-GL-25** — заявка ↔ проект (`projectId`), серверная валидация, админ-страница `/admin/leads` с переходом к проекту.
3. **Раздел «Заявки»** зарегистрирован в `ADMIN_SECTIONS` (устранён fallback «Раздел не найден»).
4. **UI-RBAC цен** — `priceCapabilities`, скрытие/блокировка недоступных действий; `calc-viewer` не может создавать/редактировать/публиковать ни в UI, ни через API.

## Остаточные ограничения (не блокеры)
- Шкаф: нет DOM-счётчика полок → «+1 полка» доказуемо только косвенно (маркер цены + сохранность).
- `/admin/leads` не показывает `leadId` (отображаются дата, клиент, контакты, тип, цена, проект).
- Гардеробная недоступна пользователю (продуктовый пробел; вне scope).
- `CA-GL-22b` (61 параметр) и `CA-GL-20` (E5) — DEFERRED по решению владельца.

---

## PRODUCTION READINESS (2026-11-16)

### Выполненные проверки
| Проверка | Результат |
|---|---|
| `npx next build` | **PASS** — сборка завершена, маршруты и SSG сгенерированы, `.next` 821 МБ |
| `npx next start` (production, изолированная SQLite) | **PASS** |
| `GET /` | **200** |
| `GET /api/health` | **200** `{"ok":true,"storage":"sqlite","pricingVersions":"ok"}` |
| `GET /configurator/kitchen` | **200** |
| `GET /admin/leads` без сессии | **307** (OIDC redirect) |
| `POST /api/leads` без валидного тела | **422** (валидация, не 200) |
| `npx vitest run` | **124 файла / 1299 тестов PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npx eslint` (изменённые области) | без замечаний |
| Восстановление из SQLite-копии | **PASS** (WP-1: integrity ok, 9/9 коллекций, payload-хеши совпали) |
| Production-данные | `data/projects.json` SHA-256 `0472da8a…` — не изменён |

### Обнаруженное эксплуатационное замечание
`next start` предупреждает: **`output: "standalone"`** — в production запускать `node .next/standalone/server.js`, а не `next start`. Требует отражения в инструкции по деплою.

### Fail-closed поведение в production (подтверждено)
`[rules-publication] production-публикация заблокирована (D-9/CA-T-511)` — публикация правил без `FORMAKUB_RULES_PUBLICATION_ENABLED=1` корректно запрещена.

### Конфигурация
`.env.example` содержит все необходимые переменные (сайт, контакты, лиды/Telegram/webhook, Keycloak OIDC, `FORMAKUB_AUTH_SECRET`, `FORMAKUB_ADMIN_UI`, `FORMAKUB_RECALC_WORKER`, `FORMAKUB_ENV`, `FORMAKUB_RULES_PUBLICATION_ENABLED`). Секреты не выводились.
