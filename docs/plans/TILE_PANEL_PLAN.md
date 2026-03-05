# Tile Detail Panel — Implementation Plan

**Status:** In Progress  
**Date:** March 2026  
**Feeds into:** Heliosphere colony-founding UX

---

## Goal

When a user left-clicks any tile on the globe or map, a floating detail card appears near
the click point showing rich terrain and climate data for that cell, plus a stubbed
"Found Settlement" button. This becomes the interaction foundation for colony placement
in the future Heliosphere project.

Ctrl+click continues to edit tectonic plates (unchanged).

---

## Decisions

| Question | Decision |
|---|---|
| Target codebase | World Orogen only (port to Heliosphere later) |
| UI treatment | Floating card anchored near click, clamped to viewport |
| Dismiss | X button OR click-away (clicking another tile = close + open new) |
| Selection highlight | Yes — distinct gold tint on clicked cell, persistent while panel open |
| Mobile | Skip — desktop only for now |
| Found Settlement button | UI stub only, does nothing |
| Hover card while panel open | Suppressed |

---

## Content Spec

### Header
- Biome name (full name from KOPPEN_CLASSES, e.g. "Tropical Rainforest")
- Lat / Lon (degrees)
- Land / Ocean badge
- × close button

### Terrain Section
- Elevation (km, with ocean depth shown as negative)
- Plate ID and type (Land / Ocean plate)

### Climate Section *(graceful fallback if climate not computed)*
- Temperature: Summer °C / Winter °C (with color indicator hot→cold)
- Precipitation: Summer mm / Winter mm
- Wind: compass direction + Beaufort-class word, both seasons
- Ocean current *(ocean tiles only)*: direction, warm/cold indicator
- Habitability index: 0.00 – 1.00 progress bar
- Hydrosphere state: label (Liquid Ocean / Ice / Dry Basin / Land)
- Full Köppen zone name + color swatch

### Colony Section
- "No settlement here yet." placeholder text
- "Found Settlement" button (visually present, disabled/muted)

---

## Files Changed

| File | Change |
|---|---|
| `index.html` | Add `#tilePanel` div; update tutorial overlay |
| `styles.css` | Style `#tilePanel` and inner sections |
| `js/state.js` | Add `selectedRegion: null` and `_selectionBackup: null` |
| `js/planet-mesh.js` | Add `updateSelectionHighlight()`, `clearSelectionHighlight()`, map variants |
| `js/edit-mode.js` | Plain click handler, `buildTilePanelHTML()`, `showTilePanel()`, `hideTilePanel()`; hover suppression; click-away |
| `js/main.js` | Call `clearSelection` + `hideTilePanel` in generate-done handlers |
| `README.md` | Document tile-click interaction |

---

## Implementation Phases

### Phase 1 — Foundation (HTML + CSS + State)

1. **`index.html`** — Insert `<div id="tilePanel">` immediately before `</body>`. Structure:
   ```html
   <div id="tilePanel">
     <div class="tp-header">
       <span class="tp-biome-swatch"></span>
       <div class="tp-title">
         <span class="tp-biome-name">—</span>
         <span class="tp-coords"></span>
       </div>
       <span class="tp-badge"></span>
       <button class="tp-close">×</button>
     </div>
     <div class="tp-section" id="tp-terrain"> … </div>
     <div class="tp-section" id="tp-climate"> … </div>
     <div class="tp-section" id="tp-colony"> … </div>
   </div>
   ```

2. **`styles.css`** — Dark card (~300px wide), fixed position (set by JS), border matching
   existing `.hoverInfo` card style, scrollable, section headers with subtle dividers,
   biome swatch as small colored square, disabled-look "Found Settlement" button,
   responsive font sizes matching existing UI.

3. **`js/state.js`** — Add two fields to the exported state object:
   ```js
   selectedRegion: null,
   _selectionBackup: null,
   ```

### Phase 2 — Selection Highlight (planet-mesh.js)

4. `updateSelectionHighlight(region)` — saves original RGB of the single cell's vertices
   into `state._selectionBackup = { region, globe: {offsets, saved}, map: {offsets, saved} }`,
   then applies a warm gold tint: R+=0.40, G+=0.35, B+=0.00, clamped to 1.0.
   Does nothing if `curData` is null. Clears any existing backup first.

5. `clearSelectionHighlight()` — restores saved vertex colors from `state._selectionBackup`,
   nulls backup. Safe to call when no selection is active.

6. Both functions update globe mesh AND map mesh color buffers in one call (unlike the
   hover highlight which has separate globe/map exports) — simpler since we only need one
   call at a time.

7. Both functions exported from `planet-mesh.js` and imported in `edit-mode.js` and
   `main.js`.

### Phase 3 — Click Handler + Panel Logic (edit-mode.js)

8. In `setupEditMode()`, add a `pointerdown` / `pointerup` pair for plain left-click:
   - Fires when `button === 0` AND `!ctrlKey` AND NOT mobile edit mode
   - Stores `{x, y}` on pointerdown; on pointerup, checks distance < 6px
   - Calls `getHitInfo(event)` — returns `{region, plate}` or null
   - If hit valid region: calls `showTilePanel(region, clientX, clientY)`
   - If no region hit (empty space click): calls `hideTilePanel()`
   - Click-away: if `state.selectedRegion !== null` AND click is outside `#tilePanel`,
     `hideTilePanel()` before running the new click logic

9. `buildTilePanelHTML(region)` — Decodes all data fields using the same decode logic as
   `buildHoverHTML`, plus the new fields:

   **Wind direction + Beaufort** (when climate computed):
   ```js
   const windAngle = Math.atan2(r_wind_east_summer[region], r_wind_north_summer[region]);
   const compass = angleToCompass(windAngle);   // returns "NNW", "SE", etc.
   const beaufort = speedToBeaufort(windSpeed); // returns "Calm", "Breeze", "Gale", etc.
   ```

   **Ocean current** (ocean tiles only):
   ```js
   const warmth = r_ocean_warmth_summer[region]; // > 0.5 = warm, < 0.5 = cold
   const speed  = r_ocean_speed_summer[region];
   ```

   **Habitability:**
   ```js
   const hab = (debugLayers.habitability?.[region] ?? 0);
   ```

   **Hydrosphere state:**
   ```js
   const HS_LABELS = ['Dry Basin', 'Ice', 'Liquid Ocean', 'Land'];
   const hsLabel = HS_LABELS[debugLayers.hydroState?.[region] ?? 3];
   ```

   **Full biome name:**
   ```js
   import { KOPPEN_CLASSES } from './koppen.js';
   const koppenId = debugLayers.koppen?.[region] ?? -1;
   const biomeName = KOPPEN_CLASSES[koppenId]?.name ?? '—';
   const biomeColor = KOPPEN_CLASSES[koppenId]?.color ?? [0.5, 0.5, 0.5];
   ```

10. `showTilePanel(region, cx, cy)`:
    - Sets `state.selectedRegion = region`
    - Calls `updateSelectionHighlight(region)`
    - Calls `buildTilePanelHTML(region)` → sets `innerHTML` of `#tilePanel`
    - Positions: default right of click; flip left if `cx + 320 > window.innerWidth`;
      default below click; flip up if needed
    - Sets `display = 'block'`

11. `hideTilePanel()`:
    - `state.selectedRegion = null`
    - `clearSelectionHighlight()`
    - `tilePanel.style.display = 'none'`

12. Hover suppression: in `pointermove` handler, add early return if
    `state.selectedRegion !== null`.

### Phase 4 — main.js Cleanup Wiring

13. Import `hideTilePanel` from `edit-mode.js` and `clearSelectionHighlight` from
    `planet-mesh.js` in `main.js`.

14. In the standalone-planet `generate-done` handler and the solar-system body-view
    `generate-done` handler, call:
    ```js
    hideTilePanel();
    clearSelectionHighlight();
    ```
    This ensures a stale open panel is dismissed when a new planet is built.

### Phase 5 — Docs

15. **`README.md`** — Interaction table: add `Left-click tile | Opens tile detail panel`.
    Sidebar section: mention the floating tile detail card and "Found Settlement" stub.

16. **`index.html` `#tutorialOverlay`** — Update the relevant tutorial step (step 2 or 3)
    to mention clicking tiles for detailed info.

---

## Heliosphere Forward Path

When the Heliosphere project begins, the "Found Settlement" button stub evolves to:
1. Accept a settlement name input
2. Create a `Colony` object at `(lat, lon)` on the current body
3. Drop a visible pin/marker on the globe
4. Open the `colony-panel.ts` UI with resource slots and build queue

The rich climate data shown in the panel (habitability, temperature range, precip,
wind, ocean current) maps directly onto the colonisation-decision UX — the player
sees exactly why a location is good or bad before committing.

The `state.selectedRegion` pattern ports directly to Heliosphere's
`bodyView.selectedTile: number | null` state field.

---

## Verification Checklist

- [ ] Click land tile → panel shows terrain + climate, coords match hover card
- [ ] Click ocean tile → shows ocean current section, not land-specific data
- [ ] Click different tile while panel open → old closes, new opens, highlight updates
- [ ] Click empty globe space → panel closes
- [ ] Click × button → panel closes
- [ ] Ctrl+click still edits plates, does NOT open tile panel
- [ ] Rebuild planet → panel closes, selection clears
- [ ] No climate computed → climate section shows graceful "compute climate" fallback
- [ ] Click near right/bottom screen edge → panel clamped within viewport  
- [ ] Globe selection highlight clearly distinct from (brighter than) plate hover tint
- [ ] Mobile: no behavioral change (feature inactive on touch devices)
