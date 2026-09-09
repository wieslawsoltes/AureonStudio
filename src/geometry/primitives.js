import { planarUV, sphericalUV } from './mesh.js';
const mesh = (p, f, smooth = true) => planarUV({ positions: p, faces: f, uvs: [], smooth });
export const DEFAULT_PARAMS = { box: { width: 2, height: 2, depth: 2 }, sphere: { radius: 1, segments: 32, rings: 20 }, cylinder: { radius: 1, height: 2, segments: 32, heightSegments: 1 }, torus: { radius: 1.3, tube: .35, segments: 48, sides: 16 }, cone: { radius: 1, height: 2, segments: 32, heightSegments: 1 }, plane: { width: 2, depth: 2, segments: 1 }, capsule: { radius: .6, height: 2.8, segments: 32, rings: 20 }, lathe: { profile: [[.4, -1], [.65, -.9], [.45, -.65], [.25, -.25], [.3, .25], [.65, .75], [.7, .95], [.5, 1]], segments: 40 } };
export const PRIMITIVES = ['box', 'sphere', 'cylinder', 'torus', 'cone', 'plane', 'capsule', 'lathe'];
export function box({ width = 2, height = 2, depth = 2 } = {}) {
    const x = width / 2, y = height / 2, z = depth / 2;
    return mesh([-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z], [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2]], false);
}
export function plane({ width = 2, depth = 2, segments = 1 } = {}) {
    const n = Math.max(1, Math.min(128, Math.round(segments))), p = [], f = [];
    for (let z = 0; z <= n; z++)
        for (let x = 0; x <= n; x++)
            p.push((x / n - .5) * width, 0, (z / n - .5) * depth);
    for (let z = 0; z < n; z++)
        for (let x = 0; x < n; x++) {
            const a = z * (n + 1) + x;
            f.push([a, a + n + 1, a + n + 2, a + 1]);
        }
    return mesh(p, f, false);
}
export function sphere({ radius = 1, segments = 32, rings = 20 } = {}) {
    const s = Math.max(3, Math.min(256, Math.round(segments))), r = Math.max(2, Math.min(128, Math.round(rings))), p = [0, radius, 0], f = [];
    for (let j = 1; j < r; j++) {
        const t = j / r * Math.PI;
        for (let i = 0; i < s; i++) {
            const a = i / s * Math.PI * 2;
            p.push(radius * Math.sin(t) * Math.cos(a), radius * Math.cos(t), radius * Math.sin(t) * Math.sin(a));
        }
    }
    const bottom = p.length / 3;
    p.push(0, -radius, 0);
    for (let i = 0; i < s; i++) {
        const n = (i + 1) % s;
        f.push([0, 1 + n, 1 + i]);
        for (let j = 0; j < r - 2; j++) {
            const a = 1 + j * s + i, b = 1 + j * s + n;
            f.push([a, b, b + s, a + s]);
        }
        f.push([bottom, 1 + (r - 2) * s + i, 1 + (r - 2) * s + n]);
    }
    return sphericalUV({ positions: p, faces: f, smooth: true, uvs: [] });
}
export function cylinder({ radius = 1, height = 2, segments = 32, topRadius = radius, heightSegments = 1 } = {}) {
    const s = Math.max(3, Math.min(256, Math.round(segments))), h = Math.max(1, Math.min(64, Math.round(heightSegments))), p = [], f = [];
    if (topRadius === 0)
        return cone({ radius, height, segments: s, heightSegments: h });
    for (let j = 0; j <= h; j++)
        for (let i = 0; i < s; i++) {
            const a = i / s * Math.PI * 2, r = radius + (topRadius - radius) * j / h;
            p.push(r * Math.cos(a), (j / h - .5) * height, r * Math.sin(a));
        }
    for (let j = 0; j < h; j++)
        for (let i = 0; i < s; i++) {
            const n = (i + 1) % s;
            f.push([j * s + i, (j + 1) * s + i, (j + 1) * s + n, j * s + n]);
        }
    f.push(Array.from({ length: s }, (_, i) => i));
    f.push(Array.from({ length: s }, (_, i) => h * s + s - 1 - i));
    return { ...mesh(p, f, true), flatFaces: [f.length - 2, f.length - 1] };
}
export function cone({ radius = 1, height = 2, segments = 32, heightSegments = 1 } = {}) {
    const s = Math.max(3, Math.min(256, Math.round(segments))), h = Math.max(1, Math.min(64, Math.round(heightSegments))), p = [], f = [];
    for (let j = 0; j < h; j++)
        for (let i = 0; i < s; i++) {
            const a = i / s * Math.PI * 2, r = radius * (1 - j / h);
            p.push(r * Math.cos(a), (j / h - .5) * height, r * Math.sin(a));
        }
    const tip = p.length / 3;
    p.push(0, height / 2, 0);
    for (let j = 0; j < h - 1; j++)
        for (let i = 0; i < s; i++) {
            const next = (i + 1) % s;
            f.push([j * s + i, (j + 1) * s + i, (j + 1) * s + next, j * s + next]);
        }
    for (let i = 0; i < s; i++)
        f.push([(h - 1) * s + i, tip, (h - 1) * s + (i + 1) % s]);
    f.push(Array.from({ length: s }, (_, i) => i));
    return { ...mesh(p, f, true), flatFaces: [f.length - 1] };
}
export function torus({ radius = 1.3, tube = .35, segments = 48, sides = 16 } = {}) {
    const s = Math.max(3, Math.min(256, Math.round(segments))), t = Math.max(3, Math.min(128, Math.round(sides))), p = [], f = [], uvs = [];
    for (let i = 0; i < s; i++)
        for (let j = 0; j < t; j++) {
            const a = i / s * Math.PI * 2, b = j / t * Math.PI * 2;
            p.push((radius + tube * Math.cos(b)) * Math.cos(a), tube * Math.sin(b), (radius + tube * Math.cos(b)) * Math.sin(a));
            uvs.push(i / s, j / t);
        }
    for (let i = 0; i < s; i++)
        for (let j = 0; j < t; j++)
            f.push([i * t + j, i * t + (j + 1) % t, ((i + 1) % s) * t + (j + 1) % t, ((i + 1) % s) * t + j]);
    return { positions: p, faces: f, uvs, smooth: true };
}
export function lathe({ profile = DEFAULT_PARAMS.lathe.profile, segments = 40 } = {}) {
    const s = Math.max(3, Math.min(256, Math.round(segments))), p = [], f = [], rings = [], flatFaces = [];
    if (profile.length < 2)
        throw Error('A lathe needs at least two profile points');
    for (const [radius, y] of profile) {
        if (radius < 0 || !Number.isFinite(radius) || !Number.isFinite(y))
            throw Error('Invalid lathe profile');
        const ring = [];
        if (radius === 0) {
            ring.push(p.length / 3);
            p.push(0, y, 0);
        }
        else
            for (let i = 0; i < s; i++) {
                const a = i / s * Math.PI * 2;
                ring.push(p.length / 3);
                p.push(radius * Math.cos(a), y, radius * Math.sin(a));
            }
        rings.push(ring);
    }
    for (let j = 0; j < rings.length - 1; j++) {
        const a = rings[j], b = rings[j + 1];
        if (a.length === 1 && b.length === 1)
            throw Error('Consecutive lathe profile points cannot both lie on the axis');
        for (let i = 0; i < s; i++) {
            const n = (i + 1) % s;
            if (a.length === 1)
                f.push([a[0], b[i], b[n]]);
            else if (b.length === 1)
                f.push([a[i], b[0], a[n]]);
            else
                f.push([a[i], b[i], b[n], a[n]]);
        }
    }
    if (rings[0].length > 1) {
        flatFaces.push(f.length);
        f.push([...rings[0]]);
    }
    if (rings.at(-1).length > 1) {
        flatFaces.push(f.length);
        f.push([...rings.at(-1)].reverse());
    }
    return { ...mesh(p, f, true), flatFaces };
}
export function capsule({ radius = .6, height = 2.8, segments = 32, rings = 20 } = {}) {
    const m = sphere({ radius, segments, rings }), shift = Math.max(0, height / 2 - radius);
    for (let i = 1; i < m.positions.length; i += 3)
        m.positions[i] += Math.sign(m.positions[i]) * shift;
    return m;
}
export function createPrimitive(type, params = {}) {
    const fn = { box, sphere, cylinder, torus, cone, plane, capsule, lathe }[type];
    if (!fn)
        throw Error(`Unknown primitive: ${type}`);
    for (const [k, v] of Object.entries(params))
        if (typeof v === 'number' && (!Number.isFinite(v) || (k === 'topRadius' ? v < 0 : v <= 0)))
            throw Error('Primitive dimensions must be positive and finite');
    if (type === 'lathe' && params.profile && (!Array.isArray(params.profile) || params.profile.length < 2 || params.profile.length > 1000 || params.profile.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || p[0] < 0)))
        throw Error('Lathe profile must contain finite nonnegative radius / height pairs');
    return fn(params);
}
