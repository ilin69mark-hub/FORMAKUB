# FORMULA & ALGORITHM CATALOG

**Block:** Stage 9 / Block 1 — Calculation Audit & Test Coverage Baseline
**Date:** 2026-11-12
**Mode:** diagnostic / read-only. No formula, geometry, tariff, `calcVersion`, `schemaVersion`, storage structure or UI was changed.
**Method:** direct reading of the production sources listed in §3; every formula below was taken from the implementation, not from the function name. Where the mathematics could not be fully justified from code alone, the row is marked `REQUIRES_DOMAIN_CONFIRMATION`.

---

## 1. How to read this catalog

### 1.1 ID scheme

| Prefix | Domain |
|---|---|
| `F-PR-*` | Commercial: price composition, coefficients, rounding, promos |
| `F-CV-*` | Unit conversion and rounding primitives |
| `F-GK-*` | Kitchen geometry |
| `F-GW-*` | Wardrobe geometry |
| `F-SK-*` | Sink module layout geometry |
| `F-SL-*` | Supports and lighting |
| `F-VD-*` | Normalization and validation rules |
| `F-CT-*` | Calculation input contract validation |
| `F-DM-*` | Display / presentation adapters (non-monetary) |

### 1.2 Criticality

| Level | Meaning |
|---|---|
| **CRITICAL** | An error changes the final payable amount or the physical dimensions/parts of the product. |
| **HIGH** | An error breaks one whole calculation block (e.g. fittings, promos, sink layout) but is bounded. |
| **MEDIUM** | Boundary / rare-path behaviour; wrong only for extreme or legacy inputs. |
| **LOW** | Auxiliary, presentational or dead logic with no direct monetary/geometric effect. |

### 1.3 Evidence status

| Status | Meaning |
|---|---|
| `CONFIRMED` | Formula read in the implementation and independently consistent with a test that pins concrete values. |
| `CONFIRMED (snapshot expected)` | Formula read in the implementation; the test's expected value is an Engine snapshot, so the test proves regression only, not independent correctness. |
| `REQUIRES_DOMAIN_CONFIRMATION` | The arithmetic is clear from code, but the *business rule* behind it has no approved normative source. |

### 1.4 Test column semantics

`direct` = the function name occurs in a test source. `indirect` = the function is not named in any test but is reached through a tested caller. `none` = no test source references it and no tested caller reaches it.

---

## 2. Entry points and dependency structure

```
content/pricing.ts (PRICING, PROMOS)  content/catalog.ts  content/plinth.ts
content/supports.ts  content/lighting.ts
        │
        ├── LEGACY PATH  src/lib/configurator/pricing.ts
        │      calculatePrice ─┬─ calculateKitchenPrice
        │                      └─ calculateWardrobePrice
        │      (used by golden/baseline tests and historical data)
        │
        └── RUNTIME PATH  CalculationInputs (contract.ts, validated)
               └── src/lib/configurator/engine.ts
                      calculateBreakdown ─┬─ calculateKitchenBreakdown
                                          └─ calculateWardrobeBreakdown
                      └── Display Adapter (display-adapter.ts) → PriceBreakdown
                             └── persistence / PriceHistory (server, admin)
```

Both paths share the same *formula shapes* but resolve rates from different sources (static `content/*` vs `PricingVersion.snapshot`), and the Engine keeps its own copies of the lighting and supports computations (`lightingPlanned`, `supportPlanned` inside `engine.ts`).

Shared geometry modules used by **both** the price and the 2D scenes:
`facade-geometry.ts`, `sink.ts`, `wardrobe-geometry.ts`, `wardrobe-facade-geometry.ts`, `wardrobe-hinges.ts`, `wardrobe-edge.ts`, `display.ts`, `geometry.ts`.

---

## 3. Catalog

### 3.1 Commercial / pricing (`F-PR-*`)

| ID | Name | Formula / algorithm as implemented | Inputs (units) | Output (units) | Rounding | File : function | Tests | Criticality | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| F-PR-01 | Kitchen price (legacy) | `subtotalRaw = (baseCost + Σ body + Σ fronts + Σ fittings + Σ options) × complexityFactor`; `subtotal = max(0, max(minOrder, roundMoney(subtotalRaw)))`; `total = roundMoney(max(0, subtotal − discount))` | `KitchenConfig` | `PriceBreakdown` (₽) | `roundMoney` step = `PRICING.rounding` = 100 ₽ | `lib/configurator/pricing.ts : calculateKitchenPrice` | `pricing.test` (17), `golden.test` (8), `baseline.test` | **CRITICAL** | `CONFIRMED (snapshot expected)` |
| F-PR-02 | Wardrobe price (legacy) | `subtotalRaw = baseCost + bodyCost + frontsCost + fittingsCost + optionsCost` (no complexity factor; `complexityFactor` hardcoded `1`); same min-order / promo / rounding chain | `WardrobeConfig` | `PriceBreakdown` (₽) | 100 ₽ | `pricing.ts : calculateWardrobePrice` | `pricing.test`, `golden.test`, `baseline.test` | **CRITICAL** | `CONFIRMED (snapshot expected)` |
| F-PR-03 | Price dispatcher | `kind === "kitchen" ? F-PR-01 : F-PR-02` | `FurnitureConfig` | `PriceBreakdown` | — | `pricing.ts : calculatePrice` | `pricing.test`, `golden.test` | HIGH | `CONFIRMED` |
| F-PR-04 | Kitchen breakdown (Engine) | same composition as F-PR-01, but every rate is resolved through `price(map, id)` from `PricingVersion.snapshot`; missing/duplicate `PriceItem` → hard `fail()` | `KitchenConfig`, `CalculationInputs` | `CalculationBreakdown` (₽) | step comes from `rules.rounding` (validated `> 0`) | `lib/configurator/engine.ts : calculateKitchenBreakdown` | `golden-engine.test`, `price-contour.test` (indirect) | **CRITICAL** | `CONFIRMED (snapshot expected)` |
| F-PR-05 | Wardrobe breakdown (Engine) | same composition as F-PR-02 with snapshot rates | `WardrobeConfig`, `CalculationInputs` | `CalculationBreakdown` (₽) | `rules.rounding` | `engine.ts : calculateWardrobeBreakdown` | `golden-engine.test` (indirect) | **CRITICAL** | `CONFIRMED (snapshot expected)` |
| F-PR-06 | Breakdown dispatcher | `kind === "kitchen" ? F-PR-04 : F-PR-05` | `FurnitureConfig` | `CalculationBreakdown` | — | `engine.ts : calculateBreakdown` | `golden-engine.test` | HIGH | `CONFIRMED` |
| F-PR-07 | Module body cost | `bodyCost += preset.basePrice + area(width,height) × bodyRate × max(0.5, depth / bodyDepthReference)`; `bodyRate` = `ratePerSqm` of the **fixed** body material (`FIXED_BODY_MATERIAL_ID = "ldsp"`), `bodyDepthReference` = 60 cm | module `width, height` (cm), `depth` (cm) | ₽ | none (accumulated as float, `Math.round` only in the output line) | `pricing.ts:273` / `engine.ts:714` | `golden.test`, `facade-geometry.test` (`цена кухни…`), `baseline.test` | **CRITICAL** | `CONFIRMED (snapshot expected)`; `max(0.5, …)` floor is **unreachable** for validated depths ≥ 40 cm (see §4) |
| F-PR-08 | Kitchen fronts cost | `frontsCost += facadeArea × facadeRate × styleMultiplier`; `facadeArea` comes from `kitchenModuleFacadeArea` (F-GK-09/10/11) — for a sink the area of the *actual* facade boxes, for drawers a `facadeStack`, otherwise `kitchenFacadeField` | cm, ₽/m², dimensionless multiplier | ₽ | none (rounded on output) | `pricing.ts:290–327`, `engine.ts:733–750` | `facade-geometry.test` (`цена кухни: сумма фактических площадей × тариф` — hand-computed), `golden.test` | **CRITICAL** | `CONFIRMED` (independent arithmetic in `facade-geometry.test`) |
| F-PR-09 | Door fittings | per hinged door: `+hingePerDoor`; `if hinge==="soft"` `+softClosePerDoor`; `if pushToOpen` `+pushToOpenPerDoor`; `if handle!=="none"` `+handleRate` | door count (шт), ₽/шт | ₽ | none | `pricing.ts:307–316` / `engine.ts:727–732` | `golden.test`, `baseline.test` | HIGH | `CONFIRMED (snapshot expected)` |
| F-PR-10 | Drawer fittings | per drawer: `+drawerSlide`; `if soft` `+drawerSoftClose`; `if handle!="none"` `+handleRate` | drawer count | ₽ | none | `pricing.ts:320–326`, `:364–371`; `engine.ts:746–748`, `:781–784` | `golden.test`, `pricing.test` | HIGH | `CONFIRMED (snapshot expected)` |
| F-PR-11 | Shelf cost | `optionsCost += shelfTotal × shelfRate`; `shelfTotal` is accumulated per module (`unit.shelves`), **except** a sink module that carries `sinkStorage` — for such a module the shelves come only from the layout sections (anti-double-count rule) | count (шт), ₽/шт | ₽ | none | `pricing.ts:333–335,360,378`; `engine.ts:754–756,778,791` | `pricing.test` (4 dedicated cases), `golden-engine.test` | **CRITICAL** | `CONFIRMED` (independent probe + regression tests; historical FAIL-1 was fixed here) |
| F-PR-12 | Countertop cost | `countertopWidth = Σ width of modules with type ∈ {base, sink, hob, drawers} / 100`; `optionsCost += countertopWidth × ratePerLinearMeter`. **`bottle` and `wall`/`tall`/`oven` are excluded** | cm → m, ₽/пог. м | ₽ | none | `pricing.ts:381–384`; `engine.ts:793–796` | `golden.test`, `pricing.test` | **CRITICAL** | `CONFIRMED`; bottle-module inclusion is `REQUIRES_DOMAIN_CONFIRMATION` (audit U-2, suspected −0.2 м) |
| F-PR-13 | Plinth cost (legacy) | `plinthMeters = Σ floor-row module widths / 100`; `cost = plinthMeters × plinthRatePerMeter(material, finish)` where `plinthRatePerMeter = base + rateDelta`; `0` when `plinth === false` | cm → m, ₽/м | ₽ | none | `pricing.ts:397–403` + `content/plinth.ts : plinthRatePerMeter` | `golden.test` (`kitchen-plinth-negative-delta`), `baseline.test` | HIGH | `CONFIRMED (snapshot expected)` |
| F-PR-14 | Plinth cost (Engine) | `plinthCost = plinthMeters × (ratePerMeter + signedAdjustment("plinth:<material>:<finish>"))`; a missing signed adjustment is a hard `fail()` | same | ₽ | none | `engine.ts:686–692,804` | `golden-engine.test`, `price-contour.test` | HIGH | `CONFIRMED` |
| F-PR-15 | Side panels | `optionsCost += sidePanels × sidePanelRate` | count | ₽ | none | `pricing.ts:379`; `engine.ts:792` | `golden.test` | MEDIUM | `CONFIRMED (snapshot expected)` |
| F-PR-16 | Fixed module options | sink → `+sinkCutout`; hob → `+hobCutout`; oven → `+ovenNiches`; sink section with `bottle>0` → `+bottleRack` (mechanism only; the bottle facade panel is charged as a normal facade via F-PR-08) | module type | ₽ | none | `pricing.ts:337,354–358,374–375`; `engine.ts:758,775,787–788` | `golden.test`, `pricing.test` (`bottle rack`) | HIGH | `CONFIRMED` |
| F-PR-17 | Complexity factor | `extra = max(0, moduleCount − 3)`; `complexityFactor = min(complexityMax, 1 + extra × complexityPerExtraModule)`; `complexityPerExtraModule = 0.02`, `complexityMax = 1.12` → cap binds from 10 modules. Applied to the **whole** subtotal including base cost, supports, plinth and LED | module count (шт) | dimensionless | `toFixed(2)` only for display | `pricing.ts:411–415`; `engine.ts:811–815` | `golden.test` (`kitchen-promo-complexity`, asserts `1.12`), `baseline.test` (`1.06`) | **CRITICAL** | `CONFIRMED`; **Engine-side cap has no test** (mutation M3 survived) and the *scope* of the factor is `REQUIRES_DOMAIN_CONFIRMATION` (audit U-5) |
| F-PR-18 | Min order | `subtotal = max(0, max(minOrder, roundMoney(subtotalRaw)))`; `minOrderApplied = subtotalRaw < minOrder`; `minOrder = 45000 ₽` | ₽ | ₽ | 100 ₽ | `pricing.ts:526`, `engine.ts:820` | `golden.test` (`kitchen-min-order`), `pricing.test` (small wardrobe) | **CRITICAL** | `CONFIRMED` (killed by mutation M7) |
| F-PR-19 | Promo eligibility | gates, in order: unknown code → invalid; `!active` → invalid; `appliesTo` mismatch → invalid; `subtotal < minSubtotal` → invalid. Each gate returns `discount = 0` | `PromoDefinition`, `subtotal` (₽) | `PromoResult` | — | `pricing.ts:173–197,199–240`; `engine.ts:146–227` | **none** for the `minSubtotal` gate (see §4) | **CRITICAL** | `CONFIRMED` in code; **`minSubtotal` branch untested** (mutation M12 survived) |
| F-PR-20 | Promo discount | `discount = type==="percent" ? subtotal×value/100 : value`; `if maxDiscount` `discount = min(discount, maxDiscount)`; `discount = roundMoney(min(discount, subtotal))` | ₽ | ₽ | 100 ₽ | `pricing.ts:225–229`; `engine.ts:207–212` | `golden.test` (`expectedPromo` re-computes this independently), `pricing.test` (cap ≤ 30000) | **CRITICAL** | `CONFIRMED` (killed by mutation M6) |
| F-PR-21 | Total | `total = roundMoney(max(0, subtotal − discount))` | ₽ | ₽ | 100 ₽ | `pricing.ts:537,679`; `engine.ts:823,954` | `golden.test`, `baseline.test`, `price-contour.test` | **CRITICAL** | `CONFIRMED` |
| F-PR-22 | Wardrobe body cost | `bodyCost = wardrobeBodyAreaSqm(geometry) × bodyRate`, where `wardrobeBodyAreaSqm = Σ areaSqm(parts)` and parts = left/right side, bottom, top (+ partition, + antresol divider). Back panel (ХДФ), shelves and plinth are **not** in `parts` | mm → m², ₽/m² | ₽ | none | `pricing.ts:566–569`; `engine.ts:914–917`; `wardrobe-geometry.ts : wardrobeBodyAreaSqm` | `wardrobe-geometry.test` (`площадь корпуса зависит от глубины и не использует bodyFactor`), `golden.test` | **CRITICAL** | `CONFIRMED`; consumption model is `REQUIRES_DOMAIN_CONFIRMATION` (audit U-3/U-4) |
| F-PR-23 | Wardrobe fronts cost | `frontsCost = wardrobeFacadeGeometry(config, geometry).totalAreaSqm × facadeRate × styleMultiplier` | m², ₽/m², × | ₽ | none | `pricing.ts:570–572`; `engine.ts:918–920` | `facade-geometry.test` (`цена шкафа…`), `golden.test` | **CRITICAL** | `CONFIRMED` |
| F-PR-24 | Wardrobe fittings | `hinges = hingePlan.totalHinges`; `fittings = hinges×hingePerDoor + drawers×drawer`; `if soft` `+ doorsTotal×softClose + drawers×drawerSoftClose`; `if pushToOpen` `+ doorsTotal×pushToOpen`; `if handle!=="none"` `+ doorsTotal×handleRate` | counts | ₽ | none | `pricing.ts:583–595`; `engine.ts:929–937` | `golden.test`, `wardrobe-hinges.test` | HIGH | `CONFIRMED (snapshot expected)` |
| F-PR-25 | Wardrobe options | `options = shelves×shelf + rods×rod`; `if plinth` `+ (widthCm/100) × plinthPerMeter`; `if ledLighting` `+ sectionCount × ledPerSection`; `+ wardrobeEdgePlan(...).totalCost` | шт, м | ₽ | none | `pricing.ts:597–615`; `engine.ts:938–948` | `golden.test`, `wardrobe-edge.test` | HIGH | `CONFIRMED (snapshot expected)` |
| F-PR-26 | Edge banding cost | `perimeterM(w,h) = 2×(max(0,w)+max(0,h)) / 1000`; one perimeter per rectangular part: body parts → PVC 1 mm, each physical shelf → PVC 0.4 mm, LDSP facades → PVC 2 mm (MDF facades → none); `cost = Σ lengthM × rate` | mm → м, ₽/пог. м | ₽ | none | `wardrobe-edge.ts : perimeterM, wardrobeEdgeGeometry, wardrobeEdgePlan` | `wardrobe-edge.test` (9) | MEDIUM | `CONFIRMED` (killed by mutation M13) |
| F-PR-27 | Lighting cost (legacy) | `lengthM` = Σ usable upper-row segments − mounting margins − blocked by tall units; `powerW = round(lengthM × powerPerMeter,1)`; `requiredW = round(powerW × psuMargin,1)`; `psuW` = smallest rating ≥ `requiredW` (else largest); `psuCount = ceil(requiredW / maxPsuW)` when `requiredW > maxPsuW`; `runs` split by `maxContinuousRunM`; `cost = strip+profile+diffuser+endCaps+connectors+psu+control+install` | м, Вт/м, В | LightingPlan (м, Вт, шт, ₽) | `round(…,3)` on length, `round(…,1)` on power | `lighting.ts : computeLighting` | `lighting.test` (7) | HIGH | `CONFIRMED`; engineering limits `REQUIRES_DOMAIN_CONFIRMATION` |
| F-PR-28 | Lighting cost (Engine copy) | same as F-PR-27 reimplemented inside `engine.ts` (`lightingPlanned`), rates from snapshot | same | ₽ | same | `engine.ts : lightingPlanned` (~line 545–658) | `golden-engine.test` (totals only) | HIGH | `CONFIRMED`; **run-splitting branch untested on this path** (mutation M18 survived) |
| F-PR-29 | Support cost (legacy) | see F-SL-01…F-SL-03; `cost = legs×legPrice + clips×clipPrice + screws×screwPrice + anchors×anchorPrice` | шт, ₽/шт | SupportPlan (шт, ₽) | none | `supports.ts : computeSupports` | `supports.test` (7) | HIGH | `CONFIRMED`; engineering basis `REQUIRES_DOMAIN_CONFIRMATION` (`source: "preliminary"`) |
| F-PR-30 | Support cost (Engine copy) | `supportPlanned` inside `engine.ts`, rates from snapshot; same position/count rules as `supports.ts` | same | ₽ | none | `engine.ts : supportPlanned` | `golden-engine.test` (totals only) | HIGH | `CONFIRMED`; **count clamp branch untested** (mutation M17 survived) |
| F-PR-31 | Rate lookups | `bodyRate = BODY_MATERIALS[id=FIXED_BODY_MATERIAL_ID].ratePerSqm`; `facadeRate = FACADE_MATERIALS[config.facadeMaterial].ratePerSqm ?? 0`; `styleMultiplier = FACADE_STYLES[config.facadeStyle].multiplier ?? 1`; `handleRate = HANDLES[config.handle].rate ?? 0` | ids | ₽/m², ×, ₽/шт | — | `pricing.ts:71–88` | `golden.test`, `materials.test` | **CRITICAL** | `CONFIRMED`; silent `?? 0` / `?? 1` fallbacks hide unknown ids in the legacy path |
| F-PR-32 | Door count by width | `doorCountForWidth(w) = facadeDoorCount(w) = w > 60 ? 2 : 1` (strict `>`, threshold `FACADE_SPLIT_WIDTH_CM = 60` cm) | cm | шт | — | `facade-geometry.ts:88`, re-exported `pricing.ts:90` | `facade-geometry.test` (`порог 60 см`), `sink.test` | HIGH | `CONFIRMED` (killed by mutation M1) |
| F-PR-33 | Countertop width | `kitchenCountertopWidth = Σ modules.filter(type ∈ {base,sink,hob,drawers}).width` (cm) | config | cm | — | `pricing.ts:105–109`; inline in `engine.ts:793` | `golden.test`, `pricing.test` | **CRITICAL** | `CONFIRMED` (killed by mutation M11) |
| F-PR-34 | Row / wardrobe widths | `kitchenTotalWidth = max(Σ floor widths, Σ upper widths)`; `wardrobeWidth = Σ section widths / 10` (from `wardrobeGeometry`) | config | cm | — | `display.ts:23,35` | `pricing.test` (`wardrobeWidth === 240`) | MEDIUM | `CONFIRMED` |

### 3.2 Unit conversion & rounding (`F-CV-*`)

| ID | Name | Formula | Inputs → Output | File : function | Tests | Criticality | Evidence |
|---|---|---|---|---|---|---|---|
| F-CV-01 | Area (legacy) | `area(w,h) = safe(w) × safe(h) / 10000`, `safe(x) = isFinite(x) ? x : 0` | cm, cm → m² | `pricing.ts : area` | indirect (`golden.test`, `facade-geometry.test`) | **CRITICAL** | `CONFIRMED` (killed by mutation M9) |
| F-CV-02 | Area (Engine) | identical to F-CV-01 | cm → m² | `engine.ts : area` | indirect | **CRITICAL** | `CONFIRMED` |
| F-CV-03 | Area (facade) | `facadeAreaSqm(w,h) = max(0,w) × max(0,h) / 10000` — note: clamps negatives to 0 instead of passing them through | cm → m² | `facade-geometry.ts : facadeAreaSqm` | indirect (`facade-geometry.test`) | **CRITICAL** | `CONFIRMED` |
| F-CV-04 | Area (wardrobe parts) | `areaM2(w,h) = max(0,w) × max(0,h) / 1_000_000` | mm → m² | `wardrobe-geometry.ts : areaM2` | `wardrobe-geometry.test` | **CRITICAL** | `CONFIRMED` |
| F-CV-05 | Area (wardrobe panels) | `(max(0,w) × max(0,h)) / 1_000_000` | mm → m² | `wardrobe-facade-geometry.ts : panel` | `wardrobe-facade-geometry.test` | **CRITICAL** | `CONFIRMED` |
| F-CV-06 | Money rounding (legacy) | `roundMoney(v) = max(0, round(v / PRICING.rounding) × PRICING.rounding)`, step 100 ₽, half-up via `Math.round` | ₽ → ₽ | `pricing.ts : roundMoney` | `golden.test` (all scenarios), `baseline.test` | **CRITICAL** | `CONFIRMED` (killed by mutation M2) |
| F-CV-07 | Money rounding (Engine) | `roundMoney(v, step) = max(0, round(v / step) × step)`; `step = rules.rounding` from the snapshot (validated finite and `> 0`) | ₽ → ₽ | `engine.ts : roundMoney`, `engine.ts : rules` | `golden-engine.test` | **CRITICAL** | `CONFIRMED` |
| F-CV-08 | Generic rounding | `round(v, digits=2) = round(v × 10^digits) / 10^digits` | number | `engine.ts : round` | indirect | MEDIUM | `CONFIRMED` |
| F-CV-09 | Display range | `formatRange(v) = "v…1.1v"` style band, `±10 %` | ₽ → string | `display.ts : formatRange` | `pricing.test` (checks separator only) | LOW | `CONFIRMED`; the ±10 % band itself is **not** asserted |
| F-CV-10 | cm→m in display | hard-coded `value / 100` allowed **only** for line `wardrobe.plinth`, field `widthCm`, format `fixed1`, unit `м`; any other use throws | cm → м (string) | `display-adapter.ts : renderSegment` | `golden-engine.test` (indirect) | LOW | `CONFIRMED` |
| F-CV-11 | Depth factors | `depthFactor = depth / bodyDepthReference(60)`; floor `max(0.5, depthFactor)`; `kitchenFullDepthMm = bodyDepthCm×10 + 3mm + facadeThicknessMm`; `kitchenMaxBodyDepthMm = 580 − 3 − facadeThicknessMm`; `kitchenCountertopOverhangMm = 600 − kitchenFullDepthMm` | cm/mm → mm | `geometry.ts : kitchenFullDepthMm`, `kitchenMaxBodyDepthMm`, `kitchenCountertopOverhangMm` | `facade-depth.test` (10), `geometry-ranges.test` (12) | **CRITICAL** | `CONFIRMED` (killed by mutations M15) |

### 3.3 Kitchen geometry (`F-GK-*`)

| ID | Name | Algorithm as implemented | Inputs → Output | File : function | Tests | Criticality | Evidence |
|---|---|---|---|---|---|---|---|
| F-GK-01 | Facade field (single/двухстворочный) | `fieldWidth = width − left − right`; `fieldHeight = height − top − bottom`; `doors = max(1, floor(doors ?? doorCount(width)))`; `panelWidth = (fieldWidth − gap×(doors−1)) / doors`; panel *i* at `x = left + i×(panelWidth+gap)`, `y = top`; `area = Σ panelWidth×fieldHeight/10000` | cm → `FacadeGeometry` (cm, m²) | `facade-geometry.ts : facadeField` | `facade-geometry.test` (13) | **CRITICAL** | `CONFIRMED` (hand-computed expectations) |
| F-GK-02 | Drawer front stack | `fieldHeight = height − top − bottom`; `panelHeight = (fieldHeight − gap×(count−1)) / count`, `count = max(1, floor(count))`; each front full field width, stacked with `gap` | cm → `FacadeGeometry` | `facade-geometry.ts : facadeStack` | `facade-geometry.test`, `geometry-ranges.test` | **CRITICAL** | `CONFIRMED` (killed by mutation M22) |
| F-GK-03 | Kitchen facade field | `tall = type ∈ {tall, oven}`; `bodyHeight = height − (tall ? plinthHeight : 0)`; left/right gap = `0.2` at row edge else `0.1`; top/bottom gap `0.2`; `doorGap = type==="oven" ? 0.1 : 0.2` | module type + row position → `FacadeGeometry` | `facade-geometry.ts : kitchenFacadeField` | `facade-geometry.test` (13) | **CRITICAL** | `CONFIRMED` (killed by mutation M21) |
| F-GK-04 | Row position map | modules are grouped into `floor` / `upper` rows **by catalogue zone**; index within row → `start`/`end` flags; a row of one module is both `start` and `end` | modules → `Map<id,{start,end}>` | `pricing.ts : kitchenRowPositions`, `engine.ts : kitchenRowPositions` | indirect (`facade-geometry.test` CA-T-518) | MEDIUM | `CONFIRMED`; **order-dependent** — depends on array order, not on any coordinate |
| F-GK-05 | Module facade area | `kitchenFacadeField` → if sink: `sinkFacadeArea(sinkLayout(...).facadeBoxes, fieldHeight)`; if drawers: `facadeStack(count=unit.drawers)`; else `field.areaSqm` | module → m² | `pricing.ts : kitchenModuleFacadeArea`, `engine.ts : kitchenModuleFacadeArea` | `facade-geometry.test` (`цена кухни…`) | **CRITICAL** | `CONFIRMED` |
| F-GK-06 | Sink facade area | for each box: `drawers` → `facadeStack(...)`; `door`/`bottle` → `box.width × fieldHeight / 10000` | boxes, cm → m² | `facade-geometry.ts : sinkFacadeArea` | `facade-geometry.test` (my sink case), `sink.test` (indirect) | **CRITICAL** | `CONFIRMED` |
| F-GK-07 | Lower row total height | `kitchenLowerTotalHeightCm = first non-tall module height + (plinth ? plinthHeight : 0) + countertopThickness/10` | cm + mm → cm | `geometry.ts : kitchenLowerTotalHeightCm` | `geometry-ranges.test` (hand-computed `70+15+2.6`) | MEDIUM | `CONFIRMED`; **returns 0 when the kitchen has only tall/oven modules** |
| F-GK-08 | Kitchen full depth / overhang | see F-CV-11 | cm/mm | `geometry.ts` | `facade-depth.test`, `geometry-ranges.test` | **CRITICAL** | `CONFIRMED` |
| F-GK-09 | Kitchen move | swap a module with its neighbour **inside the same zone**, using array order; returns the same config when the target is absent or at the boundary | config, id, ±1 → config | `kitchenMove.ts : moveKitchenModule`, `canMoveKitchenModule` | `sink.test` (`module movement`, 3 cases) | MEDIUM | `CONFIRMED` |
| F-GK-10 | Countertop / plinth lengths | countertop: F-PR-33; plinth: `Σ floor-zone widths / 100` (Engine uses `zoneOf(inputs, unit)` = preset zone, legacy uses `kitchenFloorModules`) | cm → m | `pricing.ts:386–398`, `engine.ts:800–803` | `golden.test`, `pricing.test` | **CRITICAL** | `CONFIRMED` (killed by mutation M10) |

### 3.4 Wardrobe geometry (`F-GW-*`)

All linear units **mm** unless stated.

| ID | Name | Algorithm as implemented | Inputs → Output | File : function | Tests | Criticality | Evidence |
|---|---|---|---|---|---|---|---|
| F-GW-01 | Minimum wardrobe width | `wardrobeMinWidthMm(n) = n×300 + (n+1)×16`, `n = max(1, floor(sectionCount))` | count → mm | `wardrobe-geometry.ts : wardrobeMinWidthMm` | `wardrobe-geometry.test` (`минимальная ширина для 1–4 секций по формуле`) | HIGH | `CONFIRMED` (killed by mutation M4) |
| F-GW-02 | Section widths | **no partition:** `outer = width`, `inner = width − 2×16`. **with partition:** `half = 16/2`; `leftOuter = max(0, pos − half)`; `rightOuter = max(0, width − pos − half)`; `leftInner = max(0, leftOuter − 16)`; `rightInner = max(0, rightOuter − 16)` | width, pos → 2×`{outer,inner}` | `wardrobe-geometry.ts : wardrobeSectionWidths` | `wardrobe-geometry.test` (sum-preservation, boundary 300 mm) | **CRITICAL** | `CONFIRMED` (killed by mutation M16) |
| F-GW-03 | Body geometry | `heightMm = height(cm)×10`; `bodyDepthMm = max(0, fullDepth − facadeThickness − 3)`; `plinthHeightMm = plinth ? 80 : 0`; `internalWidthMm = max(0, width − 2×16)`; sections = `config.sections.slice(0, widths.length)` mapped onto computed widths | config → `WardrobeGeometry` | `wardrobe-geometry.ts : wardrobeGeometry` | `wardrobe-geometry.test` (11) | **CRITICAL** | `CONFIRMED` |
| F-GW-04 | Carcass parts | parts = `side-left (bodyDepth×height)`, `side-right`, `bottom (internalWidth×bodyDepth)`, `top (width×bodyDepth)`; + `partition (bodyDepth×height)`; + `antresol-divider (internalWidth×bodyDepth)`. Back panel, shelves, plinth are **excluded** | → `WardrobeGeometryPart[]` | `wardrobe-geometry.ts : wardrobeGeometry` (`parts`) | `wardrobe-geometry.test`, `wardrobe-edge.test` (consumes parts) | **CRITICAL** | `CONFIRMED`; **top uses full `widthMm` while bottom uses `internalWidthMm`** — asymmetry is not asserted by any test; consumption model `REQUIRES_DOMAIN_CONFIRMATION` |
| F-GW-05 | Antresol geometry | `dividerThickness = 16` (temporary assumption); `dividerBottom = max(0, height − antresolHeight − 16)`; `mainHeight = max(0, dividerBottom − plinthHeight − 16)`; `innerHeight = max(0, antresolHeight − 16)` | config → record | `wardrobe-geometry.ts` (antresol IIFE) | `wardrobe-geometry.test` (`антресоль…`, `высота антресоли…`) | HIGH | `CONFIRMED`; divider thickness explicitly `REQUIRES_DOMAIN_CONFIRMATION` |
| F-GW-06 | Body area | `Σ part.areaSqm` | mm² → m² | `wardrobe-geometry.ts : wardrobeBodyAreaSqm` | `wardrobe-geometry.test` (`площадь корпуса зависит от глубины`) | **CRITICAL** | `CONFIRMED` |
| F-GW-07 | Vertical facade bounds | no antresol: `mainTop = 2`, `mainBottom = height − plinthHeight − 2`. With antresol: `center = height − dividerBottom − dividerThickness/2`; `antresolBottom = center − 1`; `mainTop = center + 1` | → mm | `wardrobe-facade-geometry.ts : verticalBounds` | `wardrobe-facade-geometry.test` (9) | **CRITICAL** | `CONFIRMED` |
| F-GW-08 | Facade panels | **no partition:** one panel `x=2, w=width−4`. **with partition:** left `x=2, w=pos−2−1`; right `x=pos+1, w=width−pos−2−1`. Antresol: `x=2, w=width−4`, `h = antresolBottom − antresolTop`. `areaSqm = max(0,w)×max(0,h)/1e6` | → `WardrobeFacadeGeometry` | `wardrobe-facade-geometry.ts : wardrobeFacadeGeometry` | `wardrobe-facade-geometry.test`, `facade-geometry.test` (`цена шкафа`) | **CRITICAL** | `CONFIRMED` |
| F-GW-09 | Door mass | `massKg = areaSqm × density[thickness]`, densities `{16:11.5, 19:14.8, 22:16.8}` kg/m² | m² → kg | `wardrobe-hinges.ts : wardrobeDoorMassKg` | `wardrobe-hinges.test` (11) | HIGH | `CONFIRMED`; densities marked **preliminary/UNKNOWN** in source |
| F-GW-10 | Hinge count per door | first band in `WARDROBE_HINGE_BANDS` with `heightMm ≤ maxHeightMm && massKg ≤ maxMassKg`; bands ordered light→heavy (8 bands, 2…6 hinges); **no match → fallback `6` hinges with `overload = true`** | mm, kg → count or `null` | `wardrobe-hinges.ts : wardrobeHingeCountForDoor` | `wardrobe-hinges.test` | HIGH | `CONFIRMED` (killed by mutation M14) |
| F-GW-11 | Hinge plan | per panel: mass + count; `totalHinges = Σ`; `maxMassKg = max`; `overloaded = any(count === null)`; `widthWarning = widthMm > 600` | config → plan | `wardrobe-hinges.ts : wardrobeHingePlan` | `wardrobe-hinges.test` | HIGH | `CONFIRMED`; **`widthWarning` does not block anything** (documented as intentional) |
| F-GW-12 | Edge banding | see F-PR-26 | mm → м, ₽ | `wardrobe-edge.ts` | `wardrobe-edge.test` | MEDIUM | `CONFIRMED` |
| F-GW-13 | Component counts | `wardrobeDrawerCount = Σ section.drawers`; `wardrobeRodCount = Σ section.rods.length`; `wardrobePulloutRodCount` = pull-out rod subset | config → шт | `wardrobe-components.ts` | `wardrobe-components.test` (8) | MEDIUM | `CONFIRMED`; **`wardrobePulloutRodCount` is not referenced by any test** and is not used in pricing |

### 3.5 Sink module layout (`F-SK-*`)

Units: **mm** for sink dimensions, **cm** for module layout boxes.

| ID | Name | Algorithm as implemented | File : function | Tests | Criticality | Evidence |
|---|---|---|---|---|---|---|
| F-SK-01 | Sink rules | `SINK_RULES` — step, min/max, mount edges, facade gaps, `bottleClearOffset`, drawer thresholds; `sinkRulesFromParameters(inputs.parameters)` overrides them from `CalculationInputs` | `sink.ts : SINK_RULES`, `sinkRulesFromParameters` | `sink.test`, `validation.test` | HIGH | `CONFIRMED`; parameter override path covered by `data-resolver.test` |
| F-SK-02 | Standard sizes | `SINK_STANDARD_WIDTHS_MM` / `SINK_STANDARD_DEPTHS_MM`; `nearestStandardSink`, `isSinkStandardWidth/Size` | `sink.ts` | `sink.test` | MEDIUM | `CONFIRMED` |
| F-SK-03 | Snapping / clamping | `snapMm(v, rules)` (step grid), `snapSinkWidth`, `clampSinkWidth/Depth` (module-specific maximum, mount edges), `maxSinkWidthFor = W − margins`, `maxSinkDepthFor = depth − 2×50` | `sink.ts` | `sink.test` (several) | HIGH | `CONFIRMED`; `nearestStandardSink` **not referenced by any test** |
| F-SK-04 | Row margins | `sinkRowMargins(module, row)` → `{left,right}` mm; `edge` side gets 50 mm, inner side 0; `sinkRowContext(modules, id)` derives `leftEdge`/`rightEdge` from neighbours in array order | `sink.ts : sinkRowMargins`, `sinkRowContext` | `sink.test` (`row margins`, 5 cases) | HIGH | `CONFIRMED`; **order-dependent** on the module array |
| F-SK-05 | Sink geometry | `x` from position/offset, clamped into `[minOffset, maxOffset]`; `zoneLeft/zoneRight` from cutout ± margins; `centerAllowed = (W−sinkW)/2 ≥ max(margins) − 0.001` | `sink.ts : sinkGeometry` | `sink.test` (74 total) | **CRITICAL** | `CONFIRMED` |
| F-SK-06 | Section building | partitions divide the carcass → intersect with the mounting zone → remainders `< 100 mm` → comms zone | `sink.ts : buildSections` (internal) | `sink.test` (`sinkLayout geometry`, acceptance configs) | **CRITICAL** | `CONFIRMED` |
| F-SK-07 | Facade boxes | section with fill → its own panel; remainder → base doors split on the structural partition axis; bottle → narrow edge panel | `sink.ts : computeFacadeBoxes`, `distributeDoors`, `applyBottleCut`, `resolvePartitionBox`, `partitionBoxForSide` | `sink.test` (bottle rack suite, 9 cases) | **CRITICAL** | `CONFIRMED` |
| F-SK-08 | Partition counting / conflicts | `sinkPartitionCount` (auto + structural), `autoPartitionSides`, `sinkPartitionConflicts` (partition crossing the sink zone → error/warning), `isBottleEdgeSection`, `sectionOuterWidth`, `sectionFitsDrawers` | `sink.ts` | `sink.test` (partition suite, `partition conflicts`) | HIGH | `CONFIRMED`; `autoPartitionSides`, `sinkPartitionAvailable`, `sinkThreeDoorAvailable`, `isBottleEdgeSection` are **not named in any test** (reached indirectly) |
| F-SK-09 | Layout | `sinkLayout(module, gaps, rowContext, rules)` → `{sections, facadeBoxes}`; drives price (F-PR-08/11/16), 2D, validation, supports | `sink.ts : sinkLayout` | `sink.test` (74) | **CRITICAL** | `CONFIRMED` |
| F-SK-10 | Facade totals | `sinkFacadeTotals(module, row, rules)` → `{doors, fronts, bottle, panels}` used by F-PR-09 and by the facade area | `sink.ts : sinkFacadeTotals` | indirect (`pricing.test`, `golden.test`) | **CRITICAL** | `CONFIRMED`; **not named in any test** |
| F-SK-11 | Normalization | `normalizeSinkModule` clamps dimensions, snaps to standard, drops legacy `sinkPartition`, trims `sinkStorage` to the number of free sections, zeroes blocked fills; `normalizeSinkStorage`, `resolveDrawerCount` (1 drawer never valid; step 3→2→0; snap up to minimum 2) | `sink.ts` | `sink.test` (normalize suite) | HIGH | `CONFIRMED` |
| F-SK-12 | Drawer count resolution | `resolveDrawerCount(current, requested)` — see above | `sink.ts : resolveDrawerCount` | `sink.test` (2 cases) | MEDIUM | `CONFIRMED` |

### 3.6 Supports & lighting (`F-SL-*`)

| ID | Name | Formula as implemented | File : function | Tests | Criticality | Evidence |
|---|---|---|---|---|---|---|
| F-SL-01 | Support positions | `edgeInset = clamp(round(system.edgeInsetCm), 1, floor(width/4))`; `loadPerModule = MODULE_LOAD_KG[type] × width / REF_WIDTH[type]`; `innerWidth = max(0, width − 2×edgeInset)`; `spanCount = max(2, ceil(innerWidth/maxSpan)+1)`; `loadCount = max(2, ceil(loadPerModule / max(1, maxLoad×2)))`; `tallRule = tall ? (width ≥ tallCenterLegWidth ? 3 : 2) : 2`; `target = max(span, load, tall)`; `maxBySpacing = floor(innerWidth/MIN_LEG_SPACING) + (innerWidth>0 ? 1 : 0)`; `count = clamp(target, 2, max(2, maxBySpacing))`; edge + evenly spaced interior positions + tall centre + positions under sink partitions; merged when `\|Δx\| ≤ MERGE_TOLERANCE` | `supports.ts : positionsForModule` | `supports.test` (7) | HIGH | `CONFIRMED`; **upper clamp (`maxBySpacing`) untested** (mutation M17 survived) |
| F-SL-02 | Support counts | excluded when `zone !== "floor"` or `module.ownSupports === true`; `front = back = positions.length`, `legs = 2×positions`; `clips = plinth && mount==="clips" ? front×clipsPerLeg : 0`; `screws = plinth && mount==="hidden" ? front×screwsPerLeg : 0`; `anchors = tall ? max(1, ceil(height/tallAnchorSpacing)) : 0` | `supports.ts : supportsForModule` | `supports.test` (4 cases) | HIGH | `CONFIRMED` |
| F-SL-03 | Support plan | sums module plans, resolves system + leg/clip/screw/anchor prices → `cost` and `costParts` | `supports.ts : computeSupports` | `supports.test`, `golden.test` | HIGH | `CONFIRMED`; `source: "preliminary"` |
| F-SL-04 | Lighting length | per upper module: `start = x0+endMargin`, `end = x1−endMargin`; skip if `end−start ≤ 0.5`; subtract overlap with tall-module blockers; `/100` → m; `lengthM = round(Σ,3)` | `lighting.ts : availableLength` (legacy) / `engine.ts` inline | `lighting.test` (2 cases) | HIGH | `CONFIRMED` |
| F-SL-05 | Lighting runs | greedy fill of each segment into `maxContinuousRunM` buckets → `runs`; `endCaps = active×2`; `connectors = (active>0 ? max(0,active−1) + runs : 0)` | `lighting.ts : countRuns` / `engine.ts` inline | `lighting.test` (`splits runs…`) on the **legacy** path only | MEDIUM | `CONFIRMED`; **Engine copy untested** (mutation M18 survived) |
| F-SL-06 | PSU selection | `requiredW = round(powerW × psuMargin,1)`; choose smallest rating ≥ `requiredW`, else largest; `psuCount = ceil(requiredW/maxPsuW)` when exceeded. `psuMarginLow` is computed and discarded (`void low`) | `lighting.ts` / `engine.ts : lightingPlanned` | `lighting.test` (`computes power, psu with 20–25% reserve`) | MEDIUM | `CONFIRMED`; `LED_PSU_MARGIN_LOW` is a **dead constant** (audit U-7) |

### 3.7 Normalization & validation (`F-VD-*`)

| ID | Name | Rule summary | File : function | Tests | Criticality | Evidence |
|---|---|---|---|---|---|---|
| F-VD-01 | Kitchen validation | ranges from `KITCHEN_MODULES` (depth 40–58 cm, tall 55–60), heights 700–850 mm, plinth 100–150 mm (schema), `KITCHEN_LIMITS` (max 25 modules), row height consistency, one sink/hob/tall-appliance, handle↔facade compatibility, push-to-open ↔ protruding handle, sink rules (step, range, position, offset, facade count 2/3, partition conflicts, bottle placement), legacy material availability → `ValidationIssue[]` | `validation.ts : validateKitchen` | `validation.test` (18 tests / 27 assertions against **66** issue sites) | **CRITICAL** | `CONFIRMED` — but rule coverage is **partial** (see TEST_COVERAGE_AUDIT §5) |
| F-VD-02 | Wardrobe validation | `WARDROBE_LIMITS` (max sections), fullDepth > 0, section width ≥ 300 mm, shelf positions inside carcass, drawers only ≥ 50 cm, rod heights, plinth/LED/antresol ranges, partition position, handle/hinge rules | `validation.ts : validateWardrobe` | `validation.test` (part of the same 18) | **CRITICAL** | `CONFIRMED` — partial coverage |
| F-VD-03 | Config dispatch | `validateConfig` → kitchen/wardrobe validator by `kind`; `getFurnitureErrors`, `isConfigValid` helpers | `validation.ts : validateConfig` | `validation.test` (`runs the correct validator for each kind`) | HIGH | `CONFIRMED` |
| F-VD-04 | Kitchen normalization | `normalizeKitchenDepth` → `normalizePlinthOptions` → `normalizeLighting` → `normalizeSupportSettings` → `snapCountertopThickness` → `normalizeSinkModule` per module; documented as idempotent | `defaults.ts : normalizeKitchen` | `migration.test`, `facade-depth.test`, `validation.test` | HIGH | `CONFIRMED`; **`normalizeKitchenDepth`, `normalizeKitchenFacadeDepth`, `normalizePlinthOptions`, `normalizeLighting`, `normalizeSupportSettings`, `nextShelfPosition` are not named in any test** |
| F-VD-05 | Facade depth normalization | `normalizeKitchenFacadeDepth` / `withKitchenFacadeThickness` pick the nearest approved thickness and clamp the body depth to the dynamic maximum | `defaults.ts` | `facade-depth.test` (3 cases) | HIGH | `CONFIRMED` |
| F-VD-06 | Next shelf position | `nextShelfPosition` — proposed height for a new wardrobe shelf | `defaults.ts : nextShelfPosition` | **none** | LOW | not referenced by any test |
| F-VD-07 | Schema parse | Zod strict objects for kitchen/wardrobe/customer/lead/project/price lines/breakdown; `safeParseConfig` | `schema.ts` | `migration.test`, `geometry-ranges.test`, API route tests | HIGH | `CONFIRMED` |

### 3.8 Calculation input contract (`F-CT-*`)

| ID | Name | Rule summary | File : function | Tests | Criticality | Evidence |
|---|---|---|---|---|---|---|
| F-CT-01 | Price snapshot validation | exact key sets, `snapshot` entries unique by `priceItemId`, finite amounts, `signedAdjustments` unique by key, `rules.rounding > 0` and finite, `rules` must contain exactly the approved key set | `contract.ts : validatePriceSnapshot` | `contract.test` (8) | **CRITICAL** | `CONFIRMED` |
| F-CT-02 | CatalogItem validation | exact keys, `priceRefs` roles present, attrs typed per catalog kind | `contract.ts : validateCatalogItemInput` | `contract.test` | HIGH | `CONFIRMED` |
| F-CT-03 | ModulePreset validation | dimension ranges, `priceRef` presence, zone | `contract.ts : validateModulePresetInput` | `contract.test` | HIGH | `CONFIRMED` |
| F-CT-04 | CalculationInputs validation | composition of F-CT-01…03 + `versions` check (`calcVersion`/`schemaVersion`), parameter registry keys | `contract.ts : validateCalculationInputs` | `contract.test`, API `calculation-inputs` tests | **CRITICAL** | `CONFIRMED` |
| F-CT-05 | CalculationRequest validation | config + inputs together | `contract.ts : validateCalculationRequest` | `contract.test` | HIGH | `CONFIRMED` |
| F-CT-06 | Engine input guards | duplicate `PriceItem` → throw; missing `PriceItem`/`CatalogItem`/`ModulePreset`/role/signed adjustment → throw; non-finite `rules.rounding` → throw | `engine.ts : snapshotMap, price, catalog, priceRef, preset, signed, rules` | `golden-engine.test`, `engine-purity.test` | **CRITICAL** | `CONFIRMED` (positive paths only — **no test asserts that a missing PriceItem actually throws**) |

### 3.9 Display (`F-DM-*`)

| ID | Name | Rule | File : function | Tests | Criticality |
|---|---|---|---|---|---|
| F-DM-01 | Breakdown → PriceBreakdown | pure rendering from `CalculationBreakdown` + `DisplayMetadata`; throws on unknown line id, missing field, bad format | `display-adapter.ts : toPriceBreakdown` | `golden-engine.test` (full equality, 8 scenarios) | MEDIUM |
| F-DM-02 | Detail segments | `literal / number / numberWithUnit / catalogLabel / booleanLabel / conditional` with strict format whitelist | `display-adapter.ts` (internal) | `golden-engine.test` (indirect) | LOW |
| F-DM-03 | Formatting | `formatRub` (ru-RU), `formatRange` (±10 % band) | `display.ts` | `pricing.test` (separator only) | LOW |
| F-DM-04 | Display metadata fingerprint | `computeDisplayMetadataFingerprint` over line definitions | `lib/admin/display-metadata.ts` | `display-metadata.test` | LOW |

---

## 4. Dead and unused commercial rules (verified in this block)

| Rule | Status | Evidence |
|---|---|---|
| `PRICING.kitchen.countertopDepthAllowance = 0.04` | **NOT USED** — never read by any calculation | `dependency-map.ts` row `NOT_USED`; confirmed by search: no read outside `content/pricing.ts` |
| `PRICING.kitchen.underCabinetLightPerMeter = 1900` | **NOT USED** — replaced by the component lighting specification | same |
| `PRICING.kitchen.sinkPartition = 2400` | **NOT USED** — sink partitions are free | same |
| `PRICING.kitchen.plinthPerMeter = 1600` | **NOT USED** for the kitchen (kitchen uses `content/plinth.ts`) | `CALCULATOR_TECHNICAL_AUDIT` §4 №8 |
| `PRICING.wardrobe.bodyFactor = 1.15` | **carried but not applied** — it flows into `PricingVersion.rules` and is contract-validated, but `calculateWardrobePrice`/`calculateWardrobeBreakdown` compute `bodyCost = area × rate` with no factor; explicitly asserted by `wardrobe-geometry.test` ("не использует bodyFactor") | `pricing.ts:569`, `engine.ts:917`, `wardrobe-geometry.test:98` |
| `LED_PSU_MARGIN_LOW` / `psuMarginLow` | computed and discarded (`void low`) | `engine.ts:605–606`, audit U-7 |
| `formatRange` ±10 % band | implemented, never asserted numerically | `display.ts` |

Changing any of the first five values in `content/pricing.ts` would produce **no change in any calculated result**.

---

## 5. Items marked `REQUIRES_DOMAIN_CONFIRMATION`

These are arithmetic-verified but business-rule-unapproved. They are carried over from `docs/CALCULATION_ADMIN/CALCULATION_CORRECTNESS_AUDIT.md` §11/§12 and re-confirmed against the current code in this block:

| ID | Rule | Where |
|---|---|---|
| U-1 | Golden K1/K2 expected values originate from an Engine snapshot, not from an independent financial source | `golden.expected.ts`, `baseline.test.ts` |
| U-2 | Countertop width excludes a standalone `bottle` module (suspected −0.2 м per bottle module) | F-PR-12/F-PR-33 |
| U-3 | Wardrobe carcass consumption: `parts` model does not charge for the back panel, and the `top`/`bottom` width asymmetry is unasserted | F-GW-04 |
| U-4 | Kitchen body consumption is front-area × depth factor, not panel m² | F-PR-07 |
| U-5 | Complexity factor multiplies pass-through items (supports, plinth, LED, base cost) | F-PR-17 |
| U-6 | Promo `minSubtotal` is evaluated **after** min-order uplift | F-PR-18/F-PR-19 |
| U-7 | `psuMarginLow` dead constant | F-SL-06 |
| U-8 | Wardrobe hinge densities and bands are preliminary (no hinge manufacturer chosen) | F-GW-09/F-GW-10 |
| U-9 | Support system loads are `preliminary` (engineering not approved) | F-SL-01…03 |
| U-10 | Antresol divider thickness assumed = 16 mm | F-GW-05 |

---

## 6. Statistics

| Metric | Count |
|---|---:|
| Catalog rows (formulas/algorithms documented) | **103** |
| of which commercial (`F-PR-*`) | 34 |
| of which unit conversion / rounding (`F-CV-*`) | 11 |
| of which kitchen geometry (`F-GK-*`) | 10 |
| of which wardrobe geometry (`F-GW-*`) | 13 |
| of which sink layout (`F-SK-*`) | 12 |
| of which supports / lighting (`F-SL-*`) | 6 |
| of which validation / normalization (`F-VD-*`) | 7 |
| of which contract (`F-CT-*`) | 6 |
| of which display (`F-DM-*`) | 4 |
| Marked `REQUIRES_DOMAIN_CONFIRMATION` | 10 |
| Dead / unused commercial rules found | 7 |

---

## 7. Test closure addendum — Stage 9 / Block 3 (2026-09-12)

| Entry | New evidence |
|---|---|
| F-PR-17 Complexity factor | Engine path now covered: 6/9/10/25-module scenarios assert `complexityFactor` (1.06 / 1.12 / capped) **and** the exact `subtotal`/`total` recomputed from published rules; the cap is proven to change the money (mutation M3 class closed). `engine-rule-gaps.test.ts` |
| F-PR-19 Promo eligibility | `minSubtotal` gate covered on the Engine path: below the published 120 000 ₽, exactly at the threshold (strict `<` → eligible) and ±100 ₽ around it; `valid`, `discount`, `total`, `reason` asserted (mutation M12 class closed) |
| F-PR-20 Promo discount | Percent + cap recomputed independently in the boundary tests |
| F-SL-01/02 Support positions/counts | Engine copy `supportPlanned` verified against the documented formula (base 60 → 4 legs; tall 60/220 → 6 legs + 2 anchors; clips 5); `maxBySpacing` clamp pinned parametrically (published `minLegSpacingCm = 8` never binds → hypothetical 60 clamps 3 → 2 positions) |
| F-SL-04/05/06 Lighting length/runs/PSU (Engine copy) | Short row 1.68 m (1 run, 6 end caps, 3 connectors, PSU 30 Вт) and long row 8.12 m > 7.5 m (2 runs, 8 connectors, PSU 100 Вт) with component amounts recomputed from snapshot tariffs (mutation M18 class closed) |
| F-CT-06 Engine input guards | Negative tests for missing/duplicate `PriceItem`, missing role, duplicate `signedAdjustment`, invalid `rules.rounding` |
| F-VD-01 Kitchen validation | 14 substantial rules assert their issue **exactly once** (`validation-rule-gaps.test.ts`); systematic rule↔test mapping still incomplete for the remaining sites |
| LED rules R1–R7 (owner, DOMAIN_CONFIRMED) | `led-domain.test.ts`: engine + UI layers tested separately; R1/R2/R6 violated by production → `it.fails`; D1 status changed to `DOMAIN_CONFIRMED` |

---

## 8. Defect fixes addendum — Stage 9 / Block 4 (2026-09-12)

| Entry | Change in Block 4 | Tests |
|---|---|---|
| F-PR-12 / F-PR-33 Countertop width | **Rule DOMAIN_CONFIRMED and implemented.** `kitchenCountertopWidth` (`pricing.ts`) and the inline sum in `engine.ts` now include standalone floor modules `type === "bottle"` (наружные габариты 150/200/300 мм). The built-in mechanism (`sinkStorage[].bottle`) adds **no** width — the host module is already counted. Structural discrimination only: module type vs. sink-section fill; no new fields. | `countertop-bottle.test.ts` (14): scenarios А/Б, all three standard sizes, no double count, legacy↔Engine parity, «длина × тариф» arithmetic |
| F-PR-28 / F-SL-05…06 Lighting (Engine copy) | **D1 fixed.** `lightingPlanned` returns a fully zeroed kit when `lengthM = 0` (`psuAmount`, `controlAmount`, `psuW`, `psuCount`, end caps, connectors, all length-proportional items). | `led-domain.test.ts` R2 (was `it.fails`) |
| F-VD-04 Kitchen normalization | **R6 implemented.** `normalizeKitchen` forces `underCabinetLighting = false` when the config has no upper-zone module. Idempotent; stale stored projects self-heal on load, and even a stale `true` cannot produce a charge (R2). | `led-domain.test.ts` R6, R7 (new) |
| UI: подсветка верхнего ряда | **R1 implemented** in `SharedPanels.tsx`: switch `disabled` without upper modules, hint «Чтобы включить подсветку, добавьте верхние модули.», LED controls (power button / chip groups) are not rendered while unavailable. | `led-domain.test.ts` R1 (was `it.fails`), R3/R7 |
| Legacy rate lookup (`bodyRate` / `facadeRate` / `styleMultiplier` / `handleRate`) | **A16-4 contract.** Unknown id → controlled error `Legacy pricing: неизвестный …` instead of silent `0` / `1`. Four cases separated: (1) explicit free option `handle: "none"` = catalogue entry with `rate: 0`; (2) missing optional parameter — not these helpers (schema defaults); (3) unknown id — forbidden by `schema.ts` `z.enum` and `safeParseConfig`; (4) **Q-A17-2.3 CLOSED (Block 7A.2)**: a facade material with **no active tariff** (historical `veneer`/`glass`/`solid`, no `ratePerSqm` in the content source) → controlled error `Legacy pricing: нет действующего тарифа для facadeMaterial "…"` — **no silent 0 ₽, no automatic historical tariff, facades are not skipped**; their tariffs **11 800 / 14 400 / 18 600 ₽/м²** are confirmed **as historical only** (not for new projects, not for automatic recalculation), old projects are read-only and recalculation is forbidden — `OWNER_DECISIONS_STAGE9_BLOCK5.md` §1.6. | `validation-rule-gaps.test.ts` TG-H4 (9 tests), `legacy-facade-guard.test.ts` (read-path independence) |

**A18-1 (Block 7A):** тот же барьер закрыт и для расчётов — см. §9 (единый контракт + перечень защищённых входных точек).

**Verification of interactions (§3 task 8):** no separate «готовая / изготавливаемая столешница» rule exists — the only countertop rule is `countertopWidth × ratePerLinearMeter` on both paths, and the fix applies to it uniformly. `KITCHEN_LIMITS.minCountertopMeters = 0.8` is declared but **not read** anywhere (`dependency-map.ts`: `NOT_USED`), therefore it does not clip the new width; it was left untouched (out of scope). **OWNER CONFIRMED (Block 6):** the 0.8 m minimum **is not applied**, must **not** be introduced as a minimum chargeable length in the approximate calculator, and the unused parameter must **not** be removed without separate approval — `OWNER_DECISIONS_STAGE9_BLOCK5.md` §3.8.

**Recorded golden-expected deltas (business-rule change, verified arithmetically):**

| Scenario | Field | Before | After | Independent check |
|---|---|---|---|---|
| `kitchen-promo-complexity` | options line / `optionsCost` | 70 261 ₽, «2.4 м столешницы» | 72 161 ₽, «2.6 м» | +0.2 м × 9 500 ₽/м = **+1 900 ₽** exactly |
| `kitchen-promo-complexity` | `subtotal` / `total` | 313 300 / 283 300 | 315 400 / 285 400 | +1 900 × 1.12 = 2 128 ₽ → rounding step 100 ₽; discount stayed at the 30 000 ₽ cap |
| `kitchen-min-order` | options line / `optionsCost` | 1 680 ₽, «0.0 м столешницы» | 4 530 ₽, «0.3 м» | +0.3 м × 9 500 ₽/м = **+2 850 ₽** exactly; `subtotal`/`total` unchanged (min order floor) |

---

## 9. A18-1 — barrier contract for historical facade materials (Stage 9 / Block 7A)

**Business rule (owner):** `veneer` / `glass` / `solid` are **forbidden for new calculations**. Their historical tariffs (11 800 / 14 400 / 18 600 ₽/м²) are reference-only: they must not reach a new calculation and the material must never be substituted automatically. Old projects stay readable, keep their historical `PriceSnapshot`, and can be neither saved nor recalculated.

**Single contract:** `src/lib/configurator/materials.ts`
- `LEGACY_FACADE_BLOCK_MESSAGE` — the one message used by every server-side refusal;
- `legacyFacadeBlockIssue(path?)` — `{ path, message, severity: "error" }` for validation-shaped consumers (leads).

Error **codes** stay per layer (they are existing API contracts and were not changed): `ENGINE_CONTRACT_LEGACY_FACADE_MATERIAL` (calculation inputs), `CONFIG_INVALID` (save), `LEGACY_FACADE_MATERIAL` (recalculate / apply history).

**Why the guard lives in `resolveCalculationInputs` and not in `validateConfig`:** `getProject` (`projects.ts:843`) runs `validateConfig` to decide whether a stored project is readable. Raising the legacy issue from `warning` to `error` would mark every historical project `unsupported` and **block viewing** — explicitly forbidden. `validation.ts` therefore keeps `warning`.

**Protected entry points (all refuse before any price is computed):**

| # | Входная точка | Механизм отказа |
|---|---|---|
| 1 | `POST /api/calculation-inputs` — `create` / `preview` / `recalculate` | `data-resolver.ts` guard для **всех** операций (новая ветка для create/preview) |
| 2 | `POST /api/projects` → `saveProject` | `projects.ts` guard (`CONFIG_INVALID`, 422) + guard резолвера |
| 3 | `POST /api/projects/[id]/recalculate` → `recalculateProject` | `projects.ts` guard (`LEGACY_FACADE_MATERIAL`, 422) |
| 4 | `POST /api/admin/projects/[id]/recalculate` → `recalculateProject` | то же |
| 5 | Worker пересчёта (`admin/worker.ts:438`) → `recalculateProject` | то же |
| 6 | `POST /api/leads` → `createLead` | `leads.ts` guard → `{ok:false}` до расчёта, HTTP 422 |
| 7 | `applyProjectPriceHistory` (альтернативное сохранение результата) | два guard-а (`LEGACY_FACADE_MATERIAL`, 422) |
| 8 | `calculatePriceFromInputs` — последний шлюз перед Engine (прямой вызов сервиса с вручную собраным `CalculationRequest`) | guard в начале функции → `{ok:false}` (`ENGINE_CONTRACT_LEGACY_FACADE_MATERIAL`) |

**Not changed:** `validation.ts` (warning kept for read paths), historical tariffs, historical records, UI, storage schema, `golden.expected.ts`.

**Tests:** `src/lib/server/legacy-facade-guard.test.ts` — 18 tests covering the ten acceptance points (create ×3, preview ×3, API 422, leads ×3 + API 422, allowed materials still calculate, all bypass routes, old-project read, snapshot unchanged, save/recalculate forbidden).

---

## 10. Commercial rules verification addendum — Stage 9 / Block 7 (2026-09-12)

| Entry | Result | Tests |
|---|---|---|
| **F-PR-19 Promo eligibility** | **CLOSED** — все 5 ворот на runtime Engine-пути: неизвестный код, неактивный, чужая категория (кухня + `WARDROBE7`), `subtotal < minSubtotal`, ровно на пороге (строгое «<» → скидка применяется). Каждый случай: `discount = 0`/ненулевой + точный `reason` + `total = subtotal`/`subtotal − discount` | `promo-rules-matrix.test.ts` (11) |
| **F-PR-20 Promo discount** | **CLOSED** — percent (10 %), **fixed (`DEMO5000`, ветка не выполнялась ранее)**, cap 30 000 ₽ (сравнение с uncapped 31 500), скидка > суммы заказа → `total = 0` (не отрицательный), округление до 100 ₽, последовательность `minOrder → ворота → скидка → округление` (raw 39 359 → subtotal 45 000 → скидка от 45 000) | то же |
| **§4 Dead commercial rules (TG-M7)** | **CLOSED для runtime Engine**: `wardrobe.bodyFactor`, `kitchen.countertopDepthAllowance`, `kitchen.underCabinetLightPerMeter`, `kitchen.sinkPartition`, `kitchen.plinthPerMeter` — ни один идентификатор отсутствует в `engine.ts`; 4 kitchen-поля не попадают ни в `snapshot`, ни в `rules`; мутация значений не меняет breakdown; контроль чувствительности (мутация живого PriceItem) меняет результат → тест не «пустой». `bodyFactor` присутствует в `rules` (контракт F-CT-01), но Engine его не читает | `dead-commercial-rules.test.ts` (17) |
| **F-PR-02 Wardrobe price** | **Независимо подтверждён**: `complexityFactor = 1`; компоненты двух независимых реализаций (Engine ↔ legacy) совпадают; ручная цепочка `Σ → round100 → max(minOrder)` → промо → итог | `wardrobe-golden-verification.test.ts` (6) |

**Clarification (не расхождение):** `PRICING.wardrobe.plinthPerMeter` — **отдельный живой** тариф (legacy `pricing.ts:674` и `PriceItem "wardrobe.plinthPerMeter"`, который Engine читает). Мёртвым по §4 является именно `PRICING.kitchen.plinthPerMeter`; тесты проверяют полный путь `kitchen.plinthPerMeter`, чтобы не спутать их.

**Manual wardrobe calculations (independent of `golden.expected.ts`):**

| Сценарий | Σ компонентов | subtotal (round100) | Промо | discount | total |
|---|---:|---:|---|---:|---:|
| `wardrobe-default` | 9 000 + 36 158 + 33 533 + 29 050 + 20 546 = **128 287** | **128 300** | нет | 0 | **128 300** |
| `wardrobe-custom-promo` | 9 000 + 41 695 + 56 926 + 28 850 + 17 983 = **154 454** | **154 500** | WARDROBE7: 7 % ≥ 70 000 → 10 815 ≤ cap 18 000 | round100(10 815) = **10 800** | **143 700** |

Published tariffs used: `rounding 100`, `minOrder 45 000`, `wardrobe.baseCost 9 000`, `ldsp 5 600 ₽/м²` и `mdf_pvc 8 400 ₽/м²`, `handleless ×1.08`, `handle "none" 0 ₽`, `WARDROBE7` = 7 % / 70 000 / 18 000. **Расхождений с golden не обнаружено** (`golden.expected.ts` не изменялся).
