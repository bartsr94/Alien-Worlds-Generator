// Export modal — single-map and batch PNG export from the equirectangular map view.
import { state } from '../core/state.js';
import { computeClimateViaWorker } from '../generate.js';
import { exportMap, exportMapBatch } from '../render/planet-mesh.js';
import { showBuildOverlay, hideBuildOverlay, onProgress } from '../viz-controls.js';

export function initExportModal() {
    const overlay   = document.getElementById('exportOverlay');
    const closeBtn  = document.getElementById('exportClose');
    const cancelBtn = document.getElementById('exportCancel');
    const goBtn     = document.getElementById('exportGo');
    const widthEl   = document.getElementById('exportWidth');
    const dimsEl    = document.getElementById('exportDims');
    const typeEl    = document.getElementById('exportType');
    const openBtn   = document.getElementById('exportBtn');

    function updateDims() {
        const w = +widthEl.value;
        dimsEl.textContent = w + ' \u00D7 ' + (w / 2);
    }

    function openModal() {
        overlay.classList.remove('hidden');
        updateDims();
        // Disable climate-dependent export types when climate isn't computed
        for (const opt of typeEl.options) {
            if (opt.value === 'biome' || opt.value === 'koppen') {
                opt.disabled = !state.climateComputed;
                if (opt.disabled && typeEl.value === opt.value) typeEl.value = 'color';
            }
        }
    }
    function closeModal() { overlay.classList.add('hidden'); }

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal();
    });
    widthEl.addEventListener('change', updateDims);

    goBtn.addEventListener('click', async () => {
        const type = typeEl.value;
        const w = +widthEl.value;
        closeModal();
        showBuildOverlay();
        onProgress(0, 'Preparing export...');
        try {
            await exportMap(type, w, onProgress);
        } catch (err) {
            console.error('Export failed:', err);
        } finally {
            hideBuildOverlay();
        }
    });

    // Export All — downloads Satellite, Climate, Heightmap, and Land Mask
    const exportAllBtn = document.getElementById('exportAllGo');
    const EXPORT_ALL_TYPES = [
        { type: 'biome',          label: 'Satellite' },
        { type: 'koppen',         label: 'Climate' },
        { type: 'landheightmap',  label: 'Heightmap' },
        { type: 'landmask',       label: 'Land Mask' },
    ];

    exportAllBtn.addEventListener('click', async () => {
        const w = +widthEl.value;
        closeModal();
        showBuildOverlay();

        // Compute climate first if needed (Satellite & Climate require it)
        if (!state.climateComputed) {
            onProgress(0, 'Computing climate...');
            await new Promise(resolve => computeClimateViaWorker(onProgress, resolve));
        }

        try {
            await exportMapBatch(EXPORT_ALL_TYPES, w, onProgress);
        } catch (err) {
            console.error('Batch export failed:', err);
        } finally {
            hideBuildOverlay();
        }
    });
}
