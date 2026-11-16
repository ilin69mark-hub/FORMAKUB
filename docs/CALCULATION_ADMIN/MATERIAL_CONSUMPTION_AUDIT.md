# MATERIAL CONSUMPTION AUDIT — Kitchen and Wardrobe

**Date:** 2026-11-10  
**Scope:** how the kitchen and wardrobe calculators account for physical material consumption.  
**Mode:** READ → VERIFY → DOCUMENT. No code, prices, golden fixtures, production DB, or user projects were changed.

---

## 1. Executive Summary

The calculators do **not** build a cutting list or a panel-by-panel material model. They use commercial area/depth heuristics:

- kitchen body: `module basePrice + frontArea × bodyRate × max(0.5, depth/60)`;
- wardrobe body: `frontArea × bodyRate × (depth/60) × 1.15`;
- facades: `frontArea × facadeRate × styleMultiplier`;
- countertop: `linear lower-row width × ratePerLinearMeter`;
- shelves/rods/drawers/partitions: per-piece prices or not charged separately.

No approved production/cutting specification with panel lists, waste factors, edge-banding, or internal-panel accounting was found. The `1.15` wardrobe body factor is documented as a **commercial rule**, not a physical consumption model.

**Results of the checks in this report:**

| Category | Count |
|---|---:|
| PASS | 5 |
| CONFIRMED IMPLEMENTATION FACT | 5 |
| CONFIRMED DEFECT | 0 |
| BUSINESS RULE REQUIRED | 7 |

Key findings:

1. **Bottle modules are excluded from countertop width** (`kitchenCountertopWidth` filters only `base,sink,hob,drawers`). Confirmed implementation fact; whether it is a defect depends on the countertop rule. Potential undercharge: 0.15–0.30 m × countertop rate per bottle module.
2. **Wardrobe section dividers are not charged.** A 120 cm wardrobe with one section and with two 60 cm sections has identical body/fronts/fittings and total (with LED off). Outer surfaces are correctly identical; the missing item is the divider panel material.
3. **Kitchen body material is front-area-based**, not a carcass panel list. Default kitchen body material portion is ≈26 174 ₽ = 3.444 m² at MDF 7600 ₽/m², while the geometric front area is 3.804 m². No approved panel consumption formula exists.
4. **Countertop is charged per linear meter only**; `countertopDepthAllowance = 0.04` is defined but never read.
5. **No new confirmed defect** was found in this material audit. The previously confirmed sink shelf double-count is already resolved in `CALCULATION_CORRECTNESS_AUDIT.md` and is not re-opened here.

---

## 2. Architecture and calculation chains

```
KitchenConfig / WardrobeConfig
        │
        ├── legacy: pricing.ts (calculateKitchenPrice / calculateWardrobePrice)
        │
        └── Admin snapshot → DataResolver → engine.ts
                calculateKitchenBreakdown / calculateWardrobeBreakdown
                        │
                        └── Display Adapter → PriceBreakdown
```

Relevant material functions:

| Layer | Kitchen | Wardrobe |
|---|---|---|
| body | `pricing.ts:198`, `engine.ts:627` | `pricing.ts:470`, `engine.ts:801` |
| facades | `pricing.ts:206–232`, `engine.ts:634–659` | `pricing.ts:471`, `engine.ts:802` |
| countertop | `pricing.ts:276`, `engine.ts:677` | — |
| shelves/partitions | `pricing.ts:235/255`, `engine.ts:650/662`; `sink.ts` | `pricing.ts:474`, `engine.ts:805` |
| sections | modules array | `config.sections` |
| options | supports/plinth/LED | shelves/rods/plinth/LED |

Units: dimensions in **cm**, area in **m²** (`w×h/10000`), countertop/plinth in **linear m** (`w/100`), money in **RUB**.

---

## 3. Kitchen — body

### CONFIRMED IMPLEMENTATION FACT

`bodyCost += preset.basePrice + area(width,height) × bodyRate × max(0.5, depth/60)`.

- `preset.basePrice` is charged once per module (5 000–15 800 ₽).
- `bodyRate` is the material rate per m² (LDSP 5 200, MDF 7 600, plywood 9 200).
- Width and height enter as **front area**; depth enters as a linear factor relative to 60 cm.
- Internal panels, shelves, partitions, back panel, edge banding, and waste are **not** listed as separate material quantities.

### Financial/quantity evidence

Default kitchen (K1):

| Item | Value |
|---|---:|
| Module base prices (6 modules) | 63 300 ₽ |
| Total body cost | 89 474 ₽ |
| Material portion | 26 174 ₽ |
| Implied material area at MDF 7 600 | **3.444 m²** |
| Geometric front area of 6 modules | 3.804 m² |
| Depth-adjusted front area | 3.444 m² |

Thus the “material area” is the depth-adjusted front area, not a carcass panel list.

### Classification

**BUSINESS RULE REQUIRED** — a physical carcass consumption model (panel list, thickness, back panel, shelves, partitions, waste) is not approved. The current formula can be a deliberate commercial model, so it is not classified as a defect.

---

## 4. Kitchen — facades

### CONFIRMED IMPLEMENTATION FACT

- Normal modules: `frontArea × facadeRate × styleMultiplier`.
- Drawer bank: `moduleArea × facadeRate × styleMultiplier` (drawer fronts cover the module face).
- Sink: actual facade panel widths from `sinkLayout` × module height × facade rate × style.
- Sink drawer fronts are included in panel area; hinges are charged only for hinged doors.

### Numerical check

Default kitchen:

- `frontsCost = 31 916 ₽`;
- MDF facade rate = 8 400 ₽/m²;
- implied facade area = 31 916 / 8 400 ≈ **3.7995 m²**;
- geometric front area of the modules + sink panels ≈ 3.80 m².

This is consistent with the current area-based model.

### Classification

**PASS** for front-area accounting in the standard scenarios. The style multiplier is commercial, not a material-consumption rule; that is outside this audit’s defect scope.

---

## 5. Kitchen — countertop

### Formula

`countertopWidth = Σ width of floor modules of type base|sink|hob|drawers`; cost = `countertopWidth/100 × ratePerLinearMeter`.

### CONFIRMED IMPLEMENTATION FACT

1. `tall` and `oven` are excluded — correct for full-height cabinets that do not receive a countertop.
2. `bottle` is **also excluded**, although `KitchenPanel` treats bottle as a floor-row module and supports/plinth include it.
3. Countertop is charged per **linear meter**, not by area; `PRICING.kitchen.countertopDepthAllowance = 0.04` is defined but never read (`dependency-map.ts` marks it `NOT_USED`).

### Comparative scenario

Config: one `base` 60 cm + one `bottle` 20 cm; plinth/LED off.

| Config | Countertop detail | Body | Fronts | Fittings |
|---|---|---:|---:|---:|
| base 60 only | 0.6 m | 12 304 | 4 536 | 2 300 |
| base 60 + bottle 20 | **0.6 m** | 18 672 | 6 048 | 4 600 |

The bottle module adds body/front/fitting cost but **does not increase countertop width**, although the physical lower run becomes 0.8 m.

### Financial impact if the rule says bottle must be covered

| Bottle width | LDSP+HPL 9 500 ₽/m | Acrylic 16 800 | Quartz 22 400 | Porcelain/solid 29 400 |
|---:|---:|---:|---:|---:|
| 15 cm | 1 425 ₽ | 2 520 ₽ | 3 360 ₽ | 4 410 ₽ |
| 20 cm | **1 900 ₽** | 3 360 ₽ | 4 480 ₽ | 5 880 ₽ |
| 30 cm | 2 850 ₽ | 5 040 ₽ | 6 720 ₽ | 8 820 ₽ |

### Classification

- Bottle exclusion: **BUSINESS RULE REQUIRED** (confirmed code behavior, but no approved countertop rule).
- Countertop depth allowance: **BUSINESS RULE REQUIRED** (rate may intentionally include standard depth).
- Tall/oven exclusion: **PASS**.

---

## 6. Wardrobe — body

### Formula

`bodyCost = area(totalWidth, height) × bodyRate × (depth/60) × 1.15`.

### CONFIRMED IMPLEMENTATION FACT

- Body material is based on the **outer front area** (`totalWidth × height`), not a panel list.
- `1.15` is the wardrobe `bodyFactor`; the design document lists it as a commercial rule, not a physical consumption coefficient.
- Section count does not enter the body formula.
- Internal vertical dividers, shelves, back panel, edge banding, and waste are not separately listed.

Default wardrobe:

- front area = 5.76 m²;
- body cost = 60 941 ₽;
- implied material area = 60 941 / 9 200 ≈ **6.624 m²** (5.76 × 1.15).

### Classification

**BUSINESS RULE REQUIRED** — an approved carcass panel model and the meaning of `bodyFactor` are missing.

---

## 7. Wardrobe — facades

### Formula

`frontsCost = area(totalWidth, height) × facadeRate × styleMultiplier`.

Door count for fittings: `section.width > 60 ? 2 : 1` per section.

### Comparative scenario

120 cm wardrobe, one 120 cm section vs two 60 cm sections, same total shelves/rods/drawers, LED off:

| Metric | 1 × 120 cm | 2 × 60 cm |
|---|---:|---:|
| Body | 30 470 | 30 470 |
| Fronts | 36 703 | 36 703 |
| Fittings | 25 150 | 25 150 |
| Options | 6 620 | 6 620 |
| Total | 107 900 | 107 900 |

For **facades** this is correct: splitting a 120 cm front into two 60 cm doors does not change total front area. Door count is also 2 in both cases.

### Classification

**PASS** for facade area and door-count accounting in this scenario.

---

## 8. Sections, partitions, shelves

### CONFIRMED IMPLEMENTATION FACT

- Wardrobe sections affect shelves, rods, drawers, and LED-per-section pricing; they do **not** add a body/divider material line.
- Kitchen module internal shelves are charged per piece (`shelf = 1 100 ₽`), not as body material area.
- Sink partitions are part of the sink layout/carcass; `PRICING.kitchen.sinkPartition = 2 400 ₽` exists but is not charged (`NOT_USED`). The code comment says partitions are part of the carcass.
- Wardrobe shelves (`1 150 ₽`), rods (`2 400 ₽`), and drawers (`6 200 ₽`) are per-piece commercial prices; whether they include material is not specified.

### Comparative scenario: 120 cm wardrobe, one vs two sections

With identical total fill and LED off, the only physical difference is **one vertical divider panel**. The calculator produces identical totals. If a divider is required, its material is missing.

Approximate divider panel: `height 2.4 m × depth 0.6 m = 1.44 m²`.

| Body material | Rate | Raw panel material |
|---|---:|---:|
| LDSP | 5 200 ₽/m² | **7 488 ₽** |
| MDF | 7 600 ₽/m² | **10 944 ₽** |
| Plywood | 9 200 ₽/m² | **13 248 ₽** |

If the existing `bodyFactor = 1.15` were applied: 8 611 / 12 586 / 15 235 ₽. This is material only; edge banding, labor, and waste are not included.

### Classification

- Divider not charged: **CONFIRMED IMPLEMENTATION FACT**.
- Whether it is a defect: **BUSINESS RULE REQUIRED** (does a section require a full-height divider, and is `bodyFactor` intended to cover internal panels?).
- Sink partition free: **BUSINESS RULE REQUIRED**.
- Shelf/rod per-piece material inclusion: **BUSINESS RULE REQUIRED**.

---

## 9. Comparative scenarios

| Scenario | Changed parameter | Observed result | Classification |
|---|---|---|---|
| Kitchen base 60 vs base 60 + bottle 20 | bottle module | countertop stays 0.6 m; body/fronts/fittings increase | CONFIRMED IMPLEMENTATION FACT |
| Kitchen width 60→80 | module width | body/fronts increase; door count jumps at >60, fittings increase | PASS for monotonicity in this case |
| Wardrobe 1×120 vs 2×60, LED off | section split | body/fronts/fittings/options/total identical | CONFIRMED IMPLEMENTATION FACT |
| Wardrobe 1×120 vs 2×60, LED on | section split | only options/LED differ by 3 800 ₽ per extra section | CONFIRMED IMPLEMENTATION FACT |
| Kitchen default K1 | — | body material area = depth-adjusted front area, not panel list | CONFIRMED IMPLEMENTATION FACT |

---

## 10. Financial impact

### Calculated

1. **Bottle countertop exclusion** — see §5: 1 425–8 820 ₽ per bottle module depending on width/material, if the rule requires countertop coverage.
2. **Wardrobe divider** — see §8: 7 488 / 10 944 / 13 248 ₽ raw material for one full-height divider at 240×60 cm; 8 611 / 12 586 / 15 235 ₽ if `bodyFactor` is applied.
3. **Sink partition** — one partition panel ≈0.9×0.6 = 0.54 m²: 2 808 / 4 104 / 4 968 ₽ at LDSP/MDF/plywood rates, if not already covered by module basePrice.
4. **Kitchen/wardrobe shelf material** — per-piece prices 1 100 / 1 150 ₽; material inclusion cannot be separated without a cost breakdown.

### Not calculable

- Actual carcass panel consumption for kitchen/wardrobe (needs cutting list, panel thickness, back panel material, waste coefficient).
- Countertop depth surcharge (needs rule whether `ratePerLinearMeter` covers standard depth).
- Edge banding, drilling, labor, and waste.
- `bodyFactor` physical meaning.

No prices or norms were invented; all rates are from `src/content/*`.

---

## 11. CONFIRMED DEFECT

**None new in this material audit.**

The previously confirmed sink shelf double-count (`CALCULATION_CORRECTNESS_AUDIT.md`, FAIL-1) was a pricing double-count, already fixed and regression-tested. It is not re-opened here.

The following are confirmed **implementation facts**, not defects until a business rule is approved:

- bottle excluded from countertop width;
- wardrobe divider not charged;
- countertop depth allowance unused;
- kitchen/wardrobe body based on front area, not panel list;
- module basePrice and body area both charged.

---

## 12. BUSINESS RULE REQUIRED

| ID | Rule needed | Why it matters | Data required |
|---|---|---|---|
| MR-1 | Physical carcass panel model for kitchen | Current body cost is front-area × depth; internal panels not listed | Cutting list, panel thickness, back panel, waste factor |
| MR-2 | Physical carcass panel model for wardrobe | `1.15` is commercial; dividers/internal panels not listed | Panel list, thickness, back panel, waste |
| MR-3 | Does a new wardrobe section require a full-height divider? | 1×120 and 2×60 currently cost the same | Section construction spec |
| MR-4 | Is a standalone bottle module covered by countertop? | Potential 1 425–8 820 ₽ undercharge per bottle | Countertop layout rule |
| MR-5 | Does countertop rate include depth, or is area/depth surcharge required? | `countertopDepthAllowance` is unused | Countertop pricing basis |
| MR-6 | Does module `basePrice` include any carcass material? | Prevents double counting with body material area | Production cost breakdown |
| MR-7 | Are sink partitions and per-piece shelves/rods priced including material? | Potential missing panel material | Cost breakdown / cutting spec |

---

## 13. PASS

| Check | Evidence |
|---|---|
| Kitchen facade area accounting | K1 fronts 31 916 ₽ / MDF 8 400 = 3.7995 m², matching geometric front area |
| Tall/oven excluded from countertop | Full-height modules do not receive countertop; code filters them |
| Wardrobe facade area for 1×120 vs 2×60 | Same front area; identical facade cost is correct |
| Wardrobe door count for 1×120 vs 2×60 | 2 doors in both; fittings identical is correct |
| Standard-scenario arithmetic | K1/K2/wardrobe recomputation from content rates matches |

---

## 14. What must be approved before the next stage

1. A production carcass specification: panel list per module/section, thickness, back panel, shelves, partitions, waste/edge-banding.
2. The meaning of `bodyFactor = 1.15` and whether it replaces or supplements internal panels.
3. The countertop rule for standalone bottle modules and whether the linear rate includes standard depth.
4. Whether `basePrice` includes carcass material (to avoid double counting).
5. Whether sink partitions and per-piece shelves/rods include material.
6. Approved rates/norms and a cutting-list source, if the business wants physical material consumption rather than a commercial heuristic.

Until then, the material model remains a **commercial estimate**, not a verified production material calculation.

---

**Related report:** `docs/CALCULATION_ADMIN/CALCULATION_CORRECTNESS_AUDIT.md` (UNKNOWN statuses retained; this report adds material-consumption evidence only).

**Decision register:** `docs/CALCULATION_ADMIN/MATERIAL_CONSUMPTION_RULES_DECISION_REGISTER.md` (2026-11-10). This register records open owner decisions; the audit statuses above are unchanged.

**Master plan:** `docs/CALCULATION_ADMIN/MATERIAL_COST_MODEL_MASTER_PLAN.md` (2026-11-10). Research/design only; existing statuses unchanged.
