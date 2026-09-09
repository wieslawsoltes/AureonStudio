# Validation report and reproduction

## Scope

This release was exercised on 8 September 2026. Algorithm tests use Node.js v22.16.0 on Linux. Browser integration uses Chromium 144.0.7559.96, Python Playwright, and the native WebGPU API backed by **SwiftShader**, a software adapter reporting vendor `google` and architecture `swiftshader`. A headed browser under Xvfb was used for reliable presentation/capture in the test container.

These are correctness checks, **not hardware-GPU benchmarks**, commercial compatibility certification, an accessibility audit, or proof of statistical rendering convergence. No physical GPU, other browser engine, or remote deployment was tested.

## CPU test suite

```sh
npm test
```

**74 passed; 0 failed; 0 skipped.** The complete TAP output is retained in `unit-tests.tap`. No test runner package is needed: this uses Node's built-in test runner.

| Area | Assertions exercised |
|---|---|
| Math and cameras | Transform composition/inversion, projections, camera rays and parent transforms |
| Geometry | All eight primitives, finite coordinates, closed topology where expected, winding, exact cone/lathe apices, concave triangulation and polygon area |
| Editing and modifiers | Extrusion/inset topology and volume, subdivision boundary rules, all eight modifiers, source nonmutation, shell boundary walls |
| Documents and animation | Native validation, hierarchy, rollback, undo/redo and history budgets, transform key interpolation and current-channel behavior |
| Scene compilation | Evaluated geometry caching, visibility/material flags, reflected-transform winding and finite GPU records |
| Acceleration | Build/refit ray hits against brute-force and fresh-build results, emissive sampling probabilities, refit invalidation and bounds |
| Exchange | OBJ relative indexing, STL input/output, static glTF output and linear PFM encoding |
| Examples | Each of the five supplied native scenes validates and compiles into finite triangle data |

## Browser integration suite

```sh
python3 -m pip install -r requirements-dev.txt
python3 tests/browser.py --browser /path/to/chromium --headed
```

Supply an installed Chromium executable with a working WebGPU adapter. `CHROMIUM_PATH` is an alternative to `--browser`. On Linux, the script defaults to `/usr/bin/chromium`. This optional harness is not a runtime dependency of the application. It starts the local Node server when the configured local address is not already serving.

To reproduce this container's software-adapter configuration on a suitably configured Linux test machine:

```sh
xvfb-run -a python3 tests/browser.py \
  --browser /usr/bin/chromium --headed --software
```

The `--software` flag explicitly enables the SwiftShader/Vulkan launch configuration. It must not be used to substantiate hardware performance claims. Hardware-backed testing should omit that flag. The test harness enables Chromium's experimental WebGPU launch option and disables the browser process sandbox for container execution; run it only in a trusted local development/test environment. Those flags are not application requirements or production browser configuration guidance.

**32 browser checks passed.** `browser-report.json` contains every check and the adapter details. The harness fails with a nonzero exit status on assertion or unhandled test failure.

| Workflow | What is actually checked |
|---|---|
| Startup | Native adapter/device creation, compilation of all WGSL pipelines, 8,138-triangle demo compilation |
| Editing | Primitive creation using UI controls, inspector edits, BVH refitting, undo/redo, modifier reorder/collapse, viewport polygon picking, extrusion and inset |
| UV/materials | Projection and coordinate manipulation through the UV dialog, real material assignment and procedural-pattern edits |
| Transforms | Pointer-dragged transform handle updates canonical data and commits one undoable transaction |
| Animation | Timeline transform interpolation, opening/applying the curve editor, playback advancing frames |
| Documents | Real download/file-input native save/open, OBJ file-input import, IndexedDB recovery |
| Rendering | Actual compute tracing with glass and aperture enabled, finite HDR readback, radiance above display white |
| Exports | Actual PNG/PFM downloads, file signatures/sizes, decoded PNG image content and dynamic range |
| State and errors | Camera changes reset accumulation; empty geometry/light buffers are safe; no uncaught JavaScript exceptions or uncaptured WebGPU validation errors |

The renderer check uses a 262 × 143 image at 12 samples per pixel to keep the regression test tractable on a software adapter. Its exact measurements are in the JSON report. Finite output and nonblack images catch important regressions but do not prove an unbiased estimator, physical equivalence to a reference renderer, or good convergence on difficult transport paths.

The PNG-content assertion was added after visual inspection caught a valid but black export. The implementation now reads a retained GPU color target with aligned readback rows and explicit channel conversion, rather than relying on an expired presentation surface. Both the source fix and the image-content regression test are included.

## Actual screenshots and standalone renderer

`images/studio.png` is a screenshot of the running modeling application. `images/render.png` is a screenshot of the running compute renderer. These are actual application pixels, not design mockups or generated illustrations. The final render reached **64 samples per pixel at 523 × 287 pixels**; all HDR components were finite, with a maximum linear component of **8.8268**. Sample count, dimensions and measured HDR range are recorded in `final-render-check.json`. `images/render-output.png` is the actual exported display image. Residual sampling noise remains visible; this is not a denoised production-convergence claim.

The standalone renderer example is also opened independently during final capture to check that the reusable renderer entry point initializes and progresses without the editor controller. This is an additional manual/scripted smoke check, not one of the 32 integration assertions.

## CPU acceleration benchmark

```sh
npm run bench
```

`cpu-benchmark.json` records one warm-up build followed by seven trials on the supplied **8,138-triangle** scene, under Node.js v22.16.0 on an AMD EPYC 9V74 host. Observed medians were **76.38 ms for BVH build** and **5.40 ms for BVH refit**. These are process-local CPU timings from this run, not application frame rates. They exclude polygon evaluation, scene flattening, GPU upload, shader execution, display and unrelated editing work. The environment is shared and results can vary; no commercial or physical-GPU comparison was performed.

## Deployment and remaining qualification

The supplied GitHub Actions configurations have not been executed in a remote repository. Local source and example serving were exercised; GitHub Pages publication has not been performed.

Further qualification must include physical GPUs from multiple vendors; other browser/OS combinations; long-running animation and memory-pressure cases; large and adversarial meshes; statistical and reference-image comparisons; glass/caustic/light-transport edge cases; file-format interoperability; and complete production workflow testing. Passing the included checks does not turn the feature boundaries in `FEATURES.md` into completed capabilities.

Local server binding defaults to loopback only. Set `HOST=0.0.0.0` deliberately to expose it on a network; browser secure-context rules still apply.
