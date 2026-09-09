/** Position-based incompressible particle fluid with hashed neighbors, XSPH
 * viscosity, optional vorticity confinement, and marching-tetrahedra meshing.
 * Solver equations: Macklin & Müller, Position Based Fluids (SIGGRAPH 2013).
 * CPU reference implementation: deterministic order, no hidden random forces.
 */
import {add,sub,mul,dot,cross,normalize,clamp} from '../core/math.js';
import {TriangleCollider} from './collision.js';
export class SpatialHash {
    constructor(cellSize){if(!Number.isFinite(cellSize)||cellSize<=0)throw Error('Invalid spatial hash cell size');this.cellSize=cellSize;this.cells=new Map();}
    key(p){return p.map(x=>Math.floor(x/this.cellSize)).join(',');}
    build(positions){this.cells.clear();for(let i=0;i<positions.length/3;i++){const key=this.key(Array.from(positions.slice(i*3,i*3+3)));let bucket=this.cells.get(key);if(!bucket)this.cells.set(key,bucket=[]);bucket.push(i);}this.positions=positions;return this;}
    neighbors(p,radius=this.cellSize){const cell=p.map(x=>Math.floor(x/this.cellSize)),n=Math.ceil(radius/this.cellSize),out=[];for(let z=-n;z<=n;z++)for(let y=-n;y<=n;y++)for(let x=-n;x<=n;x++)for(const id of this.cells.get(`${cell[0]+x},${cell[1]+y},${cell[2]+z}`)||[])out.push(id);return out;}
}
export function fluidBlock({min=[-.5,1,-.5],size=[1,1,1],spacing=.1}={}){if(!Number.isFinite(spacing)||spacing<=0||min.length!==3||size.length!==3||![...min,...size].every(Number.isFinite)||size.some(v=>v<=0))throw Error('Invalid fluid block');const count=size.map(s=>Math.ceil(s/spacing));if(count.reduce((a,b)=>a*b,1)>20000)throw Error('Fluid block exceeds 20,000 particles');const p=[];for(let z=0;z<count[2];z++)for(let y=0;y<count[1];y++)for(let x=0;x<count[0];x++)p.push(min[0]+(x+.5)*spacing,min[1]+(y+.5)*spacing,min[2]+(z+.5)*spacing);return p;}
export class PositionBasedFluid {
    constructor(positions,{spacing=.1,smoothingRadius=spacing*2,restDensity=1000,mass=restDensity*spacing**3,iterations=4,substeps=3,gravity=[0,-9.81,0],viscosity=.02,vorticity=0,relaxation=1e-5,tensile=.0001,bounds={min:[-2,0,-2],max:[2,4,2]},radius=spacing*.4,colliders=[]}={}){
        if(positions.length%3||positions.length>60000||!Array.from(positions).every(Number.isFinite)||![spacing,smoothingRadius,restDensity,mass,relaxation,radius].every(x=>Number.isFinite(x)&&x>0)||!Number.isInteger(iterations)||iterations<1||iterations>40||!Number.isInteger(substeps)||substeps<1||substeps>64||!Number.isFinite(viscosity)||viscosity<0||viscosity>1||!Number.isFinite(vorticity)||vorticity<0||!Number.isFinite(tensile)||tensile<0||gravity.length!==3||!gravity.every(Number.isFinite)||!bounds.min||!bounds.max||[...bounds.min,...bounds.max].some(x=>!Number.isFinite(x))||bounds.min.some((v,i)=>v+2*radius>=bounds.max[i]))throw Error('Invalid fluid solver parameters');
        Object.assign(this,{spacing,h:smoothingRadius,restDensity,mass,iterations,substeps,gravity,viscosity,vorticity,relaxation,tensile,bounds,radius});this.initial=Float64Array.from(positions);this.positions=Float64Array.from(positions);this.velocities=new Float64Array(positions.length);this.density=new Float64Array(positions.length/3);this.lambda=new Float64Array(positions.length/3);this.hash=new SpatialHash(this.h);this.colliders=colliders.map(c=>c instanceof TriangleCollider?c:new TriangleCollider(c.mesh||c,c));this.time=0;
        this.poly=315/(64*Math.PI*this.h**9);this.spiky=-45/(Math.PI*this.h**6);
    }
    W(r2){return r2<this.h*this.h?this.poly*(this.h*this.h-r2)**3:0;}
    grad(d,r=Math.hypot(...d)){return r>1e-10&&r<this.h?mul(d,this.spiky*(this.h-r)**2/r):[0,0,0];}
    constrain(p,previous){let q=p.map((x,i)=>clamp(x,this.bounds.min[i]+this.radius,this.bounds.max[i]-this.radius));for(const c of this.colliders)q=c.project(previous,q,this.radius);return q;}
    reset(){this.positions.set(this.initial);this.velocities.fill(0);this.time=0;return this;}
    step(dt){if(!Number.isFinite(dt)||dt<=0||dt>.1)throw Error('Fluid timestep must be in (0, .1]');const p=this.positions,v=this.velocities,n=p.length/3,h=dt/this.substeps,mr=this.mass/this.restDensity,ref=this.W((.3*this.h)**2);
        for(let stepIndex=0;stepIndex<this.substeps;stepIndex++){const old=p.slice();for(let i=0;i<n;i++){const q=[];for(let k=0;k<3;k++){v[3*i+k]+=this.gravity[k]*h;q[k]=p[3*i+k]+h*v[3*i+k];}p.set(this.constrain(q,Array.from(old.slice(i*3,i*3+3))),i*3);}
            for(let it=0;it<this.iterations;it++){this.hash.build(p);const neighbors=Array.from({length:n},(_,i)=>this.hash.neighbors(Array.from(p.slice(i*3,i*3+3))));
                for(let i=0;i<n;i++){const pi=Array.from(p.slice(i*3,i*3+3));let rho=0,den=0,gi=[0,0,0];for(const j of neighbors[i]){const d=sub(pi,Array.from(p.slice(j*3,j*3+3))),r2=dot(d,d);rho+=this.mass*this.W(r2);if(i!==j){const g=mul(this.grad(d),mr);gi=add(gi,g);den+=dot(g,g);}}this.density[i]=rho;this.lambda[i]=-Math.max(0,rho/this.restDensity-1)/(den+dot(gi,gi)+this.relaxation);}
                const corrections=new Float64Array(p.length);for(let i=0;i<n;i++){const pi=Array.from(p.slice(i*3,i*3+3));let dp=[0,0,0];for(const j of neighbors[i])if(i!==j){const d=sub(pi,Array.from(p.slice(j*3,j*3+3))),sc=-this.tensile*(this.W(dot(d,d))/ref)**4;dp=add(dp,mul(this.grad(d),(this.lambda[i]+this.lambda[j]+sc)*mr));}const length=Math.hypot(...dp);if(length>this.h*.2)dp=mul(dp,this.h*.2/length);corrections.set(dp,i*3);}
                for(let i=0;i<n;i++)p.set(this.constrain([0,1,2].map(k=>p[i*3+k]+corrections[i*3+k]),Array.from(old.slice(i*3,i*3+3))),i*3);
            }
            for(let i=0;i<p.length;i++)v[i]=(p[i]-old[i])/h;
            this.hash.build(p);const before=v.slice(),omega=new Float64Array(p.length);
            if(this.vorticity)for(let i=0;i<n;i++){const pi=Array.from(p.slice(i*3,i*3+3)),vi=Array.from(before.slice(i*3,i*3+3));let w=[0,0,0];for(const j of this.hash.neighbors(pi))if(i!==j){const d=sub(pi,Array.from(p.slice(j*3,j*3+3))),dv=sub(Array.from(before.slice(j*3,j*3+3)),vi);w=add(w,mul(cross(dv,this.grad(d)),this.mass/Math.max(this.density[j],this.restDensity*.1)));}omega.set(w,i*3);}
            if(this.viscosity||this.vorticity)for(let i=0;i<n;i++){const pi=Array.from(p.slice(i*3,i*3+3)),vi=Array.from(before.slice(i*3,i*3+3));let dv=[0,0,0],eta=[0,0,0];for(const j of this.hash.neighbors(pi))if(i!==j){const d=sub(pi,Array.from(p.slice(j*3,j*3+3))),weight=this.mass/Math.max(this.density[j],this.restDensity*.1);dv=add(dv,mul(sub(Array.from(before.slice(j*3,j*3+3)),vi),this.W(dot(d,d))*weight));if(this.vorticity)eta=add(eta,mul(this.grad(d),Math.hypot(...omega.slice(j*3,j*3+3))*weight));}v.set(add(vi,add(mul(dv,this.viscosity),mul(cross(normalize(eta),Array.from(omega.slice(i*3,i*3+3))),h*this.vorticity))),i*3);}
        }this.time+=dt;return p;
    }
}
const tetrahedra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]],corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
export function fluidSurface(solver,{cellSize=solver.spacing*.75,iso=.5,maxCells=262144}={}){
    if(!Number.isFinite(cellSize)||cellSize<=0||!Number.isFinite(iso)||iso<=0||!Number.isInteger(maxCells)||maxCells<1||maxCells>2097152)throw Error('Invalid fluid meshing parameters');const p=solver.positions,n=p.length/3;if(!n)return {positions:[],faces:[],uvs:[],smooth:true};
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<n;i++)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[i*3+k]-solver.h);max[k]=Math.max(max[k],p[i*3+k]+solver.h);}const counts=max.map((v,k)=>Math.ceil((v-min[k])/cellSize)),points=counts.map(v=>v+1);if(counts.reduce((a,b)=>a*b,1)>maxCells)throw Error('Fluid surface grid exceeds cell budget; increase cell size');const total=points.reduce((a,b)=>a*b,1),values=new Float32Array(total),index=(x,y,z)=>(z*points[1]+y)*points[0]+x,pos=id=>{const x=id%points[0],y=Math.floor(id/points[0])%points[1],z=Math.floor(id/(points[0]*points[1]));return [x,y,z].map((v,k)=>min[k]+v*cellSize);};solver.hash.build(p);
    for(let i=0;i<total;i++){const q=pos(i);let density=0;for(const j of solver.hash.neighbors(q)){const d=sub(q,Array.from(p.slice(j*3,j*3+3)));density+=solver.mass/solver.restDensity*solver.W(dot(d,d));}values[i]=density-iso;}
    const mesh={positions:[],faces:[],uvs:[],smooth:true},edges=new Map();
    function cut(a,b){const key=a<b?`${a}:${b}`:`${b}:${a}`;if(edges.has(key))return edges.get(key);const t=values[a]/(values[a]-values[b]),A=pos(a),B=pos(b),q=A.map((v,i)=>v+(B[i]-v)*t),id=mesh.positions.length/3;mesh.positions.push(...q);mesh.uvs.push(q[0],q[2]);edges.set(key,id);return id;}
    function triangle(ids,inside,outside){const A=ids.map(i=>mesh.positions.slice(i*3,i*3+3)),out=sub(pos(outside),pos(inside));if(dot(cross(sub(A[1],A[0]),sub(A[2],A[0])),out)<0)ids.reverse();mesh.faces.push(ids);}
    for(let z=0;z<counts[2];z++)for(let y=0;y<counts[1];y++)for(let x=0;x<counts[0];x++){const c=corners.map(([a,b,d])=>index(x+a,y+b,z+d));for(const tet of tetrahedra){const ids=tet.map(i=>c[i]),inside=ids.filter(i=>values[i]>0),outside=ids.filter(i=>values[i]<=0);if(!inside.length||!outside.length)continue;if(inside.length===1)triangle(outside.map(i=>cut(inside[0],i)),inside[0],outside[0]);else if(inside.length===3)triangle(inside.map(i=>cut(i,outside[0])),inside[0],outside[0]);else{const [a,b]=inside,[c,d]=outside,q=[cut(a,c),cut(a,d),cut(b,d),cut(b,c)];triangle([q[0],q[1],q[2]],a,c);triangle([q[0],q[2],q[3]],a,c);}}}
    return mesh;
}
