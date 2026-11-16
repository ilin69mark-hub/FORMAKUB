# MATERIAL COST MODEL — MASTER PLAN

**Date:** 2026-11-10  
**Purpose:** inventory the real FORMAKUB kitchen/wardrobe elements and define a future element-based cost model (BOM → material → operations → price), without changing code, prices, formulas, or data.  
**Status:** research/design only. The target concept is supplied by the owner; concrete dimensions, thicknesses, norms, and missing prices are **not invented**.

---

## 1. Target cost concept

Owner-approved direction:

1. Carcass = area of each individual part × material rate per m².
2. Shelves and partitions = same area-based calculation.
3. Facades = area × corresponding facade material rate.
4. Hinges, slides, handles, fasteners = separately.
5. Ready-made purchased elements = fixed unit price.
6. Drawers made in-house from LDSP = area of their component parts.
7. Countertops: ready-made standard products with a fixed price; custom products with a per-linear-metre rate including width.
8. Plinths, fillers, cutting, edge banding, and drilling/CNC are accounted for.

This document separates **what exists today** from **what the target model requires**.

### Classification legend

| Code | Meaning |
|---|---|
| CONFIRMED | Confirmed by a catalog, schema, document, or approved source |
| IMPLEMENTED | Found in code, but not confirmed as a business/production rule |
| MISSING | Not present in the model/data |
| CONFLICT | Sources or implementation parts contradict each other |

---

## 2. Future cost architecture

```
Config (kitchen/wardrobe)
   │
   ├── Module type + dimensions
   │      └── BOM parts: sides, bottom, top, back, shelves, dividers, drawer boxes
   │              └── area × material rate
   │
   ├── Facades: doors/drawer fronts → area × facade rate
   ├── Hardware: hinges, slides, handles, supports, fasteners (pieces)
   ├── Purchased: LED, PSU, bottle rack, ready-made countertop (pieces)
   ├── Countertop: fixed product OR linear metre × width rule
   ├── Plinth/fillers/side panels
   └── Operations: cutting, edge banding, drilling/CNC, assembly
```

Current runtime uses `pricing.ts` (legacy) and `engine.ts` (Admin path). Both currently implement only a commercial subset of this chain.

---

## 3. Full catalog of kitchen module types

Source: `KITCHEN_MODULES` in `src/content/catalog.ts`; `KitchenModuleType` in `src/lib/configurator/types.ts`.

**Found: 8 kitchen module types.**

| Type | Purpose | Confirmed geometry (cm) | Doors/facades | Shelves | Drawers | Partitions | Special elements |
|---|---|---|---:|---:|---:|---|---|
| `base` | Lower closed cabinet | W 40–120 (60), H 70–85 (85), D 40–dynamic (55.8) | `width>60 ? 2 : 1` | `shelves` (default 1) | — | No explicit field | hinge, handle, supports, plinth |
| `sink` | Sink cabinet | W 40–120 (60), H 70–85 (85), D 40–dynamic (55.8) | 2 or 3 facade panels, from `sinkLayout` | `sinkStorage[].shelves` | `sinkStorage[].drawers` | Auto/structural sink partitions | sink cutout, sink geometry, bottle section, partitions |
| `hob` | Hob cabinet | W 50–100 (60), H 70–85 (85), D 40–dynamic (55.8) | `width>60 ? 2 : 1` | `shelves` (default 1) | — | No explicit field | hob cutout, hinge, handle |
| `drawers` | Drawer bank | W 40–100 (60), H 70–85 (85), D 40–dynamic (55.8) | drawer fronts, count = `drawers` | — | `drawers` (default 3) | No explicit field | drawer slides, soft-close, handles |
| `wall` | Upper wall cabinet | W 40–100 (60), H 60–140 (72), D 30–40 (35) | `width>60 ? 2 : 1` | `shelves` (default 1) | — | No explicit field | hinge, handle, no supports |
| `tall` | Tall pantry | W 40–120 (60), H 200–277 (220), D 55–60 (60) | `width>60 ? 2 : 1` | `shelves` (default 4) | — | No explicit field | wall anchors, supports, hinge, handle |
| `oven` | Tall oven housing | W 50–90 (60), H 200–277 (220), D 55–60 (60) | `width>60 ? 2 : 1` | `shelves` (default 2) | — | No explicit field | oven niche, wall anchors, supports |
| `bottle` | Narrow bottle module | W 15/20/30 (20), H 70–85 (85), D 40–dynamic (55.8) | `width>60 ? 2 : 1` (i.e. 1) | — | — | No explicit field | bottle rack body; `bottleRack` price exists for sink sections, not for this module |

For lower modules, `D` excludes the HDF 3 mm back panel and the facade; `maxBodyDepth = 580 − 3 − facadeThickness`. Default MDF 19 mm → body 55,8 cm, full 58,0 cm.

### Not found

- corner modules;
- angled modules;
- end/terminal decorative panels (except `config.sidePanels` count);
- fillers/dobors;
- open shelving modules;
- microwave/oven combined modules (only `oven`);
- dishwasher/refrigerator housings as separate types;
- ready-made cabinet modules with fixed dimensions.

`config.sidePanels` (0–2) and `ownSupports` exist as module/config flags, but there is no BOM for them.

---

## 4. Full catalog of wardrobe module types

Source: `WardrobeConfig`/`WardrobeSection` in `src/lib/configurator/types.ts`; no wardrobe entries in `KITCHEN_MODULES`.

**Found: 0 specialized wardrobe module presets.**  
**Found: 1 generic configurable section type** (`WardrobeSection`): `width`, `shelves[]`, `rods[]`, `drawers` count.

| Element | Modeled? | Source |
|---|---|---|
| Left/right side | MISSING as a detail; implied by total width/height/depth | `WardrobeConfig` |
| Top/bottom | MISSING as details | — |
| Back panel | MISSING | — |
| Vertical divider | MISSING | — |
| Shelf | Count/positions (`shelves[]`) CONFIRMED | `WardrobeSection` |
| Rod | Count/positions (`rods[]`) CONFIRMED | `WardrobeSection` |
| Drawer | Count only (`drawers`) CONFIRMED | `WardrobeSection` |
| Door/facade | Count derived from section width >60 | `pricing.ts` |
| Hinge/slide/handle | Priced per piece | `PRICING.wardrobe` |
| Plinth | Boolean + per-linear-metre price | `WardrobeConfig` |
| LED | Boolean + per-section price | `WardrobeConfig` |
| Corner/angled/end modules | MISSING | — |

Wardrobe sections are not a catalog of physical module types; they are a width + filling description.

---

## 5. Detail structure per module (BOM skeletons)

Inventory result: **31 detail/component candidates** were identified across the kitchen and wardrobe models (side panels, bottom, top, back, shelves, dividers, drawer box parts, doors, hinges, slides, handles, supports, clips, screws, anchors, bottle rack, sink bowl, LED strip/profile/diffuser/PSU/control/end cap/connector, plinth, countertop, fillers/end panels). Most are not represented as BOM rows today.

These are **structures**, not approved dimensions/quantities. `TBD` means the value is not in the current model.

### 5.1 Common kitchen lower module skeleton

| Detail | Qty | Length | Width | Thickness | Material | Area | Status |
|---|---:|---|---|---|---|---|---|
| Side panel L | 1 | TBD | TBD | TBD | body material | TBD | MISSING |
| Side panel R | 1 | TBD | TBD | TBD | body material | TBD | MISSING |
| Bottom | 1 | TBD | TBD | TBD | body material | TBD | MISSING |
| Top rail/panel | 1 | TBD | TBD | TBD | body material | TBD | MISSING |
| Back panel | 1 | TBD | TBD | TBD | TBD | TBD | MISSING |
| Shelf | `shelves` | TBD | TBD | TBD | body material | TBD | Count CONFIRMED; dimensions MISSING |
| Vertical divider | TBD | TBD | TBD | TBD | body material | TBD | MISSING (except sink partitions) |
| Door/facade | derived | TBD | TBD | TBD | facade material | derived | Count/formula IMPLEMENTED |
| Drawer box sides/front/back/bottom | TBD | TBD | TBD | TBD | body material | TBD | MISSING |
| Drawer front | `drawers` | TBD | TBD | TBD | facade material | derived | Count IMPLEMENTED |
| Hinge | doors | — | — | — | — | — | Price CONFIRMED |
| Slide | drawers | — | — | — | — | — | Price CONFIRMED |
| Handle | doors/drawers | — | — | — | — | — | Price CONFIRMED |
| Support leg/clip/screw/anchor | calculated | — | — | — | — | — | Price + formula IMPLEMENTED (preliminary) |

### 5.2 Sink module additions

| Detail | Status |
|---|---|
| Sink bowl / sink body | Not modeled; sink geometry only (`sinkWidth/Depth/Position/Offset/Cutout`) |
| Sink partitions | Layout computed by `sinkLayout`; panel dimensions/thickness MISSING; `sinkPartition` price unused |
| Sink sections | `sinkStorage[]` shelves/drawers/bottle CONFIRMED |
| Sink cutout | Price 3 800 CONFIRMED; operation tariff |
| Bottle panel / bottle rack | Sink sections: `bottleRack` 5 000 CONFIRMED price; standalone `bottle` module: basePrice 5 000, no separate rack line |

### 5.3 Other kitchen modules

| Module | Additional details |
|---|---|
| `hob` | Hob cutout 2 800; same carcass skeleton |
| `oven` | Oven niche 2 200; tall supports/anchors |
| `tall` | Tall side/top/bottom/back; wall anchors; same shelf skeleton |
| `wall` | No supports; wall cabinet carcass; back panel not modeled |
| `bottle` | Narrow carcass; door/handle currently derived by width; bottle mechanism not separately modeled |
| `drawers` | Drawer box parts MISSING; slides/fronts/handles priced |

### 5.4 Wardrobe section skeleton

| Detail | Qty | Length | Width | Thickness | Material | Area | Status |
|---|---:|---|---|---|---|---|---|
| Side panel L/R | 2 | TBD | TBD | TBD | body material | TBD | MISSING |
| Top | 1 | TBD | TBD | TBD | body material | TBD | MISSING |
| Bottom | 1 | TBD | TBD | TBD | body material | TBD | MISSING |
| Back panel | 1 | TBD | TBD | TBD | TBD | TBD | MISSING |
| Vertical divider | TBD | TBD | TBD | TBD | body material | TBD | MISSING |
| Shelf | `shelves.length` | TBD | TBD | TBD | body material | TBD | Count CONFIRMED; dimensions MISSING |
| Rod | `rods.length` | — | — | — | ready-made | — | Count/price CONFIRMED |
| Drawer box | `drawers` | TBD | TBD | TBD | body material | TBD | MISSING; per-piece price CONFIRMED |
| Door | derived | TBD | TBD | TBD | facade material | derived | Count/formula IMPLEMENTED |
| Hinge | doors | — | — | — | — | — | Price CONFIRMED |
| Slide | drawers | — | — | — | — | — | Price CONFIRMED |
| Handle | doors | — | — | — | — | — | Price CONFIRMED |
| Plinth | boolean | TBD | — | TBD | TBD | — | Price per linear metre CONFIRMED |
| LED | boolean | — | — | — | ready-made | — | Per-section price CONFIRMED |

---

## 6. Materials

### 6.1 Body materials

Source: `BODY_MATERIALS` in `src/content/catalog.ts`.

| Material | ID | Rate | Status |
|---|---|---:|---|
| LDSP 16 mm | `ldsp` | 5 200 ₽/m² | CONFIRMED (fixed) |

MDF/Plywood are no longer selectable for the body (CA-T-514). Historical projects keep their stored value; new pricing always uses fixed LDSP.
MISSING: back-panel material, edge-banding material/rate, waste coefficient.

### 6.2 Facade materials

Source: `FACADE_MATERIALS`.

| Material | ID | Rate | Thicknesses | Status |
|---|---|---:|---|---|
| LDSP | `ldsp` | 5 600 ₽/m² | 16, 18 mm | CONFIRMED |
| MDF enamel | `mdf` | 8 400 ₽/m² | 16, 19, 22 mm | CONFIRMED |
| MDF PVC film | `mdf_pvc` | 8 400 ₽/m² | 16, 19, 22 mm | CONFIRMED |

Veneer/glass/solid are legacy IDs only: not in the active catalog/UI and not used for new configurations. Historical projects keep their stored value.

**CA-515-02:** the current MDF PVC palette is a temporary copy of the MDF enamel palette. It is **not confirmed by production** and matching colors do not mean identical production assortments. The palette is kept as-is until a separate production decision.

Facade style multipliers: flat 1.0, shaker 1.16, handleless 1.08 (`FACADE_STYLES`). These are commercial multipliers, not material consumption.

### 6.3 Countertop materials

Source: `COUNTERTOPS`.

| Material | Rate | Status |
|---|---:|---|
| LDSP+HPL | 9 500 ₽/m | CONFIRMED |
| Compact HPL | 9 500 ₽/m | CONFIRMED |
| Acrylic | 16 800 ₽/m | CONFIRMED |
| Quartz | 22 400 ₽/m | CONFIRMED |
| Porcelain | 29 400 ₽/m | CONFIRMED |
| Solid wood | 29 400 ₽/m | CONFIRMED |

MISSING: standard product fixed prices/lengths, depth surcharge, custom width rule.

### 6.4 Plinth materials

Source: `PLINTH_MATERIALS`.

| Material | Base rate | Status |
|---|---:|---|
| LDSP | 1 600 ₽/m | CONFIRMED |
| MDF | 2 200 ₽/m | CONFIRMED |
| Plastic | 2 600 ₽/m | CONFIRMED |
| Aluminum | 4 400 ₽/m | CONFIRMED |
| Stainless | 6 200 ₽/m | CONFIRMED |

Finish deltas exist (`rateDelta`), e.g. LDSP pvc04 −120 ₽/m. Plinth height/thickness do not affect price (CONFLICT with material consumption).

### 6.5 Other materials

| Material/part | Status |
|---|---|
| Back-panel material | MISSING |
| Drawer-box material (LDSP?) | MISSING |
| Edge banding | MISSING |
| Fasteners (cams, dowels, screws) | Partially: support screws/anchors priced; carcass fasteners MISSING |
| LED strip/profile/diffuser/PSU/control | CONFIRMED as purchased items with prices |

---

## 7. Hardware and fasteners

| Element | Current model | Price | Status |
|---|---|---|---|
| Hinge | Per door | `kitchen.hingePerDoor` 390 / wardrobe 390 | CONFIRMED price; door count IMPLEMENTED |
| Soft-close | Per door | 460 | CONFIRMED price |
| Push-to-open | Per door | 1 350 | CONFIRMED price |
| Drawer slide | Per drawer | 1 900 | CONFIRMED price |
| Drawer soft-close | Per drawer | 650 | CONFIRMED price |
| Handle | Per door/drawer | 560/780/1 450/0 | CONFIRMED price |
| Support leg | Per leg | 420/690 | CONFIRMED price; quantity preliminary |
| Plinth clip | Per front leg | 60/65 | CONFIRMED price |
| Support screw | Per front leg | 9/12 | CONFIRMED price |
| Wall anchor | Per tall module | 350/400 | CONFIRMED price |
| Carcass cams/dowels/screws | MISSING | — | MISSING |
| Shelf supports | MISSING | — | MISSING |
| Drawer box runners (separate from slide) | MISSING | — | MISSING |

---

## 8. Ready-made purchased elements

| Element | Modeled? | Price |
|---|---|---|
| LED strip | Yes, by power/voltage | `pricePerMeter` |
| LED profile | Yes, catalog item | `ratePerMeter` |
| LED diffuser | Yes, catalog item | `ratePerMeter` |
| LED PSU | Yes, `lighting.psu.<W>` | fixed |
| LED control | Yes, catalog item | fixed |
| End cap | Yes | 110 ₽/pc |
| Connector | Yes | 260 ₽/pc |
| Support system | Yes | leg/clip/screw/anchor prices |
| Bottle rack (sink section) | Yes | 5 000 ₽ |
| Sink bowl | NO | — |
| Ready-made countertop | NO (all are linear-rate) | — |
| Ready-made drawer box | NO | — |
| Ready-made bottle module | NO (module basePrice only) | — |

---

## 9. Countertops — two target models

### 9.1 Ready-made standard countertop

Target: fixed price for a standard product, independent of kitchen length (e.g. a 3 m product is not reduced to 2.5 m).

**Current state:** MISSING. All countertops use `ratePerLinearMeter`; there is no standard-length/fixed-price entity, no `length` field, no stock product list.

Data required:
- standard lengths;
- fixed product price;
- cut allowance / trim rule;
- what happens when kitchen is shorter/longer than stock length.

### 9.2 Custom countertop

Target: per-linear-metre rate with width accounted for; separate rule for non-standard width/depth.

**Current state:** PARTIAL. `ratePerLinearMeter` exists; width/depth are not entered into the price; `countertopDepthAllowance = 0.04` is unused.

Data required:
- standard width/depth included in the rate;
- surcharge for extra depth/width;
- thickness surcharge (currently thickness does not affect price — OI-012/032).

### 9.3 Which modules increase countertop length

Current implementation: `base`, `sink`, `hob`, `drawers`; `tall`/`oven` excluded (full-height); `bottle` excluded (CONFLICT, see §13).

---

## 10. Plinths, fillers, additional elements

| Element | Current state | Missing data |
|---|---|---|
| Plinth | Per linear metre + finish delta | height/thickness effect on price; end caps; corner joints |
| Fillers/dobors | MISSING | material, width, thickness, price basis |
| Decorative side panels | `config.sidePanels` count × 4 800 ₽ | dimensions/area, material, edge banding |
| End panels | MISSING | same |
| Corner/angled elements | MISSING | geometry/BOM |
| Wall filler strips | MISSING | same |
| Cutouts | Sink 3 800; hob 2 800; oven niche 2 200 | operation unit/tariff basis |
| Bottle rack | 5 000 for sink section | standalone module semantics |

---

## 11. Production operations

| Operation | Exists? | Current tariff | Needed input |
|---|---|---|---|
| Cutting (раскрой) | Mentioned only in “Основа проекта” text | No separate tariff | panel area, cutting plan, waste |
| Edge banding (кромление) | MISSING | No tariff | perimeter length, band material |
| Drilling/CNC/присадки | MISSING | No tariff | hole count/pattern |
| Milling (фрезеровка) | MISSING | No tariff | facade area/pattern |
| Assembly | Not separate | Possibly inside `basePrice` | assembly norm |
| Sink cutout | Yes | 3 800 ₽ | operation count |
| Hob cutout | Yes | 2 800 ₽ | operation count |
| Oven niche | Yes | 2 200 ₽ | operation count |
| LED installation | Yes | 450 ₽/m | length |
| Delivery/installation | Not in calculator | — | separate service |

No new tariffs were assigned.

---

## 12. Missing parameters

| ID | Missing data | Needed for |
|---|---|---|
| M-01 | Panel thickness per material | area/volume, edge banding |
| M-02 | Back-panel material/thickness | carcass BOM |
| M-03 | Part/panel dimensions per module | BOM area |
| M-04 | Drawer box composition | in-house drawer cost |
| M-05 | Section divider rule/thickness | wardrobe BOM |
| M-06 | Edge-banding material and perimeter | operation cost |
| M-07 | Cutting/CNC/drilling tariffs and units | operation cost |
| M-08 | Waste coefficient | material consumption |
| M-09 | Standard countertop lengths/fixed prices | ready-made product |
| M-10 | Countertop width/depth surcharge | custom product |
| M-11 | Filler/dobor dimensions and price | additional elements |
| M-12 | Fastener counts/prices for carcass | hardware |
| M-13 | Sink bowl as purchased item | purchased element |
| M-14 | `basePrice` material inclusion | avoid double counting |
| M-15 | Wardrobe/module corner/end variants | catalog completeness |
| M-16 | Back-panel/edge material for facades | facade BOM |

---

## 13. Conflicts

| ID | Conflict | Sources |
|---|---|---|
| X-01 | `basePrice` is called “базовая цена корпуса” but body material area is charged separately | TZ §3.2 vs `pricing.ts` body formula |
| X-02 | `sinkPartition = 2 400 ₽` exists but partitions are charged zero separately | `content/pricing.ts` vs `pricing.ts` comment |
| X-03 | `bottle` is a floor module in UI/layout and supports/plinth, but excluded from countertop width | `KitchenPanel` floor handling vs `kitchenCountertopWidth` |
| X-04 | `countertopDepthAllowance` exists but is unused; thickness/depth do not affect price | `content/pricing.ts` vs `pricing.ts`; OI-008/OI-032 |
| X-05 | Standalone `bottle` module has `basePrice 5 000` and a normal door; sink-section bottle uses `bottleRack 5 000` without a door/hinge | `KITCHEN_MODULES.bottle` vs sink pricing |
| X-06 | Wardrobe schema allows height 100–320 cm and section width 20–200 cm, while `WARDROBE_LIMITS` says 180–270 cm and 40–120 cm | `schema.ts` vs `content/catalog.ts` |
| X-07 | Kitchen schema allows 1–25 modules; `KITCHEN_LIMITS` requires min 2 modules / total width 80 cm | `schema.ts` vs `content/catalog.ts`/validation |
| X-08 | `bodyFactor = 1.15` is commercial, but no physical divider/internal-panel model exists | design/TZ vs wardrobe BOM |
| X-09 | `bodyDepthReference`/depth factor applied to body material, but no panel list or waste rule | design/TZ vs pricing formula |

---

## 14. Validation and implementation plan

### Stage 1 — approve the cost model (owner)

Decide:
1. carcass BOM and panel thickness/back/waste;
2. `basePrice` inclusion;
3. countertop standard vs custom model and width rule;
4. bottle countertop rule;
5. wardrobe divider rule;
6. shelf/partition material inclusion;
7. filler/dobor/corner/end-panel scope;
8. production operation tariffs.

### Stage 2 — collect production data

Required inputs:
- cutting lists/BOM per module type;
- panel thickness and material for each part;
- back-panel and edge-banding specs;
- drawer box design;
- standard countertop catalog;
- operation tariffs and units;
- waste/trim coefficients;
- fastener counts.

### Stage 3 — extend the data model

Add entities/fields for:
- `PartDefinition`/BOM rows per module;
- `MaterialSpec` with thickness;
- `OperationRate` (cutting/edge/CNC/assembly);
- `CountertopProduct` (fixed vs custom);
- `Filler`/`EndPanel`/`CornerModule`;
- `HardwareItem` and `Fastener` quantities;
- `DrawerBoxSpec`.

### Stage 4 — implement and validate

Only after Stage 1–3:
- add BOM → area → cost;
- keep existing golden scenarios as regression or create new approved fixtures;
- add property tests for each detail area;
- run Engine/legacy parity and persistence tests.

**No implementation is allowed until the missing production data and owner decisions are supplied.**

---

**Related documents:** `MATERIAL_CONSUMPTION_AUDIT.md`, `MATERIAL_CONSUMPTION_RULES_DECISION_REGISTER.md`, `CALCULATION_CORRECTNESS_AUDIT.md`.

**Module BOM catalog:** `docs/CALCULATION_ADMIN/MODULE_BOM_CATALOG.md` (2026-11-10). Traces every 2D kitchen module to its data and records BOM gaps; statuses in this plan are unchanged.

**Base module BOM:** `docs/CALCULATION_ADMIN/BOM_BASE_MODULE.md` (2026-11-10). Detailed reference BOM for the `base` module; no implementation changes.
