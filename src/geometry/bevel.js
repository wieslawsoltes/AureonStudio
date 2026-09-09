/** Constant-distance, single-segment edge chamfer with mitered vertex caps.
 * Closed, convex polygonal solids only; invalid widths/concavity are rejected.
 */
import {vertex,faceNormal,validateMesh,planarUV} from './mesh.js';
import {topology,signedVolume} from './boolean.js';
import {add,sub,mul,dot,cross,normalize} from '../core/math.js';
export function bevelMesh(mesh,width=.05){
    if(!Number.isFinite(width)||width<=0)throw Error('Bevel width must be positive');
    const t=topology(mesh);if(t.boundary||t.nonManifold||t.inconsistent||signedVolume(mesh)<=0)throw Error('Bevel requires a closed, outward-facing manifold');
    // Canonicalize UV-split vertices for adjacency; output gets fresh UVs.
    const verts=[],canonical=new Map(),remap=mesh.positions.reduce((ids,_,i)=>{if(i%3)return ids;const p=mesh.positions.slice(i,i+3),key=p.map(v=>Math.round(v*1e7)).join(',');if(!canonical.has(key)){canonical.set(key,verts.length);verts.push(p);}ids.push(canonical.get(key));return ids;},[]);
    const faces=mesh.faces.map(f=>f.map(i=>remap[i])),m={positions:verts.flat(),faces};const ns=faces.map(f=>faceNormal(m,f));
    for(let f=0;f<faces.length;f++){const n=ns[f],w=dot(n,verts[faces[f][0]]);if(verts.some(p=>dot(n,p)-w>1e-6))throw Error('This bevel supports convex solids; split concave solids before beveling');}
    const out={positions:[],faces:[],uvs:[],smooth:false},corners=new Map(),edges=new Map(),rings=verts.map(()=>[]);
    for(let fi=0;fi<faces.length;fi++){const f=faces[fi],n=ns[fi],of=[];for(let j=0;j<f.length;j++){const prev=verts[f[(j+f.length-1)%f.length]],p=verts[f[j]],next=verts[f[(j+1)%f.length]],e0=normalize(sub(p,prev)),e1=normalize(sub(next,p)),n0=cross(n,e0),n1=cross(n,e1),den=1+dot(n0,n1);if(den<1e-6)throw Error('Degenerate bevel corner');const shift=mul(add(n0,n1),width/den);if(Math.hypot(...shift)>.45*Math.min(Math.hypot(...sub(p,prev)),Math.hypot(...sub(next,p))))throw Error('Bevel width would overlap adjacent corners');const q=add(p,shift),id=out.positions.length/3;out.positions.push(...q);of.push(id);corners.set(`${fi}:${f[j]}`,id);rings[f[j]].push({id,n});const a=f[j],b=f[(j+1)%f.length],key=a<b?`${a}:${b}`:`${b}:${a}`;const es=edges.get(key)||[];es.push({fi,a,b});edges.set(key,es);}out.faces.push(of);}
    for(const es of edges.values()){if(es.length!==2)throw Error('Invalid edge adjacency');const [a,b]=es;if(dot(ns[a.fi],ns[b.fi])>.999999)throw Error('Remove coplanar triangulation edges before beveling');out.faces.push([corners.get(`${a.fi}:${a.b}`),corners.get(`${a.fi}:${a.a}`),corners.get(`${b.fi}:${a.a}`),corners.get(`${b.fi}:${a.b}`)]);}
    for(let i=0;i<rings.length;i++){const ring=rings[i],n=normalize(ring.reduce((a,r)=>add(a,r.n),[0,0,0])),center=mul(ring.reduce((a,r)=>add(a,vertex(out,r.id)),[0,0,0]),1/ring.length),u=normalize(sub(vertex(out,ring[0].id),center)),v=cross(n,u);ring.sort((a,b)=>Math.atan2(dot(sub(vertex(out,a.id),center),v),dot(sub(vertex(out,a.id),center),u))-Math.atan2(dot(sub(vertex(out,b.id),center),v),dot(sub(vertex(out,b.id),center),u)));out.faces.push(ring.map(r=>r.id));}
    return validateMesh(planarUV(out));
}
