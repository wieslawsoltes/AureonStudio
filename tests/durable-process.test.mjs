/** An actual process kill between HTTP acknowledgements, not a graceful close. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {mkdtemp,rm,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emptyDocument} from '../src/scene/document.js';
import {decodeEXR} from '../src/io/exr.js';
test('Durable HTTP coordinator survives SIGKILL, recovers acknowledged tiles and rejects stale leases',{timeout:20000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'aureon-crash-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const url=`http://127.0.0.1:${port}`,headers={Authorization:'Bearer crash-test-token'},env={...process.env,RENDER_EPHEMERAL:'0',RENDER_STATE_DIR:dir,RENDER_PORT:String(port),RENDER_TOKEN:'crash-test-token'};let child;
 async function start(){child=spawn(process.execPath,['scripts/render-server.mjs'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',x=>log+=x);await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Coordinator failed: '+log);}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),5000);timer.unref();})]);}
 async function kill(){const exited=once(child,'exit');child.kill('SIGKILL');await exited;child=null;}
 t.after(async()=>{if(child){const done=once(child,'exit');child.kill();await done;}});
 const call=async(path,method='GET',data)=>{const r=await fetch(url+path,{method,headers:{...headers,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});assert.equal(r.status,method==='POST'&&path==='/api/jobs'?201:200,await r.clone().text());return r.json();};
 const complete=(job,work,data)=>fetch(url+`/api/jobs/${job}/tasks/${work.task.id}/result`,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-Render-Lease':work.task.lease},body:data.buffer});
 await start();const job=await call('/api/jobs','POST',{scene:emptyDocument(),width:2,height:1,samples:4,tileSize:2,batchSize:2});const a=await call('/api/work?worker=first'),b=await call('/api/work?worker=interrupted');const data=new Float32Array(48).fill(3.25);data[15]=7;data[39]=8;assert.equal((await complete(job.id,a,data)).status,200);
 await kill();await appendFile(join(dir,'journal.bin'),Buffer.from('AURQ'));
 await start();const status=await call('/api/status');assert.ok(status.durable);assert.equal(status.recoveredTailBytes,4);assert.equal((await call('/api/jobs/'+job.id)).completed,1);
 assert.equal((await complete(job.id,b,data)).status,400);assert.equal((await(await complete(job.id,a,data)).json()).duplicate,true);
 const retry=await call('/api/work?worker=recovered');assert.equal(retry.task.id,b.task.id);const next=new Float32Array(48).fill(1.75);next[15]=7;next[39]=8;assert.equal((await complete(job.id,retry,next)).status,200);
 await kill();await start();assert.equal((await call('/api/jobs/'+job.id)).status,'completed');const response=await fetch(url+`/api/jobs/${job.id}/image.exr`,{headers});assert.equal(response.status,200);const image=decodeEXR(new Uint8Array(await response.arrayBuffer()));assert.equal(image.channels.R[0],2.5);assert.equal(image.channels.objectId[1],8);
});
