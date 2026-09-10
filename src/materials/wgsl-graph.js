/** Material DAG -> straight-line WGSL. Graph values stay in the storage buffer;
 * only opcode/connectivity changes require new GPU pipelines. No imported source
 * or JavaScript is evaluated. Fixed node references eliminate dynamic register
 * indexing and its pathological compilation cost on software GPU drivers.
 */
import {compileGraphs} from './graph.js';
export const BASE_SURFACE=`fn surfaceMaterial(index:u32,p:vec3f,uv:vec2f)->Material {
 var m=materials[index];m.base=vec4f(baseColor(m,p,uv),m.base.w);m.pattern.x=0.;m.pattern.z=0.;
 /* MATERIAL_CASES */
 if(graphInstruction(u32(cam.assetInfo.x)+index).op.w>0.){m.pattern.x=-1.;m.pattern.z=f32(index);m.reserved.w=0.;m.params.y=0.;}
 return m;
}`;
export function compileMaterialWGSL(materials){
 const graphs=compileGraphs(materials),functions=[],cases=[];let total=0;
 for(let mi=0;mi<graphs.ranges.length;mi++){
  const range=graphs.ranges[mi];if(!range.count)continue;
  total+=range.count;if(total>4096)throw Error('Material pipeline exceeds 4096 graph instructions');
  const lines=[`fn materialGraph${mi}(p:vec3f,uv:vec2f,base:Material)->Material {`,` var m=base;let start=u32(m.pattern.w);`];
  for(let j=0;j<range.count;j++){
   const at=(range.offset+j)*16,op=graphs.data[at],c=`c${j}`;
   const reg=k=>{const n=graphs.data[at+4+k];if(!Number.isInteger(n)||n<0||n>=j)throw Error('Invalid material DAG dependency');return `r${n}`;};
   const a=op>2&&op!==100?reg(0):null,b=[3,4,5,6,7,9,12,15].includes(op)?reg(1):null,v=[7,9,12].includes(op)?reg(2):null;
   lines.push(` let ${c}=graphInstruction(start+${j}u);`);let expr;
   switch(op){
    case 0:expr=`${c}.value`;break;
    case 1:expr='vec4f(uv,0.,1.)';break;
    case 2:expr='vec4f(p,1.)';break;
    case 3:expr=`${a}+${b}`;break;
    case 4:expr=`${a}-${b}`;break;
    case 5:expr=`${a}*${b}`;break;
    case 6:expr=`${a}/select(${b},vec4f(1e-8),abs(${b})<vec4f(1e-8))`;break;
    case 7:expr=`mix(${a},${b},${v}.x)`;break;
    case 8:expr=`clamp(${a},vec4f(${c}.value.x),vec4f(${c}.value.y))`;break;
    case 9:lines.push(` let q${j}=floor(${a}.xy*${c}.extra.x);`);expr=`select(${v},${b},(i32(q${j}.x)+i32(q${j}.y))%2==0)`;break;
    case 10:expr=`vec4f(fract(sin(dot(${a}.xyz,vec3f(12.9898,78.233,37.719))*${c}.extra.x)*43758.5453))`;break;
    case 11:expr=`sampleBitmap(u32(${c}.extra.y),${a}.xy,cam.sampling.w)`;break;
    case 12:expr=`mix(${b},${v},clamp(${a}.x,0.,1.))`;break;
    case 13:expr=`sin(${a})`;break;
    case 14:expr=`vec4f(${a}[u32(clamp(${c}.extra.z,0.,3.))])`;break;
    case 15:expr=`pow(max(${a},vec4f(0.)),${b})`;break;
    case 100:{
     const output=k=>graphs.data[at+4+k]>=0?reg(k):null;
     const assignments=[x=>`m.base=vec4f(max(${x}.rgb,vec3f(0.)),m.base.w);`,x=>`m.base.w=clamp(${x}.x,0.,1.);`,x=>`m.params.x=clamp(${x}.x,0.,1.);`,x=>`m.params.w=max(0.,${x}.x);`,x=>`m.params.y=clamp(${x}.x,0.,1.);`,x=>`m.params.z=clamp(${x}.x,1.,3.);`,x=>`m.reserved.w=clamp(${x}.x,0.,1.);`,x=>`m.reserved.y=max(.001,${x}.x);`];
     for(let k=0;k<8;k++){const x=output(k);if(x)lines.push(' '+assignments[k](x));}
     continue;
    }
    default:throw Error('Unsupported material graph instruction');
   }
   lines.push(` let r${j}=${expr};`);
  }
  lines.push(' return m;\n}');functions.push(lines.join('\n'));cases.push(` if(index==${mi}u){m=materialGraph${mi}(p,uv,m);}`);
 }
 const source=functions.join('\n')+'\n'+BASE_SURFACE.replace('/* MATERIAL_CASES */',cases.join('\n'));
 if(source.length>2_000_000)throw Error('Generated material shader exceeds source budget');
 const fibers=materials.some(m=>!!m.fiber);
 return {source,key:`fiber:${fibers}\n${source}`,fibers,instructions:total};
}
export function specializeMaterialSource(common,materials){const a=common.indexOf('fn surfaceMaterial(');if(a<0)throw Error('Common shader lacks material insertion point');const start=common.indexOf('{',a);let end=start+1,depth=1;for(;depth&&end<common.length;end++){if(common[end]==='{')depth++;else if(common[end]==='}')depth--;}
 if(depth)throw Error('Unbalanced common shader material function');const shader=compileMaterialWGSL(materials);const code=common.slice(0,a)+shader.source+common.slice(end);return {...shader,code:code.replace('const FIBERS_ENABLED:bool=false;',`const FIBERS_ENABLED:bool=${shader.fibers};`)};}
