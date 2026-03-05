// Arrow overlays — wind direction, ocean current arrows, drift arrow cleanup.

import * as THREE from 'three';
import { scene } from './scene.js';
import { state } from '../core/state.js';

// Drift arrows — removes previous arrow group (rendering disabled; cleanup only).
export function buildDriftArrows() {
    if (state.arrowGroup) {
        state.arrowGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        scene.remove(state.arrowGroup);
        state.arrowGroup = null;
    }
}

// Wind arrows — show wind direction/magnitude overlay.
export function buildWindArrows(season) {
    // Clean up previous arrows
    if (state.windArrowGroup) {
        state.windArrowGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        scene.remove(state.windArrowGroup);
        state.windArrowGroup = null;
    }

    if (!season || !state.curData || !state.curData.r_wind_east_summer) return;

    const { mesh, r_xyz,
        r_wind_east_summer, r_wind_north_summer,
        r_wind_east_winter, r_wind_north_winter } = state.curData;

    const windE = season === 'winter' ? r_wind_east_winter : r_wind_east_summer;
    const windN = season === 'winter' ? r_wind_north_winter : r_wind_north_summer;
    if (!windE || !windN) return;

    const PI = Math.PI;
    const DEG = PI / 180;
    const sx = 2 / PI;
    const numRegions = mesh.numRegions;

    // ── Bin regions into a lat/lon grid for even geographic sampling ──
    const LAT_STEP = 3; // degrees
    const LON_STEP = 3;
    const latBands = Math.floor(180 / LAT_STEP); // 60
    const lonBands = Math.floor(360 / LON_STEP); // 120

    // For each grid cell, find the closest region to the cell center
    const gridRegions = new Int32Array(latBands * lonBands).fill(-1);
    const gridDist2 = new Float32Array(latBands * lonBands).fill(1e9);

    for (let r = 0; r < numRegions; r++) {
        const ry = r_xyz[3 * r + 1];
        const lat = Math.asin(Math.max(-1, Math.min(1, ry)));
        const lon = Math.atan2(r_xyz[3 * r], r_xyz[3 * r + 2]);

        const li = Math.max(0, Math.min(latBands - 1,
            Math.floor((lat + PI / 2) / (LAT_STEP * DEG))));
        const lo = Math.max(0, Math.min(lonBands - 1,
            Math.floor((lon + PI) / (LON_STEP * DEG))));

        const cellLat = (-90 + li * LAT_STEP + LAT_STEP * 0.5) * DEG;
        const cellLon = (-180 + lo * LON_STEP + LON_STEP * 0.5) * DEG;
        const dlat = lat - cellLat, dlon = lon - cellLon;
        const d2 = dlat * dlat + dlon * dlon;

        const idx = li * lonBands + lo;
        if (d2 < gridDist2[idx]) {
            gridDist2[idx] = d2;
            gridRegions[idx] = r;
        }
    }

    const globePositions = [];
    const globeColors = [];
    const mapPositions = [];
    const mapColors = [];

    const HEAD_ANGLE = 25 * DEG;
    const HEAD_FRAC = 0.35; // arrowhead length as fraction of shaft
    const cosA = Math.cos(HEAD_ANGLE), sinA = Math.sin(HEAD_ANGLE);

    for (let i = 0; i < gridRegions.length; i++) {
        const r = gridRegions[i];
        if (r < 0) continue;

        const we = windE[r], wn = windN[r];
        const speed = Math.sqrt(we * we + wn * wn);
        if (speed < 0.001) continue;

        const x = r_xyz[3 * r], y = r_xyz[3 * r + 1], z = r_xyz[3 * r + 2];

        // Color: blue (slow) → yellow (medium) → red (fast)
        const t = Math.min(1, speed * 3);
        let cr, cg, cb;
        if (t < 0.5) {
            const s = t * 2;
            cr = s; cg = s; cb = 1 - s * 0.5;
        } else {
            const s = (t - 0.5) * 2;
            cr = 1; cg = 1 - s; cb = 0.5 - s * 0.5;
        }

        // ── Globe arrows: 3D with arrowhead ──
        {
            // Tangent frame (Y-up)
            let ex = z, ey = 0, ez = -x;
            const elen = Math.sqrt(ex * ex + ez * ez);
            if (elen > 1e-10) { ex /= elen; ez /= elen; }
            else { ex = 1; ez = 0; }

            let nx = y * ez - z * ey;
            let ny = z * ex - x * ez;
            let nz = x * ey - y * ex;
            const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= nlen; ny /= nlen; nz /= nlen;

            // Wind direction in 3D = we * east + wn * north
            const dirX = we * ex + wn * nx;
            const dirY = we * ey + wn * ny;
            const dirZ = we * ez + wn * nz;
            const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
            const dxn = dirX / dirLen, dyn = dirY / dirLen, dzn = dirZ / dirLen;

            // Perpendicular in tangent plane: position × dir
            let px = y * dzn - z * dyn;
            let py = z * dxn - x * dzn;
            let pz = x * dyn - y * dxn;
            const plen = Math.sqrt(px * px + py * py + pz * pz) || 1;
            px /= plen; py /= plen; pz /= plen;

            const arrowLen = 0.008 + Math.min(0.012, speed * 0.025);
            const R = 1.007;

            const ox = x * R, oy = y * R, oz = z * R;
            const tx = ox + dxn * arrowLen;
            const ty = oy + dyn * arrowLen;
            const tz = oz + dzn * arrowLen;

            // Shaft
            globePositions.push(ox, oy, oz, tx, ty, tz);
            globeColors.push(cr, cg, cb, cr, cg, cb);

            // Arrowhead wings
            const hLen = arrowLen * HEAD_FRAC;
            const lwx = tx + (-dxn * cosA + px * sinA) * hLen;
            const lwy = ty + (-dyn * cosA + py * sinA) * hLen;
            const lwz = tz + (-dzn * cosA + pz * sinA) * hLen;
            const rwx = tx + (-dxn * cosA - px * sinA) * hLen;
            const rwy = ty + (-dyn * cosA - py * sinA) * hLen;
            const rwz = tz + (-dzn * cosA - pz * sinA) * hLen;

            globePositions.push(tx, ty, tz, lwx, lwy, lwz);
            globeColors.push(cr, cg, cb, cr, cg, cb);
            globePositions.push(tx, ty, tz, rwx, rwy, rwz);
            globeColors.push(cr, cg, cb, cr, cg, cb);
        }

        // ── Map arrows: 2D with arrowhead ──
        {
            let lon = Math.atan2(x, z) - (state.mapCenterLon || 0);
            if (lon > PI) lon -= 2 * PI; else if (lon < -PI) lon += 2 * PI;
            const lat = Math.asin(Math.max(-1, Math.min(1, y)));
            const mx = lon * sx;
            const my = lat * sx;

            const norm = speed || 1;
            const arrowLen = 0.006 + Math.min(0.012, speed * 0.025);
            const dx = (we / norm) * arrowLen;
            const dy = (wn / norm) * arrowLen;
            const tipX = mx + dx, tipY = my + dy;

            // Shaft
            mapPositions.push(mx, my, 0.002, tipX, tipY, 0.002);
            mapColors.push(cr, cg, cb, cr, cg, cb);

            // Arrowhead wings (2D rotation of -dir)
            const hLen = arrowLen * HEAD_FRAC;
            const dLen = Math.sqrt(dx * dx + dy * dy) || 1;
            const ndx = -dx / dLen, ndy = -dy / dLen;

            const lx = tipX + (ndx * cosA - ndy * sinA) * hLen;
            const ly = tipY + (ndx * sinA + ndy * cosA) * hLen;
            const rx = tipX + (ndx * cosA + ndy * sinA) * hLen;
            const ry = tipY + (-ndx * sinA + ndy * cosA) * hLen;

            mapPositions.push(tipX, tipY, 0.002, lx, ly, 0.002);
            mapColors.push(cr, cg, cb, cr, cg, cb);
            mapPositions.push(tipX, tipY, 0.002, rx, ry, 0.002);
            mapColors.push(cr, cg, cb, cr, cg, cb);
        }
    }

    state.windArrowGroup = new THREE.Group();

    // Globe arrows
    if (globePositions.length > 0) {
        const gGeo = new THREE.BufferGeometry();
        gGeo.setAttribute('position', new THREE.Float32BufferAttribute(globePositions, 3));
        gGeo.setAttribute('color', new THREE.Float32BufferAttribute(globeColors, 3));
        const gMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false });
        const gLines = new THREE.LineSegments(gGeo, gMat);
        gLines.name = 'windGlobe';
        gLines.visible = !state.mapMode;
        state.windArrowGroup.add(gLines);
    }

    // Map arrows
    if (mapPositions.length > 0) {
        const mGeo = new THREE.BufferGeometry();
        mGeo.setAttribute('position', new THREE.Float32BufferAttribute(mapPositions, 3));
        mGeo.setAttribute('color', new THREE.Float32BufferAttribute(mapColors, 3));
        const mMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6 });
        const mLines = new THREE.LineSegments(mGeo, mMat);
        mLines.name = 'windMap';
        mLines.visible = state.mapMode;
        state.windArrowGroup.add(mLines);
    }

    // ── ITCZ spline line (shown on pressure layers) ──
    const isPressureLayer = season && (state.debugLayer === 'pressureSummer' || state.debugLayer === 'pressureWinter');
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
        const igMat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2, depthWrite: false });
        const igLines = new THREE.LineSegments(igGeo, igMat);
        igLines.name = 'windGlobe';
        igLines.visible = !state.mapMode;
        state.windArrowGroup.add(igLines);

        // Map: polyline on equirectangular projection
        const mPos = [];
        for (let i = 0; i < N; i++) {
            const j = (i + 1) % N;
            const mx0 = itczLons[i] * sx, my0 = itczLats[i] * sx;
            const mx1 = itczLons[j] * sx, my1 = itczLats[j] * sx;
            // Skip segment that wraps across antimeridian
            if (Math.abs(mx1 - mx0) > 1) continue;
            mPos.push(mx0, my0, 0.003, mx1, my1, 0.003);
        }
        const imGeo = new THREE.BufferGeometry();
        imGeo.setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3));
        const imMat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 });
        const imLines = new THREE.LineSegments(imGeo, imMat);
        imLines.name = 'windMap';
        imLines.visible = state.mapMode;
        state.windArrowGroup.add(imLines);
    }

    scene.add(state.windArrowGroup);
}

// Ocean current arrows — show current direction colored by heat transport.
export function buildOceanCurrentArrows(season) {
    // Clean up previous arrows
    if (state.oceanCurrentArrowGroup) {
        state.oceanCurrentArrowGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        scene.remove(state.oceanCurrentArrowGroup);
        state.oceanCurrentArrowGroup = null;
    }

    if (!season || !state.curData || !state.curData.r_ocean_current_east_summer) return;

    const { mesh, r_xyz, r_elevation } = state.curData;

    const currentE = season === 'winter'
        ? state.curData.r_ocean_current_east_winter : state.curData.r_ocean_current_east_summer;
    const currentN = season === 'winter'
        ? state.curData.r_ocean_current_north_winter : state.curData.r_ocean_current_north_summer;
    const speedArr = season === 'winter'
        ? state.curData.r_ocean_speed_winter : state.curData.r_ocean_speed_summer;
    const warmthArr = season === 'winter'
        ? state.curData.r_ocean_warmth_winter : state.curData.r_ocean_warmth_summer;
    if (!currentE || !currentN || !speedArr || !warmthArr) return;

    const PI = Math.PI;
    const DEG = PI / 180;
    const sx = 2 / PI;
    const numRegions = mesh.numRegions;

    // ── Bin regions into a lat/lon grid for even geographic sampling ──
    const LAT_STEP = 3;
    const LON_STEP = 3;
    const latBands = Math.floor(180 / LAT_STEP);
    const lonBands = Math.floor(360 / LON_STEP);

    const gridRegions = new Int32Array(latBands * lonBands).fill(-1);
    const gridDist2 = new Float32Array(latBands * lonBands).fill(1e9);

    for (let r = 0; r < numRegions; r++) {
        // Skip land
        if (r_elevation[r] > 0) continue;

        const ry = r_xyz[3 * r + 1];
        const lat = Math.asin(Math.max(-1, Math.min(1, ry)));
        const lon = Math.atan2(r_xyz[3 * r], r_xyz[3 * r + 2]);

        const li = Math.max(0, Math.min(latBands - 1,
            Math.floor((lat + PI / 2) / (LAT_STEP * DEG))));
        const lo = Math.max(0, Math.min(lonBands - 1,
            Math.floor((lon + PI) / (LON_STEP * DEG))));

        const cellLat = (-90 + li * LAT_STEP + LAT_STEP * 0.5) * DEG;
        const cellLon = (-180 + lo * LON_STEP + LON_STEP * 0.5) * DEG;
        const dlat = lat - cellLat, dlon = lon - cellLon;
        const d2 = dlat * dlat + dlon * dlon;

        const idx = li * lonBands + lo;
        if (d2 < gridDist2[idx]) {
            gridDist2[idx] = d2;
            gridRegions[idx] = r;
        }
    }

    const globePositions = [];
    const globeColors = [];
    const mapPositions = [];
    const mapColors = [];

    const HEAD_ANGLE = 25 * DEG;
    const HEAD_FRAC = 0.35;
    const cosA = Math.cos(HEAD_ANGLE), sinA = Math.sin(HEAD_ANGLE);

    for (let i = 0; i < gridRegions.length; i++) {
        const r = gridRegions[i];
        if (r < 0) continue;

        const ce = currentE[r], cn = currentN[r];
        const speed = speedArr[r];
        const warmth = warmthArr[r];
        if (speed < 0.01) continue;

        const x = r_xyz[3 * r], y = r_xyz[3 * r + 1], z = r_xyz[3 * r + 2];

        // Color by heat transport: red (warm/poleward), blue (cold/equatorward), gray (neutral)
        let cr, cg, cb;
        if (warmth > 0.1) {
            cr = 0.9; cg = 0.15; cb = 0.15;
        } else if (warmth < -0.1) {
            cr = 0.15; cg = 0.3; cb = 0.9;
        } else {
            cr = 0.5; cg = 0.5; cb = 0.5;
        }

        // ── Globe arrows: 3D with arrowhead ──
        {
            let ex = z, ey = 0, ez = -x;
            const elen = Math.sqrt(ex * ex + ez * ez);
            if (elen > 1e-10) { ex /= elen; ez /= elen; }
            else { ex = 1; ez = 0; }

            let nx = y * ez - z * ey;
            let ny = z * ex - x * ez;
            let nz = x * ey - y * ex;
            const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= nlen; ny /= nlen; nz /= nlen;

            const dirX = ce * ex + cn * nx;
            const dirY = ce * ey + cn * ny;
            const dirZ = ce * ez + cn * nz;
            const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
            const dxn = dirX / dirLen, dyn = dirY / dirLen, dzn = dirZ / dirLen;

            let px = y * dzn - z * dyn;
            let py = z * dxn - x * dzn;
            let pz = x * dyn - y * dxn;
            const plen = Math.sqrt(px * px + py * py + pz * pz) || 1;
            px /= plen; py /= plen; pz /= plen;

            const arrowLen = 0.006 + Math.min(0.014, speed * 0.025);
            const R = 1.007;

            const ox = x * R, oy = y * R, oz = z * R;
            const tx = ox + dxn * arrowLen;
            const ty = oy + dyn * arrowLen;
            const tz = oz + dzn * arrowLen;

            globePositions.push(ox, oy, oz, tx, ty, tz);
            globeColors.push(cr, cg, cb, cr, cg, cb);

            const hLen = arrowLen * HEAD_FRAC;
            const lwx = tx + (-dxn * cosA + px * sinA) * hLen;
            const lwy = ty + (-dyn * cosA + py * sinA) * hLen;
            const lwz = tz + (-dzn * cosA + pz * sinA) * hLen;
            const rwx = tx + (-dxn * cosA - px * sinA) * hLen;
            const rwy = ty + (-dyn * cosA - py * sinA) * hLen;
            const rwz = tz + (-dzn * cosA - pz * sinA) * hLen;

            globePositions.push(tx, ty, tz, lwx, lwy, lwz);
            globeColors.push(cr, cg, cb, cr, cg, cb);
            globePositions.push(tx, ty, tz, rwx, rwy, rwz);
            globeColors.push(cr, cg, cb, cr, cg, cb);
        }

        // ── Map arrows: 2D with arrowhead ──
        {
            let lon = Math.atan2(x, z) - (state.mapCenterLon || 0);
            if (lon > PI) lon -= 2 * PI; else if (lon < -PI) lon += 2 * PI;
            const lat = Math.asin(Math.max(-1, Math.min(1, y)));
            const mx = lon * sx;
            const my = lat * sx;

            const rawSpeed = Math.sqrt(ce * ce + cn * cn) || 1;
            const arrowLen = 0.006 + Math.min(0.014, speed * 0.025);
            const dx = (ce / rawSpeed) * arrowLen;
            const dy = (cn / rawSpeed) * arrowLen;
            const tipX = mx + dx, tipY = my + dy;

            mapPositions.push(mx, my, 0.002, tipX, tipY, 0.002);
            mapColors.push(cr, cg, cb, cr, cg, cb);

            const hLen = arrowLen * HEAD_FRAC;
            const dLen = Math.sqrt(dx * dx + dy * dy) || 1;
            const ndx = -dx / dLen, ndy = -dy / dLen;

            const lx = tipX + (ndx * cosA - ndy * sinA) * hLen;
            const ly = tipY + (ndx * sinA + ndy * cosA) * hLen;
            const rx = tipX + (ndx * cosA + ndy * sinA) * hLen;
            const ry = tipY + (-ndx * sinA + ndy * cosA) * hLen;

            mapPositions.push(tipX, tipY, 0.002, lx, ly, 0.002);
            mapColors.push(cr, cg, cb, cr, cg, cb);
            mapPositions.push(tipX, tipY, 0.002, rx, ry, 0.002);
            mapColors.push(cr, cg, cb, cr, cg, cb);
        }
    }

    console.log(`[OceanArrows] ${season}: ${globePositions.length / 18} arrows (from ${gridRegions.length} grid cells)`);

    state.oceanCurrentArrowGroup = new THREE.Group();

    if (globePositions.length > 0) {
        const gGeo = new THREE.BufferGeometry();
        gGeo.setAttribute('position', new THREE.Float32BufferAttribute(globePositions, 3));
        gGeo.setAttribute('color', new THREE.Float32BufferAttribute(globeColors, 3));
        const gMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false });
        const gLines = new THREE.LineSegments(gGeo, gMat);
        gLines.name = 'oceanGlobe';
        gLines.visible = !state.mapMode;
        state.oceanCurrentArrowGroup.add(gLines);
    }

    if (mapPositions.length > 0) {
        const mGeo = new THREE.BufferGeometry();
        mGeo.setAttribute('position', new THREE.Float32BufferAttribute(mapPositions, 3));
        mGeo.setAttribute('color', new THREE.Float32BufferAttribute(mapColors, 3));
        const mMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6 });
        const mLines = new THREE.LineSegments(mGeo, mMat);
        mLines.name = 'oceanMap';
        mLines.visible = state.mapMode;
        state.oceanCurrentArrowGroup.add(mLines);
    }

    scene.add(state.oceanCurrentArrowGroup);
}
