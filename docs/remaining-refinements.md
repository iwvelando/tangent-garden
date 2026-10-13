# Remaining refinements

This is the working list of refinements still open after the spatial roadmap's slices and follow-ups. It covers all three notebooks, 2D, 3D and 4D, not only the spatial one. It replaces the open items scattered through [spatial-expansion-roadmap.md](spatial-expansion-roadmap.md); that roadmap's handoff notes remain the history and the source of the decisions summarized here. The 4D notebook's own conditional pass (general implicit sections) stays in [four-dimensional-expansion-roadmap.md](four-dimensional-expansion-roadmap.md#pass-5-general-implicit-sections-only-when-needed).

Nothing here is implemented, scheduled, or authorized for merge or deployment. When starting an item, read `AGENTS.md`, then the permanent docs named in that item. Take one item, or one bullet of a larger item, per branch. When it lands, delete it from this list, move durable definitions and limits into the permanent docs, and record verification in the pull request. Do not grow a handoff log here. Once every item is done or declined, retire this file, the spatial roadmap, and their inbound links (`docs/spatial-study.md` links the roadmap).

## The notebooks at a glance

These are the facts that decide where a refinement applies.

|                | 2D                                                                                                                                                    | 3D                                                                                        | 4D                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Drawing        | SVG (`web/Plot.tsx`)                                                                                                                                  | WebGL (`web/spatial/renderer.ts`, geometry in `scene.ts`)                                 | SVG of an orbitable 3D projection (`web/tesseract/Plot.tsx`) |
| Camera         | Pan and zoom, key-view paths                                                                                                                          | Turntable orbit (pitch ±1.5 rad), three perspective lenses, key-view paths, ray ride      | Turntable orbit (pitch ±1.5 rad), orthographic               |
| Pointer, touch | Drag, scroll, pinch (`web/gestures.ts`, shared)                                                                                                       | Same                                                                                      | Same                                                         |
| Keyboard       | Arrows pan, +/− zoom, Home fits                                                                                                                       | Arrows orbit, shift-arrows pan, +/− zoom, Home                                            | Same as 3D                                                   |
| Still export   | SVG; PNG at 1–4 × the page, optionally transparent (`web/ExportImageMenu.tsx`, shared)                                                                | PNG, SVG with embedded PNG and Lines (SVG), all at 1–4 × the page, optionally transparent | As 2D                                                        |
| Probe          | Curve                                                                                                                                                 | Curve, surface, offset, focal sheets, light                                               | None (no user curve)                                         |
| Refinement     | Base, derived input, pedal, contrapedal, orthotomic, evolute, offset and stack, caustics, inversion, involute, rolling, envelopes; to the zoomed view | Base, derived input (involute too), projections, inversion, involutes, strands, surfaces  | None (no user curve)                                         |
| Shared already | Links, field errors, repeat/pace, 60 fps WebP, line weights, pipelined playback (`web/playback.ts`), timing (`web/timing.ts`)                         | Same                                                                                      | Same                                                         |

The 3D-only features are 3D-only by nature: cut, see-through, surface and light probes, the ride, perspective lenses, typed mesh transport and adaptive implicit meshes. Do not port them to 2D or 4D unless an item below says so.

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
  - A test that opens a study by changing only the fragment (`/?study=4d#s=…`) does not reload the page, so the old study is still settled on screen. Wait for the app to clear `#s=` first, as `tests/tesseract-loop.spec.ts` does (#140); other specs still use the bare pattern.
  - Some numerical faults show only on arm64 (FMA contraction, a sample landing beside rather than on a pole, #139). Run engine tests on arm64 as well as amd64 when changing tolerances or refinement.
- **iOS gaps no local test shows.** iOS Safari gives radio and checkbox inputs a small fixed size, so a stretched input needs an explicit `width: 100%; height: 100%`. It also treats a programmatic `focus()` after a tap as `:focus-visible`, so suppress the ring explicitly after pointer actions. Ask for an on-device check whenever controls or touch behavior change.

## Recommended order

1. Scale and translation: the 2D drawing
2. Refinement between samples, remaining constructions (3D and 2D)

Items 3 and 4 need a decision or a profile before any code. Item 5 lists limits to fix only when a study runs into them.

---

### 1. Scale and translation: the 2D drawing

**Applies to:** 2D. The engines' budgets are done and documented: 2D in [scale and translation](mathematics.md#scale-and-translation) (#139), 3D in [spatial scale and translation](mathematics.md#spatial-scale-and-translation) (#136), 4D in the 4D roadmap (#138). The 3D drawing measures its positions from a drawing origin near the study (the same section's **Drawing**). What remains is the 2D drawing.

**Open:**

- **2D: the drawing's coordinates for a study far from the origin.** `xy` in `web/Plot.tsx` already subtracts the frame's center in double precision before writing page coordinates, so this may need only a test: a translated and a scaled copy of existing presets draw the original's SVG to within about 0.001 px. Check the grid and axes, ray glyphs, the probe, and the exports too.

**Start with:** a translated and scaled copy of existing presets compared against the originals, as the engine's tests do (`engine/scale_test.go`: tiny 2⁻²⁰, huge 2¹³, about 860 and 36,000 units out) and as `tests/spatial-rebase.spec.ts` does for the 3D drawing. Compare drawn geometry, not PNG bytes. Expect tolerance constants such as 10⁻⁹ and 10⁻⁶ that are absolute rather than relative.

**Watch for:** every existing preset's drawing stays identical (hash the SVG, not PNGs).

### 2. Refinement between samples: remaining constructions

**Applies to:** 3D and 2D. 4D has no user curve.

**Open:**

- **3D:** a view-dependent drawing refinement, which must still give playback and every export the same curve. The 2D drawing has one (**Refinement to the view** in `mathematics.md`): `refine.RefineFocused` takes the view as a `Focus` whose `Meets` is the only part that knows the point type, so a perspective view needs its own `Meets` (a frustum, and a tolerance that grows with depth) rather than a new refinement.
- **Both:** framing that ignores refined points.

**Start from:** `engine/refine` (point type supplied with its chord distance and length; since #134 it also scans between its probes for narrow features, with a `Scan` budget, and refines a `Focus` first), `engine3/refine.go`, `web/refinement.ts`, and `mathematics.md` (**Refinement between samples**, its **Refinement to the view**, and **Spatial refinement between samples**).

**Watch for:**

- Uniform samples remain the study's identity for construction lines, framing, reveal and probe, and for surfaces unless **Refine the surface too** is on (see [surfaces along the curve](mathematics.md#surfaces-along-the-curve)).
- Breaks found between samples must reach every curve built on that curve.
- Anything drawn from a refined curve must follow the reveal and traced light, as `arrivalAt` in `web/raytrace.ts` does (#141).
- Keep the feature opt-in and off for older links.
- Refinement is the largest cost of the twisted spring's frame (item 4); measure with `make bench`.
- The 2D stencil (`stencilAt`) no longer allocates: refined 2D presets calculate 2.4–2.6× faster in WASM, every preset unchanged bit for bit. Allocation, through WASM's single-threaded collector, cost more than the arithmetic; profile allocations (`-benchmem`, `-memprofile`) before arithmetic in the other refined paths.

### 3. Composition and comparison

**Applies to:**

- Comparison: 2D with 3D.
- Other bullets: 3D.

**Open:**

- **2D/3D comparison.** A side-by-side 2D/3D view, or a declared planar embedding, to explain reductions. The two notebooks' studies must not overwrite one another. Agree the design with the user before building.
- **3D derived curve across a base cusp.** A derived curve whose limit is continuous across a base cusp is still broken there. This is deliberate; change it only with a proof-backed rule.

### 4. Transport and efficiency, when profiled

**Applies to:** 3D first, then 4D.

**Open:**

- Typed-array transport beyond the meshes is done: the curve mesh travels typed and indexed, as the implicit mesh did, and every other large numeric array of a spatial or 4D result is lifted out of the JSON and put back in the page (see [architecture.md](architecture.md), "No spatial mesh goes through JSON" and the paragraph after it). What still goes through JSON is mostly grids of flags (a surface's `alongU`, `alongV` and `faces`, about 70 KB each at 240²) and arrays of small structs (ray lines, glyphs, constructions). A tube frame's time is now mostly Go's own work. The twisted spring's is mostly its meridians' refinement: about 7,400 contact circles between samples, each evaluating the expression curve's five-point stencils at two steps for the curve and the frame's arc length and the profile's for the radius, about 33 expression evaluations each. Expressions are now compiled to folded closures that carry their constant and variable operands (`engine/expr/compile.go`), with all 347 preset results unchanged bit for bit (`make preset-hashes`). Measured on 2026-10-11 against the deployed engine with the same Go toolchain, `make bench` gives 1.23–1.49× faster implicit-surface frames and about 1.12–1.15× for the spring (58–60 ms → 52 ms, confirmed with engine order reversed); refinement still takes most of the spring's frame, so a refinement that asks for fewer circles is what would cut it further. The refinement scan added later that day (#134) made the refined presets about 1.7× slower natively in total; re-measure before relying on these figures.
- 2D results still travel as plain JSON (`tangentGardenCompute`). Measured on 2026-10-09 across the 2D presets: the largest results are Van der Pol (2.9 MB; natively 24 ms compute and 8 ms encoding, and 15 ms to decode and copy in Node), the pendulum (2.0 MB) and the star's ripples (1.8 MB); about fifty are 0.1–0.4 MB, where JSON costs a millisecond or two. JSON is at most about a third of a frame on the largest, against 75–90% of a tube frame before spatial transport moved off JSON, so it is not worth doing yet. If a 2D study grows large, add `engine.Vec` (and its pointer, for gaps) as a kind in `cmd/wasm/lift` and `web/lifted.ts`, send the planar result through `liftReply` as the 4D bridge does, and restore it where the worker parses the planar reply. Re-measured on 2026-10-13 for the heaviest new case, **Inside a star's point** refined to a zoomed view: a 1.48 MB reply parses in 2.2 ms, now once per piece of a flight, and building the drawing's path strings for its 14,630 points takes 1.2 ms a frame. Its flight plays at the 30 fps cap, as the 1,000-point ellipse does, so points and transport do not hold it back; lifting 2D off JSON remains unmerited.
- Worker pools. A third playback engine was rejected at about 100 MB per engine.

**Rule:** profile first (`make bench`, `scripts/playback-probe.js`). Every preset must reassemble bit for bit identical.

### 5. Smaller limits, to fix if they bite

Each is known and documented; none is worth a branch until a study needs it.

- **3D probe** (`web/spatial/probe.ts`, `engine3/probe.go`, `engine3/diagnostics.go`; diagnostics are requested only while the probe is on, and studies without it must stay byte-identical, which Go tests assert per format):
  - Probe lines are depth-tested, so sheets hide them.
  - A surface probe held at its (u, v) snaps to each frame's grid: Go evaluates surfaces only at their samples.
- **3D camera paths** (`web/spatial/path.ts`, `mathematics.md#spatial-camera-paths`; watch a loop's seam slope, `cyclic`, and links' `animation.path`): geometry that grows past the starting bounds can leave the page under a path, as under Hold current view.
- **3D engine scale floors** (see [spatial scale and translation](mathematics.md#spatial-scale-and-translation) for the tested coverage): the absolute stability floors for differenced r‴ (`jerk`, in `engine3/diagnostics.go`) and τ′ (`ruledprobe.go`), the framed ribbon probe's comparison of differently dimensioned tangents (`ruledprobe.go`), and the field's absolute resting-speed and acceleration-stability floors (`flow.go`; the resting limit is also stated in the UI). Far differenced curves omit curvature and mesh-topology comparisons; translated Lorenz paths are excluded as chaotic.
- **2D engine scale limits** (see [scale and translation](mathematics.md#scale-and-translation)): constructions on an evolute past about five diameters, and the absolute constants below 2⁻²⁰.

## Pending on-device checks

No device check was possible for these. Ask the user to look on a phone:

- Manual perspective presets.
- 2D and 4D loop presets in motion.
- The probe while parameters vary, including the 3D surface probe's **Stays at its u and v** (#123).
- See-through sheets on a phone (the Klein bottle and the torus's tunnel): since #137 they are sampled 2 × 2 only when the device's limits allow, and a large high-DPR canvas falls back to one sample.
- The 2D probe, refinement and line-weight controls at phone width, including the probe's **At any t, between samples** checkbox and its continuous slider.
- The camera path's key views at phone width: **Move up** and **Move down**, and long names wrapping in their fields.
- Dashes on the page (**A coiled tube running into the distance**) on a phone GPU while orbiting: even dash lengths near and far, and the **Dashes** control beside **Opacity α** at phone width.
- Playback at 60 frames a second (`web/playback.ts`) on a 120 Hz display and on a slower phone, watching for an even fall to 30 where frames come late. The thresholds (a request 1.4 intervals after the last is late, two late in ten fall back, a 2 s hold doubling to 16 s) are first choices, to tune from what is seen.

Line weights in 3D were checked locally and on a phone on 2026-10-04, the 3D probe between samples (its checkbox and continuous slider) on 2026-10-06, and the surface probe's **Describe → The offset** with **An ellipsoid's parallel surface** in motion on 2026-10-06, and **Describe → Focal sheet 1** and **Focal sheet 2** with **A spheroid's evolute, spun about its axis** and **The curvature of an ellipsoid's focal sheet** on 2026-10-07. Playback at 60 frames a second was checked on an iPhone on 2026-10-13.

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
