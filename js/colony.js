/**
 * Colony data model.
 *
 * Defines tier thresholds, a colony factory, and per-colony production rates
 * that read from resource potential layers computed by resources-gen.js.
 */

/** Starting resource pool issued per body on first founding action. */
export const STARTING_POOL = { food: 500, water: 500, metals: 600, fuel: 200 };

export const COLONY_TIERS = [
    { name: 'outpost',    min: 1,      max: 99         },
    { name: 'settlement', min: 100,    max: 9_999      },
    { name: 'colony',     min: 10_000, max: 999_999    },
    { name: 'city',       min: 1_000_000, max: 99_999_999 },
    { name: 'megacity',   min: 1e8,    max: Infinity   },
];

/** Return the tier object for a colony (reads colony.tier string directly). */
export function getTier(colony) {
    const name = (colony && typeof colony === 'object') ? (colony.tier ?? 'outpost') : 'outpost';
    return COLONY_TIERS.find(t => t.name === name) ?? COLONY_TIERS[0];
}

/** Return the tier object whose population range contains `pop` (for UI previews). */
export function getTierFromPop(pop) {
    for (const tier of COLONY_TIERS) {
        if (pop <= tier.max) return tier;
    }
    return COLONY_TIERS[COLONY_TIERS.length - 1];
}

// ── Building system ──────────────────────────────────────────────────────────

/** Ordered list of tier names from weakest to strongest. */
export const COLONY_TIER_ORDER = ['outpost', 'settlement', 'colony', 'city', 'megacity'];

/** Population cap conferred by each Habitation building level (index = level). */
export const HOUSING_CAPS   = [0, 250, 5_000, 100_000, 2_000_000];

/** Food production multiplier per Farm building level. */
export const FARM_MULTS     = [0, 3, 10, 30];

/** Water production multiplier per Water Extraction building level. */
export const WATER_MULTS    = [0, 3, 10, 30];

/** Metals production multiplier per Mine building level. */
export const MINE_MULTS     = [0, 3, 10, 30];

/** Fuel production multiplier per Fuel Extraction building level. */
export const FUEL_MULTS     = [0, 3, 10, 30];

/** Per-colony pool cap contribution per Storage building level. */
export const STORAGE_CAPS   = [0, 2_000, 8_000, 30_000];

/**
 * Metal cost to upgrade each building category TO a given level.
 * Index = target level (index 0 unused — cost to be at level 0 = 0).
 */
export const BUILDING_COSTS = {
    habitation: [0,  50, 200,  800],
    farm:       [0,  75, 300, 1200],
    water:      [0,  75, 300, 1200],
    mine:       [0, 100, 400, 1500],
    fuel:       [0, 100, 400, 1500],
    storage:    [0,  50, 200,  800],
};

/** Minimum colony tier required to unlock each building level. */
export const BUILDING_TIER_UNLOCK = { 1: 'outpost', 2: 'settlement', 3: 'colony' };

/** Display names for each building category at each level. */
export const BUILDING_NAMES = {
    habitation: ['—', 'Hab Pod',         'Habitat Module',       'Arcology'         ],
    farm:       ['—', 'Greenhouse',       'Hydroponic Farm',      'Biosphere'        ],
    water:      ['—', 'Water Collector',  'Purification Plant',   'Deep Aquifer'     ],
    mine:       ['—', 'Mining Rig',       'Extraction Plant',     'Deep Core'        ],
    fuel:       ['—', 'Fuel Tap',         'Refinery',             'Geothermal Plant' ],
    storage:    ['—', 'Storage Unit',     'Depot',                'Warehouse'        ],
};

/** Metal cost to advance to the next colony tier. */
export const TIER_ADVANCE_COSTS = {
    outpost:    100,
    settlement: 500,
    colony:     2_000,
    city:       8_000,
    megacity:   null,
};

/**
 * Which body-pool resource each building category consumes as maintenance.
 * These create intentional interdependencies between building types:
 *   farm → needs water (irrigation)
 *   water → needs fuel (pumps)
 *   mine  → needs fuel (machinery)
 *   fuel  → needs metals (equipment wear)
 *   habitation/storage → need fuel (power)
 */
export const BUILDING_MAINTENANCE_RESOURCE = {
    habitation: 'fuel',
    farm:       'water',
    water:      'fuel',
    mine:       'fuel',
    fuel:       'metals',
    storage:    'fuel',
};

/**
 * Per-tick maintenance cost for each building category at each level (index = level).
 * Paid in the resource defined by BUILDING_MAINTENANCE_RESOURCE.
 */
export const BUILDING_MAINTENANCE = {
    habitation: [0,  1,  4, 12],
    farm:       [0,  3, 10, 30],
    water:      [0,  2,  8, 20],
    mine:       [0,  3, 12, 35],
    fuel:       [0,  2,  8, 25],
    storage:    [0,  1,  4, 12],
};

/** Return the population cap for this colony's Habitation building level. */
export function getHousingCap(buildings) {
    return HOUSING_CAPS[buildings?.habitation ?? 0] ?? 0;
}

/** Return how much this colony's Storage building contributes to the body pool cap. */
export function getStorageContribution(buildings) {
    return STORAGE_CAPS[buildings?.storage ?? 0] ?? 0;
}

/**
 * Return the total per-tick resource drain from all built buildings.
 * Returned as { food, water, metals, fuel } — summed across all categories.
 */
export function buildingMaintenanceCost(buildings) {
    const result = { food: 0, water: 0, metals: 0, fuel: 0 };
    for (const cat of Object.keys(BUILDING_MAINTENANCE)) {
        const level = buildings?.[cat] ?? 0;
        if (level <= 0) continue;
        const cost = BUILDING_MAINTENANCE[cat][level] ?? 0;
        const res  = BUILDING_MAINTENANCE_RESOURCE[cat];
        result[res] += cost;
    }
    return result;
}

/** True when the colony population meets the threshold to advance to the next tier. */
export function canAdvanceTier(colony) {
    const idx = COLONY_TIER_ORDER.indexOf(colony.tier ?? 'outpost');
    if (idx < 0 || idx >= COLONY_TIER_ORDER.length - 1) return false;
    const nextTier = COLONY_TIERS[idx + 1];
    return nextTier ? colony.population >= nextTier.min : false;
}

/**
 * Founding cost scaled by habitability (0–1).
 * Requires climate to be computed (habitability array must be valid before calling).
 * @param {number} habitability  0 = bare rock, 1 = ideal tile
 * @returns {{ food, water, metals, fuel }}
 */
export function foundingCost(habitability) {
    const m = 1 + (1 - Math.max(0, Math.min(1, habitability)));
    return {
        food:   Math.round(50  * m),
        water:  Math.round(50  * m),
        metals: Math.round(100 * m),
        fuel:   Math.round(50  * m),
    };
}

/**
 * Per-tick maintenance drawn from the body pool.
 * Combines population-based costs (food, water, fuel) with per-building costs.
 * @param {object} colony  Colony object from createColony()
 * @returns {{ food, water, fuel, metals }}
 */
export function maintenanceCost(colony) {
    const m = 1 + (1 - Math.max(0, Math.min(1, colony.habitability ?? 0.5)));
    const p = colony.population ?? 1;
    const bld = buildingMaintenanceCost(colony.buildings ?? {});
    return {
        food:   Math.round((2 + p * 0.002) * m) + bld.food,
        water:  Math.round((1 + p * 0.001) * m) + bld.water,
        fuel:   Math.round(1 * m)               + bld.fuel,
        metals: bld.metals,
    };
}

/**
 * Construct a new colony plain-object.
 * @param {{ bodyId, systemId, region, lat, lon, name, gameDays, habitability }} opts
 */
export function createColony({ bodyId, systemId, region, lat, lon, name, gameDays, habitability }) {
    const hab = Math.max(0, Math.min(1, habitability ?? 0.5));
    const bootstrapDuration = Math.round(90 + 90 * (1 - hab));
    return {
        id: crypto.randomUUID(),
        bodyId,
        systemId,
        region,
        lat,
        lon,
        name,
        population: 1,
        foundedDays: gameDays ?? 0,
        foundedAtDay: gameDays ?? 0,
        bootstrapEndDay: (gameDays ?? 0) + bootstrapDuration,
        starvationTicks: 0,
        habitability: hab,
        tier: 'outpost',
        buildings: { habitation: 1, farm: 0, water: 0, mine: 0, fuel: 0, storage: 0 },
    };
}

/**
 * Compute per-tick resource production rates for a colony.
 *
 * Production is zero unless the corresponding building is constructed.
 * Output scales with tile resource potential × building multiplier × worker fraction
 * (workerFraction = population / housingCap, so filling housing increases output).
 *
 * @param {object} colony   Colony object created by createColony()
 * @param {object} curData  state.curData (or the body's cached data object)
 * @returns {{ food: number, water: number, metals: number, fuel: number }}
 */
export function colonyProductionRates(colony, curData) {
    const dl = curData?.debugLayers;
    if (!dl?.resourceFood) return { food: 0, water: 0, metals: 0, fuel: 0 };
    const r  = colony.region;
    const hc = getHousingCap(colony.buildings);
    const wf = hc > 0 ? Math.min(colony.population, hc) / hc : 0;
    const b  = colony.buildings ?? {};
    return {
        food:   Math.floor((dl.resourceFood[r]   ?? 0) * 100 * (FARM_MULTS[b.farm     ?? 0] ?? 0) * wf),
        water:  Math.floor((dl.resourceWater[r]  ?? 0) * 100 * (WATER_MULTS[b.water   ?? 0] ?? 0) * wf),
        metals: Math.floor((dl.resourceMetals[r] ?? 0) * 100 * (MINE_MULTS[b.mine     ?? 0] ?? 0) * wf),
        fuel:   Math.floor((dl.resourceFuel[r]   ?? 0) * 100 * (FUEL_MULTS[b.fuel     ?? 0] ?? 0) * wf),
    };
}
