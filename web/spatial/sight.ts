// Seeing through the drawing: a drawing setting, not part of the study, like
// the cut. Sheets can be drawn see-through, and lines behind the nearest
// sheet can be drawn faint or dashed instead of hidden. This module holds
// the setting's fields, limits, words and rules, read by the panel, the
// renderer, linework, links and exports alike.

export type SheetSight = "opaque" | "through";
export type HiddenLines = "hide" | "faint" | "dashed";
export type Sight = {
  sheets: SheetSight;
  // Each sheet layer's opacity α when sheets are seen through.
  opacity: number;
  hidden: HiddenLines;
};
export const defaultSight: Sight = {
  sheets: "opaque",
  opacity: 0.35,
  hidden: "hide",
};
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
// Field names, as errors name them.
export const sightFields = { opacity: "Sheet opacity α" } as const;
export const sightHelp = {
  sheets:
    "See-through draws every sheet layer at once, so folds, inner sheets and lines inside a surface show. At each point of the page, the color is the mean of the shaded colors of all n sheet layers there, laid over the background with opacity 1 − (1 − α)ⁿ: the more layers overlap, the denser the drawing. Every layer counts the same whatever its depth, so it needs no sorting and intersecting sheets are drawn exactly; it is a way to see folds, not a model of light through glass. The study itself is unchanged.",
  opacity: `Each layer's opacity, from ${opacityRange[0]} to ${opacityRange[1]}. Two layers cover 1 − (1 − α)² of the background, three 1 − (1 − α)³.`,
  hidden: `Lines behind the nearest sheet: hidden, as an opaque drawing hides them; faint, at ${faintOpacity * 100}% opacity; or dashed, at ${dashedOpacity * 100}% opacity, one dash every ${dashPeriod * 100}% of the shorter side of the drawing, measured along the line in space, so a line receding from view has shorter dashes. A line lying on a sheet is in front of it. Lines never hide other lines.`,
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
