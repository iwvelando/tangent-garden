import type { Pursuer, PursuitResult } from "./types";

const time = (t: number) => String(Number(t.toPrecision(6)));

// Why the chase stopped where it did, with pursuers numbered from 1.
export function captureNote(pursuit: PursuitResult, min: number) {
  const c = pursuit.capture;
  if (c && c.time === min)
    return `Pursuer ${c.pursuer + 1} starts within the capture distance of pursuer ${c.target + 1}, so the chase ends at once.`;
  if (c)
    return `Pursuer ${c.pursuer + 1} comes within the capture distance of pursuer ${c.target + 1} at t = ${time(c.time)}, and the chase stops there for everyone: later samples are left empty.`;
  if (pursuit.exhausted)
    return `The chase ran out of integration steps at t = ${time(pursuit.end)}: later samples are left empty. A shorter domain or a larger capture distance needs fewer steps.`;
  return "No pursuer comes within the capture distance of its target by the end of the domain.";
}

// A pursuer to add after the last: halfway back to the first, which it will
// chase, at the last one's speed.
export function nextPursuer(pursuers: Pursuer[]): Pursuer {
  const last = pursuers.at(-1)!;
  const first = pursuers[0];
  const mid = (a: number, b: number) =>
    Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : 0;
  return {
    x: mid(last.x, first.x),
    y: mid(last.y, first.y),
    speed: Number.isFinite(last.speed) ? last.speed : 1,
  };
}

// The pursuers spaced evenly counterclockwise, in chase order, on the circle
// about their centroid through the farthest of them, starting from the
// first. Speeds are kept.
export function regularPolygon(pursuers: Pursuer[]): Pursuer[] {
  const n = pursuers.length;
  const cx = pursuers.reduce((s, p) => s + p.x, 0) / n;
  const cy = pursuers.reduce((s, p) => s + p.y, 0) / n;
  const radius = Math.max(
    ...pursuers.map((p) => Math.hypot(p.x - cx, p.y - cy)),
  );
  const [x0, y0, r] =
    Number.isFinite(radius) && radius > 0 ? [cx, cy, radius] : [0, 0, 1];
  const first = pursuers[0];
  const start =
    Number.isFinite(radius) && radius > 0
      ? Math.atan2(first.y - cy, first.x - cx)
      : 0;
  return pursuers.map((p, j) => {
    const a = start + (2 * Math.PI * j) / n;
    return { ...p, x: x0 + r * Math.cos(a), y: y0 + r * Math.sin(a) };
  });
}
