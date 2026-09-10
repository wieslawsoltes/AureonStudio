/** Cross-implementation fixtures: Node writes Aureon EXR; Python uses OpenEXR.
 * Expected values are saved separately; comparisons do not use Aureon's decoder.
 */
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {encodeEXRAdvanced,decodeEXRAdvanced} from '../src/io/exr-advanced.js';
const out=process.argv[3]||'test-results/gpu/interop';await mkdir(out,{recursive:true});
if(process.argv[2]==='verify'){
 const manifest=JSON.parse(await readFile(join(out,'openexr-generated.json'),'utf8'));
 for(const entry of manifest){const decoded=await decodeEXRAdvanced(new Uint8Array(await readFile(join(out,entry.file))));assert.equal(decoded.parts.length,entry.parts.length);for(let i=0;i<entry.parts.length;i++){const expected=entry.parts[i],actual=decoded.parts[i];assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);for(const [name,values]of Object.entries(expected.channels)){assert.equal(actual.channels[name].length,values.length);actual.channels[name].forEach((v,j)=>assert.ok(Math.abs(v-values[j])<.003,`${entry.file} part ${i} ${name} pixel ${j}: ${v} != ${values[j]}`));}}}
 console.log('PASS',manifest.length,'independently encoded EXRs decoded by Aureon');
}else{
 const width=37,height=19,n=width*height,channels={R:Float32Array.from({length:n},(_,i)=>(i%37-12)/8),G:new Float32Array(n).fill(4.5),B:new Float32Array(n).fill(-.25),objectId:Uint32Array.from({length:n},(_,i)=>4000000000+i),depth:Float32Array.from({length:n},(_,i)=>i/4)};
 const fixtures=[];
 for(const compression of ['NONE','ZIP','ZIPS'])for(const multipart of [false,true]){
  const file=`aureon-${compression}-${multipart?'multi':'single'}.exr`,base={width,height,types:{R:'HALF',G:'FLOAT',B:'HALF',objectId:'UINT',depth:'FLOAT'},compression},parts=multipart?[{...base,name:'beauty',channels:{R:channels.R,G:channels.G,B:channels.B}},{...base,name:'guides',channels:{objectId:channels.objectId,depth:channels.depth}}]:[{...base,name:'part0',channels}];
  await writeFile(join(out,file),await encodeEXRAdvanced(multipart?{parts}:parts[0]));fixtures.push({file,parts:parts.map(p=>({...p,channels:Object.fromEntries(Object.entries(p.channels).map(([k,v])=>[k,Array.from(v)]))}))});
 }
 await writeFile(join(out,'aureon-generated.json'),JSON.stringify(fixtures));console.log('Wrote',fixtures.length,'cross-decoder fixtures');
}
