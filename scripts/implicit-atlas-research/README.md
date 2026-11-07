# Implicit atlas research tool

This is the reproducible local experiment for [#368](https://github.com/iwvelando/tangent-garden/issues/368), kept as evidence for the implicit level / shape pair that the public 3D atlas now offers ([#369](https://github.com/iwvelando/tangent-garden/issues/369)). It is a separate page, excluded from the public build. The issue holds the research decision; measurement logs belong outside version control.

From the repository root:

```sh
npm run build
node scripts/implicit-atlas-research/build.mjs
npm run preview:lan -- --outDir .codex/implicit-atlas-dist --port 4180 --strictPort
```

Open `/scripts/implicit-atlas-research/index.html` on the printed HTTPS network address. The separate production build also contains the ordinary notebook at `/`. The research build type-checks its own source; the normal build remains unchanged.

```sh
RESEARCH_URL=https://localhost:4180 WEBKIT=1 npx playwright test --config scripts/implicit-atlas-research/playwright.config.ts
node scripts/implicit-atlas-research/measure.mjs chromium /tmp/implicit-atlas-chromium.json
node scripts/implicit-atlas-research/measure.mjs webkit /tmp/implicit-atlas-webkit.json
```

`RESEARCH_URL` also selects the measurement server (default `https://localhost:4180`). Measurement outputs include browser/version, source revision and a prototype digest. They contain two runs of each case/size and separate numerical, all-drawings, inspection, storage and cancel observations. Every Generate creates a fresh meshing worker, so its first request includes startup; later requests reuse it. The scalar parser has a separate worker. Measurements use headless browsers, not achieved device frame rates. Actual phones need their own exploration and measurements.

`model.ts` fixes the experimental sample set before execution: spheres including empty levels, Cassini drops including the pinch, a gyroid, undefined half-spaces, poles, a refined gyroid and invalid section normals. Columns vary level c; rows vary shape a. The formulas, boxes, axis endpoints, original quality and section counts are in `cases`. These are research fixtures, not gallery presets.

The candidate caps are 24 longest-side cells for 3 × 3 and 16 for 5 × 5, with preview refinement off. Sections retain their source settings. Full inspection keeps all source quality. Admission reserves at most 400,000 base grid cells and 2,000,000 section cells across N previews and one original-quality inspection. An anisotropic base grid follows the engine's rounded proportional dimensions. A section reserves the square of `min(256, 4*cells)`, because sections sample more finely than the mesh. These counts do not bound all field evaluations; ordinary parser, refinement, crossing, triangle and worker-deadline limits still apply.

The production `AtlasQueue` owns numeric entries, stale results and priority inspection; `AtlasPainter` owns renderer, image sizing and object URL disposal. At most 4,000,000 delivered numeric entries are admitted, including typed arrays by length. The page exposes full request/geometry snapshots under `window.research` solely for independent checks. Main-page typed-array bytes exclude ordinary objects, temporary copies, worker/WASM heaps and GPU allocations. Chromium's forced-GC heap observations are separately labeled; logical release is not proof of an immediate process-memory reduction.

The selected study opens through the ordinary link writer and notebook, where its existing controls, motion, sharing and exports apply. The original notebook remains untouched. It deliberately did not prototype in-place adoption, which the public atlas provides: see `docs/architecture.md`, **Reversible parameter atlas**. No new study-link fields or public defaults are introduced.

Regression checks compare real worker replies with direct replies, evaluate independent sphere/drop equations on returned vertices, exercise disconnected/singular/empty cases, demonstrate a missed hole resolved by refinement, check full-quality links/SVG output, and cover range parsing, keyboard/phone reachability, cancellation and retained resources. The existing engine mathematics remains authoritative; neither previews nor full meshes certify topology.
