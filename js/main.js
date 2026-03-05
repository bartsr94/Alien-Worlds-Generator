// Entry point — wires UI controls, animation loop, and kicks off initial generation.

import * as THREE from 'three';
import { renderer, scene, camera, ctrl, waterMesh, atmosMesh, starsMesh,
         mapCamera, updateMapCameraFrustum, mapCtrl, canvas,
         tickZoom, tickMapZoom,
         updateAtmosphereColor, updateWaterColor, updateHazeLayer,
         orreryCamera, orreryCtrl, tickOrreryZoom, updateOrreryCameraFrustum,
         switchToOrrery, switchToPlanetView } from './scene.js';
import { state } from './state.js';
import { generate, reapplyViaWorker, computeClimateViaWorker } from './generate.js';
import { encodePlanetCode, decodePlanetCode } from './planet-code.js';
import { buildMesh, updateMeshColors, buildMapMesh, rebuildGrids, exportMap, exportMapBatch, buildWindArrows, buildOceanCurrentArrows, updateKoppenHoverHighlight, updateMapKoppenHoverHighlight, clearSelectionHighlight } from './planet-mesh.js';
import { setupEditMode, hideTilePanel } from './edit-mode.js';
import { detailFromSlider, sliderFromDetail } from './detail-scale.js';
import { KOPPEN_CLASSES } from './koppen.js';
import { elevationToColor, setUpliftMult, setHasLiquidOcean,
         setBaseTemp, setAtmosphere, setHydrosphere } from './color-map.js';
import { buildPlanetaryParams, ATM_LABELS, HYDRO_LABELS } from './planetary-params.js';
import { OUR_SOLAR_SYSTEM, generateSystem } from './solar-system.js';
import { initOrrery, tickOrrery, enterOrrery, exitOrrery, getBodyAtMouse } from './orrery.js';
import { tickClock, getGameDate, isPaused, togglePause, setSpeedIndex,
         getSpeedIndex, resetClock } from './game-clock.js';
import { bodyParamsToSliderValues } from './system-planet-params.js';
import {
    loadRegistry, upsertSystem, deleteSystem, setActiveSystemId,
    getBodyOverride, saveBodyOverride, clearBodyOverride,
    markBodyGenerated, isBodyGenerated, renameSystem,
} from './system-storage.js';

// World Preset definitions — { gravity, atm, hydro, baseTemp, tilt }
const WORLD_PRESETS = {
    earth:    { gravity: 1.0, atm: 3, hydro: 3, baseTemp:   15, tilt: 23 },
    arid:     { gravity: 1.0, atm: 2, hydro: 1, baseTemp:   40, tilt: 25 },
    mars:     { gravity: 0.4, atm: 1, hydro: 0, baseTemp:  -60, tilt: 25 },
    venus:    { gravity: 0.9, atm: 5, hydro: 0, baseTemp:  460, tilt:  3 },
    ocean:    { gravity: 1.0, atm: 3, hydro: 5, baseTemp:   20, tilt: 20 },
    highgrav: { gravity: 2.5, atm: 3, hydro: 3, baseTemp:   15, tilt: 23 },
    iceball:  { gravity: 0.8, atm: 2, hydro: 2, baseTemp:  -80, tilt: 15 },
    titan:    { gravity: 0.1, atm: 4, hydro: 2, baseTemp: -180, tilt: 27 },
    deadrock: { gravity: 0.5, atm: 0, hydro: 0, baseTemp:    0, tilt: 10 },
};

// Slider value displays + stale tracking
const sliderIds = ['sN','sP','sCn','sJ','sNs','sGravity','sAtm','sHydro','sBaseTemp','sTilt'];
let lastGenValues = {};

function snapshotSliders() {
    for (const id of sliderIds) {
        const el = document.getElementById(id);
        if (el) lastGenValues[id] = el.value;
    }
}

function checkStale() {
    const btn = document.getElementById('generate');
    if (btn.classList.contains('generating')) return;
    const plateSliders = ['sP', 'sCn', 'sGravity', 'sAtm', 'sHydro', 'sBaseTemp', 'sTilt'];
    const detailSliders = ['sN', 'sJ', 'sNs'];
    const plateChanged = plateSliders.some(id => document.getElementById(id).value !== lastGenValues[id]);
    const detailChanged = detailSliders.some(id => document.getElementById(id).value !== lastGenValues[id]);
    btn.classList.remove('stale', 'regen');
    if (plateChanged) {
        btn.classList.add('regen');
        btn.textContent = 'Regenerate';
    } else if (detailChanged) {
        btn.classList.add('stale');
        btn.textContent = 'Rebuild';
    } else {
        btn.textContent = 'Build New World';
    }
}

// Reapply smoothing + erosion without full rebuild (via worker)
function reapplyPostProcessing() {
    const d = state.curData;
    if (!d || !d.prePostElev) return;

    const skipClimate = shouldSkipClimate();
    reapplyViaWorker(() => {
        reapplyBtn.classList.remove('spinning');
        updatePlanetCode(false);
        // If climate invalidated and viewing a climate layer, switch to Terrain
        if (skipClimate && CLIMATE_LAYERS.has(state.debugLayer)) {
            state.debugLayer = '';
            if (debugLayerEl) debugLayerEl.value = '';
            syncTabsToLayer('');
            updateMeshColors();
            updateLegend('');
        }
    }, skipClimate);
}

const reapplyBtn = document.getElementById('reapplyBtn');

function markReapplyPending() {
    reapplyBtn.disabled = false;
    reapplyBtn.classList.add('ready');
}

function clearReapplyPending() {
    reapplyBtn.disabled = true;
    reapplyBtn.classList.remove('ready');
}

reapplyBtn.addEventListener('click', () => {
    if (reapplyBtn.disabled) return;
    clearReapplyPending();
    reapplyBtn.classList.add('spinning');
    reapplyPostProcessing();
});

// Auto Climate checkbox — default OFF above threshold
const AUTO_CLIMATE_THRESHOLD = 300000;

// Detail slider warning update (lower thresholds on touch devices)
const WARN_ORANGE = state.isTouchDevice ? 200000 : 640000;
const WARN_RED    = state.isTouchDevice ? 500000 : 1280000;

function updateDetailWarning(detail) {
    const cg = document.getElementById('sN').closest('.cg');
    const warn = document.getElementById('detailWarn');
    cg.classList.remove('detail-orange', 'detail-red');
    warn.className = 'detail-warn';
    if (detail > WARN_RED) {
        cg.classList.add('detail-red');
        warn.classList.add('red');
        warn.textContent = '\u26A0 Very high \u2014 generation may be slow and unstable';
    } else if (detail > WARN_ORANGE) {
        cg.classList.add('detail-orange');
        warn.classList.add('orange');
        warn.textContent = '\u26A0 High detail \u2014 generation may be slow and unstable';
    } else {
        warn.textContent = '';
    }
}

// Slider thumb tooltip — floating value bubble near the thumb during drag
function initSliderTooltip(slider) {
    const cg = slider.closest('.cg');
    if (!cg) return;
    cg.style.position = 'relative';
    const tip = document.createElement('div');
    tip.className = 'slider-tooltip';
    cg.appendChild(tip);

    function positionTip() {
        const pct = (+slider.value - +slider.min) / (+slider.max - +slider.min);
        const thumbOffset = pct * slider.offsetWidth;
        tip.style.left = thumbOffset + 'px';
    }

    slider.addEventListener('pointerdown', () => {
        tip.textContent = document.getElementById(slider.id.replace('s', 'v')).textContent;
        positionTip();
        tip.classList.add('visible');
    });
    slider.addEventListener('input', () => {
        tip.textContent = document.getElementById(slider.id.replace('s', 'v')).textContent;
        positionTip();
    });
    const hide = () => tip.classList.remove('visible');
    slider.addEventListener('pointerup', hide);
    slider.addEventListener('pointercancel', hide);
}

for (const [s,v] of [['sN','vN'],['sP','vP'],['sCn','vCn'],['sJ','vJ'],['sNs','vNs'],['sTw','vTw'],['sS','vS'],['sGl','vGl'],['sHEr','vHEr'],['sTEr','vTEr'],['sRs','vRs'],['sGravity','vGravity'],['sAtm','vAtm'],['sHydro','vHydro'],['sBaseTemp','vBaseTemp'],['sTilt','vTilt']]) {
    const slider = document.getElementById(s);
    if (!slider) continue; // guard during incremental rollout
    initSliderTooltip(slider);
    slider.addEventListener('input', e => {
        const val = e.target.value;
        const num = +val;
        if (s === 'sN') {
            const detail = detailFromSlider(num);
            document.getElementById(v).textContent = detail.toLocaleString();
            updateDetailWarning(detail);
        } else if (s === 'sAtm') {
            document.getElementById(v).textContent = ATM_LABELS[num] ?? val;
        } else if (s === 'sHydro') {
            document.getElementById(v).textContent = HYDRO_LABELS[num] ?? val;
        } else if (s === 'sBaseTemp') {
            document.getElementById(v).textContent = `${num > 0 ? '+' : ''}${num}°C`;
        } else if (s === 'sTilt') {
            document.getElementById(v).textContent = `${num}°`;
        } else {
            document.getElementById(v).textContent = val;
        }
        if (s === 'sTw' || s === 'sS' || s === 'sGl' || s === 'sHEr' || s === 'sTEr' || s === 'sRs') {
            markReapplyPending();
        } else {
            checkStale();
        }
        if (s === 'sGravity' || s === 'sAtm' || s === 'sHydro' || s === 'sBaseTemp' || s === 'sTilt') {
            const wp = document.getElementById('worldPreset');
            if (wp) wp.value = 'custom';
            state.currentPreset = 'custom';
            updatePlanetWarnings();
        }
    });
}

// World Preset dropdown
const worldPresetEl = document.getElementById('worldPreset');
if (worldPresetEl) {
    worldPresetEl.addEventListener('change', e => {
        applyPreset(e.target.value);
    });
}

/** Returns true if climate should be skipped (detail above threshold). */
function shouldSkipClimate() {
    return detailFromSlider(+document.getElementById('sN').value) > AUTO_CLIMATE_THRESHOLD;
}

/**
 * Apply a named world preset to the five Planetary Physics sliders.
 * 'random' picks alien-range values randomly.
 */
function applyPreset(name) {
    let p = WORLD_PRESETS[name];
    if (!p) {
        if (name === 'random') {
            const gravList = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.2, 1.5, 1.8, 2.0, 2.5];
            const tempList = [-150, -100, -80, -60, -40, -20, 0, 30, 60, 100, 150, 200, 300, 400, 460];
            p = {
                gravity:  gravList[Math.floor(Math.random() * gravList.length)],
                atm:      Math.floor(Math.random() * 6),
                hydro:    Math.floor(Math.random() * 5),
                baseTemp: tempList[Math.floor(Math.random() * tempList.length)],
                tilt:     Math.floor(Math.random() * 81),
            };
        } else {
            return;
        }
    }
    const map = { sGravity: p.gravity, sAtm: p.atm, sHydro: p.hydro, sBaseTemp: p.baseTemp, sTilt: p.tilt };
    for (const [id, val] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.value = val;
        el.dispatchEvent(new Event('input'));
    }
    // input events above reset the dropdown to 'custom'; restore the preset label (random stays 'custom')
    const wp = document.getElementById('worldPreset');
    if (wp && name !== 'random') wp.value = name;
    state.currentPreset = (name !== 'random') ? name : 'custom';
}

/** Show constraint warnings for implausible planetary parameter combinations. */
function updatePlanetWarnings() {
    const el = document.getElementById('planetWarning');
    if (!el) return;
    const atm  = +(document.getElementById('sAtm')?.value      ?? 3);
    const hydro = +(document.getElementById('sHydro')?.value   ?? 3);
    const temp = +(document.getElementById('sBaseTemp')?.value ?? 15);
    const grav = +(document.getElementById('sGravity')?.value  ?? 1.0);
    const tilt = +(document.getElementById('sTilt')?.value     ?? 23);

    // Priority: errors first, then warnings
    if (atm === 0 && hydro >= 2) {
        el.textContent = '\u26A0 No atmosphere — surface liquids would instantly vaporize. Hydrosphere produces no weather or oceans.';
        el.className = 'planet-warning error';
    } else if (atm >= 4 && grav <= 0.3) {
        el.textContent = '\u26A0 A thick atmosphere on a very low-gravity world is unlikely to be retained — it would escape to space over geological time.';
        el.className = 'planet-warning warn';
    } else if (temp >= 150 && hydro >= 3 && atm <= 3) {
        el.textContent = '\u26A0 At these temperatures, liquid water boils away under normal pressure. Only a crushing atmosphere could keep it liquid.';
        el.className = 'planet-warning warn';
    } else if (tilt >= 60) {
        el.textContent = '\u2139 Extreme axial tilt causes severe seasons — polar regions alternate between months of constant sunlight and total darkness.';
        el.className = 'planet-warning warn';
    } else {
        el.textContent = '';
        el.className = 'planet-warning';
    }
}

// Climate layer keys — layers that require climate data
const CLIMATE_LAYERS = new Set([
    'pressureSummer', 'pressureWinter',
    'windSpeedSummer', 'windSpeedWinter',
    'oceanCurrentSummer', 'oceanCurrentWinter',
    'precipSummer', 'precipWinter',
    'rainShadowSummer', 'rainShadowWinter',
    'tempSummer', 'tempWinter',
    'koppen', 'biome', 'continentality',
    'hydroState', 'habitability',
]);

// Map tabs → tab-layer mapping
const mapTabs = document.getElementById('mapTabs');
const vizLegend = document.getElementById('vizLegend');
const debugLayerEl = document.getElementById('debugLayer');

function switchVisualization(layer) {
    if (CLIMATE_LAYERS.has(layer) && !state.climateComputed) {
        // Need to compute climate first
        showBuildOverlay();
        computeClimateViaWorker(onProgress, () => {
            hideBuildOverlay();
            applyLayer(layer);
        });
        return;
    }
    applyLayer(layer);
}

function applyLayer(layer) {
    state.debugLayer = layer;
    state.hoveredKoppen = -1;
    updateMeshColors();
    // Show/hide wind/ocean arrows
    const isWindLayer = layer === 'pressureSummer' || layer === 'pressureWinter' ||
                        layer === 'windSpeedSummer' || layer === 'windSpeedWinter';
    const isOceanLayer = layer === 'oceanCurrentSummer' || layer === 'oceanCurrentWinter';
    if (isOceanLayer) {
        const season = layer.includes('Winter') ? 'winter' : 'summer';
        buildWindArrows(null);
        buildOceanCurrentArrows(season);
    } else if (isWindLayer) {
        const season = layer.includes('Winter') ? 'winter' : 'summer';
        buildOceanCurrentArrows(null);
        buildWindArrows(season);
    } else {
        buildWindArrows(null);
        buildOceanCurrentArrows(null);
    }
    updateLegend(layer);
}

function syncTabsToLayer(layer) {
    mapTabs.querySelectorAll('.map-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.layer === layer);
    });
    // Sync mobile view switcher (only for main views it knows about)
    const mvs = document.getElementById('mobileViewSwitch');
    if (mvs && [...mvs.options].some(o => o.value === layer)) {
        mvs.value = layer;
    }
}

mapTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.map-tab');
    if (!tab) return;
    const layer = tab.dataset.layer;
    // Update active tab
    mapTabs.querySelectorAll('.map-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    // Sync debug dropdown + mobile switcher
    if (debugLayerEl) debugLayerEl.value = layer;
    mobileViewSwitch.value = layer;
    switchVisualization(layer);
});

// Mobile view switcher
const mobileViewSwitch = document.getElementById('mobileViewSwitch');
mobileViewSwitch.addEventListener('change', (e) => {
    const layer = e.target.value;
    syncTabsToLayer(layer);
    if (debugLayerEl) debugLayerEl.value = layer;
    switchVisualization(layer);
});

// Koppen climate zone descriptions for hover tooltips
const KOPPEN_DESCRIPTIONS = {
    Af:  'Tropical rainforest — Hot and wet year-round. Amazon Basin, Congo Basin, Southeast Asia.',
    Am:  'Tropical monsoon — Brief dry season offset by heavy monsoon rains. Southern India, West Africa, Northern Australia.',
    Aw:  'Tropical savanna — Distinct wet and dry seasons. Sub-Saharan Africa, Brazilian Cerrado, Northern Australia.',
    BWh: 'Hot desert — Extremely dry with scorching summers. Sahara, Arabian Desert, Sonoran Desert.',
    BWk: 'Cold desert — Arid with cold winters. Gobi Desert, Patagonian steppe, Great Basin.',
    BSh: 'Hot steppe — Semi-arid grassland with hot summers. Sahel, outback Australia, northern Mexico.',
    BSk: 'Cold steppe — Semi-arid with cold winters. Central Asian steppe, Montana, Anatolian plateau.',
    Cfa: 'Humid subtropical — Hot humid summers, mild winters. Southeastern US, eastern China, Buenos Aires.',
    Cfb: 'Oceanic — Mild year-round, cool summers, frequent rain. Western Europe, New Zealand, Pacific Northwest.',
    Cfc: 'Subpolar oceanic — Cool year-round with short summers. Iceland, southern Chile, Faroe Islands.',
    Csa: 'Hot-summer Mediterranean — Dry hot summers, mild wet winters. Southern California, Greece, coastal Turkey.',
    Csb: 'Warm-summer Mediterranean — Dry warm summers, mild wet winters. San Francisco, Porto, Cape Town.',
    Csc: 'Cold-summer Mediterranean — Cool dry summers, mild wet winters. Rare; high-altitude Mediterranean coasts.',
    Cwa: 'Humid subtropical monsoon — Warm with dry winters. Hong Kong, northern India, Southeastern Brazil highlands.',
    Cwb: 'Subtropical highland — Mild with dry winters. Mexico City, Bogota, Ethiopian Highlands.',
    Cwc: 'Cold subtropical highland — Cool with dry winters. Rare; high-altitude tropical mountains.',
    Dfa: 'Hot-summer continental — Hot summers, cold snowy winters. Chicago, Kyiv, Beijing.',
    Dfb: 'Warm-summer continental — Warm summers, cold winters. Moscow, southern Scandinavia, New England.',
    Dfc: 'Subarctic — Long cold winters, brief cool summers. Siberia, northern Canada, interior Alaska.',
    Dfd: 'Extremely cold subarctic — Harshest winters on Earth. Yakutsk, Verkhoyansk (eastern Siberia).',
    Dsa: 'Hot-summer continental, dry summer — Hot dry summers, cold winters. Parts of eastern Turkey, Iran.',
    Dsb: 'Warm-summer continental, dry summer — Dry warm summers, cold winters. Parts of the western US highlands.',
    Dsc: 'Subarctic, dry summer — Cool dry summers, very cold winters. Rare; high-altitude inland regions.',
    Dsd: 'Extremely cold subarctic, dry summer — Very rare; extreme cold with dry summers.',
    Dwa: 'Hot-summer continental, monsoon — Wet hot summers, dry cold winters. Northern China, Korea.',
    Dwb: 'Warm-summer continental, monsoon — Wet warm summers, dry cold winters. Parts of northeast China.',
    Dwc: 'Subarctic monsoon — Brief wet summers, long dry frigid winters. Eastern Siberia, far northeast China.',
    Dwd: 'Extremely cold subarctic, monsoon — Extreme cold, driest in winter. Interior eastern Siberia.',
    ET:  'Tundra — Permafrost, only warmest month above 0 C. Arctic coasts, high mountain plateaus.',
    EF:  'Ice cap — Permanent ice, never above 0 C. Antarctica interior, Greenland ice sheet.',
};

// Legend rendering
function updateLegend(layer) {
    if (!vizLegend) return;

    if (layer === '' || !layer) {
        // Terrain legend — colors from elevationToColor (already aware of hasLiquidOcean)
        const hasOcean = state.planetaryParams?.hasLiquidOcean !== false;
        const stops = [
            { e: -0.50, label: '' },
            { e: -0.25, label: '' },
            { e: -0.05, label: '' },
            { e: 0.00, label: '' },
            { e: 0.03, label: '' },
            { e: 0.15, label: '' },
            { e: 0.35, label: '' },
            { e: 0.55, label: '' },
            { e: 0.80, label: '' }
        ];
        const colors = stops.map(s => {
            const [r, g, b] = elevationToColor(s.e);
            return `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
        });
        const pcts = stops.map((_, i) => Math.round(i / (stops.length - 1) * 100));
        const gradStr = colors.map((c, i) => `${c} ${pcts[i]}%`).join(', ');
        const leftLabel  = hasOcean ? 'Deep Ocean' : 'Deep Basin';
        const midLabel   = hasOcean ? 'Sea Level'  : 'Ground';
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,${gradStr})"></div>` +
            `<div class="legend-labels"><span>${leftLabel}</span><span>${midLabel}</span><span>Peak</span></div>`;
    } else if (layer === 'koppen') {
        // Koppen legend — Wikipedia link + swatches with hover tooltips
        let html = '<div class="legend-koppen-header"><a href="https://en.wikipedia.org/wiki/K%C3%B6ppen_climate_classification" target="_blank" rel="noopener">K\u00f6ppen climate classification</a></div>';
        html += '<div class="legend-koppen">';
        for (let i = 1; i < KOPPEN_CLASSES.length; i++) {
            const k = KOPPEN_CLASSES[i];
            const [r, g, b] = k.color;
            const hex = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
            const desc = KOPPEN_DESCRIPTIONS[k.code] || k.name;
            html += `<div class="legend-koppen-item" data-code="${k.code}"><span class="legend-koppen-swatch" style="background:${hex}"></span>${k.code}</div>`;
        }
        html += '<div class="legend-koppen-tooltip" id="koppenTip"></div>';
        html += '</div>';
        vizLegend.innerHTML = html;
        // Wire hover tooltips with dynamic positioning
        const tipEl = document.getElementById('koppenTip');
        const container = vizLegend.querySelector('.legend-koppen');
        vizLegend.querySelectorAll('.legend-koppen-item').forEach(item => {
            item.addEventListener('mouseenter', () => {
                const code = item.dataset.code;
                const desc = KOPPEN_DESCRIPTIONS[code] || '';
                tipEl.textContent = desc;
                tipEl.classList.add('visible');
                // Position above the hovered item, clamped within the container
                const itemRect = item.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const tipWidth = 240;
                let left = itemRect.left - containerRect.left + itemRect.width / 2 - tipWidth / 2;
                left = Math.max(0, Math.min(left, containerRect.width - tipWidth));
                tipEl.style.left = left + 'px';
                tipEl.style.bottom = (containerRect.bottom - itemRect.top + 6) + 'px';
                // Highlight matching cells on the mesh
                const classId = KOPPEN_CLASSES.findIndex(c => c.code === code);
                if (classId >= 0) {
                    state.hoveredKoppen = classId;
                    updateKoppenHoverHighlight();
                    updateMapKoppenHoverHighlight();
                }
            });
            item.addEventListener('mouseleave', () => {
                tipEl.classList.remove('visible');
                state.hoveredKoppen = -1;
                updateKoppenHoverHighlight();
                updateMapKoppenHoverHighlight();
            });
        });
    } else if (layer === 'biome') {
        // Satellite biome legend — gradient bar of key biome colors
        const biomeStops = [
            { color: [0.82,0.72,0.50], label: 'Desert' },
            { color: [0.72,0.62,0.30], label: 'Steppe' },
            { color: [0.42,0.50,0.18], label: 'Savanna' },
            { color: [0.12,0.38,0.10], label: 'Forest' },
            { color: [0.06,0.22,0.08], label: 'Taiga' },
            { color: [0.35,0.32,0.22], label: 'Tundra' },
            { color: [0.78,0.80,0.84], label: 'Ice' },
        ];
        const biomeColors = biomeStops.map(s => {
            const [r, g, b] = s.color;
            return `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
        });
        const biomePcts = biomeStops.map((_, i) => Math.round(i / (biomeStops.length - 1) * 100));
        const biomeGrad = biomeColors.map((c, i) => `${c} ${biomePcts[i]}%`).join(', ');
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,${biomeGrad})"></div>` +
            `<div class="legend-labels"><span>${biomeStops[0].label}</span><span>${biomeStops[3].label}</span><span>${biomeStops[6].label}</span></div>`;
    } else if (layer === 'rainShadowSummer' || layer === 'rainShadowWinter') {
        // Rain shadow diverging legend: leeward shadow ↔ neutral ↔ windward boost
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,rgb(230,51,33) 0%,rgb(140,140,148) 50%,rgb(38,102,243) 100%)"></div>` +
            `<div class="legend-labels"><span>Rain Shadow</span><span>Neutral</span><span>Windward</span></div>`;
    } else if (layer === 'heightmap') {
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,#000 0%,#404040 25%,#fff 100%)"></div>` +
            `<div class="legend-labels"><span>Ocean Floor</span><span>Sea Level</span><span>Peak</span></div>`;
    } else if (layer === 'landheightmap') {
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,#000 0%,#fff 100%)"></div>` +
            `<div class="legend-labels"><span>Sea Level</span><span>Peak</span></div>`;
    } else if (layer === 'hydroState') {
        vizLegend.innerHTML =
            `<div class="legend-discrete">` +
            `<span class="ld-item"><span class="ld-swatch" style="background:rgb(10,46,173)"></span>Liquid Ocean</span>` +
            `<span class="ld-item"><span class="ld-swatch" style="background:rgb(204,230,247)"></span>Frozen</span>` +
            `<span class="ld-item"><span class="ld-swatch" style="background:rgb(184,140,71)"></span>Dry Basin</span>` +
            `<span class="ld-item"><span class="ld-swatch" style="background:rgb(87,77,66)"></span>Land</span>` +
            `</div>`;
    } else if (layer === 'habitability') {
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,rgb(51,20,20) 0%,rgb(191,102,13) 30%,rgb(191,170,13) 55%,rgb(20,184,56) 100%)"></div>` +
            `<div class="legend-labels"><span>Inhospitable</span><span>Marginal</span><span>Habitable</span></div>`;
    } else {
        vizLegend.innerHTML = '';
    }
}

// Build overlay — unified loading / generation overlay
const buildOverlay  = document.getElementById('buildOverlay');
const buildBarFill  = document.getElementById('buildBarFill');
const buildBarLabel = document.getElementById('buildBarLabel');
let overlayActive = true; // starts active (visible in HTML on first load)

function onProgress(pct, label) {
    if (!overlayActive) return;
    if (buildBarFill)  buildBarFill.style.transform = 'scaleX(' + (pct / 100) + ')';
    if (buildBarLabel) buildBarLabel.textContent = label;
}

function showBuildOverlay() {
    if (!buildBarFill || !buildOverlay) return;
    // Snap bar to 0 instantly — disable transition, reset transform, force reflow
    buildBarFill.style.transition = 'none';
    buildBarFill.style.transform = 'scaleX(0)';
    buildBarLabel.textContent = '';
    buildBarFill.offsetWidth; // force reflow
    buildBarFill.style.transition = '';
    overlayActive = true;
    buildOverlay.classList.remove('hidden');
}

function hideBuildOverlay() {
    setTimeout(() => {
        overlayActive = false;
        if (buildOverlay) {
            buildOverlay.classList.add('hidden');
            // After first generation, switch from opaque to semi-transparent
            buildOverlay.classList.remove('initial');
        }
    }, 500);
}

// Generate button
const genBtn = document.getElementById('generate');
genBtn.addEventListener('click', () => {
    clearReapplyPending();
    buildWindArrows(null); // dispose previous wind arrows
    buildOceanCurrentArrows(null); // dispose previous ocean arrows
    showBuildOverlay();
    // Collapse bottom sheet on mobile so user can see the planet build
    const ui = document.getElementById('ui');
    if (window.innerWidth <= 768 && ui) ui.classList.add('collapsed');
    // Rebuild: reuse seed + plate edits so only resolution/params change.
    // If plate-affecting sliders (Plates, Continents) changed, force a fresh
    // generation — the coarse plate grid is fully determined by seed + P + Cn.
    const plateSliders = ['sP', 'sCn'];
    const plateChanged = plateSliders.some(id => document.getElementById(id).value !== lastGenValues[id]);
    const isRebuild = genBtn.classList.contains('stale') && state.curData && !plateChanged;
    const seed = isRebuild ? state.curData.seed : undefined;
    const toggles = isRebuild ? getToggledIndices() : [];
    generate(seed, toggles, onProgress, shouldSkipClimate());
});
genBtn.addEventListener('generate-done', snapshotSliders);
genBtn.addEventListener('generate-done', hideBuildOverlay);
genBtn.addEventListener('generate-done', () => {
    // Close tile panel and clear selection on any user-triggered generation
    if (state.isBgGenerating) return;
    hideTilePanel();
    clearSelectionHighlight();
});
genBtn.addEventListener('generate-done', () => {
    const infoEl = document.getElementById('info');
    if (!infoEl.dataset.nudged) {
        infoEl.dataset.nudged = '1';
        infoEl.classList.add('nudge');
        infoEl.addEventListener('animationend', () => infoEl.classList.remove('nudge'), { once: true });
    }
}, { once: true });

// Planet code — display after generation, copy, load, URL hash
const seedInput = document.getElementById('seedCode');
const copyBtn   = document.getElementById('copyBtn');
const loadBtn   = document.getElementById('loadBtn');
let currentCode = ''; // the code for the currently loaded planet

function updateLoadBtn() {
    const val = seedInput.value.trim().toLowerCase();
    const ready = val.length > 0 && val !== currentCode;
    loadBtn.classList.toggle('ready', ready);
}

/** Get sorted array of toggled plate indices by diffing current vs original plateIsOcean. */
function getToggledIndices() {
    const d = state.curData;
    if (!d || !d.originalPlateIsOcean) return [];
    const indices = [];
    const seeds = Array.from(d.plateSeeds);
    for (let i = 0; i < seeds.length; i++) {
        const r = seeds[i];
        if (d.originalPlateIsOcean.has(r) !== d.plateIsOcean.has(r)) {
            indices.push(i);
        }
    }
    return indices;
}

/** Encode current planet state and update the seed input + URL hash. */
function updatePlanetCode(flash) {
    const d = state.curData;
    if (!d) return;
    const code = encodePlanetCode(
        d.seed,
        detailFromSlider(+document.getElementById('sN').value),
        +document.getElementById('sJ').value,
        +document.getElementById('sP').value,
        +document.getElementById('sCn').value,
        +document.getElementById('sNs').value,
        +document.getElementById('sTw').value,
        +document.getElementById('sS').value,
        +document.getElementById('sGl').value,
        +document.getElementById('sHEr').value,
        +document.getElementById('sTEr').value,
        +document.getElementById('sRs').value,
        +(document.getElementById('sSc')?.value ?? 0.75),
        getToggledIndices(),
        +(document.getElementById('sGravity')?.value  ?? 1.0),
        +(document.getElementById('sAtm')?.value      ?? 3),
        +(document.getElementById('sHydro')?.value    ?? 3),
        +(document.getElementById('sBaseTemp')?.value  ?? 15),
        +(document.getElementById('sTilt')?.value     ?? 23)
    );
    currentCode = code;
    seedInput.value = code;
    updateLoadBtn();
    history.replaceState(null, '', '#' + code);
    if (flash) {
        seedInput.classList.add('flash');
        seedInput.addEventListener('animationend', () => seedInput.classList.remove('flash'), { once: true });
    }
}

genBtn.addEventListener('generate-done', () => {
    if (state.isBgGenerating || state.currentSystem) return; // solar system body — skip code update
    updatePlanetCode(false);
});
genBtn.addEventListener('generate-done', () => {
    if (state.isBgGenerating || state.currentSystem) return; // solar system body — skip standalone visual updates
    // Update state.planetaryParams from current slider values
    state.planetaryParams = buildPlanetaryParams({
        gravity:     +(document.getElementById('sGravity')?.value  ?? 1.0),
        atmosphere:  +(document.getElementById('sAtm')?.value      ?? 3),
        hydrosphere: +(document.getElementById('sHydro')?.value    ?? 3),
        baseTemp:    +(document.getElementById('sBaseTemp')?.value  ?? 15),
        axialTilt:   +(document.getElementById('sTilt')?.value     ?? 23),
        preset:      document.getElementById('worldPreset')?.value ?? 'custom',
    });
    // Update atmosphere rim glow and water sphere appearance
    updateAtmosphereColor(state.planetaryParams.atmosphereRimColor);
    updateWaterColor(state.planetaryParams.surfaceFluidColor);
    // Update atmospheric haze sphere — full-disc opacity layer for thick/crushing atmospheres
    updateHazeLayer(state.planetaryParams.hazeOpacity, state.planetaryParams.atmosphereTint);
    // Update elevToHeightKm scale so mountain heights display correctly for this gravity
    setUpliftMult(state.planetaryParams.upliftMultiplier);
    // Update terrain color ramp — dry worlds get basin grey instead of ocean blue
    setHasLiquidOcean(state.planetaryParams.hasLiquidOcean);
    // Update palette sub-variant selectors (temperature, atmosphere, hydrosphere)
    setBaseTemp(state.planetaryParams.baseTemp);
    setAtmosphere(state.planetaryParams.atmosphere);
    setHydrosphere(state.planetaryParams.hydrosphere);
    // If climate not computed and current view is a climate layer, switch to Terrain
    if (!state.climateComputed && CLIMATE_LAYERS.has(state.debugLayer)) {
        state.debugLayer = '';
        if (debugLayerEl) debugLayerEl.value = '';
        syncTabsToLayer('');
    }
    syncTabsToLayer(state.debugLayer);
    if (debugLayerEl) debugLayerEl.value = state.debugLayer;
    updateLegend(state.debugLayer);

    // Always re-render with the newly applied palette vars (setBaseTemp etc. changed
    // module state in color-map.js after buildMesh already ran with stale values).
    updateMeshColors();

    // Rebuild wind/ocean arrows if a relevant debug layer is active
    const v = state.debugLayer;
    const isWindLayer = v === 'pressureSummer' || v === 'pressureWinter' ||
                        v === 'windSpeedSummer' || v === 'windSpeedWinter';
    const isOceanLayer = v === 'oceanCurrentSummer' || v === 'oceanCurrentWinter';
    if (isWindLayer) {
        buildWindArrows(v.includes('Winter') ? 'winter' : 'summer');
    } else if (isOceanLayer) {
        buildOceanCurrentArrows(v.includes('Winter') ? 'winter' : 'summer');
    }
});

document.addEventListener('plates-edited', () => {
    updatePlanetCode(true);
    // If climate was invalidated and we're viewing a climate layer, switch to Terrain
    if (!state.climateComputed && CLIMATE_LAYERS.has(state.debugLayer)) {
        state.debugLayer = '';
        if (debugLayerEl) debugLayerEl.value = '';
        syncTabsToLayer('');
        updateMeshColors();
        updateLegend('');
    }
});

copyBtn.addEventListener('click', () => {
    if (!seedInput.value) return;
    navigator.clipboard.writeText(seedInput.value).then(() => {
        copyBtn.textContent = '\u2713';
        setTimeout(() => { copyBtn.textContent = '\u2398'; }, 1200);
    });
});

seedInput.addEventListener('input', () => {
    updateLoadBtn();
    seedError.classList.remove('visible');
});

const seedError = document.getElementById('seedError');

function applyCode(code) {
    const params = decodePlanetCode(code);
    if (!params) {
        seedInput.style.borderColor = '#c44';
        seedError.classList.add('visible');
        setTimeout(() => { seedInput.style.borderColor = ''; }, 1500);
        return;
    }
    seedError.classList.remove('visible');
    // Set slider values + fire input events to update displays
    const map = {
        sN: sliderFromDetail(params.N), sJ: params.jitter, sP: params.P,
        sCn: params.numContinents, sNs: params.roughness,
        sTw: params.terrainWarp, sS: params.smoothing, sGl: params.glacialErosion,
        sHEr: params.hydraulicErosion, sTEr: params.thermalErosion, sRs: params.ridgeSharpening,
        sSc: params.soilCreep ?? 0.75,
        sGravity: params.gravity ?? 1.0, sAtm: params.atmosphere ?? 3,
        sHydro: params.hydrosphere ?? 3, sBaseTemp: params.baseTemp ?? 15,
        sTilt: Math.round(params.axialTilt ?? 23),
    };
    for (const [id, val] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.value = val;
        el.dispatchEvent(new Event('input'));
    }
    clearReapplyPending();
    showBuildOverlay();
    generate(params.seed, params.toggledIndices, onProgress, shouldSkipClimate());
}

loadBtn.addEventListener('click', () => {
    applyCode(seedInput.value);
});

seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyCode(seedInput.value);
});

// View-mode checkboxes
document.getElementById('chkPlates').addEventListener('change', updateMeshColors);
document.getElementById('chkWire').addEventListener('change', buildMesh);

// Grid toggle
const gridSpacingGroup = document.getElementById('gridSpacingGroup');
document.getElementById('chkGrid').addEventListener('change', (e) => {
    state.gridEnabled = e.target.checked;
    gridSpacingGroup.style.display = state.gridEnabled ? '' : 'none';
    if (state.mapMode) {
        if (state.mapGridMesh) state.mapGridMesh.visible = state.gridEnabled;
        if (state.globeGridMesh) state.globeGridMesh.visible = false;
    } else {
        if (state.globeGridMesh) state.globeGridMesh.visible = state.gridEnabled;
        if (state.mapGridMesh) state.mapGridMesh.visible = false;
    }
});

// Grid spacing dropdown
document.getElementById('gridSpacing').addEventListener('change', (e) => {
    state.gridSpacing = parseFloat(e.target.value);
    rebuildGrids();
});

// Map center longitude slider — translate on drag (instant), rebuild on release
const mapCenterLonGroup = document.getElementById('mapCenterLonGroup');
const sMapCenterLon = document.getElementById('sMapCenterLon');
const vMapCenterLon = document.getElementById('vMapCenterLon');

sMapCenterLon.addEventListener('input', () => {
    const lon = +sMapCenterLon.value;
    const suffix = lon > 0 ? 'E' : lon < 0 ? 'W' : '';
    vMapCenterLon.textContent = Math.abs(lon) + '\u00B0' + suffix;
    state.mapCenterLon = lon * Math.PI / 180;
    if (state.mapMode && state.mapMesh) {
        // Instant GPU translation — wrap clones (children at ±4) fill edges
        const builtLon = state.mapMesh._builtCenterLon || 0;
        const dx = (builtLon - state.mapCenterLon) * (2 / Math.PI);
        state.mapMesh.position.x = dx;
        if (state.mapGridMesh) state.mapGridMesh.position.x = dx;
    }
});

sMapCenterLon.addEventListener('change', () => {
    if (state.mapMode) {
        buildMapMesh();
        // Rebuild arrows if a wind/ocean layer is active
        const layer = state.debugLayer;
        const isWind = layer === 'pressureSummer' || layer === 'pressureWinter' ||
                       layer === 'windSpeedSummer' || layer === 'windSpeedWinter';
        const isOcean = layer === 'oceanCurrentSummer' || layer === 'oceanCurrentWinter';
        if (isWind) buildWindArrows(layer.includes('Winter') ? 'winter' : 'summer');
        if (isOcean) buildOceanCurrentArrows(layer.includes('Winter') ? 'winter' : 'summer');
    }
});

// View mode dropdown (Globe / Map)
document.getElementById('viewMode').addEventListener('change', (e) => {
    state.mapMode = e.target.value === 'map';
    if (state.mapMode) {
        if (state.planetMesh) state.planetMesh.visible = false;
        waterMesh.visible = false;
        atmosMesh.visible = false;
        starsMesh.visible = false;
        if (state.wireMesh) state.wireMesh.visible = false;
        if (state.arrowGroup) state.arrowGroup.visible = false;
        if (!state.mapMesh) {
            showBuildOverlay();
            onProgress(0, 'Building map mesh\u2026');
            // Yield to let the overlay paint, then build the mesh
            setTimeout(() => {
                buildMapMesh();
                if (state.mapMesh) state.mapMesh.visible = true;
                hideBuildOverlay();
            }, 50);
        }
        if (state.mapMesh) state.mapMesh.visible = true;
        if (state.mapGridMesh) state.mapGridMesh.visible = state.gridEnabled;
        if (state.globeGridMesh) state.globeGridMesh.visible = false;
        // Toggle wind arrow sub-groups for map mode
        if (state.windArrowGroup) {
            state.windArrowGroup.traverse(c => {
                if (c.name === 'windGlobe') c.visible = false;
                if (c.name === 'windMap') c.visible = true;
            });
        }
        if (state.oceanCurrentArrowGroup) {
            state.oceanCurrentArrowGroup.traverse(c => {
                if (c.name === 'oceanGlobe') c.visible = false;
                if (c.name === 'oceanMap') c.visible = true;
            });
        }
        scene.background = new THREE.Color(0x1a1a2e);
        ctrl.enabled = false;
        mapCtrl.enabled = true;
        mapCamera.position.set(0, 0, 5);
        mapCamera.lookAt(0, 0, 0);
        updateMapCameraFrustum();
        mapCtrl.target.set(0, 0, 0);
        mapCtrl.update();
        mapCenterLonGroup.style.display = '';
    } else {
        if (state.planetMesh) state.planetMesh.visible = true;
        updateAtmosphereColor(state.planetaryParams?.atmosphereRimColor);
        starsMesh.visible = true;
        if (state.wireMesh) state.wireMesh.visible = true;
        if (state.arrowGroup) state.arrowGroup.visible = true;
        if (state.mapMesh) state.mapMesh.visible = false;
        if (state.mapGridMesh) state.mapGridMesh.visible = false;
        if (state.globeGridMesh) state.globeGridMesh.visible = state.gridEnabled;
        // Toggle wind arrow sub-groups for globe mode
        if (state.windArrowGroup) {
            state.windArrowGroup.traverse(c => {
                if (c.name === 'windGlobe') c.visible = true;
                if (c.name === 'windMap') c.visible = false;
            });
        }
        if (state.oceanCurrentArrowGroup) {
            state.oceanCurrentArrowGroup.traverse(c => {
                if (c.name === 'oceanGlobe') c.visible = true;
                if (c.name === 'oceanMap') c.visible = false;
            });
        }
        const showPlates = document.getElementById('chkPlates').checked;
        const hasFluid = state.planetaryParams?.surfaceFluidColor !== null;
        waterMesh.visible = hasFluid && !showPlates && !state.debugLayer;
        scene.background = new THREE.Color(0x030308);
        mapCtrl.enabled = false;
        ctrl.enabled = true;
        mapCenterLonGroup.style.display = 'none';
    }
});

// Debug layer dropdown
if (debugLayerEl) {
    debugLayerEl.addEventListener('change', (e) => {
        const layer = e.target.value;
        syncTabsToLayer(layer);
        switchVisualization(layer);
    });
}

// Export modal
(function initExport() {
    const overlay   = document.getElementById('exportOverlay');
    const closeBtn  = document.getElementById('exportClose');
    const cancelBtn = document.getElementById('exportCancel');
    const goBtn     = document.getElementById('exportGo');
    const widthEl   = document.getElementById('exportWidth');
    const dimsEl    = document.getElementById('exportDims');
    const typeEl    = document.getElementById('exportType');
    const openBtn   = document.getElementById('exportBtn');

    function updateDims() {
        const w = +widthEl.value;
        dimsEl.textContent = w + ' \u00D7 ' + (w / 2);
    }

    function openModal() {
        overlay.classList.remove('hidden');
        updateDims();
        // Disable climate-dependent export types when climate isn't computed
        for (const opt of typeEl.options) {
            if (opt.value === 'biome' || opt.value === 'koppen') {
                opt.disabled = !state.climateComputed;
                if (opt.disabled && typeEl.value === opt.value) typeEl.value = 'color';
            }
        }
    }
    function closeModal() { overlay.classList.add('hidden'); }

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal();
    });
    widthEl.addEventListener('change', updateDims);

    goBtn.addEventListener('click', async () => {
        const type = typeEl.value;
        const w = +widthEl.value;
        closeModal();
        showBuildOverlay();
        onProgress(0, 'Preparing export...');
        await exportMap(type, w, onProgress);
        hideBuildOverlay();
    });

    // Export All — downloads Satellite, Climate, Heightmap, and Land Mask
    const exportAllBtn = document.getElementById('exportAllGo');
    const EXPORT_ALL_TYPES = [
        { type: 'biome',          label: 'Satellite' },
        { type: 'koppen',         label: 'Climate' },
        { type: 'landheightmap',  label: 'Heightmap' },
        { type: 'landmask',       label: 'Land Mask' },
    ];

    exportAllBtn.addEventListener('click', async () => {
        const w = +widthEl.value;
        closeModal();
        showBuildOverlay();

        // Compute climate first if needed (Satellite & Climate require it)
        if (!state.climateComputed) {
            onProgress(0, 'Computing climate...');
            await new Promise(resolve => computeClimateViaWorker(onProgress, resolve));
        }

        await exportMapBatch(EXPORT_ALL_TYPES, w, onProgress);
        hideBuildOverlay();
    });
})();

// Edit mode setup (pointer events, sub-mode buttons)
setupEditMode();

// Sidebar toggle (desktop) + bottom sheet (mobile)
const sidebarToggle = document.getElementById('sidebarToggle');
const uiPanel = document.getElementById('ui');
const isMobileLayout = () => window.innerWidth <= 768;

if (isMobileLayout()) {
    uiPanel.classList.add('collapsed');
}

// Desktop sidebar toggle
sidebarToggle.addEventListener('click', () => {
    const collapsed = uiPanel.classList.toggle('collapsed');
    sidebarToggle.innerHTML = collapsed ? '\u00BB' : '\u00AB';
    sidebarToggle.title = collapsed ? 'Show panel' : 'Collapse panel';
});

// Bottom-sheet drag behavior (Pointer Events + setPointerCapture)
(function initBottomSheet() {
    const handle = document.getElementById('sheetHandle');
    if (!handle) return;

    let startY = 0, startTransform = 0, dragging = false;
    let lastY = 0, lastTime = 0, velocity = 0;
    let didDrag = false;
    let rafId = 0, pendingY = null;

    function getTranslateY() {
        const st = getComputedStyle(uiPanel);
        const m = new DOMMatrix(st.transform);
        return m.m42;
    }

    function getCollapsedY() {
        return uiPanel.offsetHeight - 60;
    }

    function applyTransform() {
        if (pendingY !== null) {
            uiPanel.style.transform = `translateY(${pendingY}px)`;
            pendingY = null;
        }
        rafId = 0;
    }

    function scheduleTransform(y) {
        pendingY = y;
        if (!rafId) rafId = requestAnimationFrame(applyTransform);
    }

    function cleanup() {
        dragging = false;
        uiPanel.style.transition = '';
        uiPanel.classList.remove('dragging');
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        pendingY = null;
    }

    handle.addEventListener('pointerdown', (e) => {
        if (!isMobileLayout()) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        dragging = true;
        didDrag = false;
        startY = e.clientY;
        lastY = e.clientY;
        lastTime = performance.now();
        velocity = 0;
        startTransform = uiPanel.classList.contains('collapsed') ? getTranslateY() : 0;
        uiPanel.style.transition = 'none';
        uiPanel.classList.add('dragging');
    });

    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const y = e.clientY;
        const now = performance.now();
        const dt = now - lastTime;
        if (dt > 0) velocity = (y - lastY) / dt; // px/ms, positive = downward
        lastY = y;
        lastTime = now;
        const dy = y - startY;
        if (Math.abs(dy) > 5) didDrag = true;
        const collapsedY = getCollapsedY();
        const newY = Math.max(0, Math.min(collapsedY, startTransform + dy));
        scheduleTransform(newY);
    });

    handle.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        handle.releasePointerCapture(e.pointerId);
        cleanup();
        const curY = getTranslateY();
        const collapsedY = getCollapsedY();
        const progress = collapsedY > 0 ? 1 - curY / collapsedY : 0;
        const shouldCollapse = velocity > 0.3 || (velocity > -0.3 && progress < 0.3);
        if (shouldCollapse) {
            uiPanel.classList.add('collapsed');
        } else {
            uiPanel.classList.remove('collapsed');
        }
        uiPanel.style.transform = '';
    });

    handle.addEventListener('pointercancel', (e) => {
        if (!dragging) return;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        cleanup();
        uiPanel.style.transform = '';
    });

    // Tap on handle toggles collapsed state (suppressed if a drag just happened)
    handle.addEventListener('click', () => {
        if (!isMobileLayout()) return;
        if (didDrag) { didDrag = false; return; }
        uiPanel.classList.toggle('collapsed');
    });
})();

// Edit-mode toggle wiring
(function initEditToggle() {
    const editBtn = document.getElementById('editToggle');
    if (!editBtn) return;
    editBtn.addEventListener('click', () => {
        state.editMode = !state.editMode;
        editBtn.classList.toggle('active', state.editMode);
    });
})();

// Mobile refresh FAB — two-tap to regenerate (blue → green → generate)
(function initRefreshFab() {
    const btn = document.getElementById('refreshFab');
    if (!btn) return;
    let armed = false;
    let timer = 0;

    function disarm() {
        armed = false;
        btn.classList.remove('armed');
        clearTimeout(timer);
    }

    btn.addEventListener('click', () => {
        if (!armed) {
            armed = true;
            btn.classList.add('armed');
            timer = setTimeout(disarm, 3000);
        } else {
            disarm();
            // Collapse sheet so user sees the planet build
            if (isMobileLayout()) uiPanel.classList.add('collapsed');
            clearReapplyPending();
            showBuildOverlay();
            generate(undefined, [], onProgress, shouldSkipClimate());
        }
    });
})();

// Mobile info text
if (state.isTouchDevice) {
    const infoEl = document.getElementById('info');
    if (infoEl) infoEl.textContent = 'Drag to rotate \u00b7 Pinch to zoom \u00b7 Use edit button to reshape';
}

// Disable export widths > 8192 on touch devices
if (state.isTouchDevice) {
    const exportWidth = document.getElementById('exportWidth');
    if (exportWidth) {
        for (const opt of exportWidth.options) {
            if (+opt.value > 8192) {
                opt.disabled = true;
                opt.textContent = opt.value + ' (too large for mobile)';
            }
        }
    }
}

// Orientation change handler
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        updateMapCameraFrustum();
        renderer.setSize(innerWidth, innerHeight);
    }, 100);
});

// ── Panel switching (nav row) ─────────────────────────────────────────────
function switchPanel(kind) {
    const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('panel' + cap)?.classList.add('active');
    document.getElementById('navBtn'  + cap)?.classList.add('active');
}

// ── Bottom-right layers popup ─────────────────────────────────────────────
(function initLayersPopup() {
    const vizWidget = document.getElementById('vizWidget');
    const layersBtn = document.getElementById('layersBtn');
    if (!layersBtn || !vizWidget) return;
    layersBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        vizWidget.classList.toggle('popup-open');
    });
    document.addEventListener('click', (e) => {
        if (!vizWidget.contains(e.target)) vizWidget.classList.remove('popup-open');
    });
})();

// ── On touch/mobile: move #vizWidget inside #panelVisual so it scrolls in the sheet ──
(function initMobileVizWidget() {
    if (!state.isTouchDevice && window.innerWidth > 768) return;
    const panelVisual = document.getElementById('panelVisual');
    const vizWidget   = document.getElementById('vizWidget');
    if (panelVisual && vizWidget) panelVisual.appendChild(vizWidget);
})();

// Animation loop
// ═══════════════════════════════════════════════════════════════════════════
// SOLAR SYSTEM MODE
// ═══════════════════════════════════════════════════════════════════════════

(function initSolarSystem() {
    const systemBtn     = document.getElementById('systemBtn');
    const systemPanel   = document.getElementById('systemPanel');
    const solarSysBtn   = document.getElementById('solarSystemBtn');
    const genSysBtn     = document.getElementById('generateSystemBtn');
    const bodyListEl    = document.getElementById('bodyList');
    const systemNameEl  = document.getElementById('systemNameDisplay');
    const backToSysEl   = document.getElementById('backToSystem');
    const backToGlobeBtn = document.getElementById('backToGlobeBtn');
    const systemBarEl   = document.getElementById('systemBar');
    const gameDateEl    = document.getElementById('gameDate');
    const pauseBtn      = document.getElementById('btnPause');
    const speedBtns     = document.querySelectorAll('.speed-btn');
    const bodyInfoCard  = document.getElementById('bodyInfoCard');
    const bodyInfoName  = document.getElementById('bodyInfoName');
    const bodyInfoType  = document.getElementById('bodyInfoType');
    const bodyInfoOrbit = document.getElementById('bodyInfoOrbit');
    const bodyInfoStatus = document.getElementById('bodyInfoStatus');

    // ── Module-level solar system state ──────────────────────────────────────
    let _bgBodyId      = null;  // bodyId currently being quietly background-generated
    let _pendingBodyId = null;  // bodyId the user clicked — fg generation in progress
    let _systemSeed    = Math.floor(Math.random() * 0xFFFFFF);

    // ── Helper: apply body params to the five physics sliders ────────────────
    function applyBodyParams(params) {
        const sv = bodyParamsToSliderValues(params);
        if (!sv) return;
        const map = {
            sGravity: sv.gravity, sAtm: sv.atmosphere, sHydro: sv.hydrosphere,
            sBaseTemp: sv.baseTemp, sTilt: sv.axialTilt,
        };
        for (const [id, val] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.value = val;
            el.dispatchEvent(new Event('input'));
        }
        const wp = document.getElementById('worldPreset');
        if (wp) { wp.value = 'custom'; state.currentPreset = 'custom'; }
    }

    // ── Body list rendering ───────────────────────────────────────────────────
    const TYPE_COLORS = {
        star:   '#ffdd88', rocky: '#cc8855', icy: '#88ccee',
        gas:    '#c8a87a', belt:  '#887766',
    };
    const TYPE_LABELS = {
        star: 'Star', rocky: 'Rocky Planet', icy: 'Ice World',
        gas: 'Gas Giant', belt: 'Asteroid Belt',
    };

    function renderBodyList() {
        if (!bodyListEl || !state.currentSystem) return;
        bodyListEl.innerHTML = '';
        for (const body of state.currentSystem.bodies) {
            if (body.parentId) continue; // hide moons in sidebar for now
            const canEnter = body.params !== null;
            const item = document.createElement('div');
            item.className = 'body-list-item' + (canEnter ? '' : ' no-globe');
            if (body.id === state.activeBodyId) item.classList.add('active');

            const dot = document.createElement('span');
            dot.className = 'body-dot';
            dot.style.background = TYPE_COLORS[body.type] ?? '#888';

            const name = document.createElement('span');
            name.className = 'body-item-name';
            name.textContent = body.name;

            const type = document.createElement('span');
            type.className = 'body-item-type';
            type.textContent = TYPE_LABELS[body.type] ?? body.type;

            const status = document.createElement('span');
            status.className = 'body-status';
            if (body.id === state.activeBodyId) {
                status.textContent = 'viewing'; status.classList.add('active');
            } else if (state.generatedBodies.has(body.id)) {
                status.textContent = '✓ ready'; status.classList.add('ready');
            } else if (state.currentSystemId && isBodyGenerated(state.currentSystemId, body.id)) {
                // Previously generated in a past session but not yet in the in-session cache
                status.textContent = '✓'; status.classList.add('ready');
            } else if (canEnter) {
                status.textContent = '…';
            }

            item.append(dot, name, type, status);
            if (canEnter) {
                item.addEventListener('click', () => enterBody(body.id));
            }
            bodyListEl.appendChild(item);
        }
    }

    // ── Saved Systems list ────────────────────────────────────────────────────
    function renderSavedSystemsList() {
        const listEl = document.getElementById('savedSystemsList');
        if (!listEl) return;
        const registry = loadRegistry();
        listEl.innerHTML = '';

        if (registry.systems.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'saved-system-empty';
            empty.textContent = 'No saved systems yet.';
            listEl.appendChild(empty);
            return;
        }

        for (const sys of registry.systems) {
            const isActive = sys.id === state.currentSystemId;
            const hasOverrides = Object.keys(sys.bodyOverrides ?? {}).length > 0;
            const genCount = (sys.generatedBodyIds ?? []).length;

            const li = document.createElement('li');
            li.className = 'saved-system-row' + (isActive ? ' active' : '');

            // Left: name + badges
            const left = document.createElement('div');
            left.className = 'saved-system-left';

            const badge = document.createElement('span');
            badge.className = `saved-system-badge saved-system-badge-${sys.type}`;
            badge.textContent = sys.type === 'sol' ? 'Sol' : 'Random';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'saved-system-name';
            nameSpan.setAttribute('contenteditable', 'true');
            nameSpan.setAttribute('spellcheck', 'false');
            nameSpan.textContent = sys.name;
            if (hasOverrides) {
                const mod = document.createElement('span');
                mod.className = 'saved-system-modified';
                mod.textContent = ' (modified)';
                nameSpan.appendChild(mod);
            }
            nameSpan.addEventListener('blur', () => {
                const raw = nameSpan.childNodes[0]?.nodeValue?.trim() ?? '';
                if (raw && raw !== sys.name) {
                    renameSystem(sys.id, raw);
                    renderSavedSystemsList();
                }
            });
            nameSpan.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); nameSpan.blur(); }
            });

            const meta = document.createElement('span');
            meta.className = 'saved-system-meta';
            meta.textContent = `${genCount} explored · ${_relativeDate(sys.savedAt)}`;

            left.append(badge, nameSpan, meta);

            // Right: action buttons
            const right = document.createElement('div');
            right.className = 'saved-system-actions';

            if (!isActive) {
                const loadBtn = document.createElement('button');
                loadBtn.className = 'saved-system-btn';
                loadBtn.textContent = 'Load';
                loadBtn.addEventListener('click', () => {
                    if (sys.type === 'sol') {
                        enterSystemMode(OUR_SOLAR_SYSTEM);
                    } else if (sys.seed) {
                        enterSystemMode(generateSystem(sys.seed));
                    }
                });
                right.appendChild(loadBtn);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'saved-system-btn saved-system-btn-danger';
            delBtn.textContent = '✕';
            delBtn.title = 'Delete saved system';
            delBtn.addEventListener('click', () => {
                if (!confirm(`Delete "${sys.name}" from saved systems?`)) return;
                deleteSystem(sys.id);
                // If we deleted the active system's record, clear the currentSystemId
                // so it doesn't reappear on next page load
                if (sys.id === state.currentSystemId) {
                    setActiveSystemId(null);
                }
                renderSavedSystemsList();
            });
            right.appendChild(delBtn);

            li.append(left, right);
            listEl.appendChild(li);
        }
    }

    function _relativeDate(ts) {
        if (!ts) return '';
        const diffMs  = Date.now() - ts;
        const diffDays = Math.floor(diffMs / 86400000);
        if (diffDays === 0) return 'today';
        if (diffDays === 1) return 'yesterday';
        if (diffDays < 30) return `${diffDays}d ago`;
        return new Date(ts).toLocaleDateString();
    }

    // ── Enter a solar system body (set sliders + generate or restore) ─────────
    function enterBody(bodyId) {
        const sys  = state.currentSystem;
        const body = sys?.bodies.find(b => b.id === bodyId);
        if (!body || !body.params) return;

        state.activeBodyId = _pendingBodyId = bodyId;

        // Exit orrery view → planet view; show full planet controls in sidebar
        exitOrrery();
        switchToPlanetView();
        state.solarSystemMode = false;

        // Switch sidebar to World panel
        switchPanel('world');
        systemPanel?.classList.add('hidden');
        const banner = document.getElementById('bodyViewBanner');
        const bannerName = document.getElementById('bodyBannerName');
        if (banner) banner.classList.remove('hidden');
        if (bannerName) bannerName.textContent = body.name;

        backToSysEl?.classList.add('hidden'); // banner back button covers it
        backToGlobeBtn?.classList.add('hidden');

        // Restore from cache if available
        if (state.generatedBodies.has(bodyId)) {
            const cached = state.generatedBodies.get(bodyId);
            state.curData = cached.curData;
            applyBodyParams(body.params);
            // Layer any stored override on top of base params
            const override = getBodyOverride(state.currentSystemId, bodyId);
            if (override) applyBodyParams(override);
            // Re-apply planetary params module state
            state.planetaryParams = buildPlanetaryParams({
                gravity: +(document.getElementById('sGravity')?.value ?? 1.0),
                atmosphere: +(document.getElementById('sAtm')?.value ?? 3),
                hydrosphere: +(document.getElementById('sHydro')?.value ?? 3),
                baseTemp: +(document.getElementById('sBaseTemp')?.value ?? 15),
                axialTilt: +(document.getElementById('sTilt')?.value ?? 23),
                preset: 'custom',
            });
            updateAtmosphereColor(state.planetaryParams.atmosphereRimColor);
            updateWaterColor(state.planetaryParams.surfaceFluidColor);
            updateHazeLayer(state.planetaryParams.hazeOpacity, state.planetaryParams.atmosphereTint);
            setUpliftMult(state.planetaryParams.upliftMultiplier);
            setHasLiquidOcean(state.planetaryParams.hasLiquidOcean);
            setBaseTemp(state.planetaryParams.baseTemp);
            setAtmosphere(state.planetaryParams.atmosphere);
            setHydrosphere(state.planetaryParams.hydrosphere);
            // Import buildMesh and rebuild visual from cached data
            import('./planet-mesh.js').then(({ buildMesh, updateMeshColors }) => {
                buildMesh();
                updateMeshColors();
            });
            _pendingBodyId = null;
            renderBodyList();
            return;
        }

        // Not cached → run full generation
        applyBodyParams(body.params);
        // Layer any stored override on top of base params
        const override = getBodyOverride(state.currentSystemId, bodyId);
        if (override) applyBodyParams(override);
        showBuildOverlay();
        generate(
            /* seed */ _systemSeed ^ (bodyId.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)),
            /* toggles */ [],
            onProgress,
            shouldSkipClimate(),
        );
        renderBodyList();
    }

    // ── Return to orrery from planet view ────────────────────────────────────
    function backToSystem() {
        state.solarSystemMode = true;
        state.activeBodyId    = null;
        _pendingBodyId        = null;

        // Clear stale plate-hover state so the info card doesn't linger
        state.hoveredPlate  = -1;
        state.hoveredRegion = -1;
        const hoverEl = document.getElementById('hoverInfo');
        if (hoverEl) hoverEl.style.display = 'none';

        // Restore system panel in sidebar, hide body-view banner
        switchPanel('system');
        document.getElementById('bodyViewBanner')?.classList.add('hidden');

        backToSysEl?.classList.add('hidden');
        backToGlobeBtn?.classList.add('hidden');

        // Hide planet visuals
        if (state.planetMesh) state.planetMesh.visible = false;
        waterMesh.visible = false;
        atmosMesh.visible = false;
        starsMesh.visible = false;
        if (state.wireMesh) state.wireMesh.visible = false;
        updateHazeLayer(0, null);

        switchToOrrery();
        enterOrrery();
        renderBodyList();
        updateSysBarPauseBtn();
    }

    // ── Enter system mode (from planet-only mode) ─────────────────────────────
    function enterSystemMode(system) {
        // Compute a stable string ID for this system so its cache persists across
        // system-switching within the same session.
        // Use identity comparison to distinguish OUR_SOLAR_SYSTEM from any
        // random system that might coincidentally share the same seed value.
        const isSol    = Object.is(system, OUR_SOLAR_SYSTEM);
        const systemId = isSol ? 'sol' : `random-${system.seed}`;
        const systemType = isSol ? 'sol' : 'random';

        state.currentSystem   = system;
        state.currentSystemId = systemId;
        state.solarSystemMode = true;
        state.activeBodyId    = null;

        // ── Per-system cache: reuse existing map if we visited this system before ──
        state.systemCaches ??= {}; // guard for any stale module instances
        if (!state.systemCaches[systemId]) {
            state.systemCaches[systemId] = new Map();
        }
        state.generatedBodies = state.systemCaches[systemId];

        state.bodyQueue       = [];
        _bgBodyId             = null;
        _systemSeed           = system.seed || Math.floor(Math.random() * 0xFFFFFF);
        resetClock();

        // ── Persist to localStorage ───────────────────────────────────────────
        const existing = loadRegistry().systems.find(s => s.id === systemId);
        upsertSystem({
            id:               systemId,
            name:             system.name,
            type:             systemType,
            seed:             isSol ? null : (system.seed || null),
            savedAt:          Date.now(),
            // Preserve existing user data; don't overwrite on re-entry
            bodyOverrides:    existing?.bodyOverrides    ?? {},
            generatedBodyIds: existing?.generatedBodyIds ?? [],
        });
        setActiveSystemId(systemId);
        renderSavedSystemsList();

        // Show system panel in sidebar, hide the normal planet controls
        switchPanel('system');

        // Update system name
        if (systemNameEl) systemNameEl.textContent = system.name;

        // Switch scene
        if (state.planetMesh) state.planetMesh.visible = false;
        waterMesh.visible = false;
        atmosMesh.visible = false;
        starsMesh.visible = false;
        if (state.wireMesh) state.wireMesh.visible = false;
        updateHazeLayer(0, null);

        switchToOrrery();
        initOrrery(system);
        enterOrrery();

        backToSysEl?.classList.add('hidden');
        backToGlobeBtn?.classList.add('hidden');

        renderBodyList();
        updateSysBarPauseBtn();

        // Queue all generable bodies for background generation
        for (const body of system.bodies) {
            if (body.params && !body.parentId) {
                state.bodyQueue.push(body.id);
            }
        }
        advanceBodyQueue();
    }

    // ── Exit system mode entirely (return to standalone planet mode) ──────────
    function exitSystemMode() {
        state.solarSystemMode  = false;
        state.activeBodyId     = null;
        _bgBodyId              = null;
        state.isBgGenerating   = false;
        state.bodyQueue        = [];

        switchPanel('world');
        document.getElementById('bodyViewBanner')?.classList.add('hidden');
        document.querySelectorAll('.system-hidden')
            .forEach(el => el.classList.remove('system-hidden'));

        systemBarEl?.classList.add('hidden');
        backToSysEl?.classList.add('hidden');
        backToGlobeBtn?.classList.add('hidden');
        exitOrrery();
        switchToPlanetView();

        // Restore normal planet visuals
        if (state.planetMesh) state.planetMesh.visible = true;
        if (state.planetaryParams) {
            updateAtmosphereColor(state.planetaryParams.atmosphereRimColor);
            updateWaterColor(state.planetaryParams.surfaceFluidColor);
        }
        starsMesh.visible = true;
        if (state.wireMesh) state.wireMesh.visible = true;
    }

    // ── Background queue: generate bodies silently ────────────────────────────
    function advanceBodyQueue() {
        if (state.bodyQueue.length === 0 || _bgBodyId) return;
        // Don't background-generate while user is actively generating a planet
        const genBtnEl = document.getElementById('generate');
        if (genBtnEl?.classList.contains('generating')) return;

        const bodyId = state.bodyQueue.shift();
        if (state.generatedBodies.has(bodyId)) {
            advanceBodyQueue(); // already cached, skip
            return;
        }

        const sys  = state.currentSystem;
        const body = sys?.bodies.find(b => b.id === bodyId);
        if (!body?.params) { advanceBodyQueue(); return; }

        _bgBodyId = bodyId;
        state.isBgGenerating = true;
        applyBodyParams(body.params);
        const seed = _systemSeed ^ (bodyId.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0));
        // Suppress overlay for background generation
        generate(seed, [], () => {}, shouldSkipClimate());
    }

    // ── generate-done: handle system mode caching and queue advancement ───────
    document.getElementById('generate').addEventListener('generate-done', () => {
        if (!state.currentSystem) return;

        const isBackground = !!_bgBodyId && _bgBodyId !== _pendingBodyId;

        if (isBackground) {
            // Cache the raw generation data
            state.generatedBodies.set(_bgBodyId, { curData: state.curData });
            markBodyGenerated(state.currentSystemId, _bgBodyId);
            _bgBodyId = null;
            state.isBgGenerating = false;

            // buildMesh() was skipped (isBgGenerating flag), so no mesh suppression needed.
            renderBodyList();
            renderSavedSystemsList();
            // Keep background queue moving
            setTimeout(advanceBodyQueue, 200);
            return;
        }

        if (_pendingBodyId) {
            // User clicked into this body — cache it
            state.generatedBodies.set(_pendingBodyId, { curData: state.curData });

            // ── Persist any physics slider changes made before generation ──────
            const sys    = state.currentSystem;
            const bodyId = _pendingBodyId;
            const body   = sys?.bodies.find(b => b.id === bodyId);
            if (body?.params && state.currentSystemId) {
                const currentParams = {
                    gravity:     +(document.getElementById('sGravity')?.value  ?? body.params.gravity),
                    atmosphere:  +(document.getElementById('sAtm')?.value      ?? body.params.atmosphere),
                    hydrosphere: +(document.getElementById('sHydro')?.value    ?? body.params.hydrosphere),
                    baseTemp:    +(document.getElementById('sBaseTemp')?.value  ?? body.params.baseTemp),
                    axialTilt:   +(document.getElementById('sTilt')?.value      ?? body.params.axialTilt),
                };
                // Compare against base body params (post bodyParamsToSliderValues conversion)
                const sv = bodyParamsToSliderValues(body.params) ?? body.params;
                const changed = (
                    currentParams.gravity     !== +sv.gravity     ||
                    currentParams.atmosphere  !== +sv.atmosphere  ||
                    currentParams.hydrosphere !== +sv.hydrosphere ||
                    currentParams.baseTemp    !== +sv.baseTemp    ||
                    currentParams.axialTilt   !== +sv.axialTilt
                );
                if (changed) {
                    saveBodyOverride(state.currentSystemId, bodyId, currentParams);
                } else {
                    clearBodyOverride(state.currentSystemId, bodyId);
                }
                markBodyGenerated(state.currentSystemId, bodyId);
            }

            _pendingBodyId = null;
            renderBodyList();
            renderSavedSystemsList();
        }
    });

    // ── Clock bar UI ──────────────────────────────────────────────────────────
    function updateSysBarPauseBtn() {
        if (!pauseBtn) return;
        pauseBtn.classList.toggle('paused-state', isPaused());
    }

    function updateSpeedBtns() {
        const idx = getSpeedIndex();
        speedBtns.forEach(btn => {
            btn.classList.toggle('active', +btn.dataset.speed === idx);
        });
    }

    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            togglePause();
            updateSysBarPauseBtn();
        });
    }

    speedBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            setSpeedIndex(+btn.dataset.speed);
            if (isPaused()) {
                // Resume on speed click if paused
                togglePause();
                updateSysBarPauseBtn();
            }
            updateSpeedBtns();
        });
    });
    updateSpeedBtns();

    // ── Button wiring ─────────────────────────────────────────────────────────
    // ── Nav button wiring ─────────────────────────────────────────────────────
    const navBtnSystem = document.getElementById('navBtnSystem');
    const navBtnWorld  = document.getElementById('navBtnWorld');
    const navBtnVisual = document.getElementById('navBtnVisual');

    navBtnSystem?.addEventListener('click', () => {
        if (state.activeBodyId) {
            backToSystem(); // returns to orrery, calls switchPanel('system')
        } else if (!state.solarSystemMode) {
            enterSystemMode(state.currentSystem ?? OUR_SOLAR_SYSTEM); // calls switchPanel('system')
        } else {
            switchPanel('system'); // already in orrery, ensure correct panel
        }
    });
    navBtnWorld?.addEventListener('click', () => {
        if (state.solarSystemMode) {
            exitSystemMode(); // calls switchPanel('world')
        } else {
            switchPanel('world');
        }
    });
    navBtnVisual?.addEventListener('click', () => switchPanel('visual'));

    if (solarSysBtn) {
        solarSysBtn.addEventListener('click', () => {
            state.currentSystem = null;
            enterSystemMode(OUR_SOLAR_SYSTEM);
        });
    }

    if (genSysBtn) {
        genSysBtn.addEventListener('click', () => {
            const seed = Math.floor(Math.random() * 0xFFFFFF);
            state.currentSystem = generateSystem(seed);
            enterSystemMode(state.currentSystem);
        });
    }

    backToSysEl?.addEventListener('click', backToSystem);
    backToGlobeBtn?.addEventListener('click', backToSystem);
    document.getElementById('bodyBannerBackBtn')?.addEventListener('click', backToSystem);

    // ── Reset body physics to defaults ────────────────────────────────────────
    document.getElementById('bodyResetParamsBtn')?.addEventListener('click', () => {
        const bodyId = state.activeBodyId;
        if (!bodyId || !state.currentSystemId) return;
        const body = state.currentSystem?.bodies.find(b => b.id === bodyId);
        if (!body?.params) return;
        // Clear the stored override
        clearBodyOverride(state.currentSystemId, bodyId);
        // Remove from in-session cache so the next enterBody() regenerates cleanly
        state.generatedBodies.delete(bodyId);
        // Re-enter the body with fresh default params
        enterBody(bodyId);
        renderSavedSystemsList();
    });

    // ── Orrery hover info card ────────────────────────────────────────────────
    canvas.addEventListener('mousemove', (e) => {
        if (!state.solarSystemMode || state.activeBodyId) return;
        const bodyId = getBodyAtMouse(e);
        if (bodyId && state.currentSystem) {
            const body = state.currentSystem.bodies.find(b => b.id === bodyId);
            if (body) {
                bodyInfoCard?.classList.remove('hidden');
                if (bodyInfoName)   bodyInfoName.textContent  = body.name;
                if (bodyInfoType)   bodyInfoType.textContent  = TYPE_LABELS[body.type] ?? body.type;
                if (bodyInfoOrbit) {
                    bodyInfoOrbit.textContent = body.orbitRadiusAU > 0
                        ? `Orbit: ${body.orbitRadiusAU.toFixed(3)} AU · Period: ${body.orbitalPeriodDays.toFixed(1)} days`
                        : '';
                }
                if (bodyInfoStatus) {
                    if (!body.params) bodyInfoStatus.textContent = 'No globe available';
                    else if (state.generatedBodies.has(bodyId)) bodyInfoStatus.textContent = '✓ Generated · Click to explore';
                    else bodyInfoStatus.textContent = 'Click to generate & explore';
                }
            }
        } else {
            bodyInfoCard?.classList.add('hidden');
        }
    });

    canvas.addEventListener('mouseleave', () => bodyInfoCard?.classList.add('hidden'));

    // ── Orrery click → enter body ─────────────────────────────────────────────
    canvas.addEventListener('click', (e) => {
        if (!state.solarSystemMode) return;
        const bodyId = getBodyAtMouse(e);
        if (bodyId) {
            const body = state.currentSystem?.bodies.find(b => b.id === bodyId);
            if (body?.params) enterBody(bodyId);
        }
    });

    // Expose for use in animate()
    window._solarSystemTickFrame = function(realDtSec) {
        if (!state.solarSystemMode) return;
        const gameDt = tickClock(realDtSec);
        tickOrrery(gameDt);
        if (gameDateEl) gameDateEl.textContent = getGameDate();
    };
    // Expose enterSystemMode at module level for the page-load restore code
    window._enterSystemMode = enterSystemMode;
})();

let _lastFrameTime = performance.now();
function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const realDtSec = Math.min((now - _lastFrameTime) / 1000, 0.1); // cap at 100ms
    _lastFrameTime = now;

    if (state.solarSystemMode) {
        // ── Orrery mode ──
        // Suppress all planet-side meshes every frame so intermediate buildMesh()
        // calls during background generation can never leak through.
        if (state.planetMesh) state.planetMesh.visible = false;
        waterMesh.visible = false;
        atmosMesh.visible = false;
        starsMesh.visible = false;
        if (state.wireMesh) state.wireMesh.visible = false;
        updateHazeLayer(0, null);
        if (state.globeGridMesh) state.globeGridMesh.visible = false;
        if (state.mapGridMesh) state.mapGridMesh.visible = false;
        if (state.arrowGroup) state.arrowGroup.visible = false;
        if (state.windArrowGroup) state.windArrowGroup.visible = false;
        if (state.mapMesh) state.mapMesh.visible = false;

        tickOrreryZoom();
        orreryCtrl.update();
        if (window._solarSystemTickFrame) window._solarSystemTickFrame(realDtSec);
        renderer.render(scene, orreryCamera);
    } else if (state.mapMode) {
        tickMapZoom(); mapCtrl.update();
        renderer.render(scene, mapCamera);
    } else {
        tickZoom(); ctrl.update();
        if (state.planetMesh && document.getElementById('chkRotate').checked) {
            state.planetMesh.rotation.y += 0.0008;
            waterMesh.rotation.y = state.planetMesh.rotation.y;
            if (state.wireMesh) state.wireMesh.rotation.y = state.planetMesh.rotation.y;
            if (state.arrowGroup) state.arrowGroup.rotation.y = state.planetMesh.rotation.y;
            if (state.windArrowGroup) state.windArrowGroup.rotation.y = state.planetMesh.rotation.y;
            if (state.oceanCurrentArrowGroup) state.oceanCurrentArrowGroup.rotation.y = state.planetMesh.rotation.y;
            if (state.globeGridMesh) state.globeGridMesh.rotation.y = state.planetMesh.rotation.y;
        }
        renderer.render(scene, camera);
    }
}

// Resize handler
window.addEventListener('resize', () => {
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    updateMapCameraFrustum();
    updateOrreryCameraFrustum();
    renderer.setSize(innerWidth, innerHeight);
});

// Tutorial modal
(function initTutorial() {
    const overlay  = document.getElementById('tutorialOverlay');
    const card     = document.getElementById('tutorialCard');
    const closeBtn = document.getElementById('tutorialClose');
    const backBtn  = document.getElementById('tutorialBack');
    const nextBtn  = document.getElementById('tutorialNext');
    const helpBtn  = document.getElementById('helpBtn');
    const steps    = card.querySelectorAll('.tutorial-step');
    const dots     = card.querySelectorAll('.dot');
    const TOTAL    = steps.length;
    const LS_KEY   = 'atlas-engine-tutorial-seen';
    let current    = 0;

    function showStep(i) {
        current = i;
        steps.forEach((s, idx) => s.classList.toggle('active', idx === i));
        dots.forEach((d, idx) => d.classList.toggle('active', idx === i));
        backBtn.disabled = i === 0;
        nextBtn.textContent = i === TOTAL - 1 ? 'Get Started' : 'Next';
    }

    function openModal() {
        current = 0;
        showStep(0);
        overlay.classList.remove('hidden');
    }

    function closeModal() {
        overlay.classList.add('hidden');
        localStorage.setItem(LS_KEY, '1');
    }

    nextBtn.addEventListener('click', () => {
        if (current < TOTAL - 1) showStep(current + 1);
        else closeModal();
    });

    backBtn.addEventListener('click', () => {
        if (current > 0) showStep(current - 1);
    });

    closeBtn.addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal();
    });

    helpBtn.addEventListener('click', openModal);

    // Update tutorial step 2 for touch devices
    if (state.isTouchDevice) {
        const step2 = card.querySelector('.tutorial-step[data-step="2"]');
        if (step2) {
            const p = step2.querySelector('p');
            if (p) p.innerHTML = '<strong>Drag</strong> to rotate the globe. <strong>Pinch</strong> to zoom in and out. Tap the <strong>edit button</strong> (pencil icon) then <strong>tap</strong> any plate to reshape continents &mdash; ocean rises into land, land floods into ocean.';
        }
    }

    // Auto-show on first visit — wait until the build overlay has faded out
    overlay.classList.add('hidden');
    if (!localStorage.getItem(LS_KEY)) {
        genBtn.addEventListener('generate-done', () => {
            if (buildOverlay) {
                buildOverlay.addEventListener('transitionend', () => openModal(), { once: true });
            } else {
                openModal();
            }
        }, { once: true });
    }
})();

// Power-user survey — triggers after 3+ distinct hours across 2+ distinct days
(function initSurveyTracker() {
    const LS = 'wo-usage';
    const LS_DISMISSED = 'wo-survey-dismissed';

    if (localStorage.getItem(LS_DISMISSED)) return;

    // Simple hash so we don't store raw timestamps
    function hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    let data;
    try { data = JSON.parse(localStorage.getItem(LS)) || {}; } catch (_) { data = {}; }
    const hours = data.h || 0;
    const days  = data.d || 0;
    const lastH = data.lh || '';
    const lastD = data.ld || '';

    const now = new Date();
    const hourKey = hash(now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate() + 'T' + now.getHours());
    const dayKey  = hash(now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate());

    const newHours = hourKey !== lastH ? hours + 1 : hours;
    const newDays  = dayKey  !== lastD ? days  + 1 : days;

    localStorage.setItem(LS, JSON.stringify({ h: newHours, d: newDays, lh: hourKey, ld: dayKey }));

    if (newHours >= 3 && newDays >= 2) {
        const overlay    = document.getElementById('surveyOverlay');
        const closeBtn   = document.getElementById('surveyClose');
        const dismissBtn = document.getElementById('surveyDismiss');
        const linkBtn    = document.getElementById('surveyLink');
        if (!overlay) return;

        function dismiss() {
            overlay.classList.add('hidden');
            localStorage.setItem(LS_DISMISSED, '1');
        }

        // Show after the first generation completes
        genBtn.addEventListener('generate-done', () => {
            setTimeout(() => overlay.classList.remove('hidden'), 1000);
        }, { once: true });

        closeBtn.addEventListener('click', dismiss);
        dismissBtn.addEventListener('click', dismiss);
        linkBtn.addEventListener('click', dismiss);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !overlay.classList.contains('hidden')) dismiss();
        });
    }
})();

// Screenshot helper — call window.takePreview() from the browser console
// Hides UI, renders at 1200×630 from the current camera angle, downloads preview.png
window.takePreview = function(width = 1200, height = 630) {
    // Save current state
    const savedW = renderer.domElement.width;
    const savedH = renderer.domElement.height;
    const savedAspect = camera.aspect;
    const savedPixelRatio = renderer.getPixelRatio();

    // Hide all UI elements
    const hiddenEls = [];
    for (const sel of ['#ui', '#topInfo', '#info', '#hoverInfo', '#helpBtn',
                        '#editToggle', '#refreshFab', '#mobileViewSwitch',
                        '#buildOverlay', '#tutorialOverlay', '#exportOverlay', '#surveyOverlay']) {
        const el = document.querySelector(sel);
        if (el && el.style.display !== 'none') {
            hiddenEls.push({ el, prev: el.style.display });
            el.style.display = 'none';
        }
    }

    // Keep the current camera angle, just adjust aspect ratio for the output size
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // Render at exact target size
    renderer.setPixelRatio(1);
    renderer.setSize(width, height);
    renderer.render(scene, camera);

    // Download
    const link = document.createElement('a');
    link.download = 'preview.png';
    link.href = renderer.domElement.toDataURL('image/png');
    link.click();

    // Restore everything
    renderer.setPixelRatio(savedPixelRatio);
    renderer.setSize(savedW / savedPixelRatio, savedH / savedPixelRatio);
    camera.aspect = savedAspect;
    camera.updateProjectionMatrix();
    for (const { el, prev } of hiddenEls) el.style.display = prev;
    renderer.render(scene, state.mapMode ? mapCamera : camera);
    console.log('preview.png downloaded!');
};

// Go! Check URL hash for a planet code, otherwise check stored system state.
const hashCode = location.hash.replace(/^#/, '').trim();
const hashParams = hashCode ? decodePlanetCode(hashCode) : null;
if (hashParams) {
    // URL hash is a valid standalone planet code — load it, skip system restore
    const map = {
        sN: sliderFromDetail(hashParams.N), sJ: hashParams.jitter,
        sP: hashParams.P, sCn: hashParams.numContinents, sNs: hashParams.roughness,
        sTw: hashParams.terrainWarp, sS: hashParams.smoothing, sGl: hashParams.glacialErosion,
        sHEr: hashParams.hydraulicErosion, sTEr: hashParams.thermalErosion, sRs: hashParams.ridgeSharpening,
        sSc: hashParams.soilCreep ?? 0.75,
        sGravity: hashParams.gravity ?? 1.0, sAtm: hashParams.atmosphere ?? 3,
        sHydro: hashParams.hydrosphere ?? 3, sBaseTemp: hashParams.baseTemp ?? 15,
        sTilt: Math.round(hashParams.axialTilt ?? 23),
    };
    for (const [id, val] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.value = val;
        el.dispatchEvent(new Event('input'));
    }
    generate(hashParams.seed, hashParams.toggledIndices, onProgress, shouldSkipClimate());
} else {
    // ── Auto-restore last active system from localStorage ─────────────────
    // window._enterSystemMode is set by initSolarSystem IIFE (defined above)
    const registry   = loadRegistry();
    const activeId   = registry.activeSystemId;
    const savedEntry = registry.systems.find(s => s.id === activeId);
    if (savedEntry?.type === 'sol') {
        // Defer so animate() has started before we switch to orrery view
        setTimeout(() => window._enterSystemMode(OUR_SOLAR_SYSTEM), 0);
    } else if (savedEntry?.type === 'random' && savedEntry.seed) {
        setTimeout(() => {
            window._enterSystemMode(generateSystem(savedEntry.seed));
        }, 0);
    } else {
        generate(undefined, [], onProgress, shouldSkipClimate());
    }
}
animate();
