/** CPU acceleration benchmark only. No browser/GPU performance claims. */
import os from 'node:os';
import {demoDocument,GeometryCache} from '../src/scene/document.js';
import {compileTriangles} from '../src/render/compile.js';
import {buildBVH,refitBVH} from '../src/render/bvh.js';
const d=demoDocument(),g=new GeometryCache(),input=compileTriangles(d,g);
let b=buildBVH(input.triangles,input.materials);
const builds=[],refits=[];
for(let i=0;i<7;i++) {
 d.objects[3].position[0]+=.01;
 const c=compileTriangles(d,g);
 const rebuilt=buildBVH(c.triangles,c.materials);
 const refitted=refitBVH(b,c.triangles,c.materials);
 builds.push(rebuilt.buildMs);refits.push(refitted.buildMs);b=refitted;
}
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
console.log(JSON.stringify({scope:'CPU BVH only; same process and geometry; one warm-up build; seven trials; no GPU measurement',node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,triangles:input.triangles.length/32,buildMs:builds,refitMs:refits,medianBuildMs:median(builds),medianRefitMs:median(refits)},null,2));
