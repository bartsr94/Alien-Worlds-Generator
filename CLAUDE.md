# CLAUDE.md

## Project Overview

Heliosphere — a browser-based procedural planet generator using Three.js and ES modules with no build step.

> For a detailed architectural overview, data flow diagrams, and module descriptions, see `docs/ARCHITECTURE.md`.

## Guiding Principles

All three tenets should be considered simultaneously. When they conflict, break ties in this order:

1. **Artistic appeal** — The output should look visually interesting and compelling, informed by real science but not constrained by it. Aesthetics come first.
2. **Ease of use and efficiency** — The interface should be approachable and intuitive. Generation should be fast. Don't sacrifice usability for realism.
3. **Scientific plausibility** — Terrain, tectonics, and geology should be grounded in real planetary science. Results don't need to be physically accurate simulations, but they should be believable.

## Key Rules

After any code change, check whether README.md needs updating. The README documents all UI controls, features, algorithms, and project structure. If a change adds, removes, or modifies any of the following, update the README to match:

- Sliders, dropdowns, toggles, or other UI controls (names, ranges, defaults)
- User interactions (keyboard shortcuts, mouse actions, edit behaviors)
- Generation pipeline steps or algorithms
- Visual features (rendering, overlays, debug layers)
- Project file structure (new files, renamed files, removed files)
- External dependencies

After any code change, check whether the tutorial modal content (in `index.html`, inside `#tutorialOverlay`) needs updating. The tutorial has three steps that describe the app's features and interactions. If a change adds, removes, or modifies any of the following, update the relevant tutorial step to match:

- Core workflow (how to generate a planet, what controls to use)
- Interactive features (navigation, editing, keyboard/mouse actions)
- What the tool does or its key selling points

After any code change that affects the UI, ensure it works on mobile. The app uses a responsive bottom-sheet layout on screens ≤ 768px (`styles.css` media queries) and has touch-specific behavior throughout. If a change adds, removes, or modifies any of the following, verify and update the mobile experience:

- New buttons or controls — must have ≥ 44px touch targets on mobile (see `@media (max-width: 768px)` in `styles.css`)
- New interactions — must have touch equivalents; desktop uses Ctrl-click for plate editing, mobile uses `state.editMode` toggle (`js/edit-mode.js`); desktop uses scroll-to-zoom, mobile uses pinch (`js/scene.js`)
- Tooltips — must reposition above their trigger on mobile, not to the right (overflow off-screen)
- New overlays or modals — must be usable within the bottom-sheet layout and not be hidden behind it
- Performance-sensitive features — consider lower thresholds on touch devices (detail warnings, export limits); check `state.isTouchDevice` in `js/state.js`
- Info/hint text — update both desktop text (in `index.html`) and the mobile-specific text set in `js/main.js` (search for `state.isTouchDevice`)

After any code change to simulation or climate code, ensure **scale invariance** — the result must look equivalent regardless of the Detail slider (numRegions from 2K to 2.5M). The key rule: never use raw cell-hop counts or neighbor-displacement magnitudes without scaling by resolution. Specifically:

- **Smoothing passes** must target a physical distance: `Math.max(minPasses, Math.round(targetKm / avgEdgeKm))` where `avgEdgeKm = (π × 6371) / √numRegions`. Never write a bare `smooth(mesh, field, 5)`.
- **Multipliers on neighbor-displacement quantities** (e.g. wind convergence, which sums `wind · displacement`) must normalize by `avgEdgeRad = π / √numRegions` since displacement magnitudes shrink at higher resolution.
- **BFS hop thresholds** must be expressed as `Math.round(targetKm / avgEdgeKm)`, not as fixed integers.
- **Thresholds in physical units** (degrees latitude, km altitude, °C, mm precipitation) are inherently scale-invariant and do NOT need scaling — e.g. "28° from ITCZ" or "heightKm > 1.5" are fine at any resolution.
- When in doubt, ask: "if I double numRegions, does this value change meaning?" If yes, it needs scaling.

*→ See `docs/ARCHITECTURE.md` § Scale Invariance for a concise summary of these rules.*

After any code change that adds, removes, or modifies features, check whether the SEO and AISEO files need updating. The project has several files that describe the app to search engines and AI models. These must stay accurate — outdated claims are worse than no claims. If a change adds, removes, or modifies any of the following, update the relevant files:

- **`index.html` `<head>` meta tags** — The `<title>`, `description`, `og:description`, `twitter:description`, and `keywords` meta tags describe what the app does. Update if core capabilities change (e.g. new simulation type, new export format, new interaction mode).
- **`index.html` JSON-LD structured data** — The `<script type="application/ld+json">` block contains a `WebApplication` schema with a `featureList` array. Add or remove entries when major features are added or removed.
- **`index.html` hidden `<main>` block** — The visually hidden semantic HTML block (right after `<body>`) describes the app for crawlers. Update its feature list, use cases, or description when the app's capabilities change meaningfully.
- **`llms.txt`** — A plain-text file at the project root that describes the tool for AI assistants. Update its feature list, "who it's for" section, or technical details when capabilities change. Keep it concise and factual.
- **`sitemap.xml`** — Update the `<lastmod>` date when deploying significant changes.

Files that rarely need updating: `robots.txt` (only if adding pages or restricting crawlers), `CNAME` (only if domain changes), `preview.png` (only if the app's visual appearance changes dramatically).

After any code change that adds a planetary parameter that affects rendering, follow the **`color-map.js` module-level state pattern**. Planetary rendering context is stored as module-level variables (not function parameters) so the ~21 call sites in `color-map.js` pick it up automatically without threading. The pattern:

1. Declare `let _myParam = defaultValue;` near the top of `color-map.js`
2. Export `export function setMyParam(v) { _myParam = ...; }` immediately after
3. Use `_myParam` inside any `color-map.js` function that needs it
4. In `js/main.js`, import `setMyParam` and call it in the `generate-done` handler after `state.planetaryParams` is populated
5. Ensure Earth defaults (`upliftMult=1`, `hasLiquidOcean=true`, etc.) preserve the original Earth output exactly

Existing examples: `_upliftMult`/`setUpliftMult` (mountain height scaling), `_hasLiquidOcean`/`setHasLiquidOcean` (dry-world terrain colors), and `_baseTemp`/`setBaseTemp`, `_atmosphere`/`setAtmosphere`, `_hydrosphere`/`setHydrosphere` (alien/arid/ice/barren palette sub-variant selection).

**When NOT to use the color-map.js module-state pattern:** if the param controls whether a feature renders *at all* (a boolean visibility gate) rather than influencing colour or palette, read `state.planetaryParams` directly at the top of the relevant render function(s) in `planet-mesh.js`. This avoids the import/setter boilerplate for something that isn't a colour calculation. Example: `riversPlausible` (river corridor rendering is suppressed on frozen worlds ≤ −30 °C, steam worlds ≥ 130 °C, or hydrosphere 0) is computed inline in `buildMapMesh`, `buildMesh`, and `updateMeshColors` as:
```js
const _rp_temp  = state.planetaryParams?.baseTemp    ?? 15;
const _rp_hydro = state.planetaryParams?.hydrosphere ?? 3;
const riversPlausible = _rp_hydro >= 1 && _rp_temp > -30 && _rp_temp < 130;
```

*→ See `docs/ARCHITECTURE.md` § `js/render/color-map.js — Planetary Rendering State` for a module-level overview.*

After any code change that adds a new full-disc globe visual effect (something visible across the whole planet face, not just the rim), follow the **`scene.js` globe layer pattern**:

1. Create a new `THREE.Mesh` with a `THREE.SphereGeometry` at radius slightly above the terrain sphere (the water sphere is at r=1.0, the haze is at r=1.01, the atmosphere rim is at r=1.12 — pick the appropriate layer)
2. Use a `THREE.ShaderMaterial` so opacity, color, and any Fresnel/limb effects can be driven by uniforms
3. Export both the mesh constant and an `export function updateMyLayer(...)` updater that sets `mesh.visible` and updates uniforms
4. In `js/main.js`, import the updater and call it in the `generate-done` handler using the appropriate field from `state.planetaryParams`
5. Add the corresponding derived value to `js/planetary-params.js` using the established helper pattern

Existing example: `hazeMesh`/`updateHazeLayer` (full-disc atmospheric haze opacity, r=1.01 sphere, driven by `params.hazeOpacity` + `params.atmosphereTint`).

*→ See `docs/ARCHITECTURE.md` § `js/render/scene.js — Globe Layer Stack` for the full layer radius table.*

After any code change that adds or modifies the tile detail panel (click-to-inspect interaction), be aware of the **tile panel architecture**:

- **`state.selectedRegion`** (`null` or region index) — the currently selected tile. `null` = no selection.
- **`state._selectionBackup`** (`null` or `{ region, globe: {offsets, saved}, map: {offsets, saved} }`) — stores original vertex colors for the selected tile so its gold highlight can be precisely restored. Cleared by `clearSelectionHighlight()` in `js/planet-mesh.js`.
- **`updateSelectionHighlight(region)`** / **`clearSelectionHighlight()`** — exported from `js/planet-mesh.js`. The gold tint is `R+0.40, G+0.35, B+0.00` (distinct from the plate hover `+0.22` uniform brighten). Called from `updateMeshColors` at the end of every full color rebuild so the selection survives layer-switching.
- **`showTilePanel(region, cx, cy)`** / **`export function hideTilePanel()`** — in `js/edit-mode.js`. `hideTilePanel` is also exported and imported by `js/main.js` for generate-done cleanup.
- **Hover suppression**: the `pointermove` handler in `js/edit-mode.js` has an early-return guard `if (state.selectedRegion !== null) return` so the hover card is hidden while a tile panel is open.
- **Close-on-outside**: a single `document.addEventListener('pointerdown', ...)` registered in `setupEditMode()` closes the panel if the click target is not inside `#tilePanel`.
- **Draggable header**: drag logic is attached per-panel in `showTilePanel()` using per-call `pointermove`/`pointerup` listeners on `document` that are cleaned up on drag-end.
- **Mobile**: the tile panel is intentionally desktop-only. The `tileDown` tracking only starts when `!state.isTouchDevice`.
- **generate-done cleanup**: `main.js` calls `hideTilePanel()` + `clearSelectionHighlight()` on every non-background-generation `generate-done` event.

*→ See `docs/ARCHITECTURE.md` § `js/edit-mode.js — Tile Interaction` for a higher-level description.*

After any code change that modifies how ocean fraction is targeted or how elevation distributions are shaped, be aware of the **sea level calibration and hypsometric scaling pattern** in `js/sim/terrain-post.js` and `js/planet-worker.js`:

- **`calibrateSeaLevel(r_elevation, targetFraction)`** — called after `runPostProcessing` in all three worker handlers (`handleGenerate`, `handleReapply`, `handleEditRecompute`). Sorts the elevation array, finds the element at rank `floor(targetFraction × N)`, and shifts the entire field so that element lands at exactly 0. This guarantees that the exact `oceanFraction` fraction of cells is below sea level, regardless of what erosion and hypsometric correction did to the distribution. Earth invariance: hydro=3 → oceanFraction=0.70; the plate assignment already targets 70 % → shift is typically < 1e-3.
- **`applyHypsometricCorrection(mesh, r_elevation, r_isOcean, hydro = 3)`** — the `hydro` 4th parameter scales the ocean CDF exponent: `1.20 + 0.15 × (hydro − 3)`. Earth (hydro=3) uses exponent 1.20 unchanged; High (4) and Flooded (5) produce progressively deeper basins; Trace (1) and Partial (2) produce shallower shelves. Land exponent (0.80) is unchanged.
- **Call order in `planet-worker.js`:** `runPostProcessing` (which calls `applyHypsometricCorrection` internally) → `calibrateSeaLevel`. Sea level calibration runs last, after all smoothing/erosion passes, so the target fraction is exact on the final terrain.
- **Earth defaults are inviolable:** the combination of hydro=3 + oceanFraction=0.70 must produce output visually identical to pre-change output.

*→ See `js/sim/terrain-post.js` for the implementation of both functions.*

After any code change that adds a new alien (X) Köppen zone, follow the **`koppen.js` alien zone pattern**. Alien zones use 2-letter codes starting with `X` (to avoid conflict with standard Köppen `A/B/C/D/E` bands) and are checked at the top of the per-cell classification loop, before any standard band logic.

1. **Add to `KOPPEN_CLASSES`** at the bottom of the array in `js/koppen.js` (after `EF`, together with the other X zones). Each entry needs `{ code, name, color [r,g,b 0–1] }`.
2. **Add a gate in the classification loop** in `classifyKoppen()`, in the alien zone block just before the `// "Shoulder-month"` comment. Gates must check physical °C thresholds (using the already-decoded `Ts`/`Tw`/`Tann`/`Thot`) and precipitation (use `(pSummer[r] + pWinter[r]) * 1000` for annual mm proxy). Order matters: hotter zones first (XV before XS), colder zones last.
3. **Add to `BIOME_COLORS`** in `js/color-map.js` with a satellite-view color matching the zone's visual character.
4. **Add a case to `altitudeThresholds()`** in `js/color-map.js`. Use very high alpine/snow lines (e.g. `[4.0, 99.0]`) for hot zones so snow never appears; use low snow lines (e.g. `[0.0, 0.1]`) for deep-freeze zones.
5. **Thresholds must be set well outside Earth's climate range** so terrestrial worlds are unaffected. Earth's surface temperatures stay within roughly −45 to +45°C; any X-zone threshold should be comfortably beyond that (current outermost Earth thresholds: `Thot < 0` for EF, `Tann ≥ 18` for BWh).
6. **No ID remapping needed** — `CODE_TO_ID` is built at import time by iterating `KOPPEN_CLASSES`, so new entries at the end get the next integer ID automatically.
7. **Update README.md** (zone count in Visual Options and the pipeline step 16 description), **`llms.txt`**, and **`sitemap.xml` `<lastmod>`**.

Existing X zones (IDs 31–35): `XD` Cryo-Desert (Thot < −30°C, dry), `XF` Deep Freeze (Thot < −30°C, wet), `XP` Primordial (Tann > 70°C, Pann > 400 mm), `XS` Scorched (Tann > 70°C, dry), `XV` Hellscape (Tann > 250°C).

**Note:** Purely visual sub-variants within one zone (e.g. Europa-ice vs frost-world vs standard ice under `EF`/`XF`) should be handled in `color-map.js` palette functions using the `_hydrosphere`/`_baseTemp` module-level state, not as separate Köppen codes. Reserve new X codes for cases where the climate regime itself is meaningfully distinct (different precipitation regime, different aridity character, etc.).

After any code change that adds, removes, or modifies slider controls, update the planet code encoding in `js/planet-code.js` to match. The planet code packs the seed and all slider values into a compact base36 string using mixed-radix integer packing. If a slider's range, step, or count changes, or if a new slider is added, update:

- The `SLIDERS` array (min, step, count for each slider)
- The `RADICES` array (the count values in right-to-left order)
- The `encodePlanetCode` and `decodePlanetCode` functions (packing/unpacking order)
- The corresponding slider wiring in `js/main.js` (the `map` objects in the `generate-done` handler, `applyCode`, and hash-loading code)

After any code change that adds or modifies solar system features, be aware of the **solar system persistence architecture**. All localStorage state for solar systems lives in `js/system-storage.js` under key `"wo-systems-v1"`.

**Schema:** `{ activeSystemId: string|null, systems: [{ id, name, type:"sol"|"random", seed, savedAt, bodyOverrides:{bodyId:{gravity,atmosphere,hydrosphere,baseTemp,axialTilt}}, generatedBodyIds:[] }] }`

**System ID convention:** `"sol"` for `OUR_SOLAR_SYSTEM`, `"random-{system.seed}"` for procedural systems. Always use `Object.is(system, OUR_SOLAR_SYSTEM)` identity check — never `!system.seed` (Sol has `seed: 42` which is truthy). Both the ID and the active system object are stored as `state.currentSystemId` and `state.currentSystem`.

**In-session cache:** `state.systemCaches` is a plain object keyed by systemId; each value is a `Map<bodyId, {curData}>`. `state.generatedBodies` always points to `state.systemCaches[currentSystemId]`. Never create a new `Map()` unconditionally on `enterSystemMode()` — use `state.systemCaches[systemId] ??= new Map()`.

**What is and is NOT persisted:** Only the five physics slider overrides (`gravity, atmosphere, hydrosphere, baseTemp, axialTilt`) are saved to localStorage. `curData` (terrain typed arrays) is intentionally not persisted — too large. Bodies re-generate on page reload but with their saved slider values applied.

**Key call sites in `js/solar-ui.js`:**
- `enterSystemMode()` — call `upsertSystem(record)` (preserve existing `bodyOverrides`/`generatedBodyIds`) then `setActiveSystemId(id)` then `renderSavedSystemsList()`
- `enterBody()` — call `getBodyOverride(systemId, bodyId)` in both cache-hit and cache-miss paths and layer onto base params
- `generate-done` body handler — call `markBodyGenerated()`, then `saveBodyOverride()`/`clearBodyOverride()` based on slider diff vs `body.params`, then `renderSavedSystemsList()`
- Page-load restore — use `window._enterSystemMode` (exposed by `initSolarSystem()` in `js/solar-ui.js`) since `main.js` page-load code runs after module initialization

**`generate-done` guard:** Both top-level `generate-done` listeners in `main.js` must check `if (state.isBgGenerating || state.currentSystem) return` to avoid running standalone-planet code during solar body generation. The solar-body `generate-done` listener lives in `js/solar-ui.js` and handles caching and queue advancement.

*→ See `docs/ARCHITECTURE.md` § `js/solar-ui.js — Solar System Mode` for a higher-level description and persistence rationale.*

After any code change that modifies how visualization layers are switched or how mesh colors are rebuilt, be aware of the **visualization switching lifecycle**:

1. User clicks a map tab, the Inspect dropdown, or the mobile view switcher
2. `switchVisualization(layer)` is called — if the layer requires climate data (`CLIMATE_LAYERS` set) and climate hasn't been computed yet, it triggers `computeClimateViaWorker()` first, then falls through to `applyLayer(layer)` on completion
3. `applyLayer(layer)` does three things in order:
   - Sets `state.debugLayer = layer` and calls `updateMeshColors()` — this recolors all globe + map vertex buffers without rebuilding geometry
   - Toggles wind/ocean arrow visibility: wind layers show `buildWindArrows(season)`, ocean layers show `buildOceanCurrentArrows(season)`, all other layers call both with `null` to hide
   - Calls `updateLegend(layer)` to rebuild the color legend bar
4. Tab syncing: `syncTabsToLayer(layer)` updates the active tab highlight, the Inspect dropdown value, and the mobile view switcher selection

**`updateMeshColors()` vs `buildMesh()`**: `updateMeshColors()` is the fast path — it reuses existing geometry and only overwrites the `color` attribute buffer on both globe and map meshes. Call it when the visualization layer changes, when biome mode changes, or when the selected tile highlight needs refreshing. Call `buildMesh()` (which internally calls `updateMeshColors()` at the end) only when the terrain data itself has changed (after generate-done, reapply-done, or edit-done). `updateMeshColors()` also re-applies the selection highlight at the end so the gold tile selection survives layer switching.

*→ See `docs/ARCHITECTURE.md` § 2. Visualization Switching for a data flow diagram.*

After any code change that modifies worker communication or adds a new worker command, be aware of the **worker and fallback architecture** in `js/generate.js`:

- **Worker lifecycle**: A single `Worker` instance is created at module load with `type: 'module'`. If module workers aren't supported (Safari, older browsers), `workerSupported` is set to `false` and all generation runs synchronously on the main thread via `generateFallback()`.
- **Commands**: The worker accepts four commands: `'generate'` (full pipeline), `'reapply'` (terrain post-processing only), `'editRecompute'` (plate toggle + re-elevation), `'computeClimate'` (deferred climate on existing terrain). Each returns a typed response (`'done'`, `'reapplyDone'`, `'editDone'`, `'climateDone'`).
- **Retained state `W`**: The worker clones essential data (mesh topology, coordinates, plate assignments, pre-erosion elevation) into a module-level `W` object after `'generate'`. Subsequent `'reapply'`/`'editRecompute'`/`'computeClimate'` commands reuse `W` without retransmission. This means the worker must always receive updated values for anything that changed (e.g. `toggledIndices` for edits, `planetaryParams` for reapply).
- **Zero-copy transfers**: Large typed arrays (`r_xyz`, `r_elevation`, etc.) are transferred to the main thread via `postMessage` transfer lists. The worker keeps its own clones in `W`.
- **Main-thread climate fallback**: If the worker returns terrain without climate data (e.g. `skipClimate` was set), `generate.js` has `buildWindResultForOcean()` and inline calls to `computeOceanCurrents()`, `computePrecipitation()`, `computeTemperature()`, `classifyKoppen()` that run on the main thread. This path is also used for `'computeClimate'` when workers aren't supported.
- **Planetary inspection layers**: `computePlanetaryDebugLayers(curData, planetaryParams)` (exported from `generate.js`) computes `debugLayers.hydroState`, `debugLayers.habitability`, `debugLayers.permanentIce`, and `debugLayers.seasonalIce`. It runs **twice** per generation: a first pass in the `done` handler while `state.planetaryParams` is still null (using `??` Earth-defaults), then definitively in the `generate-done` handler in `main.js` after `state.planetaryParams` is populated from slider values. `permanentIce` marks cells where summer temperature < −10 °C; `seasonalIce` marks cells below 0 °C in winter but ≥ −10 °C in summer. Both arrays are `Uint8Array`s stored on `debugLayers` and consumed by `makeColorizer` in `planet-mesh.js` for ice rendering overlays. If you add new parameters that affect these layers, update all three storage call sites (lines matching `debugLayers.hydroState = planetary.r_hydro_state` in `generate.js`) and ensure the `generate-done` pass uses `state.planetaryParams`.
- **Callback pattern**: `generate()` accepts `onProgress(pct, label)` and `onDone()` callbacks stored as module-level `_onProgress`/`_onDone`. These are overwritten each call (not queued).

*→ See `docs/ARCHITECTURE.md` § Worker Architecture for a sequence diagram and retained-state rationale.*

After any code change that adds a new visual layer to the planet globe (e.g. clouds, rings, aurora), be aware of the **globe layer stack** in `js/scene.js`. All layers are concentric spheres at different radii:

| Layer | Radius | Mesh | Material | Update Function | Visibility Rule |
|-------|--------|------|----------|-----------------|-----------------|
| Terrain/planet | ≈1.0 (displaced) | `state.planetMesh` | `MeshLambertMaterial` vertex colors | `buildMesh()` / `updateMeshColors()` | Always visible |
| Water | 1.0 | `waterMesh` | `MeshPhongMaterial` translucent | `updateWaterColor(rgb)` | Hidden when hydrosphere=None (`rgb=null`) |
| Haze | 1.01 | `hazeMesh` | `ShaderMaterial` (Fresnel limb brightening) | `updateHazeLayer(opacity, rgb)` | Visible for Thick/Crushing/Titan-cold atmospheres |
| Atmosphere rim | 1.12 | `atmosMesh` | `ShaderMaterial` (rim glow, `pow(r, 3.5)`) | `updateAtmosphereColor(rgb)` | Hidden when atmosphere=None (`rgb=[0,0,0]`) |
| Stars | 40–70 | `starsMesh` | `PointsMaterial` | None (static) | Always visible in globe view |

New layers should pick a radius that avoids z-fighting with existing layers. All update functions are called from the `generate-done` handler in `main.js` using values from `state.planetaryParams`.

*→ See `docs/ARCHITECTURE.md` § `js/render/scene.js — Globe Layer Stack` for the full layer table with radii and materials.*

After any code change that adds or modifies files in the `js/` directory, be aware of the **module file organization** and subfolder layout:

```
js/
  main.js           Entry point — UI wiring, animation loop
  generate.js       Worker dispatcher — posts jobs, handles results
  planet-worker.js  Web Worker — runs geology pipeline off main thread
  edit-mode.js      Ctrl-click plate toggle, hover info card, tile detail panel
  solar-ui.js       Solar system UI — orrery interaction, body list, saved systems panel, clock controls, system entry/exit, background generation queue
  orrery.js         2-D top-down orrery — Kepler orbit solver, Three.js meshes
  game-clock.js     Compressed game-time clock

  core/             Pure utilities — no game logic, no external deps
    state.js        Shared mutable application state
    rng.js          Seeded PRNG
    simplex-noise.js  3-D Simplex noise
    detail-scale.js   Non-linear detail slider mapping
    elev-scale.js     Elevation → km conversion + upliftMult state (shared by sim + render)

  world/            World data and configuration — no simulation deps
    planetary-params.js     Physics parameter builder
    planet-code.js          Planet code encode/decode
    solar-system.js         Body definitions + procedural system generator
    system-planet-params.js Body → slider adapter
    system-storage.js       Solar system localStorage persistence

  ui/               UI component modules (extracted from main.js)
    world-preset.js   WORLD_PRESETS data, applyPreset(), updatePlanetWarnings()
    export-modal.js   Export modal wiring (single + batch PNG download)
    modals.js         Tutorial modal + power-user survey tracker

  viz-controls.js  Layer switching, legend rendering, build overlay

  sim/              Simulation pipeline — geology, climate, tectonics
    sphere-mesh.js  coarse-plates.js  plates.js  ocean-land.js
    elevation.js  terrain-post.js  erosion.js  impact-craters.js
    climate-util.js  wind.js  ocean.js  precipitation.js
    heuristic-precip.js  temperature.js  koppen.js

  render/           Three.js rendering — scene, mesh, colors
    scene.js        Three.js scene, cameras, controls, lights
    color-map.js    Elevation → RGB, satellite biome palettes
    planet-mesh.js  Voronoi mesh, map projection, highlights, arrows, export
    mesh-colors.js  All 27+ per-region color-mapping functions + biome cache
    mesh-highlights.js  Hover, Köppen hover, and tile selection highlights
```

Key render module responsibilities:

- **`js/render/planet-mesh.js`** — Globe and map mesh construction, `updateMeshColors()` fast-path color rebuild, plate color computation, grid overlays. Re-exports functions from child modules for backward compatibility.
- **`js/render/mesh-highlights.js`** — Surgical save/restore color-buffer patches for plate hover, Köppen legend hover, and tile selection. All six highlight functions are re-exported through `planet-mesh.js`.
- **`js/render/mesh-colors.js`** — All 27+ per-region color mapping functions (elevation, heightmap, precipitation, temperature, Köppen, biome, continentality, ocean current, habitability, hydro state, flow accumulation, etc.) plus the biome smoothing cache. Imported by `planet-mesh.js`.
- **`js/render/mesh-arrows.js`** — Wind direction arrows, ocean current arrows, and drift arrow cleanup. Handles both globe and map arrow overlays with lat/lon grid sampling for visual clarity. Imported by `planet-mesh.js`.
- **`js/render/mesh-export.js`** — High-resolution equirectangular PNG export with tiled rendering (max 2048×2048 per tile), sRGB gamma correction, and row-flip. Supports single (`exportMap`) and batch (`exportMapBatch`) export. Imported by `planet-mesh.js`.
- **`js/viz-controls.js`** — Visualization layer switching (`switchVisualization`, `applyLayer`), tab/mobile-switcher sync (`syncTabsToLayer`), legend rendering (`updateLegend`), build overlay (`onProgress`, `showBuildOverlay`, `hideBuildOverlay`), and the Inspect dropdown element (`debugLayerEl`). Imported by `main.js`.
- **`js/sim/erosion.js`** — Priority-flood pit carving (`priorityFloodCarve`, private) and composite iterative erosion (`erodeComposite`, exported). Re-exported through `terrain-post.js`.
- **`js/solar-ui.js`** — Solar system UI: orrery interaction, body list rendering, saved systems panel, clock controls, system creation/entry/exit, background generation queue, and body param overrides. Initialized from `main.js` via `initSolarSystem(config)`.

*→ See `docs/ARCHITECTURE.md` § File Layout for the complete annotated file tree.*
