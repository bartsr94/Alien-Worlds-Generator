// Entry point — wires UI controls, animation loop, and kicks off initial generation.

import * as THREE from 'three';
import { renderer, scene, camera, ctrl, waterMesh, atmosMesh, starsMesh,
         mapCamera, updateMapCameraFrustum, mapCtrl, canvas,
         tickZoom, tickMapZoom,
         updateAtmosphereColor, updateWaterColor, updateHazeLayer,
         orreryCamera, orreryCtrl, tickOrreryZoom, updateOrreryCameraFrustum } from './render/scene.js';
import { state } from './core/state.js';
import { generate, reapplyViaWorker, computePlanetaryDebugLayers } from './generate.js';
import { encodePlanetCode, decodePlanetCode } from './world/planet-code.js';
import { buildMesh, updateMeshColors, buildMapMesh, rebuildGrids, buildWindArrows, buildOceanCurrentArrows, clearSelectionHighlight } from './render/planet-mesh.js';
import { setupEditMode, hideTilePanel } from './edit-mode.js';
import { detailFromSlider, sliderFromDetail } from './core/detail-scale.js';
import { setUpliftMult, setHasLiquidOcean,
         setBaseTemp, setAtmosphere, setHydrosphere } from './render/color-map.js';
import { buildPlanetaryParams, ATM_LABELS, HYDRO_LABELS } from './world/planetary-params.js';
import { OUR_SOLAR_SYSTEM, generateSystem } from './world/solar-system.js';
import { loadRegistry } from './world/system-storage.js';
import { initSolarSystem } from './solar-ui.js';
import { CLIMATE_LAYERS, switchVisualization, syncTabsToLayer, updateLegend, onProgress, showBuildOverlay, hideBuildOverlay, debugLayerEl } from './viz-controls.js';
import { WORLD_PRESETS, applyPreset, updatePlanetWarnings } from './ui/world-preset.js';
import { initExportModal } from './ui/export-modal.js';
import { initTutorial, initSurveyTracker } from './ui/modals.js';

state.isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

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

    // Recompute planetary inspection layers (habitability, hydroState) now that
    // state.planetaryParams is set correctly — the worker 'done' handler computed
    // them earlier with null params (earth defaults). This ensures alien worlds
    // (ice, hot, dry) show correct habitability scores.
    if (state.climateComputed && state.curData?.debugLayers && state.curData.r_temperature_summer) {
        const planetary = computePlanetaryDebugLayers(state.curData, state.planetaryParams);
        state.curData.debugLayers.hydroState   = planetary.r_hydro_state;
        state.curData.debugLayers.habitability = planetary.r_habitability;
    }

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
initExportModal();

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

// SOLAR SYSTEM MODE
// ═══════════════════════════════════════════════════════════════════════════
initSolarSystem({ onProgress, shouldSkipClimate, switchPanel, showBuildOverlay });

// Animation loop
// ═══════════════════════════════════════════════════════════════════════════
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

// Tutorial modal and power-user survey
initTutorial();
initSurveyTracker();

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
    // window._enterSystemMode is set by initSolarSystem() in solar-ui.js
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
