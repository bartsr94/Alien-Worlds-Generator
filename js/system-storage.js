/**
 * system-storage.js
 *
 * Persistence layer for solar system state.
 * Wraps localStorage under the key "wo-systems-v1".
 *
 * Schema:
 * {
 *   activeSystemId: string | null,
 *   systems: Array<{
 *     id:               string,          // "sol" | "random-{seed}"
 *     name:             string,
 *     type:             "sol" | "random",
 *     seed:             number | null,
 *     savedAt:          number,          // Date.now()
 *     bodyOverrides:    { [bodyId]: { gravity, atmosphere, hydrosphere, baseTemp, axialTilt } },
 *     generatedBodyIds: string[],        // bodyIds that have been generated at least once
 *   }>
 * }
 *
 * NOTE: curData (the large terrain buffers) is NOT persisted — it is only kept
 * in the in-session state.systemCaches Map. On page reload bodies will re-generate
 * but their physics overrides and ✓ badges are restored from storage.
 */

const STORAGE_KEY = 'wo-systems-v1';

// ── Low-level read / write ────────────────────────────────────────────────────

export function loadRegistry() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return _emptyRegistry();
        const parsed = JSON.parse(raw);
        // Basic schema guard
        if (!parsed || !Array.isArray(parsed.systems)) return _emptyRegistry();
        return parsed;
    } catch {
        return _emptyRegistry();
    }
}

function _emptyRegistry() {
    return { activeSystemId: null, systems: [] };
}

export function saveRegistry(registry) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
    } catch {
        // Private browsing / quota exceeded — silently ignore
    }
}

// ── System CRUD ───────────────────────────────────────────────────────────────

/**
 * Add or update a system record in the registry.
 * Preserves existing bodyOverrides and generatedBodyIds if not supplied.
 */
export function upsertSystem(record) {
    const registry = loadRegistry();
    const idx = registry.systems.findIndex(s => s.id === record.id);
    if (idx >= 0) {
        // Merge: preserve user data if not being overwritten
        const existing = registry.systems[idx];
        registry.systems[idx] = {
            ...existing,
            ...record,
            bodyOverrides:    record.bodyOverrides    ?? existing.bodyOverrides    ?? {},
            generatedBodyIds: record.generatedBodyIds ?? existing.generatedBodyIds ?? [],
        };
    } else {
        registry.systems.push({
            bodyOverrides:    {},
            generatedBodyIds: [],
            ...record,
        });
    }
    saveRegistry(registry);
}

export function deleteSystem(systemId) {
    const registry = loadRegistry();
    registry.systems = registry.systems.filter(s => s.id !== systemId);
    if (registry.activeSystemId === systemId) registry.activeSystemId = null;
    saveRegistry(registry);
}

// ── Active system ─────────────────────────────────────────────────────────────

export function setActiveSystemId(id) {
    const registry = loadRegistry();
    registry.activeSystemId = id;
    saveRegistry(registry);
}

// ── Body override helpers ─────────────────────────────────────────────────────

export function getBodyOverride(systemId, bodyId) {
    const registry = loadRegistry();
    const sys = registry.systems.find(s => s.id === systemId);
    return sys?.bodyOverrides?.[bodyId] ?? null;
}

export function saveBodyOverride(systemId, bodyId, params) {
    const registry = loadRegistry();
    const sys = registry.systems.find(s => s.id === systemId);
    if (!sys) return;
    sys.bodyOverrides = sys.bodyOverrides ?? {};
    sys.bodyOverrides[bodyId] = {
        gravity:     params.gravity,
        atmosphere:  params.atmosphere,
        hydrosphere: params.hydrosphere,
        baseTemp:    params.baseTemp,
        axialTilt:   params.axialTilt,
    };
    sys.savedAt = Date.now();
    saveRegistry(registry);
}

export function clearBodyOverride(systemId, bodyId) {
    const registry = loadRegistry();
    const sys = registry.systems.find(s => s.id === systemId);
    if (!sys?.bodyOverrides) return;
    delete sys.bodyOverrides[bodyId];
    saveRegistry(registry);
}

// ── Generated body tracking ───────────────────────────────────────────────────

export function markBodyGenerated(systemId, bodyId) {
    const registry = loadRegistry();
    const sys = registry.systems.find(s => s.id === systemId);
    if (!sys) return;
    sys.generatedBodyIds = sys.generatedBodyIds ?? [];
    if (!sys.generatedBodyIds.includes(bodyId)) {
        sys.generatedBodyIds.push(bodyId);
    }
    saveRegistry(registry);
}

export function isBodyGenerated(systemId, bodyId) {
    const registry = loadRegistry();
    const sys = registry.systems.find(s => s.id === systemId);
    return sys?.generatedBodyIds?.includes(bodyId) ?? false;
}

/**
 * Rename a saved system. No-op if systemId not found.
 */
export function renameSystem(systemId, newName) {
    const registry = loadRegistry();
    const sys = registry.systems.find(s => s.id === systemId);
    if (!sys) return;
    sys.name    = newName;
    sys.savedAt = Date.now();
    saveRegistry(registry);
}
