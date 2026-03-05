# CLAUDE.md

## Project Overview

World Orogen — a browser-based procedural planet generator using Three.js and ES modules with no build step.

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

After any code change that adds a new full-disc globe visual effect (something visible across the whole planet face, not just the rim), follow the **`scene.js` globe layer pattern**:

1. Create a new `THREE.Mesh` with a `THREE.SphereGeometry` at radius slightly above the terrain sphere (the water sphere is at r=1.0, the haze is at r=1.01, the atmosphere rim is at r=1.12 — pick the appropriate layer)
2. Use a `THREE.ShaderMaterial` so opacity, color, and any Fresnel/limb effects can be driven by uniforms
3. Export both the mesh constant and an `export function updateMyLayer(...)` updater that sets `mesh.visible` and updates uniforms
4. In `js/main.js`, import the updater and call it in the `generate-done` handler using the appropriate field from `state.planetaryParams`
5. Add the corresponding derived value to `js/planetary-params.js` using the established helper pattern

Existing example: `hazeMesh`/`updateHazeLayer` (full-disc atmospheric haze opacity, r=1.01 sphere, driven by `params.hazeOpacity` + `params.atmosphereTint`).

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

**Key call sites in `main.js`:**
- `enterSystemMode()` — call `upsertSystem(record)` (preserve existing `bodyOverrides`/`generatedBodyIds`) then `setActiveSystemId(id)` then `renderSavedSystemsList()`
- `enterBody()` — call `getBodyOverride(systemId, bodyId)` in both cache-hit and cache-miss paths and layer onto base params
- `generate-done` body handler — call `markBodyGenerated()`, then `saveBodyOverride()`/`clearBodyOverride()` based on slider diff vs `body.params`, then `renderSavedSystemsList()`
- Page-load restore — use `window._enterSystemMode` (exposed inside the `initSolarSystem()` IIFE) since page-load code runs outside that IIFE scope

**`generate-done` guard:** Both top-level `generate-done` listeners (outside the solar system IIFE) must check `if (state.isBgGenerating || state.currentSystem) return` to avoid running standalone-planet code during solar body generation.
