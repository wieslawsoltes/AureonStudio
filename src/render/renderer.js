import {TextureArray} from '../materials/textures.js';
import {compileGraphs} from '../materials/graph.js';
import {Denoiser} from './denoiser.js';
import { cameraFrame } from './camera.js';
import { rad } from '../core/math.js';
/** The renderer has no editor or DOM dependency beyond its output canvas. */
export class Renderer {
    constructor(canvas, onStatus = () => {
    }) {
        this.canvas = canvas;
        this.onStatus = onStatus;
        this.mode = 'raster';
        this.samples = 0;
        this.paused = false;
        this.generation = 0;
        this.disposed = false;
        this.errors = [];
        this.maxPixels = 2073600;
    }
    async init() {
        if (!globalThis.isSecureContext)
            throw Error('WebGPU requires HTTPS or localhost. Start the included local server.');
        if (!navigator.gpu)
            throw Error('This browser does not expose WebGPU. Use a WebGPU-capable browser with graphics acceleration enabled.');
        this.gpu = navigator.gpu;
        this.adapter = await this.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!this.adapter)
            throw Error('No WebGPU adapter is available. Check the browser GPU configuration.');
        this.device = await this.adapter.requestDevice();
        this.device.addEventListener('uncapturederror', e => {
            this.errors.push(e.error.message);
            this.onStatus(e.error.message, 'error');
        });
        this.device.lost.then(info => {
            if (!this.disposed) {
                this.lost = true;
                console.error('Device lost details', info.reason, info.message);
                this.onStatus(`GPU device lost: ${info.message}. Save the scene and reload to reconnect.`, 'error');
            }
        });
        this.context = this.canvas.getContext('webgpu');
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
        const read = async (file) => {
            const res = await fetch(new URL(file, import.meta.url));
            if (!res.ok)
                throw Error(`Cannot load shader ${file}`);
            return res.text();
        };
        const common = await read('common.wgsl');
        const module = async (file) => {
            const mod = this.device.createShaderModule({ label: file, code: common + '\n' + await read(file) }), info = await mod.getCompilationInfo(), errors = info.messages.filter(m => m.type === 'error');
            if (errors.length)
                throw Error(`${file}: ${errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n')}`);
            return mod;
        };
        const [compute, display, raster] = await Promise.all(['pathtrace.wgsl', 'display.wgsl', 'raster.wgsl'].map(module));
        this.photonPipeline = await this.device.createComputePipelineAsync({ label: 'Linked-cell photon emission', layout: 'auto', compute: { module: compute, entryPoint: 'photonMain' } });
        this.compute = await this.device.createComputePipelineAsync({ label: 'Aureon Ray integrator', layout: 'auto', compute: { module: compute, entryPoint: 'main' } });
        this.display = await this.device.createRenderPipelineAsync({ label: 'Linear HDR display', layout: 'auto', vertex: { module: display, entryPoint: 'vertexMain' }, fragment: { module: display, entryPoint: 'fragmentMain', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list' } });
        this.raster = await this.device.createRenderPipelineAsync({ label: 'Modeling viewport', layout: 'auto', vertex: { module: raster, entryPoint: 'vertexMain' }, fragment: { module: raster, entryPoint: 'fragmentMain', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } });
        this.uniform = this.device.createBuffer({ label: 'Camera and frame', size: 512, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.pixelBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        this.buffers = { triangles: this.buffer(new Float32Array(32), 'Triangles'), nodes: this.buffer(new Float32Array(8), 'BVH nodes'), lights: this.buffer(new Float32Array(4), 'Emissive triangle CDF'), materials: this.buffer(new Float32Array(16), 'Materials') };
        this.aovBuffer=this.device.createBuffer({size:80,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
        this.photonBuffer=this.device.createBuffer({size:16384+80*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
        this.graphBuffer=this.buffer(new Float32Array(16),'Shader graphs');
        this.textureArray=new TextureArray(this.device);this.textureArray.upload([],1);
        this.denoiser=await new Denoiser(this.device).init();
        this.bind();
        this.info = this.adapter.info;
        return this;
    }
    buffer(data, label) {
        const bytes = data.byteLength;
        const limit = Math.min(this.device.limits.maxStorageBufferBindingSize, this.device.limits.maxBufferSize);
        if (bytes > limit)
            throw Error(`${label} requires ${(bytes / 1048576).toFixed(1)} MiB, exceeding the GPU binding limit ${(limit / 1048576).toFixed(1)} MiB`);
        const buffer = this.device.createBuffer({ label, size: Math.max(label.toLowerCase().includes('triangle') && !label.toLowerCase().includes('cdf') ? 128 : label.toLowerCase().includes('material') ? 64 : label.toLowerCase().includes('node') ? 32 : 16, Math.ceil(bytes / 16) * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        if (bytes)
            this.device.queue.writeBuffer(buffer, 0, data);
        return buffer;
    }
    bind() {
        const b=this.buffers,d=this.device;
        const resource=buffer=>({buffer});
        const entries=[{binding:0,resource:resource(this.uniform)},{binding:1,resource:resource(b.triangles)},{binding:2,resource:resource(b.materials)},{binding:3,resource:resource(b.nodes)},{binding:4,resource:resource(this.pixelBuffer)},{binding:5,resource:resource(b.lights)},{binding:6,resource:resource(this.aovBuffer)},{binding:7,resource:resource(this.photonBuffer)}];
        this.computeGroup=d.createBindGroup({layout:this.compute.getBindGroupLayout(0),entries});
        this.photonGroup=d.createBindGroup({layout:this.photonPipeline.getBindGroupLayout(0),entries:entries.filter(e=>![4,6].includes(e.binding))});
        this.rasterGroup=d.createBindGroup({layout:this.raster.getBindGroupLayout(0),entries:entries.filter(e=>e.binding<=2)});
        this.makeDisplayGroup(this.pixelBuffer);
        this.materialGroups={};
        for(const [name,pipeline] of [['compute',this.compute],['photon',this.photonPipeline],['raster',this.raster]]) this.materialGroups[name]=d.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[{binding:0,resource:this.textureArray.sampler},{binding:1,resource:this.textureArray.view},{binding:2,resource:resource(this.graphBuffer)}]});
    }
    makeDisplayGroup(pixels) {
        this.displayGroup=this.device.createBindGroup({layout:this.display.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}},{binding:3,resource:{buffer:pixels}},{binding:6,resource:{buffer:this.aovBuffer}}]});
    }
    setAssets(doc) {
        const key=JSON.stringify([doc.textures||[],doc.materials.map(m=>m.graph||null),doc.settings.textureResolution||256]);
        if(key===this.assetKey)return;
        const graphs=compileGraphs(doc.materials);const replacement=this.buffer(graphs.data,'Shader graphs');
        try {this.textureArray.upload(doc.textures||[],doc.settings.textureResolution||256);}catch(e){replacement.destroy();throw e;}
        this.graphBuffer.destroy();this.graphBuffer=replacement;this.assetKey=key;this.bind();this.reset();
    }
    setScene(scene, materials, {preserveAccumulation=false}={}) {
        const replacement={};
        try {replacement.triangles=this.buffer(scene.triangles,'Triangles');replacement.nodes=this.buffer(scene.nodes,'BVH nodes');replacement.lights=this.buffer(scene.lights,'Light distribution');replacement.materials=this.buffer(materials,'Materials');}
        catch(error){Object.values(replacement).forEach(b=>b.destroy());throw error;}
        const old=this.buffers;this.buffers=replacement;this.scene=scene;this.photonDirty=true;this.bind();Object.values(old).forEach(b=>b.destroy());
        if(!preserveAccumulation)this.reset();
    }
    configurePhotons(settings) {
        if(!settings.integrator||settings.integrator==='path')return;
        const count=Math.floor(settings.photonCount??8192),radius=settings.photonRadius??.3;
        if(count<1||count>131072||!Number.isFinite(radius)||radius<=0)throw Error('Invalid photon map settings');
        if(this.photonCount!==count){const size=16384+count*8*80;if(size>this.device.limits.maxStorageBufferBindingSize)throw Error('Photon map exceeds GPU storage binding limit');this.photonBuffer.destroy();this.photonBuffer=this.device.createBuffer({label:'Photon linked-cell map',size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});this.photonCount=count;this.photonDirty=true;this.bind();}
        const transportKey=JSON.stringify([settings.environment,settings.seed]);
        if(radius!==this.photonRadius||transportKey!==this.photonTransportKey){this.photonRadius=radius;this.photonTransportKey=transportKey;this.photonDirty=true;}
    }
    reset() {
        this.samples = 0;
        this.generation++;
        this.started = performance.now();
        this.lastDuration = 0;
    }
    resize(resolution) {
        const rect = this.canvas.getBoundingClientRect(), scale = Math.min(2, globalThis.devicePixelRatio || 1) * (this.mode === 'trace' ? resolution : 1);
        let width = Math.max(1, Math.round(rect.width * scale)), height = Math.max(1, Math.round(rect.height * scale));
        if(this.fixedSize){width=this.fixedSize.width;height=this.fixedSize.height;}
        const maxPixels = Math.min(this.maxPixels, Math.floor(this.device.limits.maxStorageBufferBindingSize / 80));
        if(this.fixedSize && (width*height>maxPixels||width>this.device.limits.maxTextureDimension2D||height>this.device.limits.maxTextureDimension2D))throw Error('Requested render dimensions exceed the GPU pixel/texture budget');
        if (width * height > maxPixels) {
            const factor = Math.sqrt(maxPixels / (width * height));
            width = Math.floor(width * factor);
            height = Math.floor(height * factor);
        }
        if (this.canvas.width === width && this.canvas.height === height && this.depth)
            return;
        this.canvas.width = width;
        this.canvas.height = height;
        this.depth?.destroy();
        this.colorTexture?.destroy();
        this.colorTexture = this.device.createTexture({ label: 'Retained displayed color', size: [width, height], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        this.depth = this.device.createTexture({ size: [width, height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
        this.pixelBuffer.destroy();
        this.pixelBuffer = this.device.createBuffer({ label: 'Linear HDR accumulation', size: width * height * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        this.aovBuffer?.destroy();
        this.aovBuffer=this.device.createBuffer({label:"Simultaneous float32 AOVs",size:width*height*80,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
        this.denoiser.resize(width,height);
        this.bind();
        this.reset();
    }
    async render(doc, selectedIndex = 0, { grid = true, wireframe = false } = {}) {
        if (this.busy || this.lost || !this.device)
            return;
        this.busy = true;
        try {
            this.resize(doc.settings.resolution);
            this.configurePhotons(doc.settings);
            const w = this.canvas.width, h = this.canvas.height, c = cameraFrame(doc.camera, (this.tile?.fullWidth||w) / (this.tile?.fullHeight||h)), s = doc.settings;
            const u = new Float32Array(128);
            u.set([...c.eye, Math.tan(rad(doc.camera.fov) / 2), ...c.right, (this.tile?.fullWidth||w)/(this.tile?.fullHeight||h), ...c.up, s.exposure, ...c.forward, s.environment, w, h, this.samples, s.bounces, doc.camera.aperture, doc.camera.focus, +c.ortho, c.size, this.scene?.triangles.length / 32 || 0, this.scene?.lightCount || 0, selectedIndex, ['beauty', 'albedo', 'normals', 'depth', 'objects','emission','direct','indirect'].indexOf(s.view)], 0);
            u.set(c.viewProjection, 28);
            u.set([+grid, +wireframe, 0, 0], 44);
            const volume=doc.volume||{},integrator=['path','photon','finalGather'].indexOf(s.integrator||'path');
            if(integrator>0&&(volume.density>0||doc.materials.some(m=>m.subsurface?.weight>0||m.graph?.outputs?.subsurface)))throw Error('Photon mapping is surface-only; select path tracing for volumes/subsurface materials');
            u.set([...(volume.min||[-5,0,-5]),volume.density||0,...(volume.max||[5,5,5]),volume.anisotropy||0,...(volume.color||[.9,.9,.9]),0,Math.max(0,integrator),this.photonCount||1,s.photonRadius||.3,+!!s.denoise],48);
            u.set([this.tile?.x||0,this.tile?.y||0,this.tile?.fullWidth||w,this.tile?.fullHeight||h,this.sampleStart||0,0,s.seed||0,s.textureLod||0],64);
            this.device.queue.writeBuffer(this.uniform, 0, u);
            const encoder = this.device.createCommandEncoder({ label: 'Aureon frame' });
            const tracing = this.mode === 'trace', sample = tracing && !this.paused && this.samples < s.samples;
            if(sample && integrator>0 && this.photonDirty){
                encoder.clearBuffer(this.photonBuffer);const emit=encoder.beginComputePass({label:'Emit and store surface photons'});emit.setPipeline(this.photonPipeline);emit.setBindGroup(0,this.photonGroup);emit.setBindGroup(1,this.materialGroups.photon);emit.dispatchWorkgroups(Math.ceil(this.photonCount/64));emit.end();this.photonDirty=false;
            }
            if (sample) {
                const pass = encoder.beginComputePass();
                pass.setPipeline(this.compute);
                pass.setBindGroup(0, this.computeGroup);
                pass.setBindGroup(1,this.materialGroups.compute);
                pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
                pass.end();
                this.samples++;
            }
            if(tracing&&s.denoise&&this.samples>0){this.denoisedBuffer=this.denoiser.encode(encoder,this.pixelBuffer,this.aovBuffer,s.denoiseIterations||3);this.makeDisplayGroup(this.denoisedBuffer);}else{this.denoisedBuffer=null;this.makeDisplayGroup(this.pixelBuffer);}
            const colorAttachment = { view: this.colorTexture.createView(), clearValue: { r: .16, g: .18, b: .205, a: 1 }, loadOp: 'clear', storeOp: 'store' };
            const pass = encoder.beginRenderPass({ colorAttachments: [colorAttachment], ...(!tracing ? { depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } } : {}) });
            pass.setPipeline(tracing ? this.display : this.raster);
            pass.setBindGroup(0, tracing ? this.displayGroup : this.rasterGroup);
            if(!tracing)pass.setBindGroup(1,this.materialGroups.raster);
            pass.draw(tracing ? 3 : (this.scene?.triangles.length / 32 || 0) * 3);
            pass.end();
            encoder.copyTextureToTexture({ texture: this.colorTexture }, { texture: this.context.getCurrentTexture() }, [w, h]);
            const start = performance.now();
            this.device.queue.submit([encoder.finish()]);
            await this.device.queue.onSubmittedWorkDone();
            this.lastDuration = performance.now() - start;
            this.elapsed = performance.now() - this.started;
        }
        finally {
            this.busy = false;
        }
    }
    /** Read a retained render target, never an expired presentation texture. */
    async capturePNG() {
        if (!this.colorTexture)
            throw Error('Render a viewport before capturing it');
        await this.device.queue.onSubmittedWorkDone();
        const width = this.canvas.width, height = this.canvas.height, bytesPerRow = Math.ceil(width * 4 / 256) * 256;
        const readback = this.device.createBuffer({ label: 'PNG texture readback', size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = this.device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: this.colorTexture }, { buffer: readback, bytesPerRow, rowsPerImage: height }, [width, height]);
        this.device.queue.submit([encoder.finish()]);
        try {
            await readback.mapAsync(GPUMapMode.READ);
            const source = new Uint8Array(readback.getMappedRange()), rgba = new Uint8ClampedArray(width * height * 4), bgra = this.format.startsWith('bgra');
            for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) {
                    const from = y * bytesPerRow + x * 4, to = (y * width + x) * 4;
                    rgba[to] = source[from + (bgra ? 2 : 0)];
                    rgba[to + 1] = source[from + 1];
                    rgba[to + 2] = source[from + (bgra ? 0 : 2)];
                    rgba[to + 3] = 255;
                }
            const surface = new OffscreenCanvas(width, height), ctx = surface.getContext('2d');
            ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
            return await surface.convertToBlob({ type: 'image/png' });
        }
        finally {
            readback.unmap();
            readback.destroy();
        }
    }
    async readHDR({denoised=false}={}) {
        if(denoised&&!this.denoisedBuffer)throw Error('Enable denoising and render the frame before exporting a denoised beauty');
        if (this.mode !== 'trace' || !this.samples)
            throw Error('Render at least one path-traced sample before exporting HDR');
        await this.device.queue.onSubmittedWorkDone();
        const size = this.canvas.width * this.canvas.height * 16, buffer = this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(denoised&&this.denoisedBuffer?this.denoisedBuffer:this.pixelBuffer, 0, buffer, 0, size);
        this.device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(buffer.getMappedRange().slice(0));
        buffer.unmap();
        buffer.destroy();
        return { data, width: this.canvas.width, height: this.canvas.height };
    }
    async readAOVs() {
        if(this.mode!=='trace'||!this.samples)throw Error('Render a path-traced frame first');
        await this.device.queue.onSubmittedWorkDone();const width=this.canvas.width,height=this.canvas.height,size=width*height*80;
        const buffer=this.device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        try {const encoder=this.device.createCommandEncoder();encoder.copyBufferToBuffer(this.aovBuffer,0,buffer,0,size);this.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);return {width,height,data:new Float32Array(buffer.getMappedRange().slice(0))};}finally{buffer.unmap();buffer.destroy();}
    }
    async photonStatistics(){if(!this.photonCount)return {stored:0};await this.device.queue.onSubmittedWorkDone();const size=this.photonCount*8*80,buffer=this.device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=this.device.createCommandEncoder();e.copyBufferToBuffer(this.photonBuffer,16384,buffer,0,size);this.device.queue.submit([e.finish()]);await buffer.mapAsync(GPUMapMode.READ);const a=new Float32Array(buffer.getMappedRange());let stored=0,flux=0,finite=true;for(let i=0;i<a.length;i+=20){if(a[i+3]){stored++;for(let k=0;k<3;k++){finite&&=Number.isFinite(a[i+8+k]);flux+=a[i+8+k];}}}return {emitted:this.photonCount,stored,flux,finite};}finally{buffer.unmap();buffer.destroy();}}
    dispose() {
        this.disposed = true;
        this.denoiser?.dispose();this.textureArray?.dispose();
        this.device?.destroy();
    }
}
