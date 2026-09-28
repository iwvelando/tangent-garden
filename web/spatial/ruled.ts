import type { SpatialResult } from "./types";

const short = (v: number) => Number(v.toPrecision(3)).toString();

// What the rulings join, whether the surface closes, where it stops or
// pinches, and whether it is developable.
export function ruledNote(result: SpatialResult): string[] {
  const q = result.ruled!;
  const out = [
    q.partner === "chord"
      ? "Chords join each point a(t) to a(mt + δ) on the same curve."
      : "Straight rulings join each point a(t) to the second thread at b(mt + δ).",
  ];
  if (q.closed) out.push("Both threads close, so the surface closes.");
  else if (q.gap > 0)
    out.push(
      `The curve closes but its partner ends ${short(q.gap)} from where it began, so the surface has a seam.`,
    );
  else out.push("The curve is open, so the surface has two free ends.");
  if (q.outside > 0)
    out.push(
      `${q.outside} chords would reach beyond the open domain and are left out.`,
    );
  const gaps = q.breaks.filter((b, i) => b && !result.breaks[i]).length;
  if (gaps > 0)
    out.push(
      `The partner is missing or jumps across ${gaps === 1 ? "one interval" : `${gaps} intervals`}; the surface is not joined there.`,
    );
  const regular = result.mesh.length > 0;
  if (q.coincident > 0)
    out.push(
      regular
        ? `${q.coincident === 1 ? "One ruling has" : `${q.coincident} rulings have`} zero length where the threads meet; the surface pinches there.`
        : "Every ruling has zero length: each point is its own partner, so there is no surface.",
    );
  if (q.singular > 0)
    out.push(
      `On ${q.singular === 1 ? "one ruling" : `${q.singular} rulings`} S_t × S_u vanishes, as at a cone's apex; the shading there uses the neighbouring faces.`,
    );
  if (regular)
    out.push(
      q.developable
        ? "The surface is developable: det(a′, d, d′) vanishes, so its normal is constant along each ruling."
        : `The surface is not developable: its normal turns along the rulings (largest scale-free det(a′, d, d′) ≈ ${short(q.deviation)}).`,
    );
  return out;
}
