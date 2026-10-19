# Instructions for contributors and coding agents

## Intent

Tangent Garden is a mathematical art explorer. The curve, derived curve, and representative construction lines are the product. Do not turn it into a scene editor or physical graphics renderer without explicit direction. Start with 2D; preserve clear boundaries for future 3D work.

Read `README.md` and `docs/mathematics.md` before changing numerical behavior.

## Procedures for particular changes

Before making one of these changes, read its section of `docs/contributing.md`. Each section lists the files the change touches and the tests it needs:

- adding a preset;
- adding a numeric field or a validation error;
- adding or renaming a configuration, layer or animation field (study links);
- changing the WASM transport, a result's arrays, or anything whose speed matters;
- adding, splitting or removing a spec file (CI shards);
- running a mutation pass;
- changing focus, menus or form inputs, which Safari and iOS treat differently;
- adding side-by-side fields;
- running targeted tests, or wondering why a thumbnail is hidden.

## Language

Use American English spelling in user-facing text, documentation, comments, and new identifiers. Preserve external API names, proper names, and verbatim quotations.

## Discovery and tools

If codebase-memory-mcp is available, prefer `search_graph`, `trace_path`, `get_code_snippet`, `query_graph`, and `get_architecture` for code discovery. Fall back to `rg` and direct reads when graph tools are unavailable or insufficient; use `rg` for configuration and literal searches. Graph tools and local command wrappers are optional; project scripts must run without them or machine-specific paths.

## Boundaries

- Mathematical evaluation and numerical algorithms belong in Go, with no UI dependency.
- The parser must remain bounded and must never evaluate user input as executable code.
- `cmd/wasm` is transport only. Keep Go and TypeScript request/result fields synchronized.
- A spatial or 4D result's large arrays must not travel as JSON numbers. A mesh goes in the typed mesh reply (`cmd/wasm/mesh.go`); other bulk geometry must be a kind `cmd/wasm/lift` moves out of the JSON. A slice of structs of numbers, or a new bridge function that returns plain JSON, puts the cost back.
- Time a transport or engine change against the deployed site, never by headless frame rate. Keep every preset's result bit for bit identical unless a change is intended, with refinement on and off. On an arm64 machine, run a borderline numerical change's Go tests under `GOARCH=amd64` too. The commands are in `docs/contributing.md`, **Transport and performance**.
- React manages controls; SVG manages the planar drawing. Preserve equal axis scale.
- The renderable visualization viewport contains geometry only, never visible text. Keep labels, legends, annotations and diagnostic readouts in the surrounding UI. Apply this rule to live drawings, thumbnails, still images and animation exports; non-rendering accessibility titles and metadata may remain.
- Keep live regions (`role="status"`, `aria-live`) to short summaries. Do not rewrite them on every animation frame or list every item of a family in them; put per-item detail in ordinary, non-announcing UI.
- When a notebook offers several kinds of object, keep each object's capabilities, labels, help, explanations, support, defaults, and diagnostics in one descriptor (for the 4D notebook, `web/tesseract/objects.ts`). Components read the descriptor; they do not branch on object names.
- Keep computations in the browser worker. Do not introduce a server or remote data collection.
- Treat nonfinite values, singularities, virtual rays, and total internal reflection explicitly. Never silently join known discontinuities.
- Document sign conventions and refractive index ratios. Do not infer scene topology.
- A future 3D extension needs separate mathematical definitions and types, not dummy coordinates.
- Keep scalar parsing in Go. Bounds and animation endpoints must reject `t`, `x`, and `a`; curve expressions can bind `a` numerically.
- Every numeric curve, generator, and construction parameter field accepts the same constant expressions as the bounds, including `pi`, `e`, and `phi`: use `ScalarInput` (`web/ScalarInput.tsx`), never `<input type="number">`. Only whole-number counts and animation settings stay numeric. Because Go resolves these fields asynchronously, apply control changes to the latest configuration with functional updates, never a render's copy; a handler that computes from other numeric fields must await pending evaluations; replacing the configuration (a preset) must drop evaluations begun before it.
- Choosing a preset replaces the whole study, as a link does: nothing of the previous study carries over. A preset's animation starts from the view the preset opens with, unless a cut is intended. A preset that turns an option on needs a test that plays its own animation with the option on, and the comment above the preset must still describe what it opens with.
- Help text states the same limits the engine enforces, including when an input is ignored. Validation errors name the offending field rather than combining several fields in one message. Such an error is a `FieldError` carrying the field's request path, shown under that control.
- Preserve immutable base studies and manual camera state during animation. Stop/pause/edit must invalidate in-flight results. Never queue an unbounded animation backlog or blend output geometry across singularities.
- Hold-current camera snapshots must preserve effective pan/zoom in playback and exports. Point-source coordinates are independent of curve format; interpolate polar radius/theta before Go resolves the Cartesian point. Polar theta uses radians, while parallel-light direction uses degrees.
- Animation export must reuse the numerical sampler and plot renderer, preserve file duration independently of render speed, bound memory/work, and discard canceled output. Verify actual exported files with an independent decoder, including timing and endpoints.
- Fit base and derived point families independently before combining their bounds; an offset derived curve must not be discarded just because the base arc is short. Retain explicit robust treatment of asymptotic outliers. Export quality must render at its target resolution, not upscale a previously rasterized frame.
- Study links (`web/study-link.ts`) are untrusted input and must keep opening as studies grow. A new or renamed configuration, layer or animation field needs a link schema entry, a default that reproduces the previous drawing for older links, and a test. Never read link fields before they are conformed, and never put the theme or transient playback state in a link.
- Theme defaults to the live system preference. Explicit choices persist locally; storage denial must not break the app.
- A setting that changes how every drawing looks, such as the theme or color scheme, must reach everything that draws or names a color, not only the main drawing: legends, swatches, notes, thumbnails and exports. Search for calls that fall back on the setting's default parameter (`lineColor`, `describeColors`). Text that names a color takes the name from `describeColors`. Keep each palette's roles distinct under every scheme, and test at least one legend or note under a non-default scheme.

## Help text

Help opens in a narrow sidebar column, so it gives the essentials first and keeps the rest one click away.

- A help opens on one line of at most 20 words, or 12 in a paired column (`.pair`): what the control does and, when it fits, the range the engine accepts.
- Anything further goes behind Show more: write the help as `tiered(brief, more)` from `web/help.ts`. The second tier is a short paragraph of at most 60 words, for exact limits, edge cases and interactions with other settings. Together the two tiers still state every limit the engine enforces (see Boundaries), but not how the algorithm works step by step: that belongs in `docs/mathematics.md` or a study's explanation. A help that is complete in one line stays one line.
- `tests/help-text.spec.ts` checks these limits on every help each example opens with, and on the help tables that other settings reveal (Loop, a camera flight, the cut, probe targets, 4D motions). A help shown only under another setting needs its table in that second test.
- Trim before tiering. Leave out history and compatibility notes (what older links open with, how drawings looked before an option existed), implementation names such as Go, restatements of the control's label, and anything a neighboring control's help already says.
- Add to an existing help with `withMore`, never by joining strings, so the essentials stay first. Tests read both tiers with `helpText`.
- Notes and captions that are always visible get the same treatment: a sentence or two, with longer detail in a help toggle.
- When behavior changes, search help, notes, `docs/` and code comments for the old description and correct each one. `docs/` describes the mathematics and the app as they are, not their tests or their history.

## Safari and iOS

Playwright's WebKit uses macOS rules, so it misses some of what an iPhone does (details and reproductions in `docs/contributing.md`):

- A menu that moves focus after a pointer action uses `useQuietFocus` (`web/quiet-focus.ts`), since iOS rings a programmatic `focus()` after a tap.
- A radio or checkbox stretched over its label sets `width: 100%; height: 100%` explicitly.
- Cover click, focus and blur behavior in `tests/webkit.spec.ts`, since Safari does not focus a clicked button.

Anything only a phone can show is reported as needing an on-device check over HTTPS, never as passing.

## Verification

Run `gofmt` on changed Go files. Use analytic identities and geometric invariants for numerical changes, and convergence checks when altering approximation methods. A matching screenshot alone is insufficient. Extend relevant tests for regressions, especially singularities and invalid inputs.

- After every change, run `make thumbnails`, including engine, rendering, camera, style, dependency, test, and documentation changes. This is required even when no preset definition changed. Inspect regenerated thumbnails in both themes, run `npx playwright test tests/gallery.spec.ts`, and commit all valid generated changes under `web/examples/`, including incidental refreshes. Unchanged preset fingerprints do not prove thumbnails are current (`docs/contributing.md`, **Thumbnails**).

- Run `make pre-pr` once on the final changes, before handing work to the user for review. It runs `make check`, `make thumbnails`, and the complete production Chromium suite (`make test-browser`) without spec, grep, or shard filters, then fails if any regenerated file under `web/examples/` is uncommitted. Before the user asks for a commit, that last step is expected to fail when thumbnails changed; report it as such, not as a failing check. When the user then asks for a PR and nothing has changed since that run, do not run it again: commit, confirm `git status --porcelain web/examples` is empty, and quote that run's final lines in the PR body. Run it again only for changes made after it. Targeted tests support reproduction and iteration; the full suite is required for the final changes, including regression-baseline and metadata updates. Review changed image or SVG baselines against the intended behavior and retain exact regression assertions. Use CI to confirm the local results, and report the checks actually run and any remaining limits.

- Use test-driven development with red-green-refactor cycles for new features, major changes to existing ones, and behavioral fixes. Write the failing test first and observe it fail against the current implementation. Then write the code that makes it pass, and refactor under that protection. Report which failures were reproduced. If reproduction is unavailable, explain the limitation rather than claiming a red test.
- Adding an object, mode, or option must not change existing studies' drawings, readouts, number formatting, or help text unless that change is intended and stated. Before sharing a code path with existing studies, assert an affected existing preset's output so a regression fails.
- Tests must exercise production code and assert meaningful behavior. Numerical expectations should be independent, but observations must come from the engine's returned geometry or diagnostics, not a second copy of the formula. Convergence checks should measure the actual approximation error. Screenshots and timing/heap logs alone are observations, not regression assertions; add a meaningful invariant or a generous justified bound.
- Exercise controls directly as well as through presets. Cover supported options, transitions between edited studies, restoration of user work, and outstanding asynchronous evaluations. Defaults applied by a switch or reset must produce a valid study for whatever parameters remain in effect; test them starting from edited, non-default values. Check identities in the visible UI and drawing, and verify that export uses the same rendering semantics and metadata.
- Refine tests of numerical logic, sampling, validation, state restoration and cancellation with targeted mutations (procedure in `docs/contributing.md`). Report the tested scope and the detected and surviving faults.

Playwright tests the production build in `dist/`, and a targeted `npx playwright test` neither rebuilds it nor replaces a preview already serving port 4173. Run `npm run build` before targeted runs, including after `make thumbnails`, and stop any stale preview (`docs/contributing.md`, **Running the tests**). Inspect the drawing in both themes and on a narrow screen when changing layout, and under an alternate color scheme when changing colors. Content that appears or disappears (help text, notes, errors) must never move a control beside it: put side-by-side fields in `.pair` as `Field`s, and never couple them so that one field's height moves its neighbor (`docs/contributing.md`, **Side-by-side fields**). Report actual checks and remaining limits; do not imply unrun checks passed.

CI runs the Chromium tests in six shards packed by each spec file's recorded duration. Refresh the durations after adding, splitting or removing any spec file, and whenever the slowest shard runs a few minutes longer than the fastest (`docs/contributing.md`, **CI shards**).

For animation changes, exercise endpoint accuracy, cancellation, pause/resume, scrubbing, and all camera modes. Playback progress must stay within its start and 1: `requestAnimationFrame` timestamps can precede the moment playback began, and extrapolating before the start overshoots the entered endpoint. Test custom sample/line counts, scalar bounds, and system/manual theme persistence when changing controls. Desktop sidebar scrolling must not move the drawing.

Preserve user work. Keep temporary generated files, caches, dependency directories, and build output out of version control. Gallery thumbnails under `web/examples/` are tracked artifacts and must be committed after regeneration. Commit the npm lockfile. Update generated distribution notices when adding runtime dependencies; verify all three license files are included in dist/. Do not initialize Git or publish unless requested. Merging to `main` deploys to production (`.github/workflows/ci.yml`); never deploy any other way. Dependabot patch and minor updates merge and deploy on their own once `Verify` passes (`.github/workflows/dependabot-merge.yml`), so the browser tests are what stands between a bad dependency and production. Keep `tests/smoke.spec.ts` fast and read-only, because it runs against the live site after every deploy. Any page, worker, or export that needs a new kind of resource needs a matching change to `deploy/content-security-policy.txt`, and the same change in `iwvelando/cloud-accounts` (`sites/tangent-garden.isaacvelando.com`) before this repo's change merges. Use the project's MIT license and retain dependency notices. Leave no machine-specific paths in source or docs.
