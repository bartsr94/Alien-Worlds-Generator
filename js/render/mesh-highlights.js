// Mesh highlight utilities — surgical save/restore color-buffer patches for
// plate hover, Köppen hover, and tile selection. No geometry rebuild.
import { state } from '../core/state.js';

const HOVER_BRIGHTEN = 0.22;                             // white-tint delta for hovered cells
const SELECTION_TINT = { r: 0.40, g: 0.35, b: 0.00 };  // warm gold tint for selected tile

// Shared helper: restore the previous backup stored at state[backupKey], then
// apply a new uniform brightness boost to all cells where matchFn(i) is true.
// count  — number of entries to scan (mesh.numSides or fts.length)
// isActive — false skips the apply pass (backup is still cleared)
function applyHoverHighlight(colorAttr, count, backupKey, isActive, matchFn) {
    const colors = colorAttr.array;
    if (state[backupKey]) {
        const { offsets, saved } = state[backupKey];
        for (let i = 0; i < offsets.length; i++) {
            const off = offsets[i] * 9;
            for (let j = 0; j < 9; j++) colors[off + j] = saved[i * 9 + j];
        }
        state[backupKey] = null;
    }
    if (isActive) {
        let c = 0;
        for (let i = 0; i < count; i++) if (matchFn(i)) c++;
        const offsets = new Int32Array(c);
        const saved = new Float32Array(c * 9);
        let idx = 0;
        for (let i = 0; i < count; i++) {
            if (matchFn(i)) {
                offsets[idx] = i;
                const off = i * 9;
                for (let j = 0; j < 9; j++) saved[idx * 9 + j] = colors[off + j];
                for (let j = 0; j < 3; j++) {
                    colors[off + j*3]     = Math.min(1, colors[off + j*3]     + HOVER_BRIGHTEN);
                    colors[off + j*3 + 1] = Math.min(1, colors[off + j*3 + 1] + HOVER_BRIGHTEN);
                    colors[off + j*3 + 2] = Math.min(1, colors[off + j*3 + 2] + HOVER_BRIGHTEN);
                }
                idx++;
            }
        }
        state[backupKey] = { offsets, saved };
    }
    colorAttr.needsUpdate = true;
}

// Hover highlight — brighten hovered plate's cells (surgical save/restore).
export function updateHoverHighlight() {
    if (!state.planetMesh || !state.curData) return;
    const { mesh, r_plate } = state.curData;
    applyHoverHighlight(
        state.planetMesh.geometry.getAttribute('color'),
        mesh.numSides,
        '_hoverBackup',
        state.hoveredPlate >= 0,
        s => r_plate[mesh.s_begin_r(s)] === state.hoveredPlate,
    );
}

// Hover highlight for map mesh (surgical save/restore).
export function updateMapHoverHighlight() {
    if (!state.mapMesh || !state.curData || !state.mapFaceToSide) return;
    const { mesh, r_plate } = state.curData;
    const fts = state.mapFaceToSide;
    applyHoverHighlight(
        state.mapMesh.geometry.getAttribute('color'),
        fts.length,
        '_mapHoverBackup',
        state.hoveredPlate >= 0,
        f => r_plate[mesh.s_begin_r(fts[f])] === state.hoveredPlate,
    );
}

// Köppen legend hover highlight — brighten cells matching hovered climate class (globe).
export function updateKoppenHoverHighlight() {
    if (!state.planetMesh || !state.curData) return;
    const { mesh, debugLayers } = state.curData;
    const koppenArr = debugLayers && debugLayers.koppen;
    applyHoverHighlight(
        state.planetMesh.geometry.getAttribute('color'),
        mesh.numSides,
        '_koppenHoverBackup',
        state.hoveredKoppen >= 0 && !!koppenArr,
        s => koppenArr[mesh.s_begin_r(s)] === state.hoveredKoppen,
    );
}

// Köppen legend hover highlight for map mesh (surgical save/restore).
export function updateMapKoppenHoverHighlight() {
    if (!state.mapMesh || !state.curData || !state.mapFaceToSide) return;
    const { mesh, debugLayers } = state.curData;
    const koppenArr = debugLayers && debugLayers.koppen;
    const fts = state.mapFaceToSide;
    applyHoverHighlight(
        state.mapMesh.geometry.getAttribute('color'),
        fts.length,
        '_mapKoppenHoverBackup',
        state.hoveredKoppen >= 0 && !!koppenArr,
        f => koppenArr[mesh.s_begin_r(fts[f])] === state.hoveredKoppen,
    );
}

// Selection highlight — warm gold tint on a single clicked region (globe + map).
export function updateSelectionHighlight(region) {
    if (!state.planetMesh || !state.curData || region === null || region < 0) return;
    clearSelectionHighlight(); // restore any previous selection first
    const { mesh } = state.curData;

    // --- Globe ---
    const colorAttr = state.planetMesh.geometry.getAttribute('color');
    const colors = colorAttr.array;
    let globeCount = 0;
    for (let s = 0; s < mesh.numSides; s++) {
        if (mesh.s_begin_r(s) === region) globeCount++;
    }
    let globeBackup = null;
    if (globeCount > 0) {
        const offsets = new Int32Array(globeCount);
        const saved   = new Float32Array(globeCount * 9);
        let idx = 0;
        for (let s = 0; s < mesh.numSides; s++) {
            if (mesh.s_begin_r(s) === region) {
                offsets[idx] = s;
                const off = s * 9;
                for (let j = 0; j < 9; j++) saved[idx * 9 + j] = colors[off + j];
                for (let j = 0; j < 3; j++) {
                    colors[off + j*3]     = Math.min(1, colors[off + j*3]     + SELECTION_TINT.r);
                    colors[off + j*3 + 1] = Math.min(1, colors[off + j*3 + 1] + SELECTION_TINT.g);
                    colors[off + j*3 + 2] = Math.min(1, colors[off + j*3 + 2] + SELECTION_TINT.b);
                }
                idx++;
            }
        }
        colorAttr.needsUpdate = true;
        globeBackup = { offsets, saved };
    }

    // --- Map ---
    let mapBackup = null;
    if (state.mapMesh && state.mapFaceToSide) {
        const mapColorAttr = state.mapMesh.geometry.getAttribute('color');
        const mapColors = mapColorAttr.array;
        const fts = state.mapFaceToSide;
        let mapCount = 0;
        for (let f = 0; f < fts.length; f++) {
            if (mesh.s_begin_r(fts[f]) === region) mapCount++;
        }
        if (mapCount > 0) {
            const offsets = new Int32Array(mapCount);
            const saved   = new Float32Array(mapCount * 9);
            let idx = 0;
            for (let f = 0; f < fts.length; f++) {
                if (mesh.s_begin_r(fts[f]) === region) {
                    offsets[idx] = f;
                    const off = f * 9;
                    for (let j = 0; j < 9; j++) saved[idx * 9 + j] = mapColors[off + j];
                    for (let j = 0; j < 3; j++) {
                        mapColors[off + j*3]     = Math.min(1, mapColors[off + j*3]     + SELECTION_TINT.r);
                        mapColors[off + j*3 + 1] = Math.min(1, mapColors[off + j*3 + 1] + SELECTION_TINT.g);
                        mapColors[off + j*3 + 2] = Math.min(1, mapColors[off + j*3 + 2] + SELECTION_TINT.b);
                    }
                    idx++;
                }
            }
            mapColorAttr.needsUpdate = true;
            mapBackup = { offsets, saved };
        }
    }

    if (globeBackup || mapBackup) {
        state._selectionBackup = { region, globe: globeBackup, map: mapBackup };
    }
}

// Restore the selected-tile highlight (called before any full color rebuild).
export function clearSelectionHighlight() {
    if (!state._selectionBackup) return;
    const { globe, map } = state._selectionBackup;
    if (globe && state.planetMesh) {
        const colorAttr = state.planetMesh.geometry.getAttribute('color');
        const colors = colorAttr.array;
        for (let i = 0; i < globe.offsets.length; i++) {
            const off = globe.offsets[i] * 9;
            for (let j = 0; j < 9; j++) colors[off + j] = globe.saved[i * 9 + j];
        }
        colorAttr.needsUpdate = true;
    }
    if (map && state.mapMesh) {
        const mapColorAttr = state.mapMesh.geometry.getAttribute('color');
        const mapColors = mapColorAttr.array;
        for (let i = 0; i < map.offsets.length; i++) {
            const off = map.offsets[i] * 9;
            for (let j = 0; j < 9; j++) mapColors[off + j] = map.saved[i * 9 + j];
        }
        mapColorAttr.needsUpdate = true;
    }
    state._selectionBackup = null;
}
