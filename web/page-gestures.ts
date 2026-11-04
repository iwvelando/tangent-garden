import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { createGesture, zoomAbout, type Motion } from "./gestures";
import type { PlotCamera } from "./planar-link";

// The manual camera of a drawing in a fixed page, such as the Apollonian
// garden's and hyperbolic lace's 1000 × 760: drag to pan, wheel or pinch
// to zoom about the pointer, arrows, + / − (about the middle) and Home
// from the keyboard, and a tap that moved less than 4 pixels to choose
// something. The camera pans in page units and zooms within range; the
// drawing decides what a tap at a page point means, with a tolerance in
// page units that is wider for a finger than for a cursor.
export function usePageGestures(o: {
  page: { width: number; height: number };
  range: [number, number];
  camera: PlotCamera;
  onCamera?: (c: PlotCamera) => void;
  onTap?: (at: { x: number; y: number }, tolerance: number) => void;
}) {
  const { width, height } = o.page;
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef(createGesture());
  const camera = useRef(o.camera);
  camera.current = o.camera;
  const change = useRef(o.onCamera);
  change.current = o.onCamera;
  const range = useRef(o.range);
  range.current = o.range;
  const tap = useRef<{ x: number; y: number; type: string } | null>(null);
  // Client pixels to page units, as the SVG's default meet fitting draws it.
  const page = (clientX: number, clientY: number, box: DOMRect) => {
    const ratio = Math.max(width / box.width, height / box.height);
    return {
      ratio,
      x: width / 2 + (clientX - box.left - box.width / 2) * ratio,
      y: height / 2 + (clientY - box.top - box.height / 2) * ratio,
    };
  };
  const apply = (motion: Motion, box: DOMRect) => {
    const c = camera.current,
      ratio = Math.max(width / box.width, height / box.height);
    let next: PlotCamera;
    if (motion.kind === "drag")
      next = { ...c, x: c.x + motion.dx * ratio, y: c.y + motion.dy * ratio };
    else {
      const [lo, hi] = range.current;
      const zoom = Math.max(lo, Math.min(hi, c.zoom * motion.scale)),
        k = zoom / c.zoom;
      // Zoom about the fingers' midpoint, kept under them as they move.
      const u = (motion.mid.x - box.left - box.width / 2) * ratio,
        v = (motion.mid.y - box.top - box.height / 2) * ratio;
      next = {
        zoom,
        x: u - (u - motion.dx * ratio - c.x) * k,
        y: v - (v - motion.dy * ratio - c.y) * k,
      };
    }
    camera.current = next;
    change.current?.(next);
  };
  const active = !!o.onCamera;
  useEffect(() => {
    const el = svg.current;
    if (!el || !active) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      apply(
        {
          kind: "pinch",
          scale: Math.exp(-e.deltaY * 0.001),
          dx: 0,
          dy: 0,
          mid: { x: e.clientX, y: e.clientY },
        },
        el.getBoundingClientRect(),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [active]);
  return {
    ref: svg,
    tabIndex: active ? 0 : undefined,
    onPointerDown: (e: PointerEvent<SVGSVGElement>) => {
      if (!active || e.button !== 0) return;
      tap.current =
        gesture.current.count === 0
          ? { x: e.clientX, y: e.clientY, type: e.pointerType }
          : null;
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current.down(e);
    },
    onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
      const motion = gesture.current.move(e);
      if (!motion || !active) return;
      if (
        motion.kind === "pinch" ||
        (tap.current &&
          Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 4)
      )
        tap.current = null;
      apply(motion, e.currentTarget.getBoundingClientRect());
    },
    onPointerUp: (e: PointerEvent<SVGSVGElement>) => {
      gesture.current.up(e);
      const t = tap.current;
      tap.current = null;
      if (!t || !o.onTap) return;
      const at = page(
        e.clientX,
        e.clientY,
        e.currentTarget.getBoundingClientRect(),
      );
      // A finger covers more than a cursor does.
      o.onTap({ x: at.x, y: at.y }, (t.type === "touch" ? 18 : 10) * at.ratio);
    },
    onPointerCancel: (e: PointerEvent<SVGSVGElement>) => {
      gesture.current.up(e);
      tap.current = null;
    },
    onLostPointerCapture: (e: PointerEvent<SVGSVGElement>) =>
      gesture.current.up(e),
    // + and − zoom about the middle of the page. Keys repeat faster than
    // renders, so each applies to the latest camera, as gestures do.
    onKeyDown: (e: KeyboardEvent<SVGSVGElement>) => {
      const onCamera = o.onCamera;
      if (!onCamera) return;
      const c = camera.current,
        range = o.range;
      const next: PlotCamera | null =
        e.key === "Home"
          ? { x: 0, y: 0, zoom: 1 }
          : e.key === "+" || e.key === "="
            ? zoomAbout(c, 1.2, range)
            : e.key === "-"
              ? zoomAbout(c, 1 / 1.2, range)
              : e.key === "ArrowLeft"
                ? { ...c, x: c.x - 25 }
                : e.key === "ArrowRight"
                  ? { ...c, x: c.x + 25 }
                  : e.key === "ArrowUp"
                    ? { ...c, y: c.y - 25 }
                    : e.key === "ArrowDown"
                      ? { ...c, y: c.y + 25 }
                      : null;
      if (next) {
        e.preventDefault();
        camera.current = next;
        onCamera(next);
      }
    },
  };
}
