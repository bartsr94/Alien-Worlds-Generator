// Three.js scene setup: renderer, cameras, controls, lights, atmosphere, water, stars.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const canvas   = document.getElementById('canvas');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

export const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x030308);

export const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 200);
camera.position.set(0, 0.4, 2.8);

export const ctrl = new OrbitControls(camera, canvas);
ctrl.enableDamping = true; ctrl.dampingFactor = 0.06;
ctrl.enablePan = false;
ctrl.minDistance = 1.4; ctrl.maxDistance = 8;
ctrl.enableZoom = false; // disable built-in zoom; custom handler below

// Smooth zoom: wheel sets a target distance, each frame lerps toward it
let _zoomTarget = camera.position.distanceTo(ctrl.target);
const ZOOM_STEP   = 0.92;   // multiplier per tick (lower = faster zoom)
const ZOOM_SMOOTH = 0.12;   // lerp speed per frame (higher = snappier)

canvas.addEventListener('wheel', (e) => {
    if (!ctrl.enabled) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    _zoomTarget *= dir > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    _zoomTarget = THREE.MathUtils.clamp(_zoomTarget, ctrl.minDistance, ctrl.maxDistance);
}, { passive: false });

// Pinch-to-zoom for globe (touch)
let _pinchDist = 0;
canvas.addEventListener('touchstart', (e) => {
    if (!ctrl.enabled || e.touches.length !== 2) { _pinchDist = 0; return; }
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    _pinchDist = Math.sqrt(dx * dx + dy * dy);
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
    if (!ctrl.enabled || e.touches.length !== 2 || _pinchDist === 0) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ratio = _pinchDist / dist;
    _zoomTarget *= ratio;
    _zoomTarget = THREE.MathUtils.clamp(_zoomTarget, ctrl.minDistance, ctrl.maxDistance);
    _pinchDist = dist;
}, { passive: true });

canvas.addEventListener('touchend', () => { _pinchDist = 0; }, { passive: true });

export function tickZoom() {
    const v = new THREE.Vector3().subVectors(camera.position, ctrl.target);
    const cur = v.length();
    const next = THREE.MathUtils.lerp(cur, _zoomTarget, ZOOM_SMOOTH);
    if (Math.abs(next - cur) < 0.0001) return;
    v.setLength(next);
    camera.position.copy(ctrl.target).add(v);
}

scene.add(new THREE.AmbientLight(0xaabbcc, 3.5));
export const sun = new THREE.DirectionalLight(0xfff8ee, 1.5);
sun.position.set(5, 3, 4);
scene.add(sun);

// Stars
export let starsMesh;
{ const g=new THREE.BufferGeometry(),p=[];
  for(let i=0;i<3000;i++){const th=Math.random()*Math.PI*2,ph=Math.acos(2*Math.random()-1),r=40+Math.random()*30;
    p.push(r*Math.sin(ph)*Math.cos(th),r*Math.sin(ph)*Math.sin(th),r*Math.cos(ph));}
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  starsMesh = new THREE.Points(g,new THREE.PointsMaterial({color:0xffffff,size:0.08}));
  scene.add(starsMesh); }

// Atmosphere
const atmosMat = new THREE.ShaderMaterial({
    uniforms:{c:{value:new THREE.Color(0.35,0.6,1.0)}},
    vertexShader:`varying vec3 vN,vP;void main(){vN=normalize(normalMatrix*normal);vP=(modelViewMatrix*vec4(position,1)).xyz;gl_Position=projectionMatrix*vec4(vP,1);}`,
    fragmentShader:`uniform vec3 c;varying vec3 vN,vP;void main(){float r=1.0-max(0.0,dot(normalize(-vP),vN));gl_FragColor=vec4(c,pow(r,3.5)*0.55);}`,
    transparent:true,side:THREE.FrontSide,depthWrite:false
});
export const atmosMesh = new THREE.Mesh(new THREE.SphereGeometry(1.12,64,64), atmosMat);
scene.add(atmosMesh);

/** Update the atmosphere rim glow color and visibility.
 *  @param {number[]} rgb  [r, g, b] in 0–1; pass null or [0,0,0] to hide. */
export function updateAtmosphereColor(rgb) {
    if (!rgb || (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0)) {
        atmosMesh.visible = false;
    } else {
        atmosMesh.visible = true;
        atmosMat.uniforms.c.value.setRGB(rgb[0], rgb[1], rgb[2]);
    }
}

// Water sphere
const waterMat = new THREE.MeshPhongMaterial({
    color:0x0c3a6e, transparent:true, opacity:0.55,
    shininess:120, specular:0x4488bb, depthWrite:false
});
export const waterMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0,80,80), waterMat);
scene.add(waterMesh);

/** Update the water sphere color and visibility.
 *  @param {number[]|null} rgb  [r, g, b] in 0–1; pass null to hide. */
export function updateWaterColor(rgb) {
    if (!rgb) {
        waterMesh.visible = false;
    } else {
        waterMesh.visible = true;
        waterMat.color.setRGB(rgb[0], rgb[1], rgb[2]);
    }
}

// Atmospheric haze sphere — covers the full planet disc for dense atmospheres.
// Rendered at r=1.01 so it sits above terrain and water.  Unlike the rim-only
// atmosMesh (r=1.12, limb-only glow), this sphere is visible across the whole
// face of the globe and is used for Thick/Crushing/Titan-cold atmosphere types.
const hazeMat = new THREE.ShaderMaterial({
    uniforms: {
        hazeColor:   { value: new THREE.Color(0.35, 0.6, 1.0) },
        hazeOpacity: { value: 0.0 },
    },
    vertexShader: [
        'varying vec3 vNormal;',
        'varying vec3 vViewDir;',
        'void main() {',
        '  vNormal = normalize(normalMatrix * normal);',
        '  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);',
        '  vViewDir = normalize(-mvPos.xyz);',
        '  gl_Position = projectionMatrix * mvPos;',
        '}',
    ].join('\n'),
    fragmentShader: [
        'uniform vec3  hazeColor;',
        'uniform float hazeOpacity;',
        'varying vec3  vNormal;',
        'varying vec3  vViewDir;',
        'void main() {',
        '  // Limb brightening: haze column is thicker at grazing angles,',
        '  // giving an aerial-perspective appearance at the planet edge.',
        '  float rim = 1.0 - max(0.0, dot(vNormal, vViewDir));',
        '  float alpha = hazeOpacity * (1.0 + rim * rim * 0.7);',
        '  gl_FragColor = vec4(hazeColor, min(1.0, alpha));',
        '}',
    ].join('\n'),
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
});
export const hazeMesh = new THREE.Mesh(new THREE.SphereGeometry(1.01, 64, 64), hazeMat);
hazeMesh.visible = false;
scene.add(hazeMesh);

/**
 * Update the atmospheric haze layer — the full-disc opacity layer on the globe.
 * @param {number}        opacity  0 = clear; 1 = fully opaque.  From params.hazeOpacity.
 * @param {number[]|null} rgb      [r, g, b] in 0–1.  Typically params.atmosphereTint.
 */
export function updateHazeLayer(opacity, rgb) {
    if (!opacity || opacity <= 0 || !rgb) {
        hazeMesh.visible = false;
        return;
    }
    hazeMesh.visible = true;
    hazeMat.uniforms.hazeOpacity.value = opacity;
    hazeMat.uniforms.hazeColor.value.setRGB(rgb[0], rgb[1], rgb[2]);
}

// Equirectangular map camera & controls
export const mapCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
mapCamera.position.set(0, 0, 5);
mapCamera.lookAt(0, 0, 0);

export function updateMapCameraFrustum() {
    const aspect = innerWidth / innerHeight;
    const mapAspect = 2;
    let halfW, halfH;
    if (aspect > mapAspect) {
        halfH = 1.15;
        halfW = halfH * aspect;
    } else {
        halfW = 2.3;
        halfH = halfW / aspect;
    }
    mapCamera.left = -halfW; mapCamera.right = halfW;
    mapCamera.top = halfH; mapCamera.bottom = -halfH;
    mapCamera.updateProjectionMatrix();
}
updateMapCameraFrustum();

export const mapCtrl = new OrbitControls(mapCamera, canvas);
mapCtrl.enableRotate = false;
mapCtrl.enableDamping = true;
mapCtrl.dampingFactor = 0.09;
mapCtrl.panSpeed = 1.4;
mapCtrl.screenSpacePanning = true;
mapCtrl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
mapCtrl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
mapCtrl.minZoom = 0.5;
mapCtrl.maxZoom = 20;
mapCtrl.enableZoom = false; // custom handler below
mapCtrl.enabled = false;

// Smooth zoom for map view (orthographic)
let _mapZoomTarget = mapCamera.zoom;
const MAP_ZOOM_STEP   = 0.92;
const MAP_ZOOM_SMOOTH = 0.12;

canvas.addEventListener('wheel', (e) => {
    if (!mapCtrl.enabled) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    _mapZoomTarget *= dir < 0 ? 1 / MAP_ZOOM_STEP : MAP_ZOOM_STEP;
    _mapZoomTarget = THREE.MathUtils.clamp(_mapZoomTarget, mapCtrl.minZoom, mapCtrl.maxZoom);
}, { passive: false });

// Pinch-to-zoom for map (touch)
let _mapPinchDist = 0;
canvas.addEventListener('touchstart', (e) => {
    if (!mapCtrl.enabled || e.touches.length !== 2) { _mapPinchDist = 0; return; }
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    _mapPinchDist = Math.sqrt(dx * dx + dy * dy);
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
    if (!mapCtrl.enabled || e.touches.length !== 2 || _mapPinchDist === 0) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ratio = dist / _mapPinchDist;
    _mapZoomTarget *= ratio;
    _mapZoomTarget = THREE.MathUtils.clamp(_mapZoomTarget, mapCtrl.minZoom, mapCtrl.maxZoom);
    _mapPinchDist = dist;
}, { passive: true });

canvas.addEventListener('touchend', () => { _mapPinchDist = 0; }, { passive: true });

export function tickMapZoom() {
    const cur = mapCamera.zoom;
    const next = THREE.MathUtils.lerp(cur, _mapZoomTarget, MAP_ZOOM_SMOOTH);
    if (Math.abs(next - cur) < 0.0001) return;
    mapCamera.zoom = next;
    mapCamera.updateProjectionMatrix();
}

// ── Orrery camera & controls (2D top-down solar system view) ─────────────────
// Looks straight down the -Y axis.  Pan and zoom only — no rotation.
export const orreryCamera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 200);
orreryCamera.position.set(0, 80, 0);
orreryCamera.lookAt(0, 0, 0);

export function updateOrreryCameraFrustum() {
    const aspect = innerWidth / innerHeight;
    const halfH  = 3.0;
    const halfW  = halfH * aspect;
    orreryCamera.left   = -halfW;
    orreryCamera.right  =  halfW;
    orreryCamera.top    =  halfH;
    orreryCamera.bottom = -halfH;
    orreryCamera.updateProjectionMatrix();
}
updateOrreryCameraFrustum();

export const orreryCtrl = new OrbitControls(orreryCamera, canvas);
orreryCtrl.enableRotate   = false;
orreryCtrl.enableDamping  = true;
orreryCtrl.dampingFactor  = 0.09;
orreryCtrl.panSpeed       = 1.4;
orreryCtrl.screenSpacePanning = true;
orreryCtrl.mouseButtons   = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
orreryCtrl.touches        = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
orreryCtrl.minZoom        = 0.2;
orreryCtrl.maxZoom        = 30;
orreryCtrl.enableZoom     = false; // custom handler below
orreryCtrl.enabled        = false;

let _orreryZoomTarget   = orreryCamera.zoom;
const ORRERY_ZOOM_STEP  = 0.88;
const ORRERY_ZOOM_SMOOTH = 0.12;

canvas.addEventListener('wheel', (e) => {
    if (!orreryCtrl.enabled) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    _orreryZoomTarget *= dir < 0 ? 1 / ORRERY_ZOOM_STEP : ORRERY_ZOOM_STEP;
    _orreryZoomTarget = THREE.MathUtils.clamp(_orreryZoomTarget, orreryCtrl.minZoom, orreryCtrl.maxZoom);
}, { passive: false });

// Pinch-to-zoom for orrery (touch)
let _orreryPinchDist = 0;
canvas.addEventListener('touchstart', (e) => {
    if (!orreryCtrl.enabled || e.touches.length !== 2) { _orreryPinchDist = 0; return; }
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    _orreryPinchDist = Math.sqrt(dx * dx + dy * dy);
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
    if (!orreryCtrl.enabled || e.touches.length !== 2 || _orreryPinchDist === 0) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ratio = dist / _orreryPinchDist;
    _orreryZoomTarget *= ratio;
    _orreryZoomTarget = THREE.MathUtils.clamp(_orreryZoomTarget, orreryCtrl.minZoom, orreryCtrl.maxZoom);
    _orreryPinchDist = dist;
}, { passive: true });

canvas.addEventListener('touchend', () => { _orreryPinchDist = 0; }, { passive: true });

export function tickOrreryZoom() {
    const cur  = orreryCamera.zoom;
    const next = THREE.MathUtils.lerp(cur, _orreryZoomTarget, ORRERY_ZOOM_SMOOTH);
    if (Math.abs(next - cur) < 0.0001) return;
    orreryCamera.zoom = next;
    orreryCamera.updateProjectionMatrix();
}

/**
 * Switch the renderer into orrery mode: disable planet controls, enable orrery
 * controls, hide the planet/water/atmosphere meshes, set a deep-space background.
 * The orrery group visibility is managed separately by orrery.js enterOrrery().
 */
export function switchToOrrery() {
    ctrl.enabled      = false;
    mapCtrl.enabled   = false;
    orreryCtrl.enabled = true;
    // Reset orrery camera to a clean top-down framing
    orreryCamera.position.set(0, 80, 0);
    orreryCamera.lookAt(0, 0, 0);
    _orreryZoomTarget = 1;
    orreryCamera.zoom = 1;
    updateOrreryCameraFrustum();
    orreryCtrl.target.set(0, 0, 0);
    orreryCtrl.update();
    scene.background = new THREE.Color(0x000004);
}

/**
 * Switch back to the planet globe view after being in the orrery.
 * The caller is responsible for re-enabling ctrl or mapCtrl.
 */
export function switchToPlanetView() {
    orreryCtrl.enabled = false;
    scene.background   = new THREE.Color(0x030308);
    ctrl.enabled       = true;
}

// ── Moon discs and parent planet disc in globe view ───────────────────────────

const MOON_ORBIT_RADIUS = 2.5; // scene units from planet centre

let _moonMeshes      = [];    // [{ mesh, bodyId, angle, periodDays, label }]
let _moonOrbitLines  = [];    // orbit ring lines (not raycasted)
let _parentDiscMesh  = null;  // sphere shown when viewing a moon
let _parentDiscBodyId = null;
let _parentLabel     = null;  // floating HTML label near the parent disc

const _moonRaycaster = new THREE.Raycaster();
const _moonMouse     = new THREE.Vector2();

/**
 * Create / update the moon discs visible around the current planet in globe view.
 * Disposes any previously created moon discs automatically.
 * @param {object|null} currentBody  The body being viewed.
 * @param {object[]}    allBodies    Array of all bodies in the system.
 */
export function updateMoonScene(currentBody, allBodies) {
    for (const m of _moonMeshes) {
        m.mesh.geometry.dispose(); m.mesh.material.dispose(); scene.remove(m.mesh);
        if (m.label) m.label.remove();
    }
    for (const line of _moonOrbitLines) {
        line.geometry.dispose(); line.material.dispose(); scene.remove(line);
    }
    _moonMeshes = [];
    _moonOrbitLines = [];
    if (!currentBody || !allBodies) return;

    const moons = allBodies.filter(b => b.parentId === currentBody.id && b.params);
    moons.forEach((moon, idx) => {
        // Stagger orbit radii slightly so multiple moons don't look like one
        const orbitR = MOON_ORBIT_RADIUS + idx * 0.35;

        // Orbit ring
        const ringPts = [];
        for (let i = 0; i <= 96; i++) {
            const t = (i / 96) * Math.PI * 2;
            ringPts.push(new THREE.Vector3(orbitR * Math.cos(t), 0, orbitR * Math.sin(t)));
        }
        const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
        const ringMat = new THREE.LineBasicMaterial({ color: 0x445566, transparent: true, opacity: 0.4 });
        const orbitLine = new THREE.Line(ringGeo, ringMat);
        scene.add(orbitLine);
        _moonOrbitLines.push(orbitLine);

        // Moon sphere
        const ws  = moon.params.worldSize ?? 0.3;
        const r   = Math.max(0.035, 0.14 * ws);
        const geo = new THREE.SphereGeometry(r, 16, 10);
        const mat = new THREE.MeshLambertMaterial({ color: 0xbbbbcc });
        const mesh = new THREE.Mesh(geo, mat);

        // Invisible hit sphere — 4× visual radius so it's easy to click
        const hitGeo = new THREE.SphereGeometry(r * 4, 6, 4);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        hitMesh.visible = false;
        mesh.add(hitMesh); // parented to visual mesh; shares world transform

        const initialAngle = (idx / Math.max(moons.length, 1)) * Math.PI * 2;
        mesh.position.set(orbitR * Math.cos(initialAngle), 0, orbitR * Math.sin(initialAngle));
        mesh.userData.bodyId = moon.id;
        scene.add(mesh);

        // Floating name label
        const label = document.createElement('div');
        label.className = 'moon-globe-label';
        label.textContent = moon.name;
        document.body.appendChild(label);

        const periodDays = moon.orbitalPeriodDays ?? 27;
        _moonMeshes.push({ mesh, hitMesh, bodyId: moon.id, angle: initialAngle, periodDays, orbitR, label });
    });
}

/**
 * Create / update the parent planet disc shown when viewing a moon.
 * Placed at x=+10 in globe space so it is clearly off to the side.
 * @param {object|null} currentBody  The body being viewed.
 * @param {object[]}    allBodies    Array of all bodies in the system.
 */
export function updateParentScene(currentBody, allBodies) {
    if (_parentDiscMesh) {
        _parentDiscMesh.geometry.dispose(); _parentDiscMesh.material.dispose();
        scene.remove(_parentDiscMesh);
        _parentDiscMesh = null; _parentDiscBodyId = null;
    }
    if (_parentLabel) { _parentLabel.remove(); _parentLabel = null; }
    if (!currentBody?.parentId || !allBodies) return;
    const parent = allBodies.find(b => b.id === currentBody.parentId);
    if (!parent) return;

    const ws  = parent.params?.worldSize ?? 1.0;
    const r   = Math.max(0.14, 0.36 * ws);
    const geo = new THREE.SphereGeometry(r, 24, 16);
    const mat = new THREE.MeshLambertMaterial({ color: 0x5577aa });
    _parentDiscMesh = new THREE.Mesh(geo, mat);
    _parentDiscMesh.position.set(10, 0, 0);
    _parentDiscMesh.userData.bodyId = parent.id;
    _parentDiscBodyId = parent.id;
    scene.add(_parentDiscMesh);

    _parentLabel = document.createElement('div');
    _parentLabel.className = 'moon-globe-label parent-globe-label';
    _parentLabel.textContent = `↖ ${parent.name}`;
    document.body.appendChild(_parentLabel);
}

/**
 * Advance moon orbital positions every animation frame.
 * Uses a visual time scale so orbits are always perceptible on screen:
 * each moon completes one orbit in max(5, periodDays/2) real seconds.
 * @param {number} dtSec  Real-time elapsed seconds since the last frame.
 */
export function tickMoonOrbits(dtSec) {
    for (const m of _moonMeshes) {
        const visualPeriodSec = Math.max(40, m.periodDays * 3);
        m.angle += (dtSec / visualPeriodSec) * Math.PI * 2;
        m.mesh.position.set(
            m.orbitR * Math.cos(m.angle), 0,
            m.orbitR * Math.sin(m.angle)
        );
    }
}

/**
 * Project moon and parent-disc positions to screen coordinates and
 * reposition their floating HTML labels. Call every frame from the
 * globe-view animate branch.
 */
export function updateMoonLabels() {
    const rect = canvas.getBoundingClientRect();
    for (const m of _moonMeshes) {
        if (!m.label) continue;
        const pos = m.mesh.position.clone().project(camera);
        if (pos.z > 1) { m.label.style.display = 'none'; continue; }
        m.label.style.display = 'block';
        m.label.style.left = `${(pos.x *  0.5 + 0.5) * rect.width  + rect.left}px`;
        m.label.style.top  = `${(pos.y * -0.5 + 0.5) * rect.height + rect.top - 18}px`;
    }
    if (_parentLabel && _parentDiscMesh) {
        const pos = _parentDiscMesh.position.clone().project(camera);
        _parentLabel.style.display = pos.z <= 1 ? 'block' : 'none';
        _parentLabel.style.left = `${(pos.x *  0.5 + 0.5) * rect.width  + rect.left}px`;
        _parentLabel.style.top  = `${(pos.y * -0.5 + 0.5) * rect.height + rect.top - 18}px`;
    }
}

/**
 * Returns the bodyId of the moon disc under the pointer, or null.
 * @param {PointerEvent|MouseEvent} event
 */
export function getMoonBodyAtPointer(event) {
    if (_moonMeshes.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    _moonMouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    _moonMouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
    _moonRaycaster.setFromCamera(_moonMouse, camera);
    // Use hit spheres (4× visual radius) so the click target is generous
    const hits = _moonRaycaster.intersectObjects(_moonMeshes.map(m => m.hitMesh), false);
    return hits.length > 0 ? hits[0].object.parent.userData.bodyId : null;
}

/**
 * Returns the bodyId of the parent planet disc under the pointer, or null.
 * @param {PointerEvent|MouseEvent} event
 */
export function getParentDiscAtPointer(event) {
    if (!_parentDiscMesh) return null;
    const rect = canvas.getBoundingClientRect();
    _moonMouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    _moonMouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
    _moonRaycaster.setFromCamera(_moonMouse, camera);
    const hits = _moonRaycaster.intersectObject(_parentDiscMesh, false);
    return hits.length > 0 ? _parentDiscBodyId : null;
}

// ── Camera fly-in transition when entering a new body ─────────────────────────

let _bodyTransition = null; // { t, dur, fromPos, toPos }

/**
 * Begin a smooth camera fly-in toward the planet.
 * Places the camera far away and animates it to the standard close view.
 * Call this whenever entering a new solar body.
 */
export function startBodyTransition() {
    ctrl.target.set(0, 0, 0);
    camera.position.set(0, 1.0, 9);
    camera.lookAt(0, 0, 0);
    _zoomTarget = Math.sqrt(0 + 0.4 * 0.4 + 2.8 * 2.8); // ~2.83, normal zoom
    _bodyTransition = {
        t: 0,
        dur: 2.0,
        fromPos: new THREE.Vector3(0, 1.0, 9),
        toPos:   new THREE.Vector3(0, 0.4, 2.8),
    };
}

/**
 * Advance the body-entry camera transition.
 * Returns true while a transition is in progress (caller should skip tickZoom
 * and ctrl.update() while this returns true).
 * @param {number} dtSec
 */
export function tickBodyTransition(dtSec) {
    if (!_bodyTransition) return false;
    _bodyTransition.t = Math.min(_bodyTransition.t + dtSec / _bodyTransition.dur, 1);
    const ease = 1 - Math.pow(1 - _bodyTransition.t, 3); // ease-out cubic
    camera.position.lerpVectors(_bodyTransition.fromPos, _bodyTransition.toPos, ease);
    camera.lookAt(0, 0, 0);
    if (_bodyTransition.t >= 1) {
        _bodyTransition = null;
        // On the very next frame ctrl.update() will read our final position
        // and sync its internal spherical to match — no snap.
    }
    return true;
}

/* ── Surface fly-to ─────────────────────────────────────────────────────────
 * Smoothly orbit the camera to face a given world-space unit direction.
 * Works like tickBodyTransition: caller should skip tickZoom + ctrl.update()
 * while tickFlyTo() returns true.
 */
let _flyTo = null; // { fromPos, toPos, t, dur }

/**
 * Begin a smooth camera orbit to face the given world-space direction (need
 * not be a unit vector — it will be normalised). Also snaps zoom to targetDist
 * if provided. Call flyToSurfacePoint BEFORE opening any panel that needs the
 * camera already centred.
 */
export function flyToSurfacePoint(nx, ny, nz, targetDist = null) {
    const dir  = new THREE.Vector3(nx, ny, nz).normalize();
    const dist = Math.max(ctrl.minDistance, Math.min(ctrl.maxDistance, targetDist ?? camera.position.length()));
    _zoomTarget = dist; // keep tickZoom in sync after fly-to ends
    _flyTo = {
        fromPos: camera.position.clone(),
        toPos:   dir.multiplyScalar(dist),
        t: 0,
        dur: 0.65,
    };
}

/**
 * Advance the surface fly-to animation.
 * Returns true while animating (caller should skip tickZoom + ctrl.update()).
 */
export function tickFlyTo(dtSec) {
    if (!_flyTo) return false;
    _flyTo.t = Math.min(_flyTo.t + dtSec / _flyTo.dur, 1);
    const ease = 1 - Math.pow(1 - _flyTo.t, 3); // ease-out cubic
    camera.position.lerpVectors(_flyTo.fromPos, _flyTo.toPos, ease);
    camera.lookAt(0, 0, 0);
    if (_flyTo.t >= 1) _flyTo = null;
    return true;
}

// Colony marker groups — globe-mode 3D dots and map-mode flat discs.
// Visibility is managed by the animate loop in main.js.
export const colonyGlobeGroup = new THREE.Group();
scene.add(colonyGlobeGroup);

export const colonyMapGroup = new THREE.Group();
colonyMapGroup.visible = false;
scene.add(colonyMapGroup);
