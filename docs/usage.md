# Using Tangent Garden

[Back to the project overview](../README.md)

## Explore

- Eight presets cover representative notebook studies and parallel illumination.
- Input parametric `x(t), y(t)`, Cartesian `y=f(x)`, or polar `r(t)` curves. Interval bounds accept constant expressions such as `2*pi`, `-phi`, or `ln(e)` through the same Go parser.
- Expressions support `+ - * / ^`, parentheses, `pi ≈ 3.1415926536`, `e ≈ 2.7182818285`, `phi ≈ 1.6180339887` (the positive golden ratio), and the functions shown in the UI. Multiplication is explicit. Exponentiation is right associative; `-t^2` means `-(t^2)`. This is a bounded parser, never JavaScript evaluation. An adjustable `a` is available in curve expressions; bounds and animation endpoints must be constant, with no `t`, `x`, or `a`.
- Point sources default to Cartesian x/y independently of curve format. Choose **Source coordinates → Polar** for nonnegative radius and theta in radians, counterclockwise from +x. Switching coordinates preserves the location. For parallel light, 0° travels right and 90° travels up.
- Refraction uses **incident index n₁ / transmitted index n₂**. Normals face each incident ray. Total internal reflection produces an amber reflected ray, with no transmitted envelope at that sample.
- The involute is `r − (s+c)T`, with `s=0` at the interval's lower bound and adjustable initial offset `c`.
- Toggle construction lines, incident rays, dashed backward extensions, curves, and axes. Drag to pan, scroll to zoom, or fit the view. Light/dark backgrounds and SVG export preserve the visible drawing; SVG metadata includes its mathematical inputs.
- Simple mode offers the original slider and sample presets. Expert mode accepts any whole number of samples from 64–32,768 and construction lines from 2–2,048, with no more lines than samples. Switching modes preserves custom values. These workload limits apply in both modes and to animations. They are application guardrails, not intrinsic browser limits: computation and serialization grow with sample count, while SVG drawing grows with line count. Responsiveness depends on hardware, expressions, and construction. More samples improve spatial coverage but do not automatically improve derivative precision.
- The theme initially follows your system, including live time-of-day changes. Clicking the toggle saves an explicit light/dark preference in this browser. **Follow system** clears that override. Storage failures do not prevent using the app.
- On desktop, the parameter sidebar scrolls independently of the drawing. On narrow screens, the drawing and controls stack in the document.
- The expandable diacaustic explanation covers index conventions, Snell's law, total internal reflection, and the supported inclusive range 0.01–10. Every finite decimal in that range is allowed; there is no 0.05-step restriction.

## Animate

Open **Animation** in the sidebar. Set a duration (0.1–3,600 seconds) and choose one of two modes:

**Draw along the curve** reveals the study from the domain minimum to maximum. It reveals the already-computed base curve, derived curve, and representative lines in parameter order. The numerical grid and arc-length anchor stay fixed; this avoids changing the involute as the drawing grows. At the start, a zero-length trace is represented by its first point, not by an invalid zero-width computation domain.

**Vary parameters** adds one or more simultaneous linear tracks with **From** and **To** values. Every numeric simulation control is available: domain start/end, point-source x/y or polar radius/theta, parallel travel direction, incident/transmitted index, involute offset, sample count, line count, and shape parameter `a`. Ray length is also animatable. Only parameters applicable to the selected construction/source are offered. Counts are rounded to whole numbers; invalid endpoints are rejected with their start/end context, and a calculation error stops playback. Moving the domain start to its end creates a zero-width interval; derivative-based constructions need a positive width of at least 0.000001. Singular samples remain numerical gaps rather than stopping a valid study.

Examples:

- **Unwinding a circle** → Draw along the curve → 10 seconds → Hold final view.
- **Light inside a circle** → Vary parameters → Source x from `1` to `.75` → 30 seconds. Add Source y for a moving source in both coordinates.
- For an orbit: set a polar curve `r(t)=1`, domain `0` to `2*pi`, and a polar point source with radius `1` and theta `0`. Animate **Source theta θ (radians)** from `0` to `pi/2`. The source follows a quarter circle; radius may have a simultaneous track. Polar sources also work with Cartesian and parametric curves.
- **Parallel light & a circle** → Vary parameters → Travel direction from `0` to `360` → 30 seconds. Angles here are degrees, and interpolation follows the entered values without shortest-path wrapping.
- Write `a*cos(t)` and `a*sin(t)` and animate `a` from `1` to `phi`. More generally, expressions such as `(1-a)*cos(t)+a*cos(2*t)` allow shape transitions; categorical choices such as construction type and curve format are held fixed during a run.

Four camera choices are available:

| Camera | Behavior |
| --- | --- |
| Hold final view | Fit the final result once and retain its center and scale throughout. |
| Hold current view | Capture your current manual pan/zoom for playback and export. |
| Follow center, fixed zoom | Use the final scale, but center on the current geometry. Parameter animations that grow larger than the final extent can still leave the frame. |
| Fit each frame | Fit the current geometry on every displayed frame. |

Runs use a clean automatic camera except when **Hold current view** captures your manual framing. **Pause** freezes the current frame; the timeline then allows scrubbing, and SVG export captures that frame and its animation metadata. **Resume** continues for the remaining duration; **Replay** restarts. **Stop** restores the original study and manual pan/zoom. After completion, controls unlock and the button becomes **Reset view**; editing settings clears the completed preview for another run. Changing a simulation input also cancels the animation. Playback pauses when the tab becomes hidden.

Playback targets at most 30 displayed frames per second, using elapsed time rather than a fixed number of steps. A longer duration gives smaller parameter changes per frame. Only one live frame calculation is in flight; slower devices skip intermediate times instead of accumulating a backlog. Endpoint preparation is outside the requested playback duration, and the last frame is always the exact endpoint.

**Export animated WebP** saves the entire configured animation, including both endpoints, at **Standard (1000 × 760, encoder quality 0.95)** or **Fine (2000 × 1520, maximum encoder quality 1.0)**. Fine rasterizes the SVG at twice the resolution rather than upscaling a finished image. It takes longer and produces larger files; the browser chooses the actual WebP codec/compression behavior, so maximum quality is not a cross-browser lossless guarantee. Choose 15 or 30 fps and optionally loop the file; the default plays once and holds its final frame. The export snapshots the theme and visible layers and uses the selected animation camera, including manual framing for **Hold current view**, independently of the current playback position. Frames are rendered individually with the same SVG renderer and encoded at high quality in the browser. Rendering may take longer than playback, but the saved duration is preserved to the nearest millisecond. Frame delays divide that duration evenly (within 1 ms); endpoints are included on the first and last frames.

Export shows progress and can be canceled. Editing a simulation input also cancels it without saving a partial file. Limits are 7,200 frames (four minutes at 30 fps or eight at 15 fps) and 256 MiB of compressed output. Browsers that cannot encode canvas images as WebP display an error; no fallback file is mislabeled as WebP. Everything stays local, and static hosting remains sufficient.

This is a **mathematical construction explorer**, not a scene renderer. Every regular sampled point participates; there is no occlusion, solid-medium topology, or multiple-bounce tracing. A closed curve can therefore display ray families that would not all be illuminated in a physical object.

