# Colony & Resource System — Implementation Plan

**Status:** Ready to implement  
**Date:** March 2026  
**Depends on:** TILE_PANEL_PLAN.md (Phases 1–4 must be merged first)

---

## Goal

Extend the planet generator and solar system mode with a colony-founding and
per-colony resource economy. Players scout tile resource potential from the tile
detail panel, found colonies on promising sites, and watch their inventories grow
via a game-clock-driven economy tick.

Four resources launch in this milestone: **Food**, **Water**, **Metals**, **Fuel**.
They are generated as per-tile probability layers during the planet pipeline and are
fully grounded in the simulation data, not hardcoded numbers.

---

## Design Decisions

| Question | Decision |
|---|---|
| Resource granularity | Per-tile, computed during generation |
| Pipeline hook | After Köppen classification, inside `planet-worker.js` |
| Starting resources | 4 — food, water, metals, fuel (expand later as trade routes need variety) |
| Stockpile model | Per-colony inventory; HUD shows sums across active body's colonies |
| Colony persistence | In-session only (same as planet terrain); cross-session is follow-on |
| Colony markers | 3D dot on globe + CSS overlay dot on map |
| HUD | Fixed compact strip, visible when a body is active in system mode |
| Found-colony UX | Inline name input in the tile panel (replaces the "Found Settlement" stub) |
| Rebuild behavior | Colonies cleared on rebuild; warn user if any exist |
| Files | Top-level `js/` alongside existing modules |

---

## Resource Formula Design

### Why these inputs

Each resource derives from physically meaningful simulation data:

- **Food** — life and crop viability. Driven by temperature (bell-curve peaking at
  ~22°C), precipitation (wetter = more biomass), and elevation (flat lowlands are
  arable; high alpine suppresses). Atmosphere level gates it globally (no air, no
  photosynthesis, no food).

- **Water** — accessible liquid or ice. Ocean tiles are high; land tiles track
  precipitation and sub-zero ice bonuses. Atmosphere level and `hasLiquidOcean`
  gate it globally.

- **Metals** — tectonic ore concentration, the key insight: `r_stress` in the
  simulation already encodes convergent-plate-boundary stress propagated inward.
  Real-world ore deposits (copper, iron, gold, molybdenum) are overwhelmingly
  concentrated in orogenic belts formed at subduction and collision zones — exactly
  what `r_stress` marks. Mountains are a secondary visual signal but stress is the
  primary driver. Gravity further scales it (denser-core high-gravity worlds have
  deeper crustal recycling and richer veins).

- **Fuel** — two independent components blended 50/50: biotic (decompressed organic
  matter → fossil fuels) driven by food potential × heavy-precip signal; geothermal
  (volcanic/mountain proximity) driven by `r_stress`. High-atmosphere worlds get a
  hydrocarbon bonus emulating Titan-type deep methane lakes.

### Inputs used (all available at time of resource computation)

| Array | Where it comes from |
|---|---|
| `r_stress` | `elevation.js` → `propagateStress()` (convergent-boundary stress, BFS-propagated inward) |
| `mountain_r` | `elevation.js` (Set of convergent-boundary cells before erosion) |
| `r_elevation` | Terrain post-processing output (km, land > 0, ocean ≤ 0) |
| `tempResult.r_temperature_summer/winter` | `temperature.js` (normalized 0–1, decoded via `tempScaleMin/Max`) |
| `precipResult.r_precip_summer/winter` | `precipitation.js` (normalized 0–1, × 1000 for mm proxy) |
| `planetaryParams.*` | `buildPlanetaryParams()` output: `atmosphere`, `hasLiquidOcean`, `gravity`, `baseTemp` |

### Formulas

All values produce a `Float32Array(numRegions)` in range `[0, 1]`.

#### Food Potential (`r_resource_food`)

```js
const T_RANGE = tempResult.tempScaleMax - tempResult.tempScaleMin;
for each region r:
  if r_elevation[r] <= 0:
    food[r] = 0                     // ocean: no crops
    continue
  tAnn = tempResult.tempScaleMin + 0.5*(tSummer[r]+tWinter[r]) * T_RANGE  // °C
  pAnn = (pSummer[r] + pWinter[r]) * 1000                                 // mm proxy
  tempScore  = exp(-((tAnn - 22) / 20)²)       // bell curve: peak 22°C, ~0 below -10°C or above 55°C
  precipScore = clamp(pAnn / 2000, 0, 1)
  elevScore  = max(0, 1 - clamp(r_elevation[r] / 3.0, 0, 1))  // 0 at 3km+
  atmGate    = clamp(params.atmosphere / 3, 0, 1)             // 0 for airless
  food[r]    = tempScore × precipScore × elevScore × atmGate
```

#### Water Potential (`r_resource_water`)

```js
for each region r:
  if r_elevation[r] <= 0:                         // ocean tile
    if params.hasLiquidOcean:  water[r] = 1.0
    elif tAnn <= -30:          water[r] = 0.5     // ice ocean
    else:                      water[r] = 0.05    // dry basin
    continue
  // land tile
  pAnn = (pSummer[r] + pWinter[r]) * 1000
  precipScore = clamp(pAnn / 1200, 0, 0.9)
  iceBonus    = (tAnn < -5) ? 0.35 : 0.0          // glaciers, ice fields
  water[r]    = max(precipScore, iceBonus)
  if params.atmosphere === 0:  water[r] = min(water[r], 0.1)  // airless worlds: trace only
```

#### Metal Deposits (`r_resource_metals`)

```js
// Normalize r_stress to 0–1 using 95th-percentile (same approach as elevation.js)
const stressVals = [...r_stress].filter(v => v > 0.01).sort((a,b) => a-b)
const p95 = stressVals[Math.floor(stressVals.length * 0.95)] || 1
const stressMax = Math.max(p95, 0.001)

for each region r:
  stressScore = clamp(r_stress[r] / stressMax, 0, 1)
  mtnBonus    = mountain_r.has(r) ? 0.25 : 0.0         // convergent-boundary cells get a top-up
  elevScore   = r_elevation[r] > 0
                  ? clamp(r_elevation[r] / 4.0, 0.15, 0.70)  // land: modest to high
                  : 0.10                                       // ocean floor: low (seafloor nodules)
  // Ore-patch clustering: fast integer hash for spatial variation without simplex dependency
  hash = (r * 2654435761 >>> 0) / 4294967295             // Knuth multiplicative hash
  clusterNoise = 0.55 + 0.45 * hash                      // range [0.55, 1.0]
  gravityScale = clamp(params.gravity * 0.7 + 0.3, 0.3, 1.5)  // denser cores on heavier worlds
  metals[r] = clamp((stressScore * 0.55 + mtnBonus + elevScore * 0.20) * clusterNoise * gravityScale, 0, 1)
```

*Why this works:* `r_stress` is highest right at convergent boundaries and falls off
inward. Subduction zones deliver metal-rich oceanic crust to the magmatic arc;
collision belts fold and expose ore-bearing rocks. The formula faithfully mirrors this:
high-stress orogenic cells are the richest ore sites.

#### Fuel Potential (`r_resource_fuel`)

```js
for each region r:
  // Biotic component (fossil fuels, peat, biomass energy)
  pAnn    = (pSummer[r] + pWinter[r]) * 1000
  bioScore = food[r] * clamp(pAnn / 1500, 0, 1)   // needs life AND heavy rain

  // Geothermal component (volcanic heat, hydrothermal vents)
  geoScore = clamp(r_stress[r] / stressMax, 0, 1) * 0.7   // orogenic heat
  if r_elevation[r] > 1.5: geoScore = max(geoScore, 0.4)  // midplate volcanism proxy

  // Hydrocarbon bonus (Titan-type thick-atm worlds)
  hydrocarbon = (params.atmosphere >= 4) ? 0.4 : 0.0

  fuel[r] = clamp(0.5 * bioScore + 0.5 * geoScore + hydrocarbon, 0, 1)
```

### Scale Invariance

All formulas operate on physical values decoded from normalized floats:
- Temperature decoded via `tempScaleMin/Max` → always °C
- Precipitation multiplied by 1000 → mm proxy
- Elevation is already in km
- Stress normalized to its own 95th percentile (same approach as elevation.js)
- Integer hash (Knuth multiplicative) is per-region, not distance-dependent

**No BFS hops, no smoothing passes.** Fully resolution-independent. ✓

---

## Tile Panel Integration

The resource section appears **between the Climate section and the Colony section** in
the tile panel. It requires climate to have been computed (same guard as Köppen display).

### Resource Section Layout

```
┌──────────────────────────────┐
│ RESOURCE POTENTIAL           │
│                              │
│ 🌾 Food    ████░░░░  52%     │
│ 💧 Water   ██░░░░░░  28%     │
│ ⛏ Metals  ███████░  84%     │
│ ⚡ Fuel    █████░░░  62%     │
│                              │
│ (shown only if climate       │
│  has been computed)          │
└──────────────────────────────┘
```

Each row: icon + label + small progress-bar + percentage. Progress bars use a
resource-specific color:
- Food: `#6aaa3a` (green)
- Water: `#4488cc` (blue)
- Metals: `#aaaaaa` (silver-grey)
- Fuel: `#dd8833` (amber-orange)

**No resource section is shown if `!state.climateComputed`** — instead the climate
section shows its existing graceful fallback ("Compute Climate to see climate data"),
and the resource section is simply omitted.

### Colony Section Layout (evolved from tile panel plan stub)

**When no colony:**
```
┌──────────────────────────────┐
│ COLONY                       │
│ No settlement here yet.      │
│ ┌──────────────────────────┐ │
│ │ Colony name…             │ │
│ └──────────────────────────┘ │
│              [ Found Here ]  │
└──────────────────────────────┘
```
Input is `<input type="text" maxlength="32" placeholder="Name this colony…">`.
The "Found Here" button is enabled only when the input is non-empty and climate
has been computed (resources need to be known for production rates).

**When colony exists:**
```
┌──────────────────────────────┐
│ COLONY                       │
│ Bradbury Station             │
│ Settlement · Pop: 12,400     │
│ ─────────────────────────── │
│ STOCKPILE (this tick cycle)  │
│ 🌾 Food    +48  total 2,304  │
│ 💧 Water   +12  total  890   │
│ ⛏ Metals  +96  total 5,100  │
│ ⚡ Fuel    +61  total 3,211  │
└──────────────────────────────┘
```

---

## Files Changed

| File | Change |
|---|---|
| `js/resources-gen.js` | **New** — `computeResourceLayers()` pure function |
| `js/colony.js` | **New** — colony data model, tiers, production rates |
| `js/planet-worker.js` | Import + call `computeResourceLayers` after Köppen; add to `debugLayers` |
| `js/state.js` | Add `colonies: []`, `lastEconomyTickDays: 0` |
| `js/planet-mesh.js` | `drawColonyMarkers()`, `clearColonyMarkers()`, `updateMapColonyMarkers()`; debug layer color ramps for 4 resource layers |
| `js/edit-mode.js` | Add resource section + evolved colony section to `buildTilePanelHTML()`; found-colony confirm handler (*after tile panel plan merge*) |
| `js/main.js` | `tickEconomy()`, `updateHUD()`, rebuild warning, `drawColonyMarkers` call sites |
| `index.html` | `<div id="heliosphereHud">`, 4 resource debug-layer buttons under "Resources" group |
| `styles.css` | HUD strip, `.tp-resource-bar`, `.colonyMapDot`, resource debug layer color ramps |
| `README.md` | Resource mechanics, tile panel resource row, colony tier table, HUD |

---

## Implementation Phases

### Phase 1 — Resource Generation (`js/resources-gen.js` + pipeline hook)

**Step 1.1 — Create `js/resources-gen.js`**

```js
export function computeResourceLayers(mesh, params, tempResult, precipResult, r_elevation, r_stress, mountain_r) {
    const N = mesh.numRegions;
    const r_resource_food   = new Float32Array(N);
    const r_resource_water  = new Float32Array(N);
    const r_resource_metals = new Float32Array(N);
    const r_resource_fuel   = new Float32Array(N);
    // … formulas as specced above …
    return { r_resource_food, r_resource_water, r_resource_metals, r_resource_fuel };
}
```

Also export constants shared with economy tick:
```js
export const RESOURCE_TYPES = ['food', 'water', 'metals', 'fuel'];
export const RESOURCE_LABELS = { food: 'Food', water: 'Water', metals: 'Metals', fuel: 'Fuel' };
export const RESOURCE_ICONS  = { food: '🌾', water: '💧', metals: '⛏', fuel: '⚡' };
export const RESOURCE_COLORS = { food: '#6aaa3a', water: '#4488cc', metals: '#aaaaaa', fuel: '#dd8833' };
```

**Step 1.2 — Hook into `js/planet-worker.js`**

After the Köppen classification block:
```js
// Resource potential layers (requires climate)
import { computeResourceLayers } from './resources-gen.js';

// (inside skipClimate block, after koppen):
const { r_resource_food, r_resource_water, r_resource_metals, r_resource_fuel }
    = computeResourceLayers(mesh, planetaryParams, tempResult, precipResult, r_elevation, r_stress, mountain_r);
debugLayers.resourceFood   = r_resource_food;
debugLayers.resourceWater  = r_resource_water;
debugLayers.resourceMetals = r_resource_metals;
debugLayers.resourceFuel   = r_resource_fuel;
```

Also add the four `Float32Array` buffers to the `transferList` for zero-copy transfer.

**Scale invariance check:** formulas use decoded °C + mm proxy + km elevations +
stress normalized to its own max. No resolution-dependent magic numbers. ✓

---

### Phase 2 — Colony Data Model (`js/colony.js`)

```js
export const COLONY_TIERS = [
    { name: 'outpost',   min: 1,      max: 99      },
    { name: 'settlement',min: 100,    max: 9_999   },
    { name: 'colony',    min: 10_000, max: 999_999 },
    { name: 'city',      min: 1e6,    max: 99e6    },
    { name: 'megacity',  min: 1e8,    max: Infinity},
];
export const TIER_MULTIPLIERS = { outpost:1, settlement:3, colony:8, city:20, megacity:50 };

export function getTier(pop) { /* walk COLONY_TIERS until max >= pop */ }

export function createColony({ bodyId, systemId, region, lat, lon, name, gameDays }) {
    return {
        id: `colony-${Date.now()}-${region}`,
        bodyId, systemId, region, lat, lon, name,
        population: 1,
        resources: { food: 0, water: 0, metals: 0, fuel: 0 },
        foundedAt: gameDays ?? 0,
    };
}

// Returns per-tick resource gain for one colony.
// Reads potential from curData.debugLayers; scales by tier.
export function colonyProductionRates(colony, curData) {
    const dl = curData?.debugLayers;
    if (!dl?.resourceFood) return { food: 0, water: 0, metals: 0, fuel: 0 };
    const mult = TIER_MULTIPLIERS[getTier(colony.population)] ?? 1;
    return {
        food:   (dl.resourceFood  [colony.region] ?? 0) * mult * 10,
        water:  (dl.resourceWater [colony.region] ?? 0) * mult * 10,
        metals: (dl.resourceMetals[colony.region] ?? 0) * mult * 10,
        fuel:   (dl.resourceFuel  [colony.region] ?? 0) * mult * 10,
    };
}
```

---

### Phase 3 — State & Colony Array (`js/state.js`)

Add to the exported state object:
```js
colonies: [],
lastEconomyTickDays: 0,
```

---

### Phase 4 — Economy Tick (`js/main.js`)

```js
function tickEconomy(gameDays) {
    if (gameDays - state.lastEconomyTickDays < 30) return;
    state.lastEconomyTickDays = gameDays;

    const bodyColonies = state.colonies.filter(c => c.bodyId === state.activeBodyId);
    for (const colony of bodyColonies) {
        const rates = colonyProductionRates(colony, state.curData);
        for (const type of RESOURCE_TYPES) {
            colony.resources[type] += rates[type];
        }
        // Population growth: 0.5% per tick, capped at tier max
        const tier = COLONY_TIERS.find(t => t.name === getTier(colony.population));
        colony.population = Math.min(
            Math.floor(colony.population * 1.005),
            tier?.max ?? Infinity
        );
    }
    updateHUD();
}
```

Hook: called in the solar-system render loop at the same call site as `tickClock(delta)`:
```js
const gameDays = getGameDays();
tickClock(delta);
tickOrrery(gameDays);
if (state.activeBodyId) tickEconomy(gameDays);
```

---

### Phase 5 — Found Colony UX in Tile Panel (`js/edit-mode.js`)

*This phase depends on TILE_PANEL_PLAN.md being fully merged first.*

**Step 5.1 — Resource section** (add to `buildTilePanelHTML` before colony section):

```js
// Resource Potential section (requires climate)
if (state.climateComputed && dl?.resourceFood) {
    const dl = state.curData.debugLayers;
    html += `<div class="tp-section">
      <div class="tp-section-header">Resource Potential</div>`;
    for (const type of RESOURCE_TYPES) {
        const val = dl[`resource${capitalize(type)}`]?.[region] ?? 0;
        const pct = Math.round(val * 100);
        html += `<div class="tp-resource-row">
          <span class="tp-resource-icon">${RESOURCE_ICONS[type]}</span>
          <span class="tp-resource-label">${RESOURCE_LABELS[type]}</span>
          <div class="tp-resource-bar-bg">
            <div class="tp-resource-bar-fill" style="width:${pct}%;background:${RESOURCE_COLORS[type]}"></div>
          </div>
          <span class="tp-resource-pct">${pct}%</span>
        </div>`;
    }
    html += `</div>`;
}
```

**Step 5.2 — Colony section** (replace disabled stub):

```js
const existing = state.colonies.find(c => c.bodyId === state.activeBodyId && c.region === region);
if (existing) {
    const tier = getTier(existing.population);
    const rates = colonyProductionRates(existing, state.curData);
    html += `<div class="tp-section">
      <div class="tp-section-header">Colony</div>
      <div class="tp-colony-name">${existing.name}</div>
      <div class="tp-colony-meta">${capitalize(tier)} · Pop: ${existing.population.toLocaleString()}</div>
      <div class="tp-colony-resources">`;
    for (const type of RESOURCE_TYPES) {
        html += `<div class="tp-resource-row">
          <span>${RESOURCE_ICONS[type]} ${RESOURCE_LABELS[type]}</span>
          <span>+${Math.round(rates[type])}/tick · ${Math.round(existing.resources[type]).toLocaleString()} total</span>
        </div>`;
    }
    html += `</div></div>`;
} else {
    const canFound = state.climateComputed;
    html += `<div class="tp-section">
      <div class="tp-section-header">Colony</div>
      <p class="tp-colony-empty">No settlement here yet.</p>
      <input id="tp-colony-name-input" class="tp-colony-input" type="text" maxlength="32"
             placeholder="Name this colony…" ${canFound ? '' : 'disabled'}>
      <button id="tp-found-btn" class="tp-found-btn" disabled>Found Here</button>
      ${!canFound ? '<p class="tp-climate-hint">Compute climate first to enable founding.</p>' : ''}
    </div>`;
}
```

**Step 5.3 — Confirm handler** (attached in `showTilePanel()` after setting innerHTML):

```js
const nameInput = document.getElementById('tp-colony-name-input');
const foundBtn  = document.getElementById('tp-found-btn');
if (nameInput && foundBtn) {
    nameInput.addEventListener('input', () => {
        foundBtn.disabled = nameInput.value.trim().length === 0;
    });
    foundBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) return;
        const [lat, lon] = regionToLatLon(region);   // utility from edit-mode.js
        const colony = createColony({
            bodyId: state.activeBodyId,
            systemId: state.currentSystemId,
            region, lat, lon, name,
            gameDays: getGameDays(),
        });
        state.colonies.push(colony);
        drawColonyMarkers(state.colonies, state.activeBodyId);
        updateMapColonyMarkers(state.colonies, state.activeBodyId);
        updateHUD();
        showTilePanel(region, lastPanelCx, lastPanelCy);   // re-render to show colony info
    });
}
```

---

### Phase 6 — Globe & Map Markers (`js/planet-mesh.js`)

**Step 6.1** — Add to scene initializer (scene.js or planet-mesh.js setup):
```js
export const colonyMarkerGroup = new THREE.Group();
scene.add(colonyMarkerGroup);
```

**Step 6.2** — `drawColonyMarkers(colonies, bodyId)`:
```js
export function drawColonyMarkers(colonies, bodyId) {
    while (colonyMarkerGroup.children.length) {
        colonyMarkerGroup.children[0].geometry.dispose();
        colonyMarkerGroup.remove(colonyMarkerGroup.children[0]);
    }
    const mat = new THREE.MeshBasicMaterial({ color: 0xffee44, depthTest: false });
    const geo = new THREE.SphereGeometry(0.014, 5, 5);
    for (const c of colonies) {
        if (c.bodyId !== bodyId) continue;
        const pos = latLonToXYZ(c.lat, c.lon, 1.006);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(...pos);
        colonyMarkerGroup.add(mesh);
    }
}
```

**Step 6.3** — `clearColonyMarkers()`: empties the group.

**Step 6.4** — `updateMapColonyMarkers(colonies, bodyId)`:
```js
export function updateMapColonyMarkers(colonies, bodyId) {
    // Remove existing dots
    document.querySelectorAll('.colonyMapDot').forEach(el => el.remove());
    const canvas = document.getElementById('mapCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    for (const c of colonies) {
        if (c.bodyId !== bodyId) continue;
        // Equirectangular projection
        const u = (c.lon + 180) / 360;
        const v = (90 - c.lat) / 180;
        const dot = document.createElement('div');
        dot.className = 'colonyMapDot';
        dot.style.left = `${rect.left + u * rect.width  - 5}px`;
        dot.style.top  = `${rect.top  + v * rect.height - 5}px`;
        document.body.appendChild(dot);
    }
}
```

**Step 6.5** — Debug layer color ramps in `debugLayerToColors()`:

```js
case 'resourceFood':
    lerp(color, [0.33, 0.20, 0.05], [0.42, 0.67, 0.23], value); break; // brown → green
case 'resourceWater':
    lerp(color, [0.80, 0.72, 0.45], [0.27, 0.53, 0.80], value); break; // tan → blue
case 'resourceMetals':
    lerp(color, [0.12, 0.12, 0.12], [0.67, 0.67, 0.67], value); break; // black → silver
case 'resourceFuel':
    lerp(color, [0.10, 0.08, 0.05], [0.87, 0.53, 0.20], value); break; // dark → amber
```

---

### Phase 7 — HUD Bar

**Step 7.1 — `index.html`** — add immediately before `</body>`:
```html
<div id="heliosphereHud" style="display:none">
  <span class="hud-item" id="hudColonies">⊙ <span>0</span> colonies</span>
  <span class="hud-item" id="hudPop">👥 <span>0</span></span>
  <span class="hud-sep">|</span>
  <span class="hud-item hud-food"  id="hudFood">  🌾 <span>0</span></span>
  <span class="hud-item hud-water" id="hudWater"> 💧 <span>0</span></span>
  <span class="hud-item hud-metals"id="hudMetals">⛏ <span>0</span></span>
  <span class="hud-item hud-fuel"  id="hudFuel">  ⚡ <span>0</span></span>
</div>
```

**Step 7.2 — `styles.css`**:
```css
#heliosphereHud {
    position: fixed; top: 0; left: 50%; transform: translateX(-50%);
    background: rgba(10, 12, 18, 0.85);
    border: 1px solid rgba(255,255,255,0.12);
    border-top: none; border-radius: 0 0 8px 8px;
    padding: 4px 16px; display: flex; align-items: center; gap: 12px;
    font-size: 13px; color: #ddd; z-index: 120;
    backdrop-filter: blur(6px);
}
.hud-sep { color: rgba(255,255,255,0.25); }
.colonyMapDot {
    position: fixed; width: 10px; height: 10px;
    border-radius: 50%; background: #ffee44;
    border: 1px solid #333; pointer-events: none; z-index: 110;
}
.tp-resource-bar-bg { flex: 1; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; }
.tp-resource-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
.tp-resource-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 12px; }
.tp-resource-icon { width: 18px; text-align: center; }
.tp-resource-label { width: 46px; color: #aaa; }
.tp-resource-pct { width: 32px; text-align: right; color: #ccc; font-size: 11px; }
.tp-colony-input { width: 100%; box-sizing: border-box; margin: 6px 0 4px;
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15);
    color: #eee; padding: 5px 8px; border-radius: 4px; font-size: 12px; }
.tp-found-btn { width: 100%; padding: 6px; margin-top: 2px;
    background: rgba(80, 140, 220, 0.25); border: 1px solid rgba(80,140,220,0.5);
    color: #88bbff; border-radius: 4px; cursor: pointer; font-size: 12px; }
.tp-found-btn:disabled { opacity: 0.4; cursor: default; }
.tp-climate-hint { font-size: 11px; color: #888; margin: 4px 0 0; }
```

**Step 7.3 — `updateHUD()` in `main.js`**:
```js
function updateHUD() {
    const bodyColonies = state.colonies.filter(c => c.bodyId === state.activeBodyId);
    const totals = { food: 0, water: 0, metals: 0, fuel: 0 };
    let totalPop = 0;
    for (const c of bodyColonies) {
        totalPop += c.population;
        for (const type of RESOURCE_TYPES) totals[type] += c.resources[type];
    }
    document.getElementById('hudColonies').querySelector('span').textContent = bodyColonies.length;
    document.getElementById('hudPop'    ).querySelector('span').textContent = formatPop(totalPop);
    document.getElementById('hudFood'  ).querySelector('span').textContent = Math.round(totals.food).toLocaleString();
    document.getElementById('hudWater' ).querySelector('span').textContent = Math.round(totals.water).toLocaleString();
    document.getElementById('hudMetals').querySelector('span').textContent = Math.round(totals.metals).toLocaleString();
    document.getElementById('hudFuel'  ).querySelector('span').textContent = Math.round(totals.fuel).toLocaleString();
    document.getElementById('heliosphereHud').style.display = state.activeBodyId ? '' : 'none';
}
```

---

### Phase 8 — Rebuild Warning & Cleanup (`js/main.js`)

In the standalone-planet `generate-done` handler, before clearing any planet state:
```js
if (state.colonies.length > 0 && !state.currentSystem) {
    // Small non-blocking notice (reuse existing .toast or inline banner)
    showNotice('Colonies cleared — planet rebuilt.');
    state.colonies = [];
    clearColonyMarkers();
    document.querySelectorAll('.colonyMapDot').forEach(el => el.remove());
}
```

In the solar-system body `generate-done` handler (new planet for a body):
```js
state.colonies = state.colonies.filter(c => c.bodyId !== state.activeBodyId);
clearColonyMarkers();
updateMapColonyMarkers(state.colonies, state.activeBodyId);
updateHUD();
```

---

### Phase 9 — Debug Layer Buttons (`index.html`)

Add a new "Resources" group to the debug layer selector (alongside existing Geology,
Atmosphere, Ocean, Climate, Planetary, Elevation groups):

```html
<optgroup label="Resources">
  <option value="resourceFood">Food Potential</option>
  <option value="resourceWater">Water Potential</option>
  <option value="resourceMetals">Metal Deposits</option>
  <option value="resourceFuel">Fuel Potential</option>
</optgroup>
```

These display the raw 0–1 resource potential across the globe, useful for planet
analysis and debugging the generation formulas.

---

### Phase 10 — Docs (`README.md`, `llms.txt`)

**`README.md`** additions:
- Interaction: "Left-click tile → tile panel (with resource potential when climate computed)"
- Colony Founding section: how to found, tier table, economy tick explanation
- HUD bar description
- Note that resource layers require climate computation, same as Köppen

**`llms.txt`** addition to feature list: "Colony founding on planetary tiles with
per-colony resource economy (food, water, metals, fuel) derived from climate and
tectonic simulation data"

---

## Verification Checklist

- [ ] **Food map (Earth)**: debug layer shows green tropics/temperate, brown deserts, white poles, zero ocean
- [ ] **Food map (Mars preset)**: near-zero everywhere (cold, dry, thin atmosphere)
- [ ] **Metal map**: highest peaks around mountain ranges and tectonic plate boundaries; matches plate collision zones visually
- [ ] **Metal map (ocean-only world)**: ocean floor shows low but non-zero (seafloor nodules)
- [ ] **Fuel map (Titan-like preset)**: large + hydrocarbon bonus makes most tiles high
- [ ] **Fuel map (Dead Rock)**: near-zero (no life, no atmosphere, minimal geo)
- [ ] **Tile panel**: clicking a mountain tile shows metals bar noticeably higher than the same planet's ocean tile
- [ ] **Tile panel**: clicking a tropical rainforest tile shows food near-max, metals near-min
- [ ] **Tile panel → Found colony**: input enables when climate is computed; button enables on non-empty name
- [ ] **Colony creation**: dot appears on globe and map; panel re-renders to show colony info
- [ ] **Economy tick**: advance game clock at 1000×; HUD resource counts increase each 30-tick interval
- [ ] **Multi-colony**: found two colonies on the same body; HUD shows aggregated totals
- [ ] **Body switch**: Earth colonies invisible when viewing Mars; reappear on return
- [ ] **Rebuild warning**: notice appears and colonies are cleared when planet is rebuilt
- [ ] **Alien system rocky body**: resource layers generate without error; formulas produce plausible values
- [ ] **No climate**: click tile when climate not computed → resource section absent; "Compute climate first" hint in colony section
- [ ] **Scale invariance**: enable Food layer at 2K detail and at 200K detail — visual output equivalent

---

## Forward Path (next milestones)

| Item | Notes |
|---|---|
| Colony persistence | Save `state.colonies` to localStorage alongside body overrides (system-storage.js) |
| Ship system | Ships carry resources between colonies; per-body inventory then drives real trade decisions |
| Rare metals | Add 5th resource type driven by `r_stress` × `gravityScale` with steeper ore-vein concentration |
| Colony panel | Dedicated side-panel (not in tile panel) with full build queue and infrastructure tabs |
| Resource overlay on orrery | Show resource richness as body annotation rings in the orrery view |
