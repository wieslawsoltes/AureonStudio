import {writeFile,mkdir} from 'node:fs/promises';
import {encodeEXR} from '../src/io/exr.js';
import {encodePNG} from '../src/io/png.js';
const path=new URL('../test-results/v0.2/',import.meta.url);await mkdir(path,{recursive:true});
await writeFile(new URL('independent.exr',path),encodeEXR({width:2,height:2,channels:{R:Float32Array.of(.1,3.5,-.4,1),G:Float32Array.of(.2,.5,.6,1),B:Float32Array.of(.3,.8,.9,1),objectId:Uint32Array.of(0,1,2,3)}}));
await writeFile(new URL('independent.png',path),encodePNG(2,1,Uint8Array.of(255,0,0,255,0,128,255,127)));
