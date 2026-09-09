import test from 'node:test';
import assert from 'node:assert/strict';
import { compose, inverse, matMul, identity, transformPoint, normalize, sub, cross, dot, rayTriangle, rayBox, perspective, lookAt } from '../src/core/math.js';
import { History } from '../src/core/history.js';
import { PRIMITIVES, createPrimitive, box, plane, sphere, torus, cone } from '../src/geometry/primitives.js';
import { validateMesh, triangulate, faceNormal, extrudeFace, deleteFace, catmullClark, subdivide, weld, vertex, bounds } from '../src/geometry/mesh.js';
import { applyModifier, MODIFIERS } from '../src/geometry/modifiers.js';
import { emptyDocument, demoDocument, newObject, validateDocument, GeometryCache, worldMatrix, setKey, sampleTransform } from '../src/scene/document.js';
import { compileTriangles, compileMaterials } from '../src/render/compile.js';
import { buildBVH, intersectBVH } from '../src/render/bvh.js';
import { cameraRay, project } from '../src/render/camera.js';
import { parseOBJ, exportOBJ, parseSTL, exportSTL, exportGLTF, encodePFM } from '../src/io/formats.js';
const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const vecNear = (a, b, eps = 1e-5) => a.forEach((v, i) => near(v, b[i], eps));
const signedVolume = m => triangulate(m).reduce((s, { ids }) => s + dot(vertex(m, ids[0]), cross(vertex(m, ids[1]), vertex(m, ids[2]))) / 6, 0);
const manifold = m => {
    const edges = new Map();
    for (const f of m.faces)
        for (let i = 0; i < f.length; i++) {
            const a = f[i], b = f[(i + 1) % f.length], k = a < b ? `${a}:${b}` : `${b}:${a}`;
            edges.set(k, (edges.get(k) || 0) + 1);
        }
    return [...edges.values()].every(v => v === 2);
};
test('TRS matrices round-trip under nonuniform scale and rotations', () => {
    for (let i = 0; i < 30; i++) {
        const m = compose({ position: [i, -2, 3], rotation: [i * 7, 23, -91], scale: [.3, 2, -1] }), p = [.32, 4, -7];
        vecNear(transformPoint(inverse(m), transformPoint(m, p)), p);
        vecNear(matMul(m, inverse(m)), identity());
    }
});
test('Singular matrices are rejected', () => assert.throws(() => inverse(new Array(16).fill(0)), /Singular/));
test('WebGPU projection maps near plane to 0 and far plane to 1', () => {
    const p = perspective(60, 1, .1, 100);
    near(transformPoint(p, [0, 0, -.1])[2], 0);
    near(transformPoint(p, [0, 0, -100])[2], 1);
});
test('Ray/AABB handles zero components and rays on slab boundaries', () => {
    assert.ok(rayBox([0, 0, 5], [0, 0, -1], [-1, -1, -1], [1, 1, 1]));
    assert.ok(rayBox([1, 0, 5], [0, 0, -1], [-1, -1, -1], [1, 1, 1]));
    assert.equal(rayBox([2, 0, 5], [0, 0, -1], [-1, -1, -1], [1, 1, 1]), false);
});
test('Ray triangle returns barycentric coordinates and distance', () => {
    const h = rayTriangle([.2, .3, 2], [0, 0, -1], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
    near(h.t, 2);
    near(h.u, .2);
    near(h.v, .3);
    assert.equal(rayTriangle([2, 2, 2], [0, 0, -1], [0, 0, 0], [1, 0, 0], [0, 1, 0]), null);
});
for (const type of PRIMITIVES)
    test(`${type}: valid finite triangulated mesh`, () => {
        const m = createPrimitive(type);
        validateMesh(m);
        const t = triangulate(m);
        assert.ok(t.length > 0);
        for (const tri of t) {
            const [a, b, c] = tri.ids.map(i => vertex(m, i));
            assert.ok(Math.hypot(...cross(sub(b, a), sub(c, a))) > 1e-10);
        }
    });
for (const type of PRIMITIVES.filter(t => t !== 'plane'))
    test(`${type}: closed manifold and outward winding`, () => {
        const m = createPrimitive(type);
        assert.ok(manifold(m));
        assert.ok(signedVolume(m) > 0);
    });
test('Box has exact volume and dimensions', () => {
    const m = box({ width: 2, height: 3, depth: 4 });
    near(signedVolume(m), 24);
    vecNear(bounds(m).min, [-1, -1.5, -2]);
});
test('Cone has an exact shared apex, not a tiny top cap', () => {
    const m = cone({ segments: 24 });
    assert.equal(m.positions.length / 3, 25);
    assert.equal(m.faces.length, 25);
    assert.equal(m.faces.filter(f => f.length === 3).length, 24);
});
test('Concave polygon triangulation preserves area', () => {
    const m = { positions: [0, 0, 0, 3, 0, 0, 3, 1, 0, 1, 1, 0, 1, 3, 0, 0, 3, 0], faces: [[0, 1, 2, 3, 4, 5]], uvs: [] };
    const ts = triangulate(m);
    assert.equal(ts.length, 4);
    const area = ts.reduce((sum, { ids }) => {
        const [a, b, c] = ids.map(i => vertex(m, i));
        return sum + Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
    }, 0);
    near(area, 5);
});
test('Invalid mesh indices and nonfinite positions are rejected', () => {
    assert.throws(() => validateMesh({ positions: [0, 0, 0], faces: [[0, 1, 2]] }));
    assert.throws(() => validateMesh({ positions: [NaN, 0, 0], faces: [] }));
});
test('Extrusion preserves a closed manifold and adds exact volume', () => {
    const m = extrudeFace(box(), 5, 1);
    assert.ok(manifold(m));
    near(signedVolume(m), 12);
    assert.equal(m.faces.length, 10);
});
test('Radial inset preserves volume at zero extrusion', () => {
    const m = extrudeFace(box(), 5, 0, .25);
    assert.ok(manifold(m));
    near(signedVolume(m), 8);
});
test('Face deletion changes only the specified polygon', () => assert.equal(deleteFace(box(), 0).faces.length, 5));
test('Subdivision preserves volume and manifold topology', () => {
    const m = subdivide(box());
    assert.ok(manifold(m));
    assert.equal(m.faces.length, 24);
    near(signedVolume(m), 8);
});
test('Catmull–Clark refines topology and preserves symmetry', () => {
    const m = catmullClark(box());
    assert.ok(manifold(m));
    assert.equal(m.faces.length, 24);
    vecNear(bounds(m).min, bounds(m).max.map(v => -v));
    assert.ok(signedVolume(m) < 8);
});
test('Catmull–Clark applies boundary vertex weights on an open plane', () => {
    const m = catmullClark(plane());
    assert.equal(m.faces.length, 4);
    assert.ok(m.positions.every(Number.isFinite));
});
for (const [type, spec] of Object.entries(MODIFIERS))
    test(`${type} modifier evaluates without mutating its source`, () => {
        const input = type === 'shell' ? plane({ segments: 3 }) : sphere({ segments: 8, rings: 6 }), before = JSON.stringify(input), m = applyModifier(input, { type, value: spec.value });
        assert.equal(JSON.stringify(input), before);
        validateMesh(m);
        assert.ok(m.positions.every(Number.isFinite));
    });
test('Shell closes open plane boundary with correctly oriented walls', () => {
    const m = applyModifier(plane(), { type: 'shell', value: .5 });
    assert.ok(manifold(m));
    near(signedVolume(m), 2);
});
test('Disabled modifier returns unchanged geometry', () => {
    const m = box();
    assert.deepEqual(applyModifier(m, { type: 'twist', value: 90, enabled: false }), m);
});
test('History supports atomic undo/redo and failure rollback', () => {
    let doc = { x: 0 };
    const h = new History(() => doc, x => doc = x);
    h.run('x', () => doc.x = 5);
    assert.equal(h.undo(), 'x');
    assert.equal(doc.x, 0);
    assert.equal(h.redo(), 'x');
    assert.equal(doc.x, 5);
    assert.throws(() => h.run('fail', () => {
        doc.x = 20;
        throw Error('bad');
    }));
    assert.equal(doc.x, 5);
});
test('History drops redo branch after a new edit', () => {
    let d = { x: 0 };
    const h = new History(() => d, x => d = x);
    h.run('1', () => d.x = 1);
    h.undo();
    h.run('2', () => d.x = 2);
    assert.equal(h.redo(), false);
});
test('Scene format round-trips with modifiers and animation', () => {
    const d = demoDocument();
    setKey(d.objects[3], 0);
    d.objects[3].position[0] = 2;
    setKey(d.objects[3], 60);
    d.objects[3].modifiers.push({ type: 'twist', value: 15, enabled: true });
    const json = JSON.stringify(d);
    assert.equal(JSON.stringify(validateDocument(JSON.parse(json))), json);
});
test('Scene validation rejects hierarchy cycles and unsupported versions', () => {
    const d = demoDocument();
    d.objects[0].parent = d.objects[1].id;
    d.objects[1].parent = d.objects[0].id;
    assert.throws(() => validateDocument(d), /Cyclic/);
    const e = emptyDocument();
    e.version = 999;
    assert.throws(() => validateDocument(e));
});
test('Scene validation rejects missing parents and material references', () => {
    const d = demoDocument();
    d.objects[0].parent = 'missing';
    assert.throws(() => validateDocument(d), /Missing parent/);
    d.objects[0].parent = null;
    d.objects[0].material = 1000;
    assert.throws(() => validateDocument(d), /material reference/);
});
test('Animation: step, linear, smooth and duplicate frame replacement', () => {
    const o = newObject('box');
    o.position = [0, 0, 0];
    setKey(o, 0);
    o.position = [10, 20, 30];
    setKey(o, 10);
    vecNear(sampleTransform(o, 5, 'linear').position, [5, 10, 15]);
    vecNear(sampleTransform(o, 5, 'step').position, [0, 0, 0]);
    vecNear(sampleTransform(o, 2.5, 'smooth').position, [1.5625, 3.125, 4.6875]);
    o.position = [20, 0, 0];
    setKey(o, 10);
    assert.equal(o.keys.length, 2);
    near(sampleTransform(o, 20).position[0], 20);
});
test('Hierarchy composes parent transforms without modifying children', () => {
    const d = emptyDocument(), a = newObject('box'), b = newObject('sphere');
    a.position = [2, 0, 0];
    b.position = [0, 3, 0];
    b.parent = a.id;
    d.objects = [a, b];
    vecNear(transformPoint(worldMatrix(d, b), [0, 0, 0]), [2, 3, 0]);
});
test('Geometry cache invalidates parameter and modifier changes', () => {
    const cache = new GeometryCache(), o = newObject('box');
    const a = cache.get(o);
    assert.equal(cache.get(o), a);
    o.params.width = 4;
    const b = cache.get(o);
    assert.notEqual(a, b);
    near(bounds(b).max[0], 2);
});
test('Camera projection and picking rays agree', () => {
    const d = emptyDocument(), p = [0, 1, 0], screen = project(d.camera, p, 1000, 700), ray = cameraRay(d.camera, screen[0], screen[1], 1000, 700);
    vecNear(normalize(sub(p, ray.origin)), ray.direction);
});
const d = demoDocument(), compiled = compileTriangles(d, new GeometryCache()), bvh = buildBVH(compiled.triangles, compiled.materials);
test('BVH nodes, triangle order and light CDF satisfy packing invariants', () => {
    assert.ok(bvh.nodeCount > 1);
    assert.equal(bvh.nodes.byteLength, bvh.nodeCount * 32);
    assert.ok(bvh.maxDepth < 64);
    assert.equal(bvh.triangles.length, compiled.triangles.length);
    assert.ok(bvh.lightCount > 0);
    const l = new Float32Array(bvh.lights);
    near(l[(bvh.lightCount - 1) * 4 + 1], 1);
    let total = 0;
    for (let i = 0; i < bvh.lightCount; i++)
        total += l[i * 4 + 2];
    near(total, 1);
});
test('Every emissive triangle stores a matching area probability for MIS', () => {
    const l = new Float32Array(bvh.lights), u = new Uint32Array(bvh.lights);
    for (let i = 0; i < bvh.lightCount; i++)
        near(bvh.triangles[u[i * 4] * 32 + 31], l[i * 4 + 2] / l[i * 4 + 3], 1e-6);
});
test('BVH traversal agrees with brute force for deterministic random rays', () => {
    let seed = 8121;
    const rng = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
    for (let i = 0; i < 100; i++) {
        const o = [(rng() - .5) * 12, 2 + rng() * 8, (rng() - .5) * 12], direction = normalize(sub([(rng() - .5) * 5, rng() * 3, (rng() - .5) * 5], o)), hit = intersectBVH(bvh, o, direction, { ignoreHidden: false });
        let dist = Infinity;
        for (let j = 0; j < compiled.triangles.length; j += 32) {
            const t = compiled.triangles, h = rayTriangle(o, direction, [...t.slice(j, j + 3)], [...t.slice(j + 4, j + 7)], [...t.slice(j + 8, j + 11)], dist);
            if (h)
                dist = h.t;
        }
        assert.equal(!!hit, Number.isFinite(dist));
        if (hit)
            near(hit.t, dist, 1e-4);
    }
});
test('Empty scene BVH is safe to query', () => {
    const e = buildBVH(new Float32Array(), new Float32Array(16));
    assert.equal(intersectBVH(e, [0, 0, 0], [0, 0, -1]), null);
});
test('OBJ import supports negative indices and texture coordinates', () => {
    const m = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf -3/1 -2/2 -1/3');
    assert.equal(m.faces.length, 1);
    assert.deepEqual(m.uvs, [0, 0, 1, 0, 0, 1]);
});
test('OBJ import rejects invalid indices', () => assert.throws(() => parseOBJ('v 0 0 0\nf 1 2 3'), /range/));
test('OBJ world-space export/import preserves box bounds', () => {
    const d = emptyDocument(), o = newObject('box');
    o.position = [2, 3, 4];
    d.objects = [o];
    const m = parseOBJ(exportOBJ(d, new GeometryCache()));
    vecNear(bounds(m).min, [1, 2, 3]);
    vecNear(bounds(m).max, [3, 4, 5]);
});
test('Binary STL round-trip preserves triangle count and bounds', () => {
    const d = emptyDocument();
    d.objects = [newObject('box')];
    const buffer = exportSTL(d, new GeometryCache()), m = parseSTL(buffer);
    assert.equal(triangulate(m).length, 12);
    vecNear(bounds(m).min, [-1, 0, -1]);
});
test('ASCII STL parser accepts signed exponential numbers', () => {
    const m = parseSTL(new TextEncoder().encode('solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1e0 0 0\nvertex 0 +1.0 0\nendloop\nendfacet\nendsolid').buffer);
    assert.equal(m.faces.length, 1);
});
test('glTF static export has aligned in-bounds accessors and data URI', () => {
    const d = emptyDocument();
    d.objects = [newObject('box')];
    const g = exportGLTF(d, new GeometryCache());
    assert.equal(g.asset.version, '2.0');
    const bytes = Buffer.from(g.buffers[0].uri.split(',')[1], 'base64');
    assert.equal(bytes.length, g.buffers[0].byteLength);
    for (const v of g.bufferViews) {
        assert.equal(v.byteOffset % 4, 0);
        assert.ok(v.byteOffset + v.byteLength <= bytes.length);
    }
    assert.equal(g.scenes[0].nodes.length, 1);
});
test('PFM export stores unclamped linear HDR in little endian bottom-up order', () => {
    const buffer = encodePFM({ width: 1, height: 2, data: new Float32Array([2, 3, 4, 1, 5, 6, 7, 1]) }), bytes = new Uint8Array(buffer), header = new TextEncoder().encode('PF\n1 2\n-1.0\n');
    assert.deepEqual(bytes.slice(0, header.length), header);
    near(new DataView(buffer).getFloat32(header.length, true), 5);
    near(new DataView(buffer).getFloat32(header.length + 12, true), 2);
});
test('Relative OBJ indices are resolved at each face, not cached as raw tokens', () => {
    const m = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\nv 0 0 1\nv 1 0 1\nv 0 1 1\nf -3 -2 -1');
    assert.equal(m.positions.length / 3, 6);
    vecNear(vertex(m, m.faces[1][0]), [0, 0, 1]);
});
test('Lathe collapses on-axis profile endpoints to exact manifold apices', () => {
    const m = createPrimitive('lathe', { profile: [[0, -1], [1, 0], [0, 1]], segments: 12 });
    assert.equal(m.positions.length / 3, 14);
    assert.ok(manifold(m));
    assert.ok(signedVolume(m) > 0);
    for (const { ids } of triangulate(m)) {
        const [a, b, c] = ids.map(i => vertex(m, i));
        assert.ok(Math.hypot(...cross(sub(b, a), sub(c, a))) > 1e-8);
    }
});
test('Cylinder accepts an exact zero top radius', () => {
    const m = createPrimitive('cylinder', { topRadius: 0 });
    assert.ok(manifold(m));
    assert.equal(m.positions.length / 3, 33);
});
test('Cylinder side normals do not average in cap normals', () => {
    const d = emptyDocument(), o = newObject('cylinder', { segments: 8 });
    d.objects.push(o);
    const compiled = compileTriangles(d, new GeometryCache());
    for (let i = 0; i < compiled.triangles.length; i += 32) {
        const t = compiled.triangles;
        if (t[i + 11] < 8) {
            near(t[i + 13], 0);
            near(t[i + 17], 0);
            near(t[i + 21], 0);
        }
    }
});
test('Reflected instances keep geometric and shading normal orientations consistent', () => {
    const d = emptyDocument(), o = newObject('box');
    o.scale = [-1, 2, 1];
    d.objects.push(o);
    const t = compileTriangles(d, new GeometryCache()).triangles;
    for (let i = 0; i < t.length; i += 32) {
        const a = [...t.slice(i, i + 3)], b = [...t.slice(i + 4, i + 7)], c = [...t.slice(i + 8, i + 11)], n = [...t.slice(i + 12, i + 15)];
        assert.ok(dot(normalize(cross(sub(b, a), sub(c, a))), n) > .99);
    }
});
test('Reflected OBJ and STL snapshots retain positive signed volume', () => {
    const d = emptyDocument(), o = newObject('box');
    o.scale = [-1, 1, 1];
    d.objects.push(o);
    const g = new GeometryCache();
    near(signedVolume(parseOBJ(exportOBJ(d, g))), 8);
    near(signedVolume(parseSTL(exportSTL(d, g))), 8);
});
test('BVH refit matches a fresh build under deformation and updated emission', async () => {
    const { refitBVH } = await import('../src/render/bvh.js');
    const d = demoDocument(), g = new GeometryCache(), first = compileTriangles(d, g), a = buildBVH(first.triangles, first.materials);
    d.objects[3].position = [2, 3, -1];
    d.objects[4].scale = [.5, 2, 1];
    d.materials[7].emission = 0;
    d.materials[0].emission = 1;
    const moved = compileTriangles(d, g), r = refitBVH(a, moved.triangles, moved.materials), b = buildBVH(moved.triangles, moved.materials);
    assert.equal(r.updateKind, 'refit');
    assert.equal(r.lightCount, b.lightCount);
    for (let i = 0; i < 100; i++) {
        const origin = [Math.sin(i) * 8, 5 + Math.cos(i * 2), Math.cos(i) * 8], dir = normalize(sub([0, 1, 0], origin)), rh = intersectBVH(r, origin, dir, { ignoreHidden: false }), bh = intersectBVH(b, origin, dir, { ignoreHidden: false });
        assert.equal(!!rh, !!bh);
        if (rh)
            near(rh.t, bh.t, 1e-4);
    }
    for (let i = 0; i < r.triangles.length; i += 32)
        if (moved.materials[r.triangles[i + 3] * 16 + 7] === 0)
            near(r.triangles[i + 31], 0);
});
test('Refit rejects mismatched triangle counts', async () => {
    const { refitBVH } = await import('../src/render/bvh.js');
    const d = demoDocument(), c = compileTriangles(d, new GeometryCache()), a = buildBVH(c.triangles, c.materials);
    assert.throws(() => refitBVH(a, new Float32Array(32), c.materials), /matching/);
});
test('History prunes old transactions by approximate memory budget', () => {
    let d = { v: '' };
    const h = new History(() => d, x => d = x, 60, 100);
    for (let i = 0; i < 5; i++)
        h.run('large', () => d.v = 'x'.repeat(100) + i);
    assert.equal(h.undoStack.length, 1);
    assert.ok(h.undo());
});
