# Mathematical art expansion roadmap

This is a temporary implementation plan for the approved expansion of Tangent Garden. All nine families below are in scope, delivered as small, independently verified changes. It is not a claim that uncompleted features exist. Read `AGENTS.md`, `README.md`, `docs/mathematics.md`, and `docs/architecture.md` before implementation. Update the checkboxes and handoff notes with each completed slice.

## Product goal

Explore the relationship between a simple mathematical rule, its visible construction, and an intricate result. Keep the curve and its generating geometry central: rolling circles, projection segments, wavefront circles, connecting chords, pursuit polygons, and density accumulation should explain the artwork. Remain a local, browser-based mathematical notebook, with no scene editor, backend, telemetry, or implicit physical topology. All initial work is planar.

Support all nine families: pedals and related projections; offsets/wavefronts; roulettes; generalized envelopes; inversion; harmonic curves; pursuit/vector-field trajectories; implicit curves; and strange attractors. Some named curves already fit the expression parser. Their addition should offer meaningful controls and visible constructions, not merely another formula preset.

## Proposed implementation order and progress

- [x] 1a. Pedal curves: Go projection, independent pole controls, construction segments, preset, animation, exports, analytic and browser tests.
- [x] 1b. Contrapedals and orthotomics using the same pole and projection geometry.
- [x] 2a. Single signed normal offset with distance animation.
- [x] 2b. Offset families and generating circles; introduce the minimal multiple-path/circle result model needed for this slice.
- [ ] 3a. Circle-on-circle and circle-on-line roulettes with rolling geometry and closure controls.
- [ ] 3b. Circle rolling on an arbitrary regular input curve, then general rolling curves where well-defined.
- [ ] 4a. General line envelopes, including chords between two moving points.
- [ ] 4b. Moving-circle families and their real envelope branches.
- [ ] 5. Circle inversion, including application to generated and derived curves.
- [ ] 6. Harmonic/Lissajous generators and finite Fourier epicycle controls.
- [ ] 7a. Cyclic pursuit with explicit collision policy.
- [ ] 7b. Planar vector-field trajectories with bounded integration.
- [ ] 8. Implicit curves and contour families, including topology changes.
- [ ] 9. Curated iterated maps and strange-attractor density rendering.
- [ ] Final integration: compatible generator/construction combinations, documentation, presets, animation/export verification, and removal of this temporary plan.

The order favors familiar geometry and reuse before new numerical methods. Do not implement all phases in one change. Pedals land first because they need only first derivatives and point projection, work with every existing input format, and have strong independent analytic checks. Offset stacks motivate multiple paths; roulettes motivate explicit generators; inversion motivates composition. Avoid a speculative framework before these concrete requirements exist.

## Architectural direction

Evolve toward `generator → optional construction/transform → drawing`, retaining the pure Go engine, synchronized Go/TypeScript transport, worker scheduling, and shared SVG/export renderer. A roulette should eventually accept an evolute or pedal; an inversion should be able to consume a derived curve. Not every generator supports differentiation (notably discrete attractors). Encode capabilities and disable invalid combinations rather than pretending every result is a smooth curve.

Current touchpoints: `engine/engine.go` dispatches constructions and returns one base path, one derived path, and representative rays; `engine/curve.go` parses and differentiates expressions; `cmd/wasm` is transport; `web/types.ts` mirrors Go; `web/engine.worker.ts` validates numeric inputs before JSON serialization; `web/main.tsx` owns controls/descriptions; `web/Plot.tsx` owns drawing and framing; `web/animation.ts` owns tracks/reveal; `web/AnimationPanel.tsx` owns sessions; exports reuse the renderer and sampler. Presets live in `web/presets.ts`.

Introduce typed paths with explicit gaps and identities, segments, and circles only as needed. Multiple trajectories and density fields need distinct result types. Do not force circles or discrete iterates into the optical `Ray` semantics. Preserve correspondence/sample identity for reveal animations, and fit each point family independently before combining bounds. Circle extents must participate in framing deliberately. Prefer evaluating composed constructions from a mathematical evaluator; repeatedly differentiating uniformly sampled polylines is not a reliable composition strategy.

Separate geometric poles from optical sources. Initial Cartesian pole coordinates can grow a polar editor later; polar interpolation must occur in radius/angle before Go resolves the point. Existing optical-source conventions remain independent. Every applicable numeric control should be animatable with scalar endpoints parsed in Go. New controls must retain input revision cancellation, immutable base studies, bounded work, exact endpoints, and all four camera modes.

## Mathematical contracts and acceptance details

Let `r(t)` be regular, `T=r'/|r'|`, `N=JT` the left unit normal, and `P` a pole. Preserve invalid samples as explicit gaps. Use derivative checks appropriate to the construction's required order: a first-derivative construction must not fail solely because a second derivative is ill-conditioned. Existing absolute tolerances are limitations, not guarantees of scale independence.

### 1. Pedal family

Pedal: `H=r+dot(P-r,T)T`, the orthogonal projection of P onto the tangent line. Contrapedal: `K=r+dot(P-r,N)N`, projection onto the normal. Orthotomic: `Q=2H-P`, reflection of P across the tangent. Group related choices rather than advertising the orthotomic as unrelated to the pedal. Draw the tangent/normal segment from r to its foot and the pole-to-foot perpendicular; distinguish any reflected segment clearly.

Verification: H lies on the tangent, `(P-H)·T=0`; a circle with central pole is its own pedal; a pole on a circle produces a cardioid; a line has a single pedal point; orthotomic reflection preserves distance to the tangent. Check rigid motions, regular reparameterization/orientation reversal, endpoints, stationary points, nonfinite poles, and discontinuities. A pole on the base curve is valid, unlike a coincident optical point source. Pole coordinates must not overwrite light-source settings.

### 2. Offsets and wavefronts

`r_d=r+dN`, with positive d toward the left normal. The two offsets ±R form the envelope of radius-R circles centered on r. For arclength parameter s, `dr_d/ds=(1-dκ)T`; offset singularities occur where `1-dκ=0` and lie on the evolute. These are mathematical offsets retaining folds and self-intersections, not a trimmed outer boundary or a physical first-arrival wavefront.

Single distance first; then bounded stacks with explicit range/count and optional generating circles. Test circles (including collapse to a point), lines, orientation reversal with distance sign reversal, known cusp onset, and family framing. Do not silently discard valid offset cusps just because the derived speed vanishes.

### 3. Roulettes

Start with inside/outside rolling circles and rolling along a line. For a circle of radius r rolling inside radius R: `x=(R-r)cos(t)+d cos((R-r)t/r)`, `y=(R-r)sin(t)-d sin((R-r)t/r)`. Require R>r>0; d is the tracing-point distance from the rolling center. Outside: replace R-r with R+r and use `x=(R+r)cos(t)-d cos((R+r)t/r)`, `y=(R+r)sin(t)-d sin((R+r)t/r)`. State initial phase/orientation conventions.

Expose radii, tracing offset, phase, interval/turns, and the moving circle/contact point. Rational radius ratios permit exact closure; arbitrary real values must not be forcibly closed. Bound closure denominators and total work. General-base rolling requires arclength, tangent orientation, and a documented contact side; it is not obtained by blindly substituting a base curve into the circular formula. Test no-slip contact velocity, analytic circular/linear reductions, closure, and arclength convergence. General curve-on-curve rolling is a later slice with explicit contact matching, not physical collision simulation.

### 4. General envelopes

Lines `F(t,λ)=r(t)+λd(t)` use the existing determinant envelope formula. Permit a direction-angle function or endpoints on two curves. A first accessible preset connects `(cos t,sin t)` to `(cos(mt+φ),sin(mt+φ))`. The m=2, φ=0 family has a cardioid envelope. Coincident endpoints require gaps or explicitly justified limits; infinite lines and finite chords have different visible extents.

For circles with center c(t) and positive radius R(t), solve `|q|²=R²` and `q·c'=-RR'`, where q=X-c. With v=|c'|>0 and T=c'/v, the two candidates are `q=-RR'/v T ± R sqrt(1-(R'/v)²) JT`. Real branches require |R'|≤v; equality merges the branches. Stationary centers need separate degeneracy handling. Verify both equations, constant-radius offsets, branch counts/mergers, and no-real-envelope intervals. General implicit families `F=0, ∂F/∂t=0` can come later; this necessary system can include extraneous or degenerate components and is not a universal finished solver.

### 5. Inversion

`I(p)=O+R²(p-O)/|p-O|²`, R>0. Add a movable center, radius, inversion circle, and correspondence segments. Test involution, `|I(p)-O||p-O|=R²`, and line/circle mappings. Crossing O creates an unbounded branch, never a segment across infinity. Adaptive subdivision/branch checks are needed even if no sampled point equals O. Document circle inversion as orientation-reversing, not a holomorphic Möbius map. More complex transformations are optional extensions, not substitutes for inversion.

### 6. Harmonics

Lissajous: `x=A sin(mt+φ), y=B sin(nt)`. Fourier curves: `z(t)=Σ c_k exp(ikt)` with signed integer frequencies for a closed 2π-periodic curve. Give amplitudes, phases, frequencies, and visible rotating vectors/circles; bound the term count. Distinguish exact periodic closure from arbitrary real-frequency exploration. These curves already fit expressions; the feature is a usable generator with meaningful construction geometry. Verify periodicity, single-term circles, zero terms, known Lissajous cases, and analytic derivatives. Keep exported metadata sufficient to reproduce every coefficient.

### 7. Pursuit and vector fields

Cyclic pursuit: `p_i'=v_i (p_{i+1}-p_i)/|p_{i+1}-p_i|`. Define collision termination/merging explicitly; do not divide by zero or silently change pursuit topology. Equal-speed regular polygons produce logarithmic spirals and remain similar. Then add `r'=V(r,t)` with bounded seed count, duration, steps, and domain. General ODEs need adaptive error control, termination events, and convergence tests. Regular polygon invariants, straight/rotational vector fields, and step refinement provide independent checks. Store trajectories separately; reveal must have a defined time meaning when adaptive step counts differ.

### 8. Implicit contours

Accept bounded scalar fields `F(x,y)=c` through the Go parser, extended with explicit variable bindings without executable input. Cassini ovals satisfy `((x-a)²+y²)((x+a)²+y²)=b⁴`; b<a yields two components, b=a a lemniscate, b>a one oval. Support contour levels and a bounded spatial domain/grid, then adaptive refinement. Resolve ambiguous marching cells deliberately, avoid joining disconnected components, and distinguish poles from zero crossings. Test analytic circles/lines, Cassini component changes, saddles, isolated zeros, equation residuals, and refinement convergence. Differentiable regular branches may feed later constructions only after a suitable evaluator exists.

### 9. Strange attractors

Start with curated planar iterated maps such as Clifford: `x_next=sin(a*y)+c*cos(a*x)`, `y_next=sin(b*x)+d*cos(b*y)`, updating both from the previous point. Use a deterministic seed, transient discard, iteration cap, and a bounded visitation-density grid. Never join discrete iterates as a continuous curve. Coefficients do not guarantee chaos; describe these as iterated maps unless a stronger claim is established.

Density output needs a raster rendering/export path alongside SVG geometry. Define whether vector export embeds the density image and label that honestly. Render each export at target resolution rather than upscaling. Reuse the same sampling semantics for live and exported animation, with bounded memory and cancellation. Test deterministic iteration, finite/escaped states, density totals, seed/transient semantics, resource budgets, and independent decoding of actual exports. Review CSP and the matching cloud-accounts policy before adding resource types.

## Reproducing the proposal's visual studies

These are mathematical recipes, not committed screenshots or exact pixel specifications. Use equal axis scale and independently frame each study.

- Hypotrochoid: R=5, r=2, d=3, t∈[0,4π], with base and rolling circles.
- Offset stack: base `r(t)=1+0.18 cos(5t)` in polar form, t∈[0,2π], signed offsets d=0.105k for integer k=-9,…,8.
- Pedal: ellipse `(2 cos t,1.1 sin t)`, pole `(1.65,0.3)`, t∈[0,2π], 64 representative projection constructions.
- Chords: connect circle angles t and 4t at 200 evenly spaced phases. The proposal showed the chords, not a separately solved envelope.
- Pursuit: seven equal-speed cyclic pursuers starting on the unit regular heptagon. Exact loci can be plotted as `exp(-tan(π/7)θ)(cos(θ+2πj/7),sin(θ+2πj/7))`; θ is an angular parameter, not constant-speed time. Show intermediate connecting polygons.
- Clifford density: `(a,b,c,d)=(-1.4,1.6,1,0.7)`, initial point `(0.1,0.1)`, discard 1,000 iterates, accumulate the next 800,000. The proposal used logarithmic density coloring. It was a computed illustrative plot, not proof of chaotic dynamics.

## References

Read relevant sources when implementing; verify conventions rather than copying graphics or assuming an illustration validates numerics.

- [Pedal curves — MathCurve](https://mathcurve.com/courbes2d/podaire/podaire.shtml)
- [Parallel curves — MathCurve](https://mathcurve.com/courbes2d.gb/parallele/parallele.shtml)
- [Trochoids on arbitrary bases — MathCurve](https://mathcurve.com/courbes2d.gb/trochoidgene/trochoidgene.shtml)
- [Hypotrochoids — MathCurve](https://mathcurve.com/courbes2d.gb/hypotrochoid/hypotrochoid.shtml)
- [Envelopes of plane curve families — MathCurve](https://mathcurve.com/courbes2d.gb/enveloppe/enveloppe.shtml)
- [Cardioid constructions, including chord envelopes — MathCurve](https://www.mathcurve.com/courbes2d/cardioid/cardioid.shtml)
- [Inverse curves — MathCurve](https://www.mathcurve.com/courbes2d/inverse/inverse.shtml)
- [Lissajous curves — MathCurve](https://mathcurve.com/courbes2d.gb/lissajous/lissajous.shtml)
- [Mutual pursuit — MathCurve](https://mathcurve.com/courbes2d.gb/poursuite/poursuitemutuelle.shtml)
- [Cassini ovals — MathCurve](https://mathcurve.com/courbes2d.gb/cassini/cassini.shtml)
- [Strange Attractors: Creating Patterns in Chaos — J. C. Sprott](https://sprott.physics.wisc.edu/SA.HTM)
- [Clifford attractors and density rendering — Paul Bourke](https://paulbourke.net/fractals/clifford/index.html) (automated access may be restricted)

## Completion gate for each slice

Ship Go computation, synchronized transport, usable controls, at least one verified preset, visible construction geometry, applicable animation tracks, and shared live/export rendering together. Update permanent mathematics/usage/architecture docs and README feature claims. Keep old studies and defaults working. Add analytic/geometric regression tests and convergence checks when approximation methods change, plus the real WASM bridge test. Run `make check` and `make test-browser`; add relevant WebKit checks when touching encoding or browser-specific behavior. Inspect both themes and a narrow viewport, desktop sidebar scrolling, custom sample/line counts, and scalar validation.

For animation changes exercise exact endpoints, reveal, cancellation on edits, pause/resume, scrubbing, all camera modes, and unchanged manual camera after stopping. Export changes require independent decoding of actual files, including timing and endpoints. Do not mark a slice complete on the basis of a screenshot or unrun tests. Record limitations explicitly. Preserve generated-output/dependency exclusions and all three distribution license notices. Never deploy except via the repository's documented main-branch workflow; this roadmap does not authorize publication or merging.

## Handoff notes

Completed slice 1a on `codex/curve-expansion-pedals`: `engine/pedal.go`, first-derivative-only stability checks, independent Cartesian `pole`, controls/marker/projection segments, “Ellipse & its pedal” preset, `poleX`/`poleY` tracks, and shared export rendering. Permanent docs describe the supported behavior. No runtime dependencies or resource types were added.

Verification: `make check` passed (formatting, vet, native race/coverage, analytic WASM bridge, TypeScript, build, distribution notices). All 112 Chromium tests passed, including new pole/projection tests and independently decoded pedal MP4/WebP files. Layout inspected in light/dark themes at desktop and phone widths. The local default test port was occupied by another project, so the complete suite used an isolated preview and a temporary local Playwright configuration; do not use `BASE_URL` for an uncompressed local preview, since the smoke test treats it as a deployed site. No test harness override or machine-specific path is committed. WebKit was not run for this slice; encoding implementation is unchanged.

Completed slice 1b on `claude/curve-expansion-contrapedal-orthotomic`: `contrapedal` and `orthotomic` kinds in `engine/pedal.go` built on the pedal foot, a single **Pedal** tab with a **Projection** selector that remembers the variant, “Ellipse & its contrapedal” and “Ellipse & its orthotomic” (focus → circle) presets, dashed reflected H→Q segments with the foot recovered as (P+Q)/2, shared pole tracks/framing/marker. Tests cover analytic circles, lines, parabola directrix, ellipse focus circle, the rectangle identity H+K=r+P, reflection invariants, rigid motions with orientation reversal, reparameterization, contrapedal = pedal of evolute, C1 inputs, stationary gaps, and nonfinite poles, plus the WASM bridge and browser/export checks.

Completed slice 2a on `claude/curve-expansion-offset`: `offset` kind in `engine/offset.go` with a separate signed `distance` request field (not the involute `offset`), first-derivative-only stability via `firstOrder`, an **Offset** tab with a distance control, the “Flower & its offset” preset (polar `1+0.18cos(5t)`, d=0.4, swallowtails at the tips), normal construction segments, a `distance` animation track, and shared export rendering. Tests cover circles (inward, outward, clockwise, collapse to the center, through the center), lines, orientation reversal with sign reversal, rigid motion, reparameterization, Steiner length convergence, cusp onset at d=1/2 on the parabola with cusps on the evolute, C1 inputs, stationary gaps, and invalid distances, plus the WASM bridge and browser/export checks including short-arc framing. The phone tab grid now uses three columns for six tabs. Animation interpolation was changed to `from·(1−p)+to·p` so endpoints are exact; the old form missed by one ulp for some values.

Completed slice 2b on `claude/curve-expansion-offset-family`: an optional `stack` (enabled, from, to, count) on the offset request, returning `Result.family` paths (distance plus base-indexed points with null gaps) in place of `derived`, and `circles` requesting `Result.circles` (sample index, center, radius R = |d| or max(|from|,|to|)). Both arrays are always present. Bounds: 2–64 members, at most 131,072 points, distances within ±100000. Normal segments span `min(0,from,to)`…`max(0,from,to)`. Offsets tab gains an **Offsets** selector, stack fields, and a **Generating circles** checkbox; circles hide with construction lines but always take part in framing via their extreme points; each member is fit independently. Tracks `stackFrom`, `stackTo`, `stackCount` (rounded) replace `distance` in stack mode; reveal slices members and filters circles by sample. Presets “Flower & its offset stack” (the reference study, d=0.105k, k=−9…8) and “Circles & their envelope” (ellipse, ±0.5). Tests cover concentric circle stacks, exact/descending endpoints, member = single offset bitwise, Steiner lengths for every member, the circle envelope (circles pass through both ±R points and never cross the offsets below the least radius of curvature), circle radius rules, stack/circle isolation from other kinds, bounds, gaps, and JSON, plus the WASM bridge, browser controls/framing/reveal/animation in all camera modes, SVG export, and decoded WebP/MP4 exports.

Next: 3a, circle-on-circle and circle-on-line roulettes. The `Circle` result type and per-path framing from 2b are available for the rolling circles. Polar pole editing remains a later optional enhancement; do not overload optical-source state. Keep later phases unchecked until fully verified.

## Final task: delete this document

Once every item above is implemented and verified, move any remaining durable definitions, conventions, examples, limitations, and references into the permanent project documentation. Then delete this roadmap and remove links to it. Do not retain it as a stale completed plan.
