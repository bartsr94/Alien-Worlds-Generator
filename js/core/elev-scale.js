// Shared elevation-to-height scale — used by both simulation and rendering.
// Lives in core/ so simulation modules can import it without depending on render/.

let _upliftMult = 1;

/**
 * Update the uplift multiplier for the current planet (default 1.0 = Earth, 6 km cap).
 * Call after each generation with params.upliftMultiplier.
 */
export function setUpliftMult(m) { _upliftMult = m > 0 ? m : 1; }

/**
 * Convert raw mesh elevation (non-linear, ~0–1 for land at 1g) to physical height
 * in kilometres.  Smooth power curve: ramps slowly through lowlands, accelerates
 * into highlands.  Scales with gravity — max is 6×upliftMult km.
 * Ocean (elev < 0) is mapped with a linear scale (~5 km at –0.5).
 */
export function elevToHeightKm(elev) {
    if (elev <= 0) return elev * 10;  // ocean: -0.5 → -5 km
    // Normalize by upliftMult so a 0.3g planet's peaks (~elev 3.3) map to ~20 km,
    // not the 6 km cap that applies at Earth (1g, upliftMult=1).
    const t = Math.min(elev / _upliftMult, 1);
    return 6 * _upliftMult * t * t;
}
