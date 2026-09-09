# Aureon Studio + Aureon Ray — v0.2 development build

A modular 3D editor and compute-shader renderer written in plain HTML, JavaScript and WGSL. Geometry, deformation, material graphs, codecs and the render coordinator are reusable modules. No runtime npm packages or commercial SDKs are bundled.

**This is an integrated development build, not a complete production DCC or renderer replacement.** The new WebGPU shaders and pipelines have not been compiled or executed in this build environment: managed Chromium blocks navigation, including localhost. CPU algorithms, actual offline editor workflows, the HTTP coordinator and independent image decoders were exercised. Do not interpret the historical v0.1 GPU screenshots/tests as validation of v0.2. See [Testing](docs/TESTING.md).

## Published application

[Launch Aureon Studio](https://wieslawsoltes.github.io/AureonStudio/) · [Source repository](https://github.com/wieslawsoltes/AureonStudio)

Pushes to `main` run the CPU and packaging tests, stage the browser assets, and deploy GitHub Pages. The hosted app needs WebGPU; the optional distributed coordinator must run separately. See [Deployment](docs/DEPLOYMENT.md).

## Start

```sh
npm start
```

Open `http://localhost:4173`. The launcher needs Node.js 20 or later; `npm install` is unnecessary. `start.bat` and `start.sh` are equivalent launchers. Serve files rather than opening `index.html` as a `file:` URL. Rendering needs a browser exposing WebGPU and an available adapter in a secure context. HTTPS is needed for a remotely hosted site; localhost is the intended local development origin. Unsupported browsers show an explicit GPU-unavailable message rather than a substitute renderer.

The application is a static site. The optional render coordinator is a separate Node.js process, not a requirement for local editing or rendering.

## New in this build

| Area | Implemented path | Important boundary |
|---|---|---|
| Solid modeling | BSP union, difference, intersection; chamfer modifier; material-tagged cuts | Closed outward manifold inputs; floating-point tolerances; single-segment convex bevel |
| UVs | Corner-sector seams, automatic dual-tree cuts, LSCM, pinning, relaxation, packing, island transforms, stitching | One UV set; no UDIM, brush painting or injectivity guarantee |
| Rigging | Chain bind, normalized four-weight influences, linear/dual-quaternion skinning, bone keys, FABRIK and pole targeting | No full constraint/controller ecosystem; dual-quaternion mode requires rigid transforms |
| Simulation | XPBD cloth constraints, floor/sphere contacts, rigid sphere proxies, fractional sampling and deformation caches | Editor-attached rigid bodies have individual local worlds; no scene-wide mesh collision, fluids or self-colliding cloth |
| Hair and particles | Seeded surface strands, tube tessellation, optional root-pinned dynamics, ballistic particle meshes | CPU generation; no dedicated fiber BSDF, grooming brushes or GPU particle solver |
| Shading | Bitmap array with linear-light mipmaps, 16-node-type graph compiler/interpreter and visual graph editor | Explicit texture LOD, one UV set, no normal-map workflow or shader-source compiler |
| Media | Homogeneous world box volume and homogeneous closed-solid subsurface random walks | One active interior medium; no heterogeneous fields, VDB or nested-medium stack |
| Photon transport | Surface photon emission, linked-cell storage, density estimation and final gathering | Biased surface-only estimator; not combined with volumes/SSS |
| Temporal rendering | Shutter-time camera, transform, skin, cache and procedural evaluation | Per-sample CPU geometry/BVH updates; no temporal ray/BLAS acceleration |
| Denoising/AOVs | Edge-aware a-trous pass; albedo, normal, depth, ID, emission, direct, indirect | Not an AI or temporal denoiser; no Cryptomatte |
| Output | 21-channel FLOAT/UINT scanline EXR; existing PNG/PFM | Uncompressed single-part EXR; no deep/tiled/multipart output |
| Distributed | Authenticated coordinator, leases, retries, heartbeat, deterministic tiles, compensated batch merge, EXR result | In-memory jobs; actual multi-GPU end-to-end execution unverified |
| Interchange | GLB/glTF with hierarchy, skins, morphs and animation; PLY; USDA mesh snapshots | Not general USD/FBX/Alembic/CAD or proprietary scene compatibility |

The previous polygon tools, modifiers, scene explorer, transform handles, animation timeline/curve editor, raster viewport, progressive surface path tracer, undo/redo, recovery, OBJ/STL I/O and standalone renderer remain present. [Feature status](docs/FEATURES.md) separates implementation from qualification.

## Workspaces

The menus expose the new tools: **Model** for booleans/bevel, **Edit UV coordinates** for seams and unwrap, **Animation** for rigs/physics/cache baking, and **Render** for textures, node graphs, media, output and distributed jobs. Commands operate on the same canonical document used by both render paths. An edited dialog applies through transaction history; invalid input reports an error.

For a fixed-size image, choose **Render → Render frame / motion blur…**. Set shutter endpoints to zero for a static render. Output is kept on screen until editing resumes. EXR export can select raw or denoised beauty; the AOVs remain raw.

## Examples

Eleven editable `.aureon` scenes are in `examples/`. New scenes cover solid/UV modeling, deformation, bitmap/node shading, media, photon caustics and shutter integration. These are scene inputs, not evidence of completed GPU rendering. Open them with the native scene command. `npm run examples` regenerates them with validation.

`examples/standalone-renderer.html` embeds the renderer without editor UI. Library usage is documented in [Embedding](docs/EMBEDDING.md).

## Optional render coordinator

```sh
npm run render:server
```

It listens on `127.0.0.1:4183` and prints a random access token. Enter its address/token in **Render → Distributed rendering…**, submit a scene and open a worker at `http://127.0.0.1:4183/worker.html`. Enter the token in each worker and start it. The browser performs the GPU rendering; the server only schedules, validates, merges and encodes results.

Use a trusted HTTPS reverse proxy, a deliberate origin allowlist and a strong token before enabling remote workers. Nothing provisions cloud infrastructure or runs arbitrary shell commands. See [Production workflows](docs/PRODUCTION.md).

## Verification commands

```sh
npm test                       # CPU + real HTTP coordinator tests
npm run test:offline-ui         # Actual editor DOM; explicitly no WebGPU
npm run test:codecs             # Independent OpenCV/Pillow consumers
npm start                      # In one terminal, before GPU tests
npm run test:production-gpu     # In another terminal, on a usable GPU browser
```

Python UI tests require Playwright and Chromium. Independent codec tests require Pillow and an OpenEXR-enabled OpenCV build; these are optional development dependencies, not application dependencies. Browser paths are configurable in the GPU runner.

Current recorded results: **159 CPU/HTTP tests passed; 19 offline editor checks passed; two independent codec checks passed; 11 scenes validated and compiled to finite CPU triangle buffers. GPU regression status: blocked, zero checks executed.** Hardware speed and rendering correctness of the revised shaders are unmeasured.

## Documentation and license

[Architecture](docs/ARCHITECTURE.md) · [Feature status](docs/FEATURES.md) · [Native/GPU formats](docs/FORMAT.md) · [Workflows](docs/PRODUCTION.md) · [Testing](docs/TESTING.md) · [Changelog](CHANGELOG.md)

MIT license. This is an independent implementation of standard geometry, animation and rendering techniques. It does not load `.max` or `.mi` scenes, execute another renderer's shaders/binaries, or claim compatible visual output. The repository includes automatic GitHub Pages publication; deployment does not change the development-build qualification above.
