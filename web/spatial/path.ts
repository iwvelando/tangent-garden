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
import {
  hermite,
  keysError,
  legHelp,
  locate,
  maxKeys,
  moveKeys,
  pieceSteps,
  pieceZoom,
  removeKeys,
  slopes,
  type PathError,
  type PathStyle,
} from "../key-views";
import type { Bounds3, RefinementView, Vec3 } from "./types";
import {
  camera,
  clip,
  refinementView,
  turntableAngle,
  type Pass,
  type View,
} from "./scene";
import { spatialPlainZoom, viewZoom } from "../refinement";
import { hiddenBy, isCut, specPlanes, type CutSpec } from "./cut";
import { clippedLine, keptLine, spaceAt } from "./linework";

export {
  keyLabel,
  pieceAt,
  keyTimes,
  legRange,
  maxKeyName,
  maxKeys,
  pathLeg,
  pathStyles,
  type PathError,
  type PathStyle,
} from "../key-views";
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
  ease?: boolean;
  pivot?: PathPivot;
  keys: KeyView[];
};
export const defaultPath: CameraPath = { style: "steady", keys: [] };
export const maxTurns = 8;
// The drawing's own orbit and zoom limits: it zooms to spatialPlainZoom,
// or to viewZoom in a study refined to its view.
export const pitchRange: [number, number] = [-1.5, 1.5];
export const zoomRange: [number, number] = [0.2, viewZoom];

export const pathPivots: { value: PathPivot; label: string }[] = [
  { value: "plane", label: "Center plane" },
  { value: "geometry", label: "Geometry in the middle" },
];
// How near the middle of a view, as a share of half the page's shorter
// side, geometry must be drawn to be the framed point.
export const pivotReach = 0.05;
// The first view has no leg before it, so neither turns nor leg time.
export const asFirst = ({ leg: _, ...key }: KeyView): KeyView => ({
  ...key,
  turns: 0,
});
// Moves view k to place `to`. Each view keeps the turns and leg time of the
// leg arriving at it, unless it becomes the first.
export function moveKey(path: CameraPath, k: number, to: number): CameraPath {
  const keys = moveKeys(path.keys, k, to, asFirst);
  return keys === path.keys ? path : { ...path, keys };
}
// Removes view k; a view that becomes the first loses its leg.
export const removeKey = (path: CameraPath, k: number): CameraPath => ({
  ...path,
  keys: removeKeys(path.keys, k, asFirst),
});
// The camera's framing, which both flights share, and how their frames are
// refined.
const framing =
  "The camera turns about the page's middle; while a leg zooms, the framed place comes straight to the middle. A study refined to its view is refined to each frame's.";
export const pathHelp = {
  mode: tiered(
    "Fly the camera through your key views in order. Geometry stays fixed.",
    `Each leg takes its share of the duration by its leg time and turns the shorter way around unless you add turns. ${framing}`,
  ),
  camera: tiered(
    "Flies the camera through your key views in order while the geometry moves.",
    `Each leg takes its share of the duration by its leg time. Views are taken about the study as playback starts; geometry growing far beyond it can leave the page. ${framing}`,
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
  leg: legHelp,
  plane:
    "The camera turns about the middle of the page on the plane through the study's center.",
  geometry: tiered(
    "The camera turns about the geometry drawn in the middle of each view, keeping it there.",
    `It takes the geometry nearest the viewer within ${pivotReach * 100}% of half the page's shorter side from the middle, as drawn when playback starts, cut included. A view with none there turns about the plane. Through a lens, the eye turns about that point.`,
  ),
  keys: tiered(
    `Up to ${maxKeys} views. Add the drawing's view; to adjust one, show it, change the drawing, and set it again.`,
    `Turns and leg time move with their view. A view that becomes the first, by moving or removal, loses them. Views zoom up to ${spatialPlainZoom}×, or ${viewZoom.toLocaleString("en-US")}× in a study refined to its view.`,
  ),
};

// Why a path cannot play, naming the field, or null. The field and the
// message read as one sentence. zoomLimit is the drawing's.
export function pathError(
  path: CameraPath,
  zoomLimit = spatialPlainZoom,
): PathError | null {
  return keysError(path.keys, (key, name, k) => {
    if (
      ![key.yaw, key.pitch, key.zoom, key.panX, key.panY].every(
        Number.isFinite,
      ) ||
      key.pitch < pitchRange[0] ||
      key.pitch > pitchRange[1] ||
      key.zoom < zoomRange[0] ||
      key.zoom > zoomLimit
    )
      return {
        field: name,
        message:
          key.zoom > zoomLimit && zoomLimit < viewZoom
            ? `zooms past ${zoomLimit}×; refine the study to its view to zoom further.`
            : "is outside the drawing's orbit and zoom limits.",
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
    return null;
  });
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
// of sight with the center, sets the zoom (see scene.ts's turntableLens),
// within the drawing's zoom limit.
export function keyFromView(
  view: View,
  bounds: Bounds3,
  name: string,
  limit = spatialPlainZoom,
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
  const framed = view.framedTarget;
  const behind = fov
    ? framed
      ? framed.distance +
        back[0] * (framed.point.x - bounds.center.x) +
        back[1] * (framed.point.y - bounds.center.y) +
        back[2] * (framed.point.z - bounds.center.z)
      : (1.16 * view.radius) / (view.zoom * tan) +
        (view.targetDepth ?? 0) -
        dot(back)
    : 0;
  const zoom = fov
    ? behind > 0
      ? (1.16 * bounds.radius) / (behind * tan)
      : limit
    : view.zoom * (bounds.radius / view.radius);
  return {
    name,
    yaw: view.yaw,
    pitch: view.pitch,
    zoom: Math.min(limit, Math.max(zoomRange[0], zoom)),
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
      visible = false,
    ) => {
      const c = clip(k, x, y, z);
      if (!visible && (!(c[3] > 0) || Math.abs(c[2]) > c[3])) return;
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
          const a = vertex(i),
            b = vertex(i + 1);
          // The renderer's cut and clip rules, before choosing a point.
          const pair = indices
            ? new Float32Array([...a, 0, 0, 1, 0, ...b, 0, 0, 1, 0])
            : data;
          const start = indices ? 0 : 7 * i;
          const parts = cuts
            ? keptLine(planes, beyond, pair, start)
            : [
                {
                  ends: pair.subarray(start, start + 14),
                  range: [0, 1] as [number, number],
                },
              ];
          const e = lateral([a[0] - o[0], a[1] - o[1], a[2] - o[2]]),
            f = lateral([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
          const ff = f[0] * f[0] + f[1] * f[1];
          for (const part of parts) {
            const d = part.ends;
            const piece = clippedLine(
              k,
              clip(k, d[0], d[1], d[2]),
              clip(k, d[7], d[8], d[9]),
            );
            if (!piece) continue;
            const [p0, p1, range, w] = piece;
            // Restrict the visible segment to the disk around the middle.
            // Page coordinates here span 0..1, so its radius is reach/2.
            const dx = p1.x - p0.x,
              dy = p1.y - p0.y;
            const x = p0.x - 0.5,
              y = p0.y - 0.5;
            const dd = dx * dx + dy * dy;
            let r0 = 0,
              r1 = 1;
            if (dd > 0) {
              const r = -(x * dx + y * dy) / dd;
              const gap =
                (pivotReach / 2) ** 2 - (x + r * dx) ** 2 - (y + r * dy) ** 2;
              if (gap < 0) continue;
              const dr = Math.sqrt(gap / dd);
              r0 = Math.max(0, r - dr);
              r1 = Math.min(1, r + dr);
              if (r0 > r1) continue;
            } else if (Math.hypot(x, y) > pivotReach / 2) continue;
            const along = (r: number) => {
              const u = range[0] + spaceAt(w, r) * (range[1] - range[0]);
              return part.range[0] + u * (part.range[1] - part.range[0]);
            };
            const lo = along(r0),
              hi = along(r1);
            // Across the line of sight, use the nearest visible point.
            // For equal lateral distances, take the end nearest the eye.
            const dz =
              back[0] * (b[0] - a[0]) +
              back[1] * (b[1] - a[1]) +
              back[2] * (b[2] - a[2]);
            const u =
              ff > 0
                ? Math.min(hi, Math.max(lo, -(e[0] * f[0] + e[1] * f[1]) / ff))
                : dz > 0
                  ? hi
                  : lo;
            consider(
              a[0] + u * (b[0] - a[0]),
              a[1] + u * (b[1] - a[1]),
              a[2] + u * (b[2] - a[2]),
              Infinity,
              false,
              true,
            );
          }
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
  lens: Pick<View, "projection" | "lensAngle"> = {},
): View {
  const keys = path.keys,
    n = keys.length;
  if (n < 2) return { ...manual(keys[0], bounds), ...lens };
  const { h, i, f, end } = locate(path, p);
  if (end) return { ...manual(keys[n - 1], bounds), ...lens };
  if (f === 0) return { ...manual(keys[i], bounds), ...lens };
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
  if (path.style === "smooth" && n > 2 && depths?.some((s) => s !== 0)) {
    // Each leg alone turns its framed point's course at a view. Smooth
    // bends each leg so that it arrives at the view, and leaves it, at the
    // one velocity its two legs' own rates give there; the legs keep their
    // rates where they already agree, and at an open path's ends.
    const targets = keys.map((_, k) => target(k)),
      dz = slopes(lz, h, cyclic);
    // A leg's framed point velocity as it leaves its first view (0) or
    // reaches its second (1): its chord, times the rate of σ in time.
    const legRate = (j: number, end: 0 | 1) => {
      const w = lz[j + 1] - lz[j];
      const rate =
        w === 0
          ? 1 / h[j]
          : end
            ? (-Math.exp(-w) * dz[j + 1]) / Math.expm1(-w)
            : -dz[j] / Math.expm1(-w);
      const [p, q] = [targets[j], targets[j + 1]];
      return [(q.x - p.x) * rate, (q.y - p.y) * rate, (q.z - p.z) * rate];
    };
    // At a view between legs j0 (arriving) and j1 (leaving), each leg's
    // velocity weighed by the other's time, as a parabola's slope through
    // three points is.
    const between = (j0: number, j1: number) => {
      const [u, w] = [legRate(j0, 1), legRate(j1, 0)];
      return u.map((x, c) => (h[j1] * x + h[j0] * w[c]) / (h[j0] + h[j1]));
    };
    const velocity = (k: number) =>
      k > 0 && k < n - 1
        ? between(k - 1, k)
        : cyclic
          ? between(n - 2, 0)
          : k
            ? legRate(n - 2, 1)
            : legRate(0, 0);
    // Hermite's corrections to the leg's rates at its ends, which leave
    // its ends where they are.
    const [v0, v1] = [velocity(i), velocity(i + 1)],
      [r0, r1] = [legRate(i, 0), legRate(i, 1)];
    const f2 = f * f,
      g0 = h[i] * (f2 * f - 2 * f2 + f),
      g1 = h[i] * (f2 * f - f2);
    t.x += g0 * (v0[0] - r0[0]) + g1 * (v1[0] - r1[0]);
    t.y += g0 * (v0[1] - r0[1]) + g1 * (v1[1] - r1[1]);
    t.z += g0 * (v0[2] - r0[2]) + g1 * (v1[2] - r1[2]);
  }
  // Pan so that the framed point is in the middle of the page.
  const [rx, ry] = rows(v.yaw, v.pitch);
  const d = [
    bounds.center.x - t.x,
    bounds.center.y - t.y,
    bounds.center.z - t.z,
  ];
  const view: View = {
    ...bounds,
    ...lens,
    yaw: v.yaw,
    pitch: v.pitch,
    zoom: Math.exp(v.lz),
    panX: rx[0] * d[0] + rx[1] * d[1] + rx[2] * d[2],
    panY: ry[0] * d[0] + ry[1] * d[1] + ry[2] * d[2],
  };
  const fov = turntableAngle(view);
  if (fov && depths?.some((s) => s !== 0)) {
    // Interpolate the positive distances from each eye to its framed
    // point, rather than orbiting an eye about the center plane. This is
    // the same eye at every key, including a key with no geometry.
    const scale = (1.16 * bounds.radius) / Math.tan((fov * Math.PI) / 360);
    const distances = keys.map((key, k) =>
      Math.log(scale / key.zoom - depths[k]),
    );
    view.framedTarget = { point: t, distance: Math.exp(at(distances)) };
  }
  return view;
}

// A piece of a flight (see key-views.ts): its zoomed-in frames are drawn
// from one refinement, to a few of their own views (engine3.View), which
// Go refines each piece of curve to as finely as the finest it meets asks.
export type Piece = { from: number; to: number; views: RefinementView[] };
// At most this many views per piece, within engine3's maxViews. A frame
// is kept as a view of its piece once it has moved from the last kept by
// more than a step: its zoom by more than stepZoom, or, by more than a
// quarter of the narrower frame's half shorter side, its framed point
// across the line of sight or, as the camera turns, geometry anywhere in
// the study. Every frame between two kept views is then within both's
// margins and nearly as finely refined as it needs.
export const pieceViews = 16;
const stepZoom = 1.05;

// The point a view frames in the middle of its page, the half shorter side
// of the page at it, and its line of sight: the turntable's target, or a
// geometry pivot's (see pathView), which a lens draws at the orthographic
// scale of the zoom its distance gives.
function framedBy(view: View) {
  const [right, up, back] = rows(view.yaw, view.pitch);
  const fov = turntableAngle(view);
  const half = 1.16 * view.radius;
  if (view.framedTarget && fov)
    return {
      point: view.framedTarget.point,
      half: view.framedTarget.distance * Math.tan((fov * Math.PI) / 360),
      back,
    };
  return {
    point: {
      x: view.center.x - view.panX * right[0] - view.panY * up[0],
      y: view.center.y - view.panX * right[1] - view.panY * up[1],
      z: view.center.z - view.panX * right[2] - view.panY * up[2],
    },
    half: half / view.zoom,
    back,
  };
}
type Framed = ReturnType<typeof framedBy>;

// Whether frame b has moved from frame a by more than a step (see
// pieceViews), with the study's geometry within reach of a's framed point.
function stepped(a: Framed, b: Framed, bounds: Bounds3) {
  const low = Math.min(a.half, b.half);
  if (Math.max(a.half, b.half) / low > stepZoom) return true;
  // Across the line of sight: sliding along it, as the plane's point does
  // while the camera turns, moves nothing on the page.
  const d = [
    b.point.x - a.point.x,
    b.point.y - a.point.y,
    b.point.z - a.point.z,
  ];
  const along = d[0] * b.back[0] + d[1] * b.back[1] + d[2] * b.back[2];
  const drift = Math.hypot(...d.map((x, c) => x - along * b.back[c]));
  // Turning by θ moves a point at depth s from the framed point s θ across
  // the page; the study's geometry lies within its radius of its center.
  const turn = Math.acos(
    Math.min(
      1,
      a.back[0] * b.back[0] + a.back[1] * b.back[1] + a.back[2] * b.back[2],
    ),
  );
  const reach =
    Math.hypot(
      a.point.x - bounds.center.x,
      a.point.y - bounds.center.y,
      a.point.z - bounds.center.z,
    ) + bounds.radius;
  return drift + turn * reach > low / 4;
}

// A flight's pieces, in order, over the progress where it zooms in past the
// fitted framing (zoom above 1, as the drawing refines to its view); frames
// at the fitted zoom or wider need no piece. A piece spans a zoom of at
// most pieceZoom. size is the page's.
export function flightPieces(
  path: CameraPath,
  bounds: Bounds3,
  cyclic: boolean,
  size: { width: number; height: number },
  depths?: number[],
  lens: Pick<View, "projection" | "lensAngle"> = {},
): Piece[] {
  const n = Math.max(1, path.keys.length - 1) * pieceSteps;
  const pieces: Piece[] = [];
  type Open = {
    from: number;
    last: Framed;
    low: number;
    high: number;
    views: View[];
  };
  let open: Open | null = null;
  // Closes the open piece at progress to, where the frame view begins the
  // next stretch: frames between its last kept view and that one belong to
  // it, so that frame is kept too.
  const close = (to: number, view?: View) => {
    if (!open) return;
    pieces.push({
      from: open.from,
      to,
      views: (view ? [...open.views, view] : open.views).map((v) =>
        refinementView(v, size),
      ),
    });
    open = null;
  };
  for (let k = 0; k <= n; k++) {
    const p = k / n,
      view = pathView(path, bounds, p, cyclic, depths, lens);
    if (!(view.zoom > 1)) {
      close(p, view);
      continue;
    }
    const at = framedBy(view);
    const current = open as Open | null;
    if (current) {
      const low = Math.min(current.low, at.half),
        high = Math.max(current.high, at.half);
      if (high / low > pieceZoom) close(p, view);
      else {
        current.low = low;
        current.high = high;
        if (stepped(current.last, at, bounds)) {
          // The closing frame is kept as well, so a piece keeps room for it.
          if (current.views.length === pieceViews - 1) close(p, view);
          else {
            current.views.push(view);
            current.last = at;
          }
        }
      }
    }
    if (!open)
      open = { from: p, last: at, low: at.half, high: at.half, views: [view] };
  }
  close(1);
  return pieces;
}
