// Edge-aware, five-tap a-trous wavelet filtering. Raw HDR remains untouched.
struct Params {width:u32,height:u32,step:u32,pad:u32};
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> source:array<vec4f>;
@group(0) @binding(2) var<storage,read> aovs:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> output:array<vec4f>;
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3u) {
 if(id.x>=params.width||id.y>=params.height){return;}let i=id.y*params.width+id.x;let normal=aovs[i*5u+1u];let albedo=aovs[i*5u];let object=aovs[i*5u+2u].w;let center=source[i].rgb;
 let kernel=array<f32,5>(1.,4.,6.,4.,1.);var sum=vec3f(0.);var weight=0.;
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){let q=vec2i(id.xy)+vec2i(x,y)*i32(params.step);if(any(q<vec2i(0))||q.x>=i32(params.width)||q.y>=i32(params.height)){continue;}let j=u32(q.y)*params.width+u32(q.x);let nj=aovs[j*5u+1u];let aj=aovs[j*5u];let oj=aovs[j*5u+2u].w;if(object!=oj){continue;}let nd=select(pow(max(dot(normal.xyz,nj.xyz),0.),32.),1.,object==0.);let depth=exp(-abs(normal.w-nj.w)/max(.005,.02*(1.+normal.w)*f32(params.step)));let ad=exp(-dot(albedo.rgb-aj.rgb,albedo.rgb-aj.rgb)/.08);let color=source[j].rgb;let cd=exp(-length(color-center)/max(.15,length(center)*.45));let w=kernel[u32(x+2)]*kernel[u32(y+2)]*nd*depth*ad*cd;sum+=color*w;weight+=w;}}
 output[i]=vec4f(select(center,sum/max(weight,1e-12),weight>0.),1.);
}
