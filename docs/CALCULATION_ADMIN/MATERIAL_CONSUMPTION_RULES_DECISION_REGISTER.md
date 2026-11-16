# MATERIAL CONSUMPTION RULES — DECISION REGISTER

**Date:** 2026-11-10  
**Purpose:** consolidate what is actually documented about material consumption for kitchen and wardrobe, separate confirmed rules from implementation-only behaviour, and prepare a compact owner decision register.  
**Status:** research/documentation only. No code, prices, formulas, golden fixtures, production DB, or user projects were changed.

---

## 1. Purpose and method

This register is based on:

- `docs/CALCULATION_ADMIN/CALCULATION_CORRECTNESS_AUDIT.md`;
- `docs/CALCULATION_ADMIN/MATERIAL_CONSUMPTION_AUDIT.md`;
- `CALCULATION_ADMIN_TECHNICAL_SPECIFICATION.md`;
- `CALCULATION_ADMIN_DATA_AND_VERSIONING_DESIGN.md`;
- ADR-06 Rev11;
- `CALCULATOR_TECHNICAL_AUDIT.md`;
- current catalogs/types and the two calculation paths (`pricing.ts` and `engine.ts`).

**Important:** an implemented formula is treated only as a **CONFIRMED IMPLEMENTATION FACT**, not as proof of a business/material rule. A business rule is `CONFIRMED` only when a document or approved source states it.

### Classification summary for the seven decision questions

| Category | Count |
|---|---:|
| CONFIRMED | 0 |
| PARTIALLY CONFIRMED | 3 |
| NOT DOCUMENTED | 1 |
| CONFLICT | 3 |

Supporting rules that **are** confirmed are listed in §2; the counts above refer only to the seven unresolved decision questions in §10.

---

## 2. Approved/confirmed rules found

| Rule | Source | Confidence |
|---|---|---|
| `bodyFactor = 1.15` is a **commercial rule**, not a physical panel-consumption coefficient | Design §8.7; TZ §6.3/Commercial rules; `content/pricing.ts` | CONFIRMED |
| `bodyDepthReference = 60` cm is a commercial reference depth | Design §8.7; TZ; `content/pricing.ts` | CONFIRMED |
| Countertop price is `ratePerLinearMeter` (per linear metre) | TZ catalog; design §8.7; `content/catalog.ts` | CONFIRMED |
| `basePrice` of module presets is a commercial `PriceItem`, included in `PricingVersion` | Design §6.3/§8.7; TZ §3.2; ADR-06 | CONFIRMED |
| Module geometry ranges/defaults are Reference Data, not price rules | Design §6.3; TZ §3.2 | CONFIRMED |
| Shelf/rod/drawer/sink-support/lighting elements have per-piece or per-metre prices | `content/pricing.ts`, `content/catalog.ts`, `content/supports.ts`, `content/lighting.ts` | CONFIRMED as prices; material inclusion is **not** confirmed |
| `countertopDepthAllowance` is defined but unused | Design OI-008/Q10; TZ §3.2 dead-field note; `dependency-map.ts` | CONFIRMED implementation fact |
| `sinkPartition` price exists but is not charged | Design OI-011/032/Q12; TZ dead-field note; `pricing.ts` comment | CONFLICT (price exists vs free partitions) |

---

## 3. Kitchen body — current behaviour and sources

### Current behaviour (CONFIRMED IMPLEMENTATION FACT)

`bodyCost += preset.basePrice + area(widthCm,heightCm) × bodyRate × max(0.5, depth/60)`.

Files: `src/lib/configurator/pricing.ts:198`, `src/lib/configurator/engine.ts:627`.

- Width/height are front dimensions, not panel dimensions.
- Depth scales the material part linearly relative to 60 cm, with a floor of 0.5.
- Internal sides, bottom, top, back panel, shelves, and partitions are not listed as m².
- `preset.basePrice` is added per module on top of the material part.

Default kitchen K1 material part: body cost 89 474 ₽, module base prices 63 300 ₽, material portion 26 174 ₽ = **3.444 m²** at MDF 7 600 ₽/m² (depth-adjusted front area), while geometric front area is 3.804 m².

### Sources

- Design §6.3 (`ModulePreset`: geometry/defaults/`basePrice`), §8.7 (commercial rules).
- TZ §3.2 (`basePrice` — “Базовая цена корпуса пресета”).
- `KITCHEN_MODULES` in `src/content/catalog.ts`.
- `pricing.ts` / `engine.ts` formulas.

### Classification

**PARTIALLY CONFIRMED** — the formula and prices are documented; the physical carcass composition (which panels, thickness, back, waste) is **not documented**.

### Unknown

- Panel list and thickness for base/sink/hob/drawers/wall/tall/oven/bottle.
- Back panel material and thickness.
- Shelf/partition material area.
- Waste/cutting coefficient.
- Whether `basePrice` already includes any material.

---

## 4. Wardrobe body — current behaviour and sources

### Current behaviour (CONFIRMED IMPLEMENTATION FACT)

`bodyCost = area(totalWidth, height) × bodyRate × (depth/60) × 1.15`.

Files: `pricing.ts:470`, `engine.ts:801`.

- Section count does not enter body cost.
- `1.15` is a commercial `bodyFactor`, not a panel factor.
- Inner vertical dividers, shelves, back panel, edge banding, and waste are not listed.

Default wardrobe: front area 5.76 m², body cost 60 941 ₽, implied material area 6.624 m² (5.76 × 1.15) at plywood 9 200 ₽/m².

### Sources

- Design §8.7 (bodyFactor commercial rule).
- TZ §6.3/commercial rules.
- `WardrobeConfig`/`WardrobeSection` in `src/lib/configurator/types.ts`.
- `pricing.ts` / `engine.ts`.

### Classification

**PARTIALLY CONFIRMED** — the commercial formula is documented; physical carcass composition is **not documented**.

### Unknown

- Panel list for sides, top/bottom, back, dividers.
- Whether a new section requires a full-height divider.
- Material thickness and waste.

---

## 5. Base module cost (`basePrice`) — current behaviour and sources

### Current behaviour (CONFIRMED IMPLEMENTATION FACT)

- `preset.basePrice` is added per kitchen module in `bodyCost`.
- A separate body material area is also added.
- Wardrobe `baseCost` is 9 000 ₽, independent of sections/material area.
- `basePrice` is stored as `PriceItem` and resolved through `priceSnapshot`.

### Sources

- Design §6.3 (`ModulePreset.priceRef` → `basePrice`), §8.7 (included in snapshot).
- TZ §3.2: “Базовая цена корпуса пресета” (5 000–15 800 ₽).
- ADR-06: `basePrice` is migrated to `PriceItem`; Engine receives it only through snapshot.

### Classification

**CONFLICT** — the TZ calls it “базовая цена корпуса”, while the implementation charges a separate body-material area on top. No source states whether “корпус” includes material, construction/processing only, or assembly only.

### Financial exposure if `basePrice` includes material

| Scenario | Current material charge | Potential overcharge if already inside basePrice |
|---|---:|---:|
| Kitchen K1 | 26 174 ₽ material portion | up to 26 174 ₽ |
| Wardrobe default | 60 941 ₽ body cost (includes 1.15) | up to 60 941 ₽ (or 52 992 ₽ raw × 1.15) |

These are **conditional exposures**, not confirmed defects.

---

## 6. Countertops — current behaviour and sources

### Current behaviour (CONFIRMED IMPLEMENTATION FACT)

- `countertopWidth = Σ width of base|sink|hob|drawers modules / 100`.
- Cost = `countertopWidth × ratePerLinearMeter`.
- `tall` and `oven` are excluded (full-height cabinets).
- `bottle` is **also excluded**.
- `countertopDepthAllowance = 0.04` is defined but never read.
- Depth/thickness do not change the price today.

### Sources

- `COUNTERTOPS.ratePerLinearMeter` in `content/catalog.ts`.
- Design §8.7; OI-008/Q10: thickness and depth tariffication not designed.
- TZ §3.2 dead-field note: `countertopDepthAllowance` unused.
- `KitchenPanel` treats `bottle` as a floor-row module; supports/plinth include it.

### Classification

- **PARTIALLY CONFIRMED** for the linear-rate basis (confirmed) vs depth inclusion (not documented).
- **CONFLICT** for bottle coverage: one part of the implementation treats bottle as a floor module, while `kitchenCountertopWidth` excludes it; no document resolves this.

### Financial impact

Bottle width omission, if coverage is required:

| Bottle width | LDSP+HPL 9 500 ₽/m | Acrylic 16 800 | Quartz 22 400 | Porcelain/solid 29 400 |
|---:|---:|---:|---:|---:|
| 15 cm | 1 425 ₽ | 2 520 ₽ | 3 360 ₽ | 4 410 ₽ |
| 20 cm | 1 900 ₽ | 3 360 ₽ | 4 480 ₽ | 5 880 ₽ |
| 30 cm | 2 850 ₽ | 5 040 ₽ | 6 720 ₽ | 8 820 ₽ |

Depth surcharge cannot be calculated: no approved rate for depth/thickness.

---

## 7. Sections and dividers — current behaviour and sources

### Current behaviour (CONFIRMED IMPLEMENTATION FACT)

- Wardrobe sections only contribute shelves, rods, drawers, and LED-per-section.
- Section count does not add body/divider material.
- 120 cm wardrobe as 1×120 vs 2×60 with same fill and LED off: body 30 470, fronts 36 703, fittings 25 150, options 6 620, total **107 900 ₽ in both**.
- Facade/fittings equality is correct for front area and 2 doors; the missing item is the divider panel.

### Sources

- `WardrobeSection` model (`types.ts`): width, shelves, rods, drawers only — no divider/panel field.
- `pricing.ts`/`engine.ts` wardrobe formulas.
- Audits: `MATERIAL_CONSUMPTION_AUDIT.md` §8.

### Classification

**NOT DOCUMENTED** — no production/construction rule states whether every boundary between sections requires a full-height divider, or which inner panels are included in `bodyFactor`.

### Financial impact

One full-height divider, 240×60 cm = **1.44 m²**:

| Body material | Rate | Raw panel |
|---|---:|---:|
| LDSP | 5 200 ₽/m² | 7 488 ₽ |
| MDF | 7 600 ₽/m² | 10 944 ₽ |
| Plywood | 9 200 ₽/m² | 13 248 ₽ |

With existing `bodyFactor 1.15`: 8 611 / 12 586 / 15 235 ₽. Edge banding/labor/waste excluded.

---

## 8. Shelves and internal filling — current behaviour and sources

### Current behaviour (CONFIRMED IMPLEMENTATION FACT)

- Kitchen shelves: per-piece `kitchen.shelf = 1 100 ₽`; sink section shelves also count per piece.
- Wardrobe shelves: per-piece 1 150 ₽; rods 2 400 ₽; drawers 6 200 ₽.
- Sink partitions are part of the sink layout/carcass and are not separately charged; `sinkPartition = 2 400 ₽` exists but is unused.
- Whether per-piece prices include material is not stated.

### Sources

- `content/pricing.ts` rates.
- `pricing.ts`/`engine.ts` shelf/rod/drawer charging.
- Design OI-011/OI-032/Q12: partition tariffication and dead fields are owner decisions.

### Classification

- Shelf/rod material inclusion: **NOT DOCUMENTED**.
- Sink partition: **CONFLICT** — a price exists but the implementation charges zero separately.

### Conditional financial illustration

If per-piece prices exclude material:

| Element | Approx. material area | LDSP | MDF | Plywood |
|---|---:|---:|---:|---:|
| Kitchen shelf 60×60 cm | 0.36 m² | 1 872 ₽ | 2 736 ₽ | 3 312 ₽ |
| Sink partition 90×60 cm | 0.54 m² | 2 808 ₽ | 4 104 ₽ | 4 968 ₽ |

Current kitchen shelf price is 1 100 ₽; wardrobe shelf 1 150 ₽. If material is not included, these prices under-recover material. If included, adding material would be double counting.

---

## 9. Financial consequences of options

| Decision | Option | Financial effect |
|---|---|---|
| K carcass model | keep front-area model | no change; unknown physical accuracy |
| K carcass model | panel-list model | requires cutting spec; cannot calculate |
| W carcass model | keep 1.15 | no change; unknown physical accuracy |
| W carcass model | add divider per section | +1.44 m²/dedivider: 7 488–13 248 ₽ raw; 8 611–15 235 ₽ with 1.15 |
| basePrice | material included | remove body material charge: kitchen up to 26 174 ₽; wardrobe up to 60 941 ₽ |
| basePrice | material excluded | keep current charge; no change |
| Countertop depth | linear rate includes depth | no change |
| Countertop depth | add depth surcharge | requires new rate; cannot calculate |
| Bottle coverage | include bottle | +1 425–8 820 ₽ per bottle |
| Bottle coverage | exclude bottle | no change; document exception |
| Shelves/partitions | prices include material | no change |
| Shelves/partitions | add material separately | shelf +1 872–3 312 ₽; partition +2 808–4 968 ₽ per item |

No prices or norms were invented; all amounts use current `content/*` rates and the scenarios above.

---

## 10. Owner decision register

Only questions without a documented answer are listed.

### D1. Kitchen carcass composition — PARTIALLY CONFIRMED

- **Current:** front area × body rate × depth factor + module basePrice.
- **Unknown:** panel list, thickness, back panel, internal shelves/partitions, waste.
- **Options:**
  - **A.** Keep the commercial front-area model; document it as an estimate.
  - **B.** Approve a panel-list model; requires production cutting data.
  - **C.** Hybrid: keep basePrice/front-area for outer carcass, add explicit internal panels.
- **Financial:** A = no change; B/C cannot be calculated without panel/thickness/waste data.

### D2. Wardrobe carcass and section dividers — PARTIALLY CONFIRMED / NOT DOCUMENTED

- **Current:** front area × body rate × depth × 1.15; no divider material.
- **Unknown:** whether each section boundary requires a full-height divider; whether 1.15 covers internal panels.
- **Options:**
  - **A.** Keep 1.15 as a commercial all-in factor; document it.
  - **B.** Add one full-height divider per added section (1.44 m²; 7 488–13 248 ₽ raw).
  - **C.** Approve a full panel model for sides/top/bottom/back/dividers/shelves.
- **Financial:** B is calculable per divider; C requires a production spec.

### D3. `basePrice` semantics — CONFLICT

- **Current:** module `basePrice` + separate body material area.
- **Unknown:** does “базовая цена корпуса” include material, construction/processing, or assembly?
- **Options:**
  - **A.** `basePrice` includes carcass material → remove the separate material charge (potential overcharge: kitchen 26 174 ₽, wardrobe 60 941 ₽ in the default scenarios).
  - **B.** `basePrice` excludes material → keep current model.
  - **C.** Split `basePrice` into explicit “construction/assembly” and “material” price items.
- **Financial:** A/B are material; C is neutral but requires new price structure and migration.

### D4. Countertop depth/area basis — PARTIALLY CONFIRMED

- **Current:** linear metre only; `countertopDepthAllowance` unused; thickness/depth do not change price.
- **Unknown:** does `ratePerLinearMeter` include standard depth? Is a surcharge needed for >60 cm or thick slabs?
- **Options:**
  - **A.** Confirm linear rate includes standard depth; remove/keep dead field as `unused`.
  - **B.** Add depth/thickness surcharge (new rule/price item).
  - **C.** Price countertops by area (width × depth) instead of linear metre.
- **Financial:** B/C cannot be calculated without a new approved rate.

### D5. Countertop coverage of bottle modules — CONFLICT

- **Current:** `bottle` is a floor module in the UI/layout and is included in supports/plinth, but excluded from countertop width.
- **Options:**
  - **A.** Include bottle width in countertop length: +1 425–8 820 ₽ per bottle.
  - **B.** Exclude bottle intentionally and document the exception.
  - **C.** Include only when the bottle module is configured under a countertop (requires a new explicit rule/field).
- **Financial:** A is calculable; B is no change; C requires rule + data.

### D6. Section divider requirement — NOT DOCUMENTED

- **Current:** 1×120 and 2×60 sections cost the same (same fill, LED off).
- **Options:**
  - **A.** No divider material is required (current).
  - **B.** One full-height divider per added section: +1.44 m² (7 488–13 248 ₽ raw; 8 611–15 235 ₽ with 1.15).
  - **C.** Divider + additional top/bottom/back detailing per construction spec.
- **Financial:** B is calculable; C requires spec.

### D7. Shelves/rods/sink partitions material inclusion — CONFLICT / NOT DOCUMENTED

- **Current:** per-piece prices only; `sinkPartition` price exists but is not charged.
- **Unknown:** do shelf/rod/drawer/partition prices include material?
- **Options:**
  - **A.** Prices include material; keep current model; mark `sinkPartition` unused.
  - **B.** Add material separately: shelf +1 872–3 312 ₽; sink partition +2 808–4 968 ₽ per item.
  - **C.** Mixed rule by element (shelves material included, partitions separate, etc.).
- **Financial:** A = no change; B is calculable per element; C requires a cost breakdown.

---

## 11. Sources and limitations

### Sources used

- `docs/CALCULATION_ADMIN/CALCULATION_ADMIN_TECHNICAL_SPECIFICATION.md` — §3.2 module presets/`basePrice`, commercial rules, dead fields.
- `docs/CALCULATION_ADMIN/CALCULATION_ADMIN_DATA_AND_VERSIONING_DESIGN.md` — §6.3 presets, §8.7 rules/snapshot, OI-008/OI-011/OI-032/Q10/Q12.
- `docs/CALCULATION_ADMIN/ADR-06-ENGINE-CONTRACT.md` — `basePrice`/`priceRef`, commercial rules.
- `CALCULATOR_TECHNICAL_AUDIT.md` — formula inventory and dead fields.
- `src/content/catalog.ts`, `pricing.ts`, `plinth.ts`, `supports.ts`, `lighting.ts` — module presets, rates, limits.
- `src/lib/configurator/pricing.ts`, `engine.ts`, `types.ts` — current formulas and model.
- `docs/CALCULATION_ADMIN/CALCULATION_CORRECTNESS_AUDIT.md`.
- `docs/CALCULATION_ADMIN/MATERIAL_CONSUMPTION_AUDIT.md`.

### Limitations

- No production cutting list, panel thickness specification, waste/edge-banding norm, or assembly cost breakdown was found.
- `bodyFactor = 1.15` is explicitly a commercial rule; it cannot be used as a physical material model.
- Financial effects are conditional on the owner’s chosen rule; only currently priced elements were calculated.
- No rule was chosen on the owner’s behalf. No code, prices, formulas, fixtures, production DB, or user projects were changed.

**Completion criterion:** seven decision questions investigated; confirmed rules separated from implementation facts; conflicts recorded; financial consequences calculated where data exists; owner decisions listed.

**Master plan:** `docs/CALCULATION_ADMIN/MATERIAL_COST_MODEL_MASTER_PLAN.md` (2026-11-10). Research/design only; existing statuses unchanged.
