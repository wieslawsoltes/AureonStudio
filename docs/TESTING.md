# Validation — v0.3.0 integration

## Evidence and scope

The integrated source was independently rerun locally with **244 CPU/HTTP/codec/packaging tests passing**, before adding four suite-runner/CI regression tests. The final CPU suite therefore contains **248 tests**. This includes a real HTTP coordinator SIGKILL/restart test, not only graceful-close persistence checks.

[PR #1](https://github.com/wieslawsoltes/AureonStudio/pull/1) contains the exact source revisions and their CI checks. The [pre-finalization validation run](https://github.com/wieslawsoltes/AureonStudio/actions/runs/34459206022) passed every matrix job on the integrated application. Final CI reruns the matrix after the documentation/runner cleanup. Check the PR and merged revision's jobs for that revision's result; do not substitute an older green run for a changed head.

| Layer | Recorded integrated-source result | Coverage |
|---|---|---|
| CPU before runner cleanup | 244 passed, no failures or skips | Geometry, controllers, simulation, formats, persistence, HTTP and Pages |
| Transport | 46 production checks + 9 startup/recovery checks passed | Real shader pipelines, 11 examples, HDR/AOV readback, denoising, temporal/tile rendering and failure diagnostics |
| Advanced shading | 12 checks passed | Graph GPU/CPU agreement, constant-edit reuse, UDIM seam filtering, fiber PDF/lobes and heterogeneous density |
| Retained editor | 34 checks passed | Actual creation/editing/history/files/animation and render-to-modeling transitions |
| Production authoring | 28 checks passed | Bevel/Boolean/UV, paint/groom drafts and undo, controllers/retargeting, scene dynamics, volume authoring and compressed EXR export |
| Independent EXR | Both directions passed | Project output decoded by official OpenEXR; reference ZIP/ZIPS mixed-type single/multipart output decoded by the project |

These browser runs used Chromium 151.0.7922.34 with **SwiftShader's software WebGPU adapter**. They execute actual WGSL and browser editor controls, not renderer test doubles. They do not measure physical-GPU speed, establish arbitrary-scene robustness or certify commercial parity. The tested browser suites finish without uncaught JavaScript or uncaptured GPU errors; deliberate error-injection cases have their own expected diagnostics.

## Reproduce

```sh
npm test
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install --with-deps chromium
npm run test:gpu:software
```

`tests/run-webgpu.py` is the canonical command dispatcher for local runs and CI. By default it runs all four suites sequentially. `--suite transport|advanced|editor|authoring` selects the identical suite used by a CI matrix job. `--plan` prints argument vectors without executing them. There is no shell-source parsing or automatic merge in this runner. Child failure, timeout and launch errors fail the command. The runner's own failure-propagation unit test mocks only a child process exit; it does not replace a renderer or count mocked rendering as GPU evidence.

Transport uses `--baseline-only` solely because the separate advanced matrix job executes `advanced-gpu.html`. The advanced suite is not omitted from the complete gate. Software mode is explicit; run `npm run test:gpu` for an available hardware adapter. A blocked browser or unavailable adapter is a failure, not a skip or pass.

Independent codec validation:

```sh
python3 -m pip install 'OpenEXR>=3.3,<4' 'numpy>=1.24,<3'
node tests/exr-interoperability.mjs generate
python3 tests/exr-interoperability.py
node tests/exr-interoperability.mjs verify
```

The fixtures include mixed HALF/FLOAT/UINT channels, values outside display range, multipart data and multiple scanline chunks. They validate supported subsets, not every EXR mode. `tests/independent-codecs.py` retains the earlier RGB FLOAT EXR/PNG checks separately.

## GPU compilation regression

The initial UDIM/material interpreter caused severe driver compilation expansion. The integrated repair compiles material DAGs into straight-line WGSL, stores editable constants separately, specializes fiber usage, uses vec4 packed-asset loads and shares one texture-load path across eight trilinear UDIM taps. Actual execution tests compare graph/fiber outputs with CPU references and exercise cross-tile filtering. Tests were not changed to use a fake image or remove these material features.

The later automatic finalization workflow failed for a different reason: extracting commands from YAML preserved a shell `;;` terminator as a Python argument. That redundant self-modifying workflow is removed. The normal read-only CI matrix now invokes explicit argument vectors through `run-webgpu.py`; merging is separate from test execution.

## Publication and retained evidence

`pages.yml` requires both build and all GPU/codec jobs. A PR run never deploys. After a merge, the `main` run deploys its tested artifact and checks HTTPS status, commit/version metadata and SHA-256 for every public asset. Reports are retained as Actions artifacts (`publication-proof`, `webgpu-*`, `openexr-interoperability`, and `live-publication-verification`).

Reports under `test-results/v0.2/` and `docs/archive/v0.1/` are historical. Their earlier blocked-GPU statements do not describe this integrated release, and their screenshots must not be presented as new validation. Multi-machine GPU performance, exhaustive collision/transport validation, storage-failure certification and unsupported interchange remain outside the proven scope.
