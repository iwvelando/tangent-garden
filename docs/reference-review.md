# Independent assessment of the Maple exports

The four HTML exports and 26 GIF plots were reviewed as historical artifacts. Successfully rendering an image establishes that Maple produced something drawable; it does not establish that the formulas or branch choices are correct. The original exports are not part of this repository and are not required by the application or tests. This assessment preserves the useful mathematical findings independently of those files.

## Evolutes and involutes

The introductory `r − sT` formula is the involute formula, although the prose calls its result an evolute. The circle calculation gives `(cos t + t sin t, sin t − t cos t)`; its evolute recovers the circle away from the stationary endpoint. Both statements are independently tested.

The ellipse `(2 cos t, 3 sin t)` has evolute `(-(5/2) cos³t, (5/3) sin³t)`. The parabola `(t, (2/5)t²)` has evolute `(-(16/25)t³, 5/4+(6/5)t²)`. These match the displayed expressions and are tested across the interval, including endpoint numerical derivatives.

Other examples include a logarithmic spiral, a logarithmic/square-root curve, a cycloid, a tractrix, and more elaborate cusped curves. Several have nonregular parameter values; a rendered connected line can hide the issue. Presets preserve representative input definitions, but do not assert every old construction is correct.

The old involutes use indefinite arc-length antiderivatives, whose additive constant selects a family member. A new implementation anchored at the interval minimum would otherwise change some images. The spiral preset includes `c=√2` to recover the old antiderivative's value at zero. The parameter and offset are explicit in the new model.

## Catacaustics

The mirror families are a circle with source `(1,0)`, a rational cusped curve with source `(8,0)`, an exponential spiral illuminated from the origin, a parabola with source `(0,-15/2)`, and a cubic parametric curve with source `(-8,0)`.

The orthotomic/evolute route is useful, but the extensive trigonometric branches and symbolic intersection solves are fragile. The exports include recursion errors and missing plot variables. In the circle example, the selected surface also passes through the point source, where the incident direction is undefined. The new engine omits that sample rather than inventing a ray.

We compute the reflected direction directly from vector reflection and obtain its envelope independently. Tests use a parabolic mirror's exact focus, a plane mirror's exact virtual image, and angle/reflection invariants. The old circle and other images are visual comparisons, not sole expected-result fixtures.

## Diacaustic

The planar study uses `(t,t²/4)`, source `(0,2)`, and `asin(1.2 sin i)`. Thus `1.2` is an incident/transmitted **index ratio**, not necessarily the absolute index of the receiving medium.

Its plotted outgoing lines use a direction proportional to `(1,tan r)`. Here `r` is measured relative to the local normal; using it as a global slope fails to rotate it into the surface frame and loses the left/right orientation. In particular, at `t=0` it sends the central ray horizontally, whereas normal-incidence transmission must remain vertical. The image therefore cannot serve as a physical or mathematical refraction oracle, even though it rendered. The new preset keeps its input curve/source/ratio but corrects the ray construction using vector Snell refraction.

## 3D investigation

The 3D export experiments with a planar interface, vector refraction, and intersections/projections onto another surface. Computing where rays meet a receiver is distinct from finding the caustic of a two-parameter ray family. We preserve this as a research direction; it is not a completed general 3D caustic algorithm.

## Validation policy

Analytic identities, geometric invariants, convergence checks, and singular cases take priority over screenshots. Native Go tests and a real WASM bridge test are the foundation. Browser tests verify the built app actually loads the Go engine, accepts new expressions, handles bad input, and exports a drawing. Notebook-specific regression coverage can be expanded one independently verified example at a time.
