# Architecture — v0.2

## Shared pipeline

```text
index.html / styles.css
    app.js + ui/{inspector,editors,production}.js
             │ commands, dialogs, history
             ▼
    scene/document.js — canonical JSON + GeometryCache
       ├─ geometry/{mesh,primitives,modifiers,boolean,bevel,uv}.js
       ├─ animation/{rig,tracks}.js
       └─ simulation/{physics,curves}.js
             │ evaluated polygon meshes
             ▼
    render/compile.js — world triangles, normals, UVs, material slots
       ├─ materials/{graph,textures}.js
       └─ render/bvh-worker.js — SAH build / refit + light CDF
             │
    render/renderer.js — WebGPU lifetime / bindings / display / readback
       ├─ common.wgsl — ABI, BSDF, texture/graph interpreter
       ├─ raster.wgsl — vertex/fragment preview
       ├─ pathtrace.wgsl — path/volume transport + photon dispatch
       ├─ denoiser.js / denoise.wgsl — separate a-trous buffers
       └─ display.wgsl — selected AOV and tone-mapped output

    render/production.js — shutter evaluation and deterministic tiles
    io/{formats,gltf,interchange,exr,png}.js — independent codecs
    distributed/queue.js — Node-only scheduler and compensated merger
    scripts/render-server.mjs ⇄ distributed/worker-client.js
```

`src/index.js` exports browser-safe library namespaces without creating the application. The Node-only queue is deliberately not re-exported from that entry point. There are no runtime framework dependencies.

## Canonical state and edits

Native objects reference parents by ID and materials by index. GPU buffers and caches are transient. Shared JSON data drives editor controls, CPU geometry, viewport and production renderer; there is no separate mock renderer scene. Scene validation checks key structures, transforms, hierarchy cycles, materials, supported modifiers and added rig/cache/texture/graph fields, but is not a full hostile-asset sandbox or schema certification.

History transactions snapshot before/after JSON and roll back synchronous errors. History retains at most 60 transactions and approximately 64 MiB of snapshot text, keeping the newest transaction. Recovery is a single debounced IndexedDB slot, not version control. New rigs, textures, graphs, procedural settings and caches participate in these transactions.

## Geometry and deformation

`GeometryCache` evaluates source geometry → morph displacement → modifiers → skinning → simulation. Procedural hair/particles provide an alternative mesh source. An explicit baked deformation cache overrides resulting positions. Cache keys include source data, deformation settings/time and external skeleton matrices. Re-entrant procedural dependencies reject rather than recur forever.

UV seam splitting uses corner-sector connectivity across uncut edges. This correctly separates two sides of a cut even when they remain in one face-connected chart. Automatic seam selection retains a smooth dual spanning forest. LSCM then solves sparse normal equations with conjugate gradients and pinned anchors; chart packing is deterministic shelf packing. Rigging uses normalized four-weight influences and inverse binds; imported glTF joints are external scene objects, while authored chain bones are local rig records.

Physics uses bounded fixed steps and object-local coordinates. Integer checkpoints are cached; fractional samples save/advance/read/restore state. This avoids order-dependent cache corruption during shutter integration. Backwards seeks restart. The solver library supports multiple bodies in a `RigidWorld`; editor attachment currently uses one world per rigid object.

The triangle compiler applies hierarchical world transforms, inverse-transpose normals, mirrored-winding corrections, UVs, object/polygon IDs and per-face material slots. A `WeakMap` caches local triangulation/normals by evaluated-mesh identity. Geometry evaluation/compilation remains CPU work; neither is a GPU mesh builder.

## Acceleration and scheduling

The 12-bin SAH BVH uses adjacent sibling nodes, maximum depth 48 and a 64-entry WGSL traversal stack. Scene updates regenerate light probabilities. Interactive worker results carry revisions and stale builds are discarded. Refit quality/generation limits bound degradation; the production helper uses a 1.5× original quality threshold or 64 refits before rebuilding. Empty scenes bypass refitting.

Production rendering does not rebuild a static scene for each sample. At changing shutter times it evaluates actual geometry and refits or builds acceleration, preserving radiance accumulation. There is no BLAS/TLAS instancing or motion-BVH shortcut. Renderer queue fences bound outstanding work and protect buffer replacement. Reported submission-to-completion time is not a hardware timestamp query.

## GPU state

The main path shader consumes seven storage buffers in group 0 and one graph buffer in group 1. Texture arrays and their sampler also occupy group 1. Device allocation limits are checked; fixed-size images fail explicitly when too large. Interactive dimensions can scale to fit the pixel budget. Camera fields use 288 bytes in a 512-byte uniform allocation. See `FORMAT.md` for layouts.

Linear float32 beauty and five vec4 AOV blocks accumulate independently of display mapping. Denoising uses separate ping-pong buffers. The display pass selects beauty/AOV visualization and writes a retained color texture. PNG capture reads that texture; HDR/EXR read float buffers. Raw beauty is not replaced by denoised values or the display transform.

## Light transport paths

Surface tracing retains Lambert/GGX, ideal dielectric sampling, emissive/sky next-event estimation, power-heuristic MIS and Russian roulette. Graph evaluation resolves a bounded material record at a surface hit. The world medium is one homogeneous box; interior SSS tracks one homogeneous closed solid. The implementation is nonspectral, single-active-medium and not qualified against a reference transport integrator.

Photon emission and tracing use a separate compute entry point. A bounded array holds up to eight records per emitted photon; 4,096 atomic cell heads reference linked records. Gathering verifies spatial cells, distance and normal alignment to reject hash collisions and reduce cross-surface leakage. First-hit direct deposits are omitted; direct light is sampled separately. Final gathering extends the camera path once before density estimation. The estimator is biased and excludes media.

## Distributed execution

A submitted job copies/validates the scene, hashes it, enumerates bounded tile/sample batches and allocates accumulation. A worker claims a lease, renders the scene in its browser, heartbeats and returns little-endian float32 beauty/AOV records. The coordinator checks the lease and all values before merging. Duplicate completion is idempotent. Float64 compensated accumulation merges weighted sample means; object IDs use a nonaveraged sample label. Expired leases requeue. Cancellation stops new work; purge frees memory.

No server GPU, remote shell, external-scene downloader, plug-in executor or cloud provisioning is hidden in this path. Localhost binding and bearer authentication are defaults. Jobs are not persisted. A trusted TLS reverse proxy is required for remote deployment. The HTTP scheduling/merge path was tested; actual distributed GPU execution was not.

## Verification boundary

All changed GPU paths remain uncompiled/unexecuted in the current build environment because managed Chromium denies navigation. The source includes an executable regression page for a supported environment. CPU and offline UI results cannot establish GPU numerical correctness or speed. Archived v0.1 shader results are historical only.

## Primary conceptual/specification references

- WebGPU: https://www.w3.org/TR/webgpu/
- WGSL: https://www.w3.org/TR/WGSL/
- glTF 2.0: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- OpenEXR file layout: https://openexr.com/en/latest/OpenEXRFileLayout.html
- PBRT volume scattering: https://pbr-book.org/3ed-2018/Volume_Scattering
- PBRT subsurface scattering: https://pbr-book.org/3ed-2018/Light_Transport_II_Volume_Rendering/Subsurface_Scattering

These references describe techniques and formats; they are not independent validation of this implementation. No external SDK implementation is bundled.
