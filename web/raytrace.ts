import type { Config, Result, Vec } from "./types";

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
  // How far each outgoing ray is drawn, as in the study.
  distance: number;
};

const finite = (v: Vec | null | undefined): v is Vec =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y);
const along = (p: Vec, d: Vec, s: number) => ({
  x: p.x + d.x * s,
  y: p.y + d.y * s,
});
const inside = (p: Vec, r: Rect) =>
  p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

// Times every sample of an optical study within the given view. Nothing is
// recomputed: the hit points, caustic points, and rays are the study's own.
// Like the study, the trace infers no scene topology: every sample is lit,
// whether or not another part of the curve stands in the way.
export function traceTimeline(
  result: Result,
  config: Config,
  rect: Rect,
  distance: number,
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
    if (Number.isFinite(t))
      total = Math.max(
        total,
        t + (ray.tir ? nIncident : nTransmitted) * distance,
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
    behind: parallel ? 2 * Math.max(rect.x1 - rect.x0, rect.y1 - rect.y0) : 0,
  };
}

// The study at progress p of its timeline: each caustic sample appears once
// its ray reaches it, and is never joined across one that has not. Each
// representative ray carries the part of its path travelled so far. p = 1
// is the complete study, with every ray at its full length.
export function trace(result: Result, timeline: Timeline, p: number): Result {
  const tau = p >= 1 ? Infinity : Math.max(0, p) * timeline.total;
  return {
    ...result,
    derived: result.derived.map((q, j) =>
      timeline.arrival[j] <= tau ? q : null,
    ),
    rays: result.rays.map((ray) => {
      const j = ray.sampleIndex,
        from = timeline.start[j],
        beam = timeline.incident[j],
        t = timeline.hit[j];
      if (!from || !beam || !Number.isFinite(t))
        return { ...ray, traced: undefined };
      const length = t / timeline.nIncident;
      const travelled = tau / timeline.nIncident;
      const to =
        travelled >= length ? ray.origin : along(from, beam, travelled);
      const tail = along(from, beam, -timeline.behind);
      const speed = ray.tir ? timeline.nIncident : timeline.nTransmitted;
      const out =
        tau > t ? Math.min(timeline.distance, (tau - t) / speed) : null;
      return {
        ...ray,
        traced: {
          from: tail,
          to,
          out: out === null ? null : along(ray.origin, ray.direction, out),
          back: out === null ? null : along(ray.origin, ray.direction, -out),
        },
      };
    }),
  };
}
