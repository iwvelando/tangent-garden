import { useEffect, useRef, useState, type RefObject } from "react";
import { createGesture, zoomAbout, type Motion } from "./gestures";
import type { Vec } from "./types";

// One pane's view in the drawing dialog: a frame fitted to what it shows, and
// a camera offset from that frame in its 1000 × 760 page units.
export type PaneFrame = { cx: number; cy: number; scale: number; span: number };
export type PaneCamera = { x: number; y: number; zoom: number };
export type Box = { minX: number; minY: number; maxX: number; maxY: number };

const pageWidth = 1000,
  pageHeight = 760,
  margin = 1.12;
export const drawingWindow: PaneFrame = {
  cx: 0,
  cy: 0,
  scale: pageWidth / 6,
  span: 6,
};
export const homeCamera: PaneCamera = { x: 0, y: 0, zoom: 1 };
const zoomLimits = [1, 32] as const;

export const atHome = (c: PaneCamera) => c.x === 0 && c.y === 0 && c.zoom === 1;

// A matched view can lie outside the limits; zooming from it must not jump.
const zoomRange = (c: PaneCamera) =>
  [Math.min(zoomLimits[0], c.zoom), Math.max(zoomLimits[1], c.zoom)] as [
    number,
    number,
  ];

// Zooming back by the same steps lands within rounding of the fit, and that is
// the fit again rather than a moved pane. An anchor comes through the SVG's
// single-precision transform, so a pan's rounding is judged by what shows: half
// a page unit is under a pixel. A real pan left behind stays.
function zoomed(c: PaneCamera, k: number, u = 0, v = 0): PaneCamera {
  const next = zoomAbout(c, k, zoomRange(c), u, v);
  if (Math.abs(next.zoom - 1) > 1e-9) return next;
  return {
    zoom: 1,
    x: Math.abs(next.x) < 0.5 ? 0 : next.x,
    y: Math.abs(next.y) < 0.5 ? 0 : next.y,
  };
}

export function pointsBox(points: Vec[], box?: Box): Box {
  let { minX, minY, maxX, maxY } = box ?? {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function frameBox(box: Box): PaneFrame {
  const width = box.maxX - box.minX,
    height = box.maxY - box.minY;
  const scale = Math.min(
    pageWidth / (margin * width),
    pageHeight / (margin * height),
  );
  if (!Number.isFinite(scale)) return drawingWindow;
  return {
    cx: (box.minX + box.maxX) / 2,
    cy: (box.minY + box.maxY) / 2,
    scale,
    span: pageWidth / scale,
  };
}

// Where a camera puts a frame. The span stays the frame's, so anything sized
// from it keeps its length in the plane as a pane zooms.
export function paneView(frame: PaneFrame, c: PaneCamera): PaneFrame {
  const scale = frame.scale * c.zoom;
  return {
    cx: frame.cx - c.x / scale,
    cy: frame.cy + c.y / scale,
    scale,
    span: frame.span,
  };
}

export const viewBoxOf = (v: PaneFrame) =>
  `${v.cx - pageWidth / 2 / v.scale} ${-v.cy - pageHeight / 2 / v.scale} ${pageWidth / v.scale} ${pageHeight / v.scale}`;

// The camera that shows another pane's view from this pane's frame.
export function cameraMatching(frame: PaneFrame, view: PaneFrame): PaneCamera {
  return {
    zoom: view.scale / frame.scale,
    x: (frame.cx - view.cx) * view.scale,
    y: (view.cy - frame.cy) * view.scale,
  };
}

// A client point in a pane's page, from its middle, as the SVG actually draws
// it: its border and rounded box sizes would otherwise make a pan fall short of
// the pointer and a zoom drift from its anchor. The result does not depend on
// the camera, so events within one frame can share it.
export function panePage(svg: SVGSVGElement, x: number, y: number) {
  const m = svg.getScreenCTM()!,
    view = svg.viewBox.baseVal,
    ratio = pageWidth / (view.width * m.a);
  return {
    ratio,
    height: pageHeight / ratio,
    u: (x - m.a * (view.x + view.width / 2) - m.e) * ratio,
    v: (y - m.d * (view.y + view.height / 2) - m.f) * ratio,
  };
}

// A pinch reaches the wheel as small deltas with ctrlKey; a held Ctrl and a
// mouse wheel send far larger ones, kept here to one modest step.
const pinchRate = 0.01,
  pinchStep = 25;

// The camera of one pane, and every way of moving it but its pointers' owner.
export function usePaneCamera(
  target: RefObject<Element | null>,
  drawing: () => SVGSVGElement | null,
  options: {
    active: boolean;
    // Whether a finger landing here should keep the page from scrolling.
    claimsTouch?: (x: number, y: number) => boolean;
  },
) {
  const [camera, setCamera] = useState(homeCamera);
  const gesture = useRef(createGesture());
  const latest = useRef({ camera, drawing, options });
  latest.current = { camera, drawing, options };

  useEffect(() => {
    const element = target.current;
    if (!element || !options.active) return;
    const wheel = (event: Event) => {
      const e = event as WheelEvent;
      const svg = latest.current.drawing();
      if (!svg) return;
      // At the fit there is nowhere to pan: a scroll belongs to the dialog.
      if (!e.ctrlKey && atHome(latest.current.camera)) return;
      e.preventDefault();
      if (gesture.current.count) return;
      const { ratio, height, u, v } = panePage(svg, e.clientX, e.clientY);
      if (e.ctrlKey) {
        const step = Math.max(-pinchStep, Math.min(pinchStep, e.deltaY));
        setCamera((c) => zoomed(c, Math.exp(-step * pinchRate), u, v));
        return;
      }
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? height
            : 1;
      setCamera((c) => ({
        ...c,
        x: c.x - e.deltaX * unit * ratio,
        y: c.y - e.deltaY * unit * ratio,
      }));
    };
    // Safari's own events for a trackpad pinch: scale runs from the start.
    // Held pointers own the view, since iOS also sends these during a pinch.
    type Pinch = Event & { scale: number; clientX: number; clientY: number };
    let last = 1;
    const pinchStart = (e: Event) => {
      e.preventDefault();
      last = 1;
    };
    const pinchChange = (event: Event) => {
      const e = event as Pinch,
        svg = latest.current.drawing();
      e.preventDefault();
      if (gesture.current.count || !svg) return;
      const k = e.scale / last,
        { u, v } = panePage(svg, e.clientX, e.clientY);
      last = e.scale;
      setCamera((c) => zoomed(c, k, u, v));
    };
    // A fitted pane lets a one-finger swipe scroll the page, through its
    // touch-action. Two fingers, or a finger on something to edit, are ours.
    const touchStart = (event: Event) => {
      const e = event as TouchEvent,
        t = e.touches[0];
      if (
        e.cancelable &&
        (e.touches.length > 1 ||
          latest.current.options.claimsTouch?.(t.clientX, t.clientY))
      )
        e.preventDefault();
    };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("gesturestart", pinchStart);
    element.addEventListener("gesturechange", pinchChange);
    element.addEventListener("touchstart", touchStart, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("gesturestart", pinchStart);
      element.removeEventListener("gesturechange", pinchChange);
      element.removeEventListener("touchstart", touchStart);
    };
  }, [options.active]);

  return {
    camera,
    setCamera,
    gesture,
    home: () => setCamera(homeCamera),
    zoomBy: (k: number) => setCamera((c) => zoomed(c, k)),
    // Held pointers belong to the view they began on. Once it is replaced their
    // release may go elsewhere, and a forgotten one would be half of every pinch.
    forgetPointers: () => {
      gesture.current = createGesture();
    },
    canZoomIn: camera.zoom < zoomLimits[1],
    canZoomOut: camera.zoom > zoomLimits[0],
    // A held pointer's motion: a drag pans when allowed, and a pinch always
    // zooms about its fingers while its midpoint pans.
    follow(motion: Motion | null, svg: SVGSVGElement, panning = true) {
      if (motion?.kind === "drag" && panning) {
        const { ratio } = panePage(svg, 0, 0);
        setCamera((c) => ({
          ...c,
          x: c.x + motion.dx * ratio,
          y: c.y + motion.dy * ratio,
        }));
      } else if (motion?.kind === "pinch") {
        const { ratio, u, v } = panePage(svg, motion.mid.x, motion.mid.y);
        setCamera((c) =>
          zoomed(
            {
              ...c,
              x: c.x + motion.dx * ratio,
              y: c.y + motion.dy * ratio,
            },
            motion.scale,
            u,
            v,
          ),
        );
      }
    },
  };
}
