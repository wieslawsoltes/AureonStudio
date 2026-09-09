/** Exact rational BSP is the default. An explicit fast mode retains the
 * tolerance-based implementation. Inputs must be closed, outward 2-manifolds.
 * Coordinates and UVs are interpolated at every split; inputs are never mutated.
 */
import {add,sub,mul,dot,cross,normalize,lerp,transformPoint} from '../core/math.js';
import {vertex,triangulate,validateMesh,bounds} from './mesh.js';
import {exactBoolean} from './exact-boolean.js';
export function topology(mesh, tolerance=1e-7) {
    validateMesh(mesh);
    const canonical=new Map(), ids=[];let next=0;
    for(let i=0;i<mesh.positions.length/3;i++) {const key=vertex(mesh,i).map(v=>tolerance===0?v:Math.round(v/tolerance)).join(',');if(!canonical.has(key))canonical.set(key,next++);ids.push(canonical.get(key));}
    const edges=new Map();let degenerate=0;
    for(const f of mesh.faces) for(let j=0;j<f.length;j++) {const a=ids[f[j]],b=ids[f[(j+1)%f.length]];if(a===b){degenerate++;continue;}const key=a<b?`${a}:${b}`:`${b}:${a}`;const e=edges.get(key)||{count:0,balance:0};e.count++;e.balance+=a<b?1:-1;edges.set(key,e);}
    return {vertices:next,edges:edges.size,faces:mesh.faces.length,boundary:[...edges.values()].filter(e=>e.count===1).length,nonManifold:[...edges.values()].filter(e=>e.count>2).length,inconsistent:[...edges.values()].filter(e=>e.count===2&&e.balance!==0).length,degenerate};
}
export function signedVolume(m) {let v=0;for(const t of triangulate(m)) {const [a,b,c]=t.ids.map(i=>vertex(m,i));v+=dot(a,cross(b,c))/6;}return v;}
export function transformMesh(mesh,matrix) {const m=structuredClone(mesh);m.positions=[];for(let i=0;i<mesh.positions.length/3;i++)m.positions.push(...transformPoint(matrix,vertex(mesh,i)));if(dot([matrix[0],matrix[1],matrix[2]],cross([matrix[4],matrix[5],matrix[6]],[matrix[8],matrix[9],matrix[10]]))<0)m.faces.forEach(f=>f.reverse());delete m.vertexNormals;return m;}
class Polygon {
    constructor(vertices,tag=0){this.vertices=vertices;this.tag=tag;this.normal=normalize(cross(sub(vertices[1].p,vertices[0].p),sub(vertices[2].p,vertices[0].p)));this.w=dot(this.normal,vertices[0].p);}
    flip(){this.vertices.reverse();this.normal=mul(this.normal,-1);this.w=-this.w;}
}
class BSP {
    constructor(polygons=[],eps=1e-6,depth=0){this.eps=eps;this.depth=depth;this.polygons=[];this.front=null;this.back=null;this.plane=null;if(polygons.length)this.build(polygons);}
    split(p,cf,cb,front,back){const n=this.plane.n,w=this.plane.w,types=p.vertices.map(v=>{const d=dot(n,v.p)-w;return d>this.eps?1:d< -this.eps?2:0;}),type=types.reduce((a,b)=>a|b,0);
        if(type===0){(dot(n,p.normal)>0?cf:cb).push(p);return;}if(type===1){front.push(p);return;}if(type===2){back.push(p);return;}
        const f=[],b=[];for(let i=0;i<p.vertices.length;i++){const j=(i+1)%p.vertices.length,a=p.vertices[i],z=p.vertices[j];if(types[i]!==2)f.push(a);if(types[i]!==1)b.push(a);if((types[i]|types[j])===3){const t=(w-dot(n,a.p))/dot(n,sub(z.p,a.p)),v={p:lerp(a.p,z.p,t),uv:lerp(a.uv,z.uv,t)};f.push(v);b.push(v);}}
        if(f.length>=3&&Math.hypot(...cross(sub(f[1].p,f[0].p),sub(f[2].p,f[0].p)))>this.eps*this.eps)front.push(new Polygon(f,p.tag));
        if(b.length>=3&&Math.hypot(...cross(sub(b[1].p,b[0].p),sub(b[2].p,b[0].p)))>this.eps*this.eps)back.push(new Polygon(b,p.tag));
    }
    build(polygons){if(!polygons.length)return;if(this.depth>768)throw Error('Boolean BSP depth limit exceeded; simplify the operands.');if(!this.plane){const p=polygons[Math.floor(polygons.length/2)];this.plane={n:p.normal,w:p.w};}const f=[],b=[];for(const p of polygons)this.split(p,this.polygons,this.polygons,f,b);if(f.length){this.front ||=new BSP([],this.eps,this.depth+1);this.front.build(f);}if(b.length){this.back ||=new BSP([],this.eps,this.depth+1);this.back.build(b);}}
    invert(){for(const p of this.polygons)p.flip();if(this.plane){this.plane.n=mul(this.plane.n,-1);this.plane.w=-this.plane.w;}this.front?.invert();this.back?.invert();[this.front,this.back]=[this.back,this.front];}
    clipPolygons(polygons){if(!this.plane)return polygons.slice();let f=[],b=[];for(const p of polygons)this.split(p,f,b,f,b);if(this.front)f=this.front.clipPolygons(f);b=this.back?this.back.clipPolygons(b):[];return f.concat(b);}
    clipTo(other){this.polygons=other.clipPolygons(this.polygons);this.front?.clipTo(other);this.back?.clipTo(other);}
    all(){return this.polygons.concat(this.front?.all()||[],this.back?.all()||[]);}
}
function inputPolygons(m,tag) {return triangulate(m).map(({ids})=>new Polygon(ids.map(i=>({p:vertex(m,i),uv:m.uvs?.length?m.uvs.slice(i*2,i*2+2):[0,0]})),tag));}
/** Insert collinear T-junction vertices into polygon boundaries after BSP cuts. */
function stitchTJunctions(out,eps){const points=[];const seen=new Map();for(let i=0;i<out.positions.length/3;i++){const p=vertex(out,i),key=p.map(v=>Math.round(v/eps)).join(',');if(!seen.has(key)){seen.set(key,points.length);points.push(p);}}
    if(points.length>12000)throw Error('Boolean output exceeds the 12,000 unique-vertex stitching budget');
    out.faces=out.faces.map(face=>{const result=[];for(let e=0;e<face.length;e++){const ia=face[e],ib=face[(e+1)%face.length],a=vertex(out,ia),b=vertex(out,ib),d=sub(b,a),len2=dot(d,d),cuts=[];result.push(ia);if(len2<=eps*eps)continue;for(const p of points){const t=dot(sub(p,a),d)/len2;if(t<=eps||t>=1-eps)continue;if(Math.hypot(...sub(p,add(a,mul(d,t))))<=eps)cuts.push({t,p});}cuts.sort((a,b)=>a.t-b.t);let last=-1;for(const c of cuts){if(c.t-last<eps)continue;last=c.t;const id=out.positions.length/3;out.positions.push(...c.p);out.uvs.push(...lerp(out.uvs.slice(ia*2,ia*2+2),out.uvs.slice(ib*2,ib*2+2),c.t));result.push(id);}}return result;});}
export function booleanMesh(a,b,operation='union',{tolerance,validate=true,precision='exact',...limits}={}) {
    if(!['union','subtract','intersect'].includes(operation))throw Error('Boolean operation must be union, subtract, or intersect');
    if(!['exact','fast'].includes(precision))throw Error('Unknown Boolean precision');
    if(precision==='exact'){
        for(const m of [a,b]){validateMesh(m);if(validate&&m.faces.length){const t=topology(m,0);if(t.boundary||t.nonManifold||t.inconsistent||t.degenerate)throw Error('Boolean requires closed, consistently oriented manifold operands');if(signedVolume(m)<=0)throw Error('Boolean operands must have outward-facing winding and positive volume');}}
        return exactBoolean(a,b,operation,limits);
    }
    const ba=bounds(a),bb=bounds(b),size=Math.max(...ba.max.map((v,i)=>v-ba.min[i]),...bb.max.map((v,i)=>v-bb.min[i]),1);const eps=tolerance??size*1e-7;
    if(!Number.isFinite(eps)||eps<=0)throw Error('Invalid boolean tolerance');
    if(a.faces.length+b.faces.length>50000)throw Error('Boolean operand budget is 50,000 polygons');
    for(const m of [a,b]){validateMesh(m);if(validate){const t=topology(m,eps);if(t.boundary||t.nonManifold||t.inconsistent||t.degenerate)throw Error('Boolean requires closed, consistently oriented manifold operands');if(signedVolume(m)<=eps**3)throw Error('Boolean operands must have outward-facing winding and positive volume');}}
    if(!a.faces.length||!b.faces.length)return structuredClone(operation==='intersect'?{positions:[],uvs:[],faces:[]}:operation==='subtract'?a:a.faces.length?a:b);
    const A=new BSP(inputPolygons(a,0),eps),B=new BSP(inputPolygons(b,1),eps);
    if(operation==='union'){A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.all());}
    if(operation==='subtract'){A.invert();A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.all());A.invert();}
    if(operation==='intersect'){A.invert();B.clipTo(A);B.invert();A.clipTo(B);B.clipTo(A);A.build(B.all());A.invert();}
    const out={positions:[],uvs:[],faces:[],smooth:false,faceMaterials:[]};
    for(const p of A.all()){const face=[];for(const v of p.vertices){face.push(out.positions.length/3);out.positions.push(...v.p);out.uvs.push(...v.uv);}out.faces.push(face);out.faceMaterials.push(p.tag);}
    stitchTJunctions(out,eps*4);return validateMesh(out);
}
