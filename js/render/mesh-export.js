// PNG map export — tiled equirectangular rendering with sRGB gamma correction.

import * as THREE from 'three';
import { renderer } from './scene.js';
import { state } from '../core/state.js';
import { elevationToColor } from './color-map.js';
import {
    getCachedBiomeSmoothed,
    heightmapColor, landHeightmapColor, landMaskColor, koppenColor
} from './mesh-colors.js';

function exportFilename(type, seed) {
    switch (type) {
        case 'landmask':       return `orogen-landmask-${seed}.png`;
        case 'landheightmap':  return `orogen-land-heightmap-${seed}.png`;
        case 'heightmap':      return `orogen-heightmap-${seed}.png`;
        case 'biome':          return `orogen-satellite-${seed}.png`;
        case 'koppen':         return `orogen-climate-${seed}.png`;
        default:               return `orogen-colormap-${seed}.png`;
    }
}

// Export equirectangular map as PNG (async, with tiled rendering for large sizes).
export async function exportMap(type, width, onProgress) {
    if (!state.curData) return;

    // Yield so the browser paints the loading overlay before heavy work begins
    await new Promise(r => setTimeout(r, 50));

    const height = width / 2;
    const { mesh, r_xyz, t_xyz, r_elevation } = state.curData;
    const isBW = type === 'heightmap' || type === 'landheightmap' || type === 'landmask';

    // Climate-dependent export types (Satellite / Köppen)
    const debugLayers = state.curData.debugLayers;
    const koppenArr = (type === 'biome' || type === 'koppen') ? (debugLayers && debugLayers.koppen) : null;
    const biomeMode = state.planetaryParams?.biomeMode ?? 'earth';
    const biomeSmoothed = (type === 'biome' && koppenArr) ? getCachedBiomeSmoothed(mesh, koppenArr, r_elevation, biomeMode) : null;

    // Build map triangles (same projection as buildMapMesh, chosen coloring, no grid)
    const { numSides } = mesh;
    const PI = Math.PI;
    const sx = 2 / PI;

    const posArr = new Float32Array(numSides * 18);
    const colArr = new Float32Array(numSides * 18);
    let triCount = 0;

    for (let s = 0; s < numSides; s++) {
        const it = mesh.s_inner_t(s);
        const ot = mesh.s_outer_t(s);
        const br = mesh.s_begin_r(s);

        let cr, cg, cb;
        if (type === 'landmask') {
            [cr, cg, cb] = landMaskColor(r_elevation[br]);
        } else if (type === 'landheightmap') {
            [cr, cg, cb] = landHeightmapColor(r_elevation[br]);
        } else if (type === 'heightmap') {
            [cr, cg, cb] = heightmapColor(r_elevation[br]);
        } else if (type === 'biome' && biomeSmoothed) {
            cr = biomeSmoothed[br * 3]; cg = biomeSmoothed[br * 3 + 1]; cb = biomeSmoothed[br * 3 + 2];
        } else if (type === 'koppen' && koppenArr) {
            [cr, cg, cb] = koppenColor(koppenArr[br]);
        } else {
            [cr, cg, cb] = elevationToColor(r_elevation[br]);
        }

        const x0 = t_xyz[3*it], y0 = t_xyz[3*it+1], z0 = t_xyz[3*it+2];
        const x1 = t_xyz[3*ot], y1 = t_xyz[3*ot+1], z1 = t_xyz[3*ot+2];
        const x2 = r_xyz[3*br], y2 = r_xyz[3*br+1], z2 = r_xyz[3*br+2];

        let lon0 = Math.atan2(x0, z0), lat0 = Math.asin(Math.max(-1, Math.min(1, y0)));
        let lon1 = Math.atan2(x1, z1), lat1 = Math.asin(Math.max(-1, Math.min(1, y1)));
        let lon2 = Math.atan2(x2, z2), lat2 = Math.asin(Math.max(-1, Math.min(1, y2)));

        const clx = (v) => Math.max(-2, Math.min(2, v));
        const cly = (v) => Math.max(-1, Math.min(1, v));

        const maxLon = Math.max(lon0, lon1, lon2);
        const minLon = Math.min(lon0, lon1, lon2);
        const wraps = (maxLon - minLon) > PI;

        if (wraps) {
            if (lon0 < 0) lon0 += 2 * PI;
            if (lon1 < 0) lon1 += 2 * PI;
            if (lon2 < 0) lon2 += 2 * PI;

            let off = triCount * 9;
            posArr[off]   = clx(lon0*sx); posArr[off+1] = cly(lat0*sx); posArr[off+2] = 0;
            posArr[off+3] = clx(lon1*sx); posArr[off+4] = cly(lat1*sx); posArr[off+5] = 0;
            posArr[off+6] = clx(lon2*sx); posArr[off+7] = cly(lat2*sx); posArr[off+8] = 0;
            colArr[off]=cr; colArr[off+1]=cg; colArr[off+2]=cb;
            colArr[off+3]=cr; colArr[off+4]=cg; colArr[off+5]=cb;
            colArr[off+6]=cr; colArr[off+7]=cg; colArr[off+8]=cb;
            triCount++;

            off = triCount * 9;
            posArr[off]   = clx((lon0-2*PI)*sx); posArr[off+1] = cly(lat0*sx); posArr[off+2] = 0;
            posArr[off+3] = clx((lon1-2*PI)*sx); posArr[off+4] = cly(lat1*sx); posArr[off+5] = 0;
            posArr[off+6] = clx((lon2-2*PI)*sx); posArr[off+7] = cly(lat2*sx); posArr[off+8] = 0;
            colArr[off]=cr; colArr[off+1]=cg; colArr[off+2]=cb;
            colArr[off+3]=cr; colArr[off+4]=cg; colArr[off+5]=cb;
            colArr[off+6]=cr; colArr[off+7]=cg; colArr[off+8]=cb;
            triCount++;
        } else {
            const off = triCount * 9;
            posArr[off]   = clx(lon0*sx); posArr[off+1] = cly(lat0*sx); posArr[off+2] = 0;
            posArr[off+3] = clx(lon1*sx); posArr[off+4] = cly(lat1*sx); posArr[off+5] = 0;
            posArr[off+6] = clx(lon2*sx); posArr[off+7] = cly(lat2*sx); posArr[off+8] = 0;
            colArr[off]=cr; colArr[off+1]=cg; colArr[off+2]=cb;
            colArr[off+3]=cr; colArr[off+4]=cg; colArr[off+5]=cb;
            colArr[off+6]=cr; colArr[off+7]=cg; colArr[off+8]=cb;
            triCount++;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr.buffer, 0, triCount * 9), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colArr.buffer, 0, triCount * 9), 3));

    const mapMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));

    const offScene = new THREE.Scene();
    offScene.background = isBW ? new THREE.Color(0x000000) : new THREE.Color(0x1a1a2e);
    offScene.add(mapMesh);

    // Tiled rendering — split into small tiles to stay within GPU/CPU memory limits.
    // Cap at 2048 regardless of GPU maxTextureSize to keep render-target + pixel-
    // readback + ImageData under ~48 MB per tile (2048×2048×4 × 3 buffers).
    const maxTex = renderer.capabilities.maxTextureSize;
    const MAX_TILE = 2048;
    const tileW = Math.min(width, maxTex, MAX_TILE);
    const tileH = Math.min(height, maxTex, MAX_TILE);
    const tilesX = Math.ceil(width / tileW);
    const tilesY = Math.ceil(height / tileH);
    const totalTiles = tilesX * tilesY;

    const cvs = document.createElement('canvas');
    cvs.width = width;
    cvs.height = height;
    const ctx = cvs.getContext('2d');

    let tilesDone = 0;
    for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
            const px0 = tx * tileW;
            const py0 = ty * tileH;
            const pw = Math.min(tileW, width - px0);
            const ph = Math.min(tileH, height - py0);

            // Orthographic frustum for this tile (map space: x [-2,2], y [-1,1])
            const left   = -2 + 4 * px0 / width;
            const right  = -2 + 4 * (px0 + pw) / width;
            const top    =  1 - 2 * py0 / height;
            const bottom =  1 - 2 * (py0 + ph) / height;

            const cam = new THREE.OrthographicCamera(left, right, top, bottom, 0.1, 10);
            cam.position.set(0, 0, 5);
            cam.lookAt(0, 0, 0);

            const renderTarget = new THREE.WebGLRenderTarget(pw, ph);
            renderer.setRenderTarget(renderTarget);
            renderer.render(offScene, cam);

            const pixels = new Uint8Array(pw * ph * 4);
            renderer.readRenderTargetPixels(renderTarget, 0, 0, pw, ph, pixels);
            renderer.setRenderTarget(null);
            renderTarget.dispose();

            // Write tile to canvas (flip rows + sRGB gamma)
            const imageData = ctx.createImageData(pw, ph);
            const out = imageData.data;
            for (let y = 0; y < ph; y++) {
                const src = (ph - 1 - y) * pw * 4;
                const dst = y * pw * 4;
                for (let x = 0; x < pw; x++) {
                    const si = src + x * 4, di = dst + x * 4;
                    for (let c = 0; c < 3; c++) {
                        const v = pixels[si + c] / 255;
                        out[di + c] = (v <= 0.0031308
                            ? v * 12.92
                            : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255 + 0.5 | 0;
                    }
                    out[di + 3] = pixels[si + 3];
                }
            }
            ctx.putImageData(imageData, px0, py0);

            tilesDone++;
            if (onProgress) onProgress(tilesDone / totalTiles * 80, 'Rendering...');
            await new Promise(r => setTimeout(r, 0));
        }
    }

    // Cleanup mesh
    geo.dispose();
    mapMesh.material.dispose();

    // Encode & download
    if (onProgress) onProgress(85, 'Encoding PNG...');
    await new Promise(r => setTimeout(r, 0));

    const code = location.hash.replace(/^#/, '').trim() || (state.curData ? state.curData.seed : '');
    const filename = exportFilename(type, code);

    await new Promise(resolve => {
        cvs.toBlob(blob => {
            if (blob) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            }
            // Release canvas bitmap memory so sequential exports don't accumulate
            cvs.width = 0;
            cvs.height = 0;
            resolve();
        }, 'image/png');
    });
}

// Batch export — builds geometry once, recolors per type. Avoids GPU memory
// exhaustion that occurs when exportMap is called multiple times in sequence.
export async function exportMapBatch(types, width, onProgress) {
    if (!state.curData) return;

    await new Promise(r => setTimeout(r, 50));

    const height = width / 2;
    const { mesh, r_xyz, t_xyz, r_elevation } = state.curData;
    const debugLayers = state.curData.debugLayers;
    const koppenArr = debugLayers && debugLayers.koppen;
    const biomeMode = state.planetaryParams?.biomeMode ?? 'earth';
    const biomeSmoothed = koppenArr ? getCachedBiomeSmoothed(mesh, koppenArr, r_elevation, biomeMode) : null;
    const { numSides } = mesh;
    const PI = Math.PI;
    const sx = 2 / PI;

    // Build positions once and record per-triangle region indices.
    // Positions are reused across all export types — only colors change.
    const posArr = new Float32Array(numSides * 18);
    const triRegions = new Uint32Array(numSides * 2); // max 2 tris per side (wrapping)
    let triCount = 0;

    for (let s = 0; s < numSides; s++) {
        const it = mesh.s_inner_t(s);
        const ot = mesh.s_outer_t(s);
        const br = mesh.s_begin_r(s);

        const x0 = t_xyz[3*it], y0 = t_xyz[3*it+1], z0 = t_xyz[3*it+2];
        const x1 = t_xyz[3*ot], y1 = t_xyz[3*ot+1], z1 = t_xyz[3*ot+2];
        const x2 = r_xyz[3*br], y2 = r_xyz[3*br+1], z2 = r_xyz[3*br+2];

        let lon0 = Math.atan2(x0, z0), lat0 = Math.asin(Math.max(-1, Math.min(1, y0)));
        let lon1 = Math.atan2(x1, z1), lat1 = Math.asin(Math.max(-1, Math.min(1, y1)));
        let lon2 = Math.atan2(x2, z2), lat2 = Math.asin(Math.max(-1, Math.min(1, y2)));

        const clx = (v) => Math.max(-2, Math.min(2, v));
        const cly = (v) => Math.max(-1, Math.min(1, v));

        const maxLon = Math.max(lon0, lon1, lon2);
        const minLon = Math.min(lon0, lon1, lon2);
        const wraps = (maxLon - minLon) > PI;

        if (wraps) {
            if (lon0 < 0) lon0 += 2 * PI;
            if (lon1 < 0) lon1 += 2 * PI;
            if (lon2 < 0) lon2 += 2 * PI;

            let off = triCount * 9;
            posArr[off]   = clx(lon0*sx); posArr[off+1] = cly(lat0*sx); posArr[off+2] = 0;
            posArr[off+3] = clx(lon1*sx); posArr[off+4] = cly(lat1*sx); posArr[off+5] = 0;
            posArr[off+6] = clx(lon2*sx); posArr[off+7] = cly(lat2*sx); posArr[off+8] = 0;
            triRegions[triCount] = br;
            triCount++;

            off = triCount * 9;
            posArr[off]   = clx((lon0-2*PI)*sx); posArr[off+1] = cly(lat0*sx); posArr[off+2] = 0;
            posArr[off+3] = clx((lon1-2*PI)*sx); posArr[off+4] = cly(lat1*sx); posArr[off+5] = 0;
            posArr[off+6] = clx((lon2-2*PI)*sx); posArr[off+7] = cly(lat2*sx); posArr[off+8] = 0;
            triRegions[triCount] = br;
            triCount++;
        } else {
            const off = triCount * 9;
            posArr[off]   = clx(lon0*sx); posArr[off+1] = cly(lat0*sx); posArr[off+2] = 0;
            posArr[off+3] = clx(lon1*sx); posArr[off+4] = cly(lat1*sx); posArr[off+5] = 0;
            posArr[off+6] = clx(lon2*sx); posArr[off+7] = cly(lat2*sx); posArr[off+8] = 0;
            triRegions[triCount] = br;
            triCount++;
        }
    }

    // Trim position array to actual triangle count
    const posData = new Float32Array(posArr.buffer, 0, triCount * 9);

    const offScene = new THREE.Scene();

    // Tiled rendering setup (shared across all types).
    // Cap at 2048 to keep render-target + readback + ImageData under ~48 MB per tile.
    const maxTex = renderer.capabilities.maxTextureSize;
    const MAX_TILE = 2048;
    const tileW = Math.min(width, maxTex, MAX_TILE);
    const tileH = Math.min(height, maxTex, MAX_TILE);
    const tilesX = Math.ceil(width / tileW);
    const tilesY = Math.ceil(height / tileH);
    const totalTiles = tilesX * tilesY;

    const code = location.hash.replace(/^#/, '').trim() || (state.curData ? state.curData.seed : '');
    const total = types.length;

    // Pre-allocate pixel readback buffer (reused across all tiles and types)
    const pixelBuf = new Uint8Array(tileW * tileH * 4);

    // Single canvas reused across all export types (avoids repeated bitmap allocation)
    const cvs = document.createElement('canvas');
    cvs.width = width;
    cvs.height = height;
    const ctx = cvs.getContext('2d');

    for (let ti = 0; ti < total; ti++) {
        const { type, label } = types[ti];
        const isBW = type === 'heightmap' || type === 'landheightmap' || type === 'landmask';
        offScene.background = isBW ? new THREE.Color(0x000000) : new THREE.Color(0x1a1a2e);

        // Build fresh color array for this type
        const colData = new Float32Array(triCount * 9);
        for (let i = 0; i < triCount; i++) {
            const br = triRegions[i];
            let cr, cg, cb;
            if (type === 'landmask') {
                [cr, cg, cb] = landMaskColor(r_elevation[br]);
            } else if (type === 'landheightmap') {
                [cr, cg, cb] = landHeightmapColor(r_elevation[br]);
            } else if (type === 'heightmap') {
                [cr, cg, cb] = heightmapColor(r_elevation[br]);
            } else if (type === 'biome' && biomeSmoothed) {
                cr = biomeSmoothed[br * 3]; cg = biomeSmoothed[br * 3 + 1]; cb = biomeSmoothed[br * 3 + 2];
            } else if (type === 'koppen' && koppenArr) {
                [cr, cg, cb] = koppenColor(koppenArr[br]);
            } else {
                [cr, cg, cb] = elevationToColor(r_elevation[br]);
            }
            const off = i * 9;
            colData[off] = colData[off+3] = colData[off+6] = cr;
            colData[off+1] = colData[off+4] = colData[off+7] = cg;
            colData[off+2] = colData[off+5] = colData[off+8] = cb;
        }

        // Fresh geometry + mesh per type — avoids stale GPU buffer issues
        // when the same renderer interleaves with the main animation loop.
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(posData, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colData, 3));
        const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
        const mapMesh = new THREE.Mesh(geo, mat);
        offScene.add(mapMesh);

        // Render tiles to canvas
        let tilesDone = 0;
        for (let ty = 0; ty < tilesY; ty++) {
            for (let tx = 0; tx < tilesX; tx++) {
                const px0 = tx * tileW;
                const py0 = ty * tileH;
                const pw = Math.min(tileW, width - px0);
                const ph = Math.min(tileH, height - py0);

                const left   = -2 + 4 * px0 / width;
                const right  = -2 + 4 * (px0 + pw) / width;
                const top    =  1 - 2 * py0 / height;
                const bottom =  1 - 2 * (py0 + ph) / height;

                const cam = new THREE.OrthographicCamera(left, right, top, bottom, 0.1, 10);
                cam.position.set(0, 0, 5);
                cam.lookAt(0, 0, 0);

                const renderTarget = new THREE.WebGLRenderTarget(pw, ph);
                renderer.setRenderTarget(renderTarget);
                renderer.render(offScene, cam);

                // Reuse pre-allocated buffer (always large enough for any tile)
                renderer.readRenderTargetPixels(renderTarget, 0, 0, pw, ph, pixelBuf);
                renderer.setRenderTarget(null);
                renderTarget.dispose();

                const imageData = ctx.createImageData(pw, ph);
                const out = imageData.data;
                for (let y = 0; y < ph; y++) {
                    const src = (ph - 1 - y) * pw * 4;
                    const dst = y * pw * 4;
                    for (let x = 0; x < pw; x++) {
                        const si = src + x * 4, di = dst + x * 4;
                        for (let c = 0; c < 3; c++) {
                            const v = pixelBuf[si + c] / 255;
                            out[di + c] = (v <= 0.0031308
                                ? v * 12.92
                                : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255 + 0.5 | 0;
                        }
                        out[di + 3] = pixelBuf[si + 3];
                    }
                }
                ctx.putImageData(imageData, px0, py0);

                tilesDone++;
                if (onProgress) onProgress(tilesDone / totalTiles * 80, `Exporting ${label} (${ti+1}/${total}): Rendering...`);
                await new Promise(r => setTimeout(r, 0));
            }
        }

        // Free GPU resources before PNG encode
        offScene.remove(mapMesh);
        geo.dispose();
        mat.dispose();

        // Encode & download
        if (onProgress) onProgress(85, `Exporting ${label} (${ti+1}/${total}): Encoding PNG...`);
        await new Promise(r => setTimeout(r, 0));

        const filename = exportFilename(type, code);
        await new Promise(resolve => {
            cvs.toBlob(blob => {
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                }
                resolve();
            }, 'image/png');
        });

        // Pause between exports to let the browser reclaim memory
        await new Promise(r => setTimeout(r, 100));
    }

    // Release canvas bitmap after all exports
    cvs.width = 0;
    cvs.height = 0;
}
