# Colony Economy v2 — Gamification Plan

**Status:** Ready to implement
**Date:** March 2026
**Depends on:** COLONY_RESOURCE_PLAN.md (Phases 1–9 fully merged)

---

## Goal

Transform the colony system from a passive accumulation toy into a meaningful
resource-management game. Founding a settlement now costs resources, consumes
maintenance each tick, and goes through a slow-start bootstrap phase before
producing at full capacity. Run out of food for long enough and colonies collapse.

The tension model is deliberately inspired by:

- **Surviving Mars** — upfront supply investment + bootstrap dome phase + life
  support draining constantly
- **Stellaris** — habitability multiplies upkeep; starved pops die and reduce
  the city size
- **Anno** — per-body warehouse with visible net-income lines (production minus
  upkeep) per resource
- **Frostpunk** — scarcity creates a collapse cascade when you over-expand before
  your infrastructure can support the load

Buildings and a tech tree are explicitly **deferred to the next milestone** to keep
this iteration focused and shippable.

---

## Design Decisions

| Question | Decision |
|---|---|
| Resource pool model | Per-body pool keyed by `bodyId` (`state.bodyPools[bodyId]`); no shared cross-body pool until ships exist |
| Starting pool | Fixed starter pack per body: `{food:500, water:500, metals:600, fuel:200}` |
| What determines founding cost | Tile habitability index (`debugLayers.habitability`); guarded — founding only available when climate computed |
| Maintenance resources | Food + Water + Fuel only; Metals are a construction material, not life support |
| Collapse trigger | 3 consecutive ticks of unpaid food upkeep → population × 0.75; below 1 → abandoned |
| Population during bootstrap | Slow growth (× 1.001/tick) representing colonists arriving; full growth rate after bootstrap |
| Bootstrap timer | Stored as `bootstrapEndDay` (absolute game day); compared with `getGameDays()` — no countdown drift |
| Clock controls in planet view | Reuse `#systemBar` (already in DOM, hidden); show when any colonies exist for current body |
| Clock bar sync | `updateClockBarVisibility()` reads `isPaused()` from `game-clock.js` directly; no closure export needed |
| HUD update frequency | Decoupled from `tickEconomy`; separate 10fps-capped RAF draw |
| Buildings | Deferred to next milestone |
| Bodies not in view (solar mode) | Only the active body's economy ticks; per-body pool makes this natural |

---

## Core Formulas

### 1. Founding Cost

Drawn from `state.bodyPools[bodyId]` when the player clicks "Found Here".
Requires `state.climateComputed` — the "Found Here" button is only shown when
climate has been run, guaranteeing `debugLayers.habitability` is a valid
`Float32Array` and not null.

```
habitMult = 1 + (1 − habitability)     // 1.0 on ideal tile, 2.0 on bare rock
foundingCost = {
  food:   Math.round(50  × habitMult),   // 50 – 100
  water:  Math.round(50  × habitMult),   // 50 – 100
  metals: Math.round(100 × habitMult),   // 100 – 200   ← construction material
  fuel:   Math.round(50  × habitMult),   // 50 – 100
}
```

`metals` starting pool is 600 (not 200 as originally planned) so that even on
the most hostile tile (hab=0, metals cost=200), the player has 400 metals
remaining to found additional settlements and still hold meaningful reserves.

"Found Here" is **disabled** if any resource in the body's pool is below the
required cost amount. Each cost row in the tile panel turns red when the pool
can't cover it. A preview line also shows "Est. bootstrap: N days · Maint:
🌾−N/tick" so the player can evaluate the tile before committing.

### 2. Bootstrap Phase

Every newly founded colony has a reduced-productivity establishment window. During
this period maintenance runs at full rate but production runs at 20% to simulate
the colony team setting up infrastructure before it can operate at capacity.

```
bootstrapDuration = Math.round(90 + 90 × (1 − habitability))
// range: 90 days (hab=1) … 180 days (hab=0)

colony.bootstrapEndDay = foundedAtGameDay + bootstrapDuration
```

Stored as an **absolute game day** (snapshot of `getGameDays()`) so it's immune
to clock resets and tick-interval drift.

**During bootstrap (`getGameDays() < bootstrapEndDay`):**
- Maintenance is deducted at full rate
- Production is added at **20%** of normal rate
- Population grows at × 1.001/tick (colonists arriving gradually)
- Progress bar: `pct = (now − foundedAtGameDay) / bootstrapDuration × 100`

**After bootstrap:**
- Full production, full maintenance, normal population growth rate (× 1.005/tick)

### 3. Per-Tick Maintenance

Deducted from `state.bodyPools[bodyId]` at the start of every economy tick,
**before** production is added. Scales by colony tier and habitability penalty.

```
habitMult = 1 + (1 − colony.habitability)
tierMult  = TIER_MULTIPLIERS[getTier(pop).name]   // 1, 3, 8, 20, 50

maintenance = {
  food:   Math.round(5 × tierMult × habitMult),
  water:  Math.round(3 × tierMult × habitMult),
  fuel:   Math.round(3 × tierMult × habitMult),
  metals: 0,
}
```

**Example — Outpost on a moderate tile (hab=0.6):**
- habitMult = 1.4, tierMult = 1
- food: 7/tick, water: 4/tick, fuel: 4/tick

**Example — Colony tier (pop 10k) on a hostile tile (hab=0.1):**
- habitMult = 1.9, tierMult = 8
- food: 76/tick, water: 46/tick, fuel: 46/tick

### 4. Economy Tick Order

Runs every 30 game days. The tick interval passed to the bootstrap check is the
exact delta `gameDays − lastEconomyTickDays`, not a fixed constant — this is
irrelevant now that bootstrap uses absolute day comparison, but matters for
correct maintenance deduction accounting.

```
const toAbandon = []

for each colony where colony.bodyId === activeBodyId:

  const pool = state.bodyPools[colony.bodyId]
  if (!pool) continue

  1. Bootstrap check (absolute day comparison, no drift)
     const inBootstrap = getGameDays() < colony.bootstrapEndDay

  2. Deduct maintenance from pool
     const maint = maintenanceCost(colony)
     const hadFood = pool.food >= maint.food
     pool.food  = max(0, pool.food  − maint.food)
     pool.water = max(0, pool.water − maint.water)
     pool.fuel  = max(0, pool.fuel  − maint.fuel)
     if hadFood: colony.starvationTicks = 0
     else:       colony.starvationTicks++

  3. Add production (full rate if active, 20% if bootstrapping)
     const rates    = colonyProductionRates(colony, curData)
     const prodMult = inBootstrap ? 0.20 : 1.0
     pool.food   += Math.round(rates.food   * prodMult)
     pool.water  += Math.round(rates.water  * prodMult)
     pool.metals += Math.round(rates.metals * prodMult)
     pool.fuel   += Math.round(rates.fuel   * prodMult)

  4. Population growth
     const growthRate = inBootstrap ? 1.001 : 1.005
     colony.population = Math.round(colony.population * growthRate + (inBootstrap ? 0 : 5))

  5. Queue starvation/abandonment (don't mutate array mid-loop)
     if colony.starvationTicks >= 3:
       colony.population = Math.floor(colony.population * 0.75)
       if colony.population < 1: toAbandon.push(colony)

// After loop — safe mutation
for each abandoned in toAbandon:
  state.colonies = state.colonies.filter(c => c.id !== abandoned.id)
  showNotice(`${abandoned.name} has been abandoned.`)
if toAbandon.length > 0:
  drawColonyMarkers(state.colonies, activeBodyId)
  updateMapColonyMarkers(...)
```

### 5. Tension Calibration Check

Founding 4 outposts simultaneously — moderate hab (≈0.6), food potential ≈0.4:

| Event | Pool food | Pool metals | Note |
|---|---|---|---|
| Start | 500 | 600 | Starter pack |
| Found ×4 | 500 − 4×70 = 220 | 600 − 4×140 = 40 | Each costs 140 metals |
| Tick 1 (bootstrapping, 20% prod) | 220 − 28 + 4×(40×0.2) = 224 | +minerals | Nearly break-even on food already |
| Tick 4 (bootstrap ends ~120 days) | ~232 | growing | Full production resumes |
| Net steady-state (4 outposts) | +4×(40−7) = +132/tick | — | Comfortable |

The metals constraint is live: starting 600 − 4×140 = 40 metals remaining. A 5th
outpost on a hostile tile (cost ~200) is already blocked. This is the intended
gate — metals limit simultaneous founding, food/fuel recover quickly once bootstrap
ends.

---

## Data Model Changes

### `js/colony.js`

**Add / change:**
```js
/** Starting resource pool issued per body on first founding action. */
export const STARTING_POOL = { food: 500, water: 500, metals: 600, fuel: 200 };

/**
 * Founding cost scaled by habitability (0–1).
 * Requires climate to be computed (habitability array must be valid before calling).
 */
export function foundingCost(habitability) {
    const m = 1 + (1 - Math.max(0, Math.min(1, habitability)));
    return {
        food:   Math.round(50  * m),
        water:  Math.round(50  * m),
        metals: Math.round(100 * m),
        fuel:   Math.round(50  * m),
    };
}

/** Per-tick maintenance drawn from the body pool. Metals always 0. */
export function maintenanceCost(colony) {
    const m = 1 + (1 - Math.max(0, Math.min(1, colony.habitability)));
    const t = TIER_MULTIPLIERS[getTier(colony.population).name] ?? 1;
    return {
        food:   Math.round(5 * t * m),
        water:  Math.round(3 * t * m),
        fuel:   Math.round(3 * t * m),
        metals: 0,
    };
}
```

**Modify `createColony()`:**
- Remove `stockpile` field
- Add `foundedAtDay: opts.gameDays ?? 0` (snapshot of `getGameDays()` at founding)
- Add `bootstrapEndDay: (opts.gameDays ?? 0) + Math.round(90 + 90 * (1 - (opts.habitability ?? 0.5)))`
- Add `starvationTicks: 0`
- Add `habitability: opts.habitability ?? 0.5`

### `js/core/state.js`

```js
// Per-body resource pools — keyed by bodyId (e.g. 'standalone', 'earth', 'mars').
// Initialized lazily in wireColonyHandlers on first founding action per body.
// Cleared for a body on rebuild (same as state.colonies cleanup).
bodyPools: {},
```

Remove the old `globalPool: null` (was never added; this replaces it).

### `js/main.js`

**Pool initialization — lazy, in `wireColonyHandlers` (edit-mode.js):**
The pool for a body is created the first time a colony is founded there:
```js
if (!state.bodyPools[bodyId]) {
    state.bodyPools[bodyId] = { ...STARTING_POOL };
}
```
This is simpler than trying to initialize in `enterSystemMode` or `generate-done`
and eliminates the "solar mode never initializes pool" bug entirely.

**Rebuild cleanup — add pool clear:**
```js
// In generate-done handler where colonies are cleared:
if (!state.currentSystem) {
    state.colonies = state.colonies.filter(c => c.bodyId !== 'standalone');
    delete state.bodyPools['standalone'];
}
```
For solar-mode body rebuilds, delete `state.bodyPools[bodyId]` for the rebuilt body.

**Rewrite `tickEconomy(gameDays)`** — follow the per-body tick order in the formula
section above. Guard: `if (!state.activeBodyId && !state.currentSystem) return` to
skip when no body is active. After loop, call the HUD draw function (not directly —
see HUD decoupling below).

**HUD update decoupling — separate RAF-throttled draw function:**
```js
let _hudDirty = false;
let _lastHudDraw = 0;

function markHudDirty() { _hudDirty = true; }

// Called every animation frame (inside animate()):
function maybeDrawHud(now) {
    if (!_hudDirty) return;
    if (now - _lastHudDraw < 100) return; // cap at 10fps
    _lastHudDraw = now;
    _hudDirty = false;
    updateHUD();
}
```
`tickEconomy` calls `markHudDirty()` instead of `updateHUD()` directly.
`wireColonyHandlers` (after founding) also calls `markHudDirty()`.
`maybeDrawHud(performance.now())` is called once per frame in `animate()`.

**`updateClockBarVisibility()`:**
```js
function updateClockBarVisibility() {
    const bar = document.getElementById('systemBar');
    if (!bar) return;
    const bodyId = state.activeBodyId || 'standalone';
    const hasColonies = state.colonies.some(c => c.bodyId === bodyId);
    const show = hasColonies || state.solarSystemMode;
    bar.classList.toggle('hidden', !show);
    if (show) {
        // Sync pause button without touching solar-ui.js internals
        document.getElementById('btnPause')
            ?.classList.toggle('paused-state', isPaused());
    }
}
```
Import `isPaused` from `game-clock.js` (already imported in `solar-ui.js`, just
needs adding to `main.js`). No export changes to `solar-ui.js` required.

**Fix `lastEconomyTickDays` / clock-reset bug:**
In the `generate-done` cleanup handler (and wherever `enterSystemMode` is triggered
from `main.js`), add:
```js
state.lastEconomyTickDays = getGameDays();
```
This must also be called in `solar-ui.js` after `resetClock()` in `enterSystemMode`,
since `resetClock()` is what resets `_gameDays` back to epoch. The fix: in
`solar-ui.js` after line 371 (`resetClock()`), add:
```js
state.lastEconomyTickDays = getGameDays(); // sync after clock reset
```

**Rewrite `updateHUD()`:**
- Top section: body pool totals (`state.bodyPools[bodyId]`)
- If pool not yet initialized: show "No settlements yet" / hidden state
- Second row: total net rates (sum production × prodMult − sum maintenance); shown
  as `+N` green / `−N` red; zero shown neutral
- Per-colony row:
  - Name + tier + pop
  - If bootstrapping: progress bar + `pct%` label + maintenance drain (dimmed)
  - If active: 4-resource prod/maint/net mini-table; starvation `⚠ N/3` badge

### `js/edit-mode.js`

**`buildColonySectionHTML(region)` — three states:**

**State 1: No colony** (climate computed, so habitability is valid)
```
┌─────────────────────────────────────────┐
│ COLONY                                  │
│ No settlement here.                     │
│                                         │
│ FOUNDING COST                           │
│ 🌾 Food    50  ← red if pool too low   │
│ 💧 Water   50                           │
│ ⛏  Metals  100                          │
│ ⚡ Fuel    50                           │
│ Est. bootstrap: 120 days · 🌾−7/tick   │
│                                         │
│ [Name this colony…]  [ Found Here ]     │
└─────────────────────────────────────────┘
```

**State 2: Colony in bootstrap phase**
```
┌─────────────────────────────────────────┐
│ COLONY                                  │
│ Bradbury Station · Outpost · Pop: 3     │
│ ▓▓▓▓▓▓░░░░░░░░░░ 42%  Establishing…   │
│ 63 days remaining                       │
│                                         │
│ MAINTENANCE (per tick)                  │
│ 🌾 −7   💧 −4   ⚡ −4                  │
│ PRODUCTION (20%)                        │
│ 🌾 +8   💧 +6   ⛏ +19   ⚡ +12        │
└─────────────────────────────────────────┘
```

**State 3: Colony active**
```
┌─────────────────────────────────────────┐
│ COLONY                                  │
│ Bradbury Station · Settlement · Pop: 4,200 │
│                                         │
│       Prod   Maint    Net               │
│ 🌾    +120   −21    +99  ←green        │
│ 💧    +80    −13    +67  ←green        │
│ ⛏    +96      0    +96  ←green        │
│ ⚡    +61    −13    +48  ←green        │
└─────────────────────────────────────────┘
```
Starvation warning inserted below name when `colony.starvationTicks > 0`:
```
⚠ Starving (2/3 ticks) — food shortage
```

**Tile panel live-update while open:**
In `showTilePanel()`, after rendering, store `_openPanelRegion = region`. In the
`maybeDrawHud` path (or a separate throttled RAF), if `_openPanelRegion !== null`
and the tile panel is visible, re-render the colony section in-place (only the
`.tp-colony-sec` subtree) so bootstrap progress and starvation badges stay current
without closing and reopening the panel.

**`wireColonyHandlers(panel, region)` changes:**
- `habitability = state.curData.debugLayers.habitability[region]` — no `?? 0.5`
  fallback needed here because the section is only rendered when climate is computed
  (the outer guard `state.climateComputed` in `buildTilePanelHTML` ensures the
  habitability array is valid)
- `cost = foundingCost(habitability)`
- Lazy-init body pool: `if (!state.bodyPools[bodyId]) state.bodyPools[bodyId] = { ...STARTING_POOL }`
- `canAfford(cost, state.bodyPools[bodyId])` before enabling button
- On click: deduct cost, call `createColony({ ..., habitability, gameDays: getGameDays() })`
- Call `markHudDirty()` (not `window._refreshHUD?.()`)

**Add helper `canAfford(cost, pool)`:**
```js
function canAfford(cost, pool) {
    return !!pool && RESOURCE_TYPES.every(t => (pool[t] ?? 0) >= (cost[t] ?? 0));
}
```

### `js/solar-ui.js`

**One-line fix only — after `resetClock()` at line 371:**
```js
resetClock();
state.lastEconomyTickDays = getGameDays(); // prevent tick debt / freeze after clock reset
```
No export changes required.

### `styles.css`

```css
/* Founding cost row — unaffordable amount */
.tp-cost-amount.unaffordable { color: #e05050; font-weight: 600; }
.tp-cost-preview { font-size: 11px; color: #888; margin: 3px 0 6px; }

/* Bootstrap progress bar */
.tp-bootstrap-bar-bg  { flex: 1; height: 4px; background: rgba(255,255,255,0.12); border-radius: 2px; }
.tp-bootstrap-bar-fill { height: 100%; background: #4499ee; border-radius: 2px; transition: width 0.4s; }
.tp-bootstrap-row { display: flex; align-items: center; gap: 6px; margin: 4px 0 2px; font-size: 12px; }

/* Net production colors */
.sp-net-positive { color: #66cc66; }
.sp-net-negative { color: #e05050; }

/* Starvation badge */
.tp-starvation-warn { color: #e08830; font-size: 11px; font-weight: 600; margin: 2px 0; }

/* Founding cost breakdown table */
.tp-cost-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 12px; }
.tp-cost-label { width: 46px; color: #aaa; }
.tp-cost-amount { width: 36px; text-align: right; color: #ccc; }
.tp-insufficient-hint { font-size: 11px; color: #e05050; margin: 4px 0 0; }
```

---

## File Change Summary

| File | Change |
|---|---|
| `js/colony.js` | Add `STARTING_POOL`, `foundingCost()`, `maintenanceCost()`; update `createColony()` schema |
| `js/core/state.js` | Add `bodyPools: {}` |
| `js/main.js` | `markHudDirty()`/`maybeDrawHud()` HUD decoupling; rewrite `tickEconomy()`; rewrite `updateHUD()`; `updateClockBarVisibility()` with `isPaused()` import; add `getGameDays` import |
| `js/edit-mode.js` | Rewrite `buildColonySectionHTML()` (3 states + preview); update `wireColonyHandlers()` (lazy pool init, deduct cost, pass habitability); live panel refresh; `canAfford()` helper |
| `js/solar-ui.js` | One-line fix: `state.lastEconomyTickDays = getGameDays()` after `resetClock()` |
| `styles.css` | Cost row, bootstrap bar, net-rate colors, starvation badge, preview line |

---

## Implementation Phases

### Phase A — Economy Model (`colony.js`, `state.js`, `main.js` tickEconomy)

No UI dependencies. Verify via `state.bodyPools` in the browser console.

- A1: Add `STARTING_POOL`, `foundingCost()`, `maintenanceCost()` to `colony.js`; update `createColony()` schema
- A2: Replace `globalPool`/`stockpile` references with `bodyPools[bodyId]` in `state.js`
- A3: Fix clock-reset bug: add `state.lastEconomyTickDays = getGameDays()` in `solar-ui.js` after `resetClock()`
- A4: Rewrite `tickEconomy()` with new tick order (per-body pool, absolute bootstrap check, population growth split, toAbandon post-loop)
- A5: Add `markHudDirty()`/`maybeDrawHud()` pattern; wire `maybeDrawHud` into animate loop; update `tickEconomy` to call `markHudDirty()` not `updateHUD()` directly
- A6: Add `updateClockBarVisibility()` to `main.js` (imports `isPaused` from `game-clock.js`); wire into rebuild cleanup

### Phase B — Tile Panel UI (`edit-mode.js`)

Depends on Phase A.

- B1: Add `canAfford()` helper
- B2: Rewrite `buildColonySectionHTML()` — all three states with preview line and live-update hook
- B3: Update `wireColonyHandlers()` — lazy pool init, deduct on found, pass `habitability` and `gameDays`

### Phase C — Settlement Panel (`main.js` updateHUD)

Depends on Phase A.

- C1: Rewrite `updateHUD()` — per-body pool display, net rate row, per-colony state rows
- C2: Add bootstrap progress bar (compute from `foundedAtDay`/`bootstrapEndDay`) and starvation badge
- C3: Add `styles.css` entries

### Phase D — Clock Bar in Planet View

Depends on Phase A (pool + colonies initialized).

- D1: `updateClockBarVisibility()` already calls `isPaused()` — no `solar-ui.js` export needed
- D2: Wire `updateClockBarVisibility()` into `updateHUD()` and rebuild cleanup
- D3: Import `isPaused` from `game-clock.js` in `main.js`

---

## Verification Checklist

- [ ] Found outpost on good tile (hab ≈ 0.8) — `state.bodyPools[bodyId]` drops by founding cost; cost rows show correct scaled amounts
- [ ] "Found Here" grayed out when pool < founding cost; individual cost amounts shown in red; preview line shows estimated bootstrap duration and maintenance/tick
- [ ] Bootstrap progress bar and percentage tick up correctly as clock runs; production in pool during bootstrap is 20% (not zero) of full rate; population grows slowly (×1.001/tick)
- [ ] After bootstrap ends — production jumps to full rate; tile panel auto-updates to show active state (bootstrap section replaced with prod/maint/net table)
- [ ] Found 4+ colonies simultaneously on hostile tiles — metals in pool nearly exhausted (600 − 4×140 = 40); attempting a 5th high-cost colony is blocked
- [ ] After 3 starved ticks — colony population × 0.75; abandoned colony disappears from settlement panel and globe markers
- [ ] Settlement panel shows body pool totals (not per-colony stockpiles); values update at ≤10fps (not every tick)
- [ ] Net rate row: positive = green; goes red when colonies drain more than they produce
- [ ] Clock bar appears above globe when first colony is founded; hidden again after rebuild
- [ ] Rebuild planet — `state.bodyPools['standalone']` deleted; colonies cleared; clock bar hidden
- [ ] Harsh tile (hab ≈ 0.1) — founding cost ≈ 2× (metals ≈ 200); bootstrap ~180 days; higher maintenance per tick
- [ ] Tier promotion — maintenance jumps (tierMult × 3 for settlement); settlement panel updates correctly
- [ ] Solar system mode — clock bar visible; only active body's colonies tick; each body has its own pool
- [ ] Enter solar mode, exit, re-enter — `lastEconomyTickDays` correctly reset; no starvation backlog from clock reset

---

## Known Implementation Notes

| Concern | Resolution |
|---|---|
| **Starvation priority order** | Colonies iterate in array order (oldest first). When the pool has food but not enough for all colonies, the oldest colony gets paid first and younger ones starve. This is intentional — it rewards early settlers and reflects supply-chain logic. Document in code with a comment. |
| **`window._refreshHUD` global** | Still used by `wireColonyHandlers` but should be replaced with `markHudDirty()` once Phase A lands. The global is low-priority technical debt — track it but don't block on it. |
| **Tile panel stale data** | The open tile panel shows a snapshot rendered at `showTilePanel()` time. Live colony section refresh is handled by the `_openPanelRegion` + `maybeDrawHud` path (see Phase B). |
| **Climate guard for founding** | The "Found Here" button is only shown when `state.climateComputed === true`. This guarantees `debugLayers.habitability` is a valid `Float32Array`. No `?? 0.5` fallback needed in `wireColonyHandlers`. If climate is not computed, the tile panel shows a "Run climate simulation to found colonies" hint instead. |
| **Pool for solar vs standalone** | `bodyId` for standalone planet view is the string `'standalone'` (matches existing colony creation logic). For solar system bodies, use `body.id` as the key (e.g. `'earth'`, `'mars'`). Ensure generate-done cleanup only deletes `bodyPools['standalone']` when NOT in solar mode — solar body rebuilds delete only that body's pool. |
| **`foundedAtDay` snapshots** | Store `getGameDays()` at the moment `createColony()` is called, not the tick that processes the founding. Passing as `opts.gameDays`. The bootstrap window is then `bootstrapEndDay = opts.gameDays + duration`, preventing off-by-one-tick errors. |

---

## Forward Path (next milestones)

| Item | Notes |
|---|---|
| Buildings | Upgrade slot per colony — spend metals to construct Hydroponic Bay (+food%), Mine (+metals%), Fuel Depot (+fuel%). Colony already has `habitability` field available. |
| Colony persistence | Save `state.colonies` + `state.globalPool` to localStorage (extend `system-storage.js`) |
| Ship system | Ships carry resources between colony bodies in solar system mode; drives real trade decisions |
| Inter-body resource flow | Global pool per body, ships transfer between them |
| Rare earth metals | 5th resource driven by `r_stress × gravityScale` with steep ore-vein concentration |
