# Tangent Garden: an expansion roadmap

_Proposed October 25, 2026; direction and delivery waves accepted October 26, 2026. Grounded in repository revision `3204655` and a visual survey of the live notebooks._

Tangent Garden's next chapter should make a simple mathematical rule become an astonishing picture: a square grid blossoms into curved lace, a thread draws a whole surface, a staircase opens into a neck, or a journey returns to its starting point on a different sheet.

The strongest expansion combines three things: better ways to discover the beauty already present, better ways to compose it into images and motion, and a few new mathematical subjects with unmistakable visual identities. More controls alone are not the objective. Each substantial addition should earn its place with a memorable still, a revealing animation, and a construction the viewer can understand.

**Recommended starting sequence:** curated journeys, a small collection of nodal-pattern studies, then a parameter atlas. Follow with family engravings and the complex transformation loom. Develop the geodesic and minimal-surface studies as the next major mathematical expansion. Keep geometric evolution and branched surfaces as research projects until their numerical and visual prototypes justify them.

This is the accepted expansion design brief, not a running implementation log or a promise of delivery dates. Keep the visual goals, scope boundaries and wave rationale here; track assignments, dependencies, completion and deferrals in GitHub issues. All 16 subjects remain in the expansion; research gates decide their supported implementation, and changing that scope requires the project owner's agreement. Implemented mathematics and architecture belong in the permanent guides, and verification evidence belongs in each PR. Follow [Project delivery](../contributing.md#project-delivery) when working on an item. The [expansion issues](https://github.com/iwvelando/tangent-garden/issues?q=is%3Aissue%20label%3Aexpansion) are the current delivery record.

## 1. Where the garden stands

The project already has three substantial notebooks and **219 presets: 65 planar, 141 spatial, and 13 four-dimensional**. These counts come from the current preset declarations; some overview prose still reports an earlier planar count.

| Area                       | Existing capabilities                                                                                                                                                                                                        | What that makes possible next                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Planar constructions       | Evolutes, involutes, reflected and refracted caustics, pedal families, offsets and stacks, rolling circles and curves, line/chord/circle envelopes, inversion, and supported compositions on derived curves                  | Families of related constructions, transformation studies, and guided exploration of parameter space                        |
| Planar generators          | Expressions, roulettes, Lissajous and Fourier curves, cyclic pursuit, vector-field trajectories, implicit contours, and iterated-map densities                                                                               | Nodal-pattern collections, fitted harmonic curves, and new finite geometric families                                        |
| Spatial curves             | Knots, harmonics, trajectories and pursuit; developables, involutes, tangent projections, inversion, frames, ribbons, ruled surfaces, tubes, canals, and coils used as construction inputs                                   | Surface-following paths and new transformations that reuse the camera, linework, and export machinery                       |
| Spatial surfaces and light | Five analytic surface types; offsets, focal sheets, ridges and cuspidal edges; single reflection/refraction, wavefront diagnostics, receiver irradiance; implicit meshes, sections, topology readouts, cutaways, and shadows | Geodesic textiles, mathematically defined surface deformations, and carefully bounded discovery of topology changes         |
| Four-dimensional geometry  | Tesseract shadows, sections and stereographic grids; 4-ball and circular-tube sections; localized thread lifts; shell-bypass studies; Hopf fibers and Clifford-torus weaves                                                  | Explicit base-to-fiber correspondence, a purpose-built polytope study, and selected complex curves in four real coordinates |
| Presentation and motion    | Searchable galleries, refinement, probes, themes and color schemes, line weights, named views, camera flights, parameter animation, looping, scrubbing, image and animation export, and portable study links                 | Discovery tools and richer compositions that preserve the same mathematical sampler and renderer                            |

The visual survey reinforces the project's identity: restrained backgrounds, generous empty space, fine construction lines, distinct geometric roles, and motion that reveals structure. The existing Hopf loop already has a strong sense of continuous transformation. New features should build on that clarity, with dense work balanced by a sparse view that reveals how it was made.

The implementation has unusually useful foundations: pure Go numerical packages for 2D, 3D and 4D; bounded parsing; browser workers; explicit gaps and termination conditions; typed transport for large spatial results; shared playback/export semantics; and extensive numerical and browser regression coverage. Conversely, every extra family member or animation sample can multiply real computation. Reusing a renderer does not make a new mathematical subject inexpensive.

### Source map

- [Project overview](../../README.md), [usage](../usage.md), and [mathematics](../mathematics.md).
- [Architecture and declined approaches](../architecture.md#declined-approaches), [spatial studies](../spatial-study.md), and [4D studies](../tesseracts.md).
- Current presets: [2D](../../web/presets.ts), [3D](../../web/spatial/presets.ts), and [4D](../../web/tesseract/presets.ts).
- Extension seams: [planar animation](../../web/animation.ts), [spatial surface descriptors](../../web/spatial/surface.ts), [4D object descriptors](../../web/tesseract/objects.ts), and [study links](../../web/study-link.ts).

## 2. Principles for the expansion

1. **Lead with a picture worth making.** Name the first beautiful study before designing a general framework. It should be compelling without explanatory text inside the artwork.
2. **Make the construction available.** A beautiful finished image should have a route back to its generating circles, normals, paths, transformations, or sections.
3. **Use motion to expose a relationship.** Reveal, deformation, transport, and passage are stronger than rotation alone. A loop should have mathematical or compositional closure.
4. **Let people explore without losing their work.** Previews, excursions, and suggested variants must be reversible; opening a chosen preset still replaces the whole study.
5. **Distinguish mathematical objects.** An overlay is a family, not an envelope. A trajectory on a surface is not a free-space trajectory. A planar shadow is not a faithful view of every point in four dimensions.
6. **Keep the quiet experience.** Progressive controls, short help, a static first frame, reduced-motion behavior, and deliberate Play actions. Dense linework must remain legible on a phone.
7. **Keep the existing boundaries.** Browser-only computation, no accounts or remote collection, no scene/material editor, and no physical-rendering expansion. New numerical work belongs in Go. Text and legends remain outside every renderable viewport, including exports.

## 3. Portfolio and recommended order

Sizes describe relative scope, including controls, links, exports and verification: **S** is mostly curation or existing paths; **M** is a bounded new interaction or evaluator; **L** is a new mathematical subsystem or a change across notebooks; **XL** requires research before a reliable implementation plan. They are not calendar estimates. The visual promises below are design hypotheses to prove with actual rendered prototypes.

| ID  | Proposal                          | Signature image or motion                                      | Size | First dependency                             | Recommendation                    |
| --- | --------------------------------- | -------------------------------------------------------------- | ---- | -------------------------------------------- | --------------------------------- |
| R01 | Curated journeys                  | Three clicks from an ellipse to a forest of cusps              | S–M  | Existing presets                             | Start here                        |
| R02 | Parameter atlas                   | A page of related flowers; enter the one that catches your eye | M–L  | Bounded preview scheduling                   | First exploration tool            |
| R03 | Family engravings                 | Many precise states form one intricate print                   | M–L  | Independent family sampling                  | First new image-making tool       |
| R04 | Animation phrases                 | Construct, transform, approach, pause, return                  | L    | Immutable timeline sampling                  | After one compelling prototype    |
| R05 | Nodal gardens                     | Rosettes and lattices split, touch and reconnect               | S–M  | Existing implicit contours                   | Early visual release              |
| R06 | Complex transformation loom       | A rectilinear net curls into petals and circles                | L    | Family geometry and pole handling            | Flagship planar expansion         |
| R07 | Tangent-circle gardens            | A finite lace of circles grows into every gap                  | M–L  | Bounded circle-family evaluator              | Follow R06 or build independently |
| R08 | Hyperbolic lace                   | A repeating motif recedes toward a circular infinity           | L    | Explicit hyperbolic geometry                 | Explore after R06                 |
| R09 | Surface travelers                 | Threads launched on a torus weave their own textile            | L    | Surface-path integrator                      | Flagship spatial expansion        |
| R10 | Minimal surfaces unfolding        | A spiral stair opens into a catenoid neck                      | L    | New analytic surface family                  | Pair with R09                     |
| R11 | A flower of Hopf fibers           | A small path on a sphere becomes a linked spatial bouquet      | M–L  | Existing Hopf evaluator plus correspondence  | First 4D expansion                |
| R12 | The self-dual 24-cell             | One crystal reveals its companion within                       | L    | Explicit polytope incidence                  | Second 4D expansion               |
| R13 | Topology theater                  | Stop just before a neck joins or a handle opens                | M–L  | Existing level sets and bounded event search | After the atlas                   |
| R14 | Curves that smooth themselves     | A rippled loop relaxes through a nest of contours              | XL   | Stable geometric evolution                   | Research track                    |
| R15 | Journeys between branches         | One circuit changes sheets; two circuits return                | L–XL | Complex path lifting                         | Research track                    |
| R16 | Draw a loop, reveal its harmonics | A hand-drawn outline emerges from rotating circles             | M–L  | Bounded fitting and explicit closure         | After the atlas                   |

### Wave A: make the existing garden easier to enter

Ship R01 and R05, then a planar-only R02. This creates immediate visual variety and helps visitors find settings they would never reach by editing one number at a time. Avoid a simultaneous redesign of all three notebooks.

**Exit condition:** a new visitor can choose a visual theme, discover a variant, play a meaningful motion, and export it without learning the entire control panel. The atlas must remain cancelable and responsive on a modest device.

### Wave B: make a study into a composition

Ship R03, followed by a narrow R04 and R16. Develop R06 as the main new subject. Parameter selection, family sampling and animation should reuse conformed study configurations, without creating a universal node graph.

**Exit condition:** a user can make both an intricate still and a short composed animation from one mathematical study, reproduce them from a link, and return to the original study exactly.

### Wave C: follow the geometry into new spaces

Develop R09 and R10. R11 can proceed independently once it has a convincing paired-view sketch. Sequence R07 and R08 according to which first produces the stronger new visual language; both remain in scope, and neither needs to wait for the spatial work.

**Exit condition:** at least one spatial study reveals a relationship that the existing curves, tubes and surface grids cannot express. It must succeed as linework as well as a shaded presentation.

### Wave D: selective deeper experiments

Evaluate R12 and R13, and prototype R14 and R15. Do not make all later features depend on the research projects. Advance an experiment only when it has a strong visual result, an independent correctness argument, and a bounded browser implementation.

## 4. Feature proposals

### R01 — Curated journeys: “Show me something surprising”

**The experience.** A small entrance to the gallery offers visual invitations: _Light finding a cusp_, _Threads becoming surfaces_, _Order inside apparent chaos_, and _A glimpse of four dimensions_. Each leads through three to five existing studies, with one sentence explaining the change and one suggested control to try. The final step opens the full notebook.

**What is new.** The gallery already searches and groups examples. These are authored sequences across mathematical families, organized around a visual discovery. “A line becomes a flower” is a more inviting first decision than choosing a technical construction name.

**First release.** Four journeys using existing presets and their animations. Show static artwork first; motion starts on request. Preserve the visitor's edited study while previewing a journey, and explicitly open a selected step as a new whole study. A “surprise me” action can choose among curated entries without pretending to discover good parameters randomly.

**Release proof.** Every step opens its declared layers, view and animation; leaving a preview restores the user's configuration and camera. A journey remains understandable using keyboard controls and with motion disabled. No new engine is needed.

### R02 — Parameter atlas: find beauty by looking

**The experience.** Choose two parameters and see a small grid of variations. Across one row petals widen; down a column cusps split. Select a thumbnail, inspect it at full quality, then choose whether to adopt it. A path through the grid can later become a parameter animation.

**What is new.** Existing parameter tracks show one route through a space of possibilities. The atlas reveals neighboring possibilities simultaneously. It should use a frozen copy of the current study so exploration never races with ongoing scalar edits.

**First release.** A 3 × 3 or 5 × 5 planar atlas with curated parameter pairs and bounded ranges: roulette radius versus tracing distance, pedal-pole coordinates, or two attractor coefficients. Process previews through a bounded queue and cancel superseded atlases. Offer shared framing or independently fitted thumbnails, clearly identified outside the drawings. Invalid variants remain visible as unavailable cells.

**Signature study.** _A field of possible flowers_: one simple roulette becomes a sheet of loops, stars and nearly circular forms.

**Release proof.** Opening a cell yields the same configuration and geometry as setting those values directly. Refining a selected preview cannot silently change its parameters. Attractor previews expose their reduced iteration budget; a promising coarse preview is not guaranteed to retain every detail at full resolution.

### R03 — Family engravings: time held in one picture

**The experience.** Hold one parameter at a succession of values and draw the resulting curves together. A moving lamp leaves a fan of caustics; a pedal pole sweeps out a delicate lattice; a Fourier phase opens an apparent blossom. Reveal the family member by member, or move a narrow band through it.

**What is new.** Offset stacks, contour levels, involute families and 4D sections already exist. This adds a bounded family of complete studies over a chosen parameter, without claiming that their overlay is an envelope or a new surface.

**First release.** Planar derived curves only, one scalar track, perhaps 8–32 members initially, subject to a total point budget. Draw the common base once where appropriate. Preserve every member's gaps and identity. Use ordinary role colors and optional restrained progression styling; offer a selected member in the surrounding UI. SVG stays vector.

**Signature still.** _A lamp's lace_: caustics of an elliptical mirror for lamp positions along a circle, with a sparse companion view showing one lamp and its rays.

**Release proof.** Each member matches an ordinary engine request at its parameter value. Reversing sample order preserves the set. Memory is capped by total geometry, not just member count. Motion evaluates a declared mathematical window of members, never an unbounded accumulation of previously displayed frames.

### R04 — Animation phrases: a short mathematical performance

**The experience.** Compose a sequence such as: draw the base; reveal its normals; bring up the evolute; move the pole; approach a cusp; hold; return. The result feels like a deliberate miniature film of a single study.

**What is new.** Parameter animation, camera key views, per-leg camera timing, easing and loops already exist. The addition is coordinated phrases for construction reveal, layer emphasis, parameter keyframes and holds on one timeline. It is not another camera-path feature.

**First release.** A short, bounded sequence within one notebook and one study definition. Begin with a few authored phrases and editable durations. Numeric parameters can have intermediate keyframes; visibility changes occur at explicit boundaries. Do not interpolate formulas, mesh vertices, object kinds or topology. Existing simple animations retain their current semantics.

**Signature film.** _How a cusp is born_: sparse normals accumulate, the envelope appears, a parameter carries it through a transition, and the camera settles on the new fold.

**Release proof.** Sampling a time directly gives the same result as reaching it through playback. Pause, backward scrub, export, cancellation and repeated playback agree. Check loop geometry and camera endpoints, and distinguish positional closure from a visibly smooth velocity seam. No hidden history-dependent drawing state.

### R05 — Nodal gardens: patterns made by cancellation

**The experience.** A lattice turns into interlocking petals as two patterns trade strength. At special values, crossing lines meet and then reconnect into different cells. A family of nearby contours gives the image the delicacy of an engraving.

**What is new.** The first release is an authored subject collection using existing implicit contours and `a`, not a new PDE solver. For example, on the unit square, use the zero set of `cos(a)*sin(m*pi*x)*sin(n*pi*y) + sin(a)*sin(n*pi*x)*sin(m*pi*y)` for fixed positive integers m and n. The two terms have the same Dirichlet Laplacian eigenvalue, so their mixture remains an eigenfunction. Describe these as mathematical nodal patterns; a vibrating metal plate has a different model and boundary conditions.

**First release.** Three to five tuned presets, appropriate resolution, sparse and detailed presentations, and full-period animations. Put the formula and interpretation beside the drawing. The general theory of nodal geometry provides useful background, but the initial formulas are independently testable. [ETH lecture notes](https://metaphor.ethz.ch/x/2025/fs/401-4444-25L/l4.pdf)

**Signature film.** _A lattice changing its mind_: a symmetric grid opens into curved compartments and returns.

**Release proof.** Known zeros, reflection symmetries and boundary zeros appear in the engine's contours. Degenerate crossings are deliberately handled. Compare resolutions at reconnection values rather than accepting a plausible thumbnail.

### R06 — Complex transformation loom

**The experience.** Show a source net and its transformed image. A moving point and a few correspondence lines reveal how a square mesh becomes a curved web. Animate a transformation parameter while the source remains recognizable.

**What is new.** Circle inversion and arbitrary curve expressions already cover some individual images. This introduces a coherent family of mapped curves, source/image correspondence, and map-specific treatment of poles and critical points. Ordinary circle inversion involves complex conjugation; do not silently relabel it as the holomorphic map `1/z`.

**First release.** Curated maps: complex squaring, a nonsingular Möbius family, and `z + λ/z` on a domain with an explicit pole exclusion. Use real arithmetic in Go and bounded descriptors before considering a general complex expression language. Allow a source grid, concentric circles, or a selected planar curve. Refine the mapped image, not only the source. Möbius maps send generalized circles to generalized circles, providing both visual material and an independent invariant. [Mathematical treatment](https://arxiv.org/abs/1806.00200)

**Signature stills.** _Circles opening into a rosette_ and _Circles through infinity_. Squaring a circle through the origin gives a cardioid; rotating the source circle produces a family of rotated cardioids. A square source grid instead supplies an interlaced net of parabolic images.

**Release proof.** Identity and inverse maps agree where defined; mapped circles satisfy the expected circle or line equation; angles are preserved where a conformal map has nonzero derivative. A source interval crossing a pole is split before drawing. Unsupported downstream constructions remain unavailable rather than differentiating a displayed polyline.

### R07 — Tangent-circle gardens

**The experience.** Three circles leave a curving triangular gap. Another circle fits exactly; smaller circles fill its descendants. Reveal this finite hierarchy, zoom into a chosen gap, or move the whole configuration by a transformation that preserves tangency.

**What is new.** Existing circle envelopes follow a one-parameter family. An Apollonian packing grows by discrete tangency relations, producing a different kind of geometric lace. Descartes configurations and their transformations provide an explicit foundation. [Graham, Lagarias, Mallows, Wilks and Yan](https://arxiv.org/abs/math/0010298)

**First release.** One enclosing configuration, bounded depth, a minimum displayed radius and a total-circle cap. Retain parentage so selecting a circle exposes the three circles that generated it. Use signed curvature for the enclosing circle and stable identities for deduplication. Animate reveal or a valid map of the whole packing; never interpolate circle centers independently and imply that tangency survives.

**Signature still.** _A rose window made only of circles_, with a hairline SVG suitable for a large print.

**Release proof.** Every generated circle has the intended tangencies, with scale-aware residuals; repeated generation creates no duplicate branches. The image explains its finite cutoff. A camera zoom requests bounded additional detail rather than suggesting literal infinite resolution.

### R08 — Hyperbolic lace

**The experience.** Repeated arcs fill a disk, becoming smaller toward its rim. Move the center of attention and the whole pattern appears to flow through itself while preserving its hyperbolic relationships.

**What is new.** This is an explicit geometric model in the planar notebook, not a decorative warp of Euclidean curves. In the Poincaré disk, geodesics are diameters or circular arcs orthogonal to the boundary. [Cornell geometry notes](https://e.math.cornell.edu/people/mann/classes/GGRminicourse.pdf)

**First release.** One verified regular tessellation, such as {7,3}, finite depth, exact generating reflections, a distinct boundary circle, and a small set of curves inside a fundamental tile. Animate a bounded disk isometry or follow a closed authored path through its parameters. A finite tile set and its clipping window must return as well as the transformation before a loop is declared seamless.

**Signature film.** _An endless garden through a round window_: the same lace moves toward the center, grows, and flows outward again.

**Release proof.** Verify reflection involutions, boundary orthogonality, adjacency and hyperbolic-distance preservation. Deduplicate generated tiles and bound growth. Treat the rim as the model's boundary at infinity; never connect through it. Keep hyperbolic lengths distinct from Euclidean screen lengths in all readouts.

### R09 — Surface travelers: geodesics, transport and woven paths

**The experience.** Launch a family of threads from a point on a torus. Nearby directions create different winding bands. On a sphere, carry a small tangent arrow around a triangular route and watch it return rotated. Hide the surface to reveal the path textile alone.

**What is new.** Spatial field trajectories, carried frames, principal directions, ridges and probe normal sections already exist. These new paths obey the surface's intrinsic metric. A generic 3D trajectory projected onto a mesh is not a substitute.

**First release.** Geodesics on a sphere and a regular ring torus, specified by a start point and tangent direction, with bounded arc length and a small launch fan. Use analytic charts with explicit seam handling. Parallel transport can follow once the path evaluator is trustworthy. Later, integrate principal-direction lines as a separate path family, stopping explicitly at umbilics; do not conflate them with geodesics or existing ridge curves.

**Signature studies.** _Threads finding their way around a torus_ and _The arrow that came home turned_.

**Release proof.** Sphere geodesics lie on great circles. Torus paths preserve unit speed and the appropriate Clairaut invariant within a stated convergence budget. Transport preserves tangency and norm; a known spherical loop has the expected holonomy modulo a full turn. Closure needs a justified position-and-direction test; visual proximity alone is insufficient.

### R10 — Minimal surfaces unfolding

**The experience.** A helicoid's spiral stair slowly opens into a catenoid neck. A net drawn on the surface deforms with it, making local length preservation visible. A few highlighted curves expose the correspondence.

**What is new.** Implicit Schwarz and gyroid studies, ruled surfaces and helical ribbons already exist. This is an analytic associated family with a precise deformation law, not arbitrary mesh morphing. The helicoid–catenoid family is locally isometric; global identifications and self-intersections require care. [3D-XplorMath's mathematical description](https://webapps.math.uci.edu/~vmm/Surface/helicoid-catenoid/helicoid-catenoid.html)

**First release.** One finite parameter patch with an associate-angle control, boundary curves, optional grid, and a back-and-forth animation. Keep a common simply connected parameter domain throughout. Add the family to the spatial surface capabilities deliberately; validate curvature before enabling offsets, focal sheets or optics. A family of analytic ruled surfaces is not general enough to represent every intermediate surface here.

**Signature film.** _A staircase becoming a throat_: a slow transformation seen from an oblique view, followed by a closer look at the unchanged grid lengths.

**Release proof.** The engine returns mean curvature near zero within numerical tolerance, matching first fundamental forms across associate angles, and the expected endpoint surfaces. Test boundaries and normal conventions. Do not claim an arbitrary closed, glued surface can undergo the deformation without global obstruction.

### R11 — A flower of Hopf fibers

**The experience.** In one panel, a small path winds across a sphere. In the other, the fibers over its sampled points form a linked bouquet. Moving one point on the sphere moves one complete circle through the bouquet. Drawing a different base path produces a different spatial textile.

**What is new.** Hopf fibers, latitude sweeps, Clifford tori and double-rotation loops are already implemented. The new feature is an explicit base-sphere selection and correspondence, including fibers sampled over a non-latitude path. The current [Hopf definition](../tesseracts.md#spherical-ring-weave) supplies the mathematical starting point.

**First release.** A base latitude and one smooth spherical flower path, a bounded number of fibers, paired selection, and a tracing animation. Generate each fiber from its base point without treating a temporary coordinate chart's seam as a physical break. Preserve the existing analytic projection-window clipping.

**Signature still.** _A flower below, a bouquet above_: a sparse base curve and an elaborate nest of linked circles, with no labels inside either drawing.

**Release proof.** Every generated source point lies on S³ and maps to the selected S² point. Different chart choices produce the same fiber set. Verify representative complete pairs' linking independently; a clipped open arc is not a closed link. Existing latitude presets must remain unchanged.

### R12 — The self-dual 24-cell

**The experience.** Reveal a 24-cell and its dual, then take sections through both. A sparse choice of cells makes the relation readable before the full crystal appears. Rotation exposes changing spatial shadows; slice passage exposes changing polyhedra.

**Why this object earns a place.** The new subject is self-duality and octahedral cells in four dimensions. It should stand on that story, rather than simply extending the shape dropdown. The 24-cell is self-dual and has octahedral cells. [Thomas Banchoff's account](https://www.math.brown.edu/tbanchof/Beyond3d.new/chapter5/s5_9.html)

**First release.** Explicit vertices, edges and cell incidence; orthogonal shadows and genuine sections; selection of one cell and its dual relation. Add perspective only after deriving a safe eye-distance bound for the chosen scale. Fit the existing object-descriptor pattern and preserve unsupported-mode behavior.

**Signature film.** _A crystal meeting its own dual_: the two configurations alternate in emphasis while a section passes through them.

**Release proof.** Verify 24 vertices, 96 edges, 96 triangular faces and 24 octahedral cells, incidences and equal edge lengths. Dualize twice and recover the original up to the declared normalization. Validate section membership and degeneracies. Do not present an arbitrary interpolation of vertices as a family of regular polytopes.

### R13 — Topology theater: find the moment of change

**The experience.** Below an implicit study, a short strip of frames marks _two pieces_, _neck forming_, and _one connected surface_. Choose a transition, inspect nearby values, and play a slow passage through it. The artwork remains free of text.

**What is new.** Level animation, implicit-surface topology readouts and examples of merging drops already exist. This adds bounded discovery and navigation of interesting events. It helps the user reach a fleeting mathematical moment rather than merely watching a sweep.

**First release.** Curated scalar-field families with analytically known critical levels. Show neighboring regular states and identify the singular state separately. Later, offer a coarse scan of an entered range with bounded refinement around changes in the sampled result; call those candidates, not certified critical values.

**Signature film.** _The instant a handle appears_: a slow approach, a pause on either side, then a wider view of the new opening.

**Release proof.** Event brackets contain known critical values and stabilize under increased resolution. Never report a manifold genus at a nonmanifold singularity or treat a feature exiting the window as an intrinsic topology change. Existing drawing and topology computations remain authoritative.

### R14 — Curves that smooth themselves

**The experience.** A rippled closed loop evolves by curvature. Tiny undulations disappear first; larger lobes settle later. Retained time slices make a nest of contours. Offer physical scale and, separately, a normalized presentation that keeps the shrinking shape visible.

**What is new.** Animating an ellipse into a circle and moving normal offsets are already possible. Curvature flow is a time-dependent geometric evolution. It needs its own numerical solver, remeshing policy and termination rules.

**First experiment.** Smooth embedded planar loops, initially convex, evolving by inward curvature. Start with a circle and a gently perturbed circle before attempting narrow necks or self-intersections. A normalized display is a declared rescaling, not the original evolution. Results for embedded curves motivate the subject but do not certify a discrete algorithm. [Andrews and Bryan](https://arxiv.org/abs/0908.2682)

**Signature still.** _A flower remembering a circle_: many shrinking contours, with finer ripples disappearing along the way.

**Go/no-go proof.** For a circle, recover `R(t)^2 = R(0)^2 - 2t` before extinction. Demonstrate time-step and spatial convergence, monotone length decrease, and the expected area loss for supported simple closed curves. Show a stable termination near collapse. Stop the project if remeshing artifacts are what make the animation attractive.

### R15 — Journeys between branches

**The experience.** A point circles the origin in one panel. Its continuously followed square root travels only halfway around in another. One circuit changes the branch; the next brings it home. Lift the same path into four real coordinates to reveal that the apparent jump came from forgetting part of the object.

**What is new.** This connects complex transformations with the 4D notebook using the concrete relation `w² = z`, viewed in C² ≅ R⁴. It is a specific path-lifting study, not a promise to mesh general implicit four-dimensional hypersurfaces. The branch phenomenon is a well-established starting point. [MIT square-root study](https://ocw.mit.edu/courses/18-04-complex-variables-with-applications-fall-1999/pages/study-materials/riemann-surfaces-the-square-root/)

**First experiment.** An explicit lifted path `z = r exp(it)`, `w = sqrt(r) exp(it/2)` over two circuits, with linked source, value and projected 4D views. Choose r > 0 and show the branch point separately. Only add a surface net after the path story is visually convincing.

**Signature film.** _The second time around_: two paths seem to disagree about closure until the fourth-coordinate view explains why.

**Go/no-go proof.** Check `w² = z` throughout, branch exchange after one circuit and return after two. A chosen principal-branch cut must not create a false break in the lifted path. Four-dimensional projection and a schematic sheet diagram must be distinguished in the surrounding explanation.

### R16 — Draw a loop, reveal its harmonics

**The experience.** Sketch a single closed outline in a small input area. A few rotating circles draw a softened version. Add terms and recognizable details emerge. Then apply an existing pedal, offset or inversion to the fitted harmonic curve.

**What is new.** The notebook already evaluates Fourier sums and shows epicycles. This adds a bounded way to derive coefficients from one user-authored loop, making that mathematics personal and immediately understandable.

**First release.** One stroke, an explicit decision to close it, bounded resampling, and a fit constrained to the current 16-term limit. Fit in Go from a declared traversal parameterization, such as uniform arc length. Show the original stroke as optional reference geometry. Links carry the resulting terms; preserving the raw stroke can wait rather than introducing a new saved-file system.

**Signature film.** _Your leaf, made of circles_: a rough leaf becomes a harmonic contour, then an inverted lace of its construction.

**Release proof.** Recover a circle's dominant term and a known multi-term curve's coefficients within the sampling error. Preview error must not claim to bound between-sample deviation. Explain that a finite Fourier fit smooths corners and can overshoot. Canceling or rejecting the fit restores the original study; downstream constructions operate on the fitted evaluator, never on the pointer samples.

## 5. Smaller delights worth pairing with these releases

| Addition                            | Why it helps the art                                                                   | Smallest useful scope                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sparse-to-dense construction reveal | The user sees an intricate envelope emerge from a few understandable lines             | Deterministic subsets of one result's representative lines, with the final drawing preserved                                                            |
| Compare with the opening study      | A subtle edit becomes visible, and exploration feels safe                              | A temporary A/B view of one study, with explicit shared or independent framing                                                                          |
| Atlas contact sheets                | A family of related images becomes a finished piece                                    | Export a bounded grid of geometry-only panels; retain parameter values in metadata and surrounding UI                                                   |
| Mathematical color accents          | Curvature sign, arc-length phase or family order can expose otherwise hidden structure | One opt-in scalar coloring mode with a fixed declared range, an external legend, and consistent export behavior; retain existing role colors by default |
| “Show the symmetry”                 | A decorative pattern reveals its exact organizing rule                                 | For curated symmetric studies, display one generating sector and its declared transforms; do not infer exact symmetry from a screenshot                 |
| A suggested neighboring experiment  | Users can continue a discovery without searching the entire gallery                    | Author one or two deliberate parameter changes per journey step, with a reversible preview                                                              |

These are not all equally cheap. In particular, color mappings reach legends, notes, thumbnails and exports, and comparisons affect view state. Treat them as small product scopes with their full implementation consequences.

## 6. What to defer, and why

- **More presets without a new experience.** Curated studies remain essential, but another knot or rotation should reveal a relationship that the existing collection does not already communicate.
- **A general construction node editor.** Composition already exists within derivative-order and capability limits. A visual graph would add a substantial editing model before the first proposed artworks need one.
- **Unbounded trails or accumulations.** Use declared finite families and time windows; never make the result depend on how many frames happened to render.
- **Photorealism, spectral rendering, multi-bounce optics, collision worlds and material controls.** These change the project's purpose and its numerical obligations. The proposed nodal patterns and hyperbolic geometry need none of them.
- **An unrestricted randomizer or automatic “beauty score.”** Start with curated ranges and visible variants. Do not hide invalid geometry or optimize solely for density, symmetry or saturated colors.
- **Reaction–diffusion, fluid simulation and particle spectacle.** These can make beautiful pictures, but are a different center of gravity. Reconsider only after a specific construction-based study establishes a reason to include them.
- **A new general fractal explorer.** Circle packings and hyperbolic reflection families have an immediate geometric story here. A broad escape-time fractal application would deserve its own product decision.
- **Geometry downloads, general 4D implicit sections and wider numeric scale limits as infrastructure projects.** They were left conditional in the retired plans. Reopen them only for a selected study with a demonstrated need.
- **Saved study files, accounts and a community backend.** Portable links already serve the core sharing need. Discovery, fitting and composed motion can remain entirely local.

## 7. Shared engineering and acceptance requirements

### Build only the foundations the selected artworks require

| Need                   | Existing starting point                                          | New work to keep explicit                                                                                      |
| ---------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Variant previews       | Engine client, preset gallery, study configuration               | Frozen inputs, bounded scheduling, cancellation, quality disclosure and cache limits                           |
| Mathematical families  | Offset/involute/contour families and 4D curve identities         | Independent member identity, a global work budget, and family-aware framing without discarding small members   |
| Composed motion        | Immutable animation sampling, key views, pacing and export sinks | A bounded timeline sampled by absolute time, including holds and discrete layer events                         |
| New surfaces and paths | Analytic surface evaluation, probes, adaptive ODE support        | Metric-aware integration, chart transitions and capability checks; no curvature inferred from the display mesh |
| New 4D objects         | `engine4` and the object descriptor table                        | Object-specific definitions, incidence or path identities, safe projection and explicit supported operations   |
| New state              | Conformed study links, scalar inputs and preset replacement      | Backward-compatible defaults, bounded link size, stale-evaluation invalidation and restoration tests           |

An atlas, a family and a film can each multiply work by a different factor. Establish a total work and memory limit before combining them. Begin with the existing worker model; the earlier worker-pool and GPU-numerics decisions remain in force until evidence changes their stated conditions. New bulk 3D/4D data must use the existing typed transport patterns.

### A release has to pass both the artistic and mathematical tests

For every substantial proposal, prepare:

1. **A hero still:** immediately readable at gallery size, rewarding at export resolution, and inspected in both themes and an alternate color scheme.
2. **A short authored animation:** one visible relationship, an intentional opening and ending, and a camera that helps the viewer follow it. A loop is optional; an honest return or stop is better than a false closure.
3. **A sparse construction view:** enough generating geometry to explain the result, without changing its mathematical meaning.
4. **An independent mathematical check:** use the per-feature identities above against returned engine geometry, plus convergence where approximations are involved. A screenshot is not a numerical test.
5. **A difficult case:** poles, chart seams, collapse, duplicate members, an umbilic, nonclosure, or a transition that exercises the actual new risk.
6. **A complete interaction path:** direct controls, edited non-default inputs, preset replacement, link restoration, asynchronous edits, keyboard use, narrow screens, and cancel/stop/restore behavior.
7. **A verified export:** actual decoded image/video output, correct timing and endpoints, and the same mathematical and rendering semantics as the live study. Keep legends and text outside the artwork.

Implementation should follow the repository's planning and red–green–refactor requirements. Preserve existing studies with regression assertions before sharing their paths; use targeted mutations on new numerical and state logic. Finish with the required thumbnail regeneration, visual inspection, gallery checks and `make pre-pr`, subject to the repository's documented exceptions and explicitly authorized verification scope. Phone-only behavior needs a real device check; desktop WebKit alone does not establish it.

### Decide from prototypes, not enthusiasm alone

The prototype review should answer: Does the still differ meaningfully from existing studies? Does motion reveal something that the still cannot? Can a viewer name the generating rule after a short explanation? Does the result remain attractive when the construction is made sparse? Does it survive increased resolution and an independent identity check?

Use direct observation and volunteered feedback for these decisions; no telemetry is needed. If a prototype succeeds only through excessive line density, hidden numerical discontinuities, or a flattering camera that conceals a failure, revise or retire it.

## 8. The first three concrete projects

**First: “Paths through the garden.”** Author four short journeys from existing studies, beginning with _Light finding a cusp_. This yields a useful entrance without waiting for a new engine.

**Second: “A lattice changing its mind.”** Add a small, mathematically checked nodal collection using the current implicit engine. It gives the roadmap an early visual result and tests whether a new subject can fit the current interface gracefully.

**Third: “A field of possible flowers.”** Build the planar parameter-atlas prototype around one roulette family. Establish cancelable computation, framing and reversible selection before generalizing it.

After those, invest in _A lamp's lace_ as the first family engraving and _Circles opening into a rosette_ as the first complex-map study. Those two projects would give Tangent Garden both a new way to compose its existing mathematics and a genuinely new visual subject.
