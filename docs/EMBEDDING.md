# Using the libraries without the editor

`src/index.js` is browser-safe and does not create UI. Serve the source with its module-relative WGSL files intact. The canvas needs nonzero CSS dimensions. `examples/standalone-renderer.html` is a complete host.

```js
import {
  AureonRayRenderer, Scene, compileTriangles, buildBVH,
  renderProduction, OpenEXR
} from './src/index.js';

const doc = Scene.demoDocument();
const renderer = await new AureonRayRenderer(canvas).init();
const geometry = new Scene.GeometryCache().setContext(doc);
const compiled = compileTriangles(doc, geometry);
renderer.setAssets(doc); // textures + graph bytecode; required in v0.2
renderer.setScene(buildBVH(compiled.triangles, compiled.materials), compiled.materials);
renderer.mode = 'trace';
await renderer.render(doc);

const {hdr, aovs} = await renderProduction(renderer, doc, {
  width: 640, height: 480, samples: 128, shutter: [-0.25, 0.25],
  onProgress: ({sample, samples}) => console.log(sample, samples)
});
const bytes = OpenEXR.encodeEXR({
  width: hdr.width, height: hdr.height,
  channels: OpenEXR.renderChannels(hdr, aovs)
});
// bytes is a Uint8Array; the host decides where to save it.
```

Do not run the interactive animation loop concurrently with `renderProduction` or `renderTile`. Wait for in-flight queue work before changing scene assets/buffers. After changing geometry or material emission, compile and build/refit again; `setScene()` resets accumulation unless preservation is explicit. `setAssets()` updates bitmap/graph state separately. A camera-only edit needs a sample reset but not new geometry. Production rendering leaves a fixed-size trace result; set `fixedSize=null`, `tile=null`, `sampleStart=0` and restore the desired mode before resuming normal viewport rendering.

For a deterministic job tile:

```js
import {renderTile} from './src/index.js';
const rgbaAndAovs = await renderTile(renderer, doc, {
  x:0, y:0, width:128, height:128,
  fullWidth:1920, fullHeight:1080,
  sampleStart:0, samples:16, totalSamples:128
});
// Float32Array, 24 floats/pixel. Merge with weights equal to samples.
```

Full-frame pixel coordinates and the global sample offset determine the pixel RNG. Photon accumulation still depends on GPU execution/reduction order and is not a bitwise cross-device guarantee. Motion uses `totalSamples` to choose globally consistent shutter strata.

Geometry and codecs can run in Node without a GPU:

```js
import {Primitives, SolidModeling, UV, Rigging, Scene, GLTF2} from './src/index.js';
const mesh = Primitives.createPrimitive('box', {width:2,height:2,depth:2});
const unwrapped = UV.conformalUnwrap(mesh);
const rig = Rigging.createChainRig(unwrapped, 4);
const posed = Rigging.skinMesh(unwrapped, rig, 0);
```

The render queue is deliberately Node-only:

```js
import {RenderQueue} from './src/distributed/queue.js';
const queue = new RenderQueue();
const job = queue.create({scene:Scene.emptyDocument(),width:64,height:64,samples:16});
const claim = queue.claim('worker-1');
// Use the HTTP server or integrate lease/heartbeat/completion with your own transport.
```

Do not fabricate a successful worker result for rendering: CPU tests use synthetic data only to verify scheduling/merge arithmetic and are labeled as such. The shipped browser worker renders its tile with WebGPU.

The source-level interfaces are not a stable SDK or compatibility ABI. v0.2 GPU code remains unverified in the current environment; run `tests/production-gpu.html` on the intended device before relying on output.
