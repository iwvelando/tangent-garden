# A first spatial study

The artistic thread worth carrying into 3D is a simple curve giving rise to something unexpectedly intricate through a visible family of lines. A shaded solid alone would lose that connection. The construction should remain legible with its surface hidden.

## Candidates

| Construction | Visual opportunity | Mathematical and product tradeoff |
| --- | --- | --- |
| Tangent developable of a space curve | Folded ribbons, sharp seams, intertwined sheets, line-only string art | Direct definition from a curve and its unit tangents; manageable first prototype |
| Families of spatial involutes | Unwound filaments surrounding a knot, with taut generating segments | A natural continuation of existing involutes; needs careful arc-length integration and family framing |
| Focal surfaces of normal congruences | Layered cusps, ridges, and sheets around a surface | No single spatial analogue of a planar evolute; requires an explicit surface and principal-curvature conventions |
| Reflective/refractive caustic surfaces | Luminous folds, cusp edges, and concentrated ray families | Needs surface normals and a two-parameter ray family; intensity would be a separate mathematical model |

The prototype chooses the first: a **tangent developable of a torus knot**. This offers actual spatial folds while retaining a base curve, straight construction lines, and a derived object. The gold/teal palette and notebook presentation continue the planar studies. Color varies periodically with the base parameter and shading communicates orientation; neither encodes physical light intensity or curvature magnitude.

## What to try

Open `?study=3d` or choose **Explore 3D** from the notebook header. Start with Trefoil, orbit slowly, then hide **Ribbon surface** to see how straight tangents build the folds. Change **Tangent reach L** from a small positive value to 3 to watch those lines form broader intersecting sheets. Try Cinquefoil and Woven orbit for more intricate arrangements within the same construction class. All three scalar fields accept constants and arithmetic through Go.

The presets use coprime windings (2,3), (2,5), and (3,4). The parameterization convention is explicit in [mathematics.md](mathematics.md); see also [Wolfram's torus knot exploration](https://www.wolfram.com/language/12/math-entities/explore-torus-knots.html). R is the major torus radius, r its minor radius, and L the half-length of each unit-tangent segment. R lies in [0.1,20], r in [0.01,R), and L in (0,20]. Counts are bounded separately.

## Deliberate limits

This is one experimental class, not a general 3D scene editor. It accepts a bounded torus-knot generator, not arbitrary space-curve expressions or surfaces. It has no geometry animation, spatial export, transparency, simulated optics, lighting editor, or saved-camera links. Rotate view moves the camera only. Rendering needs WebGL; the 2D notebook remains independent.

Opaque, double-sided sheets and depth-tested linework make the folds readable. Occlusion hides rear geometry while surfaces are enabled; hiding surfaces exposes the line family. Orthographic projection avoids perspective scale distortion. User zoom can crop the artwork; Reset view restores a rotation-independent bounding sphere. On desktop the controls scroll independently; narrow screens place the artwork first, followed by the controls.

The engine retains the singular spine and self-intersections, omits unreliable normal intervals, and copies the closing point exactly. It does not certify all geometric features at finite resolution. Analytic derivative checks, torus and speed identities, ruling length/tangency, opposite sheet normals, closure, zero-curvature gaps, chord convergence, bounded inputs, and the actual WASM bridge verify the mathematics. Browser tests cover visible pixels, orbit/zoom/reset, rotation pause, presets, layers, scalar validation, theme persistence/storage denial, and mobile layout.

Before expanding this feature, assess whether the construction remains compelling in motion and in line-only form. A next mathematical class could be a small family of spatial involutes, reusing space curves and the camera while giving derived curves their own result type. Export and arbitrary expressions should be separate follow-up work with their own verification.
