# TEST COVERAGE AUDIT

**Block:** Stage 9 / Block 1 — Calculation Audit & Test Coverage Baseline
**Date:** 2026-11-12
**Mode:** diagnostic / read-only. No production code, formula, geometry or existing test was changed, deleted or rewritten.

---

## 0. Baseline measured in this block

| Command | Result |
|---|---|
| `npx vitest run` | **94 files / 948 tests — PASS** (5.72 s) |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |

(Stage 8 recorded 93/945; the delta reflects work landed after that record. The baseline above is the one used throughout this document.)

---

## 1. Current project coverage

### 1.1 Line / branch coverage — **not available**

| Tool | Present? | Evidence |
|---|---|---|
| `@vitest/coverage-v8` | **no** | `require.resolve` → `MODULE_NOT_FOUND`; absent from `node_modules/@vitest/` |
| `istanbul-lib-coverage` | **no** | `MODULE_NOT_FOUND` |
| `c8` / `nyc` | **no** | not in `node_modules` |
| `stryker` / any mutation runner | **no** | not in `node_modules` |
| `coverage` script in `package.json` | **no** | scripts are `dev/build/start/lint/typecheck/test/test:watch/preflight/restore-drill/smoke:browser` |
| `coverage` config in `vitest.config.mts` | **no** | file contains only `include` and the `@` alias |

**Reason:** Vitest 4 requires a separate coverage provider package. Installing it is explicitly forbidden by this block's constraints, therefore **Statements / Branches / Functions / Lines percentages cannot be produced in this block and are not approximated here.**

Everything below is therefore reported as *explicitly labelled static proxies*, never as coverage percentages.

### 1.2 Test-suite size (measured)

| Scope | Test files | Tests | `expect(...)` assertions |
|---|---:|---:|---:|
| Whole repository | 94 | 948 | 3 240 |
| `src/lib/configurator/**` | 23 | 258 | 863 |
| `src/lib/configurator` + `src/content` + `src/lib/admin` | 65 | 699 | — |

---

## 2. Coverage of the calculation core (static proxies — clearly labelled)

Core = `src/lib/configurator/*.ts` (non-test) + `src/content/*.ts` (non-test): **37 modules, 11 279 production lines, 126 exported functions.**

| Proxy metric | Value | Definition |
|---|---:|---|
| Exported functions directly referenced by name in some test source | **78 / 126 (61.9 %)** | word-boundary match of the identifier in `*.test.ts` |
| Exported functions reachable from a test-referenced root through a static call graph | **117 / 126 (92.9 %)** | forward reachability over `function name(` edges, same-file and cross-file |
| Exported functions with **no** test reference and **no** tested caller | **9 / 126 (7.1 %)** | see §5.1 |

> These are *static proxies*, not statement/branch coverage. They over-count when a test merely mentions an identifier and under-count when a function is exercised only through dynamic dispatch. They are reported because exact metrics are unavailable (§1.1).

### 2.1 Per-module table

| Модуль | Функции | Покрытые (direct) | Statements | Branches | Тест-файл | Тестов | Критичность |
|---|---:|---:|---|---|---|---:|---|
| `lib/configurator/engine.ts` | 3 | 1 | *н/д* | *н/д* | — (через `golden-engine.test`) | 7 | CRITICAL |
| `lib/configurator/pricing.ts` | 6 | 4 | *н/д* | *н/д* | `pricing.test.ts` | 17 | CRITICAL |
| `lib/configurator/validation.ts` | 5 | 5 | *н/д* | *н/д* | `validation.test.ts` | 18 | CRITICAL |
| `lib/configurator/contract.ts` | 5 | 5 | *н/д* | *н/д* | `contract.test.ts` | 8 | CRITICAL |
| `lib/configurator/sink.ts` | 27 | 20 | *н/д* | *н/д* | `sink.test.ts` | 74 | CRITICAL |
| `lib/configurator/facade-geometry.ts` | 7 | 4 | *н/д* | *н/д* | `facade-geometry.test.ts` | 13 | CRITICAL |
| `lib/configurator/geometry.ts` | 6 | 6 | *н/д* | *н/д* | `geometry-ranges.test.ts` | 12 | CRITICAL |
| `lib/configurator/wardrobe-geometry.ts` | 5 | 4 | *н/д* | *н/д* | `wardrobe-geometry.test.ts` | 11 | CRITICAL |
| `lib/configurator/wardrobe-facade-geometry.ts` | 1 | 1 | *н/д* | *н/д* | `wardrobe-facade-geometry.test.ts` | 9 | CRITICAL |
| `lib/configurator/wardrobe-hinges.ts` | 3 | 3 | *н/д* | *н/д* | `wardrobe-hinges.test.ts` | 11 | HIGH |
| `lib/configurator/wardrobe-edge.ts` | 2 | 2 | *н/д* | *н/д* | `wardrobe-edge.test.ts` | 9 | MEDIUM |
| `lib/configurator/wardrobe-components.ts` | 3 | 2 | *н/д* | *н/д* | `wardrobe-components.test.ts` | 8 | MEDIUM |
| `lib/configurator/supports.ts` | 1 | 1 | *н/д* | *н/д* | `supports.test.ts` | 7 | HIGH |
| `lib/configurator/lighting.ts` | 1 | 1 | *н/д* | *н/д* | `lighting.test.ts` | 7 | HIGH |
| `lib/configurator/defaults.ts` | 17 | 6 | *н/д* | *н/д* | — (через `migration`/`facade-depth`) | — | HIGH |
| `lib/configurator/display.ts` | 6 | 4 | *н/д* | *н/д* | — (через `pricing.test`) | — | MEDIUM |
| `lib/configurator/display-adapter.ts` | 1 | 1 | *н/д* | *н/д* | — (через `golden-engine.test`) | — | MEDIUM |
| `lib/configurator/kitchenMove.ts` | 2 | 2 | *н/д* | *н/д* | — (через `sink.test`) | — | MEDIUM |
| `lib/configurator/materials.ts` | 2 | 2 | *н/д* | *н/д* | `materials.test.ts` | 5 | MEDIUM |
| `lib/configurator/schema.ts` | 1 | 1 | *н/д* | *н/д* | — (через migration/API) | — | HIGH |
| `lib/configurator/storage.ts` | 7 | 0 | *н/д* | *н/д* | — | — | LOW |
| `lib/configurator/use-calculation-inputs.ts` | 1 | 0 | *н/д* | *н/д* | — | — | LOW |
| `lib/configurator/versions.ts` | 0 | 0 | *н/д* | *н/д* | — (константы) | — | MEDIUM |
| `content/catalog.ts` | 6 | 3 | *н/д* | *н/д* | — (косвенно) | — | HIGH |
| `content/plinth.ts` | 4 | 0 | *н/д* | *н/д* | — (косвенно через `golden.test`) | — | HIGH |
| `content/supports.ts` | 2 | 0 | *н/д* | *н/д* | — (косвенно) | — | HIGH |
| `content/lighting.ts` | 2 | 0 | *н/д* | *н/д* | — (косвенно) | — | MEDIUM |
| `content/pricing.ts`, `content/categories.ts`, `content/faq.ts`, `content/projects.ts`, `content/reviews.ts`, `content/site.ts` (data only, 0 exported functions) | 0 | 0 | *н/д* | *н/д* | — (константы данных) | — | HIGH for `content/pricing.ts` (tariffs/promos) |
| **Итого ядро** | **126** | **78** | **н/д** | **н/д** | 23 файла | **258** | — |

*`н/д` = недоступно, см. §1.1. Причина: отсутствует пакет провайдера покрытия; установка запрещена условиями блока.*

---

## 3. Coverage of the commercial calculations

| Block | Formula ID (catalog) | Direct tests | Mutation result | Assessment |
|---|---|---|---|---|
| Kitchen total composition | F-PR-01/04 | `golden.test` (8), `baseline.test`, `pricing.test`, `golden-engine.test` (8), `price-contour.test` (E2E) | — | **good** for standard scenarios |
| Wardrobe total composition | F-PR-02/05 | same | M19 (`×1.15`) KILLED | **good** |
| Body cost + depth factor | F-PR-07 | `golden.test`, `baseline.test` | M5 (`max(0.5,…)`) **SURVIVED** | branch untestable under validated inputs → see §6.5 |
| Facade cost | F-PR-08/23 | `facade-geometry.test` (hand-computed), `golden.test` | M20 (`×style` twice) KILLED | **good** |
| Countertop | F-PR-12/33 | `golden.test`, `pricing.test` | M11 (drop `hob`) KILLED | **good**; bottle rule untested (U-2) |
| Plinth | F-PR-13/14 | `golden.test`, `pricing.test` | M10 (`/10`) KILLED | **good** |
| Complexity factor | F-PR-17 | `golden.test` asserts `1.12` **only on the legacy path** | M3 (Engine `Math.min`) **SURVIVED** | **gap — see §6.1** |
| Min order | F-PR-18 | `golden.test`, `pricing.test` | M7 KILLED | **good** |
| Promo eligibility (`minSubtotal`) | F-PR-19 | **none** | M12 **SURVIVED** | **gap — see §6.2** |
| Promo discount + cap | F-PR-20 | `golden.test` (`expectedPromo` recomputes independently), `pricing.test` (cap) | M6 KILLED | **good** |
| Total / rounding | F-PR-21, F-CV-06/07 | `golden.test`, `baseline.test` | M2 (`round→floor`) KILLED | **good** |
| Shelves anti-double-count | F-PR-11 | 4 dedicated cases in `pricing.test` | M8 KILLED | **good** (regression for fixed FAIL-1) |
| Supports cost | F-PR-29/30, F-SL-01…03 | `supports.test` (7) | M17 (upper clamp) **SURVIVED** | **gap — see §6.4** |
| Lighting cost | F-PR-27/28, F-SL-04…06 | `lighting.test` (7) **on the legacy module only** | M18 (Engine run split) **SURVIVED** | **gap — see §6.4** |
| Edge banding | F-PR-26 | `wardrobe-edge.test` (9) | M13 KILLED | **good** |
| Hinges | F-GW-09…11 | `wardrobe-hinges.test` (11) | M14 KILLED | **good** |
| Engine input guards (missing/duplicate PriceItem) | F-CT-06 | partial (only *parameter* throws in `golden-engine.test:139–153`) | not mutated | **gap — see §6.6** |
| Fixed promo `DEMO5000` | F-PR-20 | **none** | — | **gap — see §6.7** |

**Commercial chain end-to-end:** `price-contour.test.ts` (1 test, 22 assertions) covers draft → amount → publish → snapshot → public price → worker recalc → idempotency → config/pins unchanged. This is the strongest single commercial test in the repository.

---

## 4. Coverage of the geometry algorithms

| Algorithm family | Formula IDs | Tests | Nature of the assertions | Assessment |
|---|---|---|---|---|
| Facade field / panel division | F-GK-01, F-PR-32 | `facade-geometry.test` (13) | hand-computed decimals with derivation comments (`59.6`, `84.6`, `0.504216`) | **excellent** — independent oracle |
| Drawer front stack | F-GK-02 | `facade-geometry.test`, `geometry-ranges.test` | hand-computed | **excellent** (M22 KILLED) |
| Kitchen facade field (row edges, plinth, oven gap) | F-GK-03 | `facade-geometry.test` (CA-T-518 cases) | hand-computed | **excellent** (M21 KILLED) |
| Sink layout / sections / partitions / bottle | F-SK-05…09 | `sink.test` (74 tests, 304 assertions) | parametric matrices, overlap invariants, acceptance configs, error messages | **excellent** |
| Sink row margins / context | F-SK-04 | `sink.test` (5) | matrix + edge detection | **good** |
| Wardrobe section widths / partition | F-GW-01…03 | `wardrobe-geometry.test` (11) | formula checks, sum-preservation invariant, boundary 300 mm, metamorphic | **excellent** (M4, M16 KILLED) |
| Wardrobe body parts / area | F-GW-04, F-GW-06 | `wardrobe-geometry.test` | depth-dependence + explicit "не использует bodyFactor" | **good**; top/bottom width asymmetry **not asserted** |
| Wardrobe facade panels / antresol | F-GW-07/08 | `wardrobe-facade-geometry.test` (9), `facade-geometry.test` | gap arithmetic, zone bounds, price cross-check | **good** (M19, M21-equivalent KILLED) |
| Kitchen depth ranges / dynamic max | F-CV-11 | `facade-depth.test` (10), `geometry-ranges.test` (12) | in/out boundary pairs (400/399, max/55.9), hand-computed `580−3−19` | **excellent** (M15 KILLED) |
| Lower-row total height | F-GK-07 | `geometry-ranges.test` | hand-computed `70+15+2.6` | **good** |
| 2D scene ↔ internal geometry | F-GK-03/05, F-GW-03/08 | `geometry-ranges.test` renders `KitchenScene` and asserts **3 total-height labels only** | **partial — see §6.8** |
| Module movement | F-GK-09 | `sink.test` (`module movement`, 3) | swap / boundary | **adequate** |
| Validation of geometric ranges | F-VD-01/02 | `validation.test` (18) + indirect via `sink.test`, `facade-depth.test` | presence/absence of issues | **partial — see §6.3** |

**"Visual correct but internal coordinates wrong" (and the reverse):**

- Kitchen and wardrobe price both consume **the same** geometry modules that the scenes render (`kitchenFacadeField`, `facadeStack`, `sinkLayout`, `wardrobeGeometry`, `wardrobeFacadeGeometry`), so price↔scene divergence for these is structurally unlikely.
- The reverse risk remains: a scene-local hard-coded value would not be caught. `KitchenScene.tsx` and `KitchenPanel.tsx` were confirmed to import the shared geometry (no local copies of the facade maths), but `KitchenScene.tsx` still contains its own `doorCount` helper (documented duplicate, `CALCULATOR_TECHNICAL_AUDIT` §6.1).
- **`WardrobeScene.tsx` has no render test at all** — no test renders it, so a scene-side coordinate/label regression is undetectable.

---

## 5. Functions without tests

### 5.1 Not referenced by any test and not reachable from a tested caller (9)

| File : function | Nature | Priority |
|---|---|---|
| `storage.ts : savePendingSaveOperation / loadPendingSaveOperation / clearPendingSaveOperation` | browser `localStorage` draft queue | LOW (no DOM test environment configured) |
| `storage.ts : saveLocalDraft / loadLocalDraft / clearLocalDraft / hasAnyLocalDraft` | browser `localStorage` drafts | LOW |
| `defaults.ts : cloneConfig` | `structuredClone` wrapper | LOW |
| `use-calculation-inputs.ts : useCalculationInputs` | React hook | LOW (no hook test runner) |

### 5.2 Exported but **not named** in any test (39) — reached only indirectly

`createId`, `defaultKitchenLighting`, `defaultKitchenSupports`, `normalizeLighting`, `normalizeSupportSettings`, `normalizePlinthOptions`, `defaultConfig`, `normalizeKitchenDepth`, `normalizeKitchenFacadeDepth`, `nextShelfPosition`, `kitchenFloorModules`, `kitchenUpperModules`, `calculateKitchenBreakdown`, `calculateWardrobeBreakdown`, `facadeAreaSqm`, `facadeDoorCount`, `sinkFacadeArea`, `doorCountForWidth`, `kitchenDoorCount`, `isBottleEdgeSection`, `sinkRowMargins`, `nearestStandardSink`, `sinkThreeDoorAvailable`, `sinkPartitionAvailable`, `autoPartitionSides`, `sinkFacadeTotals`, `wardrobePulloutRodCount`, `wardrobeSectionByIndex`, `findCountertop`, `snapCountertopThickness`, `findFacadeMaterial`, `findLedStrip`, `ledColorHex`, `findPlinthMaterial`, `snapPlinthThickness`, `snapPlinthFinish`, `plinthRatePerMeter`, `findSupportSystem`, `findPlinthMount`.

Most of these *are* executed indirectly (e.g. `calculateKitchenBreakdown` via `calculateBreakdown`, `plinthRatePerMeter` via `calculateKitchenPrice`). Two are genuinely orphaned:

- **`wardrobePulloutRodCount`** — exported, not referenced by any test and not used in pricing.
- **`nearestStandardSink`** — no direct test although it backs the sink snapping UX.

### 5.3 Modules with no dedicated test file (14)

`defaults.ts`, `display-adapter.ts`, `display-metadata.ts`, `display.ts`, `engine.ts`, `geometry.ts`, `kitchenMove.ts`, `schema.ts`, `storage.ts`, `types.ts`, `use-calculation-inputs.ts`, `versions.ts`, plus all of `src/content/*`.

For most of these an *indirect* test exists (`engine.ts` → `golden-engine.test.ts`, `geometry.ts` → `geometry-ranges.test.ts`, `kitchenMove.ts` → `sink.test.ts`, `display-adapter.ts` → `golden-engine.test.ts`). **`storage.ts` and `use-calculation-inputs.ts` have neither.**

---

## 6. Uncovered branches (each backed by an executed experiment or a code reading)

### 6.1 Engine complexity cap — **CRITICAL**
`engine.ts:812` `Math.min(rule.complexityMax, 1 + extra × complexityPerExtraModule)`. Removing the `Math.min` changed **no** test result (mutation M3, 948/948 passed). Cause: the largest golden kitchen has 9 modules, where `1 + 6×0.02 = 1.12` equals the cap exactly, so `min()` is a no-op. `KITCHEN_LIMITS.maxModules = 25`, so a valid 25-module kitchen would produce `1.44` instead of `1.12` — a **+28 %** error on the whole subtotal.

### 6.2 Promo `minSubtotal` gate — **CRITICAL**
`engine.ts:194` / `pricing.ts:218` `if (subtotal < definition.minSubtotal)` returning an invalid promo. Replacing the condition with `false` changed **no** test result (mutation M12). No test anywhere uses a promo whose `minSubtotal` exceeds the scenario subtotal (`DEMO10` = 120 000, `WARDROBE7` = 70 000, `DEMO5000` = 90 000; the smallest promo-bearing subtotal in the suite is above the threshold). Removing the gate would silently apply discounts to ineligible orders.

### 6.3 Validation rule coverage — **HIGH**
`validation.ts` contains **66** `error(...)`/`warning(...)` construction sites; `validation.test.ts` has **18** tests with **27** assertions. Additional indirect coverage comes from `sink.test.ts` (which asserts `validateConfig` outcomes for the sink rules) and `facade-depth.test.ts`. A systematic `rule → test` mapping does not exist, and no test enumerates the issue catalogue, so a newly added or removed rule is not detectable.

### 6.4 Engine-side duplicates of supports and lighting — **HIGH**
`engine.ts` contains its own `supportPlanned` and `lightingPlanned`. Tests for supports/lighting exercise `supports.ts` / `lighting.ts` only.
- M17: removing `clamp(target, 2, maxBySpacing)` in `supports.ts` → survived (the spacing cap never binds in the tested configurations).
- M18: disabling run splitting (`capacity = maxRunM − current` → `1e9`) in `engine.ts` → survived (no golden strip is longer than `maxContinuousRunM`).

### 6.5 `max(0.5, depthFactor)` floor — **MEDIUM**
Removing the floor in `pricing.ts` survived (M5). The floor can only bind for `depth < 30 cm`, while validation enforces `depth ≥ 40 cm`. The branch is **defensive/dead**: no test pins it, and no valid input reaches it. Risk is limited to a future relaxation of the depth range.

### 6.6 Engine `fail()` guards on price data — **HIGH**
`snapshotMap` (duplicate `PriceItem`), `price` (missing `PriceItem`), `priceRef` (missing role), `signed` (duplicate adjustment), `rules` (invalid rounding) all throw. `golden-engine.test.ts` asserts throws only for **sink parameters**, never for a missing or duplicated `PriceItem`. A snapshot that silently lost a rate would therefore only be caught if it happened to be used by a golden scenario.

### 6.7 Fixed promo `DEMO5000` — **MEDIUM**
No test references `DEMO5000`. The `type: "fixed"` branch of the discount formula (`definition.value` directly) is executed only by that definition, so it is currently **untested end-to-end**.

### 6.8 Scene ↔ geometry render parity — **MEDIUM**
`KitchenScene` is rendered in exactly one test (`geometry-ranges.test.ts`) and only three total-height labels are asserted. `WardrobeScene` is never rendered. Facade panel coordinates produced by `kitchenFacadeField` / `wardrobeFacadeGeometry` are asserted in unit tests but **not** against what the scenes draw.

### 6.9 Dead commercial rules — **MEDIUM**
`PRICING.wardrobe.bodyFactor`, `kitchen.countertopDepthAllowance`, `kitchen.underCabinetLightPerMeter`, `kitchen.sinkPartition`, `kitchen.plinthPerMeter` are inert (catalog §4). `import.test.ts` asserts that some of them are excluded from the import, but nothing asserts that `bodyFactor` stays unapplied in the *runtime* calculation other than one geometry test comment.

---

## 7. Tests with insufficient verification value

Measured over the 65 test files of `src/lib/configurator`, `src/content`, `src/lib/admin` (699 tests):

| Class | Count | Share |
|---|---:|---:|
| Pin at least one exact value (`toBe/toEqual/toBeCloseTo/toMatchObject/toContain/toThrow`) | **683** | 97.7 % |
| Only relational/bound assertions (`toBeGreaterThan/LessThan…`) | 9 | 1.3 % |
| Only presence/structure assertions (`toBeDefined/toHaveLength/truthy…`) | 7 | 1.0 % |

**Class 4 — "only asserts that something happened" (calculation core):**

| Test | File | Problem |
|---|---|---|
| `"writes new golden"` | `src/lib/configurator/regen-golden-tmp.test.ts` | **0 assertions.** It writes `${TMPDIR}/new-golden.json` on every `vitest run`. It is a regeneration utility shipped as a test. It proves nothing and has a side effect on the file system. **Not removed** (removing existing tests is forbidden by this block). |
| `"prices the dressing preset"` | `pricing.test.ts` | only `total > 0` |
| `"increases the total when the facade material becomes more expensive"` | `pricing.test.ts` | direction only, no magnitude |
| `"increases the total when a module gets wider"` | `pricing.test.ts` | direction only |
| `"intermediate widths recalculate without overlaps"` | `sink.test.ts` | direction only (the surrounding suite compensates) |
| `"prices wide sink higher than the base 600 module"` | `sink.test.ts` | direction only |
| `"honours configured span and load…"` | `supports.test.ts` | direction only |
| `"изменение размеров деталей меняет длину"` + 2 more | `wardrobe-edge.test.ts` | direction only (the suite has 6 exact tests) |

**Class 5 — no meaningful guarantee:** only `regen-golden-tmp.test.ts`.

**Snapshot dependence:** there are **no** Vitest snapshots (`toMatchSnapshot` / `toMatchInlineSnapshot` → 0 occurrences). Snapshot-like data lives in `golden.expected.ts` and `baseline.test.ts` as literal values — see §8.

---

## 8. Risks of incorrect expected values

| Source of expected values | Independence from the system under test | Risk |
|---|---|---|
| `golden.expected.ts` (8 scenarios) | **None.** The file itself states the values are an Engine snapshot; `golden.test.ts` then verifies arithmetic *consistency* of those values, which cannot detect a systematic error present at capture time. | **HIGH** for the *business rule*; LOW for regression detection |
| `baseline.test.ts` (2 tests) | **None** — recorded values from a 2026-11-07 run | MEDIUM |
| `pricing.test.ts` `49821 / 52021 / "7 полок"` | Derived from the audit probe that reproduced the Engine output | MEDIUM |
| `golden.test.ts : expectedPromo` | **Partially independent** — re-implements the promo formula from `PROMOS` data, not from `calculatePromo` | LOW (but the same *shape* of formula, so a shared misreading of the rule would pass) |
| `golden.test.ts : sumComponents / roundMoney` helpers | **Independent arithmetic checks** on the returned breakdown | LOW |
| `facade-geometry.test.ts` | **Fully independent** — decimal expectations derived in comments (`60−0,2−0,2 = 59,6`), and a standalone `Math.round(area × rate)` cross-check against the Engine | **none** |
| `geometry-ranges.test.ts`, `facade-depth.test.ts` | **Independent** — hand-computed (`70+15+2.6`, `580−3−19`) | **none** |
| `wardrobe-geometry.test.ts`, `wardrobe-facade-geometry.test.ts`, `wardrobe-hinges.test.ts` | **Formula-level** — expected values restate the documented formula | LOW |
| `sink.test.ts` | **Structural/parametric** — matrices, invariants, acceptance configs from the ТЗ | LOW |
| `facade-geometry.test.ts` "цена шкафа" | Expected = `wardrobeFacadeGeometry(...).totalAreaSqm × 5600 × 1.08` — uses the **same** geometry function under test | **MEDIUM for geometry**, LOW for the price multiplication |

**Net:** the arithmetic *consistency* of the golden values is well protected, but their *provenance* is an Engine snapshot (audit U-1). Nothing in the suite would catch a rule that was wrong identically at capture time and now.

---

## 9. Opportunities for independent verification (oracle catalogue)

| Target | Oracle | Difficulty | Status today |
|---|---|---|---|
| `area` / `facadeAreaSqm` / `areaM2` | exact rational arithmetic on hand-picked dimensions | trivial | **already done** (`facade-geometry.test`, `geometry-ranges.test`) |
| `roundMoney` | property: `f(v) % step === 0`, `f(v) ∈ [v−step/2, v+step/2]`, `f(v) ≥ 0` for `v < 0` | trivial | partially (golden pins values) |
| `facadeField` / `facadeStack` | closed form: `panelWidth = (W−gaps−gap×(n−1))/n`; **additivity**: `Σ panel areas === areaSqm`; **bounds**: panels never leave `[0, W]` | trivial | **already done** for spot values; additivity/bounds not asserted |
| `wardrobeSectionWidths` | invariant: `leftOuter + rightOuter + partitionThickness === widthMm`; `inner = outer − 16` | trivial | sum-preservation **done**; `inner = outer − 16` not asserted |
| `complexityFactor` | closed form `min(1.12, 1+0.02·max(0,n−3))` for `n = 3,4,9,10,25` | trivial | legacy path **done**; **Engine path missing** |
| `calculatePromo` | closed form incl. gate matrix: `{inactive, wrong kind, below threshold, percent, fixed, capped, > subtotal}` | trivial | **gate matrix missing** |
| `kitchenCountertopWidth` | independent sum over an explicit module list incl. `bottle` | trivial | **bottle case missing** |
| `positionsForModule` | span/load/tall max, `count ≤ maxBySpacing`, symmetry of edge positions, merge tolerance | low | **`count ≤ maxBySpacing` missing** |
| `lightingPlanned` / `computeLighting` | `runs ≥ ceil(length / maxRun)`, `connectors = active−1+runs`, `psuW ≥ requiredW` | low | legacy **done**; **Engine copy missing** |
| `sinkLayout` | non-overlap of sections/boxes, `Σ section widths === module width`, bottle panel at module edge | low | **done** (74 tests) |
| Metamorphic: monotonicity | `width ↑ ⇒ price ↑`, `drawers ↑ ⇒ fittings ↑`, `sections ↑ ⇒ options ↑` | trivial | partially (3 monotonicity tests) |
| Metamorphic: symmetry | mirroring a kitchen row left↔right must not change the total | low | **missing** |
| Metamorphic: additivity | two independent half-runs priced together = sum of parts (excluding complexity/min-order) | medium | **missing** |

---

## 10. Mutation testing

### 10.1 Tooling

No mutation framework (`stryker`, etc.) is installed and installing one is forbidden. A **bounded manual mutation harness** was written as a temporary script outside the repository (`$TMPDIR/stage9/mutation*.sh`). For every mutant the harness:

1. copies the target file to a temp backup and records its SHA-256;
2. applies one textual replacement (fails loudly if the pattern is absent);
3. runs the **full** suite `npx vitest run`;
4. restores the backup;
5. re-computes the SHA-256 and reports `restored-OK` / `RESTORE-MISMATCH`.

**Every one of the 22 mutants reported `restored-OK`.** No production file was left modified; `scripts/` in the repository is unchanged.

### 10.2 Results — 22 mutants, 17 killed, 5 survived (**77.3 % kill rate**)

| # | Mutation | File | Result | Failing tests |
|---|---|---|---|---:|
| M1 | `facadeDoorCount`: `>` → `>=` at the 60 cm split | `facade-geometry.ts` | KILLED | 24 |
| M2 | `roundMoney`: `Math.round` → `Math.floor` | `pricing.ts` | KILLED | 14 |
| M3 | complexity cap: remove `Math.min(complexityMax, …)` | `engine.ts` | **SURVIVED** | 0 |
| M4 | `wardrobeMinWidthMm`: `(n+1)` → `n` | `wardrobe-geometry.ts` | KILLED | 1 |
| M5 | body depth floor: remove `max(0.5, depthFactor)` | `pricing.ts` | **SURVIVED** | 0 |
| M6 | promo: remove `maxDiscount` cap | `engine.ts` | KILLED | 1 |
| M7 | min order: remove `max(minOrder, …)` | `engine.ts` | KILLED | 1 |
| M8 | sink shelves: re-introduce the double count | `engine.ts` | KILLED | 1 |
| M9 | area: `/10000` → `/1000` | `pricing.ts` | KILLED | 16 |
| M10 | plinth: `/100` → `/10` | `engine.ts` | KILLED | 6 |
| M11 | countertop: drop `hob` from counted types | `engine.ts` | KILLED | 6 |
| M12 | promo: disable the `minSubtotal` gate | `engine.ts` | **SURVIVED** | 0 |
| M13 | edge perimeter: `/1000` → `/10000` | `wardrobe-edge.ts` | KILLED | 14 |
| M14 | hinge bands: drop the mass condition | `wardrobe-hinges.ts` | KILLED | 12 |
| M15 | kitchen full depth: drop facade thickness | `geometry.ts` | KILLED | 4 |
| M16 | section widths: drop half-partition thickness | `wardrobe-geometry.ts` | KILLED | 8 |
| M17 | supports: remove the `maxBySpacing` upper clamp | `supports.ts` | **SURVIVED** | 0 |
| M18 | lighting: disable run splitting (Engine) | `engine.ts` | **SURVIVED** | 0 |
| M19 | wardrobe body: re-introduce `×1.15` | `engine.ts` | KILLED | 2 |
| M20 | fronts: apply the style multiplier twice | `engine.ts` | KILLED | 2 |
| M21 | tall/oven: forget the plinth subtraction in facade height | `facade-geometry.ts` | KILLED | 20 |
| M22 | drawer stack: forget the inter-front gaps | `facade-geometry.ts` | KILLED | 21 |

### 10.3 Interpretation

- The **geometry** mutation score is 7/7 (M1, M4, M15, M16, M21, M22 + M13) — geometry tests are genuinely error-detecting, not decorative.
- The **commercial** score is strong for rounding, min-order, promo caps, area conversion and the sink-shelf regression (all killed by 1–16 tests).
- All 5 survivors map one-to-one onto the uncovered branches in §6.1, §6.2, §6.4, §6.5 — they are **test gaps, not code defects** (the production behaviour is correct today).

---

## 11. Prioritised Test Gap list

Priority is set by **impact on the result**, not by line count.

### CRITICAL — potential error in the final price or the geometry

| ID | Gap | Evidence | Suggested check (next block) |
|---|---|---|---|
| **TG-C1** | Engine complexity cap `min(1.12, …)` has no test on the runtime path; no scenario has ≥10 modules | mutation M3 survived; `KITCHEN_LIMITS.maxModules = 25`; largest fixture = 9 modules | Add Engine scenarios with 10 and 25 modules asserting `complexityFactor === 1.12` and the exact subtotal |
| **TG-C2** | Promo `minSubtotal` eligibility gate is untested in **both** paths | mutation M12 survived; no fixture has `subtotal < minSubtotal` | Add a below-threshold case per promo asserting `valid === false`, `discount === 0`, `total === subtotal`, plus a just-above-threshold case |
| **TG-C3** | Countertop width rule for a standalone `bottle` module (U-2) has no test | `kitchenCountertopWidth` excludes `bottle`; audit probe measured 0.6 m vs 0.8 m | Lock the current behaviour with an explicit test **once the owner decision is recorded**; do not change the formula in the meantime |

### HIGH — error in a single calculation block

| ID | Gap | Evidence | Suggested check |
|---|---|---|---|
| **TG-H1** | Engine-side `supportPlanned` / `lightingPlanned` duplicates are only indirectly tested; run-splitting and leg-count clamp branches are unexercised | mutations M17, M18 survived | Engine scenarios with a strip longer than `maxContinuousRunM` and a module where `maxBySpacing` binds |
| **TG-H2** | Engine `fail()` guards for a missing/duplicate `PriceItem`, missing role, duplicate signed adjustment and invalid `rules.rounding` have no negative tests | only sink-parameter throws are asserted (`golden-engine.test:139–153`) | One negative `CalculationInputs` case per guard |
| **TG-H3** | `validation.ts` has 66 issue sites vs 18 dedicated tests; no rule↔test mapping exists | §6.3 | Build an inventory of rules and assert each emits its issue once |
| **TG-H4** | Rate-lookup helpers (`bodyRate`, `facadeRate`, `styleMultiplier`, `handleRate`) fall back to `0` / `1` on unknown ids in the legacy path — no test asserts the fallback | `pricing.ts:71–88` | Assert behaviour for an unknown material/handle id |

### MEDIUM — boundary and rare scenarios

| ID | Gap | Evidence |
|---|---|---|
| **TG-M1** | Fixed promo `DEMO5000` (`type:"fixed"`) never exercised end-to-end | no reference in any test |
| **TG-M2** | `WardrobeScene` never rendered; `KitchenScene` asserts only 3 labels → scene↔geometry parity unchecked | §6.8 |
| **TG-M3** | `max(0.5, depthFactor)` floor untested (defensive branch, unreachable at `depth ≥ 40 cm`) | mutation M5 survived |
| **TG-M4** | Metamorphic properties missing: row mirror symmetry, additivity across module subsets, monotonicity in drawer/section count | §9 |
| **TG-M5** | `formatRange` ±10 % band never asserted numerically | only the separator is checked |
| **TG-M6** | Wardrobe carcass part asymmetry (`top` uses full width, `bottom` uses internal width) is unasserted | F-GW-04 |
| **TG-M7** | Dead commercial rules (`bodyFactor` + 4 unused rates) are not pinned as inert in the runtime path | catalog §4 |
| **TG-M8** | `nearestStandardSink`, `wardrobePulloutRodCount` exported but never directly tested | §5.2 |

### LOW — auxiliary logic

| ID | Gap |
|---|---|
| **TG-L1** | `regen-golden-tmp.test.ts` has zero assertions and writes a file on every run (do not delete without approval; convert to an explicit script in a later block) |
| **TG-L2** | `storage.ts` (7 functions), `cloneConfig`, `useCalculationInputs` — unreachable from tests; no DOM/hook environment configured |
| **TG-L3** | `createId`, `defaultConfig`, `kitchenFloorModules`/`kitchenUpperModules` — trivial helpers without direct assertions |
| **TG-L4** | `LED_PSU_MARGIN_LOW` dead constant (audit U-7) — no test documents its inertness |

---

## 12. Summary

- The suite is **large and mostly exact-value**: 948 tests, 3 240 assertions, 97.7 % of the calculation/admin tests pin concrete values, no snapshot usage, no skipped tests, no mocks inside the calculation core (only 2 API test files use `vi.mock`).
- **Geometry testing is genuinely strong** — hand-computed oracles, boundary in/out pairs, sum-preservation invariants, and a 7/7 geometry mutation score.
- **Commercial testing is strong for the arithmetic chain** (rounding, min-order, promo caps, area conversion, the fixed sink-shelf regression) but has **two CRITICAL blind spots on the runtime Engine path**: the complexity cap and the promo threshold.
- **Exact line/branch coverage is unavailable** in this block because no coverage provider is installed and installing one is forbidden; static proxies are reported instead and are explicitly labelled.
- **5 of 22 mutants survived**, and all 5 correspond to real, actionable test gaps rather than to production defects.

---

## 12. Closure record — Stage 9 / Block 3 (2026-09-12)

| TG | Status | Tests added | Independent source of expected values |
|---|---|---|---|
| **TG-C1** | **CLOSED** | `engine-rule-gaps.test.ts` — 5 tests (6/9/10/25 modules: factor 1.06 / 1.12 / capped, exact subtotal chain, cap changes money) | published rules price-2026.11.1 (rounding 100, minOrder 45 000, 0.02/1.12) + F-PR-17 |
| **TG-C2** | **CLOSED** | 4 tests (published DEMO10 below 120 000; threshold ±100 ₽ and exactly at subtotal) | F-PR-19/20 + published DEMO10 (10 %, cap 30 000) |
| **TG-C3** | **BLOCKED — REQUIRES_DOMAIN_CONFIRMATION** | `it.todo` + exact owner question (see below) | none available; current behaviour deliberately not locked |
| **TG-H1** | **CLOSED** | 4 tests: supports legs/positions/clips/anchors by formula; `maxBySpacing` clamp (parametric, minLegSpacingCm 8 → 60: 6 → 4 legs); lighting length 1.68 m; run splitting 8.12 m > 7.5 m → 2 runs, connectors 8, PSU 100 Вт | F-SL-01/02/04/05/06 + parameter manifest + snapshot tariffs |
| **TG-H2** | **CLOSED** | 5 negative tests: missing / duplicate `PriceItem`, missing `priceRef` role, duplicate `signedAdjustment`, `rules.rounding = 0` → each throws its own message | F-CT-06 fail-closed contract |
| **TG-H3** | **CLOSED (substantial branches)** | `validation-rule-gaps.test.ts` — 14 rules: minModules, maxModules, minTotalWidth, floor row empty, maxHob/maxOven, maxShelves, drawers bounds, drawers outside drawers-module, width/height/depth ranges, handleless+bar, upper-overhang warning; each asserted **exactly once** | KITCHEN_LIMITS / module presets / F-VD-01 |
| **TG-H4** | **CLOSED** | 3 tests on the legacy path: unknown facade material → fronts 0; unknown style → multiplier 1; unknown handle → 0 (equals «Без ручек») | documents the `?? 0` / `?? 1` fallback as a **technical** behaviour and an undercharge risk; not an approved business rule |

**Open question for the owner (TG-C3 / U-2):** does a standalone `bottle` module of the floor row get a countertop? Today `kitchenCountertopWidth` (`pricing.ts:105`) and the inline sum in `engine.ts` count only `base/sink/hob/drawers`, so the probe measured 0.6 m against a 0.8 m floor run (suspected −0.2 m × rate). Options: (a) bottle included like any floor module; (b) no countertop; (c) a separate rule. Until confirmed, no test locks the behaviour and no formula changes.

**Not a proof of correctness:** the block added 42 test records (38 PASS, 3 `it.fails`, 1 `it.todo`). Substantive rules actually verified: complexity cap on the Engine path, promo `minSubtotal` gate, supports/lighting Engine copies (including run splitting and the leg-count clamp), Engine input guards, 14 validation rules, and the LED rules R1–R7 at both layers (R1/R2/R6 currently violated — encoded as `it.fails`).

---

## 13. Closure record — Stage 9 / Block 4 (2026-09-12)

| Item | Status | Tests | Independent source |
|---|---|---|---|
| **R1** (UI, переключатель без верхних модулей) | **CLOSED — fixed** | `led-domain.test.ts`: `disabled` attribute, `aria-checked="false"`, hint text, LED controls not rendered; `it.fails` → `it` | owner rule R1 |
| **R2** (ядро, LED = 0 при нулевом метраже) | **CLOSED — fixed** | every `kitchen.lighting*` line asserted `0`, `psuCount/psuW = 0`; `it.fails` → `it` | owner rule R2 / D1 |
| **R6** (удаление последнего верхнего модуля) | **CLOSED — fixed** | auto-off through `normalizeKitchen`, idempotency | owner rule R6 |
| **R7** (повторное добавление) | **CLOSED** | new test: lighting stays `false`, switch available again | owner rule R7 |
| **TG-C3** (столешница бутылочницы) | **CLOSED — rule confirmed and implemented** | `countertop-bottle.test.ts` 14 tests: scenarios А/Б, sizes 150/200/300 мм, no double count, both paths, «длина × тариф» | owner examples 600+800+150→1550 мм, 800+200→800 мм; `KITCHEN_MODULES.bottle` 15…30 см |
| **TG-H4 / A16-4** (fallback тарифов) | **CLOSED (contract)** — unknown id now throws; `handle:"none"` and historical materials keep current behaviour | `validation-rule-gaps.test.ts` TG-H4: 3 → **6** tests (schema rejection, 3 controlled errors, free option, legacy-material risk example) | `schema.ts` `z.enum` + `safeParseConfig`; `HANDLES["none"].rate === 0` |
| **TG-C1, TG-C2, TG-H1, TG-H2, TG-H3** | unchanged, still green after the fixes | — | Block 3 §12 |

**Test-suite state:** baseline Block 3 → Block 4: **97 → 98 files**, **990 → 1009 records (1009 passed)**. The three `it.fails` (R1/R2/R6) and the `it.todo` по TG-C3 are now ordinary passing tests. No test was deleted.

**Block 3 tests touched (all documented, none weakened):**
- `led-domain.test.ts`: three `it.fails` → `it` (pre-announced in the Block 3 header: «После исправления эти тесты начнут падать и потребуют перевода в обычные»); assertions strengthened (every LED line must be 0, `psuCount/psuW = 0`, hint text, `aria-checked`); +1 new test (R7).
- `validation-rule-gaps.test.ts` (TG-H4 only): rewritten because §4 of Block 4 mandates replacing the silent fallback with a controlled error — assertions became stronger (throw instead of «равно 0») and three tests were added. **TG-H3 tests in the same file were not modified.**
- `engine-rule-gaps.test.ts`: only the **TG-C3** block changed — the `it.todo` was replaced by two real tests after the owner answered (the question text is kept as a comment) plus an import/header note. **TG-C1/C2/H1/H2 assertions were not touched** and still pass unchanged.

**Golden expected values updated** (not «to pass», but as the arithmetic consequence of the owner-confirmed countertop rule): `kitchen-promo-complexity` (+1 900 ₽ options, +2 100 ₽ subtotal/total) and `kitchen-min-order` (+2 850 ₽ options, subtotal unchanged at the min-order floor). Every delta is reproduced exactly by `width × rate` — see FORMULA_AND_ALGORITHM_CATALOG §8.

**Closed by owner decision (Stage 9 / Block 6):** A16-4 / A17-2 — historical facade tariffs **11 800 / 14 400 / 18 600 ₽/м²** confirmed as *historical*; old projects stay read-only, historical `PriceSnapshot` preserved, **recalculation forbidden**; content-source behaviour (0 ₽) unchanged — no code change. A17-3 — `KITCHEN_LIMITS.minCountertopMeters = 0.8` confirmed **not applied**, must not be introduced, must not be removed without separate approval; it stays `NOT_USED`. Details: `OWNER_DECISIONS_STAGE9_BLOCK5.md` §1.6 and §3.8. **Closed in Block 7A.2 (Q-A17-2.3):** a facade material without an active tariff now raises a controlled error naming its id (`Legacy pricing: нет действующего тарифа для facadeMaterial "…"`) — no silent 0 ₽, no automatic historical tariff, facades are not skipped; `handle: "none"` and all active materials keep their previous results. Covered by `validation-rule-gaps.test.ts` TG-H4 (9 tests) and `legacy-facade-guard.test.ts` (old-project read stays independent of legacy pricing, snapshot unchanged). **Still open (not blocking):** Q-A17-2.4 (read-only inventory of projects referencing legacy materials).

---

## 14. Closure record — Stage 9 / Block 7 (2026-09-12)

| Gap | Status | Coverage added | Independence of expected values |
|---|---|---|---|
| **TG-M1** (promo rules matrix) | **CLOSED** | `promo-rules-matrix.test.ts` — 11 tests: 5 gates + percent + **fixed (ветка DEMO5000 впервые выполнена)** + cap + «скидка > заказа → 0» + округление + последовательность minOrder→gate→discount→rounding | опубликованные правила `PRICING`/`PROMOS` (сверяются assert-ом), `subtotal` пересчитан из строк расчёта, ручная формула F-PR-20 в тесте |
| **TG-M7** (dead rules inertness) | **CLOSED для Engine** | `dead-commercial-rules.test.ts` — 17 tests: источник, статические ссылки `engine.ts`, состав входов, мутация значений, контроль чувствительности | значения параметров и отсутствие их в `snapshot`/`rules` — факт; сравнение breakdown до/после мутации |
| **Independent wardrobe golden** | **CONFIRMED, расхождений нет** | `wardrobe-golden-verification.test.ts` — 6 tests: тарифы snapshot↔content, компоненты Engine↔legacy, ручная цепочка ↔ golden | тарифы из опубликованного snapshot, компоненты — вторая независимая реализация, цепочка — формулы F-PR-02/19/20 |
| §6.7 `DEMO5000` fixed branch | **закрыт** | входит в TG-M1 (тест 7) | published `type: "fixed"`, `value: 5000` |

**Baseline → Block 7:** 99 файлов / 1031 PASS → **102 файла / 1065 PASS** (+3 файла, +34 теста); typecheck PASS; lint PASS. Существующие тесты не удалялись и не ослаблялись, `golden.expected.ts` и production-код не изменялись.

**Оставшиеся неизвестные (вне scope):** U-3/U-4/U-5 (формулы расхода корпуса и область коэффициента сложности) и D-5/D-6 (каноничность источников промокодов/ставок UI) — ждут решения владельца; Q-A17-2.4 (инвентаризация legacy-проектов).
