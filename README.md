# Tangent Garden

<img src="public/tangent-garden.svg" alt="A sprout formed by curves and construction lines" width="96" height="96" />

Grow a little mathematical wonder.

An interactive mathematical art notebook for **evolutes, involutes, catacaustics, and diacaustics**. Enter a planar curve and explore both the derived curve and the lines that construct it. Inspired by hobby Maple worksheets from around 2006, independently reworked and validated with numerical geometry.

Go computes the geometry in a browser Web Worker through WebAssembly. React and TypeScript provide the controls; SVG draws the curves. The result is a static website with no application server, account, telemetry, or remote computation.

## Features

- Parametric, Cartesian, and polar curve definitions, with a bounded expression parser and constants such as `pi`, `e`, and `phi`.
- Eight example studies; point and parallel light sources; polar source coordinates; configurable refraction.
- Construction lines, virtual rays, singularity diagnostics, pan/zoom, and light/dark themes.
- Curve-reveal and multi-parameter animations with four camera modes.
- PNG and vector SVG image exports; animation exports as MP4 video (the default) or animated WebP, whichever the browser can encode, with resolution, quality, and up to 60 fps for MP4.
- Expert sampling controls and an engine designed for independent mathematical testing.

See the **[usage guide](docs/usage.md)** for controls, examples, animations, camera behavior, and export limits.

## Run locally

Requires **Go 1.26+**, **Node 22.12+**, npm, and Make. CI uses the latest stable Go and Node 22 on Linux. A modern browser with WebAssembly is required; WebP export additionally needs canvas WebP encoding. Browser integration tests currently target Chromium.

```sh
make install
make dev
```

Open the localhost URL printed by Vite. Go changes require `make wasm` and a browser refresh; frontend changes reload automatically. Native Go tests need no npm dependencies. On Windows, use WSL or another environment providing Make and a POSIX shell.

## Verify and contribute

```sh
make format       # gofmt and Prettier
make check        # formatting, vet, race/coverage tests, WASM, types, production build
npx playwright install chromium
make test-browser # builds and tests the production app
npx playwright install webkit
make test-webkit  # Safari/iOS engine checks (tests/webkit.spec.ts)
```

On Linux, Playwright may also need system libraries: `npx playwright install --with-deps chromium`. CI installs those dependencies. MP4 export tests also decode files with `ffprobe` from [FFmpeg](https://ffmpeg.org/) when it is installed; CI installs it, and local runs without it skip only those checks. `make test-webkit` runs the WebKit-specific export checks; CI runs them on a macOS runner, since Safari and every iOS browser use WebKit, with its own video encoder and no canvas WebP. Additional targets include `make test-go`, `make test-wasm`, `make typecheck`, and `make clean` (generated build artifacts only).

Commit source, tests, docs, and `package-lock.json`; dependency directories, build output, browser reports, and generated WASM/runtime files are ignored. Read [AGENTS.md](AGENTS.md) for contribution boundaries and verification expectations; [CLAUDE.md](CLAUDE.md) points to the same instructions. Proposals, fixes, and tests should respect the mathematical-art focus.

## Build and host

```sh
make build        # creates dist/
make preview      # serves that build locally
```

Serve **the contents of `dist/`** over HTTP(S), preserving its structure. Use the whole directory, including `engine.wasm`, `wasm_exec.js`, the logo, and the license/notice files. No server-side computation is needed. Relative asset URLs support hosting beneath a path prefix. Do not open the site using `file://`.

The build pairs the Go WASM runtime with the installed compiler and checks the resulting distribution for its required assets and notices. Static-host compression is useful for the several-megabyte WASM module.

The live site is **https://tangent-garden.isaacvelando.com**. Every push to `main` that passes verification deploys the tested `dist/` there, through the `production` environment. A browser smoke test (`tests/smoke.spec.ts`) then checks the live site. Run it yourself with `BASE_URL=https://tangent-garden.isaacvelando.com npx playwright test --grep @smoke`. A failed run on `main` opens a "Production deploy failed" issue. Serve these headers wherever you host it:

- **Content-Security-Policy:** the value in [`deploy/content-security-policy.txt`](deploy/content-security-policy.txt). `make preview` sends it too, so the browser tests run under it.
- **Content type:** serve `engine.wasm` as `application/wasm`.

`404.html` links to `/`, so it assumes the site is at the root of its host.

## Mathematical scope

This is a **mathematical construction explorer**, not a scene renderer: every regular sampled point participates, without occlusion or multiple bounces. The current engine is 2D. Future 3D work needs separate mathematical definitions and types.

The engine uses numerical differentiation, arc-length integration, and ray envelopes. Singular or ill-conditioned samples produce gaps. Uniform sampling can miss fine detail; more samples do not automatically improve derivative accuracy. Automatic framing filters isolated extreme points heuristically, so distant branches may need manual framing. Compare resolutions before relying on delicate features.

- [Mathematical definitions and numerical conventions](docs/mathematics.md)
- [Architecture and extension boundaries](docs/architecture.md)

## Project map

| Location | Responsibility |
| --- | --- |
| `engine/expr/` | Bounded arithmetic parser |
| `engine/` | Pure Go numerical geometry and analytic tests |
| `cmd/wasm/` | Go/JavaScript transport |
| `web/` | Worker client, controls, animation, SVG rendering, exports |
| `tests/` | Browser integration and rendering tests |
| `scripts/` | Reproducible WASM/build-notice generation and validation |
| `public/tangent-garden.svg` | Shared logo and favicon |
| `docs/` | Usage, mathematics, historical assessment, architecture |

## License

MIT licensed, copyright Tangent Garden contributors; see [LICENSE](LICENSE). Third-party components retain their own licenses. Production builds include `LICENSE.txt`, `GO-LICENSE.txt`, and `THIRD-PARTY-NOTICES.txt` with full notices generated from the installed dependencies.
