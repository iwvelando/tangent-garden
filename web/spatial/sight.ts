// Seeing through the drawing: a drawing setting, not part of the study, like
// the cut. Sheets can be drawn see-through, and lines behind the nearest
// sheet can be drawn faint or dashed instead of hidden. Lines are drawn as
// strokes of a chosen weight, or as hairlines. This module holds the
// setting's fields, limits, words and rules, read by the panels, the
// renderer, linework, links and exports alike.

import { tiered } from "../help";
import { weightScale, type LineWeight } from "../line-weight";
import { clip, type Camera } from "./scene";
import type { Vec3 } from "./types";
export { lineWeights, weightScale, type LineWeight } from "../line-weight";

export type SheetSight = "opaque" | "through";
export type HiddenLines = "hide" | "faint" | "dashed";
export type StrokeDepth = "even" | "taper";
export type Sight = {
  sheets: SheetSight;
  // Each sheet layer's opacity α when sheets are seen through.
  opacity: number;
  hidden: HiddenLines;
  weight: LineWeight;
  depth?: StrokeDepth;
};
export const defaultSight: Sight = {
  sheets: "opaque",
  opacity: 0.35,
  hidden: "hide",
  weight: "regular",
};
// Links made before line weights drew hairlines, and keep them.
export const legacyWeight: LineWeight = "hairline";
export const opacityRange: [number, number] = [0.05, 0.8];
// Lines behind a sheet: faint ones at this opacity, dashed ones at the
// other, over whatever is in front of them.
export const faintOpacity = 0.35;
export const dashedOpacity = 0.8;
// One dash and gap per this fraction of the page's shorter side, the dash
// taking the first dashOn of it, measured along the line in space at the
// drawing's scale.
export const dashPeriod = 0.01;
export const dashOn = 0.55;

export const sheetSights: { value: SheetSight; label: string }[] = [
  { value: "opaque", label: "Opaque" },
  { value: "through", label: "See-through" },
];
export const hiddenLines: { value: HiddenLines; label: string }[] = [
  { value: "hide", label: "Hidden" },
  { value: "faint", label: "Faint" },
  { value: "dashed", label: "Dashed" },
];
// Line weights (../line-weight.ts, shared with the 2D and 4D notebooks). A
// stroke's width is a share of the page, as in the 2D notebook: its weight
// in pixels of a 1000 × 760 page, scaled with the page (strokeUnit), so the
// live drawing, stills and videos agree in proportion at any size. A
// hairline is one device pixel at any size, as every 3D line was before
// weights.
//
// Device pixels per page pixel: the page's 1000 × 760 fitted inside.
export const strokeUnit = (size: { width: number; height: number }) =>
  Math.min(size.width / 1000, size.height / 760);
// Each ink's regular weight, in page pixels: the curve heaviest, as in the
// 2D notebook (2.3), then families, focal lines, construction lines, and
// the receding strings and rays lightest. The probe and the cut's edge are
// read against everything else.
export function inkWeight(ink: number) {
  if (ink > 7.5) return 1.6;
  if (ink > 4.5) return 1.1;
  if (ink > 3.5) return 0.8;
  if (ink > 2.5) return 1.5;
  if (ink > 1.5) return 2.2;
  return 0.9;
}
// A line batch's stroke width in device pixels on a page of this size, or
// undefined for a hairline. A batch may carry its own weight.
export function strokeWidth(
  batch: { ink: number; weight?: number },
  weight: LineWeight,
  size: { width: number; height: number },
) {
  if (weight === "hairline") return undefined;
  return (
    (batch.weight ?? inkWeight(batch.ink)) *
    weightScale[weight] *
    strokeUnit(size)
  );
}
// The polygon offset factor that pushes sheets back: their depth's change
// across the widest stroke's half width, and a pixel more, so a stroke
// lying on a sheet is not cut by the sheet's slope beneath it. Hairlines
// need only the pixel. The drawing and the vector export's sampled hiding
// use the same. Tapered strokes widen by up to taper (taperBound).
export function sheetOffset(
  lines: { ink: number; weight?: number }[],
  weight: LineWeight,
  size: { width: number; height: number },
  taper = 1,
) {
  if (weight === "hairline") return 1;
  return (
    1 +
    Math.max(
      0.5,
      ...lines.map((b) => (strokeWidth(b, weight, size)! * taper) / 2),
    )
  );
}
// The weight as an export's metadata records it, only for strokes, so files
// drawn with hairlines are unchanged.
export function strokeRecord(spec: Sight) {
  if (spec.weight === "hairline") return undefined;
  const statement = `Lines are strokes ${weightScale[spec.weight]} × their layer's weight wide, in pixels of a 1000 × 760 page scaled to the image, with round ends.`;
  if (spec.depth !== "taper") return { weight: spec.weight, statement };
  return {
    weight: spec.weight,
    depth: spec.depth,
    statement: `${statement} Through a perspective lens that width is a stroke's where it crosses the plane through the view's target (one radius ahead of the eye when riding a ray), and it is multiplied by that plane's distance from the eye over the stroke's, held from ${taperRange[0]} to ${taperRange[1]}.`,
  };
}

// Strokes through a perspective lens: even, every stroke its weight's width
// wherever it is, or tapering with depth, as a line of fixed thickness in
// space would look. A tapered stroke is its weight's width where it crosses
// the plane through the view's target (the camera's focus), and that times
// focus/w elsewhere, w its clip w, which is its distance from the eye over
// the radius: twice as wide at half the distance, half as wide at twice it.
// The factor is held within taperRange, so a line passing beside the eye
// does not fill the page and a far one does not vanish. On the page 1/w is
// affine along a segment, so the width changes linearly along it. An
// orthographic view has w = 1 at every point and nothing to taper.
export const strokeDepths: { value: StrokeDepth; label: string }[] = [
  { value: "even", label: "Even" },
  { value: "taper", label: "Taper with distance" },
];
export const taperRange: [number, number] = [0.25, 4];
// The line drawing (SVG) gives each stroke one width per path, so it draws
// a tapered line in steps: each step's width is a power of taperStep times
// the weight's (or an end of taperRange), within a factor of √taperStep of
// the drawing's width at every point of the step.
export const taperStep = 1.05;
// The factor a stroke's width is multiplied by at a point of clip w.
export function strokeTaper(
  k: Pick<Camera, "lens" | "focus">,
  w: number,
  depth: StrokeDepth | undefined,
) {
  if (depth !== "taper" || k.lens[0] === 0) return 1;
  return Math.min(taperRange[1], Math.max(taperRange[0], k.focus / w));
}
// The largest factor a point of the study's bounds can have: the sheets'
// polygon offset must reach the widest stroke drawn on them.
export function taperBound(
  k: Camera,
  bounds: { center: Vec3; radius: number },
  depth: StrokeDepth | undefined,
) {
  if (depth !== "taper" || k.lens[0] === 0) return 1;
  const c = bounds.center,
    w = clip(k, c.x, c.y, c.z)[3] - bounds.radius * k.lens[0];
  return w > 0 ? strokeTaper(k, w, depth) : taperRange[1];
}
// A tapered stroke's width step, as the line drawing draws it: the factor
// g = focus/w (before taperRange holds it) rounded to a power of
// taperStep, or the end of taperRange it passes.
export function taperStepOf(g: number) {
  const [lo, hi] = taperRange;
  if (!(g > lo)) return lo;
  if (g >= hi) return hi;
  return Math.min(
    hi,
    Math.max(lo, taperStep ** Math.round(Math.log(g) / Math.log(taperStep))),
  );
}
// The factors g where a tapered stroke's step changes between a and b:
// the ends of taperRange and halfway (in ratio) between steps.
export function taperBreaks(a: number, b: number) {
  const lo = Math.min(a, b),
    hi = Math.max(a, b),
    out: number[] = [];
  const add = (g: number) => {
    if (g > lo && g < hi) out.push(g);
  };
  add(taperRange[0]);
  const log = Math.log(taperStep);
  for (
    let k = Math.ceil(Math.log(Math.max(lo, taperRange[0])) / log - 0.5);
    taperStep ** (k + 0.5) < Math.min(hi, taperRange[1]);
    k++
  )
    add(taperStep ** (k + 0.5));
  add(taperRange[1]);
  return out;
}

// Field names, as errors name them.
export const sightFields = { opacity: "Sheet opacity α" } as const;
export const sightHelp = {
  sheets: tiered(
    "See-through shows folds and lines inside a surface.",
    "Where n layers overlap, their mean color covers the background with opacity 1 − (1 − α)ⁿ, whatever their depth. It shows folds; it does not model light through glass.",
  ),
  opacity: `Each layer's opacity, from ${opacityRange[0]} to ${opacityRange[1]}.`,
  weight: tiered(
    "How wide lines are drawn; all but hairlines scale with the drawing.",
    `Fine, regular and bold keep their proportions at any size. On a 1000 × 760 page, regular draws the curve ${inkWeight(2)} px and construction lines ${inkWeight(1)} px wide; fine is ${weightScale.fine}× and bold ${weightScale.bold}× that. A hairline is one device pixel at any size, so it looks fainter in larger exports.`,
  ),
  depth: tiered(
    "Tapered strokes widen nearer the eye, through a perspective lens only.",
    `They have the weight's width on the plane through the view's target (one study radius ahead when riding a ray), twice it at half the distance, from ${taperRange[0]}× to ${taperRange[1]}×. Orthographic views and hairlines are always even.`,
  ),
  flat: "Strokes taper only through a perspective lens: choose one with Projection above the drawing, or ride a ray.",
  hidden: tiered(
    "How lines behind the nearest sheet are drawn: hidden, faint, or dashed.",
    `Faint lines are drawn at ${faintOpacity * 100}% opacity, dashed ones at ${dashedOpacity * 100}%, with dashes measured in space, so they shorten as a line recedes. A line lying on a sheet counts as in front of it.`,
  ),
  unstroked:
    "This device's graphics cannot draw strokes (they need instanced drawing), so lines are drawn as hairlines here and in exports.",
  unavailable:
    "This device's graphics cannot draw see-through sheets (they need half-float render targets), so sheets are drawn opaque here and in exports.",
};

export type SightError = { field: string; message: string };
// The setting as drawn: an invalid opacity leaves the sheets opaque, with
// the reason, and keeps the lines' setting.
export function sightSpec(sight: Sight): { spec: Sight; error?: SightError } {
  if (sight.sheets !== "through") return { spec: sight };
  const [lo, hi] = opacityRange,
    v = sight.opacity;
  const message = !Number.isFinite(v)
    ? "must be a finite number."
    : v < lo || v > hi
      ? `must be from ${lo} to ${hi}.`
      : undefined;
  if (!message) return { spec: sight };
  return {
    spec: { ...sight, sheets: "opaque" },
    error: { field: sightFields.opacity, message },
  };
}
// Whether the drawing is the plain opaque one, drawn exactly as before.
export const isPlain = (s: Sight) =>
  s.sheets === "opaque" && s.hidden === "hide";

// The cumulative length in space at each vertex of a batch's line pairs (7
// floats per vertex): a segment that starts exactly where the previous one
// ended continues its polyline; any other starts anew at 0.
export function arcLengths(data: Float32Array): Float64Array {
  const out = new Float64Array(data.length / 7);
  for (let v = 0; v + 1 < out.length; v += 2) {
    const a = 7 * v,
      b = a + 7;
    const joined =
      v > 0 &&
      data[a] === data[a - 7] &&
      data[a + 1] === data[a - 6] &&
      data[a + 2] === data[a - 5];
    out[v] = joined ? out[v - 1] : 0;
    out[v + 1] =
      out[v] +
      Math.hypot(
        data[b] - data[a],
        data[b + 1] - data[a + 1],
        data[b + 2] - data[a + 2],
      );
  }
  return out;
}
// Each line vertex's neighbor across its joint (4 floats: the point and 1),
// or zeros where its polyline starts or ends: a segment's start joins the
// previous segment's start when the previous one ended exactly there, and
// its end joins the next segment's end likewise, as arcLengths joins them.
// Strokes mitre their ends toward these.
export function strokeJoins(data: Float32Array): Float32Array {
  const count = data.length / 7,
    out = new Float32Array(4 * count);
  const same = (a: number, b: number) =>
    data[7 * a] === data[7 * b] &&
    data[7 * a + 1] === data[7 * b + 1] &&
    data[7 * a + 2] === data[7 * b + 2];
  const put = (v: number, from: number) => {
    out.set(data.subarray(7 * from, 7 * from + 3), 4 * v);
    out[4 * v + 3] = 1;
  };
  for (let v = 0; v + 1 < count; v += 2) {
    if (v > 0 && same(v, v - 1)) put(v, v - 2);
    if (v + 3 < count && same(v + 1, v + 2)) put(v + 1, v + 3);
  }
  return out;
}
// Dash periods per unit of length in space: a period is dashPeriod of the
// page's shorter side, and the camera draws radius × 1.16 / zoom across
// half of it.
export const dashesPerUnit = (view: { zoom: number; radius: number }) =>
  view.zoom / (1.16 * view.radius * 2 * dashPeriod);

// The setting as an export's metadata records it, only when it changes the
// drawing, so plain files are unchanged. `through` is whether the device
// could draw see-through sheets.
export function sightRecord(spec: Sight, through: boolean) {
  if (isPlain(spec)) return undefined;
  const sheets = spec.sheets === "through" && through ? "through" : "opaque";
  const statements: string[] = [];
  if (sheets === "through")
    statements.push(
      `Sheets seen through: each pixel is the mean of the shaded colors of its n sheet layers over the background with opacity 1 − (1 − α)ⁿ, α = ${spec.opacity}, independent of drawing order.`,
    );
  else if (spec.sheets === "through")
    statements.push(
      "See-through sheets were asked for, but this device could not draw them, so sheets are opaque.",
    );
  if (spec.hidden === "faint")
    statements.push(
      `Lines behind the nearest sheet are drawn at ${faintOpacity * 100}% opacity.`,
    );
  else if (spec.hidden === "dashed")
    statements.push(
      `Lines behind the nearest sheet are dashed at ${dashedOpacity * 100}% opacity, one dash every 1% of the shorter side, measured along the line in space.`,
    );
  return {
    sheets,
    ...(sheets === "through" && { opacity: spec.opacity }),
    hidden: spec.hidden,
    statement: statements.join(" "),
  };
}
