# Development, building and hosting

The local toolchain, the test environment, and how the static site is built, deployed and hosted. For the steps a particular change needs, see [contributing](contributing.md); for the rules every change follows, [AGENTS.md](../AGENTS.md).

## Toolchain

Tangent Garden needs **Go 1.26+**, **Node 22.12+**, npm, and Make. Use the Node version in [`.nvmrc`](../.nvmrc) for local development; with nvm, run `nvm install` and `nvm use` first. CI uses the latest stable Go and that Node version, on Linux and macOS. On Windows, use WSL or another environment providing Make and a POSIX shell.

The app needs a modern browser with WebAssembly. WebP export also needs canvas WebP encoding.

## Running the app

```sh
make install
make dev
```

Open the localhost URL Vite prints. Go changes need `make wasm` and a browser refresh; frontend changes reload on their own. Native Go tests need no npm dependencies.

To try the app on a phone or tablet, run `make dev-lan` and open the Network URL it prints from a device on the same network. It serves to anything that can reach your machine, so use it only on a network you trust. It serves HTTPS with a self-signed certificate, so the device warns once before opening the page. A plain-HTTP address other than localhost is not a secure context: there Safari runs the app several times slower, and browsers withhold the video encoder that MP4 export needs.

## Checks and tests

```sh
make format       # gofmt and Prettier
make check        # formatting, vet, race and coverage tests, WASM, types, production build
npx playwright install chromium
make test-browser # builds and tests the production app in Chromium
npx playwright install webkit
make test-webkit  # Safari and iOS engine checks
make pre-pr       # check, thumbnails, and the full Chromium and (on macOS) WebKit suites
```

- On Linux, Playwright may also need system libraries: `npx playwright install --with-deps chromium`. CI installs them.
- MP4 export tests also decode files with `ffprobe` from [FFmpeg](https://ffmpeg.org/) when it is installed. CI installs it; local runs without it skip only those checks. CI's ffmpeg cannot decode animated WebP, so WebP export tests decode with Chromium instead ([Running the tests](contributing.md#running-the-tests)).
- `make test-webkit` runs the WebKit-specific checks (`tests/webkit.spec.ts` and `tests/mobile-inputs.spec.ts`). CI runs them on a macOS runner: Safari and every iOS browser use WebKit, which has its own video encoder and no canvas WebP.
- `make test-go` runs every native test twice, once with race detection and once with coverage. Keeping the instrumentation separate avoids race-checking atomic coverage counters in the numerical loops, which is much slower. CI runs the race pass in shards ([CI shards](contributing.md#ci-shards)).
- Further targets: `make test-wasm`, `make test-scripts`, `make typecheck`, and `make clean`, which removes generated build artifacts only.
- `make bench` times the largest implicit surfaces and curve meshes through the WASM engine. `make preset-hashes` hashes and times every preset in all three notebooks. Each takes `ARGS="--compare <site or directory>"` to set another engine beside the local one, and `make preset-hashes` then lists any preset whose result differs. Its `--refine on` or `off` forces refinement between samples on every 2D and 3D preset. See [architecture](architecture.md), **Measuring**, and [contributing](contributing.md#transport-and-performance).

Outside CI, the browser tests reuse any server already listening on port 4173, even one serving another checkout's build. When several worktrees test at once, serve your own build on a free port (`npm run build`, then `npm run preview -- --port <port> --strictPort`) and point the tests at it with `BASE_URL=http://127.0.0.1:<port>`. [Running the tests](contributing.md#running-the-tests) covers targeted runs and timing failures.

Commit source, tests, docs, `package-lock.json` and the gallery thumbnails under `web/examples/`. Dependency directories, build output, browser reports, and generated WASM and runtime files are ignored.

## Building

```sh
make build        # creates dist/
make preview      # serves that build locally, with the production security policy
make preview-lan  # serves that build to devices on your network, as dev-lan does
make thumbnails   # redraws the example gallery's thumbnails into web/examples/
make share-card   # re-renders the link-preview card and home-screen icon into public/
```

The build pairs the Go WASM runtime with the installed compiler, then checks the distribution for its required assets and license notices. Production builds include `LICENSE.txt`, `GO-LICENSE.txt`, and `THIRD-PARTY-NOTICES.txt`, with full notices generated from the installed dependencies.

A shared link unfurls into a card showing `public/og-image.png`, through the Open Graph and Twitter tags in `index.html`. `make share-card` renders that card and `public/apple-touch-icon.png` from the built site, and both are committed. Re-render them, check them by eye, and commit them when the site's look changes.

## Hosting

Serve **the contents of `dist/`** over HTTP(S), preserving its structure. Use the whole directory, including `engine.wasm`, `wasm_exec.js`, the logo, and the license and notice files. No server-side computation is needed. Relative asset URLs allow hosting beneath a path prefix, but `404.html` links to `/`, so it assumes the site is at the root of its host. Do not open the site from `file://`.

Serve these headers wherever you host it:

- **Content-Security-Policy:** the value in [`deploy/content-security-policy.txt`](../deploy/content-security-policy.txt). `make preview` sends it too, so the browser tests run under it. A page, worker or export that needs a new kind of resource needs a change here.
- **Content type:** serve `engine.wasm` as `application/wasm`.
- **Compression:** serve `/engine.wasm` from `engine.wasm.br` (with `Content-Encoding: br`) when the request's `Accept-Encoding` allows Brotli, else from `engine.wasm.gz` (`gzip`), else the plain file, with `Vary: Accept-Encoding`. The build writes both copies (`scripts/compress-wasm.mjs`) and checks that they decode to the engine. `make preview` serves them this way (`scripts/precompressed-preview.mjs`), and so does the production hosting's viewer-request function in `iwvelando/cloud-accounts` (`modules/static-site`, the site's `precompressed_paths`). Keep the two in step. CloudFront compresses nothing over 10,000,000 bytes on its own, and the engine is larger.

  As of #604 the engine is 10.7 MB, its Brotli copy (quality 11) 2.1 MB and its gzip copy (level 9) 2.9 MB. CloudFront's own Brotli is near quality 5: for the 9.6 MB engine before #601 it sent about 2.3–2.5 MB, and about 2.7 MB as gzip. No host limit applies to the copies, so further growth costs only download size and build time: Brotli takes about 11 s when the engine changes and is skipped when it has not. Everything else CloudFront still compresses itself; the largest script is about 1.2 MB, far from the limit. A new file above 10,000,000 bytes would need its own copies and a `precompressed_paths` entry.

The Open Graph tags and each notebook's canonical link name the production URL, since link scrapers need absolute URLs; change them if you host it elsewhere. `public/sitemap.xml` lists one address per notebook (`/`, `/?study=3d`, `/?study=4d`), `public/robots.txt` names it, and each notebook sets its canonical link to its own address. A new notebook needs an entry in each.

## Deployment

The live site is **https://tangent-garden.isaacvelando.com**. Every push to `main` that passes verification deploys the tested `dist/` there, through the `production` environment (`.github/workflows/ci.yml`). Deploy only by merging to `main`. The deploy checks the live security policy against `deploy/content-security-policy.txt`, and that the engine's compressed copies are served with their encodings. Browser smoke tests (`tests/smoke.spec.ts`, `tests/share.spec.ts` and `tests/sitemap.spec.ts`) then check the live site; run them yourself with `BASE_URL=https://tangent-garden.isaacvelando.com npx playwright test --grep @smoke`. A failed run on `main` opens a "Production deploy failed" issue.
