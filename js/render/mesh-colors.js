// Region color-mapping functions for all visualization layers.
// Used by planet-mesh.js (buildMesh, buildMapMesh, updateMeshColors)
// and mesh-export.js (exportMap, exportMapBatch).

import { elevToHeightKm, biomeColor } from './color-map.js';
import { KOPPEN_CLASSES } from '../sim/koppen.js';
import { state } from '../core/state.js';

// ---------------------------------------------------------------------------
// Biome smoothing cache
// ---------------------------------------------------------------------------

// Precompute smoothed biome colors: each region blends with its neighbors' average.
// Uses mesh adjacency (~6 neighbors per region) so it's inherently scale-independent.
// Cached on module state to avoid redundant computation across render paths.
let _biomeCache = null;
let _biomeCacheKey = null;
let _biomeModeCacheKey = null;
let _biomePaletteCacheKey = null;

// Build a compact key string from the palette sub-variant params that affect which color
// branch fires inside iceColor / alienColor / aridColor / barrenColor.
function _makePaletteKey(params) {
    if (!params) return '0:0:0';
    return `${params.baseTemp ?? 15}:${params.atmosphere ?? 3}:${params.hydrosphere ?? 3}`;
}

function smoothBiomeColors(mesh, koppenArr, r_elevation, biomeMode = 'earth') {
    const n = mesh.numRegions;
    const raw = new Float32Array(n * 3);
    for (let r = 0; r < n; r++) {
        const [cr, cg, cb] = biomeColor(koppenArr[r], r_elevation[r], biomeMode);
        raw[r * 3] = cr; raw[r * 3 + 1] = cg; raw[r * 3 + 2] = cb;
    }
    const out = new Float32Array(n * 3);
    const alpha = 0.35;
    const { adjOffset, adjList } = mesh;
    for (let r = 0; r < n; r++) {
        const start = adjOffset[r];
        const end = adjOffset[r + 1];
        const count = end - start;
        if (count === 0) {
            out[r * 3] = raw[r * 3]; out[r * 3 + 1] = raw[r * 3 + 1]; out[r * 3 + 2] = raw[r * 3 + 2];
            continue;
        }
        let avgR = 0, avgG = 0, avgB = 0;
        for (let i = start; i < end; i++) {
            const nr = adjList[i];
            avgR += raw[nr * 3]; avgG += raw[nr * 3 + 1]; avgB += raw[nr * 3 + 2];
        }
        avgR /= count; avgG /= count; avgB /= count;
        out[r * 3]     = raw[r * 3]     * (1 - alpha) + avgR * alpha;
        out[r * 3 + 1] = raw[r * 3 + 1] * (1 - alpha) + avgG * alpha;
        out[r * 3 + 2] = raw[r * 3 + 2] * (1 - alpha) + avgB * alpha;
    }
    return out;
}

export function getCachedBiomeSmoothed(mesh, koppenArr, r_elevation, biomeMode = 'earth') {
    const paletteKey = _makePaletteKey(state.planetaryParams);
    if (_biomeCache && _biomeCacheKey === koppenArr && _biomeModeCacheKey === biomeMode
            && _biomePaletteCacheKey === paletteKey) return _biomeCache;
    _biomeCache = smoothBiomeColors(mesh, koppenArr, r_elevation, biomeMode);
    _biomeCacheKey = koppenArr;
    _biomeModeCacheKey = biomeMode;
    _biomePaletteCacheKey = paletteKey;
    return _biomeCache;
}

// ---------------------------------------------------------------------------
// Per-region color functions
// ---------------------------------------------------------------------------

// Grayscale heightmap: black (lowest) → white (highest), in physical height space
// Piecewise scale: ocean (-5→0 km) maps to 0→0.25; land (0→maxKm) maps to 0.25→1.0.
// This gives land 75% of the brightness range so mountain relief is clearly visible.
export function heightmapColor(elevation) {
    const h = elevToHeightKm(elevation);
    const uplift = state.planetaryParams?.upliftMultiplier ?? 1;
    const maxKm = 6 * uplift; // equals 6/g
    const SEA_GRAY = 0.25; // brightness assigned to sea level
    let t;
    if (h <= 0) {
        // Ocean: -5 km → 0.0,  0 km → SEA_GRAY
        t = Math.max(0, (h + 5) / 5) * SEA_GRAY;
    } else {
        // Land: 0 km → SEA_GRAY,  maxKm → 1.0
        t = SEA_GRAY + Math.min(1, h / maxKm) * (1 - SEA_GRAY);
    }
    return [t, t, t];
}

// Land heightmap: ocean = black, land = 0 → max km absolute scale.
export function landHeightmapColor(elevation) {
    if (elevation <= 0) return [0, 0, 0];
    const uplift = state.planetaryParams?.upliftMultiplier ?? 1;
    const maxKm = 6 * uplift;
    const t = Math.max(0, Math.min(1, elevToHeightKm(elevation) / maxKm));
    return [t, t, t];
}

// Land mask: white = land, black = ocean
export function landMaskColor(elevation) {
    return elevation > 0 ? [1, 1, 1] : [0, 0, 0];
}

// Diverging color map: blue (negative) → white (zero) → red (positive)
export function debugValueToColor(v, minV, maxV) {
    const range = Math.max(Math.abs(minV), Math.abs(maxV)) || 1;
    const t = Math.max(-1, Math.min(1, v / range)); // normalise to [-1, 1]
    if (t < 0) {
        const s = -t; // 0→1
        return [1 - s * 0.7, 1 - s * 0.7, 1];           // white → blue
    } else {
        const s = t;  // 0→1
        return [1, 1 - s * 0.75, 1 - s * 0.75];          // white → red
    }
}

// Precipitation debug color: brown (dry) → green (moderate) → blue (wet)
export function precipitationColor(value) {
    // value is 0–1 (p95-normalized)
    const t = Math.max(0, Math.min(1, value));
    if (t < 0.25) {
        // Very dry: tan/brown
        const s = t / 0.25;
        return [0.76 - s * 0.16, 0.60 - s * 0.05, 0.42 - s * 0.12];
    } else if (t < 0.5) {
        // Dry to moderate: brown → green
        const s = (t - 0.25) / 0.25;
        return [0.60 - s * 0.30, 0.55 + s * 0.20, 0.30 - s * 0.05];
    } else if (t < 0.75) {
        // Moderate to wet: green → teal
        const s = (t - 0.5) / 0.25;
        return [0.30 - s * 0.15, 0.75 - s * 0.10, 0.25 + s * 0.40];
    } else {
        // Wet to very wet: teal → deep blue
        const s = (t - 0.75) / 0.25;
        return [0.15 - s * 0.05, 0.65 - s * 0.35, 0.65 + s * 0.20];
    }
}

// Rain shadow diverging color: blue (windward boost) ↔ neutral gray ↔ red-brown (leeward shadow)
// Input is signed: positive = windward, negative = leeward shadow (propagated downwind)
export function rainShadowColor(value) {
    if (value > 0.01) {
        // Windward: gray → blue (saturates at 0.5)
        const t = Math.min(1, value / 0.5);
        return [0.55 - t * 0.40, 0.55 - t * 0.10, 0.58 + t * 0.37];
    } else if (value < -0.01) {
        // Leeward shadow: gray → red-brown (saturates at -0.5)
        const t = Math.min(1, -value / 0.5);
        return [0.55 + t * 0.35, 0.55 - t * 0.35, 0.58 - t * 0.45];
    }
    return [0.55, 0.55, 0.58]; // neutral gray (ocean / flat)
}

// Continentality debug color: ocean (blue) → coast (green) → interior (orange/red)
// Input is 0–1: 0 = open ocean, ~0.3-0.5 = coast, 0.95+ = deep interior.
export function continentalityColor(value) {
    const t = Math.max(0, Math.min(1, value));
    if (t < 0.15) {
        // Ocean: dark blue → lighter blue
        const s = t / 0.15;
        return [0.05 + s * 0.10, 0.10 + s * 0.20, 0.40 + s * 0.20];
    } else if (t < 0.4) {
        // Coastal: blue → green
        const s = (t - 0.15) / 0.25;
        return [0.15 - s * 0.05, 0.30 + s * 0.45, 0.60 - s * 0.35];
    } else if (t < 0.7) {
        // Moderate interior: green → yellow
        const s = (t - 0.4) / 0.3;
        return [0.10 + s * 0.80, 0.75 - s * 0.05, 0.25 - s * 0.15];
    } else if (t < 0.9) {
        // Deep interior: yellow → orange
        const s = (t - 0.7) / 0.2;
        return [0.90 + s * 0.05, 0.70 - s * 0.40, 0.10 - s * 0.05];
    } else {
        // Super-continent core: orange → dark red
        const s = (t - 0.9) / 0.1;
        return [0.95 - s * 0.25, 0.30 - s * 0.20, 0.05];
    }
}

// Temperature debug color: discrete bands matching real climate map style.
// Input is 0-1 normalized from -45 to +45 C. Convert back to C for thresholds.
export function temperatureColor(value) {
    const T = -45 + Math.max(0, Math.min(1, value)) * 90;
    if (T < -38) return [0.78, 0.78, 0.78];       // White-gray
    if (T <   0) return [0.00, 0.00, 0.50];        // Dark blue
    if (T <  10) return [0.53, 0.81, 0.92];        // Light blue
    if (T <  18) return [1.00, 1.00, 0.00];        // Yellow
    if (T <  22) return [1.00, 0.65, 0.00];        // Orange
    if (T <  32) return [1.00, 0.00, 0.00];        // Red
    if (T <  40) return [0.55, 0.00, 0.00];        // Dark red
    return [0.20, 0.00, 0.00];                      // Darker red
}

// Köppen climate class color: returns [r,g,b] from KOPPEN_CLASSES lookup.
export function koppenColor(classId) {
    const c = KOPPEN_CLASSES[classId] || KOPPEN_CLASSES[0];
    return c.color;
}

// Hydrosphere state color: 0=liquid ocean, 1=frozen, 2=dry basin, 3=land
// Note: parameter is named `hydroState` to avoid shadowing the state module import.
export function hydroStateColor(hydroState) {
    if (hydroState === 0) return [0.04, 0.18, 0.68]; // liquid ocean — deep blue
    if (hydroState === 1) return [0.80, 0.90, 0.97]; // frozen — icy white-blue
    if (hydroState === 2) return [0.72, 0.55, 0.28]; // dry basin — dusty tan
    return [0.34, 0.30, 0.26];                        // land — neutral grey-brown
}

// Habitability index color: 0=inhospitable (red), 0.5=marginal (yellow), 1=habitable (green)
export function habitabilityColor(t) {
    const v = Math.max(0, Math.min(1, t));
    if (v <= 0)    return [0.20, 0.08, 0.08];
    if (v <  0.25) { const s = v / 0.25;         return [0.75,  s * 0.40,         0.05]; }       // red → orange
    if (v <  0.55) { const s = (v - 0.25) / 0.3; return [0.75 - s * 0.55, 0.40 + s * 0.30, 0.05]; } // orange → yellow
    return [0.08, 0.72, 0.22];                    // green (habitable)
}

// Flow-accumulation debug colour — deep blue gradient using quartic stretch.
export function flowAccumColor(v, maxV) {
    if (maxV <= 0) return [0.05, 0.05, 0.10];
    const t = Math.min(1, Math.sqrt(Math.sqrt(v / maxV)));
    return [0.02 + 0.08 * (1 - t), 0.05 + 0.25 * t, 0.12 + 0.65 * t];
}

// Ocean current debug color: warmth × speed, with gray land.
export function oceanCurrentColor(warmth, speed, isOcean) {
    if (!isOcean) return [0.45, 0.45, 0.45]; // gray land

    // speed is 0-1 (p95 normalized); ensure even low-speed areas are clearly visible
    const intensity = Math.pow(Math.min(1, speed * 3), 0.6); // gamma curve for more visible low values
    // Minimum brightness so all ocean is distinguishable from land and black background
    const base = 0.12;

    if (warmth > 0.05) {
        // Warm (poleward) → dark red-orange to bright red
        const w = Math.min(1, warmth * 1.5);
        const t = base + (1 - base) * w * intensity;
        return [t, base * 0.4 + t * 0.1, base * 0.3];
    } else if (warmth < -0.05) {
        // Cold (equatorward) → dark blue to bright blue
        const w = Math.min(1, -warmth * 1.5);
        const t = base + (1 - base) * w * intensity;
        return [base * 0.3, base * 0.5 + t * 0.15, t];
    } else {
        // Neutral (zonal) → dark teal-gray
        const t = base + intensity * 0.45;
        return [t * 0.55, t * 0.7, t * 0.65];
    }
}
