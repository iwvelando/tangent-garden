import type { SpatialResult } from "./types";

const short = (v: number) => Number(v.toPrecision(3)).toString();
const samples = (n: number) => (n === 1 ? "one sample" : `${n} samples`);

// Whether the spheres keep a real envelope, where it closes, collapses,
// vanishes or folds, and why a centre has no circle.
export function canalNote(result: SpatialResult): string[] {
  const q = result.canal!;
  const out = [
    q.constant
      ? "A tube: every sphere has the same radius R, so each contact circle is the circle of radius R in the normal plane."
      : `Each sphere touches the envelope along a circle set back along the tangent by RR′/v, of radius R√(1 − (R′/v)²); |R′|/v reaches ${short(q.steepest)}.`,
  ];
  if (q.closed)
    out.push("The curve and the radius both close, so the surface closes.");
  else if (q.gap > 0)
    out.push(
      `The curve closes but the radius does not return: the first and last contact circles are ${short(q.gap)} apart.`,
    );
  else out.push("The curve is open, so the surface has two open ends.");
  if (q.imaginary > 0)
    out.push(
      `On ${samples(q.imaginary)} the radius changes faster than the centre moves, |R′| > v: those spheres have no real envelope, and the surface stops.`,
    );
  if (q.between > 0)
    out.push(
      `Between samples the envelope also vanishes in ${q.between === 1 ? "one interval" : `${q.between} intervals`}, which are left open.`,
    );
  if (q.collapsed > 0)
    out.push(
      `On ${samples(q.collapsed)} |R′| = v, and the contact circle collapses to a point.`,
    );
  if (q.undefined > 0)
    out.push(
      `R·ρ(t) is not a positive, finite radius with a finite slope on ${samples(q.undefined)}; there is no sphere there.`,
    );
  if (result.invalid > 0)
    out.push(
      `${result.invalid === 1 ? "One sample has" : `${result.invalid} samples have`} no regular centre, where the curve stops or is undefined; no contact circle is defined there.`,
    );
  if (q.folded > 0)
    out.push(
      q.constant
        ? `The tube folds back through itself on ${samples(q.folded)}, where R exceeds the radius of curvature. The folds are drawn, not trimmed.`
        : `The surface folds back on itself on ${samples(q.folded)}, across a cusped edge where the contact circles turn back along the curve or the tube is wider than the curve can turn. The folds are drawn, not trimmed.`,
    );
  return out;
}
