// Arrow overlays — wind direction, ocean current arrows, drift arrow cleanup.

import * as THREE from 'three';
import { scene } from './scene.js';
import { state } from '../core/state.js';

// ── Shared helper: dispose arrow group ──────────────────────────────────────
function disposeArrowGroup(group) {
    if (!group) return;
    group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
    });
    scene.remove(group);
}

// ── Shared helper: build a lat/lon-sampled arrow overlay group ───────────────
// opts = {
//   r_xyz, mesh,
//   skipRegion,    // (r) => bool | null  — exclude from grid (e.g. land filter)
//   getVectors,    // (r) => { e, n, speed, ...extras } | null  — null skips the cell
//   getColor,      // (vecResult) => [cr, cg, cb]
//   arrowLenGlobe, // (speed) => float
//   arrowLenMap,   // (speed) => float  (defaults to arrowLenGlobe)
//   globeName, mapName,
// }
function buildArrowGroup({ r_xyz, mesh, skipRegion, getVectors, getColor,
                            arrowLenGlobe, arrowLenMap, globeName, mapName }) {
    arrowLenMap ??= arrowLenGlobe;

    const PI = Math.PI, DEG = PI / 180, sx = 2 / PI;
    const { numRegions } = mesh;

    // Bin regions into a lat/lon grid for even geographic sampling
    const LAT_STEP = 3, LON_STEP = 3;
    const latBands = Math.floor(180 / LAT_STEP);   // 60
    const lonBands = Math.floor(360 / LON_STEP);   // 120
    const gridRegions = new Int32Array(latBands * lonBands).fill(-1);
    const gridDist2   = new Float32Array(latBands * lonBands).fill(1e9);

    for (let r = 0; r < numRegions; r++) {
        if (skipRegion?.(r)) continue;
        const ry  = r_xyz[3 * r + 1];
        const lat = Math.asin(Math.max(-1, Math.min(1, ry)));
        const lon = Math.atan2(r_xyz[3 * r], r_xyz[3 * r + 2]);
        const li  = Math.max(0, Math.min(latBands - 1, Math.floor((lat + PI / 2) / (LAT_STEP * DEG))));
        const lo  = Math.max(0, Math.min(lonBands - 1, Math.floor((lon + PI)     / (LON_STEP * DEG))));
        const cellLat = (-90 + li * LAT_STEP + LAT_STEP * 0.5) * DEG;
        const cellLon = (-180 + lo * LON_STEP + LON_STEP * 0.5) * DEG;
        const dlat = lat - cellLat, dlon = lon - cellLon;
        const d2 = dlat * dlat + dlon * dlon;
        const idx = li * lonBands + lo;
        if (d2 < gridDist2[idx]) { gridDist2[idx] = d2; gridRegions[idx] = r; }
    }

    // Per-cell arrow geometry
    const globePositions = [], globeColors = [], mapPositions = [], mapColors = [];
    const HEAD_ANGLE = 25 * DEG, HEAD_FRAC = 0.35;
    const cosA = Math.cos(HEAD_ANGLE), sinA = Math.sin(HEAD_ANGLE);

    for (let i = 0; i < gridRegions.length; i++) {
        const r = gridRegions[i];
        if (r < 0) continue;
        const vecs = getVectors(r);
        if (!vecs) continue;
        const { e, n, speed } = vecs;
        const [cr, cg, cb] = getColor(vecs);
        const x = r_xyz[3 * r], y = r_xyz[3 * r + 1], z = r_xyz[3 * r + 2];

        // Globe: 3D arrow in tangent frame
        {
            let ex = z, ey = 0, ez = -x;
            const elen = Math.sqrt(ex * ex + ez * ez);
            if (elen > 1e-10) { ex /= elen; ez /= elen; } else { ex = 1; ez = 0; }

            let nx = y * ez - z * ey, ny = z * ex - x * ez, nz = x * ey - y * ex;
            const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= nlen; ny /= nlen; nz /= nlen;

            const dirX = e * ex + n * nx, dirY = e * ey + n * ny, dirZ = e * ez + n * nz;
            const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
            const dxn = dirX / dirLen, dyn = dirY / dirLen, dzn = dirZ / dirLen;

            let px = y * dzn - z * dyn, py = z * dxn - x * dzn, pz = x * dyn - y * dxn;
            const plen = Math.sqrt(px * px + py * py + pz * pz) || 1;
            px /= plen; py /= plen; pz /= plen;

            const arrowLen = arrowLenGlobe(speed);
            const R = 1.007;
            const ox = x * R, oy = y * R, oz = z * R;
            const tx = ox + dxn * arrowLen, ty = oy + dyn * arrowLen, tz = oz + dzn * arrowLen;

            globePositions.push(ox, oy, oz, tx, ty, tz);
            globeColors.push(cr, cg, cb, cr, cg, cb);

            const hLen = arrowLen * HEAD_FRAC;
            globePositions.push(
                tx, ty, tz,
                tx + (-dxn * cosA + px * sinA) * hLen,
                ty + (-dyn * cosA + py * sinA) * hLen,
                tz + (-dzn * cosA + pz * sinA) * hLen
            );
            globeColors.push(cr, cg, cb, cr, cg, cb);
            globePositions.push(
                tx, ty, tz,
                tx + (-dxn * cosA - px * sinA) * hLen,
                ty + (-dyn * cosA - py * sinA) * hLen,
                tz + (-dzn * cosA - pz * sinA) * hLen
            );
            globeColors.push(cr, cg, cb, cr, cg, cb);
        }

        // Map: 2D arrow in equirectangular projection
        {
            let lon = Math.atan2(x, z) - (state.mapCenterLon || 0);
            if (lon > PI) lon -= 2 * PI; else if (lon < -PI) lon += 2 * PI;
            const lat = Math.asin(Math.max(-1, Math.min(1, y)));
            const mx = lon * sx, my = lat * sx;

            const norm = Math.sqrt(e * e + n * n) || 1;
            const arrowLen = arrowLenMap(speed);
            const dx = (e / norm) * arrowLen, dy = (n / norm) * arrowLen;
            const tipX = mx + dx, tipY = my + dy;

            mapPositions.push(mx, my, 0.002, tipX, tipY, 0.002);
            mapColors.push(cr, cg, cb, cr, cg, cb);

            const hLen = arrowLen * HEAD_FRAC;
            const dLen = Math.sqrt(dx * dx + dy * dy) || 1;
            const ndx = -dx / dLen, ndy = -dy / dLen;

            mapPositions.push(tipX, tipY, 0.002, tipX + (ndx * cosA - ndy * sinA) * hLen, tipY + (ndx * sinA + ndy * cosA) * hLen, 0.002);
            mapColors.push(cr, cg, cb, cr, cg, cb);
            mapPositions.push(tipX, tipY, 0.002, tipX + (ndx * cosA + ndy * sinA) * hLen, tipY + (-ndx * sinA + ndy * cosA) * hLen, 0.002);
            mapColors.push(cr, cg, cb, cr, cg, cb);
        }
    }

    // Assemble THREE.Group
    const group = new THREE.Group();
    if (globePositions.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(globePositions, 3));
        geo.setAttribute('color',    new THREE.Float32BufferAttribute(globeColors, 3));
        const lines = new THREE.LineSegments(geo,
            new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false }));
        lines.name = globeName;
        lines.visible = !state.mapMode;
        group.add(lines);
    }
    if (mapPositions.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(mapPositions, 3));
        geo.setAttribute('color',    new THREE.Float32BufferAttribute(mapColors, 3));
        const lines = new THREE.LineSegments(geo,
            new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6 }));
        lines.name = mapName;
        lines.visible = state.mapMode;
        group.add(lines);
    }
    return group;
}

// Drift arrows — removes previous arrow group (rendering disabled; cleanup only).
export function buildDriftArrows() {
    disposeArrowGroup(state.arrowGroup);
    state.arrowGroup = null;
}

// Wind arrows — show wind direction/magnitude overlay.
export function buildWindArrows(season) {
    disposeArrowGroup(state.windArrowGroup);
    state.windArrowGroup = null;

    if (!season || !state.curData || !state.curData.r_wind_east_summer) return;

    const { mesh, r_xyz,
        r_wind_east_summer, r_wind_north_summer,
        r_wind_east_winter, r_wind_north_winter } = state.curData;

    const windE = season === 'winter' ? r_wind_east_winter  : r_wind_east_summer;
    const windN = season === 'winter' ? r_wind_north_winter : r_wind_north_summer;
    if (!windE || !windN) return;

    const group = buildArrowGroup({
        r_xyz, mesh,
        skipRegion: null,
        getVectors(r) {
            const e = windE[r], n = windN[r];
            const speed = Math.sqrt(e * e + n * n);
            return speed < 0.001 ? null : { e, n, speed };
        },
        getColor({ speed }) {
            // blue (slow) → yellow (medium) → red (fast)
            const t = Math.min(1, speed * 3);
            if (t < 0.5) { const s = t * 2; return [s, s, 1 - s * 0.5]; }
            const s = (t - 0.5) * 2;
            return [1, 1 - s, 0.5 - s * 0.5];
        },
        arrowLenGlobe: speed => 0.008 + Math.min(0.012, speed * 0.025),
        arrowLenMap:   speed => 0.006 + Math.min(0.012, speed * 0.025),
        globeName: 'windGlobe', mapName: 'windMap',
    });

    // ── ITCZ spline line (shown on pressure layers) ──
    const PI = Math.PI, sx = 2 / PI;
    const isPressureLayer = state.debugLayer === 'pressureSummer' || state.debugLayer === 'pressureWinter';
    const itczLons = state.curData.itczLons;
    const itczLats = season === 'winter' ? state.curData.itczLatsWinter : state.curData.itczLatsSummer;

    if (isPressureLayer && itczLons && itczLats) {
        const N = itczLons.length;
        const R_ITCZ = 1.01;

        // Globe: polyline on sphere surface
        const gPos = [];
        for (let i = 0; i < N; i++) {
            const j = (i + 1) % N;
            const lon0 = itczLons[i], lat0 = itczLats[i];
            const lon1 = itczLons[j], lat1 = itczLats[j];
            const cosLat0 = Math.cos(lat0), cosLat1 = Math.cos(lat1);
            gPos.push(
                Math.sin(lon0) * cosLat0 * R_ITCZ, Math.sin(lat0) * R_ITCZ, Math.cos(lon0) * cosLat0 * R_ITCZ,
                Math.sin(lon1) * cosLat1 * R_ITCZ, Math.sin(lat1) * R_ITCZ, Math.cos(lon1) * cosLat1 * R_ITCZ
            );
        }
        const igGeo = new THREE.BufferGeometry();
        igGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
        const igLines = new THREE.LineSegments(igGeo,
            new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2, depthWrite: false }));
        igLines.name = 'windGlobe';
        igLines.visible = !state.mapMode;
        group.add(igLines);

        // Map: polyline on equirectangular projection
        const mPos = [];
        for (let i = 0; i < N; i++) {
            const j = (i + 1) % N;
            const mx0 = itczLons[i] * sx, my0 = itczLats[i] * sx;
            const mx1 = itczLons[j] * sx, my1 = itczLats[j] * sx;
            if (Math.abs(mx1 - mx0) > 1) continue; // skip antimeridian wrap
            mPos.push(mx0, my0, 0.003, mx1, my1, 0.003);
        }
        const imGeo = new THREE.BufferGeometry();
        imGeo.setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3));
        const imLines = new THREE.LineSegments(imGeo,
            new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 }));
        imLines.name = 'windMap';
        imLines.visible = state.mapMode;
        group.add(imLines);
    }

    state.windArrowGroup = group;
    scene.add(group);
}

// Ocean current arrows — show current direction colored by heat transport.
export function buildOceanCurrentArrows(season) {
    disposeArrowGroup(state.oceanCurrentArrowGroup);
    state.oceanCurrentArrowGroup = null;

    if (!season || !state.curData || !state.curData.r_ocean_current_east_summer) return;

    const { mesh, r_xyz, r_elevation } = state.curData;
    const currentE  = season === 'winter' ? state.curData.r_ocean_current_east_winter  : state.curData.r_ocean_current_east_summer;
    const currentN  = season === 'winter' ? state.curData.r_ocean_current_north_winter : state.curData.r_ocean_current_north_summer;
    const speedArr  = season === 'winter' ? state.curData.r_ocean_speed_winter         : state.curData.r_ocean_speed_summer;
    const warmthArr = season === 'winter' ? state.curData.r_ocean_warmth_winter        : state.curData.r_ocean_warmth_summer;
    if (!currentE || !currentN || !speedArr || !warmthArr) return;

    const oceanLen = speed => 0.006 + Math.min(0.014, speed * 0.025);
    state.oceanCurrentArrowGroup = buildArrowGroup({
        r_xyz, mesh,
        skipRegion: r => r_elevation[r] > 0,
        getVectors(r) {
            const speed = speedArr[r];
            return speed < 0.01 ? null : { e: currentE[r], n: currentN[r], speed, warmth: warmthArr[r] };
        },
        getColor({ warmth }) {
            // red (warm/poleward), blue (cold/equatorward), gray (neutral)
            return warmth > 0.1  ? [0.9, 0.15, 0.15]
                 : warmth < -0.1 ? [0.15, 0.3, 0.9]
                 :                 [0.5, 0.5, 0.5];
        },
        arrowLenGlobe: oceanLen,
        globeName: 'oceanGlobe', mapName: 'oceanMap',
    });
    scene.add(state.oceanCurrentArrowGroup);
}
