# Architecture — v0.3.0

## Shared state and evaluation

`index.html`, `styles.css` and `src/app.js` host the editor. `ui/production.js` and `ui/advanced.js` install authoring commands on the existing command/menu system. Dialogs edit drafts and commit through the same `History` transactions as modeling. Cancelling a paint/groom/constraint draft does not alter the canonical document. Native JSON, not GPU buffers, is the source of truth. IndexedDB recovery is a local recovery slot, not project version control.

`scene/document.js` owns validation, world transforms and `GeometryCache`. Source meshes, morphs, modifiers, rigging, simulation and procedural geometry feed `render/compile.js`. Exact-rational Boolean operations live in `geometry/exact*.js`; the ordinary mesh representation and renderer are floating-point. `geometry/bevel.js` constructs segmented topological profiles with explicit unsupported-input errors. UV seams, conformal charts and UDIM packing are reusable modules.

`animation/controllers.js` evaluates bounded controller expressions and ordered constraints; dependency cycles reject. Retargeting bakes bind-space deltas. `simulation/scene-world.js` coordinates scene-level rigid bodies, colliders, cloth and fluids. It replaces the former per-object rigid-world isolation. Fractional sample evaluation preserves integer checkpoints; backwards seeks restart deterministically. Fluids and meshing remain CPU work. These systems have explicit budgets and finite robustness coverage, not unbounded production guarantees.

## Geometry to GPU

The triangle compiler applies hierarchical transforms, inverse-transpose normals, mirrored winding, UVs, material slots, object/polygon IDs and fiber metadata. Local triangulation is cached by evaluated-mesh identity. A worker builds/refits a binned SAH BVH and emissive-light distribution. Stale interactive worker results are discarded by revision. Production rendering reuses static geometry and evaluates/refits at changing shutter times; it is not a screen-space blur or a motion-BLAS implementation.

`render/renderer.js` owns device lifetime, pipelines, bindings, accumulation, display and readback. Initialization separates capability, asset, shader, pipeline and resource failures; source-mapped diagnostics do not mislabel compiler failures as missing hardware. GPU queue fences bound outstanding work. Fixed render dimensions fail when over budget; interactive dimensions may scale to fit the pixel allocation budget. See [FORMAT.md](FORMAT.md) for layouts.

## Material compilation and transport

`materials/graph.js` validates and packs a bounded DAG. `materials/wgsl-graph.js` emits straight-line WGSL from its topology. Numeric values remain in the packed buffer, permitting pipeline reuse for value edits. Changed topology or fiber usage selects specialized pipelines; the cache retains at most four entries. The default no-graph path remains available.

`render/assets.js` packs graph values, logical texture descriptors, direct UDIM tile tables, volume records, sparse density leaves and material absorption/fiber records into one storage buffer. `common.wgsl` reads it as vec4 values, preserving the 64-byte instruction ABI. A shared bounded loop performs all eight UDIM trilinear taps. This avoids the former dynamic-interpreter and repeated-inlining compilation explosion without replacing texture sampling with a mock.

`raster.wgsl` draws the modeling viewport. `pathtrace.wgsl` runs path and photon entry points, including emissive/environment sampling, MIS, glass, density-region tracking, nested interiors and fiber lobes. Transport budget overflow is reported rather than silently presented as valid output. Photon density estimation is biased and remains explicitly described as such.

Beauty and AOVs are float32 accumulations. `denoise.wgsl` writes separate guided-filter buffers. `display.wgsl` maps an AOV/beauty view into a retained color texture; PNG capture reads that texture rather than an expired presentation texture. PFM/EXR read unclamped float data. Editing after production rendering restores the interactive size, camera/scene state and accumulation lifecycle.

## Files, persistence and service boundary

`io/formats.js`, `gltf.js` and `interchange.js` implement the documented interchange subsets. `io/exr-advanced.js` adds flat scanline compression and multipart encoding/decoding. No optional codec experiment is advertised as a browser importer. Browser modules have no runtime npm/CDN dependency; `src/index.js` does not launch the editor.

The Node-only `distributed/durable-queue.js` extends the scheduler with checksummed fsync-backed log records, atomic checkpoints, single-writer ownership and restart recovery. Claims are transient; acknowledged completions preserve duplicate identity and compensated sums. A process-kill HTTP test exercises the boundary between acknowledgement and restart. Persistence uses Node/V8 serialization and is not a cross-version archival format or a distributed consensus service.

## Validation and deployment

`tests/run-webgpu.py` contains explicit argument vectors for the four native-browser suites. The CI matrix invokes this same runner; it never parses YAML or shell fragments into commands. Existing renderer tests and independent OpenEXR checks remain required. One-off self-modifying repair/finalization workflows and the obsolete transfer manifest are removed. `pages.yml` generates fresh checksums from its tested artifact and verifies the exact deployed revision and files.

See [TESTING.md](TESTING.md) for the evidence, [FEATURES.md](FEATURES.md) for limitations, and [PRODUCTION.md](PRODUCTION.md) for the UI workflows.
