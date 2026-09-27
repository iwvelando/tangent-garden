# Conventions and numerical constructions

Coordinates are ordinary mathematical coordinates: x right, y up. SVG's y reversal happens only in the renderer. Parameters increase from the lower to upper bound. All expression trigonometry uses radians; the parallel-source control uses degrees.

Scalar bounds accept the same numeric constants as curves: `pi`, `e`, and the positive golden ratio `phi=(1+sqrt(5))/2`. Scalar expressions reject curve variables rather than silently evaluating them at zero. Curve expressions may also use an externally bound shape coefficient `a`; it is fixed during each numerical evaluation, including derivative stencils.

Let `r(t)=(x(t),y(t))`, `v=r′`, `a=r″`, `T=v/|v|`, and `J(x,y)=(-y,x)`. Curves must be sufficiently smooth and regular locally for the requested construction.

## Evolute

`E = r + (v·v)/det(v,a) Jv`.

This is the signed center of curvature. Straight segments have no finite evolute. Stationary points and nearly singular curvature denominators are omitted. Singular limits are not inferred automatically.

## Involute

`I = r − (s+c) T`, where `s(t)=∫[t_min,t] |r′(u)|du`.

We use Simpson integration on every adjacent sample interval. The constant `c` selects an involute from the family. Reversing a curve's orientation changes this anchored construction. Increasing the sample count improves the integral but does not remove derivative conditioning limits.

## Pedal family

For a fixed pole `P`, `H = r + ((P-r)·T) T` is its orthogonal projection onto the tangent line at r. The pole is independent of the optical source and uses Cartesian coordinates; omitted pole coordinates in a Go request default to the origin. Finite coordinates are required. A pole on the base curve is valid. The representative segments are r→H along the tangent and P→H perpendicular to it. A straight line has a valid pedal consisting of one point, rendered with the same point marker used for other collapsed derived curves.

Only a stable, nonzero first derivative is required. Pedals use the same bounded five-point and half-step first-derivative comparison as other constructions, without requiring a stable second derivative. Stationary points and invalid or unstable evaluations produce gaps; no limiting tangent is inferred. A centered circle is its own pedal, and a pole on a circle produces a cardioid. The construction is independent of regular reparameterization and orientation. The absolute speed cutoff of 10⁻⁹ is a numerical guardrail, not scale-invariant regularity detection.

With `N = JT` the left unit normal, the contrapedal `K = r + ((P-r)·N) N` projects the pole onto the normal line instead. Because T and N are orthonormal, r, H, P, and K form a rectangle: `H + K = r + P`. Normals are the evolute's tangents, so the contrapedal is the pedal of the evolute where the evolute is regular; unlike that composition, K needs only a first derivative and remains defined at vertices, where the evolute has cusps. A centered circle has a one-point contrapedal at its center; a line's contrapedal is the parallel line through the pole. Representative segments are r→K along the normal and P→K perpendicular to it.

The orthotomic `Q = 2H - P` reflects the pole across the tangent line. It is the pedal enlarged by a factor of two about P, so it satisfies `|Q-r| = |P-r|` and `(Q-P)·T = 0`, with P and Q on opposite sides of the tangent. Reflecting a parabola's focus gives its directrix; reflecting one focus of an ellipse gives the circle of radius 2a about the other focus; a line's orthotomic is one reflected point. The orthotomic is the curve whose evolute is the catacaustic from a point source at P, but the two constructions are independent here: the pole is not the optical source. Each representative construction draws r→H and P→H as solid genuine projection segments and H→Q dashed, the reflected half. The renderer recovers H as (P+Q)/2 rather than transmitting a second point.

All three share the pole, the first-derivative stability rule, and gap handling. Neither orientation nor regular reparameterization changes any of them. See [MathCurve's pedal constructions](https://mathcurve.com/courbes2d/podaire/podaire.shtml), which also covers contrapedals and orthotomics.
## Offsets

`O = r + d N`, with `N = JT` the left unit normal and signed distance `d`: positive d moves to the left of travel, which is inward on a counterclockwise closed curve. Reversing orientation flips N, so the same points need the opposite sign. The request field is `distance`, separate from the involute string offset `c` (`offset`); both must be finite and within ±100000.

For an arclength parameter s, `dO/ds = (1 − dκ) T`. Where `1 − dκ = 0` the offset has a cusp, and that point is the center of curvature, so every offset cusp lies on the evolute; where `1 − dκ < 0` the offset runs backward, forming swallowtails and self-intersections. These are kept: the construction is the full mathematical parallel curve, not a trimmed outer boundary or a physical first-arrival wavefront. Its samples are therefore never discarded because the offset's own speed vanishes. Only a stable, nonzero first derivative of the base curve is required, with the same stationary-point and instability gaps as the pedal family. A circle of radius R offsets to a concentric circle of radius |R − d| (a single point at d = R); a line offsets to the parallel line |d| away. For a closed convex counterclockwise curve of length L, an outward offset (d < 0) has length L + 2π|d|, and an inward offset with d below the least radius of curvature has length L − 2πd (Steiner's formula). Each representative construction is the normal segment r→O of length |d|. See [MathCurve's parallel curves](https://mathcurve.com/courbes2d.gb/parallele/parallele.shtml).

## Ray envelopes

Let a unit outgoing direction be `d(t)` and the ray family be `F(t,λ)=r(t)+λd(t)`. The envelope condition is linear dependence of `∂F/∂t` and `∂F/∂λ`:

`det(r′+λd′, d)=0`, so `λ=−det(d,r′)/det(d,d′)`.

The envelope point is `r+λd`. Positive λ is forward/real; negative λ is backward/virtual. Zero direction derivative can mean no finite envelope. A point focus is a valid degenerate envelope. This formula avoids a symbolic intersection solver and applies to both reflected and refracted families.

Incident direction is `(r−source)/|r−source|` for a point or a constant `(cos θ,sin θ)` for parallel light. A source on the curve leaves the corresponding direction undefined.

Reflection: `d=i−2(i·n)n` for a unit normal `n`.

Refraction: orient `n` so `i·n≤0`, let `η=n₁/n₂`, `c=−i·n`, `k=1−η²(1−c²)`. For `k≥0`, `d=ηi+(ηc−√k)n`. For `k<0`, total internal reflection occurs: no transmitted direction or diacaustic point is emitted, and the representative reflected ray is separately flagged. Indices describe the incident and transmitted side for each ray, not an inferred global solid.

The vector refraction treatment follows the geometric construction in [Physically Based Rendering, Specular Reflection and Transmission](https://pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission). No Fresnel weights, wavelength dispersion, or intensity estimates are computed.

## Numerical policy

Derivatives use five-point Lagrange stencils at spacing `domain_span × 10⁻⁴`, shifted to remain inside the domain at endpoints. First and second derivatives of the base curve are compared against a half-step stencil to reject ill-conditioned evaluations. Direction derivatives use the same bounded stencil. Curvature and ray-envelope denominators have explicit tolerances.

The engine returns `null` at omitted points instead of serializing NaN or infinity. The renderer does not connect across nulls and additionally breaks very long screen-space segments. These are heuristics; arbitrary expressions and undersampled oscillations cannot be guaranteed continuous. The UI reports omitted samples and exposes resolution. Native tests cover analytic curves, endpoint stencils, integration convergence, optical invariants, and pathological inputs. Future work should add adaptive sampling, scale-aware error budgets, and certified branch separation before claiming higher precision.

Reveal animations expose progressively larger prefixes of the final numerical grid, retaining the original `t_min` arc-length anchor. Their temporal resolution and spatial resolution are independent. Parameter animations instead construct a fresh curve/ray family at each displayed parameter value. Numerical singularities can appear or disappear as parameters move; output curves are never blended across such transitions. Increasing duration increases temporal granularity at a given achieved frame rate, not the number of spatial samples.

Point sources may be specified as Cartesian x/y or polar radius and theta. Radius is nonnegative, theta is in radians counterclockwise from +x, and Go resolves the source as `(r cos(theta), r sin(theta))`. A polar angle animation interpolates the angle itself without wrapping, then resolves the Cartesian position for each frame; it follows an arc rather than a chord. The result includes the effective Cartesian source position for consistent rendering. Coordinate controls in the frontend convert representations when switching editors; the numerical engine remains authoritative for each computation.
