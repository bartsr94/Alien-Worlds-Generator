/**
 * Resource potential layer generation.
 *
 * Computes four per-region Float32Array maps (values in [0, 1]):
 *   food, water, metals, fuel
 *
 * When tempResult / precipResult are null (climate not yet computed), falls
 * back to a latitude + elevation + planetary-params heuristic so that resource
 * layers are always immediately available, even before climate is run.
 */

export const RESOURCE_TYPES  = ['food', 'water', 'metals', 'fuel'];
export const RESOURCE_LABELS = { food: 'Food', water: 'Water', metals: 'Metals', fuel: 'Fuel' };
export const RESOURCE_ICONS  = { food: '🌾', water: '💧', metals: '⛏', fuel: '⚡' };
export const RESOURCE_COLORS = { food: '#6aaa3a', water: '#4488cc', metals: '#aaaaaa', fuel: '#dd8833' };

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * @param {object}       mesh          SphereMesh
 * @param {Float32Array} r_xyz         Region XYZ unit-sphere positions, length 3*N
 * @param {Float32Array} r_elevation   Elevation in km (land > 0, ocean ≤ 0)
 * @param {Float32Array} r_stress      Tectonic stress field (0+)
 * @param {Set<number>}  mountain_r    Convergent-boundary cell indices
 * @param {object|null}  tempResult    { r_temperature_summer, r_temperature_winter,
 *                                       tempScaleMin, tempScaleMax } or null
 * @param {object|null}  precipResult  { r_precip_summer, r_precip_winter } or null
 * @param {object}       params        planetaryParams
 * @returns {{ r_resource_food, r_resource_water, r_resource_metals, r_resource_fuel }}
 */
export function computeResourceLayers(mesh, r_xyz, r_elevation, r_stress, mountain_r,
                                      tempResult, precipResult, params) {
    const N = mesh.numRegions;

    const r_resource_food   = new Float32Array(N);
    const r_resource_water  = new Float32Array(N);
    const r_resource_metals = new Float32Array(N);
    const r_resource_fuel   = new Float32Array(N);

    const atm     = params?.atmosphere  ?? 3;   // 0 = None … 5 = Crushing
    const hydro   = params?.hydrosphere ?? 3;   // 0 = None … 5 = Flooded
    const gravity = params?.gravity     ?? 1.0; // g
    const baseTemp = params?.baseTemp   ?? 15;  // °C

    // ── Climate decode helpers ────────────────────────────────────────────────
    const hasClimate = tempResult != null && precipResult != null;

    let getTemperatureAndPrecip; // (r) → { annualC, precipMm }

    if (hasClimate) {
        const tMin = tempResult.tempScaleMin ?? -45;
        const tMax = tempResult.tempScaleMax ??  45;
        const tRng = Math.max(1, tMax - tMin);
        const tS   = tempResult.r_temperature_summer;
        const tW   = tempResult.r_temperature_winter;
        const pS   = precipResult.r_precip_summer;
        const pW   = precipResult.r_precip_winter;

        getTemperatureAndPrecip = r => {
            const summerC  = tMin + clamp(tS[r], 0, 1) * tRng;
            const winterC  = tMin + clamp(tW[r], 0, 1) * tRng;
            const annualC  = (summerC + winterC) * 0.5;
            const precipMm = (clamp(pS[r], 0, 1) + clamp(pW[r], 0, 1)) * 500; // annual proxy
            return { annualC, precipMm };
        };
    } else {
        // Heuristic: latitude-based gradient anchored to base temperature
        getTemperatureAndPrecip = r => {
            const y      = r_xyz[r * 3 + 1]; // unit-sphere Y ≈ sin(lat)
            const latDeg = Math.asin(clamp(y, -1, 1)) * 180 / Math.PI;
            const absLat = Math.abs(latDeg);
            const annualC = baseTemp + 13 - (absLat / 90) * 55;

            // Zonal precipitation curve (mm): ITCZ wet → subtropical dry →
            //   mid-lat recovery → polar dry; land gets a continental penalty.
            let precipMm;
            if      (absLat < 10) precipMm = 1800;
            else if (absLat < 20) precipMm = 800 + (20 - absLat) * 100;
            else if (absLat < 30) precipMm = 350;
            else if (absLat < 45) precipMm = 350 + (absLat - 30) * 17;
            else if (absLat < 65) precipMm = 605 + (absLat - 45) * 10;
            else                  precipMm = 300;

            if (r_elevation[r] > 0) precipMm *= 0.7; // continental dryness
            return { annualC, precipMm };
        };
    }

    // ── Normalise r_stress to [0, 1] via 95th-percentile cut-off ─────────────
    //   (same approach as elevation.js to avoid a handful of extreme values)
    const stressVals = [];
    for (let r = 0; r < N; r++) {
        if (r_stress[r] > 0.01) stressVals.push(r_stress[r]);
    }
    stressVals.sort((a, b) => a - b);
    const p95       = stressVals[Math.floor(stressVals.length * 0.95)] || 1;
    const stressMax = Math.max(p95, 0.001);

    // High-gravity worlds have denser cores → richer metallic ore deposits
    const gravMetal = clamp(0.5 + 0.5 * gravity, 0.5, 2.0);

    // ── Per-region loop ───────────────────────────────────────────────────────
    for (let r = 0; r < N; r++) {
        const elev    = r_elevation[r];
        const isOcean = elev <= 0;
        const elevKm  = isOcean ? -elev : elev;   // absolute ≥ 0

        const { annualC, precipMm } = getTemperatureAndPrecip(r);

        // ── FOOD ─────────────────────────────────────────────────────────────
        // Land only; ocean tiles remain 0.
        if (!isOcean) {
            // Temperature: bell curve peaking at 22 °C, half-width ~20 °C
            const td        = annualC - 22;
            const tempScore = Math.exp(-td * td / 400);
            // Precipitation: linearly capped at 2000 mm
            const precipScore = clamp(precipMm / 2000, 0, 1);
            // Elevation: full productivity 0–0.3 km, drops to zero at 3 km
            const elevScore = clamp(1 - Math.max(0, elevKm - 0.3) / 2.7, 0, 1);
            // Atmosphere gate — photosynthesis requires air
            const atmGate   = atm === 0 ? 0 : clamp(atm / 5, 0.1, 1);

            r_resource_food[r] = clamp(tempScore * precipScore * elevScore * atmGate, 0, 1);
        }

        // ── WATER ─────────────────────────────────────────────────────────────
        if (isOcean) {
            // Ocean tiles: potential scales with liquid water presence
            const depthBonus = clamp(elevKm / 4, 0, 0.3);
            r_resource_water[r] = hydro >= 1 ? clamp(0.65 + depthBonus, 0, 1) : 0;
        } else {
            // Land: driven by precipitation, plus permafrost/ice bonus in the cold
            let val = clamp(precipMm / 2000, 0, 0.8);
            if (annualC < 0) val += clamp(-annualC / 80, 0, 0.25); // ice reserves
            if (atm === 0)   val  = Math.min(val, 0.1);            // airless: trace
            r_resource_water[r] = clamp(val, 0, 1);
        }

        // ── METALS ────────────────────────────────────────────────────────────
        // Tectonic stress is the primary ore driver: convergent boundaries
        // concentrate metallic ore deposits (subduction arcs, orogenic belts).
        const stressScore = clamp(r_stress[r] / stressMax, 0, 1);
        const mtnBonus    = mountain_r.has(r) ? 0.25 : 0;
        // Mid-elevation ore exposure (0.5–2 km sweet spot for erosion-exposed veins)
        const oreElev = isOcean ? 0 : clamp(elevKm / 2.5, 0, 1) *
                                      clamp(1 - Math.max(0, elevKm - 2) / 5, 0, 1);
        // Per-region cluster noise (Knuth multiplicative hash; resolution-invariant)
        const khash = ((r * 2654435761) >>> 0) / 4294967296;
        const noise = 0.7 + 0.3 * khash;

        r_resource_metals[r] = clamp(
            (stressScore * 0.55 + mtnBonus + oreElev * 0.10) * noise * gravMetal,
            0, 1
        );

        // ── FUEL ──────────────────────────────────────────────────────────────
        // Biotic component: organic accumulation → fossil fuels / biomass
        const foodScore = r_resource_food[r];
        const logPrecip = Math.log(precipMm + 1) / Math.log(3001);
        const bioScore  = isOcean ? 0 : foodScore * logPrecip;
        // Geothermal component: volcanic / tectonic heat
        const geoScore  = stressScore * 0.70 + (elevKm > 1.5 ? 0.20 : 0);
        // Hydrocarbon bonus for Titan-class thick atmospheres (atm ≥ 4)
        const hydrocarbon = atm >= 4 ? clamp((atm - 3) * 0.15, 0, 0.30) : 0;

        r_resource_fuel[r] = clamp(0.5 * bioScore + 0.5 * geoScore + hydrocarbon, 0, 1);
    }

    return { r_resource_food, r_resource_water, r_resource_metals, r_resource_fuel };
}
