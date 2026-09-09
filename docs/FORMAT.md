# Native, GPU and wire formats — v0.2

## Native `.aureon` document

The root remains UTF-8 JSON with `format: "aureon-studio"` and `version: 1`. Additive v0.2 fields extend that storage version. The application release is 0.2.0; it is not native format version 2. `emptyDocument()` creates the required materials, camera, settings and animation records. Eleven examples are complete fixtures.

Objects retain `{id,name,type,params,mesh,parent,visible,locked,material,position,rotation,scale,modifiers,keys}`. Rotations are Euler degrees; camera yaw/pitch and quaternions follow their own units. Meshes use flat XYZ `positions`, polygon index-loop `faces`, optional per-vertex `uvs`, `smooth`, optional `flatFaces`, `vertexNormals`, `faceMaterials` and `uvCharts`. `object.materialSlots[mesh.faceMaterials[face]]` resolves an optional face material; otherwise the object's material is used. Normals and metadata must match their topology.

Visibility propagates through parents during compilation. `hiddenInViewport` skips raster/picking and `cameraVisible:false` skips primary path hits but not secondary/shadow participation. Parenting uses local channels. A saved object may have manual current-frame channel edits; scrubbing samples its stored keys again.

### Deformation

```js
object.rig = {
  mode: 'linear', // or 'dualQuaternion'
  bones: [{ name:'Root', parent:-1, position:[0,0,0],
            rotation:[0,0,0,1], scale:[1,1,1], keys:[] }],
  inverseBind: [ /* one column-major 16-number matrix per bone */ ],
  indices: [ /* four integer joint indices per source vertex */ ],
  weights: [ /* four normalized weights per source vertex */ ],
  externalJoints: undefined // imported skin: scene object IDs
};
object.simulation = {
  type:'cloth', floor:-2, gravity:[0,-9.81,0], pins:[0,1],
  compliance:1e-6, substeps:4, iterations:8, start:0
};
// Rigid settings use type:'rigid' and body:{radius,restitution,...}.
object.meshCache = {frames:[{frame:0,positions:[/* XYZ */]}]};
object.morphTargets = [ /* position-delta arrays */ ];
object.morphWeights = [ /* one weight per target */ ];
```

Bone keys store quaternion rotation and optional local position/scale with a frame. Imported `tracks` store `{path,times,values,components,interpolation}` with times in seconds and optional `trackFPS`; paths are translation/rotation/scale/weights. The native timeline frame divided by FPS selects a track time. CUBICSPLINE values retain in-tangent/value/out-tangent triples.

Hair uses `procedural:{kind:'hair',source:objectID,count,length,segments,radius,sides,clump,curl,seed,dynamics}` on an empty mesh child of its source, with identity local transform. Particles use `kind:'particles'` with `rate,lifetime,speed,spread,radius,origin,direction,gravity,floor,restitution,seed`. These records produce real meshes rather than storing GPU-only effects.

### Textures, graphs, media, render settings

`doc.textures` contains `{name,width,height,data:[RGBA8 bytes]}`. `material.bitmap` is a zero-based texture index. Source images remain original-size; GPU layers are resampled to `settings.textureResolution` (default 256). Alpha is stored but not surface coverage.

`material.graph = {nodes:[{id,type,inputs,value,scale,texture,channel,ui}],outputs:{baseColor,...}}`. Inputs name upstream node IDs. UI positions do not alter evaluation. At most 63 source nodes plus a terminal material instruction are supported. Outputs are baseColor/roughness/metallic/emission/transmission/ior/subsurface/density. Base color is required when a graph is enabled.

`material.subsurface = {weight,density,anisotropy}` controls homogeneous interior scattering. **It is an object, not a numeric `subsurface` field.**

`doc.volume = {min:[x,y,z],max:[x,y,z],density,color:[linear RGB],anisotropy}` is the homogeneous world medium; density zero disables it. **This field is on the document, not inside settings.**

Settings add `integrator:'path'|'photon'|'finalGather'`, `photonCount`, `photonRadius`, `denoise`, `denoiseIterations`, `textureResolution`, `textureLod`, `seed` and `shutter:[open,close]`. Shutter endpoints are offsets in timeline frames. Existing `view` values extend to beauty/albedo/normals/depth/objects/emission/direct/indirect. `camera.keys` optionally store frame and orbit/lens channel values for temporal rendering.

## GPU layouts

WGSL declarations are authoritative. This source ABI is not a promised stable binary/plugin ABI.

| Record | Size and fields |
|---|---|
| Triangle | 128 bytes; A.xyz/material, B.xyz/object index, C.xyz/polygon, three shading-normal vec4s, UV01 vec4, UV2/flags/light-area-PDF vec4 |
| BVH node | 32 bytes; lower.xyz + uint child/start, upper.xyz + uint leaf count |
| Material | 64 bytes; baseRGB/roughness, metal/transmission/IOR/emission, patternID/scale/bitmapPlusOne/graphOffset, graphCount/SSSDensity/anisotropy/SSSWeight |
| Light | 16 bytes; uint triangle + float CDF, PMF, area |
| Graph instruction | 64 bytes; op vec4, argument vec4, value vec4, extra vec4 |
| Photon | 80 bytes; position/valid, normal, power, incoming direction, uint next vec4 |
| Photon store | 16,384-byte array of 4,096 atomic uint heads, followed by photon records |
| Beauty | 16 bytes/pixel; float32 RGBA sample mean |
| AOVs | 80 bytes/pixel; five float32 vec4 blocks, below |

The camera uniform is allocated as 512 bytes; declared fields occupy **288 bytes**. Float-slot offsets: 0 eye/tanHalfFOV; 4 right/aspect; 8 up/exposure; 12 forward/environment; 16 width/height/sample/bounces; 20 aperture/focus/ortho/size; 24 triangle/light counts, selection and view; 28–43 view-projection; 44 raster flags; 48 volumeMin/density; 52 volumeMax/anisotropy; 56 volumeRGB; 60 integrator/photonCount/radius/denoise; 64 tileOffsetXY/fullFrameWH; 68 sampleStart/reserved/seed/textureLOD. Matrices are column-major. Tile rays use full-frame aspect, not tile aspect.

AOV float offsets per pixel: 0–3 albedoRGBA; 4–7 normalXYZ/depth; 8–11 emissionRGB/objectID; 12–15 directRGBA; 16–19 indirectRGBA. Beauty RGB equals direct plus indirect by definition of the split. Object IDs are one-based compiled indices; zero is background. IDs remain a sampled label, not a coverage-weighted matte.

Group 0 bindings: camera 0, triangles 1, materials 2, nodes 3, beauty 4, lights 5, AOVs 6, photons 7. Group 1: bitmap sampler 0, bitmap array 1, graph storage 2. Entry-point reflection removes unused resources for raster/display/photon layouts. The main compute path uses eight storage bindings including the graph.

## EXR/PNG/PFM

`encodeEXR({width,height,channels,metadata})` writes a single-part scanline image with FLOAT or UINT channel arrays. Compression is NONE; scanline chunks and offsets are little-endian. `renderChannels(hdr,aovs)` yields 21 channels: beauty RGBA, albedo RGB, normal RGB, Z, objectId, emission RGB, direct RGB, indirect RGB. Only objectId is UINT. The decoder is a matching subset, not a general OpenEXR reader.

Raw beauty output is unclamped scene-linear float32. Selecting denoised beauty changes only beauty channels; raw AOVs remain unchanged. PNG is the retained displayed image, with tone mapping and an sRGB transfer. PFM remains bottom-up little-endian RGB float32 (`PF` and negative scale).

## Coordinator wire protocol

Every `/api/` request needs `Authorization: Bearer TOKEN`. JSON creates jobs. Binary results are **little-endian float32, 24 floats per pixel**: beauty4 followed by AOV20. Each tile represents the mean of its declared contiguous sample interval. Results must have exact size and all finite values. `X-Render-Lease` identifies a claimed task lease.

```text
POST   /api/jobs                         {scene,width,height,samples,tileSize,batchSize}
GET    /api/jobs                         list
GET    /api/jobs/:id                     status
GET    /api/work?worker=:workerID        claim or null
POST   /api/jobs/:id/tasks/:n/heartbeat  lease header
POST   /api/jobs/:id/tasks/:n/result     lease header + binary payload
GET    /api/jobs/:id/image.exr            merged completed image
DELETE /api/jobs/:id                     cancel
DELETE /api/jobs/:id?purge=1              remove and free memory
```

Scene payloads are limited to 32 MiB, coordinator accumulation to 512 MiB by default (`RENDER_MEMORY_MIB` can raise it), tasks to one million, tile edges to 256, sample batches to 1,024 and image/sample dimensions to 8,192. Per-worker GPU allocation limits may be smaller. The job queue is in-memory and authenticated but not a multi-tenant render-farm service.
