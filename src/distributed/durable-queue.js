/** A single-writer, fsync-backed write-ahead log for RenderQueue.
 * Each acknowledged result has a checksummed, length-delimited record on disk.
 * Snapshots are atomically renamed before log truncation. On restart, incomplete
 * trailing writes are discarded, corruption fails closed, and unfinished leases
 * are invalidated. Acknowledged duplicates remain idempotent across restarts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {serialize,deserialize} from 'node:v8';
import {createHash,randomUUID} from 'node:crypto';
import {RenderQueue} from './queue.js';
const MAGIC=Buffer.from('AURQ0001');
const MAX_RECORD=1024*1024*1024;
const digest=b=>createHash('sha256').update(b).digest();
function frame(value){const data=serialize(value);if(data.length>MAX_RECORD)throw Error('Render persistence record exceeds 1 GiB');const header=Buffer.alloc(44);MAGIC.copy(header);header.writeUInt32LE(data.length,8);digest(data).copy(header,12);return Buffer.concat([header,data]);}
function unpack(bytes,{tail=false}={}){let offset=0;const values=[];while(offset<bytes.length){if(bytes.length-offset<44){if(tail)break;throw Error('Truncated render state header');}if(!bytes.subarray(offset,offset+8).equals(MAGIC))throw Error('Invalid render state signature');const length=bytes.readUInt32LE(offset+8);if(length>MAX_RECORD)throw Error('Render state record size exceeds limit');if(offset+44+length>bytes.length){if(tail)break;throw Error('Truncated render state');}const data=bytes.subarray(offset+44,offset+44+length);if(!digest(data).equals(bytes.subarray(offset+12,offset+44)))throw Error('Render state checksum mismatch; refusing corrupted state');values.push(deserialize(data));offset+=44+length;}return {values,consumed:offset};}
function syncDirectory(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writeAll(fd,data){let at=0;while(at<data.length){const written=fs.writeSync(fd,data,at,data.length-at);if(!written)throw Error('Unable to write render state');at+=written;}fs.fsyncSync(fd);}
export class DurableRenderQueue extends RenderQueue {
    constructor({stateDir,checkpointEvery=64,maxJournalBytes=128*1024*1024,...options}={}){
        super(options);
        if(typeof stateDir!=='string'||!stateDir.length)throw Error('A render state directory is required');
        if(!Number.isInteger(checkpointEvery)||checkpointEvery<1)throw Error('Invalid checkpoint interval');
        this.stateDir=path.resolve(stateDir);this.checkpointEvery=checkpointEvery;this.maxJournalBytes=maxJournalBytes;this.seq=0;this.pending=0;this.closed=false;this.failed=false;
        fs.mkdirSync(this.stateDir,{recursive:true,mode:0o700});
        this.lockPath=path.join(this.stateDir,'writer.lock');this.owner=randomUUID();this.acquireLock();
        try{
            this.snapshotPath=path.join(this.stateDir,'snapshot.bin');this.logPath=path.join(this.stateDir,'journal.bin');
            if(fs.existsSync(this.snapshotPath)){const {values}=unpack(fs.readFileSync(this.snapshotPath));if(values.length!==1)throw Error('Invalid checkpoint record count');this.restore(values[0]);}
            if(fs.existsSync(this.logPath)){const bytes=fs.readFileSync(this.logPath),{values,consumed}=unpack(bytes,{tail:true});for(const e of values){if(e.seq<=this.seq)continue;if(e.seq!==this.seq+1)throw Error('Render journal sequence gap');this.replay(e);this.seq=e.seq;}if(consumed!==bytes.length){fs.truncateSync(this.logPath,consumed);this.recoveredTailBytes=bytes.length-consumed;}}
            // Claims are deliberately transient. Completions retain their lease
            // nonce so retrying an already acknowledged upload is harmless.
            for(const j of this.jobs.values())for(const t of j.tasks)if(t.status==='leased'){t.status='pending';delete t.lease;delete t.worker;delete t.deadline;}
            this.fd=fs.openSync(this.logPath,'a',0o600);this.logBytes=fs.fstatSync(this.fd).size;syncDirectory(this.stateDir);
        }catch(error){this.releaseLock();throw error;}
    }
    acquireLock(){
        const record={owner:this.owner,pid:process.pid,host:os.hostname()};
        try{const fd=fs.openSync(this.lockPath,'wx',0o600);try{writeAll(fd,Buffer.from(JSON.stringify(record)));}finally{fs.closeSync(fd);}syncDirectory(this.stateDir);}
        catch(error){if(error.code!=='EEXIST')throw error;const old=JSON.parse(fs.readFileSync(this.lockPath,'utf8'));if(old.host!==os.hostname())throw Error('Render state is locked by another host');
            let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
            if(alive)throw Error('Render state is locked by another writer');
            // Atomically claim stale-lock recovery itself; avoid two recovering
            // processes both replacing the live writer's newly created lock.
            const recovery=this.lockPath+'.recovery';let fd;try{fd=fs.openSync(recovery,'wx',0o600);const again=JSON.parse(fs.readFileSync(this.lockPath,'utf8'));if(again.owner!==old.owner)throw Error('Render writer lock changed during recovery');fs.unlinkSync(this.lockPath);this.acquireLock();}finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(recovery);}}
        }
    }
    releaseLock(){try{const lock=JSON.parse(fs.readFileSync(this.lockPath,'utf8'));if(lock.owner===this.owner)fs.unlinkSync(this.lockPath);}catch(e){if(e.code!=='ENOENT')throw e;}}
    writable(){if(this.closed||this.failed)throw Error('Render persistence is closed or failed; restart the coordinator');}
    append(type,payload){this.writable();const bytes=frame({seq:this.seq+1,type,payload});try{writeAll(this.fd,bytes);}catch(e){this.failed=true;throw e;}this.seq++;this.pending++;this.logBytes+=bytes.length;}
    maybeCheckpoint(){if(this.pending>=this.checkpointEvery||this.logBytes>=this.maxJournalBytes){try{this.checkpoint();}catch(e){this.failed=true;throw e;}}}
    create(options){this.writable();const result=super.create(options),job=this.jobs.get(result.id);try{this.append('create',{id:job.id,created:job.created,options:{...options,scene:job.scene}});}catch(e){super.remove(result.id);throw e;}this.maybeCheckpoint();return result;}
    complete(jobId,taskId,lease,data){
        this.writable();const {task,duplicate}=this.checkLease(jobId,taskId,lease);if(duplicate)return {duplicate:true,...this.describe(jobId)};
        if(!(data instanceof Float32Array)||data.length!==task.width*task.height*24||data.some(v=>!Number.isFinite(v)))throw Error('Invalid or nonfinite tile result');
        // A lease valid at the start of a synchronous durable commit stays valid
        // until the corresponding in-memory merge, even if fsync crosses its deadline.
        this.append('complete',{jobId,taskId,lease,data});task.deadline=Infinity;const result=super.complete(jobId,taskId,lease,data);this.maybeCheckpoint();return result;
    }
    cancel(id){this.writable();if(!this.jobs.has(id))throw Error('Unknown job');this.append('cancel',{id});const result=super.cancel(id);this.maybeCheckpoint();return result;}
    remove(id){this.writable();if(!this.jobs.has(id))return false;this.append('remove',{id});const result=super.remove(id);this.maybeCheckpoint();return result;}
    claim(worker){this.writable();return super.claim(worker);}
    heartbeat(...args){this.writable();return super.heartbeat(...args);}
    replay({type,payload:p}){
        if(type==='create'){const info=super.create(p.options),j=this.jobs.get(info.id);this.jobs.delete(j.id);j.id=p.id;j.created=p.created;this.jobs.set(j.id,j);}
        else if(type==='complete'){const j=this.jobs.get(p.jobId),t=j?.tasks[p.taskId];if(!t||t.status==='done')throw Error('Invalid completion in render journal');t.status='leased';t.lease=p.lease;t.deadline=Infinity;super.complete(p.jobId,p.taskId,p.lease,p.data);}
        else if(type==='cancel')super.cancel(p.id);else if(type==='remove')super.remove(p.id);else throw Error('Unknown render journal operation');
    }
    restore(snapshot){
        if(snapshot.version!==1||!Number.isSafeInteger(snapshot.seq)||snapshot.seq<0||!Array.isArray(snapshot.jobs))throw Error('Unsupported render checkpoint');
        this.seq=snapshot.seq;this.memory=0;this.jobs.clear();
        for(const j of snapshot.jobs){if(!j||typeof j.id!=='string'||this.jobs.has(j.id)||!(j.sums instanceof Float64Array)||!(j.correction instanceof Float64Array)||!(j.weights instanceof Uint32Array)||j.sums.length!==j.width*j.height*24||j.correction.length!==j.sums.length||j.weights.length!==j.width*j.height||!Array.isArray(j.tasks)||j.tasks.some((t,i)=>t.id!==i))throw Error('Invalid render checkpoint job');
            if(createHash('sha256').update(JSON.stringify(j.scene)).digest('hex')!==j.hash)throw Error('Render checkpoint scene hash mismatch');
            this.memory+=j.bytes;if(this.memory>this.maxMemory)throw Error('Restored render jobs exceed memory budget');this.jobs.set(j.id,j);
        }
    }
    checkpoint(){
        this.writable();const data=frame({version:1,seq:this.seq,jobs:[...this.jobs.values()]}),tmp=this.snapshotPath+'.'+this.owner+'.tmp';
        const fd=fs.openSync(tmp,'wx',0o600);try{writeAll(fd,data);}finally{fs.closeSync(fd);}
        fs.renameSync(tmp,this.snapshotPath);syncDirectory(this.stateDir);
        fs.ftruncateSync(this.fd,0);fs.fsyncSync(this.fd);this.logBytes=0;this.pending=0;
    }
    close(){if(this.closed)return;try{if(!this.failed)this.checkpoint();}finally{if(this.fd!==undefined)fs.closeSync(this.fd);this.closed=true;this.releaseLock();}}
}
