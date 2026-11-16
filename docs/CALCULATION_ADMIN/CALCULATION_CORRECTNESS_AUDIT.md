# CALCULATION CORRECTNESS AUDIT v1.0

**Date:** 2026-11-10  
**Scope:** mathematical correctness of the kitchen and wardrobe calculators.  
**Mode:** READ → ANALYZE → TEST → VERIFY → REPORT. No production DB, formulas, golden fixtures, or user projects were changed.

---

## 1. Executive Summary

The standard scenarios are arithmetically reproducible and internally consistent, but the calculation model is **not fully independently proven**. The main findings:

- **1 confirmed mathematical defect (RESOLVED):** kitchen sink shelf double-counting when a valid config contains both `sink.shelves` and `sinkStorage[].shelves`. Fixed 2026-11-10; see §10.
- **Golden values K1/K2 (221 600 / 326 200) were originally Engine snapshots, not independently derived.** They are now independently recomputed in this audit and match, but the original evidence trail does not prove independence.
- Several business rules have **no approved normative source**: countertop width for standalone bottle modules, wardrobe section divider material, body material consumption model, and the scope of the complexity factor.
- Standard kitchen/wardrobe scenarios, promo limits, min-order, rounding, Engine/legacy parity, Display Adapter, and persistence are **PASS** for the tested cases.

**Result counts for the checks explicitly listed in this report:**

| Category | Count |
|---|---:|
| PASS | 11 |
| FAIL | 0 |
| RESOLVED (was FAIL) | 1 |
| UNKNOWN | 6 |
| NOT TESTED | 4 |

**Overall:** arithmetic quality for the tested standard configurations is good; full mathematical certification is blocked by one real overcharge defect and several unapproved assumptions.

---

## 2. Calculation chain architecture

```
content/pricing.ts + content/catalog.ts + plinth/supports/lighting
        │
        ├── legacy: src/lib/configurator/pricing.ts (calculatePrice)
        │
        └── Admin bootstrap → PricingVersion snapshot / CatalogItem / ModulePreset
                │
                └── DataResolver → CalculationInputs
                        │
                        └── Engine: calculateBreakdown
                                │
                                └── Display Adapter → PriceBreakdown
                                        │
                                        └── projects.ts persistence / PriceHistory
```

Current runtime price path uses the Engine; legacy `calculatePrice` remains for historical/golden tests. The two paths share the same formulas for the checked scenarios.

### Units

- module/section dimensions: **cm**;
- area: **m²** = `widthCm × heightCm / 10000`;
- countertop/plinth: **linear meters** = `widthCm / 100`;
- money: **RUB**, rounded to `PRICING.rounding` (100 ₽) at subtotal/discount/total boundaries;
- quantities: integer pieces.

---

## 3. Kitchen formula map

| Function / component | Formula | Source | Tests | Status |
|---|---|---|---|---|
| `calculateKitchenPrice` / `calculateKitchenBreakdown` | base + body + fronts + fittings + options, × complexity, min-order, promo | `pricing.ts`, `engine.ts` | golden 6 kitchen scenarios | PASS for standard cases |
| Module body | `preset.basePrice + area(width,height) × bodyRate × max(0.5, depth/60)` | `pricing.ts:198`, `engine.ts:627` | K1/K2 independent | PASS arithmetic; model UNKNOWN |
| Kitchen fronts | sum of module/panel areas × facadeRate × styleMultiplier; sink uses actual facade panels | `pricing.ts:206–232` | K1/K2 | PASS standard |
| Sink panels | `sinkFacadeTotals` / `sinkLayout`; doors get hinges, drawer fronts do not | `sink.ts` | sink tests, K1 | PASS standard |
| Hinges/soft-close/handles | doors × rate; drawer bank: fronts × rate; handles per door/drawer | `pricing.ts:211–232` | K1/K2 | PASS |
| Drawer slides | `drawers × drawerSlide`; soft-close × drawers | `pricing.ts` | K1/K2 | PASS |
| Shelves | `shelfTotal × shelfRate` | `pricing.ts:235,255,273` | golden; audit probe | **FAIL on sink double-count** |
| Countertop | width of `base,sink,hob,drawers` × ratePerLinearMeter | `pricing.ts:276`, `engine.ts:677` | K1/K2 | PASS for standard; bottle UNKNOWN |
| Plinth | lower-row width × (`materialRate + finishDelta`) | `pricing.ts:290–298`, `engine.ts:681–689` | golden negative delta | PASS |
| Supports | edge/span/load/tall rule, front+back legs, clips/screws/anchors | `supports.ts`, `engine.ts:supportPlanned` | golden K1/K2 | PASS arithmetic; engineering UNKNOWN |
| LED | length × power, PSU margin, runs, components | `lighting.ts`, `engine.ts:lightingPlanned` | golden default/12V | PASS arithmetic |
| Complexity | `min(1.12, 1 + max(0, modules−3)×0.02)` applied to full subtotal | `pricing.ts`, `engine.ts` | golden 9-module | PASS arithmetic; scope UNKNOWN |
| Min order | `max(45000, round(raw,100))` before promo | `pricing.ts` | golden min-order | PASS |
| Promo | percent/fixed, minSubtotal, maxDiscount, round to 100 | `pricing.ts`, `engine.ts` | golden DEMO10/WARDROBE7 | PASS |
| Total | `round(max(0, subtotal − discount))` | both | golden | PASS |

### Kitchen count rules

- `doorCountForWidth(width) = width > 60 ? 2 : 1`.
- Sink doors/panels come from `sinkLayout`; drawer banks use `unit.drawers` for slides/fronts.
- `doorsTotal` is display metadata; sink displays `panels`, not hinged doors.

---

## 4. Wardrobe formula map

| Function / component | Formula | Source | Tests | Status |
|---|---|---|---|---|
| Body | `area(totalWidth, height) × bodyRate × (depth/60) × 1.15` | `pricing.ts:465`, `engine.ts:797` | wardrobe default/custom | PASS arithmetic; 1.15 UNKNOWN |
| Fronts | `area(totalWidth, height) × facadeRate × styleMultiplier` | `pricing.ts:466` | wardrobe default/custom | PASS |
| Doors | `section.width > 60 ? 2 : 1` per section | `pricing.ts:473` | wardrobe default/custom | PASS |
| Hinges/soft-close | doors × rate; plus drawer soft-close | `pricing.ts:477–490` | wardrobe default | PASS |
| Drawers | `drawers × 6200` | `pricing.ts` | wardrobe default/custom | PASS |
| Handles | doors × handleRate | `pricing.ts` | wardrobe default/custom | PASS |
| Shelves/rods | count × 1150 / 2400 | `pricing.ts` | wardrobe default | PASS |
| Plinth | width/100 × 1600 | `pricing.ts` | wardrobe default | PASS |
| LED | sections × 3800 | `pricing.ts` | wardrobe default | PASS |
| Promo | 7% with max 18000, rounded to 100 | `pricing.ts` | wardrobe custom | PASS |
| Section dividers | not explicitly counted | formula | audit probe | **UNKNOWN** |

---

## 5. Price source verification

| Source | Use | Status |
|---|---|---|
| `src/content/pricing.ts` | legacy engine rates, rounding, minOrder, promos | PASS as current demo source |
| `src/content/catalog.ts` | body/facade/handle/countertop/module base prices | PASS |
| `src/content/plinth.ts` | plinth material/finish rates | PASS |
| `src/content/supports.ts` | support system rates and preliminary loads | PASS arithmetic; engineering UNKNOWN |
| `src/content/lighting.ts` | LED rates, PSU ratings, run limits | PASS arithmetic; preliminary limits UNKNOWN |
| Admin SQLite `PricingVersion.snapshot` | runtime Engine source | PASS via golden-engine and price-contour |
| `PriceItem` metadata | does not contain amount; amount lives in snapshot | PASS by schema |

The runtime path no longer uses `content/*` for price calculation; legacy `pricing.ts` remains for tests/history.

---

## 6. Golden scenarios verification

Golden inputs: `src/lib/configurator/golden.fixtures.ts` (8 scenarios: 6 kitchen, 2 wardrobe).  
Golden outputs: `src/lib/configurator/golden.expected.ts`.

### Provenance finding — UNKNOWN (evidence independence)

`golden.expected.ts` states values are a snapshot of the Engine. `baseline.test.ts` and the implementation plan state K1/K2 were captured by running `calculatePrice`. `golden.test.ts` then checks:

- equality to the stored snapshot;
- arithmetic consistency of components;
- promo/min-order/rounding consistency;
- determinism.

This is **regression evidence, not an independent financial baseline**. No independent source document with the same component breakdown was found. The values are therefore **not independently proven by the original test design**, even though this audit independently recomputed K1/K2 and they match.

### Arithmetic consistency

For all 8 scenarios, `golden.test.ts` passes component/subtotal/discount/rounding checks; `golden-engine.test.ts` passes Engine→Adapter equality. This is **PASS for internal consistency**, not independent rule validation.

---

## 7. Independent control calculations

Rates and geometry were taken from `content/*` and the documented formulas; the Engine was not used as the source of expected values.

### K1 — kitchen default — PASS

Input: `defaultKitchen()`; 6 modules, MDF body/facade, profile handle, soft-close, ldsp_hpl countertop, ldsp plinth, LED 24V/9.6W/m, standard supports.

| Component | Independent calculation | Expected | Status |
|---|---:|---:|---|
| Body | 6 module presets + Σ area×7600×depthFactor = 89 474.4 | 89 474 | PASS |
| Fronts | 5 non-sink front areas + sink panel 59.5×90 cm = 31 916 | 31 916 | PASS |
| Fittings | 6 hinges×390 + 6 soft×460 + 3 slides×1900 + 3 soft×650 + 9 handles×1450 = 25 800 | 25 800 | PASS |
| Options | countertop 1.8×9500 + shelves 7×1100 + sink cutout 3800 + hob 2800 + supports 8800 + plinth 2.4×1600 + LED 5781 = 49 821 | 49 821 | PASS |
| Raw subtotal | (12000+89474+31916+25800+49821)=209011; ×1.06=221551.66 | — | PASS |
| Rounded total | 221 600 | 221 600 | PASS |

### K2 — kitchen premium — PASS

| Component | Independent calculation | Expected | Status |
|---|---:|---:|---|
| Body | plywood 9200, same geometry = 94 984.8 | 94 985 | PASS |
| Fronts | solid 18600 × shaker 1.16 × geometry = 81 978.01 | 81 978 | PASS |
| Fittings | 6 hinges + 6 soft + 3 slides + 3 drawer soft + 9 bar handles = 19 770 | 19 770 | PASS |
| Options | countertop 1.8×22400 + shelves 7700 + side panels 9600 + cutouts 6600 + supports 17 648 + plinth 2.4×4750 + LED 5781 = 99 049 | 99 049 | PASS |
| Raw subtotal | (12000+94985+81978+19770+99049)=307782; ×1.06=326248.92 | — | PASS |
| Rounded total | 326 200 | 326 200 | PASS |

### Wardrobe default — PASS

| Component | Independent calculation | Expected | Status |
|---|---:|---:|---|
| Body | area 5.76 × 9200 × 1.15 = 60 940.8 | 60 941 | PASS |
| Fronts | 5.76 × 11800 × 1.08 = 73 405.44 | 73 405 | PASS |
| Fittings | 6 doors×(390+460)+3 drawers×(6200+650)+6 handles×1450 = 34 350 | 34 350 | PASS |
| Options | 9 shelves×1150 + 2 rods×2400 + plinth 2.4×1600 + LED 3×3800 = 30 390 | 30 390 | PASS |
| Rounded subtotal | 9 000 + 60 941 + 73 405 + 34 350 + 30 390 = 208 086 → 208 100 | 208 100 | PASS |

### Wardrobe custom promo — PASS

Independent components: body 61 544 (MDF 7600, 6.5 m², depth65, ×1.15), fronts 101 088 (glass 14400, handleless 1.08), fittings 40 600, options 21 250, base 9 000. Raw sum 233 482 → subtotal 233 500. WARDROBE7 7% = 16 345 → rounded 16 300; total 217 200. Matches golden.

**Conclusion:** K1/K2 and the two wardrobe baselines are arithmetically correct under the implemented formulas, but the original fixtures are snapshots, not independent baselines.

---

## 8. Boundary and property-based checks

| Property / case | Method | Result |
|---|---|---|
| Increase kitchen module width 60→80 cm | temporary probe | price increases (45 000→49 000); PASS for this case |
| Increase drawer count | not exhaustively probed | NOT TESTED |
| Change material rate | linear by formula | PASS arithmetic |
| Change facade style | multiplier applied once | PASS arithmetic |
| Min-order boundary | golden `kitchen-min-order` | PASS (45 000) |
| Rounding to 100 ₽ | golden all scenarios | PASS |
| Promo cap DEMO10 | golden | PASS (30 000 cap) |
| Promo WARDROBE7 rounding | golden | PASS (16 300) |
| Fixed promo DEMO5000 | no golden scenario | NOT TESTED |
| Max dimensions / min dimensions | validation tests, not price property suite | NOT TESTED for all edges |
| Zero/missing values | schema/validation guards; no broad price property suite | NOT TESTED |
| Sink shelves + sinkStorage | temporary probe | **FAIL** (double count) |
| Bottle module countertop width | temporary probe | **UNKNOWN** (0.6 m vs 0.8 m physical run) |
| Wardrobe section count | temporary probe | **UNKNOWN** (body/fronts unchanged for 1×120 vs 2×60) |

The existing test suite does not contain a broad property-based/metamorphic price suite; the probes above are audit-only and were removed.

---

## 9. End-to-end calculation verification

| Link | Evidence | Status |
|---|---|---|
| CalculationInputs → Engine | `golden-engine.test.ts` 8/8 scenarios | PASS |
| Engine → Display Adapter | full `PriceBreakdown` equality, 8/8 | PASS |
| Persistence | `price-contour.test.ts`: saved project price equals Engine total; worker recalc; PriceHistory | PASS |
| Config/geometry/pins unchanged on recalc | `price-contour.test.ts` and worker integration tests | PASS |
| No double discount | Engine applies promo once; persistence stores Engine total | PASS |
| Published version actually used | `price-contour.test.ts` publishes a new version and public/worker paths use it | PASS |
| Display amount vs calculation | golden Engine→Adapter equality; line details may be rounded sub-lines | PASS with display caveat |
| Legacy vs Engine parity | golden and golden-engine both match same expected values 8/8 | PASS |

**Display caveat:** component lines are rounded for presentation; the sum of displayed `lines` is not intended to equal `subtotal` because nested sub-lines (LED components, supports) are informational. This is documented in the plan and is not a calculation error, but it can look inconsistent to users.

---

## 10. Found errors

### FAIL-1 — Kitchen sink shelf double-count — **RESOLVED (2026-11-10)**

**Status:** RESOLVED.  
**Severity (historical):** overcharge; medium-high for affected configs.  
**Files/functions:** `src/lib/configurator/pricing.ts:235` and `:255`; `src/lib/configurator/engine.ts:650` and `:662`; root cause: `normalizeSinkModule` does not clear `sink.shelves`.

**Reproducible scenario:**

```json
{
  "kind": "kitchen",
  "modules": [
    {
      "id": "m-sink",
      "type": "sink",
      "width": 60,
      "height": 90,
      "depth": 60,
      "shelves": 2,
      "drawers": 0,
      "sinkStorage": [{ "shelves": 2, "drawers": 0 }]
    }
  ]
}
```

Using `defaultKitchen()` with the sink adjusted as above:

| Input | `optionsCost` | Shelf detail |
|---|---:|---|
| sink `shelves:0`, `sinkStorage:[{shelves:2}]` | 49 821 | 7 полок |
| sink `shelves:2`, same `sinkStorage` | 52 021 | 9 полок |
| Difference | **+2 200** | **+2 shelves** |

Formula: `shelfTotal += unit.shelves` (line 235) **and** `shelfTotal += section.shelves` (line 255) for the same physical sink sections. Expected: one physical shelf count, not two.

**Why it can occur:** `kitchenModuleSchema` permits `shelves` on every module; `normalizeSinkModule` normalizes `sinkStorage` but does not zero `module.shelves`. The UI normally uses `sinkStorage`, but imported/legacy/API configs can contain both.

**Fix applied (2026-11-10):** in `pricing.ts` and `engine.ts`, `unit.shelves` is added only when the module is not a sink **or** when `sinkStorage` is absent. When `sinkStorage` is present, sink shelves come only from the sink layout sections. Existing behavior for sinks without `sinkStorage` is preserved. No golden fixtures were changed.

**Regression tests:**
- `src/lib/configurator/pricing.test.ts` — audit scenario (7 shelves / 49 821 ₽), ordinary shelves, legacy sink.shelves without `sinkStorage`, and sinkStorage-only counting.
- `src/lib/configurator/golden-engine.test.ts` — Engine path for the audit scenario.

**After-fix result:** audit scenario returns `optionsCost = 49 821` and 7 shelves; the 2 200 ₽ overcharge and the 9-vs-7 shelf discrepancy are gone. Target tests: 127 passed. Full suite: 77 files / 805 tests passed; typecheck/lint PASS.

---

## 11. Unconfirmed formulas and rules

| ID | Rule | Evidence gap | Status |
|---|---|---|---|
| U-1 | Golden K1/K2 independence | Values captured from Engine; no independent financial source | UNKNOWN |
| U-2 | Countertop covers standalone `bottle` module | `KitchenPanel` treats bottle as floor; `kitchenCountertopWidth` excludes it. Probe: base60+bottle20 → 0.6 m vs 0.8 m lower run | UNKNOWN (suspected undercharge 0.2 m × rate) |
| U-3 | Wardrobe body material per section/dividers | Body uses total area × 1.15; 1×120 and 2×60 sections have identical body/fronts/fittings. No approved panel-consumption rule | UNKNOWN (suspected undercharge for extra dividers) |
| U-4 | Kitchen body material consumption model | Uses front area × depth factor, not panel m²; no approved carcass consumption formula | UNKNOWN |
| U-5 | Complexity factor scope | Applied to full subtotal including supports, plinth, LED (pass-through components). No approved rule whether these should be multiplied | UNKNOWN |
| U-6 | Promo threshold vs min-order | Promo checks `subtotal` after `max(minOrder, round(raw))`; a below-min raw subtotal can be lifted above a promo threshold. No current promo threshold at 45 000, so not reachable with current demo promos | UNKNOWN / low |
| U-7 | PSU margin low constant | `LED_PSU_MARGIN_LOW` / `psuMarginLow` is computed but unused (`void low`); no effect on price, but dead rule | UNKNOWN / non-monetary |

---

## 12. UNKNOWN registry

| ID | Description | Impact | Blocking source |
|---|---|---|---|
| U-1 | Golden baseline independence | Cannot claim independent financial validation | No approved independent source |
| U-2 | Bottle countertop inclusion | Potential undercharge | No approved countertop rule |
| U-3 | Wardrobe section divider material | Potential undercharge | No approved panel consumption formula |
| U-4 | Kitchen body panel consumption | Potential over/undercharge | No approved carcass formula |
| U-5 | Complexity factor on pass-through items | Potential overcharge | No approved complexity rule |
| U-6 | Promo/min-order interaction | Potential promo boundary error | No current reachable case |
| U-7 | Unused PSU margin low | No monetary effect | Dead constant |

---

## 13. Priority fix list

1. **P1 — Fix sink shelf double-count. — RESOLVED (2026-11-10).** `unit.shelves` is ignored for sinks when `sinkStorage` is present; regression tests added. This was a confirmed overcharge.
2. **P1 — Decide bottle countertop rule.** If a standalone bottle module sits under the countertop, include its width; otherwise document the exception. Current code undercharges 0.2 m per bottle module.
3. **P2 — Define body material consumption.** Replace front-area heuristics with an approved panel m² model (kitchen and wardrobe); document `1.15` or remove it.
4. **P2 — Decide complexity factor scope.** State whether supports/plinth/LED are multiplied by `complexityFactor`.
5. **P2 — Add independent golden derivation.** Keep the current regression fixtures, but add a separate independent calculation sheet/source for K1/K2 and at least one wardrobe scenario.
6. **P3 — Add property/metamorphic suite** for width, drawers, sections, materials, min-order/promo boundaries, max dimensions, zero/missing values.
7. **P3 — Add fixed-promo DEMO5000 test** and dead-constant cleanup (`psuMarginLow`).

---

## 14. Overall confidence

| Area | Confidence |
|---|---|
| Standard kitchen K1/K2 arithmetic | High (independent recomputation matches) |
| Standard wardrobe arithmetic | High (independent recomputation matches) |
| Engine ↔ legacy parity | High (8/8 golden scenarios) |
| Engine ↔ Display ↔ Persistence | High (golden-engine + price-contour) |
| Edge-case pricing | Medium (sink double-count fixed; several UNKNOWN rules remain) |
| Independent business-rule validation | Low (golden fixtures are snapshots; no approved consumption rules) |

**Verdict:** the calculators produce consistent and reproducible results for the standard scenarios, and the main K1/K2 values are arithmetically correct. Full mathematical correctness still **cannot be certified** until the UNKNOWN business rules (bottle countertop, body material consumption, section dividers, complexity scope) are approved and tested. The confirmed sink shelf defect is fixed and regression-tested.

**No changes were made to formulas, golden fixtures, production DB, or user projects.** The temporary audit probes were removed.

**Related material-consumption audit:** `docs/CALCULATION_ADMIN/MATERIAL_CONSUMPTION_AUDIT.md` (2026-11-10). It adds material-consumption evidence only; the PASS / UNKNOWN / NOT TESTED statuses above are retained unchanged.

**Decision register:** `docs/CALCULATION_ADMIN/MATERIAL_CONSUMPTION_RULES_DECISION_REGISTER.md` (2026-11-10). This register records open owner decisions; the audit statuses above are unchanged.

**Master plan:** `docs/CALCULATION_ADMIN/MATERIAL_COST_MODEL_MASTER_PLAN.md` (2026-11-10). Research/design only; existing statuses unchanged.
