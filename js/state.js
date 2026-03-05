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
    isTouchDevice: ('ontouchstart' in window) || (navigator.maxTouchPoints > 0),
    editMode: false,
    oceanCurrentArrowGroup: null,
    climateComputed: false,
    // Planetary Physics — populated after each generation.
    planetaryParams: null,
    // Currently selected world preset name ('earth', 'mars', 'venus', … or 'custom').
    currentPreset: 'custom',

    // ── Solar System mode ────────────────────────────────────────────────────
    // true when the orrery view is active (planet globe is hidden)
    solarSystemMode: false,
    // The current system object { name, seed, bodies[] } — null when not in system mode
    currentSystem: null,
    // ID of the body currently displayed as a globe (null = no body active)
    activeBodyId: null,
    // Map of bodyId → generation result (state.curData equivalent) — cached per body
    generatedBodies: new Map(),
    // Queue of body IDs waiting for background generation
    bodyQueue: [],
    // true while a body is being silently background-generated (suppresses buildMesh)
    isBgGenerating: false,
};
