// Surface/volume path tracing and a linked-cell GPU photon map share the same
// triangles, material graph interpreter, light CDF and BVH.
struct Node {lower:vec3f,left:u32,upper:vec3f,count:u32};
struct Light {triangle:u32,cdf:f32,pmf:f32,area:f32};
struct Photon {p:vec4f,n:vec4f,power:vec4f,incoming:vec4f,next:vec4u};
struct PhotonStore {heads:array<atomic<u32>,4096>,records:array<Photon>};
@group(0) @binding(3) var<storage,read> nodes:array<Node>;
@group(0) @binding(4) var<storage,read_write> pixels:array<vec4f>;
@group(0) @binding(5) var<storage,read> lights:array<Light>;
@group(0) @binding(6) var<storage,read_write> aovs:array<vec4f>;
@group(0) @binding(7) var<storage,read_write> photonMap:PhotonStore;
var<private> state:u32;
var<private> aovAlbedo:vec3f;
var<private> aovNormal:vec3f;
var<private> aovDepth:f32;
var<private> aovObject:f32;
var<private> aovEmission:vec3f;
var<private> aovDirect:vec3f;
fn random()->f32 {state=state*747796405u+2891336453u;let word=((state>>((state>>28u)+4u))^state)*277803737u;return f32(((word>>22u)^word)>>8u)/16777216.;}
struct Ray {o:vec3f,d:vec3f};
struct Hit {t:f32,u:f32,v:f32,triangle:u32};
fn interval(ray:Ray,lower:vec3f,upper:vec3f,limit:f32)->vec2f {var near=0.;var far=limit;for(var k=0u;k<3u;k++){if(abs(ray.d[k])<1e-12){if(ray.o[k]<lower[k]||ray.o[k]>upper[k]){return vec2f(1.,0.);}}else{let a=(lower[k]-ray.o[k])/ray.d[k];let b=(upper[k]-ray.o[k])/ray.d[k];near=max(near,min(a,b));far=min(far,max(a,b));if(near>far){return vec2f(1.,0.);}}}return vec2f(near,far);}
fn boxHit(ray:Ray,node:Node,limit:f32)->bool {let v=interval(ray,node.lower,node.upper,limit);return v.x<=v.y;}
fn triangleHit(ray:Ray,t:Triangle,limit:f32)->vec3f {let e1=t.b.xyz-t.a.xyz;let e2=t.c.xyz-t.a.xyz;let p=cross(ray.d,e2);let det=dot(e1,p);if(abs(det)<1e-9){return vec3f(-1.);}let tv=ray.o-t.a.xyz;let u=dot(tv,p)/det;if(u<0.||u>1.){return vec3f(-1.);}let q=cross(tv,e1);let v=dot(ray.d,q)/det;if(v<0.||u+v>1.){return vec3f(-1.);}let dist=dot(e2,q)/det;if(dist<=1e-5||dist>=limit){return vec3f(-1.);}return vec3f(dist,u,v);}
fn intersect(ray:Ray,limit:f32,anyHit:bool,primary:bool)->Hit {var hit=Hit(limit,0.,0.,0xffffffffu);if(cam.info.x<1.){return hit;}var stack:array<u32,64>;var top=1u;stack[0]=0u;loop {if(top==0u){break;}top--;let ni=stack[top];let node=nodes[ni];if(!boxHit(ray,node,hit.t)){continue;}if(node.count==0u){stack[top]=node.left;stack[top+1u]=node.left+1u;top+=2u;}else{for(var i=node.left;i<node.left+node.count;i++){if(primary&&(u32(triangles[i].uv2.z)&2u)!=0u){continue;}let t=triangleHit(ray,triangles[i],hit.t);if(t.x>0.){hit=Hit(t.x,t.y,t.z,i);if(anyHit){return hit;}}}}}return hit;}
fn powerHeuristic(a:f32,b:f32)->f32{return a*a/max(1e-20,a*a+b*b);}
fn basis(n:vec3f)->mat3x3f {let helper=select(vec3f(0.,1.,0.),vec3f(1.,0.,0.),abs(n.y)>.95);let t=normalize(cross(helper,n));return mat3x3f(t,cross(n,t),n);}
fn cosineDirection(n:vec3f)->vec3f {let u=random();let a=random()*2.*PI;return basis(n)*vec3f(sqrt(u)*cos(a),sqrt(u)*sin(a),sqrt(1.-u));}
fn environmentDirection()->vec3f {let z=1.-2.*random();let a=random()*2.*PI;let r=sqrt(max(0.,1.-z*z));return vec3f(r*cos(a),z,r*sin(a));}
fn offsetRay(p:vec3f,g:vec3f,d:vec3f)->Ray{return Ray(p+g*select(-1.,1.,dot(g,d)>0.)*max(1.,length(p))*1e-4,d);}
fn dielectricFresnel(cosI:f32,etaI:f32,etaT:f32)->f32 {let sinT=etaI/etaT*sqrt(max(0.,1.-cosI*cosI));if(sinT>=1.){return 1.;}let cosT=sqrt(max(0.,1.-sinT*sinT));let rp=(etaT*cosI-etaI*cosT)/(etaT*cosI+etaI*cosT);let rs=(etaI*cosI-etaT*cosT)/(etaI*cosI+etaT*cosT);return (rp*rp+rs*rs)*.5;}
fn phaseHG(c:f32,g:f32)->f32 {let den=1.+g*g-2.*g*c;return (1.-g*g)/(4.*PI*den*sqrt(max(1e-8,den)));}
fn sampleHG(direction:vec3f,g:f32)->vec3f {let r=random();var c=1.-2.*r;if(abs(g)>.001){let s=(1.-g*g)/(1.-g+2.*g*r);c=(1.+g*g-s*s)/(2.*g);}c=clamp(c,-1.,1.);let a=2.*PI*random();let s=sqrt(max(0.,1.-c*c));return basis(direction)*vec3f(s*cos(a),s*sin(a),c);}
// Heterogeneous extinction is delta-tracked against a conservative majorant.
// Null-collision limits are reported to the host, never silently truncated.
// The last photon hash bucket is reserved for an atomic transport diagnostic.
struct Interior {object:f32,ior:f32,density:f32,g:f32,color:vec3f,absorption:vec3f};
var<private> interiors:array<Interior,32>;
var<private> interiorCount:u32;
fn air()->Interior{return Interior(0.,1.,0.,0.,vec3f(1.),vec3f(0.));}
fn currentInterior()->Interior{if(interiorCount==0u){return air();}return interiors[interiorCount-1u];}
fn materialInterior(object:f32,index:u32,m:Material)->Interior {
 return Interior(object,m.params.z,select(0.,max(.001,m.reserved.y),m.reserved.w>0.),clamp(m.reserved.z,-.999,.999),clamp(m.base.rgb,vec3f(0.),vec3f(1.)),graphCode[u32(cam.assetInfo.x)+index].op.xyz);
}
fn exitIndex(object:f32)->i32 {for(var i=i32(interiorCount)-1;i>=0;i--){if(interiors[u32(i)].object==object){return i;}}return -1;}
fn transmittedIOR(object:f32,front:bool,ior:f32)->f32 {if(front){return ior;}let index=exitIndex(object);if(index<0||u32(index)+1u<interiorCount){return currentInterior().ior;}if(index==0){return 1.;}return interiors[u32(index)-1u].ior;}
fn updateInterior(object:f32,index:u32,m:Material,front:bool) {
 if(front){if(interiorCount>=32u){atomicOr(&photonMap.heads[4095],2u);return;}interiors[interiorCount]=materialInterior(object,index,m);interiorCount++;}
 else{let at=exitIndex(object);if(at>=0){for(var k=u32(at);k+1u<interiorCount;k++){interiors[k]=interiors[k+1u];}interiorCount--;}}
}
fn mediumBoundary(ray:Ray)->Hit {
 var hit=Hit(1e30,0.,0.,0xffffffffu);if(cam.info.x<1.){return hit;}var stack:array<u32,64>;var top=1u;stack[0]=0u;
 loop{if(top==0u){break;}top--;let node=nodes[stack[top]];if(!boxHit(ray,node,hit.t)){continue;}if(node.count==0u){stack[top]=node.left;stack[top+1u]=node.left+1u;top+=2u;}else{for(var i=node.left;i<node.left+node.count;i++){if((u32(triangles[i].uv2.z)&4u)==0u){continue;}let h=triangleHit(ray,triangles[i],hit.t);if(h.x>0.){hit=Hit(h.x,h.y,h.z,i);}}}}
 return hit;
}
fn initializeInteriors(origin:vec3f,enabled:bool){
 interiorCount=0u;if(!enabled){return;}
 var probe=Ray(origin,normalize(vec3f(.371,.673,.641)));var seen:array<f32,256>;var seenCount=0u;
 // First crossing of each closed object determines whether the origin is inside.
 // Reverse exit order gives the outer-to-inner order for nested closed solids.
 for(var step=0u;step<256u;step++){
  let h=mediumBoundary(probe);if(h.triangle==0xffffffffu){for(var i=0u;i<interiorCount/2u;i++){let t=interiors[i];interiors[i]=interiors[interiorCount-1u-i];interiors[interiorCount-1u-i]=t;}return;}
  let t=triangles[h.triangle];let p=probe.o+probe.d*h.t;var known=false;for(var i=0u;i<seenCount;i++){known=known||seen[i]==t.b.w;}
  if(!known){seen[seenCount]=t.b.w;seenCount++;let m=surfaceMaterial(u32(t.a.w),p,triangleUV(t,vec3f(1.-h.u-h.v,h.u,h.v)));
   if(max(m.params.y,m.reserved.w)>0.&&dot(cross(t.b.xyz-t.a.xyz,t.c.xyz-t.a.xyz),probe.d)>0.){if(interiorCount>=32u){atomicOr(&photonMap.heads[4095],2u);return;}interiors[interiorCount]=materialInterior(t.b.w,u32(t.a.w),m);interiorCount++;}}
  probe.o=p+probe.d*max(1.,length(p))*2e-5;
 }
 atomicOr(&photonMap.heads[4095],4u);
}
struct Region {dimensions:vec3i,kind:u32,data:u32,leaves:u32,scale:f32,majorant:f32,color:vec3f,g:f32,emission:vec3f,replace:bool,worldToIndex:mat4x4f,priority:f32};
fn region(index:u32)->Region {
 let start=u32(cam.assets.z)+index*3u;let a=graphCode[start];let b=graphCode[start+1u];let c=graphCode[start+2u];
 return Region(vec3i(a.op.xyz),u32(a.op.w),u32(a.args.x),u32(a.args.y),a.args.z,a.args.w,a.value.xyz,a.value.w,a.extra.xyz,a.extra.w>0.,mat4x4f(b.op,b.args,b.value,b.extra),c.op.x);
}
fn regionPoint(r:Region,p:vec3f)->vec3f{return (r.worldToIndex*vec4f(p,1.)).xyz;}
fn regionContains(r:Region,p:vec3f)->bool{let q=regionPoint(r,p);return all(q>=vec3f(-.5))&&all(q<=vec3f(r.dimensions)-.5);}
fn regionVoxel(r:Region,p:vec3i)->f32 {
 if(any(p<vec3i(0))||any(p>=r.dimensions)){return 0.;}if(r.kind==0u){return 1.;}
 if(r.kind==1u){return assetScalar(r.data+u32((p.z*r.dimensions.y+p.y)*r.dimensions.x+p.x));}
 let dims=(r.dimensions+7)/8;let cell=p/8;let leaf=u32(assetScalar(r.data+u32((cell.z*dims.y+cell.y)*dims.x+cell.x)));if(leaf==0u){return 0.;}
 let local=p%8;return assetScalar(r.leaves+(leaf-1u)*512u+u32((local.z*8+local.y)*8+local.x));
}
fn regionDensity(r:Region,p:vec3f)->f32 {
 let q=regionPoint(r,p);if(any(q<vec3f(-.5))||any(q>vec3f(r.dimensions)-.5)){return 0.;}if(r.kind==0u){return r.scale;}
 let base=vec3i(floor(q));let f=fract(q);var value=0.;
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){let w=select(1.-f,f,vec3i(x,y,z)==vec3i(1));value+=regionVoxel(r,base+vec3i(x,y,z))*w.x*w.y*w.z;}}}
 return max(0.,value*r.scale);
}
fn regionInterval(ray:Ray,r:Region,limit:f32)->vec2f {return interval(Ray(regionPoint(r,ray.o),(r.worldToIndex*vec4f(ray.d,0.)).xyz),vec3f(-.5),vec3f(r.dimensions)-.5,limit);}
fn regionPriority(p:vec3f)->f32 {var priority=-1e30;for(var i=0u;i<u32(cam.assets.w);i++){let r=region(i);if(r.replace&&regionContains(r,p)){priority=max(priority,r.priority);}}return priority;}
fn legacyDensity(p:vec3f,priority:f32)->f32 {if(priority>0.||any(p<cam.volumeMin.xyz)||any(p>cam.volumeMax.xyz)){return 0.;}return cam.volumeMin.w;}
struct MajorantRange {near:f32,far:f32,rate:f32};
fn majorantRange(ray:Ray,limit:f32,interiorRate:f32)->MajorantRange {
 var result=MajorantRange(limit,0.,interiorRate);if(interiorRate>0.){result.near=0.;result.far=limit;}
 if(cam.volumeMin.w>0.){let v=interval(ray,cam.volumeMin.xyz,cam.volumeMax.xyz,limit);if(v.y>v.x){result.near=min(result.near,v.x);result.far=max(result.far,v.y);result.rate+=cam.volumeMin.w;}}
 for(var i=0u;i<u32(cam.assets.w);i++){let r=region(i);let v=regionInterval(ray,r,limit);if(r.majorant>0.&&v.y>v.x){result.near=min(result.near,v.x);result.far=max(result.far,v.y);result.rate+=r.majorant;}}
 return result;
}
fn totalDensity(p:vec3f,interiorRate:f32)->f32 {let priority=regionPriority(p);var density=interiorRate+legacyDensity(p,priority);for(var i=0u;i<u32(cam.assets.w);i++){let r=region(i);if(r.priority>=priority){density+=regionDensity(r,p);}}return density;}
struct MediumEvent {distance:f32,index:i32,color:vec3f,g:f32,emission:vec3f,density:f32};
fn sampleMedium(ray:Ray,limit:f32)->MediumEvent {
 let inside=currentInterior();let range=majorantRange(ray,limit,inside.density);var result=MediumEvent(limit,-1,vec3f(1.),0.,vec3f(0.),0.);if(range.rate<=0.||range.far<=range.near){return result;}var t=range.near;
 for(var iteration=0u;iteration<4096u;iteration++){
  t+=-log(max(1e-7,1.-random()))/range.rate;if(t>=range.far){return result;}let p=ray.o+ray.d*t;var choice=random()*range.rate;
  if(choice<inside.density){return MediumEvent(t,-2,inside.color,inside.g,vec3f(0.),inside.density);}choice-=inside.density;
  let priority=regionPriority(p);let legacy=legacyDensity(p,priority);if(choice<legacy){return MediumEvent(t,0,cam.volumeColor.rgb,cam.volumeMax.w,vec3f(0.),legacy);}choice-=legacy;
  for(var i=0u;i<u32(cam.assets.w);i++){let r=region(i);if(r.priority<priority){continue;}let density=regionDensity(r,p);if(choice<density){return MediumEvent(t,i32(i)+1,r.color,r.g,r.emission,density);}choice-=density;}
 }
 atomicOr(&photonMap.heads[4095],1u);return result;
}
fn transmittance(ray:Ray,limit:f32)->vec3f {
 let inside=currentInterior();let analytic=exp(-(inside.absorption+vec3f(inside.density))*limit);let range=majorantRange(ray,limit,0.);if(range.rate<=0.||range.far<=range.near){return analytic;}
 // Retain exact homogeneous transmittance when no heterogeneous regions exist.
 if(cam.assets.w==0.){return analytic*exp(-range.rate*(range.far-range.near));}
 var t=range.near;var weight=1.;for(var iteration=0u;iteration<4096u;iteration++){
  t+=-log(max(1e-7,1.-random()))/range.rate;if(t>=range.far){return analytic*weight;}weight*=max(0.,1.-totalDensity(ray.o+ray.d*t,0.)/range.rate);
  if(weight<.05){if(random()>=weight/.05){return vec3f(0.);}weight=.05;}
 }atomicOr(&photonMap.heads[4095],1u);return vec3f(0.);
}

fn sampleLightIndex()->u32 {let r=random();var low=0u;var high=u32(cam.info.y)-1u;loop{if(low>=high){break;}let mid=(low+high)/2u;if(lights[mid].cdf<r){low=mid+1u;}else{high=mid;}}return low;}
fn trianglePoint(t:Triangle,b:vec3f)->vec3f{return t.a.xyz*b.x+t.b.xyz*b.y+t.c.xyz*b.z;}
fn triangleUV(t:Triangle,b:vec3f)->vec2f{return t.uv01.xy*b.x+t.uv01.zw*b.y+t.uv2.xy*b.z;}


fn sampleBarycentric()->vec3f {let s=sqrt(random());let v=random();return vec3f(1.-s,s*(1.-v),s*v);}
fn directSurface(m:Material,color:vec3f,p:vec3f,g:vec3f,n:vec3f,wo:vec3f,canContinue:bool)->vec3f {
 var result=vec3f(0.);
 if(cam.info.y>0.&&m.params.y<1.) {let light=lights[sampleLightIndex()];let lt=triangles[light.triangle];let bary=sampleBarycentric();let lp=trianglePoint(lt,bary);let toLight=lp-p;let dist=length(toLight);let wi=toLight/max(1e-8,dist);let ln=normalize(cross(lt.b.xyz-lt.a.xyz,lt.c.xyz-lt.a.xyz));let cosine=abs(dot(ln,-wi));
  if(dot(n,wi)>0.&&cosine>1e-7&&dist>1e-4){let shadow=offsetRay(p,g,wi);if(intersect(shadow,dist-max(1.,dist)*5e-4,true,false).triangle==0xffffffffu){let pdf=light.pmf*dist*dist/(light.area*cosine);let bs=evaluateBSDF(m,color,n,wo,wi);let lm=surfaceMaterial(u32(lt.a.w),lp,triangleUV(lt,bary));let le=lm.base.rgb*lm.params.w;result+=bs.f*max(dot(n,wi),0.)*le*transmittance(shadow,dist)*select(1.,powerHeuristic(pdf,bs.pdf),canContinue)/max(pdf,1e-10);}}
 }
 if(cam.forward.w>0.&&m.params.y<1.) {let wi=environmentDirection();let co=dot(n,wi);if(co>0.){let shadow=offsetRay(p,g,wi);if(intersect(shadow,1e30,true,false).triangle==0xffffffffu){let bs=evaluateBSDF(m,color,n,wo,wi);let pdf=1./(4.*PI);result+=bs.f*co*environment(wi)*transmittance(shadow,1e30)*select(1.,powerHeuristic(pdf,bs.pdf),canContinue)/pdf;}}}
 return result;
}
fn directMedium(p:vec3f,forward:vec3f,g:f32,canContinue:bool)->vec3f {
 var result=vec3f(0.);
 if(cam.info.y>0.){let light=lights[sampleLightIndex()];let lt=triangles[light.triangle];let bary=sampleBarycentric();let lp=trianglePoint(lt,bary);let toLight=lp-p;let dist=length(toLight);let wi=toLight/max(1e-8,dist);let ln=normalize(cross(lt.b.xyz-lt.a.xyz,lt.c.xyz-lt.a.xyz));let cosine=abs(dot(ln,-wi));let shadow=Ray(p+wi*1e-4,wi);if(cosine>1e-7&&intersect(shadow,dist-max(1.,dist)*5e-4,true,false).triangle==0xffffffffu){let pdf=light.pmf*dist*dist/(light.area*cosine);let phase=phaseHG(dot(forward,wi),g);let lm=surfaceMaterial(u32(lt.a.w),lp,triangleUV(lt,bary));result+=lm.base.rgb*lm.params.w*phase*transmittance(shadow,dist)*select(1.,powerHeuristic(pdf,phase),canContinue)/max(pdf,1e-10);}}
 if(cam.forward.w>0.){let wi=environmentDirection();let shadow=Ray(p+wi*1e-4,wi);if(intersect(shadow,1e30,true,false).triangle==0xffffffffu){let pdf=1./(4.*PI);let phase=phaseHG(dot(forward,wi),g);result+=environment(wi)*phase*transmittance(shadow,1e30)*select(1.,powerHeuristic(pdf,phase),canContinue)/pdf;}}
 return result;
}
// WGSL requires explicit grouping between multiplication and bitwise XOR.
fn photonHash(c:vec3i)->u32 {
 let x=u32(c.x)*73856093u;
 let y=u32(c.y)*19349663u;
 let z=u32(c.z)*83492791u;
 return (x ^ y ^ z) % 4095u;
}
fn photonGather(p:vec3f,n:vec3f,wo:vec3f,m:Material)->vec3f {
 let radius=max(.0001,cam.render.z);let cell=vec3i(floor(p/radius));var result=vec3f(0.);
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let c=cell+vec3i(x,y,z);var next=atomicLoad(&photonMap.heads[photonHash(c)]);loop{if(next==0u){break;}let record=photonMap.records[next-1u];next=record.next.x;
  if(any(vec3i(floor(record.p.xyz/radius))!=c)){continue;}let distance=length(record.p.xyz-p);if(record.p.w==1.&&distance<radius&&dot(n,record.n.xyz)>.85&&abs(dot(n,record.p.xyz-p))<radius*.15){let bs=evaluateBSDF(m,m.base.rgb,n,wo,record.incoming.xyz);result+=record.power.rgb*bs.f*(1.-distance/radius);}
 }}}}
 return result*(3./(PI*radius*radius));
}
fn photonGatherVolume(p:vec3f,forward:vec3f,g:f32)->vec3f {
 let radius=max(.0001,cam.render.z);let cell=vec3i(floor(p/radius));let density=totalDensity(p,currentInterior().density);if(density<=0.){return vec3f(0.);}var result=vec3f(0.);
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let c=cell+vec3i(x,y,z);var next=atomicLoad(&photonMap.heads[photonHash(c)]);
 loop{if(next==0u){break;}let record=photonMap.records[next-1u];next=record.next.x;if(record.p.w!=2.||any(vec3i(floor(record.p.xyz/radius))!=c)){continue;}
 let d=length(record.p.xyz-p);if(d<radius){result+=record.power.rgb*phaseHG(dot(forward,record.incoming.xyz),g)*(1.-d/radius);}}
 }}}
 // Integral of the linear radial kernel over a 3D ball is pi*r^3/3.
 return result*(3./(PI*radius*radius*radius*density));
}
fn trace(primary:Ray)->vec3f {
 initializeInteriors(primary.o,cam.sampling.y>0.);
 var ray=primary;var beta=vec3f(1.);var radiance=vec3f(0.);var previousPdf=0.;var delta=true;var previousPoint=ray.o;var gatheredBounces=0u;
 for(var bounce=0u;bounce<u32(cam.size.w);bounce++) {
  let hit=intersect(ray,1e30,false,bounce==0u);let event=sampleMedium(ray,hit.t);let travelled=min(hit.t,event.distance);beta*=exp(-currentInterior().absorption*travelled);
  if(event.index != -1){
   let p=ray.o+ray.d*event.distance;let emission=beta*event.emission;radiance+=emission;beta*=event.color;
   let hasNext=bounce+1u<u32(cam.size.w);let useMap=cam.render.x>0.&&(cam.render.x==1.||gatheredBounces>=1u);
   let direct=beta*directMedium(p,ray.d,event.g,hasNext&&!useMap);radiance+=direct;
   if(bounce==0u){aovAlbedo=event.color;aovDepth=event.distance;aovEmission=emission;aovDirect+=emission+direct;}
   if(useMap){radiance+=beta*photonGatherVolume(p,ray.d,event.g);break;}if(!hasNext){break;}
   let wi=sampleHG(ray.d,event.g);previousPdf=phaseHG(dot(ray.d,wi),event.g);previousPoint=p;ray=Ray(p,wi);delta=false;gatheredBounces++;
   if(bounce>=3u){let survive=clamp(max(beta.x,max(beta.y,beta.z)),.05,.95);if(random()>survive){break;}beta/=survive;}continue;
  }
  if(hit.triangle==0xffffffffu){var w=1.;if(!delta){w=powerHeuristic(previousPdf,1./(4.*PI));}let contribution=beta*environment(ray.d)*w;radiance+=contribution;if(bounce==0u){aovDirect+=contribution;}break;}
  let t=triangles[hit.triangle];let p=ray.o+ray.d*hit.t;let bary=vec3f(1.-hit.u-hit.v,hit.u,hit.v);var mat=surfaceMaterial(u32(t.a.w),p,triangleUV(t,bary));mat.params.y=max(mat.params.y,mat.reserved.w);
  let g=normalize(cross(t.b.xyz-t.a.xyz,t.c.xyz-t.a.xyz));let front=dot(g,ray.d)<0.;var n=normalize(t.n0.xyz*bary.x+t.n1.xyz*bary.y+t.n2.xyz*bary.z);if(dot(n,g)<0.){n=-n;}if(!front){n=-n;}if(dot(n,-ray.d)<1e-5){n=select(-g,g,front);}let color=mat.base.rgb;setupFiber(t,normalize(t.n0.xyz*bary.x+t.n1.xyz*bary.y+t.n2.xyz*bary.z));
  if(bounce==0u){aovAlbedo=color;aovNormal=n;aovDepth=hit.t;aovObject=t.b.w;aovEmission=color*mat.params.w;}
  if(mat.params.w>0.){var w=1.;if(!delta){let dist2=dot(p-previousPoint,p-previousPoint);let lightPdf=t.uv2.w*dist2/max(1e-7,abs(dot(g,-ray.d)));w=powerHeuristic(previousPdf,lightPdf);}let contribution=beta*color*mat.params.w*w;radiance+=contribution;if(bounce==0u){aovDirect+=contribution;}}
  let wo=-ray.d;let hasNext=bounce+1u<u32(cam.size.w);let useMap=cam.render.x>0.&&mat.params.y<.999&&mat.pattern.x>=0.;
  let terminateWithMap=useMap&&(cam.render.x==1.||gatheredBounces>=1u);
  let direct=beta*directSurface(mat,color,p,g,n,wo,hasNext&&!terminateWithMap);radiance+=direct;if(bounce==0u){aovDirect+=direct;}
  if(terminateWithMap){radiance+=beta*photonGather(p,n,wo,mat);break;}if(!hasNext){break;}previousPoint=p;
  if(mat.pattern.x<0.&&fiberRadius>0.){let wi=sampleFiber(mat,wo);let bs=evaluateBSDF(mat,color,n,wo,wi);if(bs.pdf<=1e-12){break;}beta*=bs.f*abs(dot(n,wi))/bs.pdf;previousPdf=bs.pdf;delta=false;ray=surfaceRay(p,g,wi,mat);gatheredBounces++;}
  else if(random()<mat.params.y){
   var etaI=currentInterior().ior;if(!front&&exitIndex(t.b.w)<0){etaI=mat.params.z;}let etaT=transmittedIOR(t.b.w,front,mat.params.z);let eta=etaI/etaT;let oriented=select(-g,g,front);let F=dielectricFresnel(clamp(dot(oriented,wo),0.,1.),etaI,etaT);var wi=reflect(ray.d,oriented);
   if(random()>=F){wi=refract(ray.d,oriented,eta);beta*=eta*eta;let absorption=graphCode[u32(cam.assetInfo.x)+u32(t.a.w)].op.xyz;if(mat.reserved.w<=0.&&all(absorption==vec3f(0.))){beta*=color;}updateInterior(t.b.w,u32(t.a.w),mat,front);}
   ray=offsetRay(p,g,normalize(wi));delta=true;previousPdf=0.;
  }else{
   var wi:vec3f;let ps=.25+.5*mat.params.x;if(random()<ps){let alpha=max(.025,mat.base.w*mat.base.w);let u=min(random(),.999999);let a=random()*2.*PI;let ct=sqrt((1.-u)/(1.+(alpha*alpha-1.)*u));let st=sqrt(max(0.,1.-ct*ct));let h=basis(n)*vec3f(st*cos(a),st*sin(a),ct);wi=reflect(-wo,h);}else{wi=cosineDirection(n);}
   let bs=evaluateBSDF(mat,color,n,wo,wi);if(bs.pdf<=1e-10||dot(n,wi)<=0.){break;}beta*=bs.f*abs(dot(n,wi))/bs.pdf;previousPdf=bs.pdf;delta=false;ray=offsetRay(p,g,normalize(wi));gatheredBounces++;
  }
  if(bounce>=3u){let survive=clamp(max(beta.x,max(beta.y,beta.z)),.05,.95);if(random()>survive){break;}beta/=survive;}
 }
 if(any(!(abs(radiance)<vec3f(1e30)))){atomicOr(&photonMap.heads[4095],8u);}return radiance;
}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3u) {
 let width=u32(cam.size.x);let height=u32(cam.size.y);if(id.x>=width||id.y>=height){return;}let pixel=id.y*width+id.x;let sample=u32(cam.size.z);let globalPixel=(id.y+u32(cam.tile.y))*u32(cam.tile.z)+id.x+u32(cam.tile.x);state=(globalPixel*1973u+(sample+u32(cam.sampling.x))*9277u+89173u+u32(cam.sampling.z)*1013u)|1u;
 let jitter=vec2f(random(),random());let xy=(vec2f(id.xy)+cam.tile.xy+jitter)/cam.tile.zw*2.-1.;var origin=cam.eye.xyz;var direction=normalize(cam.forward.xyz+cam.right.xyz*xy.x*cam.right.w*cam.eye.w-cam.up.xyz*xy.y*cam.eye.w);
 if(cam.lens.z>0.){origin+=cam.right.xyz*xy.x*cam.right.w*cam.lens.w-cam.up.xyz*xy.y*cam.lens.w;direction=cam.forward.xyz;}
 else if(cam.lens.x>0.){let focus=origin+direction*cam.lens.y/max(1e-6,dot(direction,cam.forward.xyz));let a=random()*2.*PI;let r=sqrt(random())*cam.lens.x;origin+=r*(cos(a)*cam.right.xyz+sin(a)*cam.up.xyz);direction=normalize(focus-origin);}
 aovAlbedo=vec3f(0.);aovNormal=vec3f(0.);aovDepth=0.;aovObject=0.;aovEmission=vec3f(0.);aovDirect=vec3f(0.);
 let value=trace(Ray(origin,direction));let previous=select(pixels[pixel].rgb,vec3f(0.),sample==0u);pixels[pixel]=vec4f(previous+(value-previous)/f32(sample+1u),1.);
 let outputs=array<vec4f,5>(vec4f(aovAlbedo,1.),vec4f(aovNormal,aovDepth),vec4f(aovEmission,aovObject),vec4f(aovDirect,1.),vec4f(value-aovDirect,1.));
 for(var k=0u;k<5u;k++){let old=select(aovs[pixel*5u+k],vec4f(0.),sample==0u);aovs[pixel*5u+k]=old+(outputs[k]-old)/f32(sample+1u);}aovs[pixel*5u+2u].w=aovObject;
}
fn storePhoton(index:u32,p:vec3f,normal:vec3f,power:vec3f,incoming:vec3f,kind:f32){
 if(any(!(abs(power)<vec3f(1e30)))){atomicOr(&photonMap.heads[4095],8u);return;}
 let cell=vec3i(floor(p/max(.0001,cam.render.z)));let next=atomicExchange(&photonMap.heads[photonHash(cell)],index+1u);
 photonMap.records[index]=Photon(vec4f(p,kind),vec4f(normal,0.),vec4f(power,1.),vec4f(incoming,0.),vec4u(next,0u,0u,0u));
}
@compute @workgroup_size(64)
fn photonMain(@builtin(global_invocation_id) id:vec3u) {
 let count=u32(cam.render.y);if(id.x>=count){return;}state=(id.x*2654435761u+741103597u+u32(cam.sampling.z)*1013u+u32(cam.size.z+cam.sampling.x)*2246822519u)|1u;
 let hasMesh=cam.info.y>0.;let hasEnv=cam.forward.w>0.;if(!hasMesh&&!hasEnv){return;}let meshProbability=select(select(0.,1.,hasMesh),.5,hasMesh&&hasEnv);var ray:Ray;var power:vec3f;
 if(random()<meshProbability){let light=lights[sampleLightIndex()];let t=triangles[light.triangle];let b=sampleBarycentric();let p=trianglePoint(t,b);var n=normalize(cross(t.b.xyz-t.a.xyz,t.c.xyz-t.a.xyz));n*=select(-1.,1.,random()<.5);let mat=surfaceMaterial(u32(t.a.w),p,triangleUV(t,b));let wi=cosineDirection(n);ray=offsetRay(p,n,wi);power=mat.base.rgb*mat.params.w*(2.*PI*light.area/(light.pmf*meshProbability*f32(count)));}
 else{let center=(cam.worldMin.xyz+cam.worldMax.xyz)*.5;let radius=max(.1,length(cam.worldMax.xyz-cam.worldMin.xyz)*.501);let direction=environmentDirection();let r=sqrt(random())*radius;let a=random()*2.*PI;let plane=basis(direction);let origin=center-direction*radius+plane[0]*r*cos(a)+plane[1]*r*sin(a);ray=Ray(origin,direction);power=environment(-direction)*(4.*PI*PI*radius*radius/((1.-meshProbability)*f32(count)));}
 initializeInteriors(ray.o,cam.assetInfo.w>0.);
 for(var bounce=0u;bounce<8u;bounce++){
  let hit=intersect(ray,1e30,false,false);let event=sampleMedium(ray,hit.t);power*=exp(-currentInterior().absorption*min(hit.t,event.distance));
  if(event.index != -1){let p=ray.o+ray.d*event.distance;if(bounce>0u){storePhoton(id.x*8u+bounce,p,vec3f(0.),power,-ray.d,2.);}power*=event.color;ray=Ray(p,sampleHG(ray.d,event.g));}
  else{
   if(hit.triangle==0xffffffffu){break;}let t=triangles[hit.triangle];let b=vec3f(1.-hit.u-hit.v,hit.u,hit.v);let p=ray.o+ray.d*hit.t;var mat=surfaceMaterial(u32(t.a.w),p,triangleUV(t,b));mat.params.y=max(mat.params.y,mat.reserved.w);let g=normalize(cross(t.b.xyz-t.a.xyz,t.c.xyz-t.a.xyz));let front=dot(g,ray.d)<0.;let n=select(-g,g,front);let wo=-ray.d;setupFiber(t,normalize(t.n0.xyz*b.x+t.n1.xyz*b.y+t.n2.xyz*b.z));
   if(bounce>0u&&mat.params.y<.999){storePhoton(id.x*8u+bounce,p,n,power,wo,1.);}
   if(mat.pattern.x<0.&&fiberRadius>0.){let wi=sampleFiber(mat,wo);let bs=evaluateBSDF(mat,mat.base.rgb,n,wo,wi);if(bs.pdf<=1e-12){break;}power*=bs.f*abs(dot(n,wi))/bs.pdf;ray=surfaceRay(p,g,wi,mat);}
   else if(random()<mat.params.y){var etaI=currentInterior().ior;if(!front&&exitIndex(t.b.w)<0){etaI=mat.params.z;}let etaT=transmittedIOR(t.b.w,front,mat.params.z);let F=dielectricFresnel(clamp(dot(n,wo),0.,1.),etaI,etaT);var wi=reflect(ray.d,n);if(random()>=F){wi=refract(ray.d,n,etaI/etaT);let absorption=graphCode[u32(cam.assetInfo.x)+u32(t.a.w)].op.xyz;if(mat.reserved.w<=0.&&all(absorption==vec3f(0.))){power*=mat.base.rgb;}updateInterior(t.b.w,u32(t.a.w),mat,front);}ray=offsetRay(p,g,normalize(wi));}
   else{var wi:vec3f;let ps=.25+.5*mat.params.x;if(random()<ps){let alpha=max(.025,mat.base.w*mat.base.w);let u=min(random(),.999999);let a=random()*2.*PI;let ct=sqrt((1.-u)/(1.+(alpha*alpha-1.)*u));let st=sqrt(max(0.,1.-ct*ct));wi=reflect(-wo,basis(n)*vec3f(st*cos(a),st*sin(a),ct));}else{wi=cosineDirection(n);}let bs=evaluateBSDF(mat,mat.base.rgb,n,wo,wi);if(bs.pdf<=1e-10||dot(n,wi)<=0.){break;}power*=bs.f*abs(dot(n,wi))/bs.pdf;ray=offsetRay(p,g,normalize(wi));}
  }
  if(bounce>=3u){let survive=.8;if(random()>survive){break;}power/=survive;}
 }
}

fn sampleFiber(m:Material,woWorld:vec3f)->vec3f {
 let F=fiberBasis();let wo=transpose(F)*woWorld;let L=fiberLobes(m,wo);var p=0u;var u=random();
 loop{if(p>=3u||u<=L.probability[p]){break;}u-=L.probability[p];p++;}
 let v=L.variance[p];let r=max(1e-7,random());let c=clamp(1.+v*log(r+(1.-r)*exp(-2./v)),-1.,1.);
 let si=clamp(-c*L.sinTheta[p]+sqrt(max(0.,1.-c*c))*cos(2.*PI*random())*sqrt(1.-L.sinTheta[p]*L.sinTheta[p]),-1.,1.);
 let ru=clamp(random(),1e-7,1.-1e-7);let low=fiberCdf(-PI,L.s);let high=fiberCdf(PI,L.s);let q=low+(high-low)*ru;
 var dphi=L.s*log(q/(1.-q));if(p==3u){dphi=2.*PI*ru-PI;}
 let phi=atan2(wo.z,wo.y)+L.phi[p]+dphi;let ci=sqrt(max(0.,1.-si*si));return normalize(F*vec3f(si,ci*cos(phi),ci*sin(phi)));
}
fn surfaceRay(p:vec3f,g:vec3f,wi:vec3f,m:Material)->Ray {
 if(m.pattern.x<0.&&fiberRadius>0.&&dot(wi,fiberNormal)<0.){
  let radial=wi-fiberTangent*dot(wi,fiberTangent);let exitDistance=-2.*fiberRadius*dot(wi,fiberNormal)/max(1e-8,dot(radial,radial));
  return Ray(p+wi*(exitDistance+max(1.,length(p))*2e-4),wi);
 }
 return offsetRay(p,g,wi);
}
