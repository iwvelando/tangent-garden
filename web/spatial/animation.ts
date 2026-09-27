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
  "a" | "min" | "max" | "radius" | "tube" | "length" | "samples" | "lines";
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
  a: "Shape parameter a",
  min: "Domain start",
  max: "Domain end",
  radius: "Major radius R",
  tube: "Minor radius r",
  length: "Tangent reach L",
  samples: "Curve samples",
  lines: "Tangent lines",
};
export const integerTargets: Target[] = ["samples", "lines"];
export const availableTargets = (c: SpatialConfig): Target[] =>
  c.format === "parametric"
    ? ["a", "length", "min", "max", "samples", "lines"]
    : ["length", "radius", "tube", "samples", "lines"];
export function targetValue(c: SpatialConfig, t: Target, _length = 0): number {
  return t === "a" || t === "min" || t === "max" ? c.curve[t] : c[t];
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
    if (t.target === "a" || t.target === "min" || t.target === "max")
      config.curve[t.target] = v;
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
  return {
    center: {
      x: (lo[0] + hi[0]) / 2,
      y: (lo[1] + hi[1]) / 2,
      z: (lo[2] + hi[2]) / 2,
    },
    radius: Math.max(1e-4, Math.hypot(...lo.map((v, i) => hi[i] - v)) / 2),
  };
}
export function reveal(result: SpatialResult, p: number): SpatialResult {
  const last = Math.floor(
    Math.max(0, Math.min(1, p)) * (result.base.length - 1),
  );
  const base = result.base.slice(0, last + 1),
    minus = result.minus.slice(0, last + 1),
    plus = result.plus.slice(0, last + 1);
  return {
    ...result,
    base,
    minus,
    plus,
    breaks: result.breaks.slice(0, last + 1),
    mesh: result.mesh.filter((v) => v.sampleIndex <= last),
    rulings: result.rulings.filter((r) => r.sampleIndex <= last),
    bounds: fitBounds(base, minus, plus),
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
