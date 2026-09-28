# Tangent Garden

<img src="public/tangent-garden.svg" alt="A sprout formed by curves and construction lines" width="96" height="96" />

Grow a little mathematical wonder.

An interactive mathematical art notebook for **evolutes, involutes, catacaustics, diacaustics, pedals, contrapedals, orthotomics, offsets, rolling circles, rolling curves, line, chord, and circle envelopes, and circle inversions**. Enter a planar curve and explore both the derived curve and the lines that construct it. Inspired by hobby Maple worksheets from around 2006, independently reworked and validated with numerical geometry.

Go computes the geometry in a browser Web Worker through WebAssembly. React and TypeScript provide the controls; SVG draws the curves. The result is a static website with no application server, account, telemetry, or remote computation.

## Features

- Parametric, Cartesian, and polar curve definitions, with a bounded expression parser and constants such as `pi`, `e`, and `phi`.
- Roulettes traced by a circle rolling inside or outside a fixed circle or along a line, with the rolling circle drawn, exact closure for rational radius ratios, and radius, tracing-distance, and phase animation.
- A circle rolling without slipping along any regular curve, on either side, rolling back out of cusps, with its contact normals, rolling circle, and radius, tracing-distance, and phase animation.
- A second curve rolling without slipping along the curve, with arc-length contact matching, wrapping for closed rolling curves, explicit stops at open ends and its own cusps, rolling back out of the base's cusps, and tracing-point and start animation.
- Envelopes of line families, each line through the curve at a direction angle θ(t) or a chord to a second moving point, with coincident endpoints left as gaps, chord extensions dashed, and multiplier animation through `a`; and envelopes of moving circles of radius R(t), with both real branches, their mergers, and gaps where the circles nest.
- Inversion in a circle, with the circle, correspondence segments, images left open where they run off to infinity, and center and radius animation.
- Every construction built on the curve or on its evolute, pedal, contrapedal, orthotomic, or offset, evaluated from the curve's definition rather than a polyline: a pedal of a pedal, a circle rolling on an evolute, the involute of an evolute, an inverted pedal. Combinations that would need a fourth derivative are refused, and constructions that follow the direction of travel are left open at cusps.
- Lissajous figures and Fourier curves of up to 16 rotating vectors, drawn with their guide circles or chained epicycles, with closure reported exactly for whole-number frequency ratios and never forced otherwise, and animation of every amplitude, frequency, radius, and phase.
- Cyclic pursuit of 2–16 pursuers at their own speeds, integrated with adaptive error control, drawn with every path and the connecting polygons, and stopped explicitly at the first capture.
- Vector-field trajectories from 1–16 seeds, integrated with adaptive error control and explicit escape, singularity, and step-budget ends, with the direction field of an autonomous field.
- Implicit curves F(x, y) = c and families of levels, traced on a bounded grid with exact crossings, deliberately decided saddle cells, poles and jumps told apart from zero crossings, and adaptive refinement, drawn with F's gradient.
- Iterated maps (Clifford, Peter de Jong, Hénon) drawn as the logarithmic visit density of their orbits on a bounded grid, never joined into curves, with escapes counted.
- Forty-three example studies; point and parallel light sources; polar source coordinates; configurable refraction.
- Independent poles for pedal, contrapedal, and orthotomic constructions, with tangent/normal projections, reflected segments, and pole-coordinate animation.
- Signed normal offsets (parallel curves) that keep their cusps and swallowtails, with distance animation, evenly spaced offset stacks, and optional generating circles whose envelope is the offsets ±R.
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
make share-card   # re-renders the link-preview card and home-screen icon into public/
make thumbnails   # re-draws the example gallery's thumbnails into web/examples/
```

Serve **the contents of `dist/`** over HTTP(S), preserving its structure. Use the whole directory, including `engine.wasm`, `wasm_exec.js`, the logo, and the license/notice files. No server-side computation is needed. Relative asset URLs support hosting beneath a path prefix. Do not open the site using `file://`.

The build pairs the Go WASM runtime with the installed compiler and checks the resulting distribution for its required assets and notices. Static-host compression is useful for the several-megabyte WASM module.

The live site is **https://tangent-garden.isaacvelando.com**. Every push to `main` that passes verification deploys the tested `dist/` there, through the `production` environment. Browser smoke tests (`tests/smoke.spec.ts` and `tests/share.spec.ts`) then check the live site. Run them yourself with `BASE_URL=https://tangent-garden.isaacvelando.com npx playwright test --grep @smoke`. A failed run on `main` opens a "Production deploy failed" issue. Serve these headers wherever you host it:

- **Content-Security-Policy:** the value in [`deploy/content-security-policy.txt`](deploy/content-security-policy.txt). `make preview` sends it too, so the browser tests run under it.
- **Content type:** serve `engine.wasm` as `application/wasm`.

`404.html` links to `/`, so it assumes the site is at the root of its host.

A shared link unfurls into a card (Open Graph and Twitter tags in `index.html`) showing `public/og-image.png`. Those tags and the canonical link name the production URL, since link scrapers need absolute URLs; change them if you host it elsewhere. The card and `public/apple-touch-icon.png` are rendered from the built site by `make share-card` and committed; re-render them, check them by eye, and commit when the site's look changes.

## Spatial curves and constructions

Choose **3D curves** beside **2D curves** in the notebook header. Both studies stay on the same page, retaining their controls and manual camera when you switch. `?study=3d` opens directly to the spatial notebook.

Explore tangent developables, folded sheets swept out by a space curve's straight tangent lines, and involutes, filaments traced by taut strings unwound from the curve from a chosen anchor, singly or as a family. Start with Trefoil, Cinquefoil, Woven orbit, a helix, a spatial Lissajous curve, a helix unwinding into stacked spirals, or a knot shedding filaments. Project an independent 3D pole onto the tangent lines to trace a tangent-foot curve, or rotate it half a turn around each tangent to trace a tangent-line orthotomic. Two more examples show these constructions on a trefoil and a helix. Invert the curve, or one of those tangent projections, in a sphere: space turns inside out around the sphere's center, and a curve passing through the center opens out through infinity. Three examples draw a helix into its sphere, turn a trefoil inside out, and invert a knot's tangent feet. Use the torus generator or enter your own `x(t)`, `y(t)`, and `z(t)` expressions, domain, and shape parameter `a`. Scalar controls accept constants such as `pi`, `e`, and `phi`. Go evaluates curves in the browser worker; a separate WebGL renderer draws the geometry.

Drag to orbit, shift-drag to pan, and scroll to zoom. Keyboard equivalents are arrows, shift-arrows, +/−, and Home. Surface, tangent lines, boundary curves, filaments, strings, tangent projections, perpendicular constructions, the pole marker, and an inversion's image, correspondence segments, and sphere have independent visibility controls. Animate a progressive reveal, multiple parameters, or one camera orbit; pause, scrub, and choose the same four camera modes as in 2D. Save PNG images, SVG files containing the shaded PNG view, or MP4/animated WebP where the browser supports encoding. Exports render at their target resolution and retain the chosen theme, layers, and camera. See [the spatial study](docs/spatial-study.md) for examples, mathematics, and numerical limits.

## Mathematical scope

This is a **mathematical construction explorer**, not a scene renderer: every regular sampled point participates, without occlusion or multiple bounces. The planar engine remains 2D. The experimental spatial study uses separate 3D definitions and types; its renderer uses depth testing to reveal the ribbon folds.

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
