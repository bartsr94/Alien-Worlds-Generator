// Mesh highlight utilities — surgical save/restore color-buffer patches for
// plate hover, Köppen hover, and tile selection. No geometry rebuild.
import { state } from '../core/state.js';

// Hover highlight — brighten hovered plate's cells (surgical save/restore).
export function updateHoverHighlight() {
    if (!state.planetMesh || !state.curData) return;
    const colorAttr = state.planetMesh.geometry.getAttribute('color');
    const colors = colorAttr.array;

    // Restore previously highlighted cells
    if (state._hoverBackup) {
        const { offsets, saved } = state._hoverBackup;
        for (let i = 0; i < offsets.length; i++) {
            const off = offsets[i] * 9;
            for (let j = 0; j < 9; j++) colors[off + j] = saved[i * 9 + j];
        }
        state._hoverBackup = null;
    }

    // Apply new highlight
    if (state.hoveredPlate >= 0) {
        const { mesh, r_plate } = state.curData;
        // Count cells for this plate
        let count = 0;
        for (let s = 0; s < mesh.numSides; s++) {
            if (r_plate[mesh.s_begin_r(s)] === state.hoveredPlate) count++;
        }
        const offsets = new Int32Array(count);
        const saved = new Float32Array(count * 9);
        let idx = 0;
        for (let s = 0; s < mesh.numSides; s++) {
            if (r_plate[mesh.s_begin_r(s)] === state.hoveredPlate) {
                offsets[idx] = s;
                const off = s * 9;
                for (let j = 0; j < 9; j++) saved[idx * 9 + j] = colors[off + j];
                for (let j = 0; j < 3; j++) {
                    colors[off + j*3]     = Math.min(1, colors[off + j*3]     + 0.22);
                    colors[off + j*3 + 1] = Math.min(1, colors[off + j*3 + 1] + 0.22);
                    colors[off + j*3 + 2] = Math.min(1, colors[off + j*3 + 2] + 0.22);
                }
                idx++;
            }
        }
        state._hoverBackup = { offsets, saved };
    }
    colorAttr.needsUpdate = true;
}

// Hover highlight for map mesh (surgical save/restore).
export function updateMapHoverHighlight() {
    if (!state.mapMesh || !state.curData || !state.mapFaceToSide) return;
    const colorAttr = state.mapMesh.geometry.getAttribute('color');
    const colors = colorAttr.array;

    // Restore previously highlighted cells
    if (state._mapHoverBackup) {
        const { offsets, saved } = state._mapHoverBackup;
        for (let i = 0; i < offsets.length; i++) {
            const off = offsets[i] * 9;
            for (let j = 0; j < 9; j++) colors[off + j] = saved[i * 9 + j];
        }
        state._mapHoverBackup = null;
    }

    // Apply new highlight
    if (state.hoveredPlate >= 0) {
        const { mesh, r_plate } = state.curData;
        const fts = state.mapFaceToSide;
        // Count faces for this plate
        let count = 0;
        for (let f = 0; f < fts.length; f++) {
            if (r_plate[mesh.s_begin_r(fts[f])] === state.hoveredPlate) count++;
        }
        const offsets = new Int32Array(count);
        const saved = new Float32Array(count * 9);
        let idx = 0;
        for (let f = 0; f < fts.length; f++) {
            if (r_plate[mesh.s_begin_r(fts[f])] === state.hoveredPlate) {
                offsets[idx] = f;
                const off = f * 9;
                for (let j = 0; j < 9; j++) saved[idx * 9 + j] = colors[off + j];
                for (let j = 0; j < 3; j++) {
                    colors[off + j*3]     = Math.min(1, colors[off + j*3]     + 0.22);
                    colors[off + j*3 + 1] = Math.min(1, colors[off + j*3 + 1] + 0.22);
                    colors[off + j*3 + 2] = Math.min(1, colors[off + j*3 + 2] + 0.22);
                }
                idx++;
            }
        }
        state._mapHoverBackup = { offsets, saved };
    }
    colorAttr.needsUpdate = true;
}

// Köppen legend hover highlight — brighten cells matching hovered climate class (globe).
export function updateKoppenHoverHighlight() {
    if (!state.planetMesh || !state.curData) return;
    const colorAttr = state.planetMesh.geometry.getAttribute('color');
    const colors = colorAttr.array;

    // Restore previously highlighted cells
    if (state._koppenHoverBackup) {
        const { offsets, saved } = state._koppenHoverBackup;
        for (let i = 0; i < offsets.length; i++) {
            const off = offsets[i] * 9;
            for (let j = 0; j < 9; j++) colors[off + j] = saved[i * 9 + j];
        }
        state._koppenHoverBackup = null;
    }

    if (state.hoveredKoppen >= 0) {
        const { mesh, debugLayers } = state.curData;
        const koppenArr = debugLayers && debugLayers.koppen;
        if (!koppenArr) { colorAttr.needsUpdate = true; return; }
        let count = 0;
        for (let s = 0; s < mesh.numSides; s++) {
            if (koppenArr[mesh.s_begin_r(s)] === state.hoveredKoppen) count++;
        }
        const offsets = new Int32Array(count);
        const saved = new Float32Array(count * 9);
        let idx = 0;
        for (let s = 0; s < mesh.numSides; s++) {
            if (koppenArr[mesh.s_begin_r(s)] === state.hoveredKoppen) {
                offsets[idx] = s;
                const off = s * 9;
                for (let j = 0; j < 9; j++) saved[idx * 9 + j] = colors[off + j];
                for (let j = 0; j < 3; j++) {
                    colors[off + j*3]     = Math.min(1, colors[off + j*3]     + 0.22);
                    colors[off + j*3 + 1] = Math.min(1, colors[off + j*3 + 1] + 0.22);
                    colors[off + j*3 + 2] = Math.min(1, colors[off + j*3 + 2] + 0.22);
                }
                idx++;
            }
        }
        state._koppenHoverBackup = { offsets, saved };
    }
    colorAttr.needsUpdate = true;
}

// Köppen legend hover highlight for map mesh (surgical save/restore).
export function updateMapKoppenHoverHighlight() {
    if (!state.mapMesh || !state.curData || !state.mapFaceToSide) return;
    const colorAttr = state.mapMesh.geometry.getAttribute('color');
    const colors = colorAttr.array;

    // Restore previously highlighted cells
    if (state._mapKoppenHoverBackup) {
        const { offsets, saved } = state._mapKoppenHoverBackup;
        for (let i = 0; i < offsets.length; i++) {
            const off = offsets[i] * 9;
            for (let j = 0; j < 9; j++) colors[off + j] = saved[i * 9 + j];
        }
        state._mapKoppenHoverBackup = null;
    }

    if (state.hoveredKoppen >= 0) {
        const { mesh, debugLayers } = state.curData;
        const koppenArr = debugLayers && debugLayers.koppen;
        if (!koppenArr) { colorAttr.needsUpdate = true; return; }
        const fts = state.mapFaceToSide;
        let count = 0;
        for (let f = 0; f < fts.length; f++) {
            if (koppenArr[mesh.s_begin_r(fts[f])] === state.hoveredKoppen) count++;
        }
        const offsets = new Int32Array(count);
        const saved = new Float32Array(count * 9);
        let idx = 0;
        for (let f = 0; f < fts.length; f++) {
            if (koppenArr[mesh.s_begin_r(fts[f])] === state.hoveredKoppen) {
                offsets[idx] = f;
                const off = f * 9;
                for (let j = 0; j < 9; j++) saved[idx * 9 + j] = colors[off + j];
                for (let j = 0; j < 3; j++) {
                    colors[off + j*3]     = Math.min(1, colors[off + j*3]     + 0.22);
                    colors[off + j*3 + 1] = Math.min(1, colors[off + j*3 + 1] + 0.22);
                    colors[off + j*3 + 2] = Math.min(1, colors[off + j*3 + 2] + 0.22);
                }
                idx++;
            }
        }
        state._mapKoppenHoverBackup = { offsets, saved };
    }
    colorAttr.needsUpdate = true;
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
                    colors[off + j*3]     = Math.min(1, colors[off + j*3]     + 0.40);
                    colors[off + j*3 + 1] = Math.min(1, colors[off + j*3 + 1] + 0.35);
                    colors[off + j*3 + 2] = Math.min(1, colors[off + j*3 + 2] + 0.00);
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
                        mapColors[off + j*3]     = Math.min(1, mapColors[off + j*3]     + 0.40);
                        mapColors[off + j*3 + 1] = Math.min(1, mapColors[off + j*3 + 1] + 0.35);
                        mapColors[off + j*3 + 2] = Math.min(1, mapColors[off + j*3 + 2] + 0.00);
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
