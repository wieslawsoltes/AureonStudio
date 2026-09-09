# GitHub Pages deployment

Repository: <https://github.com/wieslawsoltes/AureonStudio>

Application: <https://wieslawsoltes.github.io/AureonStudio/>

## Automatic publication

Every push to `main` starts `.github/workflows/pages.yml`. The build job runs `npm test` with Node.js 22, then `npm run build:pages`. Only a successful build is deployed to the `github-pages` environment. Manual runs are supported through the Actions tab.

The Pages artifact contains the editor, renderer, WGSL source, library modules, editable example scenes and standalone renderer example. It does not contain Git metadata, Node.js server scripts, test files or test outputs. `deployment.json` records the source revision and application version. `_site/` is disposable generated output and is ignored by Git.

The builder does not rewrite the application or bundle another renderer. Relative HTML and module URLs, `import.meta.url` shader loading, and the module worker retain the `/AureonStudio/` project path.

## Hosting boundaries

GitHub Pages serves the browser application only. It does not execute `scripts/render-server.mjs`. Local modeling and WebGPU rendering do not need that server. For distributed rendering, run `npm run render:server` on your own machine or server and open its worker page there. Remote coordinators need HTTPS, a deliberate CORS origin allowlist and a strong token. Do not put coordinator tokens in repository files, source code or URLs.

HTTPS supplies the secure context required by WebGPU; a compatible browser, enabled graphics acceleration and an available adapter are still required. Unsupported environments display the application's existing explicit GPU-unavailable state. Publication and CPU test success are not evidence of hardware speed or validation of the revised v0.2 GPU pipelines.

## Local publication checks

```sh
npm test
npm run build:pages
```

The packaging tests check source identity, subpath-safe module/worker URLs, inclusion of all five WGSL files, exclusion of development/server files, stale-output removal and output-directory safeguards. The original development archives retain the generated screenshots; the repository keeps source, examples, textual reports and the small independent codec fixtures.
