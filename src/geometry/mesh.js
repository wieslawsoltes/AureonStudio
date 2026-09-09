import { sub, cross, normalize, dot, add, mul } from '../core/math.js';
export const cloneMesh = m => ({...structuredClone(m), positions:[...m.positions],faces:m.faces.map(f=>[...f]),uvs:m.uvs?[...m.uvs]:[],smooth:m.smooth!==false});
export const vertex = (m, i) => m.positions.slice(i * 3, i * 3 + 3);
export function bounds(m) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i++) {
        const k = i % 3;
        min[k] = Math.min(min[k], m.positions[i]);
        max[k] = Math.max(max[k], m.positions[i]);
    }
    return { min, max };
}
export function faceNormal(m, f) {
    let n = [0, 0, 0];
    for (let i = 0; i < f.length; i++) {
        const a = vertex(m, f[i]), b = vertex(m, f[(i + 1) % f.length]);
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return normalize(n);
}
/** Ear clipping in the dominant plane supports simple planar concave polygons. */
export function triangulateFace(m, face) {
    if (face.length === 3)
        return [[...face]];
    const n = faceNormal(m, face), drop = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))), axes = [0, 1, 2].filter(x => x !== drop), pts = face.map(i => axes.map(k => m.positions[i * 3 + k]));
    const area = pts.reduce((s, p, i) => {
        const q = pts[(i + 1) % pts.length];
        return s + p[0] * q[1] - q[0] * p[1];
    }, 0);
    const sign = Math.sign(area) || 1;
    const cp = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const rest = face.map((_, i) => i), out = [];
    let guard = 0;
    while (rest.length > 3 && guard++ < face.length * face.length) {
        let found = false;
        for (let i = 0; i < rest.length; i++) {
            const ai = rest[(i + rest.length - 1) % rest.length], bi = rest[i], ci = rest[(i + 1) % rest.length], a = pts[ai], b = pts[bi], c = pts[ci];
            if (cp(a, b, c) * sign <= 1e-10)
                continue;
            if (rest.some(j => j !== ai && j !== bi && j !== ci && cp(a, b, pts[j]) * sign >= -1e-10 && cp(b, c, pts[j]) * sign >= -1e-10 && cp(c, a, pts[j]) * sign >= -1e-10))
                continue;
            out.push([face[ai], face[bi], face[ci]]);
            rest.splice(i, 1);
            found = true;
            break;
        }
        if (!found)
            throw Error('Cannot triangulate degenerate or self-intersecting polygon');
    }
    if (rest.length === 3)
        out.push(rest.map(i => face[i]));
    return out;
}
export function triangulate(m) {
    const out = [];
    m.faces.forEach((f, face) => triangulateFace(m, f).forEach(ids => out.push({ ids, face })));
    return out;
}
export function normals(m, excludeFlatFaces = false) {
    const out = new Float32Array(m.positions.length);
    const flat = new Set(excludeFlatFaces ? m.flatFaces : []);
    for (const { ids, face } of triangulate(m)) {
        if (flat.has(face))
            continue;
        const n = cross(sub(vertex(m, ids[1]), vertex(m, ids[0])), sub(vertex(m, ids[2]), vertex(m, ids[0])));
        for (const id of ids)
            for (let k = 0; k < 3; k++)
                out[id * 3 + k] += n[k];
    }
    for (let i = 0; i < out.length; i += 3)
        out.set(normalize([...out.slice(i, i + 3)]), i);
    return out;
}
export function validateMesh(m) {
    if (!m || !Array.isArray(m.positions) || m.positions.length % 3 || !m.positions.every(Number.isFinite) || !Array.isArray(m.faces))
        throw Error('Invalid mesh positions/faces');
    if (m.positions.length > 3000000)
        throw Error('Mesh exceeds the 1,000,000 vertex import limit');
    for (const f of m.faces)
        if (!Array.isArray(f) || f.length < 3 || f.some(i => !Number.isInteger(i) || i < 0 || i >= m.positions.length / 3))
            throw Error('Invalid face index');
    if (m.flatFaces && (!Array.isArray(m.flatFaces) || m.flatFaces.some(i => !Number.isInteger(i) || i < 0 || i >= m.faces.length)))
        throw Error('Invalid flat-face indices');
    if(m.vertexNormals && (m.vertexNormals.length!==m.positions.length||!Array.from(m.vertexNormals).every(Number.isFinite)))throw Error('Invalid vertex normals');
    if(m.faceMaterials && (m.faceMaterials.length!==m.faces.length||m.faceMaterials.some(i=>!Number.isInteger(i)||i<0)))throw Error('Invalid face material slots');
    if (m.uvs?.length && (m.uvs.length !== m.positions.length / 3 * 2 || !m.uvs.every(Number.isFinite)))
        throw Error('Invalid UV coordinates');
    return m;
}
export function planarUV(m, axes = [0, 2]) {
    const b = bounds(m);
    m.uvs = [];
    for (let i = 0; i < m.positions.length; i += 3)
        for (const a of axes)
            m.uvs.push((m.positions[i + a] - b.min[a]) / Math.max(1e-6, b.max[a] - b.min[a]));
    return m;
}
export function sphericalUV(m) {
    m.uvs = [];
    for (let i = 0; i < m.positions.length; i += 3) {
        const p = normalize(m.positions.slice(i, i + 3));
        m.uvs.push(.5 + Math.atan2(p[2], p[0]) / (Math.PI * 2), .5 - Math.asin(p[1]) / Math.PI);
    }
    return m;
}
export function extrudeFace(input, faceIndex, distance = .3, inset = 0) {
    const m = cloneMesh(input), f = m.faces[faceIndex];
    if (!f)
        throw Error('Select a polygon first');
    const n = faceNormal(m, f), center = mul(f.reduce((a, i) => add(a, vertex(m, i)), [0, 0, 0]), 1 / f.length), newFace = f.map(i => {
        const p = add(add(vertex(m, i), mul(sub(center, vertex(m, i)), inset)), mul(n, distance)), id = m.positions.length / 3;
        m.positions.push(...p);
        if (m.uvs.length)
            m.uvs.push(...m.uvs.slice(i * 2, i * 2 + 2));
        return id;
    });
    m.faces[faceIndex] = newFace;
    for (let i = 0; i < f.length; i++) {
        const j = (i + 1) % f.length;
        m.faces.push([f[i], f[j], newFace[j], newFace[i]]);
    }
    return m;
}
export function deleteFace(input, index) {
    const m = cloneMesh(input);
    m.faces.splice(index, 1);
    if (m.flatFaces)
        m.flatFaces = m.flatFaces.filter(i => i !== index).map(i => i > index ? i - 1 : i);
    return m;
}
export function weld(input, tolerance = 1e-5) {
    const m = { positions: [], faces: [], uvs: [], smooth: input.smooth }, map = new Map(), ids = [];
    for (let i = 0; i < input.positions.length; i += 3) {
        const p = input.positions.slice(i, i + 3), k = p.map(x => Math.round(x / tolerance)).join(',');
        if (!map.has(k)) {
            map.set(k, m.positions.length / 3);
            m.positions.push(...p);
        }
        ids.push(map.get(k));
    }
    m.faces = input.faces.map(f => [...new Set(f.map(i => ids[i]))]).filter(f => f.length >= 3);
    return planarUV(m);
}
export function subdivide(input) {
    if (input.faces.length > 100000)
        throw Error('Subdivision would exceed the interactive mesh budget');
    const m = cloneMesh(input), out = { positions: [...m.positions], faces: [], uvs: [], smooth: m.smooth }, edges = new Map();
    const midpoint = (a, b) => {
        const k = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (!edges.has(k)) {
            edges.set(k, out.positions.length / 3);
            out.positions.push(...mul(add(vertex(m, a), vertex(m, b)), .5));
        }
        return edges.get(k);
    };
    for (const f of m.faces) {
        const c = out.positions.length / 3;
        out.positions.push(...mul(f.reduce((s, i) => add(s, vertex(m, i)), [0, 0, 0]), 1 / f.length));
        f.forEach((v, i) => out.faces.push([v, midpoint(v, f[(i + 1) % f.length]), c, midpoint(f[(i + f.length - 1) % f.length], v)]));
    }
    return planarUV(out);
}
/** Catmull-Clark with explicit boundary edge rules. */
export function catmullClark(m) {
    if (m.faces.length > 100000)
        throw Error('Subdivision exceeds budget');
    const fp = m.faces.map(f => mul(f.reduce((s, i) => add(s, vertex(m, i)), [0, 0, 0]), 1 / f.length)), edges = new Map(), vf = Array.from({ length: m.positions.length / 3 }, () => []), ve = Array.from({ length: m.positions.length / 3 }, () => []);
    m.faces.forEach((f, fi) => f.forEach((a, i) => {
        vf[a].push(fi);
        const b = f[(i + 1) % f.length], key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (!edges.has(key)) {
            const e = { a, b, faces: [], index: 0 };
            edges.set(key, e);
            ve[a].push(e);
            ve[b].push(e);
        }
        edges.get(key).faces.push(fi);
    }));
    const out = { positions: [], faces: [], uvs: [], smooth: true };
    for (let i = 0; i < vf.length; i++) {
        const p = vertex(m, i), boundary = ve[i].filter(e => e.faces.length === 1);
        let q = p;
        if (boundary.length === 2) {
            const ns = boundary.map(e => vertex(m, e.a === i ? e.b : e.a));
            q = add(mul(p, .75), mul(add(...ns), .125));
        }
        else if (vf[i].length) {
            const n = vf[i].length, F = mul(vf[i].reduce((s, fi) => add(s, fp[fi]), [0, 0, 0]), 1 / n), R = mul(ve[i].reduce((s, e) => add(s, mul(add(vertex(m, e.a), vertex(m, e.b)), .5)), [0, 0, 0]), 1 / ve[i].length);
            q = mul(add(add(F, mul(R, 2)), mul(p, n - 3)), 1 / n);
        }
        out.positions.push(...q);
    }
    for (const e of edges.values()) {
        e.index = out.positions.length / 3;
        let p = add(vertex(m, e.a), vertex(m, e.b));
        p = e.faces.length === 2 ? mul(add(add(p, fp[e.faces[0]]), fp[e.faces[1]]), .25) : mul(p, .5);
        out.positions.push(...p);
    }
    const offset = out.positions.length / 3;
    for (const p of fp)
        out.positions.push(...p);
    const ei = (a, b) => edges.get(a < b ? `${a}:${b}` : `${b}:${a}`).index;
    m.faces.forEach((f, fi) => f.forEach((v, i) => out.faces.push([v, ei(v, f[(i + 1) % f.length]), offset + fi, ei(f[(i + f.length - 1) % f.length], v)])));
    return planarUV(out);
}
