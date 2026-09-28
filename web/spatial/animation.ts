import { usesSpatialPole } from "./types";
import type {
  SpatialConfig,
  SpatialResult,
  Frame,
  Vec3,
  Bounds3,
} from "./types";
import type { View } from "./renderer";
export type { Frame };
export type Viewport = View;
export type CameraMode = "hold" | "current" | "follow" | "fit";
export type Target =
  | "poleX"
  | "poleY"
  | "poleZ"
  | "a"
  | "min"
  | "max"
  | "radius"
  | "tube"
  | "length"
  | "anchor"
  | "offset"
  | "from"
  | "to"
  | "count"
  | "samples"
  | "lines";
export type Track = { target: Target; from: string; to: string };
export type NumericTrack = { target: Target; from: number; to: number };
export type AnimationView = {
  frame: Frame;
  final: Frame;
  camera: CameraMode;
  heldView?: View;
  length: number;
  progress: number;
  mode: "reveal" | "parameters" | "orbit";
};
export const targetLabels: Record<Target, string> = {
  poleX: "Pole x",
  poleY: "Pole y",
  poleZ: "Pole z",
  a: "Shape parameter a",
  min: "Domain start",
  max: "Domain end",
  radius: "Major radius R",
  tube: "Minor radius r",
  length: "Tangent reach L",
  anchor: "Anchor t₀",
  offset: "String length c",
  from: "Family c from",
  to: "Family c to",
  count: "Involutes",
  samples: "Curve samples",
  lines: "Tangent lines",
};
export const targetLabel = (c: SpatialConfig, t: Target) =>
  t === "lines" && c.construction === "involute"
    ? "Unwinding strings"
    : t === "lines" && usesSpatialPole(c)
      ? "Projection constructions"
      : targetLabels[t];
export const integerTargets: Target[] = ["samples", "lines", "count"];
const curveTargets = ["a", "min", "max"] as const;
const involuteTargets = ["anchor", "offset", "from", "to", "count"] as const;
type CurveTarget = (typeof curveTargets)[number];
type InvoluteTarget = (typeof involuteTargets)[number];
const isCurve = (t: Target): t is CurveTarget =>
  (curveTargets as readonly Target[]).includes(t);
const isInvolute = (t: Target): t is InvoluteTarget =>
  (involuteTargets as readonly Target[]).includes(t);
// Animating the anchor or c recomputes the whole arc length in Go for every
// frame, so a track never reuses a prefix measured from another anchor.
export const availableTargets = (c: SpatialConfig): Target[] => {
  const construction: Target[] =
    c.construction === "involute"
      ? c.involute.family.enabled
        ? ["from", "to", "count", "anchor"]
        : ["offset", "anchor"]
      : usesSpatialPole(c)
        ? ["poleX", "poleY", "poleZ"]
        : ["length"];
  const curve: Target[] =
    c.format === "parametric" ? ["a", "min", "max"] : ["radius", "tube"];
  return c.format === "parametric"
    ? [curve[0], ...construction, ...curve.slice(1), "samples", "lines"]
    : [...construction, ...curve, "samples", "lines"];
};
export function targetValue(c: SpatialConfig, t: Target, _length = 0): number {
  if (t === "poleX") return c.pole.x;
  if (t === "poleY") return c.pole.y;
  if (t === "poleZ") return c.pole.z;
  if (isCurve(t)) return c.curve[t];
  if (t === "anchor" || t === "offset") return c.involute[t];
  if (isInvolute(t)) return c.involute.family[t];
  return c[t];
}
export function applyTracks(
  base: SpatialConfig,
  tracks: NumericTrack[],
  p: number,
  _length = 0,
) {
  const config = structuredClone(base);
  p = Math.max(0, Math.min(1, p));
  for (const t of tracks) {
    let v = t.from * (1 - p) + t.to * p;
    if (integerTargets.includes(t.target)) v = Math.round(v);
    if (t.target === "poleX") config.pole.x = v;
    else if (t.target === "poleY") config.pole.y = v;
    else if (t.target === "poleZ") config.pole.z = v;
    else if (isCurve(t.target)) config.curve[t.target] = v;
    else if (t.target === "anchor" || t.target === "offset")
      config.involute[t.target] = v;
    else if (isInvolute(t.target)) config.involute.family[t.target] = v;
    else config[t.target] = v;
  }
  return { config, length: config.length };
}
// Camera fitting only; no curve evaluation. Fit families independently so a
// short base never hides a distant derived edge. Same outer Tukey rule as Go.
export function fitBounds(...families: (Vec3 | null)[][]): Bounds3 {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const family of families) {
    const points = family.filter((p): p is Vec3 => p !== null);
    if (!points.length) continue;
    (["x", "y", "z"] as const).forEach((key, i) => {
      const vs = points.map((p) => p[key]).sort((a, b) => a - b);
      let a = vs[0],
        b = vs.at(-1)!;
      if (vs.length >= 8) {
        const q1 = vs[Math.floor(vs.length / 4)],
          q3 = vs[Math.floor((3 * vs.length) / 4)],
          spread = q3 - q1;
        if (spread > 1e-12) {
          a = vs.find((v) => v >= q1 - 3 * spread)!;
          b = [...vs].reverse().find((v) => v <= q3 + 3 * spread)!;
        }
      }
      lo[i] = Math.min(lo[i], a);
      hi[i] = Math.max(hi[i], b);
    });
  }
  if (!Number.isFinite(lo[0]))
    return { center: { x: 0, y: 0, z: 0 }, radius: 1 };
  const center = {
    x: (lo[0] + hi[0]) / 2,
    y: (lo[1] + hi[1]) / 2,
    z: (lo[2] + hi[2]) / 2,
  };
  let radius = 1e-4;
  for (const family of families)
    for (const p of family)
      if (
        p &&
        p.x >= lo[0] &&
        p.x <= hi[0] &&
        p.y >= lo[1] &&
        p.y <= hi[1] &&
        p.z >= lo[2] &&
        p.z <= hi[2]
      )
        radius = Math.max(
          radius,
          Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z),
        );
  return { center, radius };
}
export function reveal(result: SpatialResult, p: number): SpatialResult {
  const last = Math.floor(
    Math.max(0, Math.min(1, p)) * (result.base.length - 1),
  );
  const base = result.base.slice(0, last + 1),
    minus = result.minus.slice(0, last + 1),
    plus = result.plus.slice(0, last + 1);
  // The involute keeps its anchor and final integration grid: reveal only
  // truncates the already-measured filaments, never re-measures a prefix.
  const involute = result.involute && {
    ...result.involute,
    members: result.involute.members.map((m) => ({
      ...m,
      points: m.points.slice(0, last + 1),
    })),
    strings: result.involute.strings.filter((r) => r.sampleIndex <= last),
  };
  const projection = result.projection && {
    ...result.projection,
    points: result.projection.points.slice(0, last + 1),
    feet: result.projection.feet.slice(0, last + 1),
    constructions: result.projection.constructions.filter(
      (c) => c.sampleIndex <= last,
    ),
  };
  return {
    ...result,
    base,
    minus,
    plus,
    breaks: result.breaks.slice(0, last + 1),
    mesh: result.mesh.filter((v) => v.sampleIndex <= last),
    rulings: result.rulings.filter((r) => r.sampleIndex <= last),
    involute,
    projection,
    bounds: projection
      ? fitBounds(base, projection.points, projection.feet, [projection.pole])
      : involute
        ? fitBounds(base, ...involute.members.map((m) => m.points))
        : fitBounds(base, minus, plus),
  };
}
export function animationCamera(view: AnimationView): View {
  const held = view.heldView!;
  const bounds =
    view.camera === "current"
      ? held
      : view.camera === "hold"
        ? view.final.result.bounds
        : view.camera === "follow"
          ? {
              center: view.frame.result.bounds.center,
              radius: view.final.result.bounds.radius,
            }
          : view.frame.result.bounds;
  return {
    ...held,
    ...bounds,
    zoom: view.camera === "current" ? held.zoom : 1,
    panX: view.camera === "current" ? held.panX : 0,
    panY: view.camera === "current" ? held.panY : 0,
    yaw: held.yaw + (view.mode === "orbit" ? view.progress * 2 * Math.PI : 0),
  };
}
