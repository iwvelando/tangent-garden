# Instructions for contributors and coding agents

## Intent

Tangent Garden is a mathematical art explorer. The curve, derived curve, and representative construction lines are the product. Do not turn it into a scene editor or physical graphics renderer without explicit direction. Start with 2D; preserve clear boundaries for future 3D work.

Read `README.md`, `docs/mathematics.md`, and `docs/reference-review.md` before changing numerical behavior. The Maple exports are historical inspiration, **not a correctness oracle**. They are not part of this repository; do not introduce a dependency on them.

## Discovery and tools

If codebase-memory-mcp is available, prefer `search_graph`, `trace_path`, `get_code_snippet`, `query_graph`, and `get_architecture` for code discovery. Fall back to `rg` and direct reads when graph tools are unavailable or insufficient; use `rg` for configuration and literal searches. Graph tools and local command wrappers are optional; project scripts must run without them or machine-specific paths.

## Boundaries

- Mathematical evaluation and numerical algorithms belong in Go, with no UI dependency.
- The parser must remain bounded and must never evaluate user input as executable code.
- `cmd/wasm` is transport only. Keep Go and TypeScript request/result fields synchronized.
- React manages controls; SVG manages the planar drawing. Preserve equal axis scale.
- Keep computations in the browser worker. Do not introduce a server or remote data collection.
- Treat nonfinite values, singularities, virtual rays, and total internal reflection explicitly. Never silently join known discontinuities.
- Document sign conventions and refractive index ratios. Do not infer scene topology.
- A future 3D extension needs separate mathematical definitions and types, not dummy coordinates.
- Keep scalar parsing in Go. Bounds and animation endpoints must reject `t`, `x`, and `a`; curve expressions can bind `a` numerically.
- Preserve immutable base studies and manual camera state during animation. Stop/pause/edit must invalidate in-flight results. Never queue an unbounded animation backlog or blend output geometry across singularities.
- Hold-current camera snapshots must preserve effective pan/zoom in playback and exports. Point-source coordinates are independent of curve format; interpolate polar radius/theta before Go resolves the Cartesian point. Polar theta uses radians, while parallel-light direction uses degrees.
- Animation export must reuse the numerical sampler and plot renderer, preserve file duration independently of render speed, bound memory/work, and discard canceled output. Verify actual exported files with an independent decoder, including timing and endpoints.
- Fit base and derived point families independently before combining their bounds; an offset derived curve must not be discarded just because the base arc is short. Retain explicit robust treatment of asymptotic outliers. Export quality must render at its target resolution, not upscale a previously rasterized frame.
- Theme defaults to the live system preference. Explicit choices persist locally; storage denial must not break the app.

## Verification

Run `gofmt` on changed Go files. Use analytic identities and geometric invariants for numerical changes, and convergence checks when altering approximation methods. A matching screenshot alone is insufficient. Extend relevant tests for regressions, especially singularities and invalid inputs.

`make check` runs formatting checks, Go vet, native tests with race/coverage, a real WASM bridge test, TypeScript checks, and production build. `make test-browser` runs the production integration checks after a Chromium installation (`npx playwright install chromium`). Inspect the drawing in both themes and on a narrow screen when changing layout. Report actual checks and remaining limits; do not imply unrun checks passed.

For animation changes, exercise endpoint accuracy, cancellation, pause/resume, scrubbing, and all camera modes. Test custom sample/line counts, scalar bounds, and system/manual theme persistence when changing controls. Desktop sidebar scrolling must not move the drawing.

Preserve user work. Keep generated files, caches, dependency directories, and build output out of version control. Commit the npm lockfile. Update generated distribution notices when adding runtime dependencies; verify all three license files are included in dist/. Do not initialize Git or publish unless requested. Merging to `main` deploys to production (`.github/workflows/ci.yml`); never deploy any other way. Keep `tests/smoke.spec.ts` fast and read-only, because it runs against the live site after every deploy. Any page, worker, or export that needs a new kind of resource needs a matching change to `deploy/content-security-policy.txt`, and the same change in `iwvelando/cloud-accounts` (`sites/tangent-garden.isaacvelando.com`) before this repo's change merges. Use the project's MIT license and retain dependency notices. Leave no machine-specific paths in source or docs.
