/** Triangle BVH contacts and swept spheres for arbitrary static triangle meshes.
 * Cloth uses mass-weighted vertex/triangle and edge/edge exclusion constraints.
 * Collision triangles are geometric, not rendered depth-buffer approximations.
 */
import {add,sub,mul,dot,cross,normalize,clamp} from '../core/math.js';
import {triangulate,vertex,validateMesh} from '../geometry/mesh.js';
export function closestSegment(p,a,b){const d=sub(b,a),t=clamp(dot(sub(p,a),d)/Math.max(dot(d,d),1e-30),0,1);return {point:add(a,mul(d,t)),t};}
export function closestTriangle(p,a,b,c){
    const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
    if(Math.hypot(...cross(ab,ac))<1e-14){const choices=[[a,b,[0,1]],[b,c,[1,2]],[c,a,[2,0]]].map(([x,y,ids])=>{const q=closestSegment(p,x,y),weights=[0,0,0];weights[ids[0]]=1-q.t;weights[ids[1]]=q.t;return {...q,weights};});return choices.sort((x,y)=>dot(sub(x.point,p),sub(x.point,p))-dot(sub(y.point,p),sub(y.point,p)))[0];}
    if(d1<=0&&d2<=0)return {point:a,weights:[1,0,0]};const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return {point:b,weights:[0,1,0]};const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);return {point:add(a,mul(ab,v)),weights:[1-v,v,0]};}
    const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return {point:c,weights:[0,0,1]};const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);return {point:add(a,mul(ac,w)),weights:[1-w,0,w]};}const va=d3*d6-d5*d4;if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));return {point:add(b,mul(sub(c,b),w)),weights:[0,1-w,w]};}
    const inv=1/(va+vb+vc),v=vb*inv,w=vc*inv;return {point:add(a,add(mul(ab,v),mul(ac,w))),weights:[1-v-w,v,w]};
}
export function closestSegments(a,b,c,d){const u=sub(b,a),v=sub(d,c),w=sub(a,c),A=dot(u,u),B=dot(u,v),C=dot(v,v),D=dot(u,w),E=dot(v,w),den=A*C-B*B;let s=A>1e-20?clamp((den>1e-20?(B*E-C*D)/den:0),0,1):0,t=C>1e-20?(B*s+E)/C:0;if(t<0){t=0;s=A?clamp(-D/A,0,1):0;}else if(t>1){t=1;s=A?clamp((B-D)/A,0,1):0;}return {a:add(a,mul(u,s)),b:add(c,mul(v,t)),s,t};}
const overlap=(a,b)=>a.min.every((x,i)=>x<=b.max[i]&&a.max[i]>=b.min[i]);
const boxOf=points=>({min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))});
const pad=(b,r)=>({min:b.min.map(x=>x-r),max:b.max.map(x=>x+r)});
export class TriangleBVH {
    constructor(mesh){validateMesh(mesh);this.positions=mesh.positions;this.triangles=triangulate(mesh).map(t=>t.ids);this.nodes=[];this.root=this.build(this.triangles.map((_,i)=>i));}
    box(id){return boxOf(this.triangles[id].map(i=>vertex(this,i)));}
    build(ids){if(!ids.length)return -1;const boxes=ids.map(i=>this.box(i)),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};for(const b of boxes)for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],b.min[k]);bounds.max[k]=Math.max(bounds.max[k],b.max[k]);}const node={...bounds,ids:null,left:-1,right:-1},index=this.nodes.push(node)-1;if(ids.length<=8)node.ids=ids;else{const axis=bounds.max.map((v,i)=>v-bounds.min[i]).reduce((a,v,i,arr)=>v>arr[a]?i:a,0);ids.sort((a,b)=>{const A=this.box(a),B=this.box(b);return A.min[axis]+A.max[axis]-B.min[axis]-B.max[axis];});const split=Math.floor(ids.length/2);node.left=this.build(ids.slice(0,split));node.right=this.build(ids.slice(split));}return index;}
    refit(positions=this.positions){this.positions=positions;for(let i=this.nodes.length-1;i>=0;i--){const n=this.nodes[i],boxes=n.ids?n.ids.map(id=>this.box(id)):[this.nodes[n.left],this.nodes[n.right]];for(let k=0;k<3;k++){n.min[k]=Math.min(...boxes.map(b=>b.min[k]));n.max[k]=Math.max(...boxes.map(b=>b.max[k]));}}return this;}
    query(box){const hits=[],stack=this.root<0?[]:[this.root];while(stack.length){const n=this.nodes[stack.pop()];if(!overlap(n,box))continue;if(n.ids){for(const id of n.ids)if(overlap(this.box(id),box))hits.push(id);}else{stack.push(n.left,n.right);}}return hits;}
    contacts(center,radius){if(!Number.isFinite(radius)||radius<=0)throw Error('Invalid collision radius');const hits=[];for(const id of this.query(pad({min:center,max:center},radius))){const ids=this.triangles[id],points=ids.map(i=>vertex(this,i)),q=closestTriangle(center,...points),delta=sub(center,q.point),distance=Math.hypot(...delta);if(distance<radius){const normal=distance>1e-10?mul(delta,1/distance):normalize(cross(sub(points[1],points[0]),sub(points[2],points[0])));hits.push({triangle:id,ids,...q,normal,depth:radius-distance});}}return hits;}
    sweep(from,to,radius){
        const motion=sub(to,from),speed2=dot(motion,motion);if(speed2<1e-24)return null;let hit=null;
        const accept=(t,normal,triangle)=>{if(t>=0&&t<=1&&(!hit||t<hit.t)&&dot(motion,normal)<0)hit={t,point:add(from,mul(motion,t)),normal,triangle};};
        const root=(a,b,c)=>{const disc=b*b-a*c;return a>1e-24&&disc>=0?(-b-Math.sqrt(disc))/a:-1;};
        for(const id of this.query(pad(boxOf([from,to]),radius))){const points=this.triangles[id].map(i=>vertex(this,i)),normal=normalize(cross(sub(points[1],points[0]),sub(points[2],points[0]))),d0=dot(sub(from,points[0]),normal),den=dot(motion,normal);
            if(Math.abs(den)>1e-14)for(const sign of [-1,1]){const t=(sign*radius-d0)/den;if(t<0||t>1)continue;const center=add(from,mul(motion,t)),contact=sub(center,mul(normal,sign*radius)),q=closestTriangle(contact,...points);if(Math.hypot(...sub(q.point,contact))<1e-7)accept(t,mul(normal,sign),id);}
            for(let i=0;i<3;i++){const a=points[i],b=points[(i+1)%3],w=sub(from,a),edge=sub(b,a),len2=dot(edge,edge),wv=dot(w,motion),we=dot(w,edge),me=dot(motion,edge);
                const tv=root(speed2,wv,dot(w,w)-radius*radius);if(tv>=0)accept(tv,normalize(sub(add(from,mul(motion,tv)),a)),id);
                if(len2>1e-24){const t=root(speed2-me*me/len2,wv-we*me/len2,dot(w,w)-we*we/len2-radius*radius),u=(we+t*me)/len2;if(t>=0&&u>=0&&u<=1)accept(t,normalize(sub(add(from,mul(motion,t)),add(a,mul(edge,u)))),id);}
            }
        }return hit;
    }
}
export class TriangleCollider {
    constructor(mesh,{friction=.3,restitution=0}={}){this.bvh=new TriangleBVH(mesh);this.friction=friction;this.restitution=restitution;}
    project(from,to,radius){let position=[...to];const hit=this.bvh.sweep(from,to,radius);if(hit){const remain=mul(sub(to,from),1-hit.t),tangent=sub(remain,mul(hit.normal,Math.min(0,dot(remain,hit.normal))));position=add(add(hit.point,mul(hit.normal,1e-7)),mul(tangent,1-this.friction));}
        for(let i=0;i<3;i++){const contacts=this.bvh.contacts(position,radius);if(!contacts.length)break;for(const c of contacts)position=add(position,mul(c.normal,c.depth+1e-8));}return position;}
}
export class ClothSelfCollision {
    constructor(mesh,{thickness=.02,edgeEdge=true}={}){if(!Number.isFinite(thickness)||thickness<=0)throw Error('Invalid cloth thickness');this.thickness=thickness;this.bvh=new TriangleBVH(mesh);this.edgeEdge=edgeEdge;this.neighbors=Array.from({length:mesh.positions.length/3},(_,i)=>new Set([i]));const edges=new Map();for(const ids of this.bvh.triangles)for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3];this.neighbors[a].add(b);this.neighbors[b].add(a);edges.set(a<b?`${a}:${b}`:`${b}:${a}`,[a,b]);}this.edges=[...edges.values()];}
    solve(positions,inverseMass,previous=positions){
        const h=this.thickness;this.bvh.refit(positions);let contacts=0;
        for(let i=0;i<inverseMass.length;i++){const p=Array.from(positions.slice(i*3,i*3+3)),old=Array.from(previous.slice(i*3,i*3+3));for(const id of this.bvh.query(pad(boxOf([p,old]),h))){const ids=this.bvh.triangles[id];if(ids.some(j=>this.neighbors[i].has(j)))continue;const ps=ids.map(j=>Array.from(positions.slice(j*3,j*3+3))),q=closestTriangle(p,...ps),d=sub(p,q.point),distance=Math.hypot(...d);let normal=distance>1e-10?mul(d,1/distance):normalize(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]))),depth=h-distance;
            // A crossing gets pushed to its previous side, not deeper through a fold.
            const faceNormal=normalize(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]))),side=dot(sub(old,ps[0]),faceNormal),now=dot(sub(p,ps[0]),faceNormal);if(side*now<0&&q.weights.every(w=>w>1e-7)){normal=mul(faceNormal,Math.sign(side));depth=h+Math.abs(now);}
            if(depth<=0)continue;const weights=q.weights,den=inverseMass[i]+ids.reduce((s,j,k)=>s+inverseMass[j]*weights[k]**2,0);if(!den)continue;const lambda=depth/den;for(let k=0;k<3;k++){positions[i*3+k]+=normal[k]*lambda*inverseMass[i];for(let j=0;j<3;j++)positions[ids[j]*3+k]-=normal[k]*lambda*inverseMass[ids[j]]*weights[j];}contacts++;
        }}
        if(this.edgeEdge){const boxes=this.edges.map(ids=>pad(boxOf(ids.map(i=>Array.from(positions.slice(i*3,i*3+3)))),h));const order=this.edges.map((_,i)=>i).sort((a,b)=>boxes[a].min[0]-boxes[b].min[0]);for(let oi=0;oi<order.length;oi++){const i=order[oi],a=this.edges[i];for(let oj=oi+1;oj<order.length&&boxes[order[oj]].min[0]<=boxes[i].max[0];oj++){const j=order[oj],b=this.edges[j];if(a.some(x=>b.some(y=>this.neighbors[x].has(y)))||!overlap(boxes[i],boxes[j]))continue;const ps=[...a,...b].map(id=>Array.from(positions.slice(id*3,id*3+3))),q=closestSegments(...ps),d=sub(q.a,q.b),distance=Math.hypot(...d);if(distance>=h)continue;let n=distance>1e-10?mul(d,1/distance):normalize(cross(sub(ps[1],ps[0]),sub(ps[3],ps[2])));if(Math.hypot(...n)<.5)n=[0,1,0];const ids=[...a,...b],w=[1-q.s,q.s,-(1-q.t),-q.t],den=ids.reduce((s,id,k)=>s+inverseMass[id]*w[k]**2,0);if(!den)continue;const lambda=(h-distance)/den;for(let v=0;v<4;v++)for(let k=0;k<3;k++)positions[ids[v]*3+k]+=lambda*w[v]*inverseMass[ids[v]]*n[k];contacts++;}}}
        return contacts;
    }
}
