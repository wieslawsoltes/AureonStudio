# GitHub Pages deployment

[Application](https://wieslawsoltes.github.io/AureonStudio/) · [Repository](https://github.com/wieslawsoltes/AureonStudio)

## Gate and publication

Every push to `main` starts `pages.yml`. PR events run the same validation without publishing. The build job runs `npm test` and `npm run build:pages`; the reusable `webgpu.yml` runs transport, advanced shading, retained editor and production authoring in four isolated matrix jobs, plus independent OpenEXR interoperability. **Deployment requires both build and the complete GPU/codec workflow to succeed.** A failed matrix job does not become a skipped success.

The generated `_site/` contains HTML, CSS, browser modules, WGSL, example scenes and the standalone example. It excludes Git metadata, Node server scripts, tests, reports and coordinator state. `deployment.json` records the exact source commit and application version. Relative module/worker/shader URLs preserve the `/AureonStudio/` project subpath.

After deployment, the workflow checks each asset over HTTPS against the build's SHA-256 and checks the commit/version in `deployment.json`. The resulting `live-publication-verification` artifact is the publication evidence. A successful upload alone is not counted as a verified live application. Manual runs are available in Actions.

One-off source-transfer, shader-repair, diagnostic and automatic-finalization workflows have been removed after integration. There is no workflow that rewrites application source or merges a PR merely because a recovery upload succeeded. The optional `build-usd.yml` is manual-only, publishes an experimental codec artifact and does not deploy or integrate it.

## Local checks

```sh
npm test
npm run test:gpu:software
npm run build:pages
```

Install the test-only browser tooling as described in [TESTING.md](TESTING.md). Software WebGPU validation is correctness evidence for its fixtures, not a hardware performance benchmark. A secure context, compatible browser and adapter are still needed on the user's machine. Shader errors, missing resources, device failures and unavailable hardware have distinct diagnostics.

## Coordinator boundary

Pages hosts only the browser application. `npm run render:server` starts the optional local Node service separately. Durable job state defaults to `.aureon-render-state/`, which is ignored by Git; select another location with `RENDER_STATE_DIR`. Keep tokens and state out of commits and public directories. Remote access requires HTTPS termination, strong authentication and an explicit `RENDER_ORIGINS` allowlist. Pages does not provision compute or certificates. See [PRODUCTION.md](PRODUCTION.md).
