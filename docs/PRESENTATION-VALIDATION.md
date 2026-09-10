# Canvas presentation validation

The v0.3 integration's legacy full-Chromium editor screenshots showed black compositor regions although actual retained PNG/HDR output was correct and the other headless browser suites displayed geometry. Those captures were not accepted as proof of correct viewport presentation.

The editor runner now uses Playwright's default headless browser, consistently with the other suites, unless `--browser` or `CHROMIUM_PATH` explicitly selects another executable. No application renderer, shader, pixel data or existing editor assertions are replaced.

Two additional checks compare actual canvas screenshots with retained GPU PNG readback, for both modeling and path tracing. They wait for a completed scene/frame and two animation frames, capture the displayed canvas, and compare a central 64-by-64 RGB crop with the retained image. The crop excludes corner labels/overlays. Mean absolute RGB error must be below 0.08 on a 0–1 scale, and the reference image must have variance above 0.002. Black or uniform canvas output fails; a correct HDR buffer alone is no longer sufficient.

The retained editor suite consequently has 36 checks (the previous 34 plus these two), with the same geometry, editing, file, animation, transport and uncaught-error checks intact. All four browser suites, the 248 CPU tests and independent codec interoperability remain required before deployment. Inspect the PR's exact-head CI artifacts for results. This is software-adapter presentation validation, not physical-GPU compatibility or performance certification.

```sh
python3 tests/run-webgpu.py --suite editor --software
# Explicit executable overrides remain supported for additional browser testing:
python3 tests/run-webgpu.py --suite editor --browser /path/to/chrome --software
```
