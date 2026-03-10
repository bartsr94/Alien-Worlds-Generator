// Solar system UI — orrery, body list, saved systems panel, clock controls,
// system creation/entry/exit, background generation queue, body param overrides.
// Initialized from main.js via initSolarSystem(config).

import { state } from './core/state.js';
import { generate } from './generate.js';
import {
    waterMesh, atmosMesh, starsMesh, canvas,
    updateAtmosphereColor, updateWaterColor, updateHazeLayer,
    switchToOrrery, switchToPlanetView,
    updateMoonScene, updateParentScene,
    startBodyTransition,
} from './render/scene.js';
import {
    setUpliftMult, setHasLiquidOcean, setBaseTemp, setAtmosphere, setHydrosphere,
} from './render/color-map.js';
import { buildMesh, updateMeshColors } from './render/planet-mesh.js';
import { buildPlanetaryParams } from './world/planetary-params.js';
import { OUR_SOLAR_SYSTEM, generateSystem } from './world/solar-system.js';
import { bodyParamsToSliderValues } from './world/system-planet-params.js';
import {
    loadRegistry, upsertSystem, deleteSystem, setActiveSystemId,
    getBodyOverride, saveBodyOverride, clearBodyOverride,
    markBodyGenerated, isBodyGenerated, renameSystem,
} from './world/system-storage.js';
import { initOrrery, tickOrrery, enterOrrery, exitOrrery, getBodyAtMouse } from './orrery.js';
import {
    tickClock, getGameDate, isPaused, togglePause,
    setSpeedIndex, getSpeedIndex, resetClock, getGameDays,
} from './game-clock.js';

export function initSolarSystem({ onProgress, shouldSkipClimate, switchPanel, showBuildOverlay }) {
    const systemBtn     = document.getElementById('systemBtn');
    const systemPanel   = document.getElementById('systemPanel');
    const solarSysBtn   = document.getElementById('solarSystemBtn');
    const genSysBtn     = document.getElementById('generateSystemBtn');
    const bodyListEl    = document.getElementById('bodyList');
    const systemNameEl  = document.getElementById('systemNameDisplay');
    const backToSysEl   = document.getElementById('backToSystem');
    const backToGlobeBtn = document.getElementById('backToGlobeBtn');
    const systemBarEl   = document.getElementById('systemBar');
    const gameDateEl    = document.getElementById('gameDate');
    const pauseBtn      = document.getElementById('btnPause');
    const speedBtns     = document.querySelectorAll('.speed-btn');
    const bodyInfoCard  = document.getElementById('bodyInfoCard');
    const bodyInfoName  = document.getElementById('bodyInfoName');
    const bodyInfoType  = document.getElementById('bodyInfoType');
    const bodyInfoOrbit = document.getElementById('bodyInfoOrbit');
    const bodyInfoStatus = document.getElementById('bodyInfoStatus');

    // ── Module-level solar system state ──────────────────────────────────────
    let _bgBodyId      = null;  // bodyId currently being quietly background-generated
    let _pendingBodyId = null;  // bodyId the user clicked — fg generation in progress
    let _systemSeed    = Math.floor(Math.random() * 0xFFFFFF);

    // ── Helper: apply body params to the five physics sliders ────────────────
    function applyBodyParams(params) {
        const sv = bodyParamsToSliderValues(params);
        if (!sv) return;
        const map = {
            sGravity: sv.gravity, sWorldSize: sv.worldSize,
            sAtm: sv.atmosphere, sHydro: sv.hydrosphere,
            sBaseTemp: sv.baseTemp, sTilt: sv.axialTilt,
        };
        for (const [id, val] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.value = val;
            el.dispatchEvent(new Event('input'));
        }
        const wp = document.getElementById('worldPreset');
        if (wp) { wp.value = 'custom'; state.currentPreset = 'custom'; }
    }

    // ── Body list rendering ───────────────────────────────────────────────────
    const TYPE_COLORS = {
        star:   '#ffdd88', rocky: '#cc8855', icy: '#88ccee',
        gas:    '#c8a87a', belt:  '#887766',
    };
    const TYPE_LABELS = {
        star: 'Star', rocky: 'Rocky Planet', icy: 'Ice World',
        gas: 'Gas Giant', belt: 'Asteroid Belt',
    };

    function renderBodyList() {
        if (!bodyListEl || !state.currentSystem) return;
        bodyListEl.innerHTML = '';
        for (const body of state.currentSystem.bodies) {
            const canEnter = body.params !== null;
            const isMoon   = !!body.parentId;
            const item = document.createElement('div');
            item.className = 'body-list-item' + (canEnter ? '' : ' no-globe') + (isMoon ? ' body-moon-item' : '');
            if (body.id === state.activeBodyId) item.classList.add('active');

            const dot = document.createElement('span');
            dot.className = 'body-dot';
            dot.style.background = TYPE_COLORS[body.type] ?? '#888';

            const name = document.createElement('span');
            name.className = 'body-item-name';
            name.textContent = body.name;

            const type = document.createElement('span');
            type.className = 'body-item-type';
            type.textContent = isMoon ? 'Moon' : (TYPE_LABELS[body.type] ?? body.type);

            const status = document.createElement('span');
            status.className = 'body-status';
            if (body.id === state.activeBodyId) {
                status.textContent = 'viewing'; status.classList.add('active');
            } else if (state.generatedBodies.has(body.id)) {
                status.textContent = '✓ ready'; status.classList.add('ready');
            } else if (state.currentSystemId && isBodyGenerated(state.currentSystemId, body.id)) {
                // Previously generated in a past session but not yet in the in-session cache
                status.textContent = '✓'; status.classList.add('ready');
            } else if (canEnter) {
                status.textContent = '…';
            }

            item.append(dot, name, type, status);
            if (canEnter) {
                item.addEventListener('click', () => enterBody(body.id));
            }
            bodyListEl.appendChild(item);
        }
    }

    // ── Saved Systems list ────────────────────────────────────────────────────
    function renderSavedSystemsList() {
        const listEl = document.getElementById('savedSystemsList');
        if (!listEl) return;
        const registry = loadRegistry();
        listEl.innerHTML = '';

        if (registry.systems.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'saved-system-empty';
            empty.textContent = 'No saved systems yet.';
            listEl.appendChild(empty);
            return;
        }

        for (const sys of registry.systems) {
            const isActive = sys.id === state.currentSystemId;
            const hasOverrides = Object.keys(sys.bodyOverrides ?? {}).length > 0;
            const genCount = (sys.generatedBodyIds ?? []).length;

            const li = document.createElement('li');
            li.className = 'saved-system-row' + (isActive ? ' active' : '');

            // Left: name + badges
            const left = document.createElement('div');
            left.className = 'saved-system-left';

            const badge = document.createElement('span');
            badge.className = `saved-system-badge saved-system-badge-${sys.type}`;
            badge.textContent = sys.type === 'sol' ? 'Sol' : 'Random';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'saved-system-name';
            nameSpan.setAttribute('contenteditable', 'true');
            nameSpan.setAttribute('spellcheck', 'false');
            nameSpan.textContent = sys.name;
            if (hasOverrides) {
                const mod = document.createElement('span');
                mod.className = 'saved-system-modified';
                mod.textContent = ' (modified)';
                nameSpan.appendChild(mod);
            }
            nameSpan.addEventListener('blur', () => {
                const raw = nameSpan.childNodes[0]?.nodeValue?.trim() ?? '';
                if (raw && raw !== sys.name) {
                    renameSystem(sys.id, raw);
                    renderSavedSystemsList();
                }
            });
            nameSpan.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); nameSpan.blur(); }
            });

            const meta = document.createElement('span');
            meta.className = 'saved-system-meta';
            meta.textContent = `${genCount} explored · ${_relativeDate(sys.savedAt)}`;

            left.append(badge, nameSpan, meta);

            // Right: action buttons
            const right = document.createElement('div');
            right.className = 'saved-system-actions';

            if (!isActive) {
                const loadBtn = document.createElement('button');
                loadBtn.className = 'saved-system-btn';
                loadBtn.textContent = 'Load';
                loadBtn.addEventListener('click', () => {
                    if (sys.type === 'sol') {
                        enterSystemMode(OUR_SOLAR_SYSTEM);
                    } else if (sys.seed) {
                        enterSystemMode(generateSystem(sys.seed));
                    }
                });
                right.appendChild(loadBtn);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'saved-system-btn saved-system-btn-danger';
            delBtn.textContent = '✕';
            delBtn.title = 'Delete saved system';
            delBtn.addEventListener('click', () => {
                if (!confirm(`Delete "${sys.name}" from saved systems?`)) return;
                deleteSystem(sys.id);
                // If we deleted the active system's record, clear the currentSystemId
                // so it doesn't reappear on next page load
                if (sys.id === state.currentSystemId) {
                    setActiveSystemId(null);
                }
                renderSavedSystemsList();
            });
            right.appendChild(delBtn);

            li.append(left, right);
            listEl.appendChild(li);
        }
    }

    function _relativeDate(ts) {
        if (!ts) return '';
        const diffMs  = Date.now() - ts;
        const diffDays = Math.floor(diffMs / 86400000);
        if (diffDays === 0) return 'today';
        if (diffDays === 1) return 'yesterday';
        if (diffDays < 30) return `${diffDays}d ago`;
        return new Date(ts).toLocaleDateString();
    }

    // ── Enter a solar system body (set sliders + generate or restore) ─────────
    function enterBody(bodyId) {
        const sys  = state.currentSystem;
        const body = sys?.bodies.find(b => b.id === bodyId);
        if (!body || !body.params) return;

        state.activeBodyId = _pendingBodyId = bodyId;

        // Exit orrery view → planet view; show full planet controls in sidebar
        exitOrrery();
        switchToPlanetView();
        startBodyTransition(); // camera fly-in from far space
        state.solarSystemMode = false;

        // Switch sidebar to World panel
        switchPanel('world');
        systemPanel?.classList.add('hidden');
        const banner = document.getElementById('bodyViewBanner');
        const bannerName = document.getElementById('bodyBannerName');
        if (banner) banner.classList.remove('hidden');
        if (bannerName) bannerName.textContent = body.name;

        backToSysEl?.classList.add('hidden'); // banner back button covers it
        backToGlobeBtn?.classList.add('hidden');

        // Restore from cache if available
        if (state.generatedBodies.has(bodyId)) {
            const cached = state.generatedBodies.get(bodyId);
            state.curData = cached.curData;
            applyBodyParams(body.params);
            // Layer any stored override on top of base params
            const override = getBodyOverride(state.currentSystemId, bodyId);
            if (override) applyBodyParams(override);
            // Re-apply planetary params module state
            state.planetaryParams = buildPlanetaryParams({
                gravity: +(document.getElementById('sGravity')?.value ?? 1.0),
                worldSize: +(document.getElementById('sWorldSize')?.value ?? 1.0),
                atmosphere: +(document.getElementById('sAtm')?.value ?? 3),
                hydrosphere: +(document.getElementById('sHydro')?.value ?? 3),
                baseTemp: +(document.getElementById('sBaseTemp')?.value ?? 15),
                axialTilt: +(document.getElementById('sTilt')?.value ?? 23),
                preset: 'custom',
            });
            updateAtmosphereColor(state.planetaryParams.atmosphereRimColor);
            updateWaterColor(state.planetaryParams.surfaceFluidColor);
            updateHazeLayer(state.planetaryParams.hazeOpacity, state.planetaryParams.atmosphereTint);
            setUpliftMult(state.planetaryParams.upliftMultiplier);
            setHasLiquidOcean(state.planetaryParams.hasLiquidOcean);
            setBaseTemp(state.planetaryParams.baseTemp);
            setAtmosphere(state.planetaryParams.atmosphere);
            setHydrosphere(state.planetaryParams.hydrosphere);
            buildMesh();
            updateMeshColors();
            updateMoonScene(body, state.currentSystem.bodies);
            updateParentScene(body, state.currentSystem.bodies);
            _pendingBodyId = null;
            renderBodyList();
            return;
        }

        // Not cached → run full generation
        applyBodyParams(body.params);
        // Layer any stored override on top of base params
        const override = getBodyOverride(state.currentSystemId, bodyId);
        if (override) applyBodyParams(override);
        showBuildOverlay();
        generate(
            /* seed */ _systemSeed ^ (bodyId.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)),
            /* toggles */ [],
            onProgress,
            shouldSkipClimate(),
        );
        renderBodyList();
    }

    // ── Return to orrery from planet view ────────────────────────────────────
    function backToSystem() {
        state.solarSystemMode = true;
        state.activeBodyId    = null;
        _pendingBodyId        = null;

        // Clear stale plate-hover state so the info card doesn't linger
        state.hoveredPlate  = -1;
        state.hoveredRegion = -1;
        const hoverEl = document.getElementById('hoverInfo');
        if (hoverEl) hoverEl.style.display = 'none';

        // Restore system panel in sidebar, hide body-view banner
        switchPanel('system');
        document.getElementById('bodyViewBanner')?.classList.add('hidden');

        backToSysEl?.classList.add('hidden');
        backToGlobeBtn?.classList.add('hidden');

        // Hide planet visuals
        if (state.planetMesh) state.planetMesh.visible = false;
        waterMesh.visible = false;
        atmosMesh.visible = false;
        starsMesh.visible = false;
        if (state.wireMesh) state.wireMesh.visible = false;
        updateHazeLayer(0, null);
        updateMoonScene(null, null);
        updateParentScene(null, null);

        switchToOrrery();
        enterOrrery();
        renderBodyList();
        updateSysBarPauseBtn();
    }

    // ── Enter system mode (from planet-only mode) ─────────────────────────────
    function enterSystemMode(system) {
        // Compute a stable string ID for this system so its cache persists across
        // system-switching within the same session.
        // Use identity comparison to distinguish OUR_SOLAR_SYSTEM from any
        // random system that might coincidentally share the same seed value.
        const isSol    = Object.is(system, OUR_SOLAR_SYSTEM);
        const systemId = isSol ? 'sol' : `random-${system.seed}`;
        const systemType = isSol ? 'sol' : 'random';

        state.currentSystem   = system;
        state.currentSystemId = systemId;
        state.solarSystemMode = true;
        state.activeBodyId    = null;

        // ── Per-system cache: reuse existing map if we visited this system before ──
        state.systemCaches ??= {}; // guard for any stale module instances
        if (!state.systemCaches[systemId]) {
            state.systemCaches[systemId] = new Map();
        }
        state.generatedBodies = state.systemCaches[systemId];

        state.bodyQueue       = [];
        _bgBodyId             = null;
        _systemSeed           = system.seed || Math.floor(Math.random() * 0xFFFFFF);
        resetClock();
        state.lastEconomyTickDays = getGameDays(); // prevent tick debt / freeze after clock reset

        // ── Persist to localStorage ───────────────────────────────────────────
        const existing = loadRegistry().systems.find(s => s.id === systemId);
        upsertSystem({
            id:               systemId,
            name:             system.name,
            type:             systemType,
            seed:             isSol ? null : (system.seed || null),
            savedAt:          Date.now(),
            // Preserve existing user data; don't overwrite on re-entry
            bodyOverrides:    existing?.bodyOverrides    ?? {},
            generatedBodyIds: existing?.generatedBodyIds ?? [],
        });
        setActiveSystemId(systemId);
        renderSavedSystemsList();

        // Show system panel in sidebar, hide the normal planet controls
        switchPanel('system');

        // Update system name
        if (systemNameEl) systemNameEl.textContent = system.name;

        // Switch scene
        if (state.planetMesh) state.planetMesh.visible = false;
        waterMesh.visible = false;
        atmosMesh.visible = false;
        starsMesh.visible = false;
        if (state.wireMesh) state.wireMesh.visible = false;
        updateHazeLayer(0, null);

        switchToOrrery();
        initOrrery(system);
        enterOrrery();

        backToSysEl?.classList.add('hidden');
        backToGlobeBtn?.classList.add('hidden');

        renderBodyList();
        updateSysBarPauseBtn();

        // Queue all generable bodies for background generation
        for (const body of system.bodies) {
            if (body.params && !body.parentId) {
                state.bodyQueue.push(body.id);
            }
        }
        advanceBodyQueue();
    }

    // ── Exit system mode entirely (return to standalone planet mode) ──────────
    function exitSystemMode() {
        state.solarSystemMode  = false;
        state.activeBodyId     = null;
        _bgBodyId              = null;
        state.isBgGenerating   = false;
        state.bodyQueue        = [];

        switchPanel('world');
        document.getElementById('bodyViewBanner')?.classList.add('hidden');
        document.querySelectorAll('.system-hidden')
            .forEach(el => el.classList.remove('system-hidden'));

        systemBarEl?.classList.add('hidden');
        backToSysEl?.classList.add('hidden');
        backToGlobeBtn?.classList.add('hidden');
        exitOrrery();
        switchToPlanetView();

        // Restore normal planet visuals
        if (state.planetMesh) state.planetMesh.visible = true;
        if (state.planetaryParams) {
            updateAtmosphereColor(state.planetaryParams.atmosphereRimColor);
            updateWaterColor(state.planetaryParams.surfaceFluidColor);
        }
        starsMesh.visible = true;
        if (state.wireMesh) state.wireMesh.visible = true;
    }

    // ── Background queue: generate bodies silently ────────────────────────────
    function advanceBodyQueue() {
        if (state.bodyQueue.length === 0 || _bgBodyId) return;
        // Don't background-generate while user is actively generating a planet
        const genBtnEl = document.getElementById('generate');
        if (genBtnEl?.classList.contains('generating')) return;

        const bodyId = state.bodyQueue.shift();
        if (state.generatedBodies.has(bodyId)) {
            advanceBodyQueue(); // already cached, skip
            return;
        }

        const sys  = state.currentSystem;
        const body = sys?.bodies.find(b => b.id === bodyId);
        if (!body?.params) { advanceBodyQueue(); return; }

        _bgBodyId = bodyId;
        state.isBgGenerating = true;
        applyBodyParams(body.params);
        const seed = _systemSeed ^ (bodyId.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0));
        // Suppress overlay for background generation
        generate(seed, [], () => {}, shouldSkipClimate());
    }

    // ── generate-done: handle system mode caching and queue advancement ───────
    document.getElementById('generate').addEventListener('generate-done', () => {
        if (!state.currentSystem) return;

        const isBackground = !!_bgBodyId && _bgBodyId !== _pendingBodyId;

        if (isBackground) {
            // Cache the raw generation data
            state.generatedBodies.set(_bgBodyId, { curData: state.curData });
            markBodyGenerated(state.currentSystemId, _bgBodyId);
            _bgBodyId = null;
            state.isBgGenerating = false;

            // buildMesh() was skipped (isBgGenerating flag), so no mesh suppression needed.
            renderBodyList();
            renderSavedSystemsList();
            // Keep background queue moving
            setTimeout(advanceBodyQueue, 200);
            return;
        }

        if (_pendingBodyId) {
            // User clicked into this body — cache it
            state.generatedBodies.set(_pendingBodyId, { curData: state.curData });

            // ── Persist any physics slider changes made before generation ──────
            const sys    = state.currentSystem;
            const bodyId = _pendingBodyId;
            const body   = sys?.bodies.find(b => b.id === bodyId);
            if (body?.params && state.currentSystemId) {
                const currentParams = {
                    gravity:     +(document.getElementById('sGravity')?.value  ?? body.params.gravity),
                    atmosphere:  +(document.getElementById('sAtm')?.value      ?? body.params.atmosphere),
                    hydrosphere: +(document.getElementById('sHydro')?.value    ?? body.params.hydrosphere),
                    baseTemp:    +(document.getElementById('sBaseTemp')?.value  ?? body.params.baseTemp),
                    axialTilt:   +(document.getElementById('sTilt')?.value      ?? body.params.axialTilt),
                };
                // Compare against base body params (post bodyParamsToSliderValues conversion)
                const sv = bodyParamsToSliderValues(body.params) ?? body.params;
                const changed = (
                    currentParams.gravity     !== +sv.gravity     ||
                    currentParams.atmosphere  !== +sv.atmosphere  ||
                    currentParams.hydrosphere !== +sv.hydrosphere ||
                    currentParams.baseTemp    !== +sv.baseTemp    ||
                    currentParams.axialTilt   !== +sv.axialTilt
                );
                if (changed) {
                    saveBodyOverride(state.currentSystemId, bodyId, currentParams);
                } else {
                    clearBodyOverride(state.currentSystemId, bodyId);
                }
                markBodyGenerated(state.currentSystemId, bodyId);
            }

            _pendingBodyId = null;
            // Update moon/parent-disc meshes for the newly-rendered body
            const justRendered = sys?.bodies.find(b => b.id === bodyId);
            if (justRendered) {
                updateMoonScene(justRendered, state.currentSystem.bodies);
                updateParentScene(justRendered, state.currentSystem.bodies);
            }
            renderBodyList();
            renderSavedSystemsList();
        }
    });

    // ── Clock bar UI ──────────────────────────────────────────────────────────
    function updateSysBarPauseBtn() {
        if (!pauseBtn) return;
        pauseBtn.classList.toggle('paused-state', isPaused());
    }

    function updateSpeedBtns() {
        const idx = getSpeedIndex();
        speedBtns.forEach(btn => {
            btn.classList.toggle('active', +btn.dataset.speed === idx);
        });
    }

    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            togglePause();
            updateSysBarPauseBtn();
        });
    }

    speedBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            setSpeedIndex(+btn.dataset.speed);
            if (isPaused()) {
                // Resume on speed click if paused
                togglePause();
                updateSysBarPauseBtn();
            }
            updateSpeedBtns();
        });
    });
    updateSpeedBtns();

    // ── Button wiring ─────────────────────────────────────────────────────────
    // ── Nav button wiring ─────────────────────────────────────────────────────
    const navBtnSystem = document.getElementById('navBtnSystem');
    const navBtnWorld  = document.getElementById('navBtnWorld');
    const navBtnVisual = document.getElementById('navBtnVisual');

    navBtnSystem?.addEventListener('click', () => {
        if (state.activeBodyId) {
            backToSystem(); // returns to orrery, calls switchPanel('system')
        } else if (!state.solarSystemMode) {
            enterSystemMode(state.currentSystem ?? OUR_SOLAR_SYSTEM); // calls switchPanel('system')
        } else {
            switchPanel('system'); // already in orrery, ensure correct panel
        }
    });
    navBtnWorld?.addEventListener('click', () => {
        if (state.solarSystemMode) {
            exitSystemMode(); // calls switchPanel('world')
        } else {
            switchPanel('world');
        }
    });
    navBtnVisual?.addEventListener('click', () => switchPanel('visual'));

    if (solarSysBtn) {
        solarSysBtn.addEventListener('click', () => {
            state.currentSystem = null;
            enterSystemMode(OUR_SOLAR_SYSTEM);
        });
    }

    if (genSysBtn) {
        genSysBtn.addEventListener('click', () => {
            const seed = Math.floor(Math.random() * 0xFFFFFF);
            state.currentSystem = generateSystem(seed);
            enterSystemMode(state.currentSystem);
        });
    }

    backToSysEl?.addEventListener('click', backToSystem);
    backToGlobeBtn?.addEventListener('click', backToSystem);
    document.getElementById('bodyBannerBackBtn')?.addEventListener('click', backToSystem);

    // ── Reset body physics to defaults ────────────────────────────────────────
    document.getElementById('bodyResetParamsBtn')?.addEventListener('click', () => {
        const bodyId = state.activeBodyId;
        if (!bodyId || !state.currentSystemId) return;
        const body = state.currentSystem?.bodies.find(b => b.id === bodyId);
        if (!body?.params) return;
        // Clear the stored override
        clearBodyOverride(state.currentSystemId, bodyId);
        // Remove from in-session cache so the next enterBody() regenerates cleanly
        state.generatedBodies.delete(bodyId);
        // Re-enter the body with fresh default params
        enterBody(bodyId);
        renderSavedSystemsList();
    });

    // ── Orrery hover info card ────────────────────────────────────────────────
    canvas.addEventListener('mousemove', (e) => {
        if (!state.solarSystemMode || state.activeBodyId) return;
        const bodyId = getBodyAtMouse(e);
        if (bodyId && state.currentSystem) {
            const body = state.currentSystem.bodies.find(b => b.id === bodyId);
            if (body) {
                bodyInfoCard?.classList.remove('hidden');
                if (bodyInfoName)   bodyInfoName.textContent  = body.name;
                if (bodyInfoType)   bodyInfoType.textContent  = TYPE_LABELS[body.type] ?? body.type;
                if (bodyInfoOrbit) {
                    bodyInfoOrbit.textContent = body.orbitRadiusAU > 0
                        ? `Orbit: ${body.orbitRadiusAU.toFixed(3)} AU · Period: ${body.orbitalPeriodDays.toFixed(1)} days`
                        : '';
                }
                if (bodyInfoStatus) {
                    if (!body.params) bodyInfoStatus.textContent = 'No globe available';
                    else if (state.generatedBodies.has(bodyId)) bodyInfoStatus.textContent = '✓ Generated · Click to explore';
                    else bodyInfoStatus.textContent = 'Click to generate & explore';
                }
            }
        } else {
            bodyInfoCard?.classList.add('hidden');
        }
    });

    canvas.addEventListener('mouseleave', () => bodyInfoCard?.classList.add('hidden'));

    // ── Orrery click → enter body ─────────────────────────────────────────────
    canvas.addEventListener('click', (e) => {
        if (!state.solarSystemMode) return;
        const bodyId = getBodyAtMouse(e);
        if (bodyId) {
            const body = state.currentSystem?.bodies.find(b => b.id === bodyId);
            if (body?.params) enterBody(bodyId);
        }
    });

    // Expose for use in animate()
    window._solarSystemTickFrame = function(realDtSec) {
        if (!state.solarSystemMode) return;
        const gameDt = tickClock(realDtSec);
        tickOrrery(gameDt);
        if (gameDateEl) gameDateEl.textContent = getGameDate();
    };
    // Expose enterSystemMode at module level for the page-load restore code
    window._enterSystemMode = enterSystemMode;
    // Expose enterBody so edit-mode.js can navigate to a moon or parent on click
    window._enterBodyFromClick = (bodyId) => enterBody(bodyId);
}
