@group(0) @binding(3) var<storage,read> pixels:array<vec4f>;
@group(0) @binding(6) var<storage,read> aovs:array<vec4f>;
struct VertexOut {@builtin(position) position:vec4f};
@vertex fn vertexMain(@builtin(vertex_index) i:u32)->VertexOut{let p=array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));return VertexOut(vec4f(p[i],0.,1.));}
@fragment fn fragmentMain(@builtin(position) position:vec4f)->@location(0) vec4f {
 let i=min(u32(position.y),u32(cam.size.y)-1u)*u32(cam.size.x)+min(u32(position.x),u32(cam.size.x)-1u);var color=pixels[i].rgb;
 if(cam.info.w==1.){color=aovs[i*5u].rgb;}
 if(cam.info.w==2.){return vec4f(aovs[i*5u+1u].rgb*.5+.5,1.);}
 if(cam.info.w==3.){return vec4f(vec3f(exp(-aovs[i*5u+1u].w*.08)),1.);}
 if(cam.info.w==4.){return vec4f(.5+.5*cos(vec3f(0.,2.,4.)+aovs[i*5u+2u].w*2.4),1.);}
 if(cam.info.w==5.){color=aovs[i*5u+2u].rgb;}
 if(cam.info.w==6.){color=aovs[i*5u+3u].rgb;}
 if(cam.info.w==7.){color=aovs[i*5u+4u].rgb;}
 return vec4f(displayColor(color),1.);
}
