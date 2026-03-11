/**
 * Human-readable number formatting utilities.
 * Centralised here so callers don't each re-implement the same ternary chain.
 */

/**
 * Format a number as "1.2M", "34.5K", or "789".
 * Uses one decimal place for both M and K suffixes.
 * Suitable for resource amounts, item counts, etc.
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return Math.round(n).toLocaleString();
}

/**
 * Format a population count as "1.2M", "34K", or "789".
 * Uses no decimal for K (e.g., "34K" not "34.0K").
 * Suitable for population and other whole-number quantities.
 * @param {number} n
 * @returns {string}
 */
export function formatPop(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return n.toLocaleString();
}
