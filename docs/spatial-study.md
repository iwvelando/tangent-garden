# A first spatial study

The artistic thread worth carrying into 3D is a simple curve giving rise to something unexpectedly intricate through a visible family of lines. A shaded solid alone would lose that connection. The construction should remain legible with its surface hidden.

## Candidates

| Construction | Visual opportunity | Mathematical and product tradeoff |
| --- | --- | --- |
| Tangent developable of a space curve | Folded ribbons, sharp seams, intertwined sheets, line-only string art | Direct definition from a curve and its unit tangents; manageable first prototype |
| Families of spatial involutes | Unwound filaments surrounding a knot, with taut generating segments | A natural continuation of existing involutes; needs careful arc-length integration and family framing |
| Focal surfaces of normal congruences | Layered cusps, ridges, and sheets around a surface | No single spatial analogue of a planar evolute; requires an explicit surface and principal-curvature conventions |
| Reflective/refractive caustic surfaces | Luminous folds, cusp edges, and concentrated ray families | Needs surface normals and a two-parameter ray family; intensity would be a separate mathematical model |

The first implementation chooses a **tangent developable of a space curve**, starting with torus knots. This offers actual spatial folds while retaining a base curve, straight construction lines, and a derived object. The gold/teal palette and notebook presentation continue the planar studies. Color varies periodically with the base parameter and shading communicates orientation; neither encodes physical light intensity or curvature magnitude.

## What to try

Choose **3D curves** in the notebook header, or open `?study=3d`. Switching to **2D curves** preserves both studies and their manual views. Start with Trefoil, orbit slowly, then hide **Ribbon surface** to see how straight tangents build the folds. Change **Tangent reach L** from a small positive value to 3 to watch those lines form broader intersecting sheets. Try Cinquefoil and Woven orbit for more intricate arrangements.

The torus presets use coprime windings (2,3), (2,5), and (3,4). R is the major torus radius, r its minor radius, and L the half-length of each unit-tangent segment. R lies in [0.1,20], r in [0.01,R), and L in (0,20]. Samples range from 240 to 2400 and representative tangent lines from 12 to 240.

Choose **Custom parametric** under Spatial definition to open a torus knot as editable expressions. Try the helix or spatial Lissajous presets for other shapes. A useful helix is `x=2*cos(t)`, `y=2*sin(t)`, `z=a*t/3`, from `-3*pi` to `3*pi`. Changing `a` changes its rise. Every geometric scalar and domain field accepts constant expressions through Go. Coordinate expressions bind `t` and `a`; scalar fields do not. Switching definitions preserves edited custom coordinates; choosing a preset replaces the study.

Drag to orbit, shift-drag to pan, and scroll to zoom. Keyboard equivalents are arrows, shift-arrows, +/−, and Home. **Rotate view** provides a quick camera-only preview. **Animation** offers a progressive reveal, simultaneous parameter tracks, or a full camera orbit. Pause to scrub; Stop restores the base study and manual view. The four camera modes match the planar notebook. Hold current view includes orbit, pan, and zoom in playback and exports.

## Involute filaments

Choose **Construction · Involute** to unwind taut strings from the same curves. Arc length starts at **Anchor t₀**, where the string has length **c**; the free end traces a filament that touches the curve in a cusp where the string runs out. **Family of involutes** replaces c with 2–24 evenly spaced lengths. Open **Unwinding a staircase** to see a helix shed nine stacked planar spirals, each a lifted circle involute, joined by the tangent strings. **A knot shedding filaments** unwinds seven close lengths from a (3, 4) knot into a braided cage. Hide **Unwinding strings** to see the filaments alone. Animate c, the anchor, or the family range and count; reveal grows the filaments from the domain start without re-measuring arc length. Arc length never crosses a pole or stationary point: the far side is left without a filament, with a note. See [the mathematical conventions](mathematics.md#spatial-involute).

## Tangent feet and half-turns

Choose **Tangent-foot projection** to drop perpendiculars from a fixed pole onto the curve's moving tangent lines. Choose **Tangent-line orthotomic** to extend each perpendicular the same distance beyond its foot: a half-turn of the pole around that tangent line. The pole has independent x, y, and z coordinates, all accepting constant expressions and parameter animation. Small crosses mark the tangent feet; a larger cross marks the pole. Toggle the derived curve, **Perpendiculars & tangent feet**, and **Pole marker** separately.

Open **A knot through perpendiculars** for the trefoil's tangent-foot curve, or **Half-turns around a helix** for the orthotomic. Move the pole and watch its image wrap around the original thread. A straight curve gives a single point image, shown as a cross. Invalid tangents and unresolved intervals leave gaps; regular components after a gap still have images. These are constructions on tangent lines, with no selected Frenet normal and no optical interpretation. See [the definitions and checks](mathematics.md#spatial-tangent-foot-projection-and-orthotomic).

## Harmonic generators

Choose **Spatial definition · Harmonic sum** to add turning vectors: r(t) = c₀ + Σ[Aₖ cos(ωₖt) + Bₖ sin(ωₖt)]. Each term turns around the ellipse spanned by Aₖ and Bₖ at frequency ωₖ, and the vectors are chained from c₀ in term order. Grey chains show the vector sums at the representative samples; at the last one shown, darker lines repeat that chain and trace each term's generating ellipse around its joint, with a cross at c₀. Toggle **Vector sums** and **Generating ellipses** separately; they stay available under every construction. Up to eight terms; every field accepts constant expressions and parameter animation.

The domain is yours: the curve closes only when it spans a whole number of periods, and the note under the domain says so. **A harmonic trefoil** chains two circles turning opposite ways with a vertical wave into a trefoil knot. **Tilted ellipses · 1 : 3 : −5** tilts its generating ellipses into three different planes. **An orbit that never closes** uses frequencies 1 and φ, whose ratio is irrational: the ribbon stays an open arc however long the domain. Draw along the curve to watch the chain turn as the curve grows. See [the definitions and checks](mathematics.md#spatial-harmonic-curves).

## Inversion in a sphere

Choose **Sphere inversion** to send every point along the ray from a center O to the point whose distance from O is R² divided by its own. The sphere of radius R stays fixed while its inside and outside trade places. **Curve to invert** chooses the base curve or its tangent-foot or orthotomic projection from the pole. **Center x**, **Center y**, **Center z**, and **Sphere radius R** accept constant expressions and parameter animation. Grey segments join each point to its image along their shared ray; three great circles and a small cross mark the sphere and its center. Toggle the **Inverted curve**, **Correspondence segments**, **Inversion sphere & center**, and, for a projection, **Projection & pole** separately.

Open **A staircase drawn into a sphere** to see every turn of a long helix pulled inside the sphere and coiled toward its center. **A trefoil turned inside out** inverts the knot in a sphere through its middle, and **Inverted perpendiculars** inverts the trefoil's tangent-foot curve. Move the center onto the curve and the image opens into branches that run off to infinity: they are never joined across it, and a note counts each passage through the center. See [the definitions and checks](mathematics.md#spatial-sphere-inversion).

**Export image** saves a 2000 × 1520 PNG or an SVG containing that shaded PNG and study metadata. The SVG option is explicitly labelled as an embedded image, since depth-tested shading is raster content. Animation exports use the same sampler and renderer, with MP4 or animated WebP according to browser capabilities, adjustable resolution/quality/frame rate, and exact file duration independent of rendering speed. Cancellation discards the file. No screen recording or external service is involved.

## Deliberate limits

The notebook offers torus-knot, expression, and harmonic curves, with tangent developables, involutes, tangent-foot projections, tangent-line orthotomics, and sphere inversions, with no transparency, simulated optics, lighting editor, or saved-camera links. Rendering needs WebGL; the 2D notebook remains independent. Opaque, double-sided sheets and depth-tested linework make the folds readable. Occlusion hides rear geometry while surfaces are enabled; hiding surfaces exposes the line family. Orthographic projection avoids perspective scale distortion. Both notebooks share one page layout: the same header, sidebar, drawing frame with its heading and legend, and explanation. On desktop the controls scroll independently; narrow screens place the artwork first, followed by the controls and then the explanation.

The engine retains the singular spine and self-intersections, leaves gaps at invalid points and unreliable normals, and closes analytic torus knots exactly. Arbitrary expressions are sampled with bounded numerical derivatives; narrow folds or rapid oscillations may need more samples or a smaller domain. No finite-resolution certification is claimed. See [the mathematical conventions](mathematics.md#spatial-tangent-developable).

Analytic derivative checks, torus and speed identities, ruling length/tangency, opposite sheet normals, closure, zero-curvature gaps, convergence, bounded inputs, and the WASM bridge verify the mathematics. Browser checks cover custom expressions, scalars, playback endpoints and cameras, image dimensions, independently decoded animation timing, cancellation, layers, themes, and responsive paired-field layout.

The involute reuses the space curves, sampling, camera, and media path, and gives its filaments and strings their own result type.

## Future work

The [spatial expansion roadmap](spatial-expansion-roadmap.md) records proposed constructions, deferred numerical and rendering work, notebook/media improvements, and the acceptance gates for future slices.
