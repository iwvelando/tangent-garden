# Contributing: procedures for particular changes

[AGENTS.md](../AGENTS.md) states the rules every change follows. This page holds the step-by-step procedures for particular kinds of change: which files each one touches and which tests it needs. Read the section for a change before making it.

## Running the tests

- `make check` runs formatting checks, Go vet, native tests with race and coverage, a real WASM bridge test, TypeScript checks, and the production build.
- `make test-browser` runs the production integration checks. It needs a Chromium installation (`npx playwright install chromium`).
- Playwright tests the production build in `dist/`. `make test-browser`, `make test-webkit` and `make thumbnails` rebuild it first. A targeted `npx playwright test` does not, and locally it reuses a preview already serving port 4173.
- `make thumbnails` rewrites `web/examples/thumbnails.json` after it builds, so run `npm run build` again before a targeted run.
- Prettier formats `web/`, `scripts/` and `tests/` only (`npm run format`). Never run it over `docs/` or `README.md`: it rewraps the Markdown.
- A test that opens a study by changing only the fragment of the current path (`page.goto("/?study=4d#s=…")`) does not reload the page, so the previous study can still be settled on screen. Wait for the app to remove `#s=`, which it does once it has read the link, and poll reads rather than reading once, as `tests/tesseract-loop.spec.ts` does. To reproduce such a race, defer the app's `hashchange` listener in an init script.
- TypeScript checks (`make typecheck`, and `tsc` in the build) cover `web/` only, not `tests/` or `scripts/`. A test fixture that builds a result type by hand is not checked against it, so when a result gains a field, search the tests for its other fields (`rg crossingsExhausted tests`) and add it there too.

## Thumbnails

Preset fingerprints cover definitions, not numerical or rendering output, so unchanged fingerprints do not prove thumbnails are current. The gallery hides a thumbnail whose fingerprint no longer matches its preset, and `tests/gallery.spec.ts` fails until it is redrawn.

## Side-by-side fields

- Side-by-side fields go in `.pair` as `Field`s, whose CSS subgrid gives labels, controls and help their own shared rows. Do not bottom-align or otherwise couple them.
- `tests/layout.spec.ts` opens every paired help toggle in every preset at desktop and phone widths. Extend its setups when a pair appears only under another setting.

## Adding a preset

- A new 2D or 3D preset needs its engine's copy of the presets regenerated, `engine/testdata/presets.json` and `engine3/testdata/presets.json`: run `make preset-fixtures`.
- Raise every count of the notebook's presets: in `tests/gallery.spec.ts`, and in `tests/notebook-consistency.spec.ts`, where the 3D test counts both the example titles and their eyebrows.
- Choosing a preset replaces the whole study, as a link does. Each notebook's `presetStudy` (`planar-link.ts`, `spatial/link.ts`, `tesseract/link.ts`) returns its full link study, the preset's own fields over the notebook's defaults, so nothing of the previous study (animation, probe, layers, line weight) carries over. `tests/preset-study.ts` checks every preset against that.
- Tests choose presets through `choosePreset` in `tests/helpers.ts`.
- A preset that turns an option on needs a test that plays the preset's own animation with the option on.
- Run `make thumbnails` and commit the new thumbnail (AGENTS.md, **Verification**).
- The 3D engine never treats a `parametric` curve as closed, even one that returns over a whole period, so a loop (`repeat: "loop"`) on it is refused. Write a curve that should loop as `harmonic`.

### Framing a 3D preset

Compute a 3D preset's `view` rather than adjusting it by screenshot. The turntable's eye lies along `(−cos p·sin y, sin p, cos p·cos y)` for yaw y and pitch p (`camera` in `web/spatial/scene.ts`), so solve y and p from the direction to look from, then check once.

- The screen's rows are right = `(cos y, 0, sin y)` and up = `(sin p·sin y, cos p, −sin p·cos y)`. To center a point q in an orthographic view, set `panX = −right·(q − c)` and `panY = −up·(q − c)`, with c the study's bounds center (`Result.Bounds.Center`). The visible height is about `2·1.16·radius/zoom`.
- y is up on the page at pitch 0, so a curve in the xy-plane faces the reader at yaw 0, pitch 0; z stays upright only near p = −π/2.
- To try framings without rebuilding, open the study by link, `/?study=3d#s=` followed by base64url(deflateRaw(JSON `{v: 1, notebook: "3d", study}`)), with `study` built from `presetStudy(index)` and overrides, in a throwaway spec.
- A closed convex patch hides what lies inside it, such as the surface probe's centers and normal-section circles. Set `sight.probe` to show them behind sheets, or look into an open patch from its concave side. Principal circles lie in planes containing the normal, so look about 45° off the normal, diagonal to both principal directions.
- A probe flight with `camera: "hold"` reframes to take in the probe's circles, which can shrink the drawing; `"current"` keeps the preset's view.

## Adding a numeric field

- Use `ScalarInput` (`web/ScalarInput.tsx`), never `<input type="number">`, and add the field to `tests/scalar-fields.spec.ts`.
- Only whole-number counts (samples, lines, offsets) and animation settings stay numeric.

## Adding a validation error

A validation error about one field is a `FieldError` (in `engine`, `engine3` or `engine4`) carrying the field's request path, shown under that control. A new path needs:

- its label in the notebook's field map: `web/planar-fields.ts`, `web/spatial/fields.ts` or `web/tesseract/fields.ts`;
- cases in the engine's `fielderror_test.go`;
- cases in the notebook's label table: `tests/planar-field-error-labels.spec.ts`, `tests/spatial-field-error-labels.spec.ts` or `tests/tesseract-field-errors.spec.ts`.

## Study link fields

A new or renamed configuration, layer or animation field needs:

- its entry in the notebook's link schema (`planar-link.ts`, `spatial/link.ts`, `tesseract/link.ts`). `tsc` enforces coverage;
- a default that reproduces the previous drawing for older links;
- a case in `tests/study-link.spec.ts`.

## Transport and performance

[Architecture](architecture.md) describes the typed mesh reply (`cmd/wasm/mesh.go`) and the lifted arrays (`cmd/wasm/lift`).

- Bulk geometry other than a mesh should be a slice, or a slice of slices, of a kind `cmd/wasm/lift` moves out of the JSON: `engine3.Vec3`, `*engine3.Vec3` (nil for a gap), `[3]float64` or `[4]float64` (the 4D vectors), `float64`, or `*float64`. Then it reaches the page as float64 and is restored in place with no change on either side. A slice of structs of numbers, or a new bridge function that returns plain JSON, puts the cost back.
- A new kind needs a case in both `lift.go` and `web/lifted.ts`, and in their tests.
- A 2D result still travels as plain JSON, because it is small (under 3 MB, a few percent of most presets' time). A 2D array that grows large needs `engine.Vec` added as a kind before the planar bridge can lift it.
- Time a transport or engine change against the deployed site with `make bench ARGS="--compare <site>"` (3D only) or `make preset-hashes ARGS="--compare <site> --only <name>"` (any notebook), never by headless frame rate. In WASM, allocation costs more than arithmetic, so profile allocations first ([architecture](architecture.md), **Measuring**).
- Check that every preset's result is bit for bit identical with `make preset-hashes ARGS="--compare <site>"`, and again with `--refine on` and `--refine off`, since a reader can switch refinement on any preset.
- Native Go tests can disagree between arm64 and amd64: arm64 fuses multiply-adds, and the default amd64 build and WASM do not. On an arm64 machine, a borderline numerical change needs `GOARCH=amd64 go test` too.
- Which multiply-adds arm64 fuses depends on where a function is inlined. An evaluator that must return a sample's point exactly, such as refinement between samples, has to call the very function the sample loop calls (as `(*caustic).at` is shared), not a copy of its arithmetic.

## CI shards

CI runs the Chromium tests in six shards packed by each spec file's recorded duration (`tests/shards.ts`, read through `TEST_SHARD` in `playwright.config.ts`), not by Playwright's `--shard`, which splits by test count and leaves heavy files bunched in one shard. Every spec file on disk is placed, and a new one counts as the average until it is recorded, so durations never decide whether a test runs, only how evenly. Each shard uploads its per-test durations as `chromium-test-timings-<shard>`.

- Refresh the durations after adding, splitting or removing any spec file, and whenever the slowest shard runs a few minutes longer than the fastest: `make test-durations RUN=<run id>` (needs `gh`), then commit `tests/test-durations.json`. The run can be the pull request's own, since every shard uploads its timings even when it fails.
- `tests/shards.spec.ts` checks the balance of recorded files only, so an unrecorded file never fails it, but it packs at the average and can leave one shard minutes longer than the rest.
- A single file longer than a balanced shard's share can't be packed around. Split that file instead.
- Changing the shard count needs only the matrix in `.github/workflows/ci.yml`.

When a shard fails on a wait for a study to settle (`aria-busy` = "false") or on a test's time limit:

- Rerun the failed shards once (`gh run rerun --failed`) before investigating. Headless Chromium renders WebGL in software, using every core it can, so a heavy 3D study is far slower on a runner than locally, and an extra render pass adds settle time no GPU shows.
- If the same wait fails again, compare its test's duration with main's from the same day's runs, using the `chromium-test-timings-<shard>` reports (`startTime`, `duration` and `file:line` also show what ran beside it), before blaming the branch.
- A test that reads the drawing between a result's arrival and its redraw can see the previous study's state for a few milliseconds. To reproduce it, delay `Worker.prototype.postMessage` in an init script and record `aria-busy` with a `MutationObserver`; effects that redraw a result should be layout effects.

## Mutation testing

Use targeted mutations to refine tests of numerical logic, sampling, validation, state restoration and cancellation.

1. Inject plausible faults in temporary copies or compiler overlays.
2. Run the relevant tests and investigate each surviving fault.
3. Strengthen the tests and repeat.
4. Restore any temporary edits and discard scratch tooling afterward.

Do not add one-off mutation scripts or a maintained mutation framework unless explicitly requested. Report the tested scope and the detected and surviving faults. A targeted run is not an exhaustive mutation score.

## Safari and iOS

Safari and every iOS browser use WebKit. Playwright's WebKit uses the macOS user-agent stylesheet and focus rules, so it misses some of what an iPhone does.

- **Focus rings after a tap.** iOS Safari treats a programmatic `focus()` after a tap as `:focus-visible` and draws a ring. A menu that moves focus after a pointer action marks itself quiet with `useQuietFocus` (`web/quiet-focus.ts`), as `NotebookMode` does for its picker.
- **Radio and checkbox size.** iOS Safari gives `input[type=radio|checkbox]` a small fixed size, so `appearance: none` with `inset: 0` does not stretch the input over its label. Set `width: 100%; height: 100%` explicitly. To reproduce it in a test, add a weak author rule (`input { width: 16px; height: 16px }`) through a constructed stylesheet (`new CSSStyleSheet()` with `document.adoptedStyleSheets`), which the CSP allows.
- **Button clicks and blur.** Safari does not focus a button when it is clicked, so a blur's `relatedTarget` is null when the reader clicks a menu's own button. Cover click, focus and blur behavior in `tests/webkit.spec.ts` (`make test-webkit`).
- **On-device checks.** Check on a phone over HTTPS with `make preview-lan`: WebKit is several times slower on plain HTTP.
