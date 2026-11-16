# MODULE BOM CATALOG — Kitchen 2D Configurator

**Date:** 2026-11-10  
**Scope:** trace every module rendered by the kitchen 2D scene to its real data, then document a BOM skeleton per module.  
**Status:** research/documentation only. No code, formulas, prices, catalogs, fixtures, production DB, or user projects were changed.

Classification: **CONFIRMED** / **IMPLEMENTED** / **MISSING** / **CONFLICT**.

---

## 1. Data sources and relation to the 2D scene

| Source | Role |
|---|---|
| `src/components/configurator/KitchenScene.tsx` | 2D SVG rendering of floor/upper modules, sink sections, drawers, oven niche, bottle rack, plinth, countertop, LED, supports |
| `src/components/configurator/KitchenPanel.tsx` | editing width/height/depth, shelves, drawers, sink storage, sink facades, bottle width, `ownSupports` |
| `src/content/catalog.ts` (`KITCHEN_MODULES`, `KITCHEN_LIMITS`, rates) | module presets, ranges, defaults, `basePrice` |
| `src/lib/configurator/types.ts` | `KitchenConfig`, `KitchenModule`, sink fields |
| `src/lib/configurator/schema.ts` | runtime config schema |
| `src/lib/configurator/sink.ts` | sink geometry, sections, facade panels, partitions |
| `src/lib/configurator/supports.ts` | support positions/counts from modules and sink partitions |
| `src/lib/configurator/pricing.ts`, `engine.ts` | current price calculation |
| `src/lib/configurator/validation.ts` | geometry/storage constraints |

**Important:** the SVG geometry is a presentation model. It is **not** a manufacturing BOM. The scene draws shelves/doors/drawers/oven glass/bottle rails; the calculation may or may not account for the corresponding material.

---

## 2. Registry of all visual modules

The 2D scene renders **8 kitchen module types** (all `KitchenModuleType` values).

| UI name | ID/type | Zone | Confirmed geometry (cm) | Visual construction |
|---|---|---|---|---|
| Нижний шкаф | `base` | floor | W 40–120 (60), H 70–85 (85), D 40–dynamic (55.8) | 1–2 doors, shelves |
| Модуль под мойку | `sink` | floor | W 40–120 (60), H 70–85 (85), D 40–dynamic (55.8) | 2–3 facade panels, sink sections, partitions, drawers/bottle |
| Модуль под варочную панель | `hob` | floor | W 50–100 (60), H 70–85 (85), D 40–dynamic (55.8) | 1–2 doors, shelves, countertop cutout implied |
| Блок ящиков | `drawers` | floor | W 40–100 (60), H 70–85 (85), D 40–dynamic (55.8) | drawer fronts stack, handles |
| Верхний шкаф | `wall` | upper | W 40–100 (60), H 60–140 (72), D 30–40 (35) | 1–2 doors, shelves, optional LED line |
| Пенал | `tall` | floor | W 40–120 (60), H 200–277 (220), D 55–60 (60) | 1–2 doors, shelves, full-height body |
| Пенал под технику | `oven` | floor | W 50–90 (60), H 200–277 (220), D 55–60 (60) | 1–2 doors, shelves, dark oven niche |
| Бутылочница | `bottle` | floor | W 15/20/30 (20), H 70–85 (85), D 40–dynamic (55.8) | 1 door, 4 visual storage levels |

**No corner, angled, end, filler, or open-shelf module types exist in the 2D scene.**

For the five lower modules, `D` is the carcass depth without back panel or facade. `maxBodyDepth = 580 − 3 (HDF) − facadeThickness`; default MDF 19 mm gives body 55,8 cm and full depth 58,0 cm. HDF and facade are not part of the body-depth adjustment range.

---

## 3. Specification of each module

### 3.1 `base` — Нижний шкаф

- Created from `KITCHEN_MODULES.base` (CONFIRMED).
- Config fields: `width`, `height`, `depth`, `shelves`, `ownSupports`; global materials/finish/handle/hinge.
- Doors: `doorCount(width) = width > 60 ? 2 : 1` (IMPLEMENTED, duplicated in `KitchenScene.tsx` and `pricing.ts`).
- Shelves: `module.shelves` (CONFIRMED field); visual shelf lines when `showInterior`.
- Internal elements: no partitions field.
- Calculation: body basePrice + area × bodyRate × depth factor; facade area; hinges/handles/supports.
- Missing BOM: side panels, bottom, top, back, shelf dimensions/thickness, edge banding, fasteners.

### 3.2 `sink` — Модуль под мойку

- Created from `KITCHEN_MODULES.sink`.
- Extra fields: `sinkFacades` (2/3), `sinkWidth`, `sinkDepth`, `sinkPosition`, `sinkOffset`, `sinkCutout`, `sinkStorage[]` (`shelves`, `drawers`, `bottle` 15/20/30).
- Geometry: `sinkLayout` builds sections, partitions, facade boxes; `sinkFacadeTotals` returns doors/fronts/bottle/panels.
- Visual: comms zone, shelves, drawer fronts, bottle wire baskets; 30 cm bottle gets divider bars/bottles.
- Calculation: body + facade panel area; sink cutout; bottleRack for sink bottle; hinges for doors; slides for section drawers; supports depend on sink partitions.
- Missing BOM: sink bowl (purchased), partition dimensions/thickness, sink cutout dimensions, bottle rack dimensions, section panel/back details.
- **Same geometry, different internals:** 2 vs 3 facades; different `sinkStorage`; bottle section vs shelf/drawer section.

### 3.3 `hob` — Модуль под варочную панель

- Same visual/box model as `base` at 60×85.
- Extra option: `ownSupports` (technique on own legs).
- Calculation: body + facade + hinge/handle + hob cutout 2 800.
- Missing BOM: hob cutout size, countertop cutout operation model, reinforcements.
- **Same geometry as `base`/`sink` at 60×85 but different internal/cutout.**

### 3.4 `drawers` — Блок ящиков

- Fields: `drawers` (default 3, limits 2–4).
- Visual: stack of `drawers` fronts, each with handle.
- Calculation: body + full front area + slide/soft-close/handle per drawer.
- Missing BOM: drawer box sides/front/back/bottom, box material/thickness, runner type, front dimensions.
- **Same external geometry, different internals:** drawer count changes internals/fittings only; facade area stays module area.

### 3.5 `wall` — Верхний шкаф

- Zone upper; no supports.
- Fields: width, height, depth, shelves, door count.
- Visual: doors or interior shelves; LED line if `underCabinetLighting`.
- Calculation: body + facade + hinge/handle; no support cost.
- Missing BOM: wall cabinet back panel, hanging brackets, shelf dimensions/thickness.

### 3.6 `tall` — Пенал

- Full-height floor module; fields width/height/depth/shelves.
- Visual: 1–2 doors, shelves, plinth, wall anchor indication.
- Calculation: body + facade + hinge/handle + supports + wall anchors.
- Missing BOM: tall side/top/bottom/back, anchor positions, shelf dimensions.

### 3.7 `oven` — Пенал под технику

- Same external box as `tall` at 60×220, plus `ownSupports`.
- Visual: dark niche at fixed drawing coordinates (`top+48`…); this is **visual only**.
- Calculation: body + facade + hinge/handle + oven niche 2 200 + supports/anchors (unless ownSupports).
- Missing BOM: niche dimensions/reinforcements, oven housing panels, ventilation.
- **Same geometry as `tall` but different internals/cutout.**

### 3.8 `bottle` — Бутылочница

- Width choices 15/20/30; `module.shelves` is not used for this type in pricing.
- Visual: 4 storage levels; 30 cm variant has divider bars/bottles.
- Calculation: body basePrice 5 000 + area + normal door/hinge/handle (because `doorCount(20)=1`); **no separate bottleRack price** for the standalone module.
- Sink-section bottle (different path): `bottleRack` 5 000, bottle panel without hinges/handle.
- Missing BOM: bottle mechanism/rails/baskets, panel dimensions, whether a door/hardware is required.
- **Same visual idea as sink bottle section, different calculation.**

---

## 4. Configuration variants

### 4.1 Parameter matrix

| Parameter | Affects 2D visual | Affects calculation | Status |
|---|---|---|---|
| `width` | module width, door count, sink layout | body area, facade area, sink layout, supports | CONFIRMED |
| `height` | module height | body/facade area, tall anchors | CONFIRMED |
| `depth` | side depth in scene | body material depth factor | CONFIRMED |
| `shelves` | shelf lines | shelf price and shelf count | CONFIRMED field; panel dimensions MISSING |
| `drawers` | drawer stack | slides/soft-close/handles, front area | CONFIRMED |
| `sinkFacades` | 2/3 panels | sink layout/panels | IMPLEMENTED |
| `sinkStorage` | sections, shelves, drawers, bottle | sink section fittings/bottle | IMPLEMENTED |
| `ownSupports` | no support legs in plan | excludes supports | IMPLEMENTED |
| `sidePanels` (config) | not drawn as a separate module | count × 4 800 | IMPLEMENTED; dimensions MISSING |
| `plinth`/`plinthHeight` | plinth bar | plinth length price (height not priced) | CONFIRMED price; height CONFLICT |
| `countertopThickness` | countertop thickness | 2D/lighting; **not price** | CONFLICT (OI-012) |
| `handle`/`hinge`/`pushToOpen` | door/drawer handles | fittings | CONFIRMED |
| `underCabinetLighting` | LED line | LED plan cost | CONFIRMED |

### 4.2 Same external geometry, different internal construction

1. `base` / `sink` / `hob` at 60×85 — different internals/cutouts.
2. `tall` / `oven` at 60×220 — niche vs shelves.
3. `sink` 2 facades vs 3 facades — same width/height, different partitions/panels.
4. `sink` storage variants — same box, different shelves/drawers/bottle.
5. `drawers` count variants — same box, different internal drawer stack.
6. Standalone `bottle` vs sink-section bottle — same bottle idea, different pricing/hardware.

---

## 5. BOM and missing production data

### 5.1 Common lower/upper carcass template

Dimensions are **not invented**; `TBD` means the current data model does not provide them.

| Detail | Qty | Width | Height | Depth | Thickness | Material | Area | Processing |
|---|---:|---|---|---|---|---|---:|---|
| Side left | 1 | TBD | TBD | TBD | TBD | body material | TBD | cut, edge, drill |
| Side right | 1 | TBD | TBD | TBD | TBD | body material | TBD | cut, edge, drill |
| Bottom | 1 | TBD | TBD | TBD | TBD | body material | TBD | cut, edge, drill |
| Top/rail | 1 | TBD | TBD | TBD | TBD | body material | TBD | cut, edge, drill |
| Back panel | 1 | TBD | TBD | TBD | TBD | TBD | TBD | cut/fit |
| Shelf | `shelves` | TBD | TBD | TBD | TBD | body material | TBD | cut, edge |
| Vertical divider | TBD | TBD | TBD | TBD | TBD | body material | TBD | cut, edge, drill |
| Door | 1–2 | TBD | TBD | TBD | TBD | facade material | derived | cut, edge/mill |
| Drawer box side/front/back | `drawers`×4 | TBD | TBD | TBD | TBD | body material | TBD | cut, edge, drill |
| Drawer bottom | `drawers` | TBD | TBD | TBD | TBD | TBD | TBD | cut |
| Drawer front | `drawers` | TBD | TBD | TBD | TBD | facade material | derived | cut/mill |
| Hinge | doors | — | — | — | — | purchased | — | drilling |
| Slide | drawers | — | — | — | — | purchased | — | drilling |
| Handle | doors/drawers | — | — | — | — | purchased | — | drilling |
| Support leg/clip/screw/anchor | calculated | — | — | — | — | purchased | — | — |

### 5.2 Per-module BOM additions

#### `base`
- Common carcass + `shelves` + doors + hinges/handles + supports.
- Missing: all panel dimensions/thickness/back/edge/fasteners.

#### `sink`
- Common carcass without a simple divider; `sinkLayout` sections/partitions/panels.
- Sink bowl: **MISSING** as a BOM line.
- Sink cutout: price exists; cutout geometry only partial (`sinkCutout` optional).
- Bottle section: `bottleRack` price; wire baskets/rails **MISSING** as BOM.
- Section shelves/drawers: counts exist; panel dimensions MISSING.

#### `hob`
- Common carcass + shelves + doors + hob cutout.
- Cutout dimensions/operation unit MISSING.

#### `drawers`
- Common carcass **without** shelves; drawer box BOM MISSING.
- Slides/fronts/handles counts exist.

#### `wall`
- Common carcass + shelves + doors; back panel/hanging brackets MISSING.

#### `tall`
- Common tall carcass + shelves + doors; anchors priced; panel dimensions MISSING.

#### `oven`
- Tall carcass + oven niche; niche dimensions/reinforcements/ventilation MISSING.
- Visual niche coordinates are **not** production dimensions.

#### `bottle`
- Narrow carcass + door (currently) + hinge/handle; bottle mechanism/baskets/rails MISSING.
- Visual 4 levels are **not** priced as shelves.

### 5.3 Missing production data

| ID | Missing | Needed from |
|---|---|---|
| BOM-01 | Panel dimensions per module | production/cutting design |
| BOM-02 | Panel thickness per material | material spec |
| BOM-03 | Back-panel material/thickness | production spec |
| BOM-04 | Drawer box design | production spec |
| BOM-05 | Sink bowl purchased item | procurement |
| BOM-06 | Sink partition dimensions | production spec |
| BOM-07 | Oven niche dimensions | appliance/production spec |
| BOM-08 | Bottle mechanism/rails/baskets | procurement/production |
| BOM-09 | Edge banding perimeter/material | production spec |
| BOM-10 | Drilling/CNC patterns | production spec |
| BOM-11 | Fastener counts | production spec |
| BOM-12 | Waste/trim coefficient | production norm |

---

## 6. Mapping to the current calculation

| BOM element | Currently calculated? | Where | Conflict/duplicate risk |
|---|---|---|---|
| Body outer material | Yes, as front area × depth factor | `pricing.ts` / `engine.ts` | `basePrice` may already include material |
| Internal sides/top/bottom/back | No explicit line | — | MISSING |
| Shelves | Per piece, not area | `shelfTotal × shelf` | material not separated |
| Sink partitions | No separate line | `sink.ts` layout; price unused | `sinkPartition` 2 400 exists |
| Drawer box | No | — | slide price only |
| Drawer fronts | Yes, as module area | `pricing.ts` | front area not per drawer? area is total |
| Doors/facades | Yes, area × rate × style | `pricing.ts` | style is commercial |
| Hinges/slides/handles | Yes, per piece/count | `pricing.ts` | count formulas IMPLEMENTED |
| Supports | Yes, preliminary formula | `supports.ts` / engine | engineering data preliminary |
| Sink/hob cutouts, oven niche | Fixed price lines | `pricing.ts` | geometry not BOM |
| Bottle rack | Only sink sections | `pricing.ts` | standalone bottle differs |
| Plinth | Per linear metre | `pricing.ts` | height/thickness not priced |
| Countertop | Per linear metre | `pricing.ts` | bottle excluded in pricing, included in 2D counter segments |
| LED | Purchased components | `lighting.ts` / engine | preliminary limits |
| Side panels | Count × 4 800 | `pricing.ts` | dimensions/material MISSING |
| Fillers/dobors | No | — | MISSING |

### Key code references

- `KitchenScene.tsx`: `renderFloorModule`, `renderSinkSections`, `renderSinkDoors`, `renderUpperModule`, `counterSegments` (includes `bottle`).
- `KitchenPanel.tsx`: width/depth/shelves/drawers controls, `sinkStorage`, `sinkFacades`, `ownSupports`.
- `pricing.ts`: `calculateKitchenPrice` (body/fronts/fittings/options).
- `engine.ts`: `calculateKitchenBreakdown`.
- `sink.ts`: `sinkLayout`, `sinkFacadeTotals`, `buildSections`.
- `supports.ts`: `computeSupports`, `positionsForModule`.
- `catalog.ts`: `KITCHEN_MODULES`, `KITCHEN_LIMITS`.
- `types.ts`: `KitchenModule`, `KitchenSinkStorage`.

---

## 7. Conflicts and owner questions

| ID | Conflict/question | Evidence |
|---|---|---|
| C-01 | 2D countertop spans `bottle`; pricing countertop excludes `bottle` | `KitchenScene.tsx` `counterSegments` vs `kitchenCountertopWidth` |
| C-02 | `basePrice` called “base carcass price” but body material is charged separately | TZ §3.2 vs `pricing.ts` |
| C-03 | `sinkPartition` 2 400 exists but partitions are free | `content/pricing.ts` vs `pricing.ts` |
| C-04 | Standalone bottle has a normal door/hinge; sink bottle panel has no hinges | `doorCount` vs `sink` bottle panel |
| C-05 | Visual bottle has 4 levels; shelf count is 0 for standalone bottle | `KitchenScene` visual-only lines |
| C-06 | Oven niche is drawn at fixed coordinates; no production dimensions | `KitchenScene` visual vs BOM |
| C-07 | `countertopDepthAllowance` exists but unused; thickness not priced | `content/pricing.ts`, `pricing.ts`, OI-008/012 |
| C-08 | Wardrobe schema limits vs `WARDROBE_LIMITS` (not kitchen-specific but related model) | `schema.ts` vs `catalog.ts` |
| C-09 | Drawer box is not modeled, but drawer fronts/slides are | `pricing.ts` |

Owner questions:
1. Which BOM panels are mandatory for each module?
2. Do `basePrice` and material lines overlap?
3. Is the bottle module a door cabinet, an open rack, or a pull-out?
4. Does the countertop cover standalone bottles?
5. Is the oven niche a standard production module or a custom cutout?
6. Are visual shelves/levels in bottle/oven meaningful for material and price?
7. Are fillers/end panels/corner modules in scope?

---

## 8. Reliability status of each characteristic

| Characteristic | Status | Source |
|---|---|---|
| 8 kitchen module types | CONFIRMED | `KITCHEN_MODULES` |
| Geometry ranges/defaults | CONFIRMED | `KITCHEN_MODULES` |
| Door count formula | IMPLEMENTED | `KitchenScene.tsx`, `pricing.ts` |
| Shelves/drawers fields | CONFIRMED | `KitchenModule` |
| Sink layout/sections | IMPLEMENTED | `sink.ts`, tests |
| Sink partition dimensions | MISSING | — |
| Panel dimensions/thickness | MISSING | — |
| Back panel | MISSING | — |
| Drawer box parts | MISSING | — |
| Edge banding/CNC/fasteners | MISSING | — |
| BasePrice semantics | CONFLICT | TZ vs pricing |
| Countertop bottle coverage | CONFLICT | 2D vs pricing |
| Sink partition price | CONFLICT | catalog vs pricing |
| Bottle visual levels | IMPLEMENTED visual only | `KitchenScene.tsx` |
| Oven niche visual | IMPLEMENTED visual only | `KitchenScene.tsx` |
| Supports formula | IMPLEMENTED preliminary | `supports.ts` |
| LED components | CONFIRMED price; preliminary limits | `lighting.ts` |
| Fillers/dobors/corners | MISSING | — |

**No production BOM dimensions were invented. All unknown values are marked TBD/MISSING with the required data source.**

**Base module BOM:** `docs/CALCULATION_ADMIN/BOM_BASE_MODULE.md` (2026-11-10). Detailed reference BOM for the `base` module; no implementation changes.
