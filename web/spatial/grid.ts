// The grid of synchronized views beside a curve study's drawing: the 3D
// drawing, and its shadow's plane seen face on. Where the construction
// reduces to the plane (shadow.ts), the plane is shown three ways, in a
// 2 × 2 grid: the 2D notebook's own drawing of the 2D construction of the
// shadow, the shadow of the 3D construction, and the two over each other.
// Otherwise the plane shows the curve's shadow alone, beside the drawing.
// Every view draws the same result, so they keep the same frame of an
// animation. The panel, the views and the exports read their names and
// layout here; none branches on a construction's name.
import { tiered } from "../help";
import type { Vec } from "../types";
import { casts, shadowReduction } from "./shadow";
import type { ShadowPlane, ShadowResult, SpatialConfig, Vec3 } from "./types";

// A face-on view of the plane: the 2D construction as the 2D notebook
// draws it, the 3D construction's shadow, both, or the shadow alone.
export type PlaneView = "planar" | "cast" | "overlay" | "shadow";
// Two rows of two, or one row of two.
export type GridLayout = "grid" | "pair";

// The face-on views a study shows beside its drawing, in reading order
// after the drawing, or null when it shows the drawing alone.
export function gridViews(c: SpatialConfig): PlaneView[] | null {
  if (!c.shadow?.grid || !casts(c)) return null;
  return shadowReduction(c) ? ["planar", "cast", "overlay"] : ["shadow"];
}
export const gridLayout = (views: PlaneView[]): GridLayout =>
  views.length === 3 ? "grid" : "pair";

// Each view's caption, shown above it and outside the drawing.
export function viewCaption(view: PlaneView | "drawing", c: SpatialConfig) {
  const r = shadowReduction(c);
  switch (view) {
    case "drawing":
      return "The 3D drawing";
    case "planar":
      return `2D ${r!.planar} of the shadow`;
    case "cast":
      return `Shadow of the 3D ${r!.own}`;
    case "overlay":
      return "Both, face on";
    case "shadow":
      return "The shadow, face on";
  }
}

export const gridHelp = tiered(
  "Shows the shadow's plane face on, in views beside the drawing.",
  "Where the construction has a 2D counterpart, a 2 × 2 grid shows the 2D construction with its lines, the 3D one's shadow, and both together; otherwise one view shows the shadow. The face-on views pan and zoom together; the 3D drawing keeps its own camera. Images and videos export every view.",
);

// A point's coordinates on the plane, as the 2D engine's (engine3
// ShadowRequest.flat): (y, z) on x = c, (z, x) on y = c and (x, y) on
// z = c, each the plane seen from the side its normal points to.
export function flat(plane: ShadowPlane, p: Vec3): Vec {
  switch (plane) {
    case "x":
      return { x: p.y, y: p.z };
    case "y":
      return { x: p.z, y: p.x };
    case "z":
      return { x: p.x, y: p.y };
  }
}

// A rectangle of the plane, from (x0, y0) to (x1, y1).
export type PlaneRect = { x0: number; y0: number; x1: number; y1: number };

// The shadow's window (engine3 ShadowRequest.window) on the plane, or null
// when it is not finite.
export function planeRect(s: ShadowResult): PlaneRect | null {
  const points = s.corners.map((p) => flat(s.plane, p));
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const r = {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
  return Object.values(r).every(Number.isFinite) ? r : null;
}

// The rectangle holding both: during playback the face-on views frame
// every window shown since it began, so they grow with the geometry and
// never shrink or jump.
export function grow(a: PlaneRect | null, b: PlaneRect): PlaneRect {
  if (!a) return b;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

// The face-on views' shared camera: a pan in page units and a zoom about
// the middle, applied to the fitted window, as the 2D drawing's camera.
export type PlaneCamera = { x: number; y: number; zoom: number };
export const fittedCamera: PlaneCamera = { x: 0, y: 0, zoom: 1 };
// The zoom limits of the face-on views, as the 2D drawing's unrefined.
export const planeZoom = { min: 0.1, max: 1000 };

// The page every view draws on, as the other drawings', in page units.
export const page = { width: 1000, height: 760 };
// A view's framing: the point at the middle of the page, the page units
// per unit of the plane, and the window's larger side. The 2D drawing
// draws to it (Plot's framing).
export type Framing = { cx: number; cy: number; scale: number; span: number };

// The framing that shows the window with a margin, moved by the camera.
export function framing(r: PlaneRect, camera: PlaneCamera): Framing {
  const w = Math.max(r.x1 - r.x0, 1e-300),
    h = Math.max(r.y1 - r.y0, 1e-300);
  const scale = 0.94 * Math.min(page.width / w, page.height / h) * camera.zoom;
  return {
    cx: (r.x0 + r.x1) / 2 - camera.x / scale,
    cy: (r.y0 + r.y1) / 2 + camera.y / scale,
    scale,
    span: Math.max(w, h) / camera.zoom,
  };
}

// A plane's point on the page.
export const onPage = (f: Framing, p: Vec) => ({
  x: page.width / 2 + (p.x - f.cx) * f.scale,
  y: page.height / 2 - (p.y - f.cy) * f.scale,
});

// The grid's columns and rows.
export const gridCells = (views: PlaneView[]) => ({
  columns: 2,
  rows: gridLayout(views) === "grid" ? 2 : 1,
});
// The grid's page, as a multiple of the drawing's own.
export function gridPage(views: PlaneView[]) {
  const { columns, rows } = gridCells(views);
  return { width: columns * page.width, height: rows * page.height };
}
