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
import { tiered } from "../help";
import type { Bounds3, Vec3 } from "./types";
import { camera, clip, turntableAngle, type Pass, type View } from "./scene";
import { hiddenBy, isCut, specPlanes, type CutSpec } from "./cut";

export type PathStyle = "steady" | "smooth";
// What the camera turns about between views: the plane through the study's
// center facing it, or the geometry drawn in the middle of each view.
export type PathPivot = "plane" | "geometry";
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
// Absent, the pivot is the plane, so older paths fly as they did.
export type CameraPath = {
  style: PathStyle;
  pivot?: PathPivot;
  keys: KeyView[];
};
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
export const pathPivots: { value: PathPivot; label: string }[] = [
  { value: "plane", label: "Center plane" },
  { value: "geometry", label: "Geometry in the middle" },
];
// How near the middle of a view, as a share of half the page's shorter
// side, geometry must be drawn to be the framed point.
export const pivotReach = 0.05;
export const keyLabel = (path: CameraPath, k: number) =>
  path.keys[k]?.name.trim() || `View ${k + 1}`;
// The first view has no leg before it, so neither turns nor leg time.
const asFirst = ({ leg: _, ...key }: KeyView): KeyView => ({
  ...key,
  turns: 0,
});
const firstClear = (keys: KeyView[]) =>
  keys.map((key, k) => (k ? key : asFirst(key)));
// Moves view k to place `to`. Each view keeps the turns and leg time of the
// leg arriving at it, unless it becomes the first.
export function moveKey(path: CameraPath, k: number, to: number): CameraPath {
  const n = path.keys.length;
  if (k === to || k < 0 || k >= n || to < 0 || to >= n) return path;
  const keys = path.keys.slice();
  const [key] = keys.splice(k, 1);
  keys.splice(to, 0, key);
  return { ...path, keys: firstClear(keys) };
}
// Removes view k; a view that becomes the first loses its leg.
export const removeKey = (path: CameraPath, k: number): CameraPath => ({
  ...path,
  keys: firstClear(path.keys.filter((_, j) => j !== k)),
});
// The camera's framing, which both flights share.
const framing =
  "The camera turns about the middle of the page; while a leg zooms, the place you framed comes straight toward the middle.";
export const pathHelp = {
  mode: tiered(
    "Fly the camera through your key views in order. Geometry stays fixed.",
    `Each leg takes its share of the duration by its leg time and turns the shorter way around unless you add turns. ${framing}`,
  ),
  camera: tiered(
    "Flies the camera through your key views in order while the geometry moves.",
    `Each leg takes its share of the duration by its leg time. Views are taken about the study as drawn when playback starts, so geometry that grows far beyond it can leave the page. ${framing}`,
  ),
  steady:
    "Each leg turns, tilts and zooms at a steady rate, changing course only at a view.",
  smooth: tiered(
    "The camera passes through each view without stopping, blending its turning, tilting and zoom.",
    "It never goes beyond the two views of a leg, so it rests at a view that is a turning point. With two views it is Steady.",
  ),
  turns: tiered(
    `Whole turns added to the shorter way, from −${maxTurns} to ${maxTurns}.`,
    "Turns are counted from the previous view. Positive turns go the way dragging right does, as the orbit animation turns. Exactly half a turn goes the negative way unless a turn is added.",
  ),
  leg: tiered(
    `The leg's share of the duration, from ${legRange[0]} to ${legRange[1]}.`,
    "Each leg is the one arriving at its view. A leg of 2 takes twice as long as a leg of 1. To linger at a view, add it again and give the leg between the two its time.",
  ),
  plane:
    "The camera turns about the middle of the page on the plane through the study's center.",
  geometry: tiered(
    "The camera turns about the geometry drawn in the middle of each view, keeping it there.",
    `It takes the geometry nearest the viewer within ${pivotReach * 100}% of half the page's shorter side from the middle, as drawn when playback starts, cut included. A view with none there turns about the plane.`,
  ),
  keys: tiered(
    `Up to ${maxKeys} views. Add the drawing's view; to adjust one, show it, change the drawing, and set it again.`,
    "Turns and leg time move with their view. A view that becomes the first, by moving or removal, loses them.",
  ),
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

// How far each view's framed point stands toward the viewer from the plane
// through the study's center, along its line of sight: 0 on the plane, as
// the plane pivot has it. With the geometry pivot, it is where the line
// through the middle of the page meets the drawn geometry nearest the
// viewer: a sheet it crosses, or a line that passes within pivotReach of
// the middle of the page, at its point nearest the line. Only what the view
// draws counts: inside its clip volume, and not hidden by the cut. A view
// with nothing there keeps 0. Key views are drawn in the projection of the
// view held when playback starts (lens), so their lines of sight are too.
export function framedDepths(
  path: CameraPath,
  passes: Pass[],
  bounds: Bounds3,
  lens: Pick<View, "projection" | "lensAngle"> = {},
  cut: CutSpec | null = null,
): number[] {
  if (path.pivot !== "geometry") return path.keys.map(() => 0);
  const planes = cut ? specPlanes(cut) : [],
    beyond = cut?.beyond ?? "every",
    sides = new Float64Array(planes.length);
  return path.keys.map((key) => {
    const view = { ...manual(key, bounds), ...lens };
    const k = camera(view, { width: 1, height: 1 });
    const [right, up, back] = rows(key.yaw, key.pitch);
    // The framed point on the plane, as pathView takes it.
    const o = [
      bounds.center.x - key.panX * right[0] - key.panY * up[0],
      bounds.center.y - key.panX * right[1] - key.panY * up[1],
      bounds.center.z - key.panX * right[2] - key.panY * up[2],
    ];
    let best = -Infinity;
    // A point the view draws at the middle within reach, on a pass the cut
    // applies to when cut.
    const consider = (
      x: number,
      y: number,
      z: number,
      reach: number,
      cuts: boolean,
    ) => {
      const c = clip(k, x, y, z);
      if (!(c[3] > 0) || Math.abs(c[2]) > c[3]) return;
      if (Math.hypot(c[0], c[1]) / c[3] > reach) return;
      if (cuts) {
        planes.forEach((plane, i) => {
          const n = plane.normal;
          sides[i] = n.x * x + n.y * y + n.z * z - plane.offset;
        });
        if (hiddenBy(sides, beyond)) return;
      }
      const s =
        back[0] * (x - o[0]) + back[1] * (y - o[1]) + back[2] * (z - o[2]);
      if (s > best) best = s;
    };
    const lateral = (d: number[]) => [
      right[0] * d[0] + right[1] * d[1] + right[2] * d[2],
      up[0] * d[0] + up[1] * d[1] + up[2] * d[2],
    ];
    for (const pass of passes) {
      const { data, indices, mode } = pass.batch,
        cuts = !!cut && isCut(pass, cut.scope);
      const at = (v: number) => [data[7 * v], data[7 * v + 1], data[7 * v + 2]];
      const count = indices ? indices.length : data.length / 7;
      const vertex = (i: number) => at(indices ? indices[i] : i);
      if (mode === "lines")
        for (let i = 0; i + 1 < count; i += 2) {
          // The segment's point nearest the line of sight, across it.
          const a = vertex(i),
            b = vertex(i + 1);
          const e = lateral([a[0] - o[0], a[1] - o[1], a[2] - o[2]]),
            f = lateral([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
          const ff = f[0] * f[0] + f[1] * f[1];
          const u =
            ff > 0
              ? Math.min(1, Math.max(0, -(e[0] * f[0] + e[1] * f[1]) / ff))
              : 0;
          consider(
            a[0] + u * (b[0] - a[0]),
            a[1] + u * (b[1] - a[1]),
            a[2] + u * (b[2] - a[2]),
            pivotReach,
            cuts,
          );
        }
      else
        for (let i = 0; i + 2 < count; i += 3) {
          // Where the line of sight crosses the triangle, if it does: the
          // triangle's own coordinates of the middle, across the line.
          const a = vertex(i),
            b = vertex(i + 1),
            c = vertex(i + 2);
          const pa = lateral([a[0] - o[0], a[1] - o[1], a[2] - o[2]]),
            pb = lateral([b[0] - o[0], b[1] - o[1], b[2] - o[2]]),
            pc = lateral([c[0] - o[0], c[1] - o[1], c[2] - o[2]]);
          const area =
            (pb[0] - pa[0]) * (pc[1] - pa[1]) -
            (pc[0] - pa[0]) * (pb[1] - pa[1]);
          if (!area) continue;
          const wb = (pc[0] * pa[1] - pa[0] * pc[1]) / area,
            wc = (pa[0] * pb[1] - pb[0] * pa[1]) / area,
            wa = 1 - wb - wc;
          if (wa < 0 || wb < 0 || wc < 0) continue;
          consider(
            wa * a[0] + wb * b[0] + wc * c[0],
            wa * a[1] + wb * b[1] + wc * c[1],
            wa * a[2] + wb * b[2] + wc * c[2],
            Infinity,
            cuts,
          );
        }
    }
    return Number.isFinite(best) ? best : 0;
  });
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
// study's own bounds, so depth keeps the study's range. depths (see
// framedDepths) move each view's framed point toward the viewer along its
// line of sight; absent, every framed point is on the plane.
export function pathView(
  path: CameraPath,
  bounds: Bounds3,
  p: number,
  cyclic = false,
  depths?: number[],
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
  // the plane through the center facing the camera, or its depth toward the
  // viewer from it.
  const target = (k: number): Vec3 => {
    const key = keys[k],
      [rx, ry, back] = rows(key.yaw, key.pitch);
    const on = {
      x: bounds.center.x - key.panX * rx[0] - key.panY * ry[0],
      y: bounds.center.y - key.panX * rx[1] - key.panY * ry[1],
      z: bounds.center.z - key.panX * rx[2] - key.panY * ry[2],
    };
    const s = depths?.[k];
    return s
      ? { x: on.x + s * back[0], y: on.y + s * back[1], z: on.z + s * back[2] }
      : on;
  };
  const a = target(i),
    b = target(i + 1);
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
