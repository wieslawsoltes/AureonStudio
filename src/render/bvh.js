import { rayBox, rayTriangle } from '../core/math.js';
const STRIDE = 32;
const area = (min, max) => {
    const d = max.map((x, i) => Math.max(0, x - min[i]));
    return 2 * (d[0] * d[1] + d[1] * d[2] + d[2] * d[0]);
};
/** Binned surface-area heuristic BVH. Sibling nodes are always contiguous. */
export function buildBVH(input, materialData) {
    const start = performance.now(), n = input.length / STRIDE, ids = Array.from({ length: n }, (_, i) => i), mins = [], maxs = [], centers = [];
    for (let i = 0; i < n; i++) {
        const off = i * STRIDE, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let v = 0; v < 3; v++)
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], input[off + v * 4 + k]);
                max[k] = Math.max(max[k], input[off + v * 4 + k]);
            }
        mins.push(min);
        maxs.push(max);
        centers.push(min.map((x, k) => (x + max[k]) * .5));
    }
    const nodes = [{}];
    let maxDepth = 0;
    function build(index, lo, hi, depth) {
        maxDepth = Math.max(maxDepth, depth);
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], cmin = [Infinity, Infinity, Infinity], cmax = [-Infinity, -Infinity, -Infinity];
        for (let i = lo; i < hi; i++) {
            const id = ids[i];
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], mins[id][k]);
                max[k] = Math.max(max[k], maxs[id][k]);
                cmin[k] = Math.min(cmin[k], centers[id][k]);
                cmax[k] = Math.max(cmax[k], centers[id][k]);
            }
        }
        const node = { min, max, left: lo, count: hi - lo };
        nodes[index] = node;
        if (hi - lo <= 4 || depth >= 48)
            return;
        let best = Infinity, baxis = -1, split = 0;
        const B = 12;
        for (let k = 0; k < 3; k++) {
            if (cmax[k] - cmin[k] < 1e-9)
                continue;
            const bins = Array.from({ length: B }, () => ({ n: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
            for (let i = lo; i < hi; i++) {
                const id = ids[i], bi = Math.min(B - 1, Math.floor((centers[id][k] - cmin[k]) / (cmax[k] - cmin[k]) * B)), b = bins[bi];
                b.n++;
                for (let a = 0; a < 3; a++) {
                    b.min[a] = Math.min(b.min[a], mins[id][a]);
                    b.max[a] = Math.max(b.max[a], maxs[id][a]);
                }
            }
            for (let s = 1; s < B; s++) {
                let nl = 0, nr = 0;
                const lmin = [Infinity, Infinity, Infinity], lmax = [-Infinity, -Infinity, -Infinity], rmin = [Infinity, Infinity, Infinity], rmax = [-Infinity, -Infinity, -Infinity];
                for (let j = 0; j < B; j++) {
                    const b = bins[j];
                    if (!b.n)
                        continue;
                    const mi = j < s ? lmin : rmin, ma = j < s ? lmax : rmax;
                    if (j < s)
                        nl += b.n;
                    else
                        nr += b.n;
                    for (let a = 0; a < 3; a++) {
                        mi[a] = Math.min(mi[a], b.min[a]);
                        ma[a] = Math.max(ma[a], b.max[a]);
                    }
                }
                if (!nl || !nr)
                    continue;
                const cost = area(lmin, lmax) * nl + area(rmin, rmax) * nr;
                if (cost < best) {
                    best = cost;
                    baxis = k;
                    split = cmin[k] + (cmax[k] - cmin[k]) * s / B;
                }
            }
        }
        if (baxis < 0 || (best >= area(min, max) * (hi - lo) && hi - lo <= 16))
            return;
        let mid = lo;
        for (let i = lo; i < hi; i++)
            if (centers[ids[i]][baxis] < split) {
                [ids[i], ids[mid]] = [ids[mid], ids[i]];
                mid++;
            }
        if (mid === lo || mid === hi)
            return;
        const left = nodes.length;
        nodes.push({}, {});
        node.left = left;
        node.count = 0;
        build(left, lo, mid, depth + 1);
        build(left + 1, mid, hi, depth + 1);
    }
    if (n)
        build(0, 0, n, 0);
    else
        nodes[0] = { min: [0, 0, 0], max: [0, 0, 0], left: 0, count: 0 };
    const triangles = new Float32Array(input.length);
    ids.forEach((id, i) => triangles.set(input.subarray(id * STRIDE, (id + 1) * STRIDE), i * STRIDE));
    const buffer = new ArrayBuffer(nodes.length * 32), f = new Float32Array(buffer), u = new Uint32Array(buffer);
    nodes.forEach((nd, i) => {
        f.set(nd.min, i * 8);
        f.set(nd.max, i * 8 + 4);
        u[i * 8 + 3] = nd.left;
        u[i * 8 + 7] = nd.count;
    });
    const lightData = buildLightDistribution(triangles, materialData);
    return { triangles, nodes: buffer, ...lightData, order: Uint32Array.from(ids), nodeCount: nodes.length, maxDepth, quality: bvhQuality(buffer), updateKind: 'build', buildMs: performance.now() - start };
}
/** CDF over emitted power. Per-triangle area PDFs are shared by both MIS paths. */
function buildLightDistribution(triangles, materialData) {
    const n = triangles.length / STRIDE, lights = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
        const o = i * 32;
        triangles[o + 31] = 0;
        const mat = triangles[o + 3] * 16, em = materialData[mat + 7];
        if (em <= 0)
            continue;
        const a = [0, 1, 2].map(k => triangles[o + 4 + k] - triangles[o + k]), b = [0, 1, 2].map(k => triangles[o + 8 + k] - triangles[o + k]);
        const ar = .5 * Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
        const lum = .2126 * materialData[mat] + .7152 * materialData[mat + 1] + .0722 * materialData[mat + 2], weight = ar * em * lum;
        if (weight > 0) {
            total += weight;
            lights.push({ id: i, weight, area: ar });
        }
    }
    const lightBuffer = new ArrayBuffer(Math.max(1, lights.length) * 16), lf = new Float32Array(lightBuffer), lu = new Uint32Array(lightBuffer);
    let cdf = 0;
    lights.forEach((l, i) => {
        const pmf = l.weight / total;
        cdf += pmf;
        lu[i * 4] = l.id;
        lf.set([i === lights.length - 1 ? 1 : cdf, pmf, l.area], i * 4 + 1);
        triangles[l.id * 32 + 31] = pmf / l.area;
    });
    return { lights: lightBuffer, lightCount: lights.length };
}
/** Normalized surface-area cost used to trigger a fresh SAH build after motion. */
export function bvhQuality(nodes) {
    const f = new Float32Array(nodes), u = new Uint32Array(nodes);
    const root = area([...f.slice(0, 3)], [...f.slice(4, 7)]);
    if (root <= 1e-20)
        return 0;
    let cost = 0;
    for (let i = 0; i < f.length; i += 8)
        cost += area([...f.slice(i, i + 3)], [...f.slice(i + 4, i + 7)]) * Math.max(1, u[i + 7]);
    return cost / root;
}
/** Refit an existing leaf partition in linear time. Triangle count must match.
 * Leaves recompute exact bounds; internal nodes reduce child bounds bottom-up.
 * Topology-preserving motion is the fast path; the worker rebuilds when the
 * surface-area cost worsens materially or the refit generation limit is reached.
 */
export function refitBVH(previous, input, materials) {
    const start = performance.now(), n = input.length / STRIDE;
    if (!previous.order || previous.order.length !== n || !n)
        throw Error('Refit requires a matching nonempty triangle count');
    const triangles = new Float32Array(input.length);
    previous.order.forEach((id, i) => triangles.set(input.subarray(id * STRIDE, (id + 1) * STRIDE), i * STRIDE));
    const nodes = previous.nodes.slice(0), f = new Float32Array(nodes), u = new Uint32Array(nodes);
    for (let node = f.length / 8 - 1; node >= 0; node--) {
        const off = node * 8, left = u[off + 3], count = u[off + 7];
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        if (count)
            for (let i = left; i < left + count; i++)
                for (let v = 0; v < 3; v++)
                    for (let k = 0; k < 3; k++) {
                        const value = triangles[i * STRIDE + v * 4 + k];
                        min[k] = Math.min(min[k], value);
                        max[k] = Math.max(max[k], value);
                    }
        else
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(f[left * 8 + k], f[(left + 1) * 8 + k]);
                max[k] = Math.max(f[left * 8 + 4 + k], f[(left + 1) * 8 + 4 + k]);
            }
        f.set(min, off);
        f.set(max, off + 4);
    }
    return { triangles, nodes, ...buildLightDistribution(triangles, materials), order: previous.order, nodeCount: nodes.byteLength / 32, maxDepth: previous.maxDepth, quality: bvhQuality(nodes), updateKind: 'refit', buildMs: performance.now() - start };
}
export function intersectBVH(data, origin, direction, { ignoreHidden = true } = {}) {
    if (!data?.triangles.length)
        return null;
    const f = new Float32Array(data.nodes), u = new Uint32Array(data.nodes), t = data.triangles, stack = [0];
    let best = null, limit = Infinity;
    while (stack.length) {
        const i = stack.pop(), o = i * 8;
        if (!rayBox(origin, direction, [...f.slice(o, o + 3)], [...f.slice(o + 4, o + 7)], limit))
            continue;
        const left = u[o + 3], count = u[o + 7];
        if (!count) {
            stack.push(left + 1, left);
            continue;
        }
        for (let j = left; j < left + count; j++) {
            const off = j * 32;
            if (ignoreHidden && (t[off + 30] & 1))
                continue;
            const hit = rayTriangle(origin, direction, [...t.slice(off, off + 3)], [...t.slice(off + 4, off + 7)], [...t.slice(off + 8, off + 11)], limit);
            if (hit) {
                limit = hit.t;
                best = { ...hit, triangle: j, objectIndex: t[off + 7], face: t[off + 11], material: t[off + 3] };
            }
        }
    }
    return best;
}
