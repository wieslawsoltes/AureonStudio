import {bevelMesh} from './bevel.js';
import { cloneMesh, bounds, catmullClark, subdivide, normals, planarUV } from './mesh.js';
import { rad } from '../core/math.js';
export const MODIFIERS = {
    bevel: {label:'Bevel · segmented',value:.05,min:.001,max:1,step:.01},
    subdivide: { label: 'Subdivide', value: 1, min: 1, max: 3, step: 1 },
    smooth: { label: 'Catmull–Clark', value: 1, min: 1, max: 3, step: 1 },
    twist: { label: 'Twist', value: 45, min: -360, max: 360, step: 1 },
    bend: { label: 'Bend', value: 35, min: -180, max: 180, step: 1 },
    taper: { label: 'Taper', value: .35, min: -.95, max: 2, step: .01 },
    noise: { label: 'Displace noise', value: .12, min: 0, max: 1, step: .01 },
    mirror: { label: 'Mirror X', value: 0, min: -3, max: 3, step: .05 },
    shell: { label: 'Shell', value: .08, min: .001, max: 1, step: .01 }
};
export function applyModifier(input, mod) {
    if (mod.enabled === false)
        return cloneMesh(input);
    let m = cloneMesh(input);
    delete m.vertexNormals;
    const v = Number(mod.value), b = bounds(m), height = Math.max(1e-6, b.max[1] - b.min[1]), center = (b.max[1] + b.min[1]) / 2;
    if (!Number.isFinite(v))
        throw Error('Invalid modifier value');
    switch (mod.type) {
        case 'bevel': return bevelMesh(input,v,mod);
        case 'subdivide':
        case 'smooth':
            for (let i = 0; i < Math.min(3, Math.max(1, Math.round(v))); i++)
                m = mod.type === 'smooth' ? catmullClark(m) : subdivide(m);
            return m;
        case 'twist':
            for (let i = 0; i < m.positions.length; i += 3) {
                const a = rad(v) * (m.positions[i + 1] - center) / height, x = m.positions[i], z = m.positions[i + 2];
                m.positions[i] = x * Math.cos(a) - z * Math.sin(a);
                m.positions[i + 2] = x * Math.sin(a) + z * Math.cos(a);
            }
            break;
        case 'bend':
            if (Math.abs(v) > 1e-6) {
                const k = rad(v) / height;
                for (let i = 0; i < m.positions.length; i += 3) {
                    const y = m.positions[i + 1] - center, a = y * k, r = 1 / k - m.positions[i];
                    m.positions[i] = 1 / k - r * Math.cos(a);
                    m.positions[i + 1] = center + r * Math.sin(a);
                }
            }
            break;
        case 'taper':
            for (let i = 0; i < m.positions.length; i += 3) {
                const s = 1 + v * (m.positions[i + 1] - b.min[1]) / height;
                m.positions[i] *= s;
                m.positions[i + 2] *= s;
            }
            break;
        case 'noise':
            {
                const ns = normals(m);
                for (let i = 0; i < m.positions.length; i += 3) {
                    const [x, y, z] = m.positions.slice(i, i + 3), n = Math.sin(x * 3.7 + y * .8) * Math.cos(z * 4.1 - x * .2) * Math.sin(y * 4.3 + z);
                    for (let k = 0; k < 3; k++)
                        m.positions[i + k] += ns[i + k] * n * v;
                }
            }
            break;
        case 'mirror':
            {
                const n = m.positions.length / 3;
                for (let i = 0; i < n; i++) {
                    m.positions.push(2 * v - m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
                    if (m.uvs.length)
                        m.uvs.push(m.uvs[i * 2], m.uvs[i * 2 + 1]);
                }
                if (m.flatFaces)
                    m.flatFaces.push(...m.flatFaces.map(i => i + m.faces.length));
                m.faces.push(...m.faces.map(f => f.map(i => i + n).reverse()));
            }
            break;
        case 'shell':
            {
                const n = m.positions.length / 3, ns = normals(m), edges = new Map();
                for (let i = 0; i < n; i++)
                    m.positions.push(m.positions[i * 3] - ns[i * 3] * v, m.positions[i * 3 + 1] - ns[i * 3 + 1] * v, m.positions[i * 3 + 2] - ns[i * 3 + 2] * v);
                for (const f of m.faces)
                    for (let i = 0; i < f.length; i++) {
                        const a = f[i], c = f[(i + 1) % f.length], k = a < c ? `${a}:${c}` : `${c}:${a}`;
                        if (edges.has(k))
                            edges.delete(k);
                        else
                            edges.set(k, [a, c]);
                    }
                if (m.flatFaces)
                    m.flatFaces.push(...m.flatFaces.map(i => i + m.faces.length));
                m.faces.push(...m.faces.map(f => f.map(i => i + n).reverse()));
                for (const [a, c] of edges.values())
                    m.faces.push([c, a, a + n, c + n]);
                planarUV(m);
            }
            break;
        default: throw Error(`Unsupported modifier ${mod.type}`);
    }
    return m;
}
export function evaluateModifiers(mesh, modifiers = []) {
    return modifiers.reduce((m, mod) => applyModifier(m, mod), mesh);
}
