// Plate interaction: hover info + ctrl-click to toggle land/sea.
// Uses analytical ray-sphere intersection instead of Three.js mesh raycasting
// for O(N) dot-product lookups rather than O(N) triangle intersection tests.

import * as THREE from 'three';
import { canvas, camera, mapCamera, getMoonBodyAtPointer, getParentDiscAtPointer, colonyGlobeGroup, colonyMapGroup } from './render/scene.js';
import { state } from './core/state.js';
import { editRecomputeViaWorker } from './generate.js';
import { computePlateColors, buildMesh, updateHoverHighlight, updateMapHoverHighlight, updateSelectionHighlight, clearSelectionHighlight, drawColonyMarkers, updateMapColonyMarkers } from './render/planet-mesh.js';
import { detailFromSlider } from './core/detail-scale.js';
import { KOPPEN_CLASSES } from './sim/koppen.js';
import { elevToHeightKm } from './render/color-map.js';
import { RESOURCE_TYPES, RESOURCE_LABELS, RESOURCE_ICONS, RESOURCE_COLORS } from './resources-gen.js';
import { getTier, createColony, colonyProductionRates } from './colony.js';
import { getGameDays } from './game-clock.js';

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const _inverseMatrix = new THREE.Matrix4();
const _localRay = new THREE.Ray();

/** Recompute elevation from the (possibly edited) plate data via worker. */
function recomputeElevation(onDone) {
    const detail = detailFromSlider(+document.getElementById('sN').value);
    const skipClimate = detail > 300000;
    editRecomputeViaWorker(onDone, skipClimate);
}

/** Find nearest region to a unit-sphere direction (max dot product). */
function findNearestRegion(nx, ny, nz) {
    const { mesh, r_xyz, r_plate } = state.curData;
    const N = mesh.numRegions;
    let bestDot = -2, bestR = -1;
    for (let r = 0; r < N; r++) {
        const dot = nx * r_xyz[3 * r] + ny * r_xyz[3 * r + 1] + nz * r_xyz[3 * r + 2];
        if (dot > bestDot) { bestDot = dot; bestR = r; }
    }
    if (bestR < 0) return null;
    return { region: bestR, plate: r_plate[bestR] };
}

/** Globe view: analytical ray-sphere intersection → nearest region.
 *  ~50-100x faster than Three.js mesh raycasting at high detail. */
function getHitInfoGlobe(event) {
    if (!state.planetMesh) return null;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // Priority: check colony markers first with a generous threshold
    if (colonyGlobeGroup.children.length) {
        const saved = raycaster.params.Mesh?.threshold;
        if (raycaster.params.Mesh) raycaster.params.Mesh.threshold = 0.04;
        const hits = raycaster.intersectObjects(colonyGlobeGroup.children, false);
        if (raycaster.params.Mesh) raycaster.params.Mesh.threshold = saved ?? 0;
        if (hits.length) {
            const r = hits[0].object.userData.region;
            if (r !== undefined && state.curData)
                return { region: r, plate: state.curData.r_plate[r] };
        }
    }

    // Transform ray into planet's local space (handles auto-rotation)
    _inverseMatrix.copy(state.planetMesh.matrixWorld).invert();
    _localRay.copy(raycaster.ray).applyMatrix4(_inverseMatrix);

    const ox = _localRay.origin.x, oy = _localRay.origin.y, oz = _localRay.origin.z;
    const dx = _localRay.direction.x, dy = _localRay.direction.y, dz = _localRay.direction.z;

    // Ray-sphere: |O + tD|² = R²  (a=1 since direction is normalised)
    const R = 1.08; // slightly above max elevation displacement
    const b = 2 * (ox * dx + oy * dy + oz * dz);
    const c = ox * ox + oy * oy + oz * oz - R * R;
    const disc = b * b - 4 * c;
    if (disc < 0) return null;

    const t = (-b - Math.sqrt(disc)) * 0.5;
    if (t < 0) return null;

    // Hit point → normalise to unit direction
    const hx = ox + t * dx, hy = oy + t * dy, hz = oz + t * dz;
    const len = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
    return findNearestRegion(hx / len, hy / len, hz / len);
}

/** Map view: unproject mouse → map plane → inverse equirect → nearest region. */
function getHitInfoMap(event) {
    if (!state.mapMesh) return null;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Intersect ray with z=0 plane to get world coords on the map
    raycaster.setFromCamera(mouse, mapCamera);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    if (Math.abs(d.z) < 1e-10) return null;
    const t = -o.z / d.z;
    const wx = o.x + t * d.x;
    const wy = o.y + t * d.y;

    // Priority: check colony map discs — use Three.js raycaster directly
    if (colonyMapGroup.children.length) {
        const hits = raycaster.intersectObjects(colonyMapGroup.children, false);
        if (hits.length) {
            const r = hits[0].object.userData.region;
            if (r !== undefined && state.curData)
                return { region: r, plate: state.curData.r_plate[r] };
        }
    }

    // Inverse equirectangular: map coords → lon/lat → unit sphere xyz
    const PI = Math.PI;
    const sx = 2 / PI;
    let lon = wx / sx + (state.mapCenterLon || 0);
    const lat = wy / sx;
    if (lat < -PI / 2 || lat > PI / 2) return null;
    // Wrap lon back to [-PI, PI]
    if (lon > PI) lon -= 2 * PI;
    else if (lon < -PI) lon += 2 * PI;

    const cosLat = Math.cos(lat);
    return findNearestRegion(
        cosLat * Math.sin(lon),
        Math.sin(lat),
        cosLat * Math.cos(lon)
    );
}

function getHitInfo(event) {
    if (!state.curData) return null;
    return state.mapMode ? getHitInfoMap(event) : getHitInfoGlobe(event);
}

/** Build multi-line hover HTML for a region. */
function buildHoverHTML(region, plate) {
    const d = state.curData;
    const isOcean = d.plateIsOcean.has(plate);
    const dot = `<span style="color:${isOcean ? '#4af' : '#6b3'}">●</span>`;
    const action = state.isTouchDevice ? 'Tap' : 'Ctrl-click';
    const lines = [];

    // Line 1: plate type + edit hint
    lines.push(`${dot} <b>${isOcean ? 'Ocean' : 'Land'}</b> plate · ${action} to ${isOcean ? 'raise land' : 'flood'}`);

    // Elevation
    const elev = d.r_elevation[region];
    const elevKm = elevToHeightKm(elev).toFixed(1);
    lines.push(`<span class="hi-label">Elev</span> ${elevKm} km`);

    // Lat/Lon from r_xyz
    const x = d.r_xyz[3 * region];
    const y = d.r_xyz[3 * region + 1];
    const z = d.r_xyz[3 * region + 2];
    const lat = Math.asin(Math.max(-1, Math.min(1, y))) * (180 / Math.PI);
    const lon = Math.atan2(x, z) * (180 / Math.PI);
    const latStr = Math.abs(lat).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S');
    const lonStr = Math.abs(lon).toFixed(1) + '°' + (lon >= 0 ? 'E' : 'W');
    lines.push(`<span class="hi-label">Coord</span> ${latStr}, ${lonStr}`);

    // Climate data (only if computed)
    if (state.climateComputed && d.r_temperature_summer) {
        // Recover °C from normalized 0-1 using the planetary temperature scale.
        // On Earth: dynT_MIN=-45, dynT_MAX=45 → same as the original fixed range.
        // On alien planets, the range adapts to the planet's temperature profile.
        const pp = state.planetaryParams;
        const eqT      = pp?.equatorialTempC ?? 28;
        const polarDrp = pp?.tempRangeC      ?? 47;
        const tMin = eqT - polarDrp - 26;   // matches dynT_MIN formula in temperature.js
        const tMax = eqT + 17;              // matches dynT_MAX formula
        const tRange = Math.max(1, tMax - tMin);
        const tS = tMin + Math.max(0, Math.min(1, d.r_temperature_summer[region])) * tRange;
        const tW = tMin + Math.max(0, Math.min(1, d.r_temperature_winter[region])) * tRange;
        if (elev <= 0) {
            // Ocean: show as SST
            lines.push(`<span class="hi-label">SST</span> ${tS.toFixed(0)}°C / ${tW.toFixed(0)}°C`);
        } else {
            lines.push(`<span class="hi-label">Temp</span> ${tS.toFixed(0)}°C / ${tW.toFixed(0)}°C`);

            // Precipitation (land only).
            // Multiply by 1250 mm — this maps the simulation's 0–1 normalised precip
            // to approximate mm/season (95th-percentile wet-season ≈ ~1250 mm for Earth).
            // Values above 1.0 (high-precipScale wet worlds) are allowed through unclamped.
            if (d.r_precip_summer) {
                const pS = (Math.max(0, d.r_precip_summer[region]) * 1250).toFixed(0);
                const pW = (Math.max(0, d.r_precip_winter[region]) * 1250).toFixed(0);
                lines.push(`<span class="hi-label">Precip</span> ${pS} / ${pW} mm (est.)`);
            }

            // Köppen (land only)
            if (d.debugLayers && d.debugLayers.koppen) {
                const kIdx = d.debugLayers.koppen[region];
                const kc = KOPPEN_CLASSES[kIdx];
                if (kc && kc.code !== 'Ocean') {
                    const [r, g, b] = kc.color;
                    const hex = '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
                    lines.push(`<span class="hi-label">Clima</span> <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${hex};vertical-align:middle;margin-right:4px"></span>${kc.code} — ${kc.name}`);
                }
            }
        }
    }

    return lines.join('<br>');
}

// ── Tile panel helpers ────────────────────────────────────────────────────────

/** Convert wind vector angle (atan2 of east/north) to 8-point compass label. */
function angleToCompass(rad) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const deg = ((rad * 180 / Math.PI) % 360 + 360) % 360;
    return dirs[Math.round(deg / 45) % 8];
}

/** Map normalised wind magnitude (0–1) to a Beaufort-class word. */
function windSpeedWord(mag) {
    if (mag < 0.05) return 'Calm';
    if (mag < 0.15) return 'Light';
    if (mag < 0.30) return 'Breeze';
    if (mag < 0.50) return 'Fresh';
    if (mag < 0.70) return 'Strong';
    return 'Gale';
}

/** Map temperature in °C to a CSS colour string. */
/** Minimal HTML-escape to prevent XSS in user-supplied strings. */
function htmlEsc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function tempDotColor(c) {
    if (c <= -40) return '#88aaff';
    if (c <=   0) return '#aaccff';
    if (c <=  15) return '#aaffcc';
    if (c <=  30) return '#ffee88';
    if (c <=  50) return '#ffaa44';
    return '#ff4422';
}

/** Build the resource potential bars section for the tile panel. */
function buildResourceSectionHTML(region) {
    const d = state.curData;
    if (!d?.debugLayers?.resourceFood) {
        return '<div class="tp-climate-note">Generate a planet to see resource data.</div>';
    }
    const layerKeys = { food: 'resourceFood', water: 'resourceWater', metals: 'resourceMetals', fuel: 'resourceFuel' };
    return RESOURCE_TYPES.map(key => {
        const val = Math.max(0, Math.min(1, d.debugLayers[layerKeys[key]]?.[region] ?? 0));
        const pct = Math.round(val * 100);
        const hex = RESOURCE_COLORS[key];
        return `<div class="tp-res-row">
  <span class="tp-res-icon">${RESOURCE_ICONS[key]}</span>
  <span class="tp-res-lbl">${RESOURCE_LABELS[key]}</span>
  <span class="tp-res-bar-bg"><span class="tp-res-bar-fill" style="width:${pct}%;background:${hex}"></span></span>
  <span class="tp-res-pct">${pct}%</span>
</div>`;
    }).join('');
}

/** Build the colony section HTML for a tile panel (founded or founding UI). */
function buildColonySectionHTML(region) {
    const bodyId = state.activeBodyId || 'standalone';
    const colony  = state.colonies.find(c => c.bodyId === bodyId && c.region === region);
    if (colony) {
        const tier  = getTier(colony.population);
        const rates = colonyProductionRates(colony, state.curData);
        return `<div class="tp-colony-name">${htmlEsc(colony.name)}</div>
<div class="tp-colony-tier">${tier.name} &middot; Pop. ${colony.population.toLocaleString()}</div>
<div class="tp-sectitle" style="margin-top:6px;margin-bottom:4px">STOCKPILE</div>
<div class="tp-colony-rates">
  <span class="tp-rate-item">${RESOURCE_ICONS.food} ${colony.stockpile.food.toLocaleString()}</span>
  <span class="tp-rate-item">${RESOURCE_ICONS.water} ${colony.stockpile.water.toLocaleString()}</span>
  <span class="tp-rate-item">${RESOURCE_ICONS.metals} ${colony.stockpile.metals.toLocaleString()}</span>
  <span class="tp-rate-item">${RESOURCE_ICONS.fuel} ${colony.stockpile.fuel.toLocaleString()}</span>
</div>
<div class="tp-sectitle" style="margin-top:8px;margin-bottom:4px">PRODUCTION / TICK</div>
<div class="tp-colony-rates">
  <span class="tp-rate-item">${RESOURCE_ICONS.food} +${rates.food}</span>
  <span class="tp-rate-item">${RESOURCE_ICONS.water} +${rates.water}</span>
  <span class="tp-rate-item">${RESOURCE_ICONS.metals} +${rates.metals}</span>
  <span class="tp-rate-item">${RESOURCE_ICONS.fuel} +${rates.fuel}</span>
</div>`;
    }
    const canFound = !!(state.curData?.debugLayers?.resourceFood);
    return `<div class="tp-colony-empty">No settlement here yet.</div>
<div class="tp-colony-name-row">
  <input class="tp-colony-name-input" id="tp-colony-name" type="text" placeholder="Settlement name\u2026" maxlength="40"${canFound ? '' : ' disabled'}>
</div>
<button class="tp-found-btn" id="tp-found-btn" disabled>&#x2295; Found Settlement</button>`;
}

/** Build the inner HTML for the tile detail panel. */
function buildTilePanelHTML(region) {
    const d = state.curData;
    const plate   = d.r_plate[region];
    const isOcean = d.plateIsOcean.has(plate);
    const elevKm  = elevToHeightKm(d.r_elevation[region]);

    // Coordinates
    const rx = d.r_xyz[3 * region], ry = d.r_xyz[3 * region + 1], rz = d.r_xyz[3 * region + 2];
    const lat    = Math.asin(Math.max(-1, Math.min(1, ry))) * (180 / Math.PI);
    const lon    = Math.atan2(rx, rz) * (180 / Math.PI);
    const latStr = Math.abs(lat).toFixed(1) + '\u00b0' + (lat >= 0 ? 'N' : 'S');
    const lonStr = Math.abs(lon).toFixed(1) + '\u00b0' + (lon >= 0 ? 'E' : 'W');

    // K\u00f6ppen biome
    let biomeName = isOcean ? 'Ocean' : 'Land';
    let biomeHex  = isOcean ? '#1a4488' : '#3a6a2a';
    let koppenCode = '\u2014';
    if (state.climateComputed && d.debugLayers && d.debugLayers.koppen) {
        const kIdx = d.debugLayers.koppen[region];
        const kc   = KOPPEN_CLASSES[kIdx];
        if (kc) {
            biomeName  = kc.name;
            koppenCode = kc.code;
            const [r, g, b] = kc.color;
            biomeHex = '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
        }
    }

    // Climate rows
    let climateRows = '';
    if (!state.climateComputed) {
        climateRows = '<div class="tp-climate-note">Switch to a Climate view to compute climate data.</div>';
    } else {
        // Temperature
        if (d.r_temperature_summer) {
            const pp      = state.planetaryParams;
            const eqT     = pp?.equatorialTempC ?? 28;
            const tMin    = eqT - (pp?.tempRangeC ?? 47) - 26;
            const tRange  = Math.max(1, (eqT + 17) - tMin);
            const tS = (tMin + Math.max(0, Math.min(1, d.r_temperature_summer[region])) * tRange).toFixed(0);
            const tW = (tMin + Math.max(0, Math.min(1, d.r_temperature_winter[region])) * tRange).toFixed(0);
            climateRows += `<div class="tp-row"><span class="tp-lbl">Temp</span><span class="tp-val"><span class="tp-tdot" style="background:${tempDotColor(+tS)}"></span>${tS}\u00b0C / <span class="tp-tdot" style="background:${tempDotColor(+tW)}"></span>${tW}\u00b0C <span class="tp-sub">Su / Wi</span></span></div>`;
        }
        // Precipitation (land only)
        if (!isOcean && d.r_precip_summer) {
            const pS = (Math.max(0, d.r_precip_summer[region]) * 1250).toFixed(0);
            const pW = (Math.max(0, d.r_precip_winter[region]) * 1250).toFixed(0);
            climateRows += `<div class="tp-row"><span class="tp-lbl">Precip</span><span class="tp-val">${pS} / ${pW} mm <span class="tp-sub">Su / Wi</span></span></div>`;
        }
        // Wind
        if (d.r_wind_east_summer) {
            const weS = d.r_wind_east_summer[region],  wnS = d.r_wind_north_summer[region];
            const weW = d.r_wind_east_winter[region],  wnW = d.r_wind_north_winter[region];
            const dS  = angleToCompass(Math.atan2(weS, wnS)) + ' ' + windSpeedWord(Math.sqrt(weS*weS + wnS*wnS));
            const dW  = angleToCompass(Math.atan2(weW, wnW)) + ' ' + windSpeedWord(Math.sqrt(weW*weW + wnW*wnW));
            climateRows += `<div class="tp-row"><span class="tp-lbl">Wind</span><span class="tp-val">${dS} / ${dW} <span class="tp-sub">Su / Wi</span></span></div>`;
        }
        // Ocean current (ocean tiles only)
        if (isOcean && d.r_ocean_current_east_summer) {
            const ocES = d.r_ocean_current_east_summer[region],  ocNS = d.r_ocean_current_north_summer[region];
            const ocEW = d.r_ocean_current_east_winter[region],  ocNW = d.r_ocean_current_north_winter[region];
            const wS = d.r_ocean_warmth_summer[region],  wW = d.r_ocean_warmth_winter[region];
            const therm = v => v > 0.6 ? 'Warm' : v < 0.4 ? 'Cold' : 'Neutral';
            const dS = angleToCompass(Math.atan2(ocES, ocNS)) + ' ' + therm(wS);
            const dW = angleToCompass(Math.atan2(ocEW, ocNW)) + ' ' + therm(wW);
            climateRows += `<div class="tp-row"><span class="tp-lbl">Current</span><span class="tp-val">${dS} / ${dW} <span class="tp-sub">Su / Wi</span></span></div>`;
        }
        // Habitability
        if (d.debugLayers && d.debugLayers.habitability) {
            const hab = Math.max(0, Math.min(1, d.debugLayers.habitability[region]));
            const pct = Math.round(hab * 100);
            const hc  = hab < 0.25 ? '#c44' : hab < 0.55 ? '#ca4' : '#4a4';
            climateRows += `<div class="tp-row"><span class="tp-lbl">Habitability</span><span class="tp-val"><span class="tp-habbar"><span class="tp-habfill" style="width:${pct}%;background:${hc}"></span></span>\u00a0${pct}%</span></div>`;
        }
        // Hydrosphere state: 0=liquid ocean, 1=frozen, 2=dry basin, 3=land
        if (d.debugLayers && d.debugLayers.hydroState) {
            const HS = ['Liquid Ocean', 'Frozen', 'Dry Basin', 'Land'];
            climateRows += `<div class="tp-row"><span class="tp-lbl">Hydro</span><span class="tp-val">${HS[d.debugLayers.hydroState[region]] ?? 'Land'}</span></div>`;
        }
    }

    const elevStr = elevKm >= 0 ? `+${elevKm.toFixed(2)} km` : `${elevKm.toFixed(2)} km`;
    return `<div class="tp-header">
  <span class="tp-swatch" style="background:${biomeHex}"></span>
  <div class="tp-title"><span class="tp-bname">${biomeName}</span><span class="tp-kcode">${koppenCode}</span></div>
  <span class="tp-badge ${isOcean ? 'tp-ocean' : 'tp-land'}">${isOcean ? 'Ocean' : 'Land'}</span>
  <button class="tp-close" id="tpClose">&times;</button>
</div>
<div class="tp-body">
  <div class="tp-sec">
    <div class="tp-sectitle">TERRAIN</div>
    <div class="tp-row"><span class="tp-lbl">Elevation</span><span class="tp-val">${elevStr}</span></div>
    <div class="tp-row"><span class="tp-lbl">Plate</span><span class="tp-val">${isOcean ? 'Ocean' : 'Land'} #${plate}</span></div>
    <div class="tp-row"><span class="tp-lbl">Coords</span><span class="tp-val">${latStr}, ${lonStr}</span></div>
  </div>
  <div class="tp-sec">
    <div class="tp-sectitle">RESOURCES</div>
    ${buildResourceSectionHTML(region)}
  </div>
  <div class="tp-sec">
    <div class="tp-sectitle">CLIMATE</div>
    ${climateRows}
  </div>
  <div class="tp-sec tp-colony-sec">
    <div class="tp-sectitle">COLONY</div>
    ${buildColonySectionHTML(region)}
  </div>
</div>`;
}

/** Attach drag-to-reposition behavior to a tile panel's header. */
function setupPanelDrag(panel) {
    const header = panel.querySelector('.tp-header');
    if (!header) return;
    let dragState = null;
    const onDragMove = (ev) => {
        if (!dragState) return;
        const pw = panel.offsetWidth, ph = panel.offsetHeight;
        panel.style.left = Math.max(0, Math.min(window.innerWidth  - pw, dragState.origLeft + ev.clientX - dragState.startX)) + 'px';
        panel.style.top  = Math.max(0, Math.min(window.innerHeight - ph, dragState.origTop  + ev.clientY - dragState.startY)) + 'px';
    };
    const onDragEnd = () => {
        dragState = null;
        document.removeEventListener('pointermove', onDragMove);
        header.style.cursor = 'grab';
    };
    header.addEventListener('pointerdown', (ev) => {
        if (ev.target.closest('.tp-close')) return;
        ev.preventDefault();
        const rect = panel.getBoundingClientRect();
        dragState = { startX: ev.clientX, startY: ev.clientY, origLeft: rect.left, origTop: rect.top };
        header.style.cursor = 'grabbing';
        document.addEventListener('pointermove', onDragMove);
        document.addEventListener('pointerup', onDragEnd, { once: true });
    });
}

/** Wire the colony founding input + button inside the panel's colony section. */
function wireColonyHandlers(panel, region) {
    const nameInput = panel.querySelector('#tp-colony-name');
    const foundBtn  = panel.querySelector('#tp-found-btn');
    if (!nameInput || !foundBtn) return;

    const updateBtn = () => {
        const enabled = nameInput.value.trim().length > 0;
        foundBtn.disabled = !enabled;
        foundBtn.classList.toggle('enabled', enabled);
    };
    nameInput.addEventListener('input', updateBtn);

    foundBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) return;
        const d  = state.curData;
        const rx = d.r_xyz[region * 3], ry = d.r_xyz[region * 3 + 1], rz = d.r_xyz[region * 3 + 2];
        const lat = Math.asin(Math.max(-1, Math.min(1, ry))) * (180 / Math.PI);
        const lon = Math.atan2(rx, rz) * (180 / Math.PI);
        const bodyId   = state.activeBodyId || 'standalone';
        const systemId = state.currentSystemId || null;
        state.colonies.push(createColony({ bodyId, systemId, region, lat, lon, name, gameDays: getGameDays() }));
        drawColonyMarkers(state.colonies, bodyId);
        updateMapColonyMarkers(state.colonies, bodyId, state.mapCenterLon || 0);
        window._refreshHUD?.();
        // Re-render colony section in-place (shows info view now that colony exists)
        const colSec = panel.querySelector('.tp-colony-sec');
        if (colSec) {
            colSec.innerHTML = '<div class="tp-sectitle">COLONY</div>' + buildColonySectionHTML(region);
        }
    });
}

/** Show the tile detail panel near (cx, cy) and highlight the clicked region. */
function showTilePanel(region, cx, cy) {
    const panel = document.getElementById('tilePanel');
    if (!panel) return;

    // Clear any plate hover so it doesn't overlap the panel
    state.hoveredPlate  = -1;
    state.hoveredRegion = -1;
    document.getElementById('hoverInfo').style.display = 'none';
    if (state.mapMode) updateMapHoverHighlight();
    else updateHoverHighlight();

    state.selectedRegion = region;
    updateSelectionHighlight(region);

    panel.innerHTML = buildTilePanelHTML(region);
    document.getElementById('tpClose')?.addEventListener('click', hideTilePanel);
    setupPanelDrag(panel);
    wireColonyHandlers(panel, region);

    // Position: right of click; flip left if near right edge
    const W = 308, margin = 14;
    let left = cx + margin;
    if (left + W > window.innerWidth - 8) left = cx - W - margin + 12;
    if (left < 8) left = 8;
    panel.style.left = left + 'px';
    panel.style.top  = Math.max(8, cy - 24) + 'px';
    panel.style.display = 'block';

    // Clamp bottom edge after paint
    requestAnimationFrame(() => {
        if (!panel || panel.style.display === 'none') return;
        const rect = panel.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 8) {
            panel.style.top = Math.max(8, window.innerHeight - rect.height - 8) + 'px';
        }
    });
}

/** Hide the tile detail panel and clear the selection highlight. */
export function hideTilePanel() {
    state.selectedRegion = null;
    clearSelectionHighlight();
    const panel = document.getElementById('tilePanel');
    if (panel) panel.style.display = 'none';
}

/**
 * Open the tile panel for the given region, anchored at the horizontal centre
 * of the screen. Intended for programmatic navigation (e.g. clicking a colony
 * row in the settlement panel) where there is no pointer event to derive cx/cy.
 */
export function showTilePanelCentered(region) {
    showTilePanel(region, window.innerWidth * 0.5, window.innerHeight * 0.45);
}

/** Set up hover and ctrl-click event listeners. */
export function setupEditMode() {
    let downInfo = null;
    let tileDown = null; // tracks plain-left-click start for tile panel
    let orbiting = false;
    let lastHoverTime = 0;
    const HOVER_INTERVAL = 50; // ms — cap hover lookups

    canvas.addEventListener('pointerdown', (e) => {
        if (state.solarSystemMode) return;
        if (!state.curData) return;
        const isEditTap = (e.button === 0 && e.ctrlKey) ||
                          (e.button === 0 && state.isTouchDevice && state.editMode);
        if (isEditTap) {
            // Ctrl-click or mobile edit-mode tap: plate editing
            const hit = getHitInfo(e);
            if (!hit) return;
            downInfo = { x: e.clientX, y: e.clientY, plate: hit.plate };
        } else if (e.button === 0 || e.button === 2) {
            // Regular click/right-click: orbit or pan — skip hover raycasts
            orbiting = true;
            // Track plain left-click start for tile panel (desktop only)
            if (e.button === 0 && !state.isTouchDevice) {
                tileDown = { x: e.clientX, y: e.clientY };
            }
        }
    });

    canvas.addEventListener('pointerup', (e) => {
        orbiting = false;

        // Plain left-click → tile detail panel
        if (tileDown !== null && e.button === 0) {
            const tdx = e.clientX - tileDown.x;
            const tdy = e.clientY - tileDown.y;
            const wasClick = tdx * tdx + tdy * tdy < 36;
            tileDown = null;
            if (wasClick && !state.solarSystemMode && state.curData) {
                // Moon disc or parent planet disc click: navigate to that body
                if (state.currentSystem) {
                    const moonId = getMoonBodyAtPointer(e);
                    if (moonId) { window._enterBodyFromClick?.(moonId); return; }
                    const parentId = getParentDiscAtPointer(e);
                    if (parentId) { window._enterBodyFromClick?.(parentId); return; }
                }
                const hit = getHitInfo(e);
                if (hit) {
                    showTilePanel(hit.region, e.clientX, e.clientY);
                } else {
                    hideTilePanel();
                }
            }
        }

        if (state.solarSystemMode) { downInfo = null; return; }
        if (!downInfo || !state.curData || e.button !== 0) { downInfo = null; return; }

        const dx = e.clientX - downInfo.x;
        const dy = e.clientY - downInfo.y;

        if (dx * dx + dy * dy < 36) {
            const pid = downInfo.plate;
            const { plateIsOcean, plateDensity, plateDensityLand, plateDensityOcean } = state.curData;
            if (plateIsOcean.has(pid)) {
                plateIsOcean.delete(pid);
                plateDensity[pid] = plateDensityLand[pid];
            } else {
                plateIsOcean.add(pid);
                plateDensity[pid] = plateDensityOcean[pid];
            }

            const hoverEl = document.getElementById('hoverInfo');
            hoverEl.innerHTML = '\u23F3 Rebuilding\u2026';
            hoverEl.style.display = 'block';

            const btn = document.getElementById('generate');
            btn.disabled = true;
            btn.textContent = 'Building\u2026';
            btn.classList.add('generating');

            recomputeElevation(() => {
                btn.disabled = false;
                btn.textContent = 'Build New World';
                btn.classList.remove('generating');
                // Update hover info to reflect the new state
                if (state.hoveredRegion >= 0 && state.curData) {
                    hoverEl.innerHTML = buildHoverHTML(state.hoveredRegion, state.hoveredPlate);
                }
                // Notify main.js to update the planet code
                document.dispatchEvent(new CustomEvent('plates-edited'));
            });
        }
        downInfo = null;
    });

    canvas.addEventListener('pointermove', (e) => {
        if (state.solarSystemMode) {
            // Clear any stale hover state and hide the info card
            if (state.hoveredPlate >= 0 || state.hoveredRegion >= 0) {
                state.hoveredPlate = -1;
                state.hoveredRegion = -1;
                document.getElementById('hoverInfo').style.display = 'none';
            }
            return;
        }
        if (!state.curData) {
            if (state.hoveredPlate >= 0 || state.hoveredRegion >= 0) {
                state.hoveredPlate = -1;
                state.hoveredRegion = -1;
                document.getElementById('hoverInfo').style.display = 'none';
            }
            return;
        }

        // Skip while a tile panel is open (hover would overlap)
        if (state.selectedRegion !== null) return;
        // Skip while orbiting/panning — no hover lookup during drag
        if (orbiting) return;

        // Throttle hover updates
        const now = performance.now();
        if (now - lastHoverTime < HOVER_INTERVAL) return;
        lastHoverTime = now;

        const hit = getHitInfo(e);
        const newPlate = hit ? hit.plate : -1;
        const newRegion = hit ? hit.region : -1;

        // Update plate highlight only when plate changes
        if (newPlate !== state.hoveredPlate) {
            state.hoveredPlate = newPlate;
            if (state.mapMode) updateMapHoverHighlight();
            else updateHoverHighlight();
        }

        // Update info text when region changes
        if (newRegion !== state.hoveredRegion) {
            state.hoveredRegion = newRegion;
            const hoverEl = document.getElementById('hoverInfo');
            if (newRegion >= 0) {
                hoverEl.innerHTML = buildHoverHTML(newRegion, newPlate);
                hoverEl.style.display = 'block';
            } else {
                hoverEl.style.display = 'none';
            }
        }
    });

    // Close tile panel when clicking outside it (sidebar, buttons, empty canvas space)
    document.addEventListener('pointerdown', (e) => {
        if (state.selectedRegion === null) return;
        const panel = document.getElementById('tilePanel');
        if (panel && !panel.contains(e.target)) hideTilePanel();
    });
}
