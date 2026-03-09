// Planet mesh construction: Voronoi geometry, map projection, overlays.

import * as THREE from 'three';
import { renderer, scene, waterMesh, atmosMesh, starsMesh } from './scene.js';
import { state } from '../core/state.js';
import { elevationToColor } from './color-map.js';
import { makeRng } from '../core/rng.js';
import {
    getCachedBiomeSmoothed,
    heightmapColor, landHeightmapColor, landMaskColor,
    debugValueToColor, precipitationColor, rainShadowColor,
    continentalityColor, temperatureColor, koppenColor,
    hydroStateColor, habitabilityColor, flowAccumColor,
    oceanCurrentColor
} from './mesh-colors.js';

// Clipping planes for map wrap â€” keep everything within x âˆˆ [-2, 2]
renderer.localClippingEnabled = true;
const MAP_CLIP_PLANES = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), 2),   // x >= -2
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), 2),   // x <= 2
];

// Arrow overlays -- re-exported from mesh-arrows.js
import { buildDriftArrows } from './mesh-arrows.js';
export { buildDriftArrows, buildWindArrows, buildOceanCurrentArrows } from './mesh-arrows.js';

// Highlight utilities -- re-exported from mesh-highlights.js
import { updateHoverHighlight, updateMapHoverHighlight, updateSelectionHighlight, clearSelectionHighlight } from './mesh-highlights.js';
export { updateHoverHighlight, updateMapHoverHighlight, updateKoppenHoverHighlight, updateMapKoppenHoverHighlight, updateSelectionHighlight, clearSelectionHighlight } from './mesh-highlights.js';

// Plate colours â€” green shades for land, blue for ocean.
export function computePlateColors(plateSeeds, plateIsOcean) {
    state.plateColors = {};
    for (const r of plateSeeds) {
        const rng = makeRng(r);
        if (plateIsOcean.has(r)) {
            const h = 0.55 + rng() * 0.10;
            const s = 0.40 + rng() * 0.30;
            const l = 0.35 + rng() * 0.20;
            state.plateColors[r] = new THREE.Color().setHSL(h, s, l);
        } else {
            const h = 0.25 + rng() * 0.15;
            const s = 0.30 + rng() * 0.30;
            const l = 0.30 + rng() * 0.20;
            state.plateColors[r] = new THREE.Color().setHSL(h, s, l);
        }
    }
}

// ---------------------------------------------------------------------------
// Shared layer-state helpers — used by buildMapMesh, buildMesh, updateMeshColors
// ---------------------------------------------------------------------------

/** Compute all layer-specific flags and data arrays for the current debug layer. */
function resolveLayerState(debugLayer, debugLayers, mesh, r_elevation) {
    const isHeightmap     = debugLayer === 'heightmap';
    const isLandHeightmap = debugLayer === 'landheightmap';
    const isOceanCurrent  = debugLayer === 'oceanCurrentSummer' || debugLayer === 'oceanCurrentWinter';
    const oceanSeason     = debugLayer === 'oceanCurrentWinter' ? 'winter' : 'summer';
    const oceanWarmth     = isOceanCurrent ? state.curData[`r_ocean_warmth_${oceanSeason}`] : null;
    const oceanSpeed      = isOceanCurrent ? state.curData[`r_ocean_speed_${oceanSeason}`]  : null;
    const isPrecip        = debugLayer === 'precipSummer' || debugLayer === 'precipWinter';
    const precipArr       = isPrecip ? (debugLayers && debugLayers[debugLayer]) : null;
    const isRainShadow    = debugLayer === 'rainShadowSummer' || debugLayer === 'rainShadowWinter';
    const rainShadowArr   = isRainShadow ? (debugLayers && debugLayers[debugLayer]) : null;
    const isTemp          = debugLayer === 'tempSummer' || debugLayer === 'tempWinter';
    const tempArr         = isTemp ? (debugLayers && debugLayers[debugLayer]) : null;
    const isKoppen        = debugLayer === 'koppen';
    const isBiome         = debugLayer === 'biome';
    const koppenArr       = (isKoppen || isBiome) ? (debugLayers && debugLayers.koppen) : null;
    const isCont          = debugLayer === 'continentality';
    const contArr         = isCont ? (debugLayers && debugLayers.continentality) : null;
    const isHydroState    = debugLayer === 'hydroState';
    const hydroStateArr   = isHydroState ? (debugLayers && debugLayers.hydroState) : null;
    const isHabitability  = debugLayer === 'habitability';
    const habitabilityArr = isHabitability ? (debugLayers && debugLayers.habitability) : null;
    const isFlowAccum     = debugLayer === 'flowAccum';
    const _rpTemp  = state.planetaryParams?.baseTemp    ?? 15;
    const _rpHydro = state.planetaryParams?.hydrosphere ?? 3;
    const riversPlausible = _rpHydro >= 1 && _rpTemp > -30 && _rpTemp < 130;
    const flowAccumArr = riversPlausible && (isFlowAccum || !debugLayer || debugLayer === 'biome')
        ? ((debugLayers && debugLayers.flowAccum) || null)
        : null;
    // riverPathArr: boolean mask (1 = on a river corridor reaching the ocean).
    // Computed in the simulation alongside flowAccum; used instead of the raw
    // percentile threshold so that flat coastal plains — where per-cell flow
    // is diluted — are still coloured as part of the river.
    const riverPathArr = riversPlausible && (isFlowAccum || !debugLayer || debugLayer === 'biome')
        ? ((debugLayers && debugLayers.riverPath) || null)
        : null;
    let flowAccumMax = 0, riverThreshold = Infinity;
    if (flowAccumArr) {
        const landVals = [];
        for (let r = 0; r < mesh.numRegions; r++) {
            if (r_elevation[r] > 0 && flowAccumArr[r] > 0) landVals.push(flowAccumArr[r]);
        }
        if (landVals.length > 0) {
            landVals.sort((a, b) => a - b);
            flowAccumMax   = landVals[Math.min(landVals.length - 1, Math.floor(landVals.length * 0.995))];
            riverThreshold = landVals[Math.min(landVals.length - 1, Math.floor(landVals.length * 0.992))];
        }
    }
    let dbgArr = null, dbgMin = 0, dbgMax = 0;
    if (!isHeightmap && !isLandHeightmap && !isOceanCurrent && !isPrecip && !isRainShadow &&
            !isTemp && !isKoppen && !isBiome && !isCont && !isHydroState && !isHabitability &&
            !isFlowAccum && debugLayer && debugLayers && debugLayers[debugLayer]) {
        dbgArr = debugLayers[debugLayer];
        for (let r = 0; r < mesh.numRegions; r++) {
            if (dbgArr[r] < dbgMin) dbgMin = dbgArr[r];
            if (dbgArr[r] > dbgMax) dbgMax = dbgArr[r];
        }
    }
    return {
        isHeightmap, isLandHeightmap, isOceanCurrent, oceanWarmth, oceanSpeed,
        isPrecip, precipArr, isRainShadow, rainShadowArr, isTemp, tempArr,
        isKoppen, isBiome, koppenArr, isCont, contArr,
        isHydroState, hydroStateArr, isHabitability, habitabilityArr,
        isFlowAccum, flowAccumArr, flowAccumMax, riverThreshold, riverPathArr,
        dbgArr, dbgMin, dbgMax,
    };
}

/** Build a per-region [r,g,b] colorizer for the current debug layer. */
function makeColorizer(ls, biomeSmoothed, r_elevation, r_plate, r_stress,
                       mountain_r, coastline_r, ocean_r, showPlates, showStress, waterLevel) {
    const { isHeightmap, isLandHeightmap, isOceanCurrent, oceanWarmth, oceanSpeed,
            isPrecip, precipArr, isRainShadow, rainShadowArr, isTemp, tempArr,
            isKoppen, isBiome, koppenArr, isCont, contArr,
            isHydroState, hydroStateArr, isHabitability, habitabilityArr,
            isFlowAccum, flowAccumArr, flowAccumMax,
            dbgArr, dbgMin, dbgMax } = ls;
    return (br) => {
        if (isBiome && biomeSmoothed)          return [biomeSmoothed[br*3], biomeSmoothed[br*3+1], biomeSmoothed[br*3+2]];
        if (isCont && contArr)                 return continentalityColor(contArr[br]);
        if (isKoppen && koppenArr)             return koppenColor(koppenArr[br]);
        if (isTemp && tempArr)                 return temperatureColor(tempArr[br]);
        if (isPrecip && precipArr)             return precipitationColor(precipArr[br]);
        if (isRainShadow && rainShadowArr)     return rainShadowColor(rainShadowArr[br]);
        if (isOceanCurrent && oceanWarmth && oceanSpeed) return oceanCurrentColor(oceanWarmth[br], oceanSpeed[br], r_elevation[br] <= 0);
        if (isOceanCurrent)                    return [0.5, 0, 0.5];
        if (isHydroState && hydroStateArr)     return hydroStateColor(hydroStateArr[br]);
        if (isHabitability && habitabilityArr) return habitabilityColor(habitabilityArr[br]);
        if (isFlowAccum && flowAccumArr)       return flowAccumColor(flowAccumArr[br], flowAccumMax);
        if (isLandHeightmap)                   return landHeightmapColor(r_elevation[br]);
        if (isHeightmap)                       return heightmapColor(r_elevation[br]);
        if (dbgArr)                            return debugValueToColor(dbgArr[br], dbgMin, dbgMax);
        if (showPlates) {
            const pc = state.plateColors[r_plate[br]] || new THREE.Color(0.3, 0.3, 0.3);
            return [pc.r, pc.g, pc.b];
        }
        if (showStress) {
            const sv = r_stress ? r_stress[br] : 0;
            if (sv > 0.5)            return [0.9, 0.1+sv*0.3, 0.1];
            if (sv > 0.1)            return [0.9, 0.5+sv*0.5, 0.2];
            if (mountain_r.has(br))  return [0.8, 0.4, 0.1];
            if (coastline_r.has(br)) return [0.9, 0.9, 0.2];
            if (ocean_r.has(br))     return [0.1, 0.2, 0.7];
            return [0.15, 0.15, 0.18];
        }
        return elevationToColor(r_elevation[br] - waterLevel);
    };
}

// Build equirectangular map mesh.
export function buildMapMesh() {
    if (state.mapMesh) { scene.remove(state.mapMesh); state.mapMesh.geometry.dispose(); state.mapMesh.material.dispose(); state.mapMesh = null; }
    if (!state.curData || !state.mapMode) return;

    const { mesh, r_xyz, t_xyz, r_plate, r_elevation, t_elevation, mountain_r, coastline_r, ocean_r, r_stress, debugLayers } = state.curData;
    const showPlates = document.getElementById('chkPlates').checked;
    const showStress = false;
    const waterLevel = 0;
    const debugLayer = state.debugLayer || '';

    const ls = resolveLayerState(debugLayer, debugLayers, mesh, r_elevation);
    const { isOceanCurrent, oceanWarmth, oceanSpeed,
            isBiome, koppenArr, isFlowAccum, flowAccumArr, flowAccumMax, riverThreshold, riverPathArr,
            dbgArr, dbgMin, dbgMax } = ls;
    if (isOceanCurrent && (!oceanWarmth || !oceanSpeed)) {
        console.warn(`[buildMapMesh] Ocean current layer "${debugLayer}" selected but data missing (warmth=${!!oceanWarmth}, speed=${!!oceanSpeed}). Hard-refresh (Ctrl+Shift+R) and generate a new planet.`);
    }

    const { numSides } = mesh;
    const PI = Math.PI;
    const centerLon = state.mapCenterLon || 0;

    // Offset longitude by center meridian and wrap to [-PI, PI]
    function wrapLon(lon) {
        let l = lon - centerLon;
        if (l > PI) l -= 2 * PI;
        else if (l < -PI) l += 2 * PI;
        return l;
    }

    const biomeMode = state.planetaryParams?.biomeMode ?? 'earth';
    const biomeSmoothed = (isBiome && koppenArr) ? getCachedBiomeSmoothed(mesh, koppenArr, r_elevation, biomeMode) : null;    const getRegionColor = makeColorizer(ls, biomeSmoothed, r_elevation, r_plate, r_stress,
                                         mountain_r, coastline_r, ocean_r, showPlates, showStress, waterLevel);
    // Upper-bound allocation: wrapping sides produce 2 triangles, non-wrapping 1.
    // Wraps are rare, so 2Ã— is a conservative upper bound; trimmed after the loop.
    const posArr = new Float32Array(numSides * 2 * 9);
    const colArr = new Float32Array(numSides * 2 * 9);
    const faceToSide = new Int32Array(numSides * 2);
    let triCount = 0;

    for (let s = 0; s < numSides; s++) {
        const it = mesh.s_inner_t(s);
        const ot = mesh.s_outer_t(s);
        const br = mesh.s_begin_r(s);

        let [cr, cg, cb] = getRegionColor(br);
        // River tinting in default terrain and biome views.
        // Use the precomputed path mask so flat coastal cells are included.
        const onRiver = riverPathArr ? riverPathArr[br]
            : (flowAccumArr && flowAccumArr[br] >= riverThreshold);
        if (onRiver && !isFlowAccum && r_elevation[br] > 0) {
            const t = riverPathArr
                ? Math.min(1, 0.5 + 0.5 * (flowAccumArr[br] - riverThreshold) / Math.max(1, flowAccumMax - riverThreshold))
                : 0.75;
            cr = cr * (1 - t * 0.6) + 0.2 * t * 0.6;
            cg = cg * (1 - t * 0.5) + 0.45 * t * 0.5;
            cb = cb * (1 - t * 0.4) + 0.8 * t * 0.4;
        }

        const x0 = t_xyz[3*it], y0 = t_xyz[3*it+1], z0 = t_xyz[3*it+2];
        const x1 = t_xyz[3*ot], y1 = t_xyz[3*ot+1], z1 = t_xyz[3*ot+2];
        const x2 = r_xyz[3*br], y2 = r_xyz[3*br+1], z2 = r_xyz[3*br+2];

        let lon0 = wrapLon(Math.atan2(x0, z0)), lat0 = Math.asin(Math.max(-1, Math.min(1, y0)));
        let lon1 = wrapLon(Math.atan2(x1, z1)), lat1 = Math.asin(Math.max(-1, Math.min(1, y1)));
        let lon2 = wrapLon(Math.atan2(x2, z2)), lat2 = Math.asin(Math.max(-1, Math.min(1, y2)));

        const sx = 2 / PI;
        const maxLon = Math.max(lon0, lon1, lon2);
        const minLon = Math.min(lon0, lon1, lon2);
        const wraps = (maxLon - minLon) > PI;

        // Clamp projected coords to map bounds
        const cx = (v) => Math.max(-2, Math.min(2, v));
        const cy = (v) => Math.max(-1, Math.min(1, v));

        if (wraps) {
            if (lon0 < 0) lon0 += 2 * PI;
            if (lon1 < 0) lon1 += 2 * PI;
            if (lon2 < 0) lon2 += 2 * PI;

            let off = triCount * 9;
            posArr[off]   = cx(lon0*sx); posArr[off+1] = cy(lat0*sx); posArr[off+2] = 0;
            posArr[off+3] = cx(lon1*sx); posArr[off+4] = cy(lat1*sx); posArr[off+5] = 0;
            posArr[off+6] = cx(lon2*sx); posArr[off+7] = cy(lat2*sx); posArr[off+8] = 0;
            colArr[off]=cr; colArr[off+1]=cg; colArr[off+2]=cb;
            colArr[off+3]=cr; colArr[off+4]=cg; colArr[off+5]=cb;
            colArr[off+6]=cr; colArr[off+7]=cg; colArr[off+8]=cb;
            faceToSide[triCount] = s;
            triCount++;

            off = triCount * 9;
            posArr[off]   = cx((lon0-2*PI)*sx); posArr[off+1] = cy(lat0*sx); posArr[off+2] = 0;
            posArr[off+3] = cx((lon1-2*PI)*sx); posArr[off+4] = cy(lat1*sx); posArr[off+5] = 0;
            posArr[off+6] = cx((lon2-2*PI)*sx); posArr[off+7] = cy(lat2*sx); posArr[off+8] = 0;
            colArr[off]=cr; colArr[off+1]=cg; colArr[off+2]=cb;
            colArr[off+3]=cr; colArr[off+4]=cg; colArr[off+5]=cb;
            colArr[off+6]=cr; colArr[off+7]=cg; colArr[off+8]=cb;
            faceToSide[triCount] = s;
            triCount++;
        } else {
            const off = triCount * 9;
            posArr[off]   = cx(lon0*sx); posArr[off+1] = cy(lat0*sx); posArr[off+2] = 0;
            posArr[off+3] = cx(lon1*sx); posArr[off+4] = cy(lat1*sx); posArr[off+5] = 0;
            posArr[off+6] = cx(lon2*sx); posArr[off+7] = cy(lat2*sx); posArr[off+8] = 0;
            colArr[off]=cr; colArr[off+1]=cg; colArr[off+2]=cb;
            colArr[off+3]=cr; colArr[off+4]=cg; colArr[off+5]=cb;
            colArr[off+6]=cr; colArr[off+7]=cg; colArr[off+8]=cb;
            faceToSide[triCount] = s;
            triCount++;
        }
    }

    const finalPos = posArr.subarray(0, triCount * 9);
    const finalCol = colArr.subarray(0, triCount * 9);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(finalPos), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(finalCol), 3));

    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, clippingPlanes: MAP_CLIP_PLANES });
    state.mapMesh = new THREE.Mesh(geo, mat);
    state.mapMesh.visible = state.mapMode;
    state.mapMesh._builtCenterLon = state.mapCenterLon || 0;
    state.mapFaceToSide = faceToSide.subarray(0, triCount);
    state._mapHoverBackup = null;
    state._mapKoppenHoverBackup = null;
    // Wrap clones: children inherit parent visibility + transform
    const cloneL = new THREE.Mesh(geo, mat); cloneL.position.x = -4;
    const cloneR = new THREE.Mesh(geo, mat); cloneR.position.x = 4;
    state.mapMesh.add(cloneL, cloneR);
    scene.add(state.mapMesh);

    buildMapGrid();
}

// Build lat/lon grid overlay for map view.
function buildMapGrid() {
    if (state.mapGridMesh) {
        scene.remove(state.mapGridMesh);
        state.mapGridMesh.geometry.dispose();
        state.mapGridMesh.material.dispose();
        state.mapGridMesh = null;
    }

    const spacing = state.gridSpacing;
    const sx = 2 / Math.PI;
    const Z = 0.001;
    const PI = Math.PI;
    const centerLonDeg = (state.mapCenterLon || 0) * 180 / PI;
    const positions = [];

    for (let deg = -90; deg <= 90; deg += spacing) {
        const y = (deg * Math.PI / 180) * sx;
        positions.push(-2, y, Z, 2, y, Z);
    }

    for (let deg = -180; deg <= 180; deg += spacing) {
        let offsetDeg = deg - centerLonDeg;
        // Wrap to [-180, 180]
        if (offsetDeg > 180) offsetDeg -= 360;
        else if (offsetDeg < -180) offsetDeg += 360;
        const x = (offsetDeg * Math.PI / 180) * sx;
        positions.push(x, -1, Z, x, 1, Z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const gridMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, clippingPlanes: MAP_CLIP_PLANES });
    state.mapGridMesh = new THREE.LineSegments(geo, gridMat);
    state.mapGridMesh.visible = state.mapMode && state.gridEnabled;
    // Wrap clones for smooth longitude scrolling
    const gCloneL = new THREE.LineSegments(geo, gridMat); gCloneL.position.x = -4;
    const gCloneR = new THREE.LineSegments(geo, gridMat); gCloneR.position.x = 4;
    state.mapGridMesh.add(gCloneL, gCloneR);
    scene.add(state.mapGridMesh);
}

// Build lat/lon grid on the 3D globe.
function buildGlobeGrid() {
    if (state.globeGridMesh) {
        scene.remove(state.globeGridMesh);
        state.globeGridMesh.geometry.dispose();
        state.globeGridMesh.material.dispose();
        state.globeGridMesh = null;
    }

    const spacing = state.gridSpacing;
    const R = 1.002; // slightly above water sphere
    const SEG = 120;  // segments per circle
    const positions = [];

    // Latitude lines
    for (let deg = -90; deg <= 90; deg += spacing) {
        if (deg === -90 || deg === 90) continue; // poles are points, skip
        const lat = deg * Math.PI / 180;
        const cosLat = Math.cos(lat);
        const y = Math.sin(lat) * R;
        for (let i = 0; i < SEG; i++) {
            const lon0 = (i / SEG) * Math.PI * 2;
            const lon1 = ((i + 1) / SEG) * Math.PI * 2;
            positions.push(
                Math.sin(lon0) * cosLat * R, y, Math.cos(lon0) * cosLat * R,
                Math.sin(lon1) * cosLat * R, y, Math.cos(lon1) * cosLat * R
            );
        }
    }

    // Longitude lines (semicircles pole to pole)
    for (let deg = -180; deg < 180; deg += spacing) {
        const lon = deg * Math.PI / 180;
        const sinLon = Math.sin(lon);
        const cosLon = Math.cos(lon);
        for (let i = 0; i < SEG; i++) {
            const lat0 = -Math.PI / 2 + (i / SEG) * Math.PI;
            const lat1 = -Math.PI / 2 + ((i + 1) / SEG) * Math.PI;
            positions.push(
                sinLon * Math.cos(lat0) * R, Math.sin(lat0) * R, cosLon * Math.cos(lat0) * R,
                sinLon * Math.cos(lat1) * R, Math.sin(lat1) * R, cosLon * Math.cos(lat1) * R
            );
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const gridMat = new THREE.ShaderMaterial({
        uniforms: {
            color: { value: new THREE.Color(0xffffff) },
            opacity: { value: 0.12 }
        },
        vertexShader: `
            void main() {
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_Position.z -= 0.002 * gl_Position.w; // depth bias: render on top of nearby surfaces
            }
        `,
        fragmentShader: `
            uniform vec3 color;
            uniform float opacity;
            void main() {
                gl_FragColor = vec4(color, opacity);
            }
        `,
        transparent: true,
        depthWrite: false
    });
    state.globeGridMesh = new THREE.LineSegments(geo, gridMat);
    state.globeGridMesh.visible = !state.mapMode && state.gridEnabled;
    scene.add(state.globeGridMesh);
}

// Rebuild both grids (call when spacing changes).
export function rebuildGrids() {
    buildMapGrid();
    buildGlobeGrid();
}

// Build Voronoi mesh â€” each half-edge produces one triangle.
export function buildMesh() {
    if (!state.curData) return;
    // Skip mesh build during silent background generation â€” curData is already
    // cached by main.js; the mesh will be built fresh when the user drills in.
    if (state.isBgGenerating) return;
    const { mesh, r_xyz, t_xyz, r_plate, r_elevation, t_elevation, mountain_r, coastline_r, ocean_r, r_stress, debugLayers } = state.curData;
    const showPlates = document.getElementById('chkPlates').checked;
    const showStress = false;
    const waterLevel = 0;
    const debugLayer = state.debugLayer || '';

    const ls = resolveLayerState(debugLayer, debugLayers, mesh, r_elevation);
    const { isOceanCurrent, oceanWarmth, oceanSpeed,
            isBiome, koppenArr, isFlowAccum, flowAccumArr, flowAccumMax, riverThreshold, riverPathArr,
            dbgArr, dbgMin, dbgMax } = ls;
    if (isOceanCurrent && (!oceanWarmth || !oceanSpeed)) {
        console.warn(`[buildMesh] Ocean current layer "${debugLayer}" selected but data missing (warmth=${!!oceanWarmth}, speed=${!!oceanSpeed}). Hard-refresh (Ctrl+Shift+R) and generate a new planet.`);
    }

    if (state.planetMesh) { scene.remove(state.planetMesh); state.planetMesh.geometry.dispose(); state.planetMesh.material.dispose(); }
    if (state.wireMesh)   { scene.remove(state.wireMesh);   state.wireMesh.geometry.dispose();   state.wireMesh.material.dispose(); }

    const { numSides } = mesh;
    const V = 0.04;
    const pos = new Float32Array(numSides * 9);
    const col = new Float32Array(numSides * 9);

    const biomeMode = state.planetaryParams?.biomeMode ?? 'earth';
    const biomeSmoothed = (isBiome && koppenArr) ? getCachedBiomeSmoothed(mesh, koppenArr, r_elevation, biomeMode) : null;
    const getRegionColor = makeColorizer(ls, biomeSmoothed, r_elevation, r_plate, r_stress,
                                         mountain_r, coastline_r, ocean_r, showPlates, showStress, waterLevel);

    for (let s = 0; s < numSides; s++) {
        const it = mesh.s_inner_t(s);
        const ot = mesh.s_outer_t(s);
        const br = mesh.s_begin_r(s);

        const re  = r_elevation[br]  - waterLevel;
        const ite = t_elevation[it]  - waterLevel;
        const ote = t_elevation[ot]  - waterLevel;

        const rDisp  = 1.0 + (re  > 0 ? re  * V : re  * V * 0.3);
        const itDisp = 1.0 + (ite > 0 ? ite * V : ite * V * 0.3);
        const otDisp = 1.0 + (ote > 0 ? ote * V : ote * V * 0.3);

        const off = s * 9;
        let v0x = t_xyz[3*it]   * itDisp,
            v0y = t_xyz[3*it+1] * itDisp,
            v0z = t_xyz[3*it+2] * itDisp;
        let v1x = t_xyz[3*ot]   * otDisp,
            v1y = t_xyz[3*ot+1] * otDisp,
            v1z = t_xyz[3*ot+2] * otDisp;
        let v2x = r_xyz[3*br]   * rDisp,
            v2y = r_xyz[3*br+1] * rDisp,
            v2z = r_xyz[3*br+2] * rDisp;

        // Fix winding order
        const e1x = v1x-v0x, e1y = v1y-v0y, e1z = v1z-v0z;
        const e2x = v2x-v0x, e2y = v2y-v0y, e2z = v2z-v0z;
        const nx = e1y*e2z - e1z*e2y;
        const ny = e1z*e2x - e1x*e2z;
        const nz = e1x*e2y - e1y*e2x;
        const cx = (v0x+v1x+v2x)/3, cy = (v0y+v1y+v2y)/3, cz = (v0z+v1z+v2z)/3;
        if (nx*cx + ny*cy + nz*cz < 0) {
            let tx, ty, tz;
            tx=v1x; ty=v1y; tz=v1z;
            v1x=v2x; v1y=v2y; v1z=v2z;
            v2x=tx; v2y=ty; v2z=tz;
        }

        pos[off]   = v0x; pos[off+1] = v0y; pos[off+2] = v0z;
        pos[off+3] = v1x; pos[off+4] = v1y; pos[off+5] = v1z;
        pos[off+6] = v2x; pos[off+7] = v2y; pos[off+8] = v2z;

        let [cr, cg, cb] = getRegionColor(br);
        // River tinting in default terrain and biome views.
        // Use the precomputed path mask so flat coastal cells are included.
        const onRiver = riverPathArr ? riverPathArr[br]
            : (flowAccumArr && flowAccumArr[br] >= riverThreshold);
        if (onRiver && !isFlowAccum && r_elevation[br] > 0) {
            const t = riverPathArr
                ? Math.min(1, 0.5 + 0.5 * (flowAccumArr[br] - riverThreshold) / Math.max(1, flowAccumMax - riverThreshold))
                : 0.75;
            cr = cr * (1 - t * 0.6) + 0.2 * t * 0.6;
            cg = cg * (1 - t * 0.5) + 0.45 * t * 0.5;
            cb = cb * (1 - t * 0.4) + 0.8 * t * 0.4;
        }
        for (let j = 0; j < 3; j++) {
            col[off+j*3]   = cr;
            col[off+j*3+1] = cg;
            col[off+j*3+2] = cb;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));

    state._hoverBackup = null;
    state._koppenHoverBackup = null;

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <beginnormal_vertex>',
            'vec3 objectNormal = normalize(position);'
        );
    };
    state.planetMesh = new THREE.Mesh(geo, mat);
    scene.add(state.planetMesh);

    waterMesh.visible = !state.mapMode && !showPlates && !showStress && !debugLayer &&
                         state.planetaryParams?.surfaceFluidColor !== null;

    // Voronoi-edge wireframe
    if (document.getElementById('chkWire').checked) {
        const lp = [];
        for (let s = 0; s < numSides; s++) {
            if (s < mesh.halfedges[s]) {
                const it = mesh.s_inner_t(s), ot = mesh.s_outer_t(s);
                const ite = t_elevation[it], ote = t_elevation[ot];
                const d1 = 1.001 + (ite > 0 ? ite*V : ite*V*0.3);
                const d2 = 1.001 + (ote > 0 ? ote*V : ote*V*0.3);
                lp.push(
                    t_xyz[3*it]*d1, t_xyz[3*it+1]*d1, t_xyz[3*it+2]*d1,
                    t_xyz[3*ot]*d2, t_xyz[3*ot+1]*d2, t_xyz[3*ot+2]*d2
                );
            }
        }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
        state.wireMesh = new THREE.LineSegments(lg,
            new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12 }));
        scene.add(state.wireMesh);
    }

    buildDriftArrows();
    updateHoverHighlight();

    // Defer map mesh construction to reduce peak GPU memory â€” built on demand
    // when switching to map view (see viewMode handler in main.js).
    if (state.mapMode) buildMapMesh();
    buildGlobeGrid();
    if (state.mapMode) {
        state.planetMesh.visible = false;
        waterMesh.visible = false;
        atmosMesh.visible = false;
        starsMesh.visible = false;
        if (state.wireMesh) state.wireMesh.visible = false;
        if (state.arrowGroup) state.arrowGroup.visible = false;
        if (state.mapGridMesh) state.mapGridMesh.visible = state.gridEnabled;
        if (state.globeGridMesh) state.globeGridMesh.visible = false;
        if (state.oceanCurrentArrowGroup) {
            state.oceanCurrentArrowGroup.traverse(c => {
                if (c.name === 'oceanGlobe') c.visible = false;
                if (c.name === 'oceanMap') c.visible = true;
            });
        }
    } else {
        state.planetMesh.visible = true;
        atmosMesh.visible = true;
        starsMesh.visible = true;
        if (state.wireMesh) state.wireMesh.visible = true;
        if (state.arrowGroup) state.arrowGroup.visible = true;
        if (state.mapGridMesh) state.mapGridMesh.visible = false;
        if (state.globeGridMesh) state.globeGridMesh.visible = state.gridEnabled;
        if (state.oceanCurrentArrowGroup) {
            state.oceanCurrentArrowGroup.traverse(c => {
                if (c.name === 'oceanGlobe') c.visible = true;
                if (c.name === 'oceanMap') c.visible = false;
            });
        }
    }

    // If the orrery is the active view, suppress all planet-side meshes now
    // so they never flash for a single frame during background generation.
    if (state.solarSystemMode) {
        state.planetMesh.visible = false;
        waterMesh.visible = false;
        atmosMesh.visible = false;
        starsMesh.visible = false;
        if (state.wireMesh) state.wireMesh.visible = false;
        if (state.arrowGroup) state.arrowGroup.visible = false;
        if (state.globeGridMesh) state.globeGridMesh.visible = false;
        if (state.mapGridMesh) state.mapGridMesh.visible = false;
    }
}

// Update only color buffers for globe + map meshes (no geometry rebuild).
// Use this when switching display modes to avoid GPU memory spikes.
export function updateMeshColors() {
    if (!state.curData || !state.planetMesh) return;
    const { mesh, r_plate, r_elevation, mountain_r, coastline_r, ocean_r, r_stress, debugLayers } = state.curData;
    const showPlates = document.getElementById('chkPlates').checked;
    const showStress = false;
    const waterLevel = 0;
    const debugLayer = state.debugLayer || '';

    const ls = resolveLayerState(debugLayer, debugLayers, mesh, r_elevation);
    const { isBiome, koppenArr, isFlowAccum, flowAccumArr, flowAccumMax, riverThreshold, riverPathArr } = ls;

    // Precompute smoothed biome colors (one-pass neighbor blend)
    const biomeMode = state.planetaryParams?.biomeMode ?? 'earth';
    const biomeSmoothed = (isBiome && koppenArr) ? getCachedBiomeSmoothed(mesh, koppenArr, r_elevation, biomeMode) : null;
    const getRegionColor = makeColorizer(ls, biomeSmoothed, r_elevation, r_plate, r_stress,
                                         mountain_r, coastline_r, ocean_r, showPlates, showStress, waterLevel);

    // Update globe mesh colors in-place
    const colorAttr = state.planetMesh.geometry.getAttribute('color');
    const colors = colorAttr.array;
    const { numSides } = mesh;

    for (let s = 0; s < numSides; s++) {
        const br = mesh.s_begin_r(s);
        let [cr, cg, cb] = getRegionColor(br);
        // River tinting in default terrain and biome views.
        // Use the precomputed path mask so flat coastal cells are included.
        const onRiver = riverPathArr ? riverPathArr[br]
            : (flowAccumArr && flowAccumArr[br] >= riverThreshold);
        if (onRiver && !isFlowAccum && r_elevation[br] > 0) {
            const t = riverPathArr
                ? Math.min(1, 0.5 + 0.5 * (flowAccumArr[br] - riverThreshold) / Math.max(1, flowAccumMax - riverThreshold))
                : 0.75;
            cr = cr * (1 - t * 0.6) + 0.2 * t * 0.6;
            cg = cg * (1 - t * 0.5) + 0.45 * t * 0.5;
            cb = cb * (1 - t * 0.4) + 0.8 * t * 0.4;
        }
        const off = s * 9;
        for (let j = 0; j < 3; j++) {
            colors[off + j*3]     = cr;
            colors[off + j*3 + 1] = cg;
            colors[off + j*3 + 2] = cb;
        }
    }
    colorAttr.needsUpdate = true;
    state._hoverBackup = null;
    state._koppenHoverBackup = null;
    state._selectionBackup = null; // re-applied after full color rebuild below

    // Update map mesh colors in-place (if map exists)
    if (state.mapMesh && state.mapFaceToSide) {
        const mapColorAttr = state.mapMesh.geometry.getAttribute('color');
        const mapColors = mapColorAttr.array;
        const fts = state.mapFaceToSide;

        for (let f = 0; f < fts.length; f++) {
            const s = fts[f];
            const br = mesh.s_begin_r(s);
            let [cr, cg, cb] = getRegionColor(br);
            // River tinting in default terrain and biome views.
            // Use the precomputed path mask so flat coastal cells are included.
            const onRiver = riverPathArr ? riverPathArr[br]
                : (flowAccumArr && flowAccumArr[br] >= riverThreshold);
            if (onRiver && !isFlowAccum && r_elevation[br] > 0) {
                const t = riverPathArr
                    ? Math.min(1, 0.5 + 0.5 * (flowAccumArr[br] - riverThreshold) / Math.max(1, flowAccumMax - riverThreshold))
                    : 0.75;
                cr = cr * (1 - t * 0.6) + 0.2 * t * 0.6;
                cg = cg * (1 - t * 0.5) + 0.45 * t * 0.5;
                cb = cb * (1 - t * 0.4) + 0.8 * t * 0.4;
            }
            const off = f * 9;
            for (let j = 0; j < 3; j++) {
                mapColors[off + j*3]     = cr;
                mapColors[off + j*3 + 1] = cg;
                mapColors[off + j*3 + 2] = cb;
            }
        }
        mapColorAttr.needsUpdate = true;
        state._mapHoverBackup = null;
        state._mapKoppenHoverBackup = null;
    }

    // Update water visibility
    waterMesh.visible = !state.mapMode && !showPlates && !showStress && !debugLayer &&
                         state.planetaryParams?.surfaceFluidColor !== null;

    updateHoverHighlight();
    updateMapHoverHighlight();
    if (state.selectedRegion !== null && state.selectedRegion >= 0) {
        updateSelectionHighlight(state.selectedRegion);
    }
}

// PNG export -- re-exported from mesh-export.js
export { exportMap, exportMapBatch } from './mesh-export.js';
