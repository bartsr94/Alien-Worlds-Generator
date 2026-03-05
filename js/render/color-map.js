// Elevation → RGB colour mapping.

// Uplift multiplier for the current planet (1.0 = Earth default = 6 km cap).
// Higher values allow taller mountains on low-gravity worlds.
// Call setUpliftMult() with params.upliftMultiplier after each generation.
let _upliftMult = 1;
export function setUpliftMult(m) { _upliftMult = m > 0 ? m : 1; }

// Whether the current planet has a liquid ocean.
// When false, elevationToColor uses a dry rocky basin ramp instead of ocean blue.
let _hasLiquidOcean = true;
export function setHasLiquidOcean(v) { _hasLiquidOcean = !!v; }

// Base temperature (°C) for the current planet (default = Earth 15°C).
// Used to select palette sub-variants within alien/arid/barren/ice modes.
let _baseTemp = 15;
export function setBaseTemp(v) { _baseTemp = typeof v === 'number' ? v : 15; }

// Atmosphere level (0–5) for the current planet (default = Earth 3).
let _atmosphere = 3;
export function setAtmosphere(v) { _atmosphere = (typeof v === 'number' && v >= 0) ? v : 3; }

// Hydrosphere level (0–5) for the current planet (default = Earth 3).
let _hydrosphere = 3;
export function setHydrosphere(v) { _hydrosphere = (typeof v === 'number' && v >= 0) ? v : 3; }

// Convert raw mesh elevation (nonlinear, 0-~1 for land at 1g) to physical height
// in kilometres.  Smooth power curve: ramps slowly through lowlands,
// accelerates into highlands.  Scales with gravity — max is 6*upliftMult km.
// Ocean (elev < 0) is mapped with a linear scale (~5 km at -0.5).
export function elevToHeightKm(elev) {
    if (elev <= 0) return elev * 10;  // ocean: -0.5 → -5 km
    // Normalize by upliftMult so a 0.3g planet's peaks (~elev 3.3) map to ~20 km,
    // not the 6 km cap that applies at Earth (1g, upliftMult=1).
    const t = Math.min(elev / _upliftMult, 1);
    return 6 * _upliftMult * t * t;
}

// Biome base colors indexed by Köppen class ID (satellite-view palette).
// 0=Ocean delegated, 1-30 = land biomes.
const BIOME_COLORS = [
    null,                        //  0 Ocean — handled separately
    [0.05, 0.30, 0.05],         //  1 Af   Tropical rainforest — deep emerald
    [0.08, 0.33, 0.07],         //  2 Am   Tropical monsoon — dense green
    [0.42, 0.50, 0.18],         //  3 Aw   Tropical savanna — yellow-green
    [0.82, 0.72, 0.50],         //  4 BWh  Hot desert — sandy tan
    [0.60, 0.55, 0.48],         //  5 BWk  Cold desert — gray-brown
    [0.72, 0.62, 0.30],         //  6 BSh  Hot steppe — dry gold
    [0.55, 0.52, 0.32],         //  7 BSk  Cold steppe — muted olive-tan
    [0.18, 0.42, 0.12],         //  8 Cfa  Humid subtropical — mid green
    [0.12, 0.38, 0.10],         //  9 Cfb  Oceanic — rich green
    [0.10, 0.28, 0.10],         // 10 Cfc  Subpolar oceanic — dark muted green
    [0.45, 0.48, 0.22],         // 11 Csa  Hot-summer Mediterranean — khaki-green
    [0.40, 0.45, 0.20],         // 12 Csb  Warm-summer Mediterranean — chaparral
    [0.35, 0.40, 0.20],         // 13 Csc  Cold-summer Mediterranean — darker khaki
    [0.20, 0.44, 0.14],         // 14 Cwa  Humid subtropical monsoon — mid green
    [0.15, 0.40, 0.12],         // 15 Cwb  Subtropical highland — green
    [0.12, 0.32, 0.10],         // 16 Cwc  Cold subtropical highland — dark green
    [0.12, 0.36, 0.08],         // 17 Dfa  Hot-summer continental — forest green
    [0.10, 0.32, 0.08],         // 18 Dfb  Warm-summer continental — forest green
    [0.06, 0.22, 0.08],         // 19 Dfc  Subarctic — dark spruce green
    [0.05, 0.18, 0.07],         // 20 Dfd  Extremely cold subarctic — very dark
    [0.38, 0.38, 0.18],         // 21 Dsa  Hot-summer continental dry — olive-brown
    [0.35, 0.35, 0.17],         // 22 Dsb  Warm-summer continental dry — olive-brown
    [0.08, 0.22, 0.08],         // 23 Dsc  Subarctic dry summer — dark green
    [0.06, 0.18, 0.07],         // 24 Dsd  Extremely cold subarctic dry — very dark
    [0.14, 0.36, 0.10],         // 25 Dwa  Hot-summer continental monsoon — forest green
    [0.12, 0.32, 0.09],         // 26 Dwb  Warm-summer continental monsoon
    [0.07, 0.22, 0.08],         // 27 Dwc  Subarctic monsoon — dark spruce
    [0.05, 0.18, 0.07],         // 28 Dwd  Extremely cold subarctic monsoon
    [0.35, 0.32, 0.22],         // 29 ET   Tundra — earthy brown (sparse moss/lichen on rock)
    [0.78, 0.80, 0.84],         // 30 EF   Ice cap — blue-tinted white
    // Alien (X) zones — outside Earth's temperature envelope
    [0.60, 0.60, 0.70],         // 31 XD   Cryo-Desert — lavender-gray frozen wasteland
    [0.75, 0.86, 0.98],         // 32 XF   Deep Freeze — icy blue-white cryogenic world
    [0.22, 0.44, 0.28],         // 33 XP   Primordial — murky swamp-green hot+wet archean world
    [0.82, 0.28, 0.08],         // 34 XS   Scorched — burnt deep orange extreme heat, dry
    [0.46, 0.06, 0.04],         // 35 XV   Hellscape — dark crimson supercritical world
];

// Rocky/alpine mountain color for high-elevation blending.
const ROCK_COLOR = [0.42, 0.38, 0.32];

// Altitude thresholds (km) by Köppen group:
//   [alpine line, snow line]
// Alpine line: vegetation gives way to rocky alpine terrain.
// Snow line: permanent snow begins.
function altitudeThresholds(classId) {
    if (classId <= 0)  return [0, 0];           // Ocean
    if (classId <= 3)  return [3.5, 5.5];       // Tropical (A)
    if (classId <= 7)  return [3.0, 5.0];       // Arid (B)
    if (classId <= 16) return [2.0, 3.5];       // Temperate (C)
    if (classId <= 18 || classId === 21 || classId === 22 ||
        classId === 25 || classId === 26) return [1.5, 3.0];  // Continental humid (D*a, D*b)
    if (classId <= 28) return [0.8, 2.0];       // Subarctic (D*c, D*d)
    if (classId === 29) return [0.4, 1.5];      // Tundra (ET) — rocky higher up, snow only at peaks
    if (classId === 30) return [0.0, 0.5];       // Ice cap (EF)
    if (classId === 31) return [1.0, 2.5];       // Cryo-Desert (XD) — dry cold, snow at moderate altitude
    if (classId === 32) return [0.0, 0.1];       // Deep Freeze (XF) — permanent ice everywhere
    if (classId === 33) return [2.5, 99.0];      // Primordial (XP) — hot+wet, snow only at extreme altitude
    if (classId >= 34)  return [4.0, 99.0];      // Scorched / Hellscape (XS, XV) — no snow possible
    return [0, 0.5];                             // fallback
}

// ---------------------------------------------------------------------------
// Earth biome color (original satellite-view palette)
// ---------------------------------------------------------------------------

function earthBiomeColor(koppenId, elevation) {
    // Ocean
    if (koppenId === 0 || elevation <= 0) return elevationToColor(elevation);

    const base = BIOME_COLORS[koppenId] || [0.30, 0.50, 0.20];
    const hKm = elevToHeightKm(elevation);
    const [alpineLine, snowLine] = altitudeThresholds(koppenId);

    let r = base[0], g = base[1], b = base[2];

    // Low-elevation subtle darkening for depth (0-200m)
    if (hKm < 0.2) {
        const dark = 0.93 + 0.07 * (hKm / 0.2);
        r *= dark; g *= dark; b *= dark;
    }

    // Mid-elevation: gentle darkening to show terrain relief (200m to alpine line)
    if (alpineLine > 0 && hKm > 0.2 && hKm < alpineLine) {
        const t = (hKm - 0.2) / (alpineLine - 0.2);
        const darken = 1.0 - t * 0.15; // up to 15% darker at alpine line
        r *= darken; g *= darken; b *= darken;
    }

    // Alpine zone: blend toward rocky brown-gray above the tree/vegetation line
    if (alpineLine > 0 && hKm > alpineLine) {
        const rockZone = snowLine > alpineLine ? snowLine - alpineLine : 2.0;
        const rockT = Math.min(1, (hKm - alpineLine) / rockZone);
        const s = rockT * rockT; // ease-in for gradual transition
        r = r + (ROCK_COLOR[0] - r) * s;
        g = g + (ROCK_COLOR[1] - g) * s;
        b = b + (ROCK_COLOR[2] - b) * s;
    }

    // Snow zone: blend toward white above the snow line
    if (snowLine > 0 && hKm > snowLine) {
        const snowT = Math.min(1, (hKm - snowLine) / 2.5);
        const s = snowT * snowT; // ease-in for gradual snow buildup
        r = r + (0.92 - r) * s;
        g = g + (0.93 - g) * s;
        b = b + (0.96 - b) * s;
    }

    return [r, g, b];
}

// ---------------------------------------------------------------------------
// Alternate world-type palettes
// ---------------------------------------------------------------------------

/**
 * Barren world (no atmosphere): rocky surface, elevation-shaded only.
 * Hot barren (>150°C): Mercury-like warm tan regolith, bright reflective peaks.
 * Cold barren (<-50°C): Moon-like grey-blue rock, subtle cold tint at altitude.
 * Default: neutral mid-grey with faint warm dust at low elevations.
 */
function barrenColor(elevation) {
    const isHot  = _baseTemp > 150;
    const isCold = _baseTemp < -50;

    if (elevation < -0.40) {
        if (isHot)  return [0.14, 0.12, 0.09];
        if (isCold) return [0.05, 0.05, 0.08];
        return [0.06, 0.05, 0.06];
    }
    if (elevation < -0.10) {
        const t = (elevation + 0.40) / 0.30;
        if (isHot)  return [0.14 + t * 0.14, 0.12 + t * 0.12, 0.09 + t * 0.09];
        if (isCold) return [0.05 + t * 0.10, 0.05 + t * 0.10, 0.08 + t * 0.10];
        return [0.06 + t * 0.10, 0.05 + t * 0.10, 0.06 + t * 0.09];
    }
    if (elevation < 0.00) {
        const t = (elevation + 0.10) / 0.10;
        if (isHot)  return [0.28 + t * 0.14, 0.24 + t * 0.12, 0.18 + t * 0.10];
        if (isCold) return [0.15 + t * 0.08, 0.15 + t * 0.07, 0.18 + t * 0.08];
        return [0.16 + t * 0.08, 0.15 + t * 0.07, 0.15 + t * 0.07];
    }
    const hKm = elevToHeightKm(elevation);
    if (isHot) {
        // Mercury-like: warm tan lowlands (baked regolith), bright pale-grey peaks
        const base   = 0.30 + Math.min(0.60, hKm / 6 * 0.60);
        const warmth = Math.max(0, 0.06 - hKm * 0.012);
        return [base + warmth * 1.2, base + warmth * 0.5, base - warmth * 0.3];
    }
    if (isCold) {
        // Cold barren: grey-blue rock, subtle cold tint strengthens at altitude
        const base = 0.20 + Math.min(0.58, hKm / 6 * 0.58);
        const cold  = Math.min(0.04, hKm * 0.006);
        return [base - cold, base - cold * 0.3, base + cold * 2];
    }
    // Default neutral grey with subtle warm dust near ground
    const base   = 0.24 + Math.min(0.58, hKm / 6 * 0.58);
    const warmth = Math.max(0, 0.025 - hKm * 0.006);
    return [base + warmth, base - warmth * 0.3, base - warmth * 0.5];
}

/**
 * Arid world (no hydrosphere): ochre/rust/sandstone dry surface.
 * Very hot (>80°C): scorched yellow-brown, bleached pale peaks.
 * Very cold (<-110°C): faded pinkish-grey rust — still red-dominant, just desaturated.
 * Default: standard Mars-like orange-ochre → pale rocky grey (fires for Mars at -60°C).
 */
function aridColor(koppenId, elevation) {
    const isHot  = _baseTemp > 80;
    const isCold = _baseTemp < -110;   // only truly frigid worlds (not Mars at -60°C)

    if (elevation <= 0) {
        if (isHot) {
            if (elevation < -0.40) return [0.28, 0.18, 0.08];
            const t = (elevation + 0.40) / 0.40;
            return [0.28 + t * 0.28, 0.18 + t * 0.20, 0.08 + t * 0.14];
        }
        if (isCold) {
            if (elevation < -0.40) return [0.24, 0.16, 0.12];
            const t = (elevation + 0.40) / 0.40;
            return [0.24 + t * 0.22, 0.16 + t * 0.16, 0.12 + t * 0.10];
        }
        // Standard Mars-like rust seabed
        if (elevation < -0.40) return [0.30, 0.18, 0.10];
        const t = (elevation + 0.40) / 0.40;
        return [0.30 + t * 0.24, 0.18 + t * 0.18, 0.10 + t * 0.14];
    }
    const hKm = elevToHeightKm(elevation);
    const t = Math.min(1, hKm / 5);
    if (isHot) {
        // Scorched: vivid yellow-brown lowlands, bleached pale at peaks
        const r = 0.82 - t * 0.12;
        const g = 0.60 - t * 0.15;
        const b = 0.20 + t * 0.22;
        return [r, g, b];
    }
    if (isCold) {
        // Frigid rust: faded pinkish-grey — red always leads, just desaturated vs standard
        const r = 0.68 - t * 0.16;
        const g = 0.44 - t * 0.14;
        const b = 0.28 + t * 0.06;   // stays low so red always dominates
        const warmBias = koppenId <= 7 ? 0.04 : (koppenId >= 29 ? -0.04 : 0.00);
        return [
            Math.min(1, r + warmBias),
            Math.min(1, g + warmBias * 0.4),
            Math.max(0, b - warmBias * 0.2),
        ];
    }
    // Standard Mars-like: orange-ochre at low elevations, pale rocky grey at peaks
    const r = 0.74 - t * 0.18;
    const g = 0.50 - t * 0.18;
    const b = 0.22 + t * 0.14;
    const warmBias = koppenId <= 7 ? 0.05 : (koppenId >= 29 ? -0.06 : 0.00);
    return [
        Math.min(1, r + warmBias),
        Math.min(1, g + warmBias * 0.4),
        Math.max(0, b - warmBias * 0.3),
    ];
}

/**
 * Ice world (extreme cold): frozen surface.
 * High hydro (≥3): Europa/Snowball — brilliant white with teal fracture hints,
 *   deep blue-grey frozen ocean.
 * Low hydro (≤1): Frost world — underlying rock visible, frost coats at altitude.
 * Default: standard pale blue-white with biome tint blended at low elevations.
 */
function iceColor(koppenId, elevation) {
    const isHighHydro = _hydrosphere >= 3;
    const isLowHydro  = _hydrosphere <= 1;

    if (elevation <= 0) {
        if (isHighHydro) {
            // Europa-like: thick frozen ocean — midnight blue deep, teal-blue shallow
            if (elevation < -0.40) return [0.18, 0.26, 0.42];
            const t = (elevation + 0.40) / 0.40;
            return [0.18 + t * 0.44, 0.26 + t * 0.42, 0.42 + t * 0.38];
        }
        if (isLowHydro) {
            // Frost world: shallow frozen patches over dark rock
            if (elevation < -0.40) return [0.18, 0.16, 0.18];
            const t = (elevation + 0.40) / 0.40;
            return [0.18 + t * 0.30, 0.16 + t * 0.28, 0.18 + t * 0.30];
        }
        // Standard ice world ocean
        if (elevation < -0.40) return [0.28, 0.36, 0.52];
        const t = (elevation + 0.40) / 0.40;
        return [0.28 + t * 0.36, 0.36 + t * 0.30, 0.52 + t * 0.24];
    }
    const hKm = elevToHeightKm(elevation);
    const t   = Math.min(1, hKm / 5);
    if (isHighHydro) {
        // Europa-like land: brilliant white with subtle teal fracture tint at low altitude
        const r = 0.70 + t * 0.26;
        const g = 0.76 + t * 0.20;
        const b = 0.88 + t * 0.08;
        const fracture = Math.max(0, 0.10 - hKm * 0.03);
        return [Math.min(1, r - fracture * 0.35), Math.min(1, g), Math.min(1, b)];
    }
    if (isLowHydro) {
        // Frost world: biome rock with white frost blending in above mid-elevation
        const frost = Math.min(1, 0.25 + t * 0.60);
        if (koppenId >= 1 && koppenId <= 30) {
            const earth = BIOME_COLORS[koppenId];
            return [
                earth[0] * (1 - frost) + 0.88 * frost,
                earth[1] * (1 - frost) + 0.90 * frost,
                earth[2] * (1 - frost) + 0.94 * frost,
            ];
        }
        return [0.55 + t * 0.38, 0.57 + t * 0.36, 0.60 + t * 0.34];
    }
    // Standard ice world land
    const r = 0.68 + t * 0.22;
    const g = 0.74 + t * 0.18;
    const b = 0.82 + t * 0.12;
    if (koppenId >= 1 && koppenId <= 30) {
        const earth = BIOME_COLORS[koppenId];
        const frost = 0.75 + t * 0.15;
        return [
            r * frost + earth[0] * (1 - frost),
            g * frost + earth[1] * (1 - frost),
            b * frost + earth[2] * (1 - frost),
        ];
    }
    return [r, g, b];
}

/**
 * Alien world: temperature-dependent sub-palettes.
 *
 * Venus-type (baseTemp > 200°C): sulfurous cream-yellow hellscape —
 *   dark molten-brown basins, pale ochre-cream land fading to bright yellow-white peaks.
 *
 * Titan-type (baseTemp < -80°C): murky methane seas, dark amber-rust terrain —
 *   near-black sea deeps, dark amber shores, deep brick-red mid-land, dusty tan peaks.
 *
 * Generic alien (mid-temperature): original palette — deep indigo-to-amber exotic seas,
 *   amber-orange lowlands fading to ochre peaks.
 */
function alienColor(koppenId, elevation) {
    const isVenus = _baseTemp > 200;
    const isTitan = _baseTemp < -80;

    if (isVenus) {
        // Venus-type: sulfurous hellscape — no liquid, no blue at all
        if (elevation <= 0) {
            if (elevation < -0.40) return [0.22, 0.14, 0.06];
            const t = (elevation + 0.40) / 0.40;
            return [0.22 + t * 0.28, 0.14 + t * 0.20, 0.06 + t * 0.12];
        }
        const hKm = elevToHeightKm(elevation);
        const t   = Math.min(1, hKm / 5);
        // Lowlands: pale ochre-cream; peaks: bright sulfurous yellow-white
        const r = 0.78 + t * 0.16;
        const g = 0.62 + t * 0.24;
        const b = 0.24 + t * 0.28;
        return [Math.min(1, r), Math.min(1, g), Math.min(1, b)];
    }

    if (isTitan) {
        // Titan-type: murky methane seas, amber-rust highlands
        if (elevation <= 0) {
            // Methane seas: near-black in deeps, dark amber-brown at shore
            if (elevation < -0.40) return [0.08, 0.05, 0.04];
            const t = (elevation + 0.40) / 0.40;
            return [0.08 + t * 0.18, 0.05 + t * 0.14, 0.04 + t * 0.08];
        }
        const hKm = elevToHeightKm(elevation);
        const t   = Math.min(1, hKm / 5);
        // Dark amber lowlands → deep brick-red mid → pale dusty tan peaks
        const r = 0.55 + t * 0.22;
        const g = 0.28 - t * 0.06;
        const b = 0.05 + t * 0.14;
        return [Math.min(1, r), Math.max(0, g), Math.min(1, b)];
    }

    // Generic alien (mid-temperature): indigo-to-amber exotic seas, ochre-rust land
    if (elevation <= 0) {
        if (elevation < -0.40) return [0.10, 0.07, 0.20];
        const t = (elevation + 0.40) / 0.40;
        return [0.10 + t * 0.34, 0.07 + t * 0.22, 0.20 + t * 0.12];
    }
    const hKm = elevToHeightKm(elevation);
    const t   = Math.min(1, hKm / 5);
    // Ground: amber-orange lowlands → rust-red mid → pale ochre peaks
    const r = 0.62 + t * 0.18;
    const g = 0.30 - t * 0.05;
    const b = 0.06 + t * 0.18;
    return [r, g, b];
}

// ---------------------------------------------------------------------------
// Public: dispatch to correct palette by biome mode
// ---------------------------------------------------------------------------

/**
 * Satellite-view biome color, supporting alternate world palettes.
 * @param {number}  koppenId  Köppen class ID (0 = ocean)
 * @param {number}  elevation Normalised elevation (-1…1)
 * @param {string}  biomeMode 'earth' | 'arid' | 'ice' | 'alien' | 'barren'
 */
export function biomeColor(koppenId, elevation, biomeMode = 'earth') {
    switch (biomeMode) {
        case 'barren': return barrenColor(elevation);
        case 'arid':   return aridColor(koppenId, elevation);
        case 'ice':    return iceColor(koppenId, elevation);
        case 'alien':  return alienColor(koppenId, elevation);
        default:       return earthBiomeColor(koppenId, elevation); // 'earth'
    }
}

export function elevationToColor(e) {
    if (!_hasLiquidOcean) {
        // Dry world: no ocean blue — render as rocky basin / arid lowland.
        // Deep basin: dark charcoal-brown. Rises to sandy-tan at ground level.
        if (e < -0.50) return [0.13, 0.10, 0.09];
        if (e < -0.10) { const t=(e+0.50)/0.40; return [0.13+t*0.14, 0.10+t*0.12, 0.09+t*0.10]; }
        if (e <  0.00) { const t=(e+0.10)/0.10; return [0.27+t*0.20, 0.22+t*0.18, 0.19+t*0.14]; }
    }
    // Standard ocean ramp (Earth / wet worlds)
    if (e < -0.50) return [0.04, 0.06, 0.30];
    if (e < -0.10) { const t=(e+0.50)/0.40; return [0.04+t*0.07,0.06+t*0.14,0.30+t*0.18]; }
    if (e <  0.00) { const t=(e+0.10)/0.10; return [0.11+t*0.19,0.20+t*0.22,0.48+t*0.12]; }
    // Land ramp — same for all world types in Terrain view (shows elevation relief)
    if (e <  0.03) { const t=e/0.03;         return [0.72+t*0.08,0.68-t*0.02,0.46-t*0.10]; }
    if (e <  0.25) { const t=(e-0.03)/0.22;  return [0.20-t*0.06,0.54-t*0.12,0.12+t*0.08]; }
    if (e <  0.50) { const t=(e-0.25)/0.25;  return [0.14+t*0.30,0.42-t*0.14,0.20-t*0.06]; }
    if (e <  0.75) { const t=(e-0.50)/0.25;  return [0.44+t*0.16,0.28+t*0.12,0.14+t*0.18]; }
    { const t=Math.min(1,(e-0.75)/0.20);      return [0.60+t*0.35,0.40+t*0.50,0.32+t*0.60]; }
}
