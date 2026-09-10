# Feature status — v0.3.0

This matrix describes integrated application code, not a promise of production parity. CPU tests, real browser execution, image readback and independent codecs provide different evidence. Their current scope is recorded in [TESTING.md](TESTING.md). Physical-GPU throughput, exhaustive geometry robustness and general format certification have not been established.

## Modeling and UVs

**Boolean union, subtraction and intersection** default to rational BSP operations. Binary64 input coordinates are converted to exact rational values; classification and intersection construction use `BigInt`. An explicit fast mode retains floating-point tolerance-based operations. Final editable/render geometry is converted back to floating-point coordinates. Exact predicates do not make the entire geometry kernel exact or guarantee arbitrary self-intersecting/nonmanifold inputs. Closed, outward-facing manifold inputs, budgets and topology validation still apply.

**Bevel** constructs segmented quadratic edge profiles, edge strips, miter/corner caps and coplanar face patches. It supports all/sharp selection, explicit edge pairs and per-edge weights, with 1–32 segments. Convex and reflex-edge fixtures are tested, including an extruded L profile. This replaces the earlier convex-only single-segment restriction, but it is not a universally robust production bevel: overlapping offsets, degeneracies, stitching budgets and unsupported topology may reject. It is not analytic curved-surface modeling.

**UVs** include corner-sector seams, automatic cuts, LSCM with pins, relaxation, island transforms, stitching, and padded multi-tile UDIM packing. The scene still stores one UV set. Packing is deterministic rather than optimal, and parameterization does not guarantee injectivity, zero distortion or no overlap in arbitrary input.

## Animation and simulation

**Rigging** retains inverse binds, four normalized influences, linear/dual-quaternion skinning, quaternion bone keys and FABRIK. Transform controllers add curves with tangents/extrapolation, oscillators, bounded arithmetic expressions and drivers. Ordered world-space constraints include copy position/rotation/scale, parent, aim, limit, path and blended parents; dependency cycles reject. Retargeting transfers bind-space orientation deltas and optional scaled root motion, baking target keys while retaining its skin weights and inverse binds. Some advanced parameters are edited as structured JSON, not specialized graphical widgets. This is not a complete character-rig, controller plug-in or persistent IK ecosystem; dual-quaternion mode requires rigid transforms.

**Rigid bodies now share one scene world.** Attached bodies interact through sphere/convex contacts and angular impulses rather than independent per-object worlds. Mesh colliders and scene-time evaluation are integrated. Cloth uses XPBD constraints, pins, thickness, mesh contacts and self-contact. Fluid objects use CPU position-based particles, viscosity/vorticity controls and evaluated surface extraction. Fractional/backwards sampling and baked positions are supported. General concave dynamic-body collision, fully coupled two-way fluid/cloth/rigid dynamics, robust high-speed continuous collision for every shape, fracture, FEM and production-scale GPU fluids remain absent or unqualified.

**Hair** supports root-bound guide grooming and undoable brush edits, generated strand meshes, and cylindrical R/TT/TRT plus residual-lobe scattering. GPU evaluation is compared with the CPU fiber implementation, and actual groomed geometry is exercised through editor controls. Hair still uses tessellated tube geometry; dedicated analytic curve intersections, comprehensive strand self-collision, production grooming automation and a complete hair simulation system are not implemented. Ballistic particle meshes remain available; they are not a GPU effects-graph system.

## Materials and light transport

**Materials** retain diffuse/GGX reflection, ideal dielectric glass, procedural patterns and a 16-node-type graph editor. Graph connectivity compiles into straight-line WGSL. Numeric values remain in storage buffers, so value edits do not require recompilation; changed connectivity selects new pipelines. The pipeline cache is bounded. Fiber branches are specialized by material usage. UDIM lookup uses a direct tile table and one descriptor-bounded eight-tap filtering loop, avoiding the former repeated shader inlining that stalled compilation.

**Textures and painting** include embedded bitmap assets, linear-light mipmaps, UDIM tile lookup/filtering, layered source-over painting, erase, undo/redo, and commit/cancel of drafts. UV packing and painted assets reach the actual GPU scene. Texture arrays have device/memory budgets and a common uploaded resolution. There is no on-demand virtual-texture streaming, multiple UV channels, complete PBR texture-channel workflow, arbitrary shader language, texture-driven displacement pipeline or general alpha-cutout transport.

**Media** include the legacy homogeneous world box, dense and sparse scalar density fields, affine index-to-world transforms, priority replacement/additive regions, and nested homogeneous solid interiors. The host supports up to 32 volume regions; interior nesting and null-collision work are bounded, with explicit errors on overflow. Sparse leaves are the native representation, **not OpenVDB file compatibility**. Heterogeneous scattering is tested on finite fixtures; spectral transport and general reference-image qualification remain outstanding.

**Photons and final gathering** include surface/volume storage and progressive radius reduction. The density estimator remains **biased at finite sample/radius settings**. It is not a claim of unbiased photon mapping, arbitrary-volume convergence, irradiance-cache parity or exhaustive physical validation. The ordinary path integrator remains available.

## Rendering and output

Progressive HDR accumulation, emissive/environment sampling, MIS, depth of field and Russian roulette remain integrated. Production rendering evaluates actual camera, object, bone, simulation and procedural geometry at shutter times. It does not simulate blur with a screen-space smear. Geometry/BVH updates for temporal scenes are CPU work; no motion BLAS/TLAS or rolling-shutter workflow is provided.

Beauty, albedo, normals, depth, object ID, emission, direct and indirect AOVs are available. Tests check finite readback and beauty = direct + indirect. Object IDs are compiled indices, not Cryptomatte or coverage-weighted deep mattes. A-trous denoising uses separate buffers and preserves raw accumulation; it is not a learned or temporally qualified denoiser.

**EXR** supports NONE/ZIP/ZIPS, HALF/FLOAT/UINT and single/multipart scanline images. The editor exports compressed multipart images from real rendered pixels. The official OpenEXR Python implementation independently decodes project-generated fixtures, and the project decoder reads separately generated reference fixtures. Tiled/deep EXR, additional compression codecs and a general EXR scene-texture importer are not supported. PNG and PFM remain available.

## Coordination and interchange

The optional Node coordinator uses an fsync-backed write-ahead log and atomic checkpoints by default. Acknowledged tiles and compensated sums survive restart; unfinished leases are invalidated and acknowledged duplicates remain idempotent. A process-level test kills and restarts the HTTP coordinator, including an interrupted trailing record. Corrupt checksums fail closed. This is a single-writer local-state service, not a highly available multi-tenant farm. Multi-machine GPU throughput, network partitions, every storage failure and cross-version persistence migration are not certified.

Native `.aureon` retains richer application state than portable export. OBJ/STL, GLB/glTF, ASCII PLY and evaluated USDA mesh snapshots are integrated, with their earlier topology/hierarchy/material/skin/morph/animation subsets. A USDA snapshot is not a USD composition/import system. The optional pinned USD WebAssembly build is experimental and not wired into the application. **Full USD, FBX, Alembic, OpenVDB `.vdb`, `.max` and `.mi` are not supported.** No file extension is advertised as implemented merely because a codec source or build artifact exists.

The retained editor provides hierarchy, selection, transforms, modifiers, UVs, graphs, timeline, curves, history and local recovery. This release does not claim every commercial view, command, scripting API, shortcut, plug-in or accessibility certification.
