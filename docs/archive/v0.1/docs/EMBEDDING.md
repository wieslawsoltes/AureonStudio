# Using the libraries without the editor

Serve the repository, then open `examples/standalone-renderer.html`. It imports the public module entry point and uses no Studio controller, inspector, timeline or scene-explorer code.

```js
import {
  AureonRayRenderer,
  Scene,
  compileTriangles,
  buildBVH,
  FileFormats
} from './src/index.js';

const document = Scene.demoDocument();
const geometry = new Scene.GeometryCache();
const compiled = compileTriangles(document, geometry);
const acceleration = buildBVH(compiled.triangles, compiled.materials);

const renderer = new AureonRayRenderer(canvas, (message, type) => {
  console[type === 'error' ? 'error' : 'log'](message);
});
await renderer.init();
renderer.setScene(acceleration, compiled.materials);
renderer.mode = 'trace';

async function frame() {
  await renderer.render(document);
  requestAnimationFrame(frame);
}
frame();
```

Keep the shader files at their paths relative to `renderer.js`; initialization fetches them using module-relative URLs. The canvas needs nonzero CSS width and height. The host must be localhost or a suitable secure context, and the browser must expose an available WebGPU adapter.

`buildBVH` above is synchronous for a minimal library demonstration. The Studio application uses `bvh-worker.js`, transfers triangle arrays, coalesces edit revisions, and applies the refit/rebuild policy. A host embedding the engine should use equivalent scheduling for large scenes.

To edit geometry, update canonical object parameters or mesh data and recompile. `GeometryCache` detects source changes. Rebuild or refit acceleration and update scene buffers after prior queue work has completed. A camera-only edit needs `renderer.reset()` but no geometry compilation. `renderer.render()` bounds queued work with a completion fence.

```js
await renderer.device.queue.onSubmittedWorkDone();
const next = compileTriangles(document, geometry);
const bvh = buildBVH(next.triangles, next.materials);
renderer.setScene(bvh, next.materials);

const png = await renderer.capturePNG();
FileFormats.download(png, 'image.png');
const hdr = await renderer.readHDR();
FileFormats.download(FileFormats.encodePFM(hdr), 'image.pfm');
```

`capturePNG()` reads retained GPU display output. `readHDR()` requires at least one accumulated path-traced sample and returns `{data, width, height}` with float32 RGBA data. `dispose()` destroys the device when the embedding application is finished.

The public entry point also exports geometry, primitive, modifier, scene, math and format namespaces, CPU ray picking, camera helpers and history. These are source-level modules, not a promised stable binary/plugin ABI. Native document and GPU ABI details are in FORMAT.md.
