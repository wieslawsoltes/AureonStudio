# Architecture

## Module boundaries

```text
index.html + styles.css
          │
          ▼
  src/app.js — editor orchestration, commands, transactions, input
     │          │                  │
     │          ├── ui/inspector.js + ui/editors.js
     │          ├── io/storage.js — local recovery
     │          └── io/formats.js — interchange and render output
     ▼
  scene/document.js — canonical document, hierarchy, animation
     │
  geometry/ — primitives, polygon topology, modifiers
     │
  render/compile.js — evaluated world triangles, normals, UVs, materials
     │
  render/bvh-worker.js — build or refit, light distribution
     │
  render/renderer.js — device, buffers, pipelines, display/readback
     ├── raster.wgsl: vertex + fragment modeling viewport
     ├── pathtrace.wgsl: compute transport integrator
     └── display.wgsl: fullscreen HDR presentation
             └── common.wgsl: ABI, materials, BRDF, tone mapping
```

`src/index.js` exports the reusable libraries without booting the editor. The renderer accepts an output canvas and a status callback. It does not import editor state, scene-tree widgets, or transaction history. Geometry and scene algorithms run in Node tests without a browser.

## Canonical state and transactions

The canonical document is plain JSON-compatible data. GPU buffers, evaluated geometry, selected components, and UI layout are not serialized into the document. Objects reference parents by ID and materials by array index. Validation checks format/version, IDs, transforms, material references, hierarchy cycles, supported geometry and modifiers, animation structure, and principal render settings.

Commands use a `History` transaction. A transaction stores before/after JSON snapshots and rolls back on an exception inside the transaction. Undo and redo restore complete canonical documents, invalidate geometry caches, and request a renderer update. History keeps at most 60 transactions and approximately 64 MiB of UTF-16 snapshot text; the newest transaction is retained even when it alone exceeds that budget. This is not a delta-compressed large-scene history system.

Recovery writes are debounced to IndexedDB. This is a single recovery slot. Explicit scene-file export is the durable milestone workflow; recovery should not be described as version control.

## Geometry evaluation

Primitives produce indexed polygon meshes with finite positions, polygon loops and optional per-vertex UVs. Editable faces remain polygons until compilation. Ear clipping projects a simple planar polygon into its dominant plane; self-intersecting or degenerate polygons that cannot be clipped are rejected, not silently replaced with a triangle fan.

A non-destructive modifier stack evaluates from top to bottom. Source parameters or source editable geometry remain unchanged until a collapse or topology-edit command. Catmull–Clark implements face points, edge points, interior vertex weights and explicit boundary rules. Linear subdivision preserves the polygonal surface. Other operations deform positions or produce mirrored/inner/boundary faces.

`GeometryCache` keys evaluated meshes by object ID plus serialized source geometry, parameters and modifiers. `compile.js` caches triangulation and local shading normals in a `WeakMap` keyed by the immutable evaluated mesh identity. Transform-only changes reuse this derived data. Compilation itself still runs on the main thread; it is not GPU mesh generation.

Compilation applies parent-composed transforms, inverse-transpose shading normals, UV lookup, material IDs, object IDs and polygon IDs. Reflected transforms reverse triangle winding so geometric and shading normals stay consistent. Explicit flat cap faces on capped primitives are excluded from smooth side-normal averaging.

## Acceleration structure

The BVH builder runs in a module worker. It bins centroids into 12 bins per candidate axis and selects a surface-area split. Sibling nodes occupy adjacent slots. Small leaves are retained; maximum build depth is 48. A 64-entry traversal stack is sufficient for the binary tree depth produced by this builder.

The initial SAH partition returns an input-triangle permutation. When the triangle count matches, refitting applies that permutation to the new triangle data, recomputes exact leaf bounds, and reduces child bounds bottom-up. A full rebuild is triggered after 24 consecutive refits, when triangle count changes, or when normalized surface-area cost exceeds 1.6 times the fresh-build baseline. Matching triangle count alone is sufficient for intersection correctness, even after a topology replacement; the cost/generation policy is needed to keep the partition useful.

Every update regenerates emissive-triangle probabilities and the per-triangle area PDF used by light-hit MIS. Emission edits therefore cannot leave stale light sampling probabilities behind. Worker messages carry a document revision. The editor discards obsolete results and coalesces pending work instead of displaying a completed build for an older edit.

This is a flattened, single-level BVH. BLAS/TLAS instancing, GPU construction, BVH compression, wide nodes and traversal packet scheduling are not implemented.

## Surface transport

The compute pass dispatches 8×8 workgroups. Each pixel/sample uses a PCG-derived integer generator converted to a 24-bit float strictly below one. Camera samples include pixel jitter and optional thin-lens aperture sampling.

The material model combines Fresnel-attenuated Lambert diffuse and GGX microfacet reflection, with a metallic blend and roughness floor for reflection sampling. Transmission is a mixture with an ideal smooth dielectric lobe using Fresnel reflection/refraction and the radiance-mode eta-squared factor. It is not rough transmission, a layered measured BRDF, spectral transport, or a nested-medium system.

Visible emissive surfaces add radiance. Mesh-light next-event estimation samples a CDF weighted by triangle area and emitted luminance. Environment next-event estimation samples a uniform sphere. Power-heuristic MIS is applied against BSDF sampling; reciprocal MIS weights are applied on emissive hits and environment escape. At the terminal bounce, direct-light samples use unit MIS weight because no continuation strategy is evaluated. Russian roulette begins after the third bounce. The user bounce limit truncates transport; no claim of an exact infinite-bounce solution is made.

The renderer uses scale-relative intersection offsets and float32 GPU geometry. Extremely large coordinates, submillimeter thin geometry far from the origin, heavily refractive caustic scenes, and high-dynamic-range outliers are not production-qualified.

## GPU resources and presentation

Raster and compute pipelines consume the same packed triangles/materials. The raster view is deliberately a responsive preview: its studio lighting does not represent the scene's full indirect illumination. The compute pass writes a float32 RGBA accumulation buffer using an online average. Camera, scene and integrator changes restart sampling at zero.

Both rendering paths write a **retained GPU color texture**. That texture is copied to the browser's presentation texture. PNG export copies the retained texture to a mapped readback buffer, removes 256-byte row padding, performs BGRA/RGBA channel mapping where required, and encodes those actual display pixels. It does not depend on a canvas presentation texture remaining valid after presentation. HDR export copies the float accumulation buffer directly, without exposure, display mapping, clipping or gamma conversion.

Display uses a rational filmic fit followed by the sRGB transfer function. It is not an OCIO pipeline or a complete ACES implementation. The retained color texture is 8-bit output; PFM preserves the underlying float32 render.

The device queue is fenced before replacing buffers and between submitted frames. This bounds outstanding work. Diagnostics report CPU submission-to-queue-completion elapsed time, not hardware timestamp-query GPU time. Resolution and storage allocations are checked against explicit pixel limits and adapter buffer limits. Device loss is reported, with save/reload guidance; automatic device reconstruction is not implemented.

## Animation

Each object stores transform keys. The timeline samples position, Euler rotation and scale using step, linear, or cubic smoothstep interpolation. Rotation values remain numeric channels, allowing full revolutions. This also means the system is not quaternion interpolation, a tangent-editable Bezier controller, or a general animation graph.

Scrubbing updates the current transform channels. Rendering the current frame uses those channels, allowing manual edits before key insertion. Editing an existing key or enabling auto key updates the corresponding stored key. The curve editor operates on draft keys and commits them as one history transaction. Animation is evaluated frame by frame; there is no shutter-time sampling or motion blur.

## Public technical references

These are conceptual/specification references, not bundled third-party implementation source:

- W3C WebGPU: `https://www.w3.org/TR/webgpu/`
- W3C WGSL: `https://www.w3.org/TR/WGSL/`
- PBRT, Fourth Edition, A Better Path Tracer: `https://www.pbr-book.org/4ed/Light_Transport_I_Surface_Reflection/A_Better_Path_Tracer`
- PBRT, Fourth Edition, Bounding Volume Hierarchies: `https://www.pbr-book.org/4ed/Primitives_and_Intersection_Acceleration/Bounding_Volume_Hierarchies`

The implementation uses standard rendering concepts but does not claim bitwise equivalence, numerical conformance to a reference integrator, or equivalence to another renderer's output.
