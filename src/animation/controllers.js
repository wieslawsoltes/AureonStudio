/** Serializable animation controllers and constraints. No eval/Function/script execution.
 * A bounded expression AST can drive any local TRS component. World constraints
 * share the scene dependency graph, so cycles are rejected rather than iterated.
 */
import {add,sub,mul,dot,cross,normalize,matMul,clamp} from '../core/math.js';
import {quatEuler,eulerQuat,quatMatrix,matrixQuat,quatMul,quatConjugate,quatFromTo,quatNormalize,slerp,boneWorlds} from './rig.js';
const vec=(x,n=3)=>Array.isArray(x)&&x.length===n&&x.every(Number.isFinite);
export function decomposeTRS(m,{allowShear=false}={}) {
    if(m.length!==16||!m.every(Number.isFinite))throw Error('Invalid transform matrix');
    const s=[0,1,2].map(i=>Math.hypot(...m.slice(i*4,i*4+3)));
    if(s.some(v=>v<1e-12))throw Error('Cannot decompose a singular transform');
    if(dot(m.slice(0,3),cross(m.slice(4,7),m.slice(8,11)))<0)s[0]*=-1;
    const r=m.slice();for(let c=0;c<3;c++)for(let j=0;j<3;j++)r[c*4+j]/=s[c];
    if(!allowShear&&[dot(r.slice(0,3),r.slice(4,7)),dot(r.slice(0,3),r.slice(8,11)),dot(r.slice(4,7),r.slice(8,11))].some(x=>Math.abs(x)>1e-5))throw Error('TRS constraint cannot preserve a sheared transform; bake the parent scale');
    return {position:m.slice(12,15),rotation:matrixQuat(r),scale:s};
}
const functions={add:(a,b)=>a+b,sub:(a,b)=>a-b,mul:(a,b)=>a*b,div:(a,b)=>{if(!b)throw Error('Controller division by zero');return a/b;},pow:Math.pow,min:Math.min,max:Math.max,sin:Math.sin,cos:Math.cos,tan:Math.tan,abs:Math.abs,sqrt:Math.sqrt,floor:Math.floor,ceil:Math.ceil,neg:a=>-a,clamp:(a,b,c)=>clamp(a,b,c),mix:(a,b,t)=>a+(b-a)*t};
export function evaluateExpression(expression,context={},budget={nodes:0},depth=0){
    if(++budget.nodes>512||depth>32)throw Error('Controller expression budget exceeded');
    if(typeof expression==='number'){if(!Number.isFinite(expression))throw Error('Nonfinite controller constant');return expression;}
    if(!expression||typeof expression!=='object'||Array.isArray(expression))throw Error('Invalid controller expression');
    let value;if(expression.variable){if(!['frame','time','pi','fps'].includes(expression.variable))throw Error('Unknown controller variable');value=expression.variable==='pi'?Math.PI:context[expression.variable];}
    else if(expression.ref){const r=expression.ref;if(typeof r.object!=='string'||!['position','rotation','scale'].includes(r.path)||!Number.isInteger(r.axis)||r.axis<0||r.axis>2)throw Error('Invalid controller reference');const m=context.resolve?.(r.object);if(!m)throw Error('Missing controller target');const p=decomposeTRS(m);value=(r.path==='rotation'?eulerQuat(p.rotation):p[r.path])[r.axis];}
    else{const f=functions[expression.op],args=expression.args;if(!f||!Array.isArray(args)||args.length<1||args.length>3)throw Error('Unknown controller operator');const arity={sin:1,cos:1,tan:1,abs:1,sqrt:1,floor:1,ceil:1,neg:1,clamp:3,mix:3}[expression.op]||2;if(args.length!==arity)throw Error('Controller operator arity mismatch');value=f(...args.map(a=>evaluateExpression(a,context,budget,depth+1)));}
    if(!Number.isFinite(value))throw Error('Controller produced a nonfinite value');return value;
}
export function evaluateCurve(keys,frame,{interpolation='linear',extrapolation='constant'}={}){
    if(!Array.isArray(keys)||!keys.length||keys.some((k,i)=>!Number.isFinite(k.frame)||!Number.isFinite(k.value)||i&&k.frame<=keys[i-1].frame))throw Error('Invalid scalar animation curve');
    if(!['linear','step','bezier'].includes(interpolation)||!['constant','linear','cycle','pingpong'].includes(extrapolation))throw Error('Unknown curve interpolation/extrapolation');
    const first=keys[0],last=keys.at(-1),duration=last.frame-first.frame;if(!duration)return first.value;
    if(extrapolation==='cycle'||extrapolation==='pingpong'){let t=(frame-first.frame)/duration;if(t<0||t>1){const cycle=Math.floor(t);t-=cycle;if(extrapolation==='pingpong'&&Math.abs(cycle)%2)t=1-t;frame=first.frame+t*duration;}}
    if(frame<=first.frame)return extrapolation==='linear'?first.value+(frame-first.frame)*(interpolation==='step'?0:interpolation==='bezier'&&first.outSlope!==undefined?first.outSlope:(keys[1].value-first.value)/(keys[1].frame-first.frame)):first.value;
    if(frame>=last.frame)return extrapolation==='linear'?last.value+(frame-last.frame)*(interpolation==='step'?0:interpolation==='bezier'&&last.inSlope!==undefined?last.inSlope:(last.value-keys.at(-2).value)/(last.frame-keys.at(-2).frame)):last.value;
    const i=keys.findIndex(k=>k.frame>=frame),a=keys[i-1],b=keys[i],dt=b.frame-a.frame,t=(frame-a.frame)/dt;if(interpolation==='step')return a.value;if(interpolation==='linear')return a.value+(b.value-a.value)*t;
    const slope=(b.value-a.value)/dt,ma=a.outSlope??slope,mb=b.inSlope??slope;if(!Number.isFinite(ma)||!Number.isFinite(mb))throw Error('Invalid Bezier tangent');return (2*t**3-3*t*t+1)*a.value+(t**3-2*t*t+t)*ma*dt+(-2*t**3+3*t*t)*b.value+(t**3-t*t)*mb*dt;
}
export function applyControllers(pose,controllers,context){
    const out={position:[...pose.position],rotation:[...pose.rotation],scale:[...pose.scale]};
    for(const c of controllers||[]){if(c.enabled===false)continue;if(!['position','rotation','scale'].includes(c.path)||!Number.isInteger(c.axis)||c.axis<0||c.axis>2)throw Error('Invalid controller destination');
        const v=c.kind==='curve'?evaluateCurve(c.keys,context.frame,c):c.kind==='expression'?evaluateExpression(c.expression,context):c.kind==='oscillator'?(c.offset??0)+(c.amplitude??1)*Math.sin((context.time*(c.frequency??1)*Math.PI*2)+(c.phase??0)):NaN;
        if(!Number.isFinite(v))throw Error('Invalid animation controller');const weight=c.weight??1;if(!Number.isFinite(weight)||weight<0||weight>1)throw Error('Invalid controller blend weight');out[c.path][c.axis]+=(v-out[c.path][c.axis])*weight;
    }
    if(out.scale.some(x=>Math.abs(x)<1e-8))throw Error('Controller produced singular scale');return out;
}
export function aimRotation(direction,up=[0,1,0],forwardAxis=[0,0,1],upAxis=[0,1,0]){
    if(![direction,up,forwardAxis,upAxis].every(v=>vec(v)&&Math.hypot(...v)>1e-8)||Math.abs(dot(normalize(forwardAxis),normalize(upAxis)))>.999)throw Error('Invalid aim axes');
    const d=normalize(direction),q=quatFromTo(forwardAxis,d),r=quatMatrix(q),u=[0,1,2].map(i=>r[i]*upAxis[0]+r[4+i]*upAxis[1]+r[8+i]*upAxis[2]),a=sub(u,mul(d,dot(u,d))),b=sub(up,mul(d,dot(up,d)));
    if(Math.hypot(...a)<1e-8||Math.hypot(...b)<1e-8)return q;const angle=Math.atan2(dot(d,cross(normalize(a),normalize(b))),dot(normalize(a),normalize(b))),s=Math.sin(angle/2);return quatNormalize(quatMul([...mul(d,s),Math.cos(angle/2)],q));
}
function catmull(points,t,closed){const n=points.length,segments=closed?n:n-1,v=clamp(t,0,1)*segments,k=Math.min(segments-1,Math.floor(v)),u=v-k,p=i=>points[closed?(i%n+n)%n:clamp(i,0,n-1)];return [0,1,2].map(i=>.5*((2*p(k)[i])+(-p(k-1)[i]+p(k+1)[i])*u+(2*p(k-1)[i]-5*p(k)[i]+4*p(k+1)[i]-p(k+2)[i])*u*u+(-p(k-1)[i]+3*p(k)[i]-3*p(k+1)[i]+p(k+2)[i])*u**3));}
export function samplePath(points,t,{closed=false,arcLength=true,resolution=256}={}){
    if(!Array.isArray(points)||points.length<2||points.length>4096||!points.every(p=>vec(p))||!Number.isFinite(t)||!Number.isInteger(resolution)||resolution<8||resolution>4096)throw Error('Invalid path constraint');
    t=closed?((t%1)+1)%1:clamp(t,0,1);let u=t;
    if(arcLength){const lengths=[0];let last=points[0];for(let i=1;i<=resolution;i++){const p=catmull(points,i/resolution,closed);lengths.push(lengths.at(-1)+Math.hypot(...sub(p,last)));last=p;}const target=t*lengths.at(-1);let j=lengths.findIndex(x=>x>=target);j=Math.max(1,j);u=(j-1+(target-lengths[j-1])/Math.max(1e-12,lengths[j]-lengths[j-1]))/resolution;}
    const position=catmull(points,u,closed),h=1e-5,tangent=normalize(sub(catmull(points,Math.min(1,u+h),closed),catmull(points,Math.max(0,u-h),closed)));return {position,tangent};
}
function blend(a,b,w){return {position:a.position.map((v,i)=>v+(b.position[i]-v)*w),rotation:slerp(a.rotation,b.rotation,w),scale:a.scale.map((v,i)=>v+(b.scale[i]-v)*w)};}
export function applyConstraints(matrix,constraints,context){
    if(!constraints?.some(c=>c.enabled!==false))return matrix;
    let p=decomposeTRS(matrix);
    for(const c of constraints){if(c.enabled===false)continue;const w=typeof c.influence==='object'?evaluateExpression(c.influence,context):c.influence??1;if(!Number.isFinite(w)||w<0||w>1)throw Error('Invalid constraint influence');if(!w)continue;let desired={position:[...p.position],rotation:[...p.rotation],scale:[...p.scale]};
        if(['copyPosition','copyRotation','copyScale','parent'].includes(c.type)){const target=context.resolve(c.target);if(!target)throw Error('Missing constraint target');const q=decomposeTRS(c.offset?matMul(target,c.offset):target);if(c.type==='parent')desired=q;else if(c.type==='copyPosition')desired.position=q.position;else if(c.type==='copyRotation')desired.rotation=q.rotation;else desired.scale=q.scale;}
        else if(c.type==='aim'){const target=context.resolve(c.target);if(!target)throw Error('Missing aim target');const d=sub(target.slice(12,15),p.position);if(Math.hypot(...d)>1e-8)desired.rotation=aimRotation(d,c.up,c.forwardAxis,c.upAxis);}
        else if(c.type==='limit'){for(const key of ['position','rotation','scale'])if(c[key]){const v=key==='rotation'?eulerQuat(p.rotation):p[key],limits=c[key];if(!vec(limits.min)||!vec(limits.max)||limits.min.some((x,i)=>x>limits.max[i]))throw Error('Invalid constraint limits');const clamped=v.map((x,i)=>clamp(x,limits.min[i],limits.max[i]));desired[key]=key==='rotation'?quatEuler(clamped):clamped;}}
        else if(c.type==='path'){const t=typeof c.parameter==='object'?evaluateExpression(c.parameter,context):c.parameter??0,q=samplePath(c.points,t,c);desired.position=q.position;if(c.follow)desired.rotation=aimRotation(q.tangent,c.up,c.forwardAxis,c.upAxis);}
        else if(c.type==='blendParents'){if(!Array.isArray(c.targets)||!c.targets.length||c.targets.length>64)throw Error('Invalid parent constraint list');let sum=0,acc=null;for(const target of c.targets){const weight=target.weight??1;if(!Number.isFinite(weight)||weight<0)throw Error('Invalid parent weight');if(!weight)continue;const m=context.resolve(target.id);if(!m)throw Error('Missing parent constraint target');const q=decomposeTRS(target.offset?matMul(m,target.offset):m);sum+=weight;acc=acc?blend(acc,q,weight/sum):q;}if(acc)desired=acc;}
        else throw Error('Unknown constraint '+c.type);
        p=blend(p,desired,w);
    }
    if(p.scale.some(x=>Math.abs(x)<1e-8))throw Error('Constraint produced singular scale');return quatMatrix(p.rotation,p.position,p.scale);
}
export function constraintDependencies(object){const ids=new Set(object.parent?[object.parent]:[]);for(const c of object.constraints||[]){if(c.enabled===false)continue;if(c.target)ids.add(c.target);for(const t of c.targets||[])ids.add(t.id);}const walk=(v,depth=0)=>{if(depth>32)throw Error('Expression depth exceeded');if(v&&typeof v==='object'){if(v.ref)ids.add(v.ref.object);for(const x of Object.values(v))walk(x,depth+1);}};walk(object.controllers);for(const c of object.constraints||[]){walk(c.influence);walk(c.parameter);}return ids;}
export function validateDependencies(objects){const map=new Map(objects.map(o=>[o.id,o])),seen=new Set(),visiting=new Set();function visit(id){if(seen.has(id))return;if(visiting.has(id))throw Error('Cyclic constraint/controller dependency');const o=map.get(id);if(!o)throw Error('Missing constraint/controller target');visiting.add(id);for(const target of constraintDependencies(o))visit(target);visiting.delete(id);seen.add(id);}objects.forEach(o=>visit(o.id));}
/** Bind-space retargeting. Mapped global rotation deltas are transferred through
 * an optional coordinate-system alignment; target bone lengths remain unchanged.
 * Root translations are scaled explicitly. Keys are baked, not live script links.
 */
export function retargetRig(source,target,mapping,{start=0,end=120,step=1,rootScale=1,alignment=[0,0,0,1],translateRoot=true}={}){
    if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(step)||step<=0||end<start||(end-start)/step>10000||!Number.isFinite(rootScale)||rootScale<=0||!vec(alignment,4))throw Error('Invalid retarget bake range');
    if(!source.inverseBind||!target.inverseBind)throw Error('Retargeting requires bound skeletons');
    const out=structuredClone(target),sRest=source.inverseBind.map(invertRigidBind),tRest=target.inverseBind.map(invertRigidBind),sourceMap=new Map(source.bones.map((b,i)=>[b.name,i])),targetMap=new Map(target.bones.map((b,i)=>[b.name,i])),pairs=new Map();
    for(const [dst,src] of Object.entries(mapping)){const di=targetMap.has(dst)?targetMap.get(dst):Number(dst),si=sourceMap.has(src)?sourceMap.get(src):Number(src);if(!Number.isInteger(di)||!Number.isInteger(si)||!target.bones[di]||!source.bones[si]||pairs.has(di))throw Error('Invalid retarget bone mapping');pairs.set(di,si);}
    if(!pairs.size)throw Error('Retargeting has no mapped joints');for(const b of out.bones)b.keys=[];
    const align=quatNormalize(alignment),invAlign=quatConjugate(align);
    for(let frame=start;frame<=end+1e-9;frame+=step){const sw=boneWorlds(source,frame).map(decomposeTRS),desired=[];
        function visit(i){if(desired[i])return desired[i];const b=target.bones[i],parent=b.parent>=0?visit(b.parent):null,si=pairs.get(i),rest=tRest[i],local=decomposeTRS(quatMatrix(b.rotation||[0,0,0,1],b.position||[0,0,0],b.scale||[1,1,1]));let q=parent?quatMul(parent.rotation,local.rotation):local.rotation;
            if(si!==undefined){const delta=quatMul(sw[si].rotation,quatConjugate(sRest[si].rotation));q=quatMul(quatMul(align,quatMul(delta,invAlign)),rest.rotation);}
            let pos=[...local.position];if(translateRoot&&b.parent<0&&si!==undefined){const delta=mul(sub(sw[si].position,sRest[si].position),rootScale),m=quatMatrix(align);pos=add(pos,[0,1,2].map(k=>m[k]*delta[0]+m[k+4]*delta[1]+m[k+8]*delta[2]));}
            const localQ=parent?quatMul(quatConjugate(parent.rotation),q):q;out.bones[i].keys.push({frame,position:pos,rotation:quatNormalize(localQ),scale:[...local.scale]});const world=parent?matMul(quatMatrix(parent.rotation,parent.position,parent.scale),quatMatrix(localQ,pos,local.scale)):quatMatrix(localQ,pos,local.scale);return desired[i]=decomposeTRS(world);
        }target.bones.forEach((_,i)=>visit(i));
    }return out;
}
// General affine inversion is needed for bind matrices that include uniform scale.
import {inverse} from '../core/math.js';
function invertRigidBind(m){return decomposeTRS(inverse(m));}
