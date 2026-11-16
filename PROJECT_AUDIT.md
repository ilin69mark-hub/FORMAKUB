# PROJECT_AUDIT

Record of audit findings with evidence. Only findings proven in this repository are recorded; suspected issues are labelled.

---

## A-2026-11-16b · Composition → Engine integration: фактическая граница (design only)

- **Доказано кодом:** Engine composition не читает (`grep` по `engine.ts` → 0; `engine-purity.test.ts` запрещает `@/lib/admin`/`@/lib/server`); `CalculationInputs` замкнут whitelist'ом (`contract.ts:890–901`) → composition **не может** стать входом Engine без правки контракта ADR-06.
- **Доказано:** `quantityRef` и `condition` `CompositionLine` валидируются (`composition.ts:838–880`) и **никогда не исполняются** — исполняющего модуля в `src/` нет (grep: schema/seed/UI/editor только). Composition участвует исключительно как preflight-гейт (`data-resolver.ts:1360–1415`).
- **Доказано данными:** `data/projects.json` — 200 проектов: 0 с `rulesSnapshotId`, 0 с `compositionVersionId`, 200 с `priceVersion` → все legacy; файл `composition-versions.json` отсутствует (composition-слой инертен до публикации).
- **Следствие для дизайна:** влияние composition на количества/суммы невозможно без изменения Engine/контракта (запрещено); рекомендован вариант B — `composition-resolver` (server-слой) + read-only трасса в Inspector, totals остаются от Engine.
- **Статус:** design-only, `docs/CALCULATION_ADMIN/COMPOSITION_ENGINE_INTEGRATION_DESIGN.md`; открытые вопросы владельца В-1…В-7.

---

## A-2026-11-16 · Composition remediation (Q1–Q8, CM-A01–CM-A35)

- Remediation: **35 FIXED, 0 PARTIAL, 0 NOT REPRODUCED/BLOCKED/NOT FIXED**.
- Q1–Q8 implemented; ADR-08 added; Engine/formulas/Geometry/Legacy/CalculationBreakdown unchanged; NEW-N3 not used.
- Tests: targeted composition 28 PASS; full 119 files / 1235 PASS; typecheck/lint/build PASS.
- Residual: OIDC E2E completed (33/36; all Composition checks pass; 2 unrelated public configurator checks fail, 1 editor marker false-negative); component-level trace/Engine composition remains out of scope.

---

## A-2026-11-13 · Stage 10 / Block 2 — Composition Management audit

**Scope:** managed composition implementation. No formulas/Engine/Legacy/geometry, RulesSnapshot/ADR-07, production seed/DB/gate changes.

### A27 — Composition is a real managed data layer, not a UI table
- `CompositionVersion` collection, schema, draft/update/publish/delete, audit, journal/recovery, API and UI are implemented; published is immutable and `expectedVersion` is enforced.
- **Status: CLOSED.**

### A28 — Composition does not duplicate tariff or norm sources
- Lines reference `CatalogItem`/`PriceItem`/`ManagedRule`; no amount, formula or quantity value is duplicated. Fixed quantity is restricted to `owner_confirmed`.
- **Status: CLOSED (by schema + publication validation).**

### A29 — Project pin is optional and explicit
- `StoredProject.compositionVersionId` is optional; `schemaVersion` not bumped; transition is a separate operation with `expectedUpdatedAt` and audit; no automatic recalculation or price change.
- **Status: CLOSED.**

### A30 — DataResolver preflight is real but not an Engine BOM
- Pinned published composition is resolved and validated (coverage + tariffs in PriceSnapshot). Engine formulas and amounts remain unchanged.
- Component-level trace is **not** implemented; `CalculationBreakdown` is unchanged.
- **Status: PARTIAL — integration is a gate, not quantity/trace integration. Remaining change requires ADR.**

### A31 — Seed is deterministic and does not fabricate data
- Seed derives only from `MODULE_COMPOSITION`; no CatalogItem kinds invented; unsupported structural lines are skipped; repeated import is idempotent; source=preliminary; no publication.
- **Status: CLOSED.**

### A32 — Published composition is not deletable; referenced version protected
- Delete only allowed for draft; published/superseded blocked; project reference check implemented.
- **Status: CLOSED.**

---


## A-2026-11-13 · Stage 10 / Block 1 — Calculation Admin catalogs & inspector audit

**Scope:** implementation of read-only admin sections. No formulas, engine, price values, version schema, production config or production DB changed; no new API; no publication flag enabled.

### A19 — Catalog/model sources are not duplicated
- Elements come from `CatalogItem`; ranges from `ModulePreset`; prices from `PriceItem`/`PricingVersion`; norms from `ManagedRule`/`RulesSnapshot`.
- `catalog-model.ts` is a read-model only: no calculations, no writes, no second storage.
- **Status: CLOSED (verified by tests and code review).**

### A20 — Missing prices are shown as data problems, not 0 ₽
- `catalogPriceLinkIssues` flags `priceRefs` not resolving to `PriceItem` and the prices board reports used rates missing from the published snapshot.
- UI renders «нет в версии» / problem blocks; no fallback to zero.
- **Status: CLOSED.**

### A21 — Inspector does not fabricate tracing
- Stored `PriceBreakdown` contains only `label`/`detail`/`amount`; no line id, `priceItemId` or component quantity.
- Inspector marks every line `traceable=false` and states the gap. Applied rules are shown only as static `assigns` relations from diagnostics.
- **Status: CLOSED for available data; FULL COMPONENT TRACE = OPEN (requires contract change/ADR).**

### A22 — Preliminary is not presented as confirmed
- Data Sources separates `preliminary` from `confirmed`; diagnostics counts preliminary catalog items/rules separately.
- **Status: CLOSED.**

### A23 — Read-only pages do not weaken access controls
- New pages are server components inside the existing `/admin` layout (session required); no mutation handlers were added.
- Existing RBAC/same-origin/CSRF/rate-limit and production gates untouched.
- **Status: CLOSED.**

### A24 — Wardrobe remains a configuration, not a fake module system
- `WARDROBE_MODEL` documents sections/fillers; no `ModulePreset` for wardrobe was created.
- **Status: CLOSED.**

### A25 — Remaining traceability gap is explicit, not hidden
- `PriceBreakdown` stores only label/detail/amount. The Inspector reports `traceable=false` for every line and states why.
- Full component-level trace requires a contract change and a separate decision; it is registered as `CA-A-IMP-01` in `PROJECT_BACKLOG.md`.
- **Status: OPEN (architectural, not a regression).**

### A26 — No production data or gates touched
- New pages are read-only; no new API; no migration; no production seed/publish; `FORMAKUB_RULES_PUBLICATION_ENABLED` not changed.
- **Status: CLOSED (verified by diff scope).**

---

## A-2026-11-12 · Stage 9 / Block 1 — Calculation audit & test coverage baseline

**Scope:** diagnostic only. No production code, formula, geometry, tariff, version constant, storage structure or UI changed; no Git operations; no dependencies installed; no existing test removed or rewritten.

### A1 — Coverage metrics are not obtainable in this block
- `@vitest/coverage-v8`, `istanbul-lib-coverage`, `c8`, `nyc` are all absent (`require.resolve` → `MODULE_NOT_FOUND`); `package.json` has no coverage script; `vitest.config.mts` has no coverage config.
- Installing a provider is forbidden by the block constraints → **Statements / Branches / Functions / Lines = н/д**.
- Substituted with explicitly-labelled static proxies: direct reference 78/126 (61.9 %), transitive reachability 117/126 (92.9 %), no-coverage 9/126.

### A2 — CRITICAL test gap: Engine complexity cap untested
- `engine.ts:812` `Math.min(rule.complexityMax, 1 + extra × complexityPerExtraModule)`.
- Mutant M3 (cap removed) → **948/948 tests passed (SURVIVED)**.
- Largest golden kitchen = 9 modules, where `1 + 6×0.02 = 1.12` equals the cap, so `min()` is a no-op there.
- `KITCHEN_LIMITS.maxModules = 25` → a valid 25-module kitchen would compute `1.44` instead of `1.12` (+28 % on the subtotal) if the cap regressed.
- **Status: OPEN — test gap only; production behaviour is correct today.**

### A3 — CRITICAL test gap: promo `minSubtotal` gate untested
- `engine.ts:194` / `pricing.ts:218` `if (subtotal < definition.minSubtotal)`.
- Mutant M12 (gate disabled) → **948/948 passed (SURVIVED)**.
- No fixture has `subtotal < minSubtotal` for any of `DEMO10` (120 000), `WARDROBE7` (70 000), `DEMO5000` (90 000).
- **Status: OPEN — test gap only.**

### A4 — HIGH test gap: Engine duplicates of supports/lighting
- `engine.ts` contains private `supportPlanned` and `lightingPlanned`; tests exercise `supports.ts` / `lighting.ts` only.
- Mutant M17 (leg-count upper clamp removed, `supports.ts`) and M18 (run splitting disabled, `engine.ts`) both **SURVIVED**.
- **Status: OPEN — test gap only.**

### A5 — HIGH test gap: Engine `fail()` guards untested for price data
- `snapshotMap` duplicate `PriceItem`, `price` missing `PriceItem`, `priceRef` missing role, `signed` duplicate adjustment, `rules` invalid rounding all throw.
- `golden-engine.test.ts:139–153` asserts throws only for **sink parameters**.
- **Status: OPEN — test gap only.**

### A6 — HIGH test gap: validation rule coverage
- `validation.ts` has **66** `error()/warning()` sites; `validation.test.ts` has **18** tests / **27** assertions; no rule↔test mapping exists.
- **Status: OPEN.**

### A7 — Confirmed dead commercial rules (no effect on any calculation)
`PRICING.wardrobe.bodyFactor` (carried into `PricingVersion.rules` but never applied), `kitchen.countertopDepthAllowance`, `kitchen.underCabinetLightPerMeter`, `kitchen.sinkPartition`, `kitchen.plinthPerMeter`, `LED_PSU_MARGIN_LOW`.
- **Status: INFORMATIONAL — changing these values changes nothing.** Not fixed (no commercial change permitted in this block).

### A8 — Golden expected values are Engine snapshots (audit U-1)
- `golden.expected.ts` documents itself as an Engine capture; `golden.test.ts` verifies arithmetic *consistency*, which cannot detect a systematic error present at capture time.
- Independent oracles do exist for: facade geometry, kitchen depth ranges, lower-row height, promo formula (partial), section-width sum invariant.
- **Status: OPEN — needs an independent derivation sheet (carried over as P2 from `CALCULATION_CORRECTNESS_AUDIT`).**

### A9 — Scene ↔ geometry parity partially unchecked
- `KitchenScene` is rendered in one test and only three total-height labels are asserted; `WardrobeScene` is never rendered.
- Price and scenes do share the same geometry modules, so price↔scene divergence is structurally unlikely — the residual risk is a scene-local regression.
- **Status: OPEN (MEDIUM).**

### A10 — Test hygiene: `regen-golden-tmp.test.ts`
- Zero assertions; writes `${TMPDIR}/new-golden.json` on every `vitest run`.
- **Not removed** (deleting existing tests is forbidden in this block).
- **Status: OPEN (LOW) — convert to an explicit script in a later block.**

### A11 — Mutation testing capability
- No mutation framework installed; installing one is forbidden.
- A bounded manual harness (22 mutants, full-suite run, SHA-256 restore verification) was executed outside the repository: **17 killed / 5 survived (77.3 %)**, **22/22 `restored-OK`**, zero mutant residue confirmed by a repository-wide pattern sweep.
- **Status: CLOSED for this block.**

---

## Verification record — Stage 9 / Block 1

| Check | Result |
|---|---|
| `npx vitest run` (before experiments) | 94 files / 948 tests PASS |
| `npx vitest run` (after all experiments) | 94 files / 948 tests PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| Mutant restoration (SHA-256) | 22/22 `restored-OK` |
| Mutant residue sweep across `src/` | 0 matches for all 15 residue patterns |
| `scripts/` directory | unchanged (no files added) |
| Production code changed by this block | **none** |

---

## A-2026-11-12 · Stage 9 / Block 2 — Single Source of Truth audit

**Scope:** diagnostic only. Production code, formulas, Store/Admin/API, storage schemas, versions and UI unchanged; no Git operations; no dependencies installed; no existing test removed or rewritten; no fixes applied. Full report: `docs/CALCULATION_VERIFICATION/SINGLE_SOURCE_OF_TRUTH_AUDIT.md`.

### A12 — HIGH: proven commercial divergence between legacy and Engine (LED with zero strip length)
- Parity probe (temporary harness, outside the repo): 53 configs → 48 equal / **5 mismatch** / 0 Engine errors; all 5 are valid kitchens **without an upper row** (`underCabinetLighting: true`).
- `lighting.ts:245` — all LED components (incl. PSU and control) are inside `if (lengthM > 0)` → cost 0 at zero length. `engine.ts:628–637` adds `psuAmount + controlAmount` **unconditionally** → 950 + 780 = **1730 ₽** at zero length.
- Observed: total 118 000 (legacy) vs 119 700 (Engine); with `DEMO10` the percent discount diverges too (148 900 vs 150 500).
- Runtime = Engine only; no test pins either behaviour for this config class.
- **Status: OPEN — `REQUIRES_DOMAIN_CONFIRMATION` (which semantics is commercially correct); not fixed in this block.**

### A13 — HIGH: two complete parallel calculation branches, legacy retained as test oracle
- `pricing.ts` (content-sourced, production-consumers: none except 3 geometry helpers in `validation.ts`) vs `engine.ts` (snapshot-sourced, all 13 production price paths).
- **22 test files** use `calculatePrice/calculateKitchenPrice` as their expected-value oracle; golden fixtures are a snapshot of one of the paths (U-1), so golden equality covers only 8 scenarios.
- Confirmed negative result: **no second production pricing path** (all consumers: Store/MiniConfigurator/Hero/LeadForm → `/api/calculation-inputs`, save, recalculate ×2, leads, admin worker, publish-recalc → `data-resolver → calculateBreakdown`).
- Duplicated fragments between branches: `applyPromo`/`calculatePromo`, `roundMoney` (different step sources), `safe`, `area`, `kitchenRowPositions`, `kitchenModuleFacadeArea`, `bodyCost`+`depthFactor`, `complexityFactor`, `minOrder`.
- **Status: OPEN — consolidation is CA-T-306E territory; requires owner decisions (§7 of the SSOT report).**

### A14 — MEDIUM: display-layer commercial copies not synced with published versions
- `PromotionsSection` renders `content/PROMOS`; Engine validates `snapshot.promos` → after the first Admin promo edit the site can advertise codes/conditions the Engine will not apply.
- `KitchenPanel` shows `content/KITCHEN_MODULES.basePrice`; `SharedPanels` shows content material/handle/countertop/plinth rates; Engine charges from resolved `PriceItem`s.
- `SINK_RULES` ↔ `parameter-registry engine.sink.*` and `PRICING.rounding/minOrder` ↔ `priceSnapshot.rules` are parallel parameter sources; the first pair is **test-guarded** (`sink.test.ts:1331–1339`, `engine-purity.test.ts`), the second diverges only after a rules-changing publish.
- **Status: OPEN — `REQUIRES_DOMAIN_CONFIRMATION` for promo/rate display source (§7.2–7.3).**

### A15 — LOW: registry and schema duplications without result impact
- `FORMULA_REGISTRY`/`dependency-map`/`formulas.test` still declare `pricing.ts` as the home of `calculatePrice`/`calculateKitchenPrice` while runtime is `engine.ts`.
- `configurator/schema.ts` duplicates numeric limits inline (e.g. wardrobe height 100–320) that `validation.ts` re-checks from `content` limits (180–270); layered validation prevents a result divergence.
- Legacy `promo.reason` text uses `formatRub(...)`, Engine appends raw `₽` — user-visible only if legacy were rendered (it is not).
- **Status: OPEN (LOW).**

### Block 2 registry totals
**CRITICAL 0 / HIGH 5 (D-1…D-5) / MEDIUM 4 (D-6…D-9) / LOW 3 (D-10, D-11, A15)** — see §4/§5 of the SSOT report. Justified historical copies explicitly excluded: `StoredProject.price`, `priceHistory[]`, per-request `PriceSnapshot`, published-version history.

---

## Verification record — Stage 9 / Block 2

| Check | Result |
|---|---|
| `npx vitest run` | 94 files / 948 tests **PASS** |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| Temp parity harness in repository | **none** (created for the probe, moved to `$TMPDIR/stage9/`) |
| Production code changed by this block | **none** (git status contains only the pre-existing changes recorded in Block 1) |

---

## A16 — LED: UI и ядро не выполняют подтверждённые правила (Stage 9 / Block 3)

| ID | Finding | Layer | Evidence | Priority | Status |
|---|---|---|---|---|---|
| A16-1 | Переключатель подсветки не блокируется при отсутствии верхних модулей (R1) | UI | исправлено в Block 4: `disabled` + подсказка, LED-органы скрыты; тест обычный | HIGH | **исправлено (Block 4)** |
| A16-2 | Engine начисляет PSU + контроллер при нулевой длине ленты (R2 / D1), +1730 ₽ | ядро | исправлено в Block 4: `lightingPlanned` возвращает нулевой комплект при `lengthM = 0`; тест обычный | HIGH | **исправлено (Block 4)** |
| A16-3 | Удаление последнего верхнего модуля не гасит подсветку (R6) | ядро/нормализация | исправлено в Block 4: `normalizeKitchen` гасит опцию без верхних модулей; тест обычный + новый тест R7 | MEDIUM | **исправлено (Block 4)** |
| A16-4 | Legacy-помощники тарифов молча возвращали 0 / 1 для неизвестных id (TG-H4) | legacy | исправлено в Block 4 для **неизвестных** id (контролируемая ошибка, 6 тестов); **остановлено** для исторических материалов `glass/veneer/solid` (нет `ratePerSqm`, поведение 0 ₽ сохранено) — см. A17-2 | MEDIUM | **исправлено частично (Block 4); по историческим материалам решение получено (Block 6, A17-2) — поведение 0 ₽ в content-источнике сохранено, внедрение тарифов не разрешено** |
| A16-5 | Ограничение `maxBySpacing` в `supportPlanned` недостижимо с опубликованными параметрами (`minLegSpacingCm = 8`) — defensive-ветка | ядро | параметрический тест Block 3 | LOW | зафиксировано |

### Verification record — Stage 9 / Block 3 (2026-09-12)
- `npx vitest run`: **97 files / 986 passed + 3 expected fail + 1 todo = 990** (baseline Block 2: 94 files / 948 PASS) — без потерь.
- `npm run typecheck`: PASS; `npm run lint`: PASS (0 errors, 0 warnings).
- Production-код не изменялся; новые файлы — только тесты и документация.

---

## A17 — Исправления Block 4: правило столешницы и контракт тарифов (2026-09-12)

| ID | Finding | Layer | Evidence | Priority | Status |
|---|---|---|---|---|---|
| A17-1 | Столешница не учитывала наружную ширину самостоятельной напольной бутылочки (audit U-2 / TG-C3): недоплата 0.15–0.3 м × тариф на каждый такой модуль; обе ветви (`pricing.ts` и `engine.ts`) считали одинаково неверно | ядро + legacy | исправлено в Block 4; тесты `countertop-bottle.test.ts`; golden-expected обновлён с проверенной арифметикой | **CRITICAL** | **исправлено (Block 4)** |
| A17-2 | Исторические материалы фасада (`veneer`/`glass`/`solid`) входят в схему и читаются в старых проектах, но `ratePerSqm` не имеют → legacy-расчёт даёт 0 ₽ за фасады. Пример риска: `getProject` проекта с `facadeMaterial:"glass"` успешен, `calculateKitchenPrice` вернёт `Фасады = 0`. Замена на ошибку сломает ценообразование таких проектов, поэтому не выполнялась | legacy / данные | `LEGACY_FACADE_MATERIALS` без `ratePerSqm`; тест «отложено (A16-4)» фиксирует текущее поведение | MEDIUM | **RESOLVED — OWNER CONFIRMED (Block 6):** тарифы 11 800/14 400/18 600 ₽/м² подтверждены как исторические; старые проекты read-only, пересчёт запрещён. **Q-A17-2.3 закрыт в Block 7A.2:** legacy-расчёт возвращает контролируемую ошибку вместо 0 ₽ |
| A17-3 | `KITCHEN_LIMITS.minCountertopMeters = 0.8` объявлен, но нигде не читается (`dependency-map.ts: NOT_USED`) — минимальная длина столешницы не применяется | legacy/core | проверено в Block 4; правило «готовая/изготавливаемая столешницa» в модели отсутствует | LOW | **RESOLVED — OWNER CONFIRMED (Block 6):** не применяется, не вводить минимальную оплачиваемую длину, не удалять без отдельного согласования |
| A17-4 | Golden-expected изменён как следствие подтверждённого правила (не «ради PASS»): `kitchen-promo-complexity` +1 900 ₽ опции / +2 100 ₽ итог; `kitchen-min-order` +2 850 ₽ опции, итог без изменений (пол minOrder) | тесты | дельты точно равны `ширина × тариф`, каталог §8 | — | проверено |

### Verification record — Stage 9 / Block 4 (2026-09-12)
- `npx vitest run`: **98 files / 1009 passed** (baseline Block 3: 97 / 990 = 986 passed + 3 expected fail + 1 todo). Потерь нет, удалённых тестов нет, тесты Block 3 (TG-C1/C2/H1/H2/H3) и закрытый TG-C3 остаются зелёными.
- `npm run typecheck`: PASS; `npm run lint`: PASS (0 problems).
- Изменённые production-файлы (только в объёме R1/R2/R6/TG-C3/A16-4): `src/lib/configurator/engine.ts`, `src/lib/configurator/defaults.ts`, `src/components/configurator/SharedPanels.tsx`, `src/lib/configurator/pricing.ts`.
- Изменённые тестовые файлы: `led-domain.test.ts` (3 `it.fails` → `it`, +R7), `validation-rule-gaps.test.ts` (только блок TG-H4, 3 → 6 тестов), `engine-rule-gaps.test.ts` (**только блок TG-C3**: `it.todo` → 2 теста после ответа владельца, + импорт/комментарий; TG-C1/C2/H1/H2 не тронуты), новый `countertop-bottle.test.ts`, `golden.expected.ts` (дельты A17-4).
- Предсуществующие незакоммиченные изменения пользователя не затрагивались; Git-операции, установка зависимостей, production DB и миграции не использовались.

---

## A18 — Проверка согласованности по подтверждённым решениям (Stage 9 / Block 6, 2026-09-12)

| # | Проверка | Результат | Доказательства |
|---|---|---|---|
| 1 | Старые проекты read-only | **СОГЛАСОВАНО** | `projects.ts:269` (`saveProject` → 422 до расчёта на 303), `projects.ts:433` (`recalculateProject` → 422 до resolve 462/расчёта 482), `getProject` (`projects.ts:775`) не вызывает расчёт вообще; записи идут только через `saveProject`/`recalculateProject`/`applyProjectPriceHistory` |
| 2 | Исторический PriceSnapshot сохраняется | **СОГЛАСОВАНО** | оба расчётных сайта (`projects.ts:320`, `projects.ts:482`) находятся **после** guard-ов; `applyProjectPriceHistory` проверяет legacy дважды (`projects.ts:595`, `:652`); при блокировке не создаётся ни конфиг, ни цена, ни запись истории (`CA-516_…:154–160`) |
| 3 | Нет обхода запрета перерасчёта | **СОГЛАСОВАНО** | оба API (`/api/projects/[id]/recalculate`, `/api/admin/projects/[id]/recalculate`) → `recalculateProject`; `worker.ts:438` → `recalculateProject`; `/api/calculation-inputs` с `operation=recalculate` → `resolveCalculationInputs` → `data-resolver.ts:1077` `ENGINE_CONTRACT_LEGACY_FACADE_MATERIAL`; `calculatePriceFromInputs` вызывается только из `projects.ts` (320, 482) и `calculation-inputs/route.ts:121` |
| 4 | Исторические тарифы не становятся действующими тарифами новых проектов | **СОГЛАСОВАНО — пробел A18-1 закрыт в Block 7A** | `bootstrap.ts:347–352` создаёт только `FACADE_MATERIALS`; UI показывает только `FACADE_MATERIALS` (`SharedPanels.tsx:131`) + предупреждение (`:169`); `saveProject` → 422. Пробел (устранён): guard стоял только на `recalculate`. Теперь `resolveCalculationInputs` отклоняет исторический материал при **любой** операции, а `createLead` отклоняет лид до расчёта; `validation.ts:867` остаётся **warning** намеренно — `getProject` использует `validateConfig` при чтении, и повышение severity заблокировало бы просмотр старых проектов |
| 5 | `minCountertopMeters = 0.8` нигде не применяется | **СОГЛАСОВАНО** | во всём `src` ровно 2 упоминания: объявление `content/catalog.ts:541` и запись `dependency-map.ts:405` (`NOT_USED`); в тестах — 0; в `parameter-registry.ts` (опубликованные параметры) отсутствует |

### A18-1 — барьер legacy-фасадов вне путей пересчёта (исправлено в Block 7A)

- **Файлы/участки:** `src/lib/server/data-resolver.ts:1074–1090` (guard только при `operation === "recalculate"`), `src/app/api/calculation-inputs/route.ts:93–117` (`create`/`preview` без проверки материала), `src/lib/server/leads.ts:38–52` (`validateConfig` → warning, `isConfigValid` = нет ошибок → расчёт выполняется), `src/lib/configurator/validation.ts:867` (warning, не error).
- **Фактическое поведение:** запрос `operation: "create"` с `facadeMaterial: "glass"` (или лид с таким конфигом) проходит валидацию и, если legacy `CatalogItem` присутствует в storage со статусом `active` (задокументировано `CA-516_LEGACY_CATALOG_AND_RECALC_DECISIONS.md:87–99`; **в storage не проверялось** — production DB не читалась), получает цену по опубликованному историческому `PriceItem` (11 800 / 14 400 / 18 600 ₽/м²). На свежей установке legacy `CatalogItem` не создаётся (`bootstrap.ts:347–352`) → расчёт падает fail-closed (`ENGINE_CONTRACT_MISSING_INPUT`).
- **Риск:** получение коммерческой цены с историческим тарифом **вне старого проекта**. Буквально два запрета подтверждённого решения (новые проекты — 422; автоматический пересчёт — запрещён) **не нарушены**, но политика «исторические тарифы — только для старых проектов» соблюдается не полностью.
- **Исправление (Block 7A, разрешение владельца):** единый контракт вынесен в `src/lib/configurator/materials.ts` — `LEGACY_FACADE_BLOCK_MESSAGE` + `legacyFacadeBlockIssue()`; сообщение одинаково во всех точках отказа.
  1. `src/lib/server/data-resolver.ts` — guard распространён со `recalculate` на **все** операции (`create`/`preview`/`recalculate`): отказ до сборки входов, поэтому исторический `PriceItem` не читается и материал не подменяется.
  2. `src/lib/server/leads.ts` — исторический материал → `{ok:false, issues:[error]}` **до** расчёта, лид не записывается; HTTP `/api/leads` возвращает 422.
  3. `src/lib/server/projects.ts` — 4 существующих guard-а (`saveProject`, `recalculateProject`, `applyProjectPriceHistory` ×2) переведены на общий текст; коды ошибок не менялись.
  4. `validation.ts` **не менялся** — `warning` сохранён, чтобы `getProject` (строка 843) не помечал старые проекты `unsupported`.
- **Защищённые входные точки:** `POST /api/calculation-inputs` (create/preview/recalculate), `POST /api/projects` → `saveProject`, `POST /api/projects/[id]/recalculate` и `POST /api/admin/projects/[id]/recalculate` → `recalculateProject`, worker пересчёта → `recalculateProject`, `POST /api/leads` → `createLead`, `applyProjectPriceHistory`, а также `calculatePriceFromInputs` — последний шлюз перед Engine (защита от прямого вызова сервиса с вручную собраным `CalculationRequest`).
- **Тесты:** `src/lib/server/legacy-facade-guard.test.ts` — 18 тестов по всем 10 пунктам приёмки.

### Verification record — Stage 9 / Block 6 (2026-09-12)
- Изменены **только документы**: `docs/CALCULATION_VERIFICATION/OWNER_DECISIONS_STAGE9_BLOCK5.md`, `FORMULA_AND_ALGORITHM_CATALOG.md`, `TEST_COVERAGE_AUDIT.md`, `PROJECT_BACKLOG.md`, `PROJECT_PROGRESS.md`, `PROJECT_AUDIT.md`. Production-код, тесты и `golden.expected.ts` **не изменялись**.
- `npx vitest run`: **98 файлов / 1009 тестов PASS**; `npm run typecheck`: PASS; `npm run lint`: PASS — без изменений относительно Block 5.
- Подтверждённые результаты предыдущих блоков не переписывались: изменялись только статусы A17-2/A17-3/A16-4 и добавлены §1.6/§3.8 решения.

### Verification record — Stage 9 / Block 7A (2026-09-12)

- **Изменённые production-файлы (4):** `src/lib/configurator/materials.ts` (контракт), `src/lib/server/data-resolver.ts` (guard для всех операций), `src/lib/server/leads.ts` (отказ до расчёта), `src/lib/server/projects.ts` (общий текст 4 guard-ов; поведение и коды не менялись). `validation.ts`, UI, схемы, миграции, `golden.expected.ts` — **не изменялись**.
- **Изменённые тесты:** только **добавлен** `src/lib/server/legacy-facade-guard.test.ts` (18 тестов). Существующие тесты не удалялись и не переписывались.
- **Защищённые входные точки (8):** `/api/calculation-inputs` (create/preview/recalculate), `/api/projects` → `saveProject`, `/api/projects/[id]/recalculate`, `/api/admin/projects/[id]/recalculate`, worker → `recalculateProject`, `/api/leads` → `createLead`, `applyProjectPriceHistory`, `calculatePriceFromInputs` (прямой вызов с вручную собраным request).
- **Результаты:** `npx vitest run` → **99 файлов / 1027 тестов PASS** (база Block 6: 98 / 1009 → +1 файл, +18 тестов); `npm run typecheck` → PASS; `npm run lint` → PASS.
- **Read-only сценарии подтверждены тестами:** чтение старого проекта `status=ok` с сохранённой ценой и `priceRecalculated=false`; содержимое `projects.json` побайтово (JSON-снимок) не меняется после чтения, `saveProject` и `recalculateProject`; запреты возвращают 422 (`CONFIG_INVALID`, `LEGACY_FACADE_MATERIAL`).
- **Оставшиеся неизвестные/ограничения:** обходов через перечисленные 8 точек не обнаружено (включая прямой вызов `calculatePriceFromInputs`). Не проверялось и вне scope: поведение при обращении к Engine напрямую (`calculateBreakdown`) с вручную собранными входами — в production этот вызов доступен только внутри `calculatePriceFromInputs`; прямой импорт из приложения отсутствует (проверено grep по `src` без тестов).

---

## A19 — Q-A17-2.3: legacy pricing fail-closed (Stage 9 / Block 7A.2, 2026-09-12)

**Правило владельца:** если legacy-расчёт встречает материал без действующего тарифа — не возвращать 0 ₽, не подставлять исторический тариф, не пропускать расчёт фасадов, а возвращать контролируемую ошибку с идентификатором материала.

### Фактическое использование Legacy pricing (проверено импортами + вызовами + реэкспортами, не grep одного файла)

| Проверка | Результат |
|---|---|
| Импорты `@/lib/configurator/pricing` / `./pricing` вне тестов | **ровно один**: `src/lib/configurator/validation.ts` → `kitchenTotalWidth`, `kitchenFloorModules`, `kitchenUpperModules` (геометрические helper, тарифы не читаются) |
| Вызовы `calculateKitchenPrice` / `calculateWardrobePrice` / `calculatePrice` вне тестов | **нет ни одного** (все вхождения — `*.test.ts`) |
| Реэкспорт (`export *`), динамические `import()`/`require()` модуля pricing | **не обнаружены** |
| `src/lib/admin/pricing.ts` (импортируется как `./pricing`) | **другой модуль** — управление версиями прайса (`validateDraftVersion`, `getPublishedVersion`), к legacy-расчёту не относится |
| Runtime-путь Engine | `engine.ts` модуль pricing **не импортирует** (только комментарии); проверка закреплена `engine-purity.test` → изменение на Engine **не расширено** |
| Тесты, вызывающие legacy-расчёт с историческим материалом | **1** — `validation-rule-gaps.test.ts` (прежнее ожидание «Фасады = 0»); обновлён на ожидание ошибки |
| Прочие вызовы legacy-расчёта в тестах | конфиги только с действующими материалами (`ldsp`/`mdf`/`mdf_pvc`) → поведение не изменилось |

**Вывод:** production-вызовов legacy-расчёта не существует; контракт функции защищён, runtime-путь Engine и тарифы/справочники не менялись.

### Изменение
- `src/lib/configurator/pricing.ts` — `facadeRate`: материал вне `FACADE_MATERIALS`, но известный в `LEGACY_FACADE_MATERIALS` → **`missingActiveTariff`**: `Legacy pricing: нет действующего тарифа для facadeMaterial "<id>"; расчёт фасадов невозможен`. Неизвестный id → прежняя ошибка `неизвестный facadeMaterial "<id>"`. `handle: "none"` (реальная ставка 0 в каталоге) и все действующие материалы — без изменений.

### Тесты (4 новых)
1. `veneer` → контролируемая ошибка с id; 2. `glass` → то же; 3. `solid` → то же (плюс проверка, что схема по-прежнему принимает их для чтения); 4. действующие материалы `ldsp`/`mdf`/`mdf_pvc` → прежние ненулевые результаты. Отдельно: чтение старого проекта не зависит от legacy pricing (`legacy-facade-guard.test.ts`) — проект читается, цена из снимка, `PriceSnapshot` не меняется.

### Verification record — Stage 9 / Block 7A.2 (2026-09-12)
- **Изменённые production-файлы (1):** `src/lib/configurator/pricing.ts` (только `facadeRate` + два локальных helper-сообщения). Engine, A18-1-контракт, `validation.ts`, UI, тарифы, справочники, API-коды, миграции — **не изменялись**.
- **Изменённые тесты (2):** `validation-rule-gaps.test.ts` (TG-H4: тест «отложено» заменён на fail-closed для 3 материалов + позитивный контроль действующих), `legacy-facade-guard.test.ts` (+1 тест независимости чтения). Существующие тесты не удалялись.
- **Результаты:** `npx vitest run` → **99 файлов / 1031 тестов PASS** (база Block 7A: 1027 → +4); `npm run typecheck` → PASS; `npm run lint` → PASS.
- **`golden.expected.ts` не изменялся** (все golden-конфиги используют действующие материалы).
- **Осталось открытым:** Q-A17-2.4 (read-only инвентаризация проектов со ссылками на исторические материалы) — не блокирует.

---

## A20 — Commercial rules verification (Stage 9 / Block 7, 2026-09-12)

| ID | Finding | Evidence | Priority | Status |
|---|---|---|---|---|
| A20-1 | TG-M1: ветка `type:"fixed"` промокода и все 5 ворот F-PR-19/F-PR-20 подтверждены на Engine-пути; денежных расхождений не найдено | `promo-rules-matrix.test.ts` (11) | — | **закрыто** |
| A20-2 | TG-M7: 5 мёртвых правил §4 инертны для Engine; `bodyFactor` присутствует в `rules` (контракт F-CT-01), но Engine его не читает | `dead-commercial-rules.test.ts` (17), включая контроль чувствительности | LOW | **закрыто** |
| A20-3 | Уточнение: `PRICING.wardrobe.plinthPerMeter` — живой тариф (legacy + `PriceItem "wardrobe.plinthPerMeter"`); мёртвым является только `PRICING.kitchen.plinthPerMeter` | `pricing.ts:674`, `engine.ts:972` | LOW | задокументировано (не расхождение) |
| A20-4 | Wardrobe golden независимо подтверждён (ручная цепочка + вторая реализация); расхождений с `golden.expected.ts` нет | `wardrobe-golden-verification.test.ts` (6) | — | **закрыто** |

### Verification record — Stage 9 / Block 7 (2026-09-12)
- **Изменённые файлы:** только 3 новых теста (`promo-rules-matrix.test.ts`, `dead-commercial-rules.test.ts`, `wardrobe-golden-verification.test.ts`) и 5 документов. **Production-код и `golden.expected.ts` не изменялись** (проверено `find -mmin`).
- **Результаты:** `npx vitest run` → **102 файла / 1065 тестов PASS** (база Block 7A.2: 99 / 1031 → +3 файла, +34 теста); `npm run typecheck` → PASS; `npm run lint` → PASS.
- Все новые expected выведены из опубликованных правил (`PRICING`, `PROMOS`, snapshot-тарифы) и/или второй независимой реализации; snapshot-замены точным assertion не использовались; существующие проверки не ослаблялись.
- **Неизвестные вне scope:** U-3/U-4/U-5, D-5/D-6, Q-A17-2.4.

---

## A21 — Owner decision preparation: U-3/U-4/U-5/D-5/D-6 (Stage 9 / Block 8, 2026-11-13)

**Тип:** диагностика/документация. Production-код, тесты и `golden.expected.ts` не изменялись.

| № | Вопрос | Что подтверждено (Block 8) | Статус |
|---|---|---|---|
| A21-1 | U-3 — расход корпуса шкафа | Текущая формула: `Σ площадь деталей (боковины/дно/крышка/перегородка/антресоль) × тариф`; `bodyFactor 1.15` инертен; ХДФ/полки/цоколь не входят. Probe: валидная 2-секция оплачивает перегородку **+7 251 ₽**. Утверждения аудитов 2026-11-10 («×1.15, перегородка бесплатна, 1×120 ≡ 2×60») не воспроизводятся → помечены устаревшими; причина расхождения UNKNOWN (без Git-истории) | **OPEN / READY FOR DECISION** |
| A21-2 | U-4 — расход корпуса кухни | `preset.basePrice + фронтальная площадь × тариф × max(0.5, глубина/60)` (`engine.ts:741–743`, `pricing.ts:346–347`); панельный раскрой не утверждён; конфликт семантики `basePrice` (включает ли материал) — REGISTER §5 | **OPEN / READY FOR DECISION** |
| A21-3 | U-5 — область коэффициента сложности | `factor` умножает `(base+body+fronts+fittings+options)`, т.е. столешницу/опоры/цоколь/LED; probe: вклад ≈ 7 500 ₽ (13 модулей) / ≈ 8 700 ₽ (golden promo-complexity); шкаф вне действия (`factor = 1`) | **OPEN / READY FOR DECISION** |
| A21-4 | D-5 — источник промокодов сайта | Сайт: `content:PROMOS` (`PromotionsSection.tsx:6,56`); Engine: `snapshot.promos` (`engine.ts:154`); равенство — следствие посева; редактирование промокода в Admin (`admin/pricing.ts:289–316`) создаёт расхождение (R-3, HIGH) | **OPEN / READY FOR DECISION** |
| A21-5 | D-6 — источник подсказок ставок UI | 6 точек подсказок из `content/*` (SharedPanels:140, 256, 362–363, 441, 507–508; KitchenPanel:311); итоговые цены — из snapshot через `/api/calculation-inputs` (корректны); после правки ставки в Admin подсказка устаревает (R-4, MEDIUM) | **OPEN / READY FOR DECISION** |

### Verification record — Stage 9 / Block 8 (2026-11-13)
- **Изменённые файлы (4):** `docs/CALCULATION_VERIFICATION/OWNER_DECISIONS_STAGE9_BLOCK8.md` (создан), `PROJECT_BACKLOG.md`, `PROJECT_PROGRESS.md`, `PROJECT_AUDIT.md`. **Production-код, тесты, `golden.expected.ts`, тарифы, UI, API не изменялись** (проверено `find -newermt`: после 2026-11-13 00:00 в `src/` и `docs/` создан только новый документ).
- **Временный инструмент:** `src/lib/configurator/block8-probe.test.ts` — создан для проверки U-3/U-5, выполнен (все probe прошли), **удалён**; остаточных файлов нет (`ls` → No such file; `git status` не показывает файл).
- **Полный набор тестов не запускался** — production-код и тесты не изменялись (по условию блока). Probe-прогоны: 4/4 и 2/2 PASS во время выполнения.
- **Ограничения соблюдены:** формулы/тарифы не менялись; миграции и production DB не затрагивались; Git-операции не выполнялись (кроме read-only `git status`/`find`); Block 7, A18-1, Q-A17-2.3 не открывались; Q-A17-2.4 не входит в блок; закрытые вопросы (A17-2/A17-3/A17-4) не пересматривались.
- **Оставшиеся ограничения:** решения владельца по пяти вопросам не получены; причина расхождения аудитов 2026-11-10 с текущим кодом по U-3 не установлена (Git-история не использовалась).

### Verification record — Stage 10 / Block 4 · E1 (2026-11-16)

- **Изменённые файлы (4):** `src/lib/server/data-resolver.ts` (извлечение `resolveCompositionPreflight`, handoff `compositionPreflight`, разделение block/warning), `src/lib/server/composition-resolver.ts` (новый), `src/lib/server/composition-resolver.test.ts` (новый), `src/lib/admin/composition-data-resolver.test.ts` (+3 теста). Документ `COMPOSITION_ENGINE_INTEGRATION_DESIGN.md` — rev.4, создан на предыдущем проходе, на E1 не изменялся.
- **Не изменялись (проверено `find -newermt "-40 minutes"`):** `engine.ts`, `pricing.ts`, `contract.ts`, `display-adapter.ts`, `golden.expected.ts`, геометрия, Legacy Pricing, ADR-06/07/08, API-маршруты, Zod-схемы, `schemaVersion`, admin-модель Composition.
- **Фактические результаты:** `npx tsc --noEmit` → PASS; `npx eslint <4 файла>` → PASS; `npx vitest run` → **120 файлов / 1250 тестов PASS**; `git diff --check` → без новых замечаний (1 предупреждение `projects.test.ts:1045` предсуществует и файл не изменялся).
- **Границы E1 соблюдены:** legacy без pin → `compositionPreflight` отсутствует, расчёт проходит (В-1); `CalculationInputs`/`CalculationRequest` не содержат composition-полей; trace-резолвер не импортирует Engine и не пишет в `CalculationBreakdown`; нулевых подстановок нет (все отсутствия → `null` + issue); `managed_rule`/`code` не исполняются; неисполняемое optional-условие → `excluded`, не unconditional.
- **Открытые риски E1:** (а) `resolveCompositionTrace` **нигде не вызывается** — подключение к расчёту отложено до E2/E4 (в `projects.ts` E1 не вносил изменений); (б) drift-предупреждения собираются, но не отображаются (Inspector — E2); (в) матрица единиц §22.3 и whitelist §13.1 — предложения rev.4, решения владельца О-1/О-2 не получены; (г) для вычисления `priceAmount` вызывающая сторона обязана передать `priceItems` (единица в `PriceSnapshot` отсутствует — R-03).

### Verification record — Stage 10 / Block 4 · E2 (2026-11-16)

- **Изменённые файлы (8):** `src/lib/configurator/schema.ts`, `src/app/api/projects/route.ts`, `src/app/api/calculation-inputs/route.ts`, `src/lib/server/projects.ts`, `src/lib/admin/calculation-inspector.ts`, `src/app/admin/calculations/[projectId]/page.tsx`, `src/app/api/calculation-inputs/route.test.ts`, `src/app/api/projects/route.test.ts`.
- **Не изменялись (проверено `find -newermt "-70 minutes"`):** `engine.ts`, `pricing.ts`, `contract.ts`, `display-adapter.ts`, `golden.expected.ts`, `geometry.ts`, `admin/composition.ts`, `admin/composition-schema.ts`, ADR-06/07/08.
- **Фактические результаты:** `npx tsc --noEmit` → PASS; `npx eslint <8 файлов>` → PASS; `npx vitest run` → **120 файлов / 1259 тестов PASS**; `git diff --check` → без новых замечаний (1 предсуществующее `projects.test.ts:1045`).
- **Архитектурные инварианты:** Engine — единственный источник итогов (тест: `price.total` с pin и без pin совпадает); trace не пишет в `CalculationBreakdown`/`PriceBreakdown` и не сохраняется (E4); legacy-проект без pin → `compositionTrace.status="absent"`, ответ API без поля; неисполняемые условия и `code`/`managed_rule`-количества → block трассировки, не расчёта; нулевых подстановок нет.
- **Найденный и исправленный дефект интеграции:** `findCreateReplay` считал fingerprint без `compositionVersionId`, тогда как `saveProject` — с ним; при добавлении pin в API повторный запрос с тем же `Idempotency-Key` получал ложный 409. Теперь оба места используют один fingerprint (тест: replay 200, конфликт при другом pin 409).
- **Остаточные ограничения:** (а) trace в Inspector вычисляется **live** при каждом открытии — сохранение в историю относится к E4, поэтому инвариант «trace не пересчитывается при чтении истории» пока неприменим; (б) блокирующие диагностики trace не блокируют расчёт (следствие E2-инварианта «trace не изменяет результат Engine») — при E4 это потребует явного решения владельца; (в) сопоставление CompositionLine → CalculationLineId не подтверждено (О-1), в UI помечено как таковое.

### Verification record — Stage 10 / Block 4 · E4 (2026-11-16)

- **Изменённые файлы (7):** `src/lib/configurator/types.ts`, `src/lib/configurator/schema.ts`, `src/lib/server/composition-resolver.ts`, `src/lib/server/projects.ts`, `src/lib/admin/calculation-inspector.ts`, `src/app/admin/calculations/[projectId]/page.tsx`, `src/lib/admin/composition-trace-history.test.ts` (новый).
- **Не изменялись (проверено `find -newermt "-30 minutes"`):** `engine.ts`, `pricing.ts`, `contract.ts`, `display-adapter.ts`, `golden.expected.ts`, `geometry.ts`, `admin/composition.ts`, `admin/composition-schema.ts`, ADR-06/07/08. `SUPPORTED_SCHEMA_VERSION` = 2 и `BUILD_CALC_VERSION` не менялись.
- **Фактические результаты:** `npx tsc --noEmit` → PASS; `npx eslint <7 файлов>` → PASS; `npx vitest run` → **121 файл / 1271 тест PASS**; `git diff --check` → без новых замечаний (1 предсуществующее `projects.test.ts:1045`).
- **Ключевой инвариант доказан тестом:** после удаления текущей CompositionVersion сохранённый исторический trace читается без изменений — это исключает live-пересчёт при открытии истории. Аналогично проверены мутации PriceItem (единица → `RUB_PER_SQM`) и RulesSnapshot: исторические значения не меняются.
- **Атомарность:** trace пишется только внутри того же `updateCollection`-callback, что и `ProjectPriceHistory`; при отказе (preflight 422 / CAS 409) история и trace не появляются частично.
- **Остаточные ограничения:** (а) `CompositionTraceView.trace = null` для `blocked` (построчных данных в снимке нет — только диагностика); (б) Inspector по-прежнему читает текущую CompositionVersion для карточки «Версии и закрепления» — это отображение метаданных, не пересчёт trace; (в) лимит размера снимка не вводился (О-4 — после измерений); (г) `applyProjectPriceHistory` (без production-вызовов) trace не заполняет.

#### E4-fix (2026-11-16)

- **Дефект:** исторические записи с Composition pin и без `compositionTrace` пересчитывались live при открытии Inspector — противоречило требованию «не пересчитывать исторический trace».
- **Исправление:** `getInspectorProject` читает только `latestHistory.compositionTrace`; при его отсутствии возвращает `status:"absent"` / `source:"none"` без вызова `resolveCompositionTrace` и без обращения к текущим Composition/RulesSnapshot/PriceItem. Live-путь вынесен в экспортируемую `computeLiveCompositionTraceView` (`source:"live"`).
- **Проверки:** +4 теста в `composition-trace-history.test.ts`; актуализирован кейс «неизвестный pin» в `api/projects/route.test.ts` (историческое чтение не резолвит pin). Итог: 121 файл / 1275 тестов PASS, tsc/eslint PASS.
- **Не изменялись:** Engine, Pricing, CalculationBreakdown, модель Composition, сохранение `ProjectPriceHistory`, `schemaVersion`, исторические записи, семантика block/warning.
