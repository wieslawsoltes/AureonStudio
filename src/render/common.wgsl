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
fn evaluateBSDF(m:Material,color:vec3f,n:vec3f,wo:vec3f,wi:vec3f)->BSDF {let ni=max(dot(n,wi),0.);let no=max(dot(n,wo),0.);if(ni<=0.||no<=0.){return BSDF(vec3f(0.),0.);}let h=normalize(wi+wo);let nh=max(dot(n,h),0.);let oh=max(dot(wo,h),1e-6);let alpha=max(.025,m.base.w*m.base.w);let f0=mix(vec3f(pow((m.params.z-1.)/(m.params.z+1.),2.)),color,m.params.x);let F=fresnelSchlick(oh,f0);let D=ggxD(nh,alpha);let G=smithG1(ni,alpha)*smithG1(no,alpha);let spec=D*G*F/max(1e-6,4.*ni*no);let diffuse=(vec3f(1.)-F)*(1.-m.params.x)*color/PI;let ps=.25+.5*m.params.x;let pdf=mix(ni/PI,D*nh/(4.*oh),ps);return BSDF((diffuse+spec)*(1.-m.params.y),pdf*(1.-m.params.y));}

struct GraphInstruction {op:vec4f,args:vec4f,value:vec4f,extra:vec4f};
@group(1) @binding(0) var bitmapSampler:sampler;
@group(1) @binding(1) var bitmapArray:texture_2d_array<f32>;
@group(1) @binding(2) var<storage,read> graphCode:array<GraphInstruction>;
// Logical texture IDs stay stable when UDIM tiles expand into physical layers.
fn assetScalar(offset:u32)->f32 {let code=graphCode[offset/16u];let lane=offset%16u;if(lane<4u){return code.op[lane];}if(lane<8u){return code.args[lane-4u];}if(lane<12u){return code.value[lane-8u];}return code.extra[lane-12u];}
fn udimTexel(desc:GraphInstruction,pixel:vec2i,level:i32)->vec4f {
 let dims=vec2i(textureDimensions(bitmapArray,level));let tile=vec2i(floor(vec2f(pixel)/vec2f(dims)));
 if(tile.x<0||tile.x>9||tile.y<0||tile.y>99){return desc.value;}
 for(var i=0u;i<u32(desc.op.z);i++){let t=graphCode[u32(desc.op.w)+i].op;if(all(vec2i(t.xy)==tile)){return textureLoad(bitmapArray,pixel-tile*dims,i32(t.z),level);}}
 return desc.value;
}
fn udimLevel(desc:GraphInstruction,uv:vec2f,level:i32)->vec4f {let size=vec2f(textureDimensions(bitmapArray,level));let p=uv*size-.5;let base=vec2i(floor(p));let f=fract(p);return mix(mix(udimTexel(desc,base,level),udimTexel(desc,base+vec2i(1,0),level),f.x),mix(udimTexel(desc,base+vec2i(0,1),level),udimTexel(desc,base+vec2i(1,1),level),f.x),f.y);}
fn sampleBitmap(index:u32,uv:vec2f,lod:f32)->vec4f {
 if(index>=u32(cam.assets.y)){return vec4f(1.);}
 let desc=graphCode[u32(cam.assets.x)+index];
 if(desc.op.x==0.){return textureSampleLevel(bitmapArray,bitmapSampler,uv,i32(desc.op.y),lod);}
 let level=clamp(lod,0.,f32(textureNumLevels(bitmapArray)-1u));let lo=i32(floor(level));let hi=min(lo+1,i32(textureNumLevels(bitmapArray))-1);return mix(udimLevel(desc,uv,lo),udimLevel(desc,uv,hi),fract(level));
}
fn surfaceMaterial(index:u32,p:vec3f,uv:vec2f)->Material {
 var m=materials[index];m.base=vec4f(baseColor(m,p,uv),m.base.w);m.pattern.x=0.;m.pattern.z=0.;
 var values:array<vec4f,64>;let start=u32(m.pattern.w);let count=min(u32(m.reserved.x),64u);
 for(var i=0u;i<count;i++) {let code=graphCode[start+i];let op=u32(code.op.x);let ai=u32(max(code.args.x,0.));let bi=u32(max(code.args.y,0.));let ci=u32(max(code.args.z,0.));let a=values[ai];let b=values[bi];let c=values[ci];var v=code.value;
  switch(op) {
   case 0u: {}
   case 1u: {v=vec4f(uv,0.,1.);}
   case 2u: {v=vec4f(p,1.);}
   case 3u: {v=a+b;}
   case 4u: {v=a-b;}
   case 5u: {v=a*b;}
   case 6u: {v=a/select(b,vec4f(1e-8),abs(b)<vec4f(1e-8));}
   case 7u: {v=mix(a,b,c.x);}
   case 8u: {v=clamp(a,vec4f(code.value.x),vec4f(code.value.y));}
   case 9u: {let q=floor(a.xy*code.extra.x);v=select(c,b,(i32(q.x)+i32(q.y))%2==0);}
   case 10u: {let q=fract(sin(dot(a.xyz,vec3f(12.9898,78.233,37.719))*code.extra.x)*43758.5453);v=vec4f(q);}
   case 11u: {v=sampleBitmap(u32(code.extra.y),a.xy,cam.sampling.w);}
   case 12u: {v=mix(b,c,clamp(a.x,0.,1.));}
   case 13u: {v=sin(a);}
   case 14u: {v=vec4f(a[u32(clamp(code.extra.z,0.,3.))]);}
   case 15u: {v=pow(max(a,vec4f(0.)),b);}
   case 100u: {
    if(code.args.x>=0.){m.base=vec4f(max(values[u32(code.args.x)].rgb,vec3f(0.)),m.base.w);}
    if(code.args.y>=0.){m.base.w=clamp(values[u32(code.args.y)].x,0.,1.);}
    if(code.args.z>=0.){m.params.x=clamp(values[u32(code.args.z)].x,0.,1.);}
    if(code.args.w>=0.){m.params.w=max(0.,values[u32(code.args.w)].x);}
    if(code.value.x>=0.){m.params.y=clamp(values[u32(code.value.x)].x,0.,1.);}
    if(code.value.y>=0.){m.params.z=clamp(values[u32(code.value.y)].x,1.,3.);}
    if(code.value.z>=0.){m.reserved.w=clamp(values[u32(code.value.z)].x,0.,1.);}
    if(code.value.w>=0.){m.reserved.y=max(.001,values[u32(code.value.w)].x);}
   }
   default: {}
  }
  values[i]=v;
 }
 return m;
}
