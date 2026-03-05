/**
 * game-clock.js — Compressed game-time clock for the solar system mode.
 *
 * The clock tracks a `gameDays` counter that advances at a configurable
 * speed independent of the real render frame rate.
 *
 * Speed levels (gameDays per real second):
 *   0  →  paused
 *   1  →  1 day / s
 *   10 →  10 days / s  (~1 month in 3 s)
 *   100 → 100 days / s (~1 year in 3.65 s)
 *   1000 → 1000 days / s (~1 year in 0.365 s)
 */

// Epoch: start at year 2200-01-01 arbitrarily, expressed as days since J2000.
// J2000 epoch is 2000-01-01T12:00:00 TT.
// 2200-01-01 ≈ J2000 + 72961 days
const EPOCH_OFFSET = 72961;

let _gameDays   = EPOCH_OFFSET;   // current game time in days since J2000
let _speed      = 0;              // game-days per real second (0 = paused)
let _paused     = true;

/** Speed multipliers available, in days per real second. */
export const SPEED_LEVELS = [1, 10, 100, 1000];

/** Current speed multiplier index into SPEED_LEVELS (-1 when paused). */
let _speedIndex = 1; // default: 10 days/s

/** Set the speed. Pass -1 to pause without changing _speedIndex. */
export function setClockSpeed(daysPerSecond) {
    _speed  = daysPerSecond;
    _paused = (daysPerSecond === 0);
}

export function pauseClock()  { _paused = true;  _speed = 0; }
export function resumeClock() { _paused = false; _speed = SPEED_LEVELS[_speedIndex]; }
export function togglePause() { if (_paused) resumeClock(); else pauseClock(); }

export function setSpeedIndex(idx) {
    _speedIndex = Math.max(0, Math.min(idx, SPEED_LEVELS.length - 1));
    if (!_paused) _speed = SPEED_LEVELS[_speedIndex];
}

export function getSpeedIndex() { return _speedIndex; }
export function isPaused()      { return _paused; }
export function getGameDays()   { return _gameDays; }

/**
 * Advance the clock by `realDeltaSeconds` of real time.
 * Call this every frame from the animation loop (only when in system mode).
 * @returns {number} how many game days elapsed this tick
 */
export function tickClock(realDeltaSeconds) {
    if (_paused || _speed === 0) return 0;
    const dt = _speed * realDeltaSeconds;
    _gameDays += dt;
    return dt;
}

/**
 * Returns the current game date as a human-readable string.
 * Derived from days since J2000 (2000-01-01).
 */
export function getGameDate() {
    // J2000.0 = 2000 Jan 1.5 TT → treat as 2000-01-01 for display
    const days   = Math.floor(_gameDays - EPOCH_OFFSET + EPOCH_OFFSET); // = _gameDays
    // Simple Julian Day → calendar conversion (Gregorian proleptic)
    const jd     = days + 2451545; // JD of J2000.0 is 2451545.0
    const l      = jd + 68569;
    const n      = Math.floor(4 * l / 146097);
    const l2     = l - Math.floor((146097 * n + 3) / 4);
    const i      = Math.floor(4000 * (l2 + 1) / 1461001);
    const l3     = l2 - Math.floor(1461 * i / 4) + 31;
    const j      = Math.floor(80 * l3 / 2447);
    const day    = l3 - Math.floor(2447 * j / 80);
    const l4     = Math.floor(j / 11);
    const month  = j + 2 - 12 * l4;
    const year   = 100 * (n - 49) + i + l4;
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/**
 * Reset the clock to the epoch (useful when starting a new session).
 */
export function resetClock() {
    _gameDays   = EPOCH_OFFSET;
    _paused     = true;
    _speed      = 0;
    _speedIndex = 1;
}
