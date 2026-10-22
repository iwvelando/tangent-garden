# Remaining refinements

This is the working list of refinements still open after the spatial roadmap's slices and follow-ups. It covers all three notebooks, 2D, 3D and 4D, not only the spatial one. It replaces the open items scattered through [spatial-expansion-roadmap.md](spatial-expansion-roadmap.md); that roadmap's handoff notes remain the history and the source of the decisions summarized here. The 4D notebook's own conditional pass (general implicit sections) stays in [four-dimensional-expansion-roadmap.md](four-dimensional-expansion-roadmap.md#pass-5-general-implicit-sections-only-when-needed).

Nothing here is implemented, scheduled, or authorized for merge or deployment. When starting an item, read `AGENTS.md`, then the permanent docs named in that item. Take one item, or one bullet of a larger item, per branch. When it lands, delete it from this list, move durable definitions and limits into the permanent docs, and record verification in the pull request. Do not grow a handoff log here. Once every item is done or declined, retire this file, the spatial roadmap, and their inbound links (`docs/spatial-study.md` links the roadmap).

## The notebooks at a glance

These are the facts that decide where a refinement applies.

|                | 2D                                                                                                                                                                                           | 3D                                                                                                                                                                          | 4D                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Drawing        | SVG (`web/Plot.tsx`)                                                                                                                                                                         | WebGL (`web/spatial/renderer.ts`, geometry in `scene.ts`)                                                                                                                   | SVG of an orbitable 3D projection (`web/tesseract/Plot.tsx`) |
| Camera         | Pan and zoom, key-view paths                                                                                                                                                                 | Turntable orbit (pitch ±1.5 rad), three perspective lenses, key-view paths, ray ride                                                                                        | Turntable orbit (pitch ±1.5 rad), orthographic               |
| Pointer, touch | Drag, scroll, pinch (`web/gestures.ts`, shared)                                                                                                                                              | Same                                                                                                                                                                        | Same                                                         |
| Keyboard       | Arrows pan, +/− zoom, Home fits                                                                                                                                                              | Arrows orbit, shift-arrows pan, +/− zoom, Home                                                                                                                              | Same as 3D                                                   |
| Still export   | SVG; PNG at 1–4 × the page, optionally transparent (`web/ExportImageMenu.tsx`, shared)                                                                                                       | PNG, SVG with embedded PNG and Lines (SVG), all at 1–4 × the page, optionally transparent                                                                                   | As 2D                                                        |
| Probe          | Curve                                                                                                                                                                                        | Curve, surface, offset, focal sheets, light                                                                                                                                 | None (no user curve)                                         |
| Refinement     | Base, derived input, pedal, contrapedal, orthotomic, evolute, offset and stack, caustics, inversion, involute, rolling, envelopes; to the zoomed view; framing by the points between samples | Base, derived input (involute too), projections, inversion, involutes, strands, surfaces; to the zoomed view and each flight frame's; framing by the points between samples | None (no user curve)                                         |
| Shared already | Links, field errors, repeat/pace, 60 fps WebP, line weights, pipelined playback (`web/playback.ts`), timing (`web/timing.ts`)                                                                | Same                                                                                                                                                                        | Same                                                         |

The 3D-only features are 3D-only by nature: cut, see-through, the shadow on a plane, surface and light probes, the ride, perspective lenses, typed mesh transport and adaptive implicit meshes. Do not port them to 2D or 4D unless an item below says so.

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

Item 1 needs a profile before any code. Item 2 lists limits to fix only when a study runs into them. Item 3 is designed and ready to start. Item 4 needs a decision before any code.

---

### 1. Transport and efficiency, when profiled

**Applies to:** 3D first, then 4D.

**Open:**

- Typed-array transport beyond the meshes is done: the curve mesh travels typed and indexed, as the implicit mesh did, and every other large numeric array of a spatial or 4D result is lifted out of the JSON and put back in the page (see [architecture.md](architecture.md), "No spatial mesh goes through JSON" and the paragraph after it). What still goes through JSON is mostly grids of flags (a surface's `alongU`, `alongV` and `faces`, about 70 KB each at 240²) and arrays of small structs (ray lines, glyphs, constructions). A tube frame's time is now mostly Go's own work. The twisted spring's is mostly its meridians' refinement: about 7,400 contact circles between samples, each evaluating the expression curve's five-point stencils at two steps for the curve and the frame's arc length and the profile's for the radius, about 33 expression evaluations each. Expressions are now compiled to folded closures that carry their constant and variable operands (`engine/expr/compile.go`), with all 347 preset results unchanged bit for bit (`make preset-hashes`). Measured on 2026-10-11 against the deployed engine with the same Go toolchain, `make bench` gives 1.23–1.49× faster implicit-surface frames and about 1.12–1.15× for the spring (58–60 ms → 52 ms, confirmed with engine order reversed); refinement still takes most of the spring's frame, so a refinement that asks for fewer circles is what would cut it further. The refinement scan added later that day (#134) made the refined presets about 1.7× slower natively in total; re-measure before relying on these figures.
- 2D results still travel as plain JSON (`tangentGardenCompute`). Measured on 2026-10-09 across the 2D presets: the largest results are Van der Pol (2.9 MB; natively 24 ms compute and 8 ms encoding, and 15 ms to decode and copy in Node), the pendulum (2.0 MB) and the star's ripples (1.8 MB); about fifty are 0.1–0.4 MB, where JSON costs a millisecond or two. JSON is at most about a third of a frame on the largest, against 75–90% of a tube frame before spatial transport moved off JSON, so it is not worth doing yet. If a 2D study grows large, add `engine.Vec` (and its pointer, for gaps) as a kind in `cmd/wasm/lift` and `web/lifted.ts`, send the planar result through `liftReply` as the 4D bridge does, and restore it where the worker parses the planar reply. Re-measured on 2026-10-13 for the heaviest new case, **Inside a star's point** refined to a zoomed view: a 1.48 MB reply parses in 2.2 ms, now once per piece of a flight, and building the drawing's path strings for its 14,630 points takes 1.2 ms a frame. Its flight plays at the 30 fps cap, as the 1,000-point ellipse does, so points and transport do not hold it back; lifting 2D off JSON remains unmerited.
- Worker pools. A third playback engine was rejected at about 100 MB per engine.

**Rule:** profile first, allocations before arithmetic, and keep every preset bit for bit identical (see [architecture.md](architecture.md), **Measuring**).

### 2. Smaller limits, to fix if they bite

Each is known and documented; none is worth a branch until a study needs it.

- **3D engine scale limits** (see [spatial scale and translation](mathematics.md#spatial-scale-and-translation) for the tested coverage): far differenced curves omit curvature and mesh-topology comparisons; translated Lorenz paths are excluded as chaotic. Near a cusp of an expression curve thousands of its sizes from the origin, the rounded velocity leaves the tangent's direction noisy, so a construction built on its tangent projection breaks there again; a harmonic or knot base, with exact derivatives, keeps the crossing (the cusp presets are harmonic or plain projections for this reason).
- **2D engine scale limits** (see [scale and translation](mathematics.md#scale-and-translation)): constructions on an evolute past about five diameters, curvature on a study millions of its diameters out (beyond the second-derivative budget), and the absolute speed cutoffs for rolling and light, along with envelope and stability cutoffs below 2⁻²⁰.

### 3. A receiver refined to its view

**Applies to:** 3D (mirror and interface studies with a receiver).

**Why:** a receiver's bins are fixed across its window (8–960 each way), and its refinement (`rays.receiver.refine`, 0–3 levels, see [the receiver's definition](mathematics.md#spatial-receiver-planes-and-irradiance)) splits cells only as finely as those bins. Zoomed in far enough, a bin covers many pixels and the drawing is blocky again; raising the bins across the whole window to match costs time and transfer for parts the view does not show. The receiver should be as fine as the screen where it is seen, at any zoom, and no finer elsewhere.

**Decided:** a receiver option of its own (for example **Refine the receiver to the view**), off by default, beside **Refinement levels**, not the curves' **Refine to the view as you zoom**, which ray studies do not show. Each such option is one more lever a reader can pull, or leave off on a slow device.

**Design:**

- When the camera rests (the 200 ms settle and `RefinementView` that refined curves use in `SpatialApp.tsx`), the request carries the view. Go rasterizes, beside the window's own bins, an inset over the part of the window the page shows (its corners projected through the view, clipped to the page, as a rectangle in window coordinates), with bins about the size of a device pixel, capped (about 1024² bins). Cells landing on the inset are split by the same criterion against the inset's bins, within the receiver's cell budget.
- Rasterize the same cells into both: the box filter is additive, so the inset's bins inside each window bin then sum to it to rounding, which is the regression test. An inset covering the whole window at the window's bins must equal the window's bins exactly.
- The note's shares and the peak come from the window's bins, so readouts never change with zoom. The inset is shaded against the window's peak, clamped at 1 (a fold's narrower inset bins are brighter, and are said to be at or above the peak).
- Draw it as a second texture on the same quad: the fragment shader takes the inset's texel inside its rectangle (a uniform) and the window's elsewhere, so nothing is coplanar and no depth offset is needed. The inset's irradiance is a `[][]float64`, which `cmd/wasm/lift` already moves out of the JSON.
- Playback, flights and animation exports drop the inset, so their cost is unchanged; a still export uses it when the shown result has one. The option is a study field (link schema, default off, test); the view it was refined to is transient and never in a link.

**Tests:** additivity and whole-window equality above; a view off the window gives no inset; tilted windows and perspective views; a moving camera invalidates an inset in flight (as refined curves do); the budget running out says so; layer, cut and see-through drawing with an inset; and an exported still at its target resolution. Add a `make bench` study and time it against the deployed site, and keep every preset bit for bit identical with the option off.

### 4. Faster refined receivers in playback, possibly on the GPU

**Applies to:** 3D (a refined or finely binned receiver in motion).

**Why:** a refined receiver is smooth when still but slow to play: **Conic sections cut from a cone of light** at 480 bins refined twice takes about 227 ms a frame through the WASM bridge (2026-10-21), about 4 frames a second. On an iPhone 16 Pro Max, 960 bins refined three times played at 0.4–0.5 s between frames, while 480 bins refined twice looked smooth enough at a phone's size but would be more comfortable faster. An exported animation plays smoothly, since export does not run in real time. Profiled natively at 960 bins refined twice, about a third of a frame is the rasterizer, a quarter is tracing rays, and an eighth is garbage collection.

**Possible:** spreading flux over bins is what a GPU does best. Each cell's two triangles, at density flux/area, can be drawn with additive blending into a float render target the size of the bins (WebGL 1 with `OES_texture_float` and `WEBGL_color_buffer_float`, or WebGPU), and the receiver's texture (item 3's too) read straight from that target with no transfer. Go would still trace the rays and send each cell's crossings and flux as a typed array.

**What it costs, and what needs deciding:**

- **The boundary.** `AGENTS.md` puts numerical algorithms in Go and computation in the worker. A GPU rasterizer would move part of the receiver's mathematics into a shader (an `OffscreenCanvas` keeps it in the worker). That needs explicit direction.
- **Exactness.** The Go rasterizer gives each bin the exact area of every triangle inside it. A GPU samples coverage at points, so matching it needs supersampling or analytic coverage in the fragment shader (clipping each triangle to the pixel's square, with conservatively enlarged triangles), and half floats are too coarse to accumulate in. Results would differ by device and driver, so they cannot be bit for bit identical.
- **Accounting.** The note's received and outside shares come from the bins. Reading a float target back each frame stalls the GPU, so either Go keeps the accounting (clipping each triangle to the window without binning it) or the note is drawn only from still results.
- **Cheaper first.** Before the GPU, profile rebuilding the sampled surface, caustic sheets and diagnostics: when only the plane moves (tilt, position or size tracks) they are unchanged. A coarser receiver while playing (fewer levels, restored at rest) is another option, though it changes what plays.
- **Scope.** A reasonable first form is a playback-only preview: frames during playback drawn on the GPU, while stills, exports, readouts and tests keep the exact Go bins. Measure first whether the GPU half alone (a third of a frame) is worth it, since ray tracing and transfer remain.

**Tests, if adopted:** the GPU bins against the Go bins within a stated tolerance on the existing receiver studies (uniform beam, point source, focus, dome); additivity and total received flux; fallback to the Go bins where float targets are missing; and frame timing on a phone.

## Pending on-device checks

No device check was possible for these. Ask the user to look on a phone:

- Manual perspective presets.
- 2D and 4D loop presets in motion.
- The probe while parameters vary, including the 3D surface probe's **Stays at its u and v** (#123).
- See-through sheets on a phone (the Klein bottle and the torus's tunnel): since #137 they are sampled 2 × 2 only when the device's limits allow, and a large high-DPR canvas falls back to one sample.
- The 3D surface probe's **At any u and v, between samples** checkbox and its free **Along u** and **Along v** sliders at phone width, and **Through an ellipsoid's umbilic** in motion on a phone.
- The same checkbox on a mirror's light at phone width, and **Where a tilted dish focuses sharply** in motion on a phone.
- The same checkbox on a canal and a ruled surface (**At any t and θ − θ₀**, **At any t and u**) at phone width, and **Round a hyperboloid's throat** in motion on a phone.
- The 2D probe, refinement and line-weight controls at phone width, including the probe's **At any t, between samples** checkbox and its continuous slider.
- **Frame the points between samples** in 3D at phone width, and **A dandelion clock** in motion on a phone.
- The camera path's key views at phone width: **Move up** and **Move down**, and long names wrapping in their fields.
- Dashes on the page (**A coiled tube running into the distance**) on a phone GPU while orbiting: even dash lengths near and far, and the **Dashes** control beside **Opacity α** at phone width.
- Refinement to the view in 3D: pinching to 1,000× about the fingers on **A spring folded into a cusp**, and the **Refine to the view as you zoom** control at phone width.
- A 3D flight refined in pieces on a phone: **Wheels within wheels** playing in time, without stalls where a piece is still being refined (each refines the whole study, so a slow phone may wait at a piece's start).
- The **Shadow on a plane** panel at phone width (its select, **Plane at c** beside it, its layer checkboxes and note), and **A staircase's shadow, unwinding** in motion on a phone.
- The face-on views beside the drawing (**Face-on views beside the drawing**) on a phone: the stacked cells, dragging and pinching a face-on view with **Adjust view** on, the grid fitting the screen held sideways during playback, and **A tilting circle's cardioid, face on** and **A rippling rose's mirror images, face on** in motion; also the checkbox's help toggle at phone width, and a captioned video saved on the phone.
- The receiver's **Tilt (°)** beside **Bins** at phone width, and **Conic sections cut from a cone of light** in motion on a phone.
- The receiver's **Refinement levels** at phone width.
- The mirror's **Locate cuspidal edges** checkbox and its help toggle at phone width, and **An astigmatic dish's folded caustics** in motion on a phone.
- Playback at 60 frames a second (`web/playback.ts`) on a 120 Hz display and on a slower phone, watching for an even fall to 30 where frames come late. The thresholds (a request 1.4 intervals after the last is late, two late in ten fall back, a 2 s hold doubling to 16 s) are first choices, to tune from what is seen.

Line weights in 3D were checked locally and on a phone on 2026-10-04, the 3D probe between samples (its checkbox and continuous slider) on 2026-10-06, and the surface probe's **Describe → The offset** with **An ellipsoid's parallel surface** in motion on 2026-10-06, and **Describe → Focal sheet 1** and **Focal sheet 2** with **A spheroid's evolute, spun about its axis** and **The curvature of an ellipsoid's focal sheet** on 2026-10-07. Playback at 60 frames a second was checked on an iPhone on 2026-10-13. Zooming toward a detail through a lens (**A corridor of loops**, wheel and pinch) was checked locally and on a phone on 2026-10-14. **Fit each frame to the views** and **A seashell growing on its spiral** were checked on a phone on 2026-10-19. A refined receiver (**Conic sections cut from a cone of light**, zoomed in) was checked on an iPhone 16 Pro Max on 2026-10-21: smooth light at 480 bins refined twice, and 0.4–0.5 s between frames in playback at 960 bins refined three times (see item 4).

## Conditional and declined

- **Geometry export** (3D; possibly 4D curves). Curves and meshes in a documented interoperable format, with units, normals, branch boundaries and source metadata. The file must warn that ribbons can be open, singular, self-intersecting and nonmanifold. Choose a format only when a real downstream use is chosen. 2D and 4D drawings already export true vector SVG.
- **Saved study files:** declined on 2026-09-30. Portable links suffice.
- **Out of scope:** lighting and material editors, imported scenes, collisions, path tracing, and a backend.

## Accepted limits, not planned

Revisit these only if a study needs them:

- In 2D only parameter tracks loop. In 4D a drift, support, route or latitude sweep cannot loop.
- The SVG loop check falls back to a raster threshold of 10⁻⁴ of pixels, not a proof of identity.
- A 3D closed curve run on by less than a period is refused for a loop even when its shape returns.
- 3D surface, mirror and implicit studies use uniform grids, though a receiver can split its cells where their light lands coarsely. An offset's cuspidal edges, a focal sheet's over the patch's ridges, and a caustic's can be located. The mirror and refraction studies have one interaction and no occlusion, and a receiver turns about one of its own axes only.
- The 2D hairline is one CSS pixel (two device pixels on dense screens).
