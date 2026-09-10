# Aureon Studio + Aureon Ray — v0.3.0

A browser 3D editor and native WebGPU compute renderer built with plain HTML, JavaScript and WGSL. The application includes editable polygon geometry, animation, materials, simulation, production rendering and reusable engine modules. No runtime npm packages or commercial SDKs are required.

[Launch Aureon Studio](https://wieslawsoltes.github.io/AureonStudio/) · [Feature status](docs/FEATURES.md) · [Validation](docs/TESTING.md) · [Workflows](docs/PRODUCTION.md)

**This is a tested development release, not complete production-DCC or commercial-renderer parity.** The expanded browser suites execute real WGSL and actual editor controls using Chromium/SwiftShader. That verifies the recorded regression cases, not physical-GPU performance or arbitrary-scene correctness. Unsupported interchange formats and algorithm limits remain explicit.

## Run

```sh
npm start
```

Open `http://localhost:4173`. Node.js 20 or later is required for the launcher; no `npm install` is needed. `start.bat` and `start.sh` are equivalent launchers. Use a local server rather than `file:` URLs. Rendering needs a secure WebGPU-capable browser context and an available adapter. Shader, resource and device failures are reported separately from unavailable hardware; there is no substitute renderer.

## Integrated in v0.3

| System | Integrated capability |
|---|---|
| Modeling | Exact-rational BSP Boolean operations; segmented edge profiles, selected-edge weights, reflex-edge bevel cases and topology validation |
| Animation | Curve/oscillator/expression/driver controllers; world-space constraints; bind-space skeletal retargeting and key baking |
| Dynamics | Shared scene rigid bodies, convex/sphere contacts, mesh colliders, cloth self-contact, CPU position-based fluids and evaluated surface meshes |
| Authoring | UDIM packing, layered painting with undo/redo, root-bound grooming brushes and cylindrical fiber shading |
| Transport | Graph-specialized WGSL, cross-tile filtered textures, sparse/dense density regions, nested interiors, volume photons and progressive density estimation |
| Output | ZIP/ZIPS, HALF/FLOAT/UINT and multipart scanline EXR; raw AOVs; separate denoising; real shutter-time rendering |
| Coordination | Durable write-ahead log, checkpoints, acknowledged-tile recovery and stale-lease rejection after restart |

The earlier editor, primitives, modifiers, UV tools, skinning/IK, material graph UI, hierarchy, timeline, file recovery and OBJ/STL/glTF/PLY/USDA-snapshot tools remain integrated. See the [feature matrix](docs/FEATURES.md) before assuming a format or workflow is supported.

## Validation and publication

```sh
npm test
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install --with-deps chromium
npm run test:gpu:software
npm run build:pages
```

The browser command runs the same four suites used by CI: transport/startup, advanced shading, editor regression and production authoring. For physical-GPU testing use `npm run test:gpu`; no hardware speed claim is inferred from software-adapter results. Independent compressed/multipart EXR checks are documented in [TESTING.md](docs/TESTING.md).

The Pages workflow requires the CPU/build job **and the complete WebGPU/editor/codec matrix** before deploying `main`. It then checks the deployed commit/version and SHA-256 of every public browser asset. PR runs validate but do not deploy. One-off self-modifying recovery and automatic-merge workflows have been removed; validation no longer extracts commands from shell source.

## Distributed rendering

```sh
npm run render:server
```

The optional Node coordinator prints its local URL and access token. Its default state directory is `.aureon-render-state/`; use `RENDER_STATE_DIR` to select durable storage or `RENDER_EPHEMERAL=1` for disposable jobs. It is separate from the static Pages application. Protect remote service access with HTTPS, a strong token and an explicit origin allowlist. Never commit coordinator tokens or job state.

## Libraries and documentation

`src/index.js` exposes the original public modules without starting the editor. Additional modules can be imported directly: `geometry/exact.js`, `geometry/udim.js`, `animation/controllers.js`, `simulation/rigid.js`, `simulation/scene-world.js`, `simulation/fluids.js`, `simulation/groom.js`, `materials/udim.js`, `materials/fiber.js`, `materials/wgsl-graph.js`, `volumes/grid.js`, and `io/exr-advanced.js`. The durable queue is Node-only and is intentionally absent from the browser entry point.

[Architecture](docs/ARCHITECTURE.md) · [Formats and ABI](docs/FORMAT.md) · [Embedding](docs/EMBEDDING.md) · [Deployment](docs/DEPLOYMENT.md) · [Changelog](CHANGELOG.md)

MIT licensed. The optional pinned USD codec build is an isolated experiment, not a shipped browser importer. Full USD, FBX, Alembic, OpenVDB `.vdb`, `.max` and `.mi` compatibility are not implemented.
