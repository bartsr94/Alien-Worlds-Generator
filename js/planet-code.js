// Planet code encode/decode — packs seed + slider values into a compact base36 string.
// Pure functions, no DOM access.

// Slider quantization tables
const SLIDERS = [
    { min: 5000,  step: 1000, count: 2556 }, // [0]  Detail (N)
    { min: 0,     step: 0.05, count: 21  }, // [1]  Irregularity (jitter)
    { min: 4,     step: 1,    count: 117 }, // [2]  Plates (P)
    { min: 1,     step: 1,    count: 10  }, // [3]  Continents
    { min: 0,     step: 0.01, count: 51  }, // [4]  Roughness
    { min: 0,     step: 0.05, count: 21  }, // [5]  Smoothing
    { min: 0,     step: 0.05, count: 21  }, // [6]  Glacial Erosion
    { min: 0,     step: 0.05, count: 21  }, // [7]  Hydraulic Erosion
    { min: 0,     step: 0.05, count: 21  }, // [8]  Thermal Erosion
    { min: 0,     step: 0.05, count: 21  }, // [9]  Ridge Sharpening
    { min: 0,     step: 0.05, count: 21  }, // [10] Soil Creep
    { min: 0,     step: 0.05, count: 21  }, // [11] Terrain Warp
    // ── Planetary Physics (appended for backward compatibility) ─────────────
    { min: 0.1,  step: 0.1,  count: 30  }, // [12] Gravity (0.1–3.0g)
    { min: 0,    step: 1,    count: 6   }, // [13] Atmosphere (0–5)
    { min: 0,    step: 1,    count: 6   }, // [14] Hydrosphere (0–5)
    { min: -150, step: 5,    count: 131 }, // [15] Base Temperature (-150 to +500°C, 5° steps)
    { min: 0,    step: 1,    count: 91  }, // [16] Axial Tilt (0–90°)
    { min: 0,    step: 1,    count: 4   }, // [17] Moons (0–3)
];

// Earth-default indices for the five new sliders (used when decoding old codes).
// gravity index 9  = 0.1 + 9*0.1  = 1.0g
// atmosphere index 3  = Moderate
// hydrosphere index 3  = Moderate
// baseTemp index 33 = -150 + 33*5 = +15°C
// axialTilt index 23 = 23°  (nearest integer to Earth 23.5°)
const EARTH_GRAVITY_IDX    = 9;
const EARTH_ATM_IDX        = 3;
const EARTH_HYDRO_IDX      = 3;
const EARTH_BASETEMP_IDX   = 33;
const EARTH_AXIALTILT_IDX  = 23;
const EARTH_MOON_IDX       = 1;  // 1 moon default for Earth / old codes

// Mixed-radix bases right-to-left:
//   twIdx[0], scIdx[1], rsIdx[2], teIdx[3], heIdx[4], glIdx[5], smIdx[6],
//   nsIdx[7], cnIdx[8], pIdx[9], jIdx[10], nIdx[11],
//   gravIdx[12], atmIdx[13], hydroIdx[14], btIdx[15], tiltIdx[16], seed
const RADICES = [21, 21, 21, 21, 21, 21, 21, 51, 10, 117, 21, 2556, 30, 6, 6, 131, 91, 4];
const SEED_MAX = 16777216; // 2^24
const BASE_LEN  = 24; // current code length (with moons field)
const PREV5_LEN = 23; // previous 23-char codes (with planetary physics, before moons) — Earth defaults for moons
const PREV4_LEN = 18; // previous 18-char codes (before planetary physics) — Earth defaults for new sliders
const PREV3_LEN = 17; // previous 17-char codes (before terrain warp)
const PREV2_LEN = 16; // previous 16-char codes (before glacial erosion)
const PREV_LEN  = 14; // previous 14-char codes (before ridge/creep)
const LEGACY_LEN = 13; // legacy 13-char codes (single erosion slider)
const IDX_CHARS = 2; // base36 chars per plate index (max index 119 = "3b")

// Legacy radices for decoding old 13-char codes (single erosion slider)
const LEGACY_RADICES = [21, 21, 51, 10, 117, 21, 2559];

// Previous-gen radices for decoding 14-char codes (two erosion sliders, no ridge/creep)
const PREV_RADICES = [21, 21, 21, 51, 10, 117, 21, 2559];

// Previous2-gen radices for decoding 16-char codes (no glacial erosion)
const PREV2_RADICES = [21, 21, 21, 21, 21, 51, 10, 117, 21, 2559];

// Previous3-gen radices for decoding 17-char codes (no terrain warp)
const PREV3_RADICES = [21, 21, 21, 21, 21, 21, 51, 10, 117, 21, 2559];

// Previous4-gen radices for decoding 18-char codes (before planetary physics).
// Identical to the first 12 entries of RADICES — kept separate for clarity.
const PREV4_RADICES = [21, 21, 21, 21, 21, 21, 21, 51, 10, 117, 21, 2556];

function toIndex(value, slider) {
    return Math.round((value - slider.min) / slider.step);
}

function fromIndex(idx, slider) {
    // Round to step precision to avoid floating-point drift
    const raw = slider.min + idx * slider.step;
    const decimals = slider.step < 1 ? String(slider.step).split('.')[1].length : 0;
    return decimals > 0 ? parseFloat(raw.toFixed(decimals)) : raw;
}

/** Parse a base36 string into a BigInt (char-by-char for full precision). */
function parseBase36(str) {
    return [...str].reduce((acc, ch) => {
        const d = parseInt(ch, 36);
        if (isNaN(d)) throw new Error('bad char');
        return acc * 36n + BigInt(d);
    }, 0n);
}

/**
 * Encode planet parameters into a base36 planet code.
 * @param {number} seed - Integer seed 0–16777215
 * @param {number} N - Detail (5000–2560000, step 1000)
 * @param {number} jitter - Irregularity (0–1, step 0.05)
 * @param {number} P - Plates (4–120, step 1)
 * @param {number} numContinents - Continents (1–10, step 1)
 * @param {number} roughness - Roughness (0–0.5, step 0.01)
 * @param {number} terrainWarp - Terrain Warp (0–1, step 0.05)
 * @param {number} smoothing - Smoothing (0–1, step 0.05)
 * @param {number} glacialErosion - Glacial Erosion (0–1, step 0.05)
 * @param {number} hydraulicErosion - Hydraulic Erosion (0–1, step 0.05)
 * @param {number} thermalErosion - Thermal Erosion (0–1, step 0.05)
 * @param {number} ridgeSharpening - Ridge Sharpening (0–1, step 0.05)
 * @param {number} soilCreep - Soil Creep (0–1, step 0.05)
 * @param {number[]} [toggledIndices=[]] - Sorted array of toggled plate indices
 * @param {number} [gravity=1.0] - Surface gravity in g (0.1–3.0)
 * @param {number} [atmosphere=3] - Atmosphere level 0–5
 * @param {number} [hydrosphere=3] - Hydrosphere level 0–5
 * @param {number} [baseTemp=15] - Base temperature °C (-150–+500)
 * @param {number} [axialTilt=23] - Axial tilt in degrees (0–90)
 * @param {number} [moonCount=1] - Number of moons (0–3)
 * @returns {string} base36 code (24 chars without edits, 24 + '-' + 2*k with k edits)
 */
export function encodePlanetCode(
    seed, N, jitter, P, numContinents, roughness,
    terrainWarp, smoothing, glacialErosion, hydraulicErosion, thermalErosion, ridgeSharpening, soilCreep,
    toggledIndices = [],
    gravity = 1.0, atmosphere = 3, hydrosphere = 3, baseTemp = 15, axialTilt = 23, moonCount = 1
) {
    const nIdx    = toIndex(N, SLIDERS[0]);
    const jIdx    = toIndex(jitter, SLIDERS[1]);
    const pIdx    = toIndex(P, SLIDERS[2]);
    const cnIdx   = toIndex(numContinents, SLIDERS[3]);
    const nsIdx   = toIndex(roughness, SLIDERS[4]);
    const smIdx   = toIndex(smoothing, SLIDERS[5]);
    const glIdx   = toIndex(glacialErosion, SLIDERS[6]);
    const heIdx   = toIndex(hydraulicErosion, SLIDERS[7]);
    const teIdx   = toIndex(thermalErosion, SLIDERS[8]);
    const rsIdx   = toIndex(ridgeSharpening, SLIDERS[9]);
    const scIdx   = toIndex(soilCreep, SLIDERS[10]);
    const twIdx   = toIndex(terrainWarp, SLIDERS[11]);
    const gravIdx = toIndex(gravity,     SLIDERS[12]);
    const atmIdx  = toIndex(atmosphere,  SLIDERS[13]);
    const hydroIdx= toIndex(hydrosphere, SLIDERS[14]);
    const btIdx   = toIndex(baseTemp,    SLIDERS[15]);
    const tiltIdx = toIndex(axialTilt,   SLIDERS[16]);
    const moonIdx  = toIndex(moonCount,   SLIDERS[17]);

    // Mixed-radix packing — seed is the most-significant residual.
    // Pack order (most→least significant): seed, moonIdx, tiltIdx, btIdx, hydroIdx, atmIdx,
    //   gravIdx, nIdx, jIdx, pIdx, cnIdx, nsIdx, smIdx, glIdx, heIdx, teIdx, rsIdx, scIdx, twIdx
    let packed = BigInt(seed);
    packed = packed * BigInt(RADICES[17]) + BigInt(moonIdx);  // * 4
    packed = packed * BigInt(RADICES[16]) + BigInt(tiltIdx); // * 91
    packed = packed * BigInt(RADICES[15]) + BigInt(btIdx);   // * 131
    packed = packed * BigInt(RADICES[14]) + BigInt(hydroIdx);// * 6
    packed = packed * BigInt(RADICES[13]) + BigInt(atmIdx);  // * 6
    packed = packed * BigInt(RADICES[12]) + BigInt(gravIdx); // * 30
    packed = packed * BigInt(RADICES[11]) + BigInt(nIdx);    // * 2556
    packed = packed * BigInt(RADICES[10]) + BigInt(jIdx);    // * 21
    packed = packed * BigInt(RADICES[9])  + BigInt(pIdx);    // * 117
    packed = packed * BigInt(RADICES[8])  + BigInt(cnIdx);   // * 10
    packed = packed * BigInt(RADICES[7])  + BigInt(nsIdx);   // * 51
    packed = packed * BigInt(RADICES[6])  + BigInt(smIdx);   // * 21
    packed = packed * BigInt(RADICES[5])  + BigInt(glIdx);   // * 21
    packed = packed * BigInt(RADICES[4])  + BigInt(heIdx);   // * 21
    packed = packed * BigInt(RADICES[3])  + BigInt(teIdx);   // * 21
    packed = packed * BigInt(RADICES[2])  + BigInt(rsIdx);   // * 21
    packed = packed * BigInt(RADICES[1])  + BigInt(scIdx);   // * 21
    packed = packed * BigInt(RADICES[0])  + BigInt(twIdx);   // * 21

    let code = packed.toString(36).padStart(BASE_LEN, '0');

    // Append toggled plate indices: "-" + 2-char base36 per index
    if (toggledIndices.length > 0) {
        code += '-' + toggledIndices
            .map(i => i.toString(36).padStart(IDX_CHARS, '0'))
            .join('');
    }

    return code;
}

// Earth-default planetary physics values — returned for all pre-planetary-physics codes.
function earthPhysicsDefaults() {
    return {
        gravity:     fromIndex(EARTH_GRAVITY_IDX,   SLIDERS[12]),
        atmosphere:  fromIndex(EARTH_ATM_IDX,       SLIDERS[13]),
        hydrosphere: fromIndex(EARTH_HYDRO_IDX,     SLIDERS[14]),
        baseTemp:    fromIndex(EARTH_BASETEMP_IDX,  SLIDERS[15]),
        axialTilt:   fromIndex(EARTH_AXIALTILT_IDX, SLIDERS[16]),
    };
}

/**
 * Decode a base36 planet code back into planet parameters.
 * Supports 24-char (current), 23-char (prev5), 18-char (prev4), 17-char (prev3),
 * 16-char (prev2), 14-char (prev), and 13-char (legacy) codes.
 * Old codes get Earth defaults for the five new planetary-physics sliders and moons.
 * @param {string} code
 * @returns {object|null}
 */
export function decodePlanetCode(code) {
    if (typeof code !== 'string') return null;
    code = code.trim().toLowerCase();

    // Split base code from optional toggle suffix
    const dashIdx = code.indexOf('-');
    const base = dashIdx === -1 ? code : code.slice(0, dashIdx);
    const toggleStr = dashIdx === -1 ? '' : code.slice(dashIdx + 1);

    const isLegacy = base.length === LEGACY_LEN;
    const isPrev   = base.length === PREV_LEN;
    const isPrev2  = base.length === PREV2_LEN;
    const isPrev3  = base.length === PREV3_LEN;
    const isPrev4  = base.length === PREV4_LEN;
    const isPrev5  = base.length === PREV5_LEN;
    const isNew    = base.length === BASE_LEN;
    if (!isLegacy && !isPrev && !isPrev2 && !isPrev3 && !isPrev4 && !isPrev5 && !isNew) return null;
    if (!/^[0-9a-z]+$/.test(base)) return null;
    if (toggleStr && !/^[0-9a-z]+$/.test(toggleStr)) return null;
    if (toggleStr && toggleStr.length % IDX_CHARS !== 0) return null;

    let packed;
    try {
        packed = parseBase36(base);
    } catch {
        return null;
    }

    if (isLegacy) {
        // Legacy 13-char decode: single erosion slider
        const erIdx = Number(packed % BigInt(LEGACY_RADICES[0]));
        packed = packed / BigInt(LEGACY_RADICES[0]);

        const smIdx = Number(packed % BigInt(LEGACY_RADICES[1]));
        packed = packed / BigInt(LEGACY_RADICES[1]);

        const nsIdx = Number(packed % BigInt(LEGACY_RADICES[2]));
        packed = packed / BigInt(LEGACY_RADICES[2]);

        const cnIdx = Number(packed % BigInt(LEGACY_RADICES[3]));
        packed = packed / BigInt(LEGACY_RADICES[3]);

        const pIdx = Number(packed % BigInt(LEGACY_RADICES[4]));
        packed = packed / BigInt(LEGACY_RADICES[4]);

        const jIdx = Number(packed % BigInt(LEGACY_RADICES[5]));
        packed = packed / BigInt(LEGACY_RADICES[5]);

        const nIdx = Number(packed % BigInt(LEGACY_RADICES[6]));
        packed = packed / BigInt(LEGACY_RADICES[6]);

        const seed = Number(packed);

        if (seed < 0 || seed >= SEED_MAX) return null;
        if (nIdx >= SLIDERS[0].count || jIdx >= SLIDERS[1].count ||
            pIdx >= SLIDERS[2].count || cnIdx >= SLIDERS[3].count ||
            nsIdx >= SLIDERS[4].count || smIdx >= SLIDERS[5].count ||
            erIdx >= SLIDERS[7].count) return null;

        const P = fromIndex(pIdx, SLIDERS[2]);

        const toggledIndices = [];
        if (toggleStr) {
            for (let i = 0; i < toggleStr.length; i += IDX_CHARS) {
                const idx = parseInt(toggleStr.slice(i, i + IDX_CHARS), 36);
                if (isNaN(idx) || idx >= P) return null;
                toggledIndices.push(idx);
            }
        }

        return {
            seed,
            N:                fromIndex(nIdx, SLIDERS[0]),
            jitter:           fromIndex(jIdx, SLIDERS[1]),
            P,
            numContinents:    fromIndex(cnIdx, SLIDERS[3]),
            roughness:        fromIndex(nsIdx, SLIDERS[4]),
            terrainWarp:      0.5,
            smoothing:        fromIndex(smIdx, SLIDERS[5]),
            glacialErosion:   0,
            hydraulicErosion: fromIndex(erIdx, SLIDERS[7]), // map old erosion → hydraulic
            thermalErosion:   0.1,                          // default for legacy codes
            ridgeSharpening:  0.35,
            soilCreep:        0.05,
            toggledIndices,
            ...earthPhysicsDefaults(),
        };
    }

    if (isPrev) {
        // Previous-gen 14-char decode: two erosion sliders, no ridge/creep/glacial
        const teIdx = Number(packed % BigInt(PREV_RADICES[0]));
        packed = packed / BigInt(PREV_RADICES[0]);

        const heIdx = Number(packed % BigInt(PREV_RADICES[1]));
        packed = packed / BigInt(PREV_RADICES[1]);

        const smIdx = Number(packed % BigInt(PREV_RADICES[2]));
        packed = packed / BigInt(PREV_RADICES[2]);

        const nsIdx = Number(packed % BigInt(PREV_RADICES[3]));
        packed = packed / BigInt(PREV_RADICES[3]);

        const cnIdx = Number(packed % BigInt(PREV_RADICES[4]));
        packed = packed / BigInt(PREV_RADICES[4]);

        const pIdx = Number(packed % BigInt(PREV_RADICES[5]));
        packed = packed / BigInt(PREV_RADICES[5]);

        const jIdx = Number(packed % BigInt(PREV_RADICES[6]));
        packed = packed / BigInt(PREV_RADICES[6]);

        const nIdx = Number(packed % BigInt(PREV_RADICES[7]));
        packed = packed / BigInt(PREV_RADICES[7]);

        const seed = Number(packed);

        if (seed < 0 || seed >= SEED_MAX) return null;
        if (nIdx >= SLIDERS[0].count || jIdx >= SLIDERS[1].count ||
            pIdx >= SLIDERS[2].count || cnIdx >= SLIDERS[3].count ||
            nsIdx >= SLIDERS[4].count || smIdx >= SLIDERS[5].count ||
            heIdx >= SLIDERS[7].count || teIdx >= SLIDERS[8].count) return null;

        const P = fromIndex(pIdx, SLIDERS[2]);

        const toggledIndices = [];
        if (toggleStr) {
            for (let i = 0; i < toggleStr.length; i += IDX_CHARS) {
                const idx = parseInt(toggleStr.slice(i, i + IDX_CHARS), 36);
                if (isNaN(idx) || idx >= P) return null;
                toggledIndices.push(idx);
            }
        }

        return {
            seed,
            N:                fromIndex(nIdx, SLIDERS[0]),
            jitter:           fromIndex(jIdx, SLIDERS[1]),
            P,
            numContinents:    fromIndex(cnIdx, SLIDERS[3]),
            roughness:        fromIndex(nsIdx, SLIDERS[4]),
            terrainWarp:      0.5,
            smoothing:        fromIndex(smIdx, SLIDERS[5]),
            glacialErosion:   0,
            hydraulicErosion: fromIndex(heIdx, SLIDERS[7]),
            thermalErosion:   fromIndex(teIdx, SLIDERS[8]),
            ridgeSharpening:  0.35,
            soilCreep:        0.05,
            toggledIndices,
            ...earthPhysicsDefaults(),
        };
    }

    if (isPrev2) {
        // Previous2-gen 16-char decode: all sliders except glacial erosion
        const scIdx = Number(packed % BigInt(PREV2_RADICES[0]));
        packed = packed / BigInt(PREV2_RADICES[0]);

        const rsIdx = Number(packed % BigInt(PREV2_RADICES[1]));
        packed = packed / BigInt(PREV2_RADICES[1]);

        const teIdx = Number(packed % BigInt(PREV2_RADICES[2]));
        packed = packed / BigInt(PREV2_RADICES[2]);

        const heIdx = Number(packed % BigInt(PREV2_RADICES[3]));
        packed = packed / BigInt(PREV2_RADICES[3]);

        const smIdx = Number(packed % BigInt(PREV2_RADICES[4]));
        packed = packed / BigInt(PREV2_RADICES[4]);

        const nsIdx = Number(packed % BigInt(PREV2_RADICES[5]));
        packed = packed / BigInt(PREV2_RADICES[5]);

        const cnIdx = Number(packed % BigInt(PREV2_RADICES[6]));
        packed = packed / BigInt(PREV2_RADICES[6]);

        const pIdx = Number(packed % BigInt(PREV2_RADICES[7]));
        packed = packed / BigInt(PREV2_RADICES[7]);

        const jIdx = Number(packed % BigInt(PREV2_RADICES[8]));
        packed = packed / BigInt(PREV2_RADICES[8]);

        const nIdx = Number(packed % BigInt(PREV2_RADICES[9]));
        packed = packed / BigInt(PREV2_RADICES[9]);

        const seed = Number(packed);

        if (seed < 0 || seed >= SEED_MAX) return null;
        if (nIdx >= SLIDERS[0].count || jIdx >= SLIDERS[1].count ||
            pIdx >= SLIDERS[2].count || cnIdx >= SLIDERS[3].count ||
            nsIdx >= SLIDERS[4].count || smIdx >= SLIDERS[5].count ||
            heIdx >= SLIDERS[7].count || teIdx >= SLIDERS[8].count ||
            rsIdx >= SLIDERS[9].count || scIdx >= SLIDERS[10].count) return null;

        const P = fromIndex(pIdx, SLIDERS[2]);

        const toggledIndices = [];
        if (toggleStr) {
            for (let i = 0; i < toggleStr.length; i += IDX_CHARS) {
                const idx = parseInt(toggleStr.slice(i, i + IDX_CHARS), 36);
                if (isNaN(idx) || idx >= P) return null;
                toggledIndices.push(idx);
            }
        }

        return {
            seed,
            N:                fromIndex(nIdx, SLIDERS[0]),
            jitter:           fromIndex(jIdx, SLIDERS[1]),
            P,
            numContinents:    fromIndex(cnIdx, SLIDERS[3]),
            roughness:        fromIndex(nsIdx, SLIDERS[4]),
            terrainWarp:      0.5,
            smoothing:        fromIndex(smIdx, SLIDERS[5]),
            glacialErosion:   0,
            hydraulicErosion: fromIndex(heIdx, SLIDERS[7]),
            thermalErosion:   fromIndex(teIdx, SLIDERS[8]),
            ridgeSharpening:  fromIndex(rsIdx, SLIDERS[9]),
            soilCreep:        fromIndex(scIdx, SLIDERS[10]),
            toggledIndices,
            ...earthPhysicsDefaults(),
        };
    }

    if (isPrev3) {
        // Previous3-gen 17-char decode: all sliders except terrain warp
        const scIdx = Number(packed % BigInt(PREV3_RADICES[0]));
        packed = packed / BigInt(PREV3_RADICES[0]);

        const rsIdx = Number(packed % BigInt(PREV3_RADICES[1]));
        packed = packed / BigInt(PREV3_RADICES[1]);

        const teIdx = Number(packed % BigInt(PREV3_RADICES[2]));
        packed = packed / BigInt(PREV3_RADICES[2]);

        const heIdx = Number(packed % BigInt(PREV3_RADICES[3]));
        packed = packed / BigInt(PREV3_RADICES[3]);

        const glIdx = Number(packed % BigInt(PREV3_RADICES[4]));
        packed = packed / BigInt(PREV3_RADICES[4]);

        const smIdx = Number(packed % BigInt(PREV3_RADICES[5]));
        packed = packed / BigInt(PREV3_RADICES[5]);

        const nsIdx = Number(packed % BigInt(PREV3_RADICES[6]));
        packed = packed / BigInt(PREV3_RADICES[6]);

        const cnIdx = Number(packed % BigInt(PREV3_RADICES[7]));
        packed = packed / BigInt(PREV3_RADICES[7]);

        const pIdx = Number(packed % BigInt(PREV3_RADICES[8]));
        packed = packed / BigInt(PREV3_RADICES[8]);

        const jIdx = Number(packed % BigInt(PREV3_RADICES[9]));
        packed = packed / BigInt(PREV3_RADICES[9]);

        const nIdx = Number(packed % BigInt(PREV3_RADICES[10]));
        packed = packed / BigInt(PREV3_RADICES[10]);

        const seed = Number(packed);

        if (seed < 0 || seed >= SEED_MAX) return null;
        if (nIdx >= SLIDERS[0].count || jIdx >= SLIDERS[1].count ||
            pIdx >= SLIDERS[2].count || cnIdx >= SLIDERS[3].count ||
            nsIdx >= SLIDERS[4].count || smIdx >= SLIDERS[5].count ||
            glIdx >= SLIDERS[6].count || heIdx >= SLIDERS[7].count ||
            teIdx >= SLIDERS[8].count || rsIdx >= SLIDERS[9].count ||
            scIdx >= SLIDERS[10].count) return null;

        const P = fromIndex(pIdx, SLIDERS[2]);

        const toggledIndices = [];
        if (toggleStr) {
            for (let i = 0; i < toggleStr.length; i += IDX_CHARS) {
                const idx = parseInt(toggleStr.slice(i, i + IDX_CHARS), 36);
                if (isNaN(idx) || idx >= P) return null;
                toggledIndices.push(idx);
            }
        }

        return {
            seed,
            N:                fromIndex(nIdx, SLIDERS[0]),
            jitter:           fromIndex(jIdx, SLIDERS[1]),
            P,
            numContinents:    fromIndex(cnIdx, SLIDERS[3]),
            roughness:        fromIndex(nsIdx, SLIDERS[4]),
            terrainWarp:      0.5,
            smoothing:        fromIndex(smIdx, SLIDERS[5]),
            glacialErosion:   fromIndex(glIdx, SLIDERS[6]),
            hydraulicErosion: fromIndex(heIdx, SLIDERS[7]),
            thermalErosion:   fromIndex(teIdx, SLIDERS[8]),
            ridgeSharpening:  fromIndex(rsIdx, SLIDERS[9]),
            soilCreep:        fromIndex(scIdx, SLIDERS[10]),
            toggledIndices,
            ...earthPhysicsDefaults(),
        };
    }

    if (isPrev4) {
        // Previous4-gen 18-char decode: all terrain/erosion sliders, no planetary physics.
        // Uses PREV4_RADICES which match the first 12 entries of RADICES.
        const twIdx = Number(packed % BigInt(PREV4_RADICES[0]));
        packed = packed / BigInt(PREV4_RADICES[0]);

        const scIdx = Number(packed % BigInt(PREV4_RADICES[1]));
        packed = packed / BigInt(PREV4_RADICES[1]);

        const rsIdx = Number(packed % BigInt(PREV4_RADICES[2]));
        packed = packed / BigInt(PREV4_RADICES[2]);

        const teIdx = Number(packed % BigInt(PREV4_RADICES[3]));
        packed = packed / BigInt(PREV4_RADICES[3]);

        const heIdx = Number(packed % BigInt(PREV4_RADICES[4]));
        packed = packed / BigInt(PREV4_RADICES[4]);

        const glIdx = Number(packed % BigInt(PREV4_RADICES[5]));
        packed = packed / BigInt(PREV4_RADICES[5]);

        const smIdx = Number(packed % BigInt(PREV4_RADICES[6]));
        packed = packed / BigInt(PREV4_RADICES[6]);

        const nsIdx = Number(packed % BigInt(PREV4_RADICES[7]));
        packed = packed / BigInt(PREV4_RADICES[7]);

        const cnIdx = Number(packed % BigInt(PREV4_RADICES[8]));
        packed = packed / BigInt(PREV4_RADICES[8]);

        const pIdx = Number(packed % BigInt(PREV4_RADICES[9]));
        packed = packed / BigInt(PREV4_RADICES[9]);

        const jIdx = Number(packed % BigInt(PREV4_RADICES[10]));
        packed = packed / BigInt(PREV4_RADICES[10]);

        const nIdx = Number(packed % BigInt(PREV4_RADICES[11]));
        packed = packed / BigInt(PREV4_RADICES[11]);

        const seed = Number(packed);

        if (seed < 0 || seed >= SEED_MAX) return null;
        if (nIdx >= SLIDERS[0].count || jIdx >= SLIDERS[1].count ||
            pIdx >= SLIDERS[2].count || cnIdx >= SLIDERS[3].count ||
            nsIdx >= SLIDERS[4].count || smIdx >= SLIDERS[5].count ||
            glIdx >= SLIDERS[6].count || heIdx >= SLIDERS[7].count ||
            teIdx >= SLIDERS[8].count || rsIdx >= SLIDERS[9].count ||
            scIdx >= SLIDERS[10].count || twIdx >= SLIDERS[11].count) return null;

        const P = fromIndex(pIdx, SLIDERS[2]);

        const toggledIndices = [];
        if (toggleStr) {
            for (let i = 0; i < toggleStr.length; i += IDX_CHARS) {
                const idx = parseInt(toggleStr.slice(i, i + IDX_CHARS), 36);
                if (isNaN(idx) || idx >= P) return null;
                toggledIndices.push(idx);
            }
        }

        return {
            seed,
            N:                fromIndex(nIdx, SLIDERS[0]),
            jitter:           fromIndex(jIdx, SLIDERS[1]),
            P,
            numContinents:    fromIndex(cnIdx, SLIDERS[3]),
            roughness:        fromIndex(nsIdx, SLIDERS[4]),
            terrainWarp:      fromIndex(twIdx, SLIDERS[11]),
            smoothing:        fromIndex(smIdx, SLIDERS[5]),
            glacialErosion:   fromIndex(glIdx, SLIDERS[6]),
            hydraulicErosion: fromIndex(heIdx, SLIDERS[7]),
            thermalErosion:   fromIndex(teIdx, SLIDERS[8]),
            ridgeSharpening:  fromIndex(rsIdx, SLIDERS[9]),
            soilCreep:        fromIndex(scIdx, SLIDERS[10]),
            toggledIndices,
            ...earthPhysicsDefaults(),
        };
    }

    // New 24-char / prev5 23-char decode: all sliders including planetary physics.
    const twIdx   = Number(packed % BigInt(RADICES[0]));  packed = packed / BigInt(RADICES[0]);
    const scIdx   = Number(packed % BigInt(RADICES[1]));  packed = packed / BigInt(RADICES[1]);
    const rsIdx   = Number(packed % BigInt(RADICES[2]));  packed = packed / BigInt(RADICES[2]);
    const teIdx   = Number(packed % BigInt(RADICES[3]));  packed = packed / BigInt(RADICES[3]);
    const heIdx   = Number(packed % BigInt(RADICES[4]));  packed = packed / BigInt(RADICES[4]);
    const glIdx   = Number(packed % BigInt(RADICES[5]));  packed = packed / BigInt(RADICES[5]);
    const smIdx   = Number(packed % BigInt(RADICES[6]));  packed = packed / BigInt(RADICES[6]);
    const nsIdx   = Number(packed % BigInt(RADICES[7]));  packed = packed / BigInt(RADICES[7]);
    const cnIdx   = Number(packed % BigInt(RADICES[8]));  packed = packed / BigInt(RADICES[8]);
    const pIdx    = Number(packed % BigInt(RADICES[9]));  packed = packed / BigInt(RADICES[9]);
    const jIdx    = Number(packed % BigInt(RADICES[10])); packed = packed / BigInt(RADICES[10]);
    const nIdx    = Number(packed % BigInt(RADICES[11])); packed = packed / BigInt(RADICES[11]);
    const gravIdx = Number(packed % BigInt(RADICES[12])); packed = packed / BigInt(RADICES[12]);
    const atmIdx  = Number(packed % BigInt(RADICES[13])); packed = packed / BigInt(RADICES[13]);
    const hydroIdx= Number(packed % BigInt(RADICES[14])); packed = packed / BigInt(RADICES[14]);
    const btIdx   = Number(packed % BigInt(RADICES[15])); packed = packed / BigInt(RADICES[15]);
    const tiltIdx = Number(packed % BigInt(RADICES[16])); packed = packed / BigInt(RADICES[16]);

    // Moon count — only present in 24-char (isNew) codes; default to 1 for prev5 codes
    let moonIdx = EARTH_MOON_IDX;
    if (isNew) {
        moonIdx = Number(packed % BigInt(RADICES[17])); packed = packed / BigInt(RADICES[17]);
    }

    const seed = Number(packed);

    // Validate ranges
    if (seed < 0 || seed >= SEED_MAX) return null;
    if (nIdx    >= SLIDERS[0].count  || jIdx  >= SLIDERS[1].count  ||
        pIdx    >= SLIDERS[2].count  || cnIdx >= SLIDERS[3].count  ||
        nsIdx   >= SLIDERS[4].count  || smIdx >= SLIDERS[5].count  ||
        glIdx   >= SLIDERS[6].count  || heIdx >= SLIDERS[7].count  ||
        teIdx   >= SLIDERS[8].count  || rsIdx >= SLIDERS[9].count  ||
        scIdx   >= SLIDERS[10].count || twIdx >= SLIDERS[11].count ||
        gravIdx >= SLIDERS[12].count || atmIdx >= SLIDERS[13].count ||
        hydroIdx>= SLIDERS[14].count || btIdx >= SLIDERS[15].count ||
        tiltIdx >= SLIDERS[16].count || moonIdx >= SLIDERS[17].count) return null;

    const P = fromIndex(pIdx, SLIDERS[2]);

    // Decode toggled plate indices
    const toggledIndices = [];
    if (toggleStr) {
        for (let i = 0; i < toggleStr.length; i += IDX_CHARS) {
            const idx = parseInt(toggleStr.slice(i, i + IDX_CHARS), 36);
            if (isNaN(idx) || idx >= P) return null;
            toggledIndices.push(idx);
        }
    }

    return {
        seed,
        N:                fromIndex(nIdx,     SLIDERS[0]),
        jitter:           fromIndex(jIdx,     SLIDERS[1]),
        P,
        numContinents:    fromIndex(cnIdx,    SLIDERS[3]),
        roughness:        fromIndex(nsIdx,    SLIDERS[4]),
        terrainWarp:      fromIndex(twIdx,    SLIDERS[11]),
        smoothing:        fromIndex(smIdx,    SLIDERS[5]),
        glacialErosion:   fromIndex(glIdx,    SLIDERS[6]),
        hydraulicErosion: fromIndex(heIdx,    SLIDERS[7]),
        thermalErosion:   fromIndex(teIdx,    SLIDERS[8]),
        ridgeSharpening:  fromIndex(rsIdx,    SLIDERS[9]),
        soilCreep:        fromIndex(scIdx,    SLIDERS[10]),
        gravity:          fromIndex(gravIdx,  SLIDERS[12]),
        atmosphere:       fromIndex(atmIdx,   SLIDERS[13]),
        hydrosphere:      fromIndex(hydroIdx, SLIDERS[14]),
        baseTemp:         fromIndex(btIdx,    SLIDERS[15]),
        axialTilt:        fromIndex(tiltIdx,  SLIDERS[16]),
        moonCount:        fromIndex(moonIdx,   SLIDERS[17]),
        toggledIndices,
    };
}
