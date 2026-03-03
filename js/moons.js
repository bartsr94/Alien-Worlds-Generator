// Procedural moon rendering — builds a THREE.Group of 0-3 moon meshes positioned
// around the planet (which sits at the origin with radius ~1.0).
//
// Usage:
//   import { updateMoons } from './moons.js';
//   updateMoons(seed, count, planetaryParams);   // call in generate-done handler
//
// Moons are visual-only and do not affect planet generation in any way.

import * as THREE from 'three';
import { scene, sun } from './scene.js';

// ---------------------------------------------------------------------------
// Module-level group — added to the scene once, children rebuilt each call.
// ---------------------------------------------------------------------------
export const moonGroup = new THREE.Group();
scene.add(moonGroup);

// ---------------------------------------------------------------------------
// Orbital layout — three fixed slots (inner, mid, outer)
// ---------------------------------------------------------------------------
const ORBITAL_DISTANCES = [2.3, 3.05, 3.95]; // planet-radii

// Moon sizes (planet-radii) at each slot with a seed-driven ±variation applied
const MOON_BASE_SIZES   = [0.155, 0.105, 0.072];
const MOON_SIZE_VARY    = [0.040, 0.030, 0.022]; // ± variance

// ---------------------------------------------------------------------------
// Seeded PRNG (Park-Miller, same as rng.js pattern)
// ---------------------------------------------------------------------------
function makeRng(seed) {
    let s = (seed >>> 0) + 1;
    return function () {
        s = Math.imul(s, 1664525) + 1013904223 >>> 0;
        return s / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Moon surface ShaderMaterial
// ---------------------------------------------------------------------------
// Fragment shader uses value-noise in 3-D to generate albedo variation: large
// plains/basins + medium-scale roughness + small-scale grain.  Phong lighting from
// the scene directional light (sun) with a sharp terminator (no atmosphere).
const MOON_VERT = `
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormal   = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const MOON_FRAG = `
uniform vec3  sunDir;
uniform vec3  baseColor;
uniform vec3  darkColor;
uniform float noiseSeed;

varying vec3 vWorldPos;
varying vec3 vNormal;

// Value noise helpers -------------------------------------------------------
float hash(vec3 p) {
    p  = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float v000 = hash(i);
    float v100 = hash(i + vec3(1,0,0));
    float v010 = hash(i + vec3(0,1,0));
    float v110 = hash(i + vec3(1,1,0));
    float v001 = hash(i + vec3(0,0,1));
    float v101 = hash(i + vec3(1,0,1));
    float v011 = hash(i + vec3(0,1,1));
    float v111 = hash(i + vec3(1,1,1));
    return mix(
        mix(mix(v000,v100,f.x), mix(v010,v110,f.x), f.y),
        mix(mix(v001,v101,f.x), mix(v011,v111,f.x), f.y),
        f.z);
}
// ---------------------------------------------------------------------------

void main() {
    vec3 n   = normalize(vNormal);
    vec3 sd  = normalize(sunDir);

    // Noise: use normalised world position offset by per-moon seed
    vec3 np  = normalize(vWorldPos) * 3.5 + vec3(noiseSeed, noiseSeed * 0.7, noiseSeed * 1.3);
    float n1 = noise3(np);               // large plains / basins
    float n2 = noise3(np * 4.0) * 0.35; // medium roughness
    float n3 = noise3(np * 12.0) * 0.12; // fine grain

    float pattern = n1 + n2 + n3; // 0 → ~1.47

    // Surface color: blend between baseColor (highlands) and darkColor (basins)
    float t  = smoothstep(0.38, 0.78, pattern);
    vec3 col = mix(darkColor, baseColor, t);

    // Phong diffuse — sharp terminator (no atmospheric scattering)
    float diff    = max(0.0, dot(n, sd));
    float ambient = 0.12;
    float light   = ambient + (1.0 - ambient) * pow(diff, 0.85);

    gl_FragColor  = vec4(col * light, 1.0);
}`;

function makeMoonMaterial(baseColor, darkColor, noiseSeed) {
    return new THREE.ShaderMaterial({
        uniforms: {
            sunDir:    { value: sun.position.clone().normalize() },
            baseColor: { value: new THREE.Color(baseColor[0], baseColor[1], baseColor[2]) },
            darkColor: { value: new THREE.Color(darkColor[0], darkColor[1], darkColor[2]) },
            noiseSeed: { value: noiseSeed },
        },
        vertexShader:   MOON_VERT,
        fragmentShader: MOON_FRAG,
    });
}

// ---------------------------------------------------------------------------
// Color selection based on world type
// ---------------------------------------------------------------------------
function moonColors(params) {
    const biomeMode = params?.biomeMode ?? 'earth';
    const temp      = params?.baseTemp  ?? 15;
    const hydro     = params?.hydrosphere ?? 3;

    if (biomeMode === 'ice' || temp < -80 || hydro >= 4) {
        // Icy moon: Europa/Callisto style — pale blue-white with grey-blue shadow
        return {
            base: [0.82, 0.88, 0.95],
            dark: [0.42, 0.52, 0.68],
        };
    }
    if (biomeMode === 'arid' && temp > 80) {
        // Hot rocky moon: warm tan regolith
        return {
            base: [0.65, 0.56, 0.44],
            dark: [0.30, 0.24, 0.18],
        };
    }
    if (biomeMode === 'arid' || biomeMode === 'barren') {
        // Standard rocky/cratered moon: grey with slight warmth
        return {
            base: [0.52, 0.50, 0.47],
            dark: [0.22, 0.20, 0.18],
        };
    }
    if (biomeMode === 'alien') {
        // Alien world moon: darker, slightly tinted
        return {
            base: [0.45, 0.42, 0.38],
            dark: [0.18, 0.16, 0.14],
        };
    }
    // Earth-like / ocean / default: standard grey moon
    return {
        base: [0.55, 0.53, 0.50],
        dark: [0.24, 0.22, 0.20],
    };
}

// ---------------------------------------------------------------------------
// Public API — rebuild the moonGroup for the given parameters
// ---------------------------------------------------------------------------

/**
 * Build/rebuild the moon meshes for the current planet.
 * Call after every generation via the generate-done handler.
 *
 * @param {number} seed    - Planet seed (drives moon positions and sizes).
 * @param {number} count   - Number of moons to show (0–3).
 * @param {object} params  - state.planetaryParams (biomeMode, baseTemp, etc.).
 */
export function updateMoons(seed, count, params) {
    // Clear previous moons
    for (const child of [...moonGroup.children]) {
        child.geometry.dispose();
        child.material.dispose();
    }
    moonGroup.clear();

    if (count <= 0) return;

    const rng    = makeRng(seed ^ 0xDEADBEEF);
    const colors = moonColors(params);
    const axialTiltRad = ((params?.axialTilt ?? 23.5) * Math.PI) / 180;

    // Orbital plane tilt axis: rotate around Z by axial tilt so moons sit
    // roughly in the planet's equatorial plane.
    const orbitTiltAxis = new THREE.Vector3(0, 0, 1);

    const slotsNeeded = Math.min(count, 3);
    for (let i = 0; i < slotsNeeded; i++) {
        const dist    = ORBITAL_DISTANCES[i];
        const size    = MOON_BASE_SIZES[i] + (rng() - 0.5) * 2 * MOON_SIZE_VARY[i];
        const phase   = rng() * Math.PI * 2;           // azimuthal angle in orbit
        const incl    = (rng() - 0.5) * 0.35;         // slight orbital inclination variation (±0.18 rad)
        const nSeed   = rng() * 47.3 + i * 11.7;      // per-moon noise offset

        // 3-D position: orbit in the XZ plane, tilted by axial tilt + inclination
        const cosP = Math.cos(phase);
        const sinP = Math.sin(phase);
        // Start in XZ plane
        let px = dist * cosP;
        let py = 0;
        let pz = dist * sinP;

        // Apply axial tilt rotation (around Z axis, leans the orbit toward Y)
        const cosT = Math.cos(axialTiltRad + incl);
        const sinT = Math.sin(axialTiltRad + incl);
        // Rotate around Z: affects X and Y
        const rpx = px * cosT - py * sinT;
        const rpy = px * sinT + py * cosT;
        px = rpx; py = rpy;

        // Slight secondary inclination twist (rotate around X by incl)
        const cosI = Math.cos(incl * 0.6);
        const sinI = Math.sin(incl * 0.6);
        const ry = py * cosI - pz * sinI;
        const rz = py * sinI + pz * cosI;
        py = ry; pz = rz;

        const geo = new THREE.SphereGeometry(size, 32, 24);
        const mat = makeMoonMaterial(
            [colors.base[0], colors.base[1], colors.base[2]],
            [colors.dark[0], colors.dark[1], colors.dark[2]],
            nSeed,
        );
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(px, py, pz);
        moonGroup.add(mesh);
    }
}
