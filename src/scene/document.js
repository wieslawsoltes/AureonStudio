import {validateVolume} from '../volumes/grid.js';
import {SceneSimulationCache} from '../simulation/scene-world.js';
import {applyControllers,applyConstraints,validateDependencies} from '../animation/controllers.js';
import {skinMesh,validateRig} from '../animation/rig.js';
import {sampleObjectTracks} from '../animation/tracks.js';
import {SimulationCache} from '../simulation/physics.js';
import {generateHair,curvesToMesh,simulateHair,sampleParticles,particlesToMesh} from '../simulation/curves.js';
import {compileGraph} from '../materials/graph.js';
import {validateTexture} from '../materials/textures.js';
import { compose, matMul, identity, lerp, clamp, inverse } from '../core/math.js';
import { createPrimitive, DEFAULT_PARAMS } from '../geometry/primitives.js';
import { evaluateModifiers, MODIFIERS } from '../geometry/modifiers.js';
import { validateMesh } from '../geometry/mesh.js';
let counter = 0;
export const uid = () => `a${Date.now().toString(36)}${(++counter).toString(36)}`;
export function material(name, color, options = {}) {
    return { id: uid(), name, color, roughness: .35, metallic: 0, transmission: 0, ior: 1.5, emission: 0, pattern: 'solid', patternScale: 3, ...options };
}
export const newObject = (type, params = {}, name) => ({ id: uid(), name: name || type[0].toUpperCase() + type.slice(1), type, params: { ...structuredClone(DEFAULT_PARAMS[type] || {}), ...params }, mesh: null, parent: null, visible: true, locked: false, material: 0, position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], modifiers: [], keys: [] });
export function emptyDocument() {
    return { format: 'aureon-studio', version: 1, name: 'Untitled scene', objects: [], materials: [material('Porcelain', '#deddd9'), material('Brushed titanium', '#aebbc9', { metallic: 1, roughness: .24 }), material('Burnished copper', '#d9956e', { metallic: 1, roughness: .19 }), material('Obsidian', '#292d36', { metallic: .25, roughness: .25 }), material('Cobalt ceramic', '#315d91', { roughness: .22 }), material('Sage lacquer', '#778c78', { roughness: .28 }), material('Optical glass', '#fafbff', { roughness: 0, transmission: 1 }), material('Softbox', '#ffffff', { emission: 12 })], camera: { target: [0, 1.3, 0], yaw: .56, pitch: .4, distance: 8.5, fov: 42, projection: 'perspective', aperture: 0, focus: 8.5 }, settings: { samples: 128, bounces: 6, exposure: .2, environment: .5, resolution: .75, view: 'beauty' }, animation: { start: 0, end: 120, fps: 24, frame: 0, interpolation: 'smooth' } };
}
export function demoDocument() {
    const d = emptyDocument();
    d.name = 'Orbit study';
    d.materials.push(material('Studio gray', '#aaa9a6', { roughness: .7 }));
    const add = (type, params, name, material, position, rotation = [0, 0, 0], scale = [1, 1, 1]) => {
        const o = newObject(type, params, name);
        Object.assign(o, { material, position, rotation, scale });
        d.objects.push(o);
        return o;
    };
    add('plane', { width: 200, depth: 200 }, 'Studio floor', 8, [0, -.09, 0]);
    add('cylinder', { radius: 2.5, height: .22, segments: 80 }, 'Exhibition plinth', 3, [0, .04, 0]);
    add('cylinder', { radius: 1.75, height: .15, segments: 64 }, 'Raised stage', 0, [-.15, .225, 0]);
    add('torus', { radius: 1.32, tube: .22, segments: 72, sides: 24 }, 'Orbit · copper', 2, [-.7, 1.83, -.35], [90, 0, -18]);
    add('sphere', { radius: .72, segments: 40, rings: 28 }, 'Satellite · porcelain', 0, [.72, 1.02, .58]);
    add('sphere', { radius: .43, segments: 32, rings: 20 }, 'Satellite · titanium', 1, [-1, .73, .65]);
    add('box', { width: .8, height: 1.45, depth: .8 }, 'Monolith · cobalt', 4, [1.05, 1.02, -.65], [0, 20, 0]);
    add('sphere', { radius: .3, segments: 24, rings: 16 }, 'Satellite · sage', 5, [1.65, .45, .65]);
    const key = add('plane', { width: 4, depth: 4 }, 'Key softbox', 7, [-3, 6, 3], [155, 0, -22]);
    key.hiddenInViewport = true;
    key.cameraVisible = false;
    const fill = add('plane', { width: 3, depth: 4 }, 'Rim softbox', 7, [3, 4, -4], [45, 0, 30]);
    fill.hiddenInViewport = true;
    fill.cameraVisible = false;
    return d;
}
export function validateDocument(d) {
    if (d?.format !== 'aureon-studio' || d.version !== 1)
        throw Error('Not an Aureon Studio v1 document');
    if (!Array.isArray(d.objects) || !Array.isArray(d.materials) || !d.materials.length)
        throw Error('Document is missing objects or materials');
    if (d.objects.length > 10000)
        throw Error('Scene object limit exceeded');
    const ids = new Set();
    for (const o of d.objects) {
        if (typeof o.id !== 'string' || ids.has(o.id))
            throw Error('Object IDs must be unique');
        ids.add(o.id);
        if (typeof o.name !== 'string')
            throw Error('Invalid object name');
        for (const k of ['position', 'rotation', 'scale'])
            if (!Array.isArray(o[k]) || o[k].length !== 3 || !o[k].every(Number.isFinite))
                throw Error(`Invalid ${k}`);
        if (o.scale.some(v => Math.abs(v) < .0001))
            throw Error('Scale cannot be zero');
        if (!Number.isInteger(o.material) || !d.materials[o.material])
            throw Error('Invalid material reference');
        if (o.type === 'mesh')
            validateMesh(o.mesh);
        else
            createPrimitive(o.type, o.params);
        if (!Array.isArray(o.modifiers) || o.modifiers.some(m => !MODIFIERS[m.type] || !Number.isFinite(m.value)))
            throw Error('Invalid modifier stack');
        if (!Array.isArray(o.keys))
            throw Error('Invalid animation keys');
        for (const k of o.keys) {
            if (!Number.isFinite(k.frame))
                throw Error('Invalid keyframe');
            for (const p of ['position', 'rotation', 'scale'])
                if (!Array.isArray(k[p]) || k[p].length !== 3 || !k[p].every(Number.isFinite))
                    throw Error('Invalid key transform');
        }
    }
    for (const o of d.objects) {
        const seen = new Set([o.id]);
        let parent = o.parent;
        while (parent) {
            if (seen.has(parent))
                throw Error('Cyclic hierarchy');
            seen.add(parent);
            const p = d.objects.find(x => x.id === parent);
            if (!p)
                throw Error('Missing parent');
            parent = p.parent;
        }
    }
    for (const m of d.materials) {
        if (!/^#[\da-f]{6}$/i.test(m.color))
            throw Error('Invalid material color');
        for (const k of ['roughness', 'metallic', 'transmission', 'ior', 'emission', 'patternScale'])
            if (!Number.isFinite(m[k]))
                throw Error('Invalid material parameter');
        if (!['solid', 'checker', 'marble', 'wood'].includes(m.pattern))
            throw Error('Unknown procedural material');
        if (m.roughness < 0 || m.roughness > 1 || m.metallic < 0 || m.metallic > 1 || m.transmission < 0 || m.transmission > 1 || m.ior < 1 || m.ior > 3 || m.emission < 0)
            throw Error('Material parameter out of range');
    }
    if (!d.camera || !d.settings || !d.animation)
        throw Error('Missing scene settings');
    for (const k of ['yaw', 'pitch', 'distance', 'fov', 'aperture', 'focus'])
        if (!Number.isFinite(d.camera[k]))
            throw Error('Invalid camera');
    if (!Array.isArray(d.camera.target) || d.camera.target.length !== 3 || !d.camera.target.every(Number.isFinite))
        throw Error('Invalid camera target');
    if (d.camera.distance <= 0 || d.camera.fov <= 0 || d.camera.fov >= 179)
        throw Error('Invalid camera lens');
    for (const k of ['samples', 'bounces', 'exposure', 'environment', 'resolution'])
        if (!Number.isFinite(d.settings[k]))
            throw Error('Invalid render settings');
    if (d.settings.samples < 1 || d.settings.bounces < 1 || d.settings.bounces > 32 || d.settings.resolution <= 0 || d.settings.resolution > 2)
        throw Error('Render settings out of range');
    for (const k of ['start', 'end', 'frame', 'fps'])
        if (!Number.isFinite(d.animation[k]))
            throw Error('Invalid animation range');
    if (d.animation.end <= d.animation.start || d.animation.fps <= 0)
        throw Error('Invalid animation range');
    for(const t of d.textures||[])validateTexture(t);
    for(const m of d.materials){
        if(m.graph)compileGraph(m.graph);
        if(m.bitmap!==undefined&&(!Number.isInteger(m.bitmap)||!d.textures?.[m.bitmap]))throw Error('Missing material bitmap');
        if(m.subsurface){const q=m.subsurface;if(!Number.isFinite(q.weight)||q.weight<0||q.weight>1||!Number.isFinite(q.density)||q.density<=0||!Number.isFinite(q.anisotropy)||Math.abs(q.anisotropy)>=1)throw Error('Invalid subsurface medium');}
        for(const n of m.graph?.nodes||[])if(n.type==='image'&&!d.textures?.[n.texture])throw Error('Shader graph references a missing bitmap');
    }
    if(d.volume){const v=d.volume;if(!Number.isFinite(v.density)||v.density<0||!Number.isFinite(v.anisotropy)||Math.abs(v.anisotropy)>=1||!Array.isArray(v.min)||!Array.isArray(v.max)||!Array.isArray(v.color)||v.min.length!==3||v.max.length!==3||v.color.length!==3||![...v.min,...v.max,...v.color].every(Number.isFinite)||v.min.some((x,i)=>x>=v.max[i])||v.color.some(x=>x<0||x>1))throw Error('Invalid homogeneous volume');}
    if(d.settings.integrator&&!['path','photon','finalGather'].includes(d.settings.integrator))throw Error('Invalid integrator');
    for(const o of d.objects){
        if(o.materialSlots?.some(i=>!Number.isInteger(i)||!d.materials[i]))throw Error('Invalid object material slots');
        if(o.meshCache){const fs=o.meshCache.frames;if(!Array.isArray(fs)||!fs.length||fs.some((f,i)=>!Number.isFinite(f.frame)||i&&f.frame<=fs[i-1].frame||!Array.isArray(f.positions)||f.positions.length!==o.mesh?.positions.length||!f.positions.every(Number.isFinite)))throw Error('Invalid deformation cache');}
        if(o.rig){validateRig(o.rig,o.rig.weights.length/4);if(o.rig.externalJoints?.some(id=>!d.objects.some(x=>x.id===id)))throw Error('Missing external skeleton joint');}
        if(o.procedural?.kind==='hair'&&!d.objects.some(x=>x.id===o.procedural.source&&x.id!==o.id))throw Error('Missing hair source object');
        if(o.morphTargets?.some(m=>!Array.isArray(m)||m.length!==o.mesh?.positions.length||!m.every(Number.isFinite)))throw Error('Invalid morph target');
        for(const t of o.tracks||[]){if(!['translation','rotation','scale','weights'].includes(t.path)||!['STEP','LINEAR','CUBICSPLINE'].includes(t.interpolation)||!Array.isArray(t.times)||!t.times.length||t.times.some((x,i)=>!Number.isFinite(x)||x<0||i&&x<=t.times[i-1])||!Array.isArray(t.values)||!t.values.every(Number.isFinite)||t.values.length!==t.times.length*t.components*(t.interpolation==='CUBICSPLINE'?3:1))throw Error('Invalid imported animation track');}
    }
    if(d.volumes){if(!Array.isArray(d.volumes)||d.volumes.length>32)throw Error('Invalid volume collection');d.volumes.forEach(validateVolume);}
    validateDependencies(d.objects);
    return d;
}
export function sampleTransform(o, frame, mode = 'smooth') {
    if(o.tracks?.length)return sampleObjectTracks(o,frame);
    const keys = [...o.keys].sort((a, b) => a.frame - b.frame);
    if (!keys.length)
        return { position: [...o.position], rotation: [...o.rotation], scale: [...o.scale] };
    if (frame <= keys[0].frame)
        return structuredClone(keys[0]);
    if (frame >= keys.at(-1).frame)
        return structuredClone(keys.at(-1));
    const hi = keys.findIndex(k => k.frame >= frame), a = keys[hi - 1], b = keys[hi];
    let t = (frame - a.frame) / (b.frame - a.frame);
    if (mode === 'step')
        t = 0;
    if (mode === 'smooth')
        t = t * t * (3 - 2 * t);
    return { position: lerp(a.position, b.position, t), rotation: lerp(a.rotation, b.rotation, t), scale: lerp(a.scale, b.scale, t) };
}
export function setKey(o, frame) {
    const k = { frame, position: [...o.position], rotation: [...o.rotation], scale: [...o.scale] }, i = o.keys.findIndex(x => x.frame === frame);
    if (i >= 0)
        o.keys[i] = k;
    else
        o.keys.push(k);
    o.keys.sort((a, b) => a.frame - b.frame);
}
export function worldMatrix(doc, obj, frame = doc.animation.frame, cache = new Map()) {
    if(cache.has(obj.id)){const m=cache.get(obj.id);if(m===null)throw Error('Cyclic constraint/controller dependency');return m;}
    cache.set(obj.id,null);
    try {
        const resolve=id=>{const target=doc.objects.find(o=>o.id===id);if(!target)throw Error('Missing constraint/controller target');return worldMatrix(doc,target,frame,cache);};
        const context={frame,time:frame/doc.animation.fps,fps:doc.animation.fps,resolve};
        const base=frame===doc.animation.frame&&!obj.tracks?.length?obj:sampleTransform(obj,frame,doc.animation.interpolation);
        let m=compose(applyControllers(base,obj.controllers,context));
        if(obj.parent)m=matMul(resolve(obj.parent),m);
        m=applyConstraints(m,obj.constraints,context);
        cache.set(obj.id,m);return m;
    }catch(error){cache.delete(obj.id);throw error;}
}
export class GeometryCache {
    constructor(){this.cache=new Map();this.simulations=new SceneSimulationCache();this.context=null;this.evaluating=new Set();}
    setContext(doc,frame=doc.animation.frame){this.context=doc;this.frame=frame;this.simulations.setContext(doc,frame,(o,f)=>worldMatrix(doc,o,f),(o,f)=>{let m=evaluateModifiers(o.type==='mesh'?validateMesh(o.mesh):createPrimitive(o.type,o.params),o.modifiers);if(o.rig)m=skinMesh(m,o.rig,f);return m;});return this;}
    get(o){
        if(this.evaluating.has(o.id))throw Error('Cyclic procedural geometry dependency');
        const frame=this.frame??this.context?.animation.frame??0,fps=this.context?.animation.fps||24;
        this.evaluating.add(o.id);
        try {
            let source=null;if(o.procedural?.kind==='hair'){const parent=this.context?.objects.find(x=>x.id===o.procedural.source);if(!parent)throw Error('Hair source is missing');source=this.get(parent);}
            const external=o.rig?.externalJoints?.map(id=>{const joint=this.context?.objects.find(x=>x.id===id);if(!joint)throw Error('Missing skeleton joint');return worldMatrix(this.context,joint,frame);});
            const physicsKey=o.simulation?(this.simulations.prepare(),this.simulations.signature):null;
            const key=JSON.stringify([physicsKey,o.type,o.params,o.mesh,o.modifiers,o.rig,o.simulation,o.procedural,o.meshCache,o.morphTargets,o.morphWeights,external,source,((o.rig||o.simulation||o.procedural||o.tracks||o.meshCache)?frame:0)]);
            const old=this.cache.get(o.id);if(old?.key===key)return old.mesh;
            let mesh;
            if(o.procedural?.kind==='hair') {let curves=generateHair(source,o.procedural);if(o.procedural.dynamics)curves=simulateHair(curves,Math.max(0,frame/fps),o.procedural.dynamics);mesh=curvesToMesh(curves,o.procedural);}
            else if(o.procedural?.kind==='particles')mesh=particlesToMesh(sampleParticles(o.procedural,Math.max(0,frame/fps)));
            else {let base=o.type==='mesh'?validateMesh(o.mesh):createPrimitive(o.type,o.params);
                if(o.morphTargets){base=structuredClone(base);const weights=sampleObjectTracks(o,frame).morphWeights||o.morphWeights||[];for(let t=0;t<o.morphTargets.length;t++)if(weights[t])for(let i=0;i<base.positions.length;i++)base.positions[i]+=o.morphTargets[t][i]*weights[t];delete base.vertexNormals;}
                mesh=evaluateModifiers(base,o.modifiers);
                if(o.rig){let matrices;if(external){const inv=inverse(worldMatrix(this.context,o,frame));matrices=external.map((m,i)=>matMul(matMul(inv,m),o.rig.inverseBind[i]));}mesh=skinMesh(mesh,o.rig,frame,{matrices});}
                mesh=this.simulations.evaluate(o,mesh,frame,fps);
            }
            if(o.meshCache?.frames?.length){const frames=o.meshCache.frames;let a=frames[0],b=frames.at(-1);for(let i=1;i<frames.length;i++)if(frame<=frames[i].frame){a=frames[i-1];b=frames[i];break;}const t=Math.max(0,Math.min(1,(frame-a.frame)/Math.max(1e-8,b.frame-a.frame)));mesh={...structuredClone(mesh),positions:a.positions.map((v,i)=>v+(b.positions[i]-v)*t)};delete mesh.vertexNormals;}
            this.cache.set(o.id,{key,mesh});return mesh;
        } finally{this.evaluating.delete(o.id);}
    }
    clear(){this.cache.clear();this.simulations.clear();}
}
