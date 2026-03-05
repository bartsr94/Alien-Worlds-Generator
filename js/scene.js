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
