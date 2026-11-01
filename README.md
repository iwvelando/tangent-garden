# Tangent Garden

<img src="public/tangent-garden.svg" alt="A sprout formed by curves and construction lines" width="96" height="96" />

Grow a little mathematical wonder.

An interactive notebook of mathematical constructions: enter a curve, then explore the curves derived from it and the lines that construct them. It was inspired by hobby Maple worksheets from around 2006, then independently reworked and validated with numerical geometry. Try it at **https://tangent-garden.isaacvelando.com**.

Go computes the geometry in a browser Web Worker through WebAssembly. React and TypeScript provide the controls; SVG draws the 2D and 4D notebooks, and WebGL the 3D one. The result is a static website with no application server, account, telemetry or remote computation.

## The notebooks

- **2D.** Curves given parametrically, in Cartesian or polar form, or generated as roulettes, Lissajous and Fourier curves, cyclic pursuits, vector-field trajectories, implicit curves and iterated maps. Constructions include evolutes, involutes, catacaustics and diacaustics, pedals, contrapedals, orthotomics, offsets, rolling circles and curves, envelopes of lines, chords and circles, and circle inversion, built on the curve or on one another. Around them are a curvature probe, refinement between samples, a guided journey, a parameter atlas, Fourier fits of a drawn loop, finite engravings, a paired complex-map loom and an Apollonian circle garden. See the [usage guide](docs/usage.md).
- **3D** (`?study=3d`). Space curves and what they carry: tangent developables, involute filaments, framed ribbons, ruled and canal surfaces. It also draws surfaces with their focal sheets, a helicoid bending into a catenoid without stretching, mirrors and refracting interfaces with their caustics, and implicit surfaces with their sections, with probes, cut planes, see-through drawing, perspective lenses and camera flights. See [the spatial study](docs/spatial-study.md).
- **4D** (`?study=4d`). Shadows, sections and section families of four-dimensional shapes, and Hopf fibers and Clifford tori on the 3-sphere. See [the tesseract study](docs/tesseracts.md).

Every notebook animates its studies and saves still images and movies. It also saves a study, with its layers, view and animation, in a link that needs no server ([study links](docs/permalinks.md)). The engine reports exact sample and construction-line counts, refuses what it cannot compute, and leaves gaps at singularities rather than joining across them: it is a construction explorer, not a scene renderer.

## Quick start

Requires **Go 1.26+**, **Node 22.12+** (the version in [`.nvmrc`](.nvmrc)), npm and Make.

```sh
make install
make dev          # then open the localhost URL Vite prints
```

```sh
make check        # formatting, vet, Go tests, WASM, types, production build
make test-browser # the production app in Chromium (npx playwright install chromium)
make pre-pr       # everything a pull request needs, including thumbnails and WebKit on macOS
```

[Development, building and hosting](docs/development.md) covers trying the app on a phone, the test environment, the remaining targets, and how the site is built, hosted and deployed.

## Documentation

| Guide                                      | Covers                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [Usage](docs/usage.md)                     | Using the app: controls, examples, animation, export and links, with their limits                    |
| [The spatial study](docs/spatial-study.md) | The 3D notebook: its constructions, examples, camera and limits                                      |
| [The tesseract study](docs/tesseracts.md)  | The 4D notebook: its mathematics, controls and limits                                                |
| [Mathematics](docs/mathematics.md)         | Definitions, numerical conventions and how each construction is checked                              |
| [Architecture](docs/architecture.md)       | Structure, extension boundaries and interfaces between modules                                       |
| [Study links](docs/permalinks.md)          | The link format and how old links keep opening                                                       |
| [Development](docs/development.md)         | Toolchain, tests, building, hosting and deployment                                                   |
| [Contributing](docs/contributing.md)       | The steps particular changes need, and how project work is delivered                                 |
| [Reviewing](docs/reviewing.md)             | The review procedure, also offered as the `$tangent-garden-review` skill                             |
| [Projects](docs/projects/)                 | Briefs for larger projects                                                                           |
| [AGENTS.md](AGENTS.md)                     | Rules every contribution follows, for people and coding agents ([CLAUDE.md](CLAUDE.md) points to it) |

Proposals, fixes and tests should respect the project's mathematical-art focus.

## Project map

| Location               | Responsibility                                                  |
| ---------------------- | --------------------------------------------------------------- |
| `engine/`              | 2D numerical geometry in pure Go, with analytic tests           |
| `engine/expr/`         | Bounded expression parser                                       |
| `engine3/`, `engine4/` | 3D and 4D geometry, with their own definitions and types        |
| `cmd/wasm/`            | Go/JavaScript transport                                         |
| `web/`                 | Worker client, controls, animation, SVG rendering and exports   |
| `web/spatial/`         | The 3D notebook and its WebGL renderer                          |
| `web/tesseract/`       | The 4D notebook                                                 |
| `web/loom/`            | The complex-map loom                                            |
| `web/garden/`          | The Apollonian garden                                           |
| `web/examples/`        | The example gallery; its thumbnails come from `make thumbnails` |
| `tests/`               | Browser integration, rendering and export tests                 |
| `scripts/`             | Build, WASM, notice, thumbnail and measurement scripts          |
| `deploy/`              | The production content security policy                          |
| `public/`              | Logo, share card, sitemap and other static files                |
| `docs/`                | The guides above                                                |

## License

MIT licensed, copyright Tangent Garden contributors; see [LICENSE](LICENSE). Third-party components retain their own licenses, and production builds include their full notices.
