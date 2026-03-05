# Heliosphere — Product Status (March 2026)

This document tracks shipped features and open work items, updated from the original V1 review.

---

## Current Capabilities

### Simulation Pipeline

The tectonic and terrain pipeline is the core differentiator and has grown substantially beyond the original V1 scope:

- **Tectonics** — farthest-point seeding with top-3 jitter, round-robin flood fill with directional growth bias and compactness penalty, convergent/divergent/transform boundary classification with density-based subduction, multi-pass boundary smoothing, fragment reconnection.
- **Elevation** — three-distance-field assembly, stress-driven uplift, asymmetric mountain profiles, continental shelf/slope/abyss, foreland basins, plateau formation, rift valley graben profiles, mid-ocean ridges, deep trenches, fracture zones, back-arc basins, island arcs, hotspot volcanism with drift trails and calderas.
- **Terrain post-processing** — domain warping, bilateral smoothing, glacial erosion (fjords, U-valleys, lake basins), priority-flood canyon carving (Barnes et al.), iterative stream-power hydraulic erosion with sediment deposition, thermal erosion, ridge sharpening, soil creep, hypsometric correction.
- **Impact craters** — power-law size distribution from micro-craters (2 km) to mega-basins (1400 km), applied on airless and trace-atmosphere worlds.
- **Planetary Physics layer** — five sliders (gravity, atmosphere, hydrosphere, base temperature, axial tilt) flow through the entire pipeline. Nine world presets produce genuinely alien environments. Atmosphere rim glow, full-disc haze sphere, water sphere, biome colors, and all simulation thresholds adapt to the planetary configuration.
- **Climate** — seasonal wind (pressure-driven ITCZ with longitude variation, geostrophic Coriolis, monsoon reversals), ocean surface currents (gyre simulation with western boundary intensification, circumpolar channels), precipitation (blended moisture-advection + heuristic zonal model), temperature, and full Köppen-Geiger classification with 5 alien X-zones (XD, XF, XP, XS, XV) for out-of-Earth-range worlds.

### Visualization

- Globe (Three.js with atmosphere rim shader, haze sphere, water sphere, starfield, terrain displacement) and equirectangular map.
- Five map type tabs: Terrain, Satellite, Climate, Heightmap, Land HM — each with a color legend.
- 28 selectable debug/inspection layers organized by category (Geology, Atmosphere, Ocean, Climate, Planetary, Elevation).
- Wind arrows and ocean current arrows (globe + map), colored by speed and heat transport respectively.
- Center Longitude slider for map projection scrolling.
- Wireframe and show-plates toggles.

### Export

- High-resolution equirectangular PNG export (color terrain, satellite biome, Köppen climate, B&W heightmap, land-only heightmap, land mask) at widths up to 65536px with tiled rendering.
- **Export All** downloads Satellite, Climate, Heightmap, and Land Mask in one click, auto-computing climate if needed.

### Solar System Mode

- Our Solar System (Mercury–Neptune with real physical parameters) and procedurally generated random systems.
- 2D top-down orrery with real-time Kepler orbital mechanics.
- Background generation of all rocky/icy bodies with check badges.
- Session and cross-session persistence (last active system restored on reload, body physics overrides saved to localStorage).
- Saved Systems panel with rename, delete, and active/modified indicators.
- Game clock with four speed controls.
- Body param overrides with Defaults reset.

### Sharing & Codes

- Compact base36 planet codes (~18 chars unedited, extended for plate edits) encoding seed + all sliders. URL hash sharing. Load by paste + Enter.

### UI & Platform

- Fully responsive bottom-sheet layout on mobile (<=768px), touch-pinch zoom, edit-mode toggle replacing Ctrl-click on touch devices.
- Emoji globe favicon (SVG inline). Full Open Graph and Twitter Card meta tags with preview image. JSON-LD structured data for search engines. llms.txt for AI assistants.
- Tutorial modal (3 steps), collapsible sidebar sections, constraint warning strip for implausible planetary combinations.
- On-demand climate computation — skip at high detail for fast terrain iteration, compute on demand.
- Generation runs in a Web Worker with a live progress bar — UI stays responsive at all detail levels.

---

## Open Items

### Known Dead Code
- **`buildDriftArrows` in `planet-mesh.js`** has a bare `return;` after the cleanup block, making the arrow-drawing code (plate velocity arrows on the globe) permanently unreachable. This was intentionally deferred while the function was being designed. It should either be finished or removed. The cleanup path still runs correctly, so there is no bug — it just does nothing visually.

### No Undo for Plate Edits
- Ctrl-click (or edit-mode tap on mobile) triggers a full recompute and is irreversible within a session. A simple undo stack (even just one level deep) would make editing feel safe. Low complexity, medium value.

### `elevation.js` is a Large File
- `elevation.js` is approximately 970 lines handling collision detection, stress propagation, distance fields, rift/ridge/fracture/back-arc BFS, coastal roughening, island arcs, hotspot volcanism, and final elevation assembly. It is internally well-structured with named helper functions and has remained maintainable in practice, but further extraction into separate feature files would make it easier to reason about individual systems in isolation.

### No Keyboard Shortcuts for Common Actions
- There are no global hotkeys (e.g. Space to generate, G for globe/map toggle, W for wireframe). The only keyboard handling is Escape to close modals and Enter on text inputs. Low effort, power-user quality-of-life.

---

## Priority Summary

| Item | Priority | Notes |
|------|----------|-------|
| Finish or remove `buildDriftArrows` | Low | Dead code; no user-visible impact |
| Undo for plate edits | Low-Medium | Makes editing feel safe |
| Keyboard shortcuts | Low | Power-user QoL |
| `elevation.js` refactor | Low | Maintainability, not functionality |

---

## Bottom Line

The app has shipped well beyond the original V1 scope. All must-have and should-have items from the original review have been addressed: Web Worker generation, mobile layout, loading state, full export suite, climate/biome simulation, OG/social metadata, favicon, and edit-mode discoverability. The remaining open items are quality-of-life improvements rather than gaps in core functionality. The product is in a strong, market-ready state.
