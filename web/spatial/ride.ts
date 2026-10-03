// The camera that rides a ray: while light is traced (raytrace.ts), the
// drawing is seen through a perspective camera (scene.ts's Lens) that
// follows one representative ray a little behind its head, through its
// reflection or refraction and on past its caustic points. This module
// holds the ride's fields, limits, words and rules, read by the animation
// panel, playback, export and links alike. See
// mathematics.md#riding-a-ray.
//
// The ray is the one drawn at sample (i, j), a crossing of the parameter
// curves, so it has its whole polyline from the study: incident from where
// the light starts, the interaction point, and the reflected, refracted or
// (beyond the critical angle) totally reflected segment, as drawn. Its
// virtual extension behind the surface is never followed.
import type { Bounds3, SpatialConfig, SpatialResult, Vec3 } from "./types";
import type { Timeline } from "./raytrace";
import type { View } from "./scene";

export type Ride = {
  // The sample the ray stands at, along u and v; −1 for the middle
  // crossing.
  i: number;
  j: number;
  // The follow distance d and the turn's window Δτ, as optical path in
  // radii of the framing sphere.
  follow: number;
  turn: number;
};
export const defaultRide: Ride = { i: -1, j: -1, follow: 0.1, turn: 0.2 };
export const rideRange: [number, number] = [0, 4];
// The lens's angle across the page's shorter side, in degrees.
export const rideFov = 60;

export const rideFields = {
  u: "Ray at u",
  v: "Ray at v",
  follow: "Follow distance",
  turn: "Turn window",
};
export const rideHelp = {
  camera:
    "Rides one representative ray in perspective, a little behind the head of its light: down the incident ray, turning at the surface, then along the reflected, refracted or totally reflected ray as drawn, through its caustic points, until its head reaches the ray's drawn end. It never follows a virtual ray behind the surface. Up starts toward the side the ray turns to, so the turn is a pitch with no roll. The lens spans 60° across the page's shorter side.",
  ray: "The ray drawn where these parameter curves cross. A crossing the light does not reach has no ray to ride.",
  follow: `How far behind the ray's head the camera rides, as optical path (length × refractive index) in radii of the framing sphere, more than ${rideRange[0]} and at most ${rideRange[1]}. In glass of index 1.5 the camera is 1/1.5 as far behind in length.`,
  turn: `The optical path, in radii of the framing sphere, over which the camera turns from the incident ray to the outgoing one, centered on its own arrival at the surface, more than ${rideRange[0]} and at most ${rideRange[1]}. It turns smoothly, starting and ending at rest; a window twice the follow distance starts the turn as the ray's head reaches the surface.`,
};

const finite = (v: Vec3 | null | undefined): v is Vec3 =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const add = (a: Vec3, b: Vec3, s = 1) => ({
  x: a.x + b.x * s,
  y: a.y + b.y * s,
  z: a.z + b.z * s,
});
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const scaled = (v: Vec3, s: number) => ({ x: v.x * s, y: v.y * s, z: v.z * s });
// v's part perpendicular to the unit vector d.
const across = (v: Vec3, d: Vec3) => add(v, d, -dot(v, d));

// The crossings a ray can be chosen at: rows i along u (where the curves of
// constant u stand) and columns j along v, with their parameter values.
export function rideChoices(result: SpatialResult, config: SpatialConfig) {
  const rays = result.rays;
  return {
    u: (rays?.vCurves ?? []).map((index) => ({
      index,
      value: parameters(result, config, index, 0).u,
    })),
    v: (rays?.uCurves ?? []).map((index) => ({
      index,
      value: parameters(result, config, 0, index).v,
    })),
  };
}
// The parameters (u, v) of sample (i, j) on the study's grid.
function parameters(
  result: SpatialResult,
  config: SpatialConfig,
  i: number,
  j: number,
) {
  const points = result.rays?.surface.points ?? [],
    s = config.surface;
  const rows = Math.max(1, points.length - 1),
    cols = Math.max(1, (points[0]?.length ?? 2) - 1);
  // As weighted means, so the ends and a symmetric range's middle are
  // exact.
  return {
    u: (s.uMin * (rows - i) + s.uMax * i) / rows,
    v: (s.vMin * (cols - j) + s.vMax * j) / cols,
  };
}
// The ride at the nearest crossing (the middle one for −1), so a study
// whose curves change keeps a ray near the one chosen.
export function snapRide(result: SpatialResult, ride: Ride): Ride {
  const nearest = (list: number[], k: number) =>
    !list.length
      ? k
      : k < 0
        ? list[Math.floor((list.length - 1) / 2)]
        : list.reduce((best, x) =>
            Math.abs(x - k) < Math.abs(best - k) ? x : best,
          );
  return {
    ...ride,
    i: nearest(result.rays?.vCurves ?? [], ride.i),
    j: nearest(result.rays?.uCurves ?? [], ride.j),
  };
}

const line = (result: SpatialResult, ride: Ride) =>
  result.rays?.lines.find((l) => l.i === ride.i && l.j === ride.j);

export type RideError = { field: string; message: string };
// Why the ride cannot play, naming the field, or null. The field and the
// message read as one sentence.
export function rideError(result: SpatialResult, ride: Ride): RideError | null {
  if (!line(result, ride))
    return {
      field: rideFields.u,
      message: "meets no light at this v, so there is no ray to ride.",
    };
  for (const key of ["follow", "turn"] as const) {
    const v = ride[key];
    if (!(v > rideRange[0] && v <= rideRange[1]))
      return {
        field: rideFields[key],
        message: `must be more than ${rideRange[0]} and at most ${rideRange[1]} radii.`,
      };
  }
  return null;
}

export type Outgoing = "reflected" | "refracted" | "totally reflected";
// The chosen ray's polyline as optical path: incident from start along
// incident, reaching point at τ = hit, then along out at index nOut until
// τ = end, where its drawn length ends. follow and turn are optical path.
// The camera's orientation turns from incident toward out about one axis:
// up0 is its up before the turn, angle the whole turn.
export type RidePath = {
  i: number;
  j: number;
  start: Vec3;
  incident: Vec3;
  point: Vec3;
  out: Vec3;
  hit: number;
  end: number;
  nIn: number;
  nOut: number;
  outgoing: Outgoing;
  follow: number;
  turn: number;
  up0: Vec3;
  angle: number;
};
// The ride's polyline from the study and its trace timeline, with the
// follow distance and window scaled by the framing sphere's radius; null
// when the crossing has no ray.
export function ridePath(
  result: SpatialResult,
  timeline: Timeline,
  ride: Ride,
  around: Bounds3,
): RidePath | null {
  const l = line(result, ride);
  const start = timeline.start[ride.i]?.[ride.j],
    incident = timeline.incident[ride.i]?.[ride.j],
    hit = timeline.hit[ride.i]?.[ride.j];
  if (!l || !finite(start) || !finite(incident) || !Number.isFinite(hit))
    return null;
  const reach = length(add(l.end, l.point, -1));
  if (!(reach > 0)) return null;
  const out = scaled(add(l.end, l.point, -1), 1 / reach);
  const nOut = l.total ? timeline.nIncident : timeline.nTransmitted;
  // Up before the turn: toward the side the ray turns to, so the turn is a
  // pitch. Where the ray goes straight on or straight back, the light sets
  // no side: +z made perpendicular to the ray, or +y where the ray is
  // vertical.
  let up0 = across(out, incident);
  if (!(length(up0) > 1e-9)) up0 = across({ x: 0, y: 0, z: 1 }, incident);
  if (!(length(up0) > 1e-9)) up0 = across({ x: 0, y: 1, z: 0 }, incident);
  up0 = scaled(up0, 1 / length(up0));
  return {
    i: ride.i,
    j: ride.j,
    start,
    incident,
    point: l.point,
    out,
    hit,
    end: hit + nOut * reach,
    nIn: timeline.nIncident,
    nOut,
    outgoing: l.total
      ? "totally reflected"
      : timeline.refracting
        ? "refracted"
        : "reflected",
    follow: ride.follow * around.radius,
    turn: ride.turn * around.radius,
    up0,
    angle: Math.atan2(length(across(out, incident)), dot(out, incident)),
  };
}
// Where the light of the ride's ray has reached at optical path τ, on its
// polyline (extended back before its start).
function along(path: RidePath, tau: number) {
  const t = Math.min(tau, path.end);
  return t <= path.hit
    ? add(path.start, path.incident, t / path.nIn)
    : add(path.point, path.out, (t - path.hit) / path.nOut);
}

export type RidePose = {
  eye: Vec3;
  forward: Vec3;
  up: Vec3;
  head: Vec3;
  stage: "incident" | "turning" | Outgoing;
};
// The camera at optical path τ: the head where the ray's light has reached
// (stopping at its drawn end), the eye the follow distance of optical path
// behind it on the same polyline, and the orientation turned by the
// smoothstep 3s² − 2s³ of the eye's progress s through the window centered
// on its own arrival at the surface.
export function ridePose(path: RidePath, tau: number): RidePose {
  const t = Math.min(tau, path.end),
    eyeAt = t - path.follow;
  const s = Math.min(
    1,
    Math.max(0, (eyeAt - (path.hit - path.turn / 2)) / path.turn),
  );
  const turned = path.angle * s * s * (3 - 2 * s);
  const c = Math.cos(turned),
    n = Math.sin(turned);
  const forward =
    s >= 1
      ? path.out
      : s <= 0
        ? path.incident
        : add(scaled(path.incident, c), path.up0, n);
  const up = add(scaled(path.up0, c), path.incident, -n);
  return {
    eye: along(path, eyeAt),
    forward,
    up,
    head: along(path, t),
    stage: s <= 0 ? "incident" : s >= 1 ? path.outgoing : "turning",
  };
}

// The drawing's view at τ: the held view about the study's bounds, with the
// ride's lens. Its near plane is a quarter of the follow distance's
// shortest length (and at most 1/20 of the radius); its far plane reaches
// four radii past the study's center, as the orthographic camera's depth.
export function rideView(
  path: RidePath,
  around: Bounds3,
  held: View,
  tau: number,
): View {
  const pose = ridePose(path, tau);
  return {
    ...held,
    ...around,
    lens: {
      projection: "perspective",
      eye: pose.eye,
      forward: pose.forward,
      up: pose.up,
      fov: rideFov,
      near: Math.min(
        around.radius / 20,
        path.follow / (4 * Math.max(path.nIn, path.nOut)),
      ),
      far: length(add(pose.eye, around.center, -1)) + 4 * around.radius,
    },
  };
}

// The readout: the ray ridden and what the camera is doing.
export function rideReadout(
  path: RidePath,
  result: SpatialResult,
  config: SpatialConfig,
  tau: number,
): string {
  const value = (x: number) => String(+x.toPrecision(4));
  const { u, v } = parameters(result, config, path.i, path.j);
  return `Riding the ray at u = ${value(u)}, v = ${value(v)} · ${ridePose(path, tau).stage}`;
}
