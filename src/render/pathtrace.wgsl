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
fn transmittance(ray:Ray,limit:f32)->f32 {if(cam.volumeMin.w<=0.){return 1.;}let v=interval(ray,cam.volumeMin.xyz,cam.volumeMax.xyz,limit);return exp(-cam.volumeMin.w*max(0.,v.y-v.x));}
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
 return (x ^ y ^ z) & 4095u;
}
fn photonGather(p:vec3f,n:vec3f,wo:vec3f,m:Material)->vec3f {
 let radius=max(.0001,cam.render.z);let cell=vec3i(floor(p/radius));var result=vec3f(0.);
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let c=cell+vec3i(x,y,z);var next=atomicLoad(&photonMap.heads[photonHash(c)]);loop{if(next==0u){break;}let record=photonMap.records[next-1u];next=record.next.x;
  if(any(vec3i(floor(record.p.xyz/radius))!=c)){continue;}let distance=length(record.p.xyz-p);if(distance<radius&&dot(n,record.n.xyz)>.85&&abs(dot(n,record.p.xyz-p))<radius*.15){let bs=evaluateBSDF(m,m.base.rgb,n,wo,record.incoming.xyz);result+=record.power.rgb*bs.f*(1.-distance/radius);}
 }}}}
 return result*(3./(PI*radius*radius));
}
fn trace(primary:Ray)->vec3f {
 var ray=primary;var beta=vec3f(1.);var radiance=vec3f(0.);var previousPdf=0.;var delta=true;var previousPoint=ray.o;var mediumDensity=0.;var mediumG=0.;var mediumColor=vec3f(1.);var mediumObject=0.;var gatheredBounces=0u;
 for(var bounce=0u;bounce<u32(cam.size.w);bounce++) {
  let hit=intersect(ray,1e30,false,bounce==0u);
  if(mediumDensity>0.) {let distance=-log(max(1e-7,1.-random()))/mediumDensity;if(distance<hit.t){let p=ray.o+ray.d*distance;beta*=mediumColor;let wi=sampleHG(ray.d,mediumG);previousPdf=phaseHG(dot(ray.d,wi),mediumG);previousPoint=p;ray=Ray(p,wi);delta=false;continue;}}
  else if(cam.volumeMin.w>0.){let range=interval(ray,cam.volumeMin.xyz,cam.volumeMax.xyz,hit.t);if(range.y>range.x){let distance=range.x-log(max(1e-7,1.-random()))/cam.volumeMin.w;if(distance<range.y){let p=ray.o+ray.d*distance;beta*=cam.volumeColor.rgb;let direct=beta*directMedium(p,ray.d,cam.volumeMax.w,bounce+1u<u32(cam.size.w));radiance+=direct;if(bounce==0u){aovDirect+=direct;}let wi=sampleHG(ray.d,cam.volumeMax.w);previousPdf=phaseHG(dot(ray.d,wi),cam.volumeMax.w);previousPoint=p;ray=Ray(p,wi);delta=false;continue;}}}
  if(hit.triangle==0xffffffffu){var w=1.;if(!delta){w=powerHeuristic(previousPdf,1./(4.*PI));}let contribution=beta*environment(ray.d)*w;radiance+=contribution;if(bounce==0u){aovDirect+=contribution;}break;}
  let t=triangles[hit.triangle];let p=ray.o+ray.d*hit.t;let bary=vec3f(1.-hit.u-hit.v,hit.u,hit.v);var mat=surfaceMaterial(u32(t.a.w),p,triangleUV(t,bary));mat.params.y=max(mat.params.y,mat.reserved.w);let g=normalize(cross(t.b.xyz-t.a.xyz,t.c.xyz-t.a.xyz));let front=dot(g,ray.d)<0.;var n=normalize(t.n0.xyz*bary.x+t.n1.xyz*bary.y+t.n2.xyz*bary.z);if(dot(n,g)<0.){n=-n;}if(!front){n=-n;}if(dot(n,-ray.d)<1e-5){n=select(-g,g,front);}let color=mat.base.rgb;
  if(bounce==0u){aovAlbedo=color;aovNormal=n;aovDepth=hit.t;aovObject=t.b.w;aovEmission=color*mat.params.w;}
  if(mat.params.w>0.){var w=1.;if(!delta){let dist2=dot(p-previousPoint,p-previousPoint);let lightPdf=t.uv2.w*dist2/max(1e-7,abs(dot(g,-ray.d)));w=powerHeuristic(previousPdf,lightPdf);}let contribution=beta*color*mat.params.w*w;radiance+=contribution;if(bounce==0u){aovDirect+=contribution;}}
  let wo=-ray.d;let hasNext=bounce+1u<u32(cam.size.w);let useMap=cam.render.x>0.&&mat.params.y<.999;
  let terminateWithMap=useMap&&(cam.render.x==1.||gatheredBounces>=1u);
  let direct=beta*directSurface(mat,color,p,g,n,wo,hasNext&&!terminateWithMap);radiance+=direct;if(bounce==0u){aovDirect+=direct;}
  if(terminateWithMap){radiance+=beta*photonGather(p,n,wo,mat);break;}
  if(!hasNext){break;}previousPoint=p;
  if(random()<mat.params.y){let etaI=select(mat.params.z,1.,front);let etaT=select(1.,mat.params.z,front);let eta=etaI/etaT;let oriented=select(-g,g,front);let F=dielectricFresnel(clamp(dot(oriented,wo),0.,1.),etaI,etaT);var wi=reflect(ray.d,oriented);
   if(random()>=F){wi=refract(ray.d,oriented,eta);if(mat.reserved.w>0.){beta*=eta*eta;if(front){mediumDensity=max(.001,mat.reserved.y);mediumG=clamp(mat.reserved.z,-.95,.95);mediumColor=clamp(color,vec3f(0.),vec3f(1.));mediumObject=t.b.w;}else if(mediumObject==t.b.w){mediumDensity=0.;mediumObject=0.;}}else{beta*=color*eta*eta;}}
   ray=offsetRay(p,g,normalize(wi));delta=true;previousPdf=0.;
  } else {var wi:vec3f;let ps=.25+.5*mat.params.x;if(random()<ps){let alpha=max(.025,mat.base.w*mat.base.w);let u=min(random(),.999999);let a=random()*2.*PI;let ct=sqrt((1.-u)/(1.+(alpha*alpha-1.)*u));let st=sqrt(max(0.,1.-ct*ct));let h=basis(n)*vec3f(st*cos(a),st*sin(a),ct);wi=reflect(-wo,h);}else{wi=cosineDirection(n);}let bs=evaluateBSDF(mat,color,n,wo,wi);if(bs.pdf<=1e-10||dot(n,wi)<=0.){break;}beta*=bs.f*abs(dot(n,wi))/bs.pdf;previousPdf=bs.pdf;delta=false;ray=offsetRay(p,g,normalize(wi));gatheredBounces++;}
  if(bounce>=3u){let survive=clamp(max(beta.x,max(beta.y,beta.z)),.05,.95);if(random()>survive){break;}beta/=survive;}
 }
 return radiance;
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
@compute @workgroup_size(64)
fn photonMain(@builtin(global_invocation_id) id:vec3u) {
 let count=u32(cam.render.y);if(id.x>=count||cam.info.x<1.){return;}state=(id.x*2654435761u+741103597u+u32(cam.sampling.z)*1013u)|1u;
 let hasMesh=cam.info.y>0.;let hasEnv=cam.forward.w>0.;if(!hasMesh&&!hasEnv){return;}let meshProbability=select(select(0.,1.,hasMesh),.5,hasMesh&&hasEnv);var ray:Ray;var power:vec3f;
 if(random()<meshProbability){let light=lights[sampleLightIndex()];let t=triangles[light.triangle];let b=sampleBarycentric();let p=trianglePoint(t,b);var n=normalize(cross(t.b.xyz-t.a.xyz,t.c.xyz-t.a.xyz));n*=select(-1.,1.,random()<.5);let mat=surfaceMaterial(u32(t.a.w),p,triangleUV(t,b));let wi=cosineDirection(n);ray=offsetRay(p,n,wi);power=mat.base.rgb*mat.params.w*(2.*PI*light.area/(light.pmf*meshProbability*f32(count)));}
 else {let center=(nodes[0].lower+nodes[0].upper)*.5;let radius=max(.1,length(nodes[0].upper-nodes[0].lower)*.501);let direction=environmentDirection();let r=sqrt(random())*radius;let a=random()*2.*PI;let plane=basis(direction);let origin=center-direction*radius+plane[0]*r*cos(a)+plane[1]*r*sin(a);ray=Ray(origin,direction);power=environment(-direction)*(4.*PI*PI*radius*radius/((1.-meshProbability)*f32(count)));}
 for(var bounce=0u;bounce<8u;bounce++){let hit=intersect(ray,1e30,false,false);if(hit.triangle==0xffffffffu){break;}let t=triangles[hit.triangle];let b=vec3f(1.-hit.u-hit.v,hit.u,hit.v);let p=ray.o+ray.d*hit.t;let mat=surfaceMaterial(u32(t.a.w),p,triangleUV(t,b));let g=normalize(cross(t.b.xyz-t.a.xyz,t.c.xyz-t.a.xyz));let front=dot(g,ray.d)<0.;let n=select(-g,g,front);let wo=-ray.d;
  if(bounce>0u&&mat.params.y<.999){let index=id.x*8u+bounce;let cell=vec3i(floor(p/max(.0001,cam.render.z)));let next=atomicExchange(&photonMap.heads[photonHash(cell)],index+1u);photonMap.records[index]=Photon(vec4f(p,1.),vec4f(n,0.),vec4f(power,1.),vec4f(wo,0.),vec4u(next,0u,0u,0u));}
  if(random()<mat.params.y){let etaI=select(mat.params.z,1.,front);let etaT=select(1.,mat.params.z,front);let F=dielectricFresnel(clamp(dot(n,wo),0.,1.),etaI,etaT);var wi=reflect(ray.d,n);if(random()>=F){wi=refract(ray.d,n,etaI/etaT);power*=mat.base.rgb;}ray=offsetRay(p,g,normalize(wi));}
  else {var wi:vec3f;let ps=.25+.5*mat.params.x;if(random()<ps){let alpha=max(.025,mat.base.w*mat.base.w);let u=min(random(),.999999);let a=random()*2.*PI;let ct=sqrt((1.-u)/(1.+(alpha*alpha-1.)*u));let st=sqrt(max(0.,1.-ct*ct));wi=reflect(-wo,basis(n)*vec3f(st*cos(a),st*sin(a),ct));}else{wi=cosineDirection(n);}let bs=evaluateBSDF(mat,mat.base.rgb,n,wo,wi);if(bs.pdf<=1e-10||dot(n,wi)<=0.){break;}power*=bs.f*abs(dot(n,wi))/bs.pdf;ray=offsetRay(p,g,normalize(wi));}
  if(bounce>=3u){let survive=.8;if(random()>survive){break;}power/=survive;}
 }
}
