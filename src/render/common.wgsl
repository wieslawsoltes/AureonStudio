const FIBERS_ENABLED:bool=false;
const PI:f32=3.141592653589793;
struct Camera {eye:vec4f, right:vec4f, up:vec4f, forward:vec4f, size:vec4f, lens:vec4f, info:vec4f, vp:mat4x4f, misc:vec4f,volumeMin:vec4f,volumeMax:vec4f,volumeColor:vec4f,render:vec4f,tile:vec4f,sampling:vec4f,assets:vec4f,assetInfo:vec4f,worldMin:vec4f,worldMax:vec4f};
struct Triangle {a:vec4f,b:vec4f,c:vec4f,n0:vec4f,n1:vec4f,n2:vec4f,uv01:vec4f,uv2:vec4f};
struct Material {base:vec4f,params:vec4f,pattern:vec4f,reserved:vec4f};
@group(0) @binding(0) var<uniform> cam:Camera;
@group(0) @binding(1) var<storage,read> triangles:array<Triangle>;
@group(0) @binding(2) var<storage,read> materials:array<Material>;
fn environment(d:vec3f)->vec3f {let t=clamp(d.y*.5+.5,0.,1.);return mix(vec3f(.24,.255,.28),mix(vec3f(.64,.68,.75),vec3f(.40,.50,.68),pow(t,1.5)),smoothstep(0.,.65,t))*cam.forward.w;}
fn baseColor(m:Material,p:vec3f,uv:vec2f)->vec3f {let scale=max(.01,m.pattern.y);var color=m.base.rgb;if(m.pattern.x==1.){let q=floor(uv*scale);color*=select(.17,1.,(i32(q.x)+i32(q.y))%2==0);}else if(m.pattern.x==2.){let veins=pow(.5+.5*sin((p.x+p.z*.4)*scale*4.+sin(p.y*5.+p.z*2.)*3.),12.);color=mix(color,vec3f(.06,.07,.08),veins*.7);}else if(m.pattern.x==3.){let r=length(p.xz)*scale;let grain=.5+.5*sin(r*22.+sin(p.y*6.)*.8);color*=mix(.35,1.,grain);}if(m.pattern.z>0.){let texel=sampleBitmap(u32(m.pattern.z)-1u,uv,cam.sampling.w);color*=mix(vec3f(1.),texel.rgb,texel.a);}return color;}
fn displayColor(linear:vec3f)->vec3f {let x=max(vec3f(0.),linear*exp2(cam.up.w));let c=clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3f(0.),vec3f(1.));return select(c*12.92,1.055*pow(c,vec3f(1./2.4))-.055,c>vec3f(.0031308));}
fn fresnelSchlick(c:f32,f0:vec3f)->vec3f{return f0+(vec3f(1.)-f0)*pow(clamp(1.-c,0.,1.),5.);}
fn ggxD(nh:f32,alpha:f32)->f32{let a2=alpha*alpha;let d=nh*nh*(a2-1.)+1.;return a2/(PI*d*d);}
fn smithG1(c:f32,alpha:f32)->f32{return 2.*c/max(1e-7,c+sqrt(alpha*alpha+(1.-alpha*alpha)*c*c));}
struct BSDF {f:vec3f,pdf:f32};
// Fiber dispatch is specialized per scene, not interpreted in every path.
fn evaluateBSDF(m:Material,color:vec3f,n:vec3f,wo:vec3f,wi:vec3f)->BSDF {
 if(FIBERS_ENABLED&&m.pattern.x<0.&&fiberRadius>0.){return evaluateFiber(m,n,wo,wi);}
 return evaluateSurfaceBSDF(m,color,n,wo,wi);
}
fn evaluateSurfaceBSDF(m:Material,color:vec3f,n:vec3f,wo:vec3f,wi:vec3f)->BSDF {let ni=max(dot(n,wi),0.);let no=max(dot(n,wo),0.);if(ni<=0.||no<=0.){return BSDF(vec3f(0.),0.);}let h=normalize(wi+wo);let nh=max(dot(n,h),0.);let oh=max(dot(wo,h),1e-6);let alpha=max(.025,m.base.w*m.base.w);let f0=mix(vec3f(pow((m.params.z-1.)/(m.params.z+1.),2.)),color,m.params.x);let F=fresnelSchlick(oh,f0);let D=ggxD(nh,alpha);let G=smithG1(ni,alpha)*smithG1(no,alpha);let spec=D*G*F/max(1e-6,4.*ni*no);let diffuse=(vec3f(1.)-F)*(1.-m.params.x)*color/PI;let ps=.25+.5*m.params.x;let pdf=mix(ni/PI,D*nh/(4.*oh),ps);return BSDF((diffuse+spec)*(1.-m.params.y),pdf*(1.-m.params.y));}

struct GraphInstruction {op:vec4f,args:vec4f,value:vec4f,extra:vec4f};
@group(1) @binding(0) var bitmapSampler:sampler;
@group(1) @binding(1) var bitmapArray:texture_2d_array<f32>;
// A vec4 view preserves the 64-byte instruction ABI while scalar voxel/tile
// reads load one vector, without expanding an entire instruction and branching
// over four possible fields at every trilinear texture tap.
@group(1) @binding(2) var<storage,read> graphData:array<vec4f>;
fn graphInstruction(index:u32)->GraphInstruction {
 let p=index*4u;return GraphInstruction(graphData[p],graphData[p+1u],graphData[p+2u],graphData[p+3u]);
}
// Logical texture IDs stay stable when UDIM tiles expand into physical layers.
fn assetScalar(offset:u32)->f32 {return graphData[offset/4u][offset%4u];}
fn udimTexel(desc:GraphInstruction,pixel:vec2i,level:i32)->vec4f {
 let dims=vec2i(textureDimensions(bitmapArray,level));let tile=vec2i(floor(vec2f(pixel)/vec2f(dims)));
 if(tile.x<0||tile.x>9||tile.y<0||tile.y>99){return desc.value;}
 let address=u32(tile.y*10+tile.x);if(address>=u32(desc.op.z)){return desc.value;}
 let layer=i32(assetScalar(u32(desc.op.w)+address))-1;if(layer<0){return desc.value;}
 return textureLoad(bitmapArray,pixel-tile*dims,layer,level);
}
fn udimLevel(desc:GraphInstruction,uv:vec2f,level:i32)->vec4f {let size=vec2f(textureDimensions(bitmapArray,level));let p=uv*size-.5;let base=vec2i(floor(p));let f=fract(p);return mix(mix(udimTexel(desc,base,level),udimTexel(desc,base+vec2i(1,0),level),f.x),mix(udimTexel(desc,base+vec2i(0,1),level),udimTexel(desc,base+vec2i(1,1),level),f.x),f.y);}
fn sampleBitmap(index:u32,uv:vec2f,lod:f32)->vec4f {
 if(index>=u32(cam.assets.y)){return vec4f(1.);}
 let desc=graphInstruction(u32(cam.assets.x)+index);
 if(desc.op.x==0.){return textureSampleLevel(bitmapArray,bitmapSampler,uv,i32(desc.op.y),lod);}
 let level=clamp(lod,0.,f32(textureNumLevels(bitmapArray)-1u));let lo=i32(floor(level));let hi=min(lo+1,i32(textureNumLevels(bitmapArray))-1);return mix(udimLevel(desc,uv,lo),udimLevel(desc,uv,hi),fract(level));
}
// Graph DAGs are specialized here by materials/wgsl-graph.js before pipeline creation.
fn surfaceMaterial(index:u32,p:vec3f,uv:vec2f)->Material {
 var m=materials[index];m.base=vec4f(baseColor(m,p,uv),m.base.w);m.pattern.x=0.;m.pattern.z=0.;

 if(graphInstruction(u32(cam.assetInfo.x)+index).op.w>0.){m.pattern.x=-1.;m.pattern.z=f32(index);m.reserved.w=0.;m.params.y=0.;}
 return m;
}

// Four-order cylindrical R/TT/TRT fiber scattering. All functions are shared
// between the raster preview and compute integrators.
var<private> fiberTangent:vec3f;
var<private> fiberNormal:vec3f;
var<private> fiberRadius:f32;
fn setupFiber(t:Triangle,normal:vec3f){
 fiberTangent=vec3f(0.,1.,0.);fiberNormal=normal;fiberRadius=0.;
 if(FIBERS_ENABLED&&(u32(t.uv2.z)&8u)!=0u){
  var q=vec3f(t.n0.w,t.n1.w,1.-abs(t.n0.w)-abs(t.n1.w));
  if(q.z<0.){let xy=(vec2f(1.)-abs(q.yx))*select(vec2f(-1.),vec2f(1.),q.xy>=vec2f(0.));q=vec3f(xy,q.z);}
  fiberTangent=normalize(q);fiberRadius=t.n2.w;
 }
}
fn fiberBasis()->mat3x3f {
 let t=fiberTangent;var n=fiberNormal-t*dot(fiberNormal,t);
 if(dot(n,n)<1e-10){let a=select(vec3f(0.,1.,0.),vec3f(1.,0.,0.),abs(t.y)>.9);n=cross(t,a);}
 n=normalize(n);return mat3x3f(t,n,cross(t,n));
}
fn fiberLogI0(x:f32)->f32 {
 if(x<12.){var term=1.;var sum=1.;for(var k=1.;k<24.;k+=1.){term*=x*x/(4.*k*k);sum+=term;}return log(sum);}
 let r=1./x;return x-.5*log(2.*PI*x)+log(1.+r/8.+9.*r*r/128.+225.*r*r*r/3072.+11025.*r*r*r*r/98304.);
}
fn fiberLongitudinal(si:f32,so:f32,v:f32)->f32 {
 let ci=sqrt(max(0.,1.-si*si));let co=sqrt(max(0.,1.-so*so));let inv=1./v;
 return exp(fiberLogI0(ci*co*inv)-si*so*inv-inv)/(v*max(1e-8,1.-exp(-2.*inv)));
}
fn fiberCdf(x:f32,s:f32)->f32{return 1./(1.+exp(-x/s));}
fn fiberWrap(x:f32)->f32{return x-2.*PI*floor((x+PI)/(2.*PI));}
fn fiberFresnel(c:f32,eta:f32)->f32 {
 let s2=(1.-c*c)/(eta*eta);if(s2>=1.){return 1.;}let ct=sqrt(1.-s2);
 let a=(eta*c-ct)/(eta*c+ct);let b=(c-eta*ct)/(c+eta*ct);return (a*a+b*b)*.5;
}
struct FiberLobes {attenuation:array<vec3f,4>,variance:vec4f,s:f32,sinTheta:vec4f,phi:vec4f,probability:vec4f};
fn fiberLobes(m:Material,wo:vec3f)->FiberLobes {
 let desc=graphInstruction(u32(cam.assetInfo.x)+u32(m.pattern.z));
 let so=clamp(wo.x,-.999999,.999999);let co=sqrt(1.-so*so);let eta=desc.args.w;
 // The azimuthal offset of the impact point on a circular cross section.
 let h=clamp(wo.z/max(1e-6,length(wo.yz)),-.99999,.99999);
 let st=so/eta;let ct=sqrt(1.-st*st);let ep=sqrt(eta*eta-so*so)/co;
 let gt=asin(h/ep);let go=asin(h);let F=fiberFresnel(co*sqrt(1.-h*h),eta);
 let T=exp(-desc.args.xyz*2.*cos(gt)/ct);let a0=vec3f(F);let a1=(1.-F)*(1.-F)*T;let a2=a1*T*F;let a3=a2*T*F/max(vec3f(1e-12),vec3f(1.)-T*F);
 let r=desc.value.x;let az=desc.value.y;let v=pow(.726*r+.812*r*r+3.7*pow(r,20.),2.);
 let scale=sqrt(PI/8.)*(.265*az+1.194*az*az+5.372*pow(az,22.));let alpha=desc.value.z*PI/180.;let theta=asin(so);
 let weights=vec4f(dot(a0,vec3f(1./3.)),dot(a1,vec3f(1./3.)),dot(a2,vec3f(1./3.)),dot(a3,vec3f(1./3.)));
 return FiberLobes(array<vec3f,4>(a0,a1,a2,a3),vec4f(v,v*.25,v*4.,v*4.),scale,clamp(sin(vec4f(theta)+vec4f(-2.,1.,4.,4.)*alpha),vec4f(-.999999),vec4f(.999999)),vec4f(-2.*go,2.*gt-2.*go+PI,4.*gt-2.*go+2.*PI,0.),weights/max(1e-12,dot(weights,vec4f(1.))));
}
fn evaluateFiber(m:Material,n:vec3f,woWorld:vec3f,wiWorld:vec3f)->BSDF {
 let axes=transpose(fiberBasis());let wo=axes*woWorld;let wi=axes*wiWorld;let lobes=fiberLobes(m,wo);let phi=atan2(wi.z,wi.y)-atan2(wo.z,wo.y);var f=vec3f(0.);var pdf=0.;
 for(var p=0u;p<4u;p++){
  let x=fiberWrap(phi-lobes.phi[p]);let q=fiberCdf(x,lobes.s);var az=q*(1.-q)/(lobes.s*(fiberCdf(PI,lobes.s)-fiberCdf(-PI,lobes.s)));if(p==3u){az=1./(2.*PI);}
  let density=fiberLongitudinal(clamp(wi.x,-1.,1.),lobes.sinTheta[p],lobes.variance[p])*az;f+=lobes.attenuation[p]*density;pdf+=lobes.probability[p]*density;
 }
 return BSDF(f/max(1e-7,abs(dot(n,wiWorld))),pdf);
}
