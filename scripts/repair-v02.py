"""One-time, source-checked v0.2 repair. Removed after verified publication."""
from pathlib import Path
import hashlib
import json
root=Path('.')
def replace(path,old,new):
 p=root/path;s=p.read_text()
 if s.count(old)!=1: raise RuntimeError((path,'expected one occurrence',s.count(old)))
 p.write_text(s.replace(old,new))
p='src/render/renderer.js'
replace(p,"import {TextureArray}","import {RendererError, rendererError, readShader, compileShaderModule, validateResources} from './diagnostics.js';\nimport {TextureArray}")
replace(p,'''    async init() {
        if (!globalThis.isSecureContext)''','''    async init() {
        try {
            return await this.initialize();
        } catch (error) {
            this.initializationError = rendererError(error, this.initStage || 'initialization');
            this.dispose();
            throw this.initializationError;
        }
    }
    async initialize() {
        this.initStage = 'security';
        if (!globalThis.isSecureContext)''')
replace(p,'        if (!navigator.gpu)',"        this.initStage = 'availability';\n        if (!navigator.gpu)")
replace(p,'        this.adapter = await this.gpu.requestAdapter',"        this.initStage = 'adapter';\n        this.adapter = await this.gpu.requestAdapter")
replace(p,'        this.device = await this.adapter.requestDevice();',"        this.info = this.adapter.info;\n        this.initStage = 'device';\n        this.device = await this.adapter.requestDevice();")
replace(p,"        this.context = this.canvas.getContext('webgpu');","        this.initStage = 'context';\n        this.context = this.canvas.getContext('webgpu');\n        if (!this.context) throw Error('Cannot acquire a WebGPU canvas context.');")
s=(root/p).read_text();old=s[s.index('        const read = async (file) => {'):s.index('        this.photonPipeline = await')]
replace(p,old,'''        this.initStage = 'shader';
        const common = await readShader(new URL('common.wgsl', import.meta.url));
        const results = await Promise.allSettled(['pathtrace.wgsl', 'display.wgsl', 'raster.wgsl'].map(async file =>
            compileShaderModule(this.device, file, await readShader(new URL(file, import.meta.url)), common + '\\n')));
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) {
            const first = rendererError(failures[0], 'shader');
            throw new RendererError(first.stage, failures.map(error => error.message).join('\\n'), {
                cause: first, diagnostics: failures.flatMap(error => error.diagnostics || [])
            });
        }
        const [compute, display, raster] = results.map(result => result.value);
        this.initStage = 'pipeline';
''')
replace(p,'        this.uniform = this.device.createBuffer',"        this.initStage = 'resources';\n        await validateResources(this.device, () => {\n        this.uniform = this.device.createBuffer")
replace(p,'''        this.denoiser=await new Denoiser(this.device).init();
        this.bind();
        this.info = this.adapter.info;
        return this;''','''        this.bind();
        });
        this.initStage = 'pipeline';
        this.denoiser = await new Denoiser(this.device).init();
        this.initStage = 'ready';
        return this;''')
p='src/app.js'
replace(p,"            $('#gpu-label').textContent = 'GPU unavailable';","            $('#gpu-label').textContent = e.label || 'Renderer error';\n            $('#render-backend').textContent = e.label || 'Renderer unavailable';")
replace(p,'<h2>A WebGPU adapter is required</h2>',"<h2>${esc(e.title || 'Renderer initialization failed')}</h2>")
replace(p,"this.toast('Rendering requires an available WebGPU adapter.', true);","this.toast(this.renderer.initializationError?.message || 'The renderer is not initialized.', true);")
replace(p,"version: '0.2.0', webgpu:","version: '0.2.1', initializationError: r.initializationError ? { stage: r.initializationError.stage, message: r.initializationError.message, diagnostics: r.initializationError.diagnostics } : null, webgpu:")
replace(p,"        if(this.renderer?.fixedSize&&!this.renderLocked){this.renderer.fixedSize=null;this.renderer.tile=null;this.renderer.sampleStart=0;this.renderer.paused=false;}",'        const restored = this.resumeInteractive();')
replace(p,'''        if (rebuild)
            this.requestBuild();''','''        if (rebuild && !restored)
            this.requestBuild();''')
replace(p,'''    cameraChanged() {
        this.renderer.reset();''','''    resumeInteractive() {
        if (!this.renderer?.fixedSize || this.renderLocked) return false;
        this.renderer.fixedSize = null;
        this.renderer.tile = null;
        this.renderer.sampleStart = 0;
        this.renderer.paused = false;
        // A production frame leaves a shutter-time scene on the GPU. Rebuild
        // from the editable document before resuming the modeling viewport.
        this.requestBuild();
        this.dirty = true;
        return true;
    }
    cameraChanged() {
        this.resumeInteractive();
        this.renderer.reset();''')
replace(p,"        const trace = force ?? (this.renderer.mode !== 'trace');",'''        if (this.renderLocked) {
            this.toast('Cancel the active production render before changing render mode.', true);
            return;
        }
        this.resumeInteractive();
        const trace = force ?? (this.renderer.mode !== 'trace');''')
s=(root/p).read_text();i=s.index('    setFrame(');pos=s.index('\n',i)+1
(root/p).write_text(s[:pos]+'        this.resumeInteractive();\n'+s[pos:])
p='src/render/denoiser.js'
replace(p,'/** Device-local',"import {readShader, compileShaderModule} from './diagnostics.js';\n/** Device-local")
s=(root/p).read_text();old=s[s.index(' async init()'):s.index(' resize(')]
replace(p,old," async init(){const source=await readShader(new URL('./denoise.wgsl',import.meta.url));const module=await compileShaderModule(this.device,'denoise.wgsl',source);this.pipeline=await this.device.createComputePipelineAsync({label:'Edge-aware a-trous denoiser',layout:'auto',compute:{module,entryPoint:'main'}});return this;}\n")
p='tests/production-gpu.html'
replace(p,'GeometryCache} from','GeometryCache,validateDocument} from')
replace(p,'import {checkerGraph}',"import {compileShaderModule} from '../src/render/diagnostics.js';\nimport {checkerGraph}")
replace(p,"release:'0.2.0'","release:'0.2.1'")
replace(p,'function scene(){','const energy=x=>{let sum=0;for(let i=0;i<x.length;i+=4)sum+=x[i]+x[i+1]+x[i+2];return sum;};\nfunction scene(){')
replace(p,'finite(frame.hdr.data)&&maximum(frame.hdr.data)>0','finite(frame.hdr.data)&&energy(frame.hdr.data)>0')
old=" await renderer.device.queue.onSubmittedWorkDone();check('No uncaptured WebGPU or JavaScript errors'"
new=""" // Exercise every published scene, not just a synthetic scene or valid shader syntax.
 const examples=['orbit-study','empty-scene','glass-materials','modifier-workshop','animated-orbit','solid-uv-workshop','deformation-lab','bitmap-node-materials','volume-subsurface','photon-caustics','motion-blur'];
 for(const name of examples){
  const response=await fetch('../examples/'+name+'.aureon');check('Example asset loads: '+name,response.ok);
  const example=validateDocument(await response.json());example.settings.photonCount=2048;
  const image=await renderProduction(renderer,example,{width:32,height:24,samples:2});
  check('Example renders finite nonzero RGB + AOVs: '+name,finite(image.hdr.data)&&finite(image.aovs.data)&&energy(image.hdr.data)>0,{rgbEnergy:energy(image.hdr.data)});
 }
 doc=scene();doc.settings.samples=2;await renderProduction(renderer,doc,{width:24,height:16,samples:2});
 const before=await renderer.readHDR();
 for(const view of ['beauty','albedo','normals','depth','objects','emission','direct','indirect']){doc.settings.view=view;await renderer.render(doc);check('Display AOV executes: '+view,renderer.samples===2);}
 const after=await renderer.readHDR();check('AOV display selection does not modify beauty accumulation',after.data.every((v,i)=>v===before.data[i]));
 let rejected=false;
 try{await compileShaderModule(renderer.device,'deliberately-invalid.wgsl','fn invalid()->u32{return 2u*3u^4u;}');}catch(e){rejected=e.stage==='shader'&&e.diagnostics[0]?.file==='deliberately-invalid.wgsl';}
 check('Real WGSL syntax failures produce source-mapped shader diagnostics',rejected);
 let limited=false;try{await renderProduction(renderer,doc,{width:renderer.maxPixels+1,height:1,samples:1});}catch(e){limited=/Invalid production render/.test(e.message);}
 check('Oversized production frames fail explicitly',limited);
 await renderer.device.queue.onSubmittedWorkDone();check('No uncaptured WebGPU or JavaScript errors'"""
replace(p,old,new)
p='tests/browser.py'
old='        # Empty buffers, zero lights and an environment-only path are not mocked.'
new='''        # A retained production result must not strand the interactive viewport
        # at export resolution or leave its shutter-time snapshot bound.
        def production_snapshot():
            page.evaluate("""async()=>{
              aureon.renderLocked=true;
              while(aureon.building||aureon.renderer.busy)await new Promise(r=>setTimeout(r,10));
              const {renderProduction}=await import('./src/render/production.js');
              const snapshot=structuredClone(aureon.doc);snapshot.objects=[];
              try{await renderProduction(aureon.renderer,snapshot,{width:32,height:24,samples:2,shutter:[0,0]});aureon.renderer.paused=true;aureon.dirty=false;}
              finally{aureon.renderLocked=false;}
            }""")
        production_snapshot()
        page.evaluate('aureon.toggleRender(false)');settled()
        check('Back to modeling restores viewport size and canonical scene after production rendering',page.evaluate('!aureon.renderer.fixedSize && aureon.renderer.mode==="raster" && aureon.renderer.scene.triangles.length===aureon.compiled.triangles.length && aureon.renderer.scene.triangles.length>0'))
        production_snapshot()
        page.evaluate('aureon.doc.settings.samples=2;aureon.doc.camera.yaw+=.05;aureon.cameraChanged()');settled()
        page.wait_for_function('aureon.renderer.samples>=2 && !aureon.renderer.busy',timeout=45000)
        check('Camera edits exit a paused production snapshot and render the editable scene',page.evaluate('!aureon.renderer.fixedSize && !aureon.renderer.paused && aureon.renderer.scene.triangles.length>0'))

'''+old
replace(p,old,new)
p=root/'package.json';package=json.loads(p.read_text());package['version']='0.2.1';package['scripts']['test:gpu']='python3 tests/gpu-regression.py';p.write_text(json.dumps(package,indent=2)+'\n')
manifest=root/'MANIFEST.sha256'
paths={line.split('  ',1)[1] for line in manifest.read_text().splitlines()}
paths.update(['src/render/diagnostics.js','tests/renderer-diagnostics.test.mjs','tests/gpu-regression.py'])
manifest.write_text(''.join(hashlib.sha256((root/path).read_bytes()).hexdigest()+'  '+path+'\n' for path in sorted(paths) if (root/path).is_file()))
