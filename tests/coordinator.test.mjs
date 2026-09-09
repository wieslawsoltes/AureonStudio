/** Real loopback HTTP integration. No simulated render/GPU work is claimed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {emptyDocument} from '../src/scene/document.js';
import {decodeEXR} from '../src/io/exr.js';
test('Coordinator HTTP: auth, CORS, leasing, heartbeat, binary merge, EXR, cancellation',async()=>{
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['scripts/render-server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,RENDER_PORT:String(port),RENDER_TOKEN:'test-token-not-for-production'},stdio:['ignore','pipe','pipe']});
 const headers={Authorization:'Bearer test-token-not-for-production'},url=`http://127.0.0.1:${port}`;
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Coordinator startup timeout')),5000);child.stdout.once('data',()=>{clearTimeout(timeout);resolve();});child.once('error',reject);child.once('exit',code=>{if(code)reject(Error('Coordinator exited '+code));});});
  assert.equal((await fetch(url+'/api/jobs')).status,401);
  assert.equal((await fetch(url+'/api/jobs',{method:'OPTIONS',headers:{Origin:'https://untrusted.example'}})).status,403);
  const allowed=await fetch(url+'/api/jobs',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:4173'}});assert.equal(allowed.status,204);assert.equal(allowed.headers.get('access-control-allow-origin'),'http://127.0.0.1:4173');
  const created=await fetch(url+'/api/jobs',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({scene:emptyDocument(),width:2,height:1,samples:2,batchSize:2})});assert.equal(created.status,201);const job=await created.json();
  const work=await (await fetch(url+'/api/work?worker=http-test',{headers})).json();assert.equal(work.jobId,job.id);
  const route=`/api/jobs/${job.id}/tasks/${work.task.id}`,taskHeaders={...headers,'X-Render-Lease':work.task.lease};
  assert.equal((await fetch(url+route+'/heartbeat',{method:'POST',headers:taskHeaders})).status,200);
  const payload=new Float32Array(48).fill(3);payload[15]=7;payload[39]=8;
  const result=await fetch(url+route+'/result',{method:'POST',headers:{...taskHeaders,'Content-Type':'application/octet-stream'},body:payload.buffer});assert.equal(result.status,200);assert.equal((await result.json()).status,'completed');
  const duplicate=await fetch(url+route+'/result',{method:'POST',headers:taskHeaders,body:payload.buffer});assert.equal((await duplicate.json()).duplicate,true);
  const image=await fetch(url+`/api/jobs/${job.id}/image.exr`,{headers});assert.equal(image.status,200);const exr=decodeEXR(new Uint8Array(await image.arrayBuffer()));assert.equal(exr.channels.R[0],3);assert.equal(exr.channels.objectId[1],8);
  assert.equal((await fetch(url+'/src/distributed/worker-client.js')).status,200);
  assert.ok((await fetch(url+'/%2e%2e%2fpackage.json')).status>=400);
  assert.equal((await fetch(url+`/api/jobs/${job.id}`,{method:'DELETE',headers})).status,200);
  const bad=await fetch(url+route+'/result',{method:'POST',headers:taskHeaders,body:payload.buffer});assert.equal(bad.status,400);
  assert.equal((await fetch(url+`/api/jobs/${job.id}?purge=1`,{method:'DELETE',headers})).status,200);
 }finally{child.kill();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,1000).unref();});}
});
