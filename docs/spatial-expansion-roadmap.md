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

- [ ] 1a. One spatial involute with an arc-length anchor and visible unwinding segments.
- [ ] 1b. Bounded involute families with independently framed members and stable reveal identities.
- [ ] 2a. Spatial tangent-foot projection and orthotomic, with an independent 3D pole.
- [ ] 2b. Sphere inversion of a base or supported derived space curve.
- [ ] 3a. Structured spatial harmonic generators and visible generating vectors.
- [ ] 3b. Rotation-minimizing frames, normal-plane offsets, and explicitly framed ribbons.
- [ ] 4a. Two-curve ruled surfaces and chord families.
- [ ] 4b. Constant-radius tube envelopes, followed by variable-radius canal surfaces.
- [ ] 5a. Bounded 3D vector-field trajectories and curated continuous attractors.
- [ ] 5b. Spatial cyclic pursuit with explicit capture events and multiple paths.
- [ ] 6a. Parametric surface studies with normal congruences and signed offsets.
- [ ] 6b. Focal surfaces from principal curvature, with explicit degeneracy handling.
- [ ] 7a. Single-interaction reflected ray families and their caustic sets.
- [ ] 7b. Refraction and separately defined receiver-plane intersection/density studies.
- [ ] 8. Bounded implicit surfaces and section curves, after a topology and memory-budget prototype.

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

Recommended first implementation: **1a, one spatial involute**. Add arc length and a derived-path result to `engine3`, verify the circle/helix identities, then add the construction choice, c control/track, correspondence segments, and a preset. Keep involute stacks, framing methods and new surface classes out of that first PR.

Keep this roadmap while future work remains. As decisions become shipped behavior, move durable definitions and limitations into permanent docs. When every selected item has been completed or explicitly declined, reconcile remaining candidates and retire the roadmap and its inbound links rather than leaving a stale completed plan.
