// A camera path: the drawing's camera flown through key views, an animation
// of the camera alone with the geometry fixed. This module holds the path's
// fields, limits, words and rules, read by the animation panel, playback,
// export and links alike. See mathematics.md#spatial-camera-paths.
//
// A key view is the manual camera (orbit angles, zoom and pan about the
// study's own bounds) with a name, and the whole turns added to the leg that
// arrives at it. The camera is a turntable: it never rolls, and its pitch
// stays within ±1.5 rad, so yaw and pitch describe every orientation it can
// take without a singularity, and they are interpolated directly.
import type { Bounds3, Vec3 } from "./types";
import { turntableAngle, type View } from "./scene";

export type PathStyle = "steady" | "smooth";
export type KeyView = {
  name: string;
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
  // Whole turns added to the shorter way from the previous view; the first
  // view has none.
  turns: number;
  // The time of the leg that arrives at this view, relative to the others:
  // each leg takes its share of the duration in proportion to its time.
  // Absent, it is 1, so paths without times fly their views equally spaced.
  // The first view has no leg before it.
  leg?: number;
};
export type CameraPath = { style: PathStyle; keys: KeyView[] };
export const defaultPath: CameraPath = { style: "steady", keys: [] };
export const maxKeys = 12;
export const maxTurns = 8;
export const maxKeyName = 60;
export const legRange: [number, number] = [0.1, 10];
// The drawing's own orbit and zoom limits.
export const pitchRange: [number, number] = [-1.5, 1.5];
export const zoomRange: [number, number] = [0.2, 8];

export const pathStyles: { value: PathStyle; label: string }[] = [
  { value: "steady", label: "Steady" },
  { value: "smooth", label: "Smooth" },
];
export const keyLabel = (path: CameraPath, k: number) =>
  path.keys[k]?.name.trim() || `View ${k + 1}`;
export const pathHelp = {
  mode: "Fly the camera through your key views in order, each leg taking its share of the duration by its leg time. Each leg turns the shorter way around unless you add turns. Geometry stays fixed.",
  camera:
    "Flies the camera through your key views in order while the geometry moves, each leg taking its share of the duration by its leg time, as Fly through key views does with the geometry fixed. Each frame is drawn with the camera of its own time. The views are taken about the study as drawn when playback starts, so geometry that grows far beyond it can leave the page.",
  steady:
    "On each leg the camera turns, tilts and zooms at a constant rate, zooming by equal factors in equal times, and stops changing direction at each view.",
  smooth:
    "The camera passes through each view without stopping, blending its turning, tilting and zoom across views. It never turns, tilts or zooms beyond the two views of a leg, so it rests at a view that is a turning point. With two views it is Steady.",
  framing:
    "The camera turns about the point in the middle of the page on the plane through the study's center that faces you. While a leg zooms, that point moves with the inverse of the zoom, so the place you framed comes straight toward the middle.",
  turns: `Whole turns added to the shorter way from the previous view, from −${maxTurns} to ${maxTurns}: positive turns the way the orbit animation turns (as dragging right), negative the other way. Exactly half a turn goes the negative way unless a turn is added.`,
  leg: `How long the leg arriving at this view takes, relative to the other legs, from ${legRange[0]} to ${legRange[1]}: a leg of 2 takes twice as long as a leg of 1. The legs share the duration in proportion to their times. To linger at a view, add it again and give the leg between the two its time.`,
  keys: `Up to ${maxKeys} views. Add the view shown in the drawing, show a view to adjust it, then set it to the drawing again. Removing the first view clears the turns and leg time of the one after it.`,
};

export type PathError = { field: string; message: string };
// Why a path cannot play, naming the field, or null. The field and the
// message read as one sentence.
export function pathError(path: CameraPath): PathError | null {
  if (path.keys.length < 2)
    return {
      field: "Key views",
      message: "need at least two views to fly between.",
    };
  if (path.keys.length > maxKeys)
    return {
      field: "Key views",
      message: `hold at most ${maxKeys} views.`,
    };
  for (let k = 0; k < path.keys.length; k++) {
    const key = path.keys[k],
      name = `View ${k + 1}`;
    if (key.name.length > maxKeyName)
      return {
        field: `${name} name`,
        message: `must be at most ${maxKeyName} characters.`,
      };
    if (
      ![key.yaw, key.pitch, key.zoom, key.panX, key.panY].every(
        Number.isFinite,
      ) ||
      key.pitch < pitchRange[0] ||
      key.pitch > pitchRange[1] ||
      key.zoom < zoomRange[0] ||
      key.zoom > zoomRange[1]
    )
      return {
        field: name,
        message: "is outside the drawing's orbit and zoom limits.",
      };
    if (k === 0 && key.turns !== 0)
      return {
        field: `${name} turns`,
        message: "must be 0: the first view has no leg before it.",
      };
    if (!Number.isInteger(key.turns) || Math.abs(key.turns) > maxTurns)
      return {
        field: `${name} turns`,
        message: `must be a whole number from −${maxTurns} to ${maxTurns}.`,
      };
    if (k === 0 && key.leg !== undefined && key.leg !== 1)
      return {
        field: `${name} leg time`,
        message: "must be 1: the first view has no leg before it.",
      };
    const leg = key.leg ?? 1;
    if (!(leg >= legRange[0] && leg <= legRange[1]))
      return {
        field: `${name} leg time`,
        message: `must be from ${legRange[0]} to ${legRange[1]}.`,
      };
  }
  return null;
}

// The drawing's rotation (scene.ts) as rows: screen x, screen y, depth.
function rows(yaw: number, pitch: number) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw),
    a = Math.cos(pitch),
    b = Math.sin(pitch);
  return [
    [c, 0, s],
    [b * s, a, -b * c],
    [-a * s, b, a * c],
  ];
}
const manual = (key: KeyView, bounds: Bounds3): View => ({
  ...bounds,
  yaw: key.yaw,
  pitch: key.pitch,
  zoom: key.zoom,
  panX: key.panX,
  panY: key.panY,
});

// A shown view as a key view about the study's bounds that draws every point
// where the view drew it: a finished animation's camera may be framed about
// other bounds. Depth keeps the study's own range. Through a lens the eye
// stays put: its distance behind the new target, which moves along the line
// of sight with the center, sets the zoom (see scene.ts's turntableLens).
export function keyFromView(
  view: View,
  bounds: Bounds3,
  name: string,
): KeyView {
  const [x, y, back] = rows(view.yaw, view.pitch);
  const d = [
    bounds.center.x - view.center.x,
    bounds.center.y - view.center.y,
    bounds.center.z - view.center.z,
  ];
  const dot = (r: number[]) => r[0] * d[0] + r[1] * d[1] + r[2] * d[2];
  const fov = turntableAngle(view);
  const tan = fov ? Math.tan((fov * Math.PI) / 360) : 0;
  const behind = fov ? (1.16 * view.radius) / (view.zoom * tan) - dot(back) : 0;
  const zoom = fov
    ? behind > 0
      ? (1.16 * bounds.radius) / (behind * tan)
      : zoomRange[1]
    : view.zoom * (bounds.radius / view.radius);
  return {
    name,
    yaw: view.yaw,
    pitch: view.pitch,
    zoom: Math.min(zoomRange[1], Math.max(zoomRange[0], zoom)),
    panX: view.panX + dot(x),
    panY: view.panY + dot(y),
    turns: 0,
  };
}

// Each leg's time, and the instant each view is reached, in those times.
function knots(path: CameraPath) {
  const h = path.keys.slice(1).map((key) => key.leg ?? 1),
    t = [0];
  for (const leg of h) t.push(t[t.length - 1] + leg);
  return { h, t };
}
// The progress at which the camera stands at each view.
export function keyTimes(path: CameraPath) {
  if (path.keys.length < 2) return path.keys.map(() => 0);
  const { t } = knots(path),
    total = t[t.length - 1];
  return t.map((x, k) => (k === t.length - 1 ? 1 : x / total));
}

// Monotone piecewise cubic Hermite slopes (Fritsch and Carlson, with
// Moler's end conditions as in MATLAB's pchip) at knots spaced by the legs'
// times h: a knot between a rise and a fall, or beside a flat leg, gets
// slope 0, so no leg leaves the range of its two ends. An interior slope is
// the weighted harmonic mean of the two legs' rates, weighted toward the
// shorter leg, and with equal times it is their plain harmonic mean. A
// cyclic path, whose last knot is its first again, has no ends: both take
// the interior slope between the last leg and the first, so a loop passes
// its seam as any other view.
function slopes(y: number[], h: number[], cyclic: boolean) {
  const n = y.length,
    delta = h.map((w, i) => (y[i + 1] - y[i]) / w);
  if (n === 2) return [delta[0], delta[0]];
  const d = new Array<number>(n);
  const interior = (k0: number, k1: number) => {
    const [before, after] = [delta[k0], delta[k1]];
    if (before * after <= 0) return 0;
    const w0 = 2 * h[k1] + h[k0],
      w1 = h[k1] + 2 * h[k0],
      sum = w0 + w1;
    // As 1/(a/before + b/after) with a + b = 1, which equal times make
    // exactly the harmonic mean 2/(1/before + 1/after).
    return 1 / (w0 / sum / before + w1 / sum / after);
  };
  for (let k = 1; k < n - 1; k++) d[k] = interior(k - 1, k);
  if (cyclic) {
    d[0] = d[n - 1] = interior(n - 2, 0);
    return d;
  }
  const end = (k0: number, k1: number) => {
    const [d0, d1] = [delta[k0], delta[k1]];
    const t = ((2 * h[k0] + h[k1]) * d0 - h[k0] * d1) / (h[k0] + h[k1]);
    if (Math.sign(t) !== Math.sign(d0)) return 0;
    if (Math.sign(d0) !== Math.sign(d1) && Math.abs(t) > Math.abs(3 * d0))
      return 3 * d0;
    return t;
  };
  d[0] = end(0, 1);
  d[n - 1] = end(n - 2, n - 3);
  return d;
}
function hermite(y: number[], d: number[], h: number, i: number, f: number) {
  const f2 = f * f,
    f3 = f2 * f;
  return (
    (2 * f3 - 3 * f2 + 1) * y[i] +
    (f3 - 2 * f2 + f) * h * d[i] +
    (-2 * f3 + 3 * f2) * y[i + 1] +
    (f3 - f2) * h * d[i + 1]
  );
}

// Where progress p ∈ [0, 1] stands: on leg i, a fraction f along it, with f
// exactly 0 at a view. A progress within rounding of a view's own time
// (keyTimes) is that view.
function locate(path: CameraPath, p: number) {
  const { h, t } = knots(path),
    n = t.length,
    total = t[n - 1];
  const x = Math.max(0, Math.min(1, p)) * total;
  if (x >= total) return { h, i: n - 2, f: 1, end: true };
  let i = 0;
  while (i < n - 2 && x >= t[i + 1]) i++;
  const near = 4 * Number.EPSILON * total;
  if (Math.abs(x - t[i + 1]) <= near && i + 1 < n - 1)
    return { h, i: i + 1, f: 0, end: false };
  if (Math.abs(x - t[i + 1]) <= near) return { h, i, f: 1, end: true };
  return { h, i, f: x - t[i] <= near ? 0 : (x - t[i]) / h[i], end: false };
}

// The camera at progress p ∈ [0, 1], each leg taking its share of the
// duration in proportion to its time (all equal unless set).
// A cyclic path (a loop's, whose last view is its first) passes its seam
// smoothly; it changes only the smooth style's slopes at its ends.
// At a view it is that view exactly. Between views, yaw (unwrapped along the
// path), pitch and log zoom are interpolated in the path's style; the
// framed point (see pathHelp.framing) moves linearly in 1/zoom, or linearly
// in time on a leg that keeps its zoom. Every view is drawn about the
// study's own bounds, so depth keeps the study's range.
export function pathView(
  path: CameraPath,
  bounds: Bounds3,
  p: number,
  cyclic = false,
): View {
  const keys = path.keys,
    n = keys.length;
  if (n < 2) return manual(keys[0], bounds);
  const { h, i, f, end } = locate(path, p);
  if (end) return manual(keys[n - 1], bounds);
  if (f === 0) return manual(keys[i], bounds);
  // Yaw along the path: each leg the shorter way, a half turn the negative
  // way, plus its whole turns.
  const yaw = [keys[0].yaw];
  for (let k = 1; k < n; k++) {
    const d = keys[k].yaw - yaw[k - 1];
    const wrapped = d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
    yaw.push(yaw[k - 1] + wrapped + 2 * Math.PI * keys[k].turns);
  }
  const pitch = keys.map((k) => k.pitch),
    lz = keys.map((k) => Math.log(k.zoom));
  const at = (y: number[]) =>
    path.style === "smooth"
      ? hermite(y, slopes(y, h, cyclic), h[i], i, f)
      : y[i] + (y[i + 1] - y[i]) * f;
  const v = { yaw: at(yaw), pitch: at(pitch), lz: at(lz) };
  // The framed point of each end of the leg: in the middle of the page, on
  // the plane through the center facing the camera.
  const target = (key: KeyView): Vec3 => {
    const [rx, ry] = rows(key.yaw, key.pitch);
    return {
      x: bounds.center.x - key.panX * rx[0] - key.panY * ry[0],
      y: bounds.center.y - key.panX * rx[1] - key.panY * ry[1],
      z: bounds.center.z - key.panX * rx[2] - key.panY * ry[2],
    };
  };
  const a = target(keys[i]),
    b = target(keys[i + 1]);
  const span = lz[i + 1] - lz[i];
  const sigma =
    span === 0 ? f : Math.expm1(-(v.lz - lz[i])) / Math.expm1(-span);
  const t = {
    x: a.x + (b.x - a.x) * sigma,
    y: a.y + (b.y - a.y) * sigma,
    z: a.z + (b.z - a.z) * sigma,
  };
  // Pan so that the framed point is in the middle of the page.
  const [rx, ry] = rows(v.yaw, v.pitch);
  const d = [
    bounds.center.x - t.x,
    bounds.center.y - t.y,
    bounds.center.z - t.z,
  ];
  return {
    ...bounds,
    yaw: v.yaw,
    pitch: v.pitch,
    zoom: Math.exp(v.lz),
    panX: rx[0] * d[0] + rx[1] * d[1] + rx[2] * d[2],
    panY: ry[0] * d[0] + ry[1] * d[1] + ry[2] * d[2],
  };
}

// The readout: the view the camera stands at, or the two a leg flies
// between.
export function pathLeg(path: CameraPath, p: number): string {
  const n = path.keys.length;
  if (n < 2) return n ? keyLabel(path, 0) : "";
  const { i, f, end } = locate(path, p);
  if (end) return keyLabel(path, n - 1);
  if (f === 0) return keyLabel(path, i);
  return `${keyLabel(path, i)} → ${keyLabel(path, i + 1)}`;
}
