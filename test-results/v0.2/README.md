# v0.2 recorded verification artifacts

- `cpu-tests.tap`: 159 passing CPU/HTTP tests.
- `offline-ui.json`: 19 checks against actual offline editor DOM; no GPU available.
- `gpu-report.json`: managed Chromium navigation blocked; zero GPU checks ran.
- `independent-codecs.json`: independent EXR RGB/PNG RGBA decode checks.
- `independent.exr` and `independent.png`: tiny codec fixtures, not renderer output.
- `examples.json`: 11 native examples validated/compiled on the CPU.

Historical v0.1 textual reports are separate under `docs/archive/v0.1/`. Generated screenshots remain in the original development archives, rather than in this source repository. Current publication checks run separately in GitHub Actions; these files retain the original development results.
