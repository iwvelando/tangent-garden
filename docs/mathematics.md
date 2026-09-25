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
