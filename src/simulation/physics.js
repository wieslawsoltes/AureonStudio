/** Deterministic fixed-step XPBD cloth/soft-body constraints and sphere-proxy
 * rigid bodies. Solvers have no DOM or renderer dependency. SI units, +Y up. */
import {add,sub,mul,dot,normalize,clamp} from '../core/math.js';
import {cloneMesh,vertex,triangulate} from '../geometry/mesh.js';
import {meshEdges} from '../geometry/uv.js';
import {quatMul,quatNormalize} from '../animation/rig.js';
export function seededRandom(seed=1){let state=seed>>>0;return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}
export class XPBD {
    constructor(positions,{pins=[],mass=1,compliance=1e-6,damping=.01,gravity=[0,-9.81,0],iterations=8,substeps=4,floor=0,radius=.01,colliders=[]}={}){if(positions.length%3||!Array.from(positions).every(Number.isFinite))throw Error('Invalid XPBD positions');if(!Number.isFinite(mass)||mass<=0||!Number.isFinite(compliance)||compliance<0||!Number.isInteger(iterations)||iterations<1||iterations>100||!Number.isInteger(substeps)||substeps<1||substeps>64)throw Error('Invalid XPBD solver settings');this.initial=Float64Array.from(positions);this.positions=Float64Array.from(positions);this.velocities=new Float64Array(positions.length);this.inverseMass=new Float64Array(positions.length/3).fill(1/mass);for(const i of pins){if(!Number.isInteger(i)||i<0||i>=this.inverseMass.length)throw Error('Invalid pin');this.inverseMass[i]=0;}Object.assign(this,{compliance,damping,gravity,iterations,substeps,floor,radius,colliders});this.constraints=[];this.time=0;}
    distance(a,b,compliance=this.compliance){if(a===b||a<0||b<0||a>=this.inverseMass.length||b>=this.inverseMass.length)throw Error('Invalid distance constraint');const length=Math.hypot(...sub(Array.from(this.positions.slice(a*3,a*3+3)),Array.from(this.positions.slice(b*3,b*3+3))));this.constraints.push({a,b,length,compliance,lambda:0});return this;}
    reset(){this.positions.set(this.initial);this.velocities.fill(0);this.time=0;return this;}
    step(dt){if(!Number.isFinite(dt)||dt<=0||dt>.1)throw Error('Simulation timestep must be in (0, 0.1] seconds');const h=dt/this.substeps,p=this.positions,v=this.velocities;for(let substep=0;substep<this.substeps;substep++){const previous=p.slice();for(let i=0;i<this.inverseMass.length;i++)if(this.inverseMass[i])for(let k=0;k<3;k++){v[i*3+k]+=this.gravity[k]*h;p[i*3+k]+=v[i*3+k]*h;}for(const c of this.constraints)c.lambda=0;
        for(let it=0;it<this.iterations;it++){for(const c of this.constraints){const ai=c.a*3,bi=c.b*3,d=[p[ai]-p[bi],p[ai+1]-p[bi+1],p[ai+2]-p[bi+2]],len=Math.hypot(...d),w=this.inverseMass[c.a]+this.inverseMass[c.b],alpha=c.compliance/(h*h);if(len<1e-12||w===0)continue;const dl=(-(len-c.length)-alpha*c.lambda)/(w+alpha);c.lambda+=dl;for(let k=0;k<3;k++){const correction=dl*d[k]/len;p[ai+k]+=this.inverseMass[c.a]*correction;p[bi+k]-=this.inverseMass[c.b]*correction;}}
            for(let i=0;i<this.inverseMass.length;i++)if(this.inverseMass[i]){const j=i*3;p[j+1]=Math.max(this.floor+this.radius,p[j+1]);for(const c of this.colliders){if(c.type==='sphere'){const d=[p[j]-c.center[0],p[j+1]-c.center[1],p[j+2]-c.center[2]],len=Math.hypot(...d),r=c.radius+this.radius;if(len<r){const n=len>1e-10?mul(d,1/len):[0,1,0];for(let k=0;k<3;k++)p[j+k]=c.center[k]+n[k]*r;}}}}}
        for(let i=0;i<p.length;i++)v[i]=(p[i]-previous[i])/h*Math.exp(-this.damping*h);}
        this.time+=dt;return this.positions;}
}
export function clothSolver(mesh,options={}){const solver=new XPBD(mesh.positions,options),edges=meshEdges(mesh);for(const e of edges.values())solver.distance(e.a,e.b);const used=new Set([...edges.keys()]);const add=(a,b,c)=>{const key=a<b?`${a}:${b}`:`${b}:${a}`;if(a!==b&&!used.has(key)){solver.distance(a,b,c);used.add(key);}};for(const f of mesh.faces){if(f.length===4){add(f[0],f[2],options.compliance??1e-6);add(f[1],f[3],options.compliance??1e-6);}}
    // Across-edge distances supply bending resistance without dihedral singularities.
    const ts=triangulate(mesh);const te=new Map();for(const {ids} of ts)for(let i=0;i<3;i++){const a=ids[i],b=ids[(i+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;if(!te.has(key))te.set(key,[]);te.get(key).push(ids[(i+2)%3]);}for(const opposite of te.values())if(opposite.length===2)add(...opposite,options.bendCompliance??1e-3);return solver;}
export class RigidWorld {
    constructor({gravity=[0,-9.81,0],floor=0,substeps=4,iterations=6}={}){Object.assign(this,{gravity,floor,substeps,iterations});this.bodies=[];this.time=0;}
    add({position=[0,1,0],velocity=[0,0,0],rotation=[0,0,0,1],angularVelocity=[0,0,0],radius=.5,mass=1,restitution=.35,friction=.5}={}){if(radius<=0||mass<0||!Number.isFinite(radius)||!Number.isFinite(mass))throw Error('Invalid rigid body');const b={position:[...position],velocity:[...velocity],rotation:[...rotation],angularVelocity:[...angularVelocity],radius,inverseMass:mass?1/mass:0,restitution,friction};this.bodies.push(b);return b;}
    step(dt){if(dt<=0||dt>.1)throw Error('Rigid timestep must be in (0, .1]');const h=dt/this.substeps;for(let s=0;s<this.substeps;s++){for(const b of this.bodies)if(b.inverseMass){b.velocity=add(b.velocity,mul(this.gravity,h));b.position=add(b.position,mul(b.velocity,h));const omega=[...b.angularVelocity,0],dq=quatMul(omega,b.rotation);b.rotation=quatNormalize(b.rotation.map((v,i)=>v+.5*h*dq[i]));if(b.position[1]-b.radius<this.floor){b.position[1]=this.floor+b.radius;if(b.velocity[1]<0){const normalImpulse=-(1+b.restitution)*b.velocity[1];b.velocity[1]+=normalImpulse;const lateral=Math.hypot(b.velocity[0],b.velocity[2]),factor=Math.max(0,1-b.friction*normalImpulse/Math.max(lateral,1e-8));b.velocity[0]*=factor;b.velocity[2]*=factor;}}}
        for(let it=0;it<this.iterations;it++)for(let i=0;i<this.bodies.length;i++)for(let j=i+1;j<this.bodies.length;j++){const a=this.bodies[i],b=this.bodies[j],w=a.inverseMass+b.inverseMass,d=sub(b.position,a.position),len=Math.hypot(...d),overlap=a.radius+b.radius-len;if(overlap<=0||!w)continue;const n=len>1e-10?mul(d,1/len):[1,0,0];a.position=sub(a.position,mul(n,overlap*a.inverseMass/w));b.position=add(b.position,mul(n,overlap*b.inverseMass/w));const rel=dot(sub(b.velocity,a.velocity),n);if(rel<0){const impulse=-(1+Math.min(a.restitution,b.restitution))*rel/w;a.velocity=sub(a.velocity,mul(n,impulse*a.inverseMass));b.velocity=add(b.velocity,mul(n,impulse*b.inverseMass));}}}this.time+=dt;}
}
/** Bounded deterministic timeline cache; backwards seeks restart from rest. */
export class SimulationCache {
    constructor(){this.entries=new Map();}
    evaluate(object,mesh,frame,fps=24){
        const cfg=object.simulation;if(!cfg)return mesh;
        if(!Number.isFinite(frame)||!Number.isFinite(fps)||fps<=0||fps>1000)throw Error('Invalid simulation frame rate/time');
        const elapsed=Math.max(0,frame-(cfg.start??0)),target=Math.floor(elapsed),fraction=elapsed-target;
        const key=JSON.stringify([mesh.positions,mesh.faces,cfg,fps]);let e=this.entries.get(object.id);
        if(!e||e.key!==key||target<e.frame){
            if(cfg.type==='cloth')e={key,frame:0,solver:clothSolver(mesh,cfg),mesh};
            else if(cfg.type==='rigid'){const world=new RigidWorld(cfg),b=world.add({position:[0,0,0],...cfg.body});e={key,frame:0,world,b,mesh};}
            else throw Error('Unknown simulation type');this.entries.set(object.id,e);
        }
        if(target-e.frame>10000)throw Error('Simulation seek exceeds 10,000 frames; bake a shorter range');
        const advance=seconds=>{for(let t=0;t<seconds-1e-12;){const dt=Math.min(1/60,seconds-t);e.solver?e.solver.step(dt):e.world.step(dt);t+=dt;}};
        while(e.frame<target){advance(1/fps);e.frame++;}
        // Fractional shutter samples never perturb the cached integer-frame state.
        // This keeps random-order sampling and backwards seeks deterministic.
        let saved=null;
        if(fraction>1e-12){
            saved=e.solver?{positions:e.solver.positions.slice(),velocities:e.solver.velocities.slice(),time:e.solver.time}:{body:structuredClone(e.b),time:e.world.time};
            advance(fraction/fps);
        }
        const out=cloneMesh(mesh);delete out.vertexNormals;
        if(e.solver)out.positions=Array.from(e.solver.positions);
        else {const [x,y,z,w]=e.b.rotation;for(let i=0;i<out.positions.length;i+=3){const p=mesh.positions.slice(i,i+3),qv=[x,y,z],uv=[qv[1]*p[2]-qv[2]*p[1],qv[2]*p[0]-qv[0]*p[2],qv[0]*p[1]-qv[1]*p[0]],uuv=[qv[1]*uv[2]-qv[2]*uv[1],qv[2]*uv[0]-qv[0]*uv[2],qv[0]*uv[1]-qv[1]*uv[0]];out.positions.splice(i,3,...p.map((v,k)=>v+2*(w*uv[k]+uuv[k])+e.b.position[k]));}}
        if(saved){if(e.solver){e.solver.positions.set(saved.positions);e.solver.velocities.set(saved.velocities);e.solver.time=saved.time;}else{Object.assign(e.b,saved.body);e.world.time=saved.time;}}
        return out;
    }
    clear(){this.entries.clear();}
}
