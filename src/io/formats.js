import { reversesWinding } from '../render/compile.js';
import { validateMesh, triangulate, vertex, faceNormal, weld } from '../geometry/mesh.js';
import { worldMatrix } from '../scene/document.js';
import { transformPoint, transformVector, transpose, inverse, normalize, hexToRGB, srgbToLinear } from '../core/math.js';
export function parseOBJ(text) {
    const positions = [], uvs = [], faces = [], source = [], sourceUV = [], map = new Map();
    if (text.length > 100000000)
        throw Error('OBJ exceeds the 100 MB import limit');
    const resolve = (value, count) => {
        const i = Number(value);
        if (!Number.isInteger(i) || i === 0)
            throw Error('Invalid OBJ index');
        const id = i < 0 ? count + i : i - 1;
        if (id < 0 || id >= count)
            throw Error('OBJ index out of range');
        return id;
    };
    for (const line of text.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/), tag = parts.shift();
        if (tag === 'v') {
            const p = parts.slice(0, 3).map(Number);
            if (p.length !== 3 || !p.every(Number.isFinite))
                throw Error('Invalid OBJ vertex');
            source.push(p);
        }
        else if (tag === 'vt')
            sourceUV.push(parts.slice(0, 2).map(Number));
        else if (tag === 'f') {
            const face = parts.map(token => {
                const [v, vt] = token.split('/'), vi = resolve(v, source.length), ti = vt ? resolve(vt, sourceUV.length) : -1, key = `${vi}/${ti}`;
                if (map.has(key))
                    return map.get(key);
                const p = source[vi], uv = ti >= 0 ? sourceUV[ti] : [0, 0];
                const i = positions.length / 3;
                positions.push(...p);
                uvs.push(...uv);
                map.set(key, i);
                return i;
            });
            faces.push(face);
        }
    }
    if (!faces.length)
        throw Error('OBJ contains no polygon faces');
    return validateMesh({ positions, faces, uvs, smooth: true });
}
export function exportOBJ(doc, geometry, selection = null) {
    let out = '# Aureon Studio · evaluated world-space mesh\n', vo = 1;
    const objs = doc.objects.filter(o => selection ? selection.has(o.id) : o.visible !== false);
    for (const o of objs) {
        const m = geometry.get(o), matrix = worldMatrix(doc, o);
        out += `o ${o.name.replace(/[^\w.-]+/g, '_')}\n`;
        for (let i = 0; i < m.positions.length / 3; i++)
            out += `v ${transformPoint(matrix, vertex(m, i)).join(' ')}\n`;
        for (const face of m.faces) {
            const f = reversesWinding(matrix) ? [...face].reverse() : face;
            out += `f ${f.map(i => i + vo).join(' ')}\n`;
        }
        vo += m.positions.length / 3;
    }
    return out;
}
export function parseSTL(buffer) {
    const view = new DataView(buffer), positions = [], faces = [];
    if (buffer.byteLength >= 84 && 84 + view.getUint32(80, true) * 50 === buffer.byteLength) {
        const n = view.getUint32(80, true);
        if (n > 1000000)
            throw Error('STL exceeds triangle budget');
        for (let i = 0; i < n; i++) {
            const f = [];
            for (let j = 0; j < 3; j++) {
                const off = 84 + i * 50 + 12 + j * 12;
                f.push(positions.length / 3);
                positions.push(view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true));
            }
            faces.push(f);
        }
    }
    else {
        const text = new TextDecoder().decode(buffer), re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
        let m;
        while ((m = re.exec(text))) {
            positions.push(...m.slice(1).map(Number));
            if (positions.length % 9 === 0) {
                const end = positions.length / 3;
                faces.push([end - 3, end - 2, end - 1]);
            }
        }
        if (!faces.length || positions.length % 9)
            throw Error('Malformed or empty STL');
    }
    return weld(validateMesh({ positions, faces, uvs: [], smooth: false }));
}
export function exportSTL(doc, geometry, selection = null) {
    const tris = [];
    for (const o of doc.objects.filter(o => selection ? selection.has(o.id) : o.visible !== false)) {
        const m = geometry.get(o), matrix = worldMatrix(doc, o);
        for (const { ids } of triangulate(m))
            tris.push((reversesWinding(matrix) ? [...ids].reverse() : ids).map(i => transformPoint(matrix, vertex(m, i))));
    }
    const buffer = new ArrayBuffer(84 + tris.length * 50), view = new DataView(buffer);
    new Uint8Array(buffer).set(new TextEncoder().encode('Aureon Studio binary STL'));
    view.setUint32(80, tris.length, true);
    tris.forEach((t, i) => {
        const m = { positions: t.flat() }, n = faceNormal(m, [0, 1, 2]), o = 84 + i * 50;
        [...n, ...t.flat()].forEach((v, k) => view.setFloat32(o + k * 4, v, true));
    });
    return buffer;
}
/** Portable embedded glTF 2.0 static snapshot; geometry is evaluated and world-baked. */
export function exportGLTF(doc, geometry) {
    const gltf = { asset: { version: '2.0', generator: 'Aureon Studio' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: doc.materials.map(m => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [...hexToRGB(m.color).map(srgbToLinear), 1], metallicFactor: m.metallic, roughnessFactor: m.roughness }, emissiveFactor: hexToRGB(m.color).map(srgbToLinear).map(v => Math.min(1, v * m.emission)), doubleSided: true })), buffers: [], bufferViews: [], accessors: [] }, chunks = [];
    let byteOffset = 0;
    const accessor = (values, type, componentType = 5126) => {
        const bytes = componentType === 5125 ? new Uint32Array(values) : new Float32Array(values), components = { VEC3: 3, VEC2: 2, SCALAR: 1 }[type], bv = gltf.bufferViews.length;
        gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength });
        chunks.push(new Uint8Array(bytes.buffer));
        byteOffset += bytes.byteLength;
        const a = { bufferView: bv, componentType, count: values.length / components, type };
        if (type === 'VEC3') {
            a.min = [Infinity, Infinity, Infinity];
            a.max = [-Infinity, -Infinity, -Infinity];
            values.forEach((v, i) => {
                a.min[i % 3] = Math.min(a.min[i % 3], v);
                a.max[i % 3] = Math.max(a.max[i % 3], v);
            });
        }
        const idx = gltf.accessors.length;
        gltf.accessors.push(a);
        return idx;
    };
    for (const obj of doc.objects.filter(o => o.visible !== false)) {
        const m = geometry.get(obj), matrix = worldMatrix(doc, obj), ps = [], indices = triangulate(m).flatMap(t => reversesWinding(matrix) ? [...t.ids].reverse() : t.ids);
        for (let i = 0; i < m.positions.length / 3; i++)
            ps.push(...transformPoint(matrix, vertex(m, i)));
        if (!indices.length)
            continue;
        const attributes = { POSITION: accessor(ps, 'VEC3') };
        if (m.uvs?.length)
            attributes.TEXCOORD_0 = accessor(m.uvs, 'VEC2');
        const mesh = gltf.meshes.length;
        gltf.meshes.push({ name: obj.name, primitives: [{ attributes, indices: accessor(indices, 'SCALAR', 5125), material: obj.material }] });
        gltf.scenes[0].nodes.push(gltf.nodes.length);
        gltf.nodes.push({ name: obj.name, mesh });
    }
    const data = new Uint8Array(byteOffset);
    let at = 0;
    for (const c of chunks) {
        data.set(c, at);
        at += c.length;
    }
    let binary = '';
    for (let i = 0; i < data.length; i += 8192)
        binary += String.fromCharCode(...data.subarray(i, i + 8192));
    gltf.buffers.push({ byteLength: byteOffset, uri: 'data:application/octet-stream;base64,' + btoa(binary) });
    return gltf;
}
export function encodePFM({ data, width, height }) {
    const header = new TextEncoder().encode(`PF\n${width} ${height}\n-1.0\n`), buffer = new ArrayBuffer(header.length + width * height * 12), bytes = new Uint8Array(buffer), view = new DataView(buffer);
    bytes.set(header);
    let out = header.length;
    for (let y = height - 1; y >= 0; y--)
        for (let x = 0; x < width; x++)
            for (let k = 0; k < 3; k++) {
                view.setFloat32(out, data[(y * width + x) * 4 + k], true);
                out += 4;
            }
    return buffer;
}
export function download(data, name, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
