// Terrain post-processing: domain warping, bilateral smoothing, and
// flow-based erosion. Runs after elevation assignment to deform terrain
// for organic shapes, soften harsh boundaries, and carve natural
// drainage patterns.

import { SimplexNoise } from '../core/simplex-noise.js';
import { erodeComposite } from './erosion.js';
export { erodeComposite };

/**
 * Domain warping — displaces each region's elevation lookup by FBM simplex
 * noise in the tangent plane, producing organic, squiggly coastlines and
 * mountain ridges. Scale-invariant: noise is evaluated in 3D coordinate
 * space and amplitude is in radians (physical distance on the sphere).
 *
 * For each region:
 *  1. Compute a tangent-plane frame (east/north) at its position on the unit sphere
 *  2. Use FBM simplex noise (4 octaves, frequency 6) to generate two
 *     displacement values in the tangent plane
 *  3. Displace the region's 3D position along the tangent frame by the noise
 *     offsets, then re-project onto the unit sphere
 *  4. Walk the mesh graph (greedy nearest-neighbor) from the original region
 *     toward the displaced point to find the closest region
 *  5. Copy that source region's elevation to the output
 */
export function warpTerrain(mesh, r_elevation, r_xyz, seed, strength) {
    if (strength <= 0) return;

    const N = mesh.numRegions;
    const { adjOffset, adjList } = mesh;
    const noise = new SimplexNoise(seed + 9999);
    const freq = 4;
    const octaves = 5;
    const maxAmp = 0.12 * strength; // radians (~760 km at Earth scale when strength=1)

    const out = new Float32Array(r_elevation);

    for (let r = 0; r < N; r++) {
        const px = r_xyz[3 * r], py = r_xyz[3 * r + 1], pz = r_xyz[3 * r + 2];

        // Tangent frame: east = normalize(cross(up, pos)), north = cross(pos, east)
        let ex = -pz, ey = 0, ez = px; // cross([0,1,0], pos) = [-pz, 0, px]
        const elen = Math.sqrt(ex * ex + ez * ez);
        if (elen > 1e-10) { ex /= elen; ez /= elen; }
        else { ex = 1; ez = 0; } // poles

        const nx = py * ez;
        const ny = pz * ex - px * ez;
        const nz = -py * ex;
        const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const nnx = nx / nlen, nny = ny / nlen, nnz = nz / nlen;

        // FBM noise → two displacement values
        const d1 = noise.fbm(px * freq, py * freq, pz * freq, octaves) * maxAmp;
        const d2 = noise.fbm(px * freq + 31.7, py * freq + 47.3, pz * freq + 19.1, octaves) * maxAmp;

        // Displace position along tangent frame and re-project onto unit sphere
        let wx = px + ex * d1 + nnx * d2;
        let wy = py + ey * d1 + nny * d2;
        let wz = pz + ez * d1 + nnz * d2;
        const wlen = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1;
        wx /= wlen; wy /= wlen; wz /= wlen;

        // Greedy mesh walk from r toward the displaced point
        let cur = r;
        let bestDot = wx * px + wy * py + wz * pz;
        for (;;) {
            let moved = false;
            for (let i = adjOffset[cur], iEnd = adjOffset[cur + 1]; i < iEnd; i++) {
                const nb = adjList[i];
                const dot = wx * r_xyz[3 * nb] + wy * r_xyz[3 * nb + 1] + wz * r_xyz[3 * nb + 2];
                if (dot > bestDot) {
                    bestDot = dot;
                    cur = nb;
                    moved = true;
                }
            }
            if (!moved) break;
        }

        out[r] = r_elevation[cur];
    }

    // Weighted max: pick whichever is larger, biased by strength
    // At strength≈0 → 75% original, at strength=1 → 75% warped
    const warpBias = 0.25 + 0.5 * strength;
    for (let r = 0; r < N; r++) {
        const orig = r_elevation[r];
        const warped = out[r];
        if (warped > orig) {
            r_elevation[r] = orig + (warped - orig) * warpBias;
        } else {
            r_elevation[r] = warped + (orig - warped) * (1 - warpBias);
        }
    }
}

/**
 * Bilateral-weighted Laplacian smoothing.
 * Neighbors with similar elevation receive more weight, preserving ridges
 * and trenches while blending the banded artefacts from BFS distance fields.
 * Coastline cells (land adjacent to ocean) are locked to prevent drift.
 */
export function smoothElevation(mesh, r_elevation, r_isOcean, iterations, strength) {
    const N = mesh.numRegions;
    const tmp = new Float32Array(N);
    const { adjOffset, adjList } = mesh;

    // Pre-compute coastline lock: land cells adjacent to at least one ocean cell
    const locked = new Uint8Array(N);
    for (let r = 0; r < N; r++) {
        if (r_isOcean[r]) continue;
        for (let i = adjOffset[r], iEnd = adjOffset[r + 1]; i < iEnd; i++) {
            if (r_isOcean[adjList[i]]) { locked[r] = 1; break; }
        }
    }

    for (let iter = 0; iter < iterations; iter++) {
        for (let r = 0; r < N; r++) {
            if (locked[r]) { tmp[r] = r_elevation[r]; continue; }

            const h = r_elevation[r];
            let wSum = 0, hSum = 0;
            for (let i = adjOffset[r], iEnd = adjOffset[r + 1]; i < iEnd; i++) {
                const nh = r_elevation[adjList[i]];
                const diff = Math.abs(nh - h);
                const w = 1 / (1 + diff * 8);
                wSum += w;
                hSum += nh * w;
            }
            if (wSum > 0) {
                const avg = hSum / wSum;
                tmp[r] = h + (avg - h) * strength;
            } else {
                tmp[r] = h;
            }
        }
        // Copy back
        for (let r = 0; r < N; r++) r_elevation[r] = tmp[r];
    }
}

/**
 * Ridge sharpening — pushes cells that sit above their neighborhood average
 * further upward, accentuating ridgelines without creating unrealistic spikes.
 */
export function sharpenRidges(mesh, r_elevation, r_isOcean, iterations, strength) {
    const N = mesh.numRegions;
    const { adjOffset, adjList } = mesh;

    // Pre-build land cell list to skip ~40% ocean cells each iteration
    const landCells = [];
    for (let r = 0; r < N; r++) {
        if (!r_isOcean[r]) landCells.push(r);
    }
    const landCount = landCells.length;

    const tmp = new Float32Array(N);
    const original = new Float32Array(r_elevation);

    for (let iter = 0; iter < iterations; iter++) {
        for (let li = 0; li < landCount; li++) {
            const r = landCells[li];
            const h = r_elevation[r];
            let sum = 0;
            const count = adjOffset[r + 1] - adjOffset[r];
            for (let i = adjOffset[r], iEnd = adjOffset[r + 1]; i < iEnd; i++) {
                sum += r_elevation[adjList[i]];
            }
            if (count === 0) { tmp[r] = h; continue; }

            const avg = sum / count;
            if (h > avg) {
                let h_new = h + (h - avg) * strength;
                // Clamp: don't exceed 1.5x original elevation
                const cap = original[r] * 1.5;
                if (h_new > cap) h_new = cap;
                tmp[r] = h_new;
            } else {
                tmp[r] = h;
            }
        }
        for (let li = 0; li < landCount; li++) r_elevation[landCells[li]] = tmp[landCells[li]];
    }
}

/**
 * Soil creep — simple Laplacian diffusion on land cells.
 * Unlike bilateral smoothing, this doesn't preserve ridges — it uniformly
 * rounds off hillslopes. Coastline cells are locked.
 */
export function applySoilCreep(mesh, r_elevation, r_isOcean, iterations, strength) {
    const N = mesh.numRegions;
    const { adjOffset, adjList } = mesh;

    // Pre-build interior land cell list: skip ocean cells and coastline-locked cells
    const interiorLand = [];
    for (let r = 0; r < N; r++) {
        if (r_isOcean[r]) continue;
        let coastal = false;
        for (let i = adjOffset[r], iEnd = adjOffset[r + 1]; i < iEnd; i++) {
            if (r_isOcean[adjList[i]]) { coastal = true; break; }
        }
        if (!coastal) interiorLand.push(r);
    }
    const ilCount = interiorLand.length;

    const tmp = new Float32Array(N);

    for (let iter = 0; iter < iterations; iter++) {
        for (let li = 0; li < ilCount; li++) {
            const r = interiorLand[li];
            const h = r_elevation[r];
            let sum = 0, count = 0;
            for (let i = adjOffset[r], iEnd = adjOffset[r + 1]; i < iEnd; i++) {
                if (!r_isOcean[adjList[i]]) {
                    sum += r_elevation[adjList[i]];
                    count++;
                }
            }
            if (count === 0) { tmp[r] = h; continue; }

            const avg = sum / count;
            tmp[r] = h + (avg - h) * strength;
        }
        for (let li = 0; li < ilCount; li++) r_elevation[interiorLand[li]] = tmp[interiorLand[li]];
    }
}

/**
 * Hypsometric distribution correction — gently remaps land and ocean elevation
 * distributions toward more spread-out profiles, ensuring land elevations span
 * their available range rather than clustering near the median.
 *
 * Land and ocean populations are corrected independently, preserving the
 * sea-level boundary. Uses a mild power-law target CDF blended at 0.15
 * weight (Lesson 6 — conservative to avoid washing out structural pipeline work).
 *
 * Scale-invariant: operates purely on elevation values, not cell counts.
 */
export function applyHypsometricCorrection(mesh, r_elevation, r_isOcean, hydro = 3) {
    const N = mesh.numRegions;
    const BLEND = 0.15;

    // Collect land and ocean cell indices
    const land = [];
    const ocean = [];
    for (let r = 0; r < N; r++) {
        if (r_isOcean[r]) ocean.push(r);
        else land.push(r);
    }

    /**
     * Sort cells by elevation (ascending) to get their current rank-percentile,
     * then map each rank through targetCDF(t) to compute a target elevation,
     * and blend toward it at BLEND weight.
     * Strictly preserves [eMin, eMax] — no clamping artifacts.
     */
    function remapPopulation(cells, targetCDF) {
        if (cells.length < 2) return;
        cells.sort((a, b) => r_elevation[a] - r_elevation[b]);
        const n = cells.length;
        const eMin = r_elevation[cells[0]];
        const eMax = r_elevation[cells[n - 1]];
        if (eMax <= eMin) return; // degenerate population
        const range = eMax - eMin;
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);               // current rank-percentile [0,1]
            const targetT = targetCDF(t);         // target percentile [0,1]
            const targetElev = eMin + targetT * range;
            r_elevation[cells[i]] += (targetElev - r_elevation[cells[i]]) * BLEND;
        }
    }

    // Land: mild lowland bias — t^0.80 CDF spreads the lower end more,
    // producing a gentle peak near sea level with gradual taper to highlands.
    remapPopulation(land,  t => Math.pow(t, 0.80));

    // Ocean: depth bias scaled by hydrosphere level.
    // hydro=3 (Earth default) → exponent 1.20 (unchanged).
    // Higher levels (4=High, 5=Flooded) → deeper basins; lower levels → shallower.
    const oceanExp = 1.20 + 0.15 * (hydro - 3);
    remapPopulation(ocean, t => Math.pow(t, oceanExp));
}

/**
 * Compute per-cell flow accumulation by building a steepest-descent drainage
 * graph on the final elevation field and propagating unit flow downstream.
 *
 * Each land cell starts with a flow of 1 (its own unit contribution).  Flow is
 * routed to the steepest downslope neighbour and accumulated there, so trunk
 * river cells collect contributions from every upstream cell in their catchment.
 * Ocean cells always receive 0.
 *
 * The result is proportional to drainage area and can be used to identify
 * major river corridors (high-percentile cells).
 *
 * Scale-invariant: operates on elevation values and adjacency topology only.
 */

/**
 * Shift the elevation field so that exactly `targetFraction` of all cells
 * have elevation ≤ 0 (i.e. are ocean).  The shift is computed by finding the
 * element at rank floor(targetFraction × N) in the sorted elevation array and
 * subtracting it from every cell, which places that element precisely at 0.
 *
 * This is applied AFTER hypsometric correction so that the shape of the
 * elevation distribution is preserved — only the zero‑crossing moves.
 *
 * Earth invariance: hydro=3 → oceanFraction=0.70; the plate assignment
 * already targets 70 % ocean cells, so the shift is typically < 1 e-3 and
 * visually imperceptible.
 */
export function calibrateSeaLevel(r_elevation, targetFraction) {
    const N = r_elevation.length;
    if (targetFraction <= 0 || targetFraction >= 1) return;
    // Sort a copy to find the required shift without mutating the order.
    const sorted = new Float32Array(r_elevation).sort();
    const idx = Math.min(N - 1, Math.floor(targetFraction * N));
    const shift = -sorted[idx];
    if (Math.abs(shift) < 1e-6) return;
    for (let r = 0; r < N; r++) r_elevation[r] += shift;
}

export function computeFlowAccumulation(mesh, r_elevation) {
    const N = mesh.numRegions;
    const { adjOffset, adjList } = mesh;

    // Mark ocean cells
    const r_isOcean = new Uint8Array(N);
    for (let r = 0; r < N; r++) r_isOcean[r] = r_elevation[r] <= 0 ? 1 : 0;

    // ── BFS ocean-distance map ────────────────────────────────────────────
    // Hop count to the nearest ocean cell. Ocean = 0, land cells get the
    // BFS distance. Used as a secondary sort key and for flat-cell routing.
    // This is O(N) and ensures rivers on flat coastal plains always drain
    // toward the sea even after post-erosion operations (hypsometric
    // correction, soil creep) have washed out the tiny EPS-scale gradient
    // that priority-flood left behind.
    const oceanDist = new Int32Array(N).fill(N); // N = unreachable sentinel
    const bfsQueue = [];
    for (let r = 0; r < N; r++) {
        if (r_isOcean[r]) { oceanDist[r] = 0; bfsQueue.push(r); }
    }
    for (let qi = 0; qi < bfsQueue.length; qi++) {
        const r = bfsQueue[qi];
        const d = oceanDist[r] + 1;
        for (let j = adjOffset[r]; j < adjOffset[r + 1]; j++) {
            const nb = adjList[j];
            if (oceanDist[nb] > d) { oceanDist[nb] = d; bfsQueue.push(nb); }
        }
    }

    // ── Sort land cells: descending elevation, tie-break descending oceanDist ──
    // Primary key (high→low elevation) guarantees upstream cells are
    // processed before downstream ones.  For flat areas at the same
    // elevation, processing farther-from-ocean cells first ensures
    // accumulated flow propagates toward the coast correctly.
    const landCells = [];
    for (let r = 0; r < N; r++) if (!r_isOcean[r]) landCells.push(r);
    landCells.sort((a, b) => {
        const de = r_elevation[b] - r_elevation[a];
        if (de !== 0) return de;
        return oceanDist[b] - oceanDist[a]; // tie-break: farthest from ocean first
    });

    // ── Steepest-descent drain targets ───────────────────────────────────
    const drainTarget = new Int32Array(N).fill(-1);
    for (let i = 0; i < landCells.length; i++) {
        const r = landCells[i];
        const h = r_elevation[r];
        let bestNb = -1, bestDrop = 0;
        for (let j = adjOffset[r]; j < adjOffset[r + 1]; j++) {
            const nb = adjList[j];
            const drop = h - r_elevation[nb];
            if (drop > bestDrop) { bestDrop = drop; bestNb = nb; }
        }
        drainTarget[r] = bestNb; // −1 if flat or isolated pit — resolved below
    }

    // ── Flat-cell routing ─────────────────────────────────────────────────
    // Post-erosion operations (hypsometric correction, soil creep, ridge
    // sharpening) run after priority-flood and can erase the tiny EPS-scale
    // monotonic staircase that priority-flood created for coastal flats.
    // For any cell with no strict downhill neighbor, route to the adjacent
    // non-uphill cell that is closest to the ocean.
    for (let i = 0; i < landCells.length; i++) {
        const r = landCells[i];
        if (drainTarget[r] !== -1) continue; // already has a downhill route
        const h = r_elevation[r];
        let bestNb = -1, bestDist = N;
        for (let j = adjOffset[r]; j < adjOffset[r + 1]; j++) {
            const nb = adjList[j];
            if (r_elevation[nb] <= h && oceanDist[nb] < bestDist) {
                bestDist = oceanDist[nb];
                bestNb = nb;
            }
        }
        drainTarget[r] = bestNb; // −1 only if all neighbors are strictly higher (true peak)
    }

    // ── Accumulate flow downstream in high-to-low order ──────────────────
    const r_flow = new Float32Array(N);
    for (let r = 0; r < N; r++) if (!r_isOcean[r]) r_flow[r] = 1;

    for (let i = 0; i < landCells.length; i++) {
        const r = landCells[i];
        const t = drainTarget[r];
        if (t >= 0) r_flow[t] += r_flow[r];
    }

    // Ensure ocean cells stay at 0 (they may have received spillover above)
    for (let r = 0; r < N; r++) if (r_isOcean[r]) r_flow[r] = 0;

    // ── River-path mask ───────────────────────────────────────────────────
    // Mark every cell on a continuous corridor from a high-flow source to the
    // ocean. A cell qualifies as a river source if it is in the top 0.8% of
    // land flow-accumulation values. From each such source, walk drainTarget
    // downstream until the ocean, marking every cell along the way.
    //
    // This ensures that flat coastal plains — where steepest-descent routing
    // fans out and each individual cell has lower per-cell flow than the
    // inland trunk — are still coloured as part of the river corridor, because
    // they lie on the proven drain path from a high-accumulation source.
    const landVals = [];
    for (let r = 0; r < N; r++) {
        if (!r_isOcean[r] && r_flow[r] > 0) landVals.push(r_flow[r]);
    }
    landVals.sort((a, b) => a - b);
    const riverThreshold = landVals.length > 0
        ? landVals[Math.min(landVals.length - 1, Math.floor(landVals.length * 0.992))]
        : Infinity;

    const r_riverPath = new Uint8Array(N); // 1 = part of a river corridor
    for (let r = 0; r < N; r++) {
        if (r_isOcean[r] || r_flow[r] < riverThreshold) continue;
        // Walk downstream from this source cell to the ocean, marking as we go
        let cur = r;
        while (cur >= 0 && !r_isOcean[cur] && !r_riverPath[cur]) {
            r_riverPath[cur] = 1;
            cur = drainTarget[cur];
        }
    }

    return { r_flow, r_riverPath };
}
