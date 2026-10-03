import type {
  Bounds3,
  RaysResult,
  SpatialConfig,
  SpatialResult,
  SurfaceSheet,
  Vec3,
} from "./types";

// When each mirror or interface sample is lit and when each of its caustic
// points is reached, as optical path length τ (distance times refractive
// index), so light slows to c/n in each medium. Parallel light is a plane
// wavefront that starts, at τ = 0, tangent to the sphere the camera frames
// (or at the lit surface, if that lies further upstream); a point source
// starts at the source.
export type Timeline = {
  // τ at which the drawing is complete, before p = 1 shows everything.
  total: number;
  // τ at which each sample (i, j) is lit; NaN where it has no point.
  hit: number[][];
  // For each caustic part, in the study's order, τ at which each of its
  // points is reached; Infinity where it has none.
  arrival: number[][][];
  // Where each sample's incident light is at τ = 0, and its unit direction.
  start: (Vec3 | null)[][];
  incident: (Vec3 | null)[][];
  nIncident: number;
  nTransmitted: number;
  // Whether the outgoing light is refracted (else reflected); totally
  // reflected rays are marked on the study's own rays.
  refracting: boolean;
  // How far behind its starting front parallel light is drawn, so a plane
  // wave streams in from past the framing sphere; 0 for a point.
  behind: number;
};

const finite = (v: Vec3 | null | undefined): v is Vec3 =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const along = (p: Vec3, d: Vec3, s: number) => ({
  x: p.x + d.x * s,
  y: p.y + d.y * s,
  z: p.z + d.z * s,
});
const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const radians = (d: number) => (d * Math.PI) / 180;

// Times every sample of a mirror or interface study, entering the given
// framing sphere. Nothing is recomputed: the surface, caustic points and
// rays are the study's own. Like the study, the trace infers no scene
// topology: every lit sample is lit, whatever stands in the way.
export function traceTimeline(
  result: SpatialResult,
  config: SpatialConfig,
  bounds: Bounds3,
): Timeline {
  const rays = result.rays!;
  const light = config.rays;
  const refracting = light.interaction === "refract";
  const nIncident = refracting ? light.n1 : 1,
    nTransmitted = refracting ? light.n2 : 1;
  const parallel = light.light === "parallel";
  const a = radians(light.azimuth),
    b = radians(light.elevation);
  const beam = {
    x: Math.cos(b) * Math.cos(a),
    y: Math.cos(b) * Math.sin(a),
    z: Math.sin(b),
  };
  const dot = (p: Vec3) => beam.x * p.x + beam.y * p.y + beam.z * p.z;
  const source = rays.source ?? light.source;
  const points = rays.surface.points;
  let front = dot(bounds.center) - bounds.radius;
  if (parallel)
    for (const row of points)
      for (const p of row) if (finite(p)) front = Math.min(front, dot(p));
  const hit = points.map((row) => row.map(() => NaN));
  const start: (Vec3 | null)[][] = points.map((row) => row.map(() => null));
  const incident: (Vec3 | null)[][] = points.map((row) => row.map(() => null));
  points.forEach((row, i) =>
    row.forEach((p, j) => {
      if (!finite(p)) return;
      if (parallel) {
        const travel = dot(p) - front;
        incident[i][j] = beam;
        start[i][j] = along(p, beam, -travel);
        hit[i][j] = nIncident * travel;
      } else {
        const reach = gap(p, source);
        if (!(reach > 0)) return;
        incident[i][j] = {
          x: (p.x - source.x) / reach,
          y: (p.y - source.y) / reach,
          z: (p.z - source.z) / reach,
        };
        start[i][j] = source;
        hit[i][j] = nIncident * reach;
      }
    }),
  );
  const arrival = rays.caustics.map((c) =>
    c.points.map((row, i) =>
      row.map((q, j) => {
        const p = points[i]?.[j];
        return finite(q) && finite(p) && Number.isFinite(hit[i][j])
          ? hit[i][j] + nTransmitted * gap(q, p)
          : Infinity;
      }),
    ),
  );
  // The drawing is complete once every ray has its full length and every
  // caustic point inside the framing sphere is reached; points beyond it,
  // such as those near infinity, arrive with the final frame.
  let total = 0;
  for (const line of rays.lines) {
    const t = hit[line.i]?.[line.j];
    if (Number.isFinite(t))
      total = Math.max(
        total,
        t +
          (line.total ? nIncident : nTransmitted) *
            Math.max(gap(line.end, line.point), gap(line.back, line.point)),
      );
  }
  arrival.forEach((sheet, k) =>
    sheet.forEach((row, i) =>
      row.forEach((t, j) => {
        const q = rays.caustics[k].points[i][j];
        if (
          Number.isFinite(t) &&
          finite(q) &&
          gap(q, bounds.center) <= bounds.radius
        )
          total = Math.max(total, t);
      }),
    ),
  );
  if (!(total > 0))
    total = hit
      .flat()
      .reduce((m, t) => (Number.isFinite(t) ? Math.max(m, t) : m), 1);
  return {
    total,
    hit,
    arrival,
    start,
    incident,
    nIncident,
    nTransmitted,
    refracting,
    behind: parallel ? 2 * bounds.radius : 0,
  };
}

// A sheet with only the points reached by τ, and only the edges and faces
// whose every corner is reached.
function reachedSheet<S extends SurfaceSheet>(
  sheet: S,
  arrival: number[][],
  tau: number,
): S {
  const on = (i: number, j: number) => arrival[i]?.[j] <= tau;
  return {
    ...sheet,
    points: sheet.points.map((row, i) =>
      row.map((p, j) => (on(i, j) ? p : null)),
    ),
    normals: sheet.normals.map((row, i) =>
      row.map((n, j) => (on(i, j) ? n : null)),
    ),
    alongU: sheet.alongU.map((row, i) =>
      row.map((e, j) => e && on(i, j) && on(i + 1, j)),
    ),
    alongV: sheet.alongV.map((row, i) =>
      row.map((e, j) => e && on(i, j) && on(i, j + 1)),
    ),
    faces: sheet.faces.map((row, i) =>
      row.map(
        (f, j) =>
          f && on(i, j) && on(i + 1, j) && on(i, j + 1) && on(i + 1, j + 1),
      ),
    ),
  };
}

// The study at progress p of its timeline. Each representative ray runs
// from its light to where the light has reached: `point` is the incident
// front until the ray reaches the surface, then the surface point, with
// `end` and `back` as far along and behind as the outgoing light has gone.
// The receiver collects the whole family, so it appears only at p = 1,
// which is the complete study with every ray at its full length.
export function trace(
  result: SpatialResult,
  timeline: Timeline,
  p: number,
): SpatialResult {
  const rays = result.rays!;
  const tau = p >= 1 ? Infinity : Math.max(0, p) * timeline.total;
  const traced: RaysResult = {
    ...rays,
    caustics: rays.caustics.map((c, k) =>
      reachedSheet(c, timeline.arrival[k], tau),
    ),
    lines: rays.lines.map((line) => {
      const from = timeline.start[line.i]?.[line.j],
        beam = timeline.incident[line.i]?.[line.j],
        t = timeline.hit[line.i]?.[line.j];
      if (!from || !beam || !Number.isFinite(t)) return line;
      const tail = along(from, beam, -timeline.behind);
      if (!(tau > t)) {
        const front = along(from, beam, tau / timeline.nIncident);
        return { ...line, start: tail, point: front, end: front, back: front };
      }
      const out =
        (tau - t) / (line.total ? timeline.nIncident : timeline.nTransmitted);
      const toward = (to: Vec3) => {
        const reach = gap(to, line.point);
        if (!(reach > 0)) return line.point;
        return along(
          line.point,
          {
            x: (to.x - line.point.x) / reach,
            y: (to.y - line.point.y) / reach,
            z: (to.z - line.point.z) / reach,
          },
          Math.min(reach, out),
        );
      };
      return {
        ...line,
        start: tail,
        end: p >= 1 ? line.end : toward(line.end),
        back: p >= 1 ? line.back : toward(line.back),
      };
    }),
    receiver: p >= 1 ? rays.receiver : null,
  };
  return { ...result, rays: traced };
}
