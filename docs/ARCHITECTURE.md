# Heliosphere — Architecture

**Last updated:** March 2026

This document describes how the codebase is organized, how data flows through the system, and the reasoning behind key structural decisions. It is intended as a guide for understanding where to make changes and why things are done the way they are.

---

## Project At a Glance

Heliosphere is a **browser-based procedural planet generator** built with native ES modules and Three.js. There is no build step — the project is served as static files from any HTTP server. The URL is [orogen.studio](https://orogen.studio/).

The three guiding principles, in tie-breaking order:

1. **Artistic appeal** — output must look visually compelling
2. **Ease of use** — fast, approachable, no friction
3. **Scientific plausibility** — believable, not necessarily accurate

---

## File Layout

```
/
├── index.html              Entry point — canvas, UI chrome, tutorial modal
├── styles.css              Layout, responsive bottom-sheet, animations
├── llms.txt                AI-readable feature description
├── sitemap.xml             SEO sitemap
├── robots.txt / CNAME      Hosting config
│
├── docs/                   Project documentation
│   ├── ARCHITECTURE.md     This file
│   ├── PRODUCT_STATUS.md   Shipped features and open work items
│   └── plans/              Design documents for in-progress features
│       ├── HELIOSPHERE_PLAN.md
│       ├── TILE_PANEL_PLAN.md
│       └── COLONY_RESOURCE_PLAN.md
│
└── js/
    ├── main.js             Entry point — UI wiring, event loop, generate-done handler
    ├── generate.js         Worker dispatcher — posts jobs, routes results; exports computePlanetaryDebugLayers
    ├── planet-worker.js    Web Worker — runs the full geology + climate pipeline
    ├── edit-mode.js        Ctrl-click plate toggle, hover card, tile detail panel
    ├── solar-ui.js         Solar system UI — orrery, body list, saved systems, clock
    ├── orrery.js           2D top-down orrery — Kepler solver, Three.js orbit meshes
    ├── game-clock.js       Compressed game-time clock
    ├── viz-controls.js     Layer switching, legend rendering, build overlay, debugLayerEl
    │
    ├── core/               Pure utilities — no game logic, no external deps
    │   ├── state.js        Shared mutable application state (single source of truth)
    │   ├── rng.js          Seeded PRNG (mulberry32)
    │   ├── simplex-noise.js 3D Simplex noise
    │   ├── detail-scale.js  Non-linear mapping from the Detail slider to numRegions
    │   └── elev-scale.js   Elevation → km conversion + upliftMult state (shared by sim and render)
    │
    ├── world/              World data and configuration — no simulation deps
    │   ├── planetary-params.js     Slider values → physics parameter object
    │   ├── planet-code.js          Compact base36 planet code encode/decode
    │   ├── solar-system.js         Body definitions + procedural system generator
    │   ├── system-planet-params.js Body definition → slider values adapter
    │   └── system-storage.js       Solar system localStorage persistence
    │
    ├── ui/                 UI component modules extracted from main.js
    │   ├── world-preset.js     WORLD_PRESETS data, applyPreset(), updatePlanetWarnings()
    │   ├── export-modal.js     Export modal wiring (single + batch PNG download)
    │   └── modals.js           Tutorial modal + power-user survey tracker
    │
    ├── sim/                Simulation pipeline — geology, climate, tectonics
    │   ├── sphere-mesh.js      Fibonacci sphere + Voronoi/Delaunay tessellation
    │   ├── coarse-plates.js    Initial plate seed placement
    │   ├── plates.js           Flood-fill plate growth + boundary classification
    │   ├── ocean-land.js       Ocean/continent assignment + land fraction targeting
    │   ├── elevation.js        Distance fields, stress uplift, all tectonic features
    ├── terrain-post.js     Domain warping, bilateral smoothing, soil creep, hypsometric correction (hydro-scaled ocean depth), sea level calibration (`calibrateSeaLevel`), ridge sharpening; re-exports erosion.js
    │   ├── erosion.js          Priority-flood pit carving + composite hydraulic/thermal/glacial erosion
    │   ├── impact-craters.js   Procedural crater generation for airless worlds
    │   ├── climate-util.js     Shared climate helpers: smoothstep, Laplacian smoothing, ITCZ lookup, percentile
    │   ├── wind.js             Seasonal wind simulation (both hemispheres, 2 seasons)
    │   ├── ocean.js            Ocean surface current gyre simulation
    │   ├── precipitation.js    Moisture advection precipitation model
    │   ├── heuristic-precip.js Zonal heuristic precipitation (blended with advection)
    │   ├── temperature.js      Surface temperature from insolation + lapse rate
    │   └── koppen.js           Köppen-Geiger classification (30 standard + 5 alien zones)
    │
    └── render/             Three.js rendering — scene, mesh, colors
        ├── scene.js        Scene graph, cameras, controls, lights, globe layer stack
        ├── color-map.js    Elevation → RGB, biome palettes, module-level planet state
        ├── planet-mesh.js      Globe + map mesh construction, updateMeshColors; re-exports highlights/arrows/export
        ├── mesh-colors.js      All 27+ per-region color mapping functions + biome cache
        ├── mesh-highlights.js  Hover, Köppen hover, and tile-selection color-buffer patches
        ├── mesh-arrows.js      Wind and ocean current arrow overlays
        └── mesh-export.js      High-res equirectangular PNG export (tiled rendering)
```

---

## Data Flow

### 1. Generation Pipeline

```
User clicks "Build New World"
        │
        ▼
main.js  →  generate.js  →  planet-worker.js  (Web Worker)
                                    │
                    ┌───────────────┴──────────────────────┐
                    ▼                                       ▼
              Geology pipeline                    Climate pipeline
          sphere-mesh → plates                  wind → ocean → precip
          → ocean-land → elevation              → temperature → koppen
          → terrain-post → craters
                    │                                       │
                    └───────────────┬──────────────────────┘
                                    ▼
                         postMessage('done', transferables)
                                    │
                                    ▼
                           generate.js onDone()
                                    │
                                    ▼
                            main.js 'generate-done'
                     ┌──────────────┴──────────────────────┐
                     ▼                                      ▼
             state.* populated                  Three.js scene updated
             (r_xyz, r_elevation,              (buildMesh, updateWaterColor,
              r_koppen, r_wind…)                updateAtmosphereColor,
                                                updateHazeLayer…)
```

**Key principle:** The worker owns all computation. The main thread only handles UI events and Three.js rendering. All large typed arrays are transferred (zero-copy) from the worker back to the main thread.

### 2. Visualization Switching

When the user switches map layers:

```
User clicks a tab / Inspect dropdown / mobile view switcher
        │
        ▼
viz-controls.js switchVisualization(layer)
  → if climate needed and not computed: computeClimateViaWorker() first
  → applyLayer(layer)  [module-private in viz-controls.js]
        │
        ├─ state.debugLayer = layer
        ├─ updateMeshColors()          ← fast path: rewrites vertex color buffers
        ├─ toggle wind/ocean arrows
        └─ updateLegend(layer)
```

`updateMeshColors()` is the fast path — it never rebuilds geometry. `buildMesh()` rebuilds geometry and is only called after data changes (generate-done, reapply-done, edit-done).

### 3. Planet Code Round-Trip

```
Seed + slider values
        │
        ▼ encodePlanetCode()  (planet-code.js)
Compact base36 string (≈18 chars unedited, longer with plate edits)
        │
        ▼ URL hash / clipboard
        │
        ▼ decodePlanetCode()
Seed + slider values restored → generate()
```

---

## Key Modules in Depth

### `js/core/state.js` — The Single Source of Truth

All mutable application state lives here as a single exported `state` object. Every module imports `state` directly — there is no prop-drilling or event bus for state reads. Writes happen at well-defined points: the `generate-done` handler in `main.js`, the solar body handler in `solar-ui.js`, and edit operations in `edit-mode.js`.

Important fields:

| Field | Type | Purpose |
|-------|------|---------|
| `r_xyz` | Float32Array | Cell center positions on unit sphere |
| `r_elevation` | Float32Array | Terrain elevation per cell |
| `r_koppen` | Int32Array | Köppen zone ID per cell |
| `r_wind_*` | Float32Array | Wind speed/direction per cell, 2 seasons |
| `r_precip_*` | Float32Array | Precipitation per cell, 2 seasons |
| `r_temperature_*` | Float32Array | Temperature per cell, 2 seasons |
| `planetaryParams` | Object | Derived physics params from sliders |
| `debugLayer` | string | Currently active visualization layer |
| `selectedRegion` | int\|null | Clicked tile index, null = no selection |
| `currentSystem` | Object\|null | Active solar system, null = standalone mode |
| `isTouchDevice` | bool | Whether device is mobile (set by main.js at startup via DOM detection) |

### `js/render/color-map.js` — Planetary Rendering State

Color mapping functions need planetary context (is this an ocean world? what's the base temperature?) without threading parameters through every call. All such context is stored as **module-level variables** with exported setters:

```js
let _upliftMult    = 1.0;  export function setUpliftMult(v)    { _upliftMult = v; }
let _hasLiquidOcean = true; export function setHasLiquidOcean(b){ _hasLiquidOcean = b; }
let _baseTemp      = 15;   export function setBaseTemp(t)       { _baseTemp = t; }
let _atmosphere    = 3;    export function setAtmosphere(a)     { _atmosphere = a; }
let _hydrosphere   = 3;    export function setHydrosphere(h)    { _hydrosphere = h; }
```

These are set once in `main.js`'s `generate-done` handler. All ~21 color functions in the module pick them up automatically. Adding a new color-affecting parameter means: declare the variable, export a setter, call the setter in `main.js`. No other wiring needed.

**Exception:** Boolean visibility gates (does this feature render at all?) are read directly from `state.planetaryParams` at the top of the relevant render function in `planet-mesh.js`, because they don't need color-map logic.

### `js/render/scene.js` — Globe Layer Stack

All visual layers on the globe are concentric spheres:

| Layer | Radius | Purpose |
|-------|--------|---------|
| Terrain | ~1.0 (displaced) | `state.planetMesh` — vertex-colored terrain |
| Water | 1.0 | Translucent water sphere |
| Haze | 1.01 | Full-disc atmospheric haze (Fresnel limb) |
| Atmosphere rim | 1.12 | Rim glow shader (`pow(r, 3.5)`) |
| Stars | 40–70 | Static point cloud |

New visual layers pick a radius that avoids z-fighting. Update functions are called from `main.js generate-done` using `state.planetaryParams`.

### `js/edit-mode.js` — Tile Interaction

Two distinct click interactions share the same canvas:

- **Ctrl-click** (desktop) / **Edit Mode tap** (mobile): toggles the plate under the cursor between land and ocean, triggers `editRecompute` worker command.
- **Left-click** (desktop only): opens the **Tile Detail Panel** — a floating draggable card with terrain, climate, and biome data for the clicked cell.

These are separated by modifier-key check. The hover card is suppressed while a tile panel is open.

### `js/solar-ui.js` — Solar System Mode

Solar system mode is a distinct application layer that sits on top of the planet generator. When active:

- The orrery canvas replaces the sidebar header
- A body list replaces the main controls
- A background generation queue progressively generates all rocky/icy bodies
- Clicking a body runs a full generate cycle but routes the result through the solar body handler instead of the main planet handler

The two modes share the Three.js scene (same globe, same camera) but use separate `generate-done` listener paths. Both listeners guard with `if (state.isBgGenerating || state.currentSystem) return` / `if (!state.currentSystem) return` to stay in their respective lanes.

**Persistence:** The five physics slider overrides per body are saved to `localStorage` under `"wo-systems-v1"`, keyed by `systemId + bodyId`. Terrain data is not persisted (too large) — bodies regenerate on reload but with saved slider values reapplied.

---

## Worker Architecture

```
main thread                          Web Worker (planet-worker.js)
──────────────────────────────────   ──────────────────────────────────
generate.js posts message ────────►  Runs full pipeline
                                       Retains topology in W (module-level)
◄─────── postMessage + transfer ──── Returns typed arrays
                                    
generate.js posts 'reapply' ──────►  Re-runs elevation + post-processing
                                       Reuses W.mesh, W.plates, etc.
◄─────── postMessage + transfer ──── Returns new elevation data

generate.js posts 'editRecompute' ►  Toggles plate types, recomputes elevation
generate.js posts 'computeClimate' ► Runs deferred climate on existing terrain
```

**Why retain `W`?** The mesh topology (cell adjacency, coordinates) is expensive to rebuild and doesn't change between `reapply`/`edit`/`climate` operations. Keeping it in the worker avoids retransmitting ~10+ MB of typed arrays on every operation.

**Fallback:** If module workers aren't supported (older Safari), `workerSupported = false` and all pipeline functions run synchronously on the main thread via `generateFallback()`.

**Planetary inspection layers:** `computePlanetaryDebugLayers(curData, planetaryParams)` (exported from `generate.js`) computes four arrays stored on `debugLayers`:

| Array key | Type | Meaning |
|-----------|------|---------|
| `hydroState` | `Uint8Array` | 0=liquid ocean, 1=frozen ocean, 2=dry basin, 3=land |
| `habitability` | `Float32Array` | 0–1 composite of temperature score × water score |
| `permanentIce` | `Uint8Array` | 1 where summer temp < −10 °C (ice caps, land glaciers) |
| `seasonalIce` | `Uint8Array` | 1 where winter temp < 0 °C but summer ≥ −10 °C (pack ice, seasonal snow) |

The function runs **twice** per generation: a first pass in the `done` handler (while `state.planetaryParams` is still null, using `??` Earth-defaults), then definitively in the `generate-done` handler in `main.js` after `state.planetaryParams` is populated. `permanentIce` and `seasonalIce` are consumed by `makeColorizer` in `planet-mesh.js` to overlay ice colours on both Terrain and Satellite views.

---

## Mobile Architecture

The app has two distinct layouts driven by a single CSS media query breakpoint at 768px:

- **Desktop:** fixed sidebar on the left, canvas fills the rest, controls in the sidebar
- **Mobile:** canvas fills the screen, sidebar collapses to a bottom sheet with a drag handle

Touch-specific behavior:
- Pinch-to-zoom (in `scene.js`) replaces scroll-to-zoom
- Edit Mode toggle button (in `edit-mode.js`) replaces Ctrl-click
- Touch device detection (`state.isTouchDevice`) is set once at startup and gates mobile-only code paths

The Tile Detail Panel is intentionally desktop-only (no mobile touch tracking).

---

## Scale Invariance

The Detail slider maps to `numRegions` spanning from ~2K to ~2.5M cells. All simulation code must produce equivalent-looking results across this range. Rules:

- **Smoothing passes** are expressed as physical km targets: `Math.round(targetKm / avgEdgeKm)` where `avgEdgeKm = (π × 6371) / √numRegions`
- **Multipliers on neighbor-displacement quantities** normalize by `avgEdgeRad = π / √numRegions` (displacement magnitudes shrink at higher-res)
- **BFS hop thresholds** use `Math.round(targetKm / avgEdgeKm)`, never fixed integers
- **Physical unit thresholds** (°C, km altitude, mm precipitation, degrees latitude) need no scaling — they are inherently resolution-independent

---

## Adding a New Feature — Checklist

**New planetary parameter affecting rendering:**
1. Add `let _myParam` + `export function setMyParam` to `color-map.js`
2. Use `_myParam` inside the relevant color function
3. Call `setMyParam(...)` in `main.js generate-done` handler
4. Verify Earth defaults are unchanged

**New visualization layer:**
1. Add color function to `mesh-colors.js`
2. Add case to the layer dispatch in `planet-mesh.js updateMeshColors()`
3. Add to `CLIMATE_LAYERS` set in `viz-controls.js` if it requires climate data
4. Add legend definition in `updateLegend()` in `viz-controls.js`
5. Add the tab/dropdown entry in `index.html`

**New simulation step:**
1. Add the function to the appropriate `sim/` file (or create a new one)
2. Call it in `planet-worker.js` in the correct pipeline position
3. If it produces per-cell output, add a typed array field to the worker's `W` retained state and to `state.js`
4. Transfer the array back to the main thread in the worker's `postMessage` call

**New slider control:**
1. Add the `<input>` element to `index.html`
2. Wire it in `main.js` (change handler + `applyCode` + hash-loading)
3. Update `planetary-params.js` if it feeds into the physics layer
4. Update `planet-code.js` — `SLIDERS`, `RADICES`, `encodePlanetCode`, `decodePlanetCode`

**New globe visual layer:**
1. Create a `THREE.Mesh` with `SphereGeometry` at the appropriate radius in `scene.js`
2. Use a `ShaderMaterial` with uniforms for any driven values
3. Export the mesh + an `updateMyLayer(...)` function
4. Call the updater in `main.js generate-done`

---

## Dependencies

No npm build step. All external dependencies are loaded via CDN `<script>` tags or import maps in `index.html`:

| Dependency | Version | Purpose |
|------------|---------|---------|
| Three.js | 0.160.0 | 3D rendering, orbit controls |

Everything else is vanilla JS (ES2020+). The Simplex noise and seeded PRNG are vendored in `js/core/`.
