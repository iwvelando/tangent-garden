# Remaining refinements

This is the working list of refinements still open after the spatial roadmap's slices and follow-ups. It covers all three notebooks, 2D, 3D and 4D, not only the spatial one. It replaces the open items scattered through [spatial-expansion-roadmap.md](spatial-expansion-roadmap.md); that roadmap's handoff notes remain the history and the source of the decisions summarized here. The 4D notebook's own conditional pass (general implicit sections) stays in [four-dimensional-expansion-roadmap.md](four-dimensional-expansion-roadmap.md#pass-5-general-implicit-sections-only-when-needed).

Nothing here is implemented, scheduled, or authorized for merge or deployment. When starting an item, read `AGENTS.md`, then the permanent docs named in that item. Take one item, or one bullet of a larger item, per branch. When it lands, delete it from this list, move durable definitions and limits into the permanent docs, and record verification in the pull request. Do not grow a handoff log here. Once every item is done or declined, retire this file, the spatial roadmap, and their inbound links (`docs/spatial-study.md` links the roadmap).

## The notebooks at a glance

These are the facts that decide where a refinement applies.

|                | 2D                                                                                                                                | 3D                                                                                        | 4D                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Drawing        | SVG (`web/Plot.tsx`)                                                                                                              | WebGL (`web/spatial/renderer.ts`, geometry in `scene.ts`)                                 | SVG of an orbitable 3D projection (`web/tesseract/Plot.tsx`) |
| Camera         | Pan and zoom                                                                                                                      | Turntable orbit (pitch ±1.5 rad), three perspective lenses, key-view paths, ray ride      | Turntable orbit (pitch ±1.5 rad), orthographic               |
| Pointer, touch | Drag, scroll, pinch (`web/gestures.ts`, shared)                                                                                   | Same                                                                                      | Same                                                         |
| Keyboard       | Arrows pan, +/− zoom, Home fits                                                                                                   | Arrows orbit, shift-arrows pan, +/− zoom, Home                                            | Same as 3D                                                   |
| Still export   | SVG; PNG at 1–4 × the page, optionally transparent (`web/ExportImageMenu.tsx`, shared)                                            | PNG, SVG with embedded PNG and Lines (SVG), all at 1–4 × the page, optionally transparent | As 2D                                                        |
| Probe          | Curve                                                                                                                             | Curve, surface, offset, focal sheets, light                                               | None (no user curve)                                         |
| Refinement     | Base, derived input, pedal, contrapedal, orthotomic, evolute, offset and stack, caustics, inversion, involute, rolling, envelopes | Base, derived input (involute too), projections, inversion, involutes, strands            | None (no user curve)                                         |
| Shared already | Links, field errors, repeat/pace, 60 fps WebP, line weights, pipelined playback (`web/playback.ts`), timing (`web/timing.ts`)     | Same                                                                                      | Same                                                         |

The 3D-only features are 3D-only by nature: cut, see-through, surface and light probes, camera paths, the ride, perspective lenses, typed mesh transport and adaptive implicit meshes. Do not port them to 2D or 4D unless an item below says so.

## Conventions every item inherits

These come from the handoffs. Each was paid for at least once.

- **Existing drawings stay put.** New settings are opt-in and default to the current behavior. Before touching a shared path, record a guard first, then confirm `make thumbnails` redraws every existing thumbnail byte-identical. Hash line drawings or SVG, not PNGs: PNG bytes depend on the rasterizer, and CI's SwiftShader differs from macOS. Recorded linework hashes in `spatial-cut.spec.ts` and `spatial-sight.spec.ts` strip later metadata fields; extend that stripping when you add one.
- **Exports record a setting only when it is not the default**, so default files stay byte-identical.
- **Links:** add every new field to the notebook's schema (`planar-link.ts`, `spatial/link.ts`, `tesseract/link.ts`) with a default that reproduces older links, plus cases in `tests/study-link.spec.ts`. A preset's own value joins its gallery fingerprint only when present.
- **Presets** are appended so indices hold. Update the counts in `gallery.spec.ts` and `notebook-consistency.spec.ts`, and run `make thumbnails`.
- **One descriptor per setting** (`cut.ts`, `sight.ts`, `path.ts`, `line-weight.ts`, `tesseract/objects.ts`). Panels read the descriptor and do not branch on names.
- **Share, don't copy.** A refinement for several notebooks belongs in one shared module, as `timing.ts`, `playback.ts`, `line-weight.ts`, `probe.ts`, `gestures.ts`, `engine/refine` and `ExportImageMenu` are.
- **Test traps already found:**
  - React shows a `<select>`'s first option for a value it lacks, which hid two mutation survivors. Assert the state, not the visible option.
  - Chromium ends a slider drag when a child is inserted into its fieldset. Put changing content in a wrapper.
  - Layout sweeps must wait for each preset to settle, or they test nothing.
  - The smoke test's compression check fails against a local `BASE_URL`.
  - Run WebKit only when a rendering or encoding path changes.
- **iOS gaps no local test shows.** See the user's notes on radio and checkbox sizing and on `:focus-visible` after a tap. Ask for an on-device check whenever controls or touch behavior change.

## Recommended order

1. Probe follow-ups (3D)
2. Refinement between samples, remaining constructions (2D and 3D)

The remaining items are smaller or conditional, and each can be taken when a study needs it.

---

### 1. Probe follow-ups

**Applies to:** 3D. The 2D probe has nothing open, and 4D has no probe.

**Open:**

- **3D surface probe held at its own (u, v)** under parameter tracks, rather than its share of the grid.
- **Smaller limits** to fix if they bite:
  - 3D probe lines are depth-tested, so sheets hide them.
  - Surface plots run along the row only.
  - The readout cannot tell an unknown tangent plane from a singular one.

**Start from:** `web/probe.ts` (shared `heldCurveSample`, plot scale, inks, away messages), `engine/probe.go` and `engine3/probe.go` (the curve probe between samples, a model for a surface probe at its own (u, v)), `web/spatial/probe.ts`, `engine/diagnostics.go`, `engine3/diagnostics.go`, and `mathematics.md` (**Curvature and the 2D probe**, the spatial probe sections).

**Watch for:**

- Diagnostics are requested only while the probe is on, and studies without it must stay byte-identical (Go tests assert this per format).
- Loops are judged with the probe drawn.

### 2. Refinement between samples: remaining constructions

**Applies to:** 3D and 2D. 4D has no user curve.

**Open:**

- **3D:**
  - Refining surfaces along the curve. A refined partner thread, meridian or base can stand just off its surface's edge until then.
- **Both:**
  - A view-dependent drawing refinement, which must still give playback and every export the same curve.
  - Framing that ignores refined points.
  - Three probes per piece miss features narrower than a quarter interval.

**Start from:** `engine/refine` (point type supplied with its chord distance and length), `web/refinement.ts`, and `mathematics.md` (**Refinement between samples**).

**Watch for:**

- Uniform samples remain the study's identity for surfaces, construction lines, framing, reveal and probe.
- Breaks found between samples must reach every curve built on that curve.
- Keep the feature opt-in and off for older links.

### 3. Camera path pivot

**Applies to:** 3D only. 4D has no camera paths.

**Open:**

- Choosing the framed point from the geometry, not the plane through the study's center. Today a turn holds an off-plane detail only approximately.

**Smaller limits:**

- Smooth's framed point can change rate at a view.
- Views cannot be reordered.
- Long view names are cut off at phone width.
- Geometry that grows past the starting bounds can leave the page under a path, as under Hold current view.

**Start from:** `web/spatial/path.ts` and `mathematics.md#spatial-camera-paths`.

**Watch for:** a loop's seam slope (`cyclic`) and links' `animation.path`.

### 4. 3D rendering leftovers

**Applies to:** 3D only. The 2D and 4D SVG strokes use the browser's joins.

**Open:**

- Turns sharper than 120° are capped rather than joined.
- See-through sheets are not multisampled, so their outlines alias.
- Lines behind several see-through layers are not attenuated per layer.
- Dash length is set in space, so near dashes look longer under perspective.
- Close to a perspective eye, **Lines (SVG) · visible only, sampled** can exceed its work limit.

**Start from:** `mathematics.md` (**Spatial line weights**, the see-through section) and `web/spatial/sight.ts`.

**Watch for:** the hairline path must stay the original program and `gl.LINES`.

### 5. WebGL context recovery and device limits

**Applies to:**

- Context recovery: 3D only (done).
- Device limits: all three.

**Done:** after `webglcontextlost`, `SpatialPlot.tsx` asks for restoration and says the drawing returns when the browser restores it. Camera gestures, edits and study changes made meanwhile are kept but not drawn. On `webglcontextrestored` it builds a new renderer, uploads the current result and probe, and draws the camera as it then stands. The 2D notebook stays usable throughout. `tests/spatial-context.spec.ts` covers both, using `WEBGL_lose_context`. Exports draw on their own canvases and are not covered.

**Open:**

- All notebooks: still exports already refuse a page the device cannot draw, naming its size (see `mathematics.md`, **Still exports: size and transparent background**). Still open: query the limits before offering a size, so the menu offers only sizes that fit, and cover half-float targets and animation exports the same way.

**Test with:** `WEBGL_lose_context` in Chromium.

### 6. Scale and translation robustness

**Applies to:**

- 3D: primary.
- 2D: engine tolerances and SVG coordinates.
- 4D: a check only. Its objects are analytic with bounded scales; the 4D roadmap already requires absolute-plus-relative tolerances.

**Open:**

- Error budgets across tiny, large and translated studies.
- 3D: rebase positions before the Float32 upload, and keep meaningful clipping (near/far are set in framing radii).
- Test explicitly that live and exported drawings are equivalent.

Today's finite-value guards and robust bounds do not prove scale independence.

**Start with:** a translated and scaled copy of existing presets compared against the originals. Expect tolerance constants such as 10⁻⁹ and 10⁻⁶ that are absolute rather than relative.

### 7. Composition and comparison

**Applies to:**

- Comparison: 2D with 3D.
- Other bullets: 3D.

**Open:**

- **2D/3D comparison.** A side-by-side 2D/3D view, or a declared planar embedding, to explain reductions. The two notebooks' studies must not overwrite one another.
- **3D arc-length restart after a base break,** for involutes and the involute input. It needs separate anchors and labels; today samples past a break are unreached.
- **3D derived curve across a base cusp.** A derived curve whose limit is continuous across a base cusp is still broken there. This is deliberate; change it only with a proof-backed rule.

### 8. Transport and efficiency, when profiled

**Applies to:** 3D first, then 4D.

**Open:**

- Typed-array transport beyond the meshes is done: the curve mesh travels typed and indexed, as the implicit mesh did, and every other large numeric array of a spatial or 4D result is lifted out of the JSON and put back in the page (see [architecture.md](architecture.md), "No spatial mesh goes through JSON" and the paragraph after it). What still goes through JSON is mostly grids of flags (a surface's `alongU`, `alongV` and `faces`, about 70 KB each at 240²) and arrays of small structs (ray lines, glyphs, constructions). A tube frame's time is now mostly Go's own work. The twisted spring's is mostly its meridians' refinement: about 7,400 contact circles between samples, each evaluating the expression curve's five-point stencils at two steps for the curve and the frame's arc length and the profile's for the radius, about 33 expression evaluations each. A faster expression evaluator, or a refinement that asks for fewer circles, is what would cut it further.
- 2D results still travel as plain JSON (`tangentGardenCompute`). Measured on 2026-10-09: of the 62 presets, the largest results are Van der Pol (2.9 MB; natively 24 ms compute and 8 ms encoding, and 15 ms to decode and copy in Node), the pendulum (2.0 MB) and the star's ripples (1.8 MB); about fifty are 0.1–0.4 MB, where JSON costs a millisecond or two. JSON is at most about a third of a frame on the largest, against 75–90% of a tube frame before spatial transport moved off JSON, so it is not worth doing yet. If a 2D study grows large, add `engine.Vec` (and its pointer, for gaps) as a kind in `cmd/wasm/lift` and `web/lifted.ts`, send the planar result through `liftReply` as the 4D bridge does, and restore it where the worker parses the planar reply.
- Worker pools. A third playback engine was rejected at about 100 MB per engine.

**Rule:** profile first (`make bench`, `scripts/playback-probe.js`). Every preset must reassemble bit for bit identical.

## Pending on-device checks

No device check was possible for these. Ask the user to look on a phone:

- Manual perspective presets.
- 2D and 4D loop presets in motion.
- The probe while parameters vary.
- The 2D probe, refinement and line-weight controls at phone width, including the probe's **At any t, between samples** checkbox and its continuous slider.

Line weights in 3D were checked locally and on a phone on 2026-10-04, the 3D probe between samples (its checkbox and continuous slider) on 2026-10-06, and the surface probe's **Describe → The offset** with **An ellipsoid's parallel surface** in motion on 2026-10-06, and **Describe → Focal sheet 1** and **Focal sheet 2** with **A spheroid's evolute, spun about its axis** and **The curvature of an ellipsoid's focal sheet** on 2026-10-07.

## Conditional and declined

- **Geometry export** (3D; possibly 4D curves). Curves and meshes in a documented interoperable format, with units, normals, branch boundaries and source metadata. The file must warn that ribbons can be open, singular, self-intersecting and nonmanifold. Choose a format only when a real downstream use is chosen. 2D and 4D drawings already export true vector SVG.
- **Saved study files:** declined on 2026-09-30. Portable links suffice.
- **Out of scope:** lighting and material editors, imported scenes, collisions, path tracing, and a backend.

## Accepted limits, not planned

Revisit these only if a study needs them:

- In 2D only parameter tracks loop. In 4D a drift, support, route or latitude sweep cannot loop.
- The SVG loop check falls back to a raster threshold of 10⁻⁴ of pixels, not a proof of identity.
- A 3D closed curve run on by less than a period is refused for a loop even when its shape returns.
- 3D surface, mirror and implicit studies use uniform grids. Cuspidal edges are not located. The mirror and refraction studies have one interaction, no occlusion, and axis-aligned receiver planes only.
- The 2D hairline is one CSS pixel (two device pixels on dense screens).
