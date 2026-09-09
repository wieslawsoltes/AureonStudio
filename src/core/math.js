/** Column-major matrices; right-handed world, +Y up; WebGPU depth range [0,1]. */
export const EPS = 1e-8;
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const mul = (a, s) => a.map(v => v * s);
export const dot = (a, b) => a.reduce((v, x, i) => v + x * b[i], 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(...a);
export const normalize = a => mul(a, 1 / (length(a) || 1));
export const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const rad = x => x * Math.PI / 180;
export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function matMul(a, b) {
    const r = new Array(16).fill(0);
    for (let c = 0; c < 4; c++)
        for (let row = 0; row < 4; row++)
            for (let k = 0; k < 4; k++)
                r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
    return r;
}
export function transformPoint(m, p) {
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return [0, 1, 2].map(i => (m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]) / (w || 1));
}
export const transformVector = (m, p) => [0, 1, 2].map(i => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2]);
export function inverse(m) {
    const a = Array.from({ length: 4 }, (_, r) => [...Array.from({ length: 4 }, (_, c) => m[c * 4 + r]), ...Array.from({ length: 4 }, (_, c) => +(r === c))]);
    for (let c = 0; c < 4; c++) {
        let r = c;
        for (let j = c + 1; j < 4; j++)
            if (Math.abs(a[j][c]) > Math.abs(a[r][c]))
                r = j;
        if (Math.abs(a[r][c]) < EPS)
            throw Error('Singular transformation');
        [a[c], a[r]] = [a[r], a[c]];
        const s = a[c][c];
        a[c] = a[c].map(x => x / s);
        for (let j = 0; j < 4; j++)
            if (j !== c) {
                const k = a[j][c];
                a[j] = a[j].map((x, i) => x - k * a[c][i]);
            }
    }
    return Array.from({ length: 16 }, (_, i) => a[i % 4][4 + Math.floor(i / 4)]);
}
export const transpose = m => Array.from({ length: 16 }, (_, i) => m[(i % 4) * 4 + Math.floor(i / 4)]);
export function compose({ position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] }) {
    const [x, y, z] = rotation.map(rad), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    const rx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1], ry = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1], rz = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const m = matMul(rz, matMul(ry, rx));
    for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
            m[i * 4 + j] *= scale[i];
    m[12] = position[0];
    m[13] = position[1];
    m[14] = position[2];
    return m;
}
export function lookAt(eye, target, up = [0, 1, 0]) {
    const z = normalize(sub(eye, target)), x = normalize(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
export function perspective(fov, aspect, near = .02, far = 1000) {
    const f = 1 / Math.tan(rad(fov) / 2);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, near * far / (near - far), 0];
}
export function orthographic(size, aspect, near = .02, far = 1000) {
    return [1 / (size * aspect), 0, 0, 0, 0, 1 / size, 0, 0, 0, 0, 1 / (near - far), 0, 0, 0, near / (near - far), 1];
}
export function rayTriangle(o, d, a, b, c, max = Infinity) {
    const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-9)
        return null;
    const inv = 1 / det, tv = sub(o, a), u = dot(tv, p) * inv;
    if (u < 0 || u > 1)
        return null;
    const q = cross(tv, e1), v = dot(d, q) * inv;
    if (v < 0 || u + v > 1)
        return null;
    const t = dot(e2, q) * inv;
    return t > 1e-5 && t < max ? { t, u, v } : null;
}
export function rayBox(o, d, min, max, limit = Infinity) {
    let near = 0, far = limit;
    for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-12) {
            if (o[i] < min[i] || o[i] > max[i])
                return false;
            continue;
        }
        let a = (min[i] - o[i]) / d[i], b = (max[i] - o[i]) / d[i];
        if (a > b)
            [a, b] = [b, a];
        near = Math.max(near, a);
        far = Math.min(far, b);
        if (near > far)
            return false;
    }
    return true;
}
export const hexToRGB = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
export const rgbToHex = rgb => '#' + rgb.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
export const srgbToLinear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
