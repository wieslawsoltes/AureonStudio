import { compileGraphs, evaluateGraph } from '../materials/graph.js';
import { triangulate, normals, vertex, faceNormal } from '../geometry/mesh.js';
import { worldMatrix } from '../scene/document.js';
import { transformPoint, transformVector, inverse, transpose, normalize, cross, sub, dot, hexToRGB, srgbToLinear } from '../core/math.js';
export const TRI_FLOATS = 32;
const derivedMeshes = new WeakMap();
/** True when a transform reverses the handedness of a triangle's winding. */
export function reversesWinding(m) {
    return dot([m[0], m[1], m[2]], cross([m[4], m[5], m[6]], [m[8], m[9], m[10]])) < 0;
}
function derived(mesh) {
    let entry = derivedMeshes.get(mesh);
    if (!entry) {
        entry = { triangles: triangulate(mesh), normals: mesh.vertexNormals ? Float32Array.from(mesh.vertexNormals) : normals(mesh, true), faceNormals: mesh.faces.map(f => faceNormal(mesh, f)), flat: new Set(mesh.flatFaces || []) };
        derivedMeshes.set(mesh, entry);
    }
    return entry;
}
/** Compile immutable evaluated meshes into the common raster/path-tracing ABI.
 * Derived triangulation and local normals are cached by evaluated mesh identity.
 * World transforms and material assignments deliberately remain outside this cache.
 */
export function compileTriangles(doc, geometry) {
    geometry.setContext?.(doc);
    const chunks = [], matrixCache = new Map(), objects = [], materials = compileMaterials(doc.materials);
    const byId = new Map(doc.objects.map(o => [o.id, o])), visibility = new Map();
    const visible = o => {
        if (!o)
            return true;
        if (!visibility.has(o.id))
            visibility.set(o.id, o.visible !== false && (!o.parent || visible(byId.get(o.parent))));
        return visibility.get(o.id);
    };
    let count = 0;
    for (const obj of doc.objects) {
        if (!visible(obj))
            continue;
        const mesh = geometry.get(obj), d = derived(mesh), world = worldMatrix(doc, obj, doc.animation.frame, matrixCache), nm = transpose(inverse(world)), flip = reversesWinding(world), oi = objects.length + 1;
        objects.push(obj.id);
        const chunk = new Float32Array(d.triangles.length * TRI_FLOATS);
        const transformed = Array.from({ length: mesh.positions.length / 3 }, (_, i) => transformPoint(world, vertex(mesh, i)));
        const normalsWorld = Array.from({ length: mesh.positions.length / 3 }, (_, i) => normalize(transformVector(nm, [...d.normals.slice(i * 3, i * 3 + 3)])));
        let j = 0;
        for (const tri of d.triangles) {
            const { face } = tri, ids = flip ? [tri.ids[0], tri.ids[2], tri.ids[1]] : tri.ids, ps = ids.map(i => transformed[i]);
            if (Math.hypot(...cross(sub(ps[1], ps[0]), sub(ps[2], ps[0]))) < 1e-10)
                continue;
            const fn = normalize(transformVector(nm, d.faceNormals[face]));
            for (let v = 0; v < 3; v++) {
                chunk.set([...ps[v], v === 0 ? (obj.materialSlots?.[mesh.faceMaterials?.[face]]??obj.material) : v === 1 ? oi : face], j + v * 4);
                const normal = mesh.smooth !== false && !d.flat.has(face) ? normalsWorld[ids[v]] : fn;
                chunk.set([...normal, 0], j + 12 + v * 4);
            }
            const uv = ids.map(i => mesh.uvs?.slice(i * 2, i * 2 + 2) || [0, 0]);
            chunk.set([uv[0][0] || 0, uv[0][1] || 0, uv[1][0] || 0, uv[1][1] || 0, uv[2][0] || 0, uv[2][1] || 0, (obj.hiddenInViewport ? 1 : 0) + (obj.cameraVisible === false ? 2 : 0), 0], j + 24);
            j += TRI_FLOATS;
        }
        chunks.push(chunk.subarray(0, j));
        count += j;
    }
    const data = new Float32Array(count);
    let at = 0;
    for (const c of chunks) {
        data.set(c, at);
        at += c.length;
    }
    return { triangles: data, materials, objects };
}
export function compileMaterials(materials) {
    const data = new Float32Array(materials.length * 16), {ranges} = compileGraphs(materials);
    materials.forEach((m, i) => {
        let color = hexToRGB(m.color).map(srgbToLinear), emission=m.emission;
        // Light selection only needs a strictly positive support distribution.
        // Actual textured radiance is evaluated at the sampled point in WGSL.
        if(m.graph?.outputs?.emission) emission=Math.max(emission,1e-6,...[.1,.4,.7,.9].map(u=>evaluateGraph(m.graph,{uv:[u,u]}).emission||0));
        if(m.graph && emission>0) color=[1,1,1];
        const range=ranges[i],sss=m.subsurface||{};
        data.set([...color, m.roughness, m.metallic, m.transmission, m.ior, emission,
          ['solid', 'checker', 'marble', 'wood'].indexOf(m.pattern), m.patternScale,
          Number.isInteger(m.bitmap)?m.bitmap+1:0,range.offset,range.count,
          sss.density??10,sss.anisotropy??0,sss.weight??0], i * 16);
    });
    return data;
}
