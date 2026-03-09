// Planetary physics parameters — derives a unified params object from the five
// new planetary sliders (gravity, atmosphere, hydrosphere, baseTemp, axialTilt).
//
// All downstream pipeline modules accept a `params` argument.  During Phase 1
// the modules do not yet act on it; behavior changes land in Phase 2 and 3.
//
// Earth defaults produce values that match every current hardcoded constant:
//   gravity=1.0, atmosphere=3, hydrosphere=3, baseTemp=15, axialTilt=23.5

// ---------------------------------------------------------------------------
// Named atmosphere levels
// ---------------------------------------------------------------------------
export const ATM_LABELS  = ['None', 'Trace', 'Thin', 'Moderate', 'Thick', 'Crushing'];
export const HYDRO_LABELS = ['None', 'Trace', 'Partial', 'Moderate', 'High', 'Flooded'];

// ---------------------------------------------------------------------------
// Helper lookups  (index = atm / hydro level 0-5)
// ---------------------------------------------------------------------------

/** Normalised atmospheric density. Moderate (3) = 1.0 = Earth. */
function atmToDensity(atm) {
    return [0, 0.05, 0.20, 1.0, 1.80, 2.50][atm] ?? 1.0;
}

/**
 * Wind-intensity multiplier applied to the final wind vectors.
 * Moderate (3) = 1.0 = Earth. Crushing (5) is slow but powerful — modelled
 * here as a reduced multiplier (Venus-style uniform slow winds).
 */
function atmToWind(atm) {
    return [0, 0.20, 0.60, 1.0, 1.20, 0.40][atm] ?? 1.0;
}

/**
 * Precipitation output scale. Earth (atm=3, hydro=3) = 1.0.
 * Zero if either atmosphere or hydrosphere is absent.
 */
function atmToPrecip(atm, hydro) {
    if (atm === 0 || hydro === 0) return 0;
    const base = [0, 0.15, 0.50, 1.0, 1.40, 1.80][atm] ?? 1.0;
    return base * (hydro / 3);
}

/**
 * Greenhouse temperature bonus (°C) added on top of equatorialTempC.
 * Thin/Moderate atmosphere = 0°C. Meaningful at Thick and Crushing.
 */
function atmToGreenhouse(atm) {
    return [0, 0, 0, 0, 20, 400][atm] ?? 0;
}

/**
 * Atmosphere rim tint for the globe shader.
 * Returns an [r, g, b] tuple (0–1 range).
 */
function atmToTint(atm, preset) {
    if (preset === 'titan')  return [0.55, 0.40, 0.18]; // nitrogen-methane orange
    if (preset === 'venus')  return [0.92, 0.88, 0.60]; // sulphuric yellow-cream
    return [
        [0,    0,    0   ], // None  — black (no rim)
        [0.45, 0.40, 0.40], // Trace — faint grey
        [0.55, 0.70, 0.85], // Thin  — pale blue
        [0.35, 0.60, 1.00], // Moderate (Earth blue — matches current shader)
        [0.80, 0.60, 0.30], // Thick — orange-tan
        [0.95, 0.93, 0.72], // Crushing — yellow-white
    ][atm] ?? [0.35, 0.60, 1.00];
}

/**
 * Ocean coverage fraction (0–1).
 * Moderate (3) = 0.70 matches the current hardcoded 30% land target.
 */
function hydroToOceanFraction(hydro) {
    return [0, 0.05, 0.25, 0.70, 0.80, 0.95][hydro] ?? 0.70;
}

/** Surface fluid color for the water sphere: [r, g, b] (0–1). */
function hydrosphereFluidColor(sliders) {
    if (sliders.preset === 'titan') return [0.25, 0.20, 0.12]; // dark methane
    const hydro = sliders.hydrosphere;
    if (hydro === 0) return null; // hidden
    // Frozen / icy worlds: pale grey-blue
    if (sliders.baseTemp < -60) return [0.70, 0.80, 0.90];
    return [0.05, 0.14, 0.43]; // Earth ocean blue (matches current shader)
}

/** Atmosphere rim glow color based on preset + atm level. */
function atmosphereRimColor(sliders) {
    return atmToTint(sliders.atmosphere, sliders.preset ?? 'custom');
}

/**
 * Biome rendering mode string consumed by color-map.js.
 * Derived purely from slider values — not from the preset name — so that
 * custom slider configurations produce the correct palette even without a
 * named preset active.
 *
 * Decision tree:
 *   barren — no atmosphere (airless, cratered)
 *   arid   — no hydrosphere (dry rust/desert world)
 *   ice    — cold enough that all liquid water is frozen
 *   alien  — crushing-hot (Venus) or thick-cold cryo (Titan)
 *   earth  — everything else
 */
function deriveBiomeMode(sliders) {
    const { atmosphere: atm, hydrosphere: hydro, baseTemp: t } = sliders;
    if (atm  === 0) return 'barren';
    if (hydro === 0) return 'arid';
    if (t < -80)    return 'ice';
    // Crushing-hot: Venus-like — sulfuric yellow-cream, no green anywhere
    if (atm >= 5 && t > 200) return 'alien';
    // Thick-cold: Titan-like — methane seas, orange haze highlands
    if (atm >= 3 && t < -120) return 'alien';
    return 'earth';
}

/** Seasonal amplitude multiplier relative to Earth (tilt=23.5° → 1.0). */
function tiltToSeasonalAmplitude(tilt) {
    return tilt / 23.5;
}

/**
 * Opacity of the atmospheric haze sphere rendered on the globe (0 = clear, 1 = opaque).
 * Earth (atm=3) → 0 (no visible surface haze from orbit).
 * Crushing (atm=5) → 0.82 (Venus: surface almost completely obscured).
 * Cold + thick atmosphere (Titan-like) → 0.65 (deep orange haze blanket).
 */
function atmToHazeOpacity(atm, tempC) {
    const base = [0, 0.04, 0.12, 0, 0.38, 0.82][atm] ?? 0;
    // Titan-like override: very cold + thick atm = cryogenic haze layer
    if (atm >= 3 && tempC < -120) return Math.max(base, 0.65);
    return base;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the planetary parameters object from raw slider values.
 *
 * All five sliders are optional and default to Earth values so existing
 * call sites that don't yet pass them will continue to work identically.
 *
 * @param {object} sliders
 * @param {number} [sliders.gravity=1.0]     - Surface gravity in g (0.1–3.0)
 * @param {number} [sliders.atmosphere=3]    - Atmosphere level 0–5
 * @param {number} [sliders.hydrosphere=3]   - Hydrosphere level 0–5
 * @param {number} [sliders.baseTemp=15]     - Base surface temperature °C (-150–500)
 * @param {number} [sliders.axialTilt=23.5]  - Axial tilt in degrees (0–90)
 * @param {string} [sliders.preset='custom'] - Active preset name (runtime only)
 * @returns {object} Derived planetary parameters
 */
export function buildPlanetaryParams(sliders = {}) {
    const g    = sliders.gravity     ?? 1.0;
    const atm  = sliders.atmosphere  ?? 3;
    const hydro= sliders.hydrosphere ?? 3;
    const tempC= sliders.baseTemp    ?? 15;
    const tilt = sliders.axialTilt   ?? 23.5;
    const preset = sliders.preset    ?? 'custom';

    const greenhouseBonus   = atmToGreenhouse(atm);
    const atmosphereDensity = atmToDensity(atm);

    return {
        // ── Raw inputs ───────────────────────────────────────────────────────
        gravity:     g,
        atmosphere:  atm,
        hydrosphere: hydro,
        baseTemp:    tempC,
        axialTilt:   tilt,
        preset,

        // ── Elevation ────────────────────────────────────────────────────────
        // maxElevationKm: Everest-equivalent at 1g = 8.8 km
        maxElevationKm:    8.8 / g,
        // erosionIntensity: higher gravity accelerates erosion
        erosionIntensity:  Math.sqrt(g),
        // upliftMultiplier: higher gravity compresses terrain
        upliftMultiplier:  1 / g,

        // ── Atmosphere ───────────────────────────────────────────────────────
        atmosphereDensity,
        windIntensity:         atmToWind(atm),
        precipitationScale:    atmToPrecip(atm, hydro),
        greenhouseBonus,
        hasWeather:            atm >= 1 && hydro >= 1,
        atmosphereTint:        atmToTint(atm, preset),

        // ── Hydrosphere ──────────────────────────────────────────────────────
        oceanFraction:         hydroToOceanFraction(hydro),
        hasLiquidOcean:        hydro >= 1 && tempC > -80 && tempC < 200,
        hydraulicErosionScale: hydro / 3,
        glacialErosionScale:   hydro > 0 ? 1 : 0,
        hydrosphereFluid:      preset === 'titan' ? 'methane' : 'water',

        // ── Temperature ──────────────────────────────────────────────────────
        // equatorialTempC: the thermal-equatorial peak fed into temperature.js.
        // The +13°C offset represents Earth's equatorial-peak-over-global-mean.
        equatorialTempC:       tempC + 13 + greenhouseBonus,
        // tempRangeC: pole-to-equator temperature drop in the power-law curve.
        // At Moderate (density=1.0) this equals Earth's hardcoded 47°C range.
        // sqrt(1/density) keeps Earth exact (sqrt(1)=1) while preventing
        // runaway values on thin/trace atmospheres: Trace → ~210°C instead of 940°C.
        tempRangeC:            47 * Math.sqrt(atmosphereDensity > 0 ? 1 / atmosphereDensity : 1),
        seasonalAmplitude:     tiltToSeasonalAmplitude(tilt),

        // ── Visual ───────────────────────────────────────────────────────────
        surfaceFluidColor:     hydrosphereFluidColor(sliders),
        atmosphereRimColor:    atmosphereRimColor(sliders),
        biomeMode:             deriveBiomeMode(sliders),
        // Opacity of the inner haze sphere (0 = clear sky, 1 = fully opaque cloud deck)
        hazeOpacity:           atmToHazeOpacity(atm, tempC),
    };
}

/** Earth default params — useful as a fallback or in tests. */
export const EARTH_PARAMS = buildPlanetaryParams({
    gravity: 1.0, atmosphere: 3, hydrosphere: 3, baseTemp: 15, axialTilt: 23.5, preset: 'earth',
});
