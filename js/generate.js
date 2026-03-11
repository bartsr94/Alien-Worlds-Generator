// Planet generation — dispatches work to a Web Worker, falls back to
// synchronous main-thread generation if module workers aren't supported.

import Delaunator from 'delaunator';
import { setDelaunator, SphereMesh } from './sim/sphere-mesh.js';
import { computePlateColors, buildMesh } from './render/planet-mesh.js';
import { state } from './core/state.js';
import { detailFromSlider } from './core/detail-scale.js';
import { computeOceanCurrents } from './sim/ocean.js';
import { computePrecipitation } from './sim/precipitation.js';
import { computeTemperature } from './sim/temperature.js';
import { classifyKoppen } from './sim/koppen.js';

// Main thread still needs Delaunator for SphereMesh reconstruction
setDelaunator(Delaunator);

/**
 * Compute per-region Planetary inspection layers (Hydrosphere State,
 * Habitability Index).  Requires climate data to be present in curData.
 */
export function computePlanetaryDebugLayers(curData, planetaryParams) {
    const { mesh, r_elevation,
            r_temperature_summer, r_temperature_winter,
            r_precip_summer, r_precip_winter } = curData;
    const pp = planetaryParams;
    const n  = mesh.numRegions;

    // Temperature scale — mirrors temperature.js logic
    const eqT    = pp?.equatorialTempC ?? 28;
    const pdrop  = pp?.tempRangeC      ?? 47;
    const tMin   = eqT - pdrop - 26;
    const tRange = Math.max(1, (eqT + 17) - tMin);
    const hasLiquidOcean = pp?.hasLiquidOcean ?? true;
    const baseTempC      = pp?.equatorialTempC ?? 28; // global proxy

    // --- Hydrosphere State (Uint8Array: 0=liquid, 1=frozen, 2=dry, 3=land) ---
    const r_hydro_state = new Uint8Array(n);
    for (let r = 0; r < n; r++) {
        if (r_elevation[r] > 0) {
            r_hydro_state[r] = 3;
        } else if (hasLiquidOcean) {
            r_hydro_state[r] = 0;
        } else if (baseTempC < -80) {
            r_hydro_state[r] = 1; // frozen ocean
        } else {
            r_hydro_state[r] = 2; // evaporated / dry basin
        }
    }

    // --- Habitability Index (Float32Array 0–1) ---
    const r_habitability = new Float32Array(n);
    for (let r = 0; r < n; r++) {
        // Convert normalised summer temperature back to °C
        const tempNorm  = r_temperature_summer ? Math.max(0, Math.min(1, r_temperature_summer[r])) : 0.5;
        const tempC     = tMin + tempNorm * tRange;

        // Temperature score: peak at 10–35°C, zero outside −20…+60°C
        let tempScore;
        if      (tempC < -20) tempScore = 0;
        else if (tempC <  10) tempScore = (tempC + 20) / 30;
        else if (tempC <= 35) tempScore = 1.0;
        else if (tempC <= 60) tempScore = 1.0 - (tempC - 35) / 25;
        else                  tempScore = 0;

        // Water score
        let waterScore;
        if (r_elevation[r] <= 0 && hasLiquidOcean) {
            waterScore = 1.0;
        } else if (r_precip_summer && r_precip_winter) {
            const precip = (r_precip_summer[r] + r_precip_winter[r]) * 0.5;
            waterScore = Math.min(1.0, precip * 2.5);
        } else {
            waterScore = 0;
        }

        r_habitability[r] = tempScore * waterScore;
    }

    // --- Ice cap arrays ---
    // r_permanentIce: cells where even summer temperature stays below −10 °C
    //   → permanent ice caps and land glaciers; rendered as brilliant white.
    // r_seasonalIce:  cells below 0 °C in winter but warmer in summer
    //   → pack ice on ocean, snow cover on land; rendered as pale blue-grey.
    // Earth invariance: with baseTemp ≈ 15 °C the coldest summer cell is
    // around −12 °C only at the geographic poles, which already look white
    // in the biome/terrain palettes — the override blends on top seamlessly.
    const r_permanentIce = new Uint8Array(n);
    const r_seasonalIce  = new Uint8Array(n);
    for (let r = 0; r < n; r++) {
        const sumNorm = r_temperature_summer ? Math.max(0, Math.min(1, r_temperature_summer[r])) : 0.5;
        const sumC    = tMin + sumNorm * tRange;
        const winNorm = r_temperature_winter  ? Math.max(0, Math.min(1, r_temperature_winter[r]))  : 0.5;
        const winC    = tMin + winNorm * tRange;
        if (sumC < -10) {
            r_permanentIce[r] = 1;
        } else if (winC < 0) {
            // Seasonal ice: ocean pack ice only when there is liquid water;
            // seasonal snow on any cold land cell regardless.
            if (r_elevation[r] <= 0 && !hasLiquidOcean) continue;
            r_seasonalIce[r] = 1;
        }
    }

    return { r_hydro_state, r_habitability, r_permanentIce, r_seasonalIce };
}

// --- Worker setup ---
let worker = null;
let workerSupported = true;
try {
    worker = new Worker(new URL('./planet-worker.js', import.meta.url), { type: 'module' });
} catch (e) {
    console.warn('[World Orogen] Module workers not supported, falling back to main thread:', e);
    workerSupported = false;
}

// Active callback state
let _onProgress = null;
let _onDone = null;
let _t0 = 0;

function resetUI() {
    const btn = document.getElementById('generate');
    btn.disabled = false;
    btn.textContent = 'Build New World';
    btn.classList.remove('generating', 'stale');
}

function fail(err) {
    console.error('[World Orogen] Generation failed:', err);
    resetUI();
    if (_onProgress) _onProgress(0, '');
}

// Reconstruct SphereMesh from transferred data
function reconstructMesh(triangles, halfedges, numRegions) {
    return new SphereMesh(triangles, halfedges, numRegions);
}

/** Assign all terrain + climate fields from the worker 'done' message to state.curData. */
function assignCurData(msg, mesh) {
    state.curData = {
        mesh,
        r_xyz: msg.r_xyz,
        t_xyz: msg.t_xyz,
        r_plate: msg.r_plate,
        plateSeeds: new Set(msg.plateSeeds),
        plateVec: msg.plateVec,
        plateIsOcean: new Set(msg.plateIsOcean),
        originalPlateIsOcean: new Set(msg.originalPlateIsOcean),
        plateDensity: msg.plateDensity,
        plateDensityLand: msg.plateDensityLand,
        plateDensityOcean: msg.plateDensityOcean,
        prePostElev: msg.prePostElev,
        r_elevation: msg.r_elevation,
        t_elevation: msg.t_elevation,
        mountain_r: new Set(msg.mountain_r),
        coastline_r: new Set(msg.coastline_r),
        ocean_r: new Set(msg.ocean_r),
        r_stress: msg.r_stress,
        r_wind_east_summer: msg.r_wind_east_summer,
        r_wind_north_summer: msg.r_wind_north_summer,
        r_wind_east_winter: msg.r_wind_east_winter,
        r_wind_north_winter: msg.r_wind_north_winter,
        itczLons: msg.itczLons,
        itczLatsSummer: msg.itczLatsSummer,
        itczLatsWinter: msg.itczLatsWinter,
        r_ocean_current_east_summer: msg.r_ocean_current_east_summer,
        r_ocean_current_north_summer: msg.r_ocean_current_north_summer,
        r_ocean_current_east_winter: msg.r_ocean_current_east_winter,
        r_ocean_current_north_winter: msg.r_ocean_current_north_winter,
        r_ocean_speed_summer: msg.r_ocean_speed_summer,
        r_ocean_speed_winter: msg.r_ocean_speed_winter,
        r_ocean_warmth_summer: msg.r_ocean_warmth_summer,
        r_ocean_warmth_winter: msg.r_ocean_warmth_winter,
        r_precip_summer: msg.r_precip_summer,
        r_precip_winter: msg.r_precip_winter,
        r_temperature_summer: msg.r_temperature_summer,
        r_temperature_winter: msg.r_temperature_winter,
        seed: msg.seed,
        nMag: msg.nMag,
        debugLayers: msg.debugLayers
    };
}

// Build minimal wind-result-like object for computeOceanCurrents fallback.
// Derives geographic data (lat, sinLat, isLand, tangent frames) from r_xyz/r_elevation
// and wraps the wind vectors the worker already sent.
function buildWindResultForOcean(mesh, r_xyz, r_elevation,
    r_wind_east_summer, r_wind_north_summer, r_wind_east_winter, r_wind_north_winter,
    itczLons, itczLatsSummer, itczLatsWinter) {
    const n = mesh.numRegions;
    const r_lat = new Float32Array(n);
    const r_lon = new Float32Array(n);
    const r_sinLat = new Float32Array(n);
    const r_isLand = new Uint8Array(n);
    const r_eastX = new Float32Array(n), r_eastY = new Float32Array(n), r_eastZ = new Float32Array(n);
    const r_northX = new Float32Array(n), r_northY = new Float32Array(n), r_northZ = new Float32Array(n);

    for (let r = 0; r < n; r++) {
        const x = r_xyz[3 * r], y = r_xyz[3 * r + 1], z = r_xyz[3 * r + 2];
        r_sinLat[r] = y;
        r_lat[r] = Math.asin(Math.max(-1, Math.min(1, y)));
        r_lon[r] = Math.atan2(x, z);
        r_isLand[r] = r_elevation[r] > 0 ? 1 : 0;

        // East = cross(up, position) normalized
        let ex = z, ey = 0, ez = -x;
        const elen = Math.sqrt(ex * ex + ez * ez);
        if (elen > 1e-10) { ex /= elen; ez /= elen; }
        else { ex = 1; ez = 0; } // poles
        r_eastX[r] = ex; r_eastY[r] = ey; r_eastZ[r] = ez;

        // North = cross(position, east) normalized
        let nx = y * ez - z * ey;
        let ny = z * ex - x * ez;
        let nz = x * ey - y * ex;
        const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        r_northX[r] = nx / nlen; r_northY[r] = ny / nlen; r_northZ[r] = nz / nlen;
    }

    // BFS coast distance through land (needed by precipitation fallback)
    const { adjOffset, adjList } = mesh;
    const r_coastDistLand = new Int32Array(n);
    r_coastDistLand.fill(-1);
    const bfsQueue = [];
    for (let r = 0; r < n; r++) {
        if (!r_isLand[r]) continue;
        const end = adjOffset[r + 1];
        for (let ni = adjOffset[r]; ni < end; ni++) {
            if (!r_isLand[adjList[ni]]) {
                r_coastDistLand[r] = 0;
                bfsQueue.push(r);
                break;
            }
        }
    }
    let bfsHead = 0;
    while (bfsHead < bfsQueue.length) {
        const r = bfsQueue[bfsHead++];
        const d = r_coastDistLand[r] + 1;
        const end = adjOffset[r + 1];
        for (let ni = adjOffset[r]; ni < end; ni++) {
            const nb = adjList[ni];
            if (r_isLand[nb] && r_coastDistLand[nb] === -1) {
                r_coastDistLand[nb] = d;
                bfsQueue.push(nb);
            }
        }
    }

    // Compute wind speed from components (prevents TypeError if accessed)
    const r_wind_speed_summer = new Float32Array(n);
    const r_wind_speed_winter = new Float32Array(n);
    for (let r = 0; r < n; r++) {
        const se = r_wind_east_summer[r], sn = r_wind_north_summer[r];
        r_wind_speed_summer[r] = Math.sqrt(se * se + sn * sn);
        const we = r_wind_east_winter[r], wn = r_wind_north_winter[r];
        r_wind_speed_winter[r] = Math.sqrt(we * we + wn * wn);
    }

    // Zero-filled pressure deviation (neutral: no pressure-driven effects in fallback)
    const r_pressure_summer = new Float32Array(n);
    const r_pressure_winter = new Float32Array(n);

    return {
        r_lat, r_lon, r_sinLat, r_isLand,
        r_eastX, r_eastY, r_eastZ,
        r_northX, r_northY, r_northZ,
        r_coastDistLand,
        r_wind_east_summer, r_wind_north_summer,
        r_wind_east_winter, r_wind_north_winter,
        r_wind_speed_summer, r_wind_speed_winter,
        r_pressure_summer, r_pressure_winter,
        itczLons, itczLatsSummer, itczLatsWinter
    };
}

/**
 * Apply main-thread climate fallbacks shared by the 'reapplyDone' and 'editDone'
 * message handlers.  Fills any ocean/precip/temperature arrays the worker omitted,
 * and clears stale climate data when skipClimate was set.
 */
function applyClimateFallback(d, skipClimate) {
    // Ocean currents fallback
    if (!d.r_ocean_speed_summer && d.r_wind_east_summer) {
        const wr = buildWindResultForOcean(d.mesh, d.r_xyz, d.r_elevation,
            d.r_wind_east_summer, d.r_wind_north_summer,
            d.r_wind_east_winter, d.r_wind_north_winter,
            d.itczLons, d.itczLatsSummer, d.itczLatsWinter);
        const oc = computeOceanCurrents(d.mesh, d.r_xyz, d.r_elevation, wr);
        Object.keys(oc).filter(k => k.startsWith('r_ocean_')).forEach(k => d[k] = oc[k]);
    }
    // Precipitation / temperature fallback
    if (!skipClimate && d.r_wind_east_summer) {
        let wr = null;
        if (!d.r_precip_summer || !d.r_temperature_summer) {
            wr = buildWindResultForOcean(d.mesh, d.r_xyz, d.r_elevation,
                d.r_wind_east_summer, d.r_wind_north_summer,
                d.r_wind_east_winter, d.r_wind_north_winter,
                d.itczLons, d.itczLatsSummer, d.itczLatsWinter);
        }
        if (!d.r_precip_summer && wr) {
            const pr = computePrecipitation(d.mesh, d.r_xyz, d.r_elevation, wr, d);
            d.r_precip_summer = pr.r_precip_summer;
            d.r_precip_winter = pr.r_precip_winter;
            if (d.debugLayers) {
                d.debugLayers.precipSummer = pr.r_precip_summer;
                d.debugLayers.precipWinter = pr.r_precip_winter;
                d.debugLayers.rainShadowSummer = pr.r_rainshadow_summer;
                d.debugLayers.rainShadowWinter = pr.r_rainshadow_winter;
            }
        }
        if (!d.r_temperature_summer && wr) {
            const tr = computeTemperature(d.mesh, d.r_xyz, d.r_elevation, wr, d, d);
            d.r_temperature_summer = tr.r_temperature_summer;
            d.r_temperature_winter = tr.r_temperature_winter;
            if (d.debugLayers) {
                d.debugLayers.tempSummer = tr.r_temperature_summer;
                d.debugLayers.tempWinter = tr.r_temperature_winter;
            }
        }
    }
    // Köppen classification fallback
    if (d.debugLayers && !d.debugLayers.koppen &&
        d.r_temperature_summer && d.r_precip_summer) {
        d.debugLayers.koppen = classifyKoppen(d.mesh, d.r_elevation,
            { r_temperature_summer: d.r_temperature_summer, r_temperature_winter: d.r_temperature_winter },
            { r_precip_summer: d.r_precip_summer, r_precip_winter: d.r_precip_winter });
    }

    // Planetary inspection layers (hydroState, habitability, ice extents)
    if (d.debugLayers && d.r_temperature_summer && d.r_precip_summer) {
        try {
            const planetary = computePlanetaryDebugLayers(d, state.planetaryParams);
            d.debugLayers.hydroState   = planetary.r_hydro_state;
            d.debugLayers.habitability = planetary.r_habitability;
            d.debugLayers.permanentIce = planetary.r_permanentIce;
            d.debugLayers.seasonalIce  = planetary.r_seasonalIce;
        } catch (e) {
            console.warn('[generate.js] Planetary debug layers failed:', e);
        }
    }

    // Clear stale climate data when climate was skipped
    if (skipClimate) {
        d.r_precip_summer = null;
        d.r_precip_winter = null;
        d.r_temperature_summer = null;
        d.r_temperature_winter = null;
        if (d.debugLayers) {
            d.debugLayers.koppen = null;
            d.debugLayers.tempSummer = null;
            d.debugLayers.tempWinter = null;
            d.debugLayers.precipSummer = null;
            d.debugLayers.precipWinter = null;
        }
    }
}

if (worker) {
    worker.onmessage = (e) => {
        const msg = e.data;
        switch (msg.type) {
            case 'progress':
                if (_onProgress) _onProgress(msg.pct, msg.label);
                break;

            case 'done': {
                const tMainStart = performance.now();

                const tReconStart = performance.now();
                const mesh = reconstructMesh(msg.triangles, msg.halfedges, msg.numRegions);
                const tRecon = performance.now() - tReconStart;

                const tColorsStart = performance.now();
                computePlateColors(new Set(msg.plateSeeds), new Set(msg.plateIsOcean));
                const tColors = performance.now() - tColorsStart;

                state.climateComputed = !msg.skipClimate;

                const tStateStart = performance.now();
                assignCurData(msg, mesh);
                const tState = performance.now() - tStateStart;

                // Main-thread fallbacks — only run when climate was requested but partially missing
                // (e.g. older cached worker). Skip entirely when skipClimate was set.
                applyClimateFallback(state.curData, msg.skipClimate);

                const tBuildStart = performance.now();
                buildMesh();
                const tBuild = performance.now() - tBuildStart;

                const tMainTotal = performance.now() - tMainStart;
                const tTotal = performance.now() - _t0;

                // Diagnostics
                {
                    let landCount = 0, nanCount = 0;
                    const plateIsOcean = state.curData.plateIsOcean;
                    const r_plate = state.curData.r_plate;
                    const r_elevation = state.curData.r_elevation;
                    for (let r = 0; r < mesh.numRegions; r++) {
                        if (!plateIsOcean.has(r_plate[r])) landCount++;
                        if (isNaN(r_elevation[r])) nanCount++;
                    }
                    const landPct = (100 * landCount / mesh.numRegions).toFixed(1);
                    if (nanCount > 0) console.error(`[World Orogen] WARNING: ${nanCount} NaN elevation values detected!`);
                    if (landCount / mesh.numRegions < 0.10) console.warn(`[World Orogen] WARNING: Only ${landPct}% land (${landCount} regions). Ocean/land growth may have stalled.`);
                }

                const f = v => typeof v === 'number' ? v.toFixed(1) : v;

                console.log(`%c[World Orogen] Generation complete`, 'color:#6cf;font-weight:bold');
                if (msg._params) {
                    console.log(`  Params: N=${msg._params.N.toLocaleString()} P=${msg._params.P} jitter=${msg._params.jitter} noise=${msg._params.nMag} continents=${msg._params.numContinents} seed=${msg._params.seed}`);
                    console.log(`  Sculpting: warp=${msg._params.terrainWarp} smooth=${msg._params.smoothing} glacial=${msg._params.glacialErosion} hydraulic=${msg._params.hydraulicErosion} thermal=${msg._params.thermalErosion} ridge=${msg._params.ridgeSharpening}`);
                }
                console.log(`  Regions: ${mesh.numRegions.toLocaleString()}  Triangles: ${mesh.numTriangles.toLocaleString()}  Sides: ${mesh.numSides.toLocaleString()}`);

                // Worker pipeline stages
                if (msg._pipelineTiming) {
                    console.groupCollapsed('  %cWorker pipeline stages', 'color:#8cf');
                    console.table(msg._pipelineTiming.map(r => ({ Stage: r.stage, 'ms': f(r.ms) })));
                    console.groupEnd();
                }

                // Elevation sub-stages
                if (msg._timing) {
                    console.groupCollapsed('  %cElevation sub-stages', 'color:#fc8');
                    console.table(msg._timing.map(r => ({ Stage: r.stage, 'ms': f(r.ms) })));
                    console.groupEnd();
                }

                // Post-processing sub-stages
                if (msg._postTiming && msg._postTiming.length > 0) {
                    console.groupCollapsed('  %cPost-processing sub-stages', 'color:#8f8');
                    console.table(msg._postTiming.map(r => ({ Stage: r.stage, 'ms': f(r.ms) })));
                    console.groupEnd();
                }

                // Summary
                const tWorker = msg._workerTotal || 0;
                const tTransfer = tTotal - tWorker - tMainTotal;
                console.log(
                    `  %cSummary:%c Worker: ${f(tWorker)} ms | Transfer: ${f(tTransfer)} ms | Main thread: ${f(tMainTotal)} ms (reconstruct=${f(tRecon)}, colors=${f(tColors)}, state=${f(tState)}, buildMesh=${f(tBuild)}) | TOTAL: ${f(tTotal)} ms`,
                    'color:#ff6;font-weight:bold', ''
                );

                const ms = tTotal.toFixed(0);
                document.getElementById('stats').innerHTML =
                    `Regions: ${mesh.numRegions.toLocaleString()}<br>` +
                    `Triangles: ${mesh.numTriangles.toLocaleString()}<br>` +
                    `Generated in ${ms} ms<br>` +
                    `<span style="color:#445;font-size:10px">worker ${tWorker.toFixed(0)} · render ${tBuild.toFixed(0)}</span>`;

                if (_onProgress) _onProgress(100, 'Done');
                resetUI();
                document.getElementById('generate').dispatchEvent(new CustomEvent('generate-done'));
                if (_onDone) { _onDone(); _onDone = null; }
                break;
            }

            case 'reapplyDone': {
                const tMainStart = performance.now();
                state.climateComputed = !msg.skipClimate;
                const d = state.curData;
                d.r_elevation = msg.r_elevation;
                d.t_elevation = msg.t_elevation;
                d.debugLayers.erosionDelta = msg.erosionDelta;
                if (msg.flowAccum) d.debugLayers.flowAccum = msg.flowAccum;
                if (msg.riverPath) d.debugLayers.riverPath = msg.riverPath;
                if (msg.r_wind_east_summer) {
                    d.r_wind_east_summer = msg.r_wind_east_summer;
                    d.r_wind_north_summer = msg.r_wind_north_summer;
                    d.r_wind_east_winter = msg.r_wind_east_winter;
                    d.r_wind_north_winter = msg.r_wind_north_winter;
                }
                if (msg.itczLons) {
                    d.itczLons = msg.itczLons;
                    d.itczLatsSummer = msg.itczLatsSummer;
                    d.itczLatsWinter = msg.itczLatsWinter;
                }
                if (msg.r_ocean_current_east_summer) {
                    d.r_ocean_current_east_summer = msg.r_ocean_current_east_summer;
                    d.r_ocean_current_north_summer = msg.r_ocean_current_north_summer;
                    d.r_ocean_current_east_winter = msg.r_ocean_current_east_winter;
                    d.r_ocean_current_north_winter = msg.r_ocean_current_north_winter;
                    d.r_ocean_speed_summer = msg.r_ocean_speed_summer;
                    d.r_ocean_speed_winter = msg.r_ocean_speed_winter;
                    d.r_ocean_warmth_summer = msg.r_ocean_warmth_summer;
                    d.r_ocean_warmth_winter = msg.r_ocean_warmth_winter;
                }
                if (msg.r_precip_summer) {
                    d.r_precip_summer = msg.r_precip_summer;
                    d.r_precip_winter = msg.r_precip_winter;
                }
                if (msg.r_temperature_summer) {
                    d.r_temperature_summer = msg.r_temperature_summer;
                    d.r_temperature_winter = msg.r_temperature_winter;
                }
                if (msg.windDebugLayers) {
                    Object.assign(d.debugLayers, msg.windDebugLayers);
                }
                if (msg.resourceDebugLayers) {
                    Object.assign(d.debugLayers, msg.resourceDebugLayers);
                }
                applyClimateFallback(d, msg.skipClimate);

                const tBuildStart = performance.now();
                buildMesh();
                const tBuild = performance.now() - tBuildStart;

                const tMainTotal = performance.now() - tMainStart;

                const f = v => typeof v === 'number' ? v.toFixed(1) : v;
                const rt = msg._reapplyTiming || {};
                console.log(`%c[World Orogen] Reapply complete`, 'color:#8f8;font-weight:bold');
                if (msg._postTiming && msg._postTiming.length > 0) {
                    console.groupCollapsed('  %cPost-processing sub-stages', 'color:#8f8');
                    console.table(msg._postTiming.map(r => ({ Stage: r.stage, 'ms': f(r.ms) })));
                    console.groupEnd();
                }
                console.log(
                    `  %cSummary:%c Worker: ${f(rt.workerTotal || 0)} ms (clone=${f(rt.clone || 0)}, postProcess=${f(rt.postProcessing || 0)}, triElev=${f(rt.triangleElevations || 0)}) | Main: ${f(tMainTotal)} ms (buildMesh=${f(tBuild)})`,
                    'color:#ff6;font-weight:bold', ''
                );

                if (_onProgress) _onProgress(100, 'Done');
                if (_onDone) { _onDone(); _onDone = null; }
                break;
            }

            case 'editDone': {
                const tMainStart = performance.now();
                state.climateComputed = !msg.skipClimate;
                const d = state.curData;
                d.prePostElev = msg.prePostElev;
                d.r_elevation = msg.r_elevation;
                d.t_elevation = msg.t_elevation;
                d.mountain_r = new Set(msg.mountain_r);
                d.coastline_r = new Set(msg.coastline_r);
                d.ocean_r = new Set(msg.ocean_r);
                d.r_stress = msg.r_stress;
                if (msg.r_wind_east_summer) {
                    d.r_wind_east_summer = msg.r_wind_east_summer;
                    d.r_wind_north_summer = msg.r_wind_north_summer;
                    d.r_wind_east_winter = msg.r_wind_east_winter;
                    d.r_wind_north_winter = msg.r_wind_north_winter;
                }
                if (msg.itczLons) {
                    d.itczLons = msg.itczLons;
                    d.itczLatsSummer = msg.itczLatsSummer;
                    d.itczLatsWinter = msg.itczLatsWinter;
                }
                if (msg.r_ocean_current_east_summer) {
                    d.r_ocean_current_east_summer = msg.r_ocean_current_east_summer;
                    d.r_ocean_current_north_summer = msg.r_ocean_current_north_summer;
                    d.r_ocean_current_east_winter = msg.r_ocean_current_east_winter;
                    d.r_ocean_current_north_winter = msg.r_ocean_current_north_winter;
                    d.r_ocean_speed_summer = msg.r_ocean_speed_summer;
                    d.r_ocean_speed_winter = msg.r_ocean_speed_winter;
                    d.r_ocean_warmth_summer = msg.r_ocean_warmth_summer;
                    d.r_ocean_warmth_winter = msg.r_ocean_warmth_winter;
                }
                if (msg.r_precip_summer) {
                    d.r_precip_summer = msg.r_precip_summer;
                    d.r_precip_winter = msg.r_precip_winter;
                }
                if (msg.r_temperature_summer) {
                    d.r_temperature_summer = msg.r_temperature_summer;
                    d.r_temperature_winter = msg.r_temperature_winter;
                }
                d.debugLayers = msg.debugLayers;
                applyClimateFallback(d, msg.skipClimate);

                const tColorsStart = performance.now();
                computePlateColors(d.plateSeeds, d.plateIsOcean);
                const tColors = performance.now() - tColorsStart;

                const tBuildStart = performance.now();
                buildMesh();
                const tBuild = performance.now() - tBuildStart;

                const tMainTotal = performance.now() - tMainStart;

                const f = v => typeof v === 'number' ? v.toFixed(1) : v;
                const et = msg._editTiming || {};
                console.log(`%c[World Orogen] Edit recompute complete`, 'color:#fc8;font-weight:bold');

                if (msg._timing) {
                    console.groupCollapsed('  %cElevation sub-stages', 'color:#fc8');
                    console.table(msg._timing.map(r => ({ Stage: r.stage, 'ms': f(r.ms) })));
                    console.groupEnd();
                }
                if (msg._postTiming && msg._postTiming.length > 0) {
                    console.groupCollapsed('  %cPost-processing sub-stages', 'color:#8f8');
                    console.table(msg._postTiming.map(r => ({ Stage: r.stage, 'ms': f(r.ms) })));
                    console.groupEnd();
                }
                console.log(
                    `  %cSummary:%c Worker: ${f(et.workerTotal || 0)} ms (elevation=${f(et.elevation || 0)}, postProcess=${f(et.postProcessing || 0)}, triElev=${f(et.triangleElevations || 0)}, retain=${f(et.retainState || 0)}) | Main: ${f(tMainTotal)} ms (colors=${f(tColors)}, buildMesh=${f(tBuild)})`,
                    'color:#ff6;font-weight:bold', ''
                );

                if (_onProgress) _onProgress(100, 'Done');
                if (_onDone) { _onDone(); _onDone = null; }
                break;
            }

            case 'climateDone': {
                const d = state.curData;
                if (d) {
                    // Copy all climate arrays
                    d.r_wind_east_summer = msg.r_wind_east_summer;
                    d.r_wind_north_summer = msg.r_wind_north_summer;
                    d.r_wind_east_winter = msg.r_wind_east_winter;
                    d.r_wind_north_winter = msg.r_wind_north_winter;
                    d.itczLons = msg.itczLons;
                    d.itczLatsSummer = msg.itczLatsSummer;
                    d.itczLatsWinter = msg.itczLatsWinter;
                    d.r_ocean_current_east_summer = msg.r_ocean_current_east_summer;
                    d.r_ocean_current_north_summer = msg.r_ocean_current_north_summer;
                    d.r_ocean_current_east_winter = msg.r_ocean_current_east_winter;
                    d.r_ocean_current_north_winter = msg.r_ocean_current_north_winter;
                    d.r_ocean_speed_summer = msg.r_ocean_speed_summer;
                    d.r_ocean_speed_winter = msg.r_ocean_speed_winter;
                    d.r_ocean_warmth_summer = msg.r_ocean_warmth_summer;
                    d.r_ocean_warmth_winter = msg.r_ocean_warmth_winter;
                    d.r_precip_summer = msg.r_precip_summer;
                    d.r_precip_winter = msg.r_precip_winter;
                    d.r_temperature_summer = msg.r_temperature_summer;
                    d.r_temperature_winter = msg.r_temperature_winter;
                    // Merge climate debug layers
                    if (msg.climateDebugLayers && d.debugLayers) {
                        Object.assign(d.debugLayers, msg.climateDebugLayers);
                        // Planetary layers (hydroState, habitability) depend on climate and
                        // are not computed by the worker — compute them here on the main thread.
                        try {
                            const planetary = computePlanetaryDebugLayers(d, state.planetaryParams);
                            d.debugLayers.hydroState    = planetary.r_hydro_state;
                            d.debugLayers.habitability  = planetary.r_habitability;
                            d.debugLayers.permanentIce  = planetary.r_permanentIce;
                            d.debugLayers.seasonalIce   = planetary.r_seasonalIce;
                        } catch (e) {
                            console.warn('[generate.js] Planetary debug layers failed (climateDone):', e);
                        }
                    }
                }
                state.climateComputed = true;
                buildMesh();

                const f = v => typeof v === 'number' ? v.toFixed(1) : v;
                const ct = msg._climateTiming || {};
                console.log(`%c[World Orogen] Climate computed on demand`, 'color:#f8a;font-weight:bold');
                console.log(
                    `  %cSummary:%c Worker: ${f(ct.workerTotal || 0)} ms (wind=${f(ct.wind || 0)}, ocean=${f(ct.ocean || 0)}, precip=${f(ct.precipitation || 0)}, temp=${f(ct.temperature || 0)}, koppen=${f(ct.koppen || 0)})`,
                    'color:#ff6;font-weight:bold', ''
                );

                if (_onProgress) _onProgress(100, 'Done');
                if (_onDone) { _onDone(); _onDone = null; }
                break;
            }

            case 'error':
                fail(msg.message);
                if (_onDone) { _onDone(); _onDone = null; }
                break;
        }
    };

    worker.onerror = (e) => {
        fail(e.message || 'Worker crashed');
        if (_onDone) { _onDone(); _onDone = null; }
    };
}

// --- Synchronous fallback (imported lazily to avoid loading when worker works) ---
let _fallbackModules = null;
async function loadFallback() {
    if (_fallbackModules) return _fallbackModules;
    const [rng, simplex, sphere, plates, ocean, elev, post, wind, oceanCurrents, precip, temp, coarsePlates] = await Promise.all([
        import('./core/rng.js'),
        import('./core/simplex-noise.js'),
        import('./sim/sphere-mesh.js'),
        import('./sim/plates.js'),
        import('./sim/ocean-land.js'),
        import('./sim/elevation.js'),
        import('./sim/terrain-post.js'),
        import('./sim/wind.js'),
        import('./sim/ocean.js'),
        import('./sim/precipitation.js'),
        import('./sim/temperature.js'),
        import('./sim/coarse-plates.js')
    ]);
    _fallbackModules = { rng, simplex, sphere, plates, ocean, elev, post, wind, oceanCurrents, precip, temp, coarsePlates };
    return _fallbackModules;
}

function generateFallback(overrideSeed, toggledIndices, onProgress, skipClimate) {
    // Dynamic import already resolved — run synchronously via rAF stages
    const m = _fallbackModules;
    const btn = document.getElementById('generate');
    const N = detailFromSlider(+document.getElementById('sN').value);
    const P = +document.getElementById('sP').value;
    const jitter = +document.getElementById('sJ').value;
    const nMag = +document.getElementById('sNs').value;
    const numContinents = +document.getElementById('sCn').value;
    const terrainWarp = +document.getElementById('sTw').value;
    const smoothing = +document.getElementById('sS').value;
    const hydraulicErosion = +document.getElementById('sHEr').value;
    const thermalErosion = +document.getElementById('sTEr').value;
    const ridgeSharpening = +document.getElementById('sRs').value;
    const glacialErosion = +document.getElementById('sGl').value;
    // Planetary physics sliders needed for oceanFraction
    const _hydro = +(document.getElementById('sHydro')?.value ?? 3);
    const _hydroToFrac = [0, 0.05, 0.25, 0.70, 0.80, 0.95];
    const _oceanFraction = _hydroToFrac[_hydro] ?? 0.70;
    const progress = onProgress || (() => {});
    const ctx = {};

    const stages = [
        { pct: 0, label: 'Shaping the world\u2026', work() {
            ctx.seed = overrideSeed ?? Math.floor(Math.random() * 16777216);
            ctx.rng = m.rng.makeRng(ctx.seed);
            const { mesh, r_xyz } = m.sphere.buildSphere(N, jitter, ctx.rng);
            ctx.mesh = mesh; ctx.r_xyz = r_xyz;
            ctx.t_xyz = m.sphere.generateTriangleCenters(mesh, r_xyz);
        }},
        { pct: 10, label: 'Generating coarse plates\u2026', work() {
            const { coarseMesh, coarse_xyz, coarse_r_plate, coarsePlateSeeds, coarsePlateVec, coarsePlateIsOcean } =
                m.coarsePlates.generateCoarsePlates(ctx.seed, P, numContinents, _oceanFraction);
            ctx.coarseMesh = coarseMesh; ctx.coarse_xyz = coarse_xyz;
            ctx.coarse_r_plate = coarse_r_plate;
            ctx.plateSeeds = coarsePlateSeeds; ctx.plateVec = coarsePlateVec;
            ctx.coarsePlateIsOcean = coarsePlateIsOcean;
        }},
        { pct: 18, label: 'Projecting plates\u2026', work() {
            ctx.r_plate = m.coarsePlates.projectCoarsePlates(ctx.mesh, ctx.r_xyz, ctx.coarseMesh, ctx.coarse_xyz, ctx.coarse_r_plate, ctx.seed);
            m.plates.smoothAndReconnectPlates(ctx.mesh, ctx.r_plate, ctx.plateSeeds, 3);
        }},
        { pct: 25, label: 'Carving oceans\u2026', work() {
            const plateIsOcean = ctx.coarsePlateIsOcean;
            ctx.originalPlateIsOcean = new Set(plateIsOcean);
            if (toggledIndices.length > 0) {
                const seedArr = Array.from(ctx.plateSeeds);
                for (const i of toggledIndices) {
                    if (i < seedArr.length) {
                        const r = seedArr[i];
                        if (plateIsOcean.has(r)) plateIsOcean.delete(r);
                        else plateIsOcean.add(r);
                    }
                }
            }
            computePlateColors(ctx.plateSeeds, plateIsOcean);
            const plateDensity = {}, plateDensityLand = {}, plateDensityOcean = {};
            for (const r of ctx.plateSeeds) {
                const drng = m.rng.makeRng(r + 777);
                plateDensityOcean[r] = 3.0 + drng() * 0.5;
                plateDensityLand[r] = 2.4 + drng() * 0.5;
                plateDensity[r] = plateIsOcean.has(r) ? plateDensityOcean[r] : plateDensityLand[r];
            }
            ctx.plateIsOcean = plateIsOcean; ctx.plateDensity = plateDensity;
            ctx.plateDensityLand = plateDensityLand; ctx.plateDensityOcean = plateDensityOcean;
            ctx.noise = new m.simplex.SimplexNoise(ctx.seed);
        }},
        { pct: 35, label: 'Raising mountains\u2026', work() {
            const { r_elevation, mountain_r, coastline_r, ocean_r, r_stress, debugLayers, _timing } =
                m.elev.assignElevation(ctx.mesh, ctx.r_xyz, ctx.plateIsOcean, ctx.r_plate, ctx.plateVec, ctx.plateSeeds, ctx.noise, nMag, ctx.seed, 5, ctx.plateDensity);
            ctx.r_elevation = r_elevation; ctx.mountain_r = mountain_r; ctx.coastline_r = coastline_r;
            ctx.ocean_r = ocean_r; ctx.r_stress = r_stress; ctx.debugLayers = debugLayers;
            ctx.prePostElev = new Float32Array(r_elevation);
            if (terrainWarp > 0) m.post.warpTerrain(ctx.mesh, r_elevation, ctx.r_xyz, ctx.seed, terrainWarp);
            const r_isOcean = new Uint8Array(ctx.mesh.numRegions);
            for (let r = 0; r < ctx.mesh.numRegions; r++) { if (r_elevation[r] <= 0) r_isOcean[r] = 1; }
            const preErosion = new Float32Array(r_elevation);
            if (smoothing > 0) m.post.smoothElevation(ctx.mesh, r_elevation, r_isOcean, Math.round(1 + smoothing * 4), 0.2 + smoothing * 0.5);
            if (glacialErosion > 0 || hydraulicErosion > 0 || thermalErosion > 0)
                m.post.erodeComposite(ctx.mesh, r_elevation, ctx.r_xyz, r_isOcean, Math.round(hydraulicErosion * 20), hydraulicErosion * 0.001, 0.5, 1.0, Math.round(thermalErosion * 10), 1.2 - thermalErosion * 0.4, thermalErosion * 0.15, Math.round(glacialErosion * 10), glacialErosion);
            if (ridgeSharpening > 0) m.post.sharpenRidges(ctx.mesh, r_elevation, r_isOcean, Math.round(1 + ridgeSharpening * 3), ridgeSharpening * 0.08);
            m.post.applySoilCreep(ctx.mesh, r_elevation, r_isOcean, 3, 0.1125);
            m.post.applyHypsometricCorrection(ctx.mesh, r_elevation, r_isOcean);
            const dl_erosionDelta = new Float32Array(ctx.mesh.numRegions);
            for (let r = 0; r < ctx.mesh.numRegions; r++) dl_erosionDelta[r] = r_elevation[r] - preErosion[r];
            debugLayers.erosionDelta = dl_erosionDelta;
            const { r_flow: _flow, r_riverPath: _rp } = m.post.computeFlowAccumulation(ctx.mesh, r_elevation);
            debugLayers.flowAccum = _flow;
            debugLayers.riverPath = _rp;
            if (!skipClimate) {
                const windResult = m.wind.computeWind(ctx.mesh, ctx.r_xyz, r_elevation, ctx.plateIsOcean, ctx.r_plate, ctx.noise);
                debugLayers.pressureSummer = windResult.r_pressure_summer;
                debugLayers.pressureWinter = windResult.r_pressure_winter;
                debugLayers.windSpeedSummer = windResult.r_wind_speed_summer;
                debugLayers.windSpeedWinter = windResult.r_wind_speed_winter;
                ctx.windResult = windResult;
                const oceanResult = m.oceanCurrents.computeOceanCurrents(ctx.mesh, ctx.r_xyz, r_elevation, windResult);
                ctx.oceanResult = oceanResult;
                const precipResult = m.precip.computePrecipitation(ctx.mesh, ctx.r_xyz, r_elevation, windResult, oceanResult);
                ctx.precipResult = precipResult;
                debugLayers.precipSummer = precipResult.r_precip_summer;
                debugLayers.precipWinter = precipResult.r_precip_winter;
                debugLayers.rainShadowSummer = precipResult.r_rainshadow_summer;
                debugLayers.rainShadowWinter = precipResult.r_rainshadow_winter;
                const tempResult = m.temp.computeTemperature(ctx.mesh, ctx.r_xyz, r_elevation, windResult, oceanResult, precipResult);
                ctx.tempResult = tempResult;
                debugLayers.tempSummer = tempResult.r_temperature_summer;
                debugLayers.tempWinter = tempResult.r_temperature_winter;
                debugLayers.koppen = classifyKoppen(ctx.mesh, r_elevation, tempResult, precipResult);
                // Planetary inspection layers
                try {
                    const curDataProxy = { mesh: ctx.mesh, r_elevation,
                                          r_temperature_summer: tempResult.r_temperature_summer,
                                          r_temperature_winter: tempResult.r_temperature_winter,
                                          r_precip_summer: precipResult.r_precip_summer, r_precip_winter: precipResult.r_precip_winter };
                    const planetary = computePlanetaryDebugLayers(curDataProxy, state.planetaryParams);
                    debugLayers.hydroState    = planetary.r_hydro_state;
                    debugLayers.habitability  = planetary.r_habitability;
                    debugLayers.permanentIce  = planetary.r_permanentIce;
                    debugLayers.seasonalIce   = planetary.r_seasonalIce;
                } catch (e) {
                    console.warn('[generate.js] Planetary debug layers failed (sync):', e);
                }
            }
            const t_elevation = new Float32Array(ctx.mesh.numTriangles);
            for (let t = 0; t < ctx.mesh.numTriangles; t++) {
                const s0 = 3 * t;
                const a = ctx.mesh.s_begin_r(s0), b = ctx.mesh.s_begin_r(s0+1), c = ctx.mesh.s_begin_r(s0+2);
                t_elevation[t] = (r_elevation[a] + r_elevation[b] + r_elevation[c]) / 3;
            }
            ctx.t_elevation = t_elevation;
        }},
        { pct: 85, label: 'Painting the surface\u2026', work() {
            state.curData = {
                mesh: ctx.mesh, r_xyz: ctx.r_xyz, t_xyz: ctx.t_xyz,
                r_plate: ctx.r_plate, plateSeeds: ctx.plateSeeds, plateVec: ctx.plateVec,
                plateIsOcean: ctx.plateIsOcean, originalPlateIsOcean: ctx.originalPlateIsOcean,
                plateDensity: ctx.plateDensity, plateDensityLand: ctx.plateDensityLand,
                plateDensityOcean: ctx.plateDensityOcean, prePostElev: ctx.prePostElev,
                r_elevation: ctx.r_elevation, t_elevation: ctx.t_elevation,
                mountain_r: ctx.mountain_r, coastline_r: ctx.coastline_r, ocean_r: ctx.ocean_r,
                r_stress: ctx.r_stress, noise: ctx.noise, seed: ctx.seed, debugLayers: ctx.debugLayers,
                r_wind_east_summer: ctx.windResult ? ctx.windResult.r_wind_east_summer : null,
                r_wind_north_summer: ctx.windResult ? ctx.windResult.r_wind_north_summer : null,
                r_wind_east_winter: ctx.windResult ? ctx.windResult.r_wind_east_winter : null,
                r_wind_north_winter: ctx.windResult ? ctx.windResult.r_wind_north_winter : null,
                itczLons: ctx.windResult ? ctx.windResult.itczLons : null,
                itczLatsSummer: ctx.windResult ? ctx.windResult.itczLatsSummer : null,
                itczLatsWinter: ctx.windResult ? ctx.windResult.itczLatsWinter : null,
                r_ocean_current_east_summer: ctx.oceanResult ? ctx.oceanResult.r_ocean_current_east_summer : null,
                r_ocean_current_north_summer: ctx.oceanResult ? ctx.oceanResult.r_ocean_current_north_summer : null,
                r_ocean_current_east_winter: ctx.oceanResult ? ctx.oceanResult.r_ocean_current_east_winter : null,
                r_ocean_current_north_winter: ctx.oceanResult ? ctx.oceanResult.r_ocean_current_north_winter : null,
                r_ocean_speed_summer: ctx.oceanResult ? ctx.oceanResult.r_ocean_speed_summer : null,
                r_ocean_speed_winter: ctx.oceanResult ? ctx.oceanResult.r_ocean_speed_winter : null,
                r_ocean_warmth_summer: ctx.oceanResult ? ctx.oceanResult.r_ocean_warmth_summer : null,
                r_ocean_warmth_winter: ctx.oceanResult ? ctx.oceanResult.r_ocean_warmth_winter : null,
                r_precip_summer: ctx.precipResult ? ctx.precipResult.r_precip_summer : null,
                r_precip_winter: ctx.precipResult ? ctx.precipResult.r_precip_winter : null,
                r_temperature_summer: ctx.tempResult ? ctx.tempResult.r_temperature_summer : null,
                r_temperature_winter: ctx.tempResult ? ctx.tempResult.r_temperature_winter : null
            };
            state.climateComputed = !skipClimate;
            buildMesh();
            progress(100, 'Done');
            resetUI();
            btn.dispatchEvent(new CustomEvent('generate-done'));
        }}
    ];

    function runStage(idx) {
        if (idx >= stages.length) return;
        const s = stages[idx];
        try { progress(s.pct, s.label); } catch (e) { fail(e); return; }
        requestAnimationFrame(() => setTimeout(() => {
            try { s.work(); runStage(idx + 1); } catch (e) { fail(e); }
        }, 0));
    }
    setTimeout(() => runStage(0), 0);
}

// --- Public API ---

export function generate(overrideSeed, toggledIndices = [], onProgress, skipClimate = false) {
    const btn = document.getElementById('generate');
    btn.disabled = true;
    btn.textContent = 'Building\u2026';
    btn.classList.add('generating');

    _onProgress = onProgress || (() => {});
    _t0 = performance.now();

    if (!worker) {
        // Fallback: load modules then run synchronously
        loadFallback().then(() => generateFallback(overrideSeed, toggledIndices, onProgress, skipClimate));
        return;
    }

    const N = detailFromSlider(+document.getElementById('sN').value);
    const P = +document.getElementById('sP').value;
    const jitter = +document.getElementById('sJ').value;
    const nMag = +document.getElementById('sNs').value;
    const numContinents = +document.getElementById('sCn').value;
    const terrainWarp = +document.getElementById('sTw').value;
    const smoothing = +document.getElementById('sS').value;
    const hydraulicErosion = +document.getElementById('sHEr').value;
    const thermalErosion = +document.getElementById('sTEr').value;
    const ridgeSharpening = +document.getElementById('sRs').value;
    const glacialErosion = +document.getElementById('sGl').value;
    const gravity     = +(document.getElementById('sGravity')?.value  ?? 1.0);
    const worldSize   = +(document.getElementById('sWorldSize')?.value ?? 1.0);
    const atmosphere  = +(document.getElementById('sAtm')?.value      ?? 3);
    const hydrosphere = +(document.getElementById('sHydro')?.value    ?? 3);
    const baseTemp    = +(document.getElementById('sBaseTemp')?.value  ?? 15);
    const axialTilt   = +(document.getElementById('sTilt')?.value     ?? 23);

    worker.postMessage({
        cmd: 'generate',
        N, P, jitter, nMag, numContinents,
        terrainWarp, smoothing, hydraulicErosion, thermalErosion, ridgeSharpening, glacialErosion,
        gravity, worldSize, atmosphere, hydrosphere, baseTemp, axialTilt,
        seed: overrideSeed,
        toggledIndices,
        skipClimate
    });
}

export function reapplyViaWorker(onDone, skipClimate = false) {
    if (!worker || !state.curData) return;

    _onProgress = (pct, label) => {
        // Progress updates during reapply (used by build overlay if shown)
    };
    _onDone = onDone || null;
    _t0 = performance.now();

    worker.postMessage({
        cmd: 'reapply',
        terrainWarp: +document.getElementById('sTw').value,
        smoothing: +document.getElementById('sS').value,
        glacialErosion: +document.getElementById('sGl').value,
        hydraulicErosion: +document.getElementById('sHEr').value,
        thermalErosion: +document.getElementById('sTEr').value,
        ridgeSharpening: +document.getElementById('sRs').value,
        gravity:     +(document.getElementById('sGravity')?.value  ?? 1.0),
        worldSize:   +(document.getElementById('sWorldSize')?.value ?? 1.0),
        atmosphere:  +(document.getElementById('sAtm')?.value      ?? 3),
        hydrosphere: +(document.getElementById('sHydro')?.value    ?? 3),
        baseTemp:    +(document.getElementById('sBaseTemp')?.value  ?? 15),
        axialTilt:   +(document.getElementById('sTilt')?.value     ?? 23),
        skipClimate
    });
}

export function editRecomputeViaWorker(onDone, skipClimate = false) {
    if (!worker || !state.curData) return;

    const d = state.curData;
    _onProgress = () => {};
    _onDone = onDone || null;
    _t0 = performance.now();

    worker.postMessage({
        cmd: 'editRecompute',
        plateIsOcean: Array.from(d.plateIsOcean),
        plateDensity: d.plateDensity,
        nMag: +document.getElementById('sNs').value,
        terrainWarp: +document.getElementById('sTw').value,
        smoothing: +document.getElementById('sS').value,
        glacialErosion: +document.getElementById('sGl').value,
        hydraulicErosion: +document.getElementById('sHEr').value,
        thermalErosion: +document.getElementById('sTEr').value,
        ridgeSharpening: +document.getElementById('sRs').value,
        gravity:     +(document.getElementById('sGravity')?.value  ?? 1.0),
        worldSize:   +(document.getElementById('sWorldSize')?.value ?? 1.0),
        atmosphere:  +(document.getElementById('sAtm')?.value      ?? 3),
        hydrosphere: +(document.getElementById('sHydro')?.value    ?? 3),
        baseTemp:    +(document.getElementById('sBaseTemp')?.value  ?? 15),
        axialTilt:   +(document.getElementById('sTilt')?.value     ?? 23),
        skipClimate
    });
}

export function computeClimateViaWorker(onProgress, onDone) {
    if (!worker || !state.curData) return;
    _onProgress = onProgress || (() => {});
    _onDone = onDone || null;
    _t0 = performance.now();
    worker.postMessage({ cmd: 'computeClimate' });
}
