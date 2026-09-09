# Native document format and GPU data layout

## `.aureon` version 1

The native file is UTF-8 JSON with `format: "aureon-studio"` and `version: 1`. `examples/empty-scene.aureon` is the smallest complete example with all required settings. Save/open preserve the document's data rather than an evaluated display snapshot.

```js
{
  format: "aureon-studio",
  version: 1,
  name: "Scene name",
  objects: [],
  materials: [],
  camera: {
    target: [0, 1.3, 0], yaw: 0.56, pitch: 0.4, distance: 8.5,
    fov: 42, projection: "perspective", aperture: 0, focus: 8.5
  },
  settings: {
    samples: 128, bounces: 6, exposure: 0.2,
    environment: 0.5, resolution: 0.75, view: "beauty"
  },
  animation: {start: 0, end: 120, fps: 24, frame: 0, interpolation: "smooth"}
}
```

The empty arrays above illustrate structure, not a complete valid file: a native document must contain at least one valid material.

Objects contain a unique string `id`, name, type, primitive `params` or editable `mesh`, nullable parent ID, visible/locked flags, material array index, position, rotation, scale, modifier array, and transform-key array. Position is measured in scene meters. Rotation channels use degrees; orbit-camera yaw/pitch use radians. Scale components must be nonzero. Parenting composes local transforms; changing a parent in the inspector preserves local channels, not world position.

`hiddenInViewport` omits geometry from the raster viewport/picking while leaving it in the path tracer. `cameraVisible: false` omits primary-ray intersections while retaining secondary-ray/reflection/shadow participation. Demo softboxes use both flags. Ordinary visibility hides an object's descendant hierarchy during scene compilation.

Mesh positions are a flat number array with XYZ triples. `faces` contains polygon index loops. `uvs` is empty or contains one UV pair for each vertex. `smooth` selects vertex-normal shading. Optional `flatFaces` lists polygon indices that should retain face normals and not contribute to smooth-side averaging.

Material records contain `id`, `name`, hexadecimal sRGB base `color`, roughness, metallic, transmission, IOR, emission, procedural pattern name and pattern scale. Base colors are decoded into linear RGB when compiling GPU materials. Emission is a radiance multiplier, not a calibrated lumens/watts light UI.

A modifier record is `{type, value, enabled}`. The implementation's supported type keys are `subdivide`, `smooth`, `twist`, `bend`, `taper`, `noise`, `mirror`, and `shell`. The UI label for `smooth` is Catmull–Clark.

A key stores `{frame, position, rotation, scale}`. `smooth` interpolation means cubic smoothstep within each segment, not an editable Bezier spline. The current object transforms may contain manual, not-yet-keyed edits; current-frame compilation intentionally uses those channels. Scrubbing evaluates stored keys again.

## GPU ABI

All GPU arithmetic/data values are float32 except the packed BVH child/count values and light triangle indices. JavaScript writes typed-array views into aligned ArrayBuffers. WGSL structs in `common.wgsl` and `pathtrace.wgsl` are authoritative.

### Triangle: 128 bytes / 32 float slots

| Float slots | Meaning |
|---|---|
| 0–3 | Vertex A XYZ, material array index |
| 4–7 | Vertex B XYZ, compiled object index (one-based) |
| 8–11 | Vertex C XYZ, source polygon index |
| 12–15 | Shading normal A XYZ, reserved |
| 16–19 | Shading normal B XYZ, reserved |
| 20–23 | Shading normal C XYZ, reserved |
| 24–27 | UV A and UV B |
| 28–31 | UV C, numeric bit flags, emissive sampling probability per unit area |

Flag bit 0 is hidden in the modeling viewport. Flag bit 1 is hidden from primary path-tracing camera rays. The BVH build reorders complete records and stores the input permutation for future refits. Do not keep an input-triangle index as a post-build triangle handle.

### BVH node: 32 bytes

Lower-bound XYZ floats plus a uint32 child/leaf-start field, followed by upper-bound XYZ floats plus uint32 leaf count. `count == 0` means an internal node whose children are `left` and `left + 1`. Empty scenes are handled explicitly before traversal.

### Material: 64 bytes

Four vec4 blocks: linear base color/roughness; metallic/transmission/IOR/emission; pattern ID/pattern scale/reserved; reserved. Pattern IDs are solid=0, checker=1, marble=2, wood=3.

### Light: 16 bytes

A uint32 reordered triangle index and three floats: cumulative probability, discrete probability, triangle area. The final CDF value is exactly 1. The area PDF written into the triangle is probability divided by area. Non-emissive triangles have zero area PDF after every build/refit.

### Camera uniform and accumulation

The camera buffer is 256 bytes; used fields occupy the first 192 bytes. It includes camera basis, FOV/aspect, exposure/environment, dimensions/sample index/bounce limit, lens values, scene counts/selection/debug mode, view-projection matrix and raster flags. Matrices are column-major; projection depth is WebGPU's 0–1 convention.

Accumulation is one vec4 float32 per pixel. RGB is the current arithmetic sample mean and A is 1. Sample zero replaces earlier accumulated radiance. Display output and HDR output are separate, so tone mapping never corrupts the float buffer.

## PFM output

The header is `PF`, dimensions, and `-1.0` to indicate little-endian storage. Rows are written bottom to top. Each pixel contains three little-endian float32 linear RGB values; no exposure, clipping, gamma or alpha is written. PNG instead encodes retained, tone-mapped GPU display pixels.
