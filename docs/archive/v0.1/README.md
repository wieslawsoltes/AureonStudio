# Aureon Studio + Aureon Ray

**Original polygon modeling, transform animation, and native WebGPU rendering in plain HTML, JavaScript, and WGSL.** MIT licensed. No runtime packages, framework, transpilation, proprietary assets, external service, or remote rendering backend.

Aureon Studio is the editor; Aureon Ray is its reusable renderer. They share evaluated geometry and materials. The modeling viewport uses vertex/fragment shaders. Final rendering uses a genuine compute-shader Monte Carlo path tracer, not a raster image with a “ray tracing” label.

**Release status: working v0.1 engineering baseline, not complete product parity.** This delivery does not implement every feature of a mature commercial DCC or legacy production renderer, is not native `.max`/`.mi` compatible, and does not execute another product's shaders or scripts. The exact boundaries are recorded in [FEATURES.md](docs/FEATURES.md). No unsupported tool is presented as an implemented modeling operation.

Historical screenshots are included in the original downloadable v0.1 archive. Generated capture images are not tracked in this source repository.

## Start

Install Node.js 20 or later, extract the project, and run:

```sh
cd aureon-studio
npm start
```

Open the local address printed by the server, normally `http://localhost:4173`. No `npm install` is needed to run the application. `start.bat` and `start.sh` provide equivalent launchers.

Use a browser that exposes WebGPU and an available adapter. The application checks both and reports initialization or device-loss errors. Rendering is not replaced with a fake fallback. The document editor and geometry/file operations remain available without WebGPU.

The project can also be served by another static HTTP server or deployed over HTTPS. Opening `index.html` directly as a `file:` URL will not work reliably because ES modules, shader fetches, and the module worker require a server. A GitHub Pages workflow is included but this package has **not** been published or committed to a repository by this delivery.

## A first working session

The application opens **Orbit study**, an editable scene with ten objects, mesh lights, metallic surfaces, and a staged composition. Create a box or another primitive from the left panel. Select its name in the explorer or click it in the viewport. Use the right inspector for dimensions and precise local transforms, or drag the colored handles.

Add modifiers to the stack and reorder them. In Polygon selection mode, click a face and use **Model → Extrude** or **Inset**. These operations bake the evaluated stack into editable geometry; undo restores the source stack. **Model → UV editor** opens a real coordinate editor, not a texture-preview mockup.

Click a material swatch to assign that shared material to the selection. The swatches themselves are illustrative CSS balls; the viewport and final renderer are the actual material previews. Set emission above zero to make a mesh illuminate the scene.

Use **Set key**, move to another timeline frame, change the object transform, and set another key. Playback evaluates those transforms. The curve editor supports direct key-frame/value dragging.

Click **Render scene** to switch from the studio-lit raster viewport to progressive compute rendering. Configure sample count, bounce limit, output scale, exposure, environment intensity, aperture, and focus in the renderer inspector. Save the displayed image as PNG or linear, unclamped radiance as float32 PFM. **File → Save scene** preserves the complete native document.

## Delivered systems

| Area | Working implementation |
|---|---|
| Renderer | Native WGSL compute path tracing, binned-SAH BVH, worker-side refitting, mesh-light and environment sampling, MIS, indirect illumination, GGX reflection, diffuse surfaces, ideal dielectric transmission, progressive HDR accumulation, thin-lens depth of field |
| Viewport | GPU triangle rasterization, preview lighting, grid, wireframe, selected edges, perspective and orthographic views, orbit/pan/dolly, ray picking, transform handles |
| Modeling | Eight parametric primitives, polygon meshes, concave-face triangulation, face extrusion/inset/delete, vertex translation, welding, eight modifiers, stack enable/reorder/collapse |
| Materials | Shared color/metalness/roughness/IOR/transmission/emission, UV checker, world-space marble and wood patterns, per-vertex UV editing and projection |
| Animation | Position/rotation/scale keys, auto key, timeline playback, step/linear/smoothstep interpolation, direct key curve editing |
| Documents | Parent hierarchy, object visibility and locks, multi-object selection, bounded transaction history, IndexedDB recovery, native JSON scene files |
| Exchange | OBJ and STL import; evaluated OBJ, binary STL and embedded static glTF export; PNG and PFM rendering output |
| Engineering | Public module entry point, standalone renderer example, five editable scene examples, CPU tests, real-browser integration tests, diagnostics, optional static deployment configuration |

See [Architecture](docs/ARCHITECTURE.md), [Feature boundaries](docs/FEATURES.md), [Native format and GPU ABI](docs/FORMAT.md), [Library integration](docs/EMBEDDING.md), and [Testing](docs/TESTING.md).

## Shortcuts

| Action | Input |
|---|---|
| Select / move / rotate / scale | Q / W / E / R |
| Orbit | Alt + left drag, or right drag |
| Pan / dolly | Middle drag or Shift + right drag / mouse wheel |
| Frame selection / snap / grid / wireframe | F / S / G / F4 |
| Save / open / duplicate | Ctrl or Command + S / O / D |
| Undo / redo | Ctrl or Command + Z / Shift + Z |
| Play / set key / render | Space / K / F9 |
| Command palette / narrow-screen inspector | Ctrl or Command + K / I |

The reference-space selector applies to **translation**. Rotation and scale handles edit local transform channels; they are not a complete world-space rotation/pivot manipulation system. Two-finger pinch adjusts the camera distance on touch devices.

## Validation and performance

```sh
npm test
npm run bench
```

The included test report separates CPU algorithm tests, actual GPU/browser checks, and untested production concerns. Browser tests require Python Playwright separately; see [TESTING.md](docs/TESTING.md).

Correctness was tested with Chromium's **SwiftShader software WebGPU adapter** in this environment. That is genuine WebGPU execution, but it is **not** evidence of hardware-GPU speed, commercial-renderer parity, or production image convergence. The CPU benchmark is scoped to BVH build/refit on the supplied scene. No comparative GPU performance claim is made.

## Privacy, limits, and recovery

The application has no sign-in, telemetry, network file upload, remote renderer, or external asset dependency. IndexedDB recovery is a single browser-local slot, not a versioned backup. Replacing a scene eventually replaces that recovery slot; save explicit `.aureon` files to keep milestones.

Images are bounded to 2,073,600 pixels and the adapter's storage-buffer limits. Imported files are limited to 100 MB; individual input meshes to one million vertices; scenes to 10,000 objects. These are safety ceilings, not performance guarantees. World-space triangle flattening and CPU mesh evaluation remain important scaling limits.

## License and provenance

The application source, shader source, example scenes, and original UI assets are distributed under the [MIT License](LICENSE). It is an original implementation using public rendering concepts. It contains no proprietary renderer binaries, vendor UI assets, imported vendor implementation code, or implied vendor endorsement.
