# Validation report — v0.2 development build

## Recorded results

| Layer | Actual result | What this establishes |
|---|---|---|
| `npm test` | 159 passed, 0 failed | CPU algorithms/codecs/scene logic plus real HTTP coordinator behavior |
| Offline editor integration | 19 checks passed, no uncaught JS exceptions | Actual menus/dialogs/history/module-worker workflows without a GPU |
| Independent codecs | 2 checks passed | OpenCV RGB FLOAT EXR decode and Pillow exact RGBA PNG decode |
| Example scenes | 11 validated; finite CPU triangle buffers | Loadable canonical data and CPU evaluation at saved times |
| v0.2 GPU suite | **BLOCKED; zero checks executed** | No claim of shader compilation, GPU dispatch or GPU-render correctness |
| Hardware performance | **Not measured** | No throughput/FPS claim |

Current machine-readable reports and fixtures are in `test-results/v0.2/`. The final CPU TAP report is `cpu-tests.tap`. The offline screenshot `node-editor.png` in the original downloadable v0.2 archive shows the real node graph UI on an offline page, with a GPU-unavailable workspace behind the dialog. It is not a rendered-scene screenshot.

## Why the GPU test is blocked

The installed managed Chromium policy blocks navigation to all URLs, including `http://localhost:4173/tests/production-gpu.html`. The actual runner returned `ERR_BLOCKED_BY_ADMINISTRATOR`. Its report records `status: "blocked"` and an empty check list. The policy was not changed or bypassed. An offline `about:blank` DOM can execute source modules, but it has no usable WebGPU adapter and cannot compile/dispatch WGSL.

Therefore the new graph, volume, subsurface, photon/final-gather, AOV, denoise, temporal and tile shader integrations remain **unverified**, even though their source and host code are present. CPU/editor tests cannot replace GPU tests. Old v0.1 screenshots and 32 browser checks are archived under `docs/archive/v0.1/` and apply only to that earlier code.

## CPU and HTTP coverage

`tests/core.test.mjs` and `tests/examples.test.mjs` retain the original math, primitive, modifier, BVH, native-format, editing and animation checks. `tests/production.test.mjs` adds solid volumes/topology, conformal charts and local seam-sector splitting, pin preservation, material/normal metadata, normalized skinning, dual-quaternion guards, IK target/length behavior, imported tracks, XPBD pins/constraints, rigid contacts, fractional checkpoint preservation, hair/particles, graph DAG/arithmetic, bitmap linear-light sampling/mips, EXR FLOAT/UINT round-trip, PNG structure, glTF accessors/skin/morph/hard-edge/material round-trip, PLY/USDA transforms/visibility, shutter sampling and queue arithmetic.

`tests/coordinator.test.mjs` launches a real Node HTTP server and requests auth/CORS, job submission/status, claim, heartbeat, result, EXR download, cancellation and invalid paths. Synthetic pixel data is used deliberately to isolate scheduler/merge correctness. It is not labeled as renderer output. Queue tests cover coverage, weighted mean, IDs, duplicate completion, expired/stale leases, invalid finite data and memory release.

These are finite regression fixtures, not exhaustive geometric robustness, file-format certification, adversarial security audit or light-transport reference-image comparisons.

## Offline editor coverage

`tests/offline-ui.py` embeds the actual application modules and stylesheet in an offline DOM; it does not replace algorithms or fake `navigator.gpu`. It exercises creation and the real CPU worker, rig binding/pose keys, graph application, canonical media settings, AOV/denoise configuration, conformal UVs, hair, particles, rigid/cloth attachment, position-cache baking, interchange/distributed dialog controls and a Boolean result with hidden operands. It checks document validity through the actual validator and records uncaught exceptions.

Bitmap browser decode/file-picker workflows and WebGPU resource creation are not independently proven by the DOM test. Interchange/coordinator dialog presence does not count as an end-to-end file/remote rendering test; their algorithms/HTTP paths have separate tests.

## Independent codec verification

`tests/codec-fixtures.mjs` writes a tiny original EXR and PNG. `tests/independent-codecs.py` reads them through OpenCV and Pillow. OpenCV checked 2×2 RGB float values including 3.5 and −0.4. It did not validate arbitrary AOV/UINT channels; those use the project's round-trip test. Pillow checked exact RGBA bytes including partial alpha. These fixtures are not GPU renders.

Run on a machine with optional test dependencies:

```sh
npm test
npm run test:offline-ui
npm run test:codecs
npm run examples
```

The application itself has no Python dependency. `requirements-dev.txt` covers the pre-existing browser test setup; OpenCV/Pillow are additional optional consumers. Browser runners use Playwright with a locally installed Chromium.

## GPU regression on the target machine

```sh
npm start
# In a second terminal:
python3 tests/production-gpu.py --url http://localhost:4173 --browser /path/to/chromium
```

Or manually open `tests/production-gpu.html`. The page initializes real pipelines, checks finite nonzero path output, AOV reconstruction, denoise raw-buffer preservation, bitmap/graph raster/trace execution, volume/SSS execution, stored photons/final gathering, non-square tile/full-frame agreement and temporal geometry output. A failed setup or assertion produces failure, not a synthetic success. The runner writes `gpu-report.json` and exits nonzero unless the page passed. These checks still need to be run successfully before treating this release as GPU-qualified.

`tests/browser.py` retains broader interactive browser coverage from v0.1 and can be run against the current source on an appropriate browser. Its historical passing report has not been reused as a current result.

## Performance and packaging

No v0.2 hardware render benchmark was collected. CPU geometry/physics, per-sample deformation, triangle hair and JSON-based cache/history operations can dominate large scenes; do not infer extreme speed from a small test suite. The BVH remains flattened and CPU-built/refit. Denoising/photon mapping quality and numerical stability need reference scenes and target-device measurements.

`MANIFEST.sha256` records packaged source file digests. The final archive should be verified by extraction, manifest checks and rerunning `npm test`; a separate packaging report records that check. A valid archive and passing CPU tests do not change the GPU qualification boundary.

## Publication checks

The GitHub Pages staging tests verify exact browser assets, relative imports and worker/shader URLs under `/AureonStudio/`, exclusion of server and test files, stale-output cleanup and source-directory safeguards. `npm run build:pages` emits the deployment artifact in `_site/`. Generated screenshot captures remain in the original development archives rather than the Git repository.
