/** Offline temporal integration and deterministic tile rendering. Temporal
 * samples rebuild/refit real geometry at shutter times; no screen-space blur. */
import {compileTriangles} from './compile.js';
import {buildBVH,refitBVH} from './bvh.js';
import {GeometryCache,sampleTransform} from '../scene/document.js';
export function shutterTime(frame,index,count,open=-.25,close=.25){if(![frame,open,close].every(Number.isFinite)||!Number.isInteger(count)||count<1||!Number.isInteger(index)||index<0||index>=count||close<open)throw Error('Invalid shutter interval');return frame+open+(close-open)*(index+.5)/count;}
export function temporalDocument(source,time){const doc=structuredClone(source);doc.animation.frame=time;for(let i=0;i<doc.objects.length;i++){const o=doc.objects[i],pose=sampleTransform(source.objects[i],time,doc.animation.interpolation);for(const k of ['position','rotation','scale'])o[k]=[...pose[k]];if(pose.morphWeights)o.morphWeights=[...pose.morphWeights];}
    const keys=source.camera.keys;if(keys?.length){const sorted=[...keys].sort((a,b)=>a.frame-b.frame);let a=sorted[0],b=sorted.at(-1);for(let i=1;i<sorted.length;i++)if(time<=sorted[i].frame){a=sorted[i-1];b=sorted[i];break;}const t=Math.min(1,Math.max(0,(time-a.frame)/Math.max(1e-8,b.frame-a.frame)));for(const key of ['yaw','pitch','distance','fov','aperture','focus'])if(a[key]!==undefined&&b[key]!==undefined)doc.camera[key]=a[key]+(b[key]-a[key])*t;if(a.target&&b.target)doc.camera.target=a.target.map((v,i)=>v+(b.target[i]-v)*t);}
    return doc;
}
/** Refit only while the original partition remains useful. Empty scenes rebuild. */
function updateBVH(previous,compiled){
    if(!previous||!compiled.triangles.length||previous.order.length!==compiled.triangles.length/32)return buildBVH(compiled.triangles,compiled.materials);
    const next=refitBVH(previous,compiled.triangles,compiled.materials),baseline=previous.referenceQuality??previous.quality;
    if(next.quality>baseline*1.5||(previous.refits??0)>=64)return buildBVH(compiled.triangles,compiled.materials);
    next.referenceQuality=baseline;next.refits=(previous.refits??0)+1;return next;
}
export async function renderProduction(renderer,source,{width=640,height=480,samples=source.settings.samples,shutter=source.settings.shutter||[0,0],frame=source.animation.frame,signal,onProgress=()=>{}}={}){
    if(renderer.busy)await renderer.device.queue.onSubmittedWorkDone();if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>renderer.maxPixels||!Number.isInteger(samples)||samples<1||samples>8192)throw Error('Invalid production render size/sample count');
    const geometry=new GeometryCache();renderer.fixedSize={width,height};renderer.mode='trace';renderer.paused=false;renderer.tile=null;renderer.sampleStart=0;renderer.setAssets(source);renderer.reset();let bvh=null,previousTime=null,doc=null;
    for(let i=0;i<samples;i++){
        if(signal?.aborted)throw new DOMException('Render cancelled','AbortError');
        const time=shutterTime(frame,i,samples,shutter[0],shutter[1]);
        if(time!==previousTime){doc=temporalDocument(source,time);doc.settings.samples=samples;geometry.setContext(doc,time);const compiled=compileTriangles(doc,geometry);bvh=updateBVH(bvh,compiled);renderer.setScene(bvh,compiled.materials,{preserveAccumulation:i>0});previousTime=time;}
        await renderer.render(doc);onProgress({sample:i+1,samples,time,width:renderer.canvas.width,height:renderer.canvas.height});await new Promise(resolve=>setTimeout(resolve,0));
    }
    return {hdr:await renderer.readHDR(),aovs:await renderer.readAOVs()};
}
export async function renderTile(renderer,source,task,{signal,onProgress=()=>{}}={}){const {x,y,width,height,fullWidth,fullHeight,sampleStart,samples}=task;if([x,y,width,height,fullWidth,fullHeight,sampleStart,samples].some(v=>!Number.isInteger(v)||v<0)||!width||!height||!samples||x+width>fullWidth||y+height>fullHeight)throw Error('Invalid render task');const doc=structuredClone(source);doc.settings.samples=samples;doc.settings.denoise=false;const geometry=new GeometryCache(),compiled=compileTriangles(doc,geometry);let scene=buildBVH(compiled.triangles,compiled.materials);renderer.mode='trace';renderer.paused=false;renderer.fixedSize={width,height};renderer.tile={x,y,fullWidth,fullHeight};renderer.sampleStart=sampleStart;renderer.setAssets(doc);renderer.setScene(scene,compiled.materials);renderer.reset();
    for(let i=0;i<samples;i++){if(signal?.aborted)throw new DOMException('Task cancelled','AbortError');if(doc.settings.shutter?.some(v=>v!==0)){const total=task.totalSamples||sampleStart+samples,time=shutterTime(source.animation.frame,sampleStart+i,total,...doc.settings.shutter),snapshot=temporalDocument(doc,time),data=compileTriangles(snapshot,geometry);scene=updateBVH(scene,data);renderer.setScene(scene,data.materials,{preserveAccumulation:i>0});await renderer.render(snapshot);}else await renderer.render(doc);onProgress(i+1);await new Promise(resolve=>setTimeout(resolve,0));}
    const hdr=await renderer.readHDR(),aovs=await renderer.readAOVs(),data=new Float32Array(width*height*24);for(let i=0;i<width*height;i++){data.set(hdr.data.subarray(i*4,i*4+4),i*24);data.set(aovs.data.subarray(i*20,i*20+20),i*24+4);}return data;
}
