# BOM — BASE KITCHEN MODULE

**Date:** 2026-11-10  
**Scope:** ordinary lower kitchen module `base` as rendered by the 2D scene.  
**Status:** research/specification only. No code, prices, formulas, catalogs, fixtures, production DB, or user projects were changed.

Legend: **CONFIRMED** / **IMPLEMENTED** / **MISSING** / **CONFLICT**.

---

## 1. Real module configuration

Source: `KITCHEN_MODULES.base` in `src/content/catalog.ts`; `KitchenModule` in `src/lib/configurator/types.ts`; `KitchenPanel.tsx`; `KitchenScene.tsx`; `validation.ts`.

| Parameter | Value | Source | Status |
|---|---|---|---|
| UI name | «Нижний шкаф» | `KITCHEN_MODULES.base.label` | CONFIRMED |
| Type/id | `base` | `KitchenModuleType` | CONFIRMED |
| Zone | `floor` | `KITCHEN_MODULES.base.zone` | CONFIRMED |
| Width range | 40–120 cm | `KITCHEN_MODULES.base`; `validation.ts` width check | CONFIRMED |
| Default width | 60 cm | `KITCHEN_MODULES.base.defaultWidth` | CONFIRMED |
| Height range | 70–85 cm | `KITCHEN_MODULES.base`; row-height control 70–85 | CONFIRMED |
| Default height | 85 cm | `KITCHEN_MODULES.base.defaultHeight` | TECHNICAL — clamp of former 90 cm to new max; owner confirmation pending |
| Depth range | 40–58 cm static; dynamic max `(580 − 3 − facadeThickness)/10` | `KITCHEN_MODULES.base`; `kitchenMaxBodyDepthCm` (external body; HDF and facade excluded) | CONFIRMED |
| Back panel (HDF) | 3 mm, added separately | `KITCHEN_BACK_PANEL_THICKNESS_MM`; full depth = body + 0,3 + facade | CONFIRMED |
| Default depth | 55,8 cm | `KITCHEN_MODULES.base.defaultDepth`; MDF facade 19 mm → full 58,0 cm | PROPOSED — owner confirmation pending |
| Shelves | 0–5, default 1 | `KITCHEN_LIMITS.maxShelvesPerModule`; `KitchenPanel` | CONFIRMED |
| Drawers | 0; rejected on `base` | `validation.ts` (only `drawers` type) | CONFIRMED |
| Doors | `width > 60 ? 2 : 1` | `KitchenScene.tsx` `doorCount`; `pricing.ts` | IMPLEMENTED |
| `ownSupports` | optional boolean | `KitchenModule`; `KitchenPanel` switch | IMPLEMENTED |
| Body material | fixed `ldsp`, 16 mm | `FIXED_BODY_MATERIAL_ID` / `BODY_MATERIALS` | CONFIRMED |
| Facade material | global config (5 options) | `KitchenConfig` | CONFIRMED |
| Handle/hinge/pushToOpen | global config | `KitchenConfig` | CONFIRMED |
| Plinth | global config | `KitchenConfig` | CONFIRMED |
| Countertop | global config | `KitchenConfig` | CONFIRMED |

### Default reference configuration

```
type=base, width=60, height=85, depth=55.8, shelves=1, drawers=0
bodyMaterial=ldsp, facadeMaterial=mdf, facadeThickness=19, facadeStyle=flat
hinge=soft, handle=profile, pushToOpen=false
plinth=true, plinthHeight=10, plinthMaterial=ldsp, plinthFinish=pvc2
supports=standard (maxSpan60, maxLoad40)
countertop=ldsp_hpl (9 500 ₽/linear m)
```

At width **60**, the door-count rule `width > 60` gives **1 door**, not 2.

---

## 2. Complete detail list

The following candidates were checked against the data model. `MISSING` means the model does not contain the required production data; it is **not** a claim that the part does not physically exist.

| # | Detail | Exists in model? | Status |
|---:|---|---|---|
| 1 | Left side panel | No explicit detail | MISSING |
| 2 | Right side panel | No explicit detail | MISSING |
| 3 | Bottom panel | No explicit detail | MISSING |
| 4 | Top panel / rails | No explicit detail | MISSING |
| 5 | Back panel | No explicit detail | MISSING |
| 6 | Shelf | Count only (`shelves`) | CONFIRMED count; dimensions MISSING |
| 7 | Vertical divider | No field for `base` | MISSING / not applicable until construction rule |
| 8 | Facade/door | Count formula + area formula | IMPLEMENTED |
| 9 | Drawer box/front | Not available on `base` | MISSING by design |
| 10 | Plinth share | Global plinth price | CONFIRMED price; module height/thickness details MISSING |
| 11 | Supports | `computeSupports` | IMPLEMENTED (preliminary) |
| 12 | Hinge/soft-close/handle | Global config + per-door counts | CONFIRMED price; count IMPLEMENTED |
| 13 | Carcass fasteners (cams/dowels/screws) | No BOM/count | MISSING |
| 14 | Edge banding | No BOM/perimeter/rate | MISSING |
| 15 | Drilling/CNC/присадки | No BOM/pattern/rate | MISSING |
| 16 | Side/decor panels | Config `sidePanels`, not module detail | IMPLEMENTED count; dimensions MISSING |
| 17 | Countertop | Global kitchen element | CONFIRMED price; not a `base` detail |
| 18 | Mounting/wall attachment | `anchors` only for tall/oven | MISSING for base (usually none) |

---

## 3. Dimensions and materials

Unknown dimensions are not inferred. For panels, the current model provides only the module envelope `W×H×D`.

### 3.1 Module envelope

| Parameter | Symbol | Default | Range | Status |
|---|---|---:|---|---|
| Width | W | 60 cm | 40–120 | CONFIRMED |
| Height | H | 85 cm | 70–85 | CONFIRMED |
| Depth (body) | D | 55,8 cm | 40 – dynamic max | PROPOSED |
| Full depth with HDF 3 mm and facade | D + 0.3 + F/10 cm | 58,0 cm | 40,3 – 58,0 | CONFIRMED formula |
| Shelf count | S | 1 | 0–5 | CONFIRMED |

### 3.2 Detail table

| Detail | Qty | Width | Height | Depth | Thickness | Material | Area one | Total area | Edge | Drilling | Source | Status |
|---|---:|---|---|---|---|---|---:|---:|---|---|---|---|
| Left side | 1 | MISSING | MISSING | MISSING | MISSING | body material | MISSING | MISSING | MISSING | MISSING | — | MISSING |
| Right side | 1 | MISSING | MISSING | MISSING | MISSING | body material | MISSING | MISSING | MISSING | MISSING | — | MISSING |
| Bottom | 1 | MISSING | MISSING | MISSING | MISSING | body material | MISSING | MISSING | MISSING | MISSING | — | MISSING |
| Top/rail | 1 | MISSING | MISSING | MISSING | MISSING | body material | MISSING | MISSING | MISSING | MISSING | — | MISSING |
| Back panel | 1 | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | — | MISSING |
| Shelf | S=1 | MISSING | MISSING | MISSING | MISSING | body material | MISSING | MISSING | MISSING | MISSING | `shelves` | count CONFIRMED; dims MISSING |
| Vertical divider | 0/TBD | MISSING | MISSING | MISSING | MISSING | body material | MISSING | MISSING | MISSING | MISSING | — | MISSING |
| Door/facade | 1 (W≤60) | current price uses W | current price uses H | — | MISSING | facade material | W×H/10000 | same | MISSING | MISSING | `pricing.ts` | IMPLEMENTED |
| Hinge | 1 | — | — | — | — | purchased | — | — | — | drilling MISSING | `PRICING.kitchen` | price CONFIRMED |
| Soft-close | 1 | — | — | — | — | purchased | — | — | — | — | `PRICING.kitchen` | price CONFIRMED |
| Handle | 1 | — | — | — | — | purchased | — | — | — | drilling MISSING | `HANDLES` | price CONFIRMED |
| Support leg | 4 | — | — | — | — | purchased | — | — | — | — | `SUPPORT_SYSTEMS` | IMPLEMENTED preliminary |
| Plinth clip | 2 | — | — | — | — | purchased | — | — | — | — | `SUPPORT_SYSTEMS` | IMPLEMENTED preliminary |
| Carcass fastener | MISSING | — | — | — | — | purchased | — | — | — | — | — | MISSING |
| Edge banding | MISSING | — | — | — | — | MISSING | — | — | MISSING | — | — | MISSING |

**No panel dimensions, thicknesses, back material, edge widths, or drilling patterns exist in the current configuration/schema.**

---

## 4. Geometric formulas

### 4.1 Confirmed / implemented formulas

These formulas are used by the current calculation or confirmed by the model:

| Value | Formula | Meaning | Status |
|---|---|---|---|
| Pricing front area | `W × H / 10000` | module front area, m² | IMPLEMENTED |
| Pricing body material area | `(W × H / 10000) × max(0.5, D/60)` | current depth-adjusted front area | IMPLEMENTED |
| Door count | `W > 60 ? 2 : 1` | facade count | IMPLEMENTED |
| Shelf count | `module.shelves` | shelf count | CONFIRMED |
| Support count | `computeSupports` | 4 legs / 2 front positions at default | IMPLEMENTED preliminary |
| Plinth length share | `W/100` m | linear plinth | CONFIRMED formula |
| Countertop share | `W/100` m | linear countertop | CONFIRMED formula |

For the default base: `frontArea = 60×85/10000 = 0.51 m²`; `bodyPricingArea = 0.51 × (55.8/60) = 0.4743 m²`. Формула не менялась; изменилась только default-глубина.

### 4.2 Candidate formulas — NOT confirmed as construction

If a full-height/full-depth panel construction were approved later, the following would give candidate panel areas. They are shown only to structure future BOM work; they are **not** current production data.

| Detail | Candidate formula | Candidate area at 60×85×55.8 |
|---|---|---:|
| One side panel | `H × D / 10000` | 0.4743 m² |
| Bottom | `W × D / 10000` | 0.3348 m² |
| Top | `W × D / 10000` | 0.3348 m² |
| Back | `W × H / 10000` | 0.51 m² |
| Shelf | `(W−2T) × (D−setback) / 10000` | MISSING (T/setback unknown) |

These candidate areas must not be used as production quantities until panel thickness, insets, back-panel material, and construction rules are approved.

### 4.3 Visual vs production geometry

`KitchenScene.tsx` uses drawing gaps:
- `EDGE_GAP = 0.2 cm`;
- `NEIGHBOR_GAP = 0.1 cm`;
- `DOOR_GAP = 0.1 cm`.

For a single 60×85 base, the visual door area would be approximately `59.6 × 84.6 / 10000 = 0.5042 m²`, while the pricing formula uses `0.51 m²`. The difference is ≈0.006 m² (≈48 ₽ at MDF 8 400 ₽/m²). These gaps are **drawing conventions**, not confirmed production allowances; this is recorded as a visual/calculation CONFLICT, not a confirmed overcharge.

---

## 5. Preliminary BOM

This is a structural BOM, not an approved production BOM. Prices are deliberately omitted where no confirmed rate exists.

| Line | Quantity | Area/length basis | Material | Current price? |
|---|---:|---|---|---|
| Side left | 1 | MISSING (`H×D` candidate only) | body | No separate line |
| Side right | 1 | MISSING | body | No separate line |
| Bottom | 1 | MISSING (`W×D` candidate only) | body | No separate line |
| Top/rail | 1 | MISSING | body | No separate line |
| Back | 1 | MISSING | MISSING | No separate line |
| Shelf | 1 | MISSING | body | Per piece: 1 100 ₽ |
| Divider | 0/TBD | MISSING | body | No line |
| Door | 1 | `W×H` = 0.54 m² | facade | Area × rate × style |
| Hinge | 1 | — | purchased | 390 ₽ |
| Soft-close | 1 | — | purchased | 460 ₽ |
| Handle | 1 | — | purchased | 1 450 ₽ (profile) |
| Support leg | 4 | — | purchased | 1 680 ₽ (4×420) |
| Plinth clip | 2 | — | purchased | 120 ₽ (2×60) |
| Edge banding | MISSING | MISSING | MISSING | No line |
| Fasteners | MISSING | — | purchased | No line |
| Plinth share | 0.6 m | `W/100` | ldsp | 960 ₽ |
| Countertop share | 0.6 m | `W/100` | ldsp_hpl | 5 700 ₽ |

---

## 6. Mapping to current calculation

### 6.1 Default base 60×85×55.8, 1 shelf, MDF, MDF facade 19 mm, soft-close, profile handle

| Current component | Value | Where |
|---|---:|---|
| `preset.basePrice` | 8 200 ₽ | inside `bodyCost` |
| Body material part | 2 466 ₽ (0.4743 m² × 5 200) | `bodyCost` |
| `bodyCost` total | **10 666 ₽** | `pricing.ts` / `engine.ts` |
| `frontsCost` | **4 284 ₽** (0.51 × 8 400 × 1.0) | `frontsCost` |
| `fittingsCost` | **2 300 ₽** (390+460+1 450) | `fittingsCost` |
| Shelf | **1 100 ₽** | inside `optionsCost` |
| Supports | **1 800 ₽** (4×420 + 2×60) | inside `optionsCost` |
| Plinth share | **960 ₽** (0.6×1 600) | inside `optionsCost` |
| Countertop share | **5 700 ₽** (0.6×9 500) | inside `optionsCost` |
| `optionsCost` total | **9 560 ₽** | 1 100+1 800+960+5 700 |
| Global project `baseCost` | 12 000 ₽ | not module-specific |
| Raw kitchen subtotal | 38 810 ₽ (12 000+10 666+4 284+2 300+9 560) | min-order lifts to 45 000 |

**Module-direct component sum** (body + fronts + fittings + shelf + supports, excluding global countertop/plinth/baseCost): **21 431 ₽**.  
This is not the customer price of a one-module kitchen; min-order would apply.

### 6.2 Detail-level accounting

| Detail | Calculated now? | Function | Basis | Double-count risk |
|---|---|---|---|---|
| Side panels | No explicit | — | — | Could be inside `basePrice` |
| Bottom/top | No explicit | — | — | Could be inside `basePrice` |
| Back | No | — | — | MISSING |
| Shelf | Yes, per piece | `shelfTotal` | 1 100 ₽/pc | Material may also be inside `basePrice` |
| Doors | Yes, area | `frontsCost` | W×H×facade rate×style | Gaps ignored; style is commercial |
| Hinge/soft/handle | Yes, per door | `fittingsCost` | fixed prices | Count formula IMPLEMENTED |
| Supports | Yes | `computeSupports` | preliminary formula | `ownSupports` excludes |
| Plinth | Yes, global | `optionsCost` | linear metre | height/thickness not priced |
| Countertop | Yes, global | `optionsCost` | linear metre | bottle/length rule outside this module |
| Edge banding | No | — | — | MISSING |
| Fasteners | No | — | — | MISSING |
| CNC/drilling | No | — | — | MISSING |

### 6.3 `basePrice` semantics

Sources:
- TZ §3.2: `basePrice` — “Базовая цена корпуса пресета” (5 000–15 800 ₽).
- Design §6.3/§8.7: `basePrice` is a `PriceItem` in the Commercial Snapshot.
- Code: `bodyCost += preset.basePrice + material area`.

**CONFLICT:** “base carcass price” could include material, construction/processing, or assembly. The code also charges body material. If `basePrice` already includes material, the default base has a potential double count of **3 747 ₽** (material portion). If it covers construction/assembly only, the current separation is valid. No document resolves this.

---

## 7. Double counting and omissions

| ID | Issue | Amount/impact | Status |
|---|---|---|---|
| DC-1 | `basePrice` might include body material, while material area is charged separately | up to 3 747 ₽ for default base | CONFLICT |
| DC-2 | Shelf price 1 100 ₽ may include shelf material; body material model does not charge shelf panels | unknown | CONFLICT / BUSINESS RULE |
| OM-1 | Side panels, bottom, top | no separate charge; physical panels missing | MISSING |
| OM-2 | Back panel | no material/price | MISSING |
| OM-3 | Carcass fasteners | no count/price | MISSING |
| OM-4 | Edge banding | no perimeter/rate | MISSING |
| OM-5 | Drilling/CNC | no operation/rate | MISSING |
| DC-3 | Visual door gaps vs W×H pricing | ≈0.006 m² ≈48 ₽ at MDF | CONFLICT (visual vs calculation) |
| DC-4 | Plinth height/thickness not priced | unknown | CONFLICT (OI-012) |
| DC-5 | Countertop depth/thickness not priced | unknown | CONFLICT (OI-008/012) |

---

## 8. Owner/production questions

1. Does `basePrice = 8 200 ₽` include body material, cutting/edge/assembly, or only design/assembly?
2. What panel thickness is used for body, shelf, back?
3. Are sides full-height/full-depth? What insets/toe-kick/rear setback?
4. Is the top a full panel or front/rear rails?
5. What back-panel material/thickness and attachment method?
6. Is every base module required to have a vertical divider at widths >X? (No `base` divider field exists.)
7. Are door gaps in `KitchenScene` production gaps or only visual?
8. Does shelf price 1 100 ₽ include material and edge banding?
9. What edge-banding perimeter/rate applies?
10. Which carcass fasteners and how many?
11. Are supports 4 legs/2 clips at 60 cm a production rule or a preliminary estimate?
12. Is the kitchen `baseCost` 12 000 ₽ a separate project charge, or does it overlap with `basePrice`?

---

## 9. Status of each characteristic

| Characteristic | Status |
|---|---|
| `base` type, name, zone | CONFIRMED |
| Width/height/depth ranges and defaults | CONFIRMED |
| Shelf count range/default | CONFIRMED |
| Drawers not allowed on `base` | CONFIRMED |
| Door-count formula | IMPLEMENTED |
| Facade area pricing | IMPLEMENTED |
| Body pricing formula | IMPLEMENTED |
| `basePrice` amount | CONFIRMED as price; semantics CONFLICT |
| Side/bottom/top/back dimensions | MISSING |
| Panel thickness | MISSING |
| Shelf dimensions | MISSING |
| Divider requirement | MISSING |
| Edge banding | MISSING |
| Fasteners | MISSING |
| CNC/drilling | MISSING |
| Supports 4 legs/2 clips | IMPLEMENTED preliminary |
| Plinth share price | CONFIRMED; height/thickness pricing CONFLICT |
| Countertop share price | CONFIRMED; depth/thickness pricing CONFLICT |
| Visual door gaps as production | CONFLICT |

---

## Consistency check with `MODULE_BOM_CATALOG.md`

- Both documents list `base` as one of 8 kitchen module types.
- Both mark panel dimensions, thickness, back, drawer box (not applicable to `base`), edge banding, and fasteners as MISSING.
- Both record `basePrice` semantics as CONFLICT.
- Both record the doorstep/visual gap and countertop/plinth depth issues as open rules.
- This document adds the default `base` cost decomposition and a detailed per-detail BOM skeleton; it does not change any catalog status.

**No production BOM dimensions were invented. No code, prices, formulas, fixtures, production DB, or user projects were changed.**
