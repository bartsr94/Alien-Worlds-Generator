/**
 * orrery.js — 2D top-down solar system orrery (Three.js orthographic view).
 *
 * Planets orbit in the XZ plane; the orrery camera looks down from +Y.
 * Orbital radii are log-scaled so inner and outer planets are both visible.
 *
 * Exported API:
 *   initOrrery(system)          Build the orrery scene for a given system.
 *   tickOrrery(gameDays)        Re-solve Kepler equations and reposition bodies.
 *   enterOrrery()               Make the orrery group visible.
 *   exitOrrery()                Hide the orrery group.
 *   getBodyAtMouse(event)       Returns the bodyId under the cursor, or null.
 *   getBodyPosition(id)         Returns { x, z } world position of a body.
 *   updateOrreryLabels()        Sync HTML label overlay to current 3D positions.
 */

import * as THREE from 'three';
import { scene, orreryCamera, canvas } from './render/scene.js';

// ── Module-level state ────────────────────────────────────────────────────────

export const orreryGroup = new THREE.Group();
scene.add(orreryGroup);

let _system    = null;              // current system object
let _bodyMeshes = new Map();        // bodyId → THREE.Mesh
let _meanAnoms  = new Map();        // bodyId → current mean anomaly (radians)
let _raycaster  = new THREE.Raycaster();
let _mouse      = new THREE.Vector2();
let _labelContainer = null;        // #orreryLabels div (set in initOrrery)

// ── Scale helpers ─────────────────────────────────────────────────────────────

/**
 * Map orbital radius (AU) to a scene radius.
 * Log scaling so Mercury (~0.4 AU) and Neptune (~30 AU) coexist.
 * Scale factor tuned so Earth (~1 AU) ≈ 0.8 scene units.
 */
function auToScene(au) {
    if (au <= 0) return 0;
    return Math.log1p(au * 3.0) * 0.6;
}

/** Visual disc radius for a body (scene units). */
function bodyVisualRadius(body) {
    if (body.type === 'star') return 0.10;
    if (body.type === 'gas')  return 0.025 + (body.radiusKm / 70000) * 0.045;
    if (body.type === 'belt') return 0;
    // rocky/icy: minimum 0.008 so tiny moons are still clickable
    return Math.max(0.008, 0.006 + (body.radiusKm / 7000) * 0.022);
}

// ── Colors ────────────────────────────────────────────────────────────────────

const BODY_COLORS = {
    star:  0xffee88,
    rocky: 0xcc7744,
    icy:   0x88ccee,
    gas:   0xc8a87a,
    belt:  0x888866,
};

// ── Kepler solver ─────────────────────────────────────────────────────────────

/**
 * Solve Kepler's equation M = E - e·sin(E) for eccentric anomaly E
 * using Newton-Raphson iteration.
 */
function solveKepler(M, e, maxIter = 8) {
    let E = M; // initial guess
    for (let i = 0; i < maxIter; i++) {
        const dE = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
        E += dE;
        if (Math.abs(dE) < 1e-8) break;
    }
    return E;
}

/**
 * Compute (x, z) position on the orbit given current mean anomaly (radians),
 * eccentricity, and scene-space semi-major axis.
 */
function orbitPosition(meanAnom, ecc, semiMajor) {
    const E    = solveKepler(meanAnom, ecc);
    const xOvA = Math.cos(E) - ecc;
    const yOvB = Math.sqrt(1 - ecc * ecc) * Math.sin(E);
    return { x: semiMajor * xOvA, z: semiMajor * yOvB };
}

// ── Orbit ring geometry ───────────────────────────────────────────────────────

function buildOrbitRing(body, segments = 180) {
    const a   = auToScene(body.orbitRadiusAU);
    if (a === 0) return null;
    const ecc = body.eccentricity;
    const b   = a * Math.sqrt(1 - ecc * ecc);   // semi-minor axis
    const pts = [];
    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(a * Math.cos(t) - a * ecc, 0, b * Math.sin(t)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);

    let color, opacity;
    if (body.type === 'gas') { color = 0x445566; opacity = 0.35; }
    else if (body.type === 'belt') { color = 0x554433; opacity = 0.25; }
    else { color = 0x334455; opacity = 0.55; }

    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    return new THREE.LineLoop(geo, mat);
}

// ── Belt ring ─────────────────────────────────────────────────────────────────

function buildBeltRing(body) {
    const r     = auToScene(body.orbitRadiusAU);
    const width = r * 0.15;
    const geo   = new THREE.RingGeometry(r - width * 0.5, r + width * 0.5, 120);
    const mat   = new THREE.MeshBasicMaterial({
        color: 0x776655, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
}

// ── Star glow ─────────────────────────────────────────────────────────────────

function buildStarMesh(body) {
    const color = body.starColor ? parseInt(body.starColor.replace('#', ''), 16) : 0xffee88;
    // Core disc
    const geo = new THREE.CircleGeometry(bodyVisualRadius(body), 32);
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0, 0);

    // Soft glow (larger, more transparent)
    const glowGeo = new THREE.CircleGeometry(bodyVisualRadius(body) * 2.8, 32);
    const glowMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    mesh.add(glow);

    return mesh;
}

// ── Body disc mesh ────────────────────────────────────────────────────────────

function buildBodyMesh(body) {
    if (body.type === 'star') return buildStarMesh(body);
    if (body.type === 'belt') return buildBeltRing(body);

    const color   = body.gasColor
        ? parseInt(body.gasColor.replace('#', ''), 16)
        : BODY_COLORS[body.type] ?? 0xaaaaaa;
    const r       = bodyVisualRadius(body);
    const geo     = new THREE.CircleGeometry(r, 24);
    const mat     = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const mesh    = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
}

// ── HTML Label helpers ────────────────────────────────────────────────────────

function ensureLabelContainer() {
    let el = document.getElementById('orreryLabels');
    if (!el) {
        el = document.createElement('div');
        el.id = 'orreryLabels';
        document.body.appendChild(el);
    }
    _labelContainer = el;
}

function clearLabels() {
    if (_labelContainer) _labelContainer.innerHTML = '';
}

function createLabel(body) {
    if (!_labelContainer) return null;
    const div  = document.createElement('div');
    div.className = 'orrery-label';
    div.textContent = body.name;
    div.dataset.bodyId = body.id;
    _labelContainer.appendChild(div);
    return div;
}

/**
 * Project 3D world positions onto screen space and reposition the HTML labels.
 * Call this every frame while the orrery is active.
 */
export function updateOrreryLabels() {
    if (!_labelContainer || !_system) return;
    const canvas = document.getElementById('canvas');
    const halfW  = canvas.clientWidth  / 2;
    const halfH  = canvas.clientHeight / 2;
    const labels = _labelContainer.querySelectorAll('.orrery-label');

    labels.forEach(label => {
        const id   = label.dataset.bodyId;
        const mesh = _bodyMeshes.get(id);
        if (!mesh) { label.style.display = 'none'; return; }

        // Belt rings are RingGeometry centred at origin — their mesh.position is
        // (0,0,0) which coincides with the star.  Use the stored orbit radius to
        // place the label at a fixed point on the ring instead.
        let pos3D = new THREE.Vector3();
        if (mesh.userData.bodyType === 'belt') {
            pos3D.set(auToScene(mesh.userData.orbitRadiusAU), 0, 0);
        } else {
            mesh.getWorldPosition(pos3D);
        }
        pos3D.project(orreryCamera);

        const sx = (pos3D.x + 1) * halfW;
        const sy = (-pos3D.y + 1) * halfH;

        label.style.display  = '';
        label.style.left     = `${sx + 8}px`;
        label.style.top      = `${sy - 6}px`;
    });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the orrery scene for the given system.
 * Disposes any previously built orrery objects.
 */
export function initOrrery(system) {
    // Clean up previous orrery
    while (orreryGroup.children.length > 0) {
        const c = orreryGroup.children[0];
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
        orreryGroup.remove(c);
    }
    _bodyMeshes.clear();
    _meanAnoms.clear();
    clearLabels();

    _system = system;
    ensureLabelContainer();

    for (const body of system.bodies) {
        if (body.parentId) {
            // Moon: small disc parented to orreryGroup, no orbit ring
            const mesh = buildBodyMesh(body);
            mesh.userData.bodyId    = body.id;
            mesh.userData.bodyType  = body.type;
            mesh.userData.parentId  = body.parentId;
            orreryGroup.add(mesh);
            _bodyMeshes.set(body.id, mesh);
            const seed = body.id.charCodeAt(0) + (body.id.charCodeAt(1) || 0);
            _meanAnoms.set(body.id, (seed * 1.618) % (Math.PI * 2));
            const lbl = createLabel(body);
            if (lbl) lbl.classList.add('orrery-moon-label');
            continue;
        }

        // Orbit ring
        const ring = buildOrbitRing(body);
        if (ring) orreryGroup.add(ring);

        // Body mesh / disc
        const mesh = buildBodyMesh(body);
        mesh.userData.bodyId         = body.id;
        mesh.userData.bodyType       = body.type;
        mesh.userData.orbitRadiusAU  = body.orbitRadiusAU;
        orreryGroup.add(mesh);
        _bodyMeshes.set(body.id, mesh);

        // Initial mean anomaly — random starting phase per body
        const seed = body.id.charCodeAt(0) + (body.id.charCodeAt(1) || 0);
        _meanAnoms.set(body.id, (seed * 1.618) % (Math.PI * 2));

        // HTML label
        createLabel(body);
    }

    // Tick once to set initial positions
    tickOrrery(0);
}

/**
 * Advance body positions by `gameDaysDelta` days.
 * Call once per real frame while the orrery is active.
 */
export function tickOrrery(gameDaysDelta) {
    if (!_system) return;

    // First pass: advance all non-moon bodies
    for (const body of _system.bodies) {
        if (body.parentId) continue;
        if (body.type === 'star' || body.type === 'belt') continue;
        if (!body.orbitalPeriodDays || body.orbitalPeriodDays <= 0) continue;

        const mesh = _bodyMeshes.get(body.id);
        if (!mesh) continue;

        // Advance mean anomaly
        const dM = (gameDaysDelta / body.orbitalPeriodDays) * Math.PI * 2;
        const M  = ((_meanAnoms.get(body.id) || 0) + dM) % (Math.PI * 2);
        _meanAnoms.set(body.id, M);

        // Solve Kepler + set position
        const a   = auToScene(body.orbitRadiusAU);
        const pos = orbitPosition(M, body.eccentricity, a);
        mesh.position.set(pos.x, 0, pos.z);
    }

    // Second pass: position moons relative to their parent
    const MOON_ORBIT_R = 0.055;
    for (const body of _system.bodies) {
        if (!body.parentId) continue;
        if (!body.orbitalPeriodDays || body.orbitalPeriodDays <= 0) continue;

        const mesh       = _bodyMeshes.get(body.id);
        const parentMesh = _bodyMeshes.get(body.parentId);
        if (!mesh || !parentMesh) continue;

        const dM = (gameDaysDelta / body.orbitalPeriodDays) * Math.PI * 2;
        const M  = ((_meanAnoms.get(body.id) || 0) + dM) % (Math.PI * 2);
        _meanAnoms.set(body.id, M);

        // Simple circular orbit around parent disc
        mesh.position.set(
            parentMesh.position.x + MOON_ORBIT_R * Math.cos(M),
            0,
            parentMesh.position.z + MOON_ORBIT_R * Math.sin(M)
        );
    }

    updateOrreryLabels();
}

/**
 * Make the orrery visible and enable its controls.
 */
export function enterOrrery() {
    orreryGroup.visible = true;
    if (_labelContainer) _labelContainer.style.display = '';
    // Show the system bar (speed controls)
    const bar = document.getElementById('systemBar');
    if (bar) bar.classList.remove('hidden');
}

/**
 * Hide the orrery and its overlay labels.
 */
export function exitOrrery() {
    orreryGroup.visible = false;
    if (_labelContainer) _labelContainer.style.display = 'none';
    const bar = document.getElementById('systemBar');
    if (bar) bar.classList.add('hidden');
}

/**
 * Given a mouse event, returns the bodyId of the body under the cursor,
 * or null if nothing is hit.
 * @param {MouseEvent} event
 */
export function getBodyAtMouse(event) {
    const c    = document.getElementById('canvas');
    const rect = c.getBoundingClientRect();
    _mouse.x = ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    _mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;

    _raycaster.setFromCamera(_mouse, orreryCamera);
    const targets = [];
    _bodyMeshes.forEach((mesh, id) => {
        const body = _system?.bodies.find(b => b.id === id);
        if (body && body.type !== 'belt') targets.push(mesh);
    });

    // Expand hit area for small bodies using a threshold approach
    const hits = _raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return null;

    let obj = hits[0].object;
    while (obj && !obj.userData.bodyId) obj = obj.parent;
    return obj?.userData.bodyId ?? null;
}

/**
 * Returns the current world-space { x, z } of the named body.
 * Returns { x:0, z:0 } for the star or unknown IDs.
 */
export function getBodyPosition(id) {
    const mesh = _bodyMeshes.get(id);
    if (!mesh) return { x: 0, z: 0 };
    return { x: mesh.position.x, z: mesh.position.z };
}
