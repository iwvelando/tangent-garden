# Four-dimensional mathematical art expansion roadmap

This roadmap proposes ways to extend Tangent Garden's tesseract notebook using geometric questions inspired by _Death's End_. It is a plan, not an implementation or a claim about physical four-dimensional space. All unchecked items are future work. An implementing agent should read `AGENTS.md`, [README.md](../README.md), [mathematics.md](mathematics.md), [architecture.md](architecture.md), and [tesseracts.md](tesseracts.md), then implement one bounded pass and update its handoff here.

The source of the literary inspiration is [the supplied scene summaries](4d_descriptions_sanitized.md). References below use that document's numbered sections. Those summaries distinguish scenes from modeling suggestions; this roadmap evaluates the suggestions independently. It does not establish the novel's exact wording or resolve uncertainties in its transcription. Suggested webpage descriptions below are original paraphrases, not quotations from the book.

## Product goal

Make an extra spatial coordinate understandable through curves, sections, and the lines that construct them. A connected thread can disappear from a slice without being broken. An enclosure can block every route within three dimensions while leaving a route in four. A sequence of familiar rings can be sections of one unfamiliar solid. These are strong continuations of the notebook's existing mathematical art.

Favor a few legible, reproducible studies over a recreation of the ships, bodies, or environments in the novel. Keep the existing 4D notebook, its orbitable 3D drawing, and local Go/WASM computation. No scene editor, imported assets, anatomy, spacecraft simulator, physical material model, backend, or remote computation is required.

The first milestone should answer three questions visibly: **What is the object? What operation produces this drawing? Which information has that operation discarded?** Narrative copy should help answer them, not substitute for a mathematical definition.

## Baseline and boundaries

The current implementation is a specific and useful starting point:

- [x] `engine4/tesseract.go` constructs the fixed cube `[-1,1]^4`, with six ordered plane rotations, orthographic and perspective projections, exact polyhedral sections at `w = h`, and stereographic curves from radially normalized face grids.
- [x] The result contains 3D paths, illustrative faces, isolated points, section diagnostics, and a framing radius. The section family overlays xyz coordinates without translating the sections or connecting them into a surface.
- [x] `web/tesseract` supplies SVG drawing, independent layers, an ordinary 3D camera, three motion choices, and shared playback/export sampling. The numerical queue allows one active calculation and one replaceable pending request.
- [x] SVG export is vector; PNG and MP4/WebP use the vector drawing at the target resolution. The notebook preserves its definition and manual camera when switching dimensions.

These checkmarks describe inspected source, not checks rerun for this roadmap or a deployment claim. Read [the current mathematical limits](tesseracts.md#mathematics-and-numerical-limits) before changing those contracts.

Before pass 1, the request had no object discriminator: its modes all assume a tesseract. `Result.sections` carries polyhedral vertex/edge/face counts; `Path.family` carries coordinate-direction or cell-axis color identity. Neither is a general curved-object contract. The current slice animation is hard-coded to `[-2.05,2.05]`, and its perspective distance and framing formulas assume circumradius 2. These assumptions must be addressed when the first new object arrives.

The renderer draws transparent mathematical constructions. Average-depth ordering of illustrative faces does not implement opaque visibility, much less a four-dimensional observer. The spatial notebook has a bounded implicit-surface mesher and section machinery, but those operate on three spatial coordinates. They offer reusable numerical techniques, not an existing general 4D engine.

## Separate the mathematical operations

Use these terms consistently in controls, descriptions, diagnostics, and export metadata.

| Operation                     | Mathematical meaning                                               | What the drawing may claim                                                      |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Section                       | Intersect an object with a declared hyperplane, initially `w = h`. | The part occupying that slice; components may appear, split, or disappear.      |
| Projection                    | Map 4D coordinates to 3D, then draw that 3D image on the screen.   | A shadow with information lost; overlapping marks need not be touching objects. |
| Section family                | Sample finitely many hyperplanes.                                  | Selected sections of one object, with their offsets identified.                 |
| Extra-coordinate path         | Follow a curve in `R^4`, checking it against a declared obstacle.  | A route that can leave the reference slice and return.                          |
| Lifted embedding              | Replace `(p,0)` with `(p,H(p))`, for `p` in `R^3`.                 | A connected geometric object whose intersection with `w = 0` changes.           |
| Illustrative detail selection | Show or hide selected curves already present in the model.         | A way to read the construction; not a simulation of eyesight or cognition.      |

A four-dimensional **solid** has an interior in `R^4`; its boundary is generally three-dimensional. A 4-ball's ordinary section is a 3-ball; the surface we draw around that section is a 2-sphere. A Clifford torus is a two-dimensional surface embedded in `R^4`, not a four-dimensional solid. Keep these distinctions explicit even when all three produce attractive rings on the screen.

An idealized 4D projection produces a three-dimensional image that still has to be represented on a two-dimensional display. Turning off depth occlusion does not solve that information loss or model the novel's human perception. Hollasch's [four-space visualization thesis](https://hollasch.github.io/ray4/Four-Space_Visualization_of_4D_Objects.html) is a useful reference for separating 4D projection from the subsequent display of its 3D image; its raytracing approach is outside this roadmap's scope.

## Selection of ideas from the book

| Inspiration in the supplied summaries                                          | Proposed treatment                                                                                     | Priority                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Missing pipe sections, a thread remaining connected, a drifting bubble (§§1–3) | A localized lift of analytic threads; show the reference slice and an optional explanatory projection. | Core, pass 2                                   |
| Access to the inside of an intact enclosure (§§4, 12, 15)                      | An explicit path around an embedded 3D shell, with clearance verified in 4D.                           | Core, pass 3                                   |
| Countless layers and the ring's sense of containment (§§10, 18)                | Finite section families through a precisely defined 4D ring solid.                                     | Core, pass 1                                   |
| A new direction available at every point (§14)                                 | Representative coordinate fibers and linked coordinate readouts, as aids to passes 2–3.                | Supporting construction                        |
| Instruments missing one coordinate (§17)                                       | Two positions with the same 3D shadow but different 4D separation.                                     | Small addition to pass 3                       |
| Interwoven or nested rings (§18 modeling notes)                                | Clifford tori and selected Hopf fibers on `S^3`, with stereographic projection.                        | Optional mathematical art, pass 4              |
| Interiors visible all at once; adaptation to frames (§§9–11, 13)               | Finite chosen layers with a sparse default. Explain the analogy; do not promise complete perception.   | Copy and layer design, not a rendering project |
| Refracting warped points seen from inside (§16)                                | No implementation proposed. A conventional 3D lens would model another phenomenon.                     | Excluded                                       |
| Abrupt size jumps, decay into luminous lines, compactification (§§7–8, 17)     | Retain only as literary context if useful; no physical mechanism follows from the available geometry.  | Excluded                                       |

## Recommended implementation passes

- [x] **1. Curved sections:** introduce the minimal object/view distinction, then ship a 4-ball calibration and a circular 4D tube together with finite section families.
- [x] **2. A thread missing from a slice:** one localized lift, analytic clipping, connected source identities, and drift/shrink animation.
- [ ] **3. A route beside the wall:** an embedded shell, a verified path along the fourth coordinate, and the small hidden-coordinate comparison.
- [ ] **4. Spherical ring weaves:** optional Clifford-torus and Hopf-fiber studies using explicit curved-source projection and clipping.
- [ ] **5. General implicit 4D sections:** a separate, conditional numerical project only if the analytic studies expose a concrete need.

Passes 1–3 are the recommended scope. Pass 4 is a strong art-oriented continuation but is not needed to explain the bubble or entry into an extra dimension. Pass 5 is not a prerequisite for any earlier pass.

| Work to group                                                                            | Reason                                                                                                                                                   | Work to keep separate                                                                           |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Pass 1's 4-ball, ring solid, section families, and minimal schema change                 | They share closed-form section radii, degeneracy handling, and the same drawing controls. The ball supplies a simple oracle for the ring implementation. | Arbitrary 4D fields, general rotations of the ring's slicing frame, and a mesh renderer.        |
| Pass 2's lift, reference slice, explanatory projection, and time-dependent center/radius | These are different views and parameters of the same embedding. Shipping disappearance alone would hide the mathematical explanation.                    | Filled spherical cut surfaces, multiple overlapping bubbles, physical flow, or optical effects. |
| Pass 3's bypass path and hidden-coordinate example                                       | Both need stable point identities, a `w` readout, and two representations of one path.                                                                   | Four-dimensional camera navigation, collision simulation, or a general obstacle editor.         |
| Pass 4's Clifford tori and Hopf fibers                                                   | They share parameterized curves on `S^3` and a new curved-source pole-clipping contract.                                                                 | General polytope catalogs or opaque 4D visibility.                                              |

Do not make one implementation pass out of all five. Pass 1 should include the small supporting refactor, not precede it with a speculative framework-only rewrite. Passes 2 and 3 can be developed independently after that contract is established. Pass 4 depends on the projection work and clipping tests it actually uses, not on the bubble or shell. Each pass includes its own controls, animation, exports, presets, documentation, and acceptance checks.

## Pass 1: curved sections and a ring with depth

### Objects and exact sections

Start with the centered 4-ball

`B_R = {(x,y,z,w) : x² + y² + z² + w² ≤ R²}`, with `R > 0`.

At `w = h` it is a 3-ball of radius `sqrt(R² − h²)` when `|h| < R`, a single point when `|h| = R`, and empty when `|h| > R`. Draw representative circles on its boundary, not a claim to draw every point of its interior. A sphere's 4D rotational symmetry makes rotation controls uninformative here; hide them for this object.

For the ring, choose a specific tubular neighborhood of a circle in `R^4`:

`T_(R,r) = {(x,y,z,w) : (sqrt(x²+y²) − R)² + z² + w² ≤ r²}`, with `0 < r < R`.

This is a four-dimensional solid with topology `S¹ × B³`, whose boundary has topology `S¹ × S²`. Call it **Circular 4D tube** in technical controls; a preset may have a more evocative title. It is one possible mathematical ring, not an identification of the novel's artifact. Avoid using “ditorus,” “spherinder torus,” and “duocylinder” interchangeably: their definitions are not equivalent.

The section at `w = h` is the ordinary solid torus

`(sqrt(x²+y²) − R)² + z² ≤ ρ(h)²`, where `ρ(h) = sqrt(r² − h²)`.

For `|h| < r`, sample the boundary with

`p(u,v) = ((R + ρ cos v) cos u, (R + ρ cos v) sin u, ρ sin v)`.

Representative fixed-u and fixed-v curves make the construction visible. At `|h| = r` the entire section collapses to the core circle, not a point or a zero-area mesh. Outside that interval it is empty. Keep `r < R` in this first pass so spindle and horn degeneracies are not silently introduced.

The initial curved-object capability is **axis-aligned sections**. An arbitrary 4D rotation of the ring followed by `w = h` does not obey this torus formula. Disable that unsupported combination rather than rotating the final 3D torus and calling it the corresponding 4D section. An ordinary 3D viewing orbit remains available. A later tilted-section evaluator belongs with pass 5 or its own analytic derivation.

### Drawing and controls

Offer one section and a bounded family, with `h`, spread, count, and the object's radii. Overlay sections in their original xyz coordinates, matching the current tesseract family convention. Identify the selected section and its `h`; coincident sections at `+h` and `−h` may be visually coincident but must retain separate identities. Do not infer a unique fourth-coordinate position from the shared outline.

Default to sparse linework. A family is a finite selection of sections, not every cross-section at once. If an atlas of separate small views is later useful, give every tile its offset and common scale; translated tiles are a layout, not positions in 4D. An atlas is optional polish, not a blocker for this pass.

Use a fixed radius `R` for the 4-ball's sections and `R+r` for the tube's sections. Slice passage spans just beyond the relevant support (`±R` or `±r`) with a documented relative margin, ensuring valid empty endpoints. These replace the tesseract-specific passage endpoints for these objects. Animate `h` first; radius tracks can follow only if their endpoint interpolation preserves `0 < r < R` throughout.

**Acceptance:** check every generated point against its analytic section equation; the ball's radii at the center, an intermediate level, tangency, and outside; the ring's fixed core radius and shrinking tube radius; coincident geometry at opposite offsets; correct point/circle/empty classifications; and circumference/chord convergence as samples increase. Distinguish “section dimension” from the dimension of the boundary curves used to illustrate it. Existing tesseract polyhedral counts must remain correct and must not appear as fake counts for these curved sections.

Independent measurements can check the section volumes `4π(R²−h²)^(3/2)/3` and `2π²R(r²−h²)` inside their respective supports. Integrating the first over `h` gives the 4-ball volume `π²R⁴/2`; integrating the second gives `8π²Rr³/3`, the circle length times the normal 3-ball volume. These are numerical oracles, not required UI readouts.

**Suggested preset copy — A ring in passing:** “Each outline is a section of one four-dimensional tube. As the slice moves, the tube narrows to its central circle and disappears. The drawing samples its depth; it does not show an infinity of layers.”

## Pass 2: a connected thread with a missing middle

The most useful bubble scene is the pipe or taut thread whose middle disappears while its ends remain connected (§1). Use a small fixed arrangement of straight threads and a circular or helical strand. The mathematical object and its changing visible intervals are sufficient; rendering a cabin would add little to the explanation.

### A declared embedding, not a physical theory

Let `p = (x,y,z)` and define a localized lift with center `c`, support radius `L > 0`, and height `A ≥ 0`:

`s = |p−c|/L`

`H(p) = A(1−s²)²` for `s < 1`, and `H(p) = 0` otherwise.

This is a continuously differentiable compactly supported bump. An ordinary object `O` becomes the slab

`O_H = {(p,w) : p ∈ O and |w−H(p)| ≤ ε}`, with fixed `ε > 0`.

For an object described by `G(p) ≤ 0`, a membership field is

`F(p,w) = max(G(p), |w−H(p)|−ε)`.

This field defines the set; it is not generally an exact signed distance function. Do not feed it into a distance-based ray marcher as if it were one. The first implementation needs only representative curves and their membership, not a volume grid.

At the reference slice `w = 0`, a point is present exactly when `H(p) ≤ ε`. If `A > ε`, the missing region has radius

`r_missing = L sqrt(1 − sqrt(ε/A))`.

If `A ≤ ε`, nothing is missing. Thus the support radius of the bump is not the apparent bubble radius. Name these quantities correctly; report the derived missing radius instead of labeling `L` as the hole size. Keep ε as a documented modeling thickness in the first pass rather than an unexplained extra visual slider.

For a source curve `C(t)`, the lifted centerline `(C(t), H(C(t)))` remains connected whenever `C` is connected. The reference drawing represents the slab's intersection with `w = 0`, not the intersection of that zero-thickness centerline: the slab can still meet the slice when the centerline is up to ε away. A missing interval in that drawing does not sever the lifted curve. The deformation generally changes lengths: it demonstrates connectivity, not preserved tension, fluid dynamics, bodily survival, or the physical mechanism in the novel.

### Rendering and motion

Provide **Reference slice** and **Lifted construction** views of the same source identities. The first draws only present intervals at `w = 0`. The second projects the entire lifted centerline and optionally draws representative connectors `(p,0) → (p,H(p))`. Those connectors explain displacement; they are not material threads or light rays.

An orthographic projection dropping `w` makes the lifted centerline look undeformed. Use a declared xw rotation in the explanatory projection, or a separate coordinate diagram, so its extra-coordinate displacement can be read. Keep that presentation transform out of the reference-slice computation. This is a mathematical explanation the book's 3D observers do not have, and the label must say so. The reference slice must not become a window showing the hidden material.

The region itself can be invisible by default, with an optional **Missing-region guide** showing sparse circles on its boundary. These are construction guides. There is no simulated mercury surface, reflection, or refraction. A cylindrical wire cage intersecting a very large sphere can illustrate a nearly planar cut (§3), but is an optional preset of the same clipping operation.

Clip source intervals before drawing. A straight segment versus the missing sphere has quadratic intersection roots; two crossings can occur between samples even when both endpoints are visible. Preserve tangencies and exact crossing points. Curved sources require either analytically solved intersections or bounded root isolation with an explicit unresolved-interval policy. Begin with straight threads if a curved source cannot meet that contract. Never bridge an invisible interval just because its sampled endpoints are present.

Animate the center or support radius from explicit endpoints, with `A` and ε held fixed initially. A moving marker may follow a source thread, disappear while its reference-slice position is absent, and remain visible in the explanatory projection. This conveys continuity without simulating flow. Keep the same underlying parameter and progress in both views. A future nonzero slice `w = h` must use `|h−H(p)| ≤ ε`, which can select radial bands rather than the complement of one ball; do not reuse the reference-slice sphere clipping for it.

**Acceptance:** verify the derived missing radius, the unchanged exterior, the `A ≤ ε` case, and membership residuals at every clipped endpoint. Check a segment crossing twice between samples, tangency, a segment wholly absent, and drift across an endpoint. At a large sphere boundary, compare the departure from its tangent plane against the expected quadratic scale of local distance divided by sphere radius. Source identities must show one connected lifted thread while its visible intervals are separate; apparent screen crossings must not become new connectivity. Reverse the animation and recover the same geometry at matching parameter values.

**Suggested preset copy — The missing middle:** “The middle of each thread has left the reference slice. In the lifted construction it is still attached to both ends. Moving the boundary changes what appears, without cutting the underlying curve.”

## Pass 3: a route beside the wall

The exposure of protected interiors (§§4, 12, 15) has a clean geometric counterpart. A shell that encloses a region in `R^3` need not enclose it in `R^4`.

### Explicit obstacle and route

Use the embedded spherical shell

`K = {(p,w) : a ≤ |p| ≤ b, |w| ≤ ε}`, with `0 < a < b` and `ε ≥ 0`.

Here ε is the shell's extent along the fourth coordinate, not a claim about real material thickness. Starting at `(p_out,0)` with `|p_out| > b`, define the three-leg path

`(p_out,0) → (p_out,H) → (0,H) → (0,0)`, with `H > ε`.

The first leg stays outside the shell in xyz, the second passes above it in w, and the third returns inside its cavity. Each segment avoids `K`. For `H ≤ ε`, the middle leg crosses the shell: report the intersection rather than drawing the route as valid. Sample each linear leg by a declared fraction of the overall progress, retain the corners, and mark the moving point.

Contrast this with a genuinely four-dimensional shell

`K4 = {q ∈ R^4 : a ≤ |q| ≤ b}`.

A continuous path from `|q| > b` to the origin cannot avoid `K4`, because its radial distance must pass through `[a,b]`. A simple radial test supplies the contrast; a general collision engine or opaque rendering of `K4` is unnecessary. A wireframe alone does not establish containment, so keep the defining inequality in the explanation.

### What the user sees

Show the xyz shadow of the path and a companion `(radial position, w)` diagram, or offer a linked view toggle on narrow screens. Label the latter as a coordinate diagram, not a second 3D camera. The path's shadow can appear to pass through the shell while the 4D path has positive clearance. Display the current `w` and intersection state; use line style and text as well as color.

Add the related ambiguity example without building navigation mechanics: `q1 = (p,w1)` and `q2 = (p,w2)` have the same orthographic xyz image but are `|w1−w2|` apart in `R^4`. Toggle the coordinate readout to expose the missing information. This demonstrates an underdetermined distance measurement, not a sudden physical jump in apparent size.

This pass can also show a few short coordinate fibers through representative points: `{(p,w) : w ∈ [w0,w1]}`. They explain the extra direction available at each point. They are neither duplicated universes nor evidence that a recursive cube drawing literally contains infinite depth.

**Acceptance:** test obstacle membership over complete segments, not just sample points; verify the valid route's clearance, the invalid low-H route, boundary contact, reversed traversal, and the radial obstruction for `K4`. Apply a common 4D rigid motion to the route and obstacle and retain the same intersection result. Check `sqrt(|Δp|²+Δw²)` independently of both display projections. A reveal must stop at the same path parameter in every representation.

**Suggested preset copy — Beside the wall:** “This wall encloses the center within its three-dimensional slice. The path leaves that slice, travels beside the wall along a fourth coordinate, and returns inside. Its shadow crosses the wall; the path itself does not.”

## Pass 4: optional spherical ring weaves

This is the closest continuation of the existing stereographic tesseract drawing, and a better mathematical use of the layered-ring imagery than an unspecified ‘4D ring’ mesh.

On the unit 3-sphere, use

`q(u,v,α) = (cos α cos u, cos α sin u, sin α cos v, sin α sin v)`.

For `0 < α < π/2`, varying `(u,v)` traces a Clifford torus. At the endpoints it collapses to one circle. A finite selection of α values illustrates a family of tori on `S^3`; selected constant-u and constant-v curves expose its construction.

For Hopf fibers, identify `z1 = x+iy`, `z2 = z+iw`, and use the circles

`q(t) = (e^(it) z1, e^(it) z2)`, where `|z1|²+|z2|² = 1`.

One explicit convention for the Hopf map is

`H(z1,z2) = (2 Re(z1 conjugate(z2)), 2 Im(z1 conjugate(z2)), |z1|²−|z2|²)`.

It lies on `S²` and is constant on each fiber. Fixed α and phase difference `u−v` choose a fiber; incrementing both phases traces it. Select a bounded deterministic set, retaining stable identities. These formulas are the implementation convention; [an elementary introduction to the Hopf fibration](https://arxiv.org/abs/2212.01642) provides mathematical background. Neither Clifford tori nor individual fibers are sealed 4D solids.

Project with the existing convention `P(q) = q_xyz/(1−q_w)`, but implement clipping for the new source family. For a window radius `C`, the retained part of a unit-sphere curve obeys `q_w ≤ (C²−1)/(C²+1)`. Along these circles, including after 4D rotation, `q_w(t)` is a constant plus sine and cosine terms; isolate all window crossings analytically before sampling. The current tesseract code solves a different problem along radially normalized straight segments. Its clipping routine cannot simply be applied to chords between samples of these curves.

Animate a 4D rotation or α, keeping the stereographic window fixed. Treat pole crossings, clipped intervals, collapsed endpoint circles, and duplicate endpoint fibers explicitly. Do not fill clipped gaps, join distinct fibers, or interpret screen crossings as spatial intersections.

**Acceptance:** check unit norm, the Hopf-map unit norm and invariance along each fiber, inverse stereographic identities, and circle/line geometry of projected fibers. Test a pole between samples, a window tangency, endpoint degeneracy, and chord convergence on retained arcs. Verify linking for a pair of complete finite projected fibers using an independent construction or convergent linking-number calculation; do not infer it from a screenshot. Clipped arcs do not themselves have the linking number of the complete circles.

**Suggested preset copy — Rings from a sphere:** “These curves lie on a sphere in four dimensions. Stereographic projection turns them into a weave of circles and open arcs. Open ends mark the drawing's finite window, not broken connections.”

## Pass 5: general implicit sections, only when needed

Analytic studies should establish whether users need arbitrary fields or tilted sections. If they do, specify `F(x,y,z,w;a) ≤ 0` as a solid and evaluate its boundary on a declared slice. Initially substitute `w = h` and mesh the three-variable zero set. There is no need to allocate a four-dimensional voxel grid merely to draw one three-dimensional section.

A later arbitrary slice has an origin `o` and orthonormal frame `B ∈ R^(4×3)`, so its field is `F(o+Bξ;a)`. State whether rotations act on the object or on this frame, and test their inverse relationship. Normals in the slice derive from `Bᵀ∇F`, which can vanish even at a regular point of the original hypersurface. Tangent sections may be points or curves and must not silently disappear just because a triangle mesher only detects sign-changing surfaces.

This requires a separately bounded parser binding for x, y, z, w, and a, not string substitution, executable user code, or pretending w is time. Scalar fields must still reject all variables. Reuse the spatial mesher only through a suitable Go evaluator boundary after auditing its assumptions; do not make `engine4` depend on the spatial UI or route fake spatial requests through the browser.

Before building controls, prototype the ball, ring, rotated ring, a disconnected section, a tangent section, a pole, and an undefined region. Measure Go and WASM evaluation cost, serialized size, browser memory, and cancellation latency. Declare ambiguity, nonfinite, open-boundary, and unresolved-feature diagnostics. Document what resolution cannot certify. Meshes and optional shading would introduce a new drawing/export path and therefore belong in this separate pass.

**Go/no-go:** proceed only after a prototype shows a useful study that the earlier analytic evaluators cannot express, bounded cost on a phone-sized device, and honest handling of missed tangencies and topology. Otherwise leave the pass unchecked; a catalog of exact constructions is a valid product.

## Architecture, controls, and numerical budgets

Use `typed object → declared section/projection/path construction → typed geometry and diagnostics → drawing`. Keep object choice independent of view operation, but publish only supported combinations. A capability table should decide controls and animation options; adding an object must not accidentally enable every tesseract mode.

The first pass should extend Go and TypeScript request/result types together and preserve existing tesseract behavior. `cmd/wasm` remains transport; update the existing worker/client boundary rather than introducing another computation service. Whether the tesseract-named bridge and directory are renamed is an implementation choice, not a prerequisite. If renamed, handle all call sites and tests in the same pass.

Return stable source, section, and branch identities; distinguish base paths, section curves, displacement guides, and motion paths. Add object-appropriate diagnostics rather than forcing smooth objects into polyhedral counts or coordinate-axis colors. Empty, tangent, collapsed, clipped, invalid, and budget-exhausted are different outcomes. Define absolute-plus-relative tolerances from the supported study scale and test their threshold behavior; the unit tesseract's fixed tolerances are not automatically appropriate for arbitrary radii.

Keep rotations, field evaluation, intersections, membership, and clipping in Go. TypeScript may interpolate authorized scalar inputs and operate the final 3D camera; it must not reconstruct missing geometry or independently classify intersections. Preserve radians and the existing ordered plane-rotation convention. A 3D camera orbit, a 4D object rotation, a slice passage, and a moving lift are four different operations.

For a centered source contained in a 4D sphere of radius `B`, perspective requires an eye distance `d > B` with an explicit safety margin; its projected radius can use `Bd/sqrt(d²−B²)`. Translated or lifted sources require a valid bound in the actual eye coordinates. Do not retain the tesseract's minimum distance 2.05 after enlarging the source. A projection denominator approaching zero is a domain/clipping event, never a request for automatic camera zoom to hide the problem.

Use the existing fixed framing where possible, calculated over the animation's allowed parameters so the drawing does not breathe. Keep projected and section families independently bounded before combining them. A companion diagram needs its own labeled axes and scale; spatial geometry retains equal axis scale. Do not import the 2D/3D notebooks' four camera modes as though the current tesseract notebook already had them.

Suggested initial ceilings for the analytic passes are **25 sections, 512 source curves, 65,536 emitted points, and 262,144 evaluator/root-refinement operations per result**, with one shared budget across a family and every companion view. These are conservative design starting points, not measured performance promises. Reject an over-budget request with a specific error; do not silently omit late sections or convert unresolved intervals into continuous paths. Bound refinement depth and event counts as well as emitted points. Set final scalar ranges, tolerance values, and count limits using the analytic tests and measured WASM costs before each pass ships, and record them in permanent documentation.

All geometric scalar fields use `ScalarInput`, including radii, lift height, center coordinates, slice offset, and path height. Only whole-number counts and animation settings remain numeric. Functional updates must apply resolved scalars to the latest state; presets invalidate old evaluations. Keep paired fields in `.pair`/`Field` layouts so help and errors cannot displace a neighbor. On phones, prefer a linked view toggle to two unreadably small drawings.

Animation must sample immutable input definitions and recompute geometry, retaining exact endpoints and bounded in-flight work. Pause, Stop, edits, preset changes, and notebook changes invalidate pending results. A shared progress value synchronizes every view; playback time is not an extra spatial coordinate. Geometry must not be blended across appearance events, poles, or intersections. Stop restores the base definition and manual camera.

Retain one shared live/export drawing and numerical sampler. Export metadata should identify the object, operation, parameters, finite section levels, projection convention, diagnostic limitations, and camera. If a selected explanatory diagram is included live, define and test its export composition as well. Vector line studies should retain true vector SVG output. If pass 5 later adds raster shading, identify embedded raster content honestly. Preserve media duration independently of render speed, actual target-resolution rendering, frame and memory caps, and canceled-output suppression.

## Suggestions intentionally not adopted

- **A bubble as a conventional lens.** The summary distinguishes invisibility in 3D from optical distortion in 4D. A 3D refractive sphere does not implement that distinction. There is no specified 4D optical interface or observer model to justify extending the existing spatial Snell-law engine.
- **An unoccluded drawing as literal higher-dimensional vision.** An exactly embedded lower-dimensional object can be approached from an extra direction, but a flat display of finite curves cannot show every interior point distinctly. Sparse/dense layers may explain selected structure; they do not simulate the brain's adaptation or make a physically faithful 4D retina.
- **Abrupt size jumps caused merely by a hidden coordinate.** A smooth path under a regular perspective projection changes continuously. Poles, occlusion, or deliberately discontinuous observations require separate definitions. Do not script jumps and present them as a consequence of four dimensions.
- **Four-dimensional volume flattening into a luminous line.** A volume-preserving linear map remains full-rank while its determinant is nonzero. Compressing w while stretching x does not by itself remove y and z, and taking a zero-width limit with fixed volume introduces unbounded extent. It supplies neither the novel's finite filament nor its decay, radiation, dust, or colors. No decay pass is proposed.
- **Shrinking a compact circle as an explanation of that decay.** `R³ × S¹` with a varying circle radius is a different geometric model from the present Euclidean `R⁴` studies. It does not derive a matter-decay mechanism. It would need its own product purpose and definitions.
- **Signal falloff, astronomical scales, and inferred physics.** Ideal isotropic flux in an unbounded n-dimensional Euclidean space spreads across `(n−1)`-dimensional spheres, but that alone says nothing about coupling between dimensions or a ship's radio. Signal transport, physical collapse rates, and the novel's large distance estimates do not become simulation parameters here.

Additional regular polytopes are compatible with the existing notebook, but are not the best response to these particular experiences. Add them only as their own small geometric study when there is a reason beyond increasing the shape menu.

## Completion gate and handoff

Each pass ships a complete study: definition, bounded Go evaluation, synchronized transport, controls, explanatory construction geometry, at least one curated preset, animation, matching exports, and permanent usage/mathematics documentation. Update README feature claims only when implemented. Run `make thumbnails` and commit the affected `web/examples/` artifacts whenever presets or their fingerprints change. Tests choose presets through `choosePreset`.

Verification must include analytic identities and independent invariants, degenerate and invalid inputs, and convergence whenever curves or surfaces are approximated. Test the real WASM contract. Run `make check` and `make test-browser`; include relevant WebKit checks for drawing/encoding changes. Inspect light and dark themes, desktop and narrow layouts, all paired help/error states, scalar expressions, custom counts, sidebar scrolling, theme persistence, and storage denial. Preserve all three existing notebooks and their edited studies.

Exercise endpoints, pause/resume, scrubbing, reversal where offered, cancellation, empty frames, and camera restoration. Independently decode actual exported files to check dimensions, duration, endpoints, representative interior frames, and visual parity. Tests should catch a vanished interval accidentally rejoined, a wrong slice radius, or a route falsely reported clear; a matching screenshot is insufficient.

Record total work and memory for the largest supported study, not just one curve. Keep generated build/cache files out of version control. No new runtime dependency or resource kind is expected for passes 1–4; any change to that assumption requires the repository's dependency notices and corresponding CSP/deployment-policy work. This document authorizes no merge, deployment, or publication.

At the end of a pass, append a handoff containing:

- The completed pass and supported object/operation combinations.
- Permanent documentation paths, formulas, tolerance rules, source identities, and diagnostics.
- Actual validation commands and results, including skipped or unavailable checks.
- Measured native/WASM/browser work and memory limits, and export verification.
- Remaining limitations and the next bounded step; explain any regrouping of passes.

### Planning handoff (before implementation)

The original planning handoff preceded implementation; the completed Pass 1 is recorded below. The existing tesseract source, its documentation, the spatial roadmap, and the supplied literary summaries informed the baseline and boundaries. The recommended first implementation is pass 1: exact curved sections with a ball as the calibration case and a circular 4D tube as the first new art study. The bubble and bypass studies then add distinct mathematical experiences without requiring fictional physics or a general scene renderer.

Documentation validation checked relative file links and independently spot-checked the ring-section equation, missing-radius formula, integrated section volumes, and Hopf-map identities. Application tests were not run for this document-only change; those checks do not establish an implementation's correctness or performance.

### Pass 1 handoff — curved sections (2026-09-29)

Implemented exact axis-aligned 4-ball and circular 4D tube sections, including empty, point, core-circle and solid outcomes. Go owns geometry, tolerances and shared curve/point budgets. Curved paths retain source/section/branch identities; tesseract indices remain rendering keys. See [the permanent curved-section guide](tesseracts.md#exact-curved-sections) for formulas, bounds, controls and measured costs.

Object descriptors own capabilities, defaults, support, explanations, diagnostics and export descriptions. Object switching restores last valid definitions and invalidates outstanding scalar jobs. Curved sections have a numbered h key, signed stroke styles and a selected-section readout in the surrounding UI. Selection styling is shared by playback and exports; renderable viewports and thumbnails contain geometry only, never visible text. Family live diagnostics contain only summaries; single tesseract diagnostics retain their original formatting. The notebook menu remains **2D studies / 3D studies / 4D studies**.

Review regressions were observed failing before fixes: object-mode restoration, small-radius switches, tesseract single/family diagnostics, curved family summary, distinguishable section styles, tangent-point selection, object-specific animation help, inactive spread and separate slice/spread errors. The deliberately delayed scalar reply test passed before and after the fixes. Engine-returned-radius integration and circle sagitta/convergence tests replace the weaker numerical checks. One-off mutation refinement detected the original 22 targeted faults and three additional faults in reported radius, tube fixed-v geometry and ball latitude centres; no mutation framework is retained.

The subsequent legend-layout regression failed in both themes at desktop and phone widths, and with edited small/large radii and 25 sections. Responsive grid cells, reserved readout columns and tabular digits now keep entries fixed through passage; camera help occupies its own row. All 15 layout tests pass, including an existing tesseract wording guard. Two temporary CSS mutations (content-sized layout and unreserved readout columns) were detected; scratch tooling was discarded. This is a bounded refinement, not an exhaustive mutation score.

Verification: changed Go files were formatted with `gofmt`; `make check` passed (engine4 coverage 98.6%); `make test-browser` passed **691/691 Chromium tests**, including the viewport-text and stable-legend follow-ups; `WEBKIT=1 npx playwright test --project=webkit` passed **21/21 tests**. Independent MP4/WebP decoders verified duration, endpoints and live/export rendering parity with a non-default section selected. Empty-endpoint and midpoint parity checks cover the entire frame. The no-visible-text viewport regression failed for both curved presets before the shared renderer's text was removed; exports preserve selection in styling and metadata. Visual inspection covered both new presets and Section garden in both themes at desktop and 390 px. `make thumbnails` passed; regenerated gallery assets are included.

Limits: finite boundary linework, transparent illustration, axis-aligned curved sections and tolerance-coalesced tangencies. Passage animates h only; no tilted curved sections, radius animation, general implicit field or opaque mesh. Physical-phone performance and total browser-process memory are unmeasured. No deployment or publication was performed. Pass 2 remains the next bounded task.

### Pass 2 handoff — localized thread lift (2026-09-29)

Fetched the latest main (e6f72a2) before starting this bounded pass. Implemented **Localized thread lift** with five fixed straight threads and one circular strand, **Reference slice** and **Lifted construction**, optional missing-region circles and displacement connectors, and the **The missing middle** preset. Both views share source identities, motion progress and the manual camera. Center drift and support-radius motion use explicit endpoints with A and ε fixed. No later pass was regrouped into this one.

Go owns the C¹ bump, fixed slab half-thickness ε = 0.02, derived missing radius, analytic line/circle sphere roots, interval classification and explanatory xw projection. Roots split source intervals before sampling; absent intervals are never bridged. Tangent contacts, exact endpoints, original parameters, four-dimensional coordinates and source/role/branch identities are retained. Reference coordinates lie in w = 0; construction coordinates carry H. Descriptors own controls, help, layers, diagnostics and animation choices. Stable readouts and a constant live summary remain outside the viewport; every renderer/export contains geometry only. Existing tesseract and curved-section behavior is preserved. See [the permanent lift guide](tesseracts.md#localized-thread-lift), [mathematical definition](mathematics.md#localized-four-dimensional-lift) and [architecture](architecture.md#tesseract-notebook) for formulas, tolerances, controls and transport.

Observed red tests covered the initially unsupported lift request/preset, a source/role render-key collision leaving a stale path after view changes, inactive presentation-angle validation, an absolute membership tolerance joining a known tiny interval, and returned reference coordinates carrying H instead of w = 0. Native checks use returned geometry with independent bump, projection, endpoint, tangent-plane and convergence expectations. Reversal recovers matching geometry; stop restores the immutable entered definition. Direct controls, scalar parsing, delayed evaluations, object/notebook restoration, camera state, edited counts and cancellation are covered.

Mutation refinement detected 14 targeted engine faults, four immutable sampler faults and two UI faults in linked-view progress preservation and cancellation. An initial high-lift framing mutation survived; adding a returned-coordinate framing invariant at A = 10 detected it on repeat. The UI cancellation mutation produced three stale downloads and was detected; the view mutation reset 0.5 progress to zero and was detected. No final targeted survivor remains. This bounded procedure is not an exhaustive mutation score; temporary copies, overlays and source edits were restored, with no mutation script or framework retained.

Verification: `gofmt` applied to changed Go files; `make check` passed (engine4 coverage 99.1%); the strengthened independent reference-membership assertion also passed native lift tests. `make test-browser` passed **706/706 Chromium tests** and `make test-webkit` passed **23/23 tests**. Independent decoders checked actual MP4/WebP duration, dimensions, endpoints and representative interior frames against live rendering in both lift views, with guides/connectors enabled. WebKit independently checked MP4 timing and endpoints. Visual inspection covered both views in light/dark themes at desktop and 390 px; paired-help layout setups cover lift controls and expanded endpoints. `make thumbnails` passed and the two new preset assets and fingerprints are included.

The fixed whole study has conservative bounds of 75 paths, 2,500 emitted points and 2,700 evaluator calls; analytic roots require no iterative refinement. The maximum-sampling/high-lift fixture emits 43 paths, 2,401 points and 2,435 evaluator calls. Native runs measured 0.092–0.097 ms and about 594 KB allocated/result. A fresh WASM runtime measured about 15 ms initially and 2.2–7.8 ms thereafter, 157,830 JSON bytes and 9,240,576 bytes linear-memory high-water. Chromium observed about 84 ms control-to-drawing and 485 KB additional retained main-page heap, with generous asserted 10-second and 32 MiB ceilings alongside geometry/work invariants. These observations do not establish a total browser-memory cap or physical-phone performance; see the permanent guide for measurement scope.

Limits: fixed analytic sources, one lift, reference level w = 0, finite linework and transparent explanatory projection. Parameter events within 10⁻¹³ coalesce; contact/root tolerances are documented. No arbitrary curves, nonzero slices, overlapping lifts, filled surfaces, physical dynamics, moving marker or optional cage preset. No new runtime dependency or resource type, publication or deployment. The next bounded step is **Pass 3: a route beside the wall**, including a complete route, route/shell intersection classification and comparison with the reference slice.

### Pass 2 review follow-up — periodic seams and controls (2026-09-29)

Reproduced two periodic-circle regressions before fixing them: a solitary contact at t = 0/1 produced two paths and seven present intervals, and one visible arc crossing that seam inflated its connected interval count. Closed-source endpoints now share identity. A solitary seam contact uses one canonical t = 0 path, and an adjoining seam contact belongs to its arc. A wrapped arc still uses two drawing pieces to avoid joining across its hidden middle, but diagnostics count it once. Open line endpoints remain distinct. Native tests exercise both seam sides, exact endpoint residuals, 8/64/256 subdivisions, the linked construction's reference count and isolated line endpoints. The real WASM bridge and browser tests verify canonical contacts and live/export interval counts.

Lift worker validation now names the active field and ignores inactive tesseract rotation data; existing tesseract wording has a regression guard. The served classic worker is exercised by the existing worker test with a transport-only stub; numerical geometry remains covered by the real WASM tests. Lift center and drift endpoints each use a labeled x/y/z row with compact visible labels, full accessible names and shared `.pair.trio` help rows. The coordinate-row regression test failed before this grouping existed, and the worker validation test reproduced the old tesseract messages for invalid lift values. Visual inspection covers desktop and 390 px in both themes. The projection assertion in `TestLiftMissingMiddle` is unconditional, so an unrotated exterior can no longer bypass it.

Verification: `make check` passed (engine4 coverage 99.1%), `make test-browser` passed **711/711 Chromium tests**, and `WEBKIT=1 npx playwright test --project=webkit` passed **23/23 tests**. Four temporary Go-overlay mutations and three temporary worker-validation/transport mutations were detected; none survived. All temporary edits and tooling were removed. This is targeted test refinement, not an exhaustive mutation score. Preset definitions and fingerprints are unchanged by these corrections.
