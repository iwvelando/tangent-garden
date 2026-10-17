import type { Config, Ray, Result, Vec } from "./types";

// A world-coordinate rectangle: the view the light enters.
export type Rect = { x0: number; x1: number; y0: number; y1: number };
// When each sample is lit and when its caustic point is reached, as optical
// path length τ (distance times refractive index), so light slows to c/n in
// each medium. Parallel light is a plane wavefront that starts, at τ = 0,
// where it first touches the view (or the lit curve, if that lies further
// upstream); a point source starts at the source.
export type Timeline = {
  // τ at which the drawing is complete, before p = 1 shows everything.
  total: number;
  // τ at which each sample's incident ray reaches the curve; NaN when unlit.
  hit: number[];
  // τ at which each sample's caustic point is reached; Infinity when there
  // is none, as at total internal reflection.
  arrival: number[];
  // Where each sample's incident light is at τ = 0, and its unit direction.
  start: (Vec | null)[];
  // How far behind its starting front parallel light is drawn, so a plane
  // wave streams in from past a panel wider than the view; 0 for a point.
  behind: number;
  incident: (Vec | null)[];
  nIncident: number;
  nTransmitted: number;
  // How far each outgoing ray is drawn, as in the study, and whether it
  // stops at its caustic point (see reach).
  distance: number;
  stop: boolean;
};

const finite = (v: Vec | null | undefined): v is Vec =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y);
const along = (p: Vec, d: Vec, s: number) => ({
  x: p.x + d.x * s,
  y: p.y + d.y * s,
});
const inside = (p: Vec, r: Rect) =>
  p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

// How far an optical study's ray is drawn ahead of the curve and back
// behind it. Every ray runs the ray length both ways, unless it stops at the
// caustic: then a ray ends at its caustic point, or at the ray length if
// that comes first. Only a ray whose caustic point is virtual extends behind
// the curve, as far as that point, and it runs as far ahead, so the drawing
// keeps to the caustic's scale. A ray with no caustic point, as under total
// internal reflection, runs the ray length with no extension.
export function reach(ray: Ray, distance: number, stop: boolean) {
  if (!stop) return { ahead: distance, behind: distance };
  const q = ray.target;
  const s = finite(q)
    ? (q.x - ray.origin.x) * ray.direction.x +
      (q.y - ray.origin.y) * ray.direction.y
    : NaN;
  if (!Number.isFinite(s)) return { ahead: distance, behind: 0 };
  return s >= 0
    ? { ahead: Math.min(distance, s), behind: 0 }
    : { ahead: Math.min(distance, -s), behind: Math.min(distance, -s) };
}

// Times every sample of an optical study within the given view. Nothing is
// recomputed: the hit points, caustic points, and rays are the study's own.
// Like the study, the trace infers no scene topology: every sample is lit,
// whether or not another part of the curve stands in the way.
export function traceTimeline(
  result: Result,
  config: Config,
  rect: Rect,
  distance: number,
  stop = false,
): Timeline {
  const points = result.input ?? result.base;
  const refracting = config.kind === "diacaustic";
  const nIncident = refracting ? config.nIncident : 1,
    nTransmitted = refracting ? config.nTransmitted : 1;
  const source = result.sourcePosition ?? config.source.position;
  const parallel = config.source.kind === "parallel";
  const a = (config.source.angle * Math.PI) / 180;
  const beam = { x: Math.cos(a), y: Math.sin(a) };
  const dot = (p: Vec) => beam.x * p.x + beam.y * p.y;
  // The plane wavefront's starting position along the beam.
  let front = Math.min(
    ...[
      { x: rect.x0, y: rect.y0 },
      { x: rect.x1, y: rect.y0 },
      { x: rect.x0, y: rect.y1 },
      { x: rect.x1, y: rect.y1 },
    ].map(dot),
  );
  if (parallel)
    for (const p of points) if (finite(p)) front = Math.min(front, dot(p));
  const n = points.length;
  const hit: number[] = new Array(n).fill(NaN),
    arrival: number[] = new Array(n).fill(Infinity),
    start: (Vec | null)[] = new Array(n).fill(null),
    incident: (Vec | null)[] = new Array(n).fill(null);
  for (let j = 0; j < n; j++) {
    const p = points[j];
    if (!finite(p)) continue;
    if (parallel) {
      const travel = dot(p) - front;
      incident[j] = beam;
      start[j] = along(p, beam, -travel);
      hit[j] = nIncident * travel;
    } else {
      const reach = Math.hypot(p.x - source.x, p.y - source.y);
      if (!(reach > 0)) continue;
      incident[j] = {
        x: (p.x - source.x) / reach,
        y: (p.y - source.y) / reach,
      };
      start[j] = source;
      hit[j] = nIncident * reach;
    }
    const q = result.derived[j];
    if (finite(q))
      arrival[j] = hit[j] + nTransmitted * Math.hypot(q.x - p.x, q.y - p.y);
  }
  // The drawing is complete once every ray has its full length and every
  // caustic point in view is reached; points beyond the view, such as
  // asymptotic outliers, arrive with the final frame.
  let total = 0;
  for (const ray of result.rays) {
    const t = hit[ray.sampleIndex];
    const { ahead, behind } = reach(ray, distance, stop);
    if (Number.isFinite(t))
      total = Math.max(
        total,
        t + (ray.tir ? nIncident : nTransmitted) * Math.max(ahead, behind),
      );
  }
  arrival.forEach((t, j) => {
    const q = result.derived[j];
    if (Number.isFinite(t) && finite(q) && inside(q, rect))
      total = Math.max(total, t);
  });
  if (!(total > 0))
    total = hit.reduce((m, t) => (Number.isFinite(t) ? Math.max(m, t) : m), 1);
  return {
    total,
    hit,
    arrival,
    start,
    incident,
    nIncident,
    nTransmitted,
    distance,
    stop,
    behind: parallel ? 2 * Math.max(rect.x1 - rect.x0, rect.y1 - rect.y0) : 0,
  };
}

// The optical path at progress p of a timeline.
export const tauAt = (timeline: Timeline, p: number) =>
  p >= 1 ? Infinity : Math.max(0, p) * timeline.total;

// When the light reaches the caustic at a position in sample steps: at a
// sample, its own arrival; between samples, once both neighbors' light has
// arrived, at the arrival interpolated between them. Infinity when either
// has none.
export function arrivalAt(timeline: Timeline, step: number) {
  const i = Math.floor(step),
    f = step - i,
    a = timeline.arrival[i],
    b = timeline.arrival[Math.min(i + 1, timeline.arrival.length - 1)];
  if (f === 0) return a;
  return Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * f : Infinity;
}

// The study at progress p of its timeline: each caustic sample appears once
// its ray reaches it, and is never joined across one that has not. A caustic
// refined between samples is traced the same way, each inserted point at
// its interpolated arrival. Each representative ray carries the part of its
// path traveled so far. p = 1 is the complete study, with every ray at its
// full length.
export function trace(result: Result, timeline: Timeline, p: number): Result {
  const tau = tauAt(timeline, p);
  const refined = result.adaptive?.derived;
  return {
    ...result,
    derived: result.derived.map((q, j) =>
      timeline.arrival[j] <= tau ? q : null,
    ),
    ...(refined && {
      adaptive: {
        ...result.adaptive,
        derived: {
          ...refined,
          points: refined.points.map((q, i) =>
            arrivalAt(timeline, refined.at[i]) <= tau ? q : null,
          ),
        },
      },
    }),
    rays: result.rays.map((ray) => {
      const j = ray.sampleIndex,
        from = timeline.start[j],
        beam = timeline.incident[j],
        t = timeline.hit[j];
      if (!from || !beam || !Number.isFinite(t))
        return { ...ray, traced: undefined };
      const length = t / timeline.nIncident;
      const traveled = tau / timeline.nIncident;
      const to = traveled >= length ? ray.origin : along(from, beam, traveled);
      const tail = along(from, beam, -timeline.behind);
      const speed = ray.tir ? timeline.nIncident : timeline.nTransmitted;
      const { ahead, behind } = reach(ray, timeline.distance, timeline.stop);
      const out = tau > t ? (tau - t) / speed : null;
      return {
        ...ray,
        traced: {
          from: tail,
          to,
          out:
            out === null
              ? null
              : along(ray.origin, ray.direction, Math.min(ahead, out)),
          back:
            out === null || !(behind > 0)
              ? null
              : along(ray.origin, ray.direction, -Math.min(behind, out)),
        },
      };
    }),
  };
}
