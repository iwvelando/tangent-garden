# Spatial mathematical art expansion roadmap

This is the working roadmap for extending Tangent Garden beyond its first 3D construction. It records ideas deliberately left out of the MVP, proposes small implementation slices, and gives mathematical and verification requirements. Unchecked items are future work, not claims about the current application. The ordering is a recommendation, not a commitment to implement every research candidate unchanged. Read `AGENTS.md`, `README.md`, [mathematics.md](mathematics.md), [architecture.md](architecture.md), and [spatial-study.md](spatial-study.md) before implementation. Update progress and handoff notes as each slice lands.

## Product goal

Carry the planar notebook's beauty into space: a simple curve or rule, a visible family of construction lines, and an unexpectedly intricate result. Favor folded ribbons, unwound filaments, interlocking line families, and cusp-bearing sheets over decorative solids. A study should remain interesting and understandable with its surface hidden. Use restrained color and orientation shading; do not imply physical intensity, curvature, or density unless that quantity is actually computed and labelled.

Keep 2D and 3D together in the notebook, preserving edited studies and manual cameras when switching. The browser worker remains the place for mathematical computation, Go remains authoritative, and rendering remains local. This roadmap does not turn the product into a scene editor, CAD package, or general physical renderer. There is no planned backend or telemetry.

## Baseline and proposed implementation order

### Completed MVP on the spatial feature branch

- [x] Tangent developables of torus knots and custom `x(t), y(t), z(t)` space curves, with bounded Go parsing and explicit gaps.
- [x] Five presets: trefoil, cinquefoil, woven orbit, helix, and spatial Lissajous weave.
- [x] Orthographic orbit/pan/zoom, independent surface/ruling/boundary layers, shared 2D/3D navigation and theme behavior.
- [x] Reveal, parameter-track and camera-orbit animation; pause/resume, scrubbing, cancellation, and four framing modes.
- [x] PNG, honestly labelled SVG-with-embedded-PNG, MP4, and animated WebP export using shared live/export geometry and rendering.

These checkmarks describe the implemented branch, not a deployment claim. The baseline includes main through `1326074` (2D derived-curve composition).

### Recommended next slices

- [x] 1a. One spatial involute with an arc-length anchor and visible unwinding segments.
- [x] 1b. Bounded involute families with independently framed members and stable reveal identities.
- [x] 2a. Spatial tangent-foot projection and orthotomic, with an independent 3D pole.
- [x] 2b. Sphere inversion of a base or supported derived space curve.
- [x] 3a. Structured spatial harmonic generators and visible generating vectors.
- [x] 3b. Rotation-minimizing frames, normal-plane offsets, and explicitly framed ribbons.
- [x] 4a. Two-curve ruled surfaces and chord families.
- [x] 4b. Constant-radius tube envelopes, followed by variable-radius canal surfaces.
- [x] 5a. Bounded 3D vector-field trajectories and curated continuous attractors.
- [x] 5b. Spatial cyclic pursuit with explicit capture events and multiple paths.
- [x] 6a. Parametric surface studies with normal congruences and signed offsets.
- [x] 6b. Focal surfaces from principal curvature, with explicit degeneracy handling.
- [x] 7a. Single-interaction reflected ray families and their caustic sets.
- [x] 7b. Refraction and separately defined receiver-plane intersection/density studies.
- [x] 8. Bounded implicit surfaces and section curves, after a topology and memory-budget prototype.

Slices 1–3 offer the closest continuation of the existing curve-first notebook. Slice 4 broadens surface output without requiring a general surface editor. Slices 6–8 introduce substantially different evaluators and singularity problems: begin each with an analytic prototype and an attractive, legible study before committing to a full UI. A new formula preset alone is not a new visualization class.

The numerical and interaction backlog below can ship between these slices. Prioritize adaptive sampling and frame continuity when the first study that needs them is chosen; do not build a speculative universal geometry framework first.

## Architectural direction

Use `space-curve generator → supported construction/transform → typed geometry → drawing`. Keep `engine3` separate from the planar engine; share the bounded expression parser and suitable numerical utilities without adding dummy coordinates to planar types. Reuse existing ODE machinery only after checking dimensional assumptions and error norms.

Current spatial boundaries are `engine3/curve.go`, `engine3/developable.go`, the transport-only `cmd/wasm`, `web/spatial/types.ts`, the existing worker/client, and `web/spatial/`. `SpatialApp.tsx` owns the study controls; `SpatialPlot.tsx` owns interaction; `renderer.ts` owns projection and drawing; `animation.ts` and `SpatialAnimationPanel.tsx` own sampling/camera/session semantics; `export.ts` renders through the same WebGL renderer and shared media sinks.

Introduce result types only when a concrete slice requires them: multiple paths, correspondence segments, frame glyphs, circles, indexed meshes, ray families, or density grids. Do not squeeze a surface normal, a geometric connector, and an optical ray into one ambiguous segment type. Preserve sample/parameter identity and explicit branch breaks so reveal and parameter animation cannot reconnect a singularity. An adaptive mesh will need parameter coordinates or stable interval identities rather than assuming every vertex belongs to a uniform sample grid.

Record evaluator capabilities and derivative requirements. A smooth curve, integrated trajectory, surface patch, implicit mesh, and discrete orbit are different inputs. Compose through mathematical evaluators where available, not by repeatedly differentiating a displayed polyline. Bound composition depth and cumulative derivative order. Framing must fit each base, derived, and family member independently before combining bounds.

## Mathematical contracts and acceptance details

### 1. Spatial involutes and their families

For a regular curve r(t), let `s(t)=∫[t₀,t] |r′(v)| dv` and `T=r′/|r′|`. Define `I_c(t)=r(t)+(c−s(t))T(t)`. The anchor t₀ and signed initial length c are part of the study. Show the original curve, derived filament, and the segment connecting their corresponding points. A bounded family of c values can form an airy cage around a knot or helix.

Since `dI_c/ds=(c−s)dT/ds`, the derived tangent is perpendicular to T wherever regular. Retain the cusp at s=c; do not reject it merely because the derived speed vanishes. A straight input gives a collapsed involute point. Stop arc-length accumulation at unresolved discontinuities; an explicit later component-restart mode would need separate anchors and labels.

Acceptance: embedded planar-circle involute agrees with the planar engine; a helix has its analytic arc length; segment length is `|c−s|`; tangent orthogonality, rigid-motion and regular-reparameterization checks pass. Verify integration convergence, stationary points, gaps, family endpoints, and a short base with a distant involute. Reveal keeps the original anchor and final integration grid. Animate c and family ranges/counts without recomputing an inconsistent prefix length.

### 2. Projections, reflection across tangents, and inversion

A space curve has one tangent line but a two-dimensional normal plane. Start with the unambiguous tangent foot `H=r+dot(P−r,T)T` and tangent-line orthotomic `Q=2H−P`, for an independent pole P. Draw P, H, and the relevant perpendicular and correspondence segments. Do not label a chosen Frenet-normal construction as the unique spatial contrapedal. A normal-plane projection is another explicitly named operation, `K=P−dot(P−r,T)T`, if later useful.

Acceptance: H lies on the tangent and `(P−H)·T=0`; Q is the half-turn of P around that tangent line; planar inputs with a coplanar pole reduce to the existing planar constructions. Check distance identities, lines and circles, a pole on the curve, rigid motions, and nonfinite inputs. Pole coordinates must remain independent of future optical sources.

Sphere inversion is `J(p)=O+R²(p−O)/|p−O|²`, with R>0. Show the inversion sphere sparingly (for example its section circles), O, and correspondence segments; do not obscure the actual curves. Begin with the base and then allow supported derived evaluators. Acceptance: involution, the distance-product identity, analytic line/circle cases, and detection of branches crossing O between samples. Never join across infinity. Animate O and R using the shared scalar parser and camera policies.

### 3. Harmonic generators and framed curves

Offer meaningful coefficient controls, not just text shortcuts. A finite spatial harmonic curve can use `r(t)=c₀+Σ[A_k cos(ω_k t)+B_k sin(ω_k t)]`, where A_k and B_k are 3D vectors. Integer frequencies give a 2π-periodic curve; arbitrary real frequencies need a deliberate closure policy. Show representative vector sums or generating ellipses. Start with a small term cap, stable term identities, and analytic derivatives. Single-term ellipses, planar reductions, closure, zero terms, and translated studies provide independent checks.

For normal-plane offsets and ribbons, choose a frame `(T,U,V)` explicitly. Prefer a rotation-minimizing/parallel-transport frame for visual continuity; retain Frenet frames only as a separately named diagnostic where curvature is nonzero. Specify the initial normal, transport across samples, and what happens at a break. Closed curves can return with a different normal orientation: expose the seam or document a distributed closure correction, rather than silently adding twist. [Hanson and Ma's primary report](https://scholarworks.iu.edu/dspace/items/39fbe931-c2c8-43a1-9c9d-a207b92d551e) is a starting reference for the transport method.

With `D=cos θ U+sin θ V`, an offset curve is `r+dD` and a ribbon is `S(t,u)=r(t)+uD(t)`. These are framed constructions, not automatically tangent developables or zero-curvature sheets. Acceptance: orthonormal frames, prescribed twist, continuity on a straight segment and through a regular inflection, frame dependence under changed initial normal, and closed-loop seam behavior. Distinguish geometric frame twist from rotating the viewing camera.

### 4. Ruled surfaces and sphere envelopes

Two curves with an explicit parameter correspondence define `S(t,u)=(1−u)a(t)+u b(t)`, 0≤u≤1. Show the two threads and their joining rulings; phase shifts between circles or harmonics can produce striking woven forms. Start with a common parameter, then consider a named arc-length correspondence. Domain matching is mathematical input, not guessed scene topology.

Acceptance: boundary interpolation, straight rulings, coincident endpoint handling, normals from `S_t×S_u`, and explicit gaps where the parameterization degenerates. A ruled surface need not be developable: for `S=a+u d`, the local developability condition is `det(a′,d,d′)=0` at regular points. Do not reuse the tangent ribbon's constant-across-ruling normals for arbitrary ruled surfaces.

A canal surface is the envelope of spheres centered at c(t), radius R(t)>0. With `q=X−c`, enforce `|q|²=R²` and `q·c′=−RR′`. For speed v>0, the contact circle has axial offset `−RR′/v` along T and radius `R sqrt(1−(R′/v)²)` in the normal plane. Real circles require `|R′|≤v`; equality collapses the circle. Constant radius gives the familiar normal-plane tube envelope. Stationary centers require a separate degeneracy policy.

Start with constant radius and representative generating circles, then introduce variable radius as a distinct slice. Verify the two envelope equations, circular/straight center curves, no-real-envelope intervals, circle collapse, and surface-normal convergence. Preserve folds and self-intersections: this is not a trimmed solid, a collision-free tube, or the boundary of a union of balls. Frame transport controls the angular parameterization, not the underlying contact circle.

### 5. Trajectories and pursuit in space

Add `r′=V(x,y,z,t;a)` with a bounded seed set, integration interval, escape region, and explicit termination events. Start with an analytic rotating-and-rising field and then curated Lorenz/Rössler-style studies, with equations and coefficient conventions checked before shipping. Trajectories can stand alone; tangent ribbons should be optional because dense folded sheets can conceal their structure.

Use adaptive integration, per-trajectory error control, and bounded work. Reveal must mean the same physical time across all seeds, even when their adaptive meshes differ. Test constant fields, circular/helical flows, equilibrium points, timed fields, escape and nonfinite events, and tolerance refinement. Chaotic paths diverge with rounding; test local equations, deterministic behavior within a build, and appropriate aggregate behavior rather than requiring long trajectories to match bit-for-bit across platforms. Do not claim arbitrary coefficients produce chaos.

Spatial cyclic pursuit uses `pᵢ′=vᵢ(pᵢ₊₁−pᵢ)/|pᵢ₊₁−pᵢ|`. Begin with the planar capture policy, separate paths, and connecting polygons. Verify planar reductions, rigid motions, exact mutual-chase cases, and capture localization; do not invent a merger topology. Discrete 3D iterated maps and volumetric visitation densities are a separate later candidate, never a continuous path formed by joining unrelated iterates.

### 6. Surface normals, offsets, and focal sets

Introduce a bounded regular parameterized patch `X(u,v)` with `n=normalize(X_u×X_v)`. Begin with analytic sphere, torus, and saddle-like patches, representative parameter curves, and normal lines; only then consider arbitrary coordinate expressions. Specify chart seams and singular parameter points. This remains a mathematical surface study, not an object-placement editor.

Offsets are `X_d=X+d n`. With shape operator `A=−dn`, principal curvatures κ₁, κ₂, the regular focal branches are `Fᵢ=X+n/κᵢ` where κᵢ≠0. Derive and document the sign convention before implementing. A sphere's focal branches collapse to its center under this convention; a cylinder has an axial focal set and a branch at infinity. Handle zero curvature, umbilics, chart singularities, and branch identities explicitly. Never connect a finite sample to a clipped infinite branch. A planar curve's evolute is not a unique curve obtained from all normal lines of a space curve.

Acceptance: analytic sphere/cylinder/torus curvatures, sphere offset radii, focal collapse, principal-direction/normal orthogonality, and convergence under two-dimensional refinement. Normal reversal with matching signed-distance reversal must preserve offset geometry. Label collapsed point/curve components honestly; do not force every focal result into a nondegenerate triangle mesh.

### 7. Optical ray families and caustics

Use a known mathematical surface, an explicit point source or parallel direction, a declared normal orientation, and a single interaction. Start with reflection; add refraction only with explicit incident/transmitted indices, propagation direction, and total-internal-reflection behavior. Do not infer inside/outside topology, multiple bounces, absorption, or visibility between objects.

For a two-parameter ray family `Y(u,v,λ)=X(u,v)+λD(u,v)`, caustic candidates satisfy `det(Y_u,Y_v,D)=0`. Classify finite, virtual, repeated, and degenerate solutions and track branches through parameter changes. The one-parameter planar envelope formula is insufficient. Begin with analytic focusing examples: parallel rays at a paraboloid, a spherical reflector, and a planar interface under uniform illumination. Test reflection/refraction laws, exact focal points where applicable, branch residuals, singularities, and sampling convergence. [Schmidt's NASA report](https://ntrs.nasa.gov/api/citations/19880001678/downloads/19880001678.pdf) develops ray, wavefront, and differential-geometric approaches; it is a reference for defining this slice, not permission to substitute a visual approximation for its equations.

Keep intersection with a receiver plane separate from the caustic set. If receiver density is added, define emitted sample weights, area normalization, filtering, and energy accounting. A bright pixel histogram is not automatically physical irradiance; a geometrical caustic can diverge without a finite light-intensity model. Diffraction, spectral rendering, volumetric scattering, and general photorealism remain outside this roadmap's intended product.

### 8. Implicit surfaces and sections

Accept bounded `F(x,y,z)=c` fields only after adding explicit parser bindings and a viable bounded meshing strategy. Start with sphere/torus level sets and parameter-controlled families. Section curves on declared planes offer a way to expose the construction and connect back to the 2D notebook.

Prototype the treatment of ambiguous cells, nonfinite regions, poles masquerading as zero crossings, open domain boundaries, normal orientation, and memory growth before exposing large grids. A coarse mesh is not a differentiable surface evaluator and should not automatically feed curvature or optical constructions. Acceptance: equation residuals, analytic sections, component changes, refinement convergence, and explicit workload/triangle caps. Gyroid-like level sets and other intricate surfaces are candidates once their topology can be represented honestly; they are not a reason to skip those gates.

## Numerical and rendering work deferred from the MVP

- [ ] **Adaptive curves and meshes.** Replace uniform-only sampling where needed with bounded refinement driven by geometric error and derivative stability. Retain a quality-controlled world-space definition shared by playback and export; optional view-dependent drawing refinement must not change the mathematical study. Report budget exhaustion. Test narrow folds, rapidly oscillating curves, and poles between samples; do not promise certified topology from heuristics.
- [ ] **Scale and translation robustness.** Establish error budgets across tiny/large studies and translated coordinates. Rebase GPU positions before Float32 upload where needed, retain meaningful camera clipping, and test explicit export equivalence. Current finite-value guards and robust bounds are not a proof of scale independence.
- [ ] **Mesh identities and efficiency.** Introduce indexed/shared vertices when a concrete surface needs them, preserving branch boundaries and normals. Profile WASM serialization, worker transfer, GPU upload and canceled work before adopting typed transport or worker pools. Bound memory and keep the UI responsive.
- [ ] **Transparent and hidden geometry.** Investigate restrained transparency, cutaway planes, and hidden-line modes as ways to inspect folds. Triangle sorting alone fails for intersecting sheets. Evaluate a documented transparency method and support fallback; do not change the opaque default until both live and exported views agree reliably.
- [ ] **Line rendering quality.** Stable screen-space strokes, antialiasing, and depth bias at high export resolutions; prevent construction lines from flickering or vanishing without making hidden lines falsely visible. Device-dependent WebGL line width is not a portable stroke system.
- [ ] **Context recovery and capability limits.** The MVP reports missing/lost WebGL. Later restore resources from the current study after context restoration, preserve camera state, and validate actual device limits for export sizes. Keep the 2D notebook available throughout.
- [ ] **Geometric diagnostics.** Optional tangent/normal/binormal glyphs, curvature/torsion plots, and a parameter probe linking a curve point to its construction. Mark undefined curvature/torsion honestly. Distinguish diagnostic coloring from the existing decorative phase palette.

## Notebook, camera, and media backlog

- [ ] **Saved studies and portable links.** Versioned local JSON import/export containing dimension, generator, construction, expressions, scalar values/text, theme choice, layers, animation tracks and effective camera. Validate untrusted files through bounded schemas/parser inputs. Later add size-bounded URL sharing without a server; report incompatible versions. Keep model definitions independent of transient playback state.
- [ ] **Camera affordances.** Named front/side/top/isometric views, a small orientation indicator, touch pinch/pan, and keyboard parity. The MVP already supports orbit/pan/zoom; this is refinement, not replacement. Any perspective option must be explicitly labelled and retain orthographic defaults and reproducible export framing.
- [ ] **Authored camera animation.** Named snapshots, a target/orbit center, start/end orientation, and deliberate interpolation. Specify full-turn versus shortest-rotation behavior and avoid quaternion sign flips. Geometry tracks and camera tracks remain separate; Stop restores the manual camera.
- [ ] **Composition and study comparison.** Allow only evaluator-compatible derived inputs, with bounded depth and clear provenance. A later side-by-side 2D/3D comparison or declared planar embedding could help explain reductions, but 2D and 3D studies should not silently overwrite one another.
- [ ] **Still-export controls.** User-selected dimensions/aspect, quality where applicable, and optional transparent backgrounds with correctly composited antialiasing. The current PNG is opaque and fixed at 2000 × 1520; animation resolution is already adjustable. Keep theme/layers/camera snapshots and actual target-resolution rendering.
- [ ] **True vector linework export.** Project mathematical paths/rulings to SVG for line-only studies, with an explicit choice about occlusion. An all-lines drawing is distinct from exact hidden-line removal. Keep the existing shaded SVG honestly labelled as an embedded image; never call a raster or painter-sorted intersecting mesh exact vector output.
- [ ] **Geometry export, if useful.** Curves/meshes in a documented interoperable format with units, normals, branch boundaries and source metadata. Warn in the file/documentation that ribbons can be open, singular, self-intersecting and nonmanifold; do not describe them as print-ready solids. Select a format only when a real downstream use is chosen.
- [ ] **Animation polish.** Optional easing, ping-pong, explicit seamless-loop settings and coordinated camera/geometry tracks. Defaults remain linear and exact. A copied first frame is not a substitute for a continuous periodic study; preserve duration, endpoints, cancellation and decoder verification.

Lighting/material editors, arbitrary imported scenes, physical collisions, path tracing, and a backend remain outside the proposed scope. A small fixed shading improvement or palette control is reasonable only when it clarifies the mathematical construction. Transparency and perspective are optional investigations, not prerequisites for new curve classes.

## First visual recipes to investigate

These are proposed studies, not implemented presets or screenshot specifications.

- **Unwinding a staircase:** the existing helix, with several involute lengths and a sparse set of tangent strings. Compare with its planar circle reduction.
- **A knot shedding filaments:** the trefoil with a short bounded involute family; start with surfaces hidden so the base and correspondence remain legible.
- **A harmonic loom:** two spatial harmonic threads with a phase-shifted correspondence, joined by straight rulings. Show both boundary threads and permit a line-only view.
- **A necklace of spheres:** a helix with a constant-radius tube envelope, then a slowly varying sphere radius with its contact circles. Include an example where the real envelope disappears.
- **A rising vortex:** `V(x,y,z)=(-y,x,h)` from a small ring of seeds, giving analytically checkable helices and optional tangent ribbons.
- **A surface revealing its centers:** a torus with selected normal lines and separately colored focal branches; pair it with a sphere collapsing to one focus.
- **A geometric fold of rays:** a single analytic reflector with sparse incident/reflected rays and caustic branches. Keep receiver-density imagery as a separately labelled study.

## Completion gate for each slice

Ship a mathematical definition, Go computation, synchronized transport, usable controls, at least one verified preset, visible construction geometry, appropriate animation tracks/reveal semantics, and matching live/export behavior together. Update permanent mathematics, architecture and usage docs plus README feature claims. Do not mark a slice complete merely because a surface looks attractive.

Use analytic identities, geometric invariants, regular reparameterization and rigid-motion tests, singular/invalid inputs, and convergence checks for new numerical methods. Test the actual WASM bridge. Run `make check` and the full browser suite; include relevant WebKit checks for rendering/encoding changes. Inspect both themes at desktop and phone widths, independent sidebar scrolling, every paired help layout, all geometric scalar fields, custom counts, system/manual themes, and storage denial.

Animation verification includes exact endpoints, pause/resume, scrubbing, stale-result cancellation, bounded in-flight work, all camera modes, and restoration of immutable base studies/manual cameras. Decode actual exported images and videos independently, checking resolution, timing, endpoints, appearance and canceled-output suppression. New resource kinds require reviewing both this repository's CSP and the matching deployment policy; preserve distribution notices and dependency exclusions.

Each handoff should record the implemented slice, permanent documentation changes, numerical conventions, test commands/results, measured workload limits, unresolved limitations, and the next small step. Record results actually run, not inherited claims. Keep unrelated work in its own branch/worktree. This roadmap does not authorize publication, deployment, or merging to main.

## Handoff notes

Baseline: the spatial feature branch includes the initial tangent-developable implementation and main through `1326074`. At completion of that integration, `make check`, all 423 Chromium tests, and all six WebKit tests passed, including independently decoded spatial media. Those numbers are historical evidence for the baseline, not a guarantee for later changes. No additional runtime dependencies or CSP resource categories were introduced.

Known MVP limits: one spatial construction class; bounded torus/custom-expression inputs; uniform curve sampling and heuristic singularity/normal guards; opaque sheets and orthographic projection; fixed initial shading; no persistent study/camera files; no true vector shaded-surface export; no automatic WebGL context recovery. The UI, sampling policies and media path are already in place for adding another class deliberately.

Slices 1a and 1b (branch `claude/spatial-involutes`) landed together, because a family is the natural shape of the result type: a single involute is a one-member family, and designing the type once avoided churn. Durable definitions now live in [mathematics.md](mathematics.md#spatial-involute), [architecture.md](architecture.md), [usage.md](usage.md), and [spatial-study.md](spatial-study.md).

- Conventions: `I_c = r + (c − s)T` with s measured from the anchor t₀ inside the domain, so `c = −c_planar` against the planar engine (anchor at the domain start). Simpson arc length per interval, split at t₀; accumulation stops at the first invalid sample or break on each side and counts unreached samples. Anchors outside the domain or on a broken interval are refused. The cusp at s = c is kept; a line's involute is reported as collapsed and drawn as a cross.
- Workload: families of 2–24 members and at most 48,000 points; `c`, `from`, `to` within ±100000. Anchor, c, family range and count are animation tracks; the tangent reach L is neither validated nor offered in involute mode.
- Verification run on this branch: `go test ./engine3` (helix closed form, planar agreement, rigid motion, reparameterization, fourth-order arc length, orthogonality convergence, cusps, collapsed lines, stops, refused anchors, families, bounds, validation) and the WASM bridge test, plus `tests/spatial-involute.spec.ts` (layers, validation, count and range tracks, reveal, all four camera modes, an independently decoded MP4) and the scalar-field, layout, and gallery extensions. At handoff, `make check` passed (engine3 coverage 99.3%), all 452 Chromium tests passed, and all six WebKit tests passed. The WebKit suite has no involute-specific case; the involute reuses its rendering and encoding path.
- Limits: no arc-length restart after a gap, no tangent-developable surface under the filaments, uniform sampling only, and 1-pixel WebGL lines. Filaments of a long closed curve (a whole knot) extend to about half its length from the anchor, so knot studies are dominated by their filaments.

### Slices completed in this follow-up: 2a

- Implemented tangent-foot projection `H = r + ((P − r)·T)T` and tangent-line orthotomic `Q = 2H − P`, with an independent bounded 3D pole. This slice stands alone: sphere inversion needs separate center-crossing guards and an explicit supported-derived-evaluator contract.
- Added `engine3/projection.go` and typed projection paths, feet, pole, and representative contact/foot/image records. Only the base's first derivative is required. Collapsed images remain points; nulls and shared interval breaks preserve gaps; each family and the pole frame independently.
- Added scalar pole controls, three pole animation tracks, per-construction layers, explanations, two presets, and regenerated thumbnails. Reveal preserves sample identities, and the shared renderer handles live views and exports.
- Workload: 240–2400 sample intervals, 12–240 representative constructions, two paths of at most 2401 points, and three pole coordinates within ±100000. No new runtime dependency or resource category. Durable definitions and guidance are in `mathematics.md`, `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: `make check` passed, including Go race tests (engine3 coverage 99.7%), the analytic projection WASM checks, TypeScript, formatting, vet and production notices. `make thumbnails` regenerated the gallery. `make test-browser` passed all 465 Chromium tests; `make test-webkit` passed all eight WebKit tests, including PNG/H.264 exports of both new projection presets. New tests cover geometric identities, planar agreement, rigid motion and parameter reversal, line collapse, gaps, finite bounds, all pole scalar fields, reveal identities, playback cancellation/restoration and all four cameras, decoded MP4 timing, and SVG metadata/resolution. Paired-help sweeps include both new presets at desktop/phone widths. Light/dark desktop and narrow drawings plus the new thumbnails were visually inspected.
- Limits: uniform sampling and conservative base interval guards remain; no spatial contrapedal, derived-input composition, inversion sphere, or optical-source semantics are introduced.

### Slice completed in this follow-up: 2b

- Implemented sphere inversion `J(p) = O + R²(p − O)/|p − O|²` of the base curve or of its tangent-foot or orthotomic path (branch `claude/spatial-inversion`). It stands alone rather than batching with 3a: harmonic generators are a new curve input with their own coefficient editor, while this slice is a construction on existing inputs.
- Derived inputs use the new pointwise evaluator `project(kind, pole, r, T)` in `engine3/projection.go`, which the projections now share; composition is bounded to one level, and involutes are refused as an input. The inversion center and radius are independent of the projection pole.
- Center passages: a sample at O or with an oversized image is a null image sample; between samples, the image of each interval's midpoint source point must not turn back (`(J(M) − Jᵢ)·(Jᵢ₊₁ − J(M)) < 0`), or the interval is broken and counted. The result carries its own `breaks` (base breaks plus passages); a near passage the samples cannot resolve is conservatively broken too.
- Added `engine3/inversion.go` with a typed `InversionResult` (center, radius, input, pole for a derived input, nullable source and image paths, image breaks, correspondences, collapsed/invalid/crossing diagnostics). Also added scalar center and radius controls, a **Curve to invert** select that shows the pole fields for derived inputs, four new tracks (`centerX`, `centerY`, `centerZ`, `sphere`) plus pole tracks for derived inputs, four layers (image, correspondence segments, sphere great circles and center, derived source and pole), an explanation with passage diagnostics, three presets, and regenerated thumbnails. Adding `inversion` to the preset base changed every 3D fingerprint; the existing images re-rendered byte-identically.
- Workload is unchanged: 240–2400 samples, 12–240 correspondences, one image path, and one midpoint evaluation per interval. Center coordinates are within ±100000 and R is in (0, 100000]. No new runtime dependency or resource category. Durable definitions are in `mathematics.md#spatial-sphere-inversion`, `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: `make check` passed (formatting, vet, Go race tests with engine3 coverage 99.7%, the WASM bridge including the circle-through-center and orthotomic-source inversion checks, TypeScript, production build and notices). `make thumbnails` regenerated the gallery. `make test-browser` passed all 477 Chromium tests; `make test-webkit` passed all nine WebKit tests, including PNG/H.264 export of the derived-input inversion preset. New Go tests cover involution, the ray and distance-product identities, lines and circles in and off O's plane, circles and lines through O (one break at the passage), samples at and beside O, recovering a circle from its image, rigid motion, common scaling, parameter reversal, derived inputs against the projection engine, collapsed images, oversized derived sources, retained base gaps, framing, and validation. Browser tests cover layers and validation for base and derived inputs, a reported passage through the center, reveal/pause/resume/edit invalidation, all four cameras with a radius track, a decoded MP4, reveal identities and track targets, SVG metadata, and all new scalar fields. Paired-help sweeps include both a base and a derived inversion preset. Light and dark drawings, the thumbnails, and the phone-width controls were inspected.
- Limits: uniform sampling; unresolved near passages are broken rather than refined; the sphere is shown only as three great circles; no inversion of involutes or of an inverted curve; the center cannot be animated through the curve without momentary passage breaks, which is intended.

### Slice completed in this follow-up: 3a

- Implemented the spatial harmonic generator `r(t) = c₀ + Σ[Aₖ cos(ωₖt) + Bₖ sin(ωₖt)]` as a third curve definition, `format: "harmonic"` (branch `claude/spatial-harmonics`). It stands alone rather than batching with 3b: frames, offsets and ribbons are a construction with their own transport, seam and twist policy, while this slice is a curve input that every existing construction already accepts.
- Closure policy, decided before the UI: the domain is input and is never forced closed. The period of the moving terms comes from the planar harmonic rule, moved into the shared `engine/closure` package (the planar harmonic curves and roulettes now use it unchanged). The curve is closed only when the domain spans a whole number of periods, and then shares its seam sample. Incommensurate frequencies are open arcs; the interface offers **Trace one full period** when a period exists but the domain misses it. A curve that does not move is refused.
- Term cap 8; frequencies within ±1000; vector and center coordinates within ±100000. Terms keep their input order as their identity: zero terms stay in place, tracks name terms by number, and adding or removing a term awaits pending evaluations. Derivatives are exact, and the developable's normal guard uses the analytic scale `Σ ωₖ²(|Aₖ| + |Bₖ|)`.
- Added `engine3/harmonic.go` and `HarmonicResult` (center, terms, period, whole, closed, and vector chains at the representative samples) reported under every construction, with each term's joints and ellipse extents framed as their own families. The interface adds a coefficient editor (c₀ and each term's ωₖ, Aₖ, Bₖ as `ScalarInput` trios), a closure note, **Vector sums** and **Generating ellipses** layers, tracks for c₀, every term field, and the harmonic domain, three presets, and regenerated thumbnails. Adding `harmonic` to the preset base changed every 3D fingerprint; existing images re-rendered byte-identically.
- Workload: at most 8 terms × 240 representative chains and 64-segment ellipses at one position; no new runtime dependency or resource category. Durable definitions are in `mathematics.md#spatial-harmonic-curves`, `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: `make check` passed (formatting, vet, Go race tests with engine3 coverage 99.8% and the new closure package 95.0%, the WASM bridge including the harmonic ellipse, closure, open-arc and refusal checks, TypeScript, production build and notices). `make thumbnails` regenerated the gallery. All 491 Chromium tests and all 10 WebKit tests passed. Go tests cover the closure package, single-term ellipses, exact derivatives, the planar reduction against the complex Fourier sum, closure over one, two and part of a period for whole, rational and commensurate irrational frequencies, an incommensurate open arc, zero terms, translated studies, framing of nearly cancelled vectors, every construction, and validation. Browser tests cover layers, closure notes and period tracing, validation messages, term editing with pending evaluations and the term cap, format switching, reveal/pause/resume/edit invalidation, all four cameras on a term track, a decoded MP4 with a c₀ track, reveal and track unit tests, and every new scalar field; the layout sweep includes the harmonic trefoil, and WebKit exports it.
- Limits: uniform sampling; ellipses are drawn only at the last representative position; the vector-sum count shares the construction's line count; periods need denominators up to 1000; no per-term phase field (a phase is a rotation of Aₖ toward Bₖ, entered as coefficients).

### Slice completed in this follow-up: 3b

- Implemented a framed construction, `construction: "framed"` (branch `claude/spatial-frames`): a frame (T, U, V) at every sample, a ribbon `r + uD` for `|u| ≤ w`, and up to 12 offset strands `r + dD` turned by 2πk/m, with `D = cos θ U + sin θ V` and `θ(s) = θ₀ + 2πN s/L`. It stands alone rather than batching with 4a: two-curve ruled surfaces need a second curve input and a correspondence policy, while this slice is a construction on the existing single curve. Its frames are the natural base for 4b's tube envelopes.
- Frame policy, decided before the UI: the default is rotation-minimizing, carried between samples by double reflection (Wang, Jüttler, Zheng and Liu 2008; fourth order, rotation-equivariant). The Frenet frame is a separately named diagnostic that leaves gaps where curvature vanishes and breaks where the binormal reverses. The reference normal N₀ is projected onto the normal plane where each unbroken stretch begins; the frame restarts after every break and never crosses one, and a tangent N₀ falls back to the least aligned axis with a reported count. Twist is measured in turns over the Simpson arc length, so reparameterization does not change the drawing.
- Seam policy: on an unbroken closed loop the transported frame's holonomy α is reported. **Show the seam** (default) leaves the mismatch visible and marks it with arms and an arc at the loop start; **Distribute the correction** turns the frame by `−α s/L` and reports it. A twist that is not a whole number of turns leaves a reported seam either way. Nothing is closed silently.
- Added `engine3/frame.go` with `FrameRequest`, `FrameResult` (glyphs, nullable strands, own breaks, length, pieces, undefined, flips, fallbacks, closed, holonomy, correction, optional seam). The ribbon reuses the developable's mesh, edges, and cross-line fields, drawn with the frame's breaks. The interface adds the frame select, an N₀ trio, θ₀/twist and half-width/offset pairs, a strand count, the closure select, a note in the controls (`web/spatial/frame.ts`), **Strands**, **Frames**, and **Seam** layers, eight tracks (`angle`, `twist`, `width`, `distance`, `strands`, `normalX`–`normalZ`), three presets, and regenerated thumbnails. Adding `frame` to the preset base changed every 3D fingerprint; existing images re-rendered byte-identically. A Frenet frame ignores N₀, which is then not validated, so a hidden field cannot block it.
- Workload: one transport and one Simpson interval per sample, at most 12 strands × 2401 points, 2 triangles per interval, and one glyph per representative sample; no new runtime dependency or resource category. Durable definitions are in `mathematics.md#spatial-frames-offsets-and-ribbons`, `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: `make check` passed (formatting, vet, Go race tests with engine3 coverage 99.7%, the WASM bridge including the twisted-circle ribbon, seam and refusal checks, TypeScript, production build and notices). `make thumbnails` regenerated the gallery. All 503 Chromium tests and all 11 WebKit tests passed. Go tests cover orthonormal frames, fourth-order convergence to the helix's exact transported normal (errors 1.8·10⁻⁹, 1.1·10⁻¹⁰, 6.9·10⁻¹² at 240, 480, 960 samples; a first-order projection transport fails it), exact prescribed twist, evenly spaced strands, a straight run and a regular inflection (single transported stretch; Frenet undefined, flipped and broken), rotation under a changed N₀ with unchanged holonomy, holonomy against independently integrated total torsion, exposed and distributed seams, a half-turn seam, restarts after a pole, the tangent fallback, rigid motion and reparameterization, ribbon triangles, framing, and validation. Browser tests cover layers, validation, seam and Frenet notes, strand counts and a Frenet straight run, reveal/pause/resume/edit invalidation, all four cameras on an offset track, a decoded MP4 with an angle track, reveal and track unit tests, and every new scalar field; the layout sweep includes the band and seam presets, and WebKit exports the seam preset. Light and dark desktop drawings, a close-up of the seam, and the phone-width controls (no horizontal scroll) were inspected.
- Limits: uniform sampling; the transport step and twist use the sampled tangents, so a curve with fast-turning tangents needs more samples; the Frenet diagnostic uses the developable's normal guard, including its numerical noise floor for expressions; glyph length is a fixed fraction of the fitted bounds; ribbon shading is per triangle; no curvature or torsion plots (see geometric diagnostics below), and no framed construction on derived curves.

### Slice completed in this follow-up: 4a

- Implemented a ruled construction, `construction: "ruled"` (branch `claude/spatial-ruled`): `S(t, u) = (1 − u) a(t) + u b(φ(t))` with the explicit correspondence `φ(t) = m t + δ`. It stands alone rather than batching with 4b: tube and canal envelopes are a single-curve construction built on 3b's frames, while this slice adds a partner curve and a correspondence policy.
- Partner and correspondence policy, decided before the UI: the partner is the curve itself (**chords**) or a second **thread** `b(t)` entered as expressions in t, without `a`. A full second curve editor (torus or harmonic) was deliberately not built; the harmonic loom pairs a harmonic curve with an expression thread instead. The correspondence is a shared, affine parameter, `m t + δ`, never guessed from geometry. A chord partner wraps on a closed curve and is missing, and counted, outside an open domain. A thread has no domain of its own and is evaluated wherever φ sends it. An arc-length correspondence is not offered.
- Degeneracy policy: the surface is broken wherever the base breaks or the partner is missing or jumps (the custom curve's pole rule, now the shared `jumps`). Zero-length rulings are counted as coincident and have no faces. Where `S_t × S_u` vanishes (a cone's apex, an edge of regression), rulings are counted as singular and shaded by their face normals. Closure requires the partner to return to its start; otherwise the gap is reported. The developability measure `det(a′, d, d′)` is reported without units, and the surface is called developable within 10⁻⁶.
- Added `engine3/ruled.go` with `RuledRequest`, `Thread`, and `RuledResult` (partner, breaks, closed, gap, outside, coincident, singular, developable, deviation). `compile`'s stencil evaluator is now `sampled`, shared with the thread. The partner fills `plus` and the mesh has four strips per interval with `S_t × S_u` vertex normals, so the developable's surface, rulings, and edges layers draw it, labelled **Ruled surface**, **Rulings**, and **Partner thread**. The interface adds the partner select, the b x/y/z fields, the **Shift δ**/**Rate m** pair, a note (`web/spatial/ruled.ts`), `shift` and `rate` tracks, three presets, a "Ruled surfaces" gallery family, and regenerated thumbnails. Adding `ruled` to the preset base changed every 3D fingerprint; existing images re-rendered byte-identically.
- Workload: one partner evaluation per sample and midpoint, at most 2400 × 4 × 6 = 57,600 mesh vertices (twice the developable's), and up to 240 rulings; no new runtime dependency or resource category. Durable definitions are in `mathematics.md#spatial-ruled-surfaces-and-chord-families`, `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: `make check` passed. It covers formatting, vet, Go race tests (engine3 coverage 99.6%), the WASM bridge (including the hyperboloid, planar chords, collapse and refusal checks), TypeScript, the production build and notices. `make thumbnails` regenerated the gallery. The full Chromium run passed 513 of 514 tests. The failure was the gallery check, run against a build made before the thumbnails were recorded; after a rebuild, it passed together with the ruled, notebook-consistency, layout and scalar-field specs (69 tests). All 12 WebKit tests passed. Go tests cover the hyperboloid identity and its normals, a developable cylinder, straight rulings and boundary interpolation, chord families at whole and fractional rates, chords stopping outside an open domain, coincident chords, a cone and a pinch, partner poles (a mutation that drops the jump test fails), rigid motion and reparameterization, framing and validation. A mutation that uses a′ alone for S_t fails the hyperboloid and cone tests. Browser tests cover layers, validation, notes on closure, stops, collapse, cones and developability, reveal/pause/resume/edit invalidation, all four cameras on a rate track, a decoded MP4 with a shift track, reveal and track unit tests, and both new scalar fields. The layout sweep includes the loom and trefoil chords, and WebKit exports the loom. Light and dark thumbnails and the desktop and phone controls (no horizontal scroll) were inspected.
- Limits: uniform sampling; affine correspondence only (no arc-length or user-defined φ); the thread cannot use `a` or come from the torus or harmonic generators; per-vertex normals are shaded at five points per ruling, so a sharply twisted surface needs more samples; no striction curve or developability colouring; self-intersections are drawn as they are.

### Slice completed in this follow-up: 4b

- Implemented a canal construction, `construction: "canal"` (branch `claude/spatial-canal`): the envelope of spheres centred on the curve with radius `R(t) = R·ρ(t)`, whose contact circle is centred at `c − (RR′/v)T` with radius `R√(1 − (R′/v)²)`. The constant-radius tube and the variable-radius canal surface landed together, as 1a and 1b did: a tube is the canal surface with ρ = 1, so they share one request, one result type, and one set of controls. Designing the type once for R′ avoided a second round of churn. Each part has its own tests (torus, cylinder and folds for the tube; envelope equations, convergence, cone, collapse and vanishing envelopes for the canal).
- Frame and angle policy, decided before the UI: the circle never depends on a frame; its angle is carried by 3b's rotation-minimizing frame (N₀, θ₀, twist, seam policy), always transported, with the ribbon fields and the Frenet kind ignored and not validated. Meridians show the angle and the seam. The mesh spreads any holonomy along a closed loop, so the surface closes under either seam policy. `frames` now returns its carried field for this reuse.
- Degeneracy policy: `|R′| > v` (beyond 10⁻⁹) has no real circle and is counted and broken, and a midpoint check catches an envelope that vanishes only between samples (counted separately). `|R′| = v` collapses the circle to a point, which is counted and kept. A profile that is not positive, finite, and stably differentiable has no sphere. A stationary centre is an invalid base sample: its envelope equation has no circle, so it is a gap. Folds are detected by the sign of `(X_θ × X_t) · q/R` and counted, and they are drawn, not trimmed. A profile that does not return on a closed curve leaves a reported gap.
- Added `engine3/canal.go` with `CanalRequest`, `CanalCircle`, and `CanalResult` (circles, meridians, breaks, constant, closed, gap, steepest, undefined, imaginary, between, collapsed, folded). The mesh has 24 segments per circle and normals `q/R`. The interface adds **Tube radius R** with **Meridians** in a pair, **Profile ρ(t)**, the shared N₀, θ₀/twist and seam controls (now fragments reused from the framed controls), and a note (`web/spatial/canal.ts` plus the frame note, worded for meridians). It also adds the **Contact circles** layer (grey great circles for spheres without a real circle) and the **Meridians** layer, and reuses the **Canal surface**, **Frames**, and **Seam** layers. There are tracks `sphereRadius`, `angle`, `twist`, `meridians`, and `normalX`–`normalZ`, three presets, a "Tubes and canal surfaces" gallery family, and regenerated thumbnails. Adding `canal` to the preset base changed every 3D fingerprint; existing images re-rendered byte-identically. Go now fits the base, meridians, and circle points, the families reveal fits, so a full reveal frames exactly like the still.
- Workload: one profile evaluation per sample and midpoint, a fold check at 24 angles per sample, and at most 480 joined circles × 24 segments × 6 = 69,120 mesh vertices. Circles beside gaps are always joined, adding at most one band per gap and never more than one per sample interval. At 2400 samples, 12 meridians and 240 circles a tube took about 58 ms natively and about 15 MB of JSON. There is no new runtime dependency or resource category. Durable definitions are in `mathematics.md#spatial-canal-surfaces-and-tubes`, `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: `make check` passed: formatting, vet, Go race tests (engine3 coverage 99.5%), the WASM bridge (torus, vanishing envelope and refusal checks), TypeScript, and the production build and notices. `make thumbnails` regenerated the gallery. The full Chromium run passed all 525 tests. After the field was renamed to **Tube radius R**, the canal, scalar-field, gallery and layout specs passed again (60 tests). All 13 WebKit tests passed, including a PNG and H.264 export of the beads preset. Go tests cover the list in `mathematics.md#spatial-canal-surfaces-and-tubes`. Mutations that drop the midpoint check, the mesh's holonomy correction, the rings beside gaps, or the fold sign each fail. Browser tests cover:
  - layers and validation, including profile, radius, twist and meridian refusals;
  - notes on the tube, closure, seam, distributed correction, the ignored Frenet kind, a folding helix tube, a lost envelope, and undefined and collapsed samples;
  - reveal, pause, resume and edit invalidation;
  - all four cameras on a radius track;
  - a decoded MP4 with a twist track;
  - reveal and track unit tests, and the new scalar fields.

  The layout sweep includes the trefoil tube. Light and dark desktop drawings, the thumbnails, and the phone-width controls (scroll width 390, no horizontal scroll) were inspected.

- Limits: uniform sampling; 24 fixed segments per mesh circle; folds are counted per sample, not located on the surface, and distant parts of the surface that cross are drawn but not reported. A collapsed contact circle is drawn as nothing in the circles layer. R′ comes from numerical stencils, so a nearly collapsing profile depends on the 10⁻⁹ band. There are no canal surfaces on derived curves, no spine given as a second curve, and no Dupin cyclides or union-of-balls rendering.

### Slice completed in this follow-up: 5a

- Implemented vector-field trajectories as a spatial definition, `format: "field"` (branch `claude/spatial-field`): `r′ = V(x, y, z, t)` from 1–12 seeds over an interval, with an escape sphere about the origin and explicit termination events (end, escape located by bisection, singular, exhausted), plus resting seeds. 5a stood alone, as recommended; 5b's pursuit reuses its pieces.
- Evaluator decision, made before the UI: a field is a curve _definition_, like the planar notebook's, not a construction. The first trajectory is the base curve on which every existing construction runs unchanged; its velocity is the field and its acceleration a central difference of the field along the flow, never a derivative of integrated positions. Tangent ribbons are therefore the ordinary developable, optional. A new `construction: "none"` (**None · the curve alone**, for any definition) lets trajectories stand alone. Constructions are built on the first trajectory only.
- Shared machinery: the planar Dormand–Prince stepper and dense solution moved into a dimension-free `engine/ode` package with its own convergence tests; the planar pursuit and trajectories use it unchanged. The error norm and events stay with each caller, so the spatial norm (largest component against `10⁻¹⁰` of the distance from the origin, floored at `10⁻⁶ E`) was chosen deliberately, not inherited. The parser gained four-variable nodes and `ParseSpatialField`.
- Added `engine3/flow.go` with `FieldRequest`, `TrajectoryEnd`, `FieldArrow`, and `FieldResult` (paths indexed like the base, arrows, ends, resting, timed). The interface adds dx/dt, dy/dt and dz/dt, a, seeds in `.pair.trio` groups with add/remove, the interval, the escape radius, and a note (`web/spatial/field.ts`). It adds the **Other trajectories**, **Field directions** (fixed length, direction only), and **Seeds & early stops** layers and the tracks `a`, `seed{k}{X,Y,Z}`, `escape`, `min`, and `max`. There are three presets (a rising vortex with its tangent ribbon, Lorenz's two wings standing alone, a ribbon along Rössler's band), a "Vector-field trajectories" gallery family, and regenerated thumbnails. Adding `field` to the preset base changed every 3D fingerprint; existing images re-rendered byte-identically. A tube along Rössler was tried first and dropped: the canal mesh's 480-ring cap faceted the fast spike, while the framed ribbon meshes every sample.
- Coefficient conventions were checked through equilibria before shipping: Lorenz (σ = 10, ρ = 28, β = 8/3) at the origin and C±, and Rössler (a = b = 0.2, c = 5.7) at its near-origin equilibrium, all resting. Chaotic behaviour is checked in aggregate (bounded boxes, repeated lobe switches and spikes, determinism within a build), never bit for bit.
- Workload: at most 12 × 50,000 attempted steps. Twelve Lorenz seeds at 2400 samples took about 0.06 s over t ∈ [0, 40] and 0.1 s over [0, 100] natively (3 MB of JSON alone, 19 MB under a tube). Over [0, 1000], each seed exhausts its budget in about 0.2 s. There is no new runtime dependency or resource category. Durable definitions are in `mathematics.md#spatial-vector-field-trajectories`, `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: `make check` passed: formatting, vet, Go race tests (engine3 coverage 99.5%, `engine/ode` 100%), the WASM bridge (helices, escape, timed field and refusals), TypeScript, and the production build and notices. `make thumbnails` regenerated the gallery. The full Chromium run passed all 536 tests before two final label edits; after them, the field, layout and consistency specs passed again. All 14 WebKit tests passed, including a PNG and H.264 export of Lorenz's two wings. Go tests cover the list in `mathematics.md#spatial-vector-field-trajectories`. Mutations that drop the escape bisection or the timed-field rule for resting seeds each fail. Browser tests cover:
  - layers and validation, with seeds added to twelve and removed to one;
  - notes on ends, escapes, equilibria, fields that are not finite at a seed, timed fields, and the carried construction;
  - a refused construction on an escaped first seed, with the trajectories still shown alone;
  - reveal, pause, resume and edit invalidation;
  - all four cameras on an `a` track;
  - a decoded MP4 with a seed track;
  - reveal and track unit tests, the curve alone on any definition, and the new scalar fields.

  The layout sweep includes the rising vortex. Light and dark desktop drawings, the thumbnails, and the phone-width controls (scroll width 390) were inspected.

- Limits: uniform time sampling, so fast excursions have fewer points (adaptive sampling remains in the backlog); constructions only on the first trajectory; an escape sphere about the origin only; no 3D direction lattice; no Poincaré sections or visitation densities; explicit integration, so stiff fields may exhaust the budget.

### Slice completed in this follow-up: 5b

- Implemented spatial cyclic pursuit as a spatial definition, `format: "pursuit"` (branch `claude/spatial-pursuit`): `pᵢ′ = vᵢ(pᵢ₊₁ − pᵢ)/|pᵢ₊₁ − pᵢ|` for 2–16 pursuers, with separate paths indexed like the base, closed connecting polygons, and an explicit capture event. It stood alone: 6a starts a different evaluator.
- Capture policy, decided before the UI: the planar policy is kept exactly, not re-derived. The planar chase's integrator, step bound `(g − ε)/(2 v_max)`, gap-relative error control, capture rule and budget moved into a dimension-free `engine/cyclic` package. The planar pursuit now runs on it with two coordinates, and its tests pass unchanged apart from renamed fields. The chase stops for everyone at the first capture; nobody merges or changes target, and no merger topology is invented. A capture at the start still draws the starts alone rather than refusing them.
- Evaluator decision: as for a field, the first pursuer's path is the base curve on which every construction runs. Its velocity is the pursuit law and its acceleration the law's exact derivative, `(v₁/d)(w − (u·w)u)`, never a difference of positions. `compile` now receives a prepared evaluator for either integrated definition.
- Added `engine3/pursuit.go` with `SpatialPursuer`, `PursuitRequest`, `PursuitPolygon`, and `PursuitResult` (paths, polygons, capture, exhausted, end, final). The interface adds pursuer groups of start x, y, z and speed (`.pair.quad`) with add/remove, the interval, **Capture distance ε**, a note (`web/spatial/pursuit.ts`), and **End the interval at the capture**. It reuses the trajectories and seeds layers as **Other pursuers** and **Starts & capture**, and adds **Connecting polygons**. The tracks are `pursuer{k}{X,Y,Z,Speed}`, `capture`, `min`, and `max`. There are three presets (four pursuers on a tetrahedron, a chase untangling a trefoil, a crown of six with a tangent ribbon), a "Spatial pursuit" gallery family, and regenerated thumbnails. Adding `pursuit` to the preset base changed every 3D fingerprint; existing images re-rendered byte-identically. An unequal-speed ribbon preset was tried first and dropped: its early capture left a short, cluttered drawing.
- Exact 3D case found for verification: four equal pursuers from a regular tetrahedron keep its rotoreflection symmetry and follow `z = hρ²`, `θ = θ₀ + ln(1/ρ)`, with a closed-form time. It is tested at every sample to 10⁻⁹.
- Workload: at most 40,000 attempted steps of one 48-dimensional system, and 16 paths of 2401 points; every preset computes in milliseconds natively. There is no new runtime dependency or resource category. Durable definitions are in `mathematics.md#spatial-cyclic-pursuit`, `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: `make check` passed: formatting, vet, Go race tests (engine3 coverage 99.6%, `engine/cyclic` 96.0%, planar engine 98.2%), the WASM bridge, TypeScript, and the production build and notices. `make thumbnails` regenerated the gallery. The full Chromium run passed 547 of 548 tests. The failure was the planar heptagon preset's note: the shared chase had replaced `math.Hypot` with a square root of summed squares, and with all seven gaps equal, rounding named a different pair. `Hypot` was restored (folded across coordinates, so a z = 0 chase rounds exactly as the planar one), a Go guard now fails the old form, and the planar pursuit, spatial pursuit, planar field and gallery specs passed again (52 tests). All 15 WebKit tests passed, including a PNG and H.264 export of the tetrahedron. Go tests cover the list in `mathematics.md#spatial-cyclic-pursuit`, and `engine/cyclic` has its own tests in one to four dimensions. Mutations that drop the acceleration's projection or the capture step bound each fail. Browser tests cover:
  - layers and validation, with pursuers added to sixteen and removed to two;
  - notes on captures, no capture, a capture at the start, and the carried construction, plus the capture button;
  - a still first pursuer refused under a construction and drawn alone;
  - reveal, pause, resume and edit invalidation;
  - all four cameras on a start track;
  - a decoded MP4 with a capture track;
  - reveal and track unit tests, and the new scalar fields.

  The layout sweep includes the crown, and WebKit exports the tetrahedron.

- Limits: uniform time sampling; constructions only on the first pursuer; polygons share the construction's line count; no pursuit with changing targets, merging, or obstacles; pursuers pass through one another when not chasing each other.

### Slices completed in this follow-up: 6a and 6b

- Implemented analytic surface studies as a spatial definition, `format: "surface"` (branch `claude/spatial-surfaces`), with:
  - normal lines;
  - a signed offset `X + dn`;
  - both focal sheets `X + n/κᵢ` from the principal curvatures.

  6a and 6b landed together, as 1a/1b and 4b's tube and canal did. An offset folds exactly where `d = 1/κᵢ`, so honest offsets already need the principal curvatures, and the "surface revealing its centers" recipe needs both. The two parts share one evaluator, one request, and one grid-sheet result type, and each has its own tests (sphere offsets, Steiner area and folds for 6a; curvatures, focal collapse, continuity and degeneracies for 6b).

- Evaluator decision, made before the UI: a surface is not a curve. `Compute` hands it to `surfaces` before anything else, every curve and construction field is ignored and not validated, and the curve fields of the result are empty. The patches are analytic with exact first and second derivatives: ellipsoid (sphere), torus (spindle torus when R < r), elliptic cylinder, paraboloid (saddle, plane), and monkey saddle. Arbitrary `X(u, v)` expressions were not added, as the roadmap asked for analytic patches first.
- Conventions: `n = X_u × X_v/|X_u × X_v|` (reversible) and `A = −dn`, so a sphere's outward normal gives `κ = −1/R` and its focal sheets collapse to the centre. Principal curvatures come from the symmetric second fundamental form in an orthonormal tangent frame, `κ = (p + s)/2 ± √(((p − s)/2)² + q²)`, which keeps a sphere's curvatures equal to rounding. Branches are numbered by `κ₁ ≥ κ₂`; reversing the normal swaps the numbers, not the geometry.
- Degeneracy policy:
  - A chart singularity (`|X_u × X_v| ≤ 10⁻⁹ max(|X_u|, |X_v|)²`) has a point but no normal, offset or focal point, and is counted.
  - Umbilics are counted, and there the focal sheets have no normal.
  - A centre beyond 100 surface radii is treated as at infinity and counted as clipped.
  - A focal edge is joined only when κᵢ keeps its sign and the focal point at the edge's midpoint is finite and does not turn back, so a sheet is never joined through infinity, even between samples.
  - A face needs four joined edges and area, so a collapsed branch is never forced into triangles. Each branch is labelled a surface, a curve, a point, or none, and drawn by its parameter curves or as a cross.
  - Offset samples beyond one focal sheet are counted as folded and drawn, not trimmed.
- Added `engine3/surface.go` with `SurfaceRequest`, `SurfaceSheet` (nullable `points` and `normals` indexed by u and v sample, `alongU`, `alongV`, `faces`), `FocalSheet` (`shape`, `clipped`), `SurfaceNormal`, and `SurfaceResult`. Grid sheets keep parameter identities, as the architecture notes asked for surfaces; Go decides every edge and face, and the renderer only splits faces into triangles. The interface adds:
  - **Spatial definition · Surface patch**, with the kind, its shape fields, and the u and v domains;
  - **Normal**, **Offset d**, **Normal reach ℓ** (a signed segment from X to X + ℓn), and a note (`web/spatial/surface.ts`);
  - grid controls (**u samples**, **v samples**, **Parameter curves**);
  - the layers **Surface patch**, **Parameter curves**, **Normal lines**, **Offset surface**, **Focal sheet 1 · κ₁** (rust) and **Focal sheet 2 · κ₂** (slate), with new shader inks;
  - tracks for the shape, offset, reach, domain and grid, and a reveal that grows every sheet along u;
  - four presets (a torus revealing its centers, a sphere collapsing to one focus, the focal sheets of an ellipsoid, an elliptic cylinder and its evolute) in a new "Surface normals and focal sheets" gallery family, with thumbnails.

  Normal lines began as segments ±ℓ; a signed one-sided reach replaced them, so inward normals run to their centres. A saddle preset was tried and dropped: from the default camera one focal sheet always stands between the viewer and the saddle. Adding `surface` to the preset base changed every 3D fingerprint; existing images re-rendered byte-identically.

- Workload: at most 240 samples each way and 14,400 cells, three extra evaluations per sample for the focal edges' midpoints, and four sheets. The largest ellipsoid grid with an offset, normal lines and 48 curves each way took about 20 ms natively and about 10 MB of JSON. There is no new runtime dependency or resource category. Durable definitions are in `mathematics.md#spatial-surfaces-normals-offsets-and-focal-sheets`, `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: `make check` passed: formatting, vet, Go race tests (engine3 coverage 99.6%), the WASM bridge (sphere offsets, focus, singularities and lines, a torus's core circle, refusals), TypeScript, and the production build and notices. `make thumbnails` regenerated the gallery. The full Chromium run passed all 559 tests, and all 16 WebKit tests passed, including a PNG and H.264 export of the ellipsoid preset. Go tests cover the list in `mathematics.md#spatial-surfaces-normals-offsets-and-focal-sheets`. Mutations that drop the midpoint test, the sign test, the degenerate-face test, or the stable eigenvalue formula each fail. Browser tests cover:
  - controls, layers and validation, including grid counts, a kind change, and a return to a curve that keeps the surface;
  - notes on collapsed, surface and infinite branches, chart singularities, umbilics, folded offsets, a reversed normal and a plane;
  - reveal along u, pause, resume and edit invalidation;
  - all four cameras on a shape track;
  - a decoded MP4 with an offset track;
  - reveal and track unit tests, and every new scalar field.

  The layout sweep includes the torus and ellipsoid presets. Light and dark desktop drawings, the thumbnails, and the phone-width page and controls in both themes (scroll width 390) were inspected.

- Limits:
  - analytic patches only, with no surface expressions or surfaces from the curve constructions;
  - uniform parameter grids, so a focal sheet's fast flaring near a parabolic curve is sampled coarsely;
  - branches are classified as a whole, not region by region, and cuspidal edges are drawn but not located or counted;
  - no ridge, umbilic, or line-of-curvature tracing;
  - opaque sheets, so interior focal sheets need an opened domain or a hidden surface;
  - presets cannot set the camera or layers.

Recommended next step: **7a, single-interaction reflected ray families and their caustic sets**. It can reuse this slice's surface evaluator and normals: begin with parallel rays on a paraboloid and a spherical reflector, checking the reflection law and the exact focal points, before any UI.

### Slice completed in this follow-up: 7a

- Implemented single reflections from the analytic surface patches as a spatial definition, `format: "rays"` (branch `claude/spatial-mirrors`): the reflected ray family, its two caustic branches, and representative incident, reflected and virtual rays. 7a shipped alone. 7b's refraction needs explicit indices and total internal reflection, and its receiver-plane density needs its own result type with emitted weights, area normalization and energy accounting; neither shares 7a's caustic result.
- Evaluator decision, made before the UI: the mirror is the surface study's patch, not a new surface type. `rays` reuses `SurfaceRequest.patch` and the grid, sheet, classification and continuity helpers, validates only the patch (`validatePatch`), and ignores the surface study's offset and normal reach.
- Conventions:
  - Parallel light travels along `(cos β cos α, cos β sin α, sin β)` in degrees, exact at right angles, which reduces to the planar `(cos θ, sin θ)` at β = 0. A point source gives `I = (X − S)/|X − S|`.
  - The declared normal is the mirror side: a sample is lit only where `I·n < −10⁻⁹`. Nothing is occluded and there is no second bounce.
  - `R = I − 2(I·n)n`, with exact derivatives from the patch's second derivatives.
  - The caustic condition `det(Y_u, Y_v, R) = 0` is solved as the eigenproblem of the reflected wavefront's shape operator `W = −B̄Ā⁻¹` across R, so `C = X + R/μ` in the focal sheets' sign convention. μ > 0 is real, ahead of the mirror; μ < 0 is virtual.
  - The eigenvalues come from W's symmetric part, as κ's do. Its antisymmetric part, the twist, vanishes by Malus–Dupin and is a test residual.
  - Branches are ordered μ₁ ≥ μ₂, which stays continuous where a branch passes through infinity; ordering by λ would not.
- Degeneracy policy:
  - Unlit (grazing or from behind), at-source and chart-singular samples have no reflection and are counted.
  - Stigmatic samples (μ₁ = μ₂) are counted and have no caustic normal.
  - A caustic point beyond 100 surface radii is at infinity and counted as clipped.
  - Each branch is split into real and virtual parts, and edges follow the focal sheets' rule (same sign, a lit finite midpoint that does not turn back). A caustic is therefore never joined through infinity, from real to virtual, past the edge of the light, or across its own cusps.
- Added `engine3/rays.go` with `RaysRequest`, `Ray` (`start`, `point`, `end`, `back`, `virtual`), `CausticSheet` (a grid sheet with `branch`, `virtual`, `shape`) and `RaysResult`. The interface adds:
  - **Spatial definition · Mirror · reflected rays**, sharing the surface controls, with **Mirror side**;
  - **Light** (**Parallel light** with **Azimuth α (°)** and **Elevation β (°)**, or **Point source** with **Source x/y/z**), **Ray length ℓ**, and a note (`web/spatial/rays.ts`);
  - the layers **Mirror**, **Parameter curves**, **Incident rays** (with the source), **Reflected rays**, **Caustic 1 · μ₁** (rust), **Caustic 2 · μ₂** (slate), and **Virtual rays & caustics**, where virtual parts are drawn only as lines;
  - tracks for the shape, direction or source, ray length, domain and grid, and a reveal along u;
  - five presets (a paraboloid gathering light, a tilted beam folding into coma, a spherical bowl's cusped caustic, an ellipsoid refocusing its lamp, a cup's nephroid) in a new "Mirrors and caustics" gallery family, with thumbnails.

  Virtual extensions were first drawn behind every ray and swamped the concave mirrors, whose caustics are all real. Go now marks a ray virtual only where one of its caustic points is, and only those extensions are drawn. Adding `rays` to the preset base changed every 3D fingerprint; existing images re-rendered byte-identically.

- Workload: the surface study's limits (at most 240 samples each way and 14,400 cells), one extra reflection per edge for the midpoint test, and four caustic sheets. The largest torus grid under oblique light, with 48 curves each way and 1,159 rays, took about 11 ms natively and about 6.3 MB of JSON. There is no new runtime dependency or resource category. Durable definitions are in `mathematics.md#spatial-mirrors-reflected-rays-and-caustics`, `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: `make check` passed: formatting, vet, Go race tests (engine3 coverage 99.6%), the WASM bridge (a paraboloid's focus and rays through it, a plane mirror's virtual image and virtual rays, unlit samples, refusals), TypeScript, and the production build and notices. `make thumbnails` regenerated the gallery. The full Chromium run passed all 570 tests, and all 17 WebKit tests passed, including a PNG and H.264 export of the coma preset. Go tests cover the list in `mathematics.md#spatial-mirrors-reflected-rays-and-caustics`. Mutations that join every caustic edge or drop the grazing tolerance each fail. Symmetrizing W survives, as expected: the twist test shows it is already symmetric to rounding. Browser tests cover:
  - controls, layers and validation, including a point source, the shared patch when switching to a surface study, and an empty virtual layer when every caustic is real;
  - notes on point, surface and curve caustics, a dome's virtual focus, a saddle's real and virtual parabolas, a plane's image, a sample at the source, unlit, singular, stigmatic and clipped samples;
  - reveal along u, pause, resume and edit invalidation;
  - all four cameras on an elevation track;
  - a decoded MP4 with a moving source;
  - reveal and track unit tests, and every new scalar field.

  The layout sweep includes the coma and ellipsoid presets. Light and dark drawings, the thumbnails, and the phone-width controls and explanation in both themes (scroll width 390) were inspected.

- Limits:
  - analytic patches only, one reflection, and no occlusion, so a ray may pass through another part of the mirror (the bowl preset's lowest axis caustic is reached that way);
  - no refraction, receiver plane, or intensity, all of which belong to 7b;
  - uniform parameter grids, so a caustic's fast flaring near grazing light is sampled coarsely;
  - cuspidal edges break the sheet but are not located or counted;
  - the virtual layer is shared by both branches;
  - opaque sheets, so a virtual caustic inside a convex mirror needs the mirror hidden;
  - presets cannot set the camera or layers.

Next step at the time: 7b, below.

### Slice completed in this follow-up: 7b

- Implemented refraction and a receiver plane together (branch `claude/spatial-refraction`), as the two halves of one roadmap slice: both act on the same outgoing ray family, and the receiver serves reflection and refraction alike. They stay separate types. Refraction only changes the outgoing direction; the receiver is its own request and result (`ReceiverRequest`, `Receiver`) with its own energy model, designed and tested in Go before any UI.
- Conventions:
  - `rays.interaction` is `"reflect"` or `"refract"`, with no default. The declared normal marks the incident medium n₁, and `η = n₁/n₂`. Light from the n₂ side is unlit, so no inside or outside is inferred.
  - `T = ηI + (ηc − √k)n`. At or beyond the critical angle (`√k ≤ 10⁻⁹`) the sample is counted as totally reflected, has no caustic point, and its representative ray is drawn along the reflection in grey.
  - Both interactions are `D = aI + bn` with exact derivatives, so W, the caustics, the joins and the classification are the mirror's, with T in place of R.
  - Receiver: an axis-aligned plane with a square window and 8–240 bins each way.
    - Each cell emits its midpoint flux, `E|I·n||X_u × X_v|ΔuΔv`, with unit beam irradiance or unit intensity.
    - Each traced cell's flux is spread evenly over its corners' two crossing triangles, and bins take exact areas (a box filter of the piecewise-linear ray map).
    - Every emitted unit is received, outside, away, totally reflected, or at the edge.
    - There are no Fresnel losses and no shadows.
    - The shade is a labelled logarithmic ramp over three decades, without hue.
- UI and presets:
  - The definition became **Mirror or interface · rays**, and **Interaction** chooses between them.
  - A refracting study adds **Index n₁**/**Index n₂**, and its normal is labelled **Incident side**.
  - **Receiver** adds the plane's position, window size, centre, bins, and the **Receiver irradiance** layer.
  - New tracks: the indices, the plane's position and the window's size. A reveal withholds the receiver until complete.
  - Four presets form a "Refraction and receivers" gallery family: a glass ellipsoid focusing a beam, a glass dome's ring of light, a lamp in water over air, and a cup's nephroid on its floor.
  - Two drafts were dropped after rendering:
    - a monkey-saddle pool, whose caustics reach 100 radii from its flat centre and swamp the framing;
    - Snell's window seen from above, where the opaque plane hides everything behind it.
  - A lamp in a glass ball was also dropped: its tangential caustic runs far out near the critical angle.
- Workload: the surface study's grid limits, one extra ray per cell for the receiver's midpoint, and at most 57,600 bins. The rasterizer's work grows with the bins that triangle edges cross. A 240 × 60 torus refracting onto 240² bins took about 25 ms natively (11 ms without the receiver) and 7.2 MB of JSON. There is no new dependency or resource category.
- Permanent docs: `mathematics.md#spatial-refraction-and-caustics` and `#spatial-receiver-planes-and-irradiance`, `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: see the pull request and `mathematics.md` for the tests; mutations of the refraction derivative, the receiver's area weight, inverse square, triangle split, backward-crossing test, edge splitting and span coverage each fail.
- Limits:
  - one interaction, with no reflected share of refracted light, second interface, Fresnel weights, dispersion or occlusion;
  - axis-aligned receiver planes with square windows;
  - the receiver's resolution is bounded by the surface grid, since each cell's image carries a constant density;
  - a real caustic's bins are bright but finite, and no bin is a pointwise brightness;
  - the default oblique camera shows a small receiver small;
  - presets cannot set the camera or layers.

### Slice completed in this follow-up: 8

- Implemented bounded implicit surfaces and their sections (branch `claude/spatial-implicit`). The topology and memory-budget prototype came first, as Go tests and a native workload probe, before any UI.
- Conventions:
  - `format: "implicit"` meshes `F(x, y, z) = c`, an expression in x, y, z and `a` through the existing `expr.ParseSpatialField` binding, refusing `t`, inside a declared box of 4–128 cells along its longest side and at most 262,144 cells.
  - Meshing is marching tetrahedra on the Kuhn subdivision, the same in every cube, so there is no ambiguous tetrahedron. Grid faces whose corners alternate are counted and reported, since there the split decides the topology.
  - Vertices are solved on F (Illinois false position with a bisection safeguard, to 10⁻¹² of the edge), shared through an edge-to-vertex map, so the result is an indexed mesh. A sign change that does not shrink with its bracket (the 2D notebook's test) is a pole or jump: marked, counted, and its tetrahedron left out. Cubes touching an undefined grid point are left out.
  - Normals are `∇F/|∇F|` by five-point differences; a vanishing or undefined gradient leaves a vertex without one, counted. Triangles face larger F.
  - The note reports pieces, closedness and Euler characteristic (genus when closed), and the box's cut edges apart from open edges beside cells left out.
  - Sections are planes `n̂·p = d` traced by the planar implicit-curve tracer itself, through a new `engine.TraceLevel` with a shared `ContourBudget`, on a grid of four times the box's cells, at most 256.
- UI and presets: **Implicit surface · F(x, y, z) = c** with its expression, level, a, box, and section planes; **Cells** under sampling; four layers; a reveal that rises through the box; tracks for the level, a, section offsets, cells and plane count. Seven presets form an "Implicit surfaces and sections" gallery family: a sphere and its latitudes, the spiric sections of Perseus, Villarceau circles, two drops meeting, a double torus, the tanglecube, and a gyroid cut open.
- Workload: at most 200,000 triangles and 400,000 grid edges searched, both refused beyond, not truncated. Measured natively: a one-period gyroid at 64³, 0.12 s and 8.8 MB of JSON; the tanglecube at 64³, 0.2 s (0.48 s and 13.4 MB with 24 sections); a 128 × 128 × 9 box with 24 sections, 0.35 s and 20 MB. Section grids were capped at 256 cells after the probe showed 512 doubled the time for no visible gain. There is no new dependency or resource category.
- Permanent docs: `mathematics.md#spatial-implicit-surfaces-and-sections` (with a tanglecube reference study), `architecture.md`, `usage.md`, `spatial-study.md`, and README.
- Verification: see the pull request and `mathematics.md` for the tests and mutations.
- Limits:
  - uniform grids only, so topology is resolved at the grid: a neck or piece thinner than a cell can be pinched or missed, and a singular point on a grid point joins pieces by one vertex;
  - a tilted section stops within one of its cells of the box;
  - the mesh is a picture and feeds no curvature, focal or optical construction;
  - JSON transport of the largest meshes reaches 20 MB, so a level track on a large study plays slowly;
  - presets cannot set the camera or layers.

Every numbered slice is now complete. The backlog below remains open. Recommended next steps, for the user to choose between:

- **Saved studies and portable links**, which every notebook would use;
- **Adaptive meshes**, starting with bounded octree refinement of implicit surfaces near thin necks and alternating faces, reporting budget exhaustion;
- **Mesh identities and efficiency**: the implicit study's indexed mesh is the first shared-vertex result, and typed transport would shrink its JSON.

Keep this roadmap while future work remains. As decisions become shipped behavior, move durable definitions and limitations into permanent docs. When every selected item has been completed or explicitly declined, reconcile remaining candidates and retire the roadmap and its inbound links rather than leaving a stale completed plan.
