/** One deterministic rigid world per scene, not one world per edited object.
 * Rest meshes and bind transforms are sampled once; integer-frame checkpoints
 * survive fractional shutter evaluations. Cloth and fluids share static mesh
 * colliders in world coordinates and remain independently cacheable solvers.
 */
import {matMul,inverse,transformPoint,transformVector,sub,mul} from '../core/math.js';
import {quatMatrix,quatMul,quatConjugate,quatNormalize} from '../animation/rig.js';
import {decomposeTRS} from '../animation/controllers.js';
import {cloneMesh,bounds} from '../geometry/mesh.js';
import {DynamicsWorld,convexShape} from './rigid.js';
import {clothSolver} from './physics.js';
import {PositionBasedFluid,fluidBlock,fluidSurface} from './fluids.js';
import {particlesToMesh} from './curves.js';
function transformed(mesh,m){const out=cloneMesh(mesh);out.positions=[];for(let i=0;i<mesh.positions.length;i+=3)out.positions.push(...transformPoint(m,mesh.positions.slice(i,i+3)));delete out.vertexNormals;return out;}
function state(b){return {position:[...b.position],velocity:[...b.velocity],rotation:[...b.rotation],angularVelocity:[...b.angularVelocity],inverseMass:b.inverseMass};}
export class SceneSimulationCache {
    constructor(){this.clear();}
    clear(){this.rigid=null;this.entries=new Map();this.context=null;this.prepared=false;this.sampled=null;}
    setContext(doc,frame,world,base){this.context=doc;this.frame=frame;this.worldMatrix=world;this.base=base;this.prepared=false;this.sampled=null;return this;}
    prepare(){
        if(this.prepared)return;this.prepared=true;const doc=this.context;if(!doc)return;
        const rigid=doc.objects.filter(o=>o.simulation?.type==='rigid'),colliders=doc.objects.filter(o=>o.simulation?.type==='collider'),signatures=[];
        const records=rigid.map(o=>{const cfg=o.simulation,rest=cfg.restMesh||this.base(o,cfg.start??0),matrix=this.worldMatrix(o,cfg.start??0);signatures.push([o.id,cfg,matrix,rest.positions,rest.faces]);return {o,cfg,rest,matrix};});
        const staticMeshes=colliders.map(o=>{const rest=this.base(o,0),mesh=transformed(rest,this.worldMatrix(o,0));signatures.push([o.id,o.simulation,rest.positions,rest.faces]);return {o,rest,mesh,...o.simulation};});this.staticMeshes=staticMeshes;
        // Kinematic transforms and controller dependencies are part of the cache
        // key, but the requested sample frame is not. Replaying frame N must use
        // the collider's transform at each integration step, not its final pose.
        signatures.push(doc.objects.map(o=>[o.id,o.parent,o.position,o.rotation,o.scale,o.keys,o.tracks,o.controllers,o.constraints]));
        const settings=doc.physics||{gravity:records[0]?.cfg.gravity||[0,-9.81,0],floor:records[0]?.cfg.floor??0},key=JSON.stringify([signatures,settings,doc.animation.fps]);this.signature=key;
        if(!this.rigid||this.rigid.key!==key){const world=new DynamicsWorld(settings),bodies=new Map();staticMeshes.forEach(c=>world.addCollider(c.mesh,c));
            for(const {o,cfg,rest,matrix} of records){const trs=decomposeTRS(matrix),scaled=transformed(rest,quatMatrix([0,0,0,1],[0,0,0],trs.scale));let shape,center;
                if(cfg.shape==='convex'){shape=convexShape(scaled);center=shape.center;}
                else{const b=bounds(scaled);center=b.min.map((v,i)=>(v+b.max[i])/2);let autoRadius=0;for(let i=0;i<scaled.positions.length;i+=3)autoRadius=Math.max(autoRadius,Math.hypot(...scaled.positions.slice(i,i+3).map((x,k)=>x-center[k])));shape={type:'sphere',radius:(cfg.body?.radius??autoRadius/Math.max(...trs.scale.map(Math.abs)))*Math.max(...trs.scale.map(Math.abs))};}
                const bodyBind=quatMatrix(trs.rotation,transformPoint(quatMatrix(trs.rotation,trs.position),center)),offset=transformVector(matrix,cfg.body?.position||[0,0,0]),body=world.add({...cfg.body,id:o.id,shape,position:bodyBind.slice(12,15).map((x,i)=>x+offset[i]),rotation:quatMul(trs.rotation,cfg.body?.rotation||[0,0,0,1])});bodies.set(o.id,{o,cfg,rest,matrix,bodyBind,center,body,mass:body.inverseMass});
            }this.rigid={key,world,bodies,frame:0};this.entries.clear();
        }
    }
    updateColliders(targets,frame,offset=0){this.staticMeshes.forEach((record,i)=>{const evaluated=this.base(record.o,frame);if(evaluated.positions.length!==record.rest.positions.length||JSON.stringify(evaluated.faces)!==JSON.stringify(record.rest.faces))throw Error('Animated mesh colliders must preserve topology');targets[offset+i].bvh.refit(transformed(evaluated,this.worldMatrix(record.o,frame)).positions);});}
    stepRigid(seconds,frameStart){const e=this.rigid,fps=this.context.animation.fps;for(let t=0;t<seconds-1e-12;){const dt=Math.min(1/60,seconds-t),frame=frameStart+(t+dt)*fps;this.updateColliders(e.world.colliders,frame);
        for(const {o,cfg,body,mass,center} of e.bodies.values()){body.inverseMass=frame<(cfg.start??0)?0:mass;if(!mass){const trs=decomposeTRS(this.worldMatrix(o,frame)),position=transformPoint(quatMatrix(trs.rotation,trs.position),center).map((x,i)=>x+transformVector(this.worldMatrix(o,frame),cfg.body?.position||[0,0,0])[i]),targetRotation=quatMul(trs.rotation,cfg.body?.rotation||[0,0,0,1]),previous=body.rotation;body.velocity=mul(sub(position,body.position),1/dt);const dq=quatNormalize(quatMul(targetRotation,quatConjugate(previous))),sign=dq[3]<0?-1:1;body.angularVelocity=dq.slice(0,3).map(v=>sign*2*v/dt);body.position=position;body.rotation=targetRotation;}}
        e.world.step(dt);t+=dt;}
    }
    sampleRigids(frame){this.prepare();if(this.sampled?.frame===frame)return this.sampled.transforms;const e=this.rigid,fps=this.context.animation.fps,target=Math.max(0,Math.floor(frame)),fraction=Math.max(0,frame-target);if(target<e.frame){this.rigid=null;this.prepared=false;this.prepare();return this.sampleRigids(frame);}if(target-e.frame>10000)throw Error('Rigid seek exceeds 10,000 frames; bake a shorter range');while(e.frame<target){this.stepRigid(1/fps,e.frame);e.frame++;}
        const saved=fraction>1e-12?{bodies:e.world.bodies.map(state),time:e.world.time}:null;if(saved)this.stepRigid(fraction/fps,target);const transforms=new Map();for(const [id,r] of e.bodies)transforms.set(id,matMul(quatMatrix(r.body.rotation,r.body.position),inverse(r.bodyBind)));if(saved){e.world.bodies.forEach((b,i)=>Object.assign(b,saved.bodies[i]));e.world.time=saved.time;}this.sampled={frame,transforms};return transforms;
    }
    evaluate(object,mesh,frame,fps=24){const cfg=object.simulation;if(!cfg||cfg.type==='collider')return mesh;if(!this.context)throw Error('Scene simulation requires a document context');this.prepare();
        if(cfg.type==='rigid'){const delta=this.sampleRigids(frame).get(object.id),r=this.rigid.bodies.get(object.id);if(!delta||frame<(cfg.start??0))return mesh;const local=matMul(inverse(this.worldMatrix(object,frame)),matMul(delta,r.matrix));return transformed(r.rest,local);}
        if(!['cloth','fluid'].includes(cfg.type))throw Error('Unknown scene simulation type');const start=cfg.start??0,target=Math.max(0,Math.floor(frame-start)),fraction=Math.max(0,frame-start-target),bind=this.worldMatrix(object,start),rest=cfg.restMesh||this.base(object,start),worldRest=transformed(rest,bind),key=JSON.stringify([cfg,bind,worldRest.positions,worldRest.faces,this.signature,fps]);let e=this.entries.get(object.id);
        if(!e||e.key!==key||target<e.frame){const colliders=this.staticMeshes.map(c=>({type:'mesh',...c}));let solver;if(cfg.type==='cloth')solver=clothSolver(worldRest,{...cfg,colliders:[...(cfg.colliders||[]),...colliders]});else{const points=cfg.positions||fluidBlock(cfg.block),positions=[];for(let i=0;i<points.length;i+=3)positions.push(...transformPoint(bind,points.slice(i,i+3)));solver=new PositionBasedFluid(positions,{...cfg,colliders:[...(cfg.colliders||[]),...colliders]});}e={key,solver,frame:0,worldRest};this.entries.set(object.id,e);}
        if(target-e.frame>10000)throw Error('Simulation seek exceeds 10,000 frames');const advance=(seconds,frameStart)=>{for(let t=0;t<seconds-1e-12;){const dt=Math.min(1/60,seconds-t),targets=cfg.type==='cloth'?e.solver.meshColliders:e.solver.colliders;this.updateColliders(targets,frameStart+(t+dt)*fps,targets.length-this.staticMeshes.length);e.solver.step(dt);t+=dt;}};while(e.frame<target){advance(1/fps,start+e.frame);e.frame++;}const saved=fraction>1e-12?{positions:e.solver.positions.slice(),velocities:e.solver.velocities.slice(),time:e.solver.time}:null;if(saved)advance(fraction/fps,start+target);
        let result;if(cfg.type==='cloth')result={...cloneMesh(e.worldRest),positions:Array.from(e.solver.positions)};else if(cfg.surface!==false)result=fluidSurface(e.solver,cfg.meshing);else result=particlesToMesh(Array.from({length:e.solver.positions.length/3},(_,i)=>({position:Array.from(e.solver.positions.slice(i*3,i*3+3)),radius:cfg.radius??e.solver.radius})));
        if(saved){e.solver.positions.set(saved.positions);e.solver.velocities.set(saved.velocities);e.solver.time=saved.time;}return transformed(result,inverse(this.worldMatrix(object,frame)));
    }
}
