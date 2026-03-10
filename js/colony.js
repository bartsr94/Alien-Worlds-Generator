/**
 * Colony data model.
 *
 * Defines tier thresholds, a colony factory, and per-colony production rates
 * that read from resource potential layers computed by resources-gen.js.
 */

export const COLONY_TIERS = [
    { name: 'outpost',    min: 1,      max: 99         },
    { name: 'settlement', min: 100,    max: 9_999      },
    { name: 'colony',     min: 10_000, max: 999_999    },
    { name: 'city',       min: 1_000_000, max: 99_999_999 },
    { name: 'megacity',   min: 1e8,    max: Infinity   },
];

/** Production multiplier per tier (scales base rate of 100 units/tick). */
export const TIER_MULTIPLIERS = {
    outpost:    1,
    settlement: 3,
    colony:     8,
    city:       20,
    megacity:   50,
};

/** Return the tier object whose population range contains `pop`. */
export function getTier(pop) {
    for (const tier of COLONY_TIERS) {
        if (pop <= tier.max) return tier;
    }
    return COLONY_TIERS[COLONY_TIERS.length - 1];
}

/**
 * Construct a new colony plain-object.
 * @param {{ bodyId, systemId, region, lat, lon, name, gameDays }} opts
 */
export function createColony({ bodyId, systemId, region, lat, lon, name, gameDays }) {
    return {
        id: crypto.randomUUID(),
        bodyId,
        systemId,
        region,
        lat,
        lon,
        name,
        population: 1,
        foundedDays: gameDays,
        stockpile: { food: 0, water: 0, metals: 0, fuel: 0 },
    };
}

/**
 * Compute per-tick resource production rates for a colony.
 *
 * Reads resource potential from `curData.debugLayers.resource*[colony.region]`
 * and scales by the colony's current tier multiplier × 100 base units/tick.
 * Returns zeros gracefully when resource layers are not yet available.
 *
 * @param {object} colony   Colony object created by createColony()
 * @param {object} curData  state.curData (or the body's cached data object)
 * @returns {{ food: number, water: number, metals: number, fuel: number }}
 */
export function colonyProductionRates(colony, curData) {
    const dl = curData?.debugLayers;
    if (!dl?.resourceFood) {
        return { food: 0, water: 0, metals: 0, fuel: 0 };
    }

    const r   = colony.region;
    const mul = TIER_MULTIPLIERS[getTier(colony.population).name] * 100;

    return {
        food:   Math.round((dl.resourceFood[r]   ?? 0) * mul),
        water:  Math.round((dl.resourceWater[r]  ?? 0) * mul),
        metals: Math.round((dl.resourceMetals[r] ?? 0) * mul),
        fuel:   Math.round((dl.resourceFuel[r]   ?? 0) * mul),
    };
}
