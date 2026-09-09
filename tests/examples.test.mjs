import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateDocument,GeometryCache} from '../src/scene/document.js';
import {compileTriangles} from '../src/render/compile.js';
for(const name of ['orbit-study','empty-scene','glass-materials','animated-orbit','modifier-workshop','solid-uv-workshop','deformation-lab','bitmap-node-materials','volume-subsurface','photon-caustics','motion-blur']) {
 test(`Example ${name}: document validates and compiles finite triangle data`,async()=>{
  const doc=validateDocument(JSON.parse(await readFile(new URL(`../examples/${name}.aureon`,import.meta.url),'utf8')));
  const compiled=compileTriangles(doc,new GeometryCache());
  assert.ok(compiled.triangles.every(Number.isFinite));
  assert.equal(compiled.triangles.length%32,0);
  assert.equal(compiled.materials.length,doc.materials.length*16);
 });
}
