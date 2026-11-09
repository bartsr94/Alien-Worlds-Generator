# Colony Buildings — Plan

**Status:** Ready to implement
**Date:** March 2026
**Depends on:** COLONY_ECONOMY_V2_PLAN.md (all phases fully shipped)

---

## Goal

Remove the unchecked exponential growth problem. Currently production scales with
`tierMultiplier × 100` automatically, so every colony piles up resources with no
ceiling. This pass replaces that with a buildings-gated model:

- **Zero production until buildings are constructed** — raw tile potential is
  latent; you need to build extraction infrastructure to access it
- **Per-capita food + water maintenance** — upkeep scales with actual population so
  growth has real cost
- **Housing cap** — population halts at housing capacity; build more to grow more
- **Pool capacity cap** — resources can't accumulate past what your Storage buildings
  allow; prevents hoarding infinite surplus
- **Manual tier advancement** — tiers no longer auto-advance from pop; player spends
  metals to promote a colony when ready; gates higher-tier buildings

---

## Design Decisions

| Question | Decision |
|---|---|
| Production without buildings | Zero — tile `resourceFood` etc. are latent potential, not output |
| Building scope | Per-colony (each settlement has its own building slots) |
| Building categories | 6: Habitation, Farm, Water Extraction, Mine, Fuel Extraction, Storage |
| Building tiers | 3 tiers per category (level 1 / 2 / 3); level 0 = not built |
| Storage model | Per-colony Storage buildings contribute to a shared body-wide pool cap |
| Housing cap | `HOUSING_CAPS[buildings.habitation]` — pop halts (doesn't starve) at cap |
| Maintenance formula | Per-capita food + water + flat fuel overhead (habitability penalty kept) |
| Tier advancement | Manual button + metals cost; unlocks building tiers 2 and 3 |
| Tier multipliers in maintenance | Removed; per-capita formula replaces tier-scaled flat rates |
| TIER_MULTIPLIERS in production | Removed; replaced by per-building multiplier on tile potential |
| Bootstrap 20% prod | Kept — if buildings exist at founding, production starts at 20% |
| STARTING_POOL | Unchanged: `{ food:500, water:500, metals:600, fuel:200 }` |

---

## Building Definitions

### Categories and Tiers

| Category | Level 0 | Level 1 | Level 2 | Level 3 |
|---|---|---|---|---|
| **Habitation** | (none) | Hab Pod | Habitat Module | Arcology |
| **Farm** | (none) | Greenhouse | Hydroponic Farm | Biosphere |
| **Water Extraction** | (none) | Water Collector | Purification Plant | Deep Aquifer |
| **Mine** | (none) | Mining Rig | Extraction Plant | Deep Core |
| **Fuel Extraction** | (none) | Fuel Tap | Refinery | Geothermal Plant |
| **Storage** | (none) | Storage Unit | Depot | Warehouse |

### Effect Values

```js
export const HOUSING_CAPS     = [0, 250, 5_000, 100_000, 2_000_000]; // index = habitation level (0 = no housing = no pop cap from housing, but pop can't grow past 0)
// NOTE: level 0 means no housing → pop cap = 0 effectively (founding always starts with level 1)
// Actually: founding auto-grants habitation level 1 (50⛏ folded into founding cost)

export const FARM_MULTS       = [0, 3,  10, 30];   // food production multiplier
export const WATER_MULTS      = [0, 3,  10, 30];   // water production multiplier
export const MINE_MULTS       = [0, 3,  10, 30];   // metals production multiplier
export const FUEL_MULTS       = [0, 3,  10, 30];   // fuel production multiplier
export const STORAGE_CAPS     = [0, 2_000, 8_000, 30_000]; // per-colony contribution to body pool cap
```

### Metal Costs (per upgrade, not cumulative)

```js
export const BUILDING_COSTS = {
    habitation: [0, 50, 200, 800],    // cost to upgrade to level 1 / 2 / 3
    farm:       [0, 75, 300, 1200],
    water:      [0, 75, 300, 1200],
    mine:       [0, 100, 400, 1500],
    fuel:       [0, 100, 400, 1500],
    storage:    [0, 50, 200, 800],
};
```

Each `BUILDING_COSTS[cat][n]` is the cost to upgrade *to* level `n`. Level 0 costs
nothing (it means "not built"). `colonyMetal` is drawn from `state.bodyPools[bodyId].metals`.

### Building Tier Unlock Requirements

Building tier 2 requires the colony to be at Settlement tier or above.
Building tier 3 requires Colony tier or above.

```js
export const BUILDING_TIER_UNLOCK = {
    1: 'outpost',      // always available
    2: 'settlement',
    3: 'colony',
};
```

### Tier Advance Costs (metals)

```js
export const TIER_ADVANCE_COSTS = {
    outpost:    100,   // Outpost → Settlement
    settlement: 500,   // Settlement → Colony
    colony:     2_000, // Colony → City
    city:       8_000, // City → Megacity
    megacity:   null,  // cannot advance further
};
```

---

## Core Formulas

### 1. Production (replaces old tier-multiplier formula)

```
workerFraction = min(colony.population, housingCap) / housingCap
// 0 at empty, 1 when colony fills its housing

food   = floor(tile.resourceFood[r]   × 100 × FARM_MULTS[buildings.farm]   × workerFraction)
water  = floor(tile.resourceWater[r]  × 100 × WATER_MULTS[buildings.water] × workerFraction)
metals = floor(tile.resourceMetals[r] × 100 × MINE_MULTS[buildings.mine]   × workerFraction)
fuel   = floor(tile.resourceFuel[r]   × 100 × FUEL_MULTS[buildings.fuel]   × workerFraction)
```

All four resources are `0` when no corresponding building exists (mult = 0).
`resourceFood` etc. are `Float32Array` values in `[0, 1]`.

Example — Settlement (pop=2000, housingCap=5000, farm=1, tile.food=0.5):
```
workerFraction = 2000/5000 = 0.4
food = floor(0.5 × 100 × 3 × 0.4) = floor(60) = 60
```

### 2. Maintenance (per 30-day tick)

```
habMult = 1 + (1 − colony.habitability)    // 1.0 ideal, 2.0 bare rock

food  = Math.round((2 + colony.population × 0.002) × habMult)
water = Math.round((1 + colony.population × 0.001) × habMult)
fuel  = Math.round(1 × habMult)            // flat overhead

metals = 0
```

Example — Settlement pop=2000, hab=0.7 → habMult=1.3:
```
food  = round((2 + 4) × 1.3) = round(7.8) = 8
water = round((1 + 2) × 1.3) = round(3.9) = 4
fuel  = round(1 × 1.3) = round(1.3) = 1
```

This scales naturally: a pop=100k colony on a hostile tile costs ~270 food/tick.

### 3. Housing Cap and Population Growth

Population grows only while `colony.population < housingCap`:
```
if inBootstrap:
    newPop = round(pop × 1.001)
else:
    newPop = round(pop × 1.005 + 5)

colony.population = min(newPop, housingCap)
```

If `housingCap === 0` (no habitation building), pop is capped at 0 — which can't
happen in practice since we auto-grant habitation level 1 on founding.

### 4. Pool Cap

After all tick production is added, clamp each resource:
```
bodyPoolMax = BASE_STORAGE + sum(STORAGE_CAPS[c.buildings.storage] for c in bodyCols)
// BASE_STORAGE = 500 (starting pack size — you can always hold at least what you start with)

pool.food   = min(pool.food,   bodyPoolMax)
pool.water  = min(pool.water,  bodyPoolMax)
pool.metals = min(pool.metals, bodyPoolMax)
pool.fuel   = min(pool.fuel,   bodyPoolMax)
```

With no storage buildings on any colony, cap = 500. One Storage Unit (level 1)
adds 2000 per colony, so a body with two colonies both at level 1 gets cap=500+4000.

### 5. Founding

Founding auto-grants **habitation level 1** and **no other buildings**. The metals
cost for habitation level 1 (50⛏) is **folded into the founding cost** — the
displayed cost already includes this infrastructure investment. The colony starts
with `buildings: { habitation:1, farm:0, water:0, mine:0, fuel:0, storage:0 }`.

This means a fresh outpost has a pop cap of 250 but produces zero resources until
buildings are constructed. Player must immediately decide: farm first? mine first?

---

## Data Model Changes

### `js/colony.js`

**Add constants:**
```js
export const HOUSING_CAPS    = [0, 250, 5_000, 100_000, 2_000_000];
export const FARM_MULTS      = [0, 3, 10, 30];
export const WATER_MULTS     = [0, 3, 10, 30];
export const MINE_MULTS      = [0, 3, 10, 30];
export const FUEL_MULTS      = [0, 3, 10, 30];
export const STORAGE_CAPS    = [0, 2_000, 8_000, 30_000];
export const BUILDING_COSTS  = {
    habitation: [0, 50,  200, 800],
    farm:       [0, 75,  300, 1200],
    water:      [0, 75,  300, 1200],
    mine:       [0, 100, 400, 1500],
    fuel:       [0, 100, 400, 1500],
    storage:    [0, 50,  200, 800],
};
export const BUILDING_TIER_UNLOCK = { 1: 'outpost', 2: 'settlement', 3: 'colony' };
export const TIER_ADVANCE_COSTS   = {
    outpost: 100, settlement: 500, colony: 2_000, city: 8_000, megacity: null
};
export const COLONY_TIER_ORDER = ['outpost','settlement','colony','city','megacity'];

export function getHousingCap(buildings)         { return HOUSING_CAPS[buildings.habitation ?? 0]; }
export function getStorageContribution(buildings){ return STORAGE_CAPS[buildings.storage    ?? 0]; }
export function canAdvanceTier(colony)           {
    const idx = COLONY_TIER_ORDER.indexOf(colony.tier);
    if (idx < 0 || idx >= COLONY_TIER_ORDER.length - 1) return false;
    const nextThreshold = COLONY_TIERS[idx + 1]?.min ?? Infinity;
    return colony.population >= nextThreshold;
}
```

**Modify `createColony()`** — add `buildings` and `tier` fields:
```js
buildings: { habitation: 1, farm: 0, water: 0, mine: 0, fuel: 0, storage: 0 },
tier: 'outpost',
```

**Rewrite `colonyProductionRates(colony, curData)`:**
```js
export function colonyProductionRates(colony, curData) {
    const dl = curData?.debugLayers;
    if (!dl?.resourceFood) return { food: 0, water: 0, metals: 0, fuel: 0 };
    const r  = colony.region;
    const hc = getHousingCap(colony.buildings);
    const wf = hc > 0 ? Math.min(colony.population, hc) / hc : 0;
    return {
        food:   Math.floor((dl.resourceFood[r]   ?? 0) * 100 * FARM_MULTS[colony.buildings.farm]   * wf),
        water:  Math.floor((dl.resourceWater[r]  ?? 0) * 100 * WATER_MULTS[colony.buildings.water] * wf),
        metals: Math.floor((dl.resourceMetals[r] ?? 0) * 100 * MINE_MULTS[colony.buildings.mine]   * wf),
        fuel:   Math.floor((dl.resourceFuel[r]   ?? 0) * 100 * FUEL_MULTS[colony.buildings.fuel]   * wf),
    };
}
```

**Rewrite `maintenanceCost(colony)`:**
```js
export function maintenanceCost(colony) {
    const m = 1 + (1 - Math.max(0, Math.min(1, colony.habitability ?? 0.5)));
    const p = colony.population;
    return {
        food:   Math.round((2 + p * 0.002) * m),
        water:  Math.round((1 + p * 0.001) * m),
        fuel:   Math.round(1 * m),
        metals: 0,
    };
}
```

**Remove `TIER_MULTIPLIERS` from production and maintenance.**
Keep `TIER_MULTIPLIERS` exported if any call site still references it — check and
clean up. `getTier()` signature becomes `getTier(colony)` reading `colony.tier`
directly, not deriving from `colony.population`. Remove the `COLONY_TIERS` min/max
threshold checks from `getTier()`.

### `js/core/state.js`

No changes needed. `bodyPools` and `colonies` already exist.

### `js/main.js`

**`tickEconomy(gameDays)` changes:**

1. After population growth, clamp to housing cap:
   ```js
   colony.population = Math.min(growthResult, getHousingCap(colony.buildings));
   ```

2. After the per-colony loop, apply pool cap:
   ```js
   const poolMax = calcBodyPoolMax(bodyId);
   pool.food   = Math.min(pool.food,   poolMax);
   pool.water  = Math.min(pool.water,  poolMax);
   pool.metals = Math.min(pool.metals, poolMax);
   pool.fuel   = Math.min(pool.fuel,   poolMax);
   ```

3. Add `calcBodyPoolMax(bodyId)` helper:
   ```js
   function calcBodyPoolMax(bodyId) {
       const BASE = 500;
       return BASE + state.colonies
           .filter(c => c.bodyId === bodyId)
           .reduce((sum, c) => sum + getStorageContribution(c.buildings), 0);
   }
   ```

4. Import `getHousingCap`, `getStorageContribution` from `./colony.js`.

**`updateHUD()` changes:**

Add pool cap status line under pool totals:
```
🌾 53.2K  💧 70.5K  ⛏ 39.7K  ⚡ 44.2K   (cap: 2.5K)
```
Show cap in grey; if `pool.food >= poolMax × 0.85` highlight cap value in amber
as a "storage nearly full" warning.

### `js/edit-mode.js`

Add **BUILDINGS** section below the prod/maint/net table in `buildColonySectionHTML()`:

```
BUILDINGS                                          [upgrade buttons]
Habitation   Hab Pod (250)          › Habitat Module  200 ⛏
Farm         Greenhouse             › Hydroponic Farm  300 ⛏
Water Ext.   — not built —          › Water Collector   75 ⛏
Mine         — not built —          › Mining Rig       100 ⛏
Fuel Ext.    — not built —          › Fuel Tap         100 ⛏
Storage      — not built —          › Storage Unit      50 ⛏
```

Button rules:
- **Disabled** if `pool.metals < upgradeCost`
- **Disabled** if colony tier doesn't unlock that building tier (e.g. building
  tier 2 requires Settlement)
- **"MAX"** label (no button) when building is at level 3

Add **TIER ADVANCEMENT** row when `canAdvanceTier(colony)` is true:
```
Population requirement met — › Advance to Settlement  [100 ⛏]
```
Disabled if pool metals < cost.

Wire all buttons in `wireColonyHandlers()`: deduct metals from pool, increment
`colony.buildings[cat]` or `colony.tier`, re-render colony section HTML,
call `markHudDirty()`.

Import `BUILDING_COSTS`, `BUILDING_TIER_UNLOCK`, `TIER_ADVANCE_COSTS`,
`COLONY_TIER_ORDER`, `canAdvanceTier`, `getHousingCap` from `./colony.js`.

---

## Economy Tick Order (full, updated)

```
Runs every 30 game days.

for each colony (bodyId matches active body):

  pool = state.bodyPools[colony.bodyId]
  if !pool: continue

  inBootstrap = getGameDays() < colony.bootstrapEndDay

  1. Deduct maintenance (per-capita formula)
     maint = maintenanceCost(colony)
     hadFood = pool.food >= maint.food
     pool.food  = max(0, pool.food  − maint.food)
     pool.water = max(0, pool.water − maint.water)
     pool.fuel  = max(0, pool.fuel  − maint.fuel)
     colony.starvationTicks = hadFood ? 0 : starvationTicks + 1

  2. Add production (building-gated; 20% mult during bootstrap)
     rates = colonyProductionRates(colony, curData)
     mult  = inBootstrap ? 0.20 : 1.0
     pool += rates × mult for all resources

  3. Population growth (capped by housing)
     growth = inBootstrap
         ? round(pop × 1.001)
         : round(pop × 1.005 + 5)
     colony.population = min(growth, getHousingCap(colony.buildings))

  4. Queue collapse
     if starvationTicks >= 3:
         pop = floor(pop × 0.75)
         if pop < 1 → toAbandon

After colony loop:
  Apply pool cap:
    max = calcBodyPoolMax(bodyId)
    clamp all resources to max

Process abandonments, show toast, redraw markers.
markHudDirty()
```

---

## Phase Plan

### Phase A — `js/colony.js`

1. Add all new constants: `HOUSING_CAPS`, `FARM_MULTS`, `WATER_MULTS`, `MINE_MULTS`,
   `FUEL_MULTS`, `STORAGE_CAPS`, `BUILDING_COSTS`, `BUILDING_TIER_UNLOCK`,
   `TIER_ADVANCE_COSTS`, `COLONY_TIER_ORDER`
2. Add helpers: `getHousingCap`, `getStorageContribution`, `canAdvanceTier`
3. Modify `createColony()` — add `buildings` and `tier` fields
4. Rewrite `colonyProductionRates()` — building-gated formula
5. Rewrite `maintenanceCost()` — per-capita formula
6. Update `getTier(colony)` — read `colony.tier` directly, remove pop-threshold
   lookup from the main code path. Keep a `getTierFromPop(pop)` helper for the
   one place that still needs it (founding cost preview in tile panel only).
7. Remove `TIER_MULTIPLIERS` export (or mark deprecated if needed for call sites)

### Phase B — `js/main.js`

8. Import `getHousingCap`, `getStorageContribution`, `canAdvanceTier` from colony.js
9. Add `calcBodyPoolMax(bodyId)` helper
10. Update `tickEconomy()` — pop housing cap clamp + pool cap clamp after loop
11. Update `updateHUD()` — add pool cap indicator

### Phase C — `js/edit-mode.js`

12. Import new colony.js exports
13. Extend `buildColonySectionHTML()` — BUILDINGS section + TIER ADVANCE row
14. Extend `wireColonyHandlers()` — wire upgrade + tier-advance buttons
15. Update founding cost display — Habitation level 1 cost (50⛏) is already folded
    into `foundingCost()`, so no change to the cost formula itself; just make sure
    the founding preview note says "includes Hab Pod infrastructure"

### Phase D — `styles.css`

16. Add building UI styles:
    - `.tp-buildings-section`, `.tp-bld-row`, `.tp-bld-name`, `.tp-bld-level`,
      `.tp-bld-upgrade-btn`, `.tp-bld-upgrade-btn:disabled`, `.tp-bld-max`
    - `.tp-tier-advance-row`, `.tp-tier-advance-btn`
    - `.sp-pool-cap` (pool capacity in settlement panel)

---

## Calibration Check

**Scenario: Bootstrap on a good tile (hab=0.8, food=0.65, water=0.55, metals=0.4, fuel=0.3)**

After founding (cost: food 60, water 60, metals 120, fuel 60):
Pool: food=440, water=440, metals=480, fuel=140
Colony: hab=1, farm=0, water=0, mine=0, fuel=0, storage=0, tier=outpost, pop=1

*Tick 1 (bootstrapping, no buildings)*
- Maint: food=round((2+1×0.002)×1.2)=round(2.4)=2, water=round(1.2)=1, fuel=round(1.2)=1
- Production: all zeroes (no buildings)
- Pop: round(1 × 1.001) = 1

Player must build a Farm to get any food production. First action: build Greenhouse (75⛏).
Pool metals: 480−75=405, colony.buildings.farm=1

*Tick 2 (still bootstrapping, farm=1)*
- workerFraction = 1/250 = 0.004 (very low pop vs cap)
- food = floor(0.65 × 100 × 3 × 0.004) = floor(0.78) = 0
- Pop grows slowly. Farm barely produces until pop builds up.

This is intentional — the first 90–180 days are a drain. The player's survival
strategy is: conserve pool food by growing pop slowly, then build infrastructure.

**At pop=100 (bootstrap still going), farm=1:**
- food prod = floor(0.65 × 100 × 3 × (100/250)) = floor(78) = 78 per tick
- maint food = round((2 + 0.2) × 1.2) = round(2.6) = 3 per tick
- Net: +75/tick — pool starts growing even during bootstrap

This seems fine. By bootstrap end (pop~120), the colony is self-sustaining on food
before metals/fuel are critical. The player still needs Mine for metals and Fuel
Tap for fuel, but food pressure is resolved early with the first building.

---

## Verification Checklist

1. Fresh outpost: production is zero on all four resources until buildings built
2. Build Greenhouse → food production appears; scales with tile's `resourceFood` × 100 × 3 × workerFraction
3. Pop halts at 250 (habitation=1 cap); building Habitat Module (200⛏) → cap becomes 5000, growth resumes
4. Pool does not exceed 500 + 2000×(colonies with storage=1); build Storage Unit → cap increases
5. Tier advance button appears when pop meets threshold; disabled when metals < cost; clicking promotes colony and enables building tier 2 upgrades
6. Building tier 2 upgrade buttons are greyed out on Outpost-tier colony; enabled after tier advance to Settlement
7. Per-capita maintenance scales correctly: pop=10k on hostile tile should cost ~230 food/tick
8. Starvation collapse still fires after 3 unpaid food ticks
9. Bootstrap 20% prod multiplier still applies to building-based production (not just zeroes)
10. Earth default: founding on a hab=0.9 tile, building Greenhouse, 30 ticks — pool stays positive
