# Conventions and numerical constructions

Coordinates are ordinary mathematical coordinates: x right, y up. SVG's y reversal happens only in the renderer. Parameters increase from the lower to upper bound. All expression trigonometry uses radians; the parallel-source control uses degrees.

Scalar bounds accept the same numeric constants as curves: `pi`, `e`, and the positive golden ratio `phi=(1+sqrt(5))/2`. Scalar expressions reject curve variables rather than silently evaluating them at zero. Curve expressions may also use an externally bound shape coefficient `a`; it is fixed during each numerical evaluation, including derivative stencils.

Let `r(t)=(x(t),y(t))`, `v=r′`, `a=r″`, `T=v/|v|`, and `J(x,y)=(-y,x)`. Curves must be sufficiently smooth and regular locally for the requested construction.

## Roulettes

A roulette curve is generated rather than typed: a point at distance `d ≥ 0` from the center of a circle of radius `r > 0` that rolls without slipping on a fixed circle of radius `R > 0` centered at the origin, or along the x-axis. The drawing places the rolling circle on the upper side of the line, inside the fixed circle (a hypotrochoid, requiring `R > r`), or outside it (an epitrochoid). For a fixed circle, `t` is the polar angle of the rolling center; along the line, `t` is the angle the rolling circle has turned, so its center is `(rt, r)`. With phase `φ = 0` the tracing arm points at the contact point at `t = 0`:

- Inside: `x = (R−r)cos t + d cos((R−r)t/r − φ)`, `y = (R−r)sin t − d sin((R−r)t/r − φ)`.
- Outside: `x = (R+r)cos t − d cos((R+r)t/r + φ)`, `y = (R+r)sin t − d sin((R+r)t/r + φ)`.
- Line: `x = rt − d sin(t − φ)`, `y = r − d cos(t − φ)`.

The phase `φ` (radians) turns the arm counterclockwise from the contact direction at `t = 0`. The rolling circle spins at `−(R−r)/r`, `(R+r)/r`, or `−1` radians per unit `t`, so the material point at the contact is at rest: rolling without slipping. `d = r` traces the rim with cusps (hypocycloid, epicycloid, cycloid); `d < r` is curtate and `d > r` looped. Familiar special cases include the Tusi couple (`R = 2r`, `d = r`, a diameter), ellipses (`R = 2r`), the astroid (`R = 4r`, `d = r`), and the cardioid (outside, `R = r = d`).

When `R/r = p/q` in lowest terms, the trace repeats exactly after the rolling center makes `q` turns, `t` advancing by `2πq`, with `p` arches. The engine finds `p/q` with continued fractions, accepting it only within a relative `10⁻¹²` of the entered ratio and with `q ≤ 200`. Other ratios, including irrational ones and decimals that are merely close to a simple fraction, are reported as not closing and are never forced closed. A trace along a line repeats each turn, shifted by `2πr`, and never closes. Only the chosen domain is drawn; the closure report offers to set its end to one full period.

The traced curve is the base curve: every construction applies to it with the usual numerical derivatives. Radii and `d` are bounded by 100000 and `|φ|` by 1000000. Rolling positions (rolling center and radius, contact point, tracing point) are reported at the representative samples, including samples where the construction itself is undefined, such as the cusps of a rim trace.

## Harmonic curves

Two generators build curves from uniform rotations. Like a roulette, they replace the expressions, and the result is an ordinary base curve that every construction applies to. `t` is time: a vector of frequency `k` turns through `kt` radians.

- **Lissajous:** `x = A sin(mt + φ)`, `y = B sin(nt)`, with amplitudes `0 ≤ A, B ≤ 100000`, real frequencies `|m|, |n| ≤ 1000`, and phase `φ` in radians. With `m = n`, `φ = π/2` gives an ellipse and `φ = 0` a segment of slope `B/A`. `m : n = 1 : 2` with `φ = π/2` gives the lemniscate of Gerono `y² = 4x²(1 − x²)` (for `A = B = 1`), `2 : 1` a parabolic arc `x = 1 − 2y²`, and `3 : 1` with `φ = 0` the cubic `x = 3y − 4y³`.
- **Fourier:** `z(t) = Σ r_j e^{i(k_j t + φ_j)}` for 1–16 terms, with radius `0 ≤ r_j ≤ 100000`, frequency `|k_j| ≤ 1000` (positive turns counterclockwise), and phase `φ_j` in radians, the vector's angle from +x at `t = 0`. One term is a circle of radius `r` about the origin, clockwise for negative `k`. A Lissajous figure is the four-term Fourier curve with terms `(m, A/2, φ − π/2)`, `(−m, A/2, π/2 − φ)`, `(n, B/2, 0)`, and `(−n, B/2, π)`.

Each coordinate of a Lissajous figure is the projection of a point turning uniformly on a circle of its amplitude. The x guide is centered at `(0, B + g + A)` and the y guide at `(A + g + B, 0)`, with `g = max(A, B)/4`. Their points turn counterclockwise, at angle `mt + φ − π/2` (from straight down) and `nt` (from the right), so they project vertically and horizontally onto the traced point. A Fourier curve's vectors are chained from the origin in the order given: term `j`'s circle is centered where the previous vectors end, and the last vector ends at the traced point. The engine reports this geometry at every representative sample, including where the construction is undefined.

A rotation of frequency `k` repeats after `2π/|k|`, so a harmonic curve repeats after `T = 2π/ω`, where `ω` is the largest number of which every frequency that moves the curve is a whole multiple. Terms with zero radius or amplitude do not move it, whatever their frequency. A zero-frequency term is a fixed translation. When those frequencies are whole numbers, `ω` is their greatest common divisor, and the curve is closed over any `t`-span of `2π`. Otherwise each frequency's ratio to the first is found with continued fractions, as for roulettes (relative tolerance `10⁻¹²`, denominators up to 1000), and `ω` is the first frequency over the least common multiple of those denominators, which must also be at most 1000. The ratios of frequencies such as `√2` and `3√2` are whole, so they close. Frequencies that are merely close to such ratios, periods longer than the widest domain (`100000`), and incommensurate ratios such as `1 : √2` are reported as never closing and are not forced closed. When nothing turns, the curve is a single point. The period assumes distinct frequencies: equal-frequency terms that cancel exactly are still counted.

The generators are evaluated in closed form. Constructions use the engine's usual five-point numerical derivatives, which the tests check against the analytic `z′ = Σ i k r e^{iθ}` and `z″ = −Σ k² r e^{iθ}`. High frequencies need proportionally more samples.

## Cyclic pursuit

`n` pursuers (`2 ≤ n ≤ 16`) start at points `p_i` when `t` is at the domain start, and each runs straight at the next, the last at the first, at its own constant speed `0 ≤ v_i ≤ 100000`:

`p_i′ = v_i (p_{i+1} − p_i) / |p_{i+1} − p_i|`.

`t` is time. The first pursuer's path is the base curve that constructions use; every path is returned separately, indexed like the base samples, with the connecting polygon of all positions at each representative sample.

The direction is undefined when a pursuer reaches its target, so the chase has an explicit collision policy: it stops, for every pursuer, the first time any pursuer comes within the capture distance `0 < ε ≤ 100000` of its own target. Later samples are gaps. Nobody merges or changes target, since either would silently change the pursuit's topology. Pursuers that are not chasing one another may pass through each other: none steers around the rest. The result reports the capture time and pair (the closest pair, then the lowest index, when several close together); a pursuer that starts within `ε` of its target ends the chase at once.

For equal speeds `v` from a regular polygon of circumradius `r₀`, every pursuer moves inward at `v sin(π/n)` and turns at `v cos(π/n)/r`. The polygon stays regular as it turns and shrinks: `r(t) = r₀ − v t sin(π/n)`, `θ = θ₀ + cot(π/n) ln(r₀/r)`, so each path is the logarithmic spiral `r = r₀ exp(−tan(π/n)(θ − θ₀))`, and neighbors close to `ε` when `r = ε / (2 sin(π/n))`. The evolute of the first path, about the polygon's center `c`, is the same spiral scaled by `tan(π/n)`: `(E − c) ⊥ (P − c)` and `|E − c| = |P − c| tan(π/n)`. The tests check these, a pursuer running straight at a stationary target, two pursuers closing at the sum of their speeds, and a runner passing briefly within `ε` of a still pursuer.

The chase is integrated with the Dormand–Prince 5(4) pair and adaptive steps. The local error of each step is held to `10⁻¹²` of the smallest gap at its start (plus a rounding floor of `10⁻¹⁴` times each coordinate), so the shape stays accurate as the gaps shrink and a scaled chase is the same chase in scaled time. No gap closes faster than the two speeds in it together, so each step is also at most `(g − ε)/(2 v_max)` for the smallest gap `g`: no pursuer can come within `ε` of its target inside a step, however briefly. The steps shrink geometrically as a gap approaches `ε`, and the chase stops when the remaining difference is below `10⁻¹²ε` plus the rounding floor of that pair's coordinates. Positions between accepted steps are one step of the same method from the step's start, so paths are smooth within steps and continuous across them, and constructions differentiate them numerically as usual. A chase is limited to 40000 attempted steps; when that runs out, the result is marked exhausted, the time reached is reported, and later samples are gaps. Tests compare tolerances `10⁻⁶`, `10⁻⁹`, and `10⁻¹²` for convergence and check that every pursuer's velocity points at its target at its speed.

## Rolling circle on a curve

The rolling construction rolls a circle of radius `ρ > 0` without slipping along any regular base curve, tangent to it on a chosen side of travel, and traces a point fixed to the circle at distance `ℓ ≥ 0` from its center. With `σ = +1` for the left side and `−1` for the right, `N = JT` the left unit normal, and `s(t) = ∫[t_min,t] |r′(u)|du` the arc length from the domain start:

`C = r + σρN`, `P = C + ℓ · rot(ψ − σs/ρ)(−σN)`,

where `rot(α)` turns a vector counterclockwise by α. The contact is the base point `r` itself, and `−σN` points from the center to it. At the domain start the arm points at the contact, turned counterclockwise by the phase `ψ` (radians). On a counterclockwise closed curve the left is the inside.

No slipping fixes the spin. The center moves at `|r′|(1 − σρκ)T`, and the material point at the contact, `C − σρN`, must be at rest, so the circle turns at `ω = −|r′|(1 − σρκ)/(σρ) = κ|r′| − σ|r′|/ρ`: the tangent's turning rate plus `−σ/ρ` per unit arc length. Its arm angle is therefore the tangent angle plus `−σs/ρ`. The tangent's own turning is carried by `N`, so only the arc length is integrated and no angle is unwrapped. Because the contact is momentarily at rest, every point of the circle moves at right angles to its segment from the contact; the representative construction lines are these segments from `r` to `P`, which are normals of the roulette wherever it is regular.

This is the circular construction of the previous section with the circle replaced by any curve, not the circular formula with a substituted base. On a counterclockwise circle of radius R it reproduces the hypotrochoid (left side) and epitrochoid (right side), and on the x-axis traversed rightward with `x = ρt` the trochoid (left side), all with the same phase convention when the domain starts at `t = 0`. `ℓ = 0` traces the offset at distance `σρ`; `ℓ = ρ` traces the rim, whose cusps lie on the base curve.

The arc length uses the involute's Simpson integration over each sample interval, so it converges at fourth order, and the construction needs only a stable, nonzero first derivative (the offset's stability rule). The circle stops explicitly, with a warning, at the first invalid sample and wherever the tangent reverses within one sample interval, which marks a cusp or corner between samples: across a cusp the circle would jump to the other side, which is not rolling. Everything after the stop is a gap. The construction is kinematic: where the circle is larger than the radius of curvature on its side (`σρκ > 1`), or the curve returns near itself, the circle overlaps the curve. That is drawn as defined, not treated as a collision. The trace of a closed curve of length L repeats after one lap only when `L/(2πρ)` is a whole number; no closure is detected or forced. `ρ` and `ℓ` are bounded by 100000 and `|ψ|` by 1000000. Rolling positions (center, radius, contact, tracing point) are reported at representative samples where the trace is defined. See [MathCurve's trochoids on arbitrary bases](https://mathcurve.com/courbes2d.gb/trochoidgene/trochoidgene.shtml).

## Rolling curve on a curve

The rolling construction can instead roll a second curve, defined in its own frame by `m(u) = (x(u), y(u))` for `u` in `[u_min, u_max]`, without slipping along the base. Contact is matched by arc length, not found by collision: after the base has rolled an arc length `s` from its domain start, the contact on the moving curve is the parameter `u(s)` with `∫[u₀,u] |m′| = σs`, where `u₀` is the chosen start and `σ = +1` on the left (the contact runs forward toward `u_max`) and `−1` on the right (backward). The moving curve is then placed by the rotation `R(θ)` that turns its tangent in the direction of rolling, `σm′(u)`, onto the base tangent `r′(t)`, and the translation that puts `m(u)` on `r(t)`. A point `Q` of the moving frame traces

`P = r + R(θ)(Q − m(u))`.

On the left, the moving curve's own left side faces the base's left; on the right, its left side faces the base's right. A counterclockwise closed curve has its interior on its left, so for a counterclockwise circle `ρ(cos u, sin u)` these are exactly the sides of the rolling circle, and with `Q = ℓ(cos(u₀+ψ), sin(u₀+ψ))` the trace is the rolling circle's with phase ψ, whose center is the moving frame's origin. The moving frame is arbitrary: rotating and translating the moving curve together with `Q`, or reparameterizing it regularly (keeping its direction), leaves the trace unchanged. Equal arc lengths and a common tangent make the contact the instantaneous center of rotation, so, as for the circle, every construction line from the contact to `P` is normal to the trace wherever it is regular. The moving curve's parameter may use `a`, shared with the base curve.

The moving curve is sampled with the base's sample count over its own domain; each interval's arc length is Simpson's rule on the speed, and `u(s)` is found within its interval by Newton's method on the same rule, so the matching converges at fourth order with the base's arc length. It needs a stable, nonzero first derivative, like the base. An interval is regular when both ends are stable and the tangent does not reverse within it. When every interval is regular and the ends meet with a common unit tangent (to `10⁻⁹` relative to the curve's size and `10⁻⁶` in direction), the curve is closed and the contact wraps around it indefinitely, from any start. On an open curve, or one with a cusp, corner, or invalid point, the contact runs only across the regular intervals around the start and stops, with a note naming the reason, when it reaches the domain's end or an irregular point; the base's own stops still apply. As with the circle, overlaps are drawn as defined, and closure is neither detected nor forced.

Verification includes: the circle as a curve reproducing the rolling circle on both sides with wrapping; a parabola `(u, u²/4f)` on a line, whose focus traces the catenary `y = f cosh(x/f)`, with its normal meeting the line at the contact; two congruent ellipses rolling from matching vertices, which stay mirror images across the common tangent, so the rolling focus stays `2a` from the fixed far focus and traces a circle; no-slip normals; frame and parameter independence; and each stop. Placements report the moving frame's origin image and rotation angle, the contact, and the tracing point at representative samples; the moving curve's own sampled path is reported once, and the renderer carries it by the last placement.

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

An offset stack replaces the single distance with `count` distances `dₖ = from·(1 − k/(count−1)) + to·(k/(count−1))`, k = 0…count−1, in that order, so both entered endpoints are exact and a descending range stays descending. Each member is exactly the single offset at its distance, with the same gaps, and is returned as its own path indexed like the base samples. A stack needs 2–64 members and at most 131,072 points in total (members × samples); both distances obey the ±100000 bound. Its representative normal segment at a sample runs from `r + min(0, from, to) N` to `r + max(0, from, to) N`, crossing every member and reaching back to the curve. On a closed convex curve each member within the least radius of curvature satisfies Steiner's formula, so member lengths fall linearly in d with slope −2π.

Generating circles are circles of radius R centered on the curve at the representative samples, with R = |d| for one offset or R = max(|from|, |to|) for a stack; R = 0 draws none. The two offsets ±R are the envelope of this family: each circle passes through both offset points at its own sample, where it is tangent to them, and when R is below the least radius of curvature no circle crosses either offset. Above that radius the envelope's swallowtails reach inside some circles, which is why the offset is not a physical first-arrival wavefront. Circles belong to offsets only and are never encoded as optical rays.

## Ray envelopes

Let a unit outgoing direction be `d(t)` and the ray family be `F(t,λ)=r(t)+λd(t)`. The envelope condition is linear dependence of `∂F/∂t` and `∂F/∂λ`:

`det(r′+λd′, d)=0`, so `λ=−det(d,r′)/det(d,d′)`.

The envelope point is `r+λd`. Positive λ is forward/real; negative λ is backward/virtual. Zero direction derivative can mean no finite envelope. A point focus is a valid degenerate envelope. This formula avoids a symbolic intersection solver and applies to both reflected and refracted families.

Incident direction is `(r−source)/|r−source|` for a point or a constant `(cos θ,sin θ)` for parallel light. A source on the curve leaves the corresponding direction undefined.

Reflection: `d=i−2(i·n)n` for a unit normal `n`.

Refraction: orient `n` so `i·n≤0`, let `η=n₁/n₂`, `c=−i·n`, `k=1−η²(1−c²)`. For `k≥0`, `d=ηi+(ηc−√k)n`. For `k<0`, total internal reflection occurs: no transmitted direction or diacaustic point is emitted, and the representative reflected ray is separately flagged. Indices describe the incident and transmitted side for each ray, not an inferred global solid.

The vector refraction treatment follows the geometric construction in [Physically Based Rendering, Specular Reflection and Transmission](https://pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission). No Fresnel weights, wavelength dispersion, or intensity estimates are computed.

## Line and chord envelopes

The envelope construction applies the same determinant to a family of lines chosen directly. Each line passes through the base point `r(t)` with a unit direction `u(t)`: either `(cos θ(t), sin θ(t))` for an entered direction angle θ, in radians counterclockwise from +x, or `(q(t) − r(t))/|q(t) − r(t)|` for a chord to a second endpoint `q(t) = (x(t), y(t))` on the same parameter. On `F(t,λ) = r(t) + λu(t)` the envelope point is `r + λu` with

`λ = −det(u, r′)/det(u, u′)`.

Lines are unoriented, so before differentiating, the neighbouring directions in the five-point stencil are aligned with `u(t)`: a direction turning by exactly π is the same line, and its envelope continues across. Any other jump in the direction is a genuine break; the two-step stability check rejects the samples whose stencil crosses it. Where `det(u, u′)` vanishes (below `10⁻⁹`), neighbouring lines are parallel and meet only at infinity, so there is no finite envelope point; those lines are still drawn. A chord needs distinct endpoints: where `|q − r| ≤ 10⁻⁹(1 + |r| + |q|)` it has no direction, so no line is drawn and the envelope has a gap, counted in a note. No limit is taken across the coincidence.

A chord is the segment `0 ≤ λ ≤ |q − r|`. Its touching point may lie on the line beyond the segment; such points belong to the envelope of the full lines but not to the segments, and are marked virtual and dashed unless the chords are extended to full lines. Angle lines are always unbounded; the renderer draws them across the whole view, and they never frame the drawing. Chords frame by their second endpoints.

For the unit circle and `q(t) = (cos mt, sin mt)`, the chords envelope the epicycloid `(m e^{it} + e^{imt})/(m + 1)`, touching each chord at `λ = |q − r|/(m + 1)`, which divides it `1 : m`. For m = 2 this is the cardioid, for m = 3 the nephroid, and for m = 4 the three-cusped epicycloid of the 200-chord reference study. For m < 0 the touching point lies behind the chord, and swapping the roles of the two endpoints puts it beyond. The endpoints coincide where `(m − 1)t` is a multiple of 2π. The creases that fold a focus `(0, 1)` onto the axis point `(t, 0)` run through that point perpendicular to `(t, −1)`, direction angle `atan t`, and envelope the parabola `x² = 4y`.

Verification includes: the epicycloids for several m, including m < 0 and swapped endpoints, with their virtual flags and coincident gaps; the 200-phase reference study; tangent lines enveloping the curve itself; the folded parabola; a pencil of lines through a fixed point enveloping that point; chords of angle `t → 3t` agreeing with the direction angle `2t + π/2`; chords from an ellipse along its normals enveloping its evolute, virtual behind the chords unless extended; each touching point lying on its line with the envelope tangent there, in two arbitrary families; parallel lines; a direction flipping by π versus a genuine jump; and undefined angles and endpoints.

## Circle envelopes

The envelope construction's circle family centers a circle of radius `R(t) > 0` on each base point `c(t)`. With `F(t, X) = |X − c|² − R²`, the envelope solves `F = 0` and `∂F/∂t = 0`; for `q = X − c` these are

`|q|² = R²` and `q·c′ = −RR′`.

Where the center moves, with speed `v = |c′| > 0`, unit tangent `T = c′/v`, left normal `N = JT`, and `k = R′/v`, the solutions are

`q = R(−kT ± √(1 − k²) N)`.

The `+` branch lies to the left of travel and the `−` branch to the right, so reversing the parameter swaps them. Both are real while `|k| < 1`. At `|k| = 1` they merge into one point, the circle's point straight behind or ahead of its motion; values of `1 − k²` within `−10⁻⁹` of zero count as merged, since the separation `R√(1 − k²)` turns a rounding error ε in `R′` into roughly `R√ε`. Where `|k| > 1` the radius changes faster than the center moves, each circle nests strictly inside or around its neighbours, and there is no real envelope point; both branches have gaps there, counted in a note. A stationary center (`v < 10⁻⁹`) leaves the system degenerate: concentric circles have no envelope point, and a repeated circle is its own characteristic set, so neither is drawn as envelope, with a separate note. A radius that is not positive or not finite has no circle and leaves a gap with its own note. `R′` uses the base's five-point stencil and the same two-step stability check, so a kink in `R` inside a sample's stencil is a gap, not a guessed derivative. A kink or jump between samples is not detected. Only a stable first derivative of the base is needed.

A constant radius gives `k = 0`, and the branches are the offsets `±R`. Circles centered on the parabola `4y = x²`, of radius `t²/4 + 1`, all pass through the focus `(0, 1)` and touch the directrix `y = −1`: the right branch is the directrix, and the left collapses to the focus, a degenerate branch that the renderer draws as a point. On the axis, `c = (t, 0)` and `R = t²/2 + 1/2` give `k = t`: the branches `(t − Rt, ±R√(1 − t²))` merge at `t = ±1` and vanish beyond. The radii from each center to its touching points are normal to the envelope, since the envelope is tangent to the circle there.

Verification includes: both equations against analytic derivatives, and each branch's side of travel, for an arbitrary family and its reversal; constant radii reproducing the offset construction, with branches tangent to their circles; the focus and directrix; merging and vanishing branches and the count of nested samples; circles all through one point, merged everywhere; stationary centers; nonpositive, undefined, and zero radii; and a kink in the radius.

## Circle inversion

Inversion in the circle of radius `R > 0` about the center `O` maps each point `p ≠ O` to

`I(p) = O + R²(p − O)/|p − O|²`,

on the same ray from `O`, with `|I(p) − O| |p − O| = R²`. It is an involution, `I(I(p)) = p`, and fixes the circle pointwise; the inside and outside are exchanged. Lines not through `O` become circles through `O`, circles through `O` become lines, other circles stay circles, and lines through `O` map to themselves. Inversion is conformal but reverses orientation: a counterclockwise circle not enclosing `O` inverts into a clockwise one. It is the complex map `z ↦ O + R²/conj(z − O)`, anti-holomorphic, so not a Möbius transformation, though composing two inversions gives one. `O` itself has no finite image; a sample exactly on it is a gap with its own note.

The inverted curve is the base curve itself or one of its derived curves: the evolute, the pedal, contrapedal, or orthotomic with the configuration's pole, or the offset at its distance. A derived curve is evaluated from the base's expressions at any `t`, not resampled from a polyline, and needs exactly its construction's derivatives: none for the base, which may have cusps, the first for the pedal family and offsets, the second for the evolute. Where it is undefined, as the evolute at an inflection, so is the image.

Where the curve passes through `O`, its image runs off to infinity along one direction and returns from another. Consecutive samples are never joined across that. Each sample interval is bisected at least once, then further wherever a piece subtends more than 0.25 radians at `O`, until every piece stays well away from it. The image is left open (a break before the later sample, with a note) where the curve meets `O` or becomes undefined inside the interval, or where it comes closer to `O` than half the nearer sample's distance: its image would reach more than twice as far out as either sample's, and a chord would cut that excursion short. A piece that cannot be resolved down to floating-point resolution crosses `O` or infinity. Inside the circle it is left open, since the curve crosses `O`; outside, the curve runs off to infinity, and its image passes continuously through `O` and is joined. Each interval may evaluate the curve at most 512 times; an interval that needs more is left open rather than joined unchecked. A close pass is thus found even when no sample lies near `O`; more samples resolve it where the image is merely steep. An excursion narrower than half a sample interval can still be missed.

The hyperbola `x² − y² = 1`, inverted about its center in the circle of radius `R`, is Bernoulli's lemniscate `(x² + y²)² = R⁴(x² − y²)`: the hyperbola's four ends at infinity become the lemniscate's node at `O`. The pedal of a curve about a pole, inverted about that pole in the unit circle, is the curve's polar reciprocal; for the ellipse `(a cos t, b sin t)` about its center that is the ellipse `a²x² + b²y² = 1`.

Verification includes: the identities above, including the involution and the fixed circle; lines to circles and circles to lines, with the circle through `O` left open once; orientation reversal by signed area; near passes between samples at several distances, a narrow spike to `O`, an undefined stretch between samples, and an exact sample on `O`; the hyperbola's lemniscate, joined through `O`; a hypocycloid inverted through its cusps; every derived curve matching its construction computed alone, including its derivative requirements on a C¹ curve; the pedal's polar reciprocal; breaks following the inverted curve rather than the base; and bounded work on a curve oscillating ever faster about `O`.

## Numerical policy

Derivatives use five-point Lagrange stencils at spacing `domain_span × 10⁻⁴`, shifted to remain inside the domain at endpoints. First and second derivatives of the base curve are compared against a half-step stencil to reject ill-conditioned evaluations. Direction derivatives use the same bounded stencil. Curvature and ray-envelope denominators have explicit tolerances.

The engine returns `null` at omitted points instead of serializing NaN or infinity. The renderer does not connect across nulls and additionally breaks very long screen-space segments. These are heuristics; arbitrary expressions and undersampled oscillations cannot be guaranteed continuous. The UI reports omitted samples and exposes resolution. Native tests cover analytic curves, endpoint stencils, integration convergence, optical invariants, and pathological inputs. Future work should add adaptive sampling, scale-aware error budgets, and certified branch separation before claiming higher precision.

Reveal animations expose progressively larger prefixes of the final numerical grid, retaining the original `t_min` arc-length anchor. Their temporal resolution and spatial resolution are independent. Parameter animations instead construct a fresh curve/ray family at each displayed parameter value. Numerical singularities can appear or disappear as parameters move; output curves are never blended across such transitions. Increasing duration increases temporal granularity at a given achieved frame rate, not the number of spatial samples.

Point sources may be specified as Cartesian x/y or polar radius and theta. Radius is nonnegative, theta is in radians counterclockwise from +x, and Go resolves the source as `(r cos(theta), r sin(theta))`. A polar angle animation interpolates the angle itself without wrapping, then resolves the Cartesian position for each frame; it follows an arc rather than a chord. The result includes the effective Cartesian source position for consistent rendering. Coordinate controls in the frontend convert representations when switching editors; the numerical engine remains authoritative for each computation.


## Spatial tangent developable

This construction belongs to `engine3`, with true vectors `(x,y,z)`. For coprime positive winding numbers p and q, major radius R and minor radius r with `0 < r < R`, define the torus knot

`c(t) = ((R+r cos qt) cos pt, (R+r cos qt) sin pt, r sin qt)`, `0 ≤ t ≤ 2π`.

Its speed squared is `p²(R+r cos qt)² + r²q² > 0`, so the unit tangent `T=c′/|c′|` exists throughout. With tangent reach L, the truncated tangent developable is `S(t,u)=c(t)+uT(t)` for `−L ≤ u ≤ L`. Each ruling has length 2L in world units. This is a ruled surface formed from the curve's tangents, not a tubular neighborhood of the knot. See the [Wolfram implementation of tangent developables](https://www.wolframcloud.com/obj/resourcesystem/published/FunctionRepository/resources/TangentDevelopableSurface/).

At u=0, `S_t=c′` and `S_u=T` are parallel: the knot is a singular seam, retained explicitly. Away from the seam and zero curvature, the normal is parallel to `c′ × c″`, constant along each ruling. Thus the regular sheets have zero Gaussian curvature. For the torus generator the engine computes first and second derivatives analytically, and uses normalized `±(c′ × c″)` for the two separately tessellated sheets; the renderer shades both sides. No triangles span from negative to positive u. Self-intersections remain part of the construction and depth testing reveals the visible sheets; no physical collision or optical simulation is implied.

If the cross product is too small relative to the analytic derivative scale, or adjacent normals reverse beyond 90 degrees, adjacent faces are omitted. This includes unresolved zero-curvature intervals between samples. The base, boundary curves, and straight rulings remain well-defined there. The closure sample copies the start exactly. Sampling uses 240–2400 intervals; boundary chord error converges quadratically. Uniform sampling and these guards are not certified adaptive tessellation. Very narrow folds can need a higher sample count.


Custom space curves use three bounded expressions `x(t)`, `y(t)`, and `z(t)` with a numerical `a` binding. Constants and functions follow the existing parser. Domain bounds lie within ±10⁶, with width between 10⁻⁶ and 10⁵. There is no implicit periodic closure: endpoints are evaluated independently. The same `S(t,u)` definition and unit-length tangent apply. Five-point Lagrange stencils stay within the domain (one-sided at endpoints), subtract the evaluation origin to reduce cancellation, and compare against half-step derivatives. Unstable first derivatives, speed below 10⁻⁹, nonfinite samples, or coordinate magnitude at least 10¹² leave null gaps. Unstable second derivatives retain a valid tangent but omit surface faces. Relative normal thresholds are 10⁻⁸ for analytic generators and 10⁻⁶ for numerical derivatives; a straight line therefore retains its tangent construction without inventing a surface normal.

Midpoint checks, tangent reversals, and chord-versus-local-speed checks mark interval breaks even when both sampled endpoints are finite. A pole, cusp, or unresolved normal reversal never intentionally becomes a joining triangle. These are bounded numerical guards, not a proof that arbitrary expressions contain no features between samples; highly oscillatory curves can need more samples or a smaller domain. Tests compare custom helices and torus expressions with independent analytic tangents/normals and test reparameterization, straight lines, poles, cusps, and invalid inputs.

Camera fitting treats the base and each boundary as independent point families, rejects isolated asymptotic extremes using outer Tukey fences, and combines the retained extrema before computing a bounding sphere. Reveal uses the same policy on the retained prefix. Fitting is heuristic; Hold current view and manual pan/zoom provide access to distant branches. Animation interpolates inputs only, never output triangles across changing singularities.
