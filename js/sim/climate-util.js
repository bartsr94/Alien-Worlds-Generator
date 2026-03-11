// Shared climate utilities: smoothstep, smoothing, ITCZ lookup, and percentile selection.
// ── Physical constants ────────────────────────────────────────────────────────

/** Mean radius of Earth in km. Used throughout sim as the reference scale. */
export const EARTH_RADIUS_KM = 6371;
// ── Smoothstep utility ───────────────────────────────────────────────────────

export function smoothstep(edge0, edge1, x) {
    if (edge0 === edge1) return x >= edge1 ? 1 : 0;
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

// ── Laplacian smoothing ──────────────────────────────────────────────────────

export function smoothField(mesh, field, passes) {
    const { adjOffset, adjList, numRegions } = mesh;
    const tmp = new Float32Array(numRegions);
    let src = field, dst = tmp;

    for (let pass = 0; pass < passes; pass++) {
        for (let r = 0; r < numRegions; r++) {
            let sum = src[r];
            let count = 1;
            const end = adjOffset[r + 1];
            for (let ni = adjOffset[r]; ni < end; ni++) {
                sum += src[adjList[ni]];
                count++;
            }
            dst[r] = sum / count;
        }
        const swap = src; src = dst; dst = swap;
    }
    // If result ended up in tmp, copy back to field
    if (src !== field) field.set(src);
}

// ── ITCZ latitude lookup (linear interpolation with wrapping) ────────────────

export function makeItczLookup(itczLons, itczLats) {
    const n = itczLons.length;
    const step = (2 * Math.PI) / n;
    const lonStart = -Math.PI + step * 0.5;

    return function (lon) {
        let fi = (lon - lonStart) / step;
        fi = ((fi % n) + n) % n;
        const i0 = Math.floor(fi);
        const i1 = (i0 + 1) % n;
        const frac = fi - i0;
        return itczLats[i0] * (1 - frac) + itczLats[i1] * frac;
    };
}

// ── Floyd-Rivest selection (O(N) expected percentile) ────────────────────────

function floydRivest(arr, left, right, k) {
    while (right > left) {
        if (right - left > 600) {
            const n = right - left + 1;
            const i = k - left + 1;
            const z = Math.log(n);
            const s = 0.5 * Math.exp(2 * z / 3);
            const sd = 0.5 * Math.sqrt(z * s * (n - s) / n) * (i - n / 2 < 0 ? -1 : 1);
            const newLeft = Math.max(left, Math.floor(k - i * s / n + sd));
            const newRight = Math.min(right, Math.floor(k + (n - i) * s / n + sd));
            floydRivest(arr, newLeft, newRight, k);
        }

        const t = arr[k];
        if (t !== t) return; // NaN pivot — cannot partition, bail out
        let i = left;
        let j = right;

        arr[k] = arr[left];
        arr[left] = t;

        if (arr[right] > t) {
            arr[left] = arr[right];
            arr[right] = t;
        }

        while (i < j) {
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
            i++;
            j--;
            while (arr[i] < t) i++;
            while (arr[j] > t) j--;
        }

        if (arr[left] === t) {
            const tmp = arr[left];
            arr[left] = arr[j];
            arr[j] = tmp;
        } else {
            j++;
            const tmp = arr[j];
            arr[j] = arr[right];
            arr[right] = tmp;
        }

        if (j <= k) left = j + 1;
        if (k <= j) right = j - 1;
    }
}

/**
 * Compute the p-th percentile of a numeric array in O(N) expected time.
 * Returns the value at index floor(n * p) of the sorted order.
 * Makes a copy so the input is not mutated. Returns 1 if the result is 0.
 */
export function percentile(arr, p) {
    const n = arr.length;
    if (n === 0) return 1;
    const work = new Float32Array(arr);
    const k = Math.floor(n * p);
    floydRivest(work, 0, n - 1, k);
    const val = work[k];
    return val !== 0 ? val : 1;
}

// ── BFS distance field ───────────────────────────────────────────────────────

/**
 * Multi-source BFS distance field. Returns a Float32Array where seeds=0 and
 * each other cell = hop distance from nearest seed, or Infinity if unreachable.
 *
 * @param {number}   numRegions
 * @param {Int32Array} adjOffset
 * @param {Int32Array} adjList
 * @param {number}   maxDist    - stop expanding beyond this many hops
 * @param {function} seedTest   - seedTest(r) → true if r is a seed
 * @param {function} passFilter - passFilter(r, nr) → true if the edge r→nr is traversable
 */
export function bfsDistField(numRegions, adjOffset, adjList, maxDist, seedTest, passFilter) {
    const dist = new Float32Array(numRegions).fill(Infinity);
    const queue = [];
    for (let r = 0; r < numRegions; r++) {
        if (seedTest(r)) { dist[r] = 0; queue.push(r); }
    }
    let qi = 0;
    while (qi < queue.length) {
        const r = queue[qi++];
        const nd = dist[r] + 1;
        if (nd > maxDist) continue;
        for (let ni = adjOffset[r], niEnd = adjOffset[r + 1]; ni < niEnd; ni++) {
            const nr = adjList[ni];
            if (nd < dist[nr] && passFilter(r, nr)) { dist[nr] = nd; queue.push(nr); }
        }
    }
    return dist;
}
