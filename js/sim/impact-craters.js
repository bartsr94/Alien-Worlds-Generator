// Procedural impact crater generator for airless and trace-atmosphere worlds.
//
// Used by terrain-post.js when planetary params have atmosphere === 0 (Dead Rock,
// airless Moon-like surfaces) or atmosphere === 1 (Mars-like, partially eroded).
//
// Algorithm:
//   1. Sample crater sizes from a power-law distribution within each size tier
//   2. Sort large → small (ancient basins first, fresh micro-craters last)
//   3. BFS from a random centre cell to collect all cells within the crater's
//      physical radius (in km, converted to hops — scale-invariant)
//   4. Apply a bowl + raised rim + thin ejecta blanket elevation profile
//      using great-circle arc distance for accurate geometry
//
// Scale invariance:
//   All crater sizes are defined in km.  BFS hop counts are derived at runtime as
//   Math.round(targetKm / avgEdgeKm) where avgEdgeKm = (π × 6371) / √numRegions.
//   Crater depth is defined in elevation units (0–1 approx scale matching the
//   mesh conventions) so no per-resolution tuning is needed.

import { makeRng } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Crater profile — single cell at normalised distance t = d / radius
// ---------------------------------------------------------------------------

/**
 * Elevation delta for a single cell at normalised radial distance t.
 *
 * Components:
 *  bowl    — parabolic depression inside the rim (t ≤ 1).  Large craters
 *            (complex morphology) get a flat floor for t ≤ FLAT_FLOOR_T.
 *  rim     — Gaussian peak centred at t = 1 (the raised crater wall).
 *  ejecta  — low outer hump just beyond the rim (t ≈ 1.3) from excavated
 *            material thrown outward during impact.
 *
 * @param {number} t         Normalised distance (0 = centre, 1 = rim edge)
 * @param {number} depth     Bowl depth in elevation units
 * @param {number} rimH      Rim crest height above pre-impact level
 * @param {boolean} complex  True for large craters — enables flat floor
 * @returns {number}         Elevation delta to add to the cell
 */
function craterProfile(t, depth, rimH, complex) {
    const RIM_W     = 0.22;   // Gaussian half-width of rim (in normalised r)
    const EJECTA_R  = 1.32;   // centre of ejecta blanket hump
    const EJECTA_W  = 0.28;   // width of ejecta hump
    const FLAT_T    = 0.28;   // flat-floor radius fraction for complex craters
    const EJECTA_H  = rimH * 0.30; // ejecta hump height relative to rim

    // ── Bowl ──────────────────────────────────────────────────────────────────
    let bowl = 0;
    if (t <= 1.0) {
        // For complex craters: clamp inner t to FLAT_T so the floor is level
        const tBowl = complex ? Math.max(t, FLAT_T) : t;
        bowl = -depth * Math.max(0, 1 - (tBowl / 0.97) ** 2);
    }

    // ── Rim ──────────────────────────────────────────────────────────────────
    const rim = rimH * Math.exp(-(((t - 1.0) / RIM_W) ** 2));

    // ── Ejecta blanket (outer side only) ────────────────────────────────────
    const ejecta = t > 1.0
        ? EJECTA_H * Math.exp(-(((t - EJECTA_R) / EJECTA_W) ** 2))
        : 0;

    return bowl + rim + ejecta;
}

// ---------------------------------------------------------------------------
// BFS — collect all cells within maxHops, return their arc-distances in km
// ---------------------------------------------------------------------------

function bfsWithinRadius(mesh, r_xyz, centre, maxHops, avgEdgeKm, worldRadiusKm) {
    const { adjOffset, adjList, numRegions } = mesh;
    const maxDistKm = maxHops * avgEdgeKm * 1.15; // slight buffer beyond integer hops

    const CX = r_xyz[3 * centre];
    const CY = r_xyz[3 * centre + 1];
    const CZ = r_xyz[3 * centre + 2];

    const visited = new Uint8Array(numRegions);
    const cells = [];   // { r, distKm }
    const queue = [centre];
    visited[centre] = 1;

    for (let qi = 0; qi < queue.length; qi++) {
        const r = queue[qi];
        const rx = r_xyz[3 * r], ry = r_xyz[3 * r + 1], rz = r_xyz[3 * r + 2];
        const dot = Math.min(1, Math.max(-1, CX * rx + CY * ry + CZ * rz));
        const distKm = Math.acos(dot) * worldRadiusKm;

        if (distKm > maxDistKm) continue;

        cells.push({ r, distKm });

        for (let i = adjOffset[r], iEnd = adjOffset[r + 1]; i < iEnd; i++) {
            const nb = adjList[i];
            if (!visited[nb]) {
                visited[nb] = 1;
                // Cheap pre-filter: don't queue cells clearly beyond range
                const nbx = r_xyz[3 * nb], nby = r_xyz[3 * nb + 1], nbz = r_xyz[3 * nb + 2];
                const nbdot = Math.min(1, Math.max(-1, CX * nbx + CY * nby + CZ * nbz));
                const nbDist = Math.acos(nbdot) * 6371;
                if (nbDist <= maxDistKm + avgEdgeKm * 2) queue.push(nb);
            }
        }
    }

    return cells;
}

// ---------------------------------------------------------------------------
// Stamp a single crater
// ---------------------------------------------------------------------------

function stampOneCrater(mesh, r_xyz, r_elevation, centreIdx, radiusKm,
                        avgEdgeKm, gravity, degradation, worldRadiusKm) {
    // Depth and rim height in normalised elevation units.
    // Depth scales with sqrt(radius) — large craters are relatively shallower.
    // Gravity: lower gravity → deeper craters for the same impactor energy.
    const rawDepth = Math.min(0.22, 0.055 * Math.pow(radiusKm / 60, 0.5) / gravity);
    const depth    = rawDepth * (1 - degradation * 0.7);
    const rimH     = depth * 0.42 * (1 - degradation * 0.6);

    const complex  = radiusKm > 60; // complex morphology above ~60 km radius

    // Maximum BFS reach: extend 1.6× radius to cover full ejecta blanket
    const maxHops = Math.max(2, Math.round(radiusKm * 1.6 / avgEdgeKm));

    const cells = bfsWithinRadius(mesh, r_xyz, centreIdx, maxHops, avgEdgeKm, worldRadiusKm);

    // Pre-flatten the bowl floor for mega-basins (R > 350 km): bring existing
    // terrain to a neutral level so old mountains inside the basin look right.
    if (radiusKm > 350) {
        let sum = 0, count = 0;
        for (const { r, distKm } of cells) {
            if (distKm < radiusKm * 0.7) { sum += r_elevation[r]; count++; }
        }
        const avgInner = count > 0 ? sum / count : 0;
        const flatTarget = Math.min(avgInner, 0.1); // flatten to low relief
        for (const { r, distKm } of cells) {
            const t = distKm / radiusKm;
            if (t < 0.7) {
                const blend = 1 - t / 0.7;
                r_elevation[r] = r_elevation[r] * (1 - blend) + flatTarget * blend;
            }
        }
    }

    // Apply profile
    for (const { r, distKm } of cells) {
        const t = distKm / radiusKm;
        const delta = craterProfile(t, depth, rimH, complex);
        r_elevation[r] += delta;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Stamp impact craters onto the elevation field.
 *
 * Intensity is driven by atmosphere level:
 *   0 (airless) — fully saturated surface: mega-basins, large craters, dense
 *                 population of small craters
 *   1 (trace)   — Mars-like: 35% of airless density, rims and depths degraded
 *                 by 45% to mimic billions of years of thin-atm erosion
 *
 * @param {SphereMesh}   mesh              Voronoi sphere mesh
 * @param {Float32Array} r_xyz             Per-region 3D positions (unit sphere)
 * @param {Float32Array} r_elevation       Per-region elevation (mutated in place)
 * @param {number}       seed              RNG seed (independent from terrain seed)
 * @param {object}       planetaryParams   Params object from planetary-params.js
 */
export function stampCraters(mesh, r_xyz, r_elevation, seed, planetaryParams) {
    const { numRegions } = mesh;

    const atm       = planetaryParams?.atmosphere  ?? 0;
    const gravity   = planetaryParams?.gravity     ?? 1.0;
    const worldSize = planetaryParams?.worldSize   ?? 1.0;

    // Only run on airless (0) or trace-atmosphere (1) worlds
    if (atm > 1) return;

    // Physical radius and edge length for THIS world — not hardcoded to Earth.
    // This ensures a "400 km" crater spans the same physical fraction of the
    // sphere regardless of world size, and hop counts are correctly computed.
    const worldRadiusKm = worldSize * 6371;
    const avgEdgeKm = (Math.PI * worldRadiusKm) / Math.sqrt(numRegions);

    // Degradation factor for atmosphere=1 (eroded rims, shallower bowls)
    const degradation = atm === 0 ? 0.0 : 0.45;

    // Intensity multiplier: trace atmosphere → 35% of airless count.
    // Small worlds accumulate craters faster relative to their surface area.
    const intensityMult = (atm === 0 ? 1.0 : 0.35) * Math.min(2.5, 1.0 / Math.max(0.4, worldSize));

    // Maximum individual crater radius clipped to 55% of world radius so no
    // single crater wraps around more than half the globe.
    const maxCraterR = 0.55 * worldRadiusKm;

    // ── Crater population: [minRadiusKm, maxRadiusKm, count] ─────────────────
    // Counts are for a fully saturated airless Earth-sized world.
    // Tiers mirror the real Solar System size-frequency distribution.
    const tiers = [
        [ 400, 1400, 2  ],   // mega-basins   (Hellas / Caloris class)
        [ 120,  399, 7  ],   // large craters (Schiaparelli / Herschel class)
        [  35,  119, 22 ],   // medium craters
        [   9,   34, 60 ],   // small craters
        [   2,    8, 90 ],   // micro-craters (visible at ≥ 50K cells)
    ];

    const rng = makeRng(seed + 0xC2A7E1);

    // Collect all craters, sort large → small (old basins first, fresh small last)
    const craters = [];
    for (const [minR, rawMaxR, baseCount] of tiers) {
        const maxR = Math.min(rawMaxR, maxCraterR);
        if (minR > maxCraterR) continue; // tier entirely above world size — skip
        const count = Math.round(baseCount * intensityMult);
        for (let i = 0; i < count; i++) {
            const t = Math.pow(rng(), 1.6);
            const radiusKm = minR + t * (maxR - minR);
            const centreIdx = Math.floor(rng() * numRegions);
            craters.push({ radiusKm, centreIdx });
        }
    }
    craters.sort((a, b) => b.radiusKm - a.radiusKm);

    // Stamp each crater in descending size order
    for (const { radiusKm, centreIdx } of craters) {
        const hops = radiusKm / avgEdgeKm;
        if (hops < 0.6) continue;

        stampOneCrater(mesh, r_xyz, r_elevation, centreIdx, radiusKm,
                       avgEdgeKm, gravity, degradation, worldRadiusKm);
    }
}
