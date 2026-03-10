/**
 * system-planet-params.js — Adapter from solar-system body descriptors to
 * the slider-value objects that generate.js / buildPlanetaryParams() consumes.
 *
 * The existing generate() function accepts an optional `overrideParams` object
 * that is merged on top of the slider-derived params.  This module produces
 * exactly that object from a body's `params` field.
 */

/**
 * Build a slider-equivalent params object from a solar-system body descriptor's
 * `params` field.  The return value is safe to pass directly into generate() as
 * the `overrideParams` argument (see generate.js).
 *
 * @param  {object} bodyParams  The `params` field from a solar-system body —
 *                              { gravity, atmosphere, hydrosphere, baseTemp, axialTilt }
 * @returns {object}  { gravity, atmosphere, hydrosphere, baseTemp, axialTilt }
 *                    Values are already in the same units as the UI sliders.
 */
export function bodyParamsToSliderValues(bodyParams) {
    if (!bodyParams) return null;
    return {
        gravity:     clamp(bodyParams.gravity,     0.1, 3.0),
        worldSize:   clamp(bodyParams.worldSize ?? 1.0, 0.1, 3.0),
        atmosphere:  clamp(Math.round(bodyParams.atmosphere),  0, 5),
        hydrosphere: clamp(Math.round(bodyParams.hydrosphere), 0, 5),
        baseTemp:    clamp(Math.round(bodyParams.baseTemp / 5) * 5, -150, 500),
        axialTilt:   clamp(Math.round(bodyParams.axialTilt),   0, 90),
    };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
