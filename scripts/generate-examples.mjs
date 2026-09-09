import {mkdir,writeFile} from 'node:fs/promises';
import {demoDocument,emptyDocument,newObject,validateDocument,setKey} from '../src/scene/document.js';
const directory=new URL('../examples/',import.meta.url);
await mkdir(directory,{recursive:true});
const save=async(name,doc)=>writeFile(new URL(name+'.aureon',directory),JSON.stringify(validateDocument(doc),null,2)+'\n');
await save('orbit-study',demoDocument());
await save('empty-scene',emptyDocument());
const glass=demoDocument();glass.name='Dielectric study';glass.objects[4].material=6;glass.objects[5].material=6;glass.camera.aperture=.018;glass.camera.focus=8.5;glass.settings.bounces=10;glass.settings.samples=512;await save('glass-materials',glass);
const animated=demoDocument();animated.name='Animated orbit';const ring=animated.objects[3];setKey(ring,0);ring.rotation[1]=180;setKey(ring,60);ring.rotation[1]=360;setKey(ring,120);ring.rotation[1]=0;const ball=animated.objects[4];setKey(ball,0);ball.position[1]=2;setKey(ball,60);ball.position[1]=1.02;setKey(ball,120);await save('animated-orbit',animated);
const workshop=emptyDocument();workshop.name='Modifier workshop';workshop.camera.target=[0,1,0];workshop.camera.distance=12;
for(let i=0;i<4;i++) {const o=newObject('box',{width:1.4,height:3,depth:1.4},['Twist study','Bend study','Taper study','Subdivision study'][i]);o.position=[(i-1.5)*2.2,1.5,0];o.material=[2,4,5,1][i];o.modifiers=[{type:'subdivide',value:2,enabled:true},{type:['twist','bend','taper','smooth'][i],value:[110,80,.7,2][i],enabled:true}];workshop.objects.push(o);}
const floor=newObject('plane',{width:100,depth:100},'Ground');floor.position=[0,-.05,0];workshop.objects.unshift(floor);const light=newObject('plane',{width:5,depth:5},'Large softbox');light.position=[-2,7,3];light.rotation=[155,0,-15];light.material=7;light.hiddenInViewport=true;light.cameraVisible=false;workshop.objects.push(light);await save('modifier-workshop',workshop);
console.log('Five validated scene examples generated.');

// v0.2 examples exercise actual geometry and document schemas. These are source
// scenes, not pre-rendered evidence of GPU execution.
const {createPrimitive}=await import('../src/geometry/primitives.js');
const {booleanMesh,transformMesh}=await import('../src/geometry/boolean.js');
const {bevelMesh}=await import('../src/geometry/bevel.js');
const {conformalUnwrap}=await import('../src/geometry/uv.js');
const {compose}=await import('../src/core/math.js');
const {createChainRig,quatEuler}=await import('../src/animation/rig.js');
const {checkerGraph}=await import('../src/materials/graph.js');
function studio(name){const d=emptyDocument();d.name=name;d.camera.distance=10;d.settings.bounces=12;d.settings.samples=256;
 const f=newObject('plane',{width:30,depth:30},'Ground');f.position=[0,-.02,0];d.objects.push(f);
 const l=newObject('plane',{width:5,depth:5},'Area light');l.position=[-2,6,3];l.rotation=[155,0,-15];l.material=7;l.hiddenInViewport=true;l.cameraVisible=false;d.objects.push(l);return d;}
function put(d,type,params,name,position,material=0){const o=newObject(type,params,name);o.position=position;o.material=material;d.objects.push(o);return o;}
const solids=studio('Solid modeling and UV charts');const a=createPrimitive('box',{width:1.5,height:1.5,depth:1.5}),b=transformMesh(a,compose({position:[.6,.4,.4],rotation:[0,0,0],scale:[1,1,1]}));
for(const [i,op]of ['union','subtract','intersect'].entries()){const o=put(solids,'mesh',{},op,[(i-1)*2.4,1,0],4);o.mesh=booleanMesh(a,b,op);o.materialSlots=[4,2];}
const bev=put(solids,'mesh',{},'Chamfer and packed conformal UVs',[0,1,2.6],2);bev.mesh=conformalUnwrap(bevelMesh(a,.12));await save('solid-uv-workshop',solids);
const deform=studio('Deformation laboratory');deform.animation.end=96;const rigged=put(deform,'mesh',{},'Skinned articulated column',[-2,1.4,0],4);rigged.mesh=createPrimitive('cylinder',{radius:.35,height:2.8,segments:12,heightSegments:10});rigged.rig=createChainRig(rigged.mesh,5);
for(let i=1;i<rigged.rig.bones.length;i++){const bone=rigged.rig.bones[i];bone.keys=[{frame:0,rotation:quatEuler([0,0,0])},{frame:48,rotation:quatEuler([0,0,28])},{frame:96,rotation:quatEuler([0,0,0])}];}
const cloth=put(deform,'plane',{width:2,depth:2,segments:10},'Pinned XPBD sheet',[1.5,2,0],5);cloth.simulation={type:'cloth',pins:[0,10],floor:-1.9,compliance:1e-6,bendCompliance:.001,gravity:[0,-9.81,0],substeps:4,iterations:8};
const furBase=put(deform,'sphere',{radius:.55,segments:16,rings:10},'Hair surface',[0,.6,2],2),fur=put(deform,'mesh',{},'Surface-grown strand tubes',[0,0,0],2);fur.mesh={positions:[],faces:[],uvs:[],smooth:true};fur.parent=furBase.id;fur.procedural={kind:'hair',source:furBase.id,count:160,length:.3,segments:5,radius:.006,sides:4,curl:.15,clump:.05,seed:21};
const particles=put(deform,'mesh',{},'Seeded particle emitter',[0,.1,-1.8],1);particles.mesh={positions:[],faces:[],uvs:[],smooth:true};particles.procedural={kind:'particles',rate:25,lifetime:2,speed:3,spread:.6,radius:.04,gravity:[0,-9.81,0],floor:0,seed:42};deform.animation.frame=12;await save('deformation-lab',deform);
const nodes=studio('Bitmap and node-based shading');nodes.textures=[{name:'RGBA tiles',width:4,height:4,data:Array.from({length:16},(_,i)=>i%2? [210,150,65,255]:[40,100,180,255]).flat()}];
put(nodes,'sphere',{radius:.9,segments:24,rings:16},'Shader graph sphere',[-1.25,1,0],4);nodes.materials[4].graph=checkerGraph();put(nodes,'box',{width:1.6,height:1.6,depth:1.6},'Bitmap cube',[1.2,.8,0],0);nodes.materials[0].bitmap=0;nodes.settings.textureResolution=256;await save('bitmap-node-materials',nodes);
const media=studio('Volume and subsurface random walks');media.settings.bounces=24;media.settings.integrator='path';media.volume={min:[-4,0,-3],max:[4,4,3],density:.045,color:[.85,.91,1],anisotropy:.3};put(media,'sphere',{radius:.85,segments:28,rings:18},'Scattering solid',[-1,1,0],5);media.materials[5].subsurface={weight:1,density:4,anisotropy:.2};put(media,'box',{width:1.5,height:2,depth:1.5},'Opaque reference',[1,1,0],4);await save('volume-subsurface',media);
const photons=studio('Surface photon caustics');photons.settings.integrator='finalGather';photons.settings.photonCount=32768;photons.settings.photonRadius=.22;photons.settings.bounces=12;photons.settings.environment=.08;put(photons,'sphere',{radius:.9,segments:32,rings:24},'Refractive sphere',[0,1.05,0],6);const back=put(photons,'plane',{width:10,depth:5},'Diffuse backdrop',[0,2.5,-3],0);back.rotation=[90,0,0];await save('photon-caustics',photons);
const blur=studio('True temporal geometry integration');blur.animation.frame=24;blur.animation.interpolation='linear';blur.settings.shutter=[-3,3];const moving=put(blur,'sphere',{radius:.65,segments:20,rings:14},'Moving sphere',[0,1,0],2);moving.keys=[{frame:0,position:[-4,1,0],rotation:[0,0,0],scale:[1,1,1]},{frame:48,position:[4,1,0],rotation:[0,180,0],scale:[1,1,1]}];put(blur,'box',{width:1,height:1,depth:1},'Static reference',[1.7,.5,-1],4);await save('motion-blur',blur);
console.log('Six additional v0.2 scenes generated (eleven total).');
