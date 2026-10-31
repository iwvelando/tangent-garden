import type { GeodesicResult, GeodesicThread, Vec3 } from "./types";

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
