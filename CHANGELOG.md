# Changelog

## 0.2.0 — integrated development build

Added the modeling, UV, deformation, simulation, shading, transport, output, coordination and interchange modules enumerated in `docs/FEATURES.md`, with actual editor commands rather than disabled feature placeholders.

Notable correctness work includes corner-sector seam splitting within a connected chart; automatic dual-tree seam cuts; manifold Boolean output stitching; material slots on Boolean faces; hard-normal and material-primitive preservation in glTF; skin/morph vertex remapping; fractional simulation sampling without perturbing integer checkpoints; linear deformation-cache interpolation; original-partition BVH quality checks; global-pixel tile camera aspect and RNG; explicit allocation failures for oversized fixed frames; last-bounce direct-light MIS; raw-HDR preservation during denoising; and idempotent lease-protected result merging.

Added six editable scenes, an actual GPU regression page/runner, offline editor integration, independent codec fixtures/consumers and real HTTP coordinator tests. Revised documentation supersedes v0.1. Historical documents and reports are under `docs/archive/v0.1/`.

**Qualification:** current CPU/HTTP suite passes. Offline DOM and independent codec checks pass. v0.2 WebGPU compilation/execution remains blocked in the build environment and is not represented as passed. No hardware performance or full commercial parity claim is made.

## 0.1.0 — initial implementation

Initial editor, polygon geometry/modifiers, hierarchy, keyframe animation, raster viewport, surface path tracer, worker SAH BVH/refit, native scenes, OBJ/STL/basic glTF and PNG/PFM output. Archived reports apply to that earlier code only.
