// A 2D camera path: the drawing's camera flown through key views, an
// animation of the camera alone with the study fixed. The list of views and
// the timing are shared with the 3D notebook (key-views.ts); this module says
// what a 2D view is and how the camera moves between two of them. See
// mathematics.md#planar-camera-paths.
//
// A key view is the point of the plane in the middle of the page and the
// zoom, relative to the study's fitted framing, at which it is drawn.
import type { Viewport } from "./animation";
import { tiered } from "./help";
import {
  hermite,
  keysError,
  locate,
  maxKeys,
  pieceSteps,
  pieceZoom,
  slopes,
  type KeyBase,
  type PathError,
  type PathStyle,
} from "./key-views";
import type { PlotCamera } from "./planar-link";
export { pieceAt } from "./key-views";
import { plainZoom, viewZoom } from "./refinement";
import type { ViewRect } from "./types";

export type PlanarKeyView = KeyBase & { x: number; y: number; zoom: number };
export type PlanarPath = { style: PathStyle; keys: PlanarKeyView[] };
export const defaultPlanarPath: PlanarPath = { style: "steady", keys: [] };
// The drawing's fitted framing: its center, scale (page units per unit of
// the plane) and span.
export type Fit = { cx: number; cy: number; scale: number; span: number };

export const asFirst = ({ leg: _, ...key }: PlanarKeyView): PlanarKeyView =>
  key;

export const planarPathHelp = {
  mode: tiered(
    "Fly the camera through your key views in order. Geometry stays fixed.",
    "Each leg takes its share of the duration by its leg time. While a leg zooms, the place you framed comes straight toward the middle. A study refined to its view is refined to each frame's.",
  ),
  steady:
    "Each leg pans and zooms at a steady rate, changing course only at a view.",
  smooth: tiered(
    "The camera passes through each view without stopping, blending its zoom.",
    "It never zooms beyond the two views of a leg, so it rests at a view where the zoom turns back. With two views it is Steady.",
  ),
  keys: tiered(
    `Up to ${maxKeys} views. Add the drawing's view; to adjust one, show it, change the drawing, and set it again.`,
    `Leg times move with their view; a view that becomes the first loses its own. Views zoom up to ${plainZoom}×, or ${viewZoom.toLocaleString("en-US")}× in a study refined to its view.`,
  ),
};

// Why a path cannot play, naming the field, or null. The field and the
// message read as one sentence. zoomLimit is the drawing's.
export function planarPathError(
  path: PlanarPath,
  zoomLimit: number,
): PathError | null {
  return keysError(path.keys, (key, name) =>
    [key.x, key.y, key.zoom].every(Number.isFinite) &&
    key.zoom >= 0.1 &&
    key.zoom <= zoomLimit
      ? null
      : {
          field: name,
          message:
            key.zoom > zoomLimit && zoomLimit < viewZoom
              ? `zooms past ${zoomLimit}×; refine the study to its view to zoom further.`
              : "is outside the drawing's zoom limits.",
        },
  );
}

// The view the drawing shows as a key view: the point in the middle of the
// page and the zoom relative to the fitted framing.
export const keyFromViewport = (view: Viewport, fit: Fit): PlanarKeyView => ({
  name: "",
  x: view.cx,
  y: view.cy,
  zoom: view.scale / fit.scale,
});
// A key view as the drawing's manual camera, offset from the fitted framing
// in page units (see Plot).
export function keyCamera(key: PlanarKeyView, fit: Fit): PlotCamera {
  const s = fit.scale * key.zoom;
  return { x: -(key.x - fit.cx) * s, y: (key.y - fit.cy) * s, zoom: key.zoom };
}
const viewport = (key: PlanarKeyView, fit: Fit): Viewport => ({
  cx: key.x,
  cy: key.y,
  scale: fit.scale * key.zoom,
  span: fit.span / key.zoom,
});

// The camera at progress p ∈ [0, 1], each leg taking its share of the
// duration in proportion to its time. At a view it is that view exactly.
// Between views, log zoom is interpolated in the path's style, and the
// framed point, the point in the middle of the page, moves linearly in
// 1/zoom (or in time on a leg that keeps its zoom), so the place framed at
// the leg's end comes straight to the middle. A cyclic path (a loop's, whose
// last view is its first) passes its seam smoothly.
export function planarPathView(
  path: PlanarPath,
  fit: Fit,
  p: number,
  cyclic = false,
): Viewport {
  const keys = path.keys,
    n = keys.length;
  if (n < 2) return viewport(keys[0], fit);
  const { h, i, f, end } = locate(path, p);
  if (end) return viewport(keys[n - 1], fit);
  if (f === 0) return viewport(keys[i], fit);
  const lz = keys.map((k) => Math.log(k.zoom));
  const z =
    path.style === "smooth"
      ? hermite(lz, slopes(lz, h, cyclic), h[i], i, f)
      : lz[i] + (lz[i + 1] - lz[i]) * f;
  const span = lz[i + 1] - lz[i];
  const sigma = span === 0 ? f : Math.expm1(-(z - lz[i])) / Math.expm1(-span);
  const a = keys[i],
    b = keys[i + 1],
    zoom = Math.exp(z);
  return {
    cx: a.x + (b.x - a.x) * sigma,
    cy: a.y + (b.y - a.y) * sigma,
    scale: fit.scale * zoom,
    span: fit.span / zoom,
  };
}

// A view's camera in words, for its hint.
export const describeKey = (key: PlanarKeyView) =>
  `zoom ${Number(key.zoom.toPrecision(4))}×, centered at (${Number(key.x.toPrecision(6))}, ${Number(key.y.toPrecision(6))})`;

// A piece of a flight: a stretch of progress, [from, to), whose zoomed-in
// frames are all drawn from one refinement, to the area they show and as
// finely as the deepest of them (see engine.View's radius). Refining a
// piece once, rather than every frame, keeps playback in time; playback and
// export cut the same pieces, so they draw the same curves.
export type Piece = {
  from: number;
  to: number;
  view: ViewRect & { radius: number };
};
// A piece spans a zoom of at most pieceZoom, and its center drifts at most
// a quarter of its narrowest frame's width.

// A flight's pieces, in order, over the progress where it zooms in past
// the fitted framing; frames at the fitted zoom or wider need no piece.
// rect is the rectangle a camera shows (Plot's viewRect).
export function flightPieces(
  path: PlanarPath,
  fit: Fit,
  cyclic: boolean,
  rect: (view: Viewport) => ViewRect,
): Piece[] {
  const n = Math.max(1, path.keys.length - 1) * pieceSteps;
  const pieces: Piece[] = [];
  type Open = {
    from: number;
    start: Viewport;
    low: number;
    high: number;
    views: Viewport[];
  };
  let open: Open | null = null;
  // Closes the open piece at progress to, where the frame view begins the
  // next stretch: frames between its last sample and that one belong to it.
  const close = (to: number, view?: Viewport) => {
    if (!open) return;
    const rects = (view ? [...open.views, view] : open.views).map(rect);
    pieces.push({
      from: open.from,
      to,
      view: {
        x0: Math.min(...rects.map((r) => r.x0)),
        y0: Math.min(...rects.map((r) => r.y0)),
        x1: Math.max(...rects.map((r) => r.x1)),
        y1: Math.max(...rects.map((r) => r.y1)),
        radius: Math.min(
          ...rects.map((r) => Math.hypot(r.x1 - r.x0, r.y1 - r.y0) / 2),
        ),
      },
    });
    open = null;
  };
  for (let k = 0; k <= n; k++) {
    const p = k / n,
      view = planarPathView(path, fit, p, cyclic);
    if (!(view.scale > fit.scale)) {
      close(p, view);
      continue;
    }
    const current = open as Open | null;
    if (current) {
      const low = Math.min(current.low, view.scale),
        high = Math.max(current.high, view.scale);
      const narrowest = rect({ ...view, scale: high });
      const drift = Math.hypot(
        view.cx - current.start.cx,
        view.cy - current.start.cy,
      );
      if (high / low > pieceZoom || drift > (narrowest.x1 - narrowest.x0) / 4)
        close(p, view);
      else {
        current.low = low;
        current.high = high;
      }
    }
    if (!open)
      open = {
        from: p,
        start: view,
        low: view.scale,
        high: view.scale,
        views: [],
      };
    (open as Open).views.push(view);
  }
  close(1);
  return pieces;
}
