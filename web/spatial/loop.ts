// Seamless loops in the 3D notebook: which animations can loop, the words
// that explain repeating and pacing, and the test a loop must pass before it
// plays. A loop joins the motion's end to its start, so it is seamless only
// when the last frame is the first: the same drawing, the same probe and
// the same camera. That is judged on what the drawing would show at
// progress 0 and 1 (the engine's geometry as the scene draws it), never on
// the entered values, since only the drawing knows whether a parameter is
// periodic. It is compared sample for sample: a sheet's color follows its
// samples, so a closed curve run on until its samples are only relabeled
// is not the same drawing. See mathematics.md#seamless-loops.
import { tiered, type Help } from "../help";
import { backAndForthHelp, onceHelp, type Repeat } from "../timing";
import {
  animationCamera,
  type AnimationMode,
  type AnimationView,
} from "./animation";
import {
  buildScene,
  scenePasses,
  type Batch,
  type Layers,
  type View,
  turntableAngle,
} from "./scene";
import { probeDrawing } from "./probe";
import { loopLead as lead } from "../loop-check";

// Drawing along the curve (or rising through the box), tracing light and
// peeling with the cut all start one way and end another, so they offer
// back and forth instead of a loop.
export const loops = (mode: AnimationMode) =>
  mode === "orbit" ||
  mode === "parameters" ||
  mode === "probe" ||
  mode === "path";

export const repeatHelp: Record<Repeat, Help<string>> = {
  once: onceHelp,
  loop: tiered(
    "Plays again and again; the last frame must match the first.",
    "Play checks both ends and says what differs. Parameter tracks return when each spans one period, as a from 0 to 2*pi in cos(t + a); a camera path when its last view is its first, with whole turns. Drawing, tracing and peeling offer Back and forth instead. Exports leave out the repeated last frame and loop forever.",
  ),
  "back-and-forth": backAndForthHelp,
};
// In a loop, a smooth path's seam is one more view it passes through.
export const smoothLoopHelp =
  "In a loop it also passes without stopping through the view where it ends and starts again.";

// Far below a pixel at any export size, and far above the rounding of a
// period's worth of a parameter (and of single-precision drawing data).
const tolerance = 1e-6;

// Why the motion's end is not its start, as a sentence naming the field, or
// null when the last frame is the first. start and end are the frames at
// progress 0 and 1 of one session, drawn with these layers.
export function loopGap(
  start: AnimationView,
  end: AnimationView,
  layers: Layers,
): string | null {
  const radius = start.frame.result.bounds.radius;
  const advice =
    start.mode === "parameters"
      ? " End each track one period after it starts, for example a from 0 to 2*pi in cos(t + a), or choose Back and forth."
      : " Choose Back and forth.";
  const drawn = (v: AnimationView) =>
    scenePasses(buildScene(v.frame.result), layers).map((p) => p.batch);
  const geometry = drawingGap(drawn(start), drawn(end), radius);
  if (geometry === "pieces")
    return `${lead} the drawing at the end has different pieces from the drawing at the start.${advice}${start.mode === "parameters" ? " If each track already runs one period, start it elsewhere in its period: where a surface or curve passes exactly through its samples at the start, rounding at the end can change its pieces." : ""}`;
  if (geometry === "shading")
    return `${lead} the drawing at the end is shaded differently from the drawing at the start.${advice}`;
  if (geometry > 0)
    return `${lead} the drawing at the end lies up to ${geometry.toPrecision(2)} of the study's radius from the drawing at the start.${advice}`;
  const probe = (v: AnimationView) =>
    v.probe === undefined
      ? []
      : probeDrawing(v.frame.result, v.frame.config, v.probeSetup!, v.probe);
  if (drawingGap(probe(start), probe(end), radius) !== 0)
    return `${lead} the probe at the end is not where it starts: what it moves along does not close.${advice}`;
  if (!sameCamera(animationCamera(start), animationCamera(end)))
    return `${lead} the camera at the end is not the camera at the start. Make the last key view the first, with whole turns, or choose Back and forth.`;
  return null;
}

// The largest distance between corresponding positions of two drawings, as
// a fraction of the radius, 0 within tolerance; "pieces" when their batches
// differ in kind, size or connection, or "shading" when only a vertex's
// normal or phase differs. Each vertex is a position, a normal and a phase
// (scene.ts).
export function drawingGap(
  a: Batch[],
  b: Batch[],
  radius: number,
): number | "pieces" | "shading" {
  if (a.length !== b.length) return "pieces";
  let gap = 0,
    shading = false;
  for (let k = 0; k < a.length; k++) {
    const [p, q] = [a[k], b[k]];
    if (
      p.mode !== q.mode ||
      p.ink !== q.ink ||
      p.data.length !== q.data.length ||
      (p.indices?.length ?? -1) !== (q.indices?.length ?? -1) ||
      (p.indices && p.indices.some((v, i) => v !== q.indices![i]))
    )
      return "pieces";
    for (let i = 0; i < p.data.length; i++) {
      const [x, y] = [p.data[i], q.data[i]];
      const position = i % 7 < 3,
        d = Math.abs(x - y);
      if (
        d <=
        tolerance * ((position ? radius : 1) + Math.abs(x) + Math.abs(y))
      )
        continue;
      if (position) gap = Math.max(gap, d / radius);
      else shading = true;
    }
  }
  return gap > 0 ? gap : shading ? "shading" : 0;
}

// The same camera, a whole number of turns apart.
export function sameCamera(a: View, b: View) {
  const r = a.radius;
  const turn = 2 * Math.PI,
    yaw = a.yaw - b.yaw;
  const close = (x: number, y: number, scale: number) =>
    Math.abs(x - y) <= tolerance * scale;
  if (Boolean(a.lens) !== Boolean(b.lens)) return false;
  if ((a.projection ?? "orthographic") !== (b.projection ?? "orthographic"))
    return false;
  if (turntableAngle(a) !== turntableAngle(b)) return false;
  return (
    Math.abs(yaw - turn * Math.round(yaw / turn)) <= tolerance &&
    close(a.pitch, b.pitch, 1) &&
    close(Math.log(a.zoom), Math.log(b.zoom), 1) &&
    close(a.radius, b.radius, r) &&
    close(a.panX, b.panX, r) &&
    close(a.panY, b.panY, r) &&
    close(a.center.x, b.center.x, r) &&
    close(a.center.y, b.center.y, r) &&
    close(a.center.z, b.center.z, r)
  );
}
