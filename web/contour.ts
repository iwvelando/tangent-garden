import type { ContourResult } from "./types";

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// What the curve's level set consists of, and where F could not be drawn
// through: poles or jumps, and points where it is not a number.
export function contourNote(result: ContourResult) {
  const contours = result.curve.contours;
  const closed = contours.filter((c) => c.closed).length;
  const open = contours.length - closed;
  const cut = "cut off at the window's edge or beside cells left out";
  const shape =
    contours.length === 0
      ? "F does not cross the level anywhere in the window, so there is no curve here. A level F only touches, at an isolated point or along a fold, is not drawn."
      : contours.length === 1
        ? closed
          ? "The curve is one closed contour."
          : `The curve is one open contour, ${cut}.`
        : !open
          ? `The curve has ${contours.length} closed contours.`
          : !closed
            ? `The curve has ${contours.length} open contours, ${cut}.`
            : `The curve has ${contours.length} contours: ${closed} closed and ${open} open, ${cut}.`;
  const notes = [shape];
  if (result.discontinuities.length)
    notes.push(
      `F changes sign without reaching the level across ${count(result.discontinuities.length, "grid edge")}, marked ×: a pole or a jump, not a curve, so no contour is drawn there.`,
    );
  if (result.nonfinite)
    notes.push(
      `F is not a finite number at ${count(result.nonfinite, "grid point")} of ${((result.columns + 1) * (result.rows + 1)).toLocaleString("en-US")}; the cells beside them are left out.`,
    );
  return notes.join(" ");
}
