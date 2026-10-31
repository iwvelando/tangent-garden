import type {
  GeodesicResult,
  GeodesicThread,
  TransportResult,
  TransportSamples,
  Vec3,
} from "./types";

// A thread's drawn path: its samples, then where it stopped when that lies
// beyond its last sample. Each point carries its arc length.
export function threadPath(th: GeodesicThread, step: number) {
  const points: Vec3[] = [...th.points],
    arcs = th.points.map((_, k) => k * step);
  if (th.reached > arcs[arcs.length - 1] + 1e-9 * step) {
    points.push(th.end);
    arcs.push(th.reached);
  }
  return { points, arcs };
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

// The fan revealed through arc length p·L, the same on every thread: each
// keeps its samples so far and ends on its drawn chord at that length. A
// thread revealed short of where it stopped is `partial`, so its stop is
// marked only once the reveal passes it.
export function revealGeodesics(
  g: GeodesicResult,
  p: number,
  length: number,
): GeodesicResult {
  if (p >= 1) return g;
  const at = Math.max(0, p) * length;
  return {
    ...g,
    ...(g.transport &&
      !g.transport.unavailable && {
        transport: {
          ...g.transport,
          shown: Math.max(0, p) * g.transport.length,
        },
      }),
    threads: g.threads.map((th) => {
      if (at >= th.reached) return th;
      const { points, arcs } = threadPath(th, g.step);
      let k = 0;
      while (k + 1 < arcs.length && arcs[k + 1] <= at) k++;
      const end =
        k + 1 < arcs.length
          ? lerp(
              points[k],
              points[k + 1],
              (at - arcs[k]) / (arcs[k + 1] - arcs[k]),
            )
          : points[k];
      const kept = Math.min(k + 1, th.points.length);
      return {
        ...th,
        points: th.points.slice(0, kept),
        tangents: th.tangents.slice(0, kept),
        ...(th.u && { u: th.u.slice(0, kept), v: th.v!.slice(0, kept) }),
        end,
        endTangent: th.tangents[kept - 1],
        reached: at,
        partial: true,
      };
    }),
  };
}

// With a carried arrow, a reveal travels the path for the first 1 − hold
// of its progress and holds the arrival for the rest, so the returned
// arrow stays in view; the threads are revealed on the same schedule.
export const transportHold = 0.2;
export const travel = (p: number) =>
  Math.min(1, Math.max(0, p) / (1 - transportHold));
// Whether a fan carries an arrow that is drawn.
export const carries = (g: GeodesicResult | undefined) =>
  !!g?.transport && !g.transport.unavailable;

// The sample the arrow stands at when the reveal has reached arc length s:
// the last at or before s, so a corner shows the arrow that arrived there.
// Without a reveal it stands at the last sample, where the path ended.
export function transportIndex(
  tr: TransportResult,
  s = tr.shown ?? Infinity,
): number {
  const arcs = tr.samples.arcs;
  let lo = 0,
    hi = arcs.length - 1;
  if (hi < 0) return -1;
  if (s >= arcs[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arcs[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// The arrow's path through arc length s, ending on its chord there.
export function routeThrough(
  tr: TransportResult,
  s = tr.shown ?? Infinity,
): Vec3[] {
  const { arcs, points } = tr.samples;
  const k = transportIndex(tr, s);
  if (k < 0) return [];
  const out = points.slice(0, k + 1);
  if (k + 1 < arcs.length && s > arcs[k])
    out.push(
      lerp(points[k], points[k + 1], (s - arcs[k]) / (arcs[k + 1] - arcs[k])),
    );
  return out;
}

// An arrow of length size from sample k: its shaft, then its head's two
// barbs, which lie in the tangent plane, as point pairs.
export function arrowLines(
  s: TransportSamples,
  k: number,
  size: number,
): Vec3[] {
  const p = s.points[k],
    v = s.vectors[k],
    n = s.normals[k];
  const side = {
    x: n.y * v.z - n.z * v.y,
    y: n.z * v.x - n.x * v.z,
    z: n.x * v.y - n.y * v.x,
  };
  const at = (a: number, b: number, c: number): Vec3 => ({
    x: p.x + a * v.x + b * side.x,
    y: p.y + a * v.y + b * side.y,
    z: p.z + a * v.z + b * side.z,
  });
  const tip = at(size, 0, 0),
    head = 0.28 * size,
    back = size - head * Math.cos(Math.PI / 7),
    wide = head * Math.sin(Math.PI / 7);
  return [p, tip, tip, at(back, wide, 0), tip, at(back, -wide, 0)];
}
