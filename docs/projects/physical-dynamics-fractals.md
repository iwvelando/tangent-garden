# Physical, dynamical and recursive gardens

_Accepted direction, November 24, 2026. Starting context checked against main at `39a83f9`._

The [original expansion](expansion-roadmap.md) and [garden stems](garden-stems.md) developed an explorer where a simple construction can reveal a surprising picture. These next subjects give that exploration three new forms: hold a mathematical pattern, watch three bodies weave a shared history, and discover how repeated rules generate intricate worlds.

This brief preserves the intended experience and boundaries. GitHub issues own the current scope, readiness, research decisions, blockers and delivery evidence. The linked assignments cover the full intended horizon, including later extensions; the first useful release does not complete its parent. Shipped definitions and interfaces belong in the mathematics, architecture and usage guides. Follow [Project delivery](../contributing.md#project-delivery).

## Make mathematical art physical

**A lace medallion you can hold.** Start from a hyperbolic lace study and make a circular plaque with raised linework or recessed engraving. Adjust physical size and detail, inspect the actual solid, and export it for slicing. Grow the same workshop into planar reliefs, knots and linked fibers, surface solids and shells, finite fractal structures, orbital sculptures and physical interpretations of selected 4D studies.

The workshop derives a physical object from a frozen source; it preserves the mathematical study and the ordinary image/movie workflow. Reuse application ownership and export conventions. Show the actual geometry that will be saved, including intentional cutoff, separate components and physical joints. Color, palette and explanatory text must not conceal a failed geometric check.

Initial compatibility targets are Bambu X1-Carbon and Original Prusa i3 MK3S+, with Bambu Studio and PrusaSlicer. Use portable core 3MF with explicit units and independently validated mesh data. Printer-specific projects, G-code, remote control, automatic support generation, material simulation and structural certification are outside this scope. STL is optional if compatibility evidence warrants it.

### Physical limits have different meanings

A profile records its sources and version and remains editable. Keep these quantities separate:

- Machine travel and documented positioning or sensor precision.
- Installed nozzle, extrusion width, layer and first-layer height, usable build envelope and calibrated XY/Z detail or clearance limits.
- The desired object's minimum walls, struts, floors and gaps. The initial wall choices are **2 mm** and **3 mm**, not promises of functional strength.

A nominal XY/Z resolution cannot establish that a thin feature will print. Validate thickness and clearance after physical scaling, offsets and unions. Distinguish conservative guarantees from sampled estimates and unresolved cases. Height detail and floor thickness need their own layer-aware treatment; globally snapping mesh vertices is not a substitute.

The hyperbolic rim is the signature problem: both lines and the gaps between them become too small. Offer an explicit whole-motif cutoff, clean rim or cropped/magnified excerpt whose finite geometry satisfies the chosen profile. Do not quietly weld the finest lace into a solid band or modify the mathematical source to conceal the loss.

Solid validity, profile compliance and successful fabrication are different evidence. Check topology, orientation, components and self-intersection; independently reopen the file; inspect layers in both slicers; then obtain representative physical samples. A successful render or slicer import is not a completed print. Research gates define admitted families and conservative refusals before public delivery.

## Three-body choreography and encounters

**Three colors share a figure-eight, then a disturbance changes the story.** Offer sourced periodic configurations and carefully validated sensitive encounters, with persistent body identity, full or windowed trails and an optional connecting triangle. A comparison view puts a reference history beside a controlled perturbation on the same physical clock. Spatial motion and printable orbital paths or space-time braids extend the experience.

The mathematics is a coupled Newtonian system with explicit masses, initial conditions and dimensionless units. It is not three independent vector-field seeds. Use bounded integration, event handling and immutable physical-time histories for playback, seeking and export. Close encounters and exhausted accuracy budgets stop or refuse honestly; no hidden softening, collision/merger response or relativistic physics is implied.

Conservation is necessary but insufficient. Validate trajectory and phase against independent references and refinement, including finite agreement horizons for sensitive cases. Distinguish periodicity, established stability and observed sensitivity. A visually complicated orbit does not prove chaos, and a stable neighborhood need not diverge dramatically. Full-period closure includes the labeled positions and velocities, not just a permutation of an unlabelled picture.

True spatial dynamics has three position and three velocity coordinates per body. A separate planar construction `(x(t), y(t), k*t)` produces a space-time sculpture; explain that its third axis represents time, not physical motion. Physical thickening, crossings and joints consume the shared printing contract rather than a second manufacturing pipeline.

## Fractals through generating rules

**Move one parameter and watch an entire Julia world change.** Begin with linked Mandelbrot and Julia planes, a selected parameter, and one orbit that explains the image. Add root-controlled Newton basins and finite recursive geometry with ancestry. Continue into finite spatial solids and genuine quaternion Julia slices through four-dimensional iteration.

Favor a small expressive vocabulary over an arbitrary formula or grammar editor. Preserve the distinction between an infinite set and its finite computation: a filled Julia set, its boundary and an escape-time picture are different things. Finite nonescape remains unresolved unless an analytic test establishes membership. Newton iteration needs explicit derivative failure, nonconvergence and conditioning semantics; every pixel cannot simply be assigned to the nearest root.

Keep classification independent of palette. Bound per-sample and aggregate work, tiles, histories, meshes and retained buffers; cancellation and stale-result disposal are part of the experience. Float64 is the initial complex-iteration scope, with an explicit precision floor instead of an unlimited-deep-zoom promise. Target-resolution output recomputes at its declared quality rather than enlarging the preview. Numerical work remains in Go and browser workers under the current architecture.

Finite recursion exposes actual paths, regions or cells and the rule that generated them. Point-density samples are not polygon boundaries. Manufacturing consumers must name the finite generation or numerical contour they turn into a solid, including approximation and physical cutoff. Quaternion slices require their own multiplication, embedding and numerical evidence; a complex picture with dummy coordinates does not qualify. Their inclusion does not authorize a physical renderer or automatically promise a printable shell.

## Delivery waves and complete assignment map

Waves group useful outcomes and design maturity, not calendar deadlines or global barriers. There is no blanket dependency on the remaining Wave G work. Native blockers name actual capabilities; later work can start when its own design and prerequisites are satisfied.

The three feature parents are [P · #540](https://github.com/iwvelando/tangent-garden/issues/540), [T · #541](https://github.com/iwvelando/tangent-garden/issues/541) and [F · #542](https://github.com/iwvelando/tangent-garden/issues/542). Each spans H–J and belongs to the final milestone. H and I close on acceptance of their assigned release slices; closing either does not assert completion of the whole parents. Research is paired with an identified delivery consumer. A failed gate keeps that outcome unresolved until the owner explicitly approves a revised scope or replacement.

### Wave H — First physical and dynamical encounters

[Delivery milestone](https://github.com/iwvelando/tangent-garden/milestone/8). Establish the three foundations and their first complete public experiences.

| Assignment | Intended outcome |
| --- | --- |
| [P1 · #543](https://github.com/iwvelando/tangent-garden/issues/543) | Validate lace solids, editable printer/process profiles and core 3MF, including physical samples. |
| [P2 · #544](https://github.com/iwvelando/tangent-garden/issues/544) | Deliver raised and engraved lace through the shared physical workshop. |
| [T1 · #552](https://github.com/iwvelando/tangent-garden/issues/552) | Validate coupled planar dynamics, reference orbits, event handling and bounded histories. |
| [T2 · #553](https://github.com/iwvelando/tangent-garden/issues/553) | Deliver planar choreography, sensitive encounters, controls, sharing and exports. |
| [F1 · #558](https://github.com/iwvelando/tangent-garden/issues/558) | Validate complex iteration, classification, precision and progressive rendering. |
| [F2 · #559](https://github.com/iwvelando/tangent-garden/issues/559) | Deliver linked Mandelbrot/Julia exploration, orbit inspection and bounded motion. |

### Wave I — Broaden and connect the new studies

[Delivery milestone](https://github.com/iwvelando/tangent-garden/milestone/9). Apply the established contracts to more art and more revealing interactions.

| Assignment | Intended outcome |
| --- | --- |
| [P3.1 · #545](https://github.com/iwvelando/tangent-garden/issues/545) | Turn admitted planar curves, finite engravings and circle packings into reliefs. |
| [T3 · #554](https://github.com/iwvelando/tangent-garden/issues/554) | Compare reference and perturbed histories with common time and meaningful framing. |
| [F3 · #560](https://github.com/iwvelando/tangent-garden/issues/560) | Explore root-controlled Newton basins and their iteration behavior. |
| [F4 · #561](https://github.com/iwvelando/tangent-garden/issues/561) | Reveal finite recursive geometry, generating maps and ancestry. |

### Wave J — Spatial artifacts and deeper iteration

[Delivery milestone](https://github.com/iwvelando/tangent-garden/milestone/10). Complete the parent horizons through separately validated spatial and recursive extensions.

| Research gate | Delivery consumer | Intended outcome |
| --- | --- | --- |
| [P3.2 · #562](https://github.com/iwvelando/tangent-garden/issues/562) | [P3.3 · #563](https://github.com/iwvelando/tangent-garden/issues/563) | Physical reliefs from admitted finite recursive geometry and iteration-field contours. |
| [P4.1 · #546](https://github.com/iwvelando/tangent-garden/issues/546) | [P4.2 · #547](https://github.com/iwvelando/tangent-garden/issues/547) | Printable knots, trajectories and distinct linked fibers. |
| [P4.3 · #548](https://github.com/iwvelando/tangent-garden/issues/548) | [P4.4 · #549](https://github.com/iwvelando/tangent-garden/issues/549) | Validated surface solids and shells with honest boundaries and thickness. |
| [P5.1 · #550](https://github.com/iwvelando/tangent-garden/issues/550) | [P5.2 · #551](https://github.com/iwvelando/tangent-garden/issues/551) | Physical 3D sections and explicitly interpreted projected 4D frameworks. |
| [T4.1 · #555](https://github.com/iwvelando/tangent-garden/issues/555) | [T4.2 · #556](https://github.com/iwvelando/tangent-garden/issues/556) | True spatial three-body dynamics with ordinary notebook interactions and output. |
| Existing history and path-solid contracts | [T4.3 · #557](https://github.com/iwvelando/tangent-garden/issues/557) | Orbital sculptures and labeled space-time braids. |
| [F5.1 · #564](https://github.com/iwvelando/tangent-garden/issues/564) | [F5.2 · #565](https://github.com/iwvelando/tangent-garden/issues/565) | Finite spatial recursive solids, including shared print output. |
| [F5.3 · #566](https://github.com/iwvelando/tangent-garden/issues/566) | [F5.4 · #567](https://github.com/iwvelando/tangent-garden/issues/567) | A mathematically defined quaternion Julia slice explorer. |

### Shared outcomes and completion

There is one implementation of each shared outcome. T4.3 belongs to the dynamics parent and also blocks completion of the physical-art parent. F5.2 belongs to the fractal parent and also blocks the physical-art parent through finite recursive solid printing. P3.3 belongs to physical art and also blocks completion of the fractal parent. Their issue bodies name the exact history, finite-geometry and manufacturing contracts consumed. Native relationships preserve this coverage without duplicating assignments or blocking children on an entire unrelated parent.

Research assignments must produce a bounded experiment, independent evidence, an accepted contract and an owner decision. Their delivery consumers incorporate the actual outcome before readiness. Later assignments define an intended result and acceptance envelope now; exact catalogs, schemas, numerical tolerances and supported ranges are settled from their prerequisites. Closing research, merging children or meeting an issue count never substitutes for the parent's visual and functional acceptance.

The existing delivery procedure supplies application integration, targeted TDD, early artwork, HTTPS exploration, final verification and reviewer handoff. Extend it only if experience exposes a missing rule. Keep future research logs, changing status and deferred checks in issues/PRs rather than appending them to this brief.

## Starting references

- [3MF Core specification](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md) and [test suites](https://github.com/3MFConsortium/test_suites) for interoperable geometry packages.
- [Prusa modeling guidance](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135) for the distinction between model geometry and printable detail; printer and slicer defaults must be sourced at implementation time.
- [Montgomery's three-body material](https://people.ucsc.edu/~rmont/NbdyB.html) and [Chenciner's overview](https://www.scholarpedia.org/article/Three_body_problem) for reference dynamics and their mathematical context.
- [Complex iteration](https://complexanalysis.org/web/sec_julia-mandelbrot.html) and [Hutchinson's iterated constructions](https://maths-people.anu.edu.au/~john/Assets/Research%20Papers/fractals_self-similarity.pdf) for the distinct fractal families.

These references guide research; acceptance still requires independent checks of the production results and the declared finite approximation.
