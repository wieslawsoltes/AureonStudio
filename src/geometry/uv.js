/** Seam-aware chart extraction, least-squares conformal mapping, relaxation,
 * deterministic shelf packing, chart transforms and position-based UV stitching.
 */
import {cloneMesh,vertex,faceNormal,triangulateFace} from './mesh.js';
import {dot,sub,cross,normalize} from '../core/math.js';
export const edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
export function meshEdges(m){const map=new Map();m.faces.forEach((f,fi)=>f.forEach((a,j)=>{const b=f[(j+1)%f.length],key=edgeKey(a,b);if(!map.has(key))map.set(key,{a,b,faces:[]});map.get(key).faces.push(fi);}));return map;}
export function autoSeams(m,angle=55){
    const ns=m.faces.map(f=>faceNormal(m,f)),cos=Math.cos(angle*Math.PI/180),edges=[...meshEdges(m).entries()],cut=new Set();
    const parent=m.faces.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
    // Retain a smooth dual spanning forest. Cutting non-tree edges opens closed
    // surfaces and annular charts without depending on storage-order UV seams.
    edges.sort((a,b)=>{const score=e=>e.faces.length===2?dot(ns[e.faces[0]],ns[e.faces[1]]):-2;return score(b[1])-score(a[1]);});
    for(const [key,e]of edges){if(e.faces.length!==2||dot(ns[e.faces[0]],ns[e.faces[1]])<cos){cut.add(key);continue;}const a=find(e.faces[0]),b=find(e.faces[1]);if(a===b)cut.add(key);else parent[a]=b;}
    return [...cut];
}
export function faceCharts(m,seams=[]){const cut=new Set(seams),adj=m.faces.map(()=>[]);for(const [k,e] of meshEdges(m)){if(e.faces.length===2&&!cut.has(k)){adj[e.faces[0]].push(e.faces[1]);adj[e.faces[1]].push(e.faces[0]);}}const seen=new Set(),charts=[];for(let i=0;i<m.faces.length;i++){if(seen.has(i))continue;const chart=[],stack=[i];seen.add(i);while(stack.length){const f=stack.pop();chart.push(f);for(const j of adj[f])if(!seen.has(j)){seen.add(j);stack.push(j);}}charts.push(chart);}return charts;}
export function splitCharts(input,seams=autoSeams(input)){
    const charts=faceCharts(input,seams),cut=new Set(seams),out={positions:[],uvs:[],faces:[],smooth:input.smooth!==false,uvCharts:charts},sourceVertices=[],parents=[],corners=[];
    // A vertex must split into local corner sectors, not just face components:
    // a cylinder's longitudinal seam has both sides in the SAME connected chart.
    for(const face of input.faces){const map=new Map();for(const v of face){const id=parents.length;parents.push(id);map.set(v,id);}corners.push(map);}
    const find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
    for(const [key,e]of meshEdges(input))if(e.faces.length===2&&!cut.has(key))for(const v of [e.a,e.b]){const a=find(corners[e.faces[0]].get(v)),b=find(corners[e.faces[1]].get(v));parents[a]=b;}
    const map=new Map();input.faces.forEach((face,fi)=>out.faces.push(face.map(v=>{const root=find(corners[fi].get(v));if(!map.has(root)){const id=sourceVertices.length;map.set(root,id);sourceVertices.push(v);out.positions.push(...vertex(input,v));out.uvs.push(...(input.uvs?.length?input.uvs.slice(v*2,v*2+2):[0,0]));}return map.get(root);}))); 
    if(input.faceMaterials)out.faceMaterials=[...input.faceMaterials];if(input.flatFaces)out.flatFaces=[...input.flatFaces];
    if(input.vertexNormals)out.vertexNormals=sourceVertices.flatMap(v=>input.vertexNormals.slice(v*3,v*3+3));
    out.sourceVertices=sourceVertices;return out;
}
function cg(rows,b,n,tolerance=1e-9,maxIterations=2000){const multiply=x=>{const y=new Float64Array(n);for(const row of rows){let s=0;for(const [j,a] of row)s+=a*x[j];for(const [j,a] of row)y[j]+=a*s;}for(let i=0;i<n;i++)y[i]+=1e-12*x[i];return y;};let x=new Float64Array(n),r=Float64Array.from(b),p=Float64Array.from(r),rr=r.reduce((s,v)=>s+v*v,0),initial=rr;for(let it=0;it<maxIterations&&rr>tolerance*tolerance*Math.max(initial,1);it++){const ap=multiply(p),den=p.reduce((s,v,i)=>s+v*ap[i],0);if(Math.abs(den)<1e-30)break;const alpha=rr/den;for(let i=0;i<n;i++){x[i]+=alpha*p[i];r[i]-=alpha*ap[i];}const next=r.reduce((s,v)=>s+v*v,0),beta=next/rr;for(let i=0;i<n;i++)p[i]=r[i]+beta*p[i];rr=next;}return x;}
export function conformalUnwrap(input,{seams=autoSeams(input),pins={},pack=true,padding=.025}={}){
    let out=splitCharts(input,seams);
    for(const fs of out.uvCharts){const ids=[...new Set(fs.flatMap(fi=>out.faces[fi]))],idSet=new Set(ids),edges=meshEdges({faces:fs.map(fi=>out.faces[fi])}),boundary=[...new Set([...edges.values()].filter(e=>e.faces.length===1).flatMap(e=>[e.a,e.b]))];
        if(boundary.length<2)throw Error('UV chart is closed. Add seams before conformal unwrapping.');
        const a=boundary[0],b=boundary.reduce((best,i)=>Math.hypot(...sub(vertex(out,i),vertex(out,a)))>Math.hypot(...sub(vertex(out,best),vertex(out,a)))?i:best,a),distance=Math.hypot(...sub(vertex(out,a),vertex(out,b)));
        const pinned=new Map();for(const i of ids){const key=out.sourceVertices[i];if(pins[key])pinned.set(i,pins[key]);}if(!pinned.size){pinned.set(a,[0,0]);pinned.set(b,[distance,0]);}else if(pinned.size===1){const [anchor,uv]=[...pinned][0],other=boundary.reduce((best,i)=>Math.hypot(...sub(vertex(out,i),vertex(out,anchor)))>Math.hypot(...sub(vertex(out,best),vertex(out,anchor)))?i:best,anchor);pinned.set(other,[uv[0]+Math.hypot(...sub(vertex(out,other),vertex(out,anchor))),uv[1]]);}
        const unknown=new Map();for(const i of ids)if(!pinned.has(i)){unknown.set(i*2,unknown.size);unknown.set(i*2+1,unknown.size);}const rows=[],rhs=[];
        for(const fi of fs)for(const tri of triangulateFace(out,out.faces[fi])){const ps=tri.map(i=>vertex(out,i)),e1=sub(ps[1],ps[0]),e2=sub(ps[2],ps[0]),x1=Math.hypot(...e1),x2=dot(e2,normalize(e1)),y2=Math.hypot(...cross(e1,e2))/x1,area=x1*y2;if(area<1e-14)continue;const grads=[[-y2,x2-x1],[y2,-x2],[0,x1]],scale=1/Math.sqrt(area);
            for(let eq=0;eq<2;eq++){const row=[];let target=0;tri.forEach((id,k)=>{const g=grads[k],coeff=eq===0?[g[0],-g[1]]:[g[1],g[0]];for(let axis=0;axis<2;axis++){const value=coeff[axis]*scale;if(pinned.has(id))target-=value*pinned.get(id)[axis];else row.push([unknown.get(id*2+axis),value]);}});rows.push(row);rhs.push(target);}}
        const B=new Float64Array(unknown.size);rows.forEach((r,i)=>r.forEach(([j,a])=>B[j]+=a*rhs[i]));const x=cg(rows,B,unknown.size);for(const i of ids)for(let axis=0;axis<2;axis++)out.uvs[i*2+axis]=pinned.has(i)?pinned.get(i)[axis]:x[unknown.get(i*2+axis)];
    }
    delete out.sourceVertices;return pack?packIslands(out,padding):out;
}
export function uvIslands(m){return m.uvCharts||faceCharts(m,[]);}
export function packIslands(input,padding=.025){if(padding<0||padding>=.25)throw Error('UV padding must be in [0, .25)');const m=cloneMesh(input);m.uvCharts=structuredClone(uvIslands(input));if(!m.faces.length)return m;const boxes=m.uvCharts.map((fs,index)=>{const ids=[...new Set(fs.flatMap(fi=>m.faces[fi]))],xs=ids.map(i=>m.uvs[i*2]),ys=ids.map(i=>m.uvs[i*2+1]),min=[Math.min(...xs),Math.min(...ys)],w=Math.max(1e-6,Math.max(...xs)-min[0]),h=Math.max(1e-6,Math.max(...ys)-min[1]);return {ids,index,min,w,h};}).sort((a,b)=>b.h-a.h||a.index-b.index);let total=boxes.reduce((s,b)=>s+b.w*b.h,0),target=Math.max(Math.sqrt(total),...boxes.map(b=>b.w));const fits=scale=>{let x=padding,y=padding,row=0;for(const b of boxes){const w=b.w*scale,h=b.h*scale;if(x+w+padding>1){x=padding;y+=row+padding;row=0;}if(y+h+padding>1)return false;b.offset=[x,y];x+=w+padding;row=Math.max(row,h);}return true;};let lo=0,hi=1/Math.max(target,1e-6);for(let i=0;i<45;i++){const mid=(lo+hi)/2;fits(mid)?lo=mid:hi=mid;}fits(lo);for(const b of boxes)for(const i of b.ids){m.uvs[i*2]=(m.uvs[i*2]-b.min[0])*lo+b.offset[0];m.uvs[i*2+1]=(m.uvs[i*2+1]-b.min[1])*lo+b.offset[1];}return m;}
export function relaxUV(input,{iterations=40,strength=.4,pins=[]}={}){const m=cloneMesh(input);m.uvCharts=structuredClone(uvIslands(input));const edges=meshEdges(m),fixed=new Set(pins),adj=Array.from({length:m.positions.length/3},()=>new Set());for(const e of edges.values()){adj[e.a].add(e.b);adj[e.b].add(e.a);if(e.faces.length===1){fixed.add(e.a);fixed.add(e.b);}}for(let it=0;it<iterations;it++){const next=[...m.uvs];for(let i=0;i<adj.length;i++)if(!fixed.has(i)&&adj[i].size){for(let k=0;k<2;k++){let sum=0,weight=0;for(const j of adj[i]){const w=1/Math.max(1e-8,Math.hypot(...sub(vertex(m,i),vertex(m,j))));sum+=m.uvs[j*2+k]*w;weight+=w;}next[i*2+k]+=(sum/weight-next[i*2+k])*strength;}}m.uvs=next;}return m;}
export function transformIsland(input,index,{translation=[0,0],scale=[1,1],rotation=0}={}){const m=cloneMesh(input);m.uvCharts=structuredClone(uvIslands(input));const fs=m.uvCharts[index];if(!fs)throw Error('Unknown UV island');const ids=[...new Set(fs.flatMap(fi=>m.faces[fi]))],center=ids.reduce((a,i)=>[a[0]+m.uvs[i*2]/ids.length,a[1]+m.uvs[i*2+1]/ids.length],[0,0]),r=rotation*Math.PI/180;for(const i of ids){const u=(m.uvs[i*2]-center[0])*scale[0],v=(m.uvs[i*2+1]-center[1])*scale[1];m.uvs[i*2]=u*Math.cos(r)-v*Math.sin(r)+center[0]+translation[0];m.uvs[i*2+1]=u*Math.sin(r)+v*Math.cos(r)+center[1]+translation[1];}return m;}
export function stitchUV(input,vertices,tolerance=1e-6){const m=cloneMesh(input),groups=new Map();for(const i of vertices){const key=vertex(m,i).map(v=>Math.round(v/tolerance)).join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}for(const ids of groups.values()){const uv=ids.reduce((a,i)=>[a[0]+m.uvs[i*2]/ids.length,a[1]+m.uvs[i*2+1]/ids.length],[0,0]);for(const i of ids)m.uvs.splice(i*2,2,...uv);}return m;}
