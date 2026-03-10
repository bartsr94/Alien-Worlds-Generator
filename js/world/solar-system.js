/**
 * solar-system.js — Solar system body definitions and procedural system generator.
 *
 * Each body has:
 *   id            string   unique identifier
 *   name          string   display name
 *   type          'star'|'rocky'|'icy'|'gas'|'belt'
 *   orbitRadiusAU number   semi-major axis in AU (0 for the star itself)
 *   orbitalPeriodDays number  sidereal period in days
 *   eccentricity  number   orbital eccentricity
 *   inclination   number   orbital inclination in degrees (mostly decorative)
 *   radiusKm      number   mean radius in km (used for visual scaling only)
 *   parentId      string|null  id of parent body (for moons)
 *   params        object   { gravity, atmosphere, hydrosphere, baseTemp, axialTilt }
 *                          for rocky/icy worlds that can be fully generated.
 *                          null for stars, gas giants, and belt entries.
 */

// ── Our Solar System ─────────────────────────────────────────────────────────

export const OUR_SOLAR_SYSTEM = {
    name: 'Sol System',
    seed: 42,
    bodies: [
        {
            id: 'sun',
            name: 'Sun',
            type: 'star',
            orbitRadiusAU: 0,
            orbitalPeriodDays: 0,
            eccentricity: 0,
            inclination: 0,
            radiusKm: 696000,
            parentId: null,
            params: null,
        },
        {
            id: 'mercury',
            name: 'Mercury',
            type: 'rocky',
            orbitRadiusAU: 0.387,
            orbitalPeriodDays: 87.97,
            eccentricity: 0.206,
            inclination: 7.0,
            radiusKm: 2439,
            parentId: null,
            params: { gravity: 0.38, worldSize: 0.4, atmosphere: 0, hydrosphere: 0, baseTemp: 167, axialTilt: 0 },
        },
        {
            id: 'venus',
            name: 'Venus',
            type: 'rocky',
            orbitRadiusAU: 0.723,
            orbitalPeriodDays: 224.7,
            eccentricity: 0.007,
            inclination: 3.4,
            radiusKm: 6051,
            parentId: null,
            params: { gravity: 0.9, worldSize: 1.0, atmosphere: 5, hydrosphere: 0, baseTemp: 460, axialTilt: 177 },
        },
        {
            id: 'earth',
            name: 'Earth',
            type: 'rocky',
            orbitRadiusAU: 1.0,
            orbitalPeriodDays: 365.25,
            eccentricity: 0.017,
            inclination: 0.0,
            radiusKm: 6371,
            parentId: null,
            params: { gravity: 1.0, worldSize: 1.0, atmosphere: 3, hydrosphere: 3, baseTemp: 15, axialTilt: 23 },
        },
        {
            id: 'moon',
            name: 'Moon',
            type: 'rocky',
            orbitRadiusAU: 0.00257,  // ~384400 km in AU
            orbitalPeriodDays: 27.32,
            eccentricity: 0.055,
            inclination: 5.1,
            radiusKm: 1737,
            parentId: 'earth',
            params: { gravity: 0.17, worldSize: 0.3, atmosphere: 0, hydrosphere: 0, baseTemp: -20, axialTilt: 7 },
        },
        {
            id: 'mars',
            name: 'Mars',
            type: 'rocky',
            orbitRadiusAU: 1.524,
            orbitalPeriodDays: 686.97,
            eccentricity: 0.093,
            inclination: 1.9,
            radiusKm: 3390,
            parentId: null,
            params: { gravity: 0.38, worldSize: 0.5, atmosphere: 1, hydrosphere: 0, baseTemp: -60, axialTilt: 25 },
        },
        {
            id: 'phobos',
            name: 'Phobos',
            type: 'rocky',
            orbitRadiusAU: 0.0000627,
            orbitalPeriodDays: 0.319,
            eccentricity: 0.015,
            inclination: 1.1,
            radiusKm: 11,
            parentId: 'mars',
            params: { gravity: 0.1, worldSize: 0.1, atmosphere: 0, hydrosphere: 0, baseTemp: -40, axialTilt: 0 },
        },
        {
            id: 'deimos',
            name: 'Deimos',
            type: 'rocky',
            orbitRadiusAU: 0.000157,
            orbitalPeriodDays: 1.263,
            eccentricity: 0.0002,
            inclination: 0.9,
            radiusKm: 6,
            parentId: 'mars',
            params: { gravity: 0.1, worldSize: 0.1, atmosphere: 0, hydrosphere: 0, baseTemp: -40, axialTilt: 0 },
        },
        {
            id: 'asteroid_belt',
            name: 'Asteroid Belt',
            type: 'belt',
            orbitRadiusAU: 2.7,
            orbitalPeriodDays: 1620,
            eccentricity: 0,
            inclination: 0,
            radiusKm: 0,
            parentId: null,
            params: null,
        },
        {
            id: 'jupiter',
            name: 'Jupiter',
            type: 'gas',
            orbitRadiusAU: 5.203,
            orbitalPeriodDays: 4332.6,
            eccentricity: 0.049,
            inclination: 1.3,
            radiusKm: 69911,
            parentId: null,
            params: null,
        },
        {
            id: 'saturn',
            name: 'Saturn',
            type: 'gas',
            orbitRadiusAU: 9.537,
            orbitalPeriodDays: 10759.2,
            eccentricity: 0.057,
            inclination: 2.5,
            radiusKm: 58232,
            parentId: null,
            params: null,
        },
        {
            id: 'uranus',
            name: 'Uranus',
            type: 'gas',
            orbitRadiusAU: 19.19,
            orbitalPeriodDays: 30688.5,
            eccentricity: 0.046,
            inclination: 0.8,
            radiusKm: 25362,
            parentId: null,
            params: null,
        },
        {
            id: 'neptune',
            name: 'Neptune',
            type: 'gas',
            orbitRadiusAU: 30.07,
            orbitalPeriodDays: 60195,
            eccentricity: 0.010,
            inclination: 1.8,
            radiusKm: 24622,
            parentId: null,
            params: null,
        },
    ],
};

// ── Procedural Alien System Generator ────────────────────────────────────────

/**
 * lcg — tiny inline PRNG so this module has no dependencies.
 * Returns a seeded function that gives values in [0, 1).
 */
function makePrng(seed) {
    let s = (seed | 0) >>> 0 || 1;
    return function() {
        s = Math.imul(s, 1664525) + 1013904223 | 0;
        return (s >>> 0) / 4294967296;
    };
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function rrange(rng, lo, hi) { return lo + rng() * (hi - lo); }

/** Star type definitions: { name, color hex string, luminosityRelative } */
const STAR_TYPES = [
    { name: 'M-class Red Dwarf',   color: '#ff7755', lum: 0.04  },
    { name: 'K-class Orange Star', color: '#ffaa66', lum: 0.40  },
    { name: 'G-class Yellow Star', color: '#fff8aa', lum: 1.0   },
    { name: 'F-class Yellow-White',color: '#ffffdd', lum: 2.5   },
    { name: 'A-class White Star',  color: '#ddeeff', lum: 10.0  },
    { name: 'Binary G+K',          color: '#fff099', lum: 1.3   },
];

/**
 * Derive approximate equilibrium surface temperature for a rocky body
 * given luminosity (relative to Sol) and orbital radius (AU), plus a bias.
 */
function equilibriumTemp(lum, orbitAU, atmLevel) {
    // Simple flux model: T ∝ lum^0.25 / sqrt(AU) in Earth units.
    // Earth at 1 AU with lum=1 → ~15°C.  Very rough!
    const flux   = lum / (orbitAU * orbitAU);
    const tEq    = 15 + 250 * (Math.sqrt(flux) - 1);
    // Atmosphere boosts temps
    const greenhouseBoost = [0, 5, 20, 40, 100, 450][atmLevel] || 0;
    return Math.round(tEq + greenhouseBoost);
}

/**
 * Generate a random alien solar system.
 * @param {number} seed  Any integer — determines all body properties.
 * @returns {{ name, seed, star: object, bodies: object[] }}
 */
export function generateSystem(seed) {
    const rng  = makePrng(seed);
    const star = pick(rng, STAR_TYPES);

    // Number of major rocky/icy bodies (not counting moons or the belt)
    const numRocky = 3 + Math.floor(rng() * 5); // 3–7
    const numGas   = Math.floor(rng() * 4);      // 0–3
    const hasBelt  = rng() > 0.4;

    const bodies = [
        {
            id: 'star',
            name: 'Star',
            type: 'star',
            orbitRadiusAU: 0,
            orbitalPeriodDays: 0,
            eccentricity: 0,
            inclination: 0,
            radiusKm: 400000 + Math.floor(rng() * 500000),
            parentId: null,
            params: null,
            starColor: star.color,
        },
    ];

    // Place rocky planets on roughly log-spaced orbits inside 3 AU
    const rockyAUs = [];
    {
        let au = 0.2 + rng() * 0.3;
        for (let i = 0; i < numRocky; i++) {
            rockyAUs.push(au);
            au *= 1.3 + rng() * 0.8; // Titius–Bode-style spacing
        }
    }

    for (let i = 0; i < numRocky; i++) {
        const au       = rockyAUs[i];
        const atm      = Math.floor(rng() * 6);
        const hydro    = au < 0.8 || au > 2.5 ? Math.floor(rng() * 2) : Math.floor(rng() * 5);
        const grav     = parseFloat((0.1 + rng() * 2.9).toFixed(2));
        const tilt     = Math.floor(rng() * 80);
        const baseTemp = equilibriumTemp(star.lum, au, atm);
        const period   = 365.25 * Math.pow(au / 1.0, 1.5) * Math.pow(1.0 / 1.0, 0.5);
        const ecc      = parseFloat((rng() * 0.2).toFixed(3));
        const radiusKm = Math.round(2000 + rng() * 8000);
        const bodyId   = `planet_${i + 1}`;
        const bodyName = `Planet ${romanNumeral(i + 1)}`;
        const ws       = parseFloat(Math.max(0.1, Math.min(3.0, radiusKm / 6371)).toFixed(1));

        // Classify as icy if very cold
        const type = baseTemp < -80 ? 'icy' : 'rocky';

        bodies.push({
            id:               bodyId,
            name:             bodyName,
            type,
            orbitRadiusAU:    au,
            orbitalPeriodDays: Math.round(period * 10) / 10,
            eccentricity:     ecc,
            inclination:      parseFloat((rng() * 8).toFixed(1)),
            radiusKm,
            parentId:         null,
            params:           { gravity: grav, worldSize: ws, atmosphere: atm, hydrosphere: hydro, baseTemp, axialTilt: tilt },
        });

        // Generate 0–2 moons per rocky planet
        const numMoons = Math.floor(rng() * 3);
        for (let m = 0; m < numMoons; m++) {
            const moonRkm  = Math.round(200 + rng() * Math.min(radiusKm * 0.4, 2000));
            const moonWS   = parseFloat(Math.max(0.1, Math.min(1.0, moonRkm / 6371)).toFixed(1));
            const moonGrav = parseFloat(Math.max(0.1, Math.min(1.0, moonWS * (0.7 + rng() * 0.5))).toFixed(2));
            const moonAtm  = rng() < 0.08 ? 1 : 0;
            const moonTemp = Math.round(baseTemp + (rng() - 0.5) * 20);
            bodies.push({
                id:               `${bodyId}_moon_${m + 1}`,
                name:             `${bodyName} ${['\u03b1', '\u03b2', '\u03b3'][m]}`,
                type:             'rocky',
                orbitRadiusAU:    0,
                orbitalPeriodDays: parseFloat((1 + rng() * 40).toFixed(1)),
                eccentricity:     parseFloat((rng() * 0.1).toFixed(3)),
                inclination:      parseFloat((rng() * 15).toFixed(1)),
                radiusKm:         moonRkm,
                parentId:         bodyId,
                params:           { gravity: moonGrav, worldSize: moonWS, atmosphere: moonAtm, hydrosphere: 0, baseTemp: moonTemp, axialTilt: Math.floor(rng() * 20) },
            });
        }
    }

    // Optional asteroid belt between last rocky and first gas
    const lastRockyAU = rockyAUs[rockyAUs.length - 1];
    if (hasBelt) {
        const beltAU = lastRockyAU * (1.4 + rng() * 0.4);
        bodies.push({
            id: 'belt',
            name: 'Asteroid Belt',
            type: 'belt',
            orbitRadiusAU: beltAU,
            orbitalPeriodDays: Math.round(365.25 * Math.pow(beltAU, 1.5)),
            eccentricity: 0,
            inclination: 0,
            radiusKm: 0,
            parentId: null,
            params: null,
        });
    }

    // Gas giants beyond the belt (~4 AU onwards for this system)
    {
        const gasColors = ['#c8a87a', '#d4b896', '#e8cfa0', '#aab8d0'];
        let au = lastRockyAU * (2.0 + rng() * 1.5);
        for (let i = 0; i < numGas; i++) {
            bodies.push({
                id: `gas_${i + 1}`,
                name: `Gas Giant ${romanNumeral(i + 1)}`,
                type: 'gas',
                orbitRadiusAU: au,
                orbitalPeriodDays: Math.round(365.25 * Math.pow(au, 1.5)),
                eccentricity: parseFloat((rng() * 0.1).toFixed(3)),
                inclination: parseFloat((rng() * 4).toFixed(1)),
                radiusKm: Math.round(30000 + rng() * 60000),
                parentId: null,
                params: null,
                gasColor: gasColors[i % gasColors.length],
            });
            au *= 1.8 + rng() * 1.2;
        }
    }

    // Sort non-moon bodies by orbital radius, then insert moons after their parent
    bodies.sort((a, b) => {
        if (a.parentId && !b.parentId) return 1;
        if (!a.parentId && b.parentId) return -1;
        return a.orbitRadiusAU - b.orbitRadiusAU;
    });
    const finalBodies = [];
    for (const b of bodies) { if (!b.parentId) finalBodies.push(b); }
    for (const b of bodies) {
        if (b.parentId) {
            const pIdx = finalBodies.findIndex(s => s.id === b.parentId);
            if (pIdx >= 0) finalBodies.splice(pIdx + 1, 0, b);
        }
    }

    const systemName = generateSystemName(rng);

    return { name: systemName, seed, star, bodies: finalBodies };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
function romanNumeral(n) { return ROMAN[n - 1] || String(n); }

const SYLLABLES     = ['Ar','Vel','Tor','Maz','Kel','Dun','Syr','Nox','Zor','Tar','Rin','Myr',
                        'Gal','Ven','Kon','Ath','Sol','Eld','Yor','Brin'];
const SUFFIXES      = ['is','a','on','us','ax','en','or','ia','ix','um'];
function generateSystemName(rng) {
    const s1  = SYLLABLES[Math.floor(rng() * SYLLABLES.length)];
    const s2  = SYLLABLES[Math.floor(rng() * SYLLABLES.length)];
    const suf = SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
    return `${s1}${s2.toLowerCase()}${suf}`;
}
