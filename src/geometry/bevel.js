/** Topological polygon bevel with segmented quadratic edge profiles.
 * Convex and reflex manifold edges, selected-edge weights, coplanar dissolve,
 * corner caps, material slots and fail-fast local overlap checks. Not an implicit
 * remesher: self-intersecting offsets are rejected rather than silently repaired.
 */
import {vertex,faceNormal,validateMesh,planarUV,triangulate} from './mesh.js';
import {topology,signedVolume} from './boolean.js';
import {add,sub,mul,dot,cross,normalize,lerp} from '../core/math.js';
const edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
function adjacency(faces){const edges=new Map();faces.forEach((f,fi)=>f.forEach((a,j)=>{const b=f[(j+1)%f.length],key=edgeKey(a,b);if(!edges.has(key))edges.set(key,[]);edges.get(key).push({fi,a,b});}));return edges;}
function canonicalize(mesh){const points=[],map=new Map(),ids=[];for(let i=0;i<mesh.positions.length/3;i++){const p=vertex(mesh,i),key=p.join(',');if(!map.has(key)){map.set(key,points.length);points.push(p);}ids.push(map.get(key));}return {positions:points.flat(),faces:mesh.faces.map(f=>f.map(i=>ids[i])),faceMaterials:mesh.faceMaterials?.slice()||mesh.faces.map(()=>0)};}
function dissolveCoplanar(mesh){
    // Dissolve only unambiguous, same-material neighboring polygons. Iterating
    // topology instead of angular sorting works at reflex corners as well.
    let changed=true;
    while(changed){changed=false;const ns=mesh.faces.map(f=>faceNormal(mesh,f));for(const es of adjacency(mesh.faces).values()){
        if(es.length!==2)continue;const [a,b]=es;if(mesh.faceMaterials[a.fi]!==mesh.faceMaterials[b.fi]||dot(ns[a.fi],ns[b.fi])<1-1e-10)continue;
        const f=mesh.faces[a.fi],g=mesh.faces[b.fi],i=f.indexOf(a.a),j=g.indexOf(a.b);
        const merged=[];for(let k=1;k<f.length;k++)merged.push(f[(i+k)%f.length]);for(let k=1;k<g.length;k++)merged.push(g[(j+k)%g.length]);
        if(new Set(merged).size!==merged.length)continue;
        mesh.faces[a.fi]=merged;mesh.faces.splice(b.fi,1);mesh.faceMaterials.splice(b.fi,1);changed=true;break;
    }}return mesh;
}
function stitch(mesh,eps){const points=Array.from({length:mesh.positions.length/3},(_,i)=>vertex(mesh,i));if(points.length>16000)throw Error('Bevel stitching budget exceeded');mesh.faces=mesh.faces.map(f=>f.flatMap((id,i)=>{const next=f[(i+1)%f.length],a=points[id],d=sub(points[next],a),len=dot(d,d);if(len<eps*eps)return [];const cuts=[];for(let j=0;j<points.length;j++){if(j===id||j===next)continue;const t=dot(sub(points[j],a),d)/len;if(t>1e-8&&t<1-1e-8&&Math.hypot(...sub(points[j],add(a,mul(d,t))))<eps)cuts.push({j,t});}cuts.sort((a,b)=>a.t-b.t);return [id,...cuts.map(c=>c.j)];}));}
export function bevelMesh(input,width=.05,{segments=1,profile=.5,edges=null,weights={},dissolve=true}={}){
    validateMesh(input);
    if(!Number.isFinite(width)||width<=0||!Number.isInteger(segments)||segments<1||segments>32||!Number.isFinite(profile)||profile<0||profile>1)throw Error('Invalid bevel width, segments or profile');
    const t=topology(input);if(t.boundary||t.nonManifold||t.inconsistent||t.degenerate||signedVolume(input)<=0)throw Error('Bevel requires a closed, outward-facing manifold');
    const m=dissolve?dissolveCoplanar(canonicalize(input)):canonicalize(input),faces=m.faces,points=Array.from({length:m.positions.length/3},(_,i)=>vertex(m,i)),ns=faces.map(f=>faceNormal(m,f)),adj=adjacency(faces);
    const selected=edges?new Set(edges.map(e=>Array.isArray(e)?edgeKey(...e):e)):null;
    if(selected)for(const e of selected)if(!adj.has(e))throw Error(`Unknown bevel edge ${e}`);
    const offsets=new Map();for(const [key,es] of adj){if(es.length!==2)throw Error('Invalid bevel adjacency');const w=weights[key]??1;if(!Number.isFinite(w)||w<0||w>1)throw Error('Bevel weights must be in [0, 1]');offsets.set(key,(!selected||selected.has(key))&&dot(ns[es[0].fi],ns[es[1].fi])<1-1e-10?width*w:0);}
    const out={positions:[],faces:[],uvs:[],smooth:true,flatFaces:[],faceMaterials:[]},corners=new Map(),caps=points.map(()=>[]),welded=new Map();
    const eps=Math.max(width*1e-8,1e-12);
    const insert=p=>{const key=p.map(v=>Math.round(v/eps)).join(',');if(welded.has(key))return welded.get(key);const id=out.positions.length/3;welded.set(key,id);out.positions.push(...p);return id;};
    const face=(ids,material,flat=false)=>{ids=ids.filter((id,i)=>id!==ids[(i+ids.length-1)%ids.length]);if(new Set(ids).size<3)return;const f=faceNormal(out,ids);if(Math.hypot(...f)<.5)return;if(flat)out.flatFaces.push(out.faces.length);out.faces.push(ids);out.faceMaterials.push(material);};
    faces.forEach((f,fi)=>{const n=ns[fi],ring=[];for(let i=0;i<f.length;i++){
        const a=f[(i+f.length-1)%f.length],v=f[i],b=f[(i+1)%f.length],p=points[v],e0=normalize(sub(p,points[a])),e1=normalize(sub(points[b],p)),n0=cross(n,e0),n1=cross(n,e1),d0=offsets.get(edgeKey(a,v)),d1=offsets.get(edgeKey(v,b)),c=dot(n0,n1),den=1-c*c;
        let shift=[0,0,0];if(den>1e-12)shift=add(mul(n0,(d0-c*d1)/den),mul(n1,(d1-c*d0)/den));else if(Math.abs(d0-d1)<eps)shift=mul(n0,d0);else throw Error('Selected bevel terminates at a degenerate straight corner');
        if(Math.hypot(...shift)>.49*Math.min(Math.hypot(...sub(p,points[a])),Math.hypot(...sub(points[b],p))))throw Error('Bevel width would overlap adjacent corners');
        const id=insert(add(p,shift));ring.push(id);corners.set(`${fi}:${v}`,id);
    }
    if(dot(faceNormal(out,ring),n)<.9)throw Error('Bevel width collapses or reverses a face');
    // The shared ear-clipping validator rejects collapsed/non-simple polygons.
    triangulate({positions:out.positions,faces:[ring]});face(ring,m.faceMaterials[fi],true);
    });
    for(const [key,[a,b]] of adj){const paths=[];for(const v of [a.a,a.b]){
        const ia=corners.get(`${a.fi}:${v}`),ib=corners.get(`${b.fi}:${v}`),A=vertex(out,ia),B=vertex(out,ib),path=[ia];
        if(offsets.get(key)>0)for(let s=1;s<segments;s++){const u=s/segments,control=lerp(mul(add(A,B),.5),points[v],profile*2);path.push(insert(add(add(mul(A,(1-u)**2),mul(control,2*u*(1-u))),mul(B,u*u))));}
        path.push(ib);paths.push(path);
    }
    const [pa,pb]=paths;
    if(offsets.get(key)>0)for(let k=0;k<pa.length-1;k++)face([pb[k],pa[k],pa[k+1],pb[k+1]],m.faceMaterials[a.fi]);
    for(let k=0;k<pa.length-1;k++){if(pa[k]!==pa[k+1])caps[a.a].push([pa[k+1],pa[k]]);if(pb[k]!==pb[k+1])caps[a.b].push([pb[k],pb[k+1]]);}
    }
    for(let vi=0;vi<caps.length;vi++){const list=caps[vi];if(!list.length)continue;const links=new Map(list);if(links.size!==list.length)throw Error('Bevel corner fan is not manifold');const ring=[],start=list[0][0];let id=start;
        do{if(ring.includes(id)||!links.has(id))throw Error('Bevel corner is not a closed fan');ring.push(id);id=links.get(id);}while(id!==start);
        if(ring.length!==list.length)throw Error('Disconnected bevel corner fan');
        // A single beveled edge can end in an otherwise untouched face. Its
        // rounded end belongs to that face boundary, not to an overlapping cap.
        const original=welded.get(points[vi].map(v=>Math.round(v/eps)).join(','));
        const at=ring.indexOf(original);
        if(at>=0){const fi=faces.findIndex((f,i)=>f.includes(vi)&&corners.get(`${i}:${vi}`)===original&&ring.every(id=>Math.abs(dot(ns[i],sub(vertex(out,id),points[vi])))<eps*4));
            if(fi>=0){const cut=out.faces[fi].indexOf(original),arc=[...ring.slice(at+1),...ring.slice(0,at)];out.faces[fi].splice(cut,1,...arc);continue;}
        }
        if(segments===1){face(ring,m.faceMaterials[0]);continue;}
        if(ring.length>=3){const center=insert(mul(ring.reduce((s,i)=>add(s,vertex(out,i)),[0,0,0]),1/ring.length));for(let k=0;k<ring.length;k++)face([ring[k],ring[(k+1)%ring.length],center],m.faceMaterials[0]);}
    }
    if(selected)stitch(out,eps*2);
    const result=validateMesh(planarUV(out)),check=topology(result,eps*4);
    if(check.boundary||check.nonManifold||check.inconsistent)throw Error('Bevel topology validation failed; reduce width or adjust selected edges');
    return result;
}
