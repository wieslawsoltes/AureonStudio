/** Rational BSP CSG: exact plane signs, intersections and T-junction stitching.
 * Only the final public mesh coordinates are rounded back to binary64. The input
 * polygon tessellator is shared with the editor; this is not a CAD B-rep kernel.
 */
import {Rational as Q,rationalPoint as point,exactSub as sub,exactCross as cross,exactDot as dot,exactLerp as lerp,exactKey as key} from './exact.js';
import {triangulate,vertex,validateMesh} from './mesh.js';
class Polygon {
    constructor(vertices, material=0) {
        this.vertices = vertices; this.material = material;
        let n;
        for (let i=1;i<vertices.length-1;i++) { n=cross(sub(vertices[i].p,vertices[0].p),sub(vertices[i+1].p,vertices[0].p)); if (n.some(x=>x.sign())) break; }
        this.normal=n; this.valid=n?.some(x=>x.sign()); this.w=this.valid?dot(n,vertices[0].p):Q.from(0);
    }
    flip(){ this.vertices.reverse();this.normal=this.normal.map(x=>x.neg());this.w=this.w.neg(); }
}
class Node {
    constructor(polygons=[],depth=0,budget) { this.polygons=[];this.depth=depth;this.budget=budget;this.build(polygons); }
    split(p,cf,cb,front,back) {
        if (++this.budget.splits > this.budget.maxSplits) throw Error('Exact CSG operation budget exceeded');
        const distances=p.vertices.map(v=>dot(this.normal,v.p).sub(this.w));
        const signs=distances.map(d=>d.sign()), hasFront=signs.includes(1),hasBack=signs.includes(-1);
        if (!hasFront&&!hasBack) { (dot(this.normal,p.normal).sign()>0?cf:cb).push(p);return; }
        if (!hasBack) {front.push(p);return;} if (!hasFront) {back.push(p);return;}
        const f=[],b=[];
        for(let i=0;i<p.vertices.length;i++) {
            const j=(i+1)%p.vertices.length,a=p.vertices[i],z=p.vertices[j];
            if(signs[i]>=0)f.push(a);if(signs[i]<=0)b.push(a);
            if(signs[i]*signs[j]<0) {const t=distances[i].div(distances[i].sub(distances[j]));const v={p:lerp(a.p,z.p,t),uv:lerp(a.uv,z.uv,t)};f.push(v);b.push(v);}
        }
        for(const [vs,target] of [[f,front],[b,back]]){const p2=new Polygon(vs,p.material);if(p2.valid)target.push(p2);}
    }
    build(ps) {
        if(!ps.length)return;if(this.depth>512)throw Error('Exact CSG BSP depth limit exceeded');
        if(!this.normal){const p=ps[Math.floor(ps.length/2)];this.normal=p.normal;this.w=p.w;}
        const f=[],b=[];for(const p of ps)this.split(p,this.polygons,this.polygons,f,b);
        if(f.length){this.front ||=new Node([],this.depth+1,this.budget);this.front.build(f);}
        if(b.length){this.back ||=new Node([],this.depth+1,this.budget);this.back.build(b);}
    }
    invert(){for(const p of this.polygons)p.flip();if(this.normal){this.normal=this.normal.map(x=>x.neg());this.w=this.w.neg();}this.front?.invert();this.back?.invert();[this.front,this.back]=[this.back,this.front];}
    clip(ps){if(!this.normal)return ps.slice();let f=[],b=[];for(const p of ps)this.split(p,f,b,f,b);if(this.front)f=this.front.clip(f);b=this.back?this.back.clip(b):[];return f.concat(b);}
    clipTo(b){this.polygons=b.clip(this.polygons);this.front?.clipTo(b);this.back?.clipTo(b);}
    all(){return this.polygons.concat(this.front?.all()||[],this.back?.all()||[]);}
}
function polygons(mesh,material){const vs=Array.from({length:mesh.positions.length/3},(_,i)=>({p:point(vertex(mesh,i)),uv:point(mesh.uvs?.slice(i*2,i*2+2)||[0,0])}));return triangulate(mesh).map(t=>new Polygon(t.ids.map(i=>vs[i]),material)).filter(p=>p.valid);}
export function exactBoolean(a,b,operation='union',{maxSplits=1000000,maxVertices=12000}={}) {
    if(!['union','subtract','intersect'].includes(operation))throw Error('Unknown boolean operation');
    validateMesh(a);validateMesh(b);
    if(!a.faces.length||!b.faces.length)return structuredClone(operation==='intersect'?{positions:[],uvs:[],faces:[]}:operation==='subtract'?a:a.faces.length?a:b);
    const budget={splits:0,maxSplits},A=new Node(polygons(a,0),0,budget),B=new Node(polygons(b,1),0,budget);
    if(operation==='union'){A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.all());}
    if(operation==='subtract'){A.invert();A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.all());A.invert();}
    if(operation==='intersect'){A.invert();B.clipTo(A);B.invert();A.clipTo(B);B.clipTo(A);A.build(B.all());A.invert();}
    const ps=A.all(),points=new Map();for(const p of ps)for(const v of p.vertices)points.set(key(v.p),v.p);
    if(points.size>maxVertices)throw Error('Exact CSG stitching vertex budget exceeded');
    const out={positions:[],uvs:[],faces:[],faceMaterials:[],smooth:false},welded=new Map();
    const append=v=>{const k=key(v.p)+';'+key(v.uv);if(welded.has(k))return welded.get(k);const id=out.positions.length/3;welded.set(k,id);out.positions.push(...v.p.map(x=>x.number()));out.uvs.push(...v.uv.map(x=>x.number()));return id;};
    for(const p of ps){const face=[];for(let i=0;i<p.vertices.length;i++){
        const a=p.vertices[i],b=p.vertices[(i+1)%p.vertices.length],d=sub(b.p,a.p),axis=d.findIndex(x=>x.sign());if(axis<0)continue;
        face.push(append(a));const cuts=[];
        for(const q of points.values()) {const offset=sub(q,a.p);if(cross(offset,d).some(x=>x.sign()))continue;const t=offset[axis].div(d[axis]);if(t.sign()>0&&t.compare(1)<0)cuts.push({t,p:q});}
        cuts.sort((a,b)=>a.t.compare(b.t));for(const c of cuts)face.push(append({p:c.p,uv:lerp(a.uv,b.uv,c.t)}));
    }if(face.length>=3){out.faces.push(face);out.faceMaterials.push(p.material);}}
    out.precision={classification:'exact-rational',construction:'exact-rational',output:'binary64',splitTests:budget.splits};
    return validateMesh(out);
}
