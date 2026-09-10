# Native, GPU and wire formats — v0.3.0

The source validators and WGSL/host packers are authoritative. These layouts are not a stable binary plug-in ABI. Native format version and application version are separate.

## Native scene

`.aureon` is UTF-8 JSON with `format: "aureon-studio"` and `version: 1`. Application release 0.3.0 adds fields without changing that storage version. `emptyDocument()` creates materials, camera, settings and animation records. Eleven editable examples are complete fixtures.

Objects retain IDs, names, type/parameters or editable mesh, parent, visibility/locking, material, local position/rotation/scale, modifiers and keys. Meshes store flat XYZ `positions`, polygon `faces`, optional per-vertex `uvs`, smoothing, `flatFaces`, `vertexNormals`, `faceMaterials` and `uvCharts`. `object.materialSlots[mesh.faceMaterials[face]]` resolves a face material; otherwise the object material applies. Normals and metadata must match topology. Parent visibility propagates. `hiddenInViewport` skips raster/picking; `cameraVisible:false` excludes primary path hits, not secondary/shadow participation.

Rig records contain bones with local quaternion transforms, inverse-bind matrices, four indices/weights per vertex, and optional external joint IDs. Bone keys store frame, quaternion rotation and optional position/scale. Imported glTF tracks retain translation/rotation/scale/weights, time arrays, interpolation and CUBICSPLINE tangents. Timeline frames are converted to seconds using FPS. Native manual keys and imported tracks remain different representations.

`object.controllers` and `object.constraints` are ordered records interpreted by `animation/controllers.js`. Expressions use bounded arithmetic ASTs, not JavaScript evaluation. Retargeting writes ordinary target rig keys. Simulation roles include rigid, cloth, fluid and collider; scene-level interaction is managed by `simulation/scene-world.js`. `meshCache.frames` stores frame/position arrays with interpolated playback. Morph targets store position deltas. Topology-changing caches are not a general interchange format.

Hair/particle `procedural` records reference source objects and generation parameters. Hair grooming stores root-bound guides; evaluated meshes carry tangent/radius metadata. Bevel modifiers support width/value, segments, profile, selected edge pairs/weights, all/sharp selection and angle. Exact Boolean internals use rational values, but native/render mesh coordinates remain JSON floating-point numbers.

## Textures, graphs and media

`doc.textures` stores embedded bitmap or layered UDIM assets. `material.bitmap` is a logical texture index. Bitmap source data are RGBA8; GPU layers are resampled to a common `settings.textureResolution` and mipmapped in linear light. Alpha is stored but is not a general surface-coverage transport model.

UDIM tile numbers are `1001 + u + 10*v`, with `u` in 0–9 and `v` in 0–99. Missing-tile colors are explicit. `materials/udim.js` flattens logical tiles/layers for GPU upload. Painting keeps layers in the native document rather than storing only the final displayed image.

A material graph contains nodes with IDs/types, upstream inputs, values and UI positions, plus named surface outputs. At most 63 source nodes plus a terminal instruction are allowed per graph; the generated pipeline has an additional total-instruction budget. Outputs include baseColor, roughness, metallic, emission, transmission, IOR, subsurface and density. Graph connectivity compiles to WGSL; packed numeric values remain separately editable.

`material.subsurface = {weight,density,anisotropy}` is an object, not a scalar. `material.absorption` stores RGB interior coefficients. `material.fiber` contains absorption, IOR, longitudinal/azimuthal roughness and tilt.

Legacy `doc.volume` describes a homogeneous world box. `doc.volumes` adds at most 32 regions with bounds, density, color, anisotropy, emission, priority and replacement mode. A grid has dimensions and either dense data or sparse 8-cubed blocks; an optional affine `indexToWorld` overrides bounds mapping. This native representation is not `.vdb` compatibility. Grid dimensions, coefficients, transforms and budgets are validated.

Settings include path/photon/finalGather integrator, photon count/radius, progressive-photon mode, denoise controls, texture resolution/LOD, seed, view and shutter offsets. Shutter endpoints are timeline-frame offsets. Camera keys can animate orbit/lens channels.

## GPU layouts

| Record | Bytes | Layout |
|---|---:|---|
| Triangle | 128 | A.xyz/material, B.xyz/object, C.xyz/polygon, three normal vec4s, UV01 vec4, UV2/flags/light-area-PDF vec4 |
| BVH node | 32 | lower.xyz + uint child/start, upper.xyz + uint leaf count |
| Material | 64 | base/roughness, metal/transmission/IOR/emission, pattern/scale/bitmap+1/graph offset, graph count/SSS parameters |
| Light | 16 | uint triangle + float CDF, PMF, area |
| Graph instruction | 64 | op, argument, value, extra vec4s; storage is viewed as vec4 values |
| Photon | 80 | position/kind, normal, power, incoming direction, uint next vec4; kinds 1=surface and 2=volume |
| Beauty | 16/pixel | float32 RGBA sample mean |
| AOVs | 80/pixel | five float32 vec4 blocks |

Photon storage begins with a 16,384-byte header: 4,095 spatial hash heads and one transport-diagnostic word, followed by records. Triangle normal padding carries octahedral fiber tangent/radius data when flag bit 8 is set; flag bit 4 marks medium candidates. Other flags retain visibility roles.

The camera allocation is 512 bytes and the declared structure occupies **352 bytes**. Float-slot offsets: 0 eye/tanHalfFOV; 4 right/aspect; 8 up/exposure; 12 forward/environment; 16 image size/sample/bounces; 20 lens; 24 counts/selection/view; 28–43 column-major view-projection; 44 raster flags; 48 legacy volume minimum/density; 52 maximum/anisotropy; 56 volume color; 60 integrator/count/radius/denoise; 64 tile offset/full-frame size; 68 sampleStart/interiorCandidate/seed/LOD; 72 textureOffset/count/volumeOffset/count; 76 materialOffset/progressive flag/reserved/interior count; 80 world minimum; 84 world maximum. Tile rays use full-frame aspect.

Group 0 bindings are camera 0, triangles 1, materials 2, nodes 3, beauty 4, lights 5, AOVs 6, photons 7. Group 1 holds sampler 0, bitmap array 1 and packed asset storage 2. Reflection removes unused bindings for individual entry points. Main compute uses eight storage bindings including assets.

The asset packer appends texture descriptors, direct scalar tile tables, 48-float volume descriptors, density tables/leaves and material records after graph values. Descriptor offsets count 16-float instructions; voxel/tile offsets count scalar floats.

AOV floats per pixel: 0–3 albedoRGBA; 4–7 normalXYZ/depth; 8–11 emissionRGB/objectID; 12–15 directRGBA; 16–19 indirectRGBA. Beauty RGB equals direct plus indirect by definition. Object IDs are one-based compiled indices, not stable mattes; zero is background and IDs are sampled rather than averaged coverage.

## Image files

Legacy `io/exr.js` writes uncompressed single-part FLOAT/UINT scanlines and remains used by older APIs/coordinator output. `renderChannels(hdr,aovs)` produces 21 channels: beauty RGBA, albedo RGB, normal RGB, Z, objectId, emission RGB, direct RGB and indirect RGB. Only objectId is UINT.

`io/exr-advanced.js` adds asynchronous `encodeEXRAdvanced`/`decodeEXRAdvanced`: NONE/ZIP/ZIPS, HALF/FLOAT/UINT and multipart flat scanline data. HALF overflow and unsupported deep/tiled modes reject. Reciprocal official OpenEXR fixtures validate supported combinations. Raw output remains unclamped scene-linear; denoising does not replace raw AOVs. PNG reads the retained display-mapped texture. PFM is bottom-up little-endian RGB float32 (`PF`, negative scale).

## Coordinator protocol and persistence

Every `/api/` request requires `Authorization: Bearer TOKEN`. Job submission is JSON. Tile results are little-endian float32, **24 floats/pixel**: beauty4 then AOV20. They represent the mean over the declared sample interval and must have exact size and finite values. `X-Render-Lease` identifies the task lease.

```text
GET    /api/status                       durability/recovery diagnostics
POST   /api/jobs                         {scene,width,height,samples,tileSize,batchSize}
GET    /api/jobs                         list
GET    /api/jobs/:id                     status
GET    /api/work?worker=:workerID        claim or null
POST   /api/jobs/:id/tasks/:n/heartbeat  lease header
POST   /api/jobs/:id/tasks/:n/result     lease header + binary payload
GET    /api/jobs/:id/image.exr            completed merged image
DELETE /api/jobs/:id                     cancel
DELETE /api/jobs/:id?purge=1              remove and free memory
```

The default queue persists acknowledged operations using checksummed fsync-backed log records and atomic snapshots in `RENDER_STATE_DIR`. Unfinished leases become pending after restart; acknowledged duplicates remain idempotent. Interrupted trailing writes can be discarded, while corrupt complete records fail closed. `RENDER_EPHEMERAL=1` selects in-memory operation. Node/V8 state is not a portable cross-version archival format.

Scene payloads, task counts, tile/sample/image dimensions and accumulation memory are bounded by the scheduler; workers may have smaller GPU limits. The default coordinator memory budget is 512 MiB and is configurable with `RENDER_MEMORY_MIB`. This is an authenticated single-writer service, not a multi-tenant or highly available render farm.
