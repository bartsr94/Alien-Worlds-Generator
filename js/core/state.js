// Shared mutable application state.
// All modules import this same object, so mutations are visible everywhere.
export const state = {
    planetMesh: null,
    wireMesh: null,
    arrowGroup: null,
    windArrowGroup: null,
    curData: null,
    plateColors: {},
    _hoverBackup: null,
    hoveredPlate: -1,
    hoveredRegion: -1,
    hoveredKoppen: -1,
    _koppenHoverBackup: null,
    _mapKoppenHoverBackup: null,
    selectedRegion: null,
    _selectionBackup: null,
    mapMesh: null,
    mapFaceToSide: null,
    _mapHoverBackup: null,
    mapGridMesh: null,
    globeGridMesh: null,
    gridEnabled: true,
    gridSpacing: 15,
    mapMode: false,
    mapCenterLon: 0,
    dragStart: null,
    debugLayer: '',
    isTouchDevice: false,  // set by main.js at startup
    editMode: false,
    oceanCurrentArrowGroup: null,
    climateComputed: false,
    // Planetary Physics — populated after each generation.
    planetaryParams: null,
    // Currently selected world preset name ('earth', 'mars', 'venus', … or 'custom').
    currentPreset: 'custom',

    // ── Colony system ────────────────────────────────────────────────────────
    // Flat array of colony objects created by createColony() in js/colony.js.
    // In-session only (cleared on page reload alongside terrain data).
    colonies: [],
    // Region index of the colony currently displayed in the dedicated colony view panel.
    // null means the colony view is closed (tile panel or nothing is shown instead).
    colonyViewRegion: null,
    // Game-clock day count at the last economy tick (used to throttle 30-day cycles).
    lastEconomyTickDays: 0,
    // Per-body resource pools — keyed by bodyId ('standalone', 'earth', 'mars', …).
    // Initialized lazily in wireColonyHandlers on first founding action per body.
    // Cleared for a body on rebuild (same path as state.colonies cleanup).
    bodyPools: {},

    // ── Solar System mode ────────────────────────────────────────────────────
    // true when the orrery view is active (planet globe is hidden)
    solarSystemMode: false,
    // The current system object { name, seed, bodies[] } — null when not in system mode
    currentSystem: null,
    // Stable string ID for the active system: "sol" or "random-{seed}"
    currentSystemId: null,
    // ID of the body currently displayed as a globe (null = no body active)
    activeBodyId: null,
    // Map of bodyId → generation result (state.curData equivalent) — cached per body
    // Points into systemCaches[currentSystemId] so it survives system-switching
    generatedBodies: new Map(),
    // Per-system caches: { [systemId]: Map<bodyId, {curData}> }
    // Keyed by systemId so switching back to a visited system never loses its cache
    systemCaches: {},
    // Queue of body IDs waiting for background generation
    bodyQueue: [],
    // true while a body is being silently background-generated (suppresses buildMesh)
    isBgGenerating: false,
};
