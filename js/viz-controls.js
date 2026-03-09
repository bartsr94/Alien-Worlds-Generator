// Visualization layer switching, legend rendering, and build overlay.
import { state } from './core/state.js';
import { updateMeshColors, buildWindArrows, buildOceanCurrentArrows,
         updateKoppenHoverHighlight, updateMapKoppenHoverHighlight } from './render/planet-mesh.js';
import { KOPPEN_CLASSES } from './sim/koppen.js';
import { elevationToColor } from './render/color-map.js';
import { computeClimateViaWorker } from './generate.js';

// Climate layer keys — layers that require climate data
export const CLIMATE_LAYERS = new Set([
    'pressureSummer', 'pressureWinter',
    'windSpeedSummer', 'windSpeedWinter',
    'oceanCurrentSummer', 'oceanCurrentWinter',
    'precipSummer', 'precipWinter',
    'rainShadowSummer', 'rainShadowWinter',
    'tempSummer', 'tempWinter',
    'koppen', 'biome', 'continentality',
    'hydroState', 'habitability',
]);

// Map tabs → tab-layer mapping
const mapTabs = document.getElementById('mapTabs');
const vizLegend = document.getElementById('vizLegend');
export const debugLayerEl = document.getElementById('debugLayer');

export function switchVisualization(layer) {
    if (CLIMATE_LAYERS.has(layer) && !state.climateComputed) {
        // Need to compute climate first
        showBuildOverlay();
        computeClimateViaWorker(onProgress, () => {
            hideBuildOverlay();
            applyLayer(layer);
        });
        return;
    }
    applyLayer(layer);
}

function applyLayer(layer) {
    state.debugLayer = layer;
    state.hoveredKoppen = -1;
    updateMeshColors();
    // Show/hide wind/ocean arrows
    const isWindLayer = layer === 'pressureSummer' || layer === 'pressureWinter' ||
                        layer === 'windSpeedSummer' || layer === 'windSpeedWinter';
    const isOceanLayer = layer === 'oceanCurrentSummer' || layer === 'oceanCurrentWinter';
    if (isOceanLayer) {
        const season = layer.includes('Winter') ? 'winter' : 'summer';
        buildWindArrows(null);
        buildOceanCurrentArrows(season);
    } else if (isWindLayer) {
        const season = layer.includes('Winter') ? 'winter' : 'summer';
        buildOceanCurrentArrows(null);
        buildWindArrows(season);
    } else {
        buildWindArrows(null);
        buildOceanCurrentArrows(null);
    }
    updateLegend(layer);
}

export function syncTabsToLayer(layer) {
    mapTabs.querySelectorAll('.map-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.layer === layer);
    });
    // Sync mobile view switcher (only for main views it knows about)
    const mvs = document.getElementById('mobileViewSwitch');
    if (mvs && [...mvs.options].some(o => o.value === layer)) {
        mvs.value = layer;
    }
}

mapTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.map-tab');
    if (!tab) return;
    const layer = tab.dataset.layer;
    // Update active tab
    mapTabs.querySelectorAll('.map-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    // Sync debug dropdown + mobile switcher
    if (debugLayerEl) debugLayerEl.value = layer;
    mobileViewSwitch.value = layer;
    switchVisualization(layer);
});

// Mobile view switcher
const mobileViewSwitch = document.getElementById('mobileViewSwitch');
mobileViewSwitch.addEventListener('change', (e) => {
    const layer = e.target.value;
    syncTabsToLayer(layer);
    if (debugLayerEl) debugLayerEl.value = layer;
    switchVisualization(layer);
});

// Koppen climate zone descriptions for hover tooltips
const KOPPEN_DESCRIPTIONS = {
    Af:  'Tropical rainforest — Hot and wet year-round. Amazon Basin, Congo Basin, Southeast Asia.',
    Am:  'Tropical monsoon — Brief dry season offset by heavy monsoon rains. Southern India, West Africa, Northern Australia.',
    Aw:  'Tropical savanna — Distinct wet and dry seasons. Sub-Saharan Africa, Brazilian Cerrado, Northern Australia.',
    BWh: 'Hot desert — Extremely dry with scorching summers. Sahara, Arabian Desert, Sonoran Desert.',
    BWk: 'Cold desert — Arid with cold winters. Gobi Desert, Patagonian steppe, Great Basin.',
    BSh: 'Hot steppe — Semi-arid grassland with hot summers. Sahel, outback Australia, northern Mexico.',
    BSk: 'Cold steppe — Semi-arid with cold winters. Central Asian steppe, Montana, Anatolian plateau.',
    Cfa: 'Humid subtropical — Hot humid summers, mild winters. Southeastern US, eastern China, Buenos Aires.',
    Cfb: 'Oceanic — Mild year-round, cool summers, frequent rain. Western Europe, New Zealand, Pacific Northwest.',
    Cfc: 'Subpolar oceanic — Cool year-round with short summers. Iceland, southern Chile, Faroe Islands.',
    Csa: 'Hot-summer Mediterranean — Dry hot summers, mild wet winters. Southern California, Greece, coastal Turkey.',
    Csb: 'Warm-summer Mediterranean — Dry warm summers, mild wet winters. San Francisco, Porto, Cape Town.',
    Csc: 'Cold-summer Mediterranean — Cool dry summers, mild wet winters. Rare; high-altitude Mediterranean coasts.',
    Cwa: 'Humid subtropical monsoon — Warm with dry winters. Hong Kong, northern India, Southeastern Brazil highlands.',
    Cwb: 'Subtropical highland — Mild with dry winters. Mexico City, Bogota, Ethiopian Highlands.',
    Cwc: 'Cold subtropical highland — Cool with dry winters. Rare; high-altitude tropical mountains.',
    Dfa: 'Hot-summer continental — Hot summers, cold snowy winters. Chicago, Kyiv, Beijing.',
    Dfb: 'Warm-summer continental — Warm summers, cold winters. Moscow, southern Scandinavia, New England.',
    Dfc: 'Subarctic — Long cold winters, brief cool summers. Siberia, northern Canada, interior Alaska.',
    Dfd: 'Extremely cold subarctic — Harshest winters on Earth. Yakutsk, Verkhoyansk (eastern Siberia).',
    Dsa: 'Hot-summer continental, dry summer — Hot dry summers, cold winters. Parts of eastern Turkey, Iran.',
    Dsb: 'Warm-summer continental, dry summer — Dry warm summers, cold winters. Parts of the western US highlands.',
    Dsc: 'Subarctic, dry summer — Cool dry summers, very cold winters. Rare; high-altitude inland regions.',
    Dsd: 'Extremely cold subarctic, dry summer — Very rare; extreme cold with dry summers.',
    Dwa: 'Hot-summer continental, monsoon — Wet hot summers, dry cold winters. Northern China, Korea.',
    Dwb: 'Warm-summer continental, monsoon — Wet warm summers, dry cold winters. Parts of northeast China.',
    Dwc: 'Subarctic monsoon — Brief wet summers, long dry frigid winters. Eastern Siberia, far northeast China.',
    Dwd: 'Extremely cold subarctic, monsoon — Extreme cold, driest in winter. Interior eastern Siberia.',
    ET:  'Tundra — Permafrost, only warmest month above 0 C. Arctic coasts, high mountain plateaus.',
    EF:  'Ice cap — Permanent ice, never above 0 C. Antarctica interior, Greenland ice sheet.',
};

// Legend rendering
export function updateLegend(layer) {
    if (!vizLegend) return;

    if (layer === '' || !layer) {
        // Terrain legend — colors from elevationToColor (already aware of hasLiquidOcean)
        const hasOcean = state.planetaryParams?.hasLiquidOcean !== false;
        const stops = [
            { e: -0.50, label: '' },
            { e: -0.25, label: '' },
            { e: -0.05, label: '' },
            { e: 0.00, label: '' },
            { e: 0.03, label: '' },
            { e: 0.15, label: '' },
            { e: 0.35, label: '' },
            { e: 0.55, label: '' },
            { e: 0.80, label: '' }
        ];
        const colors = stops.map(s => {
            const [r, g, b] = elevationToColor(s.e);
            return `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
        });
        const pcts = stops.map((_, i) => Math.round(i / (stops.length - 1) * 100));
        const gradStr = colors.map((c, i) => `${c} ${pcts[i]}%`).join(', ');
        const leftLabel  = hasOcean ? 'Deep Ocean' : 'Deep Basin';
        const midLabel   = hasOcean ? 'Sea Level'  : 'Ground';
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,${gradStr})"></div>` +
            `<div class="legend-labels"><span>${leftLabel}</span><span>${midLabel}</span><span>Peak</span></div>`;
    } else if (layer === 'koppen') {
        // Koppen legend — Wikipedia link + swatches with hover tooltips
        let html = '<div class="legend-koppen-header"><a href="https://en.wikipedia.org/wiki/K%C3%B6ppen_climate_classification" target="_blank" rel="noopener">K\u00f6ppen climate classification</a></div>';
        html += '<div class="legend-koppen">';
        for (let i = 1; i < KOPPEN_CLASSES.length; i++) {
            const k = KOPPEN_CLASSES[i];
            const [r, g, b] = k.color;
            const hex = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
            const desc = KOPPEN_DESCRIPTIONS[k.code] || k.name;
            html += `<div class="legend-koppen-item" data-code="${k.code}"><span class="legend-koppen-swatch" style="background:${hex}"></span>${k.code}</div>`;
        }
        html += '<div class="legend-koppen-tooltip" id="koppenTip"></div>';
        html += '</div>';
        vizLegend.innerHTML = html;
        // Wire hover tooltips with dynamic positioning
        const tipEl = document.getElementById('koppenTip');
        const container = vizLegend.querySelector('.legend-koppen');
        vizLegend.querySelectorAll('.legend-koppen-item').forEach(item => {
            item.addEventListener('mouseenter', () => {
                const code = item.dataset.code;
                const desc = KOPPEN_DESCRIPTIONS[code] || '';
                tipEl.textContent = desc;
                tipEl.classList.add('visible');
                // Position above the hovered item, clamped within the container
                const itemRect = item.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const tipWidth = 240;
                let left = itemRect.left - containerRect.left + itemRect.width / 2 - tipWidth / 2;
                left = Math.max(0, Math.min(left, containerRect.width - tipWidth));
                tipEl.style.left = left + 'px';
                tipEl.style.bottom = (containerRect.bottom - itemRect.top + 6) + 'px';
                // Highlight matching cells on the mesh
                const classId = KOPPEN_CLASSES.findIndex(c => c.code === code);
                if (classId >= 0) {
                    state.hoveredKoppen = classId;
                    updateKoppenHoverHighlight();
                    updateMapKoppenHoverHighlight();
                }
            });
            item.addEventListener('mouseleave', () => {
                tipEl.classList.remove('visible');
                state.hoveredKoppen = -1;
                updateKoppenHoverHighlight();
                updateMapKoppenHoverHighlight();
            });
        });
    } else if (layer === 'biome') {
        // Satellite biome legend — gradient bar of key biome colors
        const biomeStops = [
            { color: [0.82,0.72,0.50], label: 'Desert' },
            { color: [0.72,0.62,0.30], label: 'Steppe' },
            { color: [0.42,0.50,0.18], label: 'Savanna' },
            { color: [0.12,0.38,0.10], label: 'Forest' },
            { color: [0.06,0.22,0.08], label: 'Taiga' },
            { color: [0.35,0.32,0.22], label: 'Tundra' },
            { color: [0.78,0.80,0.84], label: 'Ice' },
        ];
        const biomeColors = biomeStops.map(s => {
            const [r, g, b] = s.color;
            return `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
        });
        const biomePcts = biomeStops.map((_, i) => Math.round(i / (biomeStops.length - 1) * 100));
        const biomeGrad = biomeColors.map((c, i) => `${c} ${biomePcts[i]}%`).join(', ');
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,${biomeGrad})"></div>` +
            `<div class="legend-labels"><span>${biomeStops[0].label}</span><span>${biomeStops[3].label}</span><span>${biomeStops[6].label}</span></div>`;
    } else if (layer === 'rainShadowSummer' || layer === 'rainShadowWinter') {
        // Rain shadow diverging legend: leeward shadow ↔ neutral ↔ windward boost
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,rgb(230,51,33) 0%,rgb(140,140,148) 50%,rgb(38,102,243) 100%)"></div>` +
            `<div class="legend-labels"><span>Rain Shadow</span><span>Neutral</span><span>Windward</span></div>`;
    } else if (layer === 'heightmap') {
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,#000 0%,#404040 25%,#fff 100%)"></div>` +
            `<div class="legend-labels"><span>Ocean Floor</span><span>Sea Level</span><span>Peak</span></div>`;
    } else if (layer === 'landheightmap') {
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,#000 0%,#fff 100%)"></div>` +
            `<div class="legend-labels"><span>Sea Level</span><span>Peak</span></div>`;
    } else if (layer === 'hydroState') {
        vizLegend.innerHTML =
            `<div class="legend-discrete">` +
            `<span class="ld-item"><span class="ld-swatch" style="background:rgb(10,46,173)"></span>Liquid Ocean</span>` +
            `<span class="ld-item"><span class="ld-swatch" style="background:rgb(204,230,247)"></span>Frozen</span>` +
            `<span class="ld-item"><span class="ld-swatch" style="background:rgb(184,140,71)"></span>Dry Basin</span>` +
            `<span class="ld-item"><span class="ld-swatch" style="background:rgb(87,77,66)"></span>Land</span>` +
            `</div>`;
    } else if (layer === 'habitability') {
        vizLegend.innerHTML = `<div class="legend-gradient" style="background:linear-gradient(to right,rgb(51,20,20) 0%,rgb(191,102,13) 30%,rgb(191,170,13) 55%,rgb(20,184,56) 100%)"></div>` +
            `<div class="legend-labels"><span>Inhospitable</span><span>Marginal</span><span>Habitable</span></div>`;
    } else {
        vizLegend.innerHTML = '';
    }
}

// Build overlay — unified loading / generation overlay
const buildOverlay  = document.getElementById('buildOverlay');
const buildBarFill  = document.getElementById('buildBarFill');
const buildBarLabel = document.getElementById('buildBarLabel');
let overlayActive = true; // starts active (visible in HTML on first load)

export function onProgress(pct, label) {
    if (!overlayActive) return;
    if (buildBarFill)  buildBarFill.style.transform = 'scaleX(' + (pct / 100) + ')';
    if (buildBarLabel) buildBarLabel.textContent = label;
}

export function showBuildOverlay() {
    if (!buildBarFill || !buildOverlay) return;
    // Snap bar to 0 instantly — disable transition, reset transform, force reflow
    buildBarFill.style.transition = 'none';
    buildBarFill.style.transform = 'scaleX(0)';
    buildBarLabel.textContent = '';
    buildBarFill.offsetWidth; // force reflow
    buildBarFill.style.transition = '';
    overlayActive = true;
    buildOverlay.classList.remove('hidden');
}

export function hideBuildOverlay() {
    setTimeout(() => {
        overlayActive = false;
        if (buildOverlay) {
            buildOverlay.classList.add('hidden');
            // After first generation, switch from opaque to semi-transparent
            buildOverlay.classList.remove('initial');
        }
    }, 500);
}
