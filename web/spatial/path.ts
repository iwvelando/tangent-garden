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
import type { View } from "./scene";

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
};
export type CameraPath = { style: PathStyle; keys: KeyView[] };
export const defaultPath: CameraPath = { style: "steady", keys: [] };
export const maxKeys = 12;
export const maxTurns = 8;
export const maxKeyName = 60;
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
  mode: "Fly the camera through your key views in order, reaching each at an equal share of the duration. Each leg turns the shorter way around unless you add turns. Geometry stays fixed.",
  camera:
    "Flies the camera through your key views in order while the geometry moves, reaching each at an equal share of the duration, as Fly through key views does with the geometry fixed. Each frame is drawn with the camera of its own time. The views are taken about the study as drawn when playback starts, so geometry that grows far beyond it can leave the page.",
  steady:
    "On each leg the camera turns, tilts and zooms at a constant rate, zooming by equal factors in equal times, and stops changing direction at each view.",
  smooth:
    "The camera passes through each view without stopping, blending its turning, tilting and zoom across views. It never turns, tilts or zooms beyond the two views of a leg, so it rests at a view that is a turning point. With two views it is Steady.",
  framing:
    "The camera turns about the point in the middle of the page on the plane through the study's center that faces you. While a leg zooms, that point moves with the inverse of the zoom, so the place you framed comes straight toward the middle.",
  turns: `Whole turns added to the shorter way from the previous view, from −${maxTurns} to ${maxTurns}: positive turns the way the orbit animation turns (as dragging right), negative the other way. Exactly half a turn goes the negative way unless a turn is added.`,
  keys: `Up to ${maxKeys} views. Add the view shown in the drawing, show a view to adjust it, then set it to the drawing again. Removing the first view clears the turns of the one after it.`,
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
// other bounds. Depth keeps the study's own range.
export function keyFromView(
  view: View,
  bounds: Bounds3,
  name: string,
): KeyView {
  const [x, y] = rows(view.yaw, view.pitch);
  const d = [
    bounds.center.x - view.center.x,
    bounds.center.y - view.center.y,
    bounds.center.z - view.center.z,
  ];
  const dot = (r: number[]) => r[0] * d[0] + r[1] * d[1] + r[2] * d[2];
  const zoom = view.zoom * (bounds.radius / view.radius);
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

// Monotone piecewise cubic Hermite slopes (Fritsch and Carlson, with
// Moler's end conditions as in MATLAB's pchip) at equally spaced knots: a
// knot between a rise and a fall, or beside a flat leg, gets slope 0, so no
// leg leaves the range of its two ends.
function slopes(y: number[]) {
  const n = y.length,
    delta = y.slice(1).map((v, i) => v - y[i]);
  if (n === 2) return [delta[0], delta[0]];
  const d = new Array<number>(n);
  for (let k = 1; k < n - 1; k++)
    d[k] =
      delta[k - 1] * delta[k] <= 0 ? 0 : 2 / (1 / delta[k - 1] + 1 / delta[k]);
  const end = (d0: number, d1: number) => {
    const t = (3 * d0 - d1) / 2;
    if (Math.sign(t) !== Math.sign(d0)) return 0;
    if (Math.sign(d0) !== Math.sign(d1) && Math.abs(t) > Math.abs(3 * d0))
      return 3 * d0;
    return t;
  };
  d[0] = end(delta[0], delta[1]);
  d[n - 1] = end(delta[n - 2], delta[n - 3]);
  return d;
}
function hermite(y: number[], d: number[], i: number, f: number) {
  const f2 = f * f,
    f3 = f2 * f;
  return (
    (2 * f3 - 3 * f2 + 1) * y[i] +
    (f3 - 2 * f2 + f) * d[i] +
    (-2 * f3 + 3 * f2) * y[i + 1] +
    (f3 - f2) * d[i + 1]
  );
}

// The camera at progress p ∈ [0, 1], with the views equally spaced in time.
// At a view it is that view exactly. Between views, yaw (unwrapped along the
// path), pitch and log zoom are interpolated in the path's style; the
// framed point (see pathHelp.framing) moves linearly in 1/zoom, or linearly
// in time on a leg that keeps its zoom. Every view is drawn about the
// study's own bounds, so depth keeps the study's range.
export function pathView(path: CameraPath, bounds: Bounds3, p: number): View {
  const keys = path.keys,
    n = keys.length;
  if (n < 2) return manual(keys[0], bounds);
  const x = Math.max(0, Math.min(1, p)) * (n - 1),
    i = Math.min(Math.floor(x), n - 2),
    f = x - i;
  if (f === 0) return manual(keys[i], bounds);
  if (x === n - 1) return manual(keys[n - 1], bounds);
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
      ? hermite(y, slopes(y), i, f)
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
  const x = Math.max(0, Math.min(1, p)) * (n - 1),
    i = Math.min(Math.floor(x), n - 2);
  if (x === i) return keyLabel(path, i);
  if (x === n - 1) return keyLabel(path, n - 1);
  return `${keyLabel(path, i)} → ${keyLabel(path, i + 1)}`;
}
