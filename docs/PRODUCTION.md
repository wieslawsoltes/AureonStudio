# Production workspaces and operations

This guide describes implemented controls, not a claim of production qualification. GPU-dependent output still needs validation on a supported browser/device.

## Solids and UVs

Select two closed solids and choose **Model → Solid boolean…**. The evaluated result is transformed into the first operand's local space, preserving that object's parent/transform; the originals can be hidden rather than deleted. Result faces carry operand material slots. A failed topology/size check reports the reason. The bevel command adds the real convex chamfer modifier; remove coplanar triangulation edges and use a conservative positive width.

Open the UV editor for an object. Applying topology-based UV work bakes the evaluated mesh and removes incompatible rig/simulation/procedural/cache state so that stale vertex weights cannot survive a topology change. Seam input uses canonical `minVertex:maxVertex` edge pairs. Automatic seams cut a dual spanning forest, while manual seams allow fewer cuts. Use LSCM, packing and relax controls; select UV vertices/islands to transform or stitch. Shift-click pinning constrains unwrap values. Inspect charts for distortion/overlap: LSCM plus shelf packing is not a full automatic asset-quality guarantee.

## Rig, physics, hair and particles

**Animation → Skeleton / skin / IK…** binds an evaluated mesh, generates chain bones and four-influence weights, or edits an existing authored rig. Bone selection exposes translation, quaternion-backed rotation and scale, optional pose keys and numeric influence editing. FABRIK supports end/root choice, target and pole. Apply stores the result through history. Imported external skeletons are scene-node hierarchies; their tracks are not automatically rewritten by this dialog.

Cloth/rigid dialogs bake the current mesh and attach local solver settings. The collision floor is object-local, not global Y after arbitrary rotation/parenting. Rigid radius/restitution live under `simulation.body`. Each editor-attached body is currently simulated separately. Use the standalone `RigidWorld` API for interacting sphere proxies in one world; there is no scene-wide collider binding yet. Bake cache writes actual positions over a bounded frame range and preserves frame order. Saved caches interpolate positions between samples.

Hair creation attaches an empty procedural mesh child to the selected source. Set count, length, segment/ring resolution, radius, clump/curl and seed. Optional dynamics are root-pinned constraints; high counts are expensive because strands become triangles. Particles are time-dependent real octahedra with deterministic seeds and a local floor. Population depends on emission rate and lifetime, subject to explicit budgets.

## Textures, graphs and media

**Render → Bitmap textures…** imports an image or assigns a stored texture. The source pixels are embedded in the native document; GPU layer resolution is independently configurable. No external image path is required after saving. The original pixels can make history/files large.

**Render → Material node graph…** opens connected draggable cards. Add a supported node, choose its upstream inputs, edit values and connect surface outputs. Validate catches cycles and missing references; Apply changes the actual shared material. An image node selects an imported texture layer. Disable the graph to use ordinary material controls. Values are linear shading values; bitmap colors decode sRGB.

**Render → Volumes / subsurface…** configures one world box medium and the active material's homogeneous subsurface parameters. Use closed isolated solids for subsurface random walks and a sufficient bounce budget. Nested/overlapping media are unsupported. Photon modes reject media/SSS rather than silently rendering them with the wrong integrator.

## Fixed frames, AOVs and EXR

**Render → Production render settings…** selects the integrator, photon controls, denoising and viewed AOV. The interactive viewport is still a single sampled time. **Render → Render frame / motion blur…** performs fixed-size temporal integration. Shutter values are offsets in frames, not seconds: at 24 FPS a width of one frame spans 1/24 second. Zero endpoints disable blur.

Each shutter sample evaluates actual transform, bone, procedural and cache geometry. A closed shutter reuses the scene; a changing shutter refits/rebuilds. Oversized frame allocations reject rather than silently rescale. Cancelling the dialog aborts between samples and restores the interactive rendering configuration. Completed output remains a fixed-size frame until editing/resume.

EXR output offers raw or denoised beauty with raw AOVs. Requesting denoised output without a completed denoise buffer rejects. The EXR is uncompressed, linear FLOAT/UINT; exposure and display tone mapping are not baked into it. PNG uses the current displayed view; PFM contains raw linear RGB. There is no animation-sequence render/export queue UI.

## Distributed coordinator

Start the editor server and optional scheduler separately:

```sh
npm start
npm run render:server
```

The second command prints a random token and listens only on loopback by default. In the editor's distributed dialog use `http://127.0.0.1:4183`, enter the token, choose dimensions/sample/tile/batch sizes and submit. Open `http://127.0.0.1:4183/worker.html`, enter the same token and start. Additional supported browser workers can claim other tiles. Keep workers open; closing a tab stops that worker, and its lease eventually expires.

The worker uses the same WebGPU renderer and scene file. The server does not provide GPU acceleration itself. A stopped/failed worker does not imply a completed image; inspect task counts/status before downloading. The Stop button finishes the current tile rather than interrupting a dispatch. Failed workers report errors; leases permit another worker to retry. Completed images are merged on the server and downloaded as EXR. Purge finished/cancelled jobs to release memory.

Environment configuration:

```sh
RENDER_HOST=127.0.0.1 RENDER_PORT=4183 \
RENDER_TOKEN='replace-with-a-long-random-secret' \
RENDER_ORIGINS='http://localhost:4173,http://127.0.0.1:4173' \
node scripts/render-server.mjs
```

For remote machines, terminate HTTPS with a trusted reverse proxy, configure the intended host/origins/firewall and use a strong token. Do not expose a development token over plaintext LAN/WAN HTTP. Remote WebGPU pages need a suitable secure context. The application does not configure certificates, open firewall ports, discover machines, buy compute or store cloud credentials. Authentication grants job-level administrative access; this is not a tenant-isolated service. Jobs do not survive coordinator restart. `RENDER_MEMORY_MIB` sets the accumulation budget (default 512); a 1080p job needs a larger budget because each pixel has compensated multi-channel accumulation. This is server memory, separate from each tile's GPU allocation.

An HTTP integration test validates leases/retries/merging/auth/output with synthetic finite tile data. It is **not** an end-to-end multi-GPU render test. Run the GPU suite locally and verify a small actual distributed frame before large jobs.

## Interchange

**File → Production interchange…** imports GLB/glTF and ASCII PLY and exports GLB/glTF, PLY and USDA snapshots. For glTF with external resources, choose companion files together; missing assets fail explicitly. Native scenes retain richer state than portable export. Optional unsupported glTF material channels produce warnings. glTF's first animation clip is the default; API callers can select a different clip. Export validates skin/morph topology, preserves hard edges and groups per-face material primitives.

PLY is geometry-only. USDA is a baked evaluated mesh/UV snapshot, not a complete scene composition/material/animation export. Keep the `.aureon` source when using these formats. Existing OBJ/STL commands remain available. There is no general proprietary format importer or complete FBX/Alembic/USD workflow.
