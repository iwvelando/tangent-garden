# Tesseract studies

Choose **4D shapes** in the header, or open `?study=4d`. The planar, spatial, and tesseract notebooks retain their own definitions and cameras when switching. A tesseract is a new mathematical object, not a space curve with a dummy fourth coordinate.

## Three ways of seeing

- **Shadows.** Perspective gives the familiar cube within a cube. Orthographic projection drops the fourth coordinate without perspective scaling. Six independent plane angles and a freely orbiting 3D camera expose different spatial and planar shadows.
- **Sections.** A three-dimensional hyperplane cuts the rotated tesseract. The central diagonal section is a regular octahedron; a passage from outside through the centre and out again reveals the intervening polyhedra. A family of up to 25 parallel sections superimposes their xyz coordinates into a contour drawing. These contours are not translated or joined into a surface.
- **Stereographic curves.** Radially normalize the edges and parallel lines on each square face onto the unit 3-sphere, then stereographically project them. The circular arcs create a woven drawing whose lines still have precise mathematical origins. Open ends mark the boundary of the projection window, not missing connections.

The six examples range from the sparse **A cube beyond a cube** to **Spherical loom**, **Eight rooms of light**, **An octahedron within**, **Section garden**, and **An orthogonal shadow**. Colours identify original coordinate directions for edge and grid lines, or the original cell axis for sections. They are not a depth or curvature measurement. A section edge shared by two cells takes the first cell's colour in deterministic axis order.

## Controls and motion

Every angle and geometric scalar accepts constants and arithmetic, including `pi`, `e`, and `phi`, evaluated in Go. Angles are radians. A positive rotation in ij carries +i toward +j. Rotations act in order xy, xz, yz, xw, yw, zw; these rotations generally do not commute.

Drag to orbit the ordinary 3D viewpoint, shift-drag to pan, and scroll to zoom; on a touch screen, pinch to zoom and move two fingers together to pan. Arrow keys orbit, shift-arrows pan, +/− zoom, and Home resets. **Rotate view** slowly orbits the three-dimensional camera; **Reset view** restores its default orientation, pan, and zoom. Scale is equal on all axes. The fixed framing sphere contains every orientation, preventing camera breathing during playback. Stereographic framing uses the explicitly chosen window radius. Pan and zoom apply on top of it and persist during playback.

The **Animation** panel, open by default, offers an **Animate** dropdown adapted to the current construction. Rotation choices are available for all studies; **Slice passage** appears for cross-sections. Animation adds a full turn in xw, or in both xw and yz, to the entered angles. This is a change to those two angles in the stated composition, not an additional global rotation after all six. Slice passage moves h linearly from −2.05 to 2.05. Playback runs once, can pause/resume or scrub, and includes both endpoints. Once playback completes, the view is released: orbit, pan, zoom, **Rotate view**, and **Reset view** work on the final frame. **Stop** (or **Back to study** after completion) restores the entered study; edits and notebook switches stop playback. An empty section is a valid result.

PNG exports render vectors at 2000 × 1520. SVG exports contain true vector paths and metadata recording the numerical definition, camera, and layers. Motion exports use the same numerical sampler and vector drawing as playback, as MP4 or animated WebP when the browser supports encoding. **Export settings** offers resolution from 500 × 380 to 2000 × 1520, quality from 1 to 100, and 15 or 30 fps (also 60 fps for MP4). Defaults match the other notebooks: 2000 × 1520, 30 fps, quality 60 for MP4 or 85 for WebP. WebP may optionally loop. Duration is 0.1–3600 seconds for playback; exports are bounded to 7,200 frames and 256 MiB. The full passage is exported regardless of the current scrub position, with both endpoints and the captured camera, theme, and layers. Cancellation, editing, and switching notebooks discard pending output. Files never leave the browser.

## Mathematics and numerical limits

The model is C = [−1, 1]⁴. Its 16 vertices have four signs; changing one sign gives one of 32 edges. Choosing two free coordinates and two fixed signs gives its 24 square faces. Fixing one coordinate at ±1 gives one of its eight cubic cells. Circumradius is 2 and edge length is 2.

For rotated v, orthographic projection is v_xyz. Perspective projection is d v_xyz / (d − v_w). The eye distance is restricted to 2.05 ≤ d ≤ 20, so the projection plane cannot meet the object during any rotation. A containing sphere for the projected object has radius 2d / sqrt(d² − 4), obtained by maximizing projected distance on the 4D circum-sphere.

A section w = h intersects each cell's twelve edges. Coplanar endpoints are retained, coincident points are deduplicated, and each planar polygon is ordered in its own plane. Coincident polygons and shared edges are deduplicated. A cubic cell lying entirely in the section plane is three-dimensional and is not mistaken for a polygon: its boundary comes from adjacent cells. Tangential points and segments are retained and reported; an empty section is reported explicitly. Coordinate tolerance is 10⁻¹⁰ for the plane and 10⁻⁹ for point identity and affine dimension, relative to the fixed unit cube. Features within that tolerance coalesce. Section offsets are within ±3, spread within [0, 4], and count within [1, 25].

For stereographic projection, p = v/|v| and P(p) = p_xyz/(1 − p_w). A straight source segment lies in a two-plane through the origin, so its radial normalization is a great-circle arc of S³. Its image is a circle or a line in R³. The source never passes through the origin: at least two face coordinates are ±1.

The finite window |P(p)| ≤ R is equivalent to p_w ≤ (R² − 1)/(R² + 1). Along a source segment v(t), crossing this boundary reduces to a quadratic in t. Its roots split the segment **before sampling**, so even a pole between two samples cannot be bridged. Extraneous roots with negative w are rejected. The window radius is 2–12; clipped source-curve counts are reported. Kept intervals are sampled using 8–256 subdivisions of the original segment, with at least two subdivisions per retained piece. Increasing samples improves the circular-arc approximation; it does not change topology or pole clipping.

A grid adds 0–12 parallel lines per direction per face, or 48g source lines beyond the 32 true edges. There are at most 608 source curves and at most two retained pieces per curve. No surface mesh, scene topology, or 4D lighting is inferred. Transparent SVG faces use average-depth ordering for illustration; this is not exact opaque hidden-surface rendering. Curved paths are polylines, with second-order chord convergence. No geometry is interpolated between animation frames.

## Implementation and verification

`engine4` is a pure Go package, separate from `engine` and `engine3`. Its JSON bridge in `cmd/wasm` runs in the existing browser worker. `web/tesseract` owns controls and the ordinary 3D viewing camera. One active numerical request and one replaceable waiting request bound playback and scrubbing work; revision tokens reject stale results. Export computes and encodes one frame at a time using the existing bounded encoders. There are no new runtime dependencies or resource types.

Native tests check rotation isometry, edge counts, perspective formulas and bounds, cube and octahedron sections, tangent and empty sections, Euler identities, inverse-rotated cube membership, stereographic inverse identities, poles between samples, chord convergence, limits and invalid input. The real WASM bridge checks the independent request/result contract. Browser tests cover examples, scalar expressions and superseded edits, playback and endpoints, notebook and camera preservation, image exports, independently decoded MP4/WebP timing, cancellation, paired-field layout, desktop and phone widths, and both themes.

## Further reading

The implementation is independently derived from the formulas above. For other approaches to communicating four-dimensional geometry, see [Fourmilab's tesseract viewer](https://github.com/Fourmilab/tesseract) and [Aravind, The hypercube dance](https://users.wpi.edu/~paravind/Publications/PKAHypercubeDance.pdf). No source code or artwork from these projects is included.
